function num(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function ymLabel(ym) {
  const [y, m] = String(ym || '').split('-');
  return `${y}年${Number(m)}月`;
}

function monthStart(ym) {
  return `${ym}-01`;
}

function shiftYm(ym, delta) {
  const [y, m] = String(ym).split('-').map(Number);
  const d = new Date(y, m - 1 + delta, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

function listMonths(latestYm, count, available) {
  if (count === 'all') {
    const set = [...new Set(available || [])].sort().reverse();
    return set;
  }
  const n = Math.max(1, Number(count) || 12);
  const months = [];
  for (let i = 0; i < n; i += 1) months.push(shiftYm(latestYm, -i));
  return months;
}

function kubunOf(code) {
  return String(code || '') === 'payroll' ? '給与' : '外注';
}

function pickManager(managers, companyId) {
  const hits = (managers || []).filter((m) => Number(m.company_id) === Number(companyId));
  hits.sort((a, b) => String(b.start_date || '').localeCompare(String(a.start_date || '')));
  const row = hits[0];
  if (!row) return { staff_id: '', staff_name: '未設定', area_name: '未設定' };
  return {
    staff_id: row.staff_master_id ? String(row.staff_master_id) : '',
    staff_name: row.staff_name || row.name_or_user || '未設定',
    area_name: String(row.area_name || '').trim() || '未設定',
  };
}

function totalsOf(partners) {
  return partners.reduce(
    (acc, p) => ({
      sales: acc.sales + num(p.sales),
      pay: acc.pay + num(p.pay),
      pay_bill: acc.pay_bill + num(p.pay_bill),
      days: acc.days + num(p.days),
    }),
    { sales: 0, pay: 0, pay_bill: 0, days: 0 }
  );
}

function profitRate(sales, pay) {
  if (!num(sales)) return null;
  return ((num(sales) - num(pay)) / num(sales)) * 100;
}

function companyRow(base, invoice, partners) {
  const tot = totalsOf(partners);
  const hasInvoice = invoice && num(invoice.subtotal) > 0;
  return {
    ...base,
    sales: tot.sales,
    pay: tot.pay,
    days: tot.days,
    bill: hasInvoice ? num(invoice.subtotal) : tot.sales,
    pay_bill: tot.pay_bill,
    tax: hasInvoice ? num(invoice.tax) : null,
    invoice_diff: hasInvoice && num(invoice.subtotal) !== tot.sales,
    profit: tot.sales - tot.pay,
    profit_rate: profitRate(tot.sales, tot.pay),
    partners,
  };
}

function matchesFilter(row, filters = {}) {
  if (filters.area && row.area_name !== filters.area) return false;
  if (filters.staff && String(row.staff_id) !== String(filters.staff) && row.staff_name !== filters.staff) return false;
  if (filters.company_id && Number(row.company_id) !== Number(filters.company_id)) return false;
  return true;
}

function buildPl({ reports = [], invoices = [], payments = [], managers = [], filters = {} }) {
  const invoiceMap = new Map(invoices.map((r) => [Number(r.company_id), r]));
  const paymentMap = new Map(payments.map((r) => [Number(r.partner_id), r]));
  const byCompany = new Map();
  for (const row of reports) {
    const companyId = Number(row.company_id);
    const manager = pickManager(managers, companyId);
    const key = companyId;
    if (!byCompany.has(key)) {
      byCompany.set(key, {
        company_id: companyId,
        company_no: String(row.company_id),
        company_name: row.company_name,
        ...manager,
        partners: [],
      });
    }
    const partnerId = Number(row.partner_id || 0);
    const payDoc = paymentMap.get(partnerId);
    const sales = num(row.sales);
    const pay = num(row.pay);
    byCompany.get(key).partners.push({
      partner_id: partnerId || null,
      partner_name: row.partner_name || '（パートナーなし）',
      kubun: kubunOf(row.employment_type_code),
      sales,
      pay,
      bill: sales,
      pay_bill: payDoc ? num(payDoc.gross_amount) : pay,
      days: num(row.days),
      profit: sales - pay,
      profit_rate: profitRate(sales, pay),
    });
  }
  const companies = [...byCompany.values()]
    .map((c) => companyRow(c, invoiceMap.get(c.company_id), c.partners))
    .filter((c) => matchesFilter(c, filters));

  const areas = [];
  for (const c of companies) {
    let area = areas.find((a) => a.area_name === c.area_name);
    if (!area) {
      area = { area_name: c.area_name, staffs: [] };
      areas.push(area);
    }
    let staff = area.staffs.find((s) => s.staff_id === c.staff_id && s.staff_name === c.staff_name);
    if (!staff) {
      staff = { staff_id: c.staff_id, staff_name: c.staff_name, companies: [] };
      area.staffs.push(staff);
    }
    staff.companies.push(c);
  }
  const roll = (rows) => {
    const t = rows.reduce(
      (acc, r) => ({
        sales: acc.sales + num(r.sales),
        pay: acc.pay + num(r.pay),
        bill: acc.bill + num(r.bill),
        pay_bill: acc.pay_bill + num(r.pay_bill),
        tax: acc.tax + num(r.tax),
        days: acc.days + num(r.days),
        profit: acc.profit + num(r.profit),
      }),
      { sales: 0, pay: 0, bill: 0, pay_bill: 0, tax: 0, days: 0, profit: 0 }
    );
    t.profit_rate = profitRate(t.sales, t.pay);
    return t;
  };
  for (const area of areas) {
    const all = area.staffs.flatMap((s) => s.companies);
    area.totals = roll(all);
    for (const staff of area.staffs) staff.totals = roll(staff.companies);
  }
  return { areas };
}

function buildMargin({ reports = [], invoices = [], payments = [], managers = [], months = [], filters = {} }) {
  const byKey = new Map();
  for (const row of reports) {
    const ym = row.target_year_month;
    const companyId = Number(row.company_id);
    const manager = pickManager(managers, companyId);
    const key = `${companyId}`;
    if (!byKey.has(key)) {
      byKey.set(key, {
        company_id: companyId,
        company_no: String(row.company_id),
        company_name: row.company_name,
        ...manager,
        months: {},
      });
    }
    const bucket = byKey.get(key).months;
    if (!bucket[ym]) bucket[ym] = { sales: 0, pay: 0 };
    bucket[ym].sales += num(row.sales);
    bucket[ym].pay += num(row.pay);
  }
  const rows = [...byKey.values()]
    .filter((c) => matchesFilter(c, filters))
    .map((c) => ({
      ...c,
      rates: months.map((ym) => {
        const cell = c.months[ym];
        return cell ? profitRate(cell.sales, cell.pay) : null;
      }),
    }));
  return { months, rows };
}

function buildDays({ reports = [], managers = [], months = [], filters = {} }) {
  const rows = [];
  for (const row of reports) {
    const manager = pickManager(managers, row.company_id);
    const item = {
      company_id: Number(row.company_id),
      company_no: String(row.company_id),
      company_name: row.company_name,
      partner_id: row.partner_id,
      partner_name: row.partner_name || '（パートナーなし）',
      ...manager,
      months: {},
    };
    const existing = rows.find(
      (r) => r.company_id === item.company_id && Number(r.partner_id || 0) === Number(item.partner_id || 0)
    );
    const target = existing || item;
    if (!existing) rows.push(target);
    target.months[row.target_year_month] = num(row.days);
  }
  const filtered = rows.filter((r) => matchesFilter(r, filters)).map((r) => ({
    ...r,
    days: months.map((ym) => r.months[ym] ?? 0),
  }));
  return { months, rows: filtered };
}

module.exports = {
  num,
  ymLabel,
  monthStart,
  shiftYm,
  listMonths,
  kubunOf,
  pickManager,
  profitRate,
  buildPl,
  buildMargin,
  buildDays,
};
