const assert = require('node:assert/strict');
const test = require('node:test');

const {
  detailedWorkRows,
  renderHtml,
  salaryComponents,
  summaryRows,
} = require('../src/services/settlement_pdf');

function workLine({ id, projectId = 10, projectName = '検証案件', date, amount = 20000, overtime = 0 }) {
  const basic = amount - overtime;
  return {
    line_type:'work',
    project_id:projectId,
    daily_report_id:id,
    item_name:`稼働 ${date}`,
    quantity:1,
    unit_price:amount,
    amount,
    snapshot_json:JSON.stringify({
      daily_report_id:id,
      project_id:projectId,
      project_name:projectName,
      work_date:date,
      work_hours:8 + (overtime ? 1 : 0),
      calculation_detail:JSON.stringify({
        payment:{
          amounts:{
            details:{
              basic:{ calc_type:'daily', minutes:480, rate:basic, amount:basic },
              overtime:{ calc_type:'hourly', minutes:overtime ? 60 : 0, rate:overtime, amount:overtime },
            },
          },
        },
        billing:{
          amounts:{
            details:{
              basic:{ calc_type:'daily', minutes:480, rate:basic, amount:basic },
              overtime:{ calc_type:'hourly', minutes:overtime ? 60 : 0, rate:overtime, amount:overtime },
            },
          },
        },
      }),
    }),
  };
}

const issuer = {
  name:'検証株式会社',
  zip_code:'000-0000',
  address:'匿名化住所',
  registration_number:'T0000000000000',
  tel:'00-0000-0000',
  bank_accounts:[{ bank_name:'検証銀行', branch_name:'本店', deposit_type:'普通', account_number:'0000000' }],
};

test('日次行を案件・料金項目単位へ集約する', () => {
  const lines = [
    workLine({ id:1, date:'2026-05-01' }),
    workLine({ id:2, date:'2026-05-02' }),
  ];
  const rows = detailedWorkRows({ settlement_type:'invoice' }, lines);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].itemName, '検証案件 基本料金');
  assert.equal(rows[0].quantity, 2);
  assert.equal(rows[0].amount, 40000);
  assert.equal(summaryRows(lines).length, 1);
});

test('請求書と請求取纏書は専用見出し・発行情報・税額を表示する', () => {
  const base = {
    settlement_type:'invoice', document_number:'INV-1', target_year_month:'2026-05', issued_date:'2026-06-01',
    due_date:'2026-06-30', subtotal_amount:40000, tax_amount:4000, total_amount:44000,
    tax_rate:0.1, issuer, recipient:{ name:'検証請求先', zip_code:'000-0001', address:'請求先住所' },
  };
  const lines = [workLine({ id:1, date:'2026-05-01' }), workLine({ id:2, date:'2026-05-02' })];
  const invoice = renderHtml({ ...base, document_type:'invoice' }, lines);
  assert.match(invoice, /ご請求書/);
  assert.match(invoice, /お支払期日/);
  assert.match(invoice, /登録番号/);
  assert.match(invoice, /検証案件 基本料金/);
  assert.doesNotMatch(invoice, /稼働 2026-05-01/);
  const summary = renderHtml({ ...base, document_type:'invoice_summary' }, lines);
  assert.match(summary, /請求取纏書/);
});

test('負号付き7桁単価・会社名1行・会社ロゴを帳票へ反映する', () => {
  const logo = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADElEQVR42mNk+M/wHwAF/gL+XK6mAAAAAElFTkSuQmCC';
  const html = renderHtml({
    settlement_type:'invoice', document_type:'invoice', document_number:'INV-WIDE',
    target_year_month:'2026-05', issued_date:'2026-06-01', due_date:'2026-06-30',
    issuer:{ ...issuer, logo_data_url:logo },
    recipient:{ name:'改行せずに表示する長い検証請求先株式会社' },
  }, [{ line_type:'adjustment', item_name:'単価表示確認', quantity:1, unit_price:-1234567, amount:-1234567 }]);
  assert.match(html, /¥-1,234,567/);
  assert.match(html, /width:30mm;text-align:right/);
  assert.match(html, /company-name\{white-space:nowrap/);
  assert.match(html, /class="logo has-image"/);
  assert.match(html, /<img src="data:image\/png;base64,/);
});

test('支払明細書は上段明細と下段作業料金請求書を一体表示する', () => {
  const lines = [
    workLine({ id:1, date:'2026-05-01', amount:22000, overtime:2000 }),
    { line_type:'deduction', item_name:'事務手数料', quantity:1, unit_price:-1100, amount:-1100, tax_category:'taxable' },
  ];
  const html = renderHtml({
    settlement_type:'payment', document_type:'payment_statement', document_number:'PAY-1',
    target_year_month:'2026-05', issued_date:'2026-06-01', payment_date:'2026-06-30',
    gross_amount:22000, total_amount:20900, issuer,
    recipient:{ name:'検証パートナー', bank_name:'検証銀行', branch_name:'支店', account_number:'1111111' },
  }, lines);
  assert.match(html, /支払明細書/);
  assert.match(html, /作業料金請求書/);
  assert.match(html, /事務手数料/);
  assert.match(html, /negative/);
});

test('作業料金請求書は税込額の税抜換算端数を配賦して小計と一致させる', () => {
  const lines = [
    workLine({ id:1, date:'2026-05-01', amount:42900, overtime:2900 }),
    workLine({ id:2, projectId:11, projectName:'別案件', date:'2026-05-02', amount:18000 }),
  ];
  const html = renderHtml({
    settlement_type:'payment', document_type:'payment_statement', document_number:'PAY-2',
    target_year_month:'2026-05', issued_date:'2026-06-01', payment_date:'2026-06-30',
    gross_amount:60900, total_amount:60900, tax_rate:0.1, issuer,
    recipient:{ name:'検証パートナー' },
  }, lines);
  assert.match(html, /¥55,363/);
  assert.match(html, /¥5,537/);
  assert.match(html, /¥16,364/);
});

test('給与明細は勤務・支給・控除・差引支給を分離する', () => {
  const lines = [
    workLine({ id:1, date:'2026-05-01', amount:22000, overtime:2000 }),
    { line_type:'deduction', item_name:'社会保険料', quantity:1, unit_price:-3000, amount:-3000 },
  ];
  const model = salaryComponents({ settlement_type:'payment' }, lines);
  assert.equal(model.workDays, 1);
  assert.equal(model.deductions.length, 1);
  const html = renderHtml({
    settlement_type:'payment', document_type:'salary_statement', document_number:'SAL-1',
    target_year_month:'2026-05', payment_date:'2026-06-30', gross_amount:22000, total_amount:19000,
    issuer, recipient:{ name:'検証従業員' },
  }, lines);
  assert.match(html, /給与明細/);
  assert.match(html, /平日残業賃金/);
  assert.match(html, /総控除額/);
  assert.match(html, /差引支給額/);
});

test('送付状テンプレートは件名・本文・同封物を表示する', () => {
  const html = renderHtml({
    document_type:'cover_letter', issued_date:'2026-06-01', issuer,
    recipient:{ name:'検証宛先', address:'匿名化住所' }, subject:'給与明細書送付',
    body:'平素はお世話になっております。', enclosures:[{ name:'給与明細', copies:1 }],
  });
  assert.match(html, /送付状/);
  assert.match(html, /給与明細書送付/);
  assert.match(html, /給与明細/);
});
