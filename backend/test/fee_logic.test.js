const test = require('node:test');
const assert = require('node:assert/strict');
const { validateDefinition, validateSamples, evaluateAmount, selectVersion, resolveGroup, amountCalculator, bindGroup, COMPONENTS } = require('../src/services/fee_logic');
const { calculateNightSide, calculateSideAmounts } = require('../src/services/night_calc');
const { calculateDistanceSide } = require('../src/services/distance_calc');
const members = Object.fromEntries(COMPONENTS.map((c) => [c, c === 'shortage' ? 'deduct' : 'multiply']));
const rows = [
  { id: 1, master_code: 'multiply', version_no: 1, effective_from: '1000-01-01', definition_json: { expression: 'quantity * unit_price' } },
  { id: 2, master_code: 'deduct', version_no: 1, effective_from: '1000-01-01', definition_json: { expression: '-(quantity * unit_price)' } },
  { id: 3, master_code: 'daily', version_no: 1, effective_from: '1000-01-01', definition_json: { members } },
  { id: 4, master_code: 'multiply', version_no: 2, effective_from: '2026-10-01', definition_json: { expression: 'quantity * unit_price * 1.1' } },
];
test('勤務日を使い適用開始日の前日と当日に別の版を選択する', () => {
  assert.equal(selectVersion(rows, 'multiply', '2026-09-30').version_no, 1);
  assert.equal(selectVersion(rows, 'multiply', '2026-10-01').version_no, 2);
  assert.throws(() => selectVersion(rows, 'multiply', '2026-02-30'));
});
test('グループはロジックを共有し、旧スナップショットは変化しない', async () => {
  const before = await resolveGroup(async () => rows, 'daily', '2026-09-30');
  const saved = JSON.stringify(before);
  const after = await resolveGroup(async () => rows, 'daily', '2026-10-01');
  assert.equal(amountCalculator(before)('basic', 18, 17500), 315000);
  assert.equal(amountCalculator(after)('basic', 18, 17500), 346500);
  assert.equal(JSON.stringify(before), saved);
  assert.equal(amountCalculator(after)('shortage', 1, 2333), -2333);
});
test('Excelセル参照、任意JS、別業務変数、非有限値を許可しない', () => {
  for (const expression of ['A1 * B1', 'process.exit()', 'work_hours * unit_price', 'unit_price']) assert.throws(() => validateDefinition('logic', { expression }));
  assert.throws(() => evaluateAmount({ expression: 'unit_price / quantity' }, 0, 100));
  assert.throws(() => evaluateAmount({ expression: 'unit_price * quantity' }, Infinity, 100));
  assert.throws(() => evaluateAmount({ expression: 'unit_price * quantity' }, -1, 100));
});
test('検算例の不一致、数量0の固定加算、加減算の逆転を拒否する', () => {
  const definition = { expression: 'unit_price * quantity' };
  assert.equal(validateSamples('multiply', definition, [{ quantity:18, unit_price:17500, expected:315000 }]).length, 1);
  assert.throws(() => validateSamples('multiply', definition, [{ quantity:18, unit_price:17500, expected:1 }]));
  assert.throws(() => validateSamples('multiply', { expression:'unit_price * quantity + 1' }, [{ quantity:0, unit_price:1, expected:1 }]));
  assert.throws(() => validateDefinition('group', { members: { ...members, shortage:'multiply' } }));
});
test('日・時間・数量・距離を分類し、明示選択とコピー時の関連を保持する', () => {
  for (const [type, code] of [['daily_basic','daily'],['hourly','hourly'],['unit','quantity'],['distance','distance']]) assert.equal(bindGroup({ rows:[{ item_type:type }] }).logic_group_code, code);
  assert.equal(bindGroup({ logic_group_code:'daily', rows:[] }).logic_group_code, 'daily');
  assert.throws(() => bindGroup({ logic_group_code:'unknown' }));
});
test('初期ロジックは既存の日極・時間・深夜・不足・丸め計算と同額', async () => {
  const group = await resolveGroup(async () => rows, 'daily', '2026-09-30');
  let cases = 0;
  for (const calcType of ['daily', 'hourly']) for (const end of ['15:00','17:00','19:30','28:00']) for (const stage of ['detail','day','month']) for (const mode of ['floor','round','ceil']) {
    const item = { matrix: { [calcType]: { basic:{ billing:17500 } }, hourly: { ...(calcType === 'hourly' ? { basic:{ billing:2333 } } : {}), shortage:{ billing:2333 }, overtime:{ billing:2900 }, night:{ billing:3000 }, night_overtime:{ billing:3500 } } } };
    const rounding = { amount_stage:stage, amount_mode:mode, time_unit_minutes:1, time_mode:'floor' };
    const classified = calculateNightSide({ start_time:'09:00',end_time:end,total_break_minutes:60,night_break_minutes:0,standard_minutes:480,rounding });
    const input = { side:'billing',item,classified,rounding };
    const original = calculateSideAmounts(input);
    const linked = calculateSideAmounts({ ...input, calculateAmount:amountCalculator(group) });
    assert.equal(linked.total, original.total);
    for (const component of Object.keys(original.details)) assert.equal(linked.details[component].amount, original.details[component].amount);
    cases++;
  }
  assert.equal(cases,72);
});
test('距離の段階・固定・従量でも金額ロジックを参照する', async () => {
  const before = await resolveGroup(async () => rows, 'daily', '2026-09-30');
  const after = await resolveGroup(async () => rows, 'daily', '2026-10-01');
  const rule = { mode:'daily_excess', base_distance:100, unit_price:100, rounding:{ amount_mode:'round' } };
  assert.equal(calculateDistanceSide({ distance:120,rule,calculateAmount:amountCalculator(before) }).amount,2000);
  assert.equal(calculateDistanceSide({ distance:120,rule,calculateAmount:amountCalculator(after) }).amount,2200);
});
