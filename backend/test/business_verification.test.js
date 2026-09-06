const test=require('node:test');
const assert=require('node:assert/strict');
const {catalog,price,input,EXCEPTIONS}=require('../scripts/business_verification/scenarios');
const {resolveFeeItem}=require('../src/services/price_calc_config');
test('requested populations, successor histories and distinct names',()=>{
  const c=catalog();
  assert.equal(c.companies.length,100);assert.equal(c.partners.length,130);assert.equal(c.projects.length,120);
  assert.equal(new Set(c.partners.map(p=>p.name)).size,130);
  assert.equal(c.partners.filter(p=>p.ended).length,10);assert.equal(c.partners.filter(p=>p.advance).length,30);
  assert.equal(c.projects.filter(p=>p.change==='担当者交代').length,10);assert.equal(EXCEPTIONS.length,6);
});
test('training selection respects Saturday/holiday and never leaks into normal work',()=>{
  const c=catalog(),items=price(c.projects[0],c.companies[0]).fee_items;
  assert.equal(resolveFeeItem(items,'2026-09-05',null,true).item.id,'training-sat');
  assert.equal(resolveFeeItem(items,'2026-09-06',null,true).item.id,'training-holiday');
  assert.equal(resolveFeeItem(items,'2026-09-07',null,true).item.id,'training-weekday');
  assert.equal(resolveFeeItem(items,'2026-09-07',null,false).item.id,'weekday');
  const combined=price(c.projects[6],c.companies[6]).fee_items;
  assert.equal(resolveFeeItem(combined,'2026-09-05',null,true).item.id,'training-holiday');
  assert.equal(resolveFeeItem(combined,'2026-09-05',null,false).item.id,'holiday');
});
test('inactive contracts and non-driving work never acquire mileage',()=>{
  const c=catalog();
  const ended=input(c.projects[0],c.companies[0],'2026-09-01').data;
  assert.equal(ended.is_absent,1);assert.equal(ended.start_time,null);assert.equal(ended.total_distance,0);
  for(let i=45;i<65;i++)assert.equal(input(c.projects[i],c.companies[i],'2026-06-01').data.total_distance,0);
});
test('monthly distance is included exactly once from the approved snapshot',()=>{
  const {buildAggregatedLines}=require('../src/services/settlement_line_builder');
  const reports=[1,2].map(id=>({daily_report_id:id,project_id:1,monthly_approval_id:1,calculated_billing_amount:1000,monthly_distance_results:{billing:{result:{mode:'monthly_excess',amount:800,unit_price:80,quantity_km:10}}}}));
  const lines=buildAggregatedLines(reports,'invoice');
  assert.equal(lines.reduce((n,l)=>n+l.amount,0),2800);
  assert.equal(lines.filter(l=>l.component_label==='月間距離超過').length,1);
});
