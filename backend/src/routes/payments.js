const express = require('express');
const { getPool, query } = require('../db');
const { requireAuth, requirePermission, requireRole } = require('../middleware/auth');

const router = express.Router();
const ACTIVE_ADVANCE_ALLOCATION_JOIN = "LEFT JOIN advance_payment_allocations aa ON aa.advance_record_id = ar.advance_record_id AND aa.status = 'active'";
router.use(requireAuth, requirePermission('payments'));

function effectivePayment(row) {
  if (row.override_payment_amount != null) return Number(row.override_payment_amount);
  return Number(row.calculated_payment_amount || 0);
}

function roleSet(req) { return new Set(req.session.user?.roles || []); }
function restrictPaymentRead(req, where, params, paymentAlias = 'pay') {
  const roles = roleSet(req);
  if (roles.has('admin') || roles.has('soumu') || roles.has('executive')) return;
  if (roles.has('partner')) {
    where.push(`${paymentAlias}.partner_id = ?`);
    params.push(req.session.user.partner_id);
    return;
  }
  if (roles.has('sales')) {
    where.push(`EXISTS (SELECT 1 FROM payment_daily_reports pdr JOIN daily_reports dr ON dr.daily_report_id=pdr.daily_report_id JOIN project_settlement_reviewers psr ON psr.project_id=dr.project_id WHERE pdr.payment_id=${paymentAlias}.payment_id AND psr.user_id=?)`);
    params.push(req.session.user.user_id);
    return;
  }
  where.push('1=0');
}

