const test=require('node:test');
const assert=require('node:assert/strict');
const {publicOutputJob,shiftMonth,shouldExecute,PROFILE_DEFINITIONS}=require('../src/services/test_data/output_generation');

test('帳票・入出金ジョブ公開値は進捗と検証結果だけを返す',()=>{
  const job=publicOutputJob({output_job_id:'o',settlement_job_id:'s',status:'running',total_count:9,processed_count:3,manifest_json:'{"documents":2}',error_message:null});
  assert.deepEqual({id:job.id,settlementJobId:job.settlementJobId,total:job.total,processed:job.processed,documents:job.manifest.documents},{id:'o',settlementJobId:'s',total:9,processed:3,documents:2});
  assert.equal(Object.hasOwn(job,'connection'),false);
});

test('入出金月と完了月の判定は基準日から再現できる',()=>{
  assert.equal(shiftMonth('2026-12',1),'2027-01');
  assert.equal(shiftMonth('2026-01',-1),'2025-12');
  assert.equal(shouldExecute('2026-07',1,'2026-09-07'),true);
  assert.equal(shouldExecute('2026-08',1,'2026-09-07'),false);
  assert.equal(shouldExecute('2026-07',23,'2026-09-07'),false);
});

test('公開するCSV定義は検証専用だけで実銀行名を名乗らない',()=>{
  assert.equal(PROFILE_DEFINITIONS.length,3);
  for(const profile of PROFILE_DEFINITIONS){
    assert.match(profile.code,/^verification_/);
    assert.match(profile.name,/検証専用/);
    assert.match(profile.bank,/検証/);
  }
});
