const assert = require('node:assert/strict');
const ExcelJS = require('exceljs');

const baseUrl = process.env.BASE_URL || 'http://127.0.0.1:8080';
let cookie = '';
async function request(path, options = {}) {
  const response = await fetch(`${baseUrl}${path}`, { ...options, headers: { ...(options.headers || {}), ...(cookie ? { cookie } : {}) } });
  const setCookie = response.headers.get('set-cookie'); if (setCookie) cookie = setCookie.split(';')[0];
  return response;
}
async function json(path, options) { const response = await request(path, options); const body = await response.json(); assert.equal(response.ok, true, `${response.status}: ${body.message}`); return body; }
function form(buffer, name) { const value = new FormData(); value.append('file', new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }), name); return value; }

(async () => {
  await json('/api/auth/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ login_id: process.env.ADMIN_LOGIN_ID || 'admin', password: process.env.ADMIN_PASSWORD || 'admin1234' }) });
  const source = new ExcelJS.Workbook();
  const suffix = String(Date.now()).slice(-8);
  const companies = source.addWorksheet('稼働企業DB変更');
  companies.addRow(['担当','形態','企業番号','企業名','カナ','郵便番号','請求書送付先住所','電話','FAX','車両番号','車検証有効期限','任意保険有効期限','締日','支払日','基本契約日','業務内容及び付帯業務','銀行名','支店名','口座番号','預金名','口座名義','契約担当者']);
  companies.addRow(['総務','配送',suffix,`E2E匿名企業${suffix}`,'イーツーイー','1000001','東京都','0300000000','',`品川100あ${suffix}`,'2027-01-01','2027-02-01','末日','翌月末','2025-01-01','配送','匿名銀行','本店','0012345','普通','トクメイ','担当者']);
  const workers = source.addWorksheet('稼働者一覧DB');
  workers.addRow(['担当','締日','形態','氏名','企業番号','稼働企業','支払区分','分割単価','郵便番号','住所','電話','生年月日','振込口座','振込支店','口座種類','口座番号','口座名義','支払日','委託単価','契約単価','インボイス番号','傷害','請負損害','貨物','Ｇ会','確定申告','過去安全大会','稼働開始日','基本契約日','免許有効期限','車両番号','車検有効期限','任意保険期限']);
  workers.addRow(['総務','末日','配送',`E2E 匿名者${suffix}`,suffix,`E2E匿名企業${suffix}`,'分割','5000','1000001','東京都',`090${suffix}`,'1980-01-01','匿名銀行','本店','普通',suffix,'トクメイ','翌月末','12000','18000','','有','有','有','有','年末調整','2025','2026-01-01','2025-01-01','2028-01-01',`品川200あ${suffix}`,'2027-01-01','2027-02-01']);
  const sourceBuffer = await source.xlsx.writeBuffer();
  const converted = await json('/api/master-data-preparations', { method: 'POST', body: form(sourceBuffer, 'source.xlsx') });
  assert.equal(converted.summary['企業'], 1); assert.equal(converted.summary['個別案件'], 1);
  const download = await request(`/api/master-data-preparations/${converted.download_token}.xlsx`); assert.equal(download.ok, true);
  const completed = Buffer.from(await download.arrayBuffer());
  const preview = await json('/api/master-data-imports/preview', { method: 'POST', body: form(completed, 'completed.xlsx') });
  console.log(JSON.stringify({ preview: preview.counts }));
  if (preview.counts.error || preview.counts.dependency_error || preview.counts.conflict) console.log(JSON.stringify(preview.rows.filter((row) => row.messages?.length)));
  assert.equal(preview.counts.error, 0); assert.equal(preview.counts.dependency_error, 0); assert.ok(preview.counts.new >= 9);
  const committed = await json(`/api/master-data-imports/${preview.preview_token}/commit`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
  assert.equal(committed.created, preview.counts.new);
  const second = await json('/api/master-data-imports/preview', { method: 'POST', body: form(completed, 'completed.xlsx') });
  assert.equal(second.counts.new, 0); assert.equal(second.counts.update, 0); assert.ok(second.counts.unchanged >= 9);
  console.log(JSON.stringify({ converted: converted.summary, first: preview.counts, committed, second: second.counts }));
})().catch((error) => { console.error(error.message); process.exitCode = 1; });
