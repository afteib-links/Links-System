// Anonymous browser fixture: exercises production UI without writing a business DB.
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const { chromium } = require('playwright');
const frontend = path.resolve(__dirname, '../../frontend');

(async () => {
  const browser = await chromium.launch({ headless: true, ...(process.env.PLAYWRIGHT_CHANNEL ? {channel:process.env.PLAYWRIGHT_CHANNEL} : {}) });
  try {
    const page = await browser.newPage({ viewport: { width: 1366, height: 768 } });
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.setContent('<div id="app"></div>');
    await page.addStyleTag({ path: path.join(frontend, 'css/styles.css') });
    for (const file of ['time-input', 'daily-entry-ui', 'daily_reports']) await page.addScriptTag({ path: path.join(frontend, `js/${file}.js`) });
    await page.evaluate(() => {
      const dr = window.LinksDailyReports;
      const escape = value => String(value ?? '').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('"','&quot;');
      dr.ctx = { app: document.getElementById('app'), escapeHtml: escape, currentUser: {roles:['soumu']}, showToast: () => {}, api: async (url, options) => {
        if (url.includes('calculation-context')) return {res:{ok:true}, data:{ok:true, context:{}}};
        const payload = JSON.parse(options.body);
        window.savedPayloads.push(payload);
        if (window.saveDelay) await new Promise(resolve => setTimeout(resolve, window.saveDelay));
        return {res:{ok:true},data:{ok:true,report:{...payload,daily_report_id:payload.work_date.slice(-2) * 1, version:(payload.version || 1)+1, work_hours:8, calculated_billing_amount:20000,calculated_payment_amount:15000}}};
      }};
      dr.kit = { dateValue: value => String(value).slice(0,10), timeValue: value => String(value || '').slice(0,5), money: value => `${Number(value || 0).toLocaleString()}円`, unitPrice: String, shell: (title, html) => `<h1>${title}</h1>${html}`, bindShell: () => {} };
      dr.ym = '2026-09'; dr.gridMeta = {project_id:1,company_id:1,partner_id:1,company_name:'匿名企業',partner_name:'匿名パートナー',project_name:'匿名案件'};
      dr.gridRows = Array.from({length:20}, (_,idx) => dr.emptyDay(`2026-09-${String(idx+1).padStart(2,'0')}`, dr.gridMeta));
      dr.gridRows[1].toll_fee = 1500;
      window.savedPayloads = [];
      dr.renderGrid();
    });
    const time = (field, row) => page.locator(`[data-${field === 'break_minutes' ? 'minutes-f' : 'f'}="${field}"][data-idx="${row}"]`);
    await time('start_time',0).focus();
    for (let i=0; i<20; i++) {
      for (const [field, value] of [['start_time','8'],['end_time','1730'],['break_minutes','1.00']]) {
        assert.equal(await page.evaluate(() => document.activeElement.dataset.f || document.activeElement.dataset.minutesF), field);
        assert.equal(await page.evaluate(() => document.activeElement.dataset.idx), String(i));
        await page.keyboard.insertText(value);
        await page.keyboard.press('Tab');
      }
    }
    assert.equal(await time('start_time',0).inputValue(),'08:00');
    await page.keyboard.press('Shift+Tab');
    assert.equal(await page.evaluate(() => document.activeElement.dataset.idx),'19');
    await time('start_time',0).fill('２．３０');
    await page.keyboard.press('Tab');
    assert.equal(await time('start_time',0).inputValue(),'02:30');
    await time('end_time',0).fill('28:00'); await page.keyboard.press('Tab');
    await time('start_time',0).fill('2.3'); await page.keyboard.press('Tab');
    assert.equal(await time('start_time',0).getAttribute('aria-invalid'),'true');
    await page.keyboard.press('Control+s');
    assert.equal(await page.evaluate(() => window.savedPayloads.length),0);
    assert.equal(await time('start_time',0).inputValue(),'2.3');
    await time('start_time',0).fill('230'); await page.keyboard.press('Tab');
    await time('end_time',0).focus(); await page.keyboard.press('Alt+ArrowDown');
    await page.locator('dialog [name=hour]').selectOption('28');
    await page.locator('dialog [name=minute]').selectOption('15');
    await page.locator('dialog button[value=apply]').click();
    assert.equal(await time('end_time',0).inputValue(),'28:15');
    await page.keyboard.press('F2');
    await page.waitForSelector('[data-expand-row="0"]');
    assert.equal(await page.evaluate(() => !!document.activeElement.closest('.dr-expand')),true);
    const detail = page.locator('[data-expand-row="0"]');
    await detail.locator('[data-common-minutes=night_adjustment]').fill('－０．３０'); await page.keyboard.press('Tab');
    assert.equal(await page.evaluate(() => window.LinksDailyReports.gridRows[0].night_adjustment_minutes_billing),-30);
    await page.keyboard.press('Escape');
    assert.equal(await page.evaluate(() => document.activeElement.dataset.f),'start_time');
    await page.locator('[data-entry-mode=all]').click();
    await time('break_minutes',0).focus(); await page.keyboard.press('Tab');
    assert.equal(await page.evaluate(() => document.activeElement.dataset.f),'total_distance');
    await page.locator('.dr-main [data-f=toll_fee][data-idx="0"]').fill('12.5'); await page.keyboard.press('Tab');
    assert.equal(await page.locator('.dr-main [data-f=toll_fee][data-idx="0"]').getAttribute('aria-invalid'),'true');
    await page.locator('.dr-main [data-f=toll_fee][data-idx="0"]').fill('100'); await page.keyboard.press('Tab');
    await page.locator('[data-entry-mode=time]').click();
    await page.evaluate(() => window.LinksDailyReports.saveAll());
    assert.equal(await page.evaluate(() => window.savedPayloads.length),20);
    assert.equal(await page.evaluate(() => window.LinksDailyReports.gridRows.some(r => r._dirty)),false);
    // Opening details alone must not create dirty rows or repeat saves.
    await page.locator('[data-expand="1"]').click();
    await page.evaluate(() => window.LinksDailyReports.saveAll());
    assert.equal(await page.evaluate(() => window.savedPayloads.length),20);
    // Edits made while a save is in flight survive its response.
    await time('start_time',0).fill('9'); await page.keyboard.press('Tab');
    await page.evaluate(() => {window.saveDelay=150; window.pendingSave=window.LinksDailyReports.saveAll();});
    await time('start_time',0).fill('10'); await page.keyboard.press('Tab');
    await page.evaluate(() => window.pendingSave);
    assert.equal(await page.evaluate(() => window.LinksDailyReports.gridRows[0].start_time),'10:00');
    assert.equal(await page.evaluate(() => window.LinksDailyReports.gridRows[0]._dirty),true);
    // Invalid duration is retained if a detail rerender occurs.
    await time('break_minutes',0).fill('2.3'); await page.keyboard.press('Tab');
    await page.locator('[data-expand="2"]').click();
    assert.equal(await time('break_minutes',0).inputValue(),'2.3');
    await page.evaluate(() => window.LinksDailyReports.leaveGrid(() => { window.leftGrid=true; }));
    assert.equal(await page.evaluate(() => !!window.leftGrid),false);
    await page.locator('[data-expand-row="0"] [data-common-minutes="night_adjustment"]').fill('2.3');
    await page.keyboard.press('Tab');
    await page.locator('[data-expand="0"]').click();
    await time('break_minutes',0).fill('1.00'); await page.keyboard.press('Tab');
    assert.equal(await page.evaluate(() => window.LinksDailyReports.saveAll()),false,'折り畳んだ詳細の不正値も保存しない');
    await page.locator('[data-expand="0"]').click();
    assert.equal(await page.locator('[data-expand-row="0"] [data-common-minutes="night_adjustment"]').inputValue(),'2.3');
    const output = path.resolve(__dirname,'../test-results/daily-entry'); fs.mkdirSync(output,{recursive:true});
    for (const width of [1920,1366,390]) {
      await page.setViewportSize({width,height:900});
      await page.evaluate(() => window.scrollTo(0,0));
      const dimensions = await page.locator('.dr-grid-wrap').evaluate(el => ({client:el.clientWidth,scroll:el.scrollWidth}));
      await page.screenshot({path:path.join(output,`${width}.png`),fullPage:false});
      if (dimensions.scroll > dimensions.client + 2) console.log(await page.locator('.dr-grid-wrap').evaluate(root => Array.from(root.querySelectorAll('*')).filter(el => el.getBoundingClientRect().right > root.getBoundingClientRect().right + 2 && el.getClientRects().length).slice(0,12).map(el => ({tag:el.tagName,cls:el.className,right:el.getBoundingClientRect().right,text:el.textContent.slice(0,40)}))));
      assert.ok(dimensions.scroll <= dimensions.client + 2, `time grid horizontal overflow at ${width}: ${JSON.stringify(dimensions)}`);
      assert.ok(await time('start_time',0).evaluate(el => parseFloat(getComputedStyle(el).fontSize)) >= 16);
      await page.screenshot({path:path.join(output,`${width}.png`),fullPage:false});
    }
    assert.deepEqual(errors,[]);
    console.log('PASS: 20日連続Tab/逆Tab、時刻、時分選択、詳細、整数、保存競合、3画面幅');
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
