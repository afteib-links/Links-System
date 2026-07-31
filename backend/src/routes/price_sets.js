const express = require('express');
const { getPool, query } = require('../db');
const { requireAuth, requirePermission } = require('../middleware/auth');

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
    if (q) {
      where.push('(ps.price_set_name LIKE ? OR c.company_name LIKE ?)');
      params.push(`%${q}%`, `%${q}%`);
    }
    const rows = await query(
      `SELECT ps.*, c.company_name,
              (SELECT COUNT(*) FROM price_set_lines l
               WHERE l.price_set_id = ps.price_set_id AND l.is_deleted = 0) AS line_count
       FROM price_sets ps
       LEFT JOIN companies c ON c.company_id = ps.company_id
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
    const lines = normalizeLines(req.body.lines);
    await conn.beginTransaction();
    const [result] = await conn.query(
      `INSERT INTO price_sets
        (price_set_name, company_id, base_project_id, project_id, apply_start_date, apply_end_date, note)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [
        data.price_set_name,
        data.company_id,
        data.base_project_id,
        data.project_id,
        data.apply_start_date,
        data.apply_end_date,
        data.note,
      ]
    );
    const id = result.insertId;
    await syncLines(conn, id, lines);
    await conn.commit();
    const detail = await fetchDetail(id);
    return res.status(201).json({ ok: true, price_set: detail });
  } catch (err) {
    await conn.rollback();
    console.error('[price_sets/create]', err);
    return res.status(500).json({ ok: false, message: '金額データの作成に失敗しました' });
  } finally {
    conn.release();
  }
});

router.put('/:id', async (req, res) => {
  const pool = getPool();
  const conn = await pool.getConnection();
  try {
    const id = Number(req.params.id);
    const data = pick(req.body, SET_FIELDS);
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
    console.error('[price_sets/update]', err);
    return res.status(500).json({ ok: false, message: '金額データの更新に失敗しました' });
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
      await conn.beginTransaction();
      const [result] = await conn.query(
        `INSERT INTO price_sets
          (price_set_name, company_id, base_project_id, project_id, apply_start_date, apply_end_date, note)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [
          `${src.price_set_name}（コピー）`,
          src.company_id,
          src.base_project_id,
          src.project_id,
          src.apply_start_date,
          src.apply_end_date,
          src.note,
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
    console.error('[price_sets/copy]', err);
    return res.status(500).json({ ok: false, message: 'コピーに失敗しました' });
  }
});

router.delete('/:id', async (req, res) => {
  try {
    const id = Number(req.params.id);
    await query(
      `UPDATE price_sets SET is_deleted = 1, version = version + 1 WHERE price_set_id = ?`,
      [id]
    );
    return res.json({ ok: true });
  } catch (err) {
    console.error('[price_sets/delete]', err);
    return res.status(500).json({ ok: false, message: '削除に失敗しました' });
  }
});

module.exports = router;
