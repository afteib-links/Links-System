const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const { chromium } = require('playwright');
(async () => {
  const browser = await chromium.launch({headless:true,...(process.env.PLAYWRIGHT_CHANNEL ? {channel:process.env.PLAYWRIGHT_CHANNEL} : {})});
  try {
    const page = await browser.newPage({viewport:{width:1366,height:900}});
    const errors=[]; page.on('pageerror',e=>errors.push(e.message));
    await page.setContent('<main id="app"></main>');
    await page.addStyleTag({path:path.resolve(__dirname,'../../frontend/css/styles.css')});
    for(const name of ['time-input','daily-entry-ui','pdf_imports']) await page.addScriptTag({path:path.resolve(__dirname,`../../frontend/js/${name}.js`)});
    await page.evaluate(async () => {
      const values={work_date:'2026-09-01',start_time:'08:00',end_time:'17:00',break_minutes:60};
      const row={daily_report_import_row_id:1,source_row_number:1,version:1,candidate:values,raw_data:{work_date:'9/1',start_time:'8:00',end_time:'17:00',break_minutes:'1:00'},warnings:{},current_ids:[11],initially_selected:false};
      window.fixture={batch:{target_year_month:'2026-09',extra_data:{project_id:1}},file:{name:'匿名日報.pdf'},jobs:[],pages:[],period:{period_start:'2026-09-01',period_end:'2026-09-30'},rows:[row],current_reports:[{...values,daily_report_id:11,version:2,toll_fee:1500}]};
      window.LinksFeatureKit={createFeatureKit:()=>({shell:(title,html)=>`<h1>${title}</h1>${html}`,bindShell:()=>{},modalHtml:(title,html,footer)=>`<div id="test-modal"><h2>${title}</h2>${html}${footer}</div>`,bindModal:()=>()=>document.getElementById('test-modal').remove()})};
      const escape=s=>String(s).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('"','&quot;');
      await window.LinksPdfImports.open({app:document.getElementById('app'),currentUser:{roles:['soumu']},escapeHtml:escape,api:async(url,options={})=> {
        if(url.includes('month-projects'))return {res:{ok:true},data:{ok:true,rows:[{project_id:1,company_name:'匿名企業',partner_name:'匿名担当'}]}};
        if(url.endsWith('/calculation-preview'))return {res:{ok:true},data:{ok:true,preview_token:'checked',automatic:{billing:{overtime_minutes:30}},calculated:{billing:{overtime_minutes:15}},billing_amount:10500,payment_amount:8000}};
        if(options.body) { window.applied=JSON.parse(options.body); return {res:{ok:true},data:{ok:true,applied:[{skipped:false}]}}; }
        return {res:{ok:true},data:{ok:true,...window.fixture}};
      }},{batchId:1,onBack:()=>{}});
    });
    assert.equal(await page.locator('[data-select]').isChecked(),false);
    assert.equal(await page.locator('[data-include]:checked').count(),0);
    assert.ok((await page.locator('.pdf-compare-row').boundingBox()).height < 160,'通常の比較行は160px未満');
    assert.ok((await page.locator('[data-side="ocr"][data-value="work_date"]').boundingBox()).width >= 140,'日付全体とカレンダーアイコンの幅を確保する');
    const input=(side,field)=>page.locator(`[data-side="${side}"][data-value="${field}"]`);
    await input('proposed','end_time').fill('1730'); await page.keyboard.press('Tab');
    await input('ocr','end_time').fill('1800'); await page.keyboard.press('Tab');
    assert.equal(await input('proposed','end_time').inputValue(),'17:30','右側の手修正を優先');
    await input('ocr','start_time').fill('２．３０'); await page.keyboard.press('Tab');
    assert.equal(await input('proposed','start_time').inputValue(),'02:30');
    await input('proposed','start_time').fill('2.3'); await page.keyboard.press('Tab');
    assert.equal(await input('proposed','start_time').inputValue(),'2.3');
    assert.equal(await input('proposed','start_time').evaluate(el=>el.validity.valid),false);
    await input('proposed','start_time').fill('800'); await page.keyboard.press('Tab');
    await input('proposed','end_time').focus(); await page.keyboard.press('Alt+ArrowDown');
    await page.locator('dialog [name=hour]').selectOption('28'); await page.locator('dialog [name=minute]').selectOption('1');
    await page.locator('dialog button[value=apply]').click(); await page.locator('dialog').waitFor({state:'detached'});
    assert.equal(await input('proposed','end_time').inputValue(),'28:01');
    await page.keyboard.press('Tab');
    assert.notEqual(await page.evaluate(()=>document.activeElement.tagName),'BUTTON');
    await page.locator('[data-select]').check(); await page.locator('[data-include=end_time]').check();
    await page.locator('.pdf-row-details summary').click();
    await page.locator('[data-reason]').fill('原本照合');
    await page.locator('#pdf-apply').click();
    const request=await page.evaluate(()=>window.applied.rows[0]);
    assert.deepEqual(request.fields,['end_time']); assert.equal(request.values.end_time,'28:01'); assert.equal(request.expected_version,2);
    await page.locator('#pdf-extra').check();await page.locator('.pdf-adoption summary').click();
    await page.locator('[data-adoption=quantity]').check();await page.locator('[data-adoption=billing_hours]').fill('0.25');await page.locator('[data-adoption=billing_hours]').blur();
    await page.locator('.pdf-row-details summary').click();await page.locator('[data-reason]').fill('採用根拠');
    await page.locator('[data-preview-adoption]').click();
    assert.match(await page.locator('[data-adoption-preview]').textContent(),/30 → 15/);
    const financial=await page.evaluate(()=>window.LinksPdfImports.rowRequest(window.LinksPdfImports.drafts.get(1)));
    assert.equal(financial.quantity_overrides.billing.overtime_minutes,15);assert.equal(financial.preview_token,'checked');
    await page.locator('[data-adoption=billing_hours]').fill('0.5');
    assert.equal(await page.evaluate(()=>window.LinksPdfImports.drafts.get(1).previewToken),null,'変更で計算確認を破棄');
    for(const width of [1366,390]){
      await page.setViewportSize({width,height:900});
      assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),`${width}px adoption overflow`);
    }
    await page.setViewportSize({width:1366,height:900});
    await page.locator('#pdf-extra').uncheck();
    fs.mkdirSync(path.resolve(__dirname,'../test-results'),{recursive:true});
    for(const width of [1920,1366,390]) {
      await page.setViewportSize({width,height:900});
      assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),`${width}px overflow`);
      assert.equal(await input('proposed','start_time').evaluate(el=>getComputedStyle(el).fontSize),'16px');
      await page.evaluate(()=>window.scrollTo(0,0));
      await page.screenshot({path:path.resolve(__dirname,`../test-results/pdf-import-${width}.png`),fullPage:true});
    }
    assert.deepEqual(errors,[]);
    await page.evaluate(()=>{window.LinksPdfImports.data.pages=[{page_number:1,pdf_page_id:1,rectification:{proposal:{columns:{work_date:[.03,.17],start_time:[.17,.38],end_time:[.38,.59],break_minutes:[.59,.75]}},status:'rectified',row_edges:[.1,.2,.4,.7,.9]}}];});
    page.once('dialog',dialog=>dialog.accept());
    await page.locator('#pdf-template').click();
    await page.locator('[data-use-lines]').click();
    assert.equal(await page.locator('[data-config=row_count]').inputValue(),'3');
    assert.equal(await page.locator('[data-preview-lines] span').count(),4);
    await page.locator('[data-column-enabled=break_minutes]').uncheck();
    await page.locator('#pdf-start').click();
    const config=await page.evaluate(()=>window.applied.template.pages[0]);
    assert.deepEqual(config.row_edges,[.2,.4,.7,.9]);
    assert.equal(config.columns.break_minutes,undefined,'休憩のない帳票で読取を省略できる');
    console.log('[e2e] PDF initial protection, field selection, manual priority, time picker and responsive passed');
  } finally { await browser.close(); }
})().catch(e=>{console.error(e);process.exitCode=1;});
