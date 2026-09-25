'use strict';
const fs=require('node:fs'),crypto=require('node:crypto');
const {getPool}=require('/app/backend/src/db');
const parse=x=>typeof x==='string'?JSON.parse(x):x||{};
async function financialFingerprint(pool){
  const result={};
  for(const table of ['daily_reports','invoices','invoice_details','payments','payment_details']){
    const [columns]=await pool.query(`SHOW COLUMNS FROM ${table}`);
    const pk=columns.find(c=>c.Key==='PRI').Field;
    const fields=columns.map(c=>c.Field).filter(c=>!['is_deleted','updated_at','version'].includes(c));
    const [rows]=await pool.query(`SELECT ${fields.map(c=>'`'+c+'`').join(',')} FROM ${table} ORDER BY ${pk}`);
    result[table]={count:rows.length,sha256:crypto.createHash('sha256').update(JSON.stringify(rows)).digest('hex')};
  }
  return result;
}
async function main(){
  const pool=getPool();
  try{
    const fingerprints=await financialFingerprint(pool);
    if(process.argv[2]==='capture'){console.log(JSON.stringify(fingerprints));return;}
    const before=JSON.parse(fs.readFileSync(process.argv[2],'utf8').replace(/^\uFEFF/,''));
    if(JSON.stringify(before)!==JSON.stringify(fingerprints))throw new Error('Historical financial values changed');
    const [sets]=await pool.query('SELECT * FROM price_sets WHERE is_deleted=0');
    const imported=sets.filter(r=>parse(r.extra_data).legacy_analysis?.import_key);
    const {applyDailyPriceCalc}=require('/app/backend/src/services/price_calc');
    const report={financial_values_unchanged:true,sets:imported.length,base:0,project:0,ready:0,pending:0,calculation_checks:0,guard_checks:0,errors:[]};
    for(const r of imported){
      r.project_id?report.project++:report.base++;
      const x=parse(r.extra_data),pending=x.legacy_analysis.calculation_status==='review_required';
      pending?report.pending++:report.ready++;
      const [[count]]=await pool.query('SELECT COUNT(*) n FROM price_set_lines WHERE price_set_id=? AND is_deleted=0',[r.price_set_id]);
      if(!count.n||!x.fee_items?.length)throw new Error('Invisible rate set');
      if(!r.project_id)continue;
      const minutes=Number(x.work_rules.standard_minutes);
      const time=m=>`${String(Math.floor(m/60)).padStart(2,'0')}:${String(m%60).padStart(2,'0')}`;
      const input={project_id:r.project_id,work_date:r.apply_start_date,start_time:'08:00',end_time:time(480+minutes),break_minutes:0};
      if(pending){
        try{await applyDailyPriceCalc({...input});report.errors.push({id:r.price_set_id,error:'Pending rate was calculated'});}
        catch(e){if(e.code==='legacy_rate_review_required')report.guard_checks++;else throw e;}
        continue;
      }
      for(const overtime of [0,60]){
        const result=await applyDailyPriceCalc({...input,end_time:time(480+minutes+overtime)});
        if(Number(result.applied_price_set_id)!==Number(r.price_set_id)){report.errors.push({id:r.price_set_id,error:'Wrong period selection'});continue;}
        const detail=parse(result.calculation_detail);
        const card=x.fee_items.find(c=>c.id===result.selected_fee_item_id);
        const basic=card?.rows.find(v=>v.item_type==='daily_basic');
        if(!basic)continue;
        const ot=card.rows.find(v=>v.item_type==='overtime');
        for(const side of ['billing','payment']){
          const expected=Math.floor(Number(basic[side]))+Math.floor(Number(ot?.[side]||0)*overtime/60);
          if(Math.abs(Number(result[`calculated_${side}_amount`])-expected)>.01)report.errors.push({id:r.price_set_id,side,overtime,error:'Unit arithmetic mismatch'});
          else report.calculation_checks++;
        }
      }
    }
    console.log(JSON.stringify(report));
    if(report.errors.length)process.exitCode=1;
  }finally{await pool.end();}
}
main().catch(e=>{console.error(e.stack);process.exitCode=1;});
