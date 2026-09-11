const { randomUUID } = require('node:crypto');
const { query, getPool } = require('../../db');
const { ensureCycles } = require('../../routes/cash_management');
const settlementAdapter = require('../../routes/settlements').testDataAdapter;
const { GROUPS, GROUP_ORDER, periodForCycle, shiftMonth } = require('../closing_cycles');
const model = require('./model');

const running = new Set();
const parse = value => value ? JSON.parse(value) : null;
const money = value => Math.round(Number(value || 0) * 100) / 100;

function publicSettlementJob(row) {
  if (!row) return null;
  return { id:row.settlement_job_id, monthlyJobId:row.monthly_job_id, status:row.status,
    total:Number(row.total_count), processed:Number(row.processed_count), manifest:parse(row.manifest_json),
    error:row.error_message || null, createdAt:row.created_at, startedAt:row.started_at, completedAt:row.completed_at };
}

function settlementScenario(kind, ym, asOf, key) {
  if (ym < shiftMonth(asOf.slice(0,7), -1)) return 'approved';
  const n = parseInt(model.hash(`${kind}:${ym}:${key}:settlement`).slice(0,8),16) % 100;
  return n < 45 ? 'sales_reviewed' : n < 80 ? 'draft' : 'sales_review_requested';
}

function manualAdjustment(kind, index) {
  if (index >= 6) return null;
  return kind === 'invoice'
    ? { line_type:'adjustment',source_type:'manual_adjustment',item_name:'燃料価格調整',quantity:1,unit_price:1500,amount:1500,tax_category:'taxable',reason:'検証ケース：取引先との合意による燃料価格調整',is_manually_added:true,amount_overridden:false,snapshot:{test_data:true} }
    : { line_type:'adjustment',source_type:'manual_adjustment',item_name:'立替経費精算',quantity:1,unit_price:800,amount:800,tax_category:'non_taxable',reason:'検証ケース：業務中の立替経費を手入力で精算',is_manually_added:true,amount_overridden:false,snapshot:{test_data:true} };
}

async function getJob(runQuery, id) {
  const rows=await runQuery('SELECT * FROM test_data_settlement_generation_jobs WHERE settlement_job_id=?',[id]);
  return publicSettlementJob(rows[0]);
}

async function loadPlans(runQuery, monthlyJob) {
  const base = await runQuery(`SELECT d.project_id,d.target_year_month,d.company_id,d.partner_id,
      p.billing_id,COALESCE(NULLIF(p.closing_date,''),NULLIF(c.closing_date_code,''),'end') closing_date
    FROM test_data_generated_daily_reports g
    JOIN daily_reports d ON d.daily_report_id=g.daily_report_id
    JOIN projects p ON p.project_id=d.project_id
    JOIN companies c ON c.company_id=d.company_id
    JOIN test_data_generated_monthly_approvals ga ON ga.monthly_job_id=?
    JOIN daily_report_monthly_approvals a ON a.monthly_approval_id=ga.monthly_approval_id
      AND a.project_id=d.project_id AND a.target_year_month=d.target_year_month AND a.status='approved'
    WHERE g.job_id=? AND d.is_deleted=0
    GROUP BY d.project_id,d.target_year_month,d.company_id,d.partner_id,p.billing_id,p.closing_date,c.closing_date_code
    ORDER BY d.target_year_month,d.project_id`,[monthlyJob.monthly_job_id,monthlyJob.daily_job_id]);
  const grouped = kind => {
    const map=new Map();
    for(const row of base){
      const entity=kind==='invoice'?row.company_id:row.partner_id;
      const billing=kind==='invoice'?Number(row.billing_id||0):0;
      const key=[kind,row.target_year_month,entity,row.closing_date,billing].join(':');
      if(!map.has(key))map.set(key,{type:'settlement',kind,key,ym:row.target_year_month,entityId:Number(entity),billingId:billing,closingDate:String(row.closing_date),projectIds:[]});
      map.get(key).projectIds.push(Number(row.project_id));
    }
    return [...map.values()];
  };
  return {pairs:base, settlements:[...grouped('invoice'),...grouped('payment')]};
}

