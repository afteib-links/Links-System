const PRICE_LABELS = {
  basic: '基本料金',
  shortage: '不足時間控除',
  overtime: '時間超過',
  night: '深夜割増',
  night_overtime: '深夜超過',
  distance: '距離超過',
};

function parseJson(value, fallback = {}) {
  if (!value) return fallback;
  if (typeof value === 'object') return value;
  try { return JSON.parse(value); } catch (_error) { return fallback; }
}

function money(value) {
  const number = Number(value || 0);
  return Number.isFinite(number) ? Math.round(number * 100) / 100 : 0;
}

function effective(row, kind) {
  return money(kind === 'invoice'
    ? (row.override_billing_amount ?? row.calculated_billing_amount)
    : (row.override_payment_amount ?? row.calculated_payment_amount));
}

function sourceKey(projectId, component, calcType, unitPrice, taxCategory, itemName) {
  return [projectId || 0, component, calcType, money(unitPrice), taxCategory, itemName].join('|');
}

function buildAggregatedLines(reports, kind) {
  const side = kind === 'invoice' ? 'billing' : 'payment';
  const grouped = new Map();

  function add(report, component, calcType, unitPrice, quantity, amount, itemName, taxCategory = 'taxable') {
    const key = sourceKey(report.project_id, component, calcType, unitPrice, taxCategory, itemName);
    const previous = grouped.get(key) || {
      line_type: 'work',
      source_type: 'monthly_aggregate',
      source_id: report.monthly_approval_id,
      project_id: report.project_id,
      daily_report_id: null,
      item_name: itemName,
      quantity: 0,
      unit_price: money(unitPrice),
      amount: 0,
      tax_category: taxCategory,
      reason: null,
      source_key: key,
      sources: [],
    };
    previous.quantity += Number(quantity || 0);
    previous.amount = money(previous.amount + money(amount));
    previous.sources.push({
      daily_report_id: Number(report.daily_report_id),
      monthly_approval_id: Number(report.monthly_approval_id),
      source_component: component,
      quantity: Number(quantity || 0),
      amount: money(amount),
      snapshot: report,
    });
    grouped.set(key, previous);
  }

  for (const report of reports) {
    const detail = parseJson(report.calculation_detail, {});
    const components = detail?.[side]?.amounts?.details || {};
    const projectName = report.project_name || `案件 #${report.project_id}`;
    const feeName = report.selected_fee_item_name || detail?.fee_item?.name || '';
    const total = effective(report, kind);
    const hasOverride = kind === 'invoice'
      ? report.override_billing_amount != null
      : report.override_payment_amount != null;
    const collected = [];

    if (!hasOverride) {
      for (const [component, label] of Object.entries(PRICE_LABELS)) {
        if (component === 'distance') continue;
        const row = components[component];
        const amount = money(row?.amount);
        if (!row || amount === 0) continue;
        const calcType = row.calc_type || (component === 'basic' ? 'daily' : 'hourly');
        const quantity = calcType === 'hourly' ? Number(row.minutes || 0) / 60 : 1;
        const itemName = `${projectName}${feeName ? ` ${feeName}` : ''} ${label}`.trim();
        collected.push({ component, calcType, rate: money(row.rate), quantity, amount, itemName });
      }
      const distance = detail?.distance?.[side];
      const distanceAmount = money(distance?.amount ?? report[`distance_amount_${side}`]);
      if (distanceAmount !== 0) {
        collected.push({
          component: 'distance', calcType: 'distance',
          rate: money(distance?.unit_price || distanceAmount),
          quantity: Number(distance?.units || 1), amount: distanceAmount,
          itemName: `${projectName} ${PRICE_LABELS.distance}`,
        });
      }
    }

    const componentTotal = money(collected.reduce((sum, row) => sum + row.amount, 0));
    if (!collected.length || Math.abs(componentTotal - total) > 1) {
      const itemName = `${projectName}${feeName ? ` ${feeName}` : ''} ${hasOverride ? '金額調整後料金' : '基本料金'}`.trim();
      add(report, hasOverride ? 'override' : 'fallback', 'daily', total, 1, total, itemName);
      continue;
    }
    for (const row of collected) add(report, row.component, row.calcType, row.rate, row.quantity, row.amount, row.itemName);
  }

  return [...grouped.values()].map((line, index) => ({
    ...line,
    quantity: Math.round(line.quantity * 10000) / 10000,
    display_order: (index + 1) * 10,
    snapshot: {
      source_key: line.source_key,
      aggregate_version: 1,
      project_name: line.sources[0]?.snapshot?.project_name || null,
      calc_type: line.source_key.split('|')[2] || 'monthly',
    },
  }));
}

module.exports = { PRICE_LABELS, buildAggregatedLines, effective, parseJson, sourceKey };
