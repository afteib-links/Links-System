const express = require('express');
const { getPool, query } = require('../db');
const { requireAuth, requirePermission } = require('../middleware/auth');

const router = express.Router();

router.use(requireAuth, requirePermission('companies'));

const COMPANY_FIELDS = [
  'office_no',
  'office_name',
  'company_name',
  'company_name_kana',
  'zip_code',
  'address',
  'contact',
  'fax',
  'contract_manager',
  'our_manager',
  'our_contract_manager',
  'closing_date_code',
  'payment_date_code',
  'contract_date',
  'business_content',
  'bank_name',
  'branch_name',
  'account_number',
  'deposit_type',
  'account_name',
  'invoice_send_method',
  'invoice_send_address',
  'work_mode_code',
];

function formatSerial(prefix, padDigits, nextNumber) {
  const pad = Math.max(0, Math.min(12, Number(padDigits) || 0));
  const n = Math.max(0, Number(nextNumber) || 0);
  return `${prefix || ''}${String(n).padStart(pad, '0')}`;
}

function normalizeManagerPeriods(list) {
  if (!Array.isArray(list)) return [];
  return list.map((row) => ({
    period_id: row.period_id ? Number(row.period_id) : null,
    role_type: row.role_type || 'our_manager',
    name_or_user: row.name_or_user || '',
    staff_master_id: row.staff_master_id ? Number(row.staff_master_id) : null,
    start_date: row.start_date || null,
    end_date: row.end_date || null,
  })).filter((r) => r.name_or_user && r.start_date);
}

function pickCompany(body) {
  const out = {};
  for (const key of COMPANY_FIELDS) {
    if (Object.prototype.hasOwnProperty.call(body, key)) {
      const val = body[key];
      out[key] = val === '' || val === undefined ? null : val;
    }
  }
  return out;
}

function companyUpdateFields(data) {
  return Object.keys(data).filter((field) => COMPANY_FIELDS.includes(field));
}

