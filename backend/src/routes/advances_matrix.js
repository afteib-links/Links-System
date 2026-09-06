const express = require('express');
const { getPool, query } = require('../db');
const { requireAuth, requirePermission } = require('../middleware/auth');
const { ensureCycles } = require('./cash_management');
const { resolveTransferFee } = require('../services/transfer_fee');
const {
  GROUPS,
  shiftMonth,
  monthDay,
  periodForCycle,
  periodFor,
} = require('../services/closing_cycles');

const router = express.Router();
router.use(requireAuth, requirePermission('advances'));

function feeFromProject(project) {
  const projectPattern = project.project_fee_pattern_id ? {
    transfer_fee_pattern_id: project.project_fee_pattern_id,
    pattern_name: project.project_fee_pattern_name,
    amount: project.project_fee_amount,
  } : null;
  const partnerPattern = project.partner_fee_pattern_id ? {
    transfer_fee_pattern_id: project.partner_fee_pattern_id,
    pattern_name: project.partner_fee_pattern_name,
    amount: project.partner_fee_amount,
  } : null;
  return resolveTransferFee(projectPattern, partnerPattern);
}
async function cycleMeta(ym) {
  const output = {};
  for (const [groupCode, config] of Object.entries(GROUPS)) {
    const paymentYm = shiftMonth(ym, config.paymentMonthOffset);
    await ensureCycles(paymentYm);
    const rows = await query('SELECT * FROM cash_cycles WHERE target_year_month=? AND cycle_code=? LIMIT 1', [paymentYm, config.paymentCycle]);
    output[groupCode] = {
      group_code: groupCode, cycle_number: config.number, label: config.label,
      payment_date: String(rows[0].planned_outgoing_date).slice(0, 10), cash_cycle_id: Number(rows[0].cash_cycle_id),
    };
  }
  return output;
}
async function matrixData(ym) {
  const conn = await getPool().getConnection();
  try {
    const [projects] = await conn.query(
      `SELECT p.project_id,p.company_id,p.partner_id,p.closing_date,p.installment_amount,p.operation_start_date,
              p.business_type,p.manager_name,b.template_name,c.company_name,pt.partner_name,
              pfp.transfer_fee_pattern_id project_fee_pattern_id,pfp.pattern_name project_fee_pattern_name,pfp.amount project_fee_amount,
              ptfp.transfer_fee_pattern_id partner_fee_pattern_id,ptfp.pattern_name partner_fee_pattern_name,ptfp.amount partner_fee_amount
       FROM projects p LEFT JOIN base_projects b ON b.base_project_id=p.base_project_id
       LEFT JOIN companies c ON c.company_id=p.company_id LEFT JOIN partners pt ON pt.partner_id=p.partner_id
       LEFT JOIN transfer_fee_patterns pfp ON pfp.transfer_fee_pattern_id=p.transfer_fee_pattern_id AND pfp.is_deleted=0 AND pfp.is_active=1
       LEFT JOIN transfer_fee_patterns ptfp ON ptfp.transfer_fee_pattern_id=pt.transfer_fee_pattern_id AND ptfp.is_deleted=0 AND ptfp.is_active=1
       WHERE p.is_deleted=0 AND p.partner_id IS NOT NULL AND p.payment_type='installment'
         AND p.closing_date IN ('5','10','15','20','25','end') ORDER BY p.project_id`
    );
    const ids = projects.map((row) => Number(row.project_id));
    const settings = new Map(); const records = new Map(); const workDates = new Map();
    if (ids.length) {
      const marks = ids.map(() => '?').join(',');
      const [settingRows] = await conn.query(`SELECT * FROM advance_cycle_settings WHERE target_year_month=? AND project_id IN (${marks})`, [ym, ...ids]);
      settingRows.forEach((row) => settings.set(`${row.project_id}:${row.group_code}`, row));
      const [recordRows] = await conn.query(
        `SELECT ar.*,cs.status cash_status FROM advance_records ar LEFT JOIN cash_schedules cs ON cs.cash_schedule_id=ar.cash_schedule_id
         WHERE ar.target_year_month=? AND ar.project_id IN (${marks}) ORDER BY ar.advance_record_id`, [ym, ...ids]
      );
      recordRows.forEach((row) => records.set(`${row.project_id}:${row.group_code}`, row));
      const [reportRows] = await conn.query(
        `SELECT project_id,work_date FROM daily_reports WHERE project_id IN (${marks}) AND work_date BETWEEN ? AND ?
         AND status IN ('confirmed','approved') AND is_deleted=0 GROUP BY project_id,work_date`,
        [...ids, monthDay(shiftMonth(ym, -1), 26), monthDay(ym, 'end')]
      );
      reportRows.forEach((row) => {
        const id = Number(row.project_id); if (!workDates.has(id)) workDates.set(id, []);
        workDates.get(id).push(String(row.work_date).slice(0, 10));
      });
    }
    const groups = await cycleMeta(ym);
    const output = projects.map((project) => {
      const fee = feeFromProject(project); const unitPrice = Number(project.installment_amount || 0);
      const dates = workDates.get(Number(project.project_id)) || [];
      const cycles = Object.keys(GROUPS).map((groupCode) => {
        const period = periodForCycle(ym, project.closing_date, groupCode);
        const workDays = dates.filter((date) => date >= period.start && date <= period.end).length;
        const calculated = unitPrice * workDays;
        const setting = settings.get(`${project.project_id}:${groupCode}`) || null;
        const record = records.get(`${project.project_id}:${groupCode}`) || null;
        const fixed = record && !['unplanned','cancelled'].includes(record.status);
        const amount = fixed ? Number(record.advance_amount) : setting?.advance_amount_override == null ? calculated : Number(setting.advance_amount_override);
        const transferFee = fixed ? Number(record.transfer_fee_amount) : setting?.transfer_fee_override == null ? fee.amount : Number(setting.transfer_fee_override);
        return {
          ...groups[groupCode], period_start: period.start, period_end: period.end, work_days: workDays,
          unit_price: unitPrice, calculated_amount: calculated, advance_amount: amount,
          transfer_fee_pattern_id: fixed ? record.transfer_fee_pattern_id : fee.patternId,
          transfer_fee_pattern_name: fixed ? record.transfer_fee_pattern_name : fee.patternName,
          transfer_fee_base_amount: fixed ? Number(record.transfer_fee_base_amount || 0) : fee.amount,
          transfer_fee_amount: transferFee, transfer_fee_source: fee.source,
          is_target: setting ? Boolean(setting.is_target) : true,
          adjustment_reason: setting?.adjustment_reason || record?.adjustment_reason || '',
          setting_id: setting?.advance_cycle_setting_id || null, version: setting?.version || 0,
          advance_record_id: record?.advance_record_id || null,
          status: record && !['unplanned','cancelled'].includes(record.status) ? record.status : 'unplanned', cash_status: record?.cash_status || null,
        };
      });
      const active = cycles.filter((cycle) => cycle.is_target && Number(cycle.advance_amount) > 0);
      return {
        project_id: Number(project.project_id), project_name: project.template_name || project.business_type || `案件 #${project.project_id}`,
        company_id: Number(project.company_id), company_name: project.company_name || '', partner_id: Number(project.partner_id),
        partner_name: project.partner_name || '', closing_date: project.closing_date, cycles,
        totals: { advance_count: active.length, advance_amount: active.reduce((n,c) => n + Number(c.advance_amount), 0), transfer_fee_amount: active.reduce((n,c) => n + Number(c.transfer_fee_amount), 0) },
      };
    });
    return { groups: Object.values(groups), projects: output };
  } finally { conn.release(); }
}
function filterMatrix(projects, req) {
  const q = String(req.query.q || '').trim().toLowerCase(); const companyId = Number(req.query.company_id || 0);
  const partnerId = Number(req.query.partner_id || 0); const closing = String(req.query.closing_date || ''); const status = String(req.query.status || '');
  return projects.filter((p) => (!companyId || p.company_id === companyId) && (!partnerId || p.partner_id === partnerId)
    && (!closing || String(p.closing_date) === closing) && (!status || p.cycles.some((c) => c.status === status || c.cash_status === status))
    && (!q || `${p.project_name} ${p.company_name} ${p.partner_name}`.toLowerCase().includes(q)));
}
function summarize(projects) {
  const cycles = Object.keys(GROUPS).map((groupCode) => {
    const active = projects.flatMap((p) => p.cycles.filter((c) => c.group_code === groupCode)).filter((c) => c.is_target && Number(c.advance_amount) > 0);
    return { group_code: groupCode, advance_count: active.length, advance_amount: active.reduce((n,c) => n + Number(c.advance_amount), 0), transfer_fee_amount: active.reduce((n,c) => n + Number(c.transfer_fee_amount), 0) };
  });
  return { project_count: projects.length, cycles, advance_count: cycles.reduce((n,c) => n + c.advance_count, 0), advance_amount: cycles.reduce((n,c) => n + c.advance_amount, 0), transfer_fee_amount: cycles.reduce((n,c) => n + c.transfer_fee_amount, 0) };
}
function advanceProjectStatus(project) {
  const active = (project.cycles || []).filter((cycle) => cycle.is_target && Number(cycle.advance_amount) > 0);
  if (!active.length) return null;
  const states = active.map((cycle) => cycle.cash_status || cycle.status);
  if (states.every((status) => status === 'executed')) return 'completed';
  if (states.some((status) => ['planned','exported','held'].includes(status))) return 'waiting';
  if (states.some((status) => status === 'executed')) return 'in_progress';
  return 'not_started';
}
function assertCycleVersion(setting, suppliedVersion, projectId) {
  const expected = Number(suppliedVersion);
  const current = setting ? Number(setting.version) : 0;
  if (!Number.isInteger(expected) || expected < 0 || expected !== current) {
    const error = new Error(`案件 #${projectId} は他の利用者が更新しました。再読み込みしてください`);
    error.statusCode = 409;
    throw error;
  }
}
function assertMutableSchedule(schedule, projectId) {
  if (!schedule || !['planned','held'].includes(schedule.status)) {
    const error = new Error(`案件 #${projectId} はCSV出力済みまたは実行済みのため更新できません`);
    error.statusCode = 409;
    throw error;
  }
}
async function cancelScheduleExports(conn, scheduleId, reason) {
  const [batchRows] = await conn.query(
    `SELECT cash_export_batch_id FROM cash_export_batch_items
     WHERE cash_schedule_id=? AND status='active' FOR UPDATE`, [scheduleId]
  );
  if (!batchRows.length) return;
  await conn.query(
    `UPDATE cash_export_batch_items
     SET status='cancelled',cancelled_at=CURRENT_TIMESTAMP,cancellation_reason=?
     WHERE cash_schedule_id=? AND status='active'`, [reason,scheduleId]
  );
  for (const batchId of new Set(batchRows.map((row) => Number(row.cash_export_batch_id)))) {
    await conn.query(
      `UPDATE cash_export_batches SET status=
       CASE
         WHEN NOT EXISTS (SELECT 1 FROM cash_export_batch_items WHERE cash_export_batch_id=? AND status='active') THEN 'cancelled'
         ELSE 'partially_cancelled'
       END WHERE cash_export_batch_id=?`, [batchId,batchId]
    );
  }
}
async function sendMatrix(req, res) {
  const ym = String(req.query.target_year_month || '').trim();
  if (!/^\d{4}-\d{2}$/.test(ym)) return res.status(400).json({ ok:false, message:'対象年月は必須です' });
  try {
    const matrix = await matrixData(ym); const visible = filterMatrix(matrix.projects, req);
    return res.json({ ok:true, target_year_month:ym, groups:matrix.groups, projects:visible, summary:summarize(matrix.projects), visible_project_count:visible.length });
  } catch (err) { console.error('[advances/matrix]', err); return res.status(400).json({ ok:false, message:err.message }); }
}
router.get('/matrix', sendMatrix);
router.get('/groups', sendMatrix);

