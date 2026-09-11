const ExcelJS = require('exceljs');
const crypto = require('node:crypto');

const AUTO = '★自動補完';
const META_FIELDS = [
  ['取込キー', 'import_key', 'required'],
  ['入力状態', 'input_status', 'optional'],
  ['要確認理由', 'review_reason', 'optional'],
  ['元シート', 'source_sheet', 'optional'],
  ['元行番号', 'source_row', 'optional'],
];

const F = (label, code, kind = 'optional', options = {}) => ({ label, code, kind, ...options });
const FIELD_DEFINITIONS = {
  '企業': [
    F('企業No★', 'office_no', 'auto'), F('事業所名', 'office_name'), F('企業名', 'company_name', 'required'),
    F('企業名カナ', 'company_name_kana'), F('郵便番号', 'zip_code'), F('住所', 'address'), F('電話', 'contact'), F('FAX', 'fax'),
    F('契約担当者', 'contract_manager'), F('当社担当者', 'our_manager'), F('当社契約担当者', 'our_contract_manager'),
    F('締日', 'closing_date_code', 'optional', { choice: 'closing_date' }), F('支払日', 'payment_date_code', 'optional', { choice: 'payment_date' }),
    F('基本契約日', 'contract_date'), F('契約状態★', 'contract_status_code', 'auto', { choice: 'contract_status' }), F('稼働終了日', 'operation_end_date'),
    F('業務内容及び付帯業務', 'business_content'), F('銀行コード', 'bank_code'), F('銀行名', 'bank_name'), F('支店コード', 'branch_code'),
    F('支店名', 'branch_name'), F('口座番号', 'account_number'), F('預金種別', 'deposit_type', 'optional', { choice: 'deposit_type' }),
    F('口座名義', 'account_name'), F('口座名義カナ', 'account_name_kana'), F('請求書送付方法', 'invoice_send_method'),
    F('請求書送付先', 'invoice_send_address'), F('稼働形態', 'work_mode_code'),
  ],
  '請求先': [
    F('請求先No★', 'billing_no', 'auto'), F('企業取込キー', 'company_import_key', 'required'), F('既定請求先★', 'is_default', 'auto'),
    F('請求書宛名', 'billing_print_name'), F('郵便番号', 'billing_zip_code'), F('請求先住所', 'billing_address'), F('電話', 'billing_phone'),
    F('FAX', 'billing_fax'), F('メール', 'billing_email'), F('送付方法', 'invoice_send_method'), F('請求先担当者', 'billing_manager'),
    F('取りまとめ請求番号', 'billing_summary_no'),
  ],
  '企業車両': [
    F('企業取込キー', 'company_import_key', 'required'), F('車両名', 'vehicle_name'), F('車両番号', 'vehicle_number', 'required'),
    F('車検証有効期限', 'inspection_expiry_date'), F('任意保険有効期限', 'insurance_expiry_date'),
  ],
  'パートナー': [
    F('氏名・名称', 'partner_name', 'required'), F('カナ', 'partner_name_kana'), F('振込手数料パターン', 'transfer_fee_pattern_code'),
    F('郵便番号', 'zip_code'), F('住所', 'address'), F('電話', 'contact_phone'), F('血液型', 'blood_type'), F('生年月日', 'birth_date'),
    F('稼働開始日', 'work_start_date'), F('契約状態★', 'contract_status_code', 'auto', { choice: 'contract_status' }), F('稼働終了日', 'operation_end_date'),
    F('基本契約日', 'contract_date'), F('パートナー区分★', 'partner_category_code', 'auto', { choice: 'partner_category' }),
    F('契約区分★', 'employment_type_code', 'auto', { choice: 'employment_type' }), F('インボイス番号', 'invoice_number'),
    F('前払利用候補★', 'advance_payment_enabled', 'auto', { choice: 'boolean' }), F('免許有効期限', 'license_expiry_date'), F('免許種類', 'license_types'),
    F('過去安全大会', 'safety_conference_history'), F('傷害保険', 'accident_insurance_code'), F('請負損害', 'contractor_liability_code'),
    F('貨物保険', 'cargo_insurance_code'), F('G会', 'g_association_code'), F('確定申告', 'tax_return_code'), F('ループ', 'loop_code'),
    F('支払出力', 'payment_output_code'), F('銀行コード', 'bank_code'), F('銀行名', 'bank_name'), F('支店コード', 'branch_code'),
    F('支店名', 'branch_name'), F('口座番号', 'account_number'), F('預金種別', 'deposit_type', 'optional', { choice: 'deposit_type' }),
    F('口座名義', 'account_name'), F('口座名義カナ', 'account_name_kana'), F('支払条件（原文）', 'payment_terms_text'),
    F('年末調整情報（保存対象外）', 'tax_adjustment_source'),
    F('支払月オフセット★（保存対象外）', 'payment_month_offset', 'auto'), F('支払日コード★（保存対象外）', 'parsed_payment_date_code', 'auto'),
  ],
  'パートナー車両': [
    F('パートナー取込キー', 'partner_import_key', 'required'), F('車両名', 'vehicle_name'), F('車両番号', 'vehicle_number', 'required'),
    F('車検有効期限', 'inspection_expiry_date'), F('任意保険期限', 'insurance_expiry_date'),
  ],
  '基本案件': [
    F('基本案件No★', 'base_project_no', 'auto'), F('企業取込キー', 'company_import_key', 'required'), F('請求先取込キー★', 'billing_import_key', 'auto'),
    F('パートナー取込キー', 'partner_import_key'), F('車両取込キー', 'vehicle_import_key'), F('テンプレート名', 'template_name', 'required'),
    F('既定担当者', 'default_manager'), F('業種・形態', 'business_type'), F('基本勤務時間', 'basic_work_hours'), F('勤務時間種別', 'work_time_type', 'optional', { choice: 'work_time_type' }),
    F('支払区分', 'payment_type', 'optional', { choice: 'payment_type' }), F('分割種別', 'installment_type'), F('分割金額', 'installment_amount'),
    F('稼働開始日', 'operation_start_date'), F('契約状態★', 'contract_status_code', 'auto', { choice: 'contract_status' }), F('稼働終了日', 'operation_end_date'),
    F('締日', 'closing_date', 'optional', { choice: 'closing_date' }), F('遂行開始', 'execution_time_start'), F('遂行終了', 'execution_time_end'),
    F('拘束時間', 'binding_time'), F('休憩時間', 'break_time'), F('残業計算', 'overtime_calc_type'), F('日報カウント', 'daily_count_type'),
    F('稼働形態', 'work_mode_code'), F('丸め時点', 'rounding_timing_type'), F('残業累積', 'overtime_accumulation_type'),
    F('距離計算方式', 'distance_calc_mode'), F('距離計算金額', 'distance_calc_amount'), F('GoGo計算方式', 'gogo_site_calc_type'), F('GoGo地域', 'gogo_site_area'),
  ],
  '個別案件': [
    F('個別案件No★', 'project_no', 'auto'), F('基本案件取込キー', 'base_project_import_key', 'required'), F('企業取込キー', 'company_import_key', 'required'),
    F('請求先取込キー★', 'billing_import_key', 'auto'), F('パートナー取込キー', 'partner_import_key', 'required'), F('車両取込キー', 'vehicle_import_key'),
    F('車両所有元★', 'vehicle_owner_type', 'auto', { choice: 'vehicle_owner_type' }), F('担当者', 'manager_name'), F('業種・形態', 'business_type'),
    F('基本勤務時間', 'basic_work_hours'), F('支払区分', 'payment_type', 'optional', { choice: 'payment_type' }), F('分割種別', 'installment_type'),
    F('分割金額', 'installment_amount'), F('振込手数料パターン', 'transfer_fee_pattern_code'), F('稼働開始日', 'operation_start_date'),
    F('締日', 'closing_date', 'optional', { choice: 'closing_date' }), F('遂行開始', 'execution_time_start'), F('遂行終了', 'execution_time_end'),
    F('拘束時間', 'binding_time'), F('休憩時間', 'break_time'), F('残業計算', 'overtime_calc_type'), F('日報カウント', 'daily_count_type'),
    F('稼働形態', 'work_mode_code'), F('丸め時点', 'rounding_timing_type'), F('残業累積', 'overtime_accumulation_type'),
    F('距離計算方式', 'distance_calc_mode'), F('距離計算金額', 'distance_calc_amount'), F('距離テーブル(JSON)', 'distance_table_json'), F('GoGo計算方式', 'gogo_site_calc_type'), F('GoGo地域', 'gogo_site_area'),
  ],
  '料金セット': [
    F('料金セットNo★', 'price_set_no', 'auto'), F('料金系列コード★', 'price_series_code', 'auto'), F('改定番号★', 'revision_no', 'auto'),
    F('企業取込キー', 'company_import_key', 'required'), F('基本案件取込キー', 'base_project_import_key'), F('個別案件取込キー', 'project_import_key'),
    F('料金セット名称★', 'price_set_name', 'auto'), F('適用開始日★', 'apply_start_date', 'auto'), F('適用終了日', 'apply_end_date'), F('備考', 'note'),
  ],
  '料金行': [
    F('料金セット取込キー', 'price_set_import_key', 'required'), F('曜日', 'weekday_code', 'required', { choice: 'weekday' }),
    F('計算種別', 'calc_type_code', 'required', { choice: 'calc_type' }), F('料金種別', 'price_type_code', 'required', { choice: 'price_type' }),
    F('請求単価', 'billing_unit_price', 'required'), F('支払単価', 'payment_unit_price', 'required'), F('表示順', 'sort_order'),
  ],
};

