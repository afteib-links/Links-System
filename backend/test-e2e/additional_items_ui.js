const assert=require('node:assert/strict');const path=require('node:path');const fs=require('node:fs');const {chromium}=require('playwright');
(async()=>{const browser=await chromium.launch({headless:true,...(process.env.PLAYWRIGHT_CHANNEL?{channel:process.env.PLAYWRIGHT_CHANNEL}:{})});try{
  const page=await browser.newPage({viewport:{width:1366,height:900}}),errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.setContent('<main id="app"></main>');await page.addStyleTag({path:path.resolve(__dirname,'../../frontend/css/styles.css')});
  for(const file of ['feature-kit','additional_items'])await page.addScriptTag({path:path.resolve(__dirname,`../../frontend/js/${file}.js`)});
  await page.evaluate(async()=>{
    const original=window.LinksFeatureKit.createFeatureKit;
    window.LinksFeatureKit.createFeatureKit=ctx=>({...original(ctx),shell:(title,html)=>`<h1>${title}</h1>${html}`,bindShell:()=>{}});
    const masters=[{additional_item_master_id:1,item_name:'自家用燃料費',calculation_method:'fuel',applies_to:'payment',tax_category:'tax_inclusive'},{additional_item_master_id:2,item_name:'追加作業',calculation_method:'direct',applies_to:'both',tax_category:'taxable'}];
    const escape=s=>String(s??'').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('"','&quot;');
    await window.LinksAdditionalItems.open({app:document.getElementById('app'),escapeHtml:escape,currentUser:{roles:['soumu']},api:async(url,options)=>{
      let data={ok:true};const b=options.body?JSON.parse(options.body):null;
      if(url.endsWith('/masters'))data.masters=masters;
      else if(url.includes('/preview')){window.previewBody=b;data.preview={...b,billing_amount:0,payment_amount:9920,preview_token:'anonymous',calculation_method:'fuel',calculation_data:{fuel:{days:[],attendance_days:20,reference_date:b.inputs.reference_date,missing:[]}}};}
      else if(url.includes('/fuel'))data={...data,conditions:[],prices:[],runs:[],settings:{fetch_time_jst:'10:00:00',version:1},project:{project_id:1,partner_id:2}};
      else if(b)window.saved=b;
      else data={...data,period:{period_start:'2026-09-01',period_end:'2026-09-30'},items:[]};
      return {res:{ok:true},data};
    }},{projectId:1,ym:'2026-09',projectName:'匿名案件',onBack:()=>{}});
  });
  await page.locator('#extra-new').click();assert.equal(await page.locator('#extra-save').isDisabled(),true);
  await page.locator('[name=reference_date]').fill('2026-09-01');await page.locator('#extra-calc').click();
  assert.match(await page.locator('#extra-preview').innerText(),/9,920円/);assert.equal(await page.locator('#extra-save').isDisabled(),false);
  await page.locator('[name=reason]').fill('確認');assert.equal(await page.locator('#extra-save').isDisabled(),true);
  await page.locator('#extra-calc').click();await page.locator('#extra-save').click();await page.locator('#modal-backdrop').waitFor({state:'detached'});
  assert.equal(await page.evaluate(()=>window.saved.preview_token),'anonymous');assert.equal(await page.evaluate(()=>window.saved.reason),'確認');
  await page.locator('#extra-fuel').click();fs.mkdirSync(path.resolve(__dirname,'../test-results'),{recursive:true});
  for(const width of [1920,1366,390]){await page.setViewportSize({width,height:900});assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));await page.screenshot({path:path.resolve(__dirname,`../test-results/fuel-settings-${width}.png`),fullPage:true});}
  assert.deepEqual(errors,[]);console.log('[e2e] fuel preview/save invalidation and settings responsive passed');
}finally{await browser.close();}})().catch(e=>{console.error(e);process.exitCode=1;});
