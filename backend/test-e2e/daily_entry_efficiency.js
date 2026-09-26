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
      dr.kit = { dateValue: value => String(value).slice(0,10), timeValue: value => String(value || '').slice(0,5), money: value => `${Number(value || 0).toLocaleString()}円`, unitPrice: String, shell: (title, html) => `<div class="app-shell app-shell-wide app-shell-scroll-body"><aside class="app-sidebar"></aside><div class="app-frame"><h1>${title}</h1><main class="app-main app-main-wide app-main-scroll-body">${html}</main></div></div>`, bindShell: () => {} };
      dr.ym = '2026-09'; dr.gridMeta = {project_id:1,company_id:1,partner_id:1,company_name:'匿名企業',partner_name:'匿名パートナー',project_name:'匿名案件'};
      dr.gridRows = Array.from({length:20}, (_,idx) => dr.emptyDay(`2026-09-${String(idx+1).padStart(2,'0')}`, dr.gridMeta));
      dr.gridRows[1].toll_fee = 1500;
      dr.gridRows[2].is_training = 1;
      dr.additionalItems=[{work_date:'2026-09-01',item_name:'匿名追加項目',billing_amount:1000,payment_amount:800}];
      window.savedPayloads = [];
      dr.renderGrid();
    });
    const time = (field, row) => page.locator(`[data-${field === 'break_minutes' ? 'minutes-f' : 'f'}="${field}"][data-idx="${row}"]`);
    const rowHeight=async()=> (await page.locator('.dr-main').first().boundingBox()).height;
    const initialHeight=await rowHeight();
    assert.equal(await page.locator('#back-month,#back-history').count(),0);
    assert.equal(await page.locator('[data-footer=training]').innerText(),'1');
    assert.equal(await page.locator('[data-footer=work]').innerText(),'0回');
    for (const mode of ['time','all']) {
      await page.setViewportSize({width:1920,height:768});
      await page.locator(`button[data-entry-mode=${mode}]`).click();
      const headings=page.locator('.dr-month-table > thead > tr > th');
      const before=await headings.evaluateAll(els=>els.map(el=>el.getBoundingClientRect().top));
      await page.locator('.dr-grid-wrap').evaluate(el=>{el.scrollTop=300;});
      await page.waitForTimeout(50);
      const fixed=await headings.evaluateAll(els=>els.filter(el=>el.getClientRects().length).map(el=>({index:[...el.parentNode.children].indexOf(el),top:el.getBoundingClientRect().top,bg:getComputedStyle(el).backgroundColor})));
      for(const cell of fixed) {
        assert.ok(Math.abs(cell.top-before[cell.index])<2,`${mode} header ${cell.index} remains fixed`);
        assert.notEqual(cell.bg,'rgba(0, 0, 0, 0)','header is opaque');
      }
      await page.locator('.dr-grid-wrap').evaluate(el=>{el.scrollTop=0;});
    }
    await page.setViewportSize({width:1366,height:768});
    await page.locator('button[data-entry-mode=time]').click();

    const footerTop=(await page.locator('.dr-footer > td').first().boundingBox()).y;
    assert.ok(footerTop+(await page.locator('.dr-footer > td').first().boundingBox()).height<=768,'フッターは画面内に固定表示');
    assert.ok((await page.locator('.dr-main').nth(13).boundingBox()).y+initialHeight<=footerTop,'1366×768で詳細を閉じた14日分がフッターより上に収まる');
    assert.ok(await page.locator('.dr-day-total-header').first().isVisible(),'時間入力で請求支払列を表示');
    fs.mkdirSync(path.resolve(__dirname,'../test-results/daily-entry'),{recursive:true});
    await page.screenshot({path:path.resolve(__dirname,'../test-results/daily-entry/fortnight.png')});
    assert.equal(await page.locator('.dr-main').first().locator('.dr-additional-mark').innerText(),'追加 1件');
    assert.equal(await page.locator('.dr-expand').count(),0,'詳細を開かず追加項目が分かる');
    const initialDateWidth=(await page.locator('.dr-date-cell').first().boundingBox()).width;
    const commonColumns=()=>page.locator('.dr-month-table > thead > tr > th').evaluateAll(cells=>cells.slice(0,8).map(el=>({width:el.getBoundingClientRect().width,height:el.getBoundingClientRect().height})));
    const timeColumns=await commonColumns();
    await page.locator('[data-entry-mode=all]').click();
    assert.deepEqual(await commonColumns(),timeColumns,'共通列幅とヘッダー高さは両モードで一致');
    assert.equal((await page.locator('.dr-date-cell').first().boundingBox()).width,initialDateWidth,'日付幅は入力モードに依存しない');
    assert.equal(await rowHeight(),initialHeight,'時間・全項目の行間が一致する');
    await page.locator('button[data-entry-mode=time]').click();
    async function assertCellBottoms() {
      const bottoms=await page.locator('.dr-main').first().locator(':scope > td').evaluateAll(cells=>cells.filter(c=>c.getClientRects().length).map(c=>c.getBoundingClientRect().bottom));
      assert.ok(Math.max(...bottoms)-Math.min(...bottoms)<1,'操作セルの下端は他セルと一致する');
    }
    await assertCellBottoms();
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
    // Values and focus are committed by the asynchronous dialog close event.
    await page.locator('dialog.dr-time-picker').waitFor({ state: 'detached' });
    assert.equal(await time('end_time',0).inputValue(),'28:15');
    await page.keyboard.press('F2');
    await page.waitForSelector('[data-expand-row="0"]');
    assert.equal(await page.evaluate(() => !!document.activeElement.closest('.dr-expand')),true);
    const detail = page.locator('[data-expand-row="0"]');
    assert.equal(await detail.locator('[data-f=total_distance],[data-f=toll_fee],[data-f=parking_fee],[data-f=transport_fee]').count(),0,'経費は一覧に集約');
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
    await page.locator('button[data-entry-mode=time]').click();
    await page.evaluate(() => window.LinksDailyReports.saveAll());
    assert.equal(await page.evaluate(() => window.savedPayloads.length),20);
    assert.equal(await page.locator('[data-footer=break]').innerText(),'20:00');
    assert.equal(await page.locator('[data-footer=work]').innerText(),'20回');
    await page.evaluate(()=>{window.LinksDailyReports.gridRows[0].is_absent=1;window.LinksDailyReports.updateEntrySummary();});
    assert.equal(await page.locator('[data-footer=work]').innerText(),'19回');
    await page.evaluate(()=>{window.LinksDailyReports.gridRows[0].is_absent=0;window.LinksDailyReports.updateEntrySummary();});

    assert.equal(await page.locator('[data-footer=billing]').innerText(),'401,000円');
    assert.equal(await page.locator('[data-footer=payment]').innerText(),'300,800円');
    await assertCellBottoms();
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
      const textFits=await time('end_time',0).evaluate(el=>{
        const s=getComputedStyle(el),c=document.createElement('canvas').getContext('2d');c.font=`${s.fontWeight} ${s.fontSize} ${s.fontFamily}`;
        return el.clientWidth-parseFloat(s.paddingLeft)-parseFloat(s.paddingRight)>=c.measureText('28:15').width;
      });
      assert.ok(textFits,`時間入力の5文字が欠けない: ${width}`);
      await page.evaluate(() => window.scrollTo(0,0));
      const dimensions = await page.locator('.dr-grid-wrap').evaluate(el => ({client:el.clientWidth,scroll:el.scrollWidth}));
      await page.screenshot({path:path.join(output,`${width}.png`),fullPage:false});
      if (dimensions.scroll > dimensions.client + 2) console.log(await page.locator('.dr-grid-wrap').evaluate(root => Array.from(root.querySelectorAll('*')).filter(el => el.getBoundingClientRect().right > root.getBoundingClientRect().right + 2 && el.getClientRects().length).slice(0,12).map(el => ({tag:el.tagName,cls:el.className,right:el.getBoundingClientRect().right,text:el.textContent.slice(0,40)}))));
      assert.ok(dimensions.scroll <= dimensions.client + 2, `time grid horizontal overflow at ${width}: ${JSON.stringify(dimensions)}`);
      assert.ok(await time('start_time',0).evaluate(el => parseFloat(getComputedStyle(el).fontSize)) >= 16);
      await page.screenshot({path:path.join(output,`${width}.png`),fullPage:false});
    }
    // 料金表を含む展開詳細もPC横幅に収まり、7桁を読める。
    await page.evaluate(() => {
      const dr=window.LinksDailyReports;
      dr.gridRows[0].rate_overrides={billing:{basic:'1234567.00',overtime:'123.45'}};
      dr.gridRows[0].toll_fee='1234567.00';
      dr.renderGrid();
    });
    for (const width of [1920,1366,390]) {
      await page.setViewportSize({width,height:900});
      await page.locator(`button[data-entry-mode=${width<700?'time':'all'}]`).click();
      await page.locator('[data-expand-row="0"] details').evaluateAll(items=>items.forEach(el=>el.open=true));
      const root=page.locator('[data-expand-row="0"]');
      await root.locator('[data-common-minutes=night_adjustment]').fill('0:00');
      await page.keyboard.press('Tab');
      const comment=await root.locator('[data-f=row_comment]').boundingBox();
      const save=await root.locator('[data-save-row]').boundingBox();
      assert.ok(save.x>=comment.x+comment.width || save.y>=comment.y+comment.height,'行保存とコメント欄は重ならない');
      if(width>=700) {
        assert.equal(await page.locator('.dr-main [data-f=toll_fee]').first().inputValue(),'1234567');
        const escaped=await page.locator('.dr-main input, .dr-main button').evaluateAll(inputs=>inputs.filter(el=>el.getClientRects().length).filter(el=>{
          const rect=el.getBoundingClientRect(),cell=el.closest('td').getBoundingClientRect();
          return rect.left<cell.left-1 || rect.right>cell.right+1;
        }).map(el=>el.dataset.f||el.dataset.minutesF||JSON.stringify({html:el.outerHTML,x:el.getBoundingClientRect().x,w:el.getBoundingClientRect().width,c:el.closest("td").getBoundingClientRect().toJSON(),p:getComputedStyle(el).padding,flex:getComputedStyle(el).flex})));
        assert.deepEqual(escaped,[],`入力枠は各列内に収まる: ${width}`);
        assert.equal(await root.locator(':scope > td').evaluate(el=>el.colSpan),await page.locator('.dr-month-table > thead > tr > th').evaluateAll(cells=>cells.filter(el=>getComputedStyle(el).display!=='none').length),'詳細の結合列数は表示列数と一致');
      }
      const basic=root.locator('[data-rate-side=billing][data-rate-type=basic]');
      assert.equal(await basic.inputValue(),'1234567');
      assert.equal(await root.locator('[data-rate-side=billing][data-rate-type=overtime]').inputValue(),'123.45');
      const fit=await basic.evaluate(el=>{
        const c=document.createElement('canvas').getContext('2d'); const s=getComputedStyle(el); c.font=`${s.fontSize} ${s.fontFamily}`;
        return el.clientWidth-parseFloat(s.paddingLeft)-parseFloat(s.paddingRight)>=c.measureText('1234567').width;
      });
      assert.ok(fit,`7桁料金が見える: ${width}`);
      const dimensions=await page.locator('.dr-grid-wrap').evaluate(el=>({client:el.clientWidth,scroll:el.scrollWidth}));
      assert.ok(dimensions.scroll<=dimensions.client+2,`expanded all grid overflow ${width}: ${JSON.stringify(dimensions)}`);
      const rateDimensions=await root.locator('.dr-rate-wrap').evaluate(el=>({client:el.clientWidth,scroll:el.scrollWidth}));
      assert.ok(rateDimensions.scroll<=rateDimensions.client+2,`rate table overflow ${width}`);
      await root.screenshot({path:path.join(output,`detail-${width}.png`)});
      await page.screenshot({path:path.join(output,`all-${width}.png`)});
    }
    // 月跨ぎ期間の入力行と移行プレビューを実UIで確認する。
    await page.evaluate(async () => {
      const dr = window.LinksDailyReports;
      dr.ym = '2026-11';
      dr.ctx.renderLoading = () => {};
      dr.kit.currentYearMonth = () => dr.ym;
      const dates = Array.from({length:31}, (_, i) => new Date(Date.UTC(2026,9,21+i)).toISOString().slice(0,10));
      const period = {target_year_month:'2026-11',period_start:dates[0],period_end:dates.at(-1),closing_day:'20',period_mode:'closing',dates};
      dr.ctx.api = async url => ({res:{ok:true},data:{ok:true,...(url.includes('period-migration') ? {preview:{project_id:1,before_periods:[],periods:[period],changes:[],protected_months:[],token:'test'}} : {period,reports:[],settings:{}})}});
      await dr.showInputGrid(dr.gridMeta);
    });
    assert.equal(await page.evaluate(() => window.LinksDailyReports.gridRows[0].work_date), '2026-10-21');
    assert.equal(await page.evaluate(() => window.LinksDailyReports.gridRows.at(-1).work_date), '2026-11-20');
    assert.match(await page.locator('.dr-period-summary').innerText(), /2026-10-21.*2026-11-20/);
    await page.locator('#open-period-migration').click();
    await page.locator('#period-migration-reason').waitFor();
    await page.locator('#apply-period-migration').click();
    assert.match(await page.locator('#period-migration-message').innerText(), /理由/);
    assert.deepEqual(errors,[]);
    console.log('PASS: 20日連続Tab/逆Tab、時刻、時分選択、詳細、整数、保存競合、3画面幅');
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
