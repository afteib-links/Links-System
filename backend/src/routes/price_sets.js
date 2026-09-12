const express = require('express');
const { getPool, query } = require('../db');
const { requireAuth, requirePermission } = require('../middleware/auth');
const {
  assertOwnerExclusive,
  assertValidFromRequired,
  allocatePriceSetNo,
} = require('../services/price_set_lifecycle');
const { validateDistanceRule } = require('../services/distance_calc');
const { normalizePriceMatrixSettings, SETTING_KEYS } = require('../services/price_matrix_settings');
const { validateFeeItems, feeItemsToLines } = require('../services/fee_item_rules');
const { applyDailyPriceCalcWithRules } = require('../services/price_calc_rules');

const RECALCULATED_REPORT_FIELDS = [
  'applied_price_set_id', 'selected_fee_item_id', 'selected_fee_item_name', 'fee_item_selection_source',
  'break_time', 'break_minutes', 'binding_hours', 'work_hours', 'overtime_hours', 'shortage_hours',
  'shortage_minutes_billing', 'shortage_minutes_payment', 'shortage_amount_billing', 'shortage_amount_payment',
  'distance_amount_billing', 'distance_amount_payment', 'distance_calculation_mode', 'night_hours',
  'night_minutes_billing', 'night_minutes_payment', 'night_overtime_minutes_billing',
  'night_overtime_minutes_payment', 'regular_overtime_minutes_billing', 'regular_overtime_minutes_payment',
  'calculated_billing_amount', 'calculated_payment_amount', 'calculation_detail',
  'calculation_rule_set_id', 'calculation_engine_code',
];

function todayTokyoYmd() {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Tokyo' }).format(new Date());
}

const router = express.Router();
router.use(requireAuth, requirePermission('price_sets'));

const SET_FIELDS = [
  'price_set_name',
  'company_id',
  'base_project_id',
  'project_id',
  'apply_start_date',
  'apply_end_date',
  'note',
];

function pick(body, fields) {
  const out = {};
  for (const key of fields) {
    if (!Object.prototype.hasOwnProperty.call(body, key)) continue;
    const val = body[key];
    out[key] = val === '' || val === undefined ? null : val;
  }
  return out;
}

function parseExtraDataField(val) {
  if (val == null || val === '') return null;
  if (typeof val === 'object') return val;
  try {
    return JSON.parse(val);
  } catch {
    return null;
  }
}

function mergeExtraData(current, patch) {
  const base = parseExtraDataField(current) || {};
  if (!patch || typeof patch !== 'object') return base;
  return { ...base, ...patch };
}

function userRoles(req) {
  return Array.isArray(req.session?.user?.roles) ? req.session.user.roles : [req.session?.user?.role].filter(Boolean);
}

function isAdmin(req) {
  return userRoles(req).includes('admin');
}

function protectAdminExpressions(currentExtra, nextExtra) {
  const current = parseExtraDataField(currentExtra) || {};
  const next = parseExtraDataField(nextExtra) || {};
  const byId = new Map((current.fee_items || []).flatMap((item) => (item.rows || []).map((row) => [String(row.id), row])));
  next.fee_items = (next.fee_items || []).map((item) => ({
    ...item,
    rows: (item.rows || []).map((row) => {
      const before = byId.get(String(row.id)) || {};
      return {
        ...row,
        condition_expression: before.condition_expression || '',
        billing_expression: before.billing_expression || '',
        payment_expression: before.payment_expression || '',
        rule_state: before.rule_state || row.rule_state || 'active',
      };
    }),
  }));
  return next;
}

function sanitizeExtraDataForUser(raw, req) {
  const extra = parseExtraDataField(raw);
  if (!extra || isAdmin(req)) return raw;
  const clean = JSON.parse(JSON.stringify(extra));
  clean.fee_items = (clean.fee_items || []).map((item) => ({
    ...item,
    rows: (item.rows || []).map((row) => {
      const hasAdminRule = Boolean(row.condition_expression || row.billing_expression || row.payment_expression);
      const copy = { ...row, has_admin_rule: hasAdminRule };
      delete copy.condition_expression;
      delete copy.billing_expression;
      delete copy.payment_expression;
      delete copy.undefined_variables;
      delete copy.rule_error;
      return copy;
    }),
  }));
  return clean;
}

function validateExtraData(extra) {
  for (const side of ['billing', 'payment']) {
    const rule = extra?.distance_rules?.[side];
    if (rule?.mode) validateDistanceRule(rule);
  }
  if (Array.isArray(extra?.fee_items)) {
    const validated = validateFeeItems(extra.fee_items);
    extra.fee_items = validated.items;
  }
  return extra;
}

function requestError(status, message, code = 'validation_error') {
  const error = new Error(message);
  error.status = status;
  error.code = code;
  return error;
}