router.get('/targets', async (req, res) => {
  try {
    const ym = String(req.query.target_year_month || '').trim();
    if (!ym) {
      return res.status(400).json({ ok: false, message: '対象年月は必須です' });
    }
    const projectWhere = ['pr.is_deleted=0', 'pr.partner_id IS NOT NULL'];
    const projectParams = [];
    const targetRoles = new Set(req.session.user?.roles || []);
    if (targetRoles.has('partner')) {
      projectWhere.push('pr.partner_id=?'); projectParams.push(req.session.user.partner_id);
    } else if (targetRoles.has('sales')) {
      projectWhere.push('EXISTS (SELECT 1 FROM project_settlement_reviewers psr WHERE psr.project_id=pr.project_id AND psr.user_id=?)');
      projectParams.push(req.session.user.user_id);
    } else if (!(targetRoles.has('admin') || targetRoles.has('soumu') || targetRoles.has('executive'))) {
      projectWhere.push('1=0');
    }
    const projects = await query(
      `SELECT pr.project_id,pr.partner_id,pr.closing_date AS project_closing_date,
              bp.template_name AS project_name,p.partner_name,p.partner_category_code,p.payment_output_code,
              c.closing_date_code
       FROM projects pr JOIN partners p ON p.partner_id=pr.partner_id AND p.is_deleted=0
       LEFT JOIN companies c ON c.company_id=pr.company_id
       LEFT JOIN base_projects bp ON bp.base_project_id=pr.base_project_id
       WHERE ${projectWhere.join(' AND ')} ORDER BY p.partner_name,pr.project_id`, projectParams
    );
    const reports = await query(
      `SELECT d.* FROM daily_reports d WHERE d.is_deleted=0 AND d.target_year_month=?
       AND d.project_id IN (${projects.length ? projects.map(()=>'?').join(',') : 'NULL'})
       ORDER BY d.project_id,d.work_date`, [ym,...projects.map((p)=>Number(p.project_id))]
    );

    const advances = await query(
      `SELECT ar.partner_id,
              SUM(ar.advance_amount - COALESCE(alloc.allocated_amount, 0)) AS advance_sum,
              SUM(ar.transfer_fee_amount - COALESCE(alloc.allocated_fee, 0)) AS transfer_fee_sum
       FROM advance_records ar
       JOIN cash_schedules cs ON cs.cash_schedule_id = ar.cash_schedule_id AND cs.status = 'executed'
       LEFT JOIN (
         SELECT advance_record_id, SUM(amount) AS allocated_amount, SUM(transfer_fee_amount) AS allocated_fee
         FROM advance_payment_allocations
         WHERE status = 'active'
         GROUP BY advance_record_id
       ) alloc ON alloc.advance_record_id = ar.advance_record_id
       WHERE ar.status = 'executed'
       GROUP BY ar.partner_id`,
    );
    const advMap = new Map(advances.map((a) => [Number(a.partner_id), { amount:Number(a.advance_sum || 0), fee:Number(a.transfer_fee_sum || 0) }]));

    const approvals=await query(`SELECT project_id FROM daily_report_monthly_approvals WHERE target_year_month=? AND status='approved'`,[ym]);
    const approvedProjects=new Set(approvals.map((row)=>Number(row.project_id)));
    const linked=await query(
      `SELECT d.project_id,pay.payment_id,w.status FROM payment_daily_reports l
       JOIN daily_reports d ON d.daily_report_id=l.daily_report_id
       JOIN payments pay ON pay.payment_id=l.payment_id AND pay.is_deleted=0 AND pay.target_year_month=?
       JOIN settlement_workflows w ON w.settlement_type='payment' AND w.settlement_id=pay.payment_id
       WHERE w.status<>'cancelled' ORDER BY pay.payment_id DESC`,[ym]
    );
    const linkByProject=new Map();for(const row of linked)if(!linkByProject.has(Number(row.project_id)))linkByProject.set(Number(row.project_id),row);
    const reportsByProject=new Map();for(const report of reports){const id=Number(report.project_id);if(!reportsByProject.has(id))reportsByProject.set(id,[]);reportsByProject.get(id).push(report);}
    const targets = [];
    for (const project of projects) {
      const projectId=Number(project.project_id),projectReports=reportsByProject.get(projectId)||[];
      const eligible=approvedProjects.has(projectId)?projectReports.filter((row)=>row.status==='approved'&&row.payment_status==='none'):[];
      const gross=eligible.reduce((sum,row)=>sum+effectivePayment(row),0);
      const ruleRows = await query(
        `SELECT rule_code, scope, display_name, amount
         FROM settlement_deduction_rules
         WHERE is_active = 1
           AND valid_from <= LAST_DAY(?)
           AND (valid_to IS NULL OR valid_to >= ?)
           AND (scope = 'common' OR partner_id = ?)
         ORDER BY rule_code, CASE WHEN scope = 'partner' THEN 0 ELSE 1 END, valid_from DESC`,
        [`${ym}-01`, `${ym}-01`, project.partner_id]
      );
      const selectedRules = [];
      const seenRuleCodes = new Set();
      for (const rule of ruleRows) {
        if (seenRuleCodes.has(rule.rule_code)) continue;
        seenRuleCodes.add(rule.rule_code);
        selectedRules.push(rule);
      }
      const advance = advMap.get(Number(project.partner_id)) || { amount:0, fee:0 };
      const advanceDeduction = Math.max(0, advance.amount);
      const transferFeeDeduction = Math.max(0, advance.fee);
      const ruleDeduction = selectedRules.reduce((sum, rule) => sum + Number(rule.amount || 0), 0);
      const finalAmount = Math.max(0, gross - advanceDeduction - transferFeeDeduction - ruleDeduction);
      const active=linkByProject.get(projectId);
      let targetStatus='no_reports';
      if(active)targetStatus=active.status;
      else if(eligible.length)targetStatus='available';
      else if(projectReports.length)targetStatus=approvedProjects.has(projectId)?'not_available':'awaiting_approval';
      const target = {
        partner_id:Number(project.partner_id),partner_name:project.partner_name,
        partner_category_code:project.partner_category_code,payment_output_code:project.payment_output_code,
        project_id:projectId,project_name:project.project_name||`案件 #${projectId}`,
        closing_date:project.project_closing_date||project.closing_date_code||'end',
        report_ids:eligible.map((row)=>Number(row.daily_report_id)),projects:[{project_id:projectId}],gross_amount:gross,
        advance_deduction_amount: advanceDeduction,
        transfer_fee_deduction_amount: transferFeeDeduction,
        deduction_rules: selectedRules,
        rule_deduction_amount: ruleDeduction,
        other_adjustment_amount: 0,
        final_transfer_amount: finalAmount,
        report_count: eligible.length,target_status:targetStatus,
        settlement_id:active?Number(active.payment_id):null,
      };
      targets.push(target);
    }

    return res.json({ ok: true, target_year_month: ym, targets });
  } catch (err) {
    console.error('[payments/targets]', err);
    return res.status(500).json({ ok: false, message: '支払対象一覧の取得に失敗しました' });
  }
});