async function loadEligibleProject(conn, projectId, lock = false) {
  const [rows] = await conn.query(
    `SELECT p.*,c.company_name,pt.partner_name,
            pfp.transfer_fee_pattern_id project_fee_pattern_id,pfp.pattern_name project_fee_pattern_name,pfp.amount project_fee_amount,
            ptfp.transfer_fee_pattern_id partner_fee_pattern_id,ptfp.pattern_name partner_fee_pattern_name,ptfp.amount partner_fee_amount
     FROM projects p LEFT JOIN companies c ON c.company_id=p.company_id LEFT JOIN partners pt ON pt.partner_id=p.partner_id
     LEFT JOIN transfer_fee_patterns pfp ON pfp.transfer_fee_pattern_id=p.transfer_fee_pattern_id AND pfp.is_deleted=0 AND pfp.is_active=1
     LEFT JOIN transfer_fee_patterns ptfp ON ptfp.transfer_fee_pattern_id=pt.transfer_fee_pattern_id AND ptfp.is_deleted=0 AND ptfp.is_active=1
     WHERE p.project_id=? AND p.is_deleted=0 AND p.payment_type='installment' ${lock ? 'FOR UPDATE' : ''}`, [projectId]
  );
  if (!rows.length) throw new Error(`案件 #${projectId} は分割対象ではありません`);
  return rows[0];
}
async function calculatedCell(conn, project, ym, groupCode) {
  const period = periodForCycle(ym, project.closing_date, groupCode);
  const [days] = await conn.query(
    `SELECT COUNT(DISTINCT work_date) cnt FROM daily_reports WHERE project_id=? AND work_date BETWEEN ? AND ?
     AND status IN ('confirmed','approved') AND is_deleted=0`, [project.project_id, period.start, period.end]
  );
  const workDays = Number(days[0]?.cnt || 0); const unitPrice = Number(project.installment_amount || 0);
  return { period, workDays, unitPrice, calculated: unitPrice * workDays, feePattern: feeFromProject(project) };
}
router.put('/cycles/:projectId/:groupCode', async (req, res) => {
  const projectId = Number(req.params.projectId); const groupCode = String(req.params.groupCode); const ym = String(req.body?.target_year_month || '');
  const expectedVersion = Number(req.body?.version || 0); const reason = String(req.body?.adjustment_reason || '').trim();
  if (!projectId || !GROUPS[groupCode] || !/^\d{4}-\d{2}$/.test(ym)) return res.status(400).json({ ok:false, message:'案件、対象月、サイクルは必須です' });
  const conn = await getPool().getConnection();
  try {
    await conn.beginTransaction(); const project = await loadEligibleProject(conn, projectId, true);
    const cell = await calculatedCell(conn, project, ym, groupCode);
    const amount = Number(req.body?.advance_amount ?? cell.calculated); const fee = Number(req.body?.transfer_fee_amount ?? cell.feePattern.amount);
    if (!Number.isFinite(amount) || amount < 0 || !Number.isFinite(fee) || fee < 0) throw new Error('支払額と手数料は0以上で入力してください');
    if ((amount !== cell.calculated || fee !== cell.feePattern.amount) && !reason) throw new Error('支払額または手数料を変更する場合は理由が必須です');
    const [recordRows] = await conn.query(`SELECT * FROM advance_records WHERE target_year_month=? AND project_id=? AND group_code=? ORDER BY advance_record_id DESC LIMIT 1 FOR UPDATE`, [ym,projectId,groupCode]);
    if (recordRows[0] && !['unplanned','cancelled'].includes(recordRows[0].status)) throw new Error('予定作成済みまたは実行済みのセルは編集できません');
    const [rows] = await conn.query(`SELECT * FROM advance_cycle_settings WHERE target_year_month=? AND project_id=? AND group_code=? FOR UPDATE`, [ym,projectId,groupCode]);
    const before = rows[0] || null; let settingId;
    if (before) {
      if (expectedVersion !== Number(before.version)) { await conn.rollback(); return res.status(409).json({ ok:false, message:'他の利用者が更新しました。再読み込みしてください' }); }
      await conn.query(`UPDATE advance_cycle_settings SET is_target=?,advance_amount_override=?,transfer_fee_override=?,adjustment_reason=?,version=version+1 WHERE advance_cycle_setting_id=?`,
        [req.body?.is_target === false ? 0 : 1, amount === cell.calculated ? null : amount, fee === cell.feePattern.amount ? null : fee, reason || null, before.advance_cycle_setting_id]);
      settingId = Number(before.advance_cycle_setting_id);
    } else {
      const [result] = await conn.query(`INSERT INTO advance_cycle_settings (target_year_month,project_id,group_code,is_target,advance_amount_override,transfer_fee_override,adjustment_reason) VALUES (?,?,?,?,?,?,?)`,
        [ym,projectId,groupCode,req.body?.is_target === false ? 0 : 1,amount === cell.calculated ? null : amount,fee === cell.feePattern.amount ? null : fee,reason || null]);
      settingId = Number(result.insertId);
    }
    const [afterRows] = await conn.query('SELECT * FROM advance_cycle_settings WHERE advance_cycle_setting_id=?', [settingId]);
    await conn.query(`INSERT INTO advance_cycle_setting_audit_logs (advance_cycle_setting_id,action_code,before_data,after_data,reason,actor_user_id) VALUES (?,?,?,?,?,?)`,
      [settingId,before ? 'update':'create',before ? JSON.stringify(before):null,JSON.stringify(afterRows[0]),reason || '先払対象変更',req.session.user?.user_id || null]);
    await conn.commit(); return res.json({ ok:true, setting:afterRows[0] });
  } catch (err) { await conn.rollback(); return res.status(400).json({ ok:false, message:err.message }); } finally { conn.release(); }
});

