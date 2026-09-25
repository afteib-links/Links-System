'use strict';
// Read-only UI/API smoke test against the running app; does not save any form.
const assert=require('node:assert/strict');
const {chromium}=require('/app/backend/node_modules/playwright');
const parse=x=>typeof x==='string'?JSON.parse(x):x||{};
async function main(){
  const browser=await chromium.launch({headless:true,args:['--no-sandbox']});
  const page=await browser.newPage({viewport:{width:1440,height:1000}}),errors=[];
  page.on('pageerror',e=>errors.push(e.message));
  try{
    const login=await page.request.post('http://127.0.0.1:3000/api/auth/login',{data:{login_id:process.env.ADMIN_LOGIN_ID,password:process.env.ADMIN_PASSWORD}});
    assert.equal(login.status(),200,'Configured application login must succeed');
    const response=await page.request.get('http://127.0.0.1:3000/api/price-sets');
    const data=await response.json();assert.ok(data.ok);
    const sets=data.price_sets.filter(r=>parse(r.extra_data).legacy_analysis);
    assert.ok(sets.length>0);
    const selected=[sets.find(r=>r.base_project_id),sets.find(r=>r.project_id&&parse(r.extra_data).legacy_analysis.calculation_status==='ready'),sets.find(r=>r.project_id&&parse(r.extra_data).legacy_analysis.calculation_status==='review_required')];
    await page.goto('http://127.0.0.1:3000/',{waitUntil:'networkidle'});
    await page.locator('[data-nav-feature="price_sets"]').click();
    await page.locator('#price-sets-table').waitFor();
    assert.ok(await page.getByText('原本照合',{exact:true}).count());
    for(const r of selected){
      assert.ok(r);
      await page.evaluate(id=>window.LinksPriceSets.showDetail(id),r.price_set_id);
      await page.locator('.legacy-analysis-panel').waitFor();
      const panel=await page.locator('.legacy-analysis-panel').innerText();
      assert.match(panel,/原本照合・計算ロジック/);
      assert.match(panel,/qwen3.5:4b/);
      assert.match(panel,/検算差額/);
      assert.ok(await page.locator('[data-fee-row]').count());
      if(parse(r.extra_data).legacy_analysis.calculation_status==='review_required')assert.match(panel,/自動計算は保留/);
      if(r.base_project_id)assert.match(panel,/最初のデータ一式/);
    }
    await page.locator('.legacy-analysis-panel').scrollIntoViewIfNeeded();
    await page.screenshot({path:'/tmp/legacy-rate-analysis-ui.png'});
    assert.deepEqual(errors,[]);
    console.log(JSON.stringify({api_current_sets:sets.length,details_checked:selected.length,source_rows_visible:true,browser_errors:errors.length}));
  }finally{await browser.close();}
}
main().catch(e=>{console.error(e.stack);process.exitCode=1;});
