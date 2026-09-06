const express = require('express');
const { getPool, query } = require('../db');
const { requireAuth, requirePermission } = require('../middleware/auth');

const router = express.Router();
router.use(requireAuth, requirePermission('partners'));

const PARTNER_FIELDS = [
  'partner_name',
  'partner_name_kana',
  'transfer_fee_pattern_id',
  'zip_code',
  'address',
  'contact_phone',
  'blood_type',
  'birth_date',
  'work_start_date',
  'contract_date',
  'partner_category_code',
  'employment_type_code',
  'invoice_number',
  'advance_payment_enabled',
  'license_expiry_date',
  'license_types',
  'safety_conference_history',
  'accident_insurance_code',
  'contractor_liability_code',
  'cargo_insurance_code',
  'g_association_code',
  'tax_return_code',
  'loop_code',
  'payment_output_code',
  'bank_code',
  'bank_name',
  'branch_code',
  'branch_name',
  'account_number',
  'deposit_type',
  'account_name',
  'account_name_kana',
];

function pick(body, fields) {
  const out = {};
  for (const key of fields) {
    if (Object.prototype.hasOwnProperty.call(body, key)) {
      let val = body[key];
      if (key === 'advance_payment_enabled') {
        out[key] = val === true || val === 1 || val === '1' ? 1 : 0;
        continue;
      }
      out[key] = val === '' || val === undefined ? null : val;
    }
  }
  return out;
}

function normalizeVehicles(list) {
  if (!Array.isArray(list)) return [];
  return list.map((row) => ({
    vehicle_id: row.vehicle_id ? Number(row.vehicle_id) : null,
    vehicle_name: row.vehicle_name || null,
    vehicle_number: row.vehicle_number || null,
    inspection_expiry_date: row.inspection_expiry_date || null,
    insurance_expiry_date: row.insurance_expiry_date || null,
  }));
}

async function fetchDetail(partnerId) {
  const rows = await query(
    `SELECT * FROM partners WHERE partner_id = ? AND is_deleted = 0 LIMIT 1`,
    [partnerId]
  );
  if (!rows.length) return null;
  const vehicles = await query(
    `SELECT * FROM partner_vehicles
     WHERE partner_id = ? AND is_deleted = 0
     ORDER BY vehicle_id ASC`,
    [partnerId]
  );
  return { ...rows[0], vehicles };
}

async function syncVehicles(conn, partnerId, vehicles) {
  const [existing] = await conn.query(
    `SELECT vehicle_id FROM partner_vehicles WHERE partner_id = ? AND is_deleted = 0`,
    [partnerId]
  );
  const keepIds = new Set(vehicles.filter((v) => v.vehicle_id).map((v) => Number(v.vehicle_id)));
  for (const row of existing) {
    if (!keepIds.has(Number(row.vehicle_id))) {
      await conn.query(
        `UPDATE partner_vehicles
         SET is_deleted = 1, version = version + 1, updated_at = CURRENT_TIMESTAMP
         WHERE vehicle_id = ? AND partner_id = ?`,
        [row.vehicle_id, partnerId]
      );
    }
  }
  for (const v of vehicles) {
    if (v.vehicle_id) {
      await conn.query(
        `UPDATE partner_vehicles
         SET vehicle_name = ?, vehicle_number = ?,
             inspection_expiry_date = ?, insurance_expiry_date = ?,
             version = version + 1, updated_at = CURRENT_TIMESTAMP
         WHERE vehicle_id = ? AND partner_id = ? AND is_deleted = 0`,
        [
          v.vehicle_name,
          v.vehicle_number,
          v.inspection_expiry_date,
          v.insurance_expiry_date,
          v.vehicle_id,
          partnerId,
        ]
      );
    } else {
      await conn.query(
        `INSERT INTO partner_vehicles
          (partner_id, vehicle_name, vehicle_number, inspection_expiry_date, insurance_expiry_date)
         VALUES (?, ?, ?, ?, ?)`,
        [
          partnerId,
          v.vehicle_name,
          v.vehicle_number,
          v.inspection_expiry_date,
          v.insurance_expiry_date,
        ]
      );
    }
  }
}

router.get('/', async (req, res) => {
  try {
    const q = String(req.query.q || '').trim();
    const category = String(req.query.partner_category_code || '').trim();
    const employment = String(req.query.employment_type_code || '').trim();
    const sortMap = {
      partner_id: 'partner_id',
      partner_name: 'partner_name',
      partner_category_code: 'partner_category_code',
    };
    const sortCol = sortMap[String(req.query.sort || '')] || 'partner_id';
    const order = String(req.query.order || 'asc').toLowerCase() === 'desc' ? 'DESC' : 'ASC';

    const where = ['p.is_deleted = 0'];
    const params = [];
    if (q) {
      where.push('(p.partner_name LIKE ? OR p.partner_name_kana LIKE ? OR p.contact_phone LIKE ?)');
      params.push(`%${q}%`, `%${q}%`, `%${q}%`);
    }
    if (category) {
      where.push('p.partner_category_code = ?');
      params.push(category);
    }
    if (employment) {
      where.push('p.employment_type_code = ?');
      params.push(employment);
    }

    const rows = await query(
      `SELECT p.partner_id, p.partner_name, p.partner_name_kana, p.contact_phone,
              p.partner_category_code, p.employment_type_code, p.invoice_number,
              p.advance_payment_enabled, p.payment_output_code,
              p.transfer_fee_pattern_id,
              p.bank_name, p.branch_name, p.license_expiry_date, p.work_start_date,
              p.blood_type, p.birth_date,
              p.accident_insurance_code, p.contractor_liability_code,
              p.cargo_insurance_code, p.g_association_code,
              p.version, p.updated_at,
              (SELECT COUNT(*) FROM projects pr
               WHERE pr.partner_id = p.partner_id AND pr.is_deleted = 0) AS project_count,
              CASE
                WHEN p.work_start_date IS NULL THEN NULL
                ELSE TIMESTAMPDIFF(YEAR, p.work_start_date, CURDATE())
              END AS continuity_years
       FROM partners p
       WHERE ${where.join(' AND ')}
       ORDER BY p.${sortCol} ${order}`,
      params
    );
    return res.json({ ok: true, partners: rows });
  } catch (err) {
    console.error('[partners/list]', err);
    return res.status(500).json({ ok: false, message: 'パートナー一覧の取得に失敗しました' });
  }
});

