async function resolveBillingSelection(query, data, selection = {}) {
  const hasNo = selection.billing_no !== undefined && selection.billing_no !== null && selection.billing_no !== '';
  if (hasNo) {
    const value = String(selection.billing_no).normalize('NFKC').trim();
    if (!/^\d+$/.test(value) || !Number.isSafeInteger(Number(value))) return '請求先Noは0以上の整数を入力してください';
    const rows = await query('SELECT billing_id FROM company_billings WHERE company_id=? AND billing_no=? AND is_deleted=0 LIMIT 1', [Number(data.company_id), Number(value)]);
    if (!rows.length) return 'この企業に該当する請求先Noが登録されていません';
    if (selection.billing_id && Number(selection.billing_id) !== Number(rows[0].billing_id)) return '請求先Noと選択した請求先が一致しません';
    data.billing_id = Number(rows[0].billing_id);
  }
  if (!data.billing_id) {
    const rows = await query('SELECT billing_id FROM company_billings WHERE company_id=? AND billing_no=0 AND is_deleted=0 LIMIT 1', [Number(data.company_id)]);
    if (!rows.length) return '企業の請求先No.0が登録されていません';
    data.billing_id = Number(rows[0].billing_id);
  }
  const rows = await query('SELECT billing_id FROM company_billings WHERE billing_id=? AND company_id=? AND is_deleted=0 LIMIT 1', [Number(data.billing_id), Number(data.company_id)]);
  return rows.length ? null : '選択した請求先が案件の企業に属していません';
}
module.exports = { resolveBillingSelection };