const SHEET_ORDER = ['概要', '企業', '請求先', '企業車両', 'パートナー', 'パートナー車両', '基本案件', '個別案件', '料金セット', '料金行', '要確認', '選択肢', '変換ルール'];
const CHOICES = {
  closing_date: [['5', '5日'], ['10', '10日'], ['15', '15日'], ['20', '20日'], ['25', '25日'], ['end', '末日']],
  payment_date: [['5', '5日'], ['10', '10日'], ['15', '15日'], ['20', '20日'], ['25', '25日'], ['end', '末日']],
  contract_status: [['active', '稼働中'], ['paused', '一時休止中'], ['ending', '終了予定'], ['ended', '終了']],
  partner_category: [['individual', '個人'], ['company', '企業'], ['sole_proprietor', '個人事業主']],
  employment_type: [['outsourcing', '外注'], ['payroll', '給与']],
  deposit_type: [['ordinary', '普通'], ['current', '当座'], ['savings', '貯蓄']],
  work_time_type: [['binding', '拘束時間'], ['actual', '実働時間']],
  payment_type: [['normal', '通常'], ['installment', '分割']],
  vehicle_owner_type: [['company', '企業'], ['partner', 'パートナー']],
  weekday: [['all', '全日']], calc_type: [['daily', '日額']], price_type: [['base', '基本']], boolean: [['1', 'はい'], ['0', 'いいえ']],
};

