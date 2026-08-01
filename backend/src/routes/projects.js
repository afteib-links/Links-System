const express = require('express');
const { getPool, query } = require('../db');
const { requireAuth, requirePermission } = require('../middleware/auth');
const {
  listPriceSetsForBase,
  listPriceSetsForProject,
  deepCopyPriceSetsFromBaseToProject,
  softDeletePriceSetsForBase,
  softDeletePriceSetsForProject,
} = require('../services/price_set_lifecycle');

const router = express.Router();
router.use(requireAuth, requirePermission('projects'));

const BASE_FIELDS = [
  'company_id',
  'partner_id',
  'vehicle_id',
  'template_name',
  'default_manager',
  'business_type',
  'basic_work_hours',
  'work_time_type',
  'payment_type',
  'installment_type',
  'installment_amount',
  'operation_start_date',
  'closing_date',
  'execution_time_start',
  'execution_time_end',
  'binding_time',
  'break_time',
  'overtime_calc_type',
  'daily_count_type',
  'work_mode_code',
  'rounding_timing_type',
  'overtime_accumulation_type',
  'distance_calc_mode',
  'distance_calc_amount',
  'gogo_site_calc_type',
  'gogo_site_area',
  'price_set_id',
];

const PROJECT_FIELDS = [
  'base_project_id',
  'company_id',
  'partner_id',
  'vehicle_id',
  'manager_name',
  'business_type',
  'payment_type',
  'installment_type',
  'installment_amount',
  'operation_start_date',
  'closing_date',
  'execution_time_start',
  'execution_time_end',
  'binding_time',
  'break_time',
  'overtime_calc_type',
  'daily_count_type',
  'work_mode_code',
  'rounding_timing_type',
  'overtime_accumulation_type',
  'distance_calc_mode',
  'distance_calc_amount',
  'distance_table_json',
  'gogo_site_calc_type',
  'gogo_site_area',
  'price_set_id',
];

const REVISION_FIELDS = [
  'revision_start_date',
  'revision_end_date',
  'is_auto_generated',
  'basic_work_hours',
  'work_time_type',
  'break_time',
  'billing_base_price',
  'billing_overtime_price',
  'billing_settlement_price',
  'payment_base_price',
  'payment_overtime_price',
  'payment_settlement_price',
  'distance_unit_price',
  'prices_json',
];

function pick(body, fields) {
  const out = {};
  for (const key of fields) {
    if (!Object.prototype.hasOwnProperty.call(body, key)) continue;
    let val = body[key];
    if (key === 'is_auto_generated') {
      out[key] = val === true || val === 1 || val === '1' ? 1 : 0;
      continue;
    }
    if (key === 'distance_table_json' || key === 'prices_json') {
      if (val == null || val === '') {
        out[key] = null;
      } else if (typeof val === 'string') {
        try {
          out[key] = JSON.stringify(JSON.parse(val));
        } catch (_e) {
          out[key] = JSON.stringify({ raw: val });
        }
      } else {
        out[key] = JSON.stringify(val);
      }
      continue;
    }
    out[key] = val === '' || val === undefined ? null : val;
  }
  return out;
}

async function fetchBase(id) {
  const rows = await query(
    `SELECT b.*, c.company_name
     FROM base_projects b
     LEFT JOIN companies c ON c.company_id = b.company_id
     WHERE b.base_project_id = ? AND b.is_deleted = 0
     LIMIT 1`,
    [id]
  );
  const base = rows[0] || null;
  if (!base) return null;
  const price_sets = await listPriceSetsForBase(id);
  return { ...base, price_sets };
}

async function fetchProject(id) {
  const rows = await query(
    `SELECT p.*,
            c.company_name,
            pt.partner_name,
            b.template_name AS base_template_name
     FROM projects p
     LEFT JOIN companies c ON c.company_id = p.company_id
     LEFT JOIN partners pt ON pt.partner_id = p.partner_id
     LEFT JOIN base_projects b ON b.base_project_id = p.base_project_id
     WHERE p.project_id = ? AND p.is_deleted = 0
     LIMIT 1`,
    [id]
  );
  if (!rows.length) return null;
  const revisions = await query(
    `SELECT * FROM project_revisions
     WHERE project_id = ? AND is_deleted = 0
     ORDER BY revision_start_date DESC, revision_id DESC`,
    [id]
  );
  const price_sets = await listPriceSetsForProject(id);
  return { ...rows[0], revisions, price_sets };
}

