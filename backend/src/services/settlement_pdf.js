const fs = require('fs/promises');
const path = require('path');

const PDF_DIR = process.env.PDF_DIR || '/app/pdf';

function escape(value) {
  return String(value ?? '').replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');
}

function yen(value) {
  return `¥${Number(value || 0).toLocaleString('ja-JP', { maximumFractionDigits: 2 })}`;
}

function titleFor(type) {
  return { invoice: '請求書', invoice_summary: '請求取纏書', payment_statement: '支払明細書', salary_statement: '給与明細書' }[type] || '帳票';
}

function renderHtml(document, lines) {
  const recipient = document.company_name || document.partner_name || '';
  const recipientSuffix = document.settlement_type === 'invoice' ? '御中' : '様';
  const rows = lines.filter((line) => Number(line.amount) !== 0).map((line) => `<tr><td>${escape(line.item_name)}</td><td class="num">${escape(line.quantity)}</td><td class="num">${yen(line.unit_price)}</td><td class="num">${yen(line.amount)}</td></tr>`).join('');
  return `<!doctype html><html lang="ja"><meta charset="utf-8"><style>
    @page { size:A4; margin:15mm; } body{font-family:"Noto Sans JP",sans-serif;color:#111;font-size:10pt} h1{text-align:center;font-size:22pt;letter-spacing:.2em;margin:0 0 18px} .meta{display:flex;justify-content:space-between;margin-bottom:14px}.recipient{font-size:14pt;margin:16px 0}.total{text-align:right;font-size:16pt;font-weight:bold;margin:14px 0} table{width:100%;border-collapse:collapse}thead{display:table-header-group}tr{break-inside:avoid;page-break-inside:avoid}th,td{border:1px solid #555;padding:6px}th{background:#eee}.num{text-align:right}.footer{margin-top:24px;border-top:1px solid #777;padding-top:8px;font-size:8pt;color:#555}</style>
    <body><h1>${titleFor(document.document_type)}</h1><div class="meta"><div>番号: ${escape(document.document_number)}<br>発行日: ${escape(document.issued_date)}</div><div>対象月: ${escape(document.target_year_month || '')}</div></div><div class="recipient">${escape(recipient)} ${recipientSuffix}</div><div class="total">${document.settlement_type === 'invoice' ? 'ご請求額' : '振込予定額'}　${yen(document.total_amount)}</div><table><thead><tr><th>項目</th><th>数量</th><th>単価</th><th>金額</th></tr></thead><tbody>${rows}</tbody></table><div class="footer">本帳票は確定時点の明細・計算根拠を保存したPDFです。</div></body></html>`;
}

async function writePdf(document, lines) {
  await fs.mkdir(PDF_DIR, { recursive: true });
  const fileName = `${document.document_number}.pdf`;
  const absolutePath = path.join(PDF_DIR, fileName);
  let chromium;
  try {
    ({ chromium } = require('playwright'));
  } catch (_err) {
    throw new Error('PDF生成用Chromiumがインストールされていません');
  }
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    await page.setContent(renderHtml(document, lines), { waitUntil: 'networkidle' });
    await page.pdf({ path: absolutePath, format: 'A4', printBackground: true });
  } finally {
    await browser.close();
  }
  return { absolutePath, fileName };
}

module.exports = { PDF_DIR, writePdf };
