const { getPool } = require('../db');
const { applyDailyPriceCalc } = require('./price_calc');
const { definitionChecksum,executeRuleSet,resolvePublishedRuleSet } = require('./calculation_rule_engine');

function parseDetail(value) {
  if (!value) return {};
  if (typeof value === 'object') return value;
  try { return JSON.parse(value); } catch (_error) { return {}; }
}

async function applyDailyPriceCalcWithRules(data, dependencies = {}) {
  const dailyCalculator = dependencies.dailyCalculator || applyDailyPriceCalc;
  const resolve = dependencies.resolveRuleSet || ((date) => resolvePublishedRuleSet(getPool(),date));
  const selected = await resolve(data.work_date);
  if (!selected) throw new Error(`適用可能な公開計算ルールがありません: ${data.work_date || '(日付未入力)'}`);
  const executed = await executeRuleSet(selected.rule_set,selected.rules,{
    side:'billing',stages:['daily'],input:data,
  },{ dailyCalculator });
  const result = executed.daily;
  const detail = parseDetail(result.calculation_detail);
  detail.rule_engine = {
    calculation_rule_set_id:executed.calculation_rule_set_id,
    calculation_engine_code:executed.calculation_engine_code,
    definition_checksum:selected.rule_set.definition_checksum || definitionChecksum(selected.rule_set,selected.rules),
    trace:executed.trace,
  };
  return {
    ...result,
    calculation_detail:JSON.stringify(detail),
    calculation_rule_set_id:executed.calculation_rule_set_id,
    calculation_engine_code:executed.calculation_engine_code,
  };
}

module.exports = { applyDailyPriceCalcWithRules,parseDetail };
