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
