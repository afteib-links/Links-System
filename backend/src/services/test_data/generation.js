const { randomUUID } = require('node:crypto');
const { query, getPool } = require('../../db');
const model = require('./model');
const { loadRegisteredBindings } = require('./registered_masters');
const { applyDailyPriceCalc } = require('../price_calc');

const running = new Set();
const REPORT_FIELDS = ['project_id','company_id','partner_id','target_year_month','work_date','start_time','end_time','break_time','break_minutes','is_absent','is_training','total_distance','input_source_type','memo','extra_data','applied_price_set_id','selected_fee_item_id','selected_fee_item_name','fee_item_selection_source','binding_hours','work_hours','overtime_hours','shortage_hours','shortage_minutes_billing','shortage_minutes_payment','shortage_amount_billing','shortage_amount_payment','distance_amount_billing','distance_amount_payment','distance_calculation_mode','night_hours','night_minutes_billing','night_minutes_payment','night_overtime_minutes_billing','night_overtime_minutes_payment','regular_overtime_minutes_billing','regular_overtime_minutes_payment','calculated_billing_amount','calculated_payment_amount','calculation_detail','status'];
const json = value => value ? JSON.parse(value) : null;
function publicJob(row) {
  if (!row) return null;
  return { id:row.job_id, draftId:row.draft_id, revision:Number(row.draft_revision), status:row.status,
    total:Number(row.total_count), processed:Number(row.processed_count), manifest:json(row.manifest_json),
    error:row.error_message || null, createdAt:row.created_at, startedAt:row.started_at, completedAt:row.completed_at };
}
function scenarioKey(row) { return `${row.projectCode}:${row.workDate}`; }
function applyLifecycle(row, binding) {
  if ((binding.availableStart && row.workDate < binding.availableStart) || (binding.availableEnd && row.workDate > binding.availableEnd)) {
    return { ...row, scenario:'unnecessary', startTime:null, endTime:null, breakMinutes:0, distanceKm:0, isTraining:false };
  }
  return row;
}
function shouldConfirm(row) {
  if (row.monthlyTarget === '完了予定') return true;
  if (row.monthlyTarget !== '処理中') return false;
  return parseInt(model.hash(scenarioKey(row)).slice(0, 2), 16) % 4 !== 0;
}
function buildInput(row, binding, jobId) {
  const inactive = ['absent','unnecessary'].includes(row.scenario);
  return {
    project_id:binding.projectId, company_id:binding.companyId, partner_id:binding.partnerId,
    target_year_month:row.workDate.slice(0, 7), work_date:row.workDate,
    start_time:inactive ? null : row.startTime, end_time:inactive ? null : row.endTime,
    break_minutes:inactive ? 0 : row.breakMinutes, break_time:inactive ? 0 : row.breakMinutes / 60,
    is_absent:inactive ? 1 : 0, is_training:row.isTraining ? 1 : 0,
    total_distance:inactive ? 0 : row.distanceKm, input_source_type:'test_data',
    memo:row.scenario === 'unnecessary' ? '勤務不要' : row.scenario === 'absent' ? '欠勤' : null,
    extra_data:JSON.stringify({ test_data:{ job_id:jobId, scenario:row.scenario, simulated_work_date:row.workDate } }),
  };
}
async function getJob(runQuery, id) {
  const rows = await runQuery('SELECT * FROM test_data_generation_jobs WHERE job_id = ?', [id]);
  return publicJob(rows[0]);
}
function createGenerationService(deps = {}) {
  const runQuery = deps.runQuery || query, pool = deps.pool || getPool(), calculate = deps.calculate || applyDailyPriceCalc;
  const dispatch = deps.dispatch || (fn => setImmediate(fn));
  async function list() {
    const rows = await runQuery('SELECT * FROM test_data_generation_jobs ORDER BY created_at DESC LIMIT 50');
    return rows.map(publicJob);
  }
  async function enqueue(draft, actorUserId) {
    const existing = await runQuery('SELECT * FROM test_data_generation_jobs WHERE draft_id = ? AND draft_revision = ? LIMIT 1', [draft.id, draft.revision]);
    let job;
    if (existing.length) {
      job = publicJob(existing[0]);
      const validCompleted = job.status === 'completed' && job.manifest?.validation?.zeroActiveAmounts === 0;
      if (validCompleted || job.status === 'queued' || job.status === 'running') return job;
      await runQuery("UPDATE test_data_generation_jobs SET status='queued',processed_count=0,error_message=NULL,completed_at=NULL WHERE job_id=?", [job.id]);
      job.status = 'queued'; job.error = null;
    } else {
      const id = randomUUID();
      await runQuery(`INSERT INTO test_data_generation_jobs
        (job_id,draft_id,draft_revision,approved_hash,status,created_by) VALUES (?,?,?,?, 'queued',?)`,
        [id,draft.id,draft.revision,draft.approvedHash,actorUserId]);
      job = await getJob(runQuery, id);
    }
    if (!running.has(job.id)) dispatch(() => run(job.id, draft, actorUserId));
    return job;
  }
  async function run(jobId, draft, actorUserId) {
    if (running.has(jobId)) return;
    running.add(jobId);
    try {
      await runQuery("UPDATE test_data_generation_jobs SET status='running',started_at=COALESCE(started_at,CURRENT_TIMESTAMP(3)) WHERE job_id=?", [jobId]);
      const preview = model.preview(draft.config), bindings = await loadRegisteredBindings(runQuery, draft.config);
      await runQuery('UPDATE test_data_generation_jobs SET total_count=? WHERE job_id=?', [preview.reports.length, jobId]);
      const doneRows = await runQuery('SELECT scenario_key,daily_report_id FROM test_data_generated_daily_reports WHERE job_id=?', [jobId]);
      const done = new Map(doneRows.map(row => [row.scenario_key, Number(row.daily_report_id)]));
      let processed = 0, lifecycleAdjusted = 0;
      for (let offset = 0; offset < preview.reports.length; offset += 100) {
        const conn = await pool.getConnection();
        try {
          await conn.beginTransaction();
          for (const originalSample of preview.reports.slice(offset, offset + 100)) {
            const key = scenarioKey(originalSample);
            const binding = bindings.get(originalSample.projectCode); if (!binding) throw new Error(`${originalSample.projectCode}の案件参照がありません`);
            const sample = applyLifecycle(originalSample, binding);
            if (sample !== originalSample) lifecycleAdjusted += 1;
            const input = buildInput(sample, binding, jobId), calculated = await calculate(input);
            const status = shouldConfirm(sample) ? 'confirmed' : 'draft';
            const data = { ...input, ...calculated, status };
            const record = Object.fromEntries(REPORT_FIELDS.filter(k => Object.hasOwn(data,k) && data[k] !== undefined).map(k => [k,data[k]]));
            const cols = Object.keys(record);
            let reportId = done.get(key);
            if (reportId) {
              await conn.query(`UPDATE daily_reports SET ${cols.map(k => `${k}=?`).join(',')},version=version+1,updated_at=CURRENT_TIMESTAMP WHERE daily_report_id=?`, [...cols.map(k => record[k]),reportId]);
            } else {
              const [result] = await conn.query(`INSERT INTO daily_reports (${cols.join(',')}) VALUES (${cols.map(() => '?').join(',')})`, cols.map(k => record[k]));
              reportId = Number(result.insertId);
              await conn.query('INSERT INTO test_data_generated_daily_reports (job_id,scenario_key,scenario_code,daily_report_id) VALUES (?,?,?,?)', [jobId,key,sample.scenario,reportId]);
              await conn.query(`INSERT INTO daily_report_audit_logs (daily_report_id,action_code,after_data,reason,actor_user_id) VALUES (?,'test_data_generate',?,?,?)`, [reportId,JSON.stringify({job_id:jobId,scenario:sample.scenario,status}),'承認済み検証データ設定から生成',actorUserId]);
            }
            if (done.has(key)) await conn.query('UPDATE test_data_generated_daily_reports SET scenario_code=? WHERE job_id=? AND scenario_key=?', [sample.scenario,jobId,key]);
            if (status === 'confirmed') await conn.query(`INSERT INTO daily_report_confirmation_snapshots (daily_report_id,confirmation_version,snapshot_data,confirmed_by_user_id) VALUES (?,1,?,?) ON DUPLICATE KEY UPDATE snapshot_data=VALUES(snapshot_data),confirmed_by_user_id=VALUES(confirmed_by_user_id)`, [reportId,JSON.stringify({...record,daily_report_id:reportId,confirmation_version:1}),actorUserId]);
            processed += 1;
          }
          await conn.commit();
        } catch (error) { await conn.rollback(); throw error; } finally { conn.release(); }
        await runQuery('UPDATE test_data_generation_jobs SET processed_count=? WHERE job_id=?', [processed,jobId]);
      }
      const [counts] = await runQuery(`SELECT COUNT(*) total,
        SUM(d.work_date > ?) future_count,
        SUM(d.calculated_billing_amount IS NULL OR d.calculated_payment_amount IS NULL) missing_amounts,
        SUM(d.is_absent=0 AND (d.calculated_billing_amount <= 0 OR d.calculated_payment_amount <= 0)) zero_active_amounts
        FROM test_data_generated_daily_reports g JOIN daily_reports d ON d.daily_report_id=g.daily_report_id WHERE g.job_id=?`, [draft.config.asOf,jobId]);
      const overlaps = await runQuery(`SELECT d.partner_id,d.work_date,COUNT(*) count FROM test_data_generated_daily_reports g
        JOIN daily_reports d ON d.daily_report_id=g.daily_report_id WHERE g.job_id=? AND d.is_absent=0
        GROUP BY d.partner_id,d.work_date HAVING COUNT(*)>1 LIMIT 1`, [jobId]);
      const validation = { expected:preview.reports.length, actual:Number(counts?.total || 0), future:Number(counts?.future_count || 0),
        missingAmounts:Number(counts?.missing_amounts || 0), zeroActiveAmounts:Number(counts?.zero_active_amounts || 0), overlappingWork:overlaps.length };
      if (validation.actual !== validation.expected || validation.future || validation.missingAmounts || validation.zeroActiveAmounts || validation.overlappingWork) throw new Error(`生成後検証に失敗しました: ${JSON.stringify(validation)}`);
      const manifest = { version:1, draftId:draft.id, revision:draft.revision, approvedHash:draft.approvedHash,
        asOf:draft.config.asOf, seedHash:model.hash(draft.config.seed), counts:preview.achieved, lifecycleAdjusted, validation };
      await runQuery("UPDATE test_data_generation_jobs SET status='completed',processed_count=total_count,manifest_json=?,completed_at=CURRENT_TIMESTAMP(3),error_message=NULL WHERE job_id=?", [JSON.stringify(manifest),jobId]);
    } catch (error) {
      await runQuery("UPDATE test_data_generation_jobs SET status='failed',error_message=? WHERE job_id=?", [String(error.message || error).slice(0,1000),jobId]);
    } finally { running.delete(jobId); }
  }
  return { list, get:id => getJob(runQuery,id), enqueue, run };
}

module.exports = { createGenerationService, buildInput, shouldConfirm, scenarioKey, applyLifecycle, publicJob };
