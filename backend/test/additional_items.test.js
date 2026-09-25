const test=require('node:test');const assert=require('node:assert/strict');
const {fuelDaily,calculateFuel,resolveConditions,attachItems,validateAttendance}=require('../src/services/additional_items');
const {buildAggregatedLines}=require('../src/services/settlement_line_builder');
const conditions=[{fuel_condition_id:1,scope_type:'global',scope_id:0,valid_from:'2026-01-01',efficiency:10,prefecture_code:'13'},{fuel_condition_id:2,scope_type:'partner',scope_id:2,valid_from:'2026-01-01',efficiency:12,roundtrip_km:30},{fuel_condition_id:3,scope_type:'project',scope_id:1,valid_from:'2026-01-01',roundtrip_km:35}];
test('燃料は日額切上げを十進数で実行し、同一案件同日を重複計上しない',()=>{
  assert.equal(fuelDaily(35,12,170),496);assert.equal(fuelDaily('0.3','0.1','1'),3);
  const reports=Array.from({length:20},(_,i)=>({work_date:`2026-09-${String(i+1).padStart(2,'0')}`,start_time:'08:00'}));
  const result=calculateFuel({reports:[...reports,reports[0],{work_date:'2026-09-21',is_absent:1,start_time:'08:00'}],conditions,project:{project_id:1,partner_id:2},prices:[{fuel_price_id:1,price_date:'2026-09-01',prefecture_code:'13',regular_price:170}],reference_date:'2026-09-01'});
  assert.equal(result.attendance_days,20);assert.equal(result.amount,9920);assert.deepEqual(result.missing,[]);
});
test('期間途中の適用変更、研修、過去価格の明示採用を扱う',()=>{
  const changed=[...conditions,{...conditions[2],fuel_condition_id:4,valid_from:'2026-09-02',roundtrip_km:70}];
  assert.equal(resolveConditions(changed,1,2,'2026-09-02').roundtrip_km.value,70);
  const input={reports:[{work_date:'2026-09-01',is_training:1},{work_date:'2026-09-02',start_time:'08:00'}],conditions:changed,project:{project_id:1,partner_id:2},prices:[{fuel_price_id:1,price_date:'2026-09-01',prefecture_code:'13',regular_price:170}],reference_date:'2026-09-05'};
  assert.equal(calculateFuel(input).missing.length,2);
  assert.throws(()=>calculateFuel({...input,price_choices:{'13':{fuel_price_id:1}}}));
  assert.equal(calculateFuel({...input,price_choices:{'13':{fuel_price_id:1,reason:'欠測確認'}}}).amount,496+992);
});
test('期間項目と日別項目は一つの作業行にのみ固定し精算で二重計上しない',()=>{
  const reports=[{project_id:1,daily_report_id:1,work_date:'2026-09-01',start_time:'08:00',calculated_billing_amount:10000},{project_id:1,daily_report_id:2,work_date:'2026-09-01',start_time:'08:00',calculated_billing_amount:10000}];
  const items=[{additional_item_id:1,item_name:'燃料',billing_amount:9920,payment_amount:9920,tax_category:'tax_inclusive',calculation_data:{fuel:{days:[{work_date:'2026-09-01'}]}}}];
  const attached=attachItems(reports,items);assert.equal(attached[0].additional_items.length,1);assert.equal(attached[1].additional_items.length,0);
  const lines=buildAggregatedLines(attached,'invoice');assert.equal(lines.reduce((s,l)=>s+l.amount,0),29920);assert.equal(lines.filter(l=>l.tax_category==='tax_inclusive').length,1);
  validateAttendance(reports,items);assert.throws(()=>validateAttendance([],items));
});
