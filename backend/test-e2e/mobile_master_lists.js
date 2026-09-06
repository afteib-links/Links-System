const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const express = require('express');
const { chromium } = require('playwright');

const outputDir = path.resolve(__dirname, '../test-results/mobile-master-lists');

async function openFeature(page, key) {
  await page.locator('#sidebar-toggle').click();
  await page.locator('.app-shell.mobile-menu-open').waitFor();
  await page.locator(`[data-nav-feature="${key}"]`).click();
  await page.locator('#shared-data-table').waitFor();
}

async function assertCompactActions(page, triggerSelector, expectedLabels) {
  const desktopDisplay = await page.locator('.desktop-row-actions').first().evaluate((node) => getComputedStyle(node).display);
  const mobileDisplay = await page.locator(triggerSelector).first().evaluate((node) => getComputedStyle(node).display);
  assert.equal(desktopDisplay, 'none', 'スマホでは個別操作ボタンを非表示にすること');
  assert.notEqual(mobileDisplay, 'none', 'スマホでは小さな操作ボタンを表示すること');
  await page.locator(triggerSelector).first().click();
  await page.locator('#modal-backdrop').waitFor();
  const labels = await page.locator('.mobile-action-list .btn').allTextContents();
  assert.deepEqual(labels.map((label) => label.trim()), expectedLabels, '操作メニューに既存操作をすべて表示すること');
  await page.locator('#modal-close').click();
}

async function main() {
  await fs.mkdir(outputDir, { recursive:true });
  const app = express();
  app.use(express.static(path.resolve(__dirname, '../../frontend')));
  app.get('*', (_req, res) => res.sendFile(path.resolve(__dirname, '../../frontend/index.html')));
  const server = app.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  const browser = await chromium.launch({ headless:true, ...(process.env.PLAYWRIGHT_EXECUTABLE_PATH ? { executablePath:process.env.PLAYWRIGHT_EXECUTABLE_PATH } : {}) });
  const page = await browser.newPage({ viewport:{ width:390, height:844 } });
  await page.route('**/api/**', async (route) => {
    const url = new URL(route.request().url());
    const json = (body) => route.fulfill({ status:200, contentType:'application/json', body:JSON.stringify(body) });
    if (url.pathname === '/api/auth/me') return json({
      ok:true,
      user:{ user_id:1,display_name:'管理者',roles:['admin'],permissions:['companies','partners'] },
      features:[
        {key:'companies',label:'企業マスター',group:'master'},
        {key:'partners',label:'パートナーマスター',group:'master'},
      ],
      roles:[{key:'admin',label:'管理者'}],
    });
    if (url.pathname === '/api/dashboard/summary') return json({ok:true,cards:[]});
    if (url.pathname === '/api/masters/codes') return json({ok:true,codes:[]});
    if (url.pathname === '/api/master-settings/staff') return json({ok:true,staff:[]});
    if (url.pathname === '/api/lookups/transfer-fees') return json({ok:true,transfer_fees:[]});
    if (url.pathname.startsWith('/api/layouts/')) return json({ok:true,layout:null});
    if (url.pathname === '/api/companies') return json({ok:true,companies:[{
      company_id:123456,company_name:'スマホ表示確認株式会社',office_name:'東京事業所',work_mode_code:'regular',our_manager:'担当者',base_project_count:3,closing_date_code:'20',invoice_send_method:'email',
    }]});
    if (url.pathname === '/api/partners') return json({ok:true,partners:[{
      partner_id:234567,partner_name:'スマホ表示確認パートナー',bank_name:'確認銀行',branch_name:'本店',work_start_date:'2026-09-01',continuity_years:1,project_count:2,
    }]});
    return json({ok:true});
  });

  try {
    await page.goto(baseUrl, { waitUntil:'networkidle' });
    await openFeature(page, 'companies');
    const companyNo = page.locator('#shared-data-table tbody .col-record-no').first();
    assert.ok(await companyNo.evaluate((node) => node.getBoundingClientRect().width <= 95), '企業No列を5文字相当へ狭めること');
    assert.equal(await companyNo.getAttribute('title'), '123456', '省略したNoの全文を補助表示すること');
    await assertCompactActions(page, '[data-company-actions]', ['編集','基本案件','削除']);
    await page.screenshot({ path:path.join(outputDir, 'companies-390x844.png'), fullPage:true });

    await openFeature(page, 'partners');
    const partnerNo = page.locator('#shared-data-table tbody .col-record-no').first();
    assert.ok(await partnerNo.evaluate((node) => node.getBoundingClientRect().width <= 95), 'パートナーNo列を5文字相当へ狭めること');
    await assertCompactActions(page, '[data-partner-actions]', ['編集','案件一覧','削除']);
    await page.screenshot({ path:path.join(outputDir, 'partners-390x844.png'), fullPage:true });

    const widths = await page.evaluate(() => ({ document:document.documentElement.scrollWidth,client:document.documentElement.clientWidth }));
    assert.ok(widths.document <= widths.client + 1, 'ページ全体を横スクロールさせないこと');
  } finally {
    await page.close();
    await browser.close();
    await new Promise((resolve) => server.close(resolve));
  }
  console.log('[mobile-master-lists] スマホのNo列、企業・パートナー操作メニュー、横はみ出しなしを確認しました');
}

main().catch((error) => { console.error(error); process.exit(1); });
