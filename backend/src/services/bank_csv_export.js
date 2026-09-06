const crypto = require('node:crypto');
const iconv = require('iconv-lite');

const SOURCE_FIELDS = Object.freeze([
  ['transfer_date', '振込指定日'],
  ['amount', '振込金額'],
  ['counterparty_name', '支払先表示名'],
  ['beneficiary_bank_code', '振込先銀行コード'],
  ['beneficiary_bank_name', '振込先銀行名'],
  ['beneficiary_branch_code', '振込先支店コード'],
  ['beneficiary_branch_name', '振込先支店名'],
  ['beneficiary_deposit_type', '振込先口座種別'],
  ['beneficiary_account_number', '振込先口座番号'],
  ['beneficiary_account_name_kana', '振込先口座名義カナ'],
  ['cash_schedule_id', '入出金予定ID'],
  ['title', '件名・摘要'],
  ['source_bank_code', '振込元銀行コード'],
  ['source_bank_name', '振込元銀行名'],
  ['source_branch_code', '振込元支店コード'],
  ['source_branch_name', '振込元支店名'],
  ['source_deposit_type', '振込元口座種別'],
  ['source_account_number', '振込元口座番号'],
  ['source_account_name_kana', '振込元口座名義カナ'],
  ['client_code', '委託者コード'],
  ['fixed', '固定値'],
  ['blank', '空欄'],
]);

const SOURCE_FIELD_KEYS = new Set(SOURCE_FIELDS.map(([key]) => key));
const ENCODINGS = new Set(['utf8', 'utf8_bom', 'cp932']);
const TRANSFORMS = new Set(['none', 'digits', 'half_width', 'katakana', 'upper']);

function fullWidthToHalfWidth(value) {
  return String(value ?? '')
    .replace(/[！-～]/g, (char) => String.fromCharCode(char.charCodeAt(0) - 0xfee0))
    .replace(/　/g, ' ');
}

function hiraganaToKatakana(value) {
  return String(value ?? '').replace(/[ぁ-ゖ]/g, (char) => String.fromCharCode(char.charCodeAt(0) + 0x60));
}

function formatDate(value, formatCode) {
  const raw = String(value ?? '').slice(0, 10);
  const match = raw.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return raw;
  if (formatCode === 'YYYYMMDD') return `${match[1]}${match[2]}${match[3]}`;
  if (formatCode === 'MMDD') return `${match[2]}${match[3]}`;
  if (formatCode === 'YYYY/MM/DD') return `${match[1]}/${match[2]}/${match[3]}`;
  return raw;
}

function transformValue(value, column) {
  let result = formatDate(value, column.format_code);
  const transform = column.transform_code || 'none';
  if (transform === 'digits') result = fullWidthToHalfWidth(result).replace(/\D/g, '');
  else if (transform === 'half_width') result = fullWidthToHalfWidth(result);
  else if (transform === 'katakana') result = hiraganaToKatakana(fullWidthToHalfWidth(result)).toUpperCase();
  else if (transform === 'upper') result = String(result).toUpperCase();
  const pad = Number(column.zero_pad_length || 0);
  if (pad > 0) result = String(result).padStart(pad, '0');
  const max = Number(column.max_length || 0);
  if (max > 0) result = Array.from(String(result)).slice(0, max).join('');
  return String(result);
}

function sourceValue(context, column) {
  if (column.source_key === 'fixed') return column.fixed_value ?? '';
  if (column.source_key === 'blank') return '';
  return context[column.source_key] ?? '';
}

function validateDefinition(version, columns) {
  const errors = [];
  if (!version) errors.push('出力プロファイル版がありません');
  if (!Array.isArray(columns) || !columns.length) errors.push('出力列を1件以上登録してください');
  if (version && !ENCODINGS.has(version.encoding_code)) errors.push('文字コードが不正です');
  if (version && !['all', 'minimal', 'none'].includes(version.quote_mode)) errors.push('引用符設定が不正です');
  if (version && !['crlf', 'lf'].includes(version.line_ending)) errors.push('改行設定が不正です');
  const seen = new Set();
  for (const column of columns || []) {
    if (!column.column_key || seen.has(column.column_key)) errors.push('列キーは重複せず必須です');
    seen.add(column.column_key);
    if (!column.column_label) errors.push(`${column.column_key || '列'}の列名は必須です`);
    if (!SOURCE_FIELD_KEYS.has(column.source_key)) errors.push(`${column.column_label || column.column_key}の参照項目が不正です`);
    if (!TRANSFORMS.has(column.transform_code || 'none')) errors.push(`${column.column_label || column.column_key}の文字変換が不正です`);
    if (column.source_key === 'fixed' && column.fixed_value == null) errors.push(`${column.column_label || column.column_key}の固定値を入力してください`);
    if (column.zero_pad_length && column.max_length && Number(column.zero_pad_length) > Number(column.max_length)) errors.push(`${column.column_label || column.column_key}の0埋め桁数は最大長以下にしてください`);
  }
  return [...new Set(errors)];
}