router.post('/groups/:groupCode/records', async (req, res) => {
  const groupCode = String(req.params.groupCode); const config = GROUPS[groupCode]; const ym = String(req.body?.target_year_month || '');
  const items = Array.isArray(req.body?.items) ? req.body.items : [];
  if (!config || !/^\d{4}-\d{2}$/.test(ym) || !items.length) return res.status(400).json({ ok:false, message:'対象月、サイクル、対象案件は必須です' });
  const meta = (await cycleMeta(ym))[groupCode]; const conn = await getPool().getConnection();
  try {
    await conn.beginTransaction(); const created = [];
    for (const item of items) {
      const project = await loadEligibleProject(conn, Number(item.project_id), true); const cell = await calculatedCell(conn, project, ym, groupCode);
      const [settingRows] = await conn.query('SELECT is_target,version FROM advance_cycle_settings WHERE target_year_month=? AND project_id=? AND group_code=? FOR UPDATE', [ym,project.project_id,groupCode]);
      assertCycleVersion(settingRows[0] || null, item.version, project.project_id);
      if (settingRows[0] && !Number(settingRows[0].is_target)) throw new Error(`案件 #${project.project_id} の当該サイクルは先払OFFです`);
      const requested = Number(item.advance_amount ?? cell.calculated); const fee = Number(item.transfer_fee_amount ?? cell.feePattern.amount); const reason = String(item.adjustment_reason || '').trim();
      if (!(requested > 0)) throw new Error(`案件 #${project.project_id} の支払額は1円以上にしてください`);
      if (!Number.isFinite(fee) || fee < 0) throw new Error('手数料は0以上で入力してください');
      if ((requested !== cell.calculated || fee !== cell.feePattern.amount) && !reason) throw new Error('支払額または手数料を変更する場合は理由が必須です');
      const [existingRows] = await conn.query(`SELECT * FROM advance_records WHERE project_id=? AND period_start=? AND period_end=? FOR UPDATE`, [project.project_id,cell.period.start,cell.period.end]);
      const existing = existingRows[0] || null; if (existing?.status === 'executed') throw new Error(`案件 #${project.project_id} は実行済みです`);
      let recordId = existing ? Number(existing.advance_record_id) : null;
      if (!existing) {
        const [result] = await conn.query(
          `INSERT INTO advance_records (project_id,partner_id,company_id,target_year_month,group_code,project_advance_term_id,period_start,period_end,payment_date,work_days,calculated_amount,advance_amount,transfer_fee_amount,transfer_fee_pattern_id,transfer_fee_pattern_name,transfer_fee_base_amount,adjustment_reason,status,cash_schedule_id,created_by)
           VALUES (?,?,?,?,?,NULL,?,?,?,?,?,?,?,?,?,?,?,'unplanned',NULL,?)`,
          [project.project_id,project.partner_id,project.company_id,ym,groupCode,cell.period.start,cell.period.end,meta.payment_date,cell.workDays,cell.calculated,requested,fee,cell.feePattern.patternId,cell.feePattern.patternName,cell.feePattern.amount,reason || null,req.session.user?.user_id || null]
        ); recordId = Number(result.insertId);
      }
      let scheduleId = existing?.cash_schedule_id ? Number(existing.cash_schedule_id) : null;
      const snapshot = JSON.stringify({ target_year_month:ym,group_code:groupCode,period_start:cell.period.start,period_end:cell.period.end,work_days:cell.workDays,unit_price:cell.unitPrice,transfer_fee_pattern_id:cell.feePattern.patternId,transfer_fee_pattern_name:cell.feePattern.patternName,transfer_fee_base_amount:cell.feePattern.amount,transfer_fee_amount:fee });
      if (existing?.status === 'planned' && scheduleId) {
        const [scheduleRows] = await conn.query('SELECT status FROM cash_schedules WHERE cash_schedule_id=? FOR UPDATE', [scheduleId]);
        assertMutableSchedule(scheduleRows[0] || null, project.project_id);
        const [scheduleUpdate] = await conn.query(`UPDATE cash_schedules SET cash_cycle_id=?,amount=?,scheduled_date=?,snapshot_json=?,version=version+1 WHERE cash_schedule_id=? AND status IN ('planned','held')`, [meta.cash_cycle_id,requested,meta.payment_date,snapshot,scheduleId]);
        if (!scheduleUpdate.affectedRows) assertMutableSchedule(null, project.project_id);
      } else {
        const [schedule] = await conn.query(
          `INSERT INTO cash_schedules (cash_cycle_id,direction,source_type,source_id,company_id,partner_id,project_id,counterparty_name,title,amount,scheduled_date,snapshot_json,created_by)
           VALUES (?,'outgoing','advance',?,?,?,?,?,?,?,?,?,?)`,
          [meta.cash_cycle_id,recordId,project.company_id,project.partner_id,project.project_id,project.partner_name || `パートナー #${project.partner_id}`,`${config.label} 前払`,requested,meta.payment_date,snapshot,req.session.user?.user_id || null]
        ); scheduleId = Number(schedule.insertId);
      }
      await conn.query(
        `UPDATE advance_records SET target_year_month=?,group_code=?,payment_date=?,work_days=?,calculated_amount=?,advance_amount=?,transfer_fee_amount=?,transfer_fee_pattern_id=?,transfer_fee_pattern_name=?,transfer_fee_base_amount=?,adjustment_reason=?,status='planned',cash_schedule_id=?,version=version+1 WHERE advance_record_id=?`,
        [ym,groupCode,meta.payment_date,cell.workDays,cell.calculated,requested,fee,cell.feePattern.patternId,cell.feePattern.patternName,cell.feePattern.amount,reason || null,scheduleId,recordId]
      );
      await conn.query(`INSERT INTO advance_record_audit_logs (advance_record_id,action_code,before_data,after_data,reason,actor_user_id) VALUES (?,?,?,?,?,?)`,
        [recordId,existing?.status === 'planned' ? 'update':'create',existing ? JSON.stringify(existing):null,JSON.stringify({ calculated_amount:cell.calculated,advance_amount:requested,transfer_fee_amount:fee,cash_schedule_id:scheduleId }),reason || 'サイクルから予定作成',req.session.user?.user_id || null]);
      await conn.query(
        `INSERT INTO advance_cycle_settings (target_year_month,project_id,group_code,is_target,advance_amount_override,transfer_fee_override,adjustment_reason) VALUES (?,?,?,1,?,?,?)
         ON DUPLICATE KEY UPDATE is_target=1,advance_amount_override=VALUES(advance_amount_override),transfer_fee_override=VALUES(transfer_fee_override),adjustment_reason=VALUES(adjustment_reason),version=version+1`,
        [ym,project.project_id,groupCode,requested === cell.calculated ? null:requested,fee === cell.feePattern.amount ? null:fee,reason || null]
      ); created.push(recordId);
    }
    await conn.commit(); return res.status(201).json({ ok:true, advance_record_ids:created, payment_date:meta.payment_date });
  } catch (err) { await conn.rollback(); return res.status(err.statusCode || 400).json({ ok:false, message:err.message }); } finally { conn.release(); }
});