/* ===== 基本案件 ===== */
router.get('/base', async (req, res) => {
  try {
    const companyId = Number(req.query.company_id || 0);
    const q = String(req.query.q || '').trim();
    const where = ['b.is_deleted = 0'];
    const params = [];
    if (companyId > 0) {
      where.push('b.company_id = ?');
      params.push(companyId);
    }
    if (q) {
      where.push('b.template_name LIKE ?');
      params.push(`%${q}%`);
    }
    const rows = await query(
      `SELECT b.base_project_id, b.company_id, b.template_name, b.default_manager,
              b.business_type, b.basic_work_hours, b.work_time_type, b.version,
              c.company_name
       FROM base_projects b
       LEFT JOIN companies c ON c.company_id = b.company_id
       WHERE ${where.join(' AND ')}
       ORDER BY b.base_project_id ASC`,
      params
    );
    return res.json({ ok: true, base_projects: rows });
  } catch (err) {
    console.error('[projects/base/list]', err);
    return res.status(500).json({ ok: false, message: '基本案件一覧の取得に失敗しました' });
  }
});

router.get('/base/:id', async (req, res) => {
  try {
    const detail = await fetchBase(Number(req.params.id));
    if (!detail) return res.status(404).json({ ok: false, message: '基本案件が見つかりません' });
    return res.json({ ok: true, base_project: detail });
  } catch (err) {
    console.error('[projects/base/get]', err);
    return res.status(500).json({ ok: false, message: '基本案件の取得に失敗しました' });
  }
});

router.post('/base', async (req, res) => {
  try {
    const data = pick(req.body || {}, BASE_FIELDS);
    if (!data.company_id || !data.template_name) {
      return res.status(400).json({ ok: false, message: '企業とテンプレート名は必須です' });
    }
    data.template_name = String(data.template_name).trim();
    const cols = Object.keys(data);
    const result = await query(
      `INSERT INTO base_projects (${cols.join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`,
      cols.map((c) => data[c])
    );
    return res.status(201).json({ ok: true, base_project: await fetchBase(result.insertId) });
  } catch (err) {
    console.error('[projects/base/create]', err);
    return res.status(500).json({ ok: false, message: '基本案件の作成に失敗しました' });
  }
});

router.put('/base/:id', async (req, res) => {
  try {
    const id = Number(req.params.id);
    const data = pick(req.body || {}, BASE_FIELDS);
    if (!data.template_name) {
      return res.status(400).json({ ok: false, message: 'テンプレート名は必須です' });
    }
    data.template_name = String(data.template_name).trim();
    const expectedVersion = req.body.version != null ? Number(req.body.version) : null;
    const sets = BASE_FIELDS.map((f) => `${f} = ?`);
    const params = BASE_FIELDS.map((f) => (data[f] !== undefined ? data[f] : null));
    let sql = `
      UPDATE base_projects
      SET ${sets.join(', ')}, version = version + 1, updated_at = CURRENT_TIMESTAMP
      WHERE base_project_id = ? AND is_deleted = 0
    `;
    params.push(id);
    if (expectedVersion != null && Number.isInteger(expectedVersion)) {
      sql += ' AND version = ?';
      params.push(expectedVersion);
    }
    const result = await query(sql, params);
    if (!result || result.affectedRows === 0) {
      return res.status(409).json({ ok: false, message: '更新に失敗しました（競合または未存在）' });
    }
    return res.json({ ok: true, base_project: await fetchBase(id) });
  } catch (err) {
    console.error('[projects/base/update]', err);
    return res.status(500).json({ ok: false, message: '基本案件の更新に失敗しました' });
  }
});

