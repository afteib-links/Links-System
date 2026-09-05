const assert = require('node:assert/strict');
const test = require('node:test');

const advancesRouter = require('../src/routes/advances_matrix');

test('3サイクルの支払管理回を定義する', () => {
  assert.equal(advancesRouter.GROUPS.early.paymentCycle, '20');
  assert.equal(advancesRouter.GROUPS.middle.paymentCycle, 'end');
  assert.equal(advancesRouter.GROUPS.late.paymentCycle, '10');
  assert.equal(advancesRouter.GROUPS.late.paymentMonthOffset, 1);
});

test('5日系の3対象期間を計算する', () => {
  assert.deepEqual(advancesRouter.periodForCycle('2026-05', '5', 'early'), {
    start:'2026-04-26', end:'2026-05-05',
  });
  assert.deepEqual(advancesRouter.periodForCycle('2026-05', '15', 'middle'), {
    start:'2026-05-06', end:'2026-05-15',
  });
  assert.deepEqual(advancesRouter.periodForCycle('2026-05', '25', 'late'), {
    start:'2026-05-16', end:'2026-05-25',
  });
});

test('10日系の3対象期間を月末・うるう年込みで計算する', () => {
  assert.deepEqual(advancesRouter.periodFor('2026-05', '10'), {
    start:'2026-05-01', end:'2026-05-10',
  });
  assert.deepEqual(advancesRouter.periodForCycle('2024-02', 'end', 'late'), {
    start:'2024-02-21', end:'2024-02-29',
  });
  assert.deepEqual(advancesRouter.periodForCycle('2025-02', 'end', 'late'), {
    start:'2025-02-21', end:'2025-02-28',
  });
});

test('年越しの月移動を計算する', () => {
  assert.equal(advancesRouter.shiftMonth('2026-12', 1), '2027-01');
  assert.equal(advancesRouter.shiftMonth('2026-01', -1), '2025-12');
});

test('先払ONかつ1円以上だけを合計する', () => {
  const cycles = ['early','middle','late'].map((group_code, index) => ({ group_code, is_target:index !== 1, advance_amount:[100,200,0][index], transfer_fee_amount:550 }));
  const summary = advancesRouter.summarize([{ cycles }]);
  assert.equal(summary.advance_count, 1);
  assert.equal(summary.advance_amount, 100);
  assert.equal(summary.transfer_fee_amount, 550);
});

test('先払対象サイクルだけで案件進捗を判定する', () => {
  const project = { cycles:[
    { is_target:true, advance_amount:100, status:'executed' },
    { is_target:false, advance_amount:200, status:'unplanned' },
    { is_target:true, advance_amount:0, status:'unplanned' },
  ] };
  assert.equal(advancesRouter.advanceProjectStatus(project), 'completed');
  assert.equal(advancesRouter.advanceProjectStatus({ cycles:[{ is_target:false,advance_amount:100,status:'unplanned' }] }), null);
  assert.equal(advancesRouter.advanceProjectStatus({ cycles:[{ is_target:true,advance_amount:100,status:'planned' }] }), 'waiting');
});

test('一括予定作成はセル設定の版不一致を拒否する', () => {
  assert.doesNotThrow(() => advancesRouter.assertCycleVersion(null, 0, 10));
  assert.doesNotThrow(() => advancesRouter.assertCycleVersion({ version:3 }, 3, 10));
  assert.throws(() => advancesRouter.assertCycleVersion({ version:4 }, 3, 10), (error) => error.statusCode === 409 && /再読み込み/.test(error.message));
});

test('CSV出力済みまたは実行済みの予定は再更新を拒否する', () => {
  assert.doesNotThrow(() => advancesRouter.assertMutableSchedule({ status:'planned' }, 10));
  assert.doesNotThrow(() => advancesRouter.assertMutableSchedule({ status:'held' }, 10));
  assert.throws(() => advancesRouter.assertMutableSchedule({ status:'exported' }, 10), (error) => error.statusCode === 409 && /CSV出力済み/.test(error.message));
  assert.throws(() => advancesRouter.assertMutableSchedule({ status:'executed' }, 10), (error) => error.statusCode === 409);
});

test('作成取消はCSV明細とバッチ状態も取消更新する', async () => {
  const calls = [];
  const conn = { query:async (sql, params) => {
    calls.push({ sql,params });
    if (/SELECT cash_export_batch_id/.test(sql)) return [[{ cash_export_batch_id:7 },{ cash_export_batch_id:8 }]];
    return [{}];
  } };
  await advancesRouter.cancelScheduleExports(conn, 25, '誤作成');
  assert.equal(calls.length, 4);
  assert.deepEqual(calls[1].params, ['誤作成',25]);
  assert.deepEqual(calls[2].params, [7,7]);
  assert.deepEqual(calls[3].params, [8,8]);
});