router.post('/records/:id/cancel', async (req, res) => {
  const conn = await getPool().getConnection();
  try {
    const id = Number(req.params.id); const reason = String(req.body?.reason || '').trim(); if (!reason) throw new Error('作成取消理由は必須です');
    await conn.beginTransaction(); const [rows] = await conn.query('SELECT * FROM advance_records WHERE advance_record_id=? FOR UPDATE', [id]);
    if (!rows.length || rows[0].status !== 'planned') throw new Error('未実行の予定作成済み前払だけを作成取消できます');
    const before = rows[0];
    if (before.cash_schedule_id) {
      const [schedules] = await conn.query('SELECT * FROM cash_schedules WHERE cash_schedule_id=? FOR UPDATE', [before.cash_schedule_id]);
      if (schedules[0] && !['planned','held','exported'].includes(schedules[0].status)) throw new Error('実行済み前払は作成取消できません。返金調整を使用してください');
      await cancelScheduleExports(conn, before.cash_schedule_id, reason);
      await conn.query("UPDATE cash_schedules SET status='cancelled',version=version+1 WHERE cash_schedule_id=?", [before.cash_schedule_id]);
    }
    await conn.query("UPDATE advance_records SET status='unplanned',cash_schedule_id=NULL,version=version+1 WHERE advance_record_id=?", [id]);
    await conn.query(`INSERT INTO advance_record_audit_logs (advance_record_id,action_code,before_data,after_data,reason,actor_user_id) VALUES (?,'reset_to_unplanned',?,?,?,?)`, [id,JSON.stringify(before),JSON.stringify({ status:'unplanned',cash_schedule_id:null }),reason,req.session.user?.user_id || null]);
    await conn.commit(); return res.json({ ok:true, status:'unplanned' });
  } catch (err) { await conn.rollback(); return res.status(400).json({ ok:false, message:err.message }); } finally { conn.release(); }
});

