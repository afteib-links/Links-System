const { FIELD_DEFINITIONS, AUTO, partnerClassification, excelDate, money } = require('./master_data_workbook');
const { allocatePriceSetNo } = require('./price_set_lifecycle');

const CONFIG = {
  '企業': { type: 'company', table: 'companies', id: 'company_id', fields: FIELD_DEFINITIONS['企業'].map((f) => f.code).filter((x) => x !== 'office_no') },
  '請求先': { type: 'billing', table: 'company_billings', id: 'billing_id', parent: ['company_import_key', 'company'], fields: ['billing_print_name', 'billing_zip_code', 'billing_address', 'billing_phone', 'billing_fax', 'billing_email', 'invoice_send_method', 'billing_manager', 'billing_summary_no'] },
  '企業車両': { type: 'company_vehicle', table: 'company_vehicles', id: 'vehicle_id', parent: ['company_import_key', 'company'], fields: ['vehicle_name', 'vehicle_number', 'inspection_expiry_date', 'insurance_expiry_date'] },
  'パートナー': { type: 'partner', table: 'partners', id: 'partner_id', fields: [...FIELD_DEFINITIONS['パートナー'].map((f) => f.code).filter((x) => !['transfer_fee_pattern_code', 'payment_terms_text', 'tax_adjustment_source', 'payment_month_offset', 'parsed_payment_date_code'].includes(x)), 'transfer_fee_pattern_id'] },
  'パートナー車両': { type: 'partner_vehicle', table: 'partner_vehicles', id: 'vehicle_id', parent: ['partner_import_key', 'partner'], fields: ['vehicle_name', 'vehicle_number', 'inspection_expiry_date', 'insurance_expiry_date'] },
  '基本案件': { type: 'base_project', table: 'base_projects', id: 'base_project_id', fields: FIELD_DEFINITIONS['基本案件'].map((f) => f.code).filter((x) => !['base_project_no', 'company_import_key', 'billing_import_key', 'partner_import_key', 'vehicle_import_key'].includes(x)) },
  '個別案件': { type: 'project', table: 'projects', id: 'project_id', fields: [...FIELD_DEFINITIONS['個別案件'].map((f) => f.code).filter((x) => !['project_no', 'base_project_import_key', 'company_import_key', 'billing_import_key', 'partner_import_key', 'vehicle_import_key', 'transfer_fee_pattern_code'].includes(x)), 'transfer_fee_pattern_id'] },
  '料金セット': { type: 'price_set', table: 'price_sets', id: 'price_set_id', fields: ['price_set_name', 'apply_start_date', 'apply_end_date', 'note'] },
  '料金行': { type: 'price_line', table: 'price_set_lines', id: 'price_set_line_id', parent: ['price_set_import_key', 'price_set'], fields: ['weekday_code', 'calc_type_code', 'price_type_code', 'billing_unit_price', 'payment_unit_price', 'sort_order'] },
};
const ORDER = Object.keys(CONFIG);
const FK_FIELDS = {
  '請求先': { company_import_key: ['company_id', 'company'] },
  '企業車両': { company_import_key: ['company_id', 'company'] },
  'パートナー車両': { partner_import_key: ['partner_id', 'partner'] },
  '基本案件': { company_import_key: ['company_id', 'company'], billing_import_key: ['billing_id', 'billing'], partner_import_key: ['partner_id', 'partner'], vehicle_import_key: ['vehicle_id', 'company_vehicle|partner_vehicle'] },
  '個別案件': { base_project_import_key: ['base_project_id', 'base_project'], company_import_key: ['company_id', 'company'], billing_import_key: ['billing_id', 'billing'], partner_import_key: ['partner_id', 'partner'], vehicle_import_key: ['vehicle_id', 'company_vehicle|partner_vehicle'] },
  '料金セット': { company_import_key: ['company_id', 'company'], base_project_import_key: ['base_project_id', 'base_project'], project_import_key: ['project_id', 'project'] },
  '料金行': { price_set_import_key: ['price_set_id', 'price_set'] },
};
const NUMERIC_FIELDS = new Set([
  'advance_payment_enabled', 'billing_no', 'billing_summary_no', 'basic_work_hours',
  'billing_unit_price', 'binding_time', 'break_time', 'distance_calc_amount',
  'installment_amount', 'is_default', 'payment_unit_price', 'sort_order',
]);