function buildRows(items, sourceAccount, transferDate, columns) {
  const rows = [];
  const errors = [];
  for (const item of items) {
    const context = {
      transfer_date: transferDate,
      amount: String(Math.round(Number(item.amount || 0))),
      counterparty_name: item.counterparty_name || '',
      beneficiary_bank_code: item.bank_code || '',
      beneficiary_bank_name: item.bank_name || '',
      beneficiary_branch_code: item.branch_code || '',
      beneficiary_branch_name: item.branch_name || '',
      beneficiary_deposit_type: item.deposit_type || '',
      beneficiary_account_number: item.account_number || '',
      beneficiary_account_name_kana: item.account_name_kana || '',
      cash_schedule_id: String(item.cash_schedule_id || ''),
      title: item.title || '',
      source_bank_code: sourceAccount.bank_code || '',
      source_bank_name: sourceAccount.bank_name || '',
      source_branch_code: sourceAccount.branch_code || '',
      source_branch_name: sourceAccount.branch_name || '',
      source_deposit_type: sourceAccount.deposit_type || '',
      source_account_number: sourceAccount.account_number || '',
      source_account_name_kana: sourceAccount.account_name_kana || '',
      client_code: sourceAccount.client_code || '',
    };
    const baseChecks = [
      [/^\d{4}$/, context.beneficiary_bank_code, '銀行コードは4桁で入力してください'],
      [/^\d{3}$/, context.beneficiary_branch_code, '支店コードは3桁で入力してください'],
      [/^\d{1,20}$/, context.beneficiary_account_number, '口座番号は数字で入力してください'],
      [/\S/, context.beneficiary_deposit_type, '口座種別が未入力です'],
      [/\S/, context.beneficiary_account_name_kana, '口座名義カナが未入力です'],
    ];
    for (const [pattern, value, message] of baseChecks) {
      if (!pattern.test(String(value ?? ''))) errors.push({ cash_schedule_id: Number(item.cash_schedule_id), column_key: 'beneficiary_account', message });
    }
    const rawValues = columns.map((column) => sourceValue(context, column));
    const values = columns.map((column, index) => transformValue(rawValues[index], column));
    columns.forEach((column, index) => {
      if (Number(column.is_required) && String(rawValues[index] ?? '').trim() === '') {
        errors.push({ cash_schedule_id: Number(item.cash_schedule_id), column_key: column.column_key, message: `${column.column_label}が未入力です` });
      }
    });
    rows.push({ cash_schedule_id: Number(item.cash_schedule_id), values });
  }
  const uniqueErrors = [];
  const seenErrors = new Set();
  for (const error of errors) {
    const key = `${error.cash_schedule_id}:${error.column_key}:${error.message}`;
    if (!seenErrors.has(key)) { seenErrors.add(key); uniqueErrors.push(error); }
  }
  return { rows, errors: uniqueErrors };
}

function quoteCell(value, version) {
  const text = String(value ?? '');
  if (version.quote_mode === 'none') return text;
  const quote = version.quote_char || '"';
  const delimiter = version.delimiter_text || ',';
  const mustQuote = version.quote_mode === 'all' || text.includes(delimiter) || text.includes(quote) || /[\r\n]/.test(text);
  return mustQuote ? `${quote}${text.split(quote).join(quote + quote)}${quote}` : text;
}

function serializeCsv(version, columns, rows) {
  const lineEnding = version.line_ending === 'lf' ? '\n' : '\r\n';
  const delimiter = version.delimiter_text || ',';
  const lines = [];
  if (Number(version.include_header)) lines.push(columns.map((column) => quoteCell(column.column_label, version)).join(delimiter));
  for (const row of rows) lines.push(row.values.map((value) => quoteCell(value, version)).join(delimiter));
  const text = lines.join(lineEnding);
  if (version.encoding_code === 'cp932') return iconv.encode(text, 'cp932');
  const prefix = version.encoding_code === 'utf8_bom' ? Buffer.from([0xef, 0xbb, 0xbf]) : Buffer.alloc(0);
  return Buffer.concat([prefix, Buffer.from(text, 'utf8')]);
}

function checksum(buffer) {
  return crypto.createHash('sha256').update(buffer).digest('hex');
}

function fileName(pattern, context) {
  const date = String(context.transfer_date || '').replaceAll('-', '');
  const replacements = {
    '{YYYYMMDD}': date,
    '{YYYYMM}': date.slice(0, 6),
    '{MMDD}': date.slice(4, 8),
    '{bank}': String(context.bank || 'bank').replace(/[\\/:*?"<>|\s]+/g, '_'),
    '{cycle}': context.cycle || '',
    '{batchId}': String(context.batch_id || ''),
  };
  let result = String(pattern || '{bank}_{YYYYMMDD}_{cycle}.csv');
  for (const [token, value] of Object.entries(replacements)) result = result.split(token).join(value);
  if (!result.toLowerCase().endsWith('.csv')) result += '.csv';
  return result.replace(/[\\/:*?"<>|]/g, '_');
}

module.exports = {
  SOURCE_FIELDS,
  SOURCE_FIELD_KEYS,
  validateDefinition,
  buildRows,
  serializeCsv,
  checksum,
  fileName,
  transformValue,
};