async function createSettlement(conn, jobId, dailyJobId, plan, actor, asOf, index) {
  const [mapped]=await conn.query('SELECT settlement_id FROM test_data_generated_settlements WHERE settlement_job_id=? AND scenario_key=?',[jobId,plan.key]);
  if(mapped.length)return false;
  const marks=plan.projectIds.map(()=>'?').join(',');
  const [reports]=await conn.query(`SELECT d.*,bp.template_name project_name,c.company_name,pt.partner_name
    FROM test_data_generated_daily_reports g JOIN daily_reports d ON d.daily_report_id=g.daily_report_id
    JOIN projects p ON p.project_id=d.project_id LEFT JOIN base_projects bp ON bp.base_project_id=p.base_project_id
    LEFT JOIN companies c ON c.company_id=d.company_id LEFT JOIN partners pt ON pt.partner_id=d.partner_id
    WHERE g.job_id=? AND d.project_id IN (${marks}) AND d.target_year_month=? AND d.status='approved'
      AND d.is_deleted=0 AND d.${plan.kind==='invoice'?'billing_status':'payment_status'}='none' FOR UPDATE`,[dailyJobId,...plan.projectIds,plan.ym]);
  if(!reports.length)throw new Error(`${plan.key} に精算可能な承認済み日報がありません`);
  const approved=await settlementAdapter.approvedSnapshotReports(conn,reports,plan.ym);
  const lines=require('../settlement_line_builder').buildAggregatedLines(approved,plan.kind,await settlementAdapter.settlementLineConfig(conn));
  const adjustment=manualAdjustment(plan.kind,index); if(adjustment){adjustment.display_order=(lines.length+1)*10;lines.push(adjustment);}
  let id;
  if(plan.kind==='invoice'){
    const [company]=await conn.query('SELECT company_name FROM companies WHERE company_id=?',[plan.entityId]);
    const [billing]=await conn.query('SELECT billing_summary_no,billing_print_name FROM company_billings WHERE billing_id=? AND company_id=? AND is_deleted=0',[plan.billingId,plan.entityId]);
    const [result]=await conn.query(`INSERT INTO invoices
      (company_id,billing_id,billing_summary_no,billing_print_name,target_year_month,closing_date,invoice_status,settlement_status,subtotal_amount,adjustment_amount,taxable_amount,tax_amount,total_amount,extra_data)
      VALUES (?,?,?,?,?,?,'draft','draft',0,0,0,0,0,?)`,[plan.entityId,plan.billingId||null,billing[0]?.billing_summary_no||null,billing[0]?.billing_print_name||company[0]?.company_name,plan.ym,plan.closingDate,JSON.stringify({draft_source:'test_data',settlement_job_id:jobId,selected_project_ids:plan.projectIds})]);id=Number(result.insertId);
  }else{
    const [partner]=await conn.query('SELECT payment_output_code FROM partners WHERE partner_id=?',[plan.entityId]);
    const [result]=await conn.query(`INSERT INTO payments
      (partner_id,target_year_month,closing_date,payment_status,settlement_status,gross_amount,final_transfer_amount,payment_output_code,extra_data)
      VALUES (?,?,?,'draft','draft',0,0,?,?)`,[plan.entityId,plan.ym,plan.closingDate,partner[0]?.payment_output_code||null,JSON.stringify({draft_source:'test_data',settlement_job_id:jobId,selected_project_ids:plan.projectIds})]);id=Number(result.insertId);
  }
  for(const projectId of plan.projectIds)await conn.query('INSERT INTO settlement_projects (settlement_type,settlement_id,project_id) VALUES (?,?,?)',[plan.kind,id,projectId]);
  await settlementAdapter.insertLines(conn,plan.kind,id,lines,actor,'検証データ：月次承認済み日報から生成');
  const linkTable=plan.kind==='invoice'?'invoice_daily_reports':'payment_daily_reports', key=plan.kind==='invoice'?'invoice_id':'payment_id', status=plan.kind==='invoice'?'billing_status':'payment_status';
  for(const report of reports){await conn.query(`INSERT INTO ${linkTable} (${key},daily_report_id) VALUES (?,?)`,[id,report.daily_report_id]);await conn.query(`UPDATE daily_reports SET ${status}='reserved',version=version+1 WHERE daily_report_id=?`,[report.daily_report_id]);}
  const scenario=settlementScenario(plan.kind,plan.ym,asOf,plan.key);
  const approvedAt=`${plan.ym}-28 16:00:00`, reviewedAt=`${plan.ym}-27 15:00:00`;
  await conn.query(`INSERT INTO settlement_workflows
    (settlement_type,settlement_id,status,drafted_by_user_id,sales_reviewed_by_user_id,sales_reviewed_at,approved_by_user_id,approved_at)
    VALUES (?,?,?,?,?,?,?,?)`,[plan.kind,id,scenario,actor,scenario==='draft'?null:actor,scenario==='draft'?null:reviewedAt,scenario==='approved'?actor:null,scenario==='approved'?approvedAt:null]);
  await settlementAdapter.recalculateDraft(conn,plan.kind,id);
  await conn.query(`UPDATE ${plan.kind==='invoice'?'invoices':'payments'} SET settlement_status=? WHERE ${plan.kind==='invoice'?'invoice_id':'payment_id'}=?`,[scenario,id]);
  await conn.query('INSERT INTO test_data_generated_settlements (settlement_job_id,scenario_key,scenario_code,settlement_type,settlement_id) VALUES (?,?,?,?,?)',[jobId,plan.key,scenario,plan.kind,id]);
  return true;
}

