const assert = require('node:assert/strict');
const { chromium } = require('playwright');
const { createApp } = require('../src/server');
const { getPool } = require('../src/db');

async function main() {
  assert.match(process.env.DB_NAME || '', /test|ci|verification/i);
  const pool = getPool();
  let server, browser;
  try {
    const [company] = await pool.query("INSERT INTO companies(company_name) VALUES ('PDF匿名企業')");
    const [billing] = await pool.query("INSERT INTO company_billings(company_id,billing_no,billing_print_name) VALUES (?,0,'PDF匿名企業')", [company.insertId]);
    const [partner] = await pool.query("INSERT INTO partners(partner_name) VALUES ('PDF匿名担当')");
    const [project] = await pool.query("INSERT INTO projects(company_id,billing_id,partner_id,closing_date,business_type) VALUES (?,?,?,'end','PDF匿名検証')", [company.insertId,billing.insertId,partner.insertId]);
    server = (await createApp()).listen(0,'127.0.0.1');
    await new Promise(resolve => server.once('listening',resolve));
    const base = `http://127.0.0.1:${server.address().port}`;
    let cookie = '';
    async function api(url,body,method='POST') {
      const response = await fetch(base+url,{method:body===undefined?'GET':method,headers:{cookie,...(body instanceof FormData?{}:{'content-type':'application/json'})},body:body===undefined?undefined:body instanceof FormData?body:JSON.stringify(body)});
      if (response.headers.get('set-cookie')) cookie=response.headers.get('set-cookie').split(';')[0];
      return {status:response.status,data:await response.json()};
    }
    assert.equal((await api('/api/auth/login',{login_id:process.env.ADMIN_LOGIN_ID,password:process.env.ADMIN_PASSWORD})).status,200);
    const created = await api('/api/daily-reports',{project_id:project.insertId,company_id:company.insertId,partner_id:partner.insertId,target_year_month:'2026-09',work_date:'2026-09-01',start_time:'08:00',end_time:'17:00',break_minutes:60,toll_fee:1500});
    assert.equal(created.status,201,JSON.stringify(created));
    const current=created.data.report;
    browser=await chromium.launch({headless:true});
    const page=await browser.newPage();
    await page.setContent(`<style>*{box-sizing:border-box}body{margin:0;font:36px sans-serif}.table{position:absolute;top:100px;left:40px;width:720px}.row{display:flex;height:100px}.cell{width:180px;border:1px solid black;display:flex;align-items:center;justify-content:center}</style><small>anonymous ${project.insertId}</small><div class="table">${[['9/1','8:00','17:15','1:00'],['9/2','8:00','17:45','1:00'],['9/h','7:o0','18:00','1:00']].map(row=>`<div class="row">${row.map(v=>`<div class="cell">${v}</div>`).join('')}</div>`).join('')}</div>`);
    const pdf=await page.pdf({width:'800px',height:'1000px',margin:{top:0,bottom:0,left:0,right:0},printBackground:true});
    const form=new FormData(); form.set('file',new Blob([pdf],{type:'application/pdf'}),'anonymous-ocr.pdf'); form.set('target_year_month','2026-09');
    const uploaded=await api('/api/daily-report-imports/pdf/uploads',form);
    assert.equal(uploaded.status,201,JSON.stringify(uploaded));
    const id=uploaded.data.batch_id;
    const endpoint=`/api/daily-report-imports/pdf/${id}`;
    async function waitJob() {
      for(let attempt=0;attempt<180;attempt++) {
        const result=await api(endpoint);
        const job=result.data.jobs[0];
        if(job?.status==='failed') throw new Error(JSON.stringify(job));
        if(job?.status==='completed') return result.data;
        await new Promise(resolve=>setTimeout(resolve,1000));
      }
      throw new Error('OCR job timeout');
    }
    const rendered=await waitJob(); assert.equal(rendered.pages.length,1);
    const template={pages:[{page_number:1,top:.1,bottom:.4,row_count:3,columns:{work_date:[.05,.275],start_time:[.275,.5],end_time:[.5,.725],break_minutes:[.725,.95]}}]};
    const configured=await api(endpoint+'/configure',{project_id:project.insertId,template,template_name:'匿名3行帳票'});
    assert.equal(configured.status,200,JSON.stringify(configured));
    const recognized=await waitJob();
    assert.ok(recognized.pages[0].rectification.method,'保存ページの補正情報を保持する');
    assert.equal(recognized.rows.length,3); assert.ok(recognized.rows.every(row=>row.has_image));
    const metrics=typeof recognized.jobs[0].metrics==='string'?JSON.parse(recognized.jobs[0].metrics):recognized.jobs[0].metrics;
    assert.equal(metrics.mode,'ocr',JSON.stringify(recognized.jobs[0]));
    const [first,second]=recognized.rows;
    assert.equal(first.initially_selected,false,'既存行は初期OFF');
    const raw=JSON.stringify(first.raw_data);
    const row={import_row_id:first.daily_report_import_row_id,import_version:first.version,target_daily_report_id:current.daily_report_id,expected_version:current.version,fields:['end_time','toll_fee'],values:{end_time:'1730',toll_fee:''},date_confirmed:true,reason:'匿名原本との照合'};
    const changed=await api(endpoint+'/apply',{rows:[row]}); assert.equal(changed.status,200,JSON.stringify(changed));
    const replay=await api(endpoint+'/apply',{rows:[row]}); assert.equal(replay.status,200); assert.equal(replay.data.applied[0].skipped,true);
    const [saved]=await pool.query('SELECT * FROM daily_reports WHERE daily_report_id=?',[current.daily_report_id]);
    assert.equal(saved[0].start_time,'08:00:00'); assert.equal(saved[0].end_time,'17:30:00'); assert.equal(Number(saved[0].toll_fee),1500); assert.equal(saved[0].input_source_type,'manual');
    const after=await api(endpoint); assert.equal(JSON.stringify(after.data.rows[0].raw_data),raw);
    const conflict=await api(endpoint+'/apply',{rows:[{...row,import_row_id:second.daily_report_import_row_id,import_version:second.version,values:{end_time:'1900'}}]}); assert.equal(conflict.status,409);
    const next={import_row_id:second.daily_report_import_row_id,import_version:second.version,fields:['work_date','start_time','end_time','break_minutes'],values:{work_date:'2026-09-02',start_time:'800',end_time:'1745',break_minutes:60},date_confirmed:true};
    const inserted=await api(endpoint+'/apply',{rows:[next]}); assert.equal(inserted.status,200,JSON.stringify(inserted));
    const newId=inserted.data.applied[0].daily_report_id;
    await pool.query("UPDATE daily_reports SET status='confirmed',version=version+1 WHERE daily_report_id=?",[newId]);
    const fresh=await api(endpoint); const imported=fresh.data.rows[1];
    const [locked]=await pool.query('SELECT version FROM daily_reports WHERE daily_report_id=?',[newId]);
    const denied=await api(endpoint+'/apply',{rows:[{...next,import_version:imported.version,target_daily_report_id:newId,expected_version:locked[0].version,fields:['end_time'],values:{end_time:'1800'},reason:'ロック検証'}]}); assert.equal(denied.status,409);
    assert.equal((await api(`/api/daily-report-imports/${id}/apply`,{row_ids:[first.daily_report_import_row_id]})).status,400);
    assert.equal((await api(endpoint+'/retry',{job_id:recognized.jobs[0].ocr_job_id})).status,409,'反映済みの画像を再生成しない');
    const image=await fetch(base+`${endpoint}/image/row/${first.daily_report_import_row_id}`,{headers:{cookie}});
    assert.equal(image.status,200); assert.match(image.headers.get('content-type'),/image\/png/);
    const records=await api(`/api/daily-report-imports/pdf/records/${current.daily_report_id}`);
    assert.equal(records.status,200);assert.ok(records.data.records.some(r=>r.daily_report_import_batch_id===id));
    const ExcelJS=require('exceljs'),book=new ExcelJS.Workbook();
    for(const name of ['見本','原本']){const sheet=book.addWorksheet(name);sheet.addRow(['日付','開始','終了','業務経費']);sheet.addRow([2,'08:00','17:00','1500円']);}
    const excelForm=new FormData();excelForm.set('file',new Blob([await book.xlsx.writeBuffer()]),`anonymous-${project.insertId}.xlsx`);excelForm.set('target_year_month','2026-09');
    const excel=await api('/api/daily-report-imports/pdf/uploads',excelForm);assert.equal(excel.status,201,JSON.stringify(excel));
    const xurl=`/api/daily-report-imports/pdf/${excel.data.batch_id}`;
    assert.equal((await api(xurl)).data.rows.length,0,'シート確認前に日報候補を作らない');
    assert.equal((await api(xurl+'/workbook',{project_id:project.insertId,sheet_name:'原本'})).status,200);
    const xrows=(await api(xurl)).data.rows;assert.equal(xrows.length,1);assert.equal(xrows[0].source_sheet,'原本');assert.equal(xrows[0].observations.business_expense,1500);
    const jpegForm=new FormData();jpegForm.set('file',new Blob([await page.screenshot({type:'jpeg'})]),`anonymous-${project.insertId}.jpg`);jpegForm.set('target_year_month','2026-09');
    const jpeg=await api('/api/daily-report-imports/pdf/uploads',jpegForm);assert.equal(jpeg.status,201,JSON.stringify(jpeg));
    assert.equal((await api(`/api/daily-report-imports/pdf/${jpeg.data.batch_id}`)).data.file.mime_type,'image/jpeg');
    console.log('[integration] PDF render/OCR/field selection/idempotency/concurrency/lock/source preservation passed',JSON.stringify(metrics));
  } finally {
    if(browser) await browser.close();
    if(server) { server.closeAllConnections(); await new Promise(resolve=>server.close(resolve)); }
    await pool.end();
  }
}
main().then(()=>process.exit(0)).catch(error=>{console.error(error);process.exit(1);});