async function allocatePriceSeries(conn, data, source = {}) {
  const companyId = data.company_id ? Number(data.company_id) : null;
  const [rows] = await conn.query(
    `SELECT COALESCE(MAX(series_number), 0) AS max_no
     FROM price_series WHERE company_id <=> ? FOR UPDATE`,
    [companyId]
  );
  const seriesNumber = Number(rows[0]?.max_no || 0) + 1;
  const seriesCode = `FEE-${String(companyId || 0).padStart(5, '0')}-${String(seriesNumber).padStart(4, '0')}`;
  const [result] = await conn.query(
    `INSERT INTO price_series
      (company_id, series_number, series_code, price_series_name, base_project_id, project_id,
       source_price_series_id, source_price_set_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      companyId, seriesNumber, seriesCode, data.price_set_name,
      data.base_project_id || null, data.project_id || null,
      source.price_series_id || null, source.price_set_id || null,
    ]
  );
  return { price_series_id: result.insertId, series_code: seriesCode, revision_no: 1 };
}

function revisionCode(row) {
  return row.series_code ? `${row.series_code}-R${String(row.revision_no || 1).padStart(3, '0')}` : row.price_set_no;
}

function sameJson(a, b) {
  return JSON.stringify(a) === JSON.stringify(b);
}

function threeWayMerge(oldValue, newValue, individualValue, path = '', resolutions = {}, conflicts = []) {
  if (sameJson(newValue, oldValue)) return individualValue;
  if (sameJson(individualValue, oldValue) || sameJson(individualValue, newValue)) return newValue;
  const allObjects = [oldValue, newValue, individualValue].every((value) => value && typeof value === 'object');
  const allArrays = allObjects && [oldValue, newValue, individualValue].every(Array.isArray);
  if (allArrays) {
    const keyed = [oldValue, newValue, individualValue].every((list) => list.every((row) => row && typeof row === 'object' && row.id));
    if (keyed) {
      const ids = [...new Set([...oldValue, ...newValue, ...individualValue].map((row) => String(row.id)))];
      return ids.map((id) => threeWayMerge(
        oldValue.find((row) => String(row.id) === id),
        newValue.find((row) => String(row.id) === id),
        individualValue.find((row) => String(row.id) === id),
        `${path}[${id}]`, resolutions, conflicts
      )).filter((value) => value !== undefined);
    }
  }
  if (allObjects && !allArrays) {
    const keys = [...new Set([...Object.keys(oldValue), ...Object.keys(newValue), ...Object.keys(individualValue)])];
    return Object.fromEntries(keys.map((key) => [key, threeWayMerge(
      oldValue[key], newValue[key], individualValue[key], path ? `${path}.${key}` : key, resolutions, conflicts
    )]).filter(([, value]) => value !== undefined));
  }
  conflicts.push({ path, base_before: oldValue, base_after: newValue, individual: individualValue });
  return resolutions[path] === 'base' ? newValue : individualValue;
}

function mergeRevisionData(baseBefore, baseAfter, individual, resolutions = {}) {
  const conflicts = [];
  const before = { extra_data: parseExtraDataField(baseBefore?.extra_data) || {}, lines: normalizeLines(baseBefore?.lines || []) };
  const after = { extra_data: parseExtraDataField(baseAfter?.extra_data) || {}, lines: normalizeLines(baseAfter?.lines || []) };
  const current = { extra_data: parseExtraDataField(individual?.extra_data) || {}, lines: normalizeLines(individual?.lines || []) };
  const merged = threeWayMerge(before, after, current, '', resolutions, conflicts);
  if (Array.isArray(merged.extra_data?.fee_items) && merged.extra_data.fee_items.some((item) => Array.isArray(item.rows))) {
    merged.lines = feeItemsToLines(merged.extra_data.fee_items);
  }
  return { ...merged, conflicts };
}

async function createRevisionFromData(conn, source, payload, actorUserId, actionCode) {
  const startDate = String(payload.apply_start_date || '').slice(0, 10);
  assertValidFromRequired(startDate);
  if (String(source.apply_start_date).slice(0, 10) >= startDate) {
    throw requestError(400, `${source.series_code || source.price_set_no}: 適用開始日は現在版より後を指定してください`);
  }
  const [maxRows] = await conn.query('SELECT COALESCE(MAX(revision_no),0) AS max_no FROM price_sets WHERE price_series_id = ?', [source.price_series_id]);
  const revisionNo = Number(maxRows[0].max_no) + 1;
  const previousEnd = new Date(`${startDate}T12:00:00Z`);
  previousEnd.setUTCDate(previousEnd.getUTCDate() - 1);
  await conn.query(
    `UPDATE price_sets SET apply_end_date = ?, is_current_revision = 0, version = version + 1
     WHERE price_set_id = ? AND is_current_revision = 1`,
    [previousEnd.toISOString().slice(0, 10), source.price_set_id]
  );
  const priceSetNo = await allocatePriceSetNo(conn);
  const [created] = await conn.query(
    `INSERT INTO price_sets
      (price_set_no, price_series_id, revision_no, revision_reason, is_current_revision,
       source_price_set_id, price_set_name, company_id, base_project_id, project_id,
       apply_start_date, apply_end_date, note, extra_data)
     VALUES (?, ?, ?, ?, 1, ?, ?, ?, ?, ?, ?, NULL, ?, ?)`,
    [
      priceSetNo, source.price_series_id, revisionNo, payload.reason || actionCode,
      payload.source_price_set_id || source.price_set_id, source.price_set_name, source.company_id,
      source.base_project_id, source.project_id, startDate, source.note,
      JSON.stringify(payload.extra_data || {}),
    ]
  );
  await syncLines(conn, created.insertId, normalizeLines(payload.lines || []));
  await conn.query(
    `INSERT INTO price_set_revision_audit_logs
      (price_set_id, action_code, before_data, after_data, reason, actor_user_id)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [created.insertId, actionCode, JSON.stringify(source), JSON.stringify(payload), payload.reason || actionCode, actorUserId]
  );
  return { price_set_id: created.insertId, revision_no: revisionNo };
}

