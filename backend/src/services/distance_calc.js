const { roundAmount, validationError } = require('./night_calc');

const MODES = ['daily_excess', 'monthly_excess', 'tiered'];
const TIER_MODES = ['fixed', 'all_distance', 'excess_distance', 'progressive'];

function normalizeRule(rule = {}) {
  const normalized = {
    mode: MODES.includes(rule.mode) ? rule.mode : null,
    base_distance: Math.max(0, Number(rule.base_distance ?? 0)),
    tier_mode: TIER_MODES.includes(rule.tier_mode) ? rule.tier_mode : 'excess_distance',
    unit_price: Number(rule.unit_price ?? 0),
    fixed_amount: Number(rule.fixed_amount ?? 0),
    tiers: Array.isArray(rule.tiers) ? rule.tiers.map((tier) => ({
      upper_distance: tier.upper_distance == null || tier.upper_distance === '' ? null : Number(tier.upper_distance),
      unit_price: Number(tier.unit_price ?? 0),
      fixed_amount: Number(tier.fixed_amount ?? 0),
    })) : [],
    rounding: {
      amount_mode: ['floor', 'round', 'ceil'].includes(rule.rounding?.amount_mode) ? rule.rounding.amount_mode : 'floor',
      amount_stage: ['detail', 'day', 'month'].includes(rule.rounding?.amount_stage) ? rule.rounding.amount_stage : 'detail',
    },
  };
  validateDistanceRule(normalized);
  return normalized;
}

function validateDistanceRule(rule) {
  if (!rule || !MODES.includes(rule.mode)) throw validationError('距離計算方式が不正です');
  if (!Number.isInteger(rule.base_distance) || rule.base_distance < 0) throw validationError('基準距離は0以上の整数kmで指定してください');
  if (!Array.isArray(rule.tiers) || rule.tiers.length === 0) {
    if (!Number.isFinite(rule.unit_price) || !Number.isFinite(rule.fixed_amount)) throw validationError('距離単価または固定額が不正です');
    return rule;
  }
  let previous = -1;
  let open = 0;
  rule.tiers.forEach((tier, index) => {
    if (tier.upper_distance == null) { open += 1; if (index !== rule.tiers.length - 1) throw validationError('上限なしの段階は最後に配置してください'); }
    else if (!Number.isInteger(tier.upper_distance) || tier.upper_distance <= previous) throw validationError('距離段階の上限は昇順の整数kmで指定してください');
    if (tier.upper_distance != null) previous = tier.upper_distance;
  });
  if (open > 1) throw validationError('上限なしの段階は1件だけ指定してください');
  if (rule.tiers[rule.tiers.length - 1].upper_distance != null) throw validationError('距離段階の最後は上限なしにしてください');
  return rule;
}

function roundDistanceAmount(amount, rule) {
  return roundAmount(amount, rule.rounding.amount_mode);
}

function tierForDistance(tiers, distance) {
  let lower = 0;
  for (let index = 0; index < tiers.length; index += 1) {
    const tier = tiers[index];
    if (tier.upper_distance == null || distance <= tier.upper_distance) return { ...tier, index, lower_distance: lower };
    lower = tier.upper_distance + 1;
  }
  return null;
}

function calculateDistanceSide({ distance = 0, monthDistance = null, rule }) {
  const config = normalizeRule(rule);
  const inputDistance = Number(distance || 0);
  if (!Number.isInteger(inputDistance) || inputDistance < 0) throw validationError('走行距離は0以上の整数kmで入力してください');
  const accumulated = monthDistance == null ? inputDistance : Number(monthDistance || 0);
  if (!Number.isInteger(accumulated) || accumulated < 0) throw validationError('月間走行距離は0以上の整数kmで指定してください');
  const target = config.mode === 'monthly_excess' ? accumulated : inputDistance;
  const excess = Math.max(0, target - config.base_distance);
  let rawAmount = 0;
  let quantity = excess;
  let tier = null;
  if (config.mode === 'tiered') {
    tier = tierForDistance(config.tiers, target);
    if (!tier) throw validationError('距離段階が不足しています');
    quantity = config.tier_mode === 'all_distance' ? target : config.tier_mode === 'excess_distance' ? excess : target;
    if (config.tier_mode === 'fixed') rawAmount = target > tier.lower_distance ? tier.fixed_amount : 0;
    else if (config.tier_mode === 'progressive') {
      let lower = 0;
      rawAmount = 0;
      for (const current of config.tiers) {
        const upper = current.upper_distance == null ? target : Math.min(target, current.upper_distance);
        const portion = Math.max(0, upper - lower);
        rawAmount += portion * current.unit_price;
        if (target <= upper || current.upper_distance == null) break;
        lower = current.upper_distance;
      }
    } else rawAmount = quantity * tier.unit_price;
  } else {
    rawAmount = excess > 0 ? (config.fixed_amount || config.unit_price * quantity) : 0;
  }
  const amount = roundDistanceAmount(rawAmount, config);
  return {
    rule: config,
    mode: config.mode, distance_km: inputDistance, accumulated_distance_km: accumulated,
    base_distance_km: config.base_distance, target_distance_km: target, excess_distance_km: excess,
    tier_index: tier?.index ?? null, tier_lower_distance_km: tier?.lower_distance ?? null,
    quantity_km: quantity, unit_price: tier?.unit_price ?? config.unit_price,
    fixed_amount: tier?.fixed_amount ?? config.fixed_amount, raw_amount: rawAmount, amount,
    rounding: { ...config.rounding, before: rawAmount, after: amount },
  };
}

function calculateMonthlyDistance({ distances, rule }) {
  const total = (distances || []).reduce((sum, value) => sum + Number(value || 0), 0);
  return calculateDistanceSide({ distance: 0, monthDistance: total, rule });
}

module.exports = { MODES, TIER_MODES, normalizeRule, validateDistanceRule, calculateDistanceSide, calculateMonthlyDistance };