router.get('/:id', async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) {
      return res.status(400).json({ ok: false, message: 'パートナーIDが不正です' });
    }
    const detail = await fetchDetail(id);
    if (!detail) {
      return res.status(404).json({ ok: false, message: 'パートナーが見つかりません' });
    }
    return res.json({ ok: true, partner: detail });
  } catch (err) {
    console.error('[partners/get]', err);
    return res.status(500).json({ ok: false, message: 'パートナー詳細の取得に失敗しました' });
  }
});

router.post('/', async (req, res) => {
  const pool = getPool();
  const conn = await pool.getConnection();
  try {
    const data = pick(req.body || {}, PARTNER_FIELDS);
    if (!data.partner_name || !String(data.partner_name).trim()) {
      return res.status(400).json({ ok: false, message: 'パートナー名は必須です' });
    }
    data.partner_name = String(data.partner_name).trim();
    if (data.advance_payment_enabled == null) data.advance_payment_enabled = 0;
    const vehicles = normalizeVehicles(req.body.vehicles);

    await conn.beginTransaction();
    const cols = Object.keys(data);
    const [result] = await conn.query(
      `INSERT INTO partners (${cols.join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`,
      cols.map((c) => data[c])
    );
    const partnerId = result.insertId;
    await syncVehicles(conn, partnerId, vehicles);
    await conn.commit();
    return res.status(201).json({ ok: true, partner: await fetchDetail(partnerId) });
  } catch (err) {
    await conn.rollback();
    console.error('[partners/create]', err);
    return res.status(500).json({ ok: false, message: 'パートナーの作成に失敗しました' });
  } finally {
    conn.release();
  }
});

router.put('/:id', async (req, res) => {
  const pool = getPool();
  const conn = await pool.getConnection();
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) {
      return res.status(400).json({ ok: false, message: 'パートナーIDが不正です' });
    }
    const data = pick(req.body || {}, PARTNER_FIELDS);
    if (!data.partner_name || !String(data.partner_name).trim()) {
      return res.status(400).json({ ok: false, message: 'パートナー名は必須です' });
    }
    data.partner_name = String(data.partner_name).trim();
    const vehicles = normalizeVehicles(req.body.vehicles);
    const expectedVersion = req.body.version != null ? Number(req.body.version) : null;

    await conn.beginTransaction();
    const sets = PARTNER_FIELDS.map((f) => `${f} = ?`);
    const params = PARTNER_FIELDS.map((f) => (data[f] !== undefined ? data[f] : null));
    let sql = `
      UPDATE partners
      SET ${sets.join(', ')}, version = version + 1, updated_at = CURRENT_TIMESTAMP
      WHERE partner_id = ? AND is_deleted = 0
    `;
    params.push(id);
    if (expectedVersion != null && Number.isInteger(expectedVersion)) {
      sql += ' AND version = ?';
      params.push(expectedVersion);
    }
    const [result] = await conn.query(sql, params);
    if (result.affectedRows === 0) {
      await conn.rollback();
      return res.status(409).json({ ok: false, message: '他のユーザーが先に更新しました。再読み込みしてください' });
    }
    await syncVehicles(conn, id, vehicles);
    await conn.commit();
    return res.json({ ok: true, partner: await fetchDetail(id) });
  } catch (err) {
    await conn.rollback();
    console.error('[partners/update]', err);
    return res.status(500).json({ ok: false, message: 'パートナーの更新に失敗しました' });
  } finally {
    conn.release();
  }
});

router.delete('/:id', async (req, res) => {
  try {
    const id = Number(req.params.id);
    const header = await query(
      `UPDATE partners
       SET is_deleted = 1, version = version + 1, updated_at = CURRENT_TIMESTAMP
       WHERE partner_id = ? AND is_deleted = 0`,
      [id]
    );
    if (!header || header.affectedRows === 0) {
      return res.status(404).json({ ok: false, message: 'パートナーが見つかりません' });
    }
    await query(
      `UPDATE partner_vehicles
       SET is_deleted = 1, version = version + 1, updated_at = CURRENT_TIMESTAMP
       WHERE partner_id = ? AND is_deleted = 0`,
      [id]
    );
    return res.json({ ok: true });
  } catch (err) {
    console.error('[partners/delete]', err);
    return res.status(500).json({ ok: false, message: 'パートナーの削除に失敗しました' });
  }
});

module.exports = router;