function normalizeLines(list) {
  if (!Array.isArray(list)) return [];
  return list.map((row, idx) => ({
    price_set_line_id: row.price_set_line_id ? Number(row.price_set_line_id) : null,
    weekday_code: row.weekday_code || 'all',
    calc_type_code: row.calc_type_code || null,
    price_type_code: row.price_type_code || null,
    billing_unit_price: Number(row.billing_unit_price || 0),
    payment_unit_price: Number(row.payment_unit_price || 0),
    sort_order: Number(row.sort_order != null ? row.sort_order : idx * 10),
  }));
}

function handleRouteError(res, err, fallbackMessage) {
  if (err.status && err.code) {
    return res.status(err.status).json({ ok: false, message: err.message, code: err.code });
  }
  console.error(fallbackMessage, err);
  return res.status(500).json({ ok: false, message: fallbackMessage });
}

function ownerFromData(data) {
  const owner = {};
  if (data.base_project_id) owner.base_project_id = Number(data.base_project_id);
  if (data.project_id) owner.project_id = Number(data.project_id);
  return owner;
}

function profitRate(billing, payment) {
  const b = Number(billing || 0);
  const p = Number(payment || 0);
  if (!b) return null;
  return Math.round(((b - p) / b) * 1000) / 10;
}

async function fetchDetail(id) {
  const rows = await query(
    `SELECT ps.*, s.series_code, s.series_number, s.source_price_series_id,
            s.source_price_set_id AS series_source_price_set_id,
            c.company_name, b.template_name AS base_template_name
     FROM price_sets ps
     LEFT JOIN price_series s ON s.price_series_id = ps.price_series_id
     LEFT JOIN companies c ON c.company_id = ps.company_id
     LEFT JOIN base_projects b ON b.base_project_id = ps.base_project_id
     WHERE ps.price_set_id = ? AND ps.is_deleted = 0
     LIMIT 1`,
    [id]
  );
  if (!rows.length) return null;
  const lines = await query(
    `SELECT * FROM price_set_lines
     WHERE price_set_id = ? AND is_deleted = 0
     ORDER BY sort_order ASC, price_set_line_id ASC`,
    [id]
  );
  return {
    ...rows[0],
    revision_code: revisionCode(rows[0]),
    lines: lines.map((l) => ({
      ...l,
      profit_rate: profitRate(l.billing_unit_price, l.payment_unit_price),
    })),
  };
}

