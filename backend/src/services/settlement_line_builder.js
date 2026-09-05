const PRICE_LABELS = {
  basic: '基本料金',
  overtime: '時間超過',
  night: '深夜料金',
  night_overtime: '深夜時間外',
  distance: 'その他',
  shortage: '不足時間',
};
const COMPONENT_ORDER = ['basic','overtime','night','night_overtime','distance','shortage'];

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

function buildAggregatedLines(reports, kind, config = COMPONENT_ORDER) {
  const configuredOrder=Array.isArray(config)?config:(config.order||COMPONENT_ORDER);
  const priceLabels={...PRICE_LABELS,...(!Array.isArray(config)?config.labels||{}:{})};
  const componentOrder=[...configuredOrder,...COMPONENT_ORDER.filter((value)=>!configuredOrder.includes(value))];
  const side = kind === 'invoice' ? 'billing' : 'payment';
  const grouped = new Map();

  function add(report, component, calcType, unitPrice, quantity, amount, groupName, label, taxCategory = 'taxable') {
    const itemName=`${groupName} ${label}`.trim();
    const key = sourceKey(report.project_id, component, calcType, unitPrice, taxCategory, itemName);
    const previous = grouped.get(key) || {
      line_type: 'work',
      source_type: 'monthly_aggregate',
      source_id: report.monthly_approval_id,
      project_id: report.project_id,
      daily_report_id: null,
      item_name: itemName,
      group_name:groupName,
      component_label:label,
      component_order:componentOrder.indexOf(component),
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
    const template=kind==='invoice'?(detail?.fee_item?.billing_summary_template||'{企業名} {料金名}'):(detail?.fee_item?.payment_summary_template||'{パートナー名} {料金名}');
    const groupName=template
      .replaceAll('{企業名}',report.company_name||'')
      .replaceAll('{パートナー名}',report.partner_name||'')
      .replaceAll('{案件名}',projectName)
      .replaceAll('{料金名}',feeName)
      .replace(/\s+/g,' ').trim();
    const total = effective(report, kind);
    const hasOverride = kind === 'invoice'
      ? report.override_billing_amount != null
      : report.override_payment_amount != null;
    const collected = [];

    if (!hasOverride) {
      for (const [component, label] of Object.entries(priceLabels)) {
        if (component === 'distance') continue;
        const row = components[component];
        const amount = money(row?.amount);
        if (!row || amount === 0) continue;
        const calcType = row.calc_type || (component === 'basic' ? 'daily' : 'hourly');
        const quantity = calcType === 'hourly' ? Number(row.minutes || 0) / 60 : 1;
        collected.push({ component, calcType, rate: money(row.rate), quantity, amount, label });
      }
      const distance = detail?.distance?.[side];
      const distanceAmount = money(distance?.amount ?? report[`distance_amount_${side}`]);
      if (distanceAmount !== 0) {
        collected.push({
          component: 'distance', calcType: 'distance',
          rate: money(distance?.unit_price || distanceAmount),
          quantity: Number(distance?.units || 1), amount: distanceAmount,
          label: priceLabels.distance,
        });
      }
    }

    const componentTotal = money(collected.reduce((sum, row) => sum + row.amount, 0));
    if (!collected.length || Math.abs(componentTotal - total) > 1) {
      add(report, hasOverride ? 'override' : 'fallback', 'daily', total, 1, total, groupName||projectName, hasOverride ? '金額調整後料金' : '基本料金');
      continue;
    }
    for (const row of collected) add(report, row.component, row.calcType, row.rate, row.quantity, row.amount, groupName||projectName, row.label);
  }

  let previousGroup='';
  return [...grouped.values()].sort((a,b)=>String(a.group_name).localeCompare(String(b.group_name),'ja')||(['daily','hourly','distance'].indexOf(a.source_key.split('|')[2])-['daily','hourly','distance'].indexOf(b.source_key.split('|')[2]))||a.component_order-b.component_order).map((line, index) => {
    const showGroup=line.group_name!==previousGroup;previousGroup=line.group_name;
    return ({
    ...line,
    item_name:`${showGroup?`${line.group_name} `:''}${line.component_label}`.trim(),
    quantity: Math.round(line.quantity * 10000) / 10000,
    display_order: (index + 1) * 10,
    snapshot: {
      source_key: line.source_key,
      aggregate_version: 1,
      project_name: line.sources[0]?.snapshot?.project_name || null,
      calc_type: line.source_key.split('|')[2] || 'monthly',
    },
  });});
}

module.exports = { PRICE_LABELS, buildAggregatedLines, effective, parseJson, sourceKey };
