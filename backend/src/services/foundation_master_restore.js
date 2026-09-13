const { loadCatalog } = require('./foundation_masters');

const SIMPLE = [
  { sheet:'コード',table:'code_masters',id:'code_master_id',key:['category_code','code_value'],fields:['code_label','sort_order','is_active'],version:true },
  { sheet:'システム設定',table:'system_settings',id:'setting_id',key:['setting_key'],fields:['setting_value','setting_label'],version:true },
  { sheet:'画面ヘルプ',table:'help_contents',id:'help_content_id',key:['screen_key'],fields:['help_title','overview_text','input_effect_text'],version:true },
  { sheet:'銀行形式',table:'bank_export_profiles',id:'bank_export_profile_id',key:['profile_code'],fields:['profile_name','bank_family','description','is_active'],version:true },
  { sheet:'控除規則',table:'settlement_deduction_rules',id:'settlement_deduction_rule_id',key:['rule_code','valid_from'],fields:['display_name','amount','tax_category'],version:false,where:"scope='common' AND partner_id IS NULL" },
  { sheet:'採番',table:'numbering_rules',id:'numbering_rule_id',key:['rule_key'],fields:['rule_label','prefix','pad_digits','next_number','is_active'],version:true },
];
function value(value) { return value instanceof Date ? value.toISOString().slice(0,10) : value == null ? '' : String(value); }
function keyOf(row,fields) { return fields.map((field)=>value(row[field])).join(':'); }
function changedFields(source,current,fields) { return fields.filter((field)=>value(source[field])!==value(current?.[field])); }

async function previewFoundationRestore(conn) {
  const catalog=await loadCatalog(); const rows=[];
  for (const spec of SIMPLE) {
    const [existing]=await conn.query(`SELECT * FROM ${spec.table} WHERE ${spec.where || '1=1'}`);
    const byKey=new Map(existing.map((row)=>[keyOf(row,spec.key),row]));
    for (const source of catalog[spec.sheet]) {
      const key=keyOf(source,spec.key); const current=byKey.get(key);
      const diff=changedFields(source,current,spec.fields);
      const status=current && Number(current.is_deleted||0) ? 'conflict' : !current ? 'new' : diff.length ? 'update' : 'unchanged';
      rows.push({sheet:spec.sheet,key,source,current:current||null,spec,status,diff,reason:status==='conflict'?'論理削除済みです':''});
    }
  }
  const [profiles]=await conn.query('SELECT bank_export_profile_id,profile_code FROM bank_export_profiles WHERE is_deleted=0');
  for (const profile of profiles.filter((row)=>catalog['銀行形式'].some((source)=>source.profile_code===row.profile_code))) {
    const [versions]=await conn.query('SELECT bank_export_profile_version_id,status FROM bank_export_profile_versions WHERE bank_export_profile_id=? AND version_no=1',[profile.bank_export_profile_id]);
    const version=versions[0];
    const [columns]=version ? await conn.query('SELECT * FROM bank_export_columns WHERE bank_export_profile_version_id=?',[version.bank_export_profile_version_id]) : [[]];
    const byKey=new Map(columns.map((row)=>[row.column_key,row]));
    for (const source of catalog['銀行列']) {
      const key=`${profile.profile_code}:${source.column_key}`; const current=byKey.get(source.column_key);
      const fields=['column_label','source_key','is_required','format_code','zero_pad_length','max_length','transform_code','sort_order'];
      const diff=changedFields(source,current,fields);
      const status=!version || version.status!=='draft' ? 'conflict' : !current ? 'new' : diff.length ? 'update' : 'unchanged';
      rows.push({sheet:'銀行列',key,source,current:current||null,spec:{table:'bank_export_columns',id:'bank_export_column_id',key:['bank_export_profile_version_id','column_key'],fields,version:false},parentVersionId:version?.bank_export_profile_version_id,status,diff,reason:status==='conflict'?'銀行形式の下書き版がありません。公開済み版は変更できません':''});
    }
  }
  const counts={new:0,update:0,unchanged:0,conflict:0}; rows.forEach((row)=>counts[row.status]++);
  return {rows,counts};
}

async function commitFoundationRestore(conn,preview,selectedKeys) {
  const selected=new Set(selectedKeys);
  const available=new Set(preview.rows.filter((row)=>['new','update'].includes(row.status)).map((row)=>`${row.sheet}:${row.key}`));
  if (!selected.size || [...selected].some((key)=>!available.has(key))) throw Object.assign(new Error('復旧対象の選択が不正です'),{status:400});
  let created=0,updated=0;
  for (const item of preview.rows.filter((row)=>selected.has(`${row.sheet}:${row.key}`))) {
    const {spec,source,current}=item;
    const lookup={...Object.fromEntries(spec.key.map((field)=>[field,source[field]])),...(item.sheet==='銀行列'?{bank_export_profile_version_id:item.parentVersionId}:{})};
    const clauses=Object.keys(lookup).map((field)=>`${field}=?`).join(' AND ');
    const [liveRows]=await conn.query(`SELECT * FROM ${spec.table} WHERE ${clauses}${spec.where?` AND ${spec.where}`:''} FOR UPDATE`,Object.values(lookup));
    const live=liveRows[0]||null;
    if (Boolean(current)!==Boolean(live) || (current && [...spec.fields,...spec.key,'is_deleted',...(spec.version?['version']:[])].some((field)=>value(current[field])!==value(live[field])))) {
      throw Object.assign(new Error(`復旧前に値が変更されました: ${item.sheet} ${item.key}`),{status:409});
    }
    if (!live) {
      const data={...lookup,...Object.fromEntries(spec.fields.map((field)=>[field,source[field]])),...(item.sheet==='控除規則'?{scope:'common',partner_id:null,is_active:1}:{})};
      const fields=Object.keys(data);
      await conn.query(`INSERT INTO ${spec.table} (${fields.join(',')}) VALUES (${fields.map(()=>'?').join(',')})`,Object.values(data));
      created++;
    } else {
      const fields=spec.fields;
      await conn.query(`UPDATE ${spec.table} SET ${fields.map((field)=>`${field}=?`).join(',')}${spec.version?',version=version+1':''} WHERE ${spec.id}=?`,[...fields.map((field)=>source[field]),live[spec.id]]);
      updated++;
    }
  }
  return {created,updated,skipped:preview.rows.length-created-updated};
}
module.exports={SIMPLE,previewFoundationRestore,commitFoundationRestore};
