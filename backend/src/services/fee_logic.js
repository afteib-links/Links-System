const { inspectExpression, evaluateExpression } = require('./price_rule_expression');

const GROUP_CODES = ['daily', 'hourly', 'quantity', 'distance'];
const COMPONENTS = ['basic', 'shortage', 'overtime', 'night', 'night_overtime', 'distance', 'unit'];
function invalid(message, status = 422) {
  return Object.assign(new Error(message), { status, code: 'fee_logic_invalid' });
}
function json(value) { return typeof value === 'string' ? JSON.parse(value) : value; }
function inferGroup(item = {}) {
  const types = (item.rows || []).map((row) => row.item_type);
  if (types.includes('daily_basic')) return 'daily';
  if (types.includes('hourly')) return 'hourly';
  if (types.includes('unit')) return 'quantity';
  if (types.includes('distance') || item.mode === 'distance') return 'distance';
  return (item.calc_types || []).includes('daily') ? 'daily' : 'hourly';
}
function bindGroup(item) {
  const code = item.logic_group_code || inferGroup(item);
  if (!GROUP_CODES.includes(code)) throw invalid('料金カードのロジックグループが不正です');
  return { ...item, logic_group_code: code };
}
function validateDefinition(kind, definition) {
  const data = json(definition);
  if (!data || typeof data !== 'object' || Array.isArray(data)) throw invalid('定義を指定してください');
  if (kind === 'logic') {
    const expression = String(data.expression || '').trim();
    if (!expression || expression.length > 500) throw invalid('算式は1～500文字で指定してください');
    const info = inspectExpression(expression, ['quantity', 'unit_price']);
    if (!info.ok || info.references.some((key) => !['quantity', 'unit_price'].includes(key))) throw invalid(info.message || '使用できる変数は quantity と unit_price だけです');
    if (!info.references.includes('quantity') || !info.references.includes('unit_price')) throw invalid('数量と単価の両方を使用してください');
    return { expression };
  }
  if (kind !== 'group') throw invalid('マスター種別が不正です');
  const members = {};
  for (const component of COMPONENTS) {
    const code = data.members?.[component];
    if (!['multiply', 'deduct'].includes(code)) throw invalid(`${component} の計算ロジックを指定してください`);
    // Shortage is a deduction; a group cannot accidentally turn it into revenue.
    if ((component === 'shortage') !== (code === 'deduct')) throw invalid('不足は控除、その他は加算ロジックを選択してください');
    members[component] = code;
  }
  return { members };
}
function evaluateAmount(definition, quantity, unitPrice) {
  const q = Number(quantity), price = Number(unitPrice);
  if (!Number.isFinite(q) || !Number.isFinite(price) || q < 0 || price < 0) throw invalid('数量と単価は0以上の有限数で指定してください');
  const value = evaluateExpression(definition.expression, { quantity: q, unit_price: price });
  if (typeof value !== 'number' || !Number.isFinite(value) || Math.abs(value) > Number.MAX_SAFE_INTEGER) throw invalid('計算結果が有効な金額ではありません');
  return value;
}
function validateSamples(code, definition, samples) {
  if (!Array.isArray(samples) || samples.length < 1 || samples.length > 20) throw invalid('検算例を1～20件指定してください');
  const results = samples.map((sample) => {
    if (sample.quantity === '' || sample.unit_price === '' || sample.expected === '' || sample.expected == null) throw invalid('検算例の数量・単価・期待金額は必須です');
    const actual = evaluateAmount(definition, sample.quantity, sample.unit_price);
    const expected = Number(sample.expected);
    if (!Number.isFinite(expected) || Math.abs(actual - expected) > 0.000001) throw invalid('検算例の期待金額と計算結果が一致しません');
    return { quantity: Number(sample.quantity), unit_price: Number(sample.unit_price), expected, actual };
  });
  for (const q of [0, 0.25, 1, 18, 1000]) {
    const value = evaluateAmount(definition, q, 17500);
    if ((q === 0 && value !== 0) || (code === 'deduct' ? value > 0 : value < 0)) throw invalid('数量0は0円、加算は非負、控除は非正である必要があります');
  }
  return results;
}
function validDate(value) {
  return /^\d{4}-\d{2}-\d{2}$/.test(String(value)) && Number(String(value).slice(0, 4)) >= 1000 && !Number.isNaN(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value;
}
function selectVersion(versions, code, date) {
  if (!validDate(date)) throw invalid('勤務日または適用開始日が不正です');
  const row = versions.filter((v) => v.master_code === code && String(v.effective_from).slice(0, 10) <= date)
    .sort((a, b) => String(b.effective_from).localeCompare(String(a.effective_from)) || b.version_no - a.version_no)[0];
  if (!row) throw invalid(`${code} の勤務日に適用できる版がありません`);
  return { ...row, definition_json: json(row.definition_json) };
}
async function resolveGroup(query, code, date) {
  if (!GROUP_CODES.includes(code)) throw invalid('ロジックグループが不正です');
  // One statement gives a consistent group/logic snapshot during concurrent publication.
  const rows = await query('SELECT v.* FROM fee_logic_versions v WHERE v.effective_from<=? AND (v.master_code=? OR v.master_code IN (\'multiply\',\'deduct\'))', [date, code]);
  const group = selectVersion(rows, code, date);
  const definition = validateDefinition('group', group.definition_json);
  const logics = {};
  for (const component of COMPONENTS) {
    const logic = selectVersion(rows, definition.members[component], date);
    logics[component] = { id: logic.id, code: logic.master_code, version_no: logic.version_no, effective_from: logic.effective_from, ...validateDefinition('logic', logic.definition_json) };
  }
  return { code, id: group.id, version_no: group.version_no, effective_from: group.effective_from, work_date: date, logics };
}
function amountCalculator(group) {
  if (!group) return null;
  return (component, quantity, unitPrice) => {
    const logic = group.logics[component];
    if (!logic) throw invalid(`グループに ${component} の定義がありません`);
    const result = evaluateAmount(logic, Math.abs(quantity), component === 'shortage' ? Math.abs(unitPrice) : unitPrice);
    if (Number(quantity) === 0 && result !== 0) throw invalid('数量0に対する計算結果は0円である必要があります');
    if ((component === 'shortage' && result > 0) || (component !== 'shortage' && result < 0)) throw invalid('ロジックの加減算が項目の定義と一致しません');
    return result;
  };
}
module.exports = { GROUP_CODES, COMPONENTS, invalid, json, inferGroup, bindGroup, validateDefinition, evaluateAmount, validateSamples, validDate, selectVersion, resolveGroup, amountCalculator };
