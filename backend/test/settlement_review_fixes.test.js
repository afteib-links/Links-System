const test = require('node:test');
const assert = require('node:assert/strict');

const settlementsRouter = require('../src/routes/settlements');
const paymentsRouter = require('../src/routes/payments');
const companiesRouter = require('../src/routes/companies');

test('企業更新はpayloadにない旧送付項目を更新対象に含めない', () => {
  const data = companiesRouter.pickCompany({company_name:'検証企業',office_name:'本社'});
  const fields = companiesRouter.companyUpdateFields(data);
  assert.deepEqual(fields, ['office_name','company_name']);
  assert.equal(fields.includes('invoice_send_method'), false);
  assert.equal(fields.includes('invoice_send_address'), false);
});

test('摘要表示名は変更後の表示順に対応する', () => {
  const config = settlementsRouter.normalizeSettlementLineConfig({
    settlement_line_display_order:'shortage,basic,overtime,night,night_overtime,distance',
    settlement_line_display_labels:'不足,基本,超過,深夜,深夜超過,その他',
  });
  assert.deepEqual(config.order, ['shortage','basic','overtime','night','night_overtime','distance']);
  assert.equal(config.labels.shortage, '不足');
  assert.equal(config.labels.basic, '基本');
});

test('取纏請求の見本は案件単位の表示行へ集約する', () => {
  const lines = [
    {project_id:1,line_type:'work',item_name:'基本料金',quantity:2,amount:20000},
    {project_id:1,line_type:'work',item_name:'時間超過',quantity:1,amount:2000},
    {project_id:null,line_type:'adjustment',item_name:'調整',quantity:1,amount:-500},
  ];
  const display = settlementsRouter.invoiceDisplayLines(lines, 'project_aggregated');
  assert.deepEqual(display.map((line) => [line.item_name,line.quantity,line.amount]), [
    ['案件 #1',3,22000],
    ['調整',1,-500],
  ]);
});

test('支払見本用控除は支払総額を上限に正式確定と同じ順で適用する', () => {
  const result = settlementsRouter.applyPaymentDeductions(10000, [
    {type:'advance',row:{advance_record_id:1},name:'前払控除',amount:7000,tax:'non_taxable'},
    {type:'advance_fee',row:{advance_record_id:1},name:'前払手数料',amount:1000,tax:'non_taxable'},
    {type:'rule',row:{settlement_deduction_rule_id:2},name:'会費',amount:5000,tax:'taxable'},
  ]);
  assert.equal(result.finalAmount, 0);
  assert.deepEqual(result.lines.map((line) => line.amount), [-7000,-1000,-2000]);
  assert.equal(result.applications[2].remainder, 3000);
});

test('同一パートナー・締日の複数案件で控除を重複計上しない', () => {
  const targets = [
    {partner_id:1,closing_date:'end',gross_amount:6000,advance_deduction_amount:7000,transfer_fee_deduction_amount:1000,deduction_rules:[{rule_code:'fee',amount:2000}]},
    {partner_id:1,closing_date:'end',gross_amount:9000,advance_deduction_amount:7000,transfer_fee_deduction_amount:1000,deduction_rules:[{rule_code:'fee',amount:2000}]},
  ];
  paymentsRouter.allocateTargetGroupDeductions(targets);
  assert.deepEqual(targets.map((target) => target.final_transfer_amount), [0,5000]);
  assert.equal(targets.reduce((sum,target) => sum + target.advance_deduction_amount,0), 7000);
  assert.equal(targets.reduce((sum,target) => sum + target.transfer_fee_deduction_amount,0), 1000);
  assert.equal(targets.reduce((sum,target) => sum + target.rule_deduction_amount,0), 2000);
});