function normalizeBillings(list) {
  if (!Array.isArray(list)) return [];
  return list.map((row) => ({
    billing_id: row.billing_id ? Number(row.billing_id) : null,
    billing_print_name: row.billing_print_name || null,
    billing_zip_code: row.billing_zip_code || null,
    billing_address: row.billing_address || null,
    billing_phone: row.billing_phone || null,
    billing_fax: row.billing_fax || null,
    billing_email: row.billing_email || null,
    invoice_send_method: row.invoice_send_method || null,
    billing_manager: row.billing_manager || null,
    billing_summary_no: row.billing_summary_no || null,
  }));
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

async function fetchCompanyDetail(companyId) {
  const companies = await query(
    `SELECT * FROM companies WHERE company_id = ? AND is_deleted = 0 LIMIT 1`,
    [companyId]
  );
  if (!companies.length) return null;

  const billings = await query(
    `SELECT * FROM company_billings
     WHERE company_id = ? AND is_deleted = 0
     ORDER BY billing_id ASC`,
    [companyId]
  );
  const vehicles = await query(
    `SELECT * FROM company_vehicles
     WHERE company_id = ? AND is_deleted = 0
     ORDER BY vehicle_id ASC`,
    [companyId]
  );
  const manager_periods = await query(
    `SELECT * FROM company_manager_periods
     WHERE company_id = ? AND is_deleted = 0
     ORDER BY start_date DESC, period_id DESC`,
    [companyId]
  );

  return {
    ...companies[0],
    billings,
    vehicles,
    manager_periods,
  };
}

/** 採番ルール office から次の事業所Noを発行（conn 上で FOR UPDATE） */
async function allocateOfficeNo(conn) {
  const [rules] = await conn.query(
    `SELECT * FROM numbering_rules
     WHERE rule_key = 'office' AND is_deleted = 0
     LIMIT 1
     FOR UPDATE`
  );
  if (!rules.length) {
    const err = new Error('事業所の採番ルールが未登録です');
    err.status = 400;
    err.code = 'validation_error';
    throw err;
  }
  const rule = rules[0];
  if (!Number(rule.is_active)) {
    const err = new Error('事業所の採番ルールが無効です');
    err.status = 400;
    err.code = 'validation_error';
    throw err;
  }
  let nextNum = Number(rule.next_number) || 1;
  let officeNo = formatSerial(rule.prefix, rule.pad_digits, nextNum);
  for (let i = 0; i < 50; i += 1) {
    const [dup] = await conn.query(
      `SELECT company_id AS id FROM companies WHERE office_no = ? AND is_deleted = 0
       UNION ALL
       SELECT office_id AS id FROM office_masters WHERE office_no = ? AND is_deleted = 0
       LIMIT 1`,
      [officeNo, officeNo]
    );
    if (!dup.length) break;
    nextNum += 1;
    officeNo = formatSerial(rule.prefix, rule.pad_digits, nextNum);
  }
  await conn.query(
    `UPDATE numbering_rules
     SET next_number = ?, version = version + 1, updated_at = CURRENT_TIMESTAMP
     WHERE numbering_rule_id = ?`,
    [nextNum + 1, rule.numbering_rule_id]
  );
  return officeNo;
}

async function syncManagerPeriods(conn, companyId, periods) {
  const [existing] = await conn.query(
    `SELECT period_id FROM company_manager_periods WHERE company_id = ? AND is_deleted = 0`,
    [companyId]
  );
  const keepIds = new Set(periods.filter((p) => p.period_id).map((p) => Number(p.period_id)));
  for (const row of existing) {
    if (!keepIds.has(Number(row.period_id))) {
      await conn.query(
        `UPDATE company_manager_periods
         SET is_deleted = 1, version = version + 1, updated_at = CURRENT_TIMESTAMP
         WHERE period_id = ? AND company_id = ?`,
        [row.period_id, companyId]
      );
    }
  }
  for (const p of periods) {
    if (p.period_id) {
      await conn.query(
        `UPDATE company_manager_periods
         SET role_type = ?, name_or_user = ?, staff_master_id = ?,
             start_date = ?, end_date = ?, version = version + 1, updated_at = CURRENT_TIMESTAMP
         WHERE period_id = ? AND company_id = ? AND is_deleted = 0`,
        [
          p.role_type,
          p.name_or_user,
          p.staff_master_id,
          p.start_date,
          p.end_date,
          p.period_id,
          companyId,
        ]
      );
    } else {
      await conn.query(
        `UPDATE company_manager_periods
         SET end_date=DATE_SUB(?,INTERVAL 1 DAY),version=version+1,updated_at=CURRENT_TIMESTAMP
         WHERE company_id=? AND role_type=? AND end_date IS NULL AND is_deleted=0 AND start_date<?`,
        [p.start_date,companyId,p.role_type,p.start_date]
      );
      await conn.query(
        `INSERT INTO company_manager_periods
          (company_id, role_type, name_or_user, staff_master_id, start_date, end_date)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [companyId, p.role_type, p.name_or_user, p.staff_master_id, p.start_date, p.end_date]
      );
    }
  }
}

async function syncBillings(conn, companyId, billings) {
  const [existing] = await conn.query(
    `SELECT billing_id FROM company_billings WHERE company_id = ? AND is_deleted = 0`,
    [companyId]
  );
  const keepIds = new Set(
    billings.filter((b) => b.billing_id).map((b) => Number(b.billing_id))
  );

  for (const row of existing) {
    if (!keepIds.has(Number(row.billing_id))) {
      await conn.query(
        `UPDATE company_billings
         SET is_deleted = 1, version = version + 1, updated_at = CURRENT_TIMESTAMP
         WHERE billing_id = ? AND company_id = ?`,
        [row.billing_id, companyId]
      );
    }
  }

  for (const b of billings) {
    if (b.billing_id) {
      await conn.query(
        `UPDATE company_billings
         SET billing_print_name = ?, billing_zip_code = ?, billing_address = ?, billing_phone = ?,
             billing_fax = ?, billing_email = ?, invoice_send_method = ?, billing_manager = ?, billing_summary_no = ?,
             version = version + 1, updated_at = CURRENT_TIMESTAMP
         WHERE billing_id = ? AND company_id = ? AND is_deleted = 0`,
        [
          b.billing_print_name,
          b.billing_zip_code,
          b.billing_address,
          b.billing_phone,
          b.billing_fax,
          b.billing_email,
          b.invoice_send_method,
          b.billing_manager,
          b.billing_summary_no,
          b.billing_id,
          companyId,
        ]
      );
    } else {
      await conn.query(
        `INSERT INTO company_billings
          (company_id, billing_print_name, billing_zip_code, billing_address, billing_phone,
           billing_fax, billing_email, invoice_send_method, billing_manager, billing_summary_no)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          companyId,
          b.billing_print_name,
          b.billing_zip_code,
          b.billing_address,
          b.billing_phone,
          b.billing_fax,
          b.billing_email,
          b.invoice_send_method,
          b.billing_manager,
          b.billing_summary_no,
        ]
      );
    }
  }
}