function sameStoredValue(field, stored, desired) {
  if ((stored == null || stored === '') && (desired == null || desired === '')) return true;
  if (NUMERIC_FIELDS.has(field)) return Number(stored) === Number(desired);
  if (/date$/.test(field)) return excelDate(stored) === excelDate(desired);
  if (field.endsWith('_json')) {
    try { return JSON.stringify(typeof stored === 'string' ? JSON.parse(stored) : stored) === JSON.stringify(typeof desired === 'string' ? JSON.parse(desired) : desired); } catch { return String(stored ?? '') === String(desired ?? ''); }
  }
  return String(stored ?? '') === String(desired ?? '');
}

function cleanValue(field, value) {
  if (value == null || value === '' || value === AUTO) return null;
  // Older generated workbooks used "base", while the pricing engine and code
  // master have always used "basic" for the regular daily fee.
  if (field === 'price_type_code' && String(value).trim() === 'base') return 'basic';
  if (/date$/.test(field) || field === 'apply_start_date' || field === 'apply_end_date') return excelDate(value) || null;
  if (['billing_unit_price', 'payment_unit_price', 'sort_order', 'basic_work_hours', 'installment_amount', 'binding_time', 'break_time', 'distance_calc_amount'].includes(field)) return money(value);
  if (field === 'advance_payment_enabled') return ['1', 'true', 'はい', '有', 'あり'].includes(String(value).trim().toLowerCase()) ? 1 : 0;
  return typeof value === 'string' ? value.trim() : value;
}

function autoComplete(sheet, row) {
  const out = { ...row };
  if (sheet === '企業') out.contract_status_code = 'active';
  if (sheet === '請求先') { out.billing_no = 0; out.is_default = 1; }
  if (sheet === 'パートナー') {
    out.contract_status_code = 'active';
    const [category, employment] = partnerClassification({ '生年月日': out.birth_date, '住所': out.address, '電話': out.contact_phone, '確定申告': out.tax_return_code, '支払区分': out.tax_adjustment_source });
    out.partner_category_code = category; out.employment_type_code = employment;
  }
  if (sheet === '基本案件' || sheet === '個別案件') {
    if (!out.billing_import_key || out.billing_import_key === AUTO) out.billing_import_key = String(out.company_import_key || '').replace(/^company:/, 'billing:') + ':default';
    if (!out.payment_type) out.payment_type = 'normal';
    if (sheet === '基本案件') out.contract_status_code = 'active';
    if (out.vehicle_import_key) out.vehicle_owner_type = out.vehicle_import_key.startsWith('company_vehicle:') ? 'company' : 'partner';
  }
  if (sheet === '料金セット') {
    const owner = out.project_import_key || out.base_project_import_key;
    out.price_set_name = owner ? `${owner} 基本日額` : '';
    out.apply_start_date = excelDate(out.apply_start_date === AUTO ? '' : out.apply_start_date) || null;
  }
  return out;
}

function requiredCodes(sheet) { return FIELD_DEFINITIONS[sheet].filter((f) => f.kind === 'required').map((f) => f.code); }

function validateRows(parsed) {
  const allKeys = new Map(); const errors = []; const rows = [];
  for (const sheet of ORDER) {
    for (const original of parsed[sheet] || []) {
      const row = autoComplete(sheet, original); const config = CONFIG[sheet]; const key = String(row.import_key || '').trim(); const rowErrors = [];
      if (!key) rowErrors.push('取込キーは必須です');
      const composite = `${config.type}:${key}`;
      if (allKeys.has(composite)) rowErrors.push(`取込キーが重複しています（先行行: ${allKeys.get(composite)}）`); else allKeys.set(composite, `${sheet}!${row.__row}`);
      rows.push({ sheet, type: config.type, key, row, errors: rowErrors, status: rowErrors.length ? 'error' : 'pending' });
    }
  }
  const byKey = new Map(rows.map((r) => [`${r.type}:${r.key}`, r]));
  for (const partner of rows.filter((r) => r.sheet === 'パートナー')) {
    partner.row.advance_payment_enabled = rows.some((r) => r.sheet === '個別案件' && r.row.partner_import_key === partner.key && r.row.payment_type === 'installment') ? 1 : 0;
  }
  for (const item of rows) {
    if (item.sheet === '料金セット') {
      const owner = byKey.get(`project:${item.row.project_import_key}`) || byKey.get(`base_project:${item.row.base_project_import_key}`);
      const company = byKey.get(`company:${item.row.company_import_key}`);
      item.row.apply_start_date = excelDate(item.row.apply_start_date) || excelDate(owner?.row.operation_start_date) || excelDate(company?.row.contract_date) || null;
    }
    for (const code of requiredCodes(item.sheet)) if (cleanValue(code, item.row[code]) == null || cleanValue(code, item.row[code]) === '') item.errors.push(`${code} は必須です`);
    if (item.sheet === '料金セット' && !item.row.base_project_import_key && !item.row.project_import_key) item.errors.push('基本案件または個別案件の取込キーが必要です');
    if (item.sheet === '料金セット' && !item.row.apply_start_date) item.errors.push('適用開始日の自動補完に必要な稼働開始日または基本契約日がありません');
    if (item.errors.length) item.status = 'error';
  }
  let changed = true;
  while (changed) {
    changed = false;
    for (const item of rows.filter((r) => !r.errors.length)) for (const [keyField, [, expected]] of Object.entries(FK_FIELDS[item.sheet] || {})) {
      const key = item.row[keyField]; if (!key) continue;
      const candidates = expected.split('|').map((type) => byKey.get(`${type}:${key}`));
      if (!candidates.some((candidate) => candidate && !candidate.errors.length)) { item.errors.push(`${keyField} の参照先がないか、参照先にエラーがあります`); item.status = 'dependency_error'; changed = true; }
    }
  }
  for (const item of rows) item.errors.forEach((message) => errors.push({ sheet: item.sheet, key: item.key, row: item.row.__row, status: item.status, message }));
  return { rows, errors };
}

