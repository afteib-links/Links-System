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
        p.company_id,p.partner_id,p.base_project_id,
        DATE_FORMAT(p.operation_start_date,'%Y-%m-%d') AS operation_start_date
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
    const lifecycle = {};
    if (source.operation_start_date) lifecycle.operationStartDate = source.operation_start_date;
    return { code: row.code, name: row.name, companyCode, partnerCode, baseCode, ...lifecycle };
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

async function loadRegisteredBindings(runQuery, config) {
  const rows = await runQuery(`SELECT m.mapping_id,m.record_id,b.template_name AS name,
      p.company_id,p.partner_id,p.base_project_id,
      DATE_FORMAT(p.operation_start_date,'%Y-%m-%d') AS project_start,
      DATE_FORMAT(b.operation_start_date,'%Y-%m-%d') AS base_start,
      DATE_FORMAT(b.operation_end_date,'%Y-%m-%d') AS base_end,
      DATE_FORMAT(pt.work_start_date,'%Y-%m-%d') AS partner_start,
      DATE_FORMAT(pt.operation_end_date,'%Y-%m-%d') AS partner_end,
      DATE_FORMAT(c.contract_date,'%Y-%m-%d') AS company_start,
      DATE_FORMAT(c.operation_end_date,'%Y-%m-%d') AS company_end
    FROM master_data_import_mappings m
    JOIN projects p ON p.project_id=m.record_id AND p.is_deleted=0
    LEFT JOIN base_projects b ON b.base_project_id=p.base_project_id AND b.is_deleted=0
    LEFT JOIN partners pt ON pt.partner_id=p.partner_id AND pt.is_deleted=0
    LEFT JOIN companies c ON c.company_id=p.company_id AND c.is_deleted=0
    WHERE m.entity_type='project' ORDER BY m.mapping_id`);
  const companies = await runQuery(`SELECT m.record_id,c.company_name AS name
    FROM master_data_import_mappings m JOIN companies c ON c.company_id=m.record_id AND c.is_deleted=0
    WHERE m.entity_type='company' ORDER BY m.mapping_id`);
  const partners = await runQuery(`SELECT m.record_id,p.partner_name AS name
    FROM master_data_import_mappings m JOIN partners p ON p.partner_id=m.record_id AND p.is_deleted=0
    WHERE m.entity_type='partner' ORDER BY m.mapping_id`);
  const bases = await runQuery(`SELECT m.record_id,b.template_name AS name
    FROM master_data_import_mappings m JOIN base_projects b ON b.base_project_id=m.record_id AND b.is_deleted=0
    WHERE m.entity_type='base_project' ORDER BY m.mapping_id`);
  const codeMaps = {
    company: new Map(companies.map((row, i) => [Number(row.record_id), numbered('C', i)])),
    partner: new Map(partners.map((row, i) => [Number(row.record_id), numbered('P', i)])),
    base: new Map(bases.map((row, i) => [Number(row.record_id), numbered('B', i)])),
  };
  const expected = new Map((config.catalog?.projects || []).map(row => [row.code, row]));
  const bindings = new Map();
  rows.forEach((row, i) => {
    const code = numbered('J', i), catalogRow = expected.get(code);
    const actual = {
      code, name: String(row.name || ''), companyCode: codeMaps.company.get(Number(row.company_id)),
      partnerCode: codeMaps.partner.get(Number(row.partner_id)), baseCode: codeMaps.base.get(Number(row.base_project_id)),
      operationStartDate:row.project_start || '',
    };
    const lifecycleChanged = catalogRow && Object.hasOwn(catalogRow,'operationStartDate')
      && catalogRow.operationStartDate !== actual.operationStartDate;
    if (!catalogRow || lifecycleChanged || ['name','companyCode','partnerCode','baseCode'].some(key => catalogRow[key] !== actual[key])) {
      throw new Error(`${code}の登録済みマスターが承認時から変更されています。サンプルを作り直してください`);
    }
    const starts = [row.project_start,row.base_start,row.partner_start,row.company_start].filter(Boolean).sort();
    const ends = [row.base_end,row.partner_end,row.company_end].filter(Boolean).sort();
    bindings.set(code, { projectId:Number(row.record_id), companyId:Number(row.company_id), partnerId:Number(row.partner_id),
      availableStart:starts.at(-1) || null, availableEnd:ends[0] || null });
  });
  if (bindings.size !== expected.size) throw new Error('承認済み案件数と現在の登録済み案件数が一致しません');
  return bindings;
}

module.exports = { loadRegisteredCatalog, loadRegisteredBindings, numbered, uniqueRecordMap };
