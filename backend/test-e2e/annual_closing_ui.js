const assert=require('node:assert/strict');const path=require('node:path');const fs=require('node:fs');const {chromium}=require('playwright');
(async()=>{const browser=await chromium.launch({headless:true,...(process.env.PLAYWRIGHT_CHANNEL?{channel:process.env.PLAYWRIGHT_CHANNEL}:{})});try{
  const page=await browser.newPage({viewport:{width:1366,height:900}}),errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.setContent('<main id="app"></main>');await page.addStyleTag({path:path.resolve(__dirname,'../../frontend/css/styles.css')});
  for(const file of ['feature-kit','annual_closings'])await page.addScriptTag({path:path.resolve(__dirname,`../../frontend/js/${file}.js`)});
  await page.evaluate(async()=>{
    const original=window.LinksFeatureKit.createFeatureKit;window.LinksFeatureKit.createFeatureKit=ctx=>({...original(ctx),shell:(title,html)=>`<h1>${title}</h1>${html}`,bindShell:()=>{}});
    const sums={billing:12100000,payment:8000000,profit:4100000,profit_rate:33.884};
    const preview={source_token:'anonymous',settings:{include_previous_tail:0},normal:{billing:12000000,payment:8000000},tail:{billing:300000,payment:100000},previous:{billing:200000,payment:100000},totals:sums,blockers:[],warnings:[],details:[{project:{project_id:1,company_name:'匿名企業',partner_name:'匿名担当',template_name:'配送案件'},normal:sums,tail:{billing:300000,payment:100000},tail_auto:{billing:300000,payment:100000},tail_manual:{billing:0,payment:0},tail_start:'2026-11-21',tail_end:'2026-11-30',tail_reports:[],tail_items:[],normal_sources:[]}]};
    const escape=s=>String(s??'').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('"','&quot;');
    await window.LinksAnnualClosings.open({app:document.getElementById('app'),escapeHtml:escape,currentUser:{roles:['admin'],user_id:1},api:async(url,options)=>{
      let data={ok:true};const body=options.body?JSON.parse(options.body):null;
      if(url.endsWith('/settings'))data.settings={include_previous_tail:0,version:1};
      else if(url.endsWith('/preview')){data.preview=preview;window.previewPayload=body;}
      else if(url.endsWith('/draft')){window.savedAnnual=body;data.annual_closing_id=1;}
      else if(url.endsWith('/1'))data={...data,closing:{annual_closing_id:1,fiscal_year:2026,revision_no:1,version:1,status:'draft',reason:'匿名年度',snapshot_data:preview},reviews:[],documents:[],reconciliation:null};
      else data.closings=[];
      return {res:{ok:true},data};
    }},{onBack:()=>{}});
  });
  await page.locator('#annual-new').click();assert.equal(await page.locator('#annual-save').isDisabled(),true);
  await page.locator('#annual-preview').click();await page.locator('[name=manual_reason]').fill('月額なし');await page.locator('[name=manual_confirmed]').check();assert.equal(await page.locator('#annual-save').isDisabled(),true);
  await page.locator('#annual-preview').click();assert.match(await page.locator('#annual-preview-result').innerText(),/12,100,000円/);
  fs.mkdirSync(path.resolve(__dirname,'../test-results'),{recursive:true});
  for(const width of [1920,1366,390]){await page.setViewportSize({width,height:900});assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),`${width}px overflow`);await page.screenshot({path:path.resolve(__dirname,`../test-results/annual-${width}.png`),fullPage:true});}
  await page.locator('#annual-save').click();await page.locator('#annual-submit').waitFor();
  assert.equal(await page.evaluate(()=>window.savedAnnual.input.tail_adjustments[0].reason),'月額なし');assert.equal(await page.evaluate(()=>window.savedAnnual.source_token),'anonymous');
  assert.deepEqual(errors,[]);console.log('[e2e] annual input, manual confirmation, preview invalidation and 3 widths passed');
}finally{await browser.close();}})().catch(e=>{console.error(e);process.exitCode=1;});