function text(value) {
  if (value == null) return '';
  return String(value).replace(/\u3000/g, ' ').trim();
}
function meaningful(value) { const v = normalized(value); return Boolean(v) && !['-', 'ー', 'なし', '無し', '無', '未定', '不明'].includes(text(value)) && !['なし', '無し', '無', '未定', '不明'].includes(v); }
function normalized(value) { return text(value).normalize('NFKC').replace(/[\s\-‐‑‒–—―ー]/g, '').toLowerCase(); }
function digits(value) { return text(value).normalize('NFKC').replace(/\D/g, ''); }
function sourceKey(prefix, value) { return `${prefix}:${normalized(value) || crypto.randomUUID().slice(0, 12)}`; }
function excelDate(value) {
  if (!value) return '';
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    const year = value.getUTCFullYear();
    return year >= 1920 && year <= 2100 ? value.toISOString().slice(0, 10) : '';
  }
  if (typeof value === 'number') {
    if (value < 20000 || value > 80000) return '';
    return new Date(Date.UTC(1899, 11, 30) + value * 86400000).toISOString().slice(0, 10);
  }
  const s = text(value).normalize('NFKC').replace(/[年月\.]/g, '-').replace(/日/g, '').replace(/\//g, '-');
  const m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (!m) return '';
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  return Number(m[1]) >= 1920 && Number(m[1]) <= 2100 && d.getUTCFullYear() === Number(m[1]) && d.getUTCMonth() === Number(m[2]) - 1 && d.getUTCDate() === Number(m[3])
    ? `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}` : '';
}
function money(value) {
  if (value == null || value === '' || text(value) === '-') return '';
  const n = Number(text(value).normalize('NFKC').replace(/[,￥¥円\s]/g, ''));
  return Number.isFinite(n) ? n : '';
}
function rowObject(sheet, rowNumber, headers) {
  const row = sheet.getRow(rowNumber);
  const out = {};
  headers.forEach((header, i) => { out[header] = row.getCell(i + 1).value?.text ?? row.getCell(i + 1).value ?? ''; });
  out.__row = rowNumber;
  return out;
}
function sourceRows(sheet) {
  const headers = [];
  sheet.getRow(1).eachCell({ includeEmpty: true }, (cell, col) => { headers[col - 1] = text(cell.value); });
  const rows = [];
  for (let i = 2; i <= sheet.rowCount; i += 1) {
    const row = rowObject(sheet, i, headers);
    if (Object.entries(row).some(([k, v]) => k !== '__row' && text(v))) rows.push(row);
  }
  return rows;
}
function common(importKey, sourceSheet, sourceRow, reason = '') {
  return { import_key: importKey, input_status: reason ? '要確認' : '入力中', review_reason: reason, source_sheet: sourceSheet, source_row: sourceRow };
}
function pickMajority(rows, field) {
  const counts = new Map();
  rows.forEach((r) => { const v = text(r[field]); if (meaningful(v)) counts.set(v, (counts.get(v) || 0) + 1); });
  return [...counts].sort((a, b) => b[1] - a[1] || rows.findIndex((r) => text(r[field]) === a[0]) - rows.findIndex((r) => text(r[field]) === b[0]))[0]?.[0] || '';
}
function parsePaymentTerms(value) {
  const s = text(value).normalize('NFKC');
  const offset = /翌々月/.test(s) ? 2 : /翌月/.test(s) ? 1 : /当月/.test(s) ? 0 : '';
  const day = /末/.test(s) ? 'end' : (s.match(/(5|10|15|20|25)日?/) || [])[1] || '';
  return { offset, day };
}
function partnerClassification(row) {
  const yearEnd = /年末調整|給与/.test(`${text(row['支払区分'])} ${text(row['確定申告'])}`);
  const taxReturn = /確定申告|有|あり|○/.test(text(row['確定申告']));
  const hasPersonal = Boolean(text(row['生年月日']) || text(row['住所']) || text(row['電話']));
  if (yearEnd) return ['individual', 'payroll'];
  if (taxReturn) return ['sole_proprietor', 'outsourcing'];
  return hasPersonal ? ['individual', 'outsourcing'] : ['company', 'outsourcing'];
}

