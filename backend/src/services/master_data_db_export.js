const crypto = require('node:crypto');
const { FIELD_DEFINITIONS, workbookBuffer, excelDate } = require('./master_data_workbook');
const { CONFIG, ORDER, FK_FIELDS, cleanValue, sameStoredValue } = require('./master_data_import');

const AUTO_FIELDS = Object.fromEntries(Object.entries(FIELD_DEFINITIONS).map(([sheet, fields]) => [sheet, new Set(fields.filter((field) => field.kind === 'auto').map((field) => field.code))]));

function exportKey(batch) { return `dbx:${batch}:${crypto.randomBytes(8).toString('hex')}`; }
function rowVersion(row) { return Number(row.version || 1); }

async function buildDbExport(conn, actorUserId) {
  const batch = crypto.randomBytes(16).toString('hex');
  const data = Object.fromEntries(ORDER.map((sheet) => [sheet, []]));
  const byRecord = new Map();
  const rowsBySheet = new Map();
  const [series] = await conn.query('SELECT price_series_id,series_code FROM price_series');
  const seriesCodes = new Map(series.map((row)=>[Number(row.price_series_id),row.series_code]));
  for (const sheet of ORDER) {
    const config = CONFIG[sheet];
    const [rows] = await conn.query(`SELECT * FROM ${config.table} WHERE is_deleted=0 ORDER BY ${config.id}`);
    rowsBySheet.set(sheet, rows);
    for (const row of rows) {
      const key = exportKey(batch);
      byRecord.set(`${config.type}:${row[config.id]}`, key);
      data[sheet].push({ import_key:key, input_status:'DB出力', review_reason:'', source_sheet:'DB出力', source_row:'', ...Object.fromEntries(FIELD_DEFINITIONS[sheet].map((field) => [field.code, row[field.code] ?? ''])) });
      await conn.query('INSERT INTO master_data_db_export_rows (export_key,batch_key,entity_type,record_id,record_version,actor_user_id) VALUES (?,?,?,?,?,?)', [key,batch,config.type,row[config.id],rowVersion(row),actorUserId]);
    }
  }
  for (const sheet of ORDER) {
    const original = rowsBySheet.get(sheet);
    const exported = data[sheet];
    const links = FK_FIELDS[sheet] || {};
    original.forEach((row,index) => {
      for (const [keyField,[idField,expected]] of Object.entries(links)) {
        const id = row[idField];
        let types = expected.split('|');
        if (keyField === 'vehicle_import_key') {
          if (row.vehicle_owner_type) types = [row.vehicle_owner_type === 'partner' ? 'partner_vehicle' : 'company_vehicle'];
          else types = types.filter((type) => {
            const vehicle = rowsBySheet.get(type === 'partner_vehicle' ? 'パートナー車両' : '企業車両')
              .find((candidate) => Number(candidate.vehicle_id) === Number(id));
            return vehicle && Number(vehicle[type === 'partner_vehicle' ? 'partner_id' : 'company_id']) ===
              Number(row[type === 'partner_vehicle' ? 'partner_id' : 'company_id']);
          });
        }
        const keys = id == null ? [] : types.map((type) => byRecord.get(`${type}:${id}`)).filter(Boolean);
        exported[index][keyField] = id == null ? '' : keys.length === 1 ? keys[0] : '#UNRESOLVED';
        if (id != null && keys.length !== 1) {
          exported[index].input_status = '要確認';
          exported[index].review_reason = `${keyField} の参照先が不明または重複しています`;
        }
      }
      if (sheet === 'パートナー' || sheet === '個別案件') exported[index].transfer_fee_pattern_code = row.transfer_fee_pattern_id ?? '';
      if (sheet === '個別案件' && row.vehicle_id) exported[index].vehicle_owner_type = row.vehicle_owner_type || '';
      if (sheet === '料金セット' && row.price_series_id) exported[index].price_series_code = seriesCodes.get(Number(row.price_series_id)) || '';
      for (const field of FIELD_DEFINITIONS[sheet]) {
        if (field.code.endsWith('_date') || ['apply_start_date','apply_end_date'].includes(field.code)) {
          exported[index][field.code] = excelDate(exported[index][field.code]) || '';
        }
      }
    });
  }
  data['要確認'] = [];
  return { batch, data, ...(await workbookBuffer(data,{mode:'db_export'})) };
}

