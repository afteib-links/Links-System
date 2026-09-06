const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const express = require('express');
const { chromium } = require('playwright');

const outputDir = path.resolve(__dirname, '../test-results/advance-matrix');
const groups = [
  { group_code:'early', label:'5日・10日締め', payment_date:'2026-09-20', cash_cycle_id:1 },
  { group_code:'middle', label:'15日・20日締め', payment_date:'2026-09-30', cash_cycle_id:2 },
  { group_code:'late', label:'25日・末日締め', payment_date:'2026-10-10', cash_cycle_id:3 },
];
function cycle(group, index, projectIndex) {
  const amount = projectIndex === 2 ? 0 : [90000,90000,198000][index];
  let status = 'unplanned'; let cashStatus = null;
  if (projectIndex === 1 && index === 0) status = 'planned';
  if (projectIndex === 3 && index === 1) { status = 'planned'; cashStatus = 'exported'; }
  if (projectIndex === 4 && index === 0) { status = 'executed'; cashStatus = 'executed'; }
  if (projectIndex === 5 && index === 2) { status = 'planned'; cashStatus = 'held'; }
  return { ...group, work_days:projectIndex === 2 ? 0 : [6,6,11][index], unit_price:15000, calculated_amount:amount, advance_amount:amount, transfer_fee_base_amount:550, transfer_fee_amount:550, transfer_fee_pattern_name:'標準', is_target:true, adjustment_reason:'', version:0, status, cash_status:cashStatus, advance_record_id:1000 + projectIndex * 10 + index, period_start:`2026-09-${String(index * 10 + 1).padStart(2,'0')}`, period_end:`2026-09-${String(index * 10 + 10).padStart(2,'0')}` };
}
const projects = Array.from({ length:12 }, (_, index) => {
  const cycles = groups.map((group, groupIndex) => cycle(group, groupIndex, index));
  return { project_id:250101 + index, project_name:`配送システム案件 ${String.fromCharCode(65 + index)}`, company_id:1, company_name:'株式会社リンクス', partner_id:10 + index, partner_name:`パートナー ${index + 1}`, closing_date:['5','10','15','20','25','end'][index % 6], cycles, totals:{ advance_count:cycles.filter((c) => c.advance_amount > 0).length, advance_amount:cycles.reduce((n,c) => n + c.advance_amount,0), transfer_fee_amount:cycles.filter((c) => c.advance_amount > 0).length * 550 } };
});
const summary = { project_count:projects.length, advance_count:projects.reduce((n,p) => n + p.totals.advance_count,0), advance_amount:projects.reduce((n,p) => n + p.totals.advance_amount,0), transfer_fee_amount:projects.reduce((n,p) => n + p.totals.transfer_fee_amount,0), cycles:groups.map((group) => ({ group_code:group.group_code, advance_count:projects.filter((p) => p.cycles.find((c) => c.group_code === group.group_code).advance_amount > 0).length, advance_amount:projects.reduce((n,p) => n + p.cycles.find((c) => c.group_code === group.group_code).advance_amount,0), transfer_fee_amount:projects.filter((p) => p.cycles.find((c) => c.group_code === group.group_code).advance_amount > 0).length * 550 })) };

