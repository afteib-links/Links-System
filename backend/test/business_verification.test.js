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

test('September includes deep-night overtime but no shift ends after the reference date',()=>{
  const c=catalog();let overtime=0;
  for(const p of c.projects){
    const company=c.companies[p.base];
    for(let day=1;day<=7;day++){
      const date=`2026-09-${String(day).padStart(2,'0')}`;
      const sample=input(p,company,date);
      if(sample.data.row_comment.startsWith('深夜残業'))overtime++;
      if(day===7&&sample.data.end_time)assert.ok(Number(sample.data.end_time.slice(0,2))<24);
    }
  }
  assert.ok(overtime>0);
});
test('monthly distance is included exactly once from the approved snapshot',()=>{
  const {buildAggregatedLines}=require('../src/services/settlement_line_builder');
  const reports=[1,2].map(id=>({daily_report_id:id,project_id:1,monthly_approval_id:1,calculated_billing_amount:1000,monthly_distance_results:{billing:{result:{mode:'monthly_excess',amount:800,unit_price:80,quantity_km:10}}}}));
  const lines=buildAggregatedLines(reports,'invoice');
  assert.equal(lines.reduce((n,l)=>n+l.amount,0),2800);
  assert.equal(lines.filter(l=>l.component_label==='月間距離超過').length,1);
});

test('dedicated database and output guards reject production and unsafe paths',()=>{
  const {environment}=require('../scripts/business_verification/runtime');
  const previous={...process.env};
  try{
    process.env.VERIFICATION_ENV='isolated';process.env.DB_NAME='links_system';
    assert.throws(()=>environment(),/dedicated/);
    process.env.DB_NAME='links_verification_test';process.env.VERIFICATION_ENV='production';
    assert.throws(()=>environment(),/isolated/);
    process.env.VERIFICATION_ENV='isolated';process.env.PDF_DIR=require('node:path').resolve('/outside-test-output');
    assert.throws(()=>environment(),/inside/);
    const {child}=require('../scripts/business_verification/package');
    assert.throws(()=>child('/verification','../production'),/Unsafe/);
  }finally{for(const key of Object.keys(process.env))if(!(key in previous))delete process.env[key];Object.assign(process.env,previous);}
});

test('intentional missing days stay distinct from confirmed non-working days',()=>{
  const {intentionallyMissing}=require('../scripts/business_verification/scenarios');const c=catalog();
  assert.equal(intentionallyMissing(c.projects[70],'2025-11-30'),true);
  assert.equal(intentionallyMissing(c.projects[20],'2025-11-30'),false);
  assert.equal(new Set(c.companies.map(c=>c.name)).size,100);
});

test('normal days never select unmatched training items in ordinary fallback',()=>{
  const items=[{id:'training',name:'研修',weekdays:{sun:true},calc_types:['daily']},{id:'regular',name:'平日',weekdays:{mon:true},calc_types:['daily']}];
  assert.equal(resolveFeeItem(items,'2026-09-05',null,false).item.id,'regular');
});

test('aggregated salary retains attendance and counts negative adjustments once',()=>{
  const {salaryComponents}=require('../src/services/settlement_pdf');
  const line=(component,amount)=>({source_type:'monthly_aggregate',line_type:'work',amount,quantity:1,unit_price:amount,snapshot_json:JSON.stringify({source_key:`1|${component}|daily|100|taxable|name`,calc_type:'daily'})});
  const lines=[line('basic',30000),line('night',1000),line('shortage',-500),{line_type:'adjustment',item_name:'調整',amount:-1200},{line_type:'deduction',item_name:'手数料',amount:-1000}];
  const m=salaryComponents({attendance:{work_days:2,work_minutes:960}},lines);
  assert.equal(m.gross,31000);assert.equal(m.workDays,2);assert.equal(m.workMinutes,960);
  assert.equal(m.gross+m.deductions.reduce((n,l)=>n+l.amount,0),28300);
});
