const fs = require('fs/promises');
const path = require('path');

const PDF_DIR = process.env.PDF_DIR || '/app/pdf';
const PRICE_LABELS = {
  basic: '基本料金',
  shortage: '不足時間控除',
  overtime: '時間超過',
  night: '深夜割増',
  night_overtime: '深夜超過',
  distance: '距離超過',
};

function escape(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function parseJson(value, fallback = {}) {
  if (!value) return fallback;
  if (typeof value === 'object') return value;
  try { return JSON.parse(value); } catch (_error) { return fallback; }
}

function number(value) {
  const parsed = Number(value || 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function yen(value, suffix = '') {
  return `￥${Math.round(number(value)).toLocaleString('ja-JP')}${suffix}`;
}

function yenUnit(value) {
  const amount = number(value);
  return `￥${amount.toLocaleString('ja-JP', {
    minimumFractionDigits:Number.isInteger(amount) ? 0 : 1,
    maximumFractionDigits:2,
  })}`;
}

function quantity(value) {
  const n = number(value);
  return n.toLocaleString('ja-JP', {
    minimumFractionDigits: Number.isInteger(n) ? 0 : 2,
    maximumFractionDigits: 2,
  });
}

function formatDate(value) {
  const match = String(value || '').slice(0, 10).match(/^(\d{4})-(\d{2})-(\d{2})$/);
  return match ? `${Number(match[1])}年${Number(match[2])}月${Number(match[3])}日` : escape(value || '');
}

function formatMonth(value) {
  const match = String(value || '').match(/^(\d{4})-(\d{2})$/);
  return match ? `${Number(match[1])}年${Number(match[2])}月` : escape(value || '');
}

function safeImage(value) {
  const source = String(value || '');
  return /^data:image\/(png|jpeg|webp);base64,/i.test(source) ? source : '';
}

function companyNameStyle(value, suffix = '') {
  const length = [...`${value || ''}${suffix || ''}`].length;
  const size = length >= 30 ? 7.5 : length >= 24 ? 8.5 : length >= 18 ? 9.5 : 11.5;
  return `font-size:${size}pt`;
}

function snapshotFor(line) {
  const snapshot = parseJson(line.snapshot ?? line.snapshot_json, {});
  if (typeof snapshot.calculation_detail === 'string') {
    snapshot.calculation_detail = parseJson(snapshot.calculation_detail, {});
  }
  return snapshot;
}

function addGrouped(map, key, row) {
  const existing = map.get(key);
  if (existing) {
    existing.quantity += number(row.quantity);
    existing.amount += number(row.amount);
    existing.minutes += number(row.minutes);
    existing.days.add(row.workDate || '');
    return;
  }
  map.set(key, {
    ...row,
    quantity:number(row.quantity),
    amount:number(row.amount),
    minutes:number(row.minutes),
    days:new Set([row.workDate || '']),
  });
}

function detailedWorkRows(document, lines) {
  const side = document.settlement_type === 'invoice' ? 'billing' : 'payment';
  const grouped = new Map();
  for (const line of lines.filter((item) => item.line_type === 'work' && number(item.amount) !== 0)) {
    const snapshot = snapshotFor(line);
    if (line.source_type === 'monthly_aggregate' || line.source_type === 'correction_copy') {
      addGrouped(grouped, snapshot.source_key || `line:${line.settlement_line_id}`, {
        projectName:snapshot.project_name || `案件 #${line.project_id || '-'}`,
        itemName:line.item_name,
        calcType:snapshot.calc_type || 'monthly',
        unitPrice:number(line.unit_price),
        quantity:number(line.quantity),
        amount:number(line.amount),
        minutes:number(snapshot.minutes || 0),
        workDate:'',
      });
      continue;
    }
    const calculation = snapshot.calculation_detail || {};
    const detail = calculation?.[side]?.amounts?.details || {};
    const projectName = snapshot.project_name || line.project_name || `案件 #${line.project_id || '-'}`;
    const feeName = snapshot.selected_fee_item_name || calculation?.fee_item?.name || '';
    const workDate = String(snapshot.work_date || '').slice(0, 10);
    const components = [];
    for (const [type, label] of Object.entries(PRICE_LABELS)) {
      if (type === 'distance') continue;
      const component = detail[type];
      if (!component || number(component.amount) === 0) continue;
      const calcType = component.calc_type || 'daily';
      components.push({
        type,
        label,
        calcType,
        rate:number(component.rate),
        quantity:calcType === 'hourly' ? number(component.minutes) / 60 : 1,
        amount:number(component.amount),
        minutes:number(component.minutes),
      });
    }
    const distance = calculation?.distance?.[side];
    const distanceAmount = number(distance?.amount ?? snapshot[`distance_amount_${side}`]);
    if (distanceAmount !== 0) {
      components.push({
        type:'distance',
        label:PRICE_LABELS.distance,
        calcType:'distance',
        rate:number(distance?.unit_price || distanceAmount),
        quantity:number(distance?.units || 1),
        amount:distanceAmount,
        minutes:0,
      });
    }
    const componentTotal = components.reduce((sum, item) => sum + item.amount, 0);
    if (!components.length || Math.abs(componentTotal - number(line.amount)) > 1) {
      addGrouped(grouped, `fallback:${line.project_id}:${number(line.unit_price)}`, {
        projectName,
        itemName:`${projectName}${feeName ? ` ${feeName}` : ' 基本料金'}`,
        calcType:'daily',
        unitPrice:number(line.unit_price),
        quantity:number(line.quantity || 1),
        amount:number(line.amount),
        minutes:0,
        workDate,
      });
      continue;
    }
    for (const component of components) {
      addGrouped(grouped, `${line.project_id}:${component.type}:${component.calcType}:${component.rate}`, {
        projectName,
        itemName:`${projectName} ${component.label}`,
        calcType:component.calcType,
        unitPrice:component.rate,
        quantity:component.quantity,
        amount:component.amount,
        minutes:component.minutes,
        workDate,
      });
    }
  }
  return [...grouped.values()].map((row) => ({ ...row, days:row.days.size }));
}

function adjustmentRows(lines) {
  return lines
    .filter((line) => line.line_type !== 'work' && number(line.amount) !== 0)
    .map((line) => ({
      itemName:line.item_name,
      quantity:number(line.quantity || 1),
      unitPrice:number(line.unit_price ?? line.amount),
      amount:number(line.amount),
      taxCategory:line.tax_category || 'taxable',
    }));
}

function summaryRows(lines) {
  const grouped = new Map();
  for (const line of lines.filter((item) => item.line_type === 'work' && number(item.amount) !== 0)) {
    const snapshot = snapshotFor(line);
    if (line.source_type === 'monthly_aggregate' || line.source_type === 'correction_copy') {
      const key = String(line.project_id || `line:${line.settlement_line_id}`);
      const existing = grouped.get(key) || {
        itemName:snapshot.project_name || `案件 #${line.project_id || '-'}`,
        quantity:0,
        unitPrice:0,
        amount:0,
        dates:new Set(),
      };
      existing.quantity += number(line.quantity); existing.amount += number(line.amount); grouped.set(key,existing);
      continue;
    }
    const projectName = snapshot.project_name || line.project_name || `案件 #${line.project_id || '-'}`;
    const key = String(line.project_id || projectName);
    const existing = grouped.get(key) || {
      itemName:projectName,
      quantity:0,
      unitPrice:0,
      amount:0,
      dates:new Set(),
    };
    existing.quantity += number(line.quantity || 1);
    existing.amount += number(line.amount);
    existing.dates.add(String(snapshot.work_date || line.daily_report_id || ''));
    grouped.set(key, existing);
  }
  return [...grouped.values()].map((row) => ({
    ...row,
    quantity:row.dates.size || row.quantity,
    unitPrice:(row.dates.size || row.quantity) ? row.amount / (row.dates.size || row.quantity) : row.amount,
  }));
}

function issuerBlock(document, compact = false) {
  const issuer = document.issuer || {};
  const logo = safeImage(issuer.logo_data_url);
  const stamp = safeImage(issuer.stamp_data_url);
  return `<div class="issuer ${compact ? 'compact' : ''}">
    <div class="logo ${logo ? 'has-image' : ''}">${logo ? `<img src="${logo}" alt="会社ロゴ">` : '会社ロゴ'}</div>
    <div class="issuer-name company-name" style="${companyNameStyle(issuer.name || '発行元会社名')}">${escape(issuer.name || '発行元会社名')}</div>
    ${issuer.registration_number ? `<div>登録番号　${escape(issuer.registration_number)}</div>` : ''}
    ${issuer.zip_code ? `<div>〒 ${escape(issuer.zip_code)}</div>` : ''}
    <div>${escape(issuer.address || '')}</div>
    <div>${issuer.tel ? `TEL：${escape(issuer.tel)}` : ''}${issuer.fax ? `　FAX：${escape(issuer.fax)}` : ''}</div>
    ${stamp ? `<img class="stamp-image" src="${stamp}" alt="社印">` : ''}
  </div>`;
}

function recipientBlock(recipient, suffix) {
  return `<div class="recipient-box">
    ${recipient?.zip_code ? `<div>〒 ${escape(recipient.zip_code)}</div>` : '<div>　</div>'}
    <div>${escape(recipient?.address || '')}</div>
    <div class="recipient-name company-name" style="${companyNameStyle(recipient?.name, suffix)}">${escape(recipient?.name || '')}　${suffix}</div>
  </div>`;
}

function bankBlock(document, owner = 'issuer') {
  const target = document[owner] || {};
  const banks = Array.isArray(target.bank_accounts) ? [...target.bank_accounts] : [];
  if (!banks.length && target.bank_name) banks.push(target);
  if (!banks.length) return '';
  return `<div class="bank"><strong>お振込銀行</strong>${banks.slice(0, 2).map((bank) =>
    `<div>■ ${escape(bank.bank_name || '')} ${escape(bank.branch_name || '')}　${escape(bank.deposit_type || '')}　${escape(bank.account_number || '')}　${escape(bank.account_name || '')}</div>`
  ).join('')}</div>`;
}

function invoiceRowsHtml(rows, minimumRows = 7) {
  const body = rows.map((row, index) => `<tr class="${number(row.amount) < 0 ? 'negative' : ''}">
    <td class="center">${index + 1}</td><td>${escape(row.itemName)}</td><td class="money">${yenUnit(row.unitPrice)}</td>
    <td class="num">${quantity(row.quantity)}</td><td class="money">${yen(row.amount)}</td></tr>`).join('');
  const blanks = Array.from(
    { length:Math.max(0, minimumRows - rows.length) },
    () => '<tr class="blank"><td></td><td></td><td></td><td></td><td></td></tr>'
  ).join('');
  return body + blanks;
}

function paymentRowsHtml(rows, minimumRows = 5) {
  const body = rows.map((row, index) => `<tr class="${number(row.amount) < 0 ? 'negative' : ''}">
    <td class="center">${index + 1}</td><td>${escape(row.itemName)}</td><td class="num">${quantity(row.quantity)}</td>
    <td class="money">${yenUnit(row.unitPrice)}</td><td class="money">${yen(row.amount)}</td></tr>`).join('');
  const blanks = Array.from(
    { length:Math.max(0, minimumRows - rows.length) },
    () => '<tr class="blank"><td></td><td></td><td></td><td></td><td></td></tr>'
  ).join('');
  return body + blanks;
}

function renderInvoice(document, lines, summary) {
  const recipient = document.recipient || { name:document.company_name };
  const rows = [
    ...(summary ? summaryRows(lines) : detailedWorkRows(document, lines)),
    ...adjustmentRows(lines),
  ];
  const subtotal = number(document.subtotal_amount ?? rows.reduce((sum, row) => sum + number(row.amount), 0));
  const tax = number(document.tax_amount ?? Math.floor(subtotal * number(document.tax_rate || 0.1)));
  const total = number(document.total_amount ?? subtotal + tax);
  const title = summary
    ? `${formatMonth(document.target_year_month)}度 請求取纏書`
    : `${formatMonth(document.target_year_month)}度ご請求書`;
  return `<section class="sheet invoice-sheet">
    <div class="top-grid">${recipientBlock(recipient, '御中')}<div><h1>${title}</h1><div class="rule-title"></div><div class="issue-date">${formatDate(document.issued_date)}</div>${issuerBlock(document)}</div></div>
    <div class="invoice-meta"><div>毎度、お引き立てにあずかり誠にありがとうございます。<br>下記の通りご請求申し上げますので、ご査収下さい。</div><div><strong>お支払期日　</strong>${formatDate(document.due_date)}</div></div>
    <div class="amount-box"><div><strong>ご請求額</strong><span>${yen(total, '-')}</span></div><div><strong>内消費税</strong><span>${yen(tax, '-')}</span></div></div>
    <div class="invoice-bank">${bankBlock(document)}${document.transfer_fee_note ? `<div class="note">※ ${escape(document.transfer_fee_note)}</div>` : ''}</div>
    <table class="lines"><thead><tr><th class="no">NO.</th><th>摘　要</th><th>単　価</th><th>個　数</th><th>金　額</th></tr></thead><tbody>
      ${invoiceRowsHtml(rows, 8)}
      <tr class="sum"><td colspan="2" rowspan="3"></td><th colspan="2">小計</th><td class="money">${yen(subtotal)}</td></tr>
      <tr class="sum"><th colspan="2">消費税 ${Math.round(number(document.tax_rate || 0.1) * 100)}％</th><td class="money">${yen(tax)}</td></tr>
      <tr class="sum"><th colspan="2">合計</th><td class="money">${yen(total)}</td></tr>
    </tbody></table><div class="document-number">帳票番号：${escape(document.document_number || '')}</div>
  </section>`;
}

function renderPayment(document, lines) {
  const recipient = document.recipient || { name:document.partner_name };
  const rows = [...summaryRows(lines), ...adjustmentRows(lines)];
  const grossRows = [
    ...detailedWorkRows(document, lines).map((row) => ({ ...row, taxCategory:'taxable' })),
    ...adjustmentRows(lines.filter((line) => line.line_type === 'adjustment')),
  ];
  const gross = number(document.gross_amount ?? lines
    .filter((line) => line.line_type === 'work' || line.line_type === 'adjustment')
    .reduce((sum, line) => sum + number(line.amount), 0));
  const total = number(document.total_amount);
  const rate = number(document.tax_rate || 0.1);
  const taxableRows = grossRows.filter((row) => row.taxCategory !== 'non_taxable');
  const taxableGross = taxableRows.reduce((sum, row) => sum + number(row.amount), 0);
  const taxableSubtotal = rate > 0 ? Math.floor(taxableGross / (1 + rate)) : taxableGross;
  const includedTax = taxableGross - taxableSubtotal;
  let allocatedTaxableSubtotal = 0;
  let taxableIndex = 0;
  const workInvoiceRows = grossRows.map((row) => {
    if (row.taxCategory === 'non_taxable' || rate <= 0) return row;
    taxableIndex += 1;
    const amount = taxableIndex === taxableRows.length
      ? taxableSubtotal - allocatedTaxableSubtotal
      : Math.floor(number(row.amount) / (1 + rate));
    allocatedTaxableSubtotal += amount;
    return {
      ...row,
      amount,
      unitPrice:number(row.quantity) ? amount / number(row.quantity) : amount,
    };
  });
  const workSubtotal = workInvoiceRows.reduce((sum, row) => sum + number(row.amount), 0);
  return `<section class="sheet payment-sheet">
    <div class="top-grid payment-top">${recipientBlock(recipient, '様')}<div><h1>${formatMonth(document.target_year_month)}度支払明細書</h1><div class="rule-title"></div>${issuerBlock(document, true)}<div class="pay-date"><strong>お振込日　</strong>${formatDate(document.payment_date)}</div></div></div>
    <div class="payment-total"><span>お支払金額</span><strong>${yen(total)}</strong></div>
    <table class="lines compact-lines"><thead><tr><th class="no">NO.</th><th>摘　要</th><th>数　量</th><th>単　価</th><th>金　額</th></tr></thead><tbody>${paymentRowsHtml(rows, 5)}<tr class="sum"><td colspan="2">※ お問い合わせ等は各営業担当までご連絡下さい。</td><th colspan="2">合計</th><td class="money">${yen(total)}</td></tr></tbody></table>
    <div class="split-rule"></div><h2>${formatMonth(document.target_year_month)}度　作業料金請求書</h2>
    <div class="work-invoice-head"><div><div>〒 ${escape(document.issuer?.zip_code || '')}　${escape(document.issuer?.address || '')}</div><div class="recipient-name company-name" style="${companyNameStyle(document.issuer?.name || '発行元会社名', '御中')}">${escape(document.issuer?.name || '発行元会社名')}　御中</div></div><div><div>${formatDate(document.issued_date)}</div><div>〒 ${escape(recipient.zip_code || '')}</div><div>${escape(recipient.address || '')}</div><div class="recipient-name small company-name" style="${companyNameStyle(recipient.name, '印')}">${escape(recipient.name || '')}　印</div></div></div>
    <div class="claim-total"><span>御請求金額</span><strong>${yen(gross, '-')}</strong><span>（税込）</span></div>
    <table class="lines work-lines"><thead><tr><th class="no">NO.</th><th>摘　要</th><th>数　量</th><th>単　価</th><th>金　額</th></tr></thead><tbody>${paymentRowsHtml(workInvoiceRows, 4)}
      <tr class="sum"><td colspan="3" rowspan="3"></td><th>小計</th><td class="money">${yen(workSubtotal)}</td></tr><tr class="sum"><th>内消費税 ${Math.round(rate * 100)}％</th><td class="money">${yen(includedTax)}</td></tr><tr class="sum"><th>総合計</th><td class="money emphasis">${yen(gross)}</td></tr>
    </tbody></table>${bankBlock(document, 'recipient')}<div class="document-number">帳票番号：${escape(document.document_number || '')}</div>
  </section>`;
}

function salaryComponents(document, lines) {
  const grouped = detailedWorkRows(document, lines);
  const amount = (label) => grouped.filter((row) => row.itemName.endsWith(label)).reduce((sum, row) => sum + number(row.amount), 0);
  const minutes = (label) => grouped.filter((row) => row.itemName.endsWith(label)).reduce((sum, row) => sum + number(row.minutes), 0);
  const workSnapshots = lines.filter((line) => line.line_type === 'work').map(snapshotFor);
  const workDates = new Set(workSnapshots.map((row) => String(row.work_date || '')).filter(Boolean));
  const workMinutes = workSnapshots.reduce((sum, row) => sum + number(row.work_hours) * 60, 0);
  return {
    workDays:workDates.size,
    workMinutes,
    pay:[
      ['平日賃金', amount('基本料金'), workMinutes, grouped.find((row) => row.itemName.endsWith('基本料金'))?.unitPrice || 0],
      ['平日残業賃金', amount('時間超過'), minutes('時間超過'), grouped.find((row) => row.itemName.endsWith('時間超過'))?.unitPrice || 0],
      ['深夜割増', amount('深夜割増'), minutes('深夜割増'), grouped.find((row) => row.itemName.endsWith('深夜割増'))?.unitPrice || 0],
      ['深夜超過', amount('深夜超過'), minutes('深夜超過'), grouped.find((row) => row.itemName.endsWith('深夜超過'))?.unitPrice || 0],
      ['距離超過', amount('距離超過'), 0, grouped.find((row) => row.itemName.endsWith('距離超過'))?.unitPrice || 0],
    ].filter((row) => row[1] !== 0),
    deductions:adjustmentRows(lines).filter((row) => row.amount < 0),
  };
}

function renderSalary(document, lines) {
  const recipient = document.recipient || { name:document.partner_name };
  const model = salaryComponents(document, lines);
  const gross = number(document.gross_amount ?? model.pay.reduce((sum, row) => sum + row[1], 0));
  const deduction = Math.abs(model.deductions.reduce((sum, row) => sum + row.amount, 0));
  const total = number(document.total_amount ?? gross - deduction);
  const payColumns = [...model.pay.slice(0, 5)];
  while (payColumns.length < 5) payColumns.push(['', 0, 0, 0]);
  const deductionColumns = [...model.deductions.slice(0, 5)];
  while (deductionColumns.length < 5) deductionColumns.push({ itemName:'', amount:0 });
  return `<section class="sheet salary-sheet">
    <div class="salary-head"><div><h1>${formatMonth(document.target_year_month)}　給与明細</h1><div class="recipient-name company-name" style="${companyNameStyle(recipient.name, '殿')}">${escape(recipient.name || '')}　殿</div></div><div>${issuerBlock(document, true)}<div class="pay-date"><strong>給与支払日　</strong>${formatDate(document.payment_date)}</div></div></div>
    <table class="salary-table salary-horizontal"><tbody>
      <tr><th rowspan="3" class="salary-side">支給</th>${payColumns.map((row) => `<th>${escape(row[0]) || '　'}</th>`).join('')}</tr>
      <tr>${payColumns.map((row) => `<td class="money">${row[3] ? yen(row[3]) : '　'}</td>`).join('')}</tr>
      <tr>${payColumns.map((row) => `<td class="money">${row[1] ? yen(row[1]) : '　'}</td>`).join('')}</tr>
      <tr><th class="salary-side">勤怠</th>${payColumns.map((row) => `<td class="num">${row[2] ? quantity(row[2] / 60) + '時間' : '　'}</td>`).join('')}</tr>
    </tbody></table>
    <table class="salary-table salary-horizontal deductions"><tbody><tr><th rowspan="2" class="salary-side">控除</th>${deductionColumns.map((row) => `<th>${escape(row.itemName) || '　'}</th>`).join('')}</tr><tr>${deductionColumns.map((row) => `<td class="money">${row.amount ? yen(Math.abs(row.amount)) : '　'}</td>`).join('')}</tr></tbody></table>
    <table class="salary-summary"><tr><th>出勤日数</th><th>勤務時間</th><th>総支給額</th><th>総控除額</th><th>差引支給額</th></tr><tr><td>${model.workDays}日</td><td>${quantity(model.workMinutes / 60)}時間</td><td>${yen(gross)}</td><td>${yen(deduction)}</td><td class="emphasis">${yen(total)}</td></tr></table>
    <div class="document-number">帳票番号：${escape(document.document_number || '')}</div>
  </section>`;
}

function renderCoverLetter(document) {
  const recipient = document.recipient || {};
  const items = Array.isArray(document.enclosures) ? document.enclosures : [];
  return `<section class="sheet cover-sheet"><div class="top-grid">${recipientBlock(recipient, '様')}<div><h1>送付状</h1><div class="rule-title"></div>${issuerBlock(document, true)}<div class="issue-date">${formatDate(document.issued_date)}</div></div></div>
    <div class="cover-subject"><strong>件名</strong><span>${escape(document.subject || '')}</span></div><div class="cover-body">${escape(document.body || '').replaceAll('\n', '<br>')}</div><div class="right">敬　具</div><h2 class="center">記</h2>
    <div class="enclosures">${items.map((item, index) => `<div><span>${index + 1}</span><span>${escape(item.name || '')}</span><span>${quantity(item.copies || 1)}部</span></div>`).join('')}</div><div class="right cover-end">以　上</div>
  </section>`;
}

function commonCss() {
  return `@page{size:A4;margin:9mm 14mm}*{box-sizing:border-box}html,body{margin:0;padding:0;color:#172033;font-family:"BIZ UDPGothic",sans-serif;font-size:9.3pt;font-weight:400}body{background:#fff}.sheet{position:relative;width:100%;min-height:277mm;page-break-after:always}.sheet:last-child{page-break-after:auto}h1{margin:0;text-align:center;font-size:18pt;font-weight:700;letter-spacing:.05em;white-space:nowrap;color:#17233c}h2{text-align:center;font-size:16pt;font-weight:700;letter-spacing:.12em;margin:11mm 0 5mm;color:#17233c}.top-grid{display:grid;grid-template-columns:52% 48%;gap:7mm;align-items:start}.recipient-box{border:1px solid #344054;min-height:31mm;padding:5mm 6mm;font-size:10.5pt}.recipient-name{font-size:13pt;font-weight:700;margin-top:6mm;border-bottom:2px solid #17233c;display:inline-block;padding:0 3mm 1mm}.recipient-name.small{font-size:11pt;margin-top:2mm}.issuer{position:relative;margin:3mm auto 0;width:92%;font-size:8.7pt;line-height:1.5}.issuer.compact{margin-top:2mm}.issuer-name{font-weight:700;font-size:10pt}.logo{width:43mm;height:10mm;background:#0f6b78;color:#fff;display:flex;align-items:center;justify-content:center;font:700 10pt "BIZ UDPGothic",sans-serif;margin:0 auto 1mm}.logo img{max-width:100%;max-height:100%}.stamp-image{position:absolute;right:4mm;top:10mm;max-width:23mm;max-height:23mm}.rule-title{height:1.2mm;border-top:2px solid #17233c;border-bottom:1px solid #667085;margin:1mm auto 2mm;width:75%}.issue-date{text-align:center;background:#e8f3f5;padding:1mm;margin:0 auto;width:75%}.invoice-meta{display:grid;grid-template-columns:60% 40%;gap:6mm;align-items:end;margin-top:6mm}.amount-box{display:grid;grid-template-columns:2fr 1fr;border:1px solid #344054;width:55%;margin-top:4mm}.amount-box>div{display:flex;flex-direction:column;text-align:center;padding:2mm;border-right:1px solid #667085}.amount-box>div:last-child{border-right:0}.amount-box strong{font-size:13pt}.amount-box span{font-size:19pt;font-weight:700;margin-top:2mm}.amount-box>div:last-child span{font-size:11pt;font-weight:400}.invoice-bank{position:absolute;right:0;top:78mm;width:39%}.bank{font-size:8.5pt;line-height:1.5;margin-top:2mm}.note{margin-top:2mm}.lines{border-collapse:collapse;width:100%;margin-top:6mm;table-layout:fixed}.lines th,.lines td{border:1px solid #344054;padding:1.15mm 1.6mm;height:6.3mm}.lines thead th{background:#17233c;color:#fff;font-weight:700;letter-spacing:.06em}.lines .no{width:8mm}.lines th:nth-child(3),.lines th:nth-child(4){width:18mm}.lines th:nth-child(5){width:28mm}.lines .blank td{height:6.3mm}.money,.num{text-align:right;white-space:nowrap;font-variant-numeric:tabular-nums}.center{text-align:center}.negative{color:#b42318}.sum th{font-weight:700;background:#eef2f6}.document-number{position:absolute;bottom:2mm;right:0;font-size:7pt;color:#667085}.payment-top{grid-template-columns:48% 52%}.pay-date{background:#e8f3f5;border-bottom:2px solid #17233c;padding:1mm;text-align:center;margin:2mm auto 0;width:70%}.payment-total{display:flex;gap:10mm;align-items:baseline;border-bottom:2px solid #17233c;width:48%;margin-top:5mm;font-size:16pt}.payment-total strong{font-size:21pt}.compact-lines{margin-top:3mm;font-size:8.5pt}.compact-lines th,.compact-lines td{height:5.2mm;padding:.7mm 1mm}.split-rule{border-top:3px solid #17233c;margin-top:10mm}.work-invoice-head{display:grid;grid-template-columns:58% 42%;gap:4mm}.claim-total{display:flex;align-items:baseline;gap:5mm;border-bottom:2px solid #17233c;width:60%;font-size:13pt;margin:4mm 0}.claim-total strong{font-size:22pt}.work-lines{margin-top:3mm;font-size:8.2pt}.work-lines th,.work-lines td{height:4.8mm;padding:.55mm 1mm}.work-lines .sum th{font-size:7pt;letter-spacing:0;white-space:nowrap}.emphasis{background:#fff1c7;font-weight:700}.salary-head{display:grid;grid-template-columns:58% 42%;align-items:start;margin:11mm 12mm 5mm}.salary-head h1{text-align:left;font-size:16pt}.salary-table,.salary-summary{border-collapse:collapse;width:100%}.salary-table th,.salary-table td,.salary-summary th,.salary-summary td{border:1px solid #344054;padding:2mm}.salary-table th,.salary-summary th{background:#dfe8f2;font-weight:700}.salary-horizontal{margin:3mm 12mm;width:calc(100% - 24mm);table-layout:fixed;text-align:center}.salary-horizontal .salary-side{width:11mm}.salary-horizontal th:not(.salary-side){font-size:8pt}.salary-summary{margin:7mm 12mm;width:calc(100% - 24mm);text-align:center}.cover-subject{display:grid;grid-template-columns:18mm 1fr;border-bottom:2px solid #17233c;margin-top:48mm}.cover-subject strong{background:#17233c;color:#fff;text-align:center;padding:3mm}.cover-subject span{padding:3mm}.cover-body{font-size:11pt;line-height:2.1;margin-top:7mm}.right{text-align:right}.cover-end{margin-top:18mm}.enclosures{margin:8mm auto;width:80%}.enclosures>div{display:grid;grid-template-columns:12mm 1fr 20mm;border-bottom:1px solid #667085;padding:3mm}.cover-sheet h2{font-size:12pt;letter-spacing:.1em}@media print{.sheet{overflow:hidden}}`;
}

function layoutCorrectionsCss() {
  return `h1{font-size:17pt;letter-spacing:.04em}.pay-date{width:78%;white-space:nowrap}.work-invoice-head{line-height:1.45}.work-invoice-head>div:last-child{padding-left:3mm}.salary-head .pay-date{width:100%;font-size:8.5pt}.company-name{white-space:nowrap;max-width:100%;letter-spacing:-.02em}.logo.has-image{background:transparent}.logo.has-image img{width:100%;height:100%;object-fit:contain}.invoice-sheet .lines th:nth-child(3){width:25mm;text-align:center}.invoice-sheet .lines td:nth-child(3){width:25mm}.invoice-sheet .lines th:nth-child(4),.invoice-sheet .lines td:nth-child(4){width:12mm}.invoice-sheet .lines th:nth-child(5),.invoice-sheet .lines td:nth-child(5){width:25mm}.payment-sheet .lines th:nth-child(3),.payment-sheet .lines td:nth-child(3){width:12mm}.payment-sheet .lines th:nth-child(4){width:25mm;text-align:center}.payment-sheet .lines td:nth-child(4){width:25mm}.payment-sheet .lines th:nth-child(5),.payment-sheet .lines td:nth-child(5){width:25mm}.lines thead th:nth-child(3),.lines thead th:nth-child(4),.lines thead th:nth-child(5){white-space:nowrap;font-size:8.5pt;letter-spacing:.02em;padding-left:.4mm;padding-right:.4mm}.lines td:nth-child(3),.lines td:nth-child(4),.lines td:nth-child(5){font-size:8.3pt;letter-spacing:-.04em}.lines td.money,.lines td.num{padding-left:0;padding-right:.7mm}`;
}

function renderHtml(document, lines = []) {
  let body;
  if (document.document_type === 'invoice') body = renderInvoice(document, lines, false);
  else if (document.document_type === 'invoice_summary') body = renderInvoice(document, lines, true);
  else if (document.document_type === 'payment_statement') body = renderPayment(document, lines);
  else if (document.document_type === 'salary_statement') body = renderSalary(document, lines);
  else if (document.document_type === 'cover_letter') body = renderCoverLetter(document);
  else throw new Error(`未対応の帳票種別です: ${document.document_type}`);
  const previewCss = document.preview
    ? `@media screen{html,body{background:#5d6570;min-height:100%}body{margin:0;padding:16px;display:flex;justify-content:center}
      .preview-stage{width:210mm}
      .preview-paper{position:relative;width:210mm;min-height:297mm;padding:9mm 14mm;background:#fff;box-shadow:0 12px 40px rgba(0,0,0,.35);box-sizing:border-box}
      .preview-paper .sheet{width:100%;min-height:calc(297mm - 18mm)}
      .preview-paper:before{content:"見本・未発行";position:absolute;z-index:20;left:18%;top:42%;transform:rotate(-24deg);font-size:46pt;font-weight:700;color:rgba(180,35,24,.18);border:4px solid rgba(180,35,24,.18);padding:4mm 10mm;pointer-events:none}
      .preview-paper:after{content:"この画面は確認用です。正式な請求書・支払明細書ではありません。";position:absolute;left:14mm;right:14mm;top:4mm;text-align:center;color:#b42318;font-weight:700}}
      @media print{html,body{background:#fff}body{padding:0}.preview-stage,.preview-paper{width:auto;min-height:0;padding:0;box-shadow:none}}`
    : '';
  const wrapped = document.preview ? `<div class="preview-stage"><div class="preview-paper">${body}</div></div>` : body;
  return `<!doctype html><html lang="ja"><head><meta charset="utf-8"><title>A4見本</title><style>${commonCss()}${layoutCorrectionsCss()}${previewCss}</style></head><body>${wrapped}</body></html>`;
}

async function writePdf(document, lines) {
  await fs.mkdir(PDF_DIR, { recursive:true });
  const fileName = `${document.document_number}.pdf`;
  const absolutePath = path.join(PDF_DIR, fileName);
  let chromium;
  try { ({ chromium } = require('playwright')); } catch (_error) { throw new Error('PDF生成用Chromiumがインストールされていません'); }
  const browser = await chromium.launch({
    headless:true,
    executablePath:process.env.PDF_CHROMIUM_EXECUTABLE_PATH || undefined,
  });
  try {
    const page = await browser.newPage();
    await page.setContent(renderHtml(document, lines), { waitUntil:'networkidle' });
    const fontReady = await page.evaluate(async () => {
      await document.fonts.ready;
      return document.fonts.check('12px "BIZ UDPGothic"', '日本語 請求 支払 先払');
    });
    if (!fontReady) throw new Error('PDF生成用の日本語フォント BIZ UDPGothic を利用できません');
    await page.pdf({ path:absolutePath, format:'A4', printBackground:true, preferCSSPageSize:true });
  } finally { await browser.close(); }
  return { absolutePath, fileName };
}

module.exports = {
  PDF_DIR,
  detailedWorkRows,
  renderHtml,
  salaryComponents,
  summaryRows,
  writePdf,
};
