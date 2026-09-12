const crypto = require('crypto');
const { inspectExpression, evaluateExpression } = require('./price_rule_expression');

const STAGES = Object.freeze(['daily','aggregate','deduction','tax','finalize']);
const SIDES = new Set(['billing','payment','both']);
const RULE_VARIABLES = Object.freeze(['side','billing_amount','payment_amount','subtotal_amount','taxable_amount','tax_amount','deduction_total','total_amount']);
const HANDLER_STAGES = Object.freeze({
  daily_price_v1:'daily',aggregate_sum_v1:'aggregate',deduction_sum_v1:'deduction',tax_v1:'tax',finalize_v1:'finalize',
});
const REQUIRED_HANDLERS = Object.freeze({
  billing:['daily_price_v1','aggregate_sum_v1','tax_v1','finalize_v1'],
  payment:['aggregate_sum_v1','deduction_sum_v1','finalize_v1'],
});
const SIDE_LABELS = Object.freeze({ billing:'請求',payment:'支払' });

function json(value, fallback = {}) {
  if (value == null || value === '') return fallback;
  if (typeof value === 'object') return value;
  try { return JSON.parse(value); } catch (_error) { return fallback; }
}

function roundAmount(value, rounding = {}) {
  const unit = Math.max(1, Number(rounding.unit || 1));
  const scaled = Number(value || 0) / unit;
  const mode = String(rounding.mode || 'round');
  const rounded = mode === 'floor' ? Math.floor(scaled) : mode === 'ceil' ? Math.ceil(scaled) : Math.round(scaled);
  return rounded * unit;
}

const HANDLERS = Object.freeze({
  daily_price_v1: async (state, rule, dependencies) => {
    if (typeof dependencies.dailyCalculator !== 'function') throw new Error('日次計算処理が接続されていません');
    const result = await dependencies.dailyCalculator({ ...state.input });
    state.daily = result;
    state.billing_amount = Number(result.calculated_billing_amount || 0);
    state.payment_amount = Number(result.calculated_payment_amount || 0);
  },
  aggregate_sum_v1: async (state) => {
    const lines = Array.isArray(state.lines) ? state.lines : [];
    state.subtotal_amount = lines.reduce((sum, line) => sum + Number(line.amount || 0), 0);
    state.work_amount = lines.filter((line) => line.line_type !== 'adjustment').reduce((sum, line) => sum + Number(line.amount || 0), 0);
    state.adjustment_amount = lines.filter((line) => line.line_type === 'adjustment').reduce((sum, line) => sum + Number(line.amount || 0), 0);
    state.taxable_amount = lines.filter((line) => (line.tax_category || 'taxable') === 'taxable').reduce((sum, line) => sum + Number(line.amount || 0), 0);
  },
  deduction_sum_v1: async (state) => {
    state.deduction_total = (Array.isArray(state.deductions) ? state.deductions : []).reduce((sum, row) => sum + Math.abs(Number(row.amount || 0)), 0);
  },
  tax_v1: async (state, rule) => {
    const params = json(rule.parameter_json);
    const rate = Number(state.tax_rate ?? params.rate ?? 0.1);
    const rounding = { ...json(rule.rounding_json),...(state.tax_rounding || {}) };
    state.tax_amount = roundAmount(Number(state.taxable_amount || 0) * rate,rounding);
  },
  finalize_v1: async (state, rule) => {
    const side = rule.side_code === 'both' ? state.side : rule.side_code;
    state.total_amount = side === 'payment'
      ? Number(state.subtotal_amount ?? state.payment_amount ?? 0) - Number(state.deduction_total || 0)
      : Number(state.subtotal_amount ?? state.billing_amount ?? 0) + Number(state.tax_amount || 0);
  },
});

function normalizeRules(rows) {
  return (rows || []).map((row) => ({
    ...row,
    sort_order:Number(row.sort_order || 0),
    is_active:Number(row.is_active) !== 0,
    parameter_json:json(row.parameter_json),
    rounding_json:json(row.rounding_json),
  })).sort((a,b) => STAGES.indexOf(a.stage_code) - STAGES.indexOf(b.stage_code) || a.sort_order - b.sort_order || Number(a.calculation_rule_id || 0) - Number(b.calculation_rule_id || 0));
}

