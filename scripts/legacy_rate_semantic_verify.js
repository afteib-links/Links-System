'use strict';
const fs=require('node:fs'),assert=require('node:assert/strict');
const {getPool}=require('/app/backend/src/db');
const {verifySemanticModel}=require('/app/backend/src/services/legacy_semantic_amount');
const object=x=>typeof x==='string'?JSON.parse(x):x||{};
async function main(){
  const before=JSON.parse(fs.readFileSync(process.argv[2],'utf8').replace(/^\uFEFF/,'')),pool=getPool();
  const result={sets:0,rules:0,matched:0,mismatches:0,pending:0,other_snapshot_tables_unchanged:0};
  try{
    for(const [table,expected] of Object.entries(before.tables)){
      const fields=expected.length?Object.keys(expected[0]).map(k=>'`'+k+'`').join(','):'*';
      const [actual]=await pool.query(`SELECT ${fields} FROM \`${table}\``);
      const pk=before.schema[table].find(c=>c.Key==='PRI').Field;
      const sort=xs=>xs.slice().sort((a,b)=>Number(a[pk])-Number(b[pk]));
      if(table!=='price_sets'){assert.deepEqual(sort(actual),sort(expected),table);result.other_snapshot_tables_unchanged++;continue;}
      assert.equal(actual.length,expected.length);
      for(const current of actual){
        const prior=expected.find(r=>r.price_set_id===current.price_set_id),x=object(current.extra_data),old=object(prior.extra_data);
        if(!current.is_deleted&&old.legacy_analysis?.import_key){
          const m=x.legacy_analysis.semantic_model;assert.ok(m,'Missing semantics');
          const checked=verifySemanticModel(m);assert.deepEqual(checked,m.verification);
          result.sets++;result.rules+=m.rules.length;result.matched+=checked.matched;result.mismatches+=checked.mismatches.length;
          if(x.legacy_analysis.calculation_status==='review_required')result.pending++;
          delete x.legacy_analysis.semantic_model;
          x.legacy_analysis.calculation_status=old.legacy_analysis.calculation_status;
          assert.deepEqual(x,old,'Only semantic metadata/status may change');
          const strip=r=>Object.fromEntries(Object.entries(r).filter(([k])=>!['extra_data','version','updated_at'].includes(k)));
          assert.deepEqual(strip(current),strip(prior));
        }else assert.deepEqual(current,prior);
      }
    }
    console.log(JSON.stringify(result));
  }finally{await pool.end();}
}
main().catch(e=>{console.error(e.message);process.exitCode=1;});
