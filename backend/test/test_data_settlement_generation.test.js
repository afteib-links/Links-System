const test=require('node:test');
const assert=require('node:assert/strict');
const {settlementScenario,manualAdjustment,publicSettlementJob}=require('../src/services/test_data/settlement_generation');

test('完了月は承認済み、前月は再現可能な処理中状態になる',()=>{
  assert.equal(settlementScenario('invoice','2026-07','2026-09-12','x'),'approved');
  const current=settlementScenario('payment','2026-08','2026-09-12','x');
  assert.equal(settlementScenario('payment','2026-08','2026-09-12','x'),current);
  assert.ok(['draft','sales_reviewed','sales_review_requested'].includes(current));
});

test('請求と支払の手入力調整は理由と税区分を保持する',()=>{
  assert.equal(manualAdjustment('invoice',0).tax_category,'taxable');
  assert.equal(manualAdjustment('payment',0).tax_category,'non_taxable');
  assert.match(manualAdjustment('invoice',0).reason,/検証ケース/);
  assert.equal(manualAdjustment('invoice',6),null);
});

test('精算ジョブ公開値は接続情報を含まない',()=>{
  const job=publicSettlementJob({settlement_job_id:'s',monthly_job_id:'m',status:'running',total_count:8,processed_count:3,manifest_json:null});
  assert.deepEqual({id:job.id,monthlyJobId:job.monthlyJobId,total:job.total,processed:job.processed},{id:'s',monthlyJobId:'m',total:8,processed:3});
});
