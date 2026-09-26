const crypto=require('node:crypto');
const {periodError}=require('./daily_report_periods');
const {validateQuantityOverrides}=require('./quantity_overrides');
const additional=require('./additional_items');
function adoptionInput(merged,request) {
  const result={...merged};
  if(request.quantity_overrides!==undefined&&!String(request.reason||'').trim())throw periodError('超過値の採用・解除理由を入力してください',400);
  if(request.quantity_overrides!==undefined)result.quantity_overrides=JSON.stringify(validateQuantityOverrides(request.quantity_overrides));
  return result;
}
function expenseValues(request) {
  const expense=request.expense;
  if(expense==null)return null;
  if(!['billing','payment','both'].includes(expense.applies_to)||!['taxable','tax_inclusive','non_taxable'].includes(expense.tax_category))throw periodError('業務経費の請求支払対象・税区分を確認してください',400);
  const values={applies_to:expense.applies_to,tax_category:expense.tax_category};
  for(const side of ['billing','payment']) {
    const n=Number(expense[`${side}_amount`]);
    if(!Number.isSafeInteger(n)||n<0||n>99999999)throw periodError('業務経費は0以上の整数円で指定してください',400);
    values[`${side}_amount`]=expense.applies_to===({'billing':'payment','payment':'billing'}[side])?0:n;
  }
  if(!String(request.reason||'').trim())throw periodError('経費の採用理由を入力してください',400);
  return values;
}
function previewToken(calculated,request) {
  // Recheck the complete computed result, including the active price/rule version.
  const stable=value=>Array.isArray(value)?value.map(stable):value&&typeof value==='object'?Object.fromEntries(Object.keys(value).sort().map(key=>[key,stable(value[key])])):value;
  return crypto.createHash('sha256').update(JSON.stringify(stable({calculated,expense:expenseValues(request),quantity:request.quantity_overrides??null}))).digest('hex');
}
async function saveExpense(conn,report,batch,row,request,actor) {
  const values=expenseValues(request);if(!values)return null;
  await additional.assertEditable(conn,report.project_id,report.target_year_month,report.work_date);
  const key=`ocr-expense-${report.daily_report_id}`;
  const [items]=await conn.query('SELECT * FROM daily_additional_items WHERE project_id=? AND request_key=? FOR UPDATE',[report.project_id,key]);
  const before=items[0];
  if(before && (before.is_deleted || Number(before.version)!==Number(request.expense.expected_version)))throw periodError('業務経費が更新されています。現在値を再取得してください');
  if(!before && request.expense.expected_version!=null)throw periodError('業務経費が変更されています。再確認してください');
  const [masters]=await conn.query("SELECT additional_item_master_id FROM additional_item_masters WHERE item_name='業務経費' AND calculation_method='direct' AND is_active=1 ORDER BY additional_item_master_id LIMIT 1");
  if(!masters.length)throw periodError('業務経費の項目マスターがありません');
  const item={...values,project_id:report.project_id,daily_report_period_id:report.daily_report_period_id,target_year_month:report.target_year_month,work_date:report.work_date,
    additional_item_master_id:masters[0].additional_item_master_id,item_name:'業務経費',calculation_method:'direct',reason:String(request.reason).trim(),
    calculation_data:JSON.stringify({method:'direct',source_import_row_id:row.daily_report_import_row_id,source_batch_id:batch.daily_report_import_batch_id,inputs:values})};
  await require('./annual_closing').assertItemEditable(conn,before,item);
  const keys=Object.keys(item);let id=before?.additional_item_id;
  if(before)await conn.query(`UPDATE daily_additional_items SET ${keys.map(k=>`${k}=?`).join(',')},version=version+1 WHERE additional_item_id=?`,[...keys.map(k=>item[k]),id]);
  else {const [r]=await conn.query(`INSERT INTO daily_additional_items(${keys.join(',')},request_key) VALUES (${keys.map(()=>'?').join(',')},?)`,[...keys.map(k=>item[k]),key]);id=r.insertId;}
  await conn.query('INSERT INTO additional_item_audits(additional_item_id,before_data,after_data,reason,actor_user_id) VALUES (?,?,?,?,?)',[id,before?JSON.stringify(before):null,JSON.stringify(item),item.reason,actor]);
  return id;
}
module.exports={adoptionInput,expenseValues,previewToken,saveExpense};