async function syncLines(conn, priceSetId, lines) {
  const [existing] = await conn.query(
    `SELECT price_set_line_id FROM price_set_lines WHERE price_set_id = ? AND is_deleted = 0`,
    [priceSetId]
  );
  const keep = new Set(lines.filter((l) => l.price_set_line_id).map((l) => Number(l.price_set_line_id)));
  for (const row of existing) {
    if (!keep.has(Number(row.price_set_line_id))) {
      await conn.query(
        `UPDATE price_set_lines SET is_deleted = 1, version = version + 1 WHERE price_set_line_id = ?`,
        [row.price_set_line_id]
      );
    }
  }
  for (const line of lines) {
    if (line.price_set_line_id) {
      await conn.query(
        `UPDATE price_set_lines
         SET weekday_code = ?, calc_type_code = ?, price_type_code = ?,
             billing_unit_price = ?, payment_unit_price = ?, sort_order = ?,
             version = version + 1, updated_at = CURRENT_TIMESTAMP
         WHERE price_set_line_id = ? AND price_set_id = ? AND is_deleted = 0`,
        [
          line.weekday_code,
          line.calc_type_code,
          line.price_type_code,
          line.billing_unit_price,
          line.payment_unit_price,
          line.sort_order,
          line.price_set_line_id,
          priceSetId,
        ]
      );
    } else {
      await conn.query(
        `INSERT INTO price_set_lines
          (price_set_id, weekday_code, calc_type_code, price_type_code,
           billing_unit_price, payment_unit_price, sort_order)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [
          priceSetId,
          line.weekday_code,
          line.calc_type_code,
          line.price_type_code,
          line.billing_unit_price,
          line.payment_unit_price,
          line.sort_order,
        ]
      );
    }
  }
}

router.get('/', async (req, res) => {
  try {
    const q = String(req.query.q || '').trim();
    const where = ['ps.is_deleted = 0', 'ps.is_current_revision = 1'];
    const params = [];
    const baseProjectId = Number(req.query.base_project_id || 0);
    const projectId = Number(req.query.project_id || 0);
    if (baseProjectId > 0) {
      where.push('ps.base_project_id = ? AND ps.project_id IS NULL');
      params.push(baseProjectId);
    }
    if (projectId > 0) {
      where.push('ps.project_id = ? AND ps.base_project_id IS NULL');
      params.push(projectId);
    }
    if (q) {
      where.push('(ps.price_set_name LIKE ? OR c.company_name LIKE ?)');
      params.push(`%${q}%`, `%${q}%`);
    }
    const rows = await query(
      `SELECT ps.*, s.series_code, s.series_number, c.company_name, b.template_name AS base_template_name,
              p.manager_name AS project_manager_name,
              (SELECT COUNT(*) FROM price_set_lines l
               WHERE l.price_set_id = ps.price_set_id AND l.is_deleted = 0) AS line_count
       FROM price_sets ps
       LEFT JOIN price_series s ON s.price_series_id = ps.price_series_id
       LEFT JOIN companies c ON c.company_id = ps.company_id
       LEFT JOIN base_projects b ON b.base_project_id = ps.base_project_id
       LEFT JOIN projects p ON p.project_id = ps.project_id
       WHERE ${where.join(' AND ')}
       ORDER BY ps.price_set_id DESC`,
      params
    );
    return res.json({ ok: true, price_sets: rows });
  } catch (err) {
    console.error('[price_sets/list]', err);
    return res.status(500).json({ ok: false, message: '金額データ一覧の取得に失敗しました' });
  }
});

router.get('/calculation-settings', async (_req, res) => {
  try {
    const keys = Object.values(SETTING_KEYS);
    const rows = await query(
      `SELECT setting_key, setting_value
       FROM system_settings
       WHERE is_deleted = 0 AND setting_key IN (${keys.map(() => '?').join(', ')})`,
      keys
    );
    return res.json({ ok: true, settings: normalizePriceMatrixSettings(rows) });
  } catch (err) {
    console.error('[price_sets/calculation-settings]', err);
    return res.status(500).json({ ok: false, message: '料金自動計算設定の取得に失敗しました' });
  }
});

router.get('/:id', async (req, res) => {
  try {
    const detail = await fetchDetail(Number(req.params.id));
    if (!detail) return res.status(404).json({ ok: false, message: '金額データが見つかりません' });
    return res.json({ ok: true, price_set: { ...detail, extra_data: sanitizeExtraDataForUser(detail.extra_data, req) } });
  } catch (err) {
    console.error('[price_sets/get]', err);
    return res.status(500).json({ ok: false, message: '金額データ詳細の取得に失敗しました' });
  }
});

router.post('/', async (req, res) => {
  const pool = getPool();
  const conn = await pool.getConnection();
  try {
    const data = pick(req.body, SET_FIELDS);
    if (!data.price_set_name) {
      return res.status(400).json({ ok: false, message: '名称は必須です' });
    }
    assertOwnerExclusive(data);
    assertValidFromRequired(data.apply_start_date);
    const lines = normalizeLines(req.body.lines);
    let incomingExtra = req.body.extra_data;
    if (!isAdmin(req) && parseExtraDataField(incomingExtra)?.fee_items?.some((item) =>
      (item.rows || []).some((row) => row.condition_expression || row.billing_expression || row.payment_expression))) {
      throw requestError(403, '条件・計算式は管理者だけが設定できます', 'forbidden');
    }
    const extraData = validateExtraData(mergeExtraData(null, incomingExtra));
    await conn.beginTransaction();
    const priceSetNo = await allocatePriceSetNo(conn);
    const series = await allocatePriceSeries(conn, data);
    const [result] = await conn.query(
      `INSERT INTO price_sets
        (price_set_no, price_series_id, revision_no, is_current_revision,
         price_set_name, company_id, base_project_id, project_id, apply_start_date, apply_end_date, note, extra_data)
       VALUES (?, ?, 1, 1, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        priceSetNo,
        series.price_series_id,
        data.price_set_name,
        data.company_id,
        data.base_project_id,
        data.project_id,
        data.apply_start_date,
        data.apply_end_date,
        data.note,
        extraData ? JSON.stringify(extraData) : null,
      ]
    );
    const id = result.insertId;
    await syncLines(conn, id, lines);
    await conn.commit();
    const detail = await fetchDetail(id);
    return res.status(201).json({ ok: true, price_set: { ...detail, extra_data: sanitizeExtraDataForUser(detail.extra_data, req) } });
  } catch (err) {
    await conn.rollback();
    return handleRouteError(res, err, '金額データの作成に失敗しました');
  } finally {
    conn.release();
  }
});