async function classifyRows(conn, validated) {
  const [mappingRows] = await conn.query('SELECT entity_type, import_key, record_id, record_version FROM master_data_import_mappings');
  const resolvedMappings = new Map(mappingRows.map((m) => [`${m.entity_type}:${m.import_key}`, { recordId: Number(m.record_id), version: Number(m.record_version) }]));
  const [feeRows] = await conn.query('SELECT transfer_fee_pattern_id,pattern_name FROM transfer_fee_patterns WHERE is_deleted=0 AND is_active=1');
  const feePatterns = new Map(feeRows.flatMap((row) => [[String(row.transfer_fee_pattern_id), Number(row.transfer_fee_pattern_id)], [String(row.pattern_name).normalize('NFKC').trim(), Number(row.transfer_fee_pattern_id)]]));
  for (const item of validated.rows.filter((r) => ['パートナー', '個別案件'].includes(r.sheet))) {
    const raw = String(item.row.transfer_fee_pattern_code || '').normalize('NFKC').trim();
    item.row.transfer_fee_pattern_id = raw ? feePatterns.get(raw) || null : null;
    if (raw && !item.row.transfer_fee_pattern_id) { item.errors.push('振込手数料パターンがマスターにありません'); item.status = 'error'; }
  }
  const mappings = new Map(mappingRows.map((m) => [`${m.entity_type}:${m.import_key}`, m]));
  const counts = { new: 0, update: 0, unchanged: 0, error: 0, dependency_error: 0, conflict: 0 };
  for (const item of validated.rows) {
    if (item.errors.length) { counts[item.status] += 1; continue; }
    const config = CONFIG[item.sheet]; const mapping = mappings.get(`${item.type}:${item.key}`);
    if (!mapping) { item.status = 'new'; counts.new += 1; continue; }
    const [records] = await conn.query(`SELECT * FROM ${config.table} WHERE ${config.id} = ? AND is_deleted = 0 LIMIT 1`, [mapping.record_id]);
    if (!records.length || Number(records[0].version) !== Number(mapping.record_version)) { item.status = 'conflict'; item.errors.push('前回取込後に画面で変更されたか、対象が削除されました'); counts.conflict += 1; continue; }
    const desired = desiredData(item, resolvedMappings); const unchanged = Object.entries(desired).every(([field, value]) => sameStoredValue(field, records[0][field], value));
    item.status = unchanged ? 'unchanged' : 'update'; item.recordId = Number(mapping.record_id); item.recordVersion = Number(mapping.record_version); counts[item.status] += 1;
  }
  return { ...validated, counts };
}

function desiredData(item, resolved = new Map()) {
  const config = CONFIG[item.sheet]; const data = {};
  for (const field of config.fields) data[field] = cleanValue(field, item.row[field]);
  for (const [keyField, [idField, expected]] of Object.entries(FK_FIELDS[item.sheet] || {})) {
    const key = item.row[keyField]; if (!key) { data[idField] = null; continue; }
    const match = expected.split('|').map((type) => resolved.get(`${type}:${key}`)).find(Boolean); if (match) data[idField] = match.recordId;
  }
  if (item.sheet === '基本案件' || item.sheet === '個別案件') data.price_set_id = null;
  return data;
}