router.delete('/base/:id', async (req, res) => {
  const pool = getPool();
  const conn = await pool.getConnection();
  try {
    const id = Number(req.params.id);
    await conn.beginTransaction();
    const [result] = await conn.query(
      `UPDATE base_projects
       SET is_deleted = 1, version = version + 1, updated_at = CURRENT_TIMESTAMP
       WHERE base_project_id = ? AND is_deleted = 0`,
      [id]
    );
    if (!result || result.affectedRows === 0) {
      await conn.rollback();
      return res.status(404).json({ ok: false, message: '基本案件が見つかりません' });
    }
    await softDeletePriceSetsForBase(id, conn);
    await conn.commit();
    return res.json({ ok: true });
  } catch (err) {
    await conn.rollback();
    console.error('[projects/base/delete]', err);
    return res.status(500).json({ ok: false, message: '基本案件の削除に失敗しました' });
  } finally {
    conn.release();
  }
});

router.post('/base/:id/create-project', async (req, res) => {
  const pool = getPool();
  const conn = await pool.getConnection();
  try {
    const base = await fetchBase(Number(req.params.id));
    if (!base) return res.status(404).json({ ok: false, message: '基本案件が見つかりません' });
    const overrides = pick(req.body || {}, PROJECT_FIELDS);
    const data = {
      base_project_id: base.base_project_id,
      company_id: overrides.company_id || base.company_id,
      partner_id: overrides.partner_id != null ? overrides.partner_id : base.partner_id,
      vehicle_id: overrides.vehicle_id != null ? overrides.vehicle_id : base.vehicle_id,
      manager_name: overrides.manager_name || base.default_manager,
      business_type: overrides.business_type || base.business_type,
      payment_type: overrides.payment_type || base.payment_type || 'normal',
      installment_type: overrides.installment_type || base.installment_type,
      installment_amount: overrides.installment_amount != null ? overrides.installment_amount : base.installment_amount,
      operation_start_date: overrides.operation_start_date || base.operation_start_date,
      closing_date: overrides.closing_date || base.closing_date,
      execution_time_start: overrides.execution_time_start || base.execution_time_start,
      execution_time_end: overrides.execution_time_end || base.execution_time_end,
      binding_time: overrides.binding_time != null ? overrides.binding_time : base.binding_time,
      break_time: overrides.break_time != null ? overrides.break_time : base.break_time,
      overtime_calc_type: overrides.overtime_calc_type || base.overtime_calc_type,
      daily_count_type: overrides.daily_count_type || base.daily_count_type,
      work_mode_code: overrides.work_mode_code || base.work_mode_code,
      rounding_timing_type: overrides.rounding_timing_type || base.rounding_timing_type,
      overtime_accumulation_type: overrides.overtime_accumulation_type || base.overtime_accumulation_type,
      distance_calc_mode: overrides.distance_calc_mode || base.distance_calc_mode,
      distance_calc_amount: overrides.distance_calc_amount != null ? overrides.distance_calc_amount : base.distance_calc_amount,
      gogo_site_calc_type: overrides.gogo_site_calc_type || base.gogo_site_calc_type,
      gogo_site_area: overrides.gogo_site_area || base.gogo_site_area,
      price_set_id: null,
    };
    const cols = Object.keys(data).filter((k) => data[k] !== undefined);
    await conn.beginTransaction();
    const [insertResult] = await conn.query(
      `INSERT INTO projects (${cols.join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`,
      cols.map((c) => data[c])
    );
    const projectId = insertResult.insertId;
    const copiedPriceSets = await deepCopyPriceSetsFromBaseToProject(
      base.base_project_id,
      projectId,
      conn
    );
    await conn.commit();
    const project = await fetchProject(projectId);
    return res.status(201).json({
      ok: true,
      project,
      copied_price_set_count: copiedPriceSets,
    });
  } catch (err) {
    await conn.rollback();
    console.error('[projects/base/create-project]', err);
    return res.status(500).json({ ok: false, message: '案件作成に失敗しました' });
  } finally {
    conn.release();
  }
});

