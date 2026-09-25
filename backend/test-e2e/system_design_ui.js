const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const express = require('express');
const { chromium } = require('playwright');

const designDir = path.resolve(__dirname, '../../システム設計書');

function localBrowserPath() {
  if (process.env.SYSTEM_DESIGN_BROWSER_PATH) return process.env.SYSTEM_DESIGN_BROWSER_PATH;
  if (process.platform !== 'win32') return null;
  return ['C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe', 'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe'].find(fs.existsSync) || null;
}

async function main() {
  const app = express();
  app.use('/system-design', express.static(designDir));
  app.get('/', (_req, res) => res.send('<p>app</p>'));
  const server = app.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  const browser = await chromium.launch({ headless: true, ...(localBrowserPath() ? { executablePath: localBrowserPath() } : {}) });
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    await page.goto(`http://127.0.0.1:${server.address().port}/system-design/`, { waitUntil: 'networkidle' });
    assert.equal(await page.locator('.feature-section').count(), 25);
    await page.locator('#design-search').fill('銀行CSV');
    assert.ok(await page.locator('.searchable:visible').count() > 0);
    assert.ok(await page.locator('#feature-cash_management').isVisible());
    const href = await page.locator('#feature-companies .open-app').getAttribute('href');
    assert.equal(href, '/?feature=companies');
    const sourceLinks = await page.locator('.source-action a').evaluateAll((links) => links.map((a) => a.getAttribute('href')));
    assert.equal(sourceLinks.length, 34, '全体9章と全25機能に原稿リンク');
    for (const link of sourceLinks) {
      const filename = decodeURIComponent(link.replace('/system-design/', ''));
      assert.ok(fs.existsSync(path.join(designDir, filename)), filename);
    }
    const sourcePage = await browser.newPage();
    await sourcePage.goto(`http://127.0.0.1:${server.address().port}/system-design/sources/feature-companies.html`);
    assert.match(await sourcePage.locator('h1').innerText(), /企業マスタの原稿/);
    assert.equal(await sourcePage.locator('#source-content').inputValue(), fs.readFileSync(path.resolve(designDir, '../仕様MD/システム設計/機能/companies.md'), 'utf8').replaceAll('\r\n', '\n'));
    assert.ok(await sourcePage.locator('#open-editor').isHidden());
    await sourcePage.locator('#project-folder').fill('C:\\検証 作業\\LinksSystem');
    await sourcePage.locator('#editor-choice').selectOption('cursor');
    assert.equal(decodeURIComponent(await sourcePage.locator('#open-editor').getAttribute('href')), 'cursor://file/C:/検証 作業/LinksSystem/仕様MD/システム設計/機能/companies.md');
    await sourcePage.reload();
    assert.equal(await sourcePage.locator('#project-folder').inputValue(), 'C:\\検証 作業\\LinksSystem');
    await sourcePage.locator('#project-folder').fill('https://invalid.example');
    assert.ok(await sourcePage.locator('#open-editor').isHidden(), '相対パスやURLを編集フォルダーとして開かない');
    await sourcePage.close();
    const mobile = await browser.newPage({ viewport: { width: 390, height: 844 } });
    await mobile.goto(`http://127.0.0.1:${server.address().port}/system-design/`, { waitUntil: 'networkidle' });
    const width = await mobile.evaluate(() => ({ scroll: document.documentElement.scrollWidth, client: document.documentElement.clientWidth }));
    assert.ok(width.scroll <= width.client + 1, 'スマートフォン表示で全体が横にはみ出さない');
    console.log('[e2e] system design UI verified');
  } finally {
    await browser.close();
    await new Promise((resolve) => server.close(resolve));
  }
}

main().catch((error) => { console.error(error); process.exit(1); });
