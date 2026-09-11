// Run inside the dedicated tool container only; never against a business DB.
const assert = require('node:assert/strict');
const { chromium } = require('playwright');
const { getPool, query } = require('../src/db');
const { enabled } = require('../src/routes/test_data');

(async () => {
  if (!enabled() || process.env.DB_NAME !== 'links_verification_tool_control') throw new Error('Dedicated tool environment required');
  const counts = async () => {
    const result = {};
    for (const table of ['companies','partners','base_projects','projects','daily_reports','invoices','payments']) {
      result[table] = Number((await query(`SELECT COUNT(*) AS n FROM ${table}`))[0].n);
    }
    return result;
  };
  const before = await counts();
  let browser;
  try {
    browser = await chromium.launch({headless:true}); const page = await browser.newPage({viewport:{width:1366,height:900}});
    const errors = []; page.on('pageerror',e => errors.push(e.message));
    await page.goto('http://127.0.0.1:3000');
    await page.locator('#login_id').fill(process.env.ADMIN_LOGIN_ID);
    await page.locator('#password').fill(process.env.ADMIN_PASSWORD);
    await page.locator('#login-form button[type=submit]').click();
    await page.locator('[data-nav-feature="test_data"]').click();
    await page.locator('#td-seed').fill('review-118-daily-sample');
    await page.locator('#td-preview').click();
    await page.locator('#td-approve').waitFor();
    assert.equal(await page.locator('#td-approve').isDisabled(),true);
    await page.locator('#td-fill').check();
    await page.locator('#td-preview').click();
    await page.waitForFunction(() => !document.getElementById('td-approve')?.disabled);
    await page.locator('#td-approve').click();
    await page.waitForFunction(() => document.body.textContent.includes('この設定版を承認しました'));
    const id = await page.evaluate(() => window.LinksTestData.draft.id);
    const [stored] = await query('SELECT revision, approved_hash FROM test_data_drafts WHERE draft_id = ?', [id]);
    assert.equal(Number(stored.revision),2); assert.match(stored.approved_hash,/^[a-f0-9]{64}$/);
    await page.locator('#td-share').click(); await page.locator('#td-download').waitFor();
    await page.getByRole('heading',{name:'匿名共有内容の確認'}).waitFor();
    assert.ok(await page.locator('#header-back').isVisible());
    assert.ok(await page.locator('[data-nav-feature="test_data"] svg').isVisible());
    const generationStatus = await page.evaluate(async draftId => (await fetch(`/api/test-data/drafts/${draftId}/generate`, {method:'POST',headers:{'Content-Type':'application/json'},body:'{}'})).status,id);
    assert.equal(generationStatus,501);
    await page.locator('#td-files').setInputFiles({name:'mapping-check.csv',mimeType:'text/csv',buffer:Buffer.from('企業番号,企業名,第三列\n00001,架空食品,配送\n00002,架空建材,倉庫')});
    await page.locator('#td-import').click(); await page.locator('#td-map-sheet').waitFor();
    await page.locator('[data-map-target="workMode"]').click(); await page.locator('[data-map-column="2"]').click();
    await page.locator('#td-normalize').click();
    await page.waitForFunction(() => !window.LinksTestData.importPending);
    await page.locator('#td-preview').click(); await page.locator('#td-sample-panel').waitFor();
    const imported = (await query('SELECT payload_json FROM test_data_drafts WHERE draft_id = ?', [id]))[0];
    const config = typeof imported.payload_json === 'string' ? JSON.parse(imported.payload_json) : imported.payload_json;
    assert.equal(config.catalog.companies[0].code,'00001');
    assert.equal(config.catalog.companies[1].workMode,'倉庫');
    assert.equal(config.importMappings[0].mapping[2].field,'workMode');
    assert.deepEqual(await counts(),before);
    assert.deepEqual(errors,[]);
    console.log(JSON.stringify({ok:true,draftId:id,businessCountsUnchanged:true,checks:['login','menu','preview','approval','real MariaDB persistence','anonymous share','header back','generation barrier','column mapping persistence']}));
  } finally { await browser?.close(); await getPool().end(); }
})().catch(e => {
  let message = String(e.stack || e); if (process.env.ADMIN_PASSWORD) message = message.replaceAll(process.env.ADMIN_PASSWORD,'[REDACTED]');
  console.error(message); process.exitCode = 1;
});