async function transformSourceWorkbook(input) {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(input);
  const companySheet = workbook.getWorksheet('稼働企業DB変更');
  const workerSheet = workbook.getWorksheet('稼働者一覧DB');
  if (!companySheet || !workerSheet) throw new Error('必要なシート（稼働企業DB変更、稼働者一覧DB）が見つかりません');
  const companyRows = sourceRows(companySheet);
  const workerRows = sourceRows(workerSheet);
  const result = Object.fromEntries(Object.keys(FIELD_DEFINITIONS).map((name) => [name, []]));
  result['要確認'] = [];

  const companyGroups = new Map();
  for (const row of companyRows) {
    const no = digits(row['企業番号']);
    if (!no) { result['要確認'].push(['企業', '', '企業番号が空欄', '稼働企業DB変更', row.__row]); continue; }
    if (!companyGroups.has(no)) companyGroups.set(no, []);
    companyGroups.get(no).push(row);
  }
  const companyByNo = new Map();
  const companyByName = new Map();
  for (const [no, rows] of companyGroups) {
    const key = `company:${no}`;
    const first = rows[0];
    const company = { ...common(key, '稼働企業DB変更', first.__row), office_no: AUTO, office_name: '', company_name: pickMajority(rows, '企業名'), company_name_kana: pickMajority(rows, 'カナ'),
      zip_code: pickMajority(rows, '郵便番号'), address: pickMajority(rows, '請求書送付先住所'), contact: pickMajority(rows, '電話'), fax: pickMajority(rows, 'FAX'),
      contract_manager: pickMajority(rows, '契約担当者'), our_manager: pickMajority(rows, '担当'), our_contract_manager: '', closing_date_code: pickMajority(rows, '締日'), payment_date_code: pickMajority(rows, '支払日'),
      contract_date: rows.map((r) => excelDate(r['基本契約日'])).filter(Boolean).sort()[0] || '', contract_status_code: AUTO, operation_end_date: '', business_content: pickMajority(rows, '業務内容及び付帯業務'),
      bank_code: '', bank_name: pickMajority(rows, '銀行名'), branch_code: '', branch_name: pickMajority(rows, '支店名'), account_number: pickMajority(rows, '口座番号'), deposit_type: pickMajority(rows, '預金名'),
      account_name: pickMajority(rows, '口座名義'), account_name_kana: '', invoice_send_method: '', invoice_send_address: pickMajority(rows, '請求書送付先住所'), work_mode_code: pickMajority(rows, '形態') };
    result['企業'].push(company); companyByNo.set(no, key); companyByName.set(normalized(company.company_name), key);
    const billingKey = `billing:${no}:default`;
    result['請求先'].push({ ...common(billingKey, '稼働企業DB変更', first.__row), billing_no: AUTO, company_import_key: key, is_default: AUTO, billing_print_name: company.company_name,
      billing_zip_code: company.zip_code, billing_address: company.address, billing_phone: company.contact, billing_fax: company.fax, billing_email: '', invoice_send_method: company.invoice_send_method,
      billing_manager: company.contract_manager, billing_summary_no: '' });
    const seenVehicles = new Set();
    for (const row of rows) {
      const number = text(row['車両番号']); if (!meaningful(number) || seenVehicles.has(normalized(number))) continue; seenVehicles.add(normalized(number));
      result['企業車両'].push({ ...common(`company_vehicle:${no}:${normalized(number)}`, '稼働企業DB変更', row.__row), company_import_key: key, vehicle_name: '', vehicle_number: number,
        inspection_expiry_date: excelDate(row['車検証有効期限']), insurance_expiry_date: excelDate(row['任意保険有効期限']) });
    }
  }

  for (const row of workerRows) {
    if (digits(row['企業番号']) || !text(row['稼働企業'])) continue;
    const nameNorm = normalized(row['稼働企業']);
    if (companyByName.has(nameNorm)) continue;
    const key = `company:name:${nameNorm}`;
    result['企業'].push({ ...common(key, '稼働者一覧DB', row.__row, '企業番号がないため名称由来の仮キー'), office_no: AUTO, company_name: text(row['稼働企業']), contract_status_code: AUTO });
    result['請求先'].push({ ...common(`billing:name:${nameNorm}:default`, '稼働者一覧DB', row.__row, '企業番号がないため要確認'), billing_no: AUTO, company_import_key: key, is_default: AUTO, billing_print_name: text(row['稼働企業']) });
    companyByName.set(nameNorm, key);
  }

  const partnerGroups = new Map();
  for (const row of workerRows) {
    const name = text(row['氏名']); if (!name) continue;
    const base = normalized(name); const strong = [digits(row['電話']), excelDate(row['生年月日']), digits(row['口座番号'])].filter(Boolean).join('|');
    let groupKey = base;
    const existing = [...partnerGroups.keys()].filter((k) => k === base || k.startsWith(`${base}#`));
    if (existing.length) {
      const compatible = existing.find((k) => !strong || !partnerGroups.get(k).strong || partnerGroups.get(k).strong === strong);
      groupKey = compatible || `${base}#${crypto.createHash('sha1').update(strong || String(row.__row)).digest('hex').slice(0, 8)}`;
    }
    if (!partnerGroups.has(groupKey)) partnerGroups.set(groupKey, { rows: [], strong });
    partnerGroups.get(groupKey).rows.push(row);
  }
  const partnerByRow = new Map();
  for (const [groupKey, group] of partnerGroups) {
    const rows = group.rows; const first = rows[0]; const key = `partner:${groupKey}`;
    const [category, employment] = partnerClassification(first); const terms = parsePaymentTerms(first['支払日']);
    const reason = groupKey.includes('#') ? '同名で電話・生年月日・口座番号が衝突したため別候補' : '';
    result['パートナー'].push({ ...common(key, '稼働者一覧DB', first.__row, reason), partner_name: pickMajority(rows, '氏名'), partner_name_kana: '', transfer_fee_pattern_code: '',
      zip_code: pickMajority(rows, '郵便番号'), address: pickMajority(rows, '住所'), contact_phone: pickMajority(rows, '電話'), blood_type: pickMajority(rows, '血液'), birth_date: excelDate(pickMajority(rows, '生年月日')),
      work_start_date: excelDate(pickMajority(rows, '稼働開始日')), contract_status_code: AUTO, operation_end_date: '', contract_date: excelDate(pickMajority(rows, '基本契約日')),
      partner_category_code: AUTO, employment_type_code: AUTO, __auto_partner_category_code: category, __auto_employment_type_code: employment, invoice_number: pickMajority(rows, 'インボイス番号'),
      advance_payment_enabled: AUTO, license_expiry_date: excelDate(pickMajority(rows, '免許有効期限')), license_types: '', safety_conference_history: pickMajority(rows, '過去安全大会'),
      accident_insurance_code: pickMajority(rows, '傷害'), contractor_liability_code: pickMajority(rows, '請負損害'), cargo_insurance_code: pickMajority(rows, '貨物'), g_association_code: pickMajority(rows, 'Ｇ会'),
      tax_return_code: pickMajority(rows, '確定申告'), loop_code: '', payment_output_code: '', bank_code: '', bank_name: pickMajority(rows, '振込口座'), branch_code: '', branch_name: pickMajority(rows, '振込支店'),
      account_number: pickMajority(rows, '口座番号'), deposit_type: pickMajority(rows, '口座種類'), account_name: pickMajority(rows, '口座名義'), account_name_kana: '', payment_terms_text: pickMajority(rows, '支払日'), tax_adjustment_source: pickMajority(rows, '支払区分'),
      payment_month_offset: AUTO, parsed_payment_date_code: AUTO, __auto_payment_month_offset: terms.offset, __auto_parsed_payment_date_code: terms.day });
    rows.forEach((r) => partnerByRow.set(r.__row, key));
    const vehicles = new Set();
    for (const row of rows) {
      const number = text(row['車両番号']); if (!meaningful(number) || vehicles.has(normalized(number))) continue; vehicles.add(normalized(number));
      result['パートナー車両'].push({ ...common(`partner_vehicle:${groupKey}:${normalized(number)}`, '稼働者一覧DB', row.__row), partner_import_key: key, vehicle_name: '', vehicle_number: number,
        inspection_expiry_date: excelDate(row['車検有効期限']), insurance_expiry_date: excelDate(row['任意保険期限']) });
    }
  }

  const baseGroups = new Map();
  for (const row of workerRows) {
    const companyKey = companyByNo.get(digits(row['企業番号'])) || companyByName.get(normalized(row['稼働企業']));
    if (!companyKey) continue;
    const form = text(row['形態']) || '未設定'; const key = `base_project:${companyKey}:${normalized(form)}`;
    if (!baseGroups.has(key)) baseGroups.set(key, []); baseGroups.get(key).push(row);
  }
  for (const [key, rows] of baseGroups) {
    const first = rows[0]; const companyKey = companyByNo.get(digits(first['企業番号'])) || companyByName.get(normalized(first['稼働企業']));
    result['基本案件'].push({ ...common(key, '稼働者一覧DB', first.__row), base_project_no: AUTO, company_import_key: companyKey, billing_import_key: AUTO, partner_import_key: '', vehicle_import_key: '',
      template_name: `${text(first['稼働企業']) || companyKey} ${text(first['形態']) || '基本'}`, default_manager: text(first['担当']), business_type: text(first['形態']), payment_type: '通常',
      operation_start_date: excelDate(first['稼働開始日']), contract_status_code: AUTO, closing_date: text(first['締日']) });
    const pairCounts = new Map(); rows.forEach((r) => { const pair = `${money(r['契約単価'])}|${money(r['委託単価'])}`; if (pair !== '|') pairCounts.set(pair, (pairCounts.get(pair) || 0) + 1); });
    const pair = [...pairCounts].sort((a, b) => b[1] - a[1])[0]?.[0];
    if (pair) addPrice(result, `price_set:${key}`, companyKey, key, '', first, pair.split('|'));
  }
  for (const row of workerRows) {
    const companyKey = companyByNo.get(digits(row['企業番号'])) || companyByName.get(normalized(row['稼働企業']));
    if (!companyKey || !partnerByRow.get(row.__row)) continue;
    const form = text(row['形態']) || '未設定'; const baseKey = `base_project:${companyKey}:${normalized(form)}`; const projectKey = `project:${companyKey}:${partnerByRow.get(row.__row)}:${row.__row}`;
    const partnerKey = partnerByRow.get(row.__row); const vehicleNo = text(row['車両番号']);
    const vehicleImportKey = meaningful(vehicleNo) ? `partner_vehicle:${partnerKey.slice(8)}:${normalized(vehicleNo)}` : '';
    result['個別案件'].push({ ...common(projectKey, '稼働者一覧DB', row.__row), project_no: AUTO, base_project_import_key: baseKey, company_import_key: companyKey, billing_import_key: AUTO,
      partner_import_key: partnerKey, vehicle_import_key: vehicleImportKey, vehicle_owner_type: AUTO,
      manager_name: text(row['担当']), business_type: form, payment_type: /分割/.test(text(row['支払区分'])) ? '分割' : '通常', installment_amount: money(row['分割単価']),
      operation_start_date: excelDate(row['稼働開始日']), closing_date: text(row['締日']) });
    if (money(row['契約単価']) !== '' || money(row['委託単価']) !== '') addPrice(result, `price_set:${projectKey}`, companyKey, '', projectKey, row, [money(row['契約単価']), money(row['委託単価'])]);
  }
  const existingReviews = new Set(result['要確認'].map((r) => `${r[0]}:${r[1]}:${r[2]}`));
  for (const sheetName of Object.keys(FIELD_DEFINITIONS)) for (const row of result[sheetName]) if (row.review_reason) {
    const review = [sheetName, row.import_key, row.review_reason, row.source_sheet, row.source_row]; const signature = `${review[0]}:${review[1]}:${review[2]}`;
    if (!existingReviews.has(signature)) { result['要確認'].push(review); existingReviews.add(signature); }
  }
  return result;
}

