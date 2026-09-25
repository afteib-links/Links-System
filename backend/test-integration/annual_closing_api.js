const assert=require('node:assert/strict');const {getPool}=require('../src/db');const {createApp}=require('../src/server');
(async()=>{
  assert.ok(/test|ci|verification/i.test(process.env.DB_NAME||'')||(process.env.GITHUB_ACTIONS==='true'&&process.env.DB_HOST==='127.0.0.1'&&process.env.ADMIN_LOGIN_ID==='ci-admin'));
  const pool=getPool();let server;
  try {
    const [years]=await pool.query('SELECT GREATEST(2030,COALESCE((SELECT MAX(fiscal_year) FROM annual_closings),0),COALESCE((SELECT MAX(YEAR(work_date)) FROM daily_reports),0))+2 y');const year=Number(years[0].y);
    const [company]=await pool.query("INSERT INTO companies(company_name) VALUES ('YEAR匿名企業')"),[partner]=await pool.query("INSERT INTO partners(partner_name) VALUES ('YEAR匿名担当')");
    const [bill]=await pool.query("INSERT INTO company_billings(company_id,billing_no,billing_print_name) VALUES (?,0,'YEAR匿名企業')",[company.insertId]);
    const [project]=await pool.query("INSERT INTO projects(company_id,billing_id,partner_id,closing_date,business_type) VALUES (?,?,?,'20','YEAR匿名検証')",[company.insertId,bill.insertId,partner.insertId]);
    server=(await createApp()).listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));const base=`http://127.0.0.1:${server.address().port}`;let cookie='';
    async function api(path,body,method='POST'){const res=await fetch(base+path,{method:body===undefined?'GET':method,headers:{cookie,'content-type':'application/json',connection:'close'},body:body===undefined?undefined:JSON.stringify(body)});if(res.headers.get('set-cookie'))cookie=res.headers.get('set-cookie').split(';')[0];return {...await res.json(),http:res.status};}
    assert.equal((await api('/api/auth/login',{login_id:process.env.ADMIN_LOGIN_ID,password:process.env.ADMIN_PASSWORD})).http,200);
    const projectId=Number(project.insertId),input={project_id:projectId,company_id:company.insertId,partner_id:partner.insertId,start_time:'08:00',end_time:'17:00',break_minutes:60};
    for(let month=0;month<12;month++){
      const ym=month===0?`${year-1}-12`:`${year}-${String(month).padStart(2,'0')}`;
      const created=await api('/api/daily-reports',{...input,target_year_month:ym,work_date:`${ym}-10`});assert.equal(created.http,201,JSON.stringify(created));
      await pool.query("UPDATE daily_reports SET calculated_billing_amount=1000000,calculated_payment_amount=500000,status='confirmed' WHERE daily_report_id=?",[created.report.daily_report_id]);
    }
    const tail=await api('/api/daily-reports',{...input,target_year_month:`${year}-12`,work_date:`${year}-11-25`});assert.equal(tail.http,201,JSON.stringify(tail));
    await pool.query("UPDATE daily_reports SET calculated_billing_amount=300000,calculated_payment_amount=150000,status='confirmed' WHERE daily_report_id=?",[tail.report.daily_report_id]);
    const endpoint='/api/annual-closings';
    const settings=(await api(endpoint+'/settings')).settings;
    assert.equal((await api(endpoint+'/settings',{include_previous_tail:false,version:settings.version,reason:'匿名除外検証'})).http,200);
    const body={fiscal_year:year,input:{previous_confirmed:true,previous_billing:200000,previous_payment:100000,previous_reason:'初年度匿名繰越',acknowledge_warnings:true,warning_reason:'匿名実績の確認',tail_adjustments:[{project_id:projectId,billing:0,payment:0,confirmed:true,reason:'月額・月間項目は該当なし'}]},reason:'匿名年度締め'};
    const preview=await api(endpoint+'/preview',body);assert.equal(preview.http,200,JSON.stringify(preview));assert.equal(preview.preview.totals.billing,12100000);assert.deepEqual(preview.preview.blockers,[]);
    const currentSetting=(await api(endpoint+'/settings')).settings;await api(endpoint+'/settings',{include_previous_tail:true,version:currentSetting.version,reason:'匿名含む検証'});
    assert.equal((await api(endpoint+'/preview',body)).preview.totals.billing,12300000);
    await api(endpoint+'/settings',{include_previous_tail:false,version:currentSetting.version+1,reason:'匿名除外へ戻す'});
    body.source_token=(await api(endpoint+'/preview',body)).preview.source_token;
    const drafted=await api(endpoint+'/draft',body);assert.equal(drafted.http,200,JSON.stringify(drafted));const id=drafted.annual_closing_id;
    let row=(await api(`${endpoint}/${id}`)).closing;
    assert.equal((await api(`${endpoint}/${id}/finalize`,{version:row.version})).http,409);
    const submit=await api(`${endpoint}/${id}/submit`,{version:row.version});assert.equal(submit.http,200,JSON.stringify(submit));
    assert.equal((await api('/api/daily-reports',{...input,target_year_month:`${year}-12`,work_date:`${year}-11-29`})).http,409,'年度固定日に新規追加を拒否');
    assert.equal((await api('/api/daily-reports',{...input,target_year_month:`${year}-12`,work_date:`${year}-12-01`})).http,201,'12月の通常入力を許可');
    row=(await api(`${endpoint}/${id}`)).closing;
    assert.equal((await api(`${endpoint}/${id}/review`,{version:row.version,project_ids:[projectId],action:'approve'})).http,200);
    row=(await api(`${endpoint}/${id}`)).closing;
    const [beforeCash]=await pool.query('SELECT COUNT(*) n FROM cash_schedules');
    const [beforeNormal]=await pool.query('SELECT COUNT(*) n FROM settlement_documents');
    const finalized=await api(`${endpoint}/${id}/finalize`,{version:row.version});assert.equal(finalized.http,200,JSON.stringify(finalized));assert.equal(finalized.documents.length,2);
    const final=await api(`${endpoint}/${id}`);assert.equal(final.closing.status,'finalized');assert.equal(final.closing.snapshot_data.totals.billing,12100000);
    const [afterCash]=await pool.query('SELECT COUNT(*) n FROM cash_schedules');assert.equal(afterCash[0].n,beforeCash[0].n);
    const [afterNormal]=await pool.query('SELECT COUNT(*) n FROM settlement_documents');assert.equal(afterNormal[0].n,beforeNormal[0].n);
    const pdf=await fetch(base+`${endpoint}/${id}/documents/${final.documents[0].annual_document_id}`,{headers:{cookie}});assert.equal(pdf.status,200);assert.equal(Buffer.from(await pdf.arrayBuffer()).subarray(0,4).toString(),'%PDF');
    const previousSnapshot=JSON.stringify(final.closing.snapshot_data);
    const correction={...body,correction_of_id:id,reason:'匿名訂正版'};correction.source_token=(await api(endpoint+'/preview',correction)).preview.source_token;
    const corrected=await api(endpoint+'/draft',correction);assert.equal(corrected.http,200,JSON.stringify(corrected));assert.notEqual(corrected.annual_closing_id,id);
    assert.equal(JSON.stringify((await api(`${endpoint}/${id}`)).closing.snapshot_data),previousSnapshot);
    assert.equal((await api('/api/daily-reports',{...input,target_year_month:`${year}-12`,work_date:`${year}-11-29`})).http,201,'理由付き訂正開始で当該年度の入力保護を解除');
    console.log('[integration] annual 1210/1230万円, dedicated review/PDF, no cash or normal issue, November lock/December input, immutable revision passed');
  }finally{if(server){server.closeAllConnections();await new Promise(r=>server.close(r));}await pool.end();}
})().then(()=>process.exit(0)).catch(e=>{console.error(e);process.exit(1);});
