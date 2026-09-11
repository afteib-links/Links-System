const PREFIXES = {
  companies: 'C',
  partners: 'P',
  baseProjects: 'B',
  projects: 'J',
};

function numbered(prefix, index) {
  return `${prefix}${String(index + 1).padStart(5, '0')}`;
}

function uniqueRecordMap(rows, label) {
  const result = new Map();
  for (const row of rows) {
    const id = Number(row.record_id);
    if (result.has(id)) throw new Error(`${label}の登録履歴が重複しています（record_id=${id}）`);
    result.set(id, row.code);
  }
  return result;
}

async function loadRegisteredCatalog(runQuery) {
  const [companyRows, partnerRows, baseRows, projectRows] = await Promise.all([
    runQuery(`SELECT m.record_id,m.import_key,c.company_name AS name
      FROM master_data_import_mappings m
      JOIN companies c ON c.company_id=m.record_id AND c.is_deleted=0
      WHERE m.entity_type='company' ORDER BY m.mapping_id`),
    runQuery(`SELECT m.record_id,m.import_key,p.partner_name AS name
      FROM master_data_import_mappings m
      JOIN partners p ON p.partner_id=m.record_id AND p.is_deleted=0
      WHERE m.entity_type='partner' ORDER BY m.mapping_id`),
    runQuery(`SELECT m.record_id,m.import_key,b.template_name AS name
      FROM master_data_import_mappings m
      JOIN base_projects b ON b.base_project_id=m.record_id AND b.is_deleted=0
      WHERE m.entity_type='base_project' ORDER BY m.mapping_id`),
    runQuery(`SELECT m.record_id,m.import_key,b.template_name AS name,
        p.company_id,p.partner_id,p.base_project_id
      FROM master_data_import_mappings m
      JOIN projects p ON p.project_id=m.record_id AND p.is_deleted=0
      LEFT JOIN base_projects b ON b.base_project_id=p.base_project_id AND b.is_deleted=0
      WHERE m.entity_type='project' ORDER BY m.mapping_id`),
  ]);
  if (!companyRows.length || !partnerRows.length || !baseRows.length || !projectRows.length) {
    const error = new Error('登録済みマスターが不足しています。先に「マスターデータ取込」で完成Excelを登録してください');
    error.status = 422;
    throw error;
  }

  const prepare = (rows, type) => rows.map((row, index) => ({
    record_id: Number(row.record_id),
    importKey: String(row.import_key),
    code: numbered(PREFIXES[type], index),
    name: String(row.name || '').trim(),
  }));
  const companies = prepare(companyRows, 'companies');
  const partners = prepare(partnerRows, 'partners');
  const baseProjects = prepare(baseRows, 'baseProjects');
  const projectRecords = prepare(projectRows, 'projects');
  const companyCodes = uniqueRecordMap(companies, '企業');
  const partnerCodes = uniqueRecordMap(partners, 'パートナー');
  const baseCodes = uniqueRecordMap(baseProjects, '基本案件');
  const issues = [];
  const projects = projectRecords.map((row, index) => {
    const source = projectRows[index];
    const companyCode = companyCodes.get(Number(source.company_id));
    const partnerCode = partnerCodes.get(Number(source.partner_id));
    const baseCode = baseCodes.get(Number(source.base_project_id));
    if (!companyCode || !partnerCode || !baseCode) {
      issues.push(`${row.code}: 企業・パートナー・基本案件の参照先が登録履歴にありません`);
    }
    return { code: row.code, name: row.name, companyCode, partnerCode, baseCode };
  });
  if (issues.length) {
    const error = new Error(issues.slice(0, 5).join(' / '));
    error.status = 422;
    throw error;
  }
  const publicRows = rows => rows.map(({ code, name }) => ({ code, name }));
  const catalog = {
    companies: publicRows(companies),
    partners: publicRows(partners),
    baseProjects: publicRows(baseProjects),
    projects,
  };
  return {
    catalog,
    counts: Object.fromEntries(Object.entries(catalog).map(([key, rows]) => [key, rows.length])),
    source: 'master_data_import_mappings',
  };
}

module.exports = { loadRegisteredCatalog, numbered, uniqueRecordMap };
