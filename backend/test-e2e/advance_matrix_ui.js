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
  return { ...group, work_days:projectIndex === 2 ? 0 : [6,6,11][index], unit_price:15000, calculated_amount:amount, advance_amount:amount, transfer_fee_base_amount:550, transfer_fee_amount:550, transfer_fee_pattern_name:'標準', is_target:true, adjustment_reason:'', version:0, status:'unplanned', cash_status:null, period_start:`2026-09-${String(index * 10 + 1).padStart(2,'0')}`, period_end:`2026-09-${String(index * 10 + 10).padStart(2,'0')}` };
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
      const layout = await page.evaluate(() => ({ doc:document.documentElement.scrollWidth,client:document.documentElement.clientWidth,matrix:document.querySelector('.advance-matrix').scrollWidth,wrap:document.querySelector('.advance-matrix-wrap').clientWidth,rows:document.querySelectorAll('.advance-matrix tbody tr').length,stickyLeft:getComputedStyle(document.querySelector('.advance-project-cell')).position,stickyRight:getComputedStyle(document.querySelector('.advance-project-total')).position }));
      assert.ok(layout.doc <= layout.client + 1, `${viewport.width}pxでページ全体を横スクロールさせない`); assert.ok(layout.matrix > layout.wrap || viewport.width === 1920, '狭い画面ではマトリクス内を横スクロールする'); assert.equal(layout.rows, 12); assert.equal(layout.stickyLeft, 'sticky'); assert.equal(layout.stickyRight, 'sticky');
      await page.screenshot({ path:path.join(outputDir, `advance-${viewport.width}x${viewport.height}.png`), fullPage:true }); await page.close();
    }
  } finally { await browser.close(); await new Promise((resolve) => server.close(resolve)); }
  console.log('[advance-matrix-ui] 4画面幅、12案件、固定左右列、ページ横はみ出しなしを確認しました');
}
main().catch((error) => { console.error(error); process.exit(1); });
