const test=require('node:test');const assert=require('node:assert/strict');
const {annualTotals,tailDaily,assertItemEditable}=require('../src/services/annual_closing');
test('11月年度末調整を年額だけに適用する',()=>{
  assert.equal(annualTotals({billing:12000000,payment:8000000},{billing:300000,payment:200000},{billing:200000,payment:100000}).billing,12100000);
  assert.equal(annualTotals({billing:12000000,payment:8000000},{billing:300000,payment:200000},{billing:200000,payment:100000},true).billing,12300000);
  assert.equal(annualTotals({billing:0,payment:0},{billing:0,payment:0},{billing:0,payment:0}).profit_rate,null);
});
test('月額固定分を11月尾部の日別自動計上から外す',()=>{
  const report={calculated_billing_amount:10100,calculation_detail:{billing:{amounts:{details:{basic:{calc_type:'monthly',amount:10000},overtime:{calc_type:'hourly',amount:100}}}}}};
  assert.equal(tailDaily(report,'billing'),100);assert.equal(tailDaily({...report,override_billing_amount:20000},'billing'),0);
});
test('年度保存した燃料日額は保護し、12月の実績追加は許可する',async()=>{
  const conn={query:async sql=>[sql.includes('annual_closing_locks')?[{period_start:'2025-11-21',period_end:'2026-11-30'}]:sql.includes('FROM projects')?[{project_id:1,closing_day:'20'}]:[]]};
  const before={project_id:1,target_year_month:'2026-12',calculation_method:'fuel',applies_to:'both',calculation_data:{fuel:{days:[{work_date:'2026-11-25',daily_amount:496}]}}};
  await assertItemEditable(conn,before,{...before,calculation_data:{fuel:{days:[...before.calculation_data.fuel.days,{work_date:'2026-12-01',daily_amount:496}]}}});
  await assert.rejects(assertItemEditable(conn,before,{...before,calculation_data:{fuel:{days:[{work_date:'2026-11-25',daily_amount:500}]}}}));
  await assert.rejects(assertItemEditable(conn,before,null));
  await assert.rejects(assertItemEditable(conn,before,{...before,calculation_method:'direct',calculation_data:{}}));
  await assert.rejects(assertItemEditable(conn,null,{...before,target_year_month:'2026-10',calculation_method:'direct'}));
});
