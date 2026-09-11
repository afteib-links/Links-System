const { randomUUID } = require('node:crypto');
const { query, getPool } = require('../../db');
const { GROUP_ORDER, periodForCycle, baseSubmitDate, deadlineDate, overdueDays, shiftMonth, addUtcDays } = require('../closing_cycles');
const model = require('./model');

const running = new Set();
const parse = value => value ? JSON.parse(value) : null;
const ymd = value => String(value || '').slice(0,10);
function publicMonthlyJob(row) {
  if (!row) return null;
  return { id:row.monthly_job_id, dailyJobId:row.daily_job_id, status:row.status,
    total:Number(row.total_count), processed:Number(row.processed_count), manifest:parse(row.manifest_json),
    error:row.error_message || null, createdAt:row.created_at, startedAt:row.started_at, completedAt:row.completed_at };
}
function approvalScenario(projectId, ym, asOf) {
  const current = asOf.slice(0,7), previous = shiftMonth(current,-1);
  if (ym === current) return 'none';
  const n = parseInt(model.hash(`${projectId}:${ym}:approval`).slice(0,8),16) % 100;
  if (ym < previous) return n === 0 ? 'rejected' : n === 1 ? 'submitted' : 'approved';
  return n < 50 ? 'approved' : n < 78 ? 'submitted' : n < 88 ? 'rejected' : 'none';
}
function submissionState({ projectId, partnerId, ym, groupCode, closingDate, asOf, delayedPartners }) {
  const period = periodForCycle(ym, closingDate, groupCode);
  const planned = baseSubmitDate(period.end), deadline = deadlineDate(planned,1);
  if (period.end > asOf || planned > asOf) return { submitted:false, submittedDate:null, overdueDays:0, intentional:'future_cycle' };
  const previous = shiftMonth(asOf.slice(0,7),-1);
  if (ym === previous && delayedPartners.has(Number(partnerId)) && groupCode === 'late') {
    return { submitted:false, submittedDate:null, overdueDays:overdueDays({submitted:false,deadline,today:asOf}), intentional:'delayed_unsubmitted' };
  }
  const lateCandidate = addUtcDays(deadline,1 + (Number(projectId) % 3));
  const late = parseInt(model.hash(`${projectId}:${ym}:${groupCode}:submission`).slice(0,4),16) % 50 === 0 && lateCandidate <= asOf;
  const submittedDate = late ? lateCandidate : planned;
  return { submitted:true, submittedDate, overdueDays:overdueDays({submitted:true,submittedDate,deadline,today:asOf}), intentional:late ? 'submitted_late' : 'on_time' };
}
async function getJob(runQuery,id) {
  const rows = await runQuery('SELECT * FROM test_data_monthly_generation_jobs WHERE monthly_job_id=?',[id]);
  return publicMonthlyJob(rows[0]);
}
function createMonthlyGenerationService(deps={}) {
  const runQuery=deps.runQuery || query, pool=deps.pool || getPool();
  const dispatch=deps.dispatch || (fn=>setImmediate(fn));
  async function list() {
    const rows=await runQuery('SELECT * FROM test_data_monthly_generation_jobs ORDER BY created_at DESC LIMIT 50');
    return rows.map(publicMonthlyJob);
  }
  async function enqueue(dailyJobId,actorUserId) {
    const dailyRows=await runQuery("SELECT * FROM test_data_generation_jobs WHERE job_id=? AND status='completed'",[dailyJobId]);
    if(!dailyRows.length) throw Object.assign(new Error('完了した日報生成ジョブが必要です'),{status:409});
    let rows=await runQuery('SELECT * FROM test_data_monthly_generation_jobs WHERE daily_job_id=?',[dailyJobId]);
    let job;
    if(rows.length){
      job=publicMonthlyJob(rows[0]);
      if(['queued','running','completed'].includes(job.status)) return job;
      await runQuery("UPDATE test_data_monthly_generation_jobs SET status='queued',error_message=NULL WHERE monthly_job_id=?",[job.id]);
      job.status='queued'; job.error=null;
    }else{
      const id=randomUUID();
      await runQuery("INSERT INTO test_data_monthly_generation_jobs (monthly_job_id,daily_job_id,status,created_by) VALUES (?,?,'queued',?)",[id,dailyJobId,actorUserId]);
      job=await getJob(runQuery,id);
    }
    if(!running.has(job.id)) dispatch(()=>run(job.id,dailyRows[0],actorUserId));
    return job;
  }
  async function run(monthlyJobId,dailyJob,actorUserId) {
    if(running.has(monthlyJobId)) return;
    running.add(monthlyJobId);
    try{
      await runQuery("UPDATE test_data_monthly_generation_jobs SET status='running',started_at=COALESCE(started_at,CURRENT_TIMESTAMP(3)) WHERE monthly_job_id=?",[monthlyJobId]);
      const draftRows=await runQuery('SELECT payload_json FROM test_data_drafts WHERE draft_id=? AND revision=?',[dailyJob.draft_id,dailyJob.draft_revision]);
      if(!draftRows.length) throw new Error('日報生成元の設定版が見つかりません');
      const config=JSON.parse(draftRows[0].payload_json), asOf=config.asOf;
      const pairs=await runQuery(`SELECT d.project_id,d.target_year_month,p.partner_id,p.closing_date
        FROM test_data_generated_daily_reports g JOIN daily_reports d ON d.daily_report_id=g.daily_report_id
        JOIN projects p ON p.project_id=d.project_id
        WHERE g.job_id=? GROUP BY d.project_id,d.target_year_month,p.partner_id,p.closing_date
        ORDER BY d.target_year_month,d.project_id`,[dailyJob.job_id]);
      const validClosings=['5','10','15','20','25','end'];
      const existingOverrides=await runQuery("SELECT project_id FROM test_data_generated_project_overrides WHERE monthly_job_id=? AND field_code='closing_date'",[monthlyJobId]);
      const overriddenProjects=new Set(existingOverrides.map(row=>Number(row.project_id)));
      for(const pair of pairs){
        if(validClosings.includes(String(pair.closing_date)))continue;
        const generated=validClosings[(Number(pair.project_id)-1)%validClosings.length];
        if(!overriddenProjects.has(Number(pair.project_id))){
          await runQuery(`INSERT INTO test_data_generated_project_overrides
            (monthly_job_id,project_id,field_code,original_value,generated_value) VALUES (?,?,'closing_date',?,?)
            ON DUPLICATE KEY UPDATE generated_value=VALUES(generated_value)`,[monthlyJobId,pair.project_id,pair.closing_date,generated]);
          await runQuery('UPDATE projects SET closing_date=?,version=version+1,updated_at=CURRENT_TIMESTAMP WHERE project_id=?',[generated,pair.project_id]);
          overriddenProjects.add(Number(pair.project_id));
        }
        pair.closing_date=generated;
      }
      const previous=shiftMonth(asOf.slice(0,7),-1);
      const delayedPartners=new Set([...new Set(pairs.filter(row=>row.target_year_month===previous).map(row=>Number(row.partner_id)).filter(Boolean))].sort((a,b)=>a-b).slice(0,5));
      const mappedApprovalRows=await runQuery('SELECT scenario_key FROM test_data_generated_monthly_approvals WHERE monthly_job_id=?',[monthlyJobId]);
      const mappedApprovalKeys=new Set(mappedApprovalRows.map(row=>row.scenario_key));
      const existingApprovalRows=await runQuery('SELECT project_id,target_year_month FROM daily_report_monthly_approvals');
      const externalApprovalKeys=new Set(existingApprovalRows
        .map(row=>`${row.project_id}:${row.target_year_month}`)
        .filter(key=>!mappedApprovalKeys.has(key)));
      const plans=[];
      for(const pair of pairs){
        for(const groupCode of GROUP_ORDER) plans.push({type:'submission',pair,groupCode});
        const scenario=approvalScenario(pair.project_id,pair.target_year_month,asOf);
        const approvalKey=`${pair.project_id}:${pair.target_year_month}`;
        if(scenario!=='none' && !externalApprovalKeys.has(approvalKey)) plans.push({type:'approval',pair,scenario});
      }
      await runQuery('UPDATE test_data_monthly_generation_jobs SET total_count=? WHERE monthly_job_id=?',[plans.length,monthlyJobId]);
      const adminRows=await runQuery(`SELECT user_id FROM users WHERE is_deleted=0 AND is_active=1
        AND (role='admin' OR JSON_CONTAINS(COALESCE(roles,JSON_ARRAY()),JSON_QUOTE('admin'))) ORDER BY user_id LIMIT 1`);
      const actor=Number(actorUserId || adminRows[0]?.user_id); if(!actor) throw new Error('生成用の管理者が見つかりません');
      let processed=0;
      for(const plan of plans){
        const conn=await pool.getConnection();
        try{
          await conn.beginTransaction();
          if(plan.type==='submission') await createSubmission(conn,monthlyJobId,plan,asOf,delayedPartners,actor);
          else await createApproval(conn,monthlyJobId,dailyJob.job_id,plan,asOf,actor);
          await conn.commit();
        }catch(error){await conn.rollback();throw error;}finally{conn.release();}
        processed+=1;
        if(processed%25===0 || processed===plans.length) await runQuery('UPDATE test_data_monthly_generation_jobs SET processed_count=? WHERE monthly_job_id=?',[processed,monthlyJobId]);
      }
      const [counts]=await runQuery(`SELECT
        (SELECT COUNT(*) FROM test_data_generated_submissions WHERE monthly_job_id=?) submissions,
        (SELECT COUNT(*) FROM test_data_generated_monthly_approvals WHERE monthly_job_id=?) approvals,
        (SELECT COUNT(*) FROM test_data_generated_monthly_approvals g LEFT JOIN daily_report_monthly_approvals a ON a.monthly_approval_id=g.monthly_approval_id WHERE g.monthly_job_id=? AND a.monthly_approval_id IS NULL) orphan_approvals,
        (SELECT COUNT(*) FROM test_data_generated_monthly_approvals g JOIN daily_report_monthly_approvals a ON a.monthly_approval_id=g.monthly_approval_id WHERE g.monthly_job_id=? AND a.target_year_month=?) current_month_approvals,
        (SELECT COUNT(*) FROM test_data_generated_submissions g JOIN daily_report_submissions s ON s.daily_report_submission_id=g.daily_report_submission_id WHERE g.monthly_job_id=? AND s.submitted_date>?) future_submissions`,[monthlyJobId,monthlyJobId,monthlyJobId,monthlyJobId,asOf.slice(0,7),monthlyJobId,asOf]);
      const states=await runQuery(`SELECT scenario_code,COUNT(*) count FROM test_data_generated_monthly_approvals WHERE monthly_job_id=? GROUP BY scenario_code`,[monthlyJobId]);
      const lateRows=await runQuery(`SELECT COUNT(DISTINCT d.partner_id) count FROM test_data_generated_submissions g
        JOIN daily_report_submissions s ON s.daily_report_submission_id=g.daily_report_submission_id
        JOIN projects d ON d.project_id=s.project_id WHERE g.monthly_job_id=? AND s.target_year_month=? AND s.is_submitted=0 AND s.group_code='late'`,[monthlyJobId,previous]);
      const expectedApprovals=plans.filter(plan=>plan.type==='approval').length;
      const validation={submissions:Number(counts.submissions),approvals:Number(counts.approvals),expectedApprovals,orphanApprovals:Number(counts.orphan_approvals),currentMonthApprovals:Number(counts.current_month_approvals),futureSubmissions:Number(counts.future_submissions),delayedPartners:Number(lateRows[0]?.count||0)};
      if(validation.submissions!==pairs.length*3 || validation.approvals!==expectedApprovals || validation.orphanApprovals || validation.currentMonthApprovals || validation.futureSubmissions || (delayedPartners.size && validation.delayedPartners!==delayedPartners.size)) throw new Error(`月次生成後検証に失敗しました: ${JSON.stringify(validation)}`);
      const manifest={version:1,asOf,pairCount:pairs.length,overriddenClosings:overriddenProjects.size,
        preservedExistingApprovals:[...externalApprovalKeys].filter(key=>pairs.some(pair=>`${pair.project_id}:${pair.target_year_month}`===key)).sort(),
        states:Object.fromEntries(states.map(row=>[row.scenario_code,Number(row.count)])),validation};
      await runQuery("UPDATE test_data_monthly_generation_jobs SET status='completed',processed_count=total_count,manifest_json=?,completed_at=CURRENT_TIMESTAMP(3),error_message=NULL WHERE monthly_job_id=?",[JSON.stringify(manifest),monthlyJobId]);
    }catch(error){await runQuery("UPDATE test_data_monthly_generation_jobs SET status='failed',error_message=? WHERE monthly_job_id=?",[String(error.message||error).slice(0,1000),monthlyJobId]);}
    finally{running.delete(monthlyJobId);}
  }
  return {list,get:id=>getJob(runQuery,id),enqueue,run};
}

