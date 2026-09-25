'use strict';
// Read-only comparison with the backed-up calculator. Does not save recalculations.
const assert=require('node:assert/strict');
const currentRoot='/app/backend/src';
const originalRoot=process.argv[2];
if (!originalRoot || !originalRoot.startsWith('/tmp/')) throw new Error('Backed-up source directory under /tmp is required');
const current=require(`${currentRoot}/services/price_calc`);
const original=require(`${originalRoot}/services/price_calc`);
const {getPool}=require(`${currentRoot}/db`);
async function main(){
  const pool=getPool();
  const result={same_amounts:0,same_guards:0};
  try{
    const [prices]=await pool.query(`SELECT p.project_id,p.apply_start_date,p.extra_data FROM price_sets p
      WHERE p.project_id IS NOT NULL AND p.is_deleted=0
      AND JSON_UNQUOTE(JSON_EXTRACT(p.extra_data,'$.legacy_analysis.calculation_status'))='ready'
      ORDER BY p.price_set_id`);
    const reports=[];
    for(const price of prices){
      const extra=typeof price.extra_data==='string'?JSON.parse(price.extra_data):price.extra_data;
      for(const item of extra.fee_items||[])for(const end of ['15:00','18:00','19:00','28:00'])reports.push({project_id:price.project_id,work_date:price.apply_start_date,selected_fee_item_id:item.id,fee_item_selection_source:'manual',start_time:'09:00',end_time:end,break_minutes:60});
    }
    assert.ok(reports.length);
    for(const row of reports.slice(0,304)){
      const run=async fn=>{try{return {data:await fn({...row})};}catch(error){return {error:error.code||error.message};}};
      const a=await run(original.applyDailyPriceCalc),b=await run(current.applyDailyPriceCalc);
      assert.equal(b.error,a.error,'Calculation guard changed');
      if(a.error){result.same_guards++;continue;}
      for(const key of ['calculated_billing_amount','calculated_payment_amount','shortage_amount_billing','shortage_amount_payment','distance_amount_billing','distance_amount_payment']) assert.equal(b.data[key],a.data[key],`Amount changed: ${key}`);
      result.same_amounts++;
    }
    console.log(JSON.stringify(result));
  }finally{await pool.end();await require(`${originalRoot}/db`).getPool().end();}
}
main().catch(error=>{console.error(error.stack);process.exitCode=1;});