router.put('/:id', async (req, res) => {
  const pool = getPool();
  const conn = await pool.getConnection();
  try {
    const id = Number(req.params.id);
    const current = await fetchDetail(id);
    if (!current) return res.status(404).json({ ok: false, message: '金額データが見つかりません' });
    const data = pick(req.body, SET_FIELDS);
    const merged = { ...current, ...data };
    assertOwnerExclusive(merged);
    if (Object.prototype.hasOwnProperty.call(data, 'apply_start_date') || merged.apply_start_date) {
      assertValidFromRequired(merged.apply_start_date);
    }
    const lines = normalizeLines(req.body.lines);
    await conn.beginTransaction();
    const fields = [];
    const params = [];
    for (const key of SET_FIELDS) {
      if (Object.prototype.hasOwnProperty.call(data, key)) {
        fields.push(`${key} = ?`);
        params.push(data[key]);
      }
    }
    if (!Number(current.is_current_revision) && !String(req.body.revision_reason || '').trim()) {
      throw requestError(400, '過去の改定版を修正する場合は修正理由が必要です');
    }
    if (Object.prototype.hasOwnProperty.call(req.body, 'extra_data')) {
      const incoming = isAdmin(req)
        ? req.body.extra_data
        : protectAdminExpressions(current.extra_data, req.body.extra_data);
      const extraData = validateExtraData(mergeExtraData(current.extra_data, incoming));
      fields.push('extra_data = ?');
      params.push(extraData ? JSON.stringify(extraData) : null);
    }
    if (fields.length) {
      fields.push('version = version + 1');
      params.push(id, Number(req.body.version || current.version));
      const [updated] = await conn.query(
        `UPDATE price_sets SET ${fields.join(', ')}, updated_at = CURRENT_TIMESTAMP
         WHERE price_set_id = ? AND version = ? AND is_deleted = 0`,
        params
      );
      if (!updated.affectedRows) throw requestError(409, '他の利用者が更新しました。再読込してください', 'version_conflict');
    }
    await syncLines(conn, id, lines);
    if (!Number(current.is_current_revision)) {
      const after = { ...merged, extra_data: req.body.extra_data, lines };
      await conn.query(
        `INSERT INTO price_set_revision_audit_logs
          (price_set_id, action_code, before_data, after_data, reason, actor_user_id)
         VALUES (?, 'historical_update', ?, ?, ?, ?)`,
        [id, JSON.stringify(current), JSON.stringify(after), String(req.body.revision_reason).trim(), req.session.user.user_id]
      );
    }
    await conn.commit();
    const detail = await fetchDetail(id);
    return res.json({ ok: true, price_set: { ...detail, extra_data: sanitizeExtraDataForUser(detail.extra_data, req) } });
  } catch (err) {
    await conn.rollback();
    return handleRouteError(res, err, '金額データの更新に失敗しました');
  } finally {
    conn.release();
  }
});

router.get('/:id/revisions', async (req, res) => {
  try {
    const current = await fetchDetail(Number(req.params.id));
    if (!current) return res.status(404).json({ ok: false, message: '金額データが見つかりません' });
    const rows = await query(
      `SELECT ps.price_set_id, ps.price_set_no, ps.revision_no, ps.apply_start_date,
              ps.apply_end_date, ps.revision_reason, ps.is_current_revision, ps.version,
              s.series_code
       FROM price_sets ps
       LEFT JOIN price_series s ON s.price_series_id = ps.price_series_id
       WHERE ps.price_series_id = ? AND ps.is_deleted = 0
       ORDER BY ps.revision_no ASC`,
      [current.price_series_id]
    );
    return res.json({ ok: true, series_code: current.series_code, revisions: rows.map((row) => ({ ...row, revision_code: revisionCode(row) })) });
  } catch (err) {
    return handleRouteError(res, err, '料金改定履歴の取得に失敗しました');
  }
});

router.post('/:id/revise', async (req, res) => {
  const pool = getPool();
  const conn = await pool.getConnection();
  try {
    const source = await fetchDetail(Number(req.params.id));
    if (!source) throw requestError(404, '金額データが見つかりません', 'not_found');
    if (!Number(source.is_current_revision)) throw requestError(400, '料金改定は最新の改定版から作成してください');
    const reason = String(req.body.reason || '').trim();
    if (!reason) throw requestError(400, '料金改定理由を入力してください');
    const startDate = String(req.body.apply_start_date || '').slice(0, 10);
    assertValidFromRequired(startDate);
    if (String(source.apply_start_date).slice(0, 10) >= startDate) {
      throw requestError(400, '新しい適用開始日は現在版より後の日付を指定してください');
    }
    await conn.beginTransaction();
    const [locked] = await conn.query('SELECT * FROM price_sets WHERE price_set_id = ? FOR UPDATE', [source.price_set_id]);
    if (!locked.length || !Number(locked[0].is_current_revision)) throw requestError(409, '別の料金改定が作成されました。再読込してください', 'version_conflict');
    const [maxRows] = await conn.query('SELECT COALESCE(MAX(revision_no),0) AS max_no FROM price_sets WHERE price_series_id = ?', [source.price_series_id]);
    const revisionNo = Number(maxRows[0].max_no) + 1;
    const previousEnd = new Date(`${startDate}T12:00:00Z`);
    previousEnd.setUTCDate(previousEnd.getUTCDate() - 1);
    const previousEndText = previousEnd.toISOString().slice(0, 10);
    await conn.query(
      `UPDATE price_sets SET apply_end_date = ?, is_current_revision = 0,
              version = version + 1, updated_at = CURRENT_TIMESTAMP
       WHERE price_set_id = ?`,
      [previousEndText, source.price_set_id]
    );
    const priceSetNo = await allocatePriceSetNo(conn);
    const [created] = await conn.query(
      `INSERT INTO price_sets
        (price_set_no, price_series_id, revision_no, revision_reason, is_current_revision,
         source_price_set_id, price_set_name, company_id, base_project_id, project_id,
         apply_start_date, apply_end_date, note, extra_data)
       VALUES (?, ?, ?, ?, 1, ?, ?, ?, ?, ?, ?, NULL, ?, ?)`,
      [
        priceSetNo, source.price_series_id, revisionNo, reason,
        source.price_set_id, source.price_set_name, source.company_id, source.base_project_id,
        source.project_id, startDate, source.note,
        typeof source.extra_data === 'string' ? source.extra_data : JSON.stringify(source.extra_data || {}),
      ]
    );
    await syncLines(conn, created.insertId, (source.lines || []).map((line) => ({ ...line, price_set_line_id: null })));
    await conn.query(
      `INSERT INTO price_set_revision_audit_logs
        (price_set_id, action_code, before_data, after_data, reason, actor_user_id)
       VALUES (?, 'revise', ?, ?, ?, ?)`,
      [created.insertId, JSON.stringify(source), JSON.stringify({ revision_no: revisionNo, apply_start_date: startDate }), reason, req.session.user.user_id]
    );
    await conn.commit();
    const detail = await fetchDetail(created.insertId);
    return res.status(201).json({ ok: true, price_set: { ...detail, extra_data: sanitizeExtraDataForUser(detail.extra_data, req) } });
  } catch (err) {
    await conn.rollback();
    return handleRouteError(res, err, '料金改定の作成に失敗しました');
  } finally {
    conn.release();
  }
});