async function createSubmission(conn,monthlyJobId,plan,asOf,delayedPartners,actor){
  const {pair,groupCode}=plan, key=`${pair.project_id}:${pair.target_year_month}:${groupCode}`;
  const [mapped]=await conn.query('SELECT daily_report_submission_id FROM test_data_generated_submissions WHERE monthly_job_id=? AND scenario_key=?',[monthlyJobId,key]);
  if(mapped.length)return;
  const state=submissionState({projectId:pair.project_id,partnerId:pair.partner_id,ym:pair.target_year_month,groupCode,closingDate:pair.closing_date,asOf,delayedPartners});
  const [existing]=await conn.query('SELECT daily_report_submission_id FROM daily_report_submissions WHERE target_year_month=? AND project_id=? AND group_code=?',[pair.target_year_month,pair.project_id,groupCode]);
  if(existing.length)throw new Error(`既存の日報提出データがあるため生成できません: ${key}`);
  const [created]=await conn.query(`INSERT INTO daily_report_submissions
    (target_year_month,project_id,group_code,is_submitted,submitted_date,overdue_days,updated_by)
    VALUES (?,?,?,?,?,?,?)`,[pair.target_year_month,pair.project_id,groupCode,state.submitted?1:0,state.submittedDate,state.overdueDays,actor]);
  await conn.query('INSERT INTO test_data_generated_submissions (monthly_job_id,scenario_key,scenario_code,daily_report_submission_id) VALUES (?,?,?,?)',[monthlyJobId,key,state.intentional,created.insertId]);
}

