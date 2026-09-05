const crypto = require('crypto');
const fs = require('fs/promises');
const path = require('path');
const readXlsxFile = require('read-excel-file/node');
const { readSheetNames } = require('read-excel-file/node');

const IMPORT_FIELDS = [
  { key: 'project_id', label: '案件ID', aliases: ['案件id', '案件no', '案件番号', 'projectid', 'project_id'] },
  { key: 'project_name', label: '案件名', aliases: ['案件名', '業務名', 'projectname', 'project_name'] },
  { key: 'company_name', label: '企業名', aliases: ['企業名', '会社名', '荷主名', 'companyname', 'company_name'] },
  { key: 'partner_name', label: 'パートナー名', aliases: ['パートナー名', '協力会社名', '乗務員名', 'partnername', 'partner_name'] },
  { key: 'work_date', label: '勤務日', aliases: ['勤務日', '稼働日', '日付', '作業日', 'workdate', 'work_date'] },
  { key: 'start_time', label: '開始時刻', aliases: ['開始', '開始時刻', '始業', '出勤', 'starttime', 'start_time'] },
  { key: 'end_time', label: '終了時刻', aliases: ['終了', '終了時刻', '終業', '退勤', 'endtime', 'end_time'] },
  { key: 'break_minutes', label: '休憩時間', aliases: ['休憩', '休憩時間', '休憩分', 'break', 'breakminutes', 'break_minutes'] },
  { key: 'is_absent', label: '不要・欠勤', aliases: ['不要', '非稼働', '欠勤', 'isabsent', 'is_absent'] },
  { key: 'is_training', label: '研修', aliases: ['研修', '研修日', 'istraining', 'is_training'] },
  { key: 'total_distance', label: '走行距離', aliases: ['距離', '走行距離', '総距離', 'totaldistance', 'total_distance'] },
  { key: 'toll_fee', label: '通行料', aliases: ['通行料', '高速代', '高速料金', 'tollfee', 'toll_fee'] },
  { key: 'parking_fee', label: '駐車料', aliases: ['駐車料', '駐車場代', 'parkingfee', 'parking_fee'] },
  { key: 'transport_fee', label: '交通費', aliases: ['交通費', 'transportfee', 'transport_fee'] },
  { key: 'row_comment', label: '行コメント', aliases: ['備考', 'コメント', '作業内容', 'rowcomment', 'row_comment'] },
];

function normalizeKey(value) {
  return String(value ?? '').normalize('NFKC').trim().toLocaleLowerCase('ja').replace(/[\s_\-・\/／]+/g, '');
}

function jsonValue(value) {
  if (value instanceof Date) return value.toISOString();
  if (value == null) return null;
  if (typeof value === 'object') return JSON.parse(JSON.stringify(value));
  return value;
}

function parseCsv(text) {
  const rows = [];
  let row = [];
  let cell = '';
  let quoted = false;
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (quoted) {
      if (char === '"' && text[index + 1] === '"') {
        cell += '"';
        index += 1;
      } else if (char === '"') quoted = false;
      else cell += char;
      continue;
    }
    if (char === '"') quoted = true;
    else if (char === ',') {
      row.push(cell);
      cell = '';
    } else if (char === '\n') {
      row.push(cell.replace(/\r$/, ''));
      if (row.some((value) => String(value).trim() !== '')) rows.push(row);
      row = [];
      cell = '';
    } else cell += char;
  }
  if (quoted) {
    const error = new Error('CSVの引用符が閉じていません');
    error.status = 400;
    error.code = 'invalid_csv';
    throw error;
  }
  row.push(cell.replace(/\r$/, ''));
  if (row.some((value) => String(value).trim() !== '')) rows.push(row);
  return rows;
}

async function readCsv(filePath) {
  const buffer = await fs.readFile(filePath);
  let text;
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(buffer);
  } catch (_error) {
    text = new TextDecoder('shift_jis').decode(buffer);
  }
  return parseCsv(text.replace(/^\uFEFF/, ''));
}