async function allocateOfficeNo(conn) {
  const [rules] = await conn.query("SELECT * FROM numbering_rules WHERE rule_key='office' AND is_deleted=0 LIMIT 1 FOR UPDATE");
  if (!rules.length || !Number(rules[0].is_active)) throw new Error('企業Noの採番ルールがありません');
  const rule = rules[0]; const no = `${rule.prefix || ''}${String(rule.next_number).padStart(Number(rule.pad_digits || 0), '0')}`;
  await conn.query('UPDATE numbering_rules SET next_number=next_number+1, version=version+1 WHERE numbering_rule_id=?', [rule.numbering_rule_id]); return no;
}
async function allocatePrice(conn, data) {
  const priceSetNo = await allocatePriceSetNo(conn);
  const [seriesRows] = await conn.query('SELECT COALESCE(MAX(series_number),0) AS max_no FROM price_series WHERE company_id <=> ? FOR UPDATE', [data.company_id]);
  const seriesNumber = Number(seriesRows[0].max_no) + 1; const code = `FEE-${String(data.company_id || 0).padStart(5, '0')}-${String(seriesNumber).padStart(4, '0')}`;
  const [series] = await conn.query('INSERT INTO price_series (company_id,series_number,series_code,price_series_name,base_project_id,project_id) VALUES (?,?,?,?,?,?)', [data.company_id, seriesNumber, code, data.price_set_name, data.base_project_id, data.project_id]);
  return { price_set_no: priceSetNo, price_series_id: series.insertId, revision_no: 1, is_current_revision: 1 };
}

async function commitRows(conn, preview, actorUserId) {
  const accepted = preview.rows.filter((r) => ['new', 'update', 'unchanged'].includes(r.status));
  const total = preview.rows.length; const [batch] = await conn.query('INSERT INTO master_data_import_batches (actor_user_id,total_count,error_count,conflict_count) VALUES (?,?,?,?)', [actorUserId, total, preview.counts.error + preview.counts.dependency_error, preview.counts.conflict]);
  const resolved = new Map();
  const [existing] = await conn.query('SELECT entity_type,import_key,record_id,record_version FROM master_data_import_mappings'); existing.forEach((m) => resolved.set(`${m.entity_type}:${m.import_key}`, { recordId: Number(m.record_id), version: Number(m.record_version) }));
  for (const sheet of ORDER) {
    for (const item of accepted.filter((x) => x.sheet === sheet)) {
      const config = CONFIG[sheet];
      if (item.status === 'unchanged') { resolved.set(`${item.type}:${item.key}`, { recordId: item.recordId, version: item.recordVersion }); continue; }
      const data = desiredData(item, resolved);
      if (sheet === '企業' && item.status === 'new') data.office_no = await allocateOfficeNo(conn);
      if (sheet === '請求先') data.billing_no = 0;
      if (sheet === '料金セット' && item.status === 'new') Object.assign(data, await allocatePrice(conn, data));
      let recordId; let version;
      if (item.status === 'new') {
        const fields = Object.keys(data); const [created] = await conn.query(`INSERT INTO ${config.table} (${fields.join(',')}) VALUES (${fields.map(() => '?').join(',')})`, fields.map((f) => data[f]));
        recordId = Number(created.insertId); version = 1;
        await conn.query('INSERT INTO master_data_import_mappings (entity_type,import_key,record_id,record_version,first_batch_id,last_batch_id) VALUES (?,?,?,?,?,?)', [item.type, item.key, recordId, version, batch.insertId, batch.insertId]);
      } else {
        const fields = Object.keys(data); const [updated] = await conn.query(`UPDATE ${config.table} SET ${fields.map((f) => `${f}=?`).join(',')},version=version+1,updated_at=CURRENT_TIMESTAMP WHERE ${config.id}=? AND version=? AND is_deleted=0`, [...fields.map((f) => data[f]), item.recordId, item.recordVersion]);
        if (!updated.affectedRows) throw Object.assign(new Error('登録直前にバージョン競合が発生しました'), { code: 'version_conflict' });
        recordId = item.recordId; version = item.recordVersion + 1;
        await conn.query('UPDATE master_data_import_mappings SET record_version=?,last_batch_id=? WHERE entity_type=? AND import_key=?', [version, batch.insertId, item.type, item.key]);
      }
      resolved.set(`${item.type}:${item.key}`, { recordId, version });
    }
  }
  await conn.query("UPDATE master_data_import_batches SET completed_at=CURRENT_TIMESTAMP,created_count=?,updated_count=?,unchanged_count=?,result_code='completed' WHERE batch_id=?", [preview.counts.new, preview.counts.update, preview.counts.unchanged, batch.insertId]);
  return { batch_id: batch.insertId, created: preview.counts.new, updated: preview.counts.update, unchanged: preview.counts.unchanged, skipped: total - accepted.length };
}

module.exports = { CONFIG, ORDER, FK_FIELDS, cleanValue, sameStoredValue, autoComplete, validateRows, classifyRows, desiredData, commitRows };