router.get('/', async (req, res) => {
  try {
    const ym = String(req.query.target_year_month || '').trim();
    const where = ['pay.is_deleted = 0'];
    const params = [];
    restrictPaymentRead(req, where, params);
    if (ym) {
      where.push('pay.target_year_month = ?');
      params.push(ym);
    }
    const rows = await query(
      `SELECT pay.*, p.partner_name
       FROM payments pay
       LEFT JOIN partners p ON p.partner_id = pay.partner_id
       WHERE ${where.join(' AND ')}
       ORDER BY pay.payment_id DESC`,
      params
    );
    return res.json({ ok: true, payments: rows });
  } catch (err) {
    console.error('[payments/list]', err);
    return res.status(500).json({ ok: false, message: '支払一覧の取得に失敗しました' });
  }
});

router.get('/:id', async (req, res) => {
  try {
    const id = Number(req.params.id);
    const where = ['pay.payment_id = ?', 'pay.is_deleted = 0'];
    const params = [id];
    restrictPaymentRead(req, where, params);
    const rows = await query(
      `SELECT pay.*, p.partner_name
       FROM payments pay
       LEFT JOIN partners p ON p.partner_id = pay.partner_id
       WHERE ${where.join(' AND ')}`,
      params
    );
    if (!rows.length) {
      const exists = await query('SELECT payment_id FROM payments WHERE payment_id = ? AND is_deleted = 0', [id]);
      if (exists.length) return res.status(403).json({ ok: false, message: 'この支払は閲覧できません' });
      return res.status(404).json({ ok: false, message: '支払が見つかりません' });
    }
    const details = await query(
      `SELECT * FROM payment_details WHERE payment_id = ? AND is_deleted = 0 ORDER BY payment_detail_id`,
      [id]
    );
    return res.json({ ok: true, payment: { ...rows[0], details } });
  } catch (err) {
    console.error('[payments/get]', err);
    return res.status(500).json({ ok: false, message: '支払詳細の取得に失敗しました' });
  }
});

router.post('/close', (_req, res) => {
  return res.status(410).json({
    ok: false,
    error: 'legacy_endpoint_disabled',
    message: '旧支払締めAPIは停止しました。/api/settlements/payment/drafts を使用してください',
  });
});

