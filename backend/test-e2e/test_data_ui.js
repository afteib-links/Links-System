const express = require('express');
const path = require('node:path');
const assert = require('node:assert/strict');
const { chromium } = require('playwright');
const { createRouter } = require('../src/routes/test_data');
const { createStore } = require('../test-support/test_data_store');

(async () => {
  const app = express(); app.use(express.json());
  app.use((req,res,next) => { req.session = {user:{user_id:1,roles:['admin']}}; next(); });
  app.use('/api/test-data', createRouter(createStore(), {LINKS_ENV:'verification',TEST_DATA_TOOL_ENABLED:'true',DB_NAME:'links_verification_tool_control'}));
  app.use('/js',express.static(path.resolve(__dirname,'../../frontend/js')));
  app.use('/css',express.static(path.resolve(__dirname,'../../frontend/css')));
  app.get('/',(req,res) => res.send('<html lang="ja"><link rel="stylesheet" href="/css/styles.css"><div id="app"></div><script src="/js/feature-kit.js"></script><script src="/js/test_data.js"></script></html>'));
  const server = app.listen(0,'127.0.0.1'); await new Promise(r => server.once('listening',r));
  let browser;
  try {
    browser = await chromium.launch({headless:true, ...(process.env.BROWSER_CHANNEL ? {channel:process.env.BROWSER_CHANNEL} : {})}); const page = await browser.newPage({ viewport:{width:1366,height:900} });
    const errors = []; page.on('pageerror', e => errors.push(e.message));
    await page.goto(`http://127.0.0.1:${server.address().port}`);
    await page.evaluate(async () => {
      const escapeHtml = v => String(v ?? '').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;');
      await window.LinksTestData.open({ app:document.getElementById('app'), escapeHtml, headerHtml:() => '<header>検証ツール</header>', bindChrome:() => {},
        api:async (url,options) => { const res = await fetch(url,{...options,headers:options?.body instanceof FormData ? {} : {'Content-Type':'application/json'}}); return {res,data:await res.json()}; } });
    });
    await page.locator('#td-preview').click(); await page.locator('#td-approve').waitFor();
    assert.equal(await page.locator('#td-approve').isDisabled(),true);
    await page.locator('#td-fill').check(); await page.locator('#td-preview').click();
    await page.waitForFunction(() => !document.getElementById('td-approve').disabled);
    await page.locator('#td-approve').click(); await page.waitForFunction(() => document.body.textContent.includes('この設定版を承認しました'));
    await page.locator('#td-share').click(); await page.locator('#td-download').waitFor();
    await page.locator('#td-seed').fill('modified'); await page.locator('#td-approve').click();
    await page.waitForFunction(() => document.body.textContent.includes('変更後の設定を保存'));
    assert.deepEqual(errors,[]);
    console.log('PASS: preview, fill confirmation, approval, anonymous download and stale-edit rejection');
  } finally { await browser?.close(); server.close(); }
})().catch(e => { console.error(e); process.exitCode = 1; });
