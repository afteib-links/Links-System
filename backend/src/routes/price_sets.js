const express = require('express');
const { getPool, query } = require('../db');
const { requireAuth, requirePermission } = require('../middleware/auth');
const {
  assertOwnerExclusive,
  assertValidFromRequired,
  allocatePriceSetNo,
} = require('../services/price_set_lifecycle');
const { normalizePriceMatrixSettings, SETTING_KEYS } = require('../services/price_matrix_settings');

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
    `SELECT ps.*, c.company_name, b.template_name AS base_template_name
     FROM price_sets ps
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
    const where = ['ps.is_deleted = 0'];
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
      `SELECT ps.*, c.company_name, b.template_name AS base_template_name,
              p.manager_name AS project_manager_name,
              (SELECT COUNT(*) FROM price_set_lines l
               WHERE l.price_set_id = ps.price_set_id AND l.is_deleted = 0) AS line_count
       FROM price_sets ps
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
    return res.json({ ok: true, price_set: detail });
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
    const extraData = mergeExtraData(null, req.body.extra_data);
    await conn.beginTransaction();
    const priceSetNo = await allocatePriceSetNo(conn);
    const [result] = await conn.query(
      `INSERT INTO price_sets
        (price_set_no, price_set_name, company_id, base_project_id, project_id, apply_start_date, apply_end_date, note, extra_data)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        priceSetNo,
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
    return res.status(201).json({ ok: true, price_set: detail });
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
    if (Object.prototype.hasOwnProperty.call(req.body, 'extra_data')) {
      const extraData = mergeExtraData(current.extra_data, req.body.extra_data);
      fields.push('extra_data = ?');
      params.push(extraData ? JSON.stringify(extraData) : null);
    }
    if (fields.length) {
      fields.push('version = version + 1');
      params.push(id);
      await conn.query(
        `UPDATE price_sets SET ${fields.join(', ')}, updated_at = CURRENT_TIMESTAMP
         WHERE price_set_id = ? AND is_deleted = 0`,
        params
      );
    }
    await syncLines(conn, id, lines);
    await conn.commit();
    const detail = await fetchDetail(id);
    return res.json({ ok: true, price_set: detail });
  } catch (err) {
    await conn.rollback();
    return handleRouteError(res, err, '金額データの更新に失敗しました');
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
      const copyData = {
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
      const [result] = await conn.query(
        `INSERT INTO price_sets
          (price_set_no, price_set_name, company_id, base_project_id, project_id, apply_start_date, apply_end_date, note, extra_data)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          priceSetNo,
          copyName,
          src.company_id,
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
      return res.status(201).json({ ok: true, price_set: detail });
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
    return res.json({ ok: true, price_set: detail });
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
