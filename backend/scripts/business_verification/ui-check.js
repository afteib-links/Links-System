const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const path=require('node:path');
const {environment}=require('./runtime');
async function main(){
  const env=environment(),base=`http://127.0.0.1:${Number(process.env.VERIFICATION_PORT||18080)}`;
  const browser=await require('playwright').chromium.launch({headless:true,executablePath:process.env.PDF_CHROMIUM_EXECUTABLE_PATH||undefined});
  try{
    const page=await browser.newPage({viewport:{width:1440,height:1000}}),errors=[];
    page.on('pageerror',e=>errors.push(e.message));
    const health=await (await page.request.get(base+'/api/health')).json();assert.equal(health.db,'up');
    await page.goto(base);await page.locator('#login_id').fill('verification-admin');await page.locator('#password').fill(process.env.VERIFICATION_PASSWORD||'Verification93!');await page.locator('#login-form button[type="submit"]').click();
    await page.locator('[data-nav-feature="companies"]').waitFor();
    const checks=[];await fs.mkdir(path.join(env.out,'ui'),{recursive:true});
    for(const feature of ['companies','partners','projects','daily_reports','advances','invoices','payments','cash_management']){
      await page.locator(`[data-nav-feature="${feature}"]`).click();
      await page.waitForLoadState('networkidle');
      await page.screenshot({path:path.join(env.out,'ui',feature+'.png'),fullPage:false});
      const body=await page.locator('body').innerText();assert.ok(!body.includes('取得に失敗しました'),feature);
      checks.push({feature,title:await page.locator('.topbar-page-title').innerText()});
    }
    assert.deepEqual(errors,[]);const result={status:'passed',health:health.db,checks};await fs.writeFile(path.join(env.out,'ui-result.json'),JSON.stringify(result,null,2));console.log(JSON.stringify(result,null,2));
  }finally{await browser.close();}
}
main().then(()=>process.exit(0)).catch(e=>{console.error(e.stack);process.exit(1);});
