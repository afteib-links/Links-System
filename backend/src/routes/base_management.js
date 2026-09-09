const express = require('express');
const { query } = require('../db');
const { requireAuth, requirePermission } = require('../middleware/auth');

const router = express.Router();

router.use(requireAuth, requirePermission('base_management'));

router.get('/', async (req, res) => {
  try {
    const includeEnded = String(req.query.include_ended || '') === '1';
    const companyLifecycle = includeEnded ? '' : "AND c.contract_status_code <> 'ended' AND (c.operation_end_date IS NULL OR c.operation_end_date >= CURDATE())";
    const baseLifecycle = includeEnded ? '' : "AND b.contract_status_code <> 'ended' AND (b.operation_end_date IS NULL OR b.operation_end_date >= CURDATE())";
    const projectLifecycle = includeEnded ? '' : `AND pc.contract_status_code <> 'ended' AND (pc.operation_end_date IS NULL OR pc.operation_end_date >= CURDATE())
      AND (pb.base_project_id IS NULL OR (pb.contract_status_code <> 'ended' AND (pb.operation_end_date IS NULL OR pb.operation_end_date >= CURDATE())))
      AND (pt.partner_id IS NULL OR (pt.contract_status_code <> 'ended' AND (pt.operation_end_date IS NULL OR pt.operation_end_date >= CURDATE())))`;
    const priceLifecycle = includeEnded ? '' : `AND psc.contract_status_code <> 'ended' AND (psc.operation_end_date IS NULL OR psc.operation_end_date >= CURDATE())
      AND (psb.base_project_id IS NULL OR (psb.contract_status_code <> 'ended' AND (psb.operation_end_date IS NULL OR psb.operation_end_date >= CURDATE())))
      AND (pspt.partner_id IS NULL OR (pspt.contract_status_code <> 'ended' AND (pspt.operation_end_date IS NULL OR pspt.operation_end_date >= CURDATE())))`;
    const [companies, baseProjects, projects, priceSets] = await Promise.all([
      query(
        `SELECT c.company_id, c.office_no, c.company_name, c.company_name_kana,
                c.closing_date_code, c.payment_date_code, c.contract_date,
                c.contract_status_code, c.operation_end_date,
                c.updated_at
         FROM companies c
         WHERE c.is_deleted = 0 ${companyLifecycle}
         ORDER BY c.company_name ASC, c.company_id ASC`
      ),
      query(
        `SELECT b.base_project_id, b.company_id, b.template_name, b.default_manager,
                b.business_type, b.basic_work_hours, b.work_time_type,
                b.work_mode_code, b.payment_type, b.operation_start_date,
                b.closing_date, b.contract_status_code, b.operation_end_date, b.updated_at
         FROM base_projects b
         WHERE b.is_deleted = 0 ${baseLifecycle}
         ORDER BY b.template_name ASC, b.base_project_id ASC`
      ),
      query(
        `SELECT p.project_id, p.base_project_id, p.company_id, p.partner_id,
                p.manager_name, p.business_type, p.payment_type,
                p.operation_start_date, p.closing_date, p.updated_at,
                pt.partner_name
         FROM projects p
         JOIN companies pc ON pc.company_id = p.company_id AND pc.is_deleted = 0
         LEFT JOIN base_projects pb ON pb.base_project_id = p.base_project_id AND pb.is_deleted = 0
         LEFT JOIN partners pt ON pt.partner_id = p.partner_id AND pt.is_deleted = 0
         WHERE p.is_deleted = 0 ${projectLifecycle}
         ORDER BY p.project_id ASC`
      ),
      query(
        `SELECT ps.price_set_id, ps.price_set_no, ps.price_set_name, ps.company_id,
                ps.base_project_id, ps.project_id, ps.apply_start_date,
                ps.apply_end_date, ps.updated_at,
                (SELECT COUNT(*) FROM price_set_lines psl
                 WHERE psl.price_set_id = ps.price_set_id AND psl.is_deleted = 0) AS line_count,
                (SELECT COALESCE(SUM(psl.billing_unit_price), 0) FROM price_set_lines psl
                 WHERE psl.price_set_id = ps.price_set_id AND psl.is_deleted = 0) AS billing_unit_total,
                (SELECT COALESCE(SUM(psl.payment_unit_price), 0) FROM price_set_lines psl
                 WHERE psl.price_set_id = ps.price_set_id AND psl.is_deleted = 0) AS payment_unit_total
         FROM price_sets ps
         LEFT JOIN projects psp ON psp.project_id = ps.project_id AND psp.is_deleted = 0
         LEFT JOIN base_projects psb ON psb.base_project_id = COALESCE(ps.base_project_id, psp.base_project_id) AND psb.is_deleted = 0
         LEFT JOIN partners pspt ON pspt.partner_id = psp.partner_id AND pspt.is_deleted = 0
         JOIN companies psc ON psc.company_id = COALESCE(ps.company_id, psp.company_id, psb.company_id) AND psc.is_deleted = 0
         WHERE ps.is_deleted = 0 ${priceLifecycle}
         ORDER BY ps.apply_start_date DESC, ps.price_set_id DESC`
      ),
    ]);

    return res.json({
      ok: true,
      companies,
      base_projects: baseProjects,
      projects,
      price_sets: priceSets,
    });
  } catch (err) {
    console.error('[base_management/list]', err);
    return res.status(500).json({ ok: false, message: '基本管理データの取得に失敗しました' });
  }
});

module.exports = router;