function addPrice(result, key, companyKey, baseKey, projectKey, source, pair) {
  result['料金セット'].push({ ...common(key, '稼働者一覧DB', source.__row), price_set_no: AUTO, price_series_code: AUTO, revision_no: AUTO, company_import_key: companyKey,
    base_project_import_key: baseKey, project_import_key: projectKey, price_set_name: AUTO, apply_start_date: AUTO, __auto_apply_start_date: excelDate(source['稼働開始日']) || excelDate(source['基本契約日']), apply_end_date: '', note: '' });
  result['料金行'].push({ ...common(`price_line:${key}:base`, '稼働者一覧DB', source.__row), price_set_import_key: key, weekday_code: '全日', calc_type_code: '日額', price_type_code: '基本',
    billing_unit_price: pair[0] === '' ? 0 : Number(pair[0]), payment_unit_price: pair[1] === '' ? 0 : Number(pair[1]), sort_order: 10 });
}

function allFields(sheetName) { return [...META_FIELDS.map(([label, code, kind]) => F(label, code, kind)), ...(FIELD_DEFINITIONS[sheetName] || [])]; }
function displayValue(row, field) {
  const v = row[field.code];
  if (v == null) return '';
  if ((field.code.endsWith('_date') || ['apply_start_date', 'apply_end_date'].includes(field.code)) && v !== AUTO) {
    const date = excelDate(v); if (date) return new Date(`${date}T00:00:00Z`);
  }
  return v;
}

