const test=require('node:test');
const assert=require('node:assert/strict');
const {validateQuantityOverrides}=require('../src/services/quantity_overrides');
const {calculateNightSide}=require('../src/services/night_calc');
const {calculateDistanceSide}=require('../src/services/distance_calc');
const {expenseValues,previewToken,adoptionInput}=require('../src/services/document_adoption');
test('採用超過は深夜配分・金額計算へ渡し、自動値を別に保持する',()=>{
 const input={start_time:'20:00',end_time:'30:00',standard_minutes:480,total_break_minutes:0,rule:{night_mode:'separate',night_overtime_mode:'separate'}};
 const auto=calculateNightSide(input),adopted=calculateNightSide({...input,adopted_overtime_minutes:15});
 assert.equal(auto.overtime_minutes,120);assert.equal(adopted.overtime_minutes,15);assert.equal(adopted.automatic_overtime_minutes,120);
 assert.equal(adopted.normal_minutes+adopted.regular_overtime_minutes+adopted.night_minutes+adopted.night_overtime_minutes,600);
 assert.throws(()=>calculateNightSide({...input,adopted_overtime_minutes:601}));
 assert.equal(calculateNightSide({...input,adopted_overtime_minutes:0}).overtime_minutes,0);
});
test('日別超過距離を採用でき、月間契約には日別採用を混ぜない',()=>{
 const rule={mode:'daily_excess',base_distance:100,unit_price:10};
 const result=calculateDistanceSide({distance:110,rule,adoptedExcess:25});
 assert.equal(result.automatic_excess_distance_km,10);assert.equal(result.excess_distance_km,25);assert.equal(result.amount,250);
 assert.throws(()=>calculateDistanceSide({distance:110,rule:{...rule,mode:'monthly_excess'},adoptedExcess:25}));
});
test('採用の不正形式・理由なし・分未満を拒否し、解除理由も保存する',()=>{
 for(const v of ['{',[],{billing:1},{billing:{overtime_minutes:15}},{billing:{overtime_minutes:.5,reason:'確認'}}])assert.throws(()=>validateQuantityOverrides(v));
 assert.deepEqual(validateQuantityOverrides({billing:{reason:'自動へ戻す'}}),{billing:{reason:'自動へ戻す'}});
 assert.throws(()=>adoptionInput({},{quantity_overrides:{}}));
});
test('採用前計算トークンはキー順に依存せず金額変更を検出する',()=>{
 assert.equal(previewToken({a:1,b:{c:2,d:3}},{}),previewToken({b:{d:3,c:2},a:1},{}));
 assert.notEqual(previewToken({a:1},{}),previewToken({a:2},{}));
});
test('業務経費の対象側と整数金額を明示し、税込区分を維持する',()=>{
 const req={reason:'照合',expense:{applies_to:'billing',tax_category:'tax_inclusive',billing_amount:1500,payment_amount:1500}};
 assert.deepEqual(expenseValues(req),{applies_to:'billing',tax_category:'tax_inclusive',billing_amount:1500,payment_amount:0});
 assert.throws(()=>expenseValues({...req,reason:''}));assert.throws(()=>expenseValues({...req,expense:{...req.expense,billing_amount:1.5}}));
});
