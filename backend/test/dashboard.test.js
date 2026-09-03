const test = require('node:test');
const assert = require('node:assert/strict');
const dashboard = require('../src/routes/dashboard');

test('ダッシュボード集計は完了率と未完了件数を返す', () => {
  const result = dashboard.card('daily_reports', '日報', [
    'completed', 'completed', 'waiting', 'in_progress', 'attention', 'not_started',
  ]);
  assert.equal(result.total, 6);
  assert.equal(result.completed, 2);
  assert.equal(result.incomplete, 4);
  assert.equal(result.waiting, 1);
  assert.equal(result.attention, 1);
  assert.equal(result.progress_percent, 33);
});
