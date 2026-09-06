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
  ], holiday_dates:['2026-09-21'] };
  if (url.includes('/schedules')) return { ok:true, schedules:[
    { cash_schedule_id:11,cash_cycle_id:2,cycle_code:'10',direction:'outgoing',scheduled_date:'2026-09-10',counterparty_name:'匿名パートナーA',title:'8月分支払',amount:250000,status:'planned',partner_id:1,bank_code:'0001',bank_name:'テスト銀行',branch_code:'001',branch_name:'本店',deposit_type:'ordinary',account_number:'1234567',account_name_kana:'トクメイパートナーエー',executed_amount:0 },
    { cash_schedule_id:12,cash_cycle_id:2,cycle_code:'10',direction:'incoming',scheduled_date:'2026-09-10',counterparty_name:'匿名企業B',title:'8月分請求',amount:620000,status:'planned',executed_amount:0 },
    { cash_schedule_id:13,cash_cycle_id:1,cycle_code:'05',direction:'outgoing',scheduled_date:'2026-09-04',counterparty_name:'匿名パートナーC',title:'前払',amount:80000,status:'exported',partner_id:2,bank_code:'0002',bank_name:'テスト銀行',branch_code:'002',branch_name:'西支店',deposit_type:'ordinary',account_number:'7654321',account_name_kana:'トクメイシー',executed_amount:0 },
  ] };
  if (url.includes('/exports')) return { ok:true,batches:[{ cash_export_batch_id:5,cash_cycle_id:1,cycle_code:'05',export_kind:'bank_csv',file_name:'test_20260904_05.csv',item_count:1,status:'active',profile_name:'確認用銀行CSV',profile_version_no:1 }] };
  if (url.includes('/balances')) return { ok:true,accounts:[{ source_bank_account_id:3,account_label:'りそな本口座',bank_name:'りそな銀行',masked_account_number:'***4567',opening_balance:1000000,incoming_total:0,outgoing_total:0,balance:1000000 }], total_balance:1000000 };
  if (url.includes('/ledger')) return { ok:true, entries:[] };
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
      async api(url){
        const key = url.includes('/cycles')?'cycles':url.includes('/schedules')?'schedules':url.includes('/exports')?'exports':url.includes('/balances')?'balances':url.includes('/ledger')?'ledger':'options';
        return { res:{ ok:true }, data:data[key] };
      },
    };
    await window.LinksCashManagement.open(ctx);
  }, { cycles:mockData('/cycles'), schedules:mockData('/schedules'), exports:mockData('/exports'), options:mockData('/bank-export-options'), balances:mockData('/balances'), ledger:mockData('/ledger') });
  await page.locator('.cash-calendar-grid').waitFor();
  assert.equal(await page.locator('.cash-calendar-day').filter({ hasText:'入 ￥620,000' }).count(), 1);
  assert.equal(await page.locator('.cash-calendar-day').filter({ hasText:'出 ￥80,000' }).count(), 1);
  assert.equal(await page.locator('[data-calendar-date="2026-09-05"].is-saturday').count(), 1);
  assert.equal(await page.locator('[data-calendar-date="2026-09-06"].is-holiday').count(), 1);
  assert.equal(await page.locator('[data-calendar-date="2026-09-21"].is-holiday').count(), 1);
  const topbarOrder = await page.evaluate(() => {
    const top = document.querySelector('.cash-topbar');
    const month = top?.querySelector('.month-navigator');
    const filters = top?.querySelector('.cash-filterbar');
    const toggle = top?.querySelector('.cash-view-toggle');
    if (!month || !filters || !toggle) return { inTopbar:false };
    return {
      inTopbar: true,
      monthBeforeFilters: Boolean(month.compareDocumentPosition(filters) & Node.DOCUMENT_POSITION_FOLLOWING),
      filtersBeforeToggle: Boolean(filters.compareDocumentPosition(toggle) & Node.DOCUMENT_POSITION_FOLLOWING),
    };
  });
  assert.equal(topbarOrder.inTopbar, true);
  assert.equal(topbarOrder.monthBeforeFilters, true);
  assert.equal(topbarOrder.filtersBeforeToggle, true);
  if (viewport.width >= 1200) {
    const bar = await page.evaluate(() => {
      const box = (selector) => {
        const rect = document.querySelector(selector)?.getBoundingClientRect();
        return rect ? { left:rect.left, right:rect.right, top:rect.top, bottom:rect.bottom } : null;
      };
      return {
        month: box('.cash-topbar .month-navigator'),
        filters: box('.cash-topbar .cash-filterbar'),
        toggle: box('.cash-view-toggle'),
        cards: box('.summary-cards'),
      };
    });
    assert.ok(bar.filters.left >= bar.month.right - 2, '検索が月選択の右にあること');
    assert.ok(bar.toggle.left >= bar.filters.right - 2, 'カレンダー切替が検索の右にあること');
    assert.ok(bar.cards.top >= bar.filters.bottom - 2, 'カードがツールバーの下にあること');
  }
  assert.equal(await page.locator('.summary-card').filter({ hasText:'銀行預金 合計' }).count(), 1);
  assert.equal(await page.locator('.summary-card').filter({ hasText:'りそな本口座 預金' }).count(), 0);
  assert.equal(await page.locator('#adjust-balance').count(), 1);
  assert.equal(await page.locator('[data-new-schedule="incoming"]').count(), 1);
  assert.equal(await page.locator('[data-new-schedule="outgoing"]').count(), 1);
  const monthWrap = await page.evaluate(() => ({
    out: window.LinksCashManagement.businessDate('2026-02-01', 'outgoing'),
    inn: window.LinksCashManagement.businessDate('2026-02-01', 'incoming'),
    endIn: window.LinksCashManagement.businessDate('2026-02-28', 'incoming'),
  }));
  assert.equal(monthWrap.out, '2026-01-30');
  assert.equal(monthWrap.inn, '2026-02-02');
  assert.equal(monthWrap.endIn, '2026-03-02');
  await page.locator('[data-calendar-date="2026-09-05"]').click();
  await page.locator('[data-new-schedule="outgoing"]').click();
  await page.locator('#cash-form').waitFor();
  assert.equal(await page.locator('[name="direction"]').inputValue(), 'outgoing');
  assert.equal(await page.locator('[name="scheduled_date"]').inputValue(), '2026-09-04');
  await page.locator('#modal-close').click();
  await page.locator('[data-new-schedule="incoming"]').click();
  await page.locator('#cash-form').waitFor();
  assert.equal(await page.locator('[name="direction"]').inputValue(), 'incoming');
  assert.equal(await page.locator('[name="scheduled_date"]').inputValue(), '2026-09-07');
  await page.locator('#modal-close').click();
  await page.locator('#adjust-balance').click();
  await page.locator('#cash-ledger-form').waitFor();
  assert.match(await page.locator('#modal-backdrop').innerText(), /りそな本口座/);
  await page.locator('#modal-close').click();
  await page.locator('[data-calendar-date="2026-09-10"]').click();
  assert.equal(await page.locator('[data-calendar-date="2026-09-10"].is-selected').count(), 1);
  assert.equal(await page.locator('.cash-calendar-day').filter({ hasText:'出 ￥80,000' }).count(), 1, 'クリック後も他日の予定が残ること');
  await page.locator('[data-calendar-date="2026-09-04"]').dblclick();
  await page.locator('.cash-schedule-table').waitFor();
  assert.equal(await page.locator('.cash-schedule-table tbody tr').count(), 1);
  assert.match(await page.locator('.cash-schedule-table').innerText(), /前払/);
  await page.locator('#clear-cash-date').click();
  await page.locator('[data-view="list"]').click();
  assert.equal(await page.locator('th').filter({ hasText:'締日' }).count() > 0, true);
  assert.match(await page.locator('.cash-schedule-table').innerText(), /対象外/);
  assert.match(await page.locator('.cash-schedule-table').innerText(), /入金/);
  assert.match(await page.locator('.cash-schedule-table').innerText(), /出金/);
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
  const executablePath = process.env.PLAYWRIGHT_CHROME_PATH || process.env.PLAYWRIGHT_EXECUTABLE_PATH;
  const browser = await chromium.launch({ headless:true, ...(executablePath ? { executablePath } : {}) });
  try {
    const desktop = await inspect(browser, { width:1440,height:1000 });
    const mobile = await inspect(browser, { width:390,height:844 });
    console.log(`[e2e] bank export UI verified: ${desktop}, ${mobile}`);
  } finally { await browser.close(); }
})().catch((error) => { console.error(error); process.exit(1); });
