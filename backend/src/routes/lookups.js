const express = require('express');
const { query } = require('../db');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();
router.use(requireAuth);

router.get('/companies', async (_req, res) => {
  try {
    const rows = await query(
      `SELECT company_id, company_name, closing_date_code
       FROM companies WHERE is_deleted = 0
       ORDER BY company_id ASC`
    );
    return res.json({ ok: true, companies: rows });
  } catch (err) {
    console.error('[lookups/companies]', err);
    return res.status(500).json({ ok: false, message: '企業一覧の取得に失敗しました' });
  }
});

router.get('/partners', async (_req, res) => {
  try {
    const rows = await query(
      `SELECT partner_id, partner_name, partner_category_code, employment_type_code
       FROM partners WHERE is_deleted = 0
       ORDER BY partner_id ASC`
    );
    return res.json({ ok: true, partners: rows });
  } catch (err) {
    console.error('[lookups/partners]', err);
    return res.status(500).json({ ok: false, message: 'パートナー一覧の取得に失敗しました' });
  }
});

router.get('/projects', async (req, res) => {
  try {
    const companyId = Number(req.query.company_id || 0);
    const partnerId = Number(req.query.partner_id || 0);
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
    const rows = await query(
      `SELECT p.project_id, p.company_id, p.partner_id, p.vehicle_id,
              p.manager_name, p.business_type, p.payment_type, p.closing_date,
              c.company_name, pt.partner_name, b.template_name
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
    console.error('[lookups/projects]', err);
    return res.status(500).json({ ok: false, message: '案件一覧の取得に失敗しました' });
  }
});

router.get('/base-projects', async (req, res) => {
  try {
    const companyId = Number(req.query.company_id || 0);
    const where = ['is_deleted = 0'];
    const params = [];
    if (companyId > 0) {
      where.push('company_id = ?');
      params.push(companyId);
    }
    const rows = await query(
      `SELECT base_project_id, company_id, template_name, default_manager, business_type
       FROM base_projects
       WHERE ${where.join(' AND ')}
       ORDER BY base_project_id ASC`,
      params
    );
    return res.json({ ok: true, base_projects: rows });
  } catch (err) {
    console.error('[lookups/base-projects]', err);
    return res.status(500).json({ ok: false, message: '基本案件一覧の取得に失敗しました' });
  }
});

module.exports = router;