/* ===== 個別案件 ===== */
router.get('/', async (req, res) => {
  try {
    const companyId = Number(req.query.company_id || 0);
    const partnerId = Number(req.query.partner_id || 0);
    const baseId = Number(req.query.base_project_id || 0);
    const q = String(req.query.q || '').trim();
    const where = ['p.is_deleted = 0'];
    const params = [];
    if (companyId > 0) {
      where.push('p.company_id = ?');
      params.push(companyId);
    }
    if (partnerId > 0) {
      where.push('p.partner_id = ?');
      params.push(partnerId);
    }
    if (baseId > 0) {
      where.push('p.base_project_id = ?');
      params.push(baseId);
    }
    if (q) {
      where.push('(p.manager_name LIKE ? OR p.business_type LIKE ? OR c.company_name LIKE ? OR pt.partner_name LIKE ?)');
      params.push(`%${q}%`, `%${q}%`, `%${q}%`, `%${q}%`);
    }
    const rows = await query(
      `SELECT p.project_id, p.base_project_id, p.company_id, p.partner_id, p.vehicle_id,
              p.manager_name, p.business_type, p.payment_type, p.installment_amount,
              p.operation_start_date, p.closing_date, p.version,
              c.company_name, pt.partner_name, b.template_name AS base_template_name
       FROM projects p
       LEFT JOIN companies c ON c.company_id = p.company_id
       LEFT JOIN partners pt ON pt.partner_id = p.partner_id
       LEFT JOIN base_projects b ON b.base_project_id = p.base_project_id
       WHERE ${where.join(' AND ')}
       ORDER BY p.project_id ASC`,
      params
    );
    return res.json({ ok: true, projects: rows });
  } catch (err) {
    console.error('[projects/list]', err);
    return res.status(500).json({ ok: false, message: '案件一覧の取得に失敗しました' });
  }
});

router.get('/:id', async (req, res) => {
  try {
    const detail = await fetchProject(Number(req.params.id));
    if (!detail) return res.status(404).json({ ok: false, message: '案件が見つかりません' });
    return res.json({ ok: true, project: detail });
  } catch (err) {
    console.error('[projects/get]', err);
    return res.status(500).json({ ok: false, message: '案件詳細の取得に失敗しました' });
  }
});

router.post('/', async (req, res) => {
  const pool = getPool();
  const conn = await pool.getConnection();
  try {
    const data = pick(req.body || {}, PROJECT_FIELDS);
    if (!data.company_id) {
      return res.status(400).json({ ok: false, message: '企業は必須です' });
    }
    if (!data.payment_type) data.payment_type = 'normal';
    data.price_set_id = null;
    const cols = Object.keys(data);
    await conn.beginTransaction();
    const [insertResult] = await conn.query(
      `INSERT INTO projects (${cols.join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`,
      cols.map((c) => data[c])
    );
    const projectId = insertResult.insertId;
    let copiedPriceSets = 0;
    if (data.base_project_id) {
      copiedPriceSets = await deepCopyPriceSetsFromBaseToProject(
        data.base_project_id,
        projectId,
        conn
      );
    }

    // 仮組: 初回改定を任意で同時作成
    if (req.body.initial_revision) {
      const rev = pick(req.body.initial_revision, REVISION_FIELDS);
      if (rev.revision_start_date) {
        rev.is_auto_generated = rev.is_auto_generated || 0;
        const rcols = Object.keys(rev);
        await conn.query(
          `INSERT INTO project_revisions (project_id, ${rcols.join(', ')})
           VALUES (?, ${rcols.map(() => '?').join(', ')})`,
          [projectId, ...rcols.map((c) => rev[c])]
        );
      }
    }
    await conn.commit();
    const project = await fetchProject(projectId);
    return res.status(201).json({
      ok: true,
      project,
      copied_price_set_count: copiedPriceSets,
    });
  } catch (err) {
    await conn.rollback();
    console.error('[projects/create]', err);
    return res.status(500).json({ ok: false, message: '案件の作成に失敗しました' });
  } finally {
    conn.release();
  }
});