router.get('/:id/unconfirmed-impact', async (req, res) => {
  try {
    const source = await fetchDetail(Number(req.params.id));
    if (!source) return res.status(404).json({ ok: false, message: '金額データが見つかりません' });
    const rows = await query(
      `SELECT daily_report_id, project_id, work_date, status, billing_status, payment_status
       FROM daily_reports
       WHERE applied_price_set_id = ? AND is_deleted = 0
         AND status NOT IN ('confirmed', 'approved')
         AND COALESCE(billing_status, 'unbilled') <> 'billed'
         AND COALESCE(payment_status, 'unpaid') <> 'paid'
       ORDER BY work_date ASC, daily_report_id ASC`,
      [source.price_set_id]
    );
    return res.json({ ok: true, recalculable_count: rows.length, daily_reports: rows });
  } catch (err) {
    return handleRouteError(res, err, '再計算対象の取得に失敗しました');
  }
});

router.post('/:id/recalculate-unconfirmed', async (req, res) => {
  const reason = String(req.body.reason || '').trim();
  if (!reason) return res.status(400).json({ ok: false, message: '再計算理由を入力してください' });
  const pool = getPool();
  const conn = await pool.getConnection();
  try {
    const source = await fetchDetail(Number(req.params.id));
    if (!source) throw requestError(404, '金額データが見つかりません', 'not_found');
    await conn.beginTransaction();
    const [reports] = await conn.query(
      `SELECT * FROM daily_reports
       WHERE applied_price_set_id = ? AND is_deleted = 0
         AND status NOT IN ('confirmed', 'approved')
         AND COALESCE(billing_status, 'none') <> 'billed'
         AND COALESCE(payment_status, 'none') <> 'paid'
       ORDER BY daily_report_id ASC FOR UPDATE`,
      [source.price_set_id]
    );
    for (const report of reports) {
      const calculated = await applyDailyPriceCalcWithRules({ ...report });
      const fields = RECALCULATED_REPORT_FIELDS.filter((key) => Object.prototype.hasOwnProperty.call(calculated, key));
      await conn.query(
        `UPDATE daily_reports SET ${fields.map((key) => `${key} = ?`).join(', ')},
                version = version + 1, updated_at = CURRENT_TIMESTAMP
         WHERE daily_report_id = ?`,
        [...fields.map((key) => calculated[key]), report.daily_report_id]
      );
      await conn.query(
        `INSERT INTO daily_report_audit_logs
          (daily_report_id, action_code, before_data, after_data, reason, actor_user_id)
         VALUES (?, 'price_rule_recalculation', ?, ?, ?, ?)`,
        [
          report.daily_report_id,
          JSON.stringify({ applied_price_set_id: report.applied_price_set_id, calculated_billing_amount: report.calculated_billing_amount, calculated_payment_amount: report.calculated_payment_amount }),
          JSON.stringify({ applied_price_set_id: calculated.applied_price_set_id, calculated_billing_amount: calculated.calculated_billing_amount, calculated_payment_amount: calculated.calculated_payment_amount }),
          reason,
          req.session.user.user_id,
        ]
      );
    }
    await conn.commit();
    return res.json({ ok: true, recalculated_count: reports.length });
  } catch (err) {
    await conn.rollback();
    return handleRouteError(res, err, '未確定日報の再計算に失敗しました');
  } finally {
    conn.release();
  }
});

