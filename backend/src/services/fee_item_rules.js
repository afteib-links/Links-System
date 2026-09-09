const { inspectExpression, evaluateExpression } = require('./price_rule_expression');

const ITEM_MAPPING = Object.freeze({
  daily_basic: ['daily', 'basic'],
  hourly: ['hourly', 'basic'],
  overtime: ['hourly', 'overtime'],
  night: ['hourly', 'night'],
  night_overtime: ['hourly', 'night_overtime'],
  distance: ['distance', 'basic'],
  table: ['distance', 'basic'],
  unit: ['unit', 'basic'],
});

function isRowsModel(item) {
  return Array.isArray(item?.rows);
}

function normalizeRuleRow(row, index = 0) {
  const expressions = ['condition_expression', 'billing_expression', 'payment_expression'];
  const inspections = expressions.map((key) => inspectExpression(row?.[key]));
  const invalid = inspections.find((value) => !value.ok);
  const undefinedVariables = [...new Set(inspections.flatMap((value) => value.undefined_variables || []))];
  return {
    id: row?.id || `fr_${Date.now()}_${index}`,
    item_name: String(row?.item_name || row?.name || ''),
    item_type: String(row?.item_type || 'daily_basic'),
    billing: Number(row?.billing || 0),
    payment: Number(row?.payment || 0),
    billing_detail_name: String(row?.billing_detail_name || ''),
    payment_detail_name: String(row?.payment_detail_name || ''),
    condition_expression: String(row?.condition_expression || ''),
    billing_expression: String(row?.billing_expression || ''),
    payment_expression: String(row?.payment_expression || ''),
    sort_order: Number(row?.sort_order ?? (index + 1) * 10),
    rule_state: invalid || undefinedVariables.length ? 'draft' : 'active',
    rule_error: invalid?.message || null,
    undefined_variables: undefinedVariables,
    lineIds: { ...(row?.lineIds || {}) },
    distance: row?.distance || null,
    table: row?.table || null,
  };
}

function validateFeeItems(feeItems) {
  const errors = [];
  const items = (feeItems || []).map((item, itemIndex) => ({
    ...item,
    sort_order: Number(item.sort_order ?? (itemIndex + 1) * 10),
    rows: Array.isArray(item.rows)
      ? item.rows.map((row, rowIndex) => {
          const normalized = normalizeRuleRow(row, rowIndex);
          if (normalized.rule_error) errors.push(`${item.name || '料金カード'}: ${normalized.rule_error}`);
          return normalized;
        })
      : item.rows,
  }));
  return { items, errors };
}

function firstMatchingRows(item, variables) {
  const selected = new Map();
  const warnings = [];
  const rows = (item?.rows || []).map(normalizeRuleRow).sort((a, b) => a.sort_order - b.sort_order);
  for (const row of rows) {
    if (row.rule_state !== 'active') continue;
    if (selected.has(row.item_type)) continue;
    let matched = true;
    if (row.condition_expression) {
      try { matched = Boolean(evaluateExpression(row.condition_expression, variables)); }
      catch (error) { matched = false; warnings.push({ code: 'fee_rule_error', row_id: row.id, message: error.message }); }
    }
    if (matched) selected.set(row.item_type, row);
  }
  return { selected, warnings };
}

function amountFor(row, side, variables) {
  const expression = row?.[`${side}_expression`];
  if (!expression) return Number(row?.[side] || 0);
  const value = Number(evaluateExpression(expression, { ...variables, billing: Number(row.billing || 0), payment: Number(row.payment || 0) }));
  if (!Number.isFinite(value)) throw new Error(`${side === 'billing' ? '請求' : '支払'}式の結果が数値ではありません`);
  return value;
}

function materializeFeeItem(item, variables, side) {
  if (!isRowsModel(item)) return { item, warnings: [], selected_rows: {} };
  const { selected, warnings } = firstMatchingRows(item, variables);
  const matrix = { daily: {}, hourly: {}, distance: {}, unit: {} };
  const selectedRows = {};
  for (const [itemType, row] of selected) {
    const mapping = ITEM_MAPPING[itemType];
    if (!mapping) continue;
    try {
      const [calc, priceType] = mapping;
      if (!matrix[calc]) matrix[calc] = {};
      if (!matrix[calc][priceType]) matrix[calc][priceType] = { billing: '', payment: '', lineIds: {} };
      matrix[calc][priceType][side] = amountFor(row, side, variables);
      selectedRows[itemType] = {
        id: row.id,
        item_name: row.item_name,
        billing_detail_name: row.billing_detail_name,
        payment_detail_name: row.payment_detail_name,
      };
      if (itemType === 'hourly') {
        matrix.hourly.shortage = matrix.hourly.shortage || { billing: '', payment: '', lineIds: {} };
        matrix.hourly.shortage[side] = matrix.hourly.basic[side];
      }
    } catch (error) {
      warnings.push({ code: 'fee_formula_error', row_id: row.id, message: error.message });
    }
  }
  if (!selected.size) {
    warnings.push({ code: 'fee_rule_no_match', message: '有効な料金行がないため金額を0円として要確認にしました' });
  }
  return { item: { ...item, calc_types: Object.keys(matrix), matrix }, warnings, selected_rows: selectedRows };
}

function feeItemsToLines(items) {
  const lines = [];
  let sortOrder = 0;
  for (const item of items || []) {
    const weekdays = item.weekdays?.all
      ? ['all']
      : Object.keys(item.weekdays || {}).filter((code) => code !== 'all' && item.weekdays[code]);
    for (const row of (item.rows || []).map(normalizeRuleRow).sort((a, b) => a.sort_order - b.sort_order)) {
      const mapping = ITEM_MAPPING[row.item_type];
      if (!mapping) continue;
      const [calc, priceType] = mapping;
      const targetDays = calc === 'distance' ? ['all'] : weekdays;
      for (const weekday of targetDays) {
        lines.push({
          price_set_line_id: row.lineIds?.[weekday] || null,
          weekday_code: weekday,
          calc_type_code: calc,
          price_type_code: priceType,
          billing_unit_price: Number(row.billing || 0),
          payment_unit_price: Number(row.payment || 0),
          sort_order: sortOrder++,
        });
        if (row.item_type === 'hourly') {
          lines.push({
            price_set_line_id: row.lineIds?.[`${weekday}:shortage`] || null,
            weekday_code: weekday,
            calc_type_code: 'hourly',
            price_type_code: 'shortage',
            billing_unit_price: Number(row.billing || 0),
            payment_unit_price: Number(row.payment || 0),
            sort_order: sortOrder++,
          });
        }
      }
    }
  }
  return lines;
}

module.exports = {
  ITEM_MAPPING,
  isRowsModel,
  normalizeRuleRow,
  validateFeeItems,
  firstMatchingRows,
  materializeFeeItem,
  feeItemsToLines,
};
