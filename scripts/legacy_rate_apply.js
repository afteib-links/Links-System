'use strict';
// Run inside the named application container. Defaults to a rolled-back dry run.
const fs = require('node:fs');
const crypto = require('node:crypto');
const root = process.env.LEGACY_APP_ROOT || '/app/backend';
const { getPool } = require(`${root}/src/db`);
const { validateFeeItems, feeItemsToLines } = require(`${root}/src/services/fee_item_rules`);
const { allocatePriceSetNo } = require(`${root}/src/services/price_set_lifecycle`);
const hash = p => crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');
const read = p => JSON.parse(fs.readFileSync(p, 'utf8').replace(/^\uFEFF/, ''));
function canonical(x) {
  if (Array.isArray(x)) return x.map(canonical);
  if (x && typeof x === 'object') return Object.fromEntries(Object.keys(x).sort().map(k => [k, canonical(x[k])]));
  return x;
}
const equal = (a,b) => JSON.stringify(canonical(a)) === JSON.stringify(canonical(b));
const extra = x => typeof x === 'string' ? JSON.parse(x) : x || {};
const PRIMARY = {companies:'company_id',partners:'partner_id',base_projects:'base_project_id',projects:'project_id',daily_reports:'daily_report_id',invoices:'invoice_id',payments:'payment_id',price_sets:'price_set_id',price_series:'price_series_id'};

