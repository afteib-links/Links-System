const test = require('node:test');
const assert = require('node:assert/strict');
const { buildInput, shouldConfirm, scenarioKey, applyLifecycle, publicJob } = require('../src/services/test_data/generation');
const { cleanValue } = require('../src/services/master_data_import');

test('legacy base price type is normalized to the pricing-engine basic code', () => {
  assert.equal(cleanValue('price_type_code','base'),'basic');
  assert.equal(cleanValue('price_type_code','basic'),'basic');
});

test('daily sample becomes a verification daily report input', () => {
  const sample = {projectCode:'J00001',workDate:'2026-07-10',scenario:'overtime',startTime:'08:00',endTime:'19:00',breakMinutes:60,distanceKm:85,isTraining:false,monthlyTarget:'完了予定'};
  const input = buildInput(sample,{projectId:41,companyId:11,partnerId:21},'job-1');
  assert.equal(scenarioKey(sample),'J00001:2026-07-10');
  assert.equal(input.input_source_type,'test_data'); assert.equal(input.total_distance,85); assert.equal(input.is_absent,0);
  assert.equal(shouldConfirm(sample),true);
});

test('absence and unnecessary days are zero-time rows that remain distinguishable', () => {
  const base = {projectCode:'J00001',workDate:'2026-09-10',startTime:null,endTime:null,breakMinutes:0,distanceKm:0,isTraining:false,monthlyTarget:'入力中'};
  const absent = buildInput({...base,scenario:'absent'},{projectId:1,companyId:2,partnerId:3},'job-1');
  const unnecessary = buildInput({...base,scenario:'unnecessary'},{projectId:1,companyId:2,partnerId:3},'job-1');
  assert.equal(absent.is_absent,1); assert.equal(absent.memo,'欠勤');
  assert.equal(unnecessary.is_absent,1); assert.equal(unnecessary.memo,'勤務不要');
  assert.equal(shouldConfirm({...base,scenario:'normal'}),false);
});

test('work outside the combined contract lifecycle becomes unnecessary', () => {
  const sample = {projectCode:'J00001',workDate:'2026-07-10',scenario:'normal',startTime:'08:00',endTime:'17:00',breakMinutes:60,distanceKm:20,isTraining:false};
  const adjusted = applyLifecycle(sample,{availableStart:'2026-07-11',availableEnd:null});
  assert.equal(adjusted.scenario,'unnecessary'); assert.equal(adjusted.startTime,null); assert.equal(adjusted.distanceKm,0);
  assert.equal(applyLifecycle(sample,{availableStart:'2026-07-01',availableEnd:'2026-07-31'}),sample);
});

test('job response does not expose internal configuration or source values', () => {
  const job = publicJob({job_id:'j',draft_id:'d',draft_revision:4,status:'running',total_count:10,processed_count:3,manifest_json:null,error_message:null});
  assert.deepEqual(Object.keys(job),['id','draftId','revision','status','total','processed','manifest','error','createdAt','startedAt','completedAt']);
});

test('completed jobs generated before monetary validation are eligible for recalculation', async () => {
  const updates = []; let dispatched = false;
  const service = require('../src/services/test_data/generation').createGenerationService({
    runQuery: async (sql) => {
      if (sql.startsWith('SELECT * FROM test_data_generation_jobs WHERE draft_id')) return [{job_id:'j',draft_id:'d',draft_revision:4,status:'completed',total_count:1,processed_count:1,manifest_json:JSON.stringify({validation:{missingAmounts:0}})}];
      if (sql.startsWith('UPDATE test_data_generation_jobs')) updates.push(sql);
      return [];
    },
    pool:{}, dispatch:() => { dispatched = true; },
  });
  const job = await service.enqueue({id:'d',revision:4,approvedHash:'h'},1);
  assert.equal(job.status,'queued'); assert.equal(dispatched,true); assert.equal(updates.length,1);
});