async function createApproval(conn,monthlyJobId,dailyJobId,plan,asOf,actor){
  const {pair,scenario}=plan, key=`${pair.project_id}:${pair.target_year_month}`;
  const [mapped]=await conn.query('SELECT monthly_approval_id FROM test_data_generated_monthly_approvals WHERE monthly_job_id=? AND scenario_key=?',[monthlyJobId,key]);
  if(mapped.length)return;
  const [existing]=await conn.query('SELECT monthly_approval_id FROM daily_report_monthly_approvals WHERE project_id=? AND target_year_month=? LIMIT 1',[pair.project_id,pair.target_year_month]);
  if(existing.length)throw new Error(`既存の月次承認データがあるため生成できません: ${key}`);
  const [reports]=await conn.query(`SELECT d.* FROM test_data_generated_daily_reports g
    JOIN daily_reports d ON d.daily_report_id=g.daily_report_id
    WHERE g.job_id=? AND d.project_id=? AND d.target_year_month=?
    ORDER BY d.work_date,d.daily_report_id`,[dailyJobId,pair.project_id,pair.target_year_month]);
  if(!reports.length)throw new Error(`月次承認対象の日報がありません: ${key}`);
  const [distanceRows]=await conn.query(`SELECT side_code,calculation_version,result_data,calculated_at
    FROM daily_report_distance_monthly_results WHERE project_id=? AND target_year_month=?`,[pair.project_id,pair.target_year_month]);
  const monthlyDistanceResults=Object.fromEntries(distanceRows.map(row=>[row.side_code,{calculation_version:row.calculation_version,calculated_at:row.calculated_at,result:typeof row.result_data==='string'?JSON.parse(row.result_data):row.result_data}]));
  const nextMonth=shiftMonth(pair.target_year_month,1);
  const submittedDate=`${nextMonth}-02`, decidedDate=`${nextMonth}-04`;
  if(submittedDate>asOf || (scenario!=='submitted' && decidedDate>asOf))throw new Error(`基準日後の月次処理は生成できません: ${key}`);
  const unchecked=[...new Set(reports.filter(row=>!['confirmed','approved'].includes(row.status)).map(row=>ymd(row.work_date)))];
  const snapshot={project_id:Number(pair.project_id),target_year_month:pair.target_year_month,
    submitted_at:`${submittedDate}T09:00:00.000Z`,unchecked_dates:unchecked,monthly_distance_results:monthlyDistanceResults,reports};
  const [versions]=await conn.query('SELECT COALESCE(MAX(approval_version),0) version FROM daily_report_monthly_approvals WHERE project_id=? AND target_year_month=? FOR UPDATE',[pair.project_id,pair.target_year_month]);
  const status=scenario==='approved'?'approved':scenario==='rejected'?'rejected':'submitted';
  const [reviewerRows]=await conn.query(`SELECT u.user_id FROM project_settlement_reviewers r JOIN users u ON u.user_id=r.user_id
    WHERE r.project_id=? AND u.is_deleted=0 AND u.is_active=1 ORDER BY u.user_id LIMIT 1`,[pair.project_id]);
  const reviewer=Number(reviewerRows[0]?.user_id || actor), assignmentSource=reviewerRows.length?'project':'admin_fallback';
  const decided=status==='submitted'?null:reviewer;
  if(status==='approved'){snapshot.approved_at=`${decidedDate}T10:00:00.000Z`;delete snapshot.submitted_at;delete snapshot.unchecked_dates;}
  const note=status==='rejected'?'検証ケース：勤務内容の確認が必要なため差戻し':status==='submitted'?'検証ケース：営業確認待ち':null;
  const [approval]=await conn.query(`INSERT INTO daily_report_monthly_approvals
    (project_id,target_year_month,approval_version,status,snapshot_data,note,submitted_by_user_id,submitted_at,decided_by_user_id,decided_at)
    VALUES (?,?,?,?,?,?,?,?,?,?)`,[pair.project_id,pair.target_year_month,Number(versions[0].version)+1,status,JSON.stringify(snapshot),note,actor,`${submittedDate} 09:00:00`,decided,status==='submitted'?null:`${decidedDate} 10:00:00`]);
  const [workflowVersions]=await conn.query('SELECT COALESCE(MAX(revision_no),0) revision FROM monthly_closing_workflows WHERE project_id=? AND target_year_month=? FOR UPDATE',[pair.project_id,pair.target_year_month]);
  const workflowStatus=status==='approved'?'approved':status==='rejected'?'returned':'sales_review_requested';
  const [workflow]=await conn.query(`INSERT INTO monthly_closing_workflows
    (project_id,target_year_month,revision_no,status,monthly_approval_id,office_confirmed_by_user_id,office_confirmed_at,requested_by_user_id,requested_at,returned_by_user_id,returned_at,return_reason)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,[pair.project_id,pair.target_year_month,Number(workflowVersions[0].revision)+1,workflowStatus,approval.insertId,actor,`${submittedDate} 08:30:00`,actor,`${submittedDate} 09:00:00`,status==='rejected'?reviewer:null,status==='rejected'?`${decidedDate} 10:00:00`:null,status==='rejected'?note:null]);
  await conn.query(`INSERT INTO monthly_closing_reviewers
    (monthly_closing_workflow_id,reviewer_user_id,assignment_source,status,decision_note,decided_at)
    VALUES (?,?,?,?,?,?)`,[workflow.insertId,reviewer,assignmentSource,status==='approved'?'approved':status==='rejected'?'returned':'pending',note,status==='submitted'?null:`${decidedDate} 10:00:00`]);
  if(status==='approved')await conn.query(`UPDATE daily_reports d JOIN test_data_generated_daily_reports g ON g.daily_report_id=d.daily_report_id
    SET d.status='approved',d.version=d.version+1,d.updated_at=? WHERE g.job_id=? AND d.project_id=? AND d.target_year_month=? AND d.status='confirmed'`,[`${decidedDate} 10:00:00`,dailyJobId,pair.project_id,pair.target_year_month]);
  await conn.query(`INSERT INTO test_data_generated_monthly_approvals
    (monthly_job_id,scenario_key,scenario_code,monthly_approval_id,monthly_closing_workflow_id)
    VALUES (?,?,?,?,?)`,[monthlyJobId,key,scenario,approval.insertId,workflow.insertId]);
}

module.exports={createMonthlyGenerationService,publicMonthlyJob,approvalScenario,submissionState};
