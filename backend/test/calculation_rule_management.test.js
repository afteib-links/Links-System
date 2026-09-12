const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const route = fs.readFileSync(path.resolve(__dirname,'../src/routes/calculation_rules.js'),'utf8');
const ui = fs.readFileSync(path.resolve(__dirname,'../../frontend/js/calculation_rules.js'),'utf8');
const settlement = fs.readFileSync(path.resolve(__dirname,'../src/routes/settlements.js'),'utf8');

test('公開済み版を直接変更せず下書き・検証・比較・公開を経由する',() => {
  assert.match(route,/status !== 'draft'/);
  assert.match(route,/別の利用者が更新しました/);
  assert.match(route,/\/clone'/);
  assert.match(route,/\/compare'/);
  assert.match(route,/\/publish'/);
  assert.match(route,/definitionChecksum/);
});

test('再計算は選択された未確定下書きだけを対象にする',() => {
  assert.match(route,/row\.status !== 'draft'/);
  assert.match(route,/row\.settlement_status !== 'draft'/);
  assert.match(route,/finalized_snapshot/);
  assert.match(route,/await conn\.rollback/);
  assert.match(ui,/data-recalc-type/);
  assert.match(ui,/選択した未確定データ/);
});

test('精算下書きと確定スナップショットは適用ルール版を保持する',() => {
  assert.match(settlement,/calculation_rule_set_id/);
  assert.match(settlement,/typed-rules-v1/);
  assert.match(settlement,/executeRuleSet/);
});

test('請求の選択再計算と確定は同じ税率優先順位を使い、画面は税率の編集を促さない',() => {
  assert.match(route,/require\('\.\.\/services\/settlement_tax'\)/);
  assert.match(settlement,/require\('\.\.\/services\/settlement_tax'\)/);
  assert.match(route,/resolveInvoiceTax\(conn,row\.company_id,projectIds\)/);
  assert.match(route,/tax_rate:tax\.rate,tax_rounding:/);
  assert.match(ui,/請求税率・端数は請求先→案件→システム設定で決定/);
  assert.doesNotMatch(ui,/data-tax-rate type="number"/);
  assert.match(ui,/実データ全件を検証するものではありません/);
});
