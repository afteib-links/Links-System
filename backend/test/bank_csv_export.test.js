const assert = require('node:assert/strict');
const test = require('node:test');
const iconv = require('iconv-lite');
const {
  validateDefinition,
  buildRows,
  serializeCsv,
  checksum,
  fileName,
  transformValue,
} = require('../src/services/bank_csv_export');
const { normalizeColumns, validateAccount } = require('../src/routes/bank_export_masters');

const version = {
  encoding_code:'utf8_bom', delimiter_text:',', quote_mode:'all', quote_char:'"', include_header:1, line_ending:'crlf',
};
const columns = [
  { column_key:'date', column_label:'振込日', source_key:'transfer_date', is_required:1, format_code:'YYYYMMDD', transform_code:'none' },
  { column_key:'bank', column_label:'銀行コード', source_key:'beneficiary_bank_code', is_required:1, zero_pad_length:4, max_length:4, transform_code:'digits' },
  { column_key:'name', column_label:'名義', source_key:'beneficiary_account_name_kana', is_required:1, transform_code:'katakana' },
  { column_key:'amount', column_label:'金額', source_key:'amount', is_required:1, transform_code:'digits' },
];

test('銀行CSV列定義は許可済み参照項目だけを受け付ける', () => {
  assert.deepEqual(validateDefinition(version, columns), []);
  assert.match(validateDefinition(version, [{ ...columns[0], source_key:'sql_expression' }])[0], /参照項目/);
});

test('日付・数字・カナ変換と必須エラーを生成する', () => {
  assert.equal(transformValue('2026-09-06', columns[0]), '20260906');
  assert.equal(transformValue('１２', columns[1]), '0012');
  const built = buildRows([{ cash_schedule_id:7, amount:12500, bank_code:'0010', account_name_kana:'りんくす', bank_name:'りそな銀行', branch_code:'001', branch_name:'本店', deposit_type:'ordinary', account_number:'1234567' }], { bank_code:'0010' }, '2026-09-06', columns);
  assert.deepEqual(built.rows[0].values, ['20260906','0010','リンクス','12500']);
  assert.deepEqual(built.errors, []);
  const invalid = buildRows([{ cash_schedule_id:8, amount:100, bank_code:'ABC', branch_code:'1', account_number:'12A', deposit_type:'', account_name_kana:'' }], {}, '2026-09-06', columns);
  assert.ok(invalid.errors.length >= 5);
  assert.ok(invalid.errors.some((error) => /銀行コードは4桁/.test(error.message)));
});

test('UTF-8 BOM・CRLF・CSV引用符を設定どおり生成する', () => {
  const buffer = serializeCsv(version, columns, [{ values:['20260906','0010','リンクス','12,500'] }]);
  assert.deepEqual([...buffer.subarray(0, 3)], [0xef,0xbb,0xbf]);
  const text = buffer.subarray(3).toString('utf8');
  assert.match(text, /^"振込日","銀行コード","名義","金額"\r\n/);
  assert.match(text, /"12,500"$/);
});

test('CP932出力と保存済み行の再生成は同一チェックサムになる', () => {
  const cp932 = { ...version, encoding_code:'cp932', include_header:0, quote_mode:'minimal' };
  const rows = [{ values:['20260906','0010','リンクス','12500'] }];
  const first = serializeCsv(cp932, columns, rows);
  const second = serializeCsv(JSON.parse(JSON.stringify(cp932)), JSON.parse(JSON.stringify(columns)), JSON.parse(JSON.stringify(rows)));
  assert.equal(iconv.decode(first, 'cp932'), '20260906,0010,リンクス,12500');
  assert.equal(checksum(first), checksum(second));
});

test('ファイル名トークンを安全な名前へ展開する', () => {
  assert.equal(fileName('{bank}_{YYYYMMDD}_{cycle}_{batchId}.csv', { bank:'三井/住友銀行', transfer_date:'2026-09-06', cycle:'10', batch_id:42 }), '三井_住友銀行_20260906_10_42.csv');
});

test('列順を入力順で正規化し、振込元口座コードを検証する', () => {
  const normalized = normalizeColumns([{ column_key:'b',column_label:'B',source_key:'blank' },{ column_key:'a',column_label:'A',source_key:'fixed',fixed_value:'1' }]);
  assert.deepEqual(normalized.map((row) => row.sort_order), [10,20]);
  assert.doesNotThrow(() => validateAccount({ account_label:'本口座',bank_export_profile_id:1,bank_code:'0001',bank_name:'銀行',branch_code:'001',branch_name:'本店',deposit_type:'ordinary',account_number:'1234567',account_name_kana:'リンクス' }));
  assert.throws(() => validateAccount({ account_label:'本口座',bank_export_profile_id:1,bank_code:'1',bank_name:'銀行',branch_code:'001',branch_name:'本店',deposit_type:'ordinary',account_number:'1234567',account_name_kana:'リンクス' }), /4桁/);
});
