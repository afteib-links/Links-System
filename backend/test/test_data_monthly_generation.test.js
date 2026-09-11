const test=require('node:test');
const assert=require('node:assert/strict');
const {approvalScenario,submissionState,publicMonthlyJob}=require('../src/services/test_data/monthly_generation');

test('current month is never monthly-approved and past scenarios are deterministic',()=>{
  assert.equal(approvalScenario(1,'2026-09','2026-09-12'),'none');
  const result=approvalScenario(42,'2026-08','2026-09-12');
  assert.equal(approvalScenario(42,'2026-08','2026-09-12'),result);
  assert.ok(['approved','submitted','rejected','none'].includes(result));
});

test('selected previous-month partners can remain overdue',()=>{
  const state=submissionState({projectId:1,partnerId:7,ym:'2026-08',groupCode:'late',closingDate:'end',asOf:'2026-09-12',delayedPartners:new Set([7])});
  assert.equal(state.submitted,false); assert.equal(state.intentional,'delayed_unsubmitted'); assert.ok(state.overdueDays>0);
});

test('future submission cycles stay unsubmitted without future dates',()=>{
  const state=submissionState({projectId:1,partnerId:7,ym:'2026-09',groupCode:'middle',closingDate:'end',asOf:'2026-09-12',delayedPartners:new Set()});
  assert.equal(state.submitted,false); assert.equal(state.submittedDate,null); assert.equal(state.intentional,'future_cycle');
});

test('monthly job response exposes progress and manifest only',()=>{
  const job=publicMonthlyJob({monthly_job_id:'m',daily_job_id:'d',status:'running',total_count:10,processed_count:4,manifest_json:null});
  assert.equal(job.id,'m');assert.equal(job.dailyJobId,'d');assert.equal(job.processed,4);
});
