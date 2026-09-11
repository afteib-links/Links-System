const test = require('node:test');
const assert = require('node:assert/strict');
const ExcelJS = require('exceljs');
const {
  AUTO, FIELD_DEFINITIONS, SHEET_ORDER, normalized, excelDate, money, parsePaymentTerms,
  partnerClassification, transformSourceWorkbook, workbookBuffer, parseCompletedWorkbook, allFields,
} = require('../src/services/master_data_workbook');
const { autoComplete, sameStoredValue, validateRows } = require('../src/services/master_data_import');

test('公開項目には内部ID・監査列を含めない', () => {
  const forbidden = /(^|_)(id|created_at|updated_at|is_deleted|version|extra_data)$/;
  for (const sheet of Object.keys(FIELD_DEFINITIONS)) {
    const codes = allFields(sheet).map((f) => f.code);
    assert.equal(new Set(codes).size, codes.length, `${sheet} の項目コードが重複`);
    assert.equal(codes.some((code) => forbidden.test(code)), false, `${sheet} に内部項目`);
  }
});

test('表記・日付・金額・支払条件を正規化する', () => {
  assert.equal(normalized(' ＡＢ－ 12　'), 'ab12');
  assert.equal(excelDate('２０２６年９月２日'), '2026-09-02');
  assert.equal(excelDate(1), '');
  assert.equal(money('￥12,340円'), 12340);
  assert.deepEqual(parsePaymentTerms('翌月末払い'), { offset: 1, day: 'end' });
});

test('DBのDECIMAL・日付表現はExcel値と同値に扱う', () => {
  assert.equal(sameStoredValue('billing_unit_price', '18000.00', 18000), true);
  assert.equal(sameStoredValue('installment_amount', '5000.00', 5000), true);
  assert.equal(sameStoredValue('operation_start_date', new Date('2026-01-01T00:00:00Z'), '2026-01-01'), true);
});

test('自動補完欄は利用者の入力値を信用せず再計算する', () => {
  const company = autoComplete('企業', { contract_status_code: 'ended' });
  assert.equal(company.contract_status_code, 'active');
  const partner = autoComplete('パートナー', { partner_category_code: 'company', employment_type_code: 'payroll', birth_date: '1980-01-01', tax_return_code: 'あり' });
  assert.equal(partner.partner_category_code, 'sole_proprietor');
  assert.equal(partner.employment_type_code, 'outsourcing');
  assert.deepEqual(partnerClassification({ '支払区分': '年末調整' }), ['individual', 'payroll']);
});

test('親エラーは子を依存先エラーにする', () => {
  const parsed = Object.fromEntries(Object.keys(FIELD_DEFINITIONS).map((s) => [s, []]));
  parsed['企業'] = [{ import_key: 'company:1', company_name: '', __row: 3 }];
  parsed['請求先'] = [{ import_key: 'billing:1:default', company_import_key: 'company:1', billing_no: AUTO, __row: 3 }];
  const result = validateRows(parsed);
  assert.equal(result.rows.find((r) => r.sheet === '企業').status, 'error');
  assert.equal(result.rows.find((r) => r.sheet === '請求先').status, 'dependency_error');
});

test('最小原本を13シートの編集用Excelへ変換し再読込できる', async () => {
  const source = new ExcelJS.Workbook();
  const companies = source.addWorksheet('稼働企業DB変更');
  companies.addRow(['担当','形態','企業番号','企業名','カナ','郵便番号','請求書送付先住所','電話','FAX','車両番号','車検証有効期限','任意保険有効期限','締日','支払日','基本契約日','業務内容及び付帯業務','銀行名','支店名','口座番号','預金名','口座名義','契約担当者']);
  companies.addRow(['担当A','配送','001','匿名企業','トクメイ','1000001','東京都','0312345678','','品川100あ1','2027-01-01','2027-02-01','末日','翌月末','2025-01-01','配送','匿名銀行','本店','0012345','普通','トクメイ','担当B']);
  const workers = source.addWorksheet('稼働者一覧DB');
  workers.addRow(['担当','締日','形態','氏名','企業番号','稼働企業','支払区分','分割単価','郵便番号','住所','電話','生年月日','振込口座','振込支店','口座種類','口座番号','口座名義','支払日','委託単価','契約単価','インボイス番号','傷害','請負損害','貨物','Ｇ会','確定申告','過去安全大会','稼働開始日','基本契約日','免許有効期限','車両番号','車検有効期限','任意保険期限']);
  workers.addRow(['担当A','末日','配送','匿名 太郎','001','匿名企業','分割','5000','1000001','東京都','09000000000','1980-01-01','匿名銀行','本店','普通','0012345','トクメイ','翌月末','12000','18000','','有','有','有','有','年末調整','2025','2026-01-01','2025-01-01','2028-01-01','品川100あ2','2027-01-01','2027-02-01']);
  const prepared = await transformSourceWorkbook(await source.xlsx.writeBuffer());
  assert.equal(prepared['企業'].length, 1); assert.equal(prepared['パートナー'].length, 1); assert.equal(prepared['個別案件'].length, 1);
  const built = await workbookBuffer(prepared);
  const roundTrip = new ExcelJS.Workbook(); await roundTrip.xlsx.load(built.buffer);
  assert.deepEqual(roundTrip.worksheets.map((s) => s.name), SHEET_ORDER);
  assert.equal(roundTrip.getWorksheet('企業').getCell('A3').value, 'company:001');
  assert.equal(roundTrip.getWorksheet('企業').getCell('F3').value, AUTO);
  const parsed = await parseCompletedWorkbook(built.buffer);
  assert.equal(parsed['企業'][0].company_name, '匿名企業');
});