async function syncVehicles(conn, companyId, vehicles) {
  const [existing] = await conn.query(
    `SELECT vehicle_id FROM company_vehicles WHERE company_id = ? AND is_deleted = 0`,
    [companyId]
  );
  const keepIds = new Set(
    vehicles.filter((v) => v.vehicle_id).map((v) => Number(v.vehicle_id))
  );

  for (const row of existing) {
    if (!keepIds.has(Number(row.vehicle_id))) {
      await conn.query(
        `UPDATE company_vehicles
         SET is_deleted = 1, version = version + 1, updated_at = CURRENT_TIMESTAMP
         WHERE vehicle_id = ? AND company_id = ?`,
        [row.vehicle_id, companyId]
      );
    }
  }

  for (const v of vehicles) {
    if (v.vehicle_id) {
      await conn.query(
        `UPDATE company_vehicles
         SET vehicle_name = ?, vehicle_number = ?,
             inspection_expiry_date = ?, insurance_expiry_date = ?,
             version = version + 1, updated_at = CURRENT_TIMESTAMP
         WHERE vehicle_id = ? AND company_id = ? AND is_deleted = 0`,
        [
          v.vehicle_name,
          v.vehicle_number,
          v.inspection_expiry_date,
          v.insurance_expiry_date,
          v.vehicle_id,
          companyId,
        ]
      );
    } else {
      await conn.query(
        `INSERT INTO company_vehicles
          (company_id, vehicle_name, vehicle_number,
           inspection_expiry_date, insurance_expiry_date)
         VALUES (?, ?, ?, ?, ?)`,
        [
          companyId,
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
    const closing = String(req.query.closing_date_code || '').trim();
    const sort = String(req.query.sort || 'company_id');
    const order = String(req.query.order || 'asc').toLowerCase() === 'desc' ? 'DESC' : 'ASC';

    const sortMap = {
      company_id: 'company_id',
      company_name: 'company_name',
      closing_date_code: 'closing_date_code',
    };
    const sortCol = sortMap[sort] || 'company_id';

    const where = ['c.is_deleted = 0'];
    const params = [];
    if (q) {
      where.push('c.company_name LIKE ?');
      params.push(`%${q}%`);
    }
    if (closing) {
      where.push('c.closing_date_code = ?');
      params.push(closing);
    }

    const rows = await query(
      `SELECT c.company_id, c.office_no, c.office_name, c.company_name, c.company_name_kana,
              c.closing_date_code, c.payment_date_code,
              COALESCE((SELECT cb.invoice_send_method FROM company_billings cb WHERE cb.company_id=c.company_id AND cb.is_deleted=0 ORDER BY cb.billing_id LIMIT 1),c.invoice_send_method) AS invoice_send_method,
              c.work_mode_code, c.our_manager, c.fax, c.invoice_send_address,
              c.version, c.updated_at,
              (SELECT COUNT(*) FROM base_projects b
               WHERE b.company_id = c.company_id AND b.is_deleted = 0) AS base_project_count
       FROM companies c
       WHERE ${where.join(' AND ')}
       ORDER BY c.${sortCol} ${order}`,
      params
    );

    return res.json({ ok: true, companies: rows });
  } catch (err) {
    console.error('[companies/list]', err);
    return res.status(500).json({
      ok: false,
      error: 'server_error',
      message: '企業一覧の取得に失敗しました',
    });
  }
});

router.get('/:id', async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) {
      return res.status(400).json({
        ok: false,
        error: 'validation_error',
        message: '企業IDが不正です',
      });
    }
    const detail = await fetchCompanyDetail(id);
    if (!detail) {
      return res.status(404).json({
        ok: false,
        error: 'not_found',
        message: '企業が見つかりません',
      });
    }
    return res.json({ ok: true, company: detail });
  } catch (err) {
    console.error('[companies/get]', err);
    return res.status(500).json({
      ok: false,
      error: 'server_error',
      message: '企業詳細の取得に失敗しました',
    });
  }
});

