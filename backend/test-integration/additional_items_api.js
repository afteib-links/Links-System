const assert=require('node:assert/strict');const {getPool}=require('../src/db');const {createApp}=require('../src/server');
(async()=>{
  assert.ok(/test|ci|verification/i.test(process.env.DB_NAME||'')||(process.env.GITHUB_ACTIONS==='true'&&process.env.DB_HOST==='127.0.0.1'&&process.env.ADMIN_LOGIN_ID==='ci-admin'));
  const pool=getPool();let server;
  try {
    const [company]=await pool.query("INSERT INTO companies(company_name) VALUES ('FUEL匿名企業')"),[partner]=await pool.query("INSERT INTO partners(partner_name) VALUES ('FUEL匿名担当')");
    const [bill]=await pool.query("INSERT INTO company_billings(company_id,billing_no,billing_print_name) VALUES (?,0,'FUEL匿名企業')",[company.insertId]);
    const [project]=await pool.query("INSERT INTO projects(company_id,billing_id,partner_id,closing_date,business_type) VALUES (?,?,?,'end','FUEL匿名検証')",[company.insertId,bill.insertId,partner.insertId]);
    server=(await createApp()).listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));const base=`http://127.0.0.1:${server.address().port}`;let cookie='';
    async function api(path,body){const res=await fetch(base+path,{method:body===undefined?'GET':'POST',headers:{cookie,'content-type':'application/json'},body:body===undefined?undefined:JSON.stringify(body)});if(res.headers.get('set-cookie'))cookie=res.headers.get('set-cookie').split(';')[0];return {...await res.json(),status:res.status};}
    assert.equal((await api('/api/auth/login',{login_id:process.env.ADMIN_LOGIN_ID,password:process.env.ADMIN_PASSWORD})).status,200);
    for(let day=1;day<=20;day++)assert.equal((await api('/api/daily-reports',{project_id:project.insertId,company_id:company.insertId,partner_id:partner.insertId,target_year_month:'2026-09',work_date:`2026-09-${String(day).padStart(2,'0')}`,start_time:'08:00',end_time:'17:00',break_minutes:60})).status,201);
    const prefix='/api/additional-items';
    for(const b of [{scope_type:'global',scope_id:0,efficiency:10,prefecture_code:'13'},{scope_type:'partner',scope_id:partner.insertId,efficiency:12,roundtrip_km:30,prefecture_code:'13'},{scope_type:'project',scope_id:project.insertId,roundtrip_km:35}])assert.equal((await api(prefix+'/fuel/conditions',{...b,valid_from:'2026-01-01',reason:'匿名検証'})).status,200);
    assert.equal((await api(prefix+'/fuel/prices',{prefecture_code:'13',price_date:'2026-09-01',regular_price:170,reason:'匿名価格'})).status,200);
    const master=(await api(prefix+'/masters')).masters.find(m=>m.calculation_method==='fuel');
    const body={project_id:project.insertId,target_year_month:'2026-09',additional_item_master_id:master.additional_item_master_id,applies_to:'both',inputs:{reference_date:'2026-09-01'},request_key:`anonymous-${project.insertId}`};
    const preview=await api(prefix+'/preview',body);assert.equal(preview.status,200,JSON.stringify(preview));assert.equal(preview.preview.billing_amount,9920);assert.equal(preview.preview.payment_amount,9920);
    const saved=await api(prefix,{...body,preview_token:preview.preview.preview_token});assert.equal(saved.status,200,JSON.stringify(saved));
    assert.equal((await api(prefix,{...body,preview_token:preview.preview.preview_token})).skipped,true);
    const listed=await api(`${prefix}?project_id=${project.insertId}&target_year_month=2026-09`);assert.equal(listed.items.length,1);
    const item=listed.items[0];assert.equal(Number(item.billing_amount),9920);
    const stale={...body,additional_item_id:item.additional_item_id,version:0,reason:'変更',preview_token:preview.preview.preview_token};assert.equal((await api(prefix,stale)).status,409);
    assert.equal((await api(prefix+'/fuel/schedule',{enabled:true,fetch_time_jst:'10:00',version:1})).status,400);
    const submitted=await api('/api/daily-reports/monthly-approval',{project_id:project.insertId,target_year_month:'2026-09',action:'submit',acknowledge_warnings:true});assert.equal(submitted.status,200,JSON.stringify(submitted));
    const [approvals]=await pool.query('SELECT snapshot_data FROM daily_report_monthly_approvals WHERE project_id=?',[project.insertId]);const snapshot=typeof approvals[0].snapshot_data==='string'?JSON.parse(approvals[0].snapshot_data):approvals[0].snapshot_data;
    assert.equal(snapshot.additional_items.length,1);assert.equal(snapshot.reports.flatMap(r=>r.additional_items).length,1);
    assert.equal((await api(prefix+'/'+item.additional_item_id+'/delete',{version:item.version,reason:'ロック検証'})).status,409);
    assert.equal((await api('/api/daily-reports/monthly-approval',{project_id:project.insertId,target_year_month:'2026-09',action:'approve'})).status,200);
    await pool.query("UPDATE daily_reports SET status='approved' WHERE project_id=?",[project.insertId]);
    const invoice=await api('/api/settlements/invoice/drafts',{company_id:company.insertId,billing_id:bill.insertId,project_ids:[project.insertId],daily_report_ids:snapshot.reports.map(r=>r.daily_report_id),target_year_month:'2026-09'});
    assert.equal(invoice.status,201,JSON.stringify(invoice));
    const invoiceId=invoice.settlement_id;
    const [lines]=await pool.query("SELECT * FROM settlement_lines WHERE settlement_type='invoice' AND settlement_id=? AND status='active' AND tax_category='tax_inclusive'",[invoiceId]);
    assert.equal(lines.length,1);assert.equal(Number(lines[0].amount),9920);
    const [invoiceRow]=await pool.query('SELECT total_amount FROM invoices WHERE invoice_id=?',[invoiceId]);assert.equal(Number(invoiceRow[0].total_amount),9920);
    const diff=await api(`/api/settlements/invoice/${invoiceId}/source-diff`);assert.equal(diff.status,200,JSON.stringify(diff));
    assert.equal(diff.changes.filter(c=>c.action==='add').length,0,'再反映で追加項目を重複しない');
    console.log('[integration] fuel 9920, source precedence, persisted snapshot, idempotency, version and approval lock passed');
  } finally {if(server)await new Promise(r=>server.close(r));await pool.end();}
})().then(()=>process.exit(0)).catch(e=>{console.error(e);process.exit(1);});