async function advancePlans(runQuery, monthlyJobId) {
  const rows=await runQuery(`SELECT p.project_id,p.partner_id,p.company_id,p.closing_date,p.installment_amount,
      COALESCE(pfp.transfer_fee_pattern_id,ptfp.transfer_fee_pattern_id) transfer_fee_pattern_id,
      COALESCE(pfp.pattern_name,ptfp.pattern_name,'手数料なし') transfer_fee_pattern_name,
      COALESCE(pfp.amount,ptfp.amount,0) transfer_fee_amount,a.target_year_month
    FROM projects p
    JOIN daily_report_monthly_approvals a ON a.project_id=p.project_id AND a.status='approved'
    JOIN test_data_generated_monthly_approvals g ON g.monthly_job_id=? AND g.monthly_approval_id=a.monthly_approval_id
    LEFT JOIN transfer_fee_patterns pfp ON pfp.transfer_fee_pattern_id=p.transfer_fee_pattern_id AND pfp.is_deleted=0
    LEFT JOIN partners pt ON pt.partner_id=p.partner_id
    LEFT JOIN transfer_fee_patterns ptfp ON ptfp.transfer_fee_pattern_id=pt.transfer_fee_pattern_id AND ptfp.is_deleted=0
    WHERE p.payment_type='installment' AND p.is_deleted=0 AND p.partner_id IS NOT NULL
    ORDER BY a.target_year_month,p.partner_id,p.project_id`,[monthlyJobId]);
  const oldest=rows[0]?.target_year_month; const seen=new Set(),selected=[];
  for(const row of rows.filter(value=>value.target_year_month===oldest)){
    if(seen.has(Number(row.partner_id)))continue;
    const counts=[];
    for(const groupCode of GROUP_ORDER){const period=periodForCycle(row.target_year_month,row.closing_date,groupCode);const result=await runQuery(`SELECT COUNT(DISTINCT work_date) count FROM daily_reports WHERE project_id=? AND work_date BETWEEN ? AND ? AND status='approved' AND is_deleted=0 AND is_absent=0 AND work_hours>0`,[row.project_id,period.start,period.end]);counts.push(Number(result[0]?.count||0));}
    if(counts.some(count=>count===0))continue;
    seen.add(Number(row.partner_id)); selected.push({...row,monthly_job_id:monthlyJobId});
    if(selected.length===30)break;
  }
  if(selected.length<30)throw new Error(`3サイクルすべてに稼働がある分割対象者が不足しています（必要30名／対象${selected.length}名）`);
  return selected.flatMap(row=>GROUP_ORDER.map(groupCode=>({type:'advance',row,groupCode,key:`advance:${row.target_year_month}:${row.project_id}:${groupCode}`})));
}