function batchFromRows(parsed) {
  const keys = ORDER.flatMap((sheet) => (parsed[sheet] || []).map((row) => String(row.import_key || '')));
  if (!keys.length) throw new Error('取込対象の行がありません');
  const matches = keys.map((key) => /^dbx:([0-9a-f]{32}):[0-9a-f]{16}$/.exec(key));
  if (matches.some((match) => !match) || new Set(matches.map((match) => match[1])).size !== 1) throw new Error('DB出力Excelの取込キーが不正です');
  return matches[0][1];
}

async function previewDbExport(conn, parsed) {
  const batch = batchFromRows(parsed);
  const [snapshots] = await conn.query('SELECT export_key,entity_type,record_id,record_version FROM master_data_db_export_rows WHERE batch_key=?',[batch]);
  const byKey = new Map(snapshots.map((row) => [row.export_key,row]));
  const [feeRows]=await conn.query('SELECT transfer_fee_pattern_id,pattern_name FROM transfer_fee_patterns WHERE is_deleted=0 AND is_active=1');
  const feePatterns=new Map(feeRows.flatMap((row)=>[[String(row.transfer_fee_pattern_id),Number(row.transfer_fee_pattern_id)],[String(row.pattern_name).normalize('NFKC').trim(),Number(row.transfer_fee_pattern_id)]]));
  const all = [];
  const counts = { new:0,update:0,unchanged:0,error:0,dependency_error:0,conflict:0 };
  const seen = new Set();
  for (const sheet of ORDER) for (const row of parsed[sheet] || []) {
    const key = String(row.import_key || '');
    const config = CONFIG[sheet]; const snapshot = byKey.get(key);
    const item = {sheet,type:config.type,key,row,errors:[],status:'pending',recordId:Number(snapshot?.record_id),recordVersion:Number(snapshot?.record_version)};
    if (seen.has(key)) item.errors.push('取込キーが重複しています');
    seen.add(key);
    if (!snapshot || snapshot.entity_type !== config.type) item.errors.push('DB出力時の対象レコードを確認できません');
    if (item.errors.length) item.status='error';
    all.push(item);
  }
  const inputByKey = new Map(all.map((item) => [item.key,item]));
  for (const item of all) {
    if (item.status==='error') continue;
    const config=CONFIG[item.sheet];
    const [records]=await conn.query(`SELECT * FROM ${config.table} WHERE ${config.id}=? AND is_deleted=0 LIMIT 1`,[item.recordId]);
    if (!records.length) { item.status='conflict'; item.errors.push('対象が削除されています'); continue; }
    item.current=records[0];
    item.desired={};
    for (const field of FIELD_DEFINITIONS[item.sheet].filter((definition)=>definition.kind==='required')) {
      if (!String(item.row[field.code]??'').trim()) {item.status='error';item.errors.push(`${field.code} は必須です`);}
    }
    if (item.status==='error') continue;
    const linked = {};
    for (const field of config.fields) {
      if (AUTO_FIELDS[item.sheet].has(field) || field.endsWith('_id')) continue;
      if (!Object.hasOwn(item.row,field)) continue;
      item.desired[field]=cleanValue(field,item.row[field]);
    }
    for (const [keyField,[idField,expected]] of Object.entries(FK_FIELDS[item.sheet]||{})) {
      const targetKey=String(item.row[keyField]||'');
      if (!targetKey) {
        if (item.row[keyField] === '') {
          item.desired[idField]=null;
          if (item.sheet==='個別案件' && keyField==='vehicle_import_key') item.desired.vehicle_owner_type=null;
        }
        continue;
      }
      const target=byKey.get(targetKey);
      if (!target || !expected.split('|').includes(target.entity_type)) {
        item.status='dependency_error'; item.errors.push(`${keyField} の参照先が不正です`); break;
      }
      const parentConfig=CONFIG[ORDER.find((sheet)=>CONFIG[sheet].type===target.entity_type)];
      const [liveParents]=await conn.query(`SELECT * FROM ${parentConfig.table} WHERE ${parentConfig.id}=? AND is_deleted=0 LIMIT 1`,[target.record_id]);
      if (!liveParents.length) {item.status='dependency_error';item.errors.push(`${keyField} の参照先が削除されています`);break;}
      item.desired[idField]=Number(target.record_id);
      linked[keyField]={type:target.entity_type,row:{...liveParents[0],...(inputByKey.get(targetKey)?.desired||{})}};
      if (item.sheet==='個別案件' && keyField==='vehicle_import_key') {
        item.desired.vehicle_owner_type=target.entity_type==='partner_vehicle'?'partner':'company';
      }
    }
    if (item.status==='dependency_error') continue;
    const desiredId=(field)=>item.desired[field]===undefined?item.current[field]:item.desired[field];
    const companyId=desiredId('company_id');
    for (const field of ['billing_import_key','base_project_import_key','project_import_key']) {
      const relation=linked[field];
      if (relation && companyId != null && relation.row.company_id != null && Number(relation.row.company_id)!==Number(companyId)) {
        item.status='dependency_error';item.errors.push(`${field} が指定企業に属していません`);
      }
    }
    const vehicle=linked.vehicle_import_key;
    if (vehicle) {
      const ownerField=vehicle.type==='partner_vehicle'?'partner_id':'company_id';
      const ownerId=desiredId(ownerField);
      if (ownerId == null || Number(vehicle.row[ownerField])!==Number(ownerId)) {
        item.status='dependency_error';item.errors.push('車両が指定した所有元に属していません');
      }
    }
    if (item.status==='dependency_error') continue;
    if (['パートナー','個別案件'].includes(item.sheet)) {
      const raw=String(item.row.transfer_fee_pattern_code??'').normalize('NFKC').trim();
      const feeId=raw?feePatterns.get(raw):null;
      if (raw && !feeId) {item.status='error';item.errors.push('振込手数料パターンがマスターにありません');continue;}
      item.desired.transfer_fee_pattern_id=feeId;
    }
    if (Object.entries(item.desired).every(([field,value]) => sameStoredValue(field,item.current[field],value))) item.status='unchanged';
    else if (rowVersion(item.current)!==item.recordVersion) { item.status='conflict'; item.errors.push('出力後に画面または別のExcelから変更されています'); }
    else {
      let historical=item.sheet==='料金セット' && item.current.is_current_revision != null && Number(item.current.is_current_revision)===0;
      if (item.sheet==='料金行') {
        const [parents]=await conn.query('SELECT is_current_revision FROM price_sets WHERE price_set_id=? AND is_deleted=0 LIMIT 1',[item.current.price_set_id]);
        historical=!parents.length || (parents[0].is_current_revision != null && Number(parents[0].is_current_revision)===0);
      }
      if (historical) { item.status='conflict'; item.errors.push('過去の料金改定版はExcelから変更できません。金額データ画面で理由を入力して訂正してください'); }
      else item.status='update';
    }
  }
  let changed=true;
  while (changed) {
    changed=false;
    for (const item of all.filter((row) => row.status==='update')) for (const keyField of Object.keys(FK_FIELDS[item.sheet]||{})) {
      const target=inputByKey.get(String(item.row[keyField]||''));
      if (target && ['error','dependency_error','conflict'].includes(target.status)) {
        item.status='dependency_error'; item.errors.push(`${keyField} の参照先にエラーがあります`); changed=true; break;
      }
    }
  }
  for (const item of all) counts[item.status]++;
  return { rows:all, counts, dbExport:true, batch };
}

