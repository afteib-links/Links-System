const express = require('express');
const { getPool, query } = require('../db');
const { requireAuth, requirePermission } = require('../middleware/auth');
const { ensureCycles } = require('./cash_management');

const router = express.Router();
router.use(requireAuth, requirePermission('advances'));

const GROUPS = {
  early: { label:'5日・10日締め', closings:['5','10'], paymentCycle:'20', paymentMonthOffset:0 },
  middle: { label:'15日・20日締め', closings:['15','20'], paymentCycle:'end', paymentMonthOffset:0 },
  late: { label:'25日・末日締め', closings:['25','end'], paymentCycle:'10', paymentMonthOffset:1 },
};

function shiftMonth(ym, offset) {
  const [year,month]=ym.split('-').map(Number);const date=new Date(Date.UTC(year,month-1+offset,1));
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth()+1).padStart(2,'0')}`;
}
function dateText(date){return date.toISOString().slice(0,10);}
function periodFor(ym, closing) {
  const [year,month]=ym.split('-').map(Number);const endDay=closing==='end'?new Date(Date.UTC(year,month,0)).getUTCDate():Number(closing);
  const end=new Date(Date.UTC(year,month-1,endDay));
  const previousYm=shiftMonth(ym,-1),[py,pm]=previousYm.split('-').map(Number);
  const previousDay=closing==='end'?new Date(Date.UTC(py,pm,0)).getUTCDate():Math.min(Number(closing),new Date(Date.UTC(py,pm,0)).getUTCDate());
  const start=new Date(Date.UTC(py,pm-1,previousDay+1));return {start:dateText(start),end:dateText(end)};
}
async function confirmedWorkDays(conn, projectId, start, end) {
  const [rows]=await conn.query(`SELECT COUNT(DISTINCT work_date) cnt FROM daily_reports WHERE project_id=? AND work_date BETWEEN ? AND ? AND status IN ('confirmed','approved') AND is_deleted=0`,[projectId,start,end]);
  return Number(rows[0]?.cnt||0);
}

router.get('/groups', async(req,res)=>{
  const ym=String(req.query.target_year_month||'').trim();if(!/^\d{4}-\d{2}$/.test(ym))return res.status(400).json({ok:false,message:'対象年月は必須です'});
  const conn=await getPool().getConnection();
  try{const [projects]=await conn.query(`SELECT p.project_id,p.company_id,p.partner_id,p.closing_date,b.template_name,c.company_name,pt.partner_name FROM projects p LEFT JOIN base_projects b ON b.base_project_id=p.base_project_id LEFT JOIN companies c ON c.company_id=p.company_id LEFT JOIN partners pt ON pt.partner_id=p.partner_id WHERE p.is_deleted=0 AND p.partner_id IS NOT NULL AND p.closing_date IN ('5','10','15','20','25','end') ORDER BY p.closing_date,p.project_id`);const output=[];
    for(const [groupCode,config] of Object.entries(GROUPS)){const paymentYm=shiftMonth(ym,config.paymentMonthOffset);await ensureCycles(paymentYm);const [cycles]=await conn.query('SELECT * FROM cash_cycles WHERE target_year_month=? AND cycle_code=?',[paymentYm,config.paymentCycle]);const cycle=cycles[0];const rows=[];
      for(const project of projects.filter(p=>config.closings.includes(String(p.closing_date)))){const period=periodFor(ym,String(project.closing_date));const [terms]=await conn.query(`SELECT * FROM project_advance_terms WHERE project_id=? AND is_enabled=1 AND is_deleted=0 AND valid_from<=? AND (valid_to IS NULL OR valid_to>=?) ORDER BY valid_from DESC,project_advance_term_id DESC LIMIT 1`,[project.project_id,period.end,period.start]);if(!terms.length)continue;const workDays=await confirmedWorkDays(conn,project.project_id,period.start,period.end);const calculated=Number(terms[0].unit_price)*workDays;const [records]=await conn.query(`SELECT ar.*,cs.status cash_status FROM advance_records ar LEFT JOIN cash_schedules cs ON cs.cash_schedule_id=ar.cash_schedule_id WHERE ar.project_id=? AND ar.period_start=? AND ar.period_end=? ORDER BY ar.advance_record_id DESC LIMIT 1`,[project.project_id,period.start,period.end]);const record=records[0]||null;rows.push({...project,project_advance_term_id:terms[0].project_advance_term_id,unit_price:Number(terms[0].unit_price),period_start:period.start,period_end:period.end,work_days:workDays,calculated_amount:calculated,advance_amount:record?Number(record.advance_amount):calculated,transfer_fee_amount:record?Number(record.transfer_fee_amount):0,adjustment_reason:record?.adjustment_reason||'',advance_record_id:record?.advance_record_id||null,status:record?.status||'unplanned',cash_status:record?.cash_status||null,version:record?.version||null});}
      output.push({group_code:groupCode,label:config.label,closing_dates:config.closings,payment_date:String(cycle.planned_outgoing_date).slice(0,10),cash_cycle_id:cycle.cash_cycle_id,rows});}
    return res.json({ok:true,target_year_month:ym,groups:output});
  }catch(err){console.error('[advances/groups]',err);return res.status(400).json({ok:false,message:err.message});}finally{conn.release();}
});

router.post('/groups/:groupCode/records', async(req,res)=>{
  const groupCode=String(req.params.groupCode),config=GROUPS[groupCode],ym=String(req.body?.target_year_month||''),items=Array.isArray(req.body?.items)?req.body.items:[];
  if(!config||!/^\d{4}-\d{2}$/.test(ym)||!items.length)return res.status(400).json({ok:false,message:'対象月、前払グループ、対象案件は必須です'});
  const paymentYm=shiftMonth(ym,config.paymentMonthOffset);await ensureCycles(paymentYm);const conn=await getPool().getConnection();
  try{await conn.beginTransaction();const [cycles]=await conn.query('SELECT * FROM cash_cycles WHERE target_year_month=? AND cycle_code=? FOR UPDATE',[paymentYm,config.paymentCycle]);if(!cycles.length)throw new Error('支払管理回が見つかりません');const cycle=cycles[0];const created=[];
    for(const item of items){const projectId=Number(item.project_id);const [projects]=await conn.query(`SELECT p.*,c.company_name,pt.partner_name FROM projects p LEFT JOIN companies c ON c.company_id=p.company_id LEFT JOIN partners pt ON pt.partner_id=p.partner_id WHERE p.project_id=? AND p.is_deleted=0 FOR UPDATE`,[projectId]);const project=projects[0];if(!project||!config.closings.includes(String(project.closing_date)))throw new Error('選択した案件はこの前払グループに所属しません');const period=periodFor(ym,String(project.closing_date));const [terms]=await conn.query(`SELECT * FROM project_advance_terms WHERE project_id=? AND is_enabled=1 AND is_deleted=0 AND valid_from<=? AND (valid_to IS NULL OR valid_to>=?) ORDER BY valid_from DESC,project_advance_term_id DESC LIMIT 1`,[projectId,period.end,period.start]);if(!terms.length)throw new Error(`案件 #${projectId} に有効な前払条件がありません`);const workDays=await confirmedWorkDays(conn,projectId,period.start,period.end),calculated=Number(terms[0].unit_price)*workDays,requested=item.advance_amount==null||item.advance_amount===''?calculated:Number(item.advance_amount),fee=Number(item.transfer_fee_amount||0),reason=String(item.adjustment_reason||'').trim();if(!Number.isFinite(requested)||requested<0||!Number.isFinite(fee)||fee<0)throw new Error('前払額と手数料は0以上で入力してください');if((requested!==calculated||fee!==0)&&!reason)throw new Error('前払額の増減または手数料には変更理由が必要です');const [existingRows]=await conn.query(`SELECT * FROM advance_records WHERE project_id=? AND period_start=? AND period_end=? FOR UPDATE`,[projectId,period.start,period.end]);const existing=existingRows[0];
      if(existing){if(existing.status!=='planned')throw new Error(`案件 #${projectId} は実行済みまたは取消済みです`);const before={...existing};await conn.query(`UPDATE advance_records SET target_year_month=?,group_code=?,payment_date=?,work_days=?,calculated_amount=?,advance_amount=?,transfer_fee_amount=?,adjustment_reason=?,version=version+1 WHERE advance_record_id=?`,[ym,groupCode,cycle.planned_outgoing_date,workDays,calculated,requested,fee,reason||null,existing.advance_record_id]);await conn.query(`UPDATE cash_schedules SET cash_cycle_id=?,amount=?,scheduled_date=?,snapshot_json=?,version=version+1 WHERE cash_schedule_id=? AND status IN ('planned','held')`,[cycle.cash_cycle_id,requested,cycle.planned_outgoing_date,JSON.stringify({target_year_month:ym,group_code:groupCode,period_start:period.start,period_end:period.end,work_days:workDays,unit_price:terms[0].unit_price,transfer_fee_amount:fee}),existing.cash_schedule_id]);await conn.query(`INSERT INTO advance_record_audit_logs (advance_record_id,action_code,before_data,after_data,reason,actor_user_id) VALUES (?,'update',?,?,?,?)`,[existing.advance_record_id,JSON.stringify(before),JSON.stringify({calculated_amount:calculated,advance_amount:requested,transfer_fee_amount:fee}),reason||'グループ再計算',req.session.user.user_id]);created.push(existing.advance_record_id);continue;}
      const [schedule]=await conn.query(`INSERT INTO cash_schedules (cash_cycle_id,direction,source_type,company_id,partner_id,project_id,counterparty_name,title,amount,scheduled_date,snapshot_json,created_by) VALUES (?,'outgoing','advance',?,?,?,?,?,?,?,?,?)`,[cycle.cash_cycle_id,project.company_id,project.partner_id,projectId,project.partner_name||`パートナー #${project.partner_id}`,`${config.label} 前払`,requested,cycle.planned_outgoing_date,JSON.stringify({target_year_month:ym,group_code:groupCode,period_start:period.start,period_end:period.end,work_days:workDays,unit_price:terms[0].unit_price,transfer_fee_amount:fee}),req.session.user.user_id]);const [record]=await conn.query(`INSERT INTO advance_records (project_id,partner_id,company_id,target_year_month,group_code,project_advance_term_id,period_start,period_end,payment_date,work_days,calculated_amount,advance_amount,transfer_fee_amount,adjustment_reason,cash_schedule_id,created_by) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,[projectId,project.partner_id,project.company_id,ym,groupCode,terms[0].project_advance_term_id,period.start,period.end,cycle.planned_outgoing_date,workDays,calculated,requested,fee,reason||null,schedule.insertId,req.session.user.user_id]);await conn.query(`INSERT INTO advance_record_audit_logs (advance_record_id,action_code,before_data,after_data,reason,actor_user_id) VALUES (?,'create',NULL,?,?,?)`,[record.insertId,JSON.stringify({calculated_amount:calculated,advance_amount:requested,transfer_fee_amount:fee}),reason||'締日グループから作成',req.session.user.user_id]);created.push(Number(record.insertId));}
    await conn.commit();return res.status(201).json({ok:true,advance_record_ids:created,payment_date:String(cycle.planned_outgoing_date).slice(0,10)});
  }catch(err){await conn.rollback();return res.status(400).json({ok:false,message:err.message});}finally{conn.release();}
});

// 本実装: 案件別の有効期間付き前払条件。旧 advance_payments は参照しない。
router.get('/terms', async (_req, res) => {
  try {
    const terms = await query(`SELECT t.*, p.project_id, c.company_name, pt.partner_name
      FROM project_advance_terms t JOIN projects p ON p.project_id=t.project_id
      LEFT JOIN companies c ON c.company_id=p.company_id LEFT JOIN partners pt ON pt.partner_id=p.partner_id
      WHERE t.is_deleted=0 ORDER BY t.project_id, t.valid_from DESC`);
    return res.json({ ok: true, terms });
  } catch (err) { return res.status(500).json({ ok:false, message:'前払条件の取得に失敗しました' }); }
});
router.post('/terms', async (req, res) => {
  try {
    const b=req.body || {}; const projectId=Number(b.project_id); const unit=Number(b.unit_price);
    if (!projectId || !b.valid_from || unit < 0) throw new Error('案件、適用開始日、前払単価は必須です');
    const [result]=await getPool().query(`INSERT INTO project_advance_terms (project_id,valid_from,valid_to,is_enabled,unit_price) VALUES (?,?,?,?,?)`,[projectId,b.valid_from || null,b.valid_to || null,b.is_enabled ? 1 : 0,unit]);
    return res.status(201).json({ok:true,project_advance_term_id:result.insertId});
  } catch(err) { return res.status(400).json({ok:false,message:err.message}); }
});
router.post('/records', (_req, res) => res.status(410).json({
  ok:false,
  message:'個別の前払予定作成は廃止しました。締日別3グループから作成してください',
}));
router.post('/records/:id/cancel', async (req,res) => {
  const pool=getPool(); const conn=await pool.getConnection();
  try { const id=Number(req.params.id);const reason=String(req.body?.reason||'').trim();if(!reason)throw new Error('取消理由は必須です');await conn.beginTransaction(); const [rows]=await conn.query('SELECT * FROM advance_records WHERE advance_record_id=? FOR UPDATE',[id]); if(!rows.length || rows[0].status !== 'planned') throw new Error('実行済み前払は取消できません。調整予定を作成してください'); await conn.query("UPDATE advance_records SET status='cancelled',version=version+1 WHERE advance_record_id=?",[id]); await conn.query("UPDATE cash_schedules SET status='cancelled',version=version+1 WHERE cash_schedule_id=?",[rows[0].cash_schedule_id]);await conn.query(`INSERT INTO advance_record_audit_logs (advance_record_id,action_code,before_data,after_data,reason,actor_user_id) VALUES (?,'cancel',?,NULL,?,?)`,[id,JSON.stringify(rows[0]),reason,req.session.user.user_id]); await conn.commit(); return res.json({ok:true}); } catch(err) { await conn.rollback(); return res.status(400).json({ok:false,message:err.message}); } finally {conn.release();}
});
router.get('/records', async (req, res) => {
  try {
    const ym = String(req.query.target_year_month || '').trim();
    const where = ym ? 'AND c.target_year_month = ?' : '';
    const rows = await query(
      `SELECT ar.*, cs.status AS cash_status, c.target_year_month, c.cycle_code, p.partner_name
       FROM advance_records ar
       JOIN cash_schedules cs ON cs.cash_schedule_id = ar.cash_schedule_id
       JOIN cash_cycles c ON c.cash_cycle_id = cs.cash_cycle_id
       LEFT JOIN partners p ON p.partner_id = ar.partner_id
       WHERE 1=1 ${where} ORDER BY ar.advance_record_id DESC`, ym ? [ym] : []
    );
    return res.json({ ok: true, records: rows });
  } catch (err) { return res.status(500).json({ ok:false, message:'前払記録の取得に失敗しました' }); }
});
router.post('/records/:id/reversal', async (req, res) => {
  const pool = getPool(); const conn = await pool.getConnection();
  try {
    const id = Number(req.params.id); const cycleId = Number(req.body.cash_cycle_id); const amount = Number(req.body.amount);
    if (!id || !cycleId || !(amount > 0)) throw new Error('管理回と正の調整額は必須です');
    await conn.beginTransaction();
    const [records] = await conn.query('SELECT ar.*, p.partner_name FROM advance_records ar LEFT JOIN partners p ON p.partner_id=ar.partner_id WHERE ar.advance_record_id=? FOR UPDATE', [id]);
    if (!records.length || records[0].status !== 'executed') throw new Error('実行済みの前払だけを調整できます');
    const [reversed] = await conn.query("SELECT COALESCE(SUM(amount),0) AS total FROM cash_schedules WHERE source_type='adjustment' AND source_id=? AND direction='incoming' AND status <> 'cancelled'", [id]);
    if (amount + Number(reversed[0].total || 0) > Number(records[0].advance_amount)) throw new Error('調整額の合計は前払実行額を超えられません');
    const [cycles] = await conn.query('SELECT * FROM cash_cycles WHERE cash_cycle_id=? FOR UPDATE', [cycleId]); if (!cycles.length) throw new Error('管理回が見つかりません');
    const [result] = await conn.query(
      `INSERT INTO cash_schedules (cash_cycle_id,direction,source_type,source_id,partner_id,project_id,counterparty_name,title,amount,scheduled_date,snapshot_json,created_by)
       VALUES (?, 'incoming', 'adjustment', ?, ?, ?, ?, '前払返金・訂正', ?, ?, ?, ?)`,
      [cycleId,id,records[0].partner_id,records[0].project_id,records[0].partner_name || `パートナー #${records[0].partner_id}`,amount,cycles[0].planned_incoming_date,JSON.stringify({advance_record_id:id,kind:'advance_reversal'}),req.session.user?.user_id || null]
    );
    await conn.commit(); return res.status(201).json({ok:true,cash_schedule_id:result.insertId});
  } catch(err) { await conn.rollback(); return res.status(400).json({ok:false,message:err.message}); } finally {conn.release();}
});

router.get('/', (_req,res)=>res.status(410).json({ok:false,message:'旧先払い一覧は廃止しました。締日別3グループのAPIを使用してください'}));
router.put('/upsert', (_req,res)=>res.status(410).json({ok:false,message:'旧先払い保存は廃止しました。締日別3グループの予定作成APIを使用してください'}));

router.GROUPS = GROUPS;
router.shiftMonth = shiftMonth;
router.periodFor = periodFor;

module.exports = router;
