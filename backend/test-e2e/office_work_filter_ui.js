const assert = require('node:assert/strict');
const path = require('path');
const express = require('express');
const { chromium } = require('playwright');

async function main() {
  const app = express();
  app.use(express.static(path.resolve(__dirname, '../../frontend')));
  app.get('*', (_req, res) => res.sendFile(path.resolve(__dirname, '../../frontend/index.html')));
  const server = app.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  const browser = await chromium.launch({
    headless:true,
    ...(process.env.PLAYWRIGHT_EXECUTABLE_PATH ? { executablePath:process.env.PLAYWRIGHT_EXECUTABLE_PATH } : {}),
  });
  try {
    const page = await browser.newPage({ viewport:{ width:1366,height:820 } });
    await page.route('**/api/**', async (route) => {
      const pathname = new URL(route.request().url()).pathname;
      let body = { ok:true };
      if (pathname === '/api/auth/me') body = {
        ok:true,user:{ user_id:1,display_name:'管理者',roles:['admin'],permissions:['office_work'] },
        features:[{ key:'office_work',label:'事務作業',group:'daily' }],roles:[{ key:'admin',label:'管理者' }],
      };
      else if (pathname === '/api/dashboard/summary') body = { ok:true,cards:[] };
      else if (pathname === '/api/daily-reports/month-projects') body = { ok:true,rows:[
        { project_id:11,company_id:1,company_name:'青海ロジスティクス株式会社',company_name_kana:'オウミロジスティクスカブシキガイシャ',partner_id:21,partner_name:'青海配送',closing_date:'end',company_closing_date:'end',workflow_status:'not_started',days_in_month:30,input_days:0 },
        { project_id:12,company_id:2,company_name:'かもめ運送',company_name_kana:'カモメウンソウ',partner_id:22,partner_name:'かもめ配送',closing_date:'15',company_closing_date:'15',workflow_status:'not_started',days_in_month:30,input_days:0 },
      ] };
      else if (pathname === '/api/invoices/targets' || pathname === '/api/payments/targets') body = { ok:true,targets:[] };
      await route.fulfill({ status:200,contentType:'application/json',body:JSON.stringify(body) });
    });
    await page.goto(`http://127.0.0.1:${server.address().port}`, { waitUntil:'networkidle' });
    await page.locator('[data-nav-feature="office_work"]').click();
    await page.locator('.office-screen').waitFor();
    assert.equal(await page.locator('#office-all-companies').textContent(),'全対象');
    assert.equal(await page.locator('#office-filter-toggle').textContent(),'抽');
    await page.setViewportSize({ width:900,height:800 });
    const bounds = await page.locator('.office-company-primary-actions').evaluate((element) => {
      const container = element.getBoundingClientRect();
      return [...element.children].filter((child) => child.matches('button')).map((button) => {
        const rect = button.getBoundingClientRect();
        return { left:rect.left,right:rect.right,containerLeft:container.left,containerRight:container.right };
      });
    });
    assert.equal(bounds.every((row) => row.left >= row.containerLeft && row.right <= row.containerRight),true,`タブレット幅でも2操作を企業列内に表示する: ${JSON.stringify(bounds)}`);
    await page.locator('#office-filter-toggle').click();
    assert.equal(await page.locator('#office-filter-toggle').getAttribute('aria-expanded'),'true');
    assert.deepEqual(await page.locator('.office-company-sort .btn').allTextContents(),['企業No ▲','締日','フリ']);
    assert.equal(await page.locator('[data-office-kana-group]').count(),12);
    const panelBounds = await page.evaluate(() => {
      const head = document.querySelector('.office-column-head').getBoundingClientRect();
      const kana = document.querySelector('.office-kana-filter').getBoundingClientRect();
      return { headBottom:head.bottom,kanaBottom:kana.bottom };
    });
    assert.ok(panelBounds.kanaBottom < panelBounds.headBottom,`五十音行を企業見出し内に収める: ${JSON.stringify(panelBounds)}`);
    await page.locator('#office-company-closing').selectOption('15');
    assert.equal(await page.locator('[data-company]').count(),1);
    await page.locator('#office-company-closing').selectOption('');
    await page.locator('[data-office-kana-group="a"]').click();
    assert.equal(await page.locator('[data-company="1"]').count(),1);
    assert.equal(await page.locator('[data-company="2"]').count(),0);
  } finally {
    await browser.close();
    await new Promise((resolve) => server.close(resolve));
  }
  console.log('[office-work-filter-ui] タブレット表示と企業の抽ボタンを確認しました');
}

main().catch((error) => { console.error('[office-work-filter-ui] failed:',error); process.exit(1); });
