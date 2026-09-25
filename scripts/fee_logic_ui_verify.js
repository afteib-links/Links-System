'use strict';
// Read-only smoke test. Never publishes a logic or saves a business form.
const assert = require('node:assert/strict');
const { chromium } = require('/app/backend/node_modules/playwright');
async function main() {
  const browser = await chromium.launch({ headless:true,args:['--no-sandbox'] });
  try {
    const page = await browser.newPage({ viewport:{ width:1440,height:1000 } });
    const errors=[];
    page.on('pageerror',(error)=>errors.push(error.message));
    const base='http://127.0.0.1:3000';
    const login=await page.request.post(base+'/api/auth/login',{ data:{ login_id:process.env.ADMIN_LOGIN_ID,password:process.env.ADMIN_PASSWORD } });
    assert.equal(login.status(),200);
    const catalog=await (await page.request.get(base+'/api/fee-logic')).json();
    assert.equal(catalog.masters.length,6);
    assert.ok(catalog.masters.every((master)=>master.versions.length===1),'Live masters remain at initial formulas');
    await page.goto(base,{ waitUntil:'networkidle' });
    await page.locator('[data-nav-feature="master_settings"]').first().click();
    await page.locator('[data-hub="fee-logic"]').click();
    await page.getByRole('heading',{ name:'料金計算ロジック・グループマスター' }).waitFor();
    assert.equal(await page.locator('[data-revise]').count(),2);
    await page.screenshot({ path:'/tmp/fee-logic-live.png',fullPage:true });
    await page.locator('[data-nav-feature="price_sets"]').first().click();
    await page.locator('#price-sets-table').waitFor();
    const catalogRates=await (await page.request.get(base+'/api/price-sets')).json();
    const rate=catalogRates.price_sets.find((row)=>row.project_id);
    await page.evaluate(async (id)=>window.LinksPriceSets.showDetail(id),rate.price_set_id);
    assert.ok(await page.locator('.fee-logic-group').count());
    const codes=await page.locator('.fee-logic-group').evaluateAll((items)=>items.map((item)=>item.value));
    assert.ok(codes.every((code)=>['daily','hourly','quantity','distance'].includes(code)));
    assert.deepEqual(errors,[]);
    console.log(JSON.stringify({ masters:6,initial_versions_unchanged:true,card_links_visible:codes.length,browser_errors:errors.length }));
  } finally { await browser.close(); }
}
main().catch((error)=>{ console.error(error.stack);process.exitCode=1; });