async function main() {
  await fs.mkdir(outputDir, { recursive:true });
  const app = express(); app.use(express.static(path.resolve(__dirname, '../../frontend'))); app.get('*', (_req,res) => res.sendFile(path.resolve(__dirname, '../../frontend/index.html')));
  const server = app.listen(0, '127.0.0.1'); await new Promise((resolve) => server.once('listening', resolve));
  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  const browser = await chromium.launch({ headless:true, ...(process.env.PLAYWRIGHT_EXECUTABLE_PATH ? { executablePath:process.env.PLAYWRIGHT_EXECUTABLE_PATH } : {}) });
  try {
    for (const viewport of [{width:1920,height:1080},{width:1366,height:768},{width:430,height:932},{width:390,height:844}]) {
      const page = await browser.newPage({ viewport });
      await page.route('**/api/**', async (route) => {
        const url = new URL(route.request().url());
        let body = { ok:true };
        if (url.pathname === '/api/auth/me') body = { ok:true,user:{ user_id:1,display_name:'管理者',roles:['admin'],permissions:['advances'] },features:[{key:'advances',label:'先払い',group:'billing'}],roles:[{key:'admin',label:'管理者'}] };
        else if (url.pathname === '/api/dashboard/summary') body = { ok:true,cards:[] };
        else if (url.pathname === '/api/lookups/companies') body = { ok:true,companies:[{company_id:1,company_name:'株式会社リンクス'}] };
        else if (url.pathname === '/api/lookups/partners') body = { ok:true,partners:projects.map((p) => ({partner_id:p.partner_id,partner_name:p.partner_name})) };
        else if (url.pathname === '/api/advances/matrix') body = { ok:true,target_year_month:'2026-09',groups,projects,summary,visible_project_count:projects.length };
        await route.fulfill({ status:200,contentType:'application/json',body:JSON.stringify(body) });
      });
      await page.goto(baseUrl, { waitUntil:'networkidle' });
      if (viewport.width <= 760) await page.locator('#sidebar-toggle').click();
      await page.locator('[data-nav-feature="advances"]').click(); await page.locator('.advance-matrix').waitFor();
      const layout = await page.evaluate(() => {
        const wrap = document.querySelector('.advance-matrix-wrap');
        const rowHeight = document.querySelector('.advance-matrix tbody tr').getBoundingClientRect().height;
        const headerHeight = document.querySelector('.advance-matrix thead').getBoundingClientRect().height;
        const footerHeight = document.querySelector('.advance-matrix tfoot').getBoundingClientRect().height;
        const inputStyle = getComputedStyle(document.querySelector('.advance-amount-input'));
        const originStyle = getComputedStyle(document.querySelector('.advance-origin'));
        return { doc:document.documentElement.scrollWidth,client:document.documentElement.clientWidth,matrix:document.querySelector('.advance-matrix').scrollWidth,wrap:wrap.clientWidth,wrapHeight:wrap.clientHeight,headerHeight,footerHeight,rows:document.querySelectorAll('.advance-matrix tbody tr').length,stickyLeft:getComputedStyle(document.querySelector('.advance-project-cell')).position,stickyRight:getComputedStyle(document.querySelector('.advance-project-total')).position,amountWidth:document.querySelector('.advance-amount-input').getBoundingClientRect().width,feeWidth:document.querySelector('.advance-fee-input').getBoundingClientRect().width,periodLines:document.querySelector('.advance-period').children.length,originLines:document.querySelector('.advance-origin').children.length,rowHeight,visibleRows:Math.floor((wrap.clientHeight - headerHeight - footerHeight) / rowHeight),subHeaders:Array.from(document.querySelectorAll('.advance-heading-fields th')).map((node) => node.textContent.trim()),blockHeights:Array.from(document.querySelector('.advance-cycle-grid').children).map((node) => node.getBoundingClientRect().height),projectHeights:Array.from(document.querySelector('.advance-project-cell').children).map((node) => node.getBoundingClientRect().height),cellPadding:getComputedStyle(document.querySelector('.advance-project-cell')).padding,inputBox:`${inputStyle.height}/${inputStyle.minHeight}/${inputStyle.margin}`,originBox:`${originStyle.height}/${originStyle.margin}` };
      });
      assert.ok(layout.doc <= layout.client + 1, `${viewport.width}pxでページ全体を横スクロールさせない`); assert.ok(layout.matrix > layout.wrap || viewport.width === 1920, '狭い画面ではマトリクス内を横スクロールする'); assert.equal(layout.rows, 12); assert.equal(layout.stickyLeft, 'sticky'); assert.equal(layout.stickyRight, 'sticky');
      assert.ok(layout.amountWidth < 100, '支払額入力は7桁相当の表示幅にする'); assert.ok(layout.feeWidth < 80, '手数料入力は5桁相当の表示幅にする'); assert.equal(layout.periodLines, 2, '年と月日範囲を2行表示する'); assert.ok(layout.originLines >= 2, '元額と計算根拠を2行表示する');
      assert.deepEqual(layout.subHeaders.slice(0, 3), ['支払額','手数料','先払・状態'], '各サイクルの小見出しを表示する');
      assert.ok(layout.rowHeight <= 100, `案件行を100px以下にする（実測 ${layout.rowHeight}px、内訳 ${layout.blockHeights.join('/')}、案件余白 ${layout.cellPadding}、入力 ${layout.inputBox}、元値 ${layout.originBox}）`);
      if (viewport.width === 1920) assert.ok(layout.visibleRows >= 8, `1920×1080で8案件以上を見渡せる（実測 ${layout.visibleRows}案件、領域 ${layout.wrapHeight}px、見出し ${layout.headerHeight}px、集計 ${layout.footerHeight}px、行 ${layout.rowHeight}px、案件内訳 ${layout.projectHeights.join('/')}）`);
      if (viewport.width === 1920) {
        const matrixText = await page.locator('.advance-matrix').innerText();
        ['未作成','予定作成済み','CSV出力済み','保留','実行済み'].forEach((label) => assert.ok(matrixText.includes(label), `${label}を表示する`));
        assert.equal(await page.locator('[data-cancel]').count(), 3, '予定作成済みセルへ作成取消を表示する');
        assert.equal(await page.locator('[data-reverse]').count(), 1, '実行済みセルへ返金・訂正を表示する');
        assert.equal(await page.locator('[data-project-id="250102"] [data-cycle="early"] [data-amount]').isDisabled(), true, '予定作成済みセルを編集不可にする');

        const saveRequest = page.waitForRequest((request) => request.method() === 'PUT' && request.url().includes('/api/advances/cycles/250101/early'));
        await page.locator('[data-project-id="250101"] [data-cycle="early"] [data-target]').click();
        assert.equal((await saveRequest).postDataJSON().is_target, false, '先払OFFをセル保存する');
        await page.locator('.flash').waitFor();

        await page.locator('.advance-matrix-wrap').evaluate((node) => { node.scrollTop = 180; });
        const filterRequest = page.waitForRequest((request) => request.method() === 'GET' && request.url().includes('/api/advances/matrix?') && request.url().includes('q=%E9%85%8D%E9%80%81'));
        await page.locator('#advance-filters input[name="q"]').fill('配送');
        await page.locator('#advance-filters .btn-secondary').click();
        await filterRequest;
        await page.locator('.advance-matrix').waitFor();
        assert.ok(await page.locator('.advance-matrix-wrap').evaluate((node) => node.scrollTop > 0), '再表示後もスクロール位置を維持する');

        const nextMonthRequest = page.waitForRequest((request) => request.url().includes('target_year_month=2026-10'));
        await page.locator('#advance-month-next').click(); await nextMonthRequest;
        const previousMonthRequest = page.waitForRequest((request) => request.url().includes('target_year_month=2026-09'));
        await page.locator('#advance-month-prev').click(); await previousMonthRequest;

        await page.locator('[data-project-id="250101"] [data-select-project]').check();
        const createRequest = page.waitForRequest((request) => request.method() === 'POST' && request.url().includes('/api/advances/groups/early/records'));
        await page.locator('[data-create-group="early"]').click();
        assert.equal((await createRequest).postDataJSON().items[0].project_id, 250101, '選択案件を予定作成へ送る');

        page.once('dialog', (dialog) => dialog.accept('テスト取消'));
        const cancelRequest = page.waitForRequest((request) => request.method() === 'POST' && request.url().includes('/api/advances/records/1010/cancel'));
        await page.locator('[data-cancel="1010"]').click();
        assert.equal((await cancelRequest).postDataJSON().reason, 'テスト取消', '取消理由を送る');

        const reversalAnswers = ['7','1000'];
        const dialogHandler = (dialog) => dialog.accept(reversalAnswers.shift());
        page.on('dialog', dialogHandler);
        const reversalRequest = page.waitForRequest((request) => request.method() === 'POST' && request.url().includes('/api/advances/records/1040/reversal'));
        await page.locator('[data-reverse="1040"]').click();
        assert.deepEqual((await reversalRequest).postDataJSON(), { cash_cycle_id:7,amount:1000 }, '返金・訂正内容を送る');
        page.off('dialog', dialogHandler);

        const downloadPromise = page.waitForEvent('download');
        await page.locator('[data-export-group="early"]').click();
        await downloadPromise;
        await page.locator('.flash').waitFor();
      }
      await page.screenshot({ path:path.join(outputDir, `advance-${viewport.width}x${viewport.height}.png`), fullPage:true }); await page.close();
    }
  } finally { await browser.close(); await new Promise((resolve) => server.close(resolve)); }
  console.log('[advance-matrix-ui] 4画面幅、高密度表示、固定列、状態・保存・絞込・月移動・予定作成・取消・返金訂正・CSVを確認しました');
}
main().catch((error) => { console.error(error); process.exit(1); });