router.post('/', async (req, res) => {
  const pool = getPool();
  const conn = await pool.getConnection();
  try {
    const data = pickCompany(req.body || {});
    if (!data.company_name || !String(data.company_name).trim()) {
      return res.status(400).json({
        ok: false,
        error: 'validation_error',
        message: '企業名は必須です',
      });
    }
    data.company_name = String(data.company_name).trim();
    if (Object.prototype.hasOwnProperty.call(data, 'office_name')) {
      data.office_name = data.office_name == null ? null : String(data.office_name).trim() || null;
    }
    // 事業所Noはクライアント指定不可。登録時に自動採番。
    delete data.office_no;
    const billings = normalizeBillings(req.body.billings);
    const vehicles = normalizeVehicles(req.body.vehicles);
    const managerPeriods = normalizeManagerPeriods(req.body.manager_periods);

    await conn.beginTransaction();
    data.office_no = await allocateOfficeNo(conn);
    const cols = Object.keys(data);
    const placeholders = cols.map(() => '?').join(', ');
    const [result] = await conn.query(
      `INSERT INTO companies (${cols.join(', ')}) VALUES (${placeholders})`,
      cols.map((c) => data[c])
    );
    const companyId = result.insertId;
    await syncBillings(conn, companyId, billings);
    await syncVehicles(conn, companyId, vehicles);
    await syncManagerPeriods(conn, companyId, managerPeriods);
    await conn.commit();

    const detail = await fetchCompanyDetail(companyId);
    return res.status(201).json({ ok: true, company: detail });
  } catch (err) {
    await conn.rollback();
    if (err.status) {
      return res.status(err.status).json({
        ok: false,
        error: err.code || 'validation_error',
        message: err.message,
      });
    }
    console.error('[companies/create]', err);
    return res.status(500).json({
      ok: false,
      error: 'server_error',
      message: '企業の作成に失敗しました',
    });
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
      return res.status(400).json({
        ok: false,
        error: 'validation_error',
        message: '企業IDが不正です',
      });
    }

    const data = pickCompany(req.body || {});
    if (!data.company_name || !String(data.company_name).trim()) {
      return res.status(400).json({
        ok: false,
        error: 'validation_error',
        message: '企業名は必須です',
      });
    }
    data.company_name = String(data.company_name).trim();
    if (Object.prototype.hasOwnProperty.call(data, 'office_name')) {
      data.office_name = data.office_name == null ? null : String(data.office_name).trim() || null;
    }
    // 事業所Noは既存値を維持。未採番なら自動採番。クライアントからの上書きは不可。
    delete data.office_no;
    const billings = normalizeBillings(req.body.billings);
    const vehicles = normalizeVehicles(req.body.vehicles);
    const managerPeriods = normalizeManagerPeriods(req.body.manager_periods);
    const expectedVersion = req.body.version != null ? Number(req.body.version) : null;

    await conn.beginTransaction();
    const [currentRows] = await conn.query(
      `SELECT office_no FROM companies WHERE company_id = ? AND is_deleted = 0 LIMIT 1 FOR UPDATE`,
      [id]
    );
    if (!currentRows.length) {
      await conn.rollback();
      return res.status(404).json({
        ok: false,
        error: 'not_found',
        message: '企業が見つかりません',
      });
    }
    data.office_no = currentRows[0].office_no || (await allocateOfficeNo(conn));

    // PUT の payload に含まれない旧項目は移行完了まで既存値を維持する。
    // 全 COMPANY_FIELDS を更新すると、画面から外した請求書送付情報などが NULL になる。
    const updateFields = companyUpdateFields(data);
    const sets = updateFields.map((field) => `${field} = ?`);
    const params = updateFields.map((field) => data[field]);
    let sql = `
      UPDATE companies
      SET ${sets.join(', ')},
          version = version + 1,
          updated_at = CURRENT_TIMESTAMP
      WHERE company_id = ? AND is_deleted = 0
    `;
    params.push(id);
    if (expectedVersion != null && Number.isInteger(expectedVersion)) {
      sql += ' AND version = ?';
      params.push(expectedVersion);
    }

    const [result] = await conn.query(sql, params);
    if (result.affectedRows === 0) {
      await conn.rollback();
      return res.status(409).json({
        ok: false,
        error: 'conflict',
        message: '他のユーザーが先に更新しました。再読み込みしてください',
      });
    }

    await syncBillings(conn, id, billings);
    await syncVehicles(conn, id, vehicles);
    await syncManagerPeriods(conn, id, managerPeriods);
    await conn.commit();

    const detail = await fetchCompanyDetail(id);
    return res.json({ ok: true, company: detail });
  } catch (err) {
    await conn.rollback();
    if (err.status) {
      return res.status(err.status).json({
        ok: false,
        error: err.code || 'validation_error',
        message: err.message,
      });
    }
    console.error('[companies/update]', err);
    return res.status(500).json({
      ok: false,
      error: 'server_error',
      message: '企業の更新に失敗しました',
    });
  } finally {
    conn.release();
  }
});