async function commitDbExport(conn, preview) {
  let updated=0;
  for (const sheet of ORDER) for (const item of preview.rows.filter((row) => row.sheet===sheet && row.status==='update')) {
    const config=CONFIG[sheet]; const fields=Object.keys(item.desired);
    if (sheet==='料金セット' || sheet==='料金行') {
      const priceSetId=sheet==='料金セット'?item.recordId:item.current.price_set_id;
      const [parents]=await conn.query('SELECT is_current_revision FROM price_sets WHERE price_set_id=? AND is_deleted=0 LIMIT 1 FOR UPDATE',[priceSetId]);
      if (!parents.length || (parents[0].is_current_revision != null && Number(parents[0].is_current_revision)===0)) {
        throw Object.assign(new Error('過去の料金改定版はExcelから変更できません'),{code:'version_conflict'});
      }
    }
    const [result]=await conn.query(`UPDATE ${config.table} SET ${fields.map((field)=>`${field}=?`).join(',')},version=version+1,updated_at=CURRENT_TIMESTAMP WHERE ${config.id}=? AND version=? AND is_deleted=0`,[...fields.map((field)=>item.desired[field]),item.recordId,item.recordVersion]);
    if (!result.affectedRows) throw Object.assign(new Error('登録直前にバージョン競合が発生しました'),{code:'version_conflict'});
    updated++;
  }
  return {created:0,updated,unchanged:preview.counts.unchanged,skipped:preview.rows.length-updated-preview.counts.unchanged};
}

module.exports={buildDbExport,batchFromRows,previewDbExport,commitDbExport};