router.get('/:id/propagation-preview', async (req, res) => {
  try {
    const source = await fetchDetail(Number(req.params.id));
    if (!source) return res.status(404).json({ ok: false, message: '金額データが見つかりません' });
    if (!source.base_project_id || source.project_id) {
      throw requestError(400, '基本案件の料金データだけが個別案件へ反映できます');
    }
    if (!Number(source.is_current_revision)) {
      throw requestError(400, '最新の料金改定版から反映してください');
    }
    const targets = await query(
      `SELECT s.price_series_id, s.series_code, s.project_id, s.source_price_set_id,
              ps.price_set_id, ps.apply_start_date, ps.revision_no,
              p.manager_name, p.business_type
       FROM price_series s
       JOIN price_sets ps ON ps.price_series_id = s.price_series_id
         AND ps.is_current_revision = 1 AND ps.is_deleted = 0
       LEFT JOIN projects p ON p.project_id = s.project_id
       WHERE s.source_price_series_id = ? AND s.project_id IS NOT NULL AND s.is_deleted = 0
       ORDER BY s.project_id ASC, s.price_series_id ASC`,
      [source.price_series_id]
    );
    const preview = [];
    for (const target of targets) {
      const baseline = target.source_price_set_id ? await fetchDetail(target.source_price_set_id) : null;
      const individual = await fetchDetail(target.price_set_id);
      if (!baseline || !individual) continue;
      const merged = mergeRevisionData(baseline, source, individual);
      preview.push({
        ...target,
        can_apply: String(source.apply_start_date).slice(0, 10) > String(individual.apply_start_date).slice(0, 10),
        conflict_count: merged.conflicts.length,
        conflicts: merged.conflicts,
      });
    }
    return res.json({ ok: true, source_revision_code: source.revision_code, targets: preview });
  } catch (err) {
    return handleRouteError(res, err, '料金改定の反映候補取得に失敗しました');
  }
});

router.post('/:id/propagate', async (req, res) => {
  const pool = getPool();
  const conn = await pool.getConnection();
  try {
    const source = await fetchDetail(Number(req.params.id));
    if (!source) throw requestError(404, '金額データが見つかりません', 'not_found');
    if (!source.base_project_id || source.project_id || !Number(source.is_current_revision)) {
      throw requestError(400, '最新の基本案件料金だけが個別案件へ反映できます');
    }
    const targets = Array.isArray(req.body.targets) ? req.body.targets : [];
    const reason = String(req.body.reason || '').trim();
    if (!targets.length) throw requestError(400, '反映先を1件以上選択してください');
    if (!reason) throw requestError(400, '反映理由を入力してください');
    await conn.beginTransaction();
    const created = [];
    for (const requested of targets) {
      const seriesId = Number(requested.price_series_id || 0);
      const [seriesRows] = await conn.query(
        `SELECT s.*, ps.price_set_id AS current_price_set_id
         FROM price_series s
         JOIN price_sets ps ON ps.price_series_id = s.price_series_id
           AND ps.is_current_revision = 1 AND ps.is_deleted = 0
         WHERE s.price_series_id = ? AND s.source_price_series_id = ? AND s.is_deleted = 0
         FOR UPDATE`,
        [seriesId, source.price_series_id]
      );
      const series = seriesRows[0];
      if (!series) throw requestError(409, `反映先系列 #${seriesId} の状態が変わりました`, 'version_conflict');
      const baseline = series.source_price_set_id ? await fetchDetail(series.source_price_set_id) : null;
      const individual = await fetchDetail(series.current_price_set_id);
      if (!baseline || !individual) throw requestError(409, `${series.series_code}: 比較元を取得できません`, 'version_conflict');
      const resolutions = requested.resolutions && typeof requested.resolutions === 'object' ? requested.resolutions : {};
      const preview = mergeRevisionData(baseline, source, individual, resolutions);
      const unresolved = preview.conflicts.filter((conflict) => !['base', 'individual'].includes(resolutions[conflict.path]));
      if (unresolved.length) {
        const err = requestError(409, `${series.series_code}: 同じ項目の変更について選択が必要です`, 'merge_conflict');
        err.conflicts = unresolved;
        throw err;
      }
      const revision = await createRevisionFromData(conn, individual, {
        apply_start_date: String(source.apply_start_date).slice(0, 10),
        reason,
        source_price_set_id: source.price_set_id,
        extra_data: preview.extra_data,
        lines: preview.lines,
      }, req.session.user.user_id, 'base_propagation');
      await conn.query(
        `UPDATE price_series
         SET source_price_series_id = ?, source_price_set_id = ?, version = version + 1
         WHERE price_series_id = ?`,
        [source.price_series_id, source.price_set_id, seriesId]
      );
      created.push({ price_series_id: seriesId, series_code: series.series_code, ...revision });
    }
    await conn.commit();
    return res.status(201).json({ ok: true, created });
  } catch (err) {
    await conn.rollback();
    if (err.conflicts) {
      return res.status(err.status || 409).json({ ok: false, code: err.code, message: err.message, conflicts: err.conflicts });
    }
    return handleRouteError(res, err, '料金改定の反映に失敗しました');
  } finally {
    conn.release();
  }
});