router.put('/:id', async (req, res) => {
  try {
    const id = Number(req.params.id);
    const data = pick(req.body || {}, PROJECT_FIELDS);
    if (!data.company_id) {
      return res.status(400).json({ ok: false, message: '企業は必須です' });
    }
    const expectedVersion = req.body.version != null ? Number(req.body.version) : null;
    const sets = PROJECT_FIELDS.map((f) => `${f} = ?`);
    const params = PROJECT_FIELDS.map((f) => (data[f] !== undefined ? data[f] : null));
    let sql = `
      UPDATE projects
      SET ${sets.join(', ')}, version = version + 1, updated_at = CURRENT_TIMESTAMP
      WHERE project_id = ? AND is_deleted = 0
    `;
    params.push(id);
    if (expectedVersion != null && Number.isInteger(expectedVersion)) {
      sql += ' AND version = ?';
      params.push(expectedVersion);
    }
    const result = await query(sql, params);
    if (!result || result.affectedRows === 0) {
      return res.status(409).json({ ok: false, message: '更新に失敗しました（競合または未存在）' });
    }
    return res.json({ ok: true, project: await fetchProject(id) });
  } catch (err) {
    console.error('[projects/update]', err);
    return res.status(500).json({ ok: false, message: '案件の更新に失敗しました' });
  }
});

router.delete('/:id', async (req, res) => {
  const pool = getPool();
  const conn = await pool.getConnection();
  try {
    const id = Number(req.params.id);
    await conn.beginTransaction();
    const [result] = await conn.query(
      `UPDATE projects
       SET is_deleted = 1, version = version + 1, updated_at = CURRENT_TIMESTAMP
       WHERE project_id = ? AND is_deleted = 0`,
      [id]
    );
    if (!result || result.affectedRows === 0) {
      await conn.rollback();
      return res.status(404).json({ ok: false, message: '案件が見つかりません' });
    }
    await conn.query(
      `UPDATE project_revisions
       SET is_deleted = 1, version = version + 1, updated_at = CURRENT_TIMESTAMP
       WHERE project_id = ? AND is_deleted = 0`,
      [id]
    );
    await softDeletePriceSetsForProject(id, conn);
    await conn.commit();
    return res.json({ ok: true });
  } catch (err) {
    await conn.rollback();
    console.error('[projects/delete]', err);
    return res.status(500).json({ ok: false, message: '案件の削除に失敗しました' });
  } finally {
    conn.release();
  }
});

/* ===== 改定（追加のみ） ===== */
router.post('/:id/revisions', async (req, res) => {
  try {
    const projectId = Number(req.params.id);
    const project = await fetchProject(projectId);
    if (!project) return res.status(404).json({ ok: false, message: '案件が見つかりません' });

    const rev = pick(req.body || {}, REVISION_FIELDS);
    if (!rev.revision_start_date) {
      return res.status(400).json({ ok: false, message: '適用開始日は必須です' });
    }
    if (rev.is_auto_generated == null) rev.is_auto_generated = 0;
    const cols = Object.keys(rev);
    await query(
      `INSERT INTO project_revisions (project_id, ${cols.join(', ')})
       VALUES (?, ${cols.map(() => '?').join(', ')})`,
      [projectId, ...cols.map((c) => rev[c])]
    );
    return res.status(201).json({ ok: true, project: await fetchProject(projectId) });
  } catch (err) {
    console.error('[projects/revisions/create]', err);
    return res.status(500).json({ ok: false, message: '改定の追加に失敗しました' });
  }
});

router.delete('/:id/revisions/:revisionId', async (req, res) => {
  try {
    const projectId = Number(req.params.id);
    const revisionId = Number(req.params.revisionId);
    const result = await query(
      `UPDATE project_revisions
       SET is_deleted = 1, version = version + 1, updated_at = CURRENT_TIMESTAMP
       WHERE revision_id = ? AND project_id = ? AND is_deleted = 0`,
      [revisionId, projectId]
    );
    if (!result || result.affectedRows === 0) {
      return res.status(404).json({ ok: false, message: '改定が見つかりません' });
    }
    return res.json({ ok: true, project: await fetchProject(projectId) });
  } catch (err) {
    console.error('[projects/revisions/delete]', err);
    return res.status(500).json({ ok: false, message: '改定の削除に失敗しました' });
  }
});

module.exports = router;
