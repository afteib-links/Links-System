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
    headless: true,
    ...(process.env.PLAYWRIGHT_EXECUTABLE_PATH ? { executablePath: process.env.PLAYWRIGHT_EXECUTABLE_PATH } : {}),
  });
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    await page.route('**/api/**', async (route) => {
      const url = new URL(route.request().url());
      const json = (body, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
      if (url.pathname === '/api/auth/me') return json({
        ok: true,
        user: { user_id: 1, display_name: '管理者', roles: ['admin'], permissions: ['companies', 'partners'] },
        features: [
          { key: 'companies', label: '企業マスタ', group: 'master' },
          { key: 'partners', label: 'パートナーマスタ', group: 'master' },
        ],
        roles: [{ key: 'admin', label: '管理者' }],
      });
      if (url.pathname === '/api/dashboard/summary') return json({ ok: true, cards: [] });
      if (url.pathname === '/api/masters/codes') return json({ ok: true, codes: [
        { category_code:'closing_date', code_value:'15', code_label:'15日' },
        { category_code:'closing_date', code_value:'end', code_label:'末日' },
        { category_code:'contract_status', code_value:'active', code_label:'稼働中' },
        { category_code:'partner_category', code_value:'individual', code_label:'個人' },
        { category_code:'employment_type', code_value:'outsourcing', code_label:'外注' },
      ] });
      if (url.pathname === '/api/master-settings/staff') return json({ ok:true, staff:[] });
      if (url.pathname.startsWith('/api/layouts/')) return json({ ok:true, layout:null });
      if (url.pathname === '/api/lookups/transfer-fees') return json({ ok:true, transfer_fees:[{ transfer_fee_pattern_id:1, pattern_name:'標準', amount:330, is_active:1 }] });
      if (url.pathname === '/api/companies') return json({ ok:true, companies:[{
        company_id:1, company_name:'株式会社あおばロジ', office_name:'東京事業所', our_manager:'営業担当者', closing_date_code:'end', contract_status_code:'active',
      }] });
      if (url.pathname === '/api/partners') return json({ ok:true, partners:[{
        partner_id:1, partner_name:'山田運送サービス', bank_name:'テスト銀行', branch_name:'本店', contract_status_code:'active',
      }] });
      if (url.pathname === '/api/postal-codes/1000001') return json({ ok:true, addresses:[{ postal_code:'1000001', address:'東京都千代田区千代田' }] });
      return json({ ok:true });
    });
    await page.goto(`http://127.0.0.1:${server.address().port}`, { waitUntil:'networkidle' });

    await page.locator('[data-nav-feature="companies"]').click();
    await page.locator('#companies-list-root').waitFor();
    const companyWidth = await page.locator('td.col-company-name').evaluate((el) => el.getBoundingClientRect().width);
    const officeFont = await page.locator('td.col-secondary-text').first().evaluate((el) => parseFloat(getComputedStyle(el).fontSize));
    assert.ok(companyWidth >= 280, '企業名列を広く表示する');
    assert.ok(officeFont <= 12, '事業所名と営業担当を補助文字で表示する');
    await page.locator('#company-new').click();
    await page.locator('#company-form').waitFor();
    await page.locator('[name="company_name"]').evaluate((input) => {
      input.dispatchEvent(new CompositionEvent('compositionstart', { data:'' }));
      input.dispatchEvent(new CompositionEvent('compositionupdate', { data:'かぶしきがいしゃ' }));
      input.value = '株式会社';
      input.dispatchEvent(new CompositionEvent('compositionend', { data:'株式会社' }));
      input.dispatchEvent(new Event('input', { bubbles:true }));
    });
    assert.equal(await page.locator('[name="company_name_kana"]').inputValue(), 'カブシキガイシャ');
    await page.locator('[name="zip_code"]').fill('100-0001');
    await page.waitForTimeout(500);
    assert.equal(await page.locator('[name="address"]').inputValue(), '東京都千代田区千代田');

    await page.locator('[data-nav-feature="partners"]').click();
    await page.locator('#partners-list-root').waitFor();
    const partnerWidth = await page.locator('td.col-partner-name').evaluate((el) => el.getBoundingClientRect().width);
    const bankFont = await page.locator('td.col-secondary-text').evaluate((el) => parseFloat(getComputedStyle(el).fontSize));
    assert.ok(partnerWidth >= 280, 'パートナー名称列を広く表示する');
    assert.ok(bankFont <= 12, '銀行を補助文字で表示する');
    await page.locator('#new').click();
    await page.locator('#partner-form').waitFor();
    const kanaBox = await page.locator('[name="partner_name_kana"]').boundingBox();
    const nameBox = await page.locator('[name="partner_name"]').boundingBox();
    assert.ok(kanaBox.y < nameBox.y, 'カナを名称の上へ配置する');
    const feeHeading = await page.locator('[name="transfer_fee_pattern_id"]').evaluate((el) => el.closest('.form-section-card')?.querySelector('h3')?.textContent);
    assert.equal(feeHeading, '銀行情報');
    const emailWidth = await page.locator('[name="email"]').evaluate((el) => el.getBoundingClientRect().width);
    const phoneWidth = await page.locator('[name="contact_phone"]').evaluate((el) => el.getBoundingClientRect().width);
    assert.ok(emailWidth > phoneWidth, 'メールアドレスを電話より広く表示する');
    await page.locator('[name="zip_code"]').fill('１００－０００１');
    await page.waitForTimeout(500);
    assert.equal(await page.locator('[name="address"]').inputValue(), '東京都千代田区千代田');
    await page.setViewportSize({ width:430, height:932 });
    const mobileLayout = await page.evaluate(() => ({ width:document.documentElement.scrollWidth, viewport:window.innerWidth }));
    assert.ok(mobileLayout.width <= mobileLayout.viewport, 'パートナー入力画面はスマホ幅からはみ出さない');
  } finally {
    await browser.close();
    await new Promise((resolve) => server.close(resolve));
  }
  console.log('[master-ui-search-improvements] マスター一覧・入力・住所・カナ・配置を確認しました');
}

main().catch((error) => {
  console.error('[master-ui-search-improvements] failed:', error);
  process.exit(1);
});