async function buildWorkbook(data, options = {}) {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'Links-System'; wb.created = new Date();
  const summary = Object.fromEntries(Object.keys(FIELD_DEFINITIONS).map((name) => [name, (data[name] || []).length]));
  for (const name of SHEET_ORDER) wb.addWorksheet(name, { views: name === '概要' ? [] : [{ state: 'frozen', ySplit: 2, xSplit: 1 }] });
  const cover = wb.getWorksheet('概要');
  cover.addRows([['マスターデータ編集用Excel'], ['生成日時', new Date()], [], ['使い方'], ['1', '薄黄色の必須欄と必要な白色欄を入力します。'], ['2', '薄青の★自動補完欄は変更しても登録時に再計算されます。'], ['3', '管理画面で完成Excelを検証し、エラーがない正常行を登録します。'], [], ['シート', '件数'], ...Object.entries(summary)]);
  cover.getCell('A1').font = { name: 'Arial', size: 16, bold: true, color: { argb: 'FF1F2937' } }; cover.getColumn(1).width = 24; cover.getColumn(2).width = 70; cover.getCell('B2').numFmt = 'yyyy-mm-dd hh:mm';
  for (const [sheetName, fields] of Object.entries(FIELD_DEFINITIONS)) {
    const ws = wb.getWorksheet(sheetName); const cols = allFields(sheetName); const rows = data[sheetName] || [];
    ws.addRow(cols.map((f) => f.label)); ws.addRow(cols.map((f) => f.code));
    rows.forEach((row) => ws.addRow(cols.map((f) => displayValue(row, f))));
    ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: Math.max(2, rows.length + 2), column: cols.length } };
    ws.getRow(1).height = 34; ws.getRow(2).height = 24;
    cols.forEach((field, index) => {
      const valueWidth = rows.slice(0, 80).reduce((max, row) => Math.max(max, String(row[field.code] ?? '').length + 2), 0);
      const preferred = field.code.includes('import_key') ? 42 : field.code === 'review_reason' ? 48 : field.code === 'source_sheet' ? 22 : Math.max(12, field.label.length * 2 + 4, field.code.length + 2, valueWidth);
      const col = ws.getColumn(index + 1); col.width = Math.min(48, preferred);
      const header = ws.getCell(1, index + 1); header.font = { name: 'Arial', size: 10, bold: true, color: { argb: 'FFFFFFFF' } }; header.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1F4E78' } }; header.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
      const code = ws.getCell(2, index + 1); code.font = { name: 'Arial', size: 9, italic: true, color: { argb: 'FF374151' } }; code.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE5E7EB' } };
      const body = ws.getColumn(index + 1); body.alignment = { vertical: 'middle' };
      if (field.code.endsWith('_date') || ['apply_start_date', 'apply_end_date'].includes(field.code)) col.numFmt = 'yyyy-mm-dd';
      if (field.kind === 'required') for (let r = 3; r <= Math.max(rows.length + 2, 502); r += 1) ws.getCell(r, index + 1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFF2CC' } };
      if (field.kind === 'auto') for (let r = 3; r <= Math.max(rows.length + 2, 502); r += 1) { const c = ws.getCell(r, index + 1); c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFDDEBF7' } }; if (!c.value) c.value = AUTO; }
      if (field.choice) {
        const rangeName = `choice_${field.choice}`;
        for (let r = 3; r <= Math.max(rows.length + 2, 502); r += 1) ws.getCell(r, index + 1).dataValidation = { type: 'list', allowBlank: field.kind !== 'required', formulae: [`=${rangeName}`], showErrorMessage: true, errorTitle: '選択肢エラー', error: '一覧の表示名またはコード値を入力してください。' };
      }
    });
  }
  const review = wb.getWorksheet('要確認'); review.addRow(['対象シート', '取込キー', '理由', '元シート', '元行番号']); (data['要確認'] || []).forEach((r) => review.addRow(r));
  review.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } }; review.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFC65911' } }; review.columns = [{ width: 18 }, { width: 34 }, { width: 60 }, { width: 22 }, { width: 12 }];
  const choiceSheet = wb.getWorksheet('選択肢'); choiceSheet.addRow(['カテゴリ', 'コード値', '表示名']);
  let choiceRow = 2;
  for (const [category, values] of Object.entries(CHOICES)) {
    const start = choiceRow; values.forEach(([code, label]) => { choiceSheet.addRow([category, code, label]); choiceRow += 1; });
    wb.definedNames.add(`'選択肢'!$C$${start}:$C$${choiceRow - 1}`, `choice_${category}`);
  }
  choiceSheet.columns = [{ width: 24 }, { width: 24 }, { width: 24 }]; choiceSheet.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } }; choiceSheet.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1F4E78' } };
  const rules = wb.getWorksheet('変換ルール'); rules.addRows([['項目', '規則'], ['企業統合', '企業番号で統合。番号なしの稼働企業は正規化名称の仮キー。'], ['パートナー統合', '正規化氏名と電話・生年月日・口座番号で統合。強い情報の衝突は別候補。'], ['基本案件', '企業＋形態で集約。'], ['個別案件', '企業を特定できる稼働者行ごとに作成。'], ['料金', '契約単価＝請求基本日額、委託単価＝支払基本日額、daily/all。'], ['★自動補完', 'Excel値を信用せず再取込時にサーバーで再計算。'], ['保存対象外', '支払月オフセット等はExcelには残すが今回DBへ保存しない。']]);
  rules.columns = [{ width: 24 }, { width: 100 }]; rules.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } }; rules.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1F4E78' } };
  for (const ws of wb.worksheets) { ws.views = ws.views || []; ws.properties.defaultRowHeight = 19; ws.eachRow((row) => row.eachCell((cell) => { cell.font = { name: 'Arial', size: cell.font?.size || 10, bold: cell.font?.bold, italic: cell.font?.italic, color: cell.font?.color }; cell.alignment = { ...(cell.alignment || {}), vertical: 'middle' }; })); }
  return { workbook: wb, summary };
}

