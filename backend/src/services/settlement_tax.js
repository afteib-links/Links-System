const SYSTEM_TAX_RATE = 0.1;

async function resolveInvoiceTax(conn, companyId, projectIds = []) {
  const [companyRows] = await conn.query('SELECT tax_rate,tax_rounding FROM company_invoice_settings WHERE company_id=?', [companyId]);
  if (companyRows[0]?.tax_rate != null) {
    return { rate:Number(companyRows[0].tax_rate), mode:companyRows[0].tax_rounding || 'floor' };
  }
  const ids = [...new Set(projectIds.map(Number).filter(Boolean))];
  let projectRows = [];
  if (ids.length) {
    [projectRows] = await conn.query(
      `SELECT project_id,tax_rate,tax_rounding FROM project_invoice_settings
       WHERE project_id IN (${ids.map(() => '?').join(',')})`, ids
    );
  }
  const [systemRows] = await conn.query("SELECT setting_value FROM system_settings WHERE setting_key='default_tax_rate' AND is_deleted=0 LIMIT 1");
  const configuredSystemRate = Number(systemRows[0]?.setting_value);
  const systemRate = Number.isFinite(configuredSystemRate) ? configuredSystemRate : SYSTEM_TAX_RATE;
  const byProject = new Map(projectRows.map((row) => [Number(row.project_id), row]));
  const resolvedRates = [...new Set(ids.map((projectId) => {
    const value = byProject.get(projectId)?.tax_rate;
    return value == null ? systemRate : Number(value);
  }))];
  const resolvedModes = [...new Set(ids.map((projectId) => byProject.get(projectId)?.tax_rounding || 'floor'))];
  if (resolvedRates.length > 1 || resolvedModes.length > 1) {
    throw new Error('複数案件の税率または端数処理が異なります。請求先設定を登録してください');
  }
  return { rate:resolvedRates[0] ?? systemRate,mode:resolvedModes[0] || 'floor' };
}

module.exports = { SYSTEM_TAX_RATE,resolveInvoiceTax };