router.delete('/:id', async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) {
      return res.status(400).json({
        ok: false,
        error: 'validation_error',
        message: '企業IDが不正です',
      });
    }

    const header = await query(
      `UPDATE companies
       SET is_deleted = 1, version = version + 1, updated_at = CURRENT_TIMESTAMP
       WHERE company_id = ? AND is_deleted = 0`,
      [id]
    );
    if (!header || header.affectedRows === 0) {
      return res.status(404).json({
        ok: false,
        error: 'not_found',
        message: '企業が見つかりません',
      });
    }

    await query(
      `UPDATE company_billings
       SET is_deleted = 1, version = version + 1, updated_at = CURRENT_TIMESTAMP
       WHERE company_id = ? AND is_deleted = 0`,
      [id]
    );
    await query(
      `UPDATE company_vehicles
       SET is_deleted = 1, version = version + 1, updated_at = CURRENT_TIMESTAMP
       WHERE company_id = ? AND is_deleted = 0`,
      [id]
    );

    return res.json({ ok: true });
  } catch (err) {
    console.error('[companies/delete]', err);
    return res.status(500).json({
      ok: false,
      error: 'server_error',
      message: '企業の削除に失敗しました',
    });
  }
});

router.pickCompany = pickCompany;
router.companyUpdateFields = companyUpdateFields;
module.exports = router;