router.post('/close', async (req, res) => {
  const pool = getPool();
  const conn = await pool.getConnection();
  try {
    const ym = String(req.body.target_year_month || '').trim();
    const partnerId = Number(req.body.partner_id);
    const reportIds = Array.isArray(req.body.report_ids)
      ? req.body.report_ids.map(Number).filter((n) => n > 0)
      : [];
    const closingDate = String(req.body.closing_date || '').trim() || 'end';
    const otherAdj = Number(req.body.other_adjustment_amount || 0);
    const paymentOutputCode = req.body.payment_output_code || null;
    const cashCycleId = req.body.cash_cycle_id ? Number(req.body.cash_cycle_id) : null;

    if (!ym || !partnerId || !reportIds.length) {
      return res.status(400).json({ ok: false, message: '年月・パートナー・対象日報は必須です' });
    }

    await conn.beginTransaction();
    const [reports] = await conn.query(
      `SELECT * FROM daily_reports
       WHERE daily_report_id IN (${reportIds.map(() => '?').join(',')})
         AND partner_id = ? AND is_deleted = 0
         AND status = 'approved' AND payment_status = 'none'
       FOR UPDATE`,
      [...reportIds, partnerId]
    );
    if (!reports.length) {
      await conn.rollback();
      return res.status(400).json({ ok: false, message: '締め可能な日報がありません' });
    }

    let gross = 0;
    for (const r of reports) gross += effectivePayment(r);

    const [advanceRows] = await conn.query(
      `SELECT ar.advance_record_id,
              ar.advance_amount - COALESCE(SUM(aa.amount), 0) AS remaining_amount,
              ar.transfer_fee_amount - COALESCE(SUM(aa.transfer_fee_amount), 0) AS remaining_fee
       FROM advance_records ar
       JOIN cash_schedules cs ON cs.cash_schedule_id = ar.cash_schedule_id AND cs.status = 'executed'
       ${ACTIVE_ADVANCE_ALLOCATION_JOIN}
       WHERE ar.partner_id = ? AND ar.status = 'executed'
       GROUP BY ar.advance_record_id, ar.advance_amount, ar.transfer_fee_amount
       HAVING remaining_amount > 0 OR remaining_fee > 0 FOR UPDATE`,
      [partnerId]
    );
    const advanceDeduction = advanceRows.reduce((sum, row) => sum + Number(row.remaining_amount || 0), 0);
    const transferFee = advanceRows.reduce((sum, row) => sum + Number(row.remaining_fee || 0), 0);
    const finalAmount = gross - advanceDeduction - transferFee - OFFICE_FEE - SAFETY_FEE + otherAdj;

    const [payResult] = await conn.query(
      `INSERT INTO payments
        (partner_id, target_year_month, closing_date, gross_amount,
         advance_deduction_amount, transfer_fee_deduction_amount,
         office_fee_amount, safety_fee_amount, other_adjustment_amount,
         final_transfer_amount, payment_output_code, payment_status)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'issued')`,
      [
        partnerId,
        ym,
        closingDate,
        gross,
        advanceDeduction,
        transferFee,
        OFFICE_FEE,
        SAFETY_FEE,
        otherAdj,
        finalAmount,
        paymentOutputCode,
      ]
    );
    const paymentId = payResult.insertId;

    if (cashCycleId) {
      const [cycles] = await conn.query('SELECT * FROM cash_cycles WHERE cash_cycle_id = ? FOR UPDATE', [cashCycleId]);
      if (!cycles.length) throw new Error('出金管理回が見つかりません');
      const [partners] = await conn.query('SELECT partner_name FROM partners WHERE partner_id = ?', [partnerId]);
      await conn.query(
        `INSERT INTO cash_schedules (cash_cycle_id,direction,source_type,source_id,partner_id,counterparty_name,title,amount,scheduled_date,snapshot_json,created_by)
         VALUES (?, 'outgoing', 'payment', ?, ?, ?, ?, ?, ?, ?, ?)`,
        [cashCycleId, paymentId, partnerId, partners[0]?.partner_name || `パートナー #${partnerId}`, '通常支払', finalAmount, cycles[0].planned_outgoing_date, JSON.stringify({ payment_id: paymentId, final_transfer_amount: finalAmount }), req.session.user?.user_id || null]
      );
    }

    for (const advance of advanceRows) {
      await conn.query(
        'INSERT INTO advance_payment_allocations (advance_record_id, payment_id, amount, transfer_fee_amount) VALUES (?, ?, ?, ?)',
        [advance.advance_record_id, paymentId, Number(advance.remaining_amount), Number(advance.remaining_fee)]
      );
    }

    await conn.query(
      `INSERT INTO payment_details
        (payment_id, detail_type, item_name, unit_price, quantity, amount)
       VALUES (?, 'work_item', '稼働分（仮組集計）', ?, 1, ?)`,
      [paymentId, gross, gross]
    );
    await conn.query(
      `INSERT INTO payment_details
        (payment_id, detail_type, item_name, unit_price, quantity, amount)
       VALUES
         (?, 'deduction_item', '先払い控除', ?, 1, ?),
         (?, 'deduction_item', '振込手数料控除', ?, 1, ?),
         (?, 'deduction_item', '事務手数料', ?, 1, ?),
         (?, 'deduction_item', '安全協力会費', ?, 1, ?)`,
      [
        paymentId, -advanceDeduction, -advanceDeduction,
        paymentId, -transferFee, -transferFee,
        paymentId, -OFFICE_FEE, -OFFICE_FEE,
        paymentId, -SAFETY_FEE, -SAFETY_FEE,
      ]
    );
    if (otherAdj !== 0) {
      await conn.query(
        `INSERT INTO payment_details
          (payment_id, detail_type, item_name, unit_price, quantity, amount)
         VALUES (?, 'adjustment_item', 'その他調整', ?, 1, ?)`,
        [paymentId, otherAdj, otherAdj]
      );
    }

    for (const r of reports) {
      await conn.query(
        `INSERT INTO payment_daily_reports (payment_id, daily_report_id) VALUES (?, ?)`,
        [paymentId, r.daily_report_id]
      );
      await conn.query(
        `UPDATE daily_reports
         SET payment_status = 'paid', version = version + 1, updated_at = CURRENT_TIMESTAMP
         WHERE daily_report_id = ?`,
        [r.daily_report_id]
      );
    }

    await conn.commit();
    const detail = await query(
      `SELECT pay.*, p.partner_name FROM payments pay
       LEFT JOIN partners p ON p.partner_id = pay.partner_id
       WHERE pay.payment_id = ?`,
      [paymentId]
    );
    const details = await query(
      `SELECT * FROM payment_details WHERE payment_id = ? AND is_deleted = 0`,
      [paymentId]
    );
    return res.status(201).json({ ok: true, payment: { ...detail[0], details } });
  } catch (err) {
    await conn.rollback();
    console.error('[payments/close]', err);
    return res.status(500).json({ ok: false, message: '支払締めに失敗しました' });
  } finally {
    conn.release();
  }
});

