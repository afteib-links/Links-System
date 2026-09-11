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
  app.get('/',(req,res) => res.send('<html lang="ja"><link rel="stylesheet" href="/css/styles.css"><link rel="stylesheet" href="/css/test_data_mapping.css"><div id="app"></div><script src="/js/feature-kit.js"></script><script src="/js/test_data_mapping.js"></script><script src="/js/test_data.js"></script></html>'));
  const server = app.listen(0,'127.0.0.1'); await new Promise(r => server.once('listening',r));
  let browser;
  try {
    browser = await chromium.launch({headless:true, ...(process.env.BROWSER_CHANNEL ? {channel:process.env.BROWSER_CHANNEL} : {})}); const page = await browser.newPage({ viewport:{width:1366,height:900} });
    const errors = []; page.on('pageerror', e => errors.push(e.message));
    await page.goto(`http://127.0.0.1:${server.address().port}`);
    await page.evaluate(async () => {
      const escapeHtml = v => String(v ?? '').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;');
      await window.LinksTestData.open({ app:document.getElementById('app'), escapeHtml, sidebarHtml:() => '<aside class="app-sidebar">検証用メニュー</aside>', headerHtml:() => '<header>検証ツール</header>', bindChrome:() => {},
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
    const files = [
      {name:'companies.csv',mimeType:'text/csv',buffer:Buffer.from('第一列,第二列,第三列,企業番号,企業名\n担当A,検索A,配送,00001,架空食品\n担当B,検索B,倉庫,00002,架空建材')},
      {name:'another.csv',mimeType:'text/csv',buffer:Buffer.from('企業番号,企業名\n00003,架空分析')},
    ];
    await page.locator('#td-files').setInputFiles(files);
    await page.locator('#td-import').click(); await page.locator('#td-map-sheet').waitFor();
    assert.ok((await page.locator('[data-map-column="2"]').innerText()).includes('倉庫'));
    await page.locator('[data-map-target="workMode"]').click(); await page.locator('[data-map-column="2"]').click();
    assert.ok((await page.locator('[data-map-target="workMode"]').innerText()).includes('3列目：第三列'));
    await page.locator('[data-map-column="0"]').click(); await page.locator('[data-map-target="managerName"]').click();
    await page.locator('[data-map-target="searchText"]').click(); await page.locator('[data-map-column="1"]').click();
    assert.ok((await page.locator('.td-mapping').boundingBox()).width > 800);
    if (process.env.MAPPING_SCREENSHOT) await page.locator('.td-mapping').screenshot({path:process.env.MAPPING_SCREENSHOT});
    await page.locator('#td-map-sheet').selectOption('1'); await page.locator('#td-map-sheet').selectOption('0');
    assert.ok((await page.locator('[data-map-target="workMode"]').innerText()).includes('第三列'));
    await page.locator('[data-map-clear="workMode"]').click();
    assert.ok((await page.locator('[data-map-target="workMode"]').innerText()).includes('未連携'));
    await page.locator('[data-map-column="2"]').click(); await page.locator('[data-map-target="workMode"]').click();
    await page.locator('#td-normalize').click();
    await page.waitForFunction(() => document.body.textContent.includes('対応付けと取込件数を設定に反映'));
    assert.equal(await page.locator('#td-count-companies').inputValue(),'3');
    await page.locator('#td-preview').click(); await page.locator('#td-sample-panel').waitFor();
    const imported = await page.evaluate(() => window.LinksTestData.draft.config);
    assert.equal(imported.catalog.companies[0].workMode,'配送');
    assert.equal(imported.catalog.companies[1].managerName,'担当B');
    assert.equal(imported.importMappings.length,2);
    await page.locator('#td-files').setInputFiles(files); await page.locator('#td-import').click();
    await page.waitForFunction(() => document.querySelector('[data-map-target="workMode"]')?.textContent.includes('第三列'));
    await page.setViewportSize({width:390,height:844});
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 2),false);
    assert.deepEqual(errors,[]);
    console.log('PASS: preview/approval + bidirectional mapping, first two rows, sheet retention, clear, persistence, reimport and mobile layout');
  } finally { await browser?.close(); server.close(); }
})().catch(e => { console.error(e); process.exitCode = 1; });