async function createAdvance(conn, jobId, plan, actor, cycleMeta, index) {
  const [mapped]=await conn.query('SELECT advance_record_id FROM test_data_generated_advances WHERE settlement_job_id=? AND scenario_key=?',[jobId,plan.key]);if(mapped.length)return false;
  const {row,groupCode}=plan, period=periodForCycle(row.target_year_month,row.closing_date,groupCode), meta=cycleMeta[groupCode];
  const [days]=await conn.query(`SELECT COUNT(DISTINCT work_date) count FROM daily_reports WHERE project_id=? AND work_date BETWEEN ? AND ? AND status='approved' AND is_deleted=0 AND is_absent=0 AND work_hours>0`,[row.project_id,period.start,period.end]);
  const workDays=Number(days[0]?.count||0);
  if(!workDays)throw new Error(`${plan.key} は稼働0日のため先払記録を作成できません`);
  let unit=money(row.installment_amount);
  if(!(unit>0)){
    unit=5000+(Number(row.project_id)%5)*500;
    await conn.query(`INSERT INTO test_data_generated_project_overrides
      (monthly_job_id,project_id,field_code,original_value,generated_value) VALUES (?,?,'installment_amount',?,?)
      ON DUPLICATE KEY UPDATE generated_value=VALUES(generated_value)`,[row.monthly_job_id,row.project_id,row.installment_amount,unit]);
    await conn.query('UPDATE projects SET installment_amount=?,version=version+1,updated_at=CURRENT_TIMESTAMP WHERE project_id=?',[unit,row.project_id]);
  }
  const calculated=money(workDays*unit);
  const overridden=index%23===0&&calculated>500, amount=overridden?money(calculated-500):calculated;
  const scenario=index%17===0?'cancelled':index%13===0?'held':'executed';
  const [record]=await conn.query(`INSERT INTO advance_records
    (project_id,partner_id,company_id,target_year_month,group_code,project_advance_term_id,period_start,period_end,payment_date,work_days,calculated_amount,advance_amount,transfer_fee_amount,transfer_fee_pattern_id,transfer_fee_pattern_name,transfer_fee_base_amount,adjustment_reason,status,cash_schedule_id,created_by)
    VALUES (?,?,?,?,?,NULL,?,?,?,?,?,?,?,?,?,?,?,?,NULL,?)`,[row.project_id,row.partner_id,row.company_id,row.target_year_month,groupCode,period.start,period.end,meta.payment_date,workDays,calculated,amount,money(row.transfer_fee_amount),row.transfer_fee_pattern_id||null,row.transfer_fee_pattern_name,money(row.transfer_fee_amount),overridden?'検証ケース：勤務実績確認による500円減額':null,scenario,actor]);
  const advanceId=Number(record.insertId);
  const [schedule]=await conn.query(`INSERT INTO cash_schedules
    (cash_cycle_id,direction,source_type,source_id,company_id,partner_id,project_id,counterparty_name,title,amount,scheduled_date,status,snapshot_json,created_by)
    SELECT ?,'outgoing','advance',?,p.company_id,p.partner_id,p.project_id,pt.partner_name,?, ?, ?, ?, ?, ? FROM projects p JOIN partners pt ON pt.partner_id=p.partner_id WHERE p.project_id=?`,[meta.cash_cycle_id,advanceId,`${GROUPS[groupCode].label} 前払`,amount,meta.payment_date,scenario,JSON.stringify({test_data:true,settlement_job_id:jobId,period_start:period.start,period_end:period.end}),actor,row.project_id]);
  await conn.query('UPDATE advance_records SET cash_schedule_id=? WHERE advance_record_id=?',[schedule.insertId,advanceId]);
  if(scenario==='executed')await conn.query(`INSERT INTO cash_transactions (cash_schedule_id,executed_date,executed_amount,status,reason,bank_name,created_by) VALUES (?,?,?,'executed','検証データ：前払実行','検証用振込口座',?)`,[schedule.insertId,meta.payment_date,amount,actor]);
  await conn.query(`INSERT INTO advance_cycle_settings (target_year_month,project_id,group_code,is_target,advance_amount_override,transfer_fee_override,adjustment_reason)
    VALUES (?,?,?,1,?,?,?) ON DUPLICATE KEY UPDATE is_target=1,advance_amount_override=VALUES(advance_amount_override),transfer_fee_override=VALUES(transfer_fee_override),adjustment_reason=VALUES(adjustment_reason)`,[row.target_year_month,row.project_id,groupCode,overridden?amount:null,null,overridden?'検証ケース：勤務実績確認による500円減額':null]);
  await conn.query(`INSERT INTO advance_record_audit_logs (advance_record_id,action_code,before_data,after_data,reason,actor_user_id) VALUES (?,'create',NULL,?, '検証データとして生成',?)`,[advanceId,JSON.stringify({scenario,amount,work_days:workDays}),actor]);
  await conn.query('INSERT INTO test_data_generated_advances (settlement_job_id,scenario_key,scenario_code,advance_record_id) VALUES (?,?,?,?)',[jobId,plan.key,scenario,advanceId]);return true;
}