router.post('/:id/unconfirm', requireRole('admin','soumu','executive'), async (req, res) => {
  const pool = getPool();
  const conn = await pool.getConnection();
  try {
    const id = Number(req.params.id);
    await conn.beginTransaction();
    const [rows] = await conn.query(
      `SELECT * FROM payments WHERE payment_id = ? AND is_deleted = 0 FOR UPDATE`,
      [id]
    );
    if (!rows.length) {
      await conn.rollback();
      return res.status(404).json({ ok: false, message: '支払が見つかりません' });
    }
    const [links] = await conn.query(
      `SELECT daily_report_id FROM payment_daily_reports WHERE payment_id = ?`,
      [id]
    );
    for (const link of links) {
      await conn.query(
        `UPDATE daily_reports SET payment_status = 'none', version = version + 1 WHERE daily_report_id = ?`,
        [link.daily_report_id]
      );
    }
    await conn.query(
      `UPDATE payments
       SET is_confirmed = 0, approval_status = 'draft', payment_status = 'draft',
           version = version + 1 WHERE payment_id = ?`,
      [id]
    );
    await conn.query(
      `UPDATE cash_schedules SET status = 'cancelled', version = version + 1
       WHERE source_type = 'payment' AND source_id = ? AND status IN ('planned', 'exported', 'held')`,
      [id]
    );
    await conn.commit();
    return res.json({ ok: true });
  } catch (err) {
    await conn.rollback();
    console.error('[payments/unconfirm]', err);
    return res.status(500).json({ ok: false, message: '確定解除に失敗しました' });
  } finally {
    conn.release();
  }
});

router.post('/:id/approve', requireRole('admin','soumu','executive'), async (req, res) => {
  try {
    await query(
      `UPDATE payments SET approval_status = 'approved', version = version + 1 WHERE payment_id = ?`,
      [Number(req.params.id)]
    );
    return res.json({ ok: true });
  } catch (err) {
    return res.status(500).json({ ok: false, message: '承認に失敗しました' });
  }
});

router.post('/:id/print', requireRole('admin','soumu','executive'), async (req, res) => {
  try {
    await query(
      `UPDATE payments SET is_printed = 1, version = version + 1 WHERE payment_id = ?`,
      [Number(req.params.id)]
    );
    return res.json({ ok: true, message: '印刷済みにしました（PDF本作成は後続）' });
  } catch (err) {
    return res.status(500).json({ ok: false, message: '印刷フラグ更新に失敗しました' });
  }
});

router.ACTIVE_ADVANCE_ALLOCATION_JOIN = ACTIVE_ADVANCE_ALLOCATION_JOIN;
module.exports = router;