async function readSourceFile(filePath, sheetName) {
  const extension = path.extname(filePath).toLowerCase();
  if (extension === '.csv') return { rows: await readCsv(filePath), sheetNames: ['CSV'], sheetName: 'CSV' };
  const sheetNames = await readSheetNames(filePath);
  const selected = sheetName && sheetNames.includes(sheetName) ? sheetName : sheetNames[0];
  const rows = await readXlsxFile(filePath, { sheet: selected });
  return { rows, sheetNames, sheetName: selected };
}

function inferMapping(headers) {
  const normalizedHeaders = headers.map(normalizeKey);
  const mapping = {};
  for (const field of IMPORT_FIELDS) {
    const aliases = field.aliases.map(normalizeKey);
    const index = normalizedHeaders.findIndex((header) => aliases.includes(header));
    if (index >= 0) mapping[field.key] = index;
  }
  return mapping;
}

function normalizeDate(value) {
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, '0')}-${String(value.getDate()).padStart(2, '0')}`;
  }
  const text = String(value ?? '').normalize('NFKC').trim();
  if (!text) return null;
  const match = text.match(/^(\d{4})[\/\.\-年](\d{1,2})[\/\.\-月](\d{1,2})日?$/);
  if (!match) return null;
  const date = `${match[1]}-${String(Number(match[2])).padStart(2, '0')}-${String(Number(match[3])).padStart(2, '0')}`;
  const parsed = new Date(`${date}T00:00:00`);
  return !Number.isNaN(parsed.getTime()) && parsed.getFullYear() === Number(match[1]) && parsed.getMonth() + 1 === Number(match[2]) && parsed.getDate() === Number(match[3]) ? date : null;
}

function minutesFromValue(value, duration = false) {
  if (value == null || value === '') return null;
  if (value instanceof Date) return value.getHours() * 60 + value.getMinutes();
  if (typeof value === 'number') {
    if (value >= 0 && value < 2) return Math.round(value * 24 * 60);
    if (duration) return Math.round(value * 60);
  }
  let text = String(value).normalize('NFKC').trim();
  if (!text) return null;
  text = text.replace('：', ':');
  if (/^\d{1,2}\.\d{2}$/.test(text)) text = text.replace('.', ':');
  if (/^\d{1,2}$/.test(text)) text += ':00';
  const match = text.match(/^(\d{1,2}):(\d{2})$/);
  if (!match || Number(match[2]) > 59) return null;
  return Number(match[1]) * 60 + Number(match[2]);
}

function clockText(value) {
  const minutes = minutesFromValue(value, false);
  if (minutes == null || minutes > 47 * 60 + 59) return null;
  return `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;
}

function integerValue(value) {
  if (value == null || value === '') return null;
  const number = Number(String(value).normalize('NFKC').replace(/[¥￥,，\s]/g, ''));
  return Number.isFinite(number) ? Math.round(number) : null;
}

function booleanValue(value) {
  if (typeof value === 'boolean') return value ? 1 : 0;
  const text = normalizeKey(value);
  return ['1', 'true', 'yes', '有', 'あり', '○', '〇', '欠勤', '不要', '非稼働', '研修'].includes(text) ? 1 : 0;
}

function rowObject(headers, sourceRow) {
  const raw = {};
  headers.forEach((header, index) => { raw[String(header || `列${index + 1}`)] = jsonValue(sourceRow[index]); });
  return raw;
}