async function main() {
  const [planPath, snapshotPath, backupPath, backupHash, mode] = process.argv.slice(2);
  if (!planPath || !snapshotPath) throw new Error('Usage: script plan snapshot backup backupSha256 [--commit]');
  const plan=read(planPath), snapshot=read(snapshotPath), commit=mode==='--commit';
  if (hash(snapshotPath)!==plan.snapshot_sha256) throw new Error('Snapshot checksum mismatch');
  if (commit && (!backupPath || fs.statSync(backupPath).size<1000 || hash(backupPath)!==backupHash)) throw new Error('Verified full backup is required');
  const pool=getPool(),conn=await pool.getConnection();
  const report={mode:commit?'committed':'dry_run_rolled_back',plan_sha256:hash(planPath),backup_sha256:backupHash||null,deleted:{},superseded:[],inserted:[],assignments:[]};
  try {
    await conn.beginTransaction();
    const [existing]=await conn.query('SELECT * FROM price_sets FOR UPDATE');
    const imported=new Set(existing.map(r=>extra(r.extra_data).legacy_analysis?.import_key).filter(Boolean));
    const hits=plan.price_sets.filter(r=>imported.has(r.import_key)).length;
    if (hits===plan.price_sets.length) { await conn.rollback(); console.log(JSON.stringify({mode:'already_applied',sets:hits}));return; }
    if (hits) throw new Error('Partial prior import requires investigation');
    // Refuse any concurrent edits to the exact source snapshot, including logical deletions.
    for (const [table,expected] of Object.entries(snapshot.tables)) {
      const fields=expected.length ? Object.keys(expected[0]).map(k=>`\`${k}\``).join(',') : '*';
      const [actual]=await conn.query(`SELECT ${fields} FROM \`${table}\` FOR UPDATE`);
      const pk=snapshot.schema[table].find(c=>c.Key==='PRI').Field;
      const sorted=rows=>rows.slice().sort((a,b)=>Number(a[pk])-Number(b[pk]));
      if (!equal(sorted(actual),sorted(expected))) throw new Error(`Concurrent change: ${table}; regenerate snapshot and plan`);
    }
    const remove=async(table,column,ids)=>{
      if(!ids.length)return;
      const [r]=await conn.query(`UPDATE \`${table}\` SET is_deleted=1,version=version+1,updated_at=CURRENT_TIMESTAMP WHERE is_deleted=0 AND \`${column}\` IN (?)`,[ids]);
      report.deleted[table]=(report.deleted[table]||0)+r.affectedRows;
    };
    const ids=plan.delete_ids;
    // Parent accounting documents must not remain active after a referenced daily row is removed.
    if (ids.daily_reports.length) {
      const [[cross]]=await conn.query('SELECT COUNT(*) n FROM invoice_details d JOIN invoices i ON i.invoice_id=d.invoice_id WHERE d.is_deleted=0 AND i.is_deleted=0 AND d.daily_report_id IN (?) AND i.invoice_id NOT IN (?)',[ids.daily_reports,ids.invoices.length?ids.invoices:[0]]);
      if(cross.n)throw new Error('Cancelled daily rows are referenced by retained invoices');
    }
    for(const [table,column,parent] of [['invoice_details','invoice_id','invoices'],['payment_details','payment_id','payments'],['company_billings','company_id','companies'],['price_set_lines','price_set_id','price_sets']]) await remove(table,column,ids[parent]);
    for(const [table,pk] of Object.entries(PRIMARY)) await remove(table,pk,ids[table]);
    const owners=new Map();
    for(const row of plan.price_sets){
      const key=row.project_id?`project:${row.project_id}`:`base:${row.base_project_id}`;
      if(!owners.has(key))owners.set(key,[]);
      owners.get(key).push(row);
    }
    for(const versions of owners.values()){
      versions.sort((a,b)=>a.apply_start_date.localeCompare(b.apply_start_date));
      const first=versions[0],ownerTable=first.project_id?'projects':'base_projects',ownerColumn=first.project_id?'project_id':'base_project_id',ownerId=first[ownerColumn];
      const [old]=await conn.query(`SELECT * FROM price_sets WHERE ${ownerColumn}=? AND is_deleted=0`,[ownerId]);
      for(const r of old){
        if(!String(r.price_set_name).startsWith('legacy18:'))throw new Error('Non-imported rates would be replaced');
        await remove('price_set_lines','price_set_id',[r.price_set_id]);
        await remove('price_sets','price_set_id',[r.price_set_id]);
        if(r.price_series_id)await remove('price_series','price_series_id',[r.price_series_id]);
        report.superseded.push(r.price_set_id);
      }
      const [[seq]]=await conn.query('SELECT COALESCE(MAX(series_number),0)+1 n FROM price_series WHERE company_id=?',[first.company_id]);
      const code=`FEE-${String(first.company_id).padStart(5,'0')}-${String(seq.n).padStart(4,'0')}`;
      const [series]=await conn.query('INSERT INTO price_series (company_id,series_number,series_code,price_series_name,base_project_id,project_id) VALUES (?,?,?,?,?,?)',[first.company_id,seq.n,code,first.price_set_name,first.base_project_id,first.project_id]);
      let latest=null;
      for(let i=0;i<versions.length;i++){
        const r=versions[i],validated=validateFeeItems(r.extra_data.fee_items);
        if(validated.errors.length)throw new Error(validated.errors.join('; '));
        r.extra_data.fee_items=validated.items;
        const lines=feeItemsToLines(validated.items);
        if(!lines.length)throw new Error('Empty fee set');
        for(const line of lines)if(!Number.isFinite(line.billing_unit_price)||!Number.isFinite(line.payment_unit_price))throw new Error('Invalid rate');
        const no=await allocatePriceSetNo(conn);
        const [insert]=await conn.query('INSERT INTO price_sets (price_set_no,price_series_id,revision_no,revision_reason,is_current_revision,price_set_name,company_id,base_project_id,project_id,apply_start_date,apply_end_date,note,extra_data) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)',
          [no,series.insertId,i+1,'旧Excel原本再照合・Ollama分類',i===versions.length-1?1:0,r.price_set_name,r.company_id,r.base_project_id,r.project_id,r.apply_start_date,r.apply_end_date,r.note,JSON.stringify(r.extra_data)]);
        latest=insert.insertId;
        for(const l of lines)await conn.query('INSERT INTO price_set_lines (price_set_id,weekday_code,calc_type_code,price_type_code,billing_unit_price,payment_unit_price,sort_order) VALUES (?,?,?,?,?,?,?)',[latest,l.weekday_code,l.calc_type_code,l.price_type_code,l.billing_unit_price,l.payment_unit_price,l.sort_order]);
        await conn.query('INSERT INTO price_set_revision_audit_logs (price_set_id,action_code,after_data,reason) VALUES (?,?,?,?)',[latest,'legacy_recheck',JSON.stringify({import_key:r.import_key,source:r.extra_data.legacy_analysis.source_file}),'バックアップ後、原本単価と数式を再照合して登録']);
        report.inserted.push({price_set_id:latest,owner:ownerTable,owner_id:ownerId,lines:lines.length,status:r.extra_data.legacy_analysis.calculation_status,import_key:r.import_key});
      }
      await conn.query(`UPDATE ${ownerTable} SET price_set_id=?,version=version+1 WHERE ${ownerColumn}=? AND is_deleted=0`,[latest,ownerId]);
      report.assignments.push({table:ownerTable,id:ownerId,price_set_id:latest});
    }
    for(const [table,pk] of Object.entries(PRIMARY)){
      if(!ids[table].length)continue;
      const [[r]]=await conn.query(`SELECT COUNT(*) n FROM ${table} WHERE is_deleted=0 AND ${pk} IN (?)`,[ids[table]]);
      if(r.n)throw new Error(`Cancellation still active: ${table}`);
    }
    const [[orphans]]=await conn.query('SELECT COUNT(*) n FROM projects p JOIN companies c ON c.company_id=p.company_id LEFT JOIN partners a ON a.partner_id=p.partner_id WHERE p.is_deleted=0 AND (c.is_deleted=1 OR a.is_deleted=1)');
    if(orphans.n)throw new Error('Active project points to deleted master');
    if(commit)await conn.commit();else await conn.rollback();
    console.log(JSON.stringify(report));
  } catch(e){await conn.rollback();throw e;}finally{conn.release();await pool.end();}
}
main().catch(e=>{console.error(e.stack);process.exitCode=1;});