async function createCycleMeta(runQuery, ym) {
  const output={};
  for(const groupCode of GROUP_ORDER){const config=GROUPS[groupCode],paymentYm=shiftMonth(ym,config.paymentMonthOffset);await ensureCycles(paymentYm);const rows=await runQuery('SELECT cash_cycle_id,planned_outgoing_date FROM cash_cycles WHERE target_year_month=? AND cycle_code=?',[paymentYm,config.paymentCycle]);output[groupCode]={cash_cycle_id:Number(rows[0].cash_cycle_id),payment_date:String(rows[0].planned_outgoing_date).slice(0,10)};}
  return output;
}

function createSettlementGenerationService(deps={}) {
  const runQuery=deps.runQuery||query,pool=deps.pool||getPool(),dispatch=deps.dispatch||(fn=>setImmediate(fn));
  async function list(){return (await runQuery('SELECT * FROM test_data_settlement_generation_jobs ORDER BY created_at DESC LIMIT 50')).map(publicSettlementJob);}
  async function enqueue(monthlyJobId,actor){const rows=await runQuery("SELECT * FROM test_data_monthly_generation_jobs WHERE monthly_job_id=? AND status='completed'",[monthlyJobId]);if(!rows.length)throw Object.assign(new Error('完了した月次生成ジョブが必要です'),{status:409});let existing=await runQuery('SELECT * FROM test_data_settlement_generation_jobs WHERE monthly_job_id=?',[monthlyJobId]);let job;if(existing.length){job=publicSettlementJob(existing[0]);if(['queued','running','completed'].includes(job.status))return job;await runQuery("UPDATE test_data_settlement_generation_jobs SET status='queued',error_message=NULL WHERE settlement_job_id=?",[job.id]);job.status='queued';}else{const id=randomUUID();await runQuery("INSERT INTO test_data_settlement_generation_jobs (settlement_job_id,monthly_job_id,status,created_by) VALUES (?,?,'queued',?)",[id,monthlyJobId,actor]);job=await getJob(runQuery,id);}if(!running.has(job.id))dispatch(()=>run(job.id,rows[0],actor));return job;}
  async function run(jobId,monthlyJob,actor){if(running.has(jobId))return;running.add(jobId);try{await runQuery("UPDATE test_data_settlement_generation_jobs SET status='running',started_at=COALESCE(started_at,CURRENT_TIMESTAMP(3)) WHERE settlement_job_id=?",[jobId]);const dailyRows=await runQuery('SELECT g.*,d.payload_json FROM test_data_generation_jobs g JOIN test_data_drafts d ON d.draft_id=g.draft_id AND d.revision=g.draft_revision WHERE g.job_id=?',[monthlyJob.daily_job_id]);if(!dailyRows.length)throw new Error('日報生成元の設定版が見つかりません');const asOf=JSON.parse(dailyRows[0].payload_json).asOf;const loaded=await loadPlans(runQuery,monthlyJob);const advances=await advancePlans(runQuery,monthlyJob.monthly_job_id);const plans=[...advances,...loaded.settlements];await runQuery('UPDATE test_data_settlement_generation_jobs SET total_count=? WHERE settlement_job_id=?',[plans.length,jobId]);const cycleMeta=advances.length?await createCycleMeta(runQuery,advances[0].row.target_year_month):{};let processed=0,settlementIndex={invoice:0,payment:0};for(const plan of plans){const conn=await pool.getConnection();try{await conn.beginTransaction();if(plan.type==='advance')await createAdvance(conn,jobId,plan,actor,cycleMeta,processed);else{await createSettlement(conn,jobId,monthlyJob.daily_job_id,plan,actor,asOf,settlementIndex[plan.kind]);settlementIndex[plan.kind]+=1;}await conn.commit();}catch(error){await conn.rollback();throw error;}finally{conn.release();}processed+=1;if(processed%20===0||processed===plans.length)await runQuery('UPDATE test_data_settlement_generation_jobs SET processed_count=? WHERE settlement_job_id=?',[processed,jobId]);}
      const counts=(await runQuery(`SELECT
        (SELECT COUNT(*) FROM test_data_generated_advances WHERE settlement_job_id=?) advances,
        (SELECT COUNT(DISTINCT ar.partner_id) FROM test_data_generated_advances g JOIN advance_records ar ON ar.advance_record_id=g.advance_record_id WHERE g.settlement_job_id=?) advance_partners,
        (SELECT COUNT(*) FROM test_data_generated_settlements WHERE settlement_job_id=? AND settlement_type='invoice') invoices,
        (SELECT COUNT(*) FROM test_data_generated_settlements WHERE settlement_job_id=? AND settlement_type='payment') payments,
        (SELECT COUNT(*) FROM test_data_generated_settlements g LEFT JOIN settlement_workflows w ON w.settlement_type=CAST(g.settlement_type AS CHAR) COLLATE utf8mb4_unicode_ci AND w.settlement_id=g.settlement_id WHERE g.settlement_job_id=? AND w.settlement_workflow_id IS NULL) orphan_workflows,
        (SELECT COUNT(*) FROM settlement_lines l JOIN test_data_generated_settlements g ON l.settlement_type=CAST(g.settlement_type AS CHAR) COLLATE utf8mb4_unicode_ci AND g.settlement_id=l.settlement_id WHERE g.settlement_job_id=? AND l.is_manually_added=1) manual_lines`,[jobId,jobId,jobId,jobId,jobId,jobId]))[0];
      const manifest={version:1,asOf,approvedProjectMonths:loaded.pairs.length,advancePartners:Number(counts.advance_partners),advances:Number(counts.advances),invoices:Number(counts.invoices),payments:Number(counts.payments),manualLines:Number(counts.manual_lines),orphanWorkflows:Number(counts.orphan_workflows),advanceDeductions:'実行済み前払は支払確定時の控除候補'};if(manifest.orphanWorkflows||manifest.advancePartners!==Math.min(30,new Set(advances.map(x=>x.row.partner_id)).size))throw new Error(`精算生成後検証に失敗しました: ${JSON.stringify(manifest)}`);await runQuery("UPDATE test_data_settlement_generation_jobs SET status='completed',processed_count=total_count,manifest_json=?,completed_at=CURRENT_TIMESTAMP(3),error_message=NULL WHERE settlement_job_id=?",[JSON.stringify(manifest),jobId]);}catch(error){await runQuery('UPDATE test_data_settlement_generation_jobs SET status=\'failed\',error_message=? WHERE settlement_job_id=?',[String(error.message||error).slice(0,1000),jobId]);}finally{running.delete(jobId);}}
  return {list,get:id=>getJob(runQuery,id),enqueue,run};
}

module.exports={createSettlementGenerationService,publicSettlementJob,settlementScenario,manualAdjustment};
