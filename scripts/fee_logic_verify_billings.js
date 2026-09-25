'use strict';
const fs = require('node:fs');
const assert = require('node:assert/strict');
const { getPool } = require('/app/backend/src/db');
function parseValues(source) {
  const rows=[]; let i=0;
  while (i<source.length) {
    while (/[\s,]/.test(source[i] || '') && i<source.length) i++;
    if (i>=source.length) break;
    assert.equal(source[i++],'(');
    const row=[];
    for (;;) {
      let value='';
      if (source[i]==="'") {
        i++;
        for (;;) {
          if (i>=source.length) throw new Error('Truncated dump value');
          const c=source[i++];
          if (c==="'") break;
          if (c==='\\') {
            const escaped=source[i++];
            value+=({ '0':'\0',n:'\n',r:'\r',b:'\b',t:'\t',Z:'\x1a' })[escaped] ?? escaped;
          } else value+=c;
        }
      } else {
        while (i<source.length && ![',',')'].includes(source[i])) value+=source[i++];
        value=value.trim()==='NULL' ? null : value.trim();
      }
      row.push(value);
      if (source[i++ ]===')') break;
    }
    rows.push(row);
  }
  return rows;
}
async function main() {
  const sql=fs.readFileSync(process.argv[2],'utf8');
  const match=sql.match(/INSERT INTO `company_billings` VALUES\s+([\s\S]*?);\r?\n/);
  assert.ok(match,'Backup billing rows required');
  const pool=getPool();
  try {
    const [columns]=await pool.query('SHOW COLUMNS FROM company_billings');
    const oldColumns=columns.filter((c)=>c.Field!=='billing_name').map((c)=>c.Field);
    const before=parseValues(match[1]).map((values)=>{
      assert.equal(values.length,oldColumns.length);
      return Object.fromEntries(oldColumns.map((key,index)=>[key,values[index]]));
    });
    const [after]=await pool.query('SELECT b.*,c.company_name FROM company_billings b LEFT JOIN companies c ON c.company_id=b.company_id');
    assert.equal(after.length,before.length);
    let timestamps=0;
    for (const row of after) {
      const prior=before.find((b)=>b.billing_id===String(row.billing_id));
      assert.ok(prior);
      for (const key of oldColumns) {
        const value=row[key]==null ? null : String(row[key]);
        if (key==='updated_at') { if (prior[key]!==value) timestamps++; continue; }
        assert.equal(value,prior[key],`Unexpected billing field change: ${key}`);
      }
      assert.equal(row.billing_name,prior.billing_print_name || row.company_name);
    }
    console.log(JSON.stringify({ verified_billings:after.length,preserved_original_fields:true,expected_timestamp_changes:timestamps }));
  } finally { await pool.end(); }
}
main().catch((error)=>{ console.error(error.message);process.exitCode=1; });