router.post('/:id/copy', async (req, res) => {
  try {
    const src = await fetchDetail(Number(req.params.id));
    if (!src) return res.status(404).json({ ok: false, message: 'コピー元が見つかりません' });
    const pool = getPool();
    const conn = await pool.getConnection();
    try {
      const targetBase = req.body.base_project_id != null ? Number(req.body.base_project_id) : src.base_project_id;
      const targetProject = req.body.project_id != null ? Number(req.body.project_id) : src.project_id;
      const targetCompany = req.body.company_id != null ? Number(req.body.company_id) : src.company_id;
      const copyData = {
        company_id: targetCompany || null,
        base_project_id: targetBase,
        project_id: targetProject,
        apply_start_date: req.body.apply_start_date || todayTokyoYmd(),
        apply_end_date:
          req.body.apply_end_date !== undefined && req.body.apply_end_date !== ''
            ? req.body.apply_end_date
            : null,
      };
      assertOwnerExclusive(copyData);
      assertValidFromRequired(copyData.apply_start_date);
      const copyName =
        req.body.price_set_name && String(req.body.price_set_name).trim()
          ? String(req.body.price_set_name).trim()
          : `${src.price_set_name}（コピー）`;
      await conn.beginTransaction();
      const priceSetNo = await allocatePriceSetNo(conn);
      const series = await allocatePriceSeries(conn, { ...src, ...copyData, price_set_name: copyName }, {
        price_series_id: src.price_series_id,
        price_set_id: src.price_set_id,
      });
      const [result] = await conn.query(
        `INSERT INTO price_sets
          (price_set_no, price_series_id, revision_no, is_current_revision, source_price_set_id,
           price_set_name, company_id, base_project_id, project_id, apply_start_date, apply_end_date, note, extra_data)
         VALUES (?, ?, 1, 1, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          priceSetNo,
          series.price_series_id,
          src.price_set_id,
          copyName,
          targetCompany || null,
          targetBase || null,
          targetProject || null,
          copyData.apply_start_date,
          copyData.apply_end_date,
          src.note,
          src.extra_data ? JSON.stringify(parseExtraDataField(src.extra_data) || src.extra_data) : null,
        ]
      );
      const id = result.insertId;
      await syncLines(
        conn,
        id,
        (src.lines || []).map((l) => ({ ...l, price_set_line_id: null }))
      );
      await conn.commit();
      const detail = await fetchDetail(id);
      return res.status(201).json({ ok: true, price_set: { ...detail, extra_data: sanitizeExtraDataForUser(detail.extra_data, req) } });
    } catch (err) {
      await conn.rollback();
      throw err;
    } finally {
      conn.release();
    }
  } catch (err) {
    return handleRouteError(res, err, 'コピーに失敗しました');
  }
});

router.post('/:id/import-lines', async (req, res) => {
  const pool = getPool();
  const conn = await pool.getConnection();
  try {
    const id = Number(req.params.id);
    const sourceId = Number(req.body.source_price_set_id || 0);
    const mode = String(req.body.mode || 'replace');
    if (!sourceId) {
      return res.status(400).json({ ok: false, message: 'コピー元の金額データを指定してください' });
    }
    const target = await fetchDetail(id);
    if (!target) return res.status(404).json({ ok: false, message: '金額データが見つかりません' });
    const source = await fetchDetail(sourceId);
    if (!source) return res.status(404).json({ ok: false, message: 'コピー元が見つかりません' });

    const imported = (source.lines || []).map((l) => ({
      ...l,
      price_set_line_id: null,
    }));
    let lines;
    if (mode === 'merge') {
      const existing = normalizeLines(target.lines || []);
      lines = [...existing, ...normalizeLines(imported)];
    } else {
      lines = normalizeLines(imported);
    }

    let extraData = parseExtraDataField(source.extra_data);
    if (mode !== 'merge') {
      extraData = extraData || null;
    } else {
      extraData = mergeExtraData(target.extra_data, extraData ? { fee_items: extraData.fee_items } : null);
    }

    await conn.beginTransaction();
    if (mode !== 'merge' && extraData) {
      await conn.query(
        `UPDATE price_sets SET extra_data = ?, version = version + 1, updated_at = CURRENT_TIMESTAMP
         WHERE price_set_id = ? AND is_deleted = 0`,
        [JSON.stringify(extraData), id]
      );
    }
    await syncLines(conn, id, lines);
    await conn.commit();
    const detail = await fetchDetail(id);
    return res.json({ ok: true, price_set: { ...detail, extra_data: sanitizeExtraDataForUser(detail.extra_data, req) } });
  } catch (err) {
    await conn.rollback();
    return handleRouteError(res, err, '行の取込に失敗しました');
  } finally {
    conn.release();
  }
});

router.delete('/:id', async (req, res) => {
  try {
    const id = Number(req.params.id);
    await query(
      `UPDATE price_set_lines SET is_deleted = 1, version = version + 1
       WHERE price_set_id = ? AND is_deleted = 0`,
      [id]
    );
    await query(
      `UPDATE price_sets SET is_deleted = 1, version = version + 1, updated_at = CURRENT_TIMESTAMP
       WHERE price_set_id = ?`,
      [id]
    );
    return res.json({ ok: true });
  } catch (err) {
    console.error('[price_sets/delete]', err);
    return res.status(500).json({ ok: false, message: '削除に失敗しました' });
  }
});

module.exports = router;