function mapRow(sourceRow, mapping) {
  const value = (key) => {
    const index = Number(mapping[key]);
    return Number.isInteger(index) && index >= 0 ? sourceRow[index] : null;
  };
  const workDate = normalizeDate(value('work_date'));
  let startTime = clockText(value('start_time'));
  let endTime = clockText(value('end_time'));
  if (startTime && endTime) {
    const start = minutesFromValue(startTime);
    let end = minutesFromValue(endTime);
    if (end <= start && end < 24 * 60) {
      end += 24 * 60;
      endTime = `${String(Math.floor(end / 60)).padStart(2, '0')}:${String(end % 60).padStart(2, '0')}`;
    }
  }
  return {
    project_id: integerValue(value('project_id')),
    project_name: String(value('project_name') ?? '').trim() || null,
    company_name: String(value('company_name') ?? '').trim() || null,
    partner_name: String(value('partner_name') ?? '').trim() || null,
    work_date: workDate,
    start_time: startTime,
    end_time: endTime,
    break_minutes: minutesFromValue(value('break_minutes'), true) ?? 0,
    is_absent: booleanValue(value('is_absent')),
    is_training: booleanValue(value('is_training')),
    total_distance: integerValue(value('total_distance')),
    toll_fee: integerValue(value('toll_fee')),
    parking_fee: integerValue(value('parking_fee')),
    transport_fee: integerValue(value('transport_fee')),
    row_comment: String(value('row_comment') ?? '').trim() || null,
  };
}

function validateParsedRow(data) {
  const errors = [];
  const warnings = [];
  if (!data.work_date) errors.push('勤務日を確認してください');
  if (!data.project_id && !data.project_name) errors.push('案件IDまたは案件名が必要です');
  if (!data.is_absent && !data.is_training && (!data.start_time || !data.end_time)) errors.push('開始時刻と終了時刻が必要です');
  if (data.start_time && !data.end_time) errors.push('終了時刻が必要です');
  if (!data.start_time && data.end_time) errors.push('開始時刻が必要です');
  if (data.break_minutes < 0) errors.push('休憩時間は0分以上にしてください');
  if (data.start_time && data.end_time) {
    const duration = minutesFromValue(data.end_time) - minutesFromValue(data.start_time);
    if (duration <= 0) errors.push('終了時刻は開始時刻より後にしてください');
    if (data.break_minutes > duration) errors.push('休憩時間が拘束時間を超えています');
  }
  if (data.total_distance != null && data.total_distance < 0) errors.push('走行距離は0以上にしてください');
  for (const key of ['toll_fee', 'parking_fee', 'transport_fee']) {
    if (data[key] != null && data[key] < 0) errors.push('経費は0円以上にしてください');
  }
  if (!data.company_name && !data.project_id) warnings.push('企業名がないため案件情報から補完します');
  return { errors, warnings };
}

function fingerprint(data) {
  const stable = IMPORT_FIELDS.map((field) => [field.key, data[field.key] ?? null]);
  return crypto.createHash('sha256').update(JSON.stringify(stable)).digest('hex');
}

function buildImportRows(rows, options = {}) {
  const headerIndex = Math.max(0, Number(options.headerRow || 1) - 1);
  const headers = (rows[headerIndex] || []).map((value, index) => String(value ?? `列${index + 1}`).trim() || `列${index + 1}`);
  const mapping = options.mapping && Object.keys(options.mapping).length ? options.mapping : inferMapping(headers);
  const output = [];
  rows.slice(headerIndex + 1).forEach((sourceRow, offset) => {
    if (!sourceRow.some((value) => value != null && String(value).trim() !== '')) return;
    const parsed = mapRow(sourceRow, mapping);
    const validation = validateParsedRow(parsed);
    output.push({
      sourceRowNumber: headerIndex + offset + 2,
      rawData: rowObject(headers, sourceRow),
      parsedData: parsed,
      errors: validation.errors,
      warnings: validation.warnings,
      fingerprint: fingerprint(parsed),
    });
  });
  return { headers, mapping, rows: output };
}

module.exports = {
  IMPORT_FIELDS,
  buildImportRows,
  fingerprint,
  inferMapping,
  normalizeDate,
  normalizeKey,
  parseCsv,
  readSourceFile,
  validateParsedRow,
};