function validateRuleSet(ruleSet, rows) {
  const errors = [];
  if (!ruleSet || !String(ruleSet.rule_set_code || '').trim()) errors.push('ルールセットコードが必要です');
  if (!String(ruleSet?.rule_set_name || '').trim()) errors.push('ルールセット名称が必要です');
  if (ruleSet?.effective_from && ruleSet?.effective_to && String(ruleSet.effective_from).slice(0,10) > String(ruleSet.effective_to).slice(0,10)) errors.push('適用終了日は適用開始日以降にしてください');
  const rules = normalizeRules(rows);
  const codes = new Set();
  for (const rule of rules) {
    if (!rule.rule_code || codes.has(rule.rule_code)) errors.push(`ルールコードが重複または未入力です: ${rule.rule_code || '(空欄)'}`);
    codes.add(rule.rule_code);
    if (!STAGES.includes(rule.stage_code)) errors.push(`${rule.rule_code}: 計算段階が不正です`);
    if (!SIDES.has(rule.side_code)) errors.push(`${rule.rule_code}: 請求・支払区分が不正です`);
    if (!HANDLERS[rule.handler_code]) errors.push(`${rule.rule_code}: 未対応の処理です (${rule.handler_code})`);
    else if (rule.stage_code !== HANDLER_STAGES[rule.handler_code]) errors.push(`${rule.rule_code}: 処理と計算段階が一致しません`);
    const expression = inspectExpression(rule.condition_expression,RULE_VARIABLES);
    if (!expression.ok) errors.push(`${rule.rule_code}: 条件式 ${expression.message}`);
    if (expression.undefined_variables.length) errors.push(`${rule.rule_code}: 条件式の未定義項目 ${expression.undefined_variables.join(', ')}`);
    if (rule.handler_code === 'tax_v1') {
      const rate = Number(rule.parameter_json.rate);
      if (!Number.isFinite(rate) || rate < 0 || rate > 1) errors.push(`${rule.rule_code}: 税率は0以上1以下で指定してください`);
    }
  }
  for (const [side,handlers] of Object.entries(REQUIRED_HANDLERS)) {
    for (const handler of handlers) {
      if (!rules.some((rule) => rule.is_active && rule.handler_code === handler && rule.stage_code === HANDLER_STAGES[handler]
        && (rule.side_code === side || rule.side_code === 'both') && !String(rule.condition_expression || '').trim())) {
        errors.push(`${SIDE_LABELS[side]}側に条件なしの必須処理がありません: ${handler}`);
      }
    }
  }
  return { ok:errors.length === 0,errors,rules };
}

function definitionChecksum(ruleSet, rules) {
  const canonical = JSON.stringify({
    code:ruleSet.rule_set_code,version:Number(ruleSet.version_no),
    effective_from:ruleSet.effective_from || null,effective_to:ruleSet.effective_to || null,
    rules:normalizeRules(rules).map(({ rule_code,rule_name,stage_code,side_code,handler_code,condition_expression,parameter_json,rounding_json,output_code,sort_order,is_active }) => ({ rule_code,rule_name,stage_code,side_code,handler_code,condition_expression:condition_expression || null,parameter_json,rounding_json,output_code:output_code || null,sort_order,is_active })),
  });
  return crypto.createHash('sha256').update(canonical).digest('hex');
}

async function executeRuleSet(ruleSet, rows, context = {}, dependencies = {}) {
  const validation = validateRuleSet(ruleSet,rows);
  if (!validation.ok) throw new Error(`計算ルールが無効です: ${validation.errors.join(' / ')}`);
  const state = { ...context,side:context.side || 'billing' };
  const selectedStages = Array.isArray(context.stages) ? new Set(context.stages) : null;
  const trace = [];
  for (const rule of validation.rules) {
    if (selectedStages && !selectedStages.has(rule.stage_code)) continue;
    if (!rule.is_active || (rule.side_code !== 'both' && rule.side_code !== state.side)) continue;
    if (rule.condition_expression && !evaluateExpression(rule.condition_expression,state)) continue;
    await HANDLERS[rule.handler_code](state,rule,dependencies);
    trace.push({ rule_code:rule.rule_code,handler_code:rule.handler_code,output_code:rule.output_code || null });
  }
  const requiredOutputs = selectedStages
    ? (selectedStages.has('daily') ? ['billing_amount','payment_amount'] : [])
    : state.side === 'billing'
      ? ['subtotal_amount','taxable_amount','tax_amount','total_amount']
      : ['subtotal_amount','deduction_total','total_amount'];
  for (const output of requiredOutputs) {
    if (typeof state[output] !== 'number' || !Number.isFinite(state[output])) {
      throw new Error(`${SIDE_LABELS[state.side] || state.side}側の計算結果が不正です: ${output}`);
    }
  }
  return { ...state,calculation_rule_set_id:Number(ruleSet.calculation_rule_set_id || 0) || null,calculation_engine_code:'typed-rules-v1',trace };
}

async function loadRuleSet(conn, id) {
  const [sets] = await conn.query('SELECT * FROM calculation_rule_sets WHERE calculation_rule_set_id=?',[id]);
  if (!sets.length) return null;
  const [rules] = await conn.query('SELECT * FROM calculation_rules WHERE calculation_rule_set_id=? ORDER BY sort_order,calculation_rule_id',[id]);
  return { rule_set:sets[0],rules:normalizeRules(rules) };
}

async function resolvePublishedRuleSet(conn, targetDate) {
  const [sets] = await conn.query(`SELECT * FROM calculation_rule_sets WHERE status='published' AND (effective_from IS NULL OR effective_from<=?) AND (effective_to IS NULL OR effective_to>=?) ORDER BY effective_from DESC,version_no DESC LIMIT 1`,[targetDate,targetDate]);
  return sets.length ? loadRuleSet(conn,sets[0].calculation_rule_set_id) : null;
}

module.exports = { STAGES,SIDES,RULE_VARIABLES,HANDLERS,json,roundAmount,normalizeRules,validateRuleSet,definitionChecksum,executeRuleSet,loadRuleSet,resolvePublishedRuleSet };
