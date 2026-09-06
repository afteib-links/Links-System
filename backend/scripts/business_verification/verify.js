const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const path=require('node:path');
const crypto=require('node:crypto');
const {schema}=require('./runtime');
const S=require('./scenarios');
const {serializeCsv,checksum}=require('../../src/services/bank_csv_export');
const parse=x=>typeof x==='string'?JSON.parse(x):x;
async function verify(pool,env,api){
  await schema(pool);
  const counts={};
  for(const table of ['companies','partners','base_projects','projects','staff_masters','price_sets','daily_reports','daily_report_monthly_approvals','advance_records','invoices','payments','cash_schedules','cash_transactions','cash_export_batches','settlement_documents']){
    const [[r]]=await pool.query(`SELECT COUNT(*) n FROM ${table}`);counts[table]=Number(r.n);
  }
  for(const [k,v]of Object.entries({companies:100,partners:130,base_projects:100,projects:120,staff_masters:15,price_sets:240}))assert.equal(counts[k],v,k);
  const [partners]=await pool.query('SELECT partner_name,advance_payment_enabled,extra_data FROM partners');
  assert.equal(partners.filter(p=>parse(p.extra_data).contract_status==='ended').length,10);
  assert.equal(partners.filter(p=>p.advance_payment_enabled).length,30);
  assert.equal(new Set(partners.map(p=>p.partner_name)).size,130);
  const [staff]=await pool.query('SELECT role_label,area_name FROM staff_masters');
  for(const [area,role,n] of [['関東','営業',8],['関東','事務',3],['関東','その他',1],['関西','営業',3]])assert.equal(staff.filter(s=>s.area_name===area&&s.role_label===role).length,n);
  async function zero(label,sql,args=[]){const [rows]=await pool.query(sql,args);assert.equal(rows.length,0,`${label}: ${JSON.stringify(rows.slice(0,3))}`);}
  await zero('future work',"SELECT daily_report_id FROM daily_reports WHERE work_date>?",[env.asOf]);
  await zero('non-work payments',"SELECT daily_report_id FROM daily_reports WHERE is_absent=1 AND (work_hours<>0 OR calculated_billing_amount<>0 OR calculated_payment_amount<>0)");
  await zero('missing price',"SELECT daily_report_id FROM daily_reports WHERE is_absent=0 AND applied_price_set_id IS NULL");
  await zero('mismatched report owner',"SELECT d.daily_report_id FROM daily_reports d JOIN projects p ON p.project_id=d.project_id WHERE d.partner_id<>p.partner_id OR d.company_id<>p.company_id");
  await zero('overlapping work',`SELECT a.daily_report_id FROM daily_reports a JOIN daily_reports b ON a.partner_id=b.partner_id AND a.daily_report_id<b.daily_report_id AND DATEDIFF(b.work_date,a.work_date) BETWEEN 0 AND 1
    WHERE a.is_absent=0 AND b.is_absent=0 AND TIMESTAMP(a.work_date,a.start_time)<TIMESTAMP(b.work_date,b.end_time) AND TIMESTAMP(b.work_date,b.start_time)<TIMESTAMP(a.work_date,a.end_time)`);
  await zero('contract end work',"SELECT d.daily_report_id FROM daily_reports d JOIN partners p ON p.partner_id=d.partner_id WHERE d.is_absent=0 AND d.work_date>JSON_UNQUOTE(JSON_EXTRACT(p.extra_data,'$.contract_end_date'))");
  await zero('advance working days',`SELECT a.advance_record_id,a.work_days FROM advance_records a WHERE a.work_days<>(SELECT COUNT(DISTINCT d.work_date) FROM daily_reports d WHERE d.project_id=a.project_id AND d.work_date BETWEEN a.period_start AND a.period_end AND d.status IN ('confirmed','approved') AND d.is_absent=0 AND d.work_hours>0)`);
  await zero('overallocated advances',`SELECT a.advance_record_id FROM advance_records a JOIN advance_payment_allocations x ON x.advance_record_id=a.advance_record_id AND x.status='active' GROUP BY a.advance_record_id,a.advance_amount,a.transfer_fee_amount HAVING SUM(x.amount)>a.advance_amount OR SUM(x.transfer_fee_amount)>a.transfer_fee_amount`);
  await zero('future transaction',"SELECT cash_transaction_id FROM cash_transactions WHERE executed_date>?",[env.asOf]);
  await zero('execution amount mismatch',`SELECT s.cash_schedule_id FROM cash_schedules s LEFT JOIN cash_transactions t ON t.cash_schedule_id=s.cash_schedule_id AND t.status='executed' WHERE s.status='executed' GROUP BY s.cash_schedule_id,s.amount HAVING COALESCE(SUM(t.executed_amount),0)<>s.amount`);
  await zero('orphan settlement sources',`SELECT s.settlement_line_source_id FROM settlement_line_sources s LEFT JOIN daily_reports d ON d.daily_report_id=s.daily_report_id LEFT JOIN daily_report_monthly_approvals a ON a.monthly_approval_id=s.monthly_approval_id WHERE d.daily_report_id IS NULL OR a.monthly_approval_id IS NULL`);
  await zero('approval chronology',"SELECT monthly_approval_id FROM daily_report_monthly_approvals WHERE decided_at<submitted_at");
  await zero('workflow chronology',"SELECT settlement_workflow_id FROM settlement_workflows WHERE finalized_at<sales_reviewed_at");
  await zero('future approvals',"SELECT monthly_approval_id FROM daily_report_monthly_approvals WHERE DATE(submitted_at)>? OR DATE(decided_at)>?",[env.asOf,env.asOf]);
  await zero('missing daily snapshot',`SELECT d.daily_report_id FROM daily_reports d LEFT JOIN daily_report_confirmation_snapshots s ON s.daily_report_id=d.daily_report_id WHERE d.status IN ('confirmed','approved') AND s.daily_report_id IS NULL`);
  await zero('duplicate active settlement',`SELECT s.daily_report_id FROM invoice_daily_reports s JOIN invoices i ON i.invoice_id=s.invoice_id WHERE i.settlement_status<>'cancelled' GROUP BY s.daily_report_id HAVING COUNT(*)>1`);
  await zero('duplicate active payment',`SELECT s.daily_report_id FROM payment_daily_reports s JOIN payments i ON i.payment_id=s.payment_id WHERE i.settlement_status<>'cancelled' GROUP BY s.daily_report_id HAVING COUNT(*)>1`);
  await zero('advance deducted before execution',`SELECT a.advance_payment_allocation_id FROM advance_payment_allocations a JOIN advance_records r ON r.advance_record_id=a.advance_record_id JOIN cash_transactions t ON t.cash_schedule_id=r.cash_schedule_id AND t.status='executed' JOIN settlement_workflows w ON w.settlement_type='payment' AND w.settlement_id=a.payment_id WHERE a.status='active' AND t.executed_date>DATE(w.finalized_at)`);
  const c=S.catalog();
  const [projectRows]=await pool.query('SELECT * FROM projects ORDER BY project_id');
  for(const row of projectRows){
    const meta=parse(row.extra_data),p=c.projects.find(p=>p.no===meta.scenario_no);
    assert.ok(p,'project scenario');
    for(const ym of S.months(env.asOf)){
      if(p.start>S.lastDay(ym)||p.end&&p.end<`${ym}-01`||ym===env.asOf.slice(0,7))continue;
      const state=S.monthState(p,ym),[a]=await pool.query('SELECT status FROM daily_report_monthly_approvals WHERE project_id=? AND target_year_month=?',[row.project_id,ym]);
      assert.equal(a[0]?.status||'unsubmitted',['complete','invoice_draft','payment_draft','payment_held'].includes(state)?'approved':state,`${p.no} ${ym} approval`);
      for(const kind of ['invoice','payment']){
        const link=kind==='invoice'?'invoice_daily_reports':'payment_daily_reports',table=kind==='invoice'?'invoices':'payments',id=kind==='invoice'?'invoice_id':'payment_id';
        const [settlements]=await pool.query(`SELECT DISTINCT h.${id},h.settlement_status FROM ${table} h JOIN ${link} l ON l.${id}=h.${id} JOIN daily_reports d ON d.daily_report_id=l.daily_report_id WHERE d.project_id=? AND d.target_year_month=?`,[row.project_id,ym]);
        const expected=['unsubmitted','submitted','rejected'].includes(state)?null:state===`${kind}_draft`?'draft':'finalized';
        assert.equal(settlements.length,expected?1:0,`${p.no} ${ym} ${kind} count`);
        if(expected)assert.equal(settlements[0].settlement_status,expected,`${p.no} ${ym} ${kind}`);
      }
    }
  }
  const [rateSets]=await pool.query('SELECT project_id,apply_start_date,apply_end_date,price_set_id,price_set_no,extra_data FROM price_sets ORDER BY price_set_id');
  assert.equal(new Set(rateSets.map(s=>s.price_set_no)).size,240);
  assert.ok(rateSets.every(s=>/^R\d{5}$/.test(s.price_set_no)));
  const initial=projectRows.map(p=>rateSets.find(s=>s.project_id===p.project_id));
  for(const [item,n] of [['weekday',120],['holiday',108],['sat',60],['distance',108],['training-weekday',96],['training-holiday',96],['training-sat',48]])assert.equal(initial.filter(s=>parse(s.extra_data).fee_items.some(f=>f.id===item)).length,n,item);
  await zero('wrong effective price',`SELECT d.daily_report_id FROM daily_reports d JOIN price_sets s ON s.price_set_id=d.applied_price_set_id WHERE d.is_absent=0 AND (s.project_id<>d.project_id OR d.work_date<s.apply_start_date OR d.work_date>COALESCE(s.apply_end_date,'9999-12-31'))`);
  const [monthly]=await pool.query("SELECT project_id,target_year_month,snapshot_data FROM daily_report_monthly_approvals WHERE status='approved'");
  for(const a of monthly)for(const side of ['billing','payment']){
    const snapshot=parse(a.snapshot_data),result=snapshot.monthly_distance_results?.[side]?.result;
    if(result?.mode!=='monthly_excess')continue;
    const distance=snapshot.reports.reduce((n,r)=>n+Number(r.total_distance||0),0);
    const expected=Math.max(0,distance-1800)*(side==='billing'?80:50);
    assert.equal(Number(result.amount),expected,`monthly distance ${a.project_id} ${a.target_year_month} ${side}`);
    const kind=side==='billing'?'invoice':'payment';
    const [[sum]]=await pool.query("SELECT COALESCE(SUM(amount),0) amount FROM settlement_lines WHERE project_id=? AND settlement_type=? AND item_name LIKE '%月間距離超過%' AND source_id IN (SELECT monthly_approval_id FROM daily_report_monthly_approvals WHERE project_id=? AND target_year_month=?)",[a.project_id,kind,a.project_id,a.target_year_month]);
    assert.equal(Number(sum.amount),expected,`monthly distance settlement ${a.project_id} ${a.target_year_month} ${side}`);
  }
  for(const kind of ['invoice','payment']){
    const [[m]]=await pool.query("SELECT COUNT(*) n FROM settlement_lines WHERE settlement_type=? AND source_type='manual_adjustment'",[kind]);assert.equal(Number(m.n),6,`${kind} manual lines`);
    const table=kind==='invoice'?'invoices':'payments',id=kind==='invoice'?'invoice_id':'payment_id';
    const [headers]=await pool.query(`SELECT * FROM ${table} WHERE settlement_status='finalized'`);
    for(const h of headers){const [lines]=await pool.query("SELECT amount FROM settlement_lines WHERE settlement_type=? AND settlement_id=? AND status='active'",[kind,h[id]]);const sum=lines.reduce((n,l)=>n+Number(l.amount),0);assert.equal(sum+(kind==='invoice'?Number(h.tax_amount):0),Number(kind==='invoice'?h.total_amount:h.final_transfer_amount),`${kind} ${h[id]} amount`);}
  }
  const [batches]=await pool.query("SELECT * FROM cash_export_batches WHERE export_kind='bank_csv'");
  for(const b of batches){
    const d=parse(b.definition_snapshot_json),[items]=await pool.query('SELECT export_row_json FROM cash_export_batch_items WHERE cash_export_batch_id=? ORDER BY export_row_no',[b.cash_export_batch_id]);
    const buffer=serializeCsv(d.version,d.columns,items.map(i=>({values:parse(i.export_row_json)})));
    assert.equal(checksum(buffer),b.file_checksum,`CSV ${b.cash_export_batch_id}`);assert.equal(items.length,b.total_count);
    assert.equal(checksum(await fs.readFile(path.join(env.out,'csv',`batch-${b.cash_export_batch_id}.csv`))),b.file_checksum);
    if(api&&b===batches[0])assert.equal(checksum((await api.request(`/cash/exports/${b.cash_export_batch_id}/download`)).buffer),b.file_checksum);
  }
  const [docs]=await pool.query('SELECT file_path,snapshot_json FROM settlement_documents');
  for(const d of docs){const file=path.resolve(env.pdf,d.file_path);assert.ok(file.startsWith(env.pdf+path.sep));const buffer=await fs.readFile(file);assert.equal(buffer.subarray(0,5).toString(),'%PDF-');assert.ok(parse(d.snapshot_json).document.issued_date<=env.asOf);}
  const [reports]=await pool.query('SELECT project_id,work_date,is_absent,start_time,end_time,total_distance,calculated_billing_amount,calculated_payment_amount,status,billing_status,payment_status FROM daily_reports ORDER BY project_id,work_date,daily_report_id');
  const semanticChecksum=crypto.createHash('sha256').update(JSON.stringify(reports)).digest('hex');
  return {status:'passed',counts,semanticChecksum,verifiedCsv:batches.length,verifiedPdf:docs.length,asOf:env.asOf};
}
module.exports={verify};
