const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { chromium } = require('playwright');

const root = path.resolve(__dirname, '../..');

function mockData(url) {
  if (url.includes('/cycles')) return { ok:true, cycles:[
    { cash_cycle_id:1,cycle_code:'05',base_date:'2026-09-05',planned_incoming_date:'2026-09-07',planned_outgoing_date:'2026-09-04' },
    { cash_cycle_id:2,cycle_code:'10',base_date:'2026-09-10',planned_incoming_date:'2026-09-10',planned_outgoing_date:'2026-09-10' },
  ] };
  if (url.includes('/schedules')) return { ok:true, schedules:[
    { cash_schedule_id:11,cash_cycle_id:2,cycle_code:'10',direction:'outgoing',scheduled_date:'2026-09-10',counterparty_name:'匿名パートナーA',title:'8月分支払',amount:250000,status:'planned',partner_id:1,bank_code:'0001',bank_name:'テスト銀行',branch_code:'001',branch_name:'本店',deposit_type:'ordinary',account_number:'1234567',account_name_kana:'トクメイパートナーエー',executed_amount:0 },
    { cash_schedule_id:12,cash_cycle_id:2,cycle_code:'10',direction:'incoming',scheduled_date:'2026-09-10',counterparty_name:'匿名企業B',title:'8月分請求',amount:620000,status:'planned',executed_amount:0 },
    { cash_schedule_id:13,cash_cycle_id:1,cycle_code:'05',direction:'outgoing',scheduled_date:'2026-09-04',counterparty_name:'匿名パートナーC',title:'前払',amount:80000,status:'exported',partner_id:2,bank_code:'0002',bank_name:'テスト銀行',branch_code:'002',branch_name:'西支店',deposit_type:'ordinary',account_number:'7654321',account_name_kana:'トクメイシー',executed_amount:0 },
  ] };
  if (url.includes('/exports')) return { ok:true,batches:[{ cash_export_batch_id:5,cash_cycle_id:1,cycle_code:'05',export_kind:'bank_csv',file_name:'test_20260904_05.csv',item_count:1,status:'active',profile_name:'確認用銀行CSV',profile_version_no:1 }] };
  if (url.includes('/bank-export-options')) return { ok:true,accounts:[{ source_bank_account_id:3,account_label:'りそな本口座',bank_name:'りそな銀行',masked_account_number:'***4567',published_version_no:1 }] };
  return { ok:true };
}

async function inspect(browser, viewport) {
  const page = await browser.newPage({ viewport });
  const css = await fs.readFile(path.join(root, 'frontend/css/styles.css'), 'utf8');
  const kit = await fs.readFile(path.join(root, 'frontend/js/feature-kit.js'), 'utf8');
  const screen = await fs.readFile(path.join(root, 'frontend/js/cash_management.js'), 'utf8');
  await page.setContent(`<style>${css}</style><div id="app"></div>`);
  await page.addScriptTag({ content:kit });
  await page.addScriptTag({ content:screen });
  await page.evaluate(async (data) => {
    const escapeHtml = (value) => String(value ?? '').replace(/[&<>"']/g, (char) => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;' }[char]));
    const ctx = {
      app:document.getElementById('app'), currentUser:{ roles:['admin'] }, escapeHtml,
      renderLoading(){ this.app.innerHTML='<div>loading</div>'; },
      headerHtml(){ return '<header class="app-header app-topbar"><strong>LinksSys</strong></header>'; },
      sidebarHtml(){ return '<aside class="app-sidebar">メニュー</aside>'; }, bindChrome(){}, bindLogout(){}, showToast(){}, showHome(){},
      async api(url){ return { res:{ ok:true }, data:data[url.includes('/cycles')?'cycles':url.includes('/schedules')?'schedules':url.includes('/exports')?'exports':'options'] }; },
    };
    await window.LinksCashManagement.open(ctx);
  }, { cycles:mockData('/cycles'), schedules:mockData('/schedules'), exports:mockData('/exports'), options:mockData('/bank-export-options') });
  await page.locator('.cash-calendar-grid').waitFor();
  assert.equal(await page.locator('.cash-calendar-day').filter({ hasText:'入 ￥620,000' }).count(), 1);
  await page.locator('[data-view="list"]').click();
  const layout = await page.evaluate(() => {
    const box = (selector) => {
      const rect = document.querySelector(selector)?.getBoundingClientRect();
      return rect ? { left:rect.left, right:rect.right, top:rect.top, bottom:rect.bottom, width:rect.width } : null;
    };
    return { checkbox:box('[data-select-schedule="11"]'), main:box('.cash-main'), aside:box('.cash-aside'), workspace:box('.cash-workspace') };
  });
  assert.ok(layout.checkbox.right <= layout.main.right, `${viewport.width}pxで一覧の選択欄がメイン領域内に収まること: ${JSON.stringify(layout)}`);
  await page.locator('[data-select-schedule="11"]').check();
  assert.equal(await page.locator('#preview-bank-export').isEnabled(), true);
  assert.match(await page.locator('.cash-selected-summary').first().innerText(), /1件/);
  const widths = await page.evaluate(() => ({ scroll:document.documentElement.scrollWidth,client:document.documentElement.clientWidth }));
  assert.ok(widths.scroll <= widths.client + 1, `${viewport.width}pxでページ全体が横にはみ出さないこと`);
  await page.evaluate(() => window.scrollTo(0, 0));
  const output = path.join(os.tmpdir(), `bank-export-ui-${viewport.width}.png`);
  await page.screenshot({ path:output, fullPage:true });
  await page.close();
  return output;
}

(async () => {
  const executablePath = process.env.PLAYWRIGHT_CHROME_PATH || 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
  const browser = await chromium.launch({ headless:true, executablePath });
  try {
    const desktop = await inspect(browser, { width:1440,height:1000 });
    const mobile = await inspect(browser, { width:390,height:844 });
    console.log(`[e2e] bank export UI verified: ${desktop}, ${mobile}`);
  } finally { await browser.close(); }
})().catch((error) => { console.error(error); process.exit(1); });