router.get('/records', async (req, res) => {
  try {
    const ym = String(req.query.target_year_month || '').trim(); const where = ym ? 'WHERE ar.target_year_month=?' : '';
    const rows = await query(`SELECT ar.*,cs.status cash_status,c.cycle_code,p.partner_name FROM advance_records ar LEFT JOIN cash_schedules cs ON cs.cash_schedule_id=ar.cash_schedule_id LEFT JOIN cash_cycles c ON c.cash_cycle_id=cs.cash_cycle_id LEFT JOIN partners p ON p.partner_id=ar.partner_id ${where} ORDER BY ar.advance_record_id DESC`, ym ? [ym]:[]);
    return res.json({ ok:true, records:rows });
  } catch (_err) { return res.status(500).json({ ok:false, message:'前払記録の取得に失敗しました' }); }
});

router.post('/records/:id/reversal', async (req, res) => {
  const conn = await getPool().getConnection();
  try {
    const id = Number(req.params.id); const cycleId = Number(req.body.cash_cycle_id); const amount = Number(req.body.amount);
    if (!id || !cycleId || !(amount > 0)) throw new Error('管理回と正の調整額は必須です');
    await conn.beginTransaction(); const [records] = await conn.query('SELECT ar.*,p.partner_name FROM advance_records ar LEFT JOIN partners p ON p.partner_id=ar.partner_id WHERE ar.advance_record_id=? FOR UPDATE', [id]);
    if (!records.length || records[0].status !== 'executed') throw new Error('実行済みの前払だけを調整できます');
    const [reversed] = await conn.query("SELECT COALESCE(SUM(amount),0) total FROM cash_schedules WHERE source_type='adjustment' AND source_id=? AND direction='incoming' AND status<>'cancelled'", [id]);
    if (amount + Number(reversed[0].total || 0) > Number(records[0].advance_amount)) throw new Error('調整額の合計は前払実行額を超えられません');
    const [cycles] = await conn.query('SELECT * FROM cash_cycles WHERE cash_cycle_id=? FOR UPDATE', [cycleId]); if (!cycles.length) throw new Error('管理回が見つかりません');
    const [result] = await conn.query(`INSERT INTO cash_schedules (cash_cycle_id,direction,source_type,source_id,partner_id,project_id,counterparty_name,title,amount,scheduled_date,snapshot_json,created_by) VALUES (?,'incoming','adjustment',?,?,?,?,'前払返金・訂正',?,?,?,?)`, [cycleId,id,records[0].partner_id,records[0].project_id,records[0].partner_name || `パートナー #${records[0].partner_id}`,amount,cycles[0].planned_incoming_date,JSON.stringify({ advance_record_id:id,kind:'advance_reversal' }),req.session.user?.user_id || null]);
    await conn.commit(); return res.status(201).json({ ok:true, cash_schedule_id:result.insertId });
  } catch (err) { await conn.rollback(); return res.status(400).json({ ok:false, message:err.message }); } finally { conn.release(); }
});

router.get('/terms', (_req,res) => res.status(410).json({ ok:false, message:'前払条件は個別案件の支払区分・分割単価で設定してください' }));
router.post('/terms', (_req,res) => res.status(410).json({ ok:false, message:'前払条件は個別案件で設定してください' }));
router.post('/records', (_req,res) => res.status(410).json({ ok:false, message:'3サイクルの予定作成APIを使用してください' }));
router.get('/', (_req,res) => res.status(410).json({ ok:false, message:'先払マトリクスAPIを使用してください' }));
router.put('/upsert', (_req,res) => res.status(410).json({ ok:false, message:'先払マトリクスAPIを使用してください' }));

router.GROUPS = GROUPS; router.shiftMonth = shiftMonth; router.periodFor = periodFor; router.periodForCycle = periodForCycle; router.summarize = summarize;
router.matrixData = matrixData; router.advanceProjectStatus = advanceProjectStatus; router.assertCycleVersion = assertCycleVersion; router.assertMutableSchedule = assertMutableSchedule; router.cancelScheduleExports = cancelScheduleExports;
module.exports = router;