async function workbookBuffer(data, options) { const { workbook, summary } = await buildWorkbook(data, options); return { buffer: await workbook.xlsx.writeBuffer(), summary }; }

function choiceCode(category, value) {
  if (!text(value) || value === AUTO) return '';
  const n = normalized(value); const pair = (CHOICES[category] || []).find(([code, label]) => normalized(code) === n || normalized(label) === n);
  return pair?.[0] || text(value);
}
async function parseCompletedWorkbook(input) {
  const wb = new ExcelJS.Workbook(); await wb.xlsx.load(input); const result = {};
  for (const [sheetName, definitions] of Object.entries(FIELD_DEFINITIONS)) {
    const ws = wb.getWorksheet(sheetName); if (!ws) throw new Error(`必須シート「${sheetName}」がありません`);
    const codes = []; ws.getRow(2).eachCell({ includeEmpty: true }, (cell, col) => { codes[col - 1] = text(cell.value); });
    const allowed = new Set(allFields(sheetName).map((f) => f.code));
    const unknown = codes.filter((c) => c && !allowed.has(c)); if (unknown.length) throw new Error(`「${sheetName}」に不明な項目コードがあります: ${unknown.join(', ')}`);
    const defs = new Map(definitions.map((f) => [f.code, f])); result[sheetName] = [];
    for (let rowNo = 3; rowNo <= ws.rowCount; rowNo += 1) {
      const row = {}; codes.forEach((code, i) => { if (code) row[code] = ws.getCell(rowNo, i + 1).value?.text ?? ws.getCell(rowNo, i + 1).value ?? ''; });
      if (!text(row.import_key)) continue;
      for (const [code, def] of defs) if (def.choice && row[code] !== AUTO) row[code] = choiceCode(def.choice, row[code]);
      row.__row = rowNo; result[sheetName].push(row);
    }
  }
  return result;
}

module.exports = { AUTO, META_FIELDS, FIELD_DEFINITIONS, SHEET_ORDER, CHOICES, normalized, meaningful, digits, excelDate, money, parsePaymentTerms, partnerClassification, transformSourceWorkbook, buildWorkbook, workbookBuffer, parseCompletedWorkbook, allFields, choiceCode };
