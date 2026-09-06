const test = require('node:test');
const assert = require('node:assert/strict');
const { buildPl, buildMargin, buildDays, profitRate, listMonths } = require('../src/services/analytics');
const { featuresFromRoles } = require('../src/permissions');

test('管理者・経営者・総務は収支分析を使える', () => {
  assert.equal(featuresFromRoles(['admin']).includes('analytics'), true);
  assert.equal(featuresFromRoles(['executive']).includes('analytics'), true);
  assert.equal(featuresFromRoles(['soumu']).includes('analytics'), true);
  assert.equal(featuresFromRoles(['sales']).includes('analytics'), false);
});

test('企業行は請求書合計を優先しパートナー累計と差が出る', () => {
  const data = buildPl({
    reports: [
      { company_id: 101, company_name: 'ABC', partner_id: 1, partner_name: '山田', employment_type_code: 'outsourcing', sales: 100, pay: 70, days: 10 },
      { company_id: 101, company_name: 'ABC', partner_id: 2, partner_name: '高橋', employment_type_code: 'payroll', sales: 50, pay: 40, days: 8 },
    ],
    invoices: [{ company_id: 101, subtotal: 200, tax: 20 }],
    payments: [{ partner_id: 1, gross_amount: 70 }],
    managers: [{ company_id: 101, staff_master_id: 9, staff_name: '佐藤', area_name: '関東', start_date: '2026-01-01' }],
  });
  const company = data.areas[0].staffs[0].companies[0];
  assert.equal(company.sales, 150);
  assert.equal(company.bill, 200);
  assert.equal(company.invoice_diff, true);
  assert.equal(company.tax, 20);
  assert.equal(company.partners[1].kubun, '給与');
});

test('利益率は売上0ならnull、警告基準未満を判定できる', () => {
  assert.equal(profitRate(0, 10), null);
  assert.ok(profitRate(100, 95) < 10);
  assert.ok(profitRate(100, 80) > 10);
});

test('利益率一覧は左が最新月', () => {
  const months = listMonths('2026-08', 3);
  assert.deepEqual(months, ['2026-08', '2026-07', '2026-06']);
  const data = buildMargin({
    months,
    reports: [
      { target_year_month: '2026-08', company_id: 1, company_name: 'A', partner_id: 1, sales: 100, pay: 70 },
      { target_year_month: '2026-07', company_id: 1, company_name: 'A', partner_id: 1, sales: 100, pay: 90 },
    ],
    managers: [{ company_id: 1, staff_name: '佐藤', area_name: '関東', start_date: '2020-01-01' }],
  });
  assert.equal(data.rows[0].rates[0].toFixed(1), '30.0');
  assert.equal(data.rows[0].rates[1].toFixed(1), '10.0');
  assert.equal(data.rows[0].rates[2], null);
});

test('稼働日は企業×パートナーで月列に載る', () => {
  const months = ['2026-08', '2026-07'];
  const data = buildDays({
    months,
    reports: [
      { target_year_month: '2026-08', company_id: 1, company_name: 'A', partner_id: 2, partner_name: '山田', days: 22 },
      { target_year_month: '2026-07', company_id: 1, company_name: 'A', partner_id: 2, partner_name: '山田', days: 18 },
    ],
    managers: [{ company_id: 1, staff_name: '佐藤', area_name: '関東', start_date: '2020-01-01' }],
  });
  assert.deepEqual(data.rows[0].days, [22, 18]);
});
