'use strict';
// Read-only fingerprints; no business values are emitted.
const fs = require('node:fs');
const crypto = require('node:crypto');
const { getPool } = require(process.env.FEE_APP_ROOT || '/app/backend/src/db');
const object = (v) => typeof v === 'string' ? JSON.parse(v) : v;
const canonical = (v) => Array.isArray(v) ? v.map(canonical) : v && typeof v === 'object' ? Object.fromEntries(Object.keys(v).sort().map((k) => [k,canonical(v[k])])) : v;
const digest = (rows) => crypto.createHash('sha256').update(rows.map((r) => JSON.stringify(canonical(r))).sort().join('\n')).digest('hex');
async function main() {
  const pool = getPool();
  const conn = await pool.getConnection();
  const result = { hashes:{},counts:{},groups:{},review_status:{} };
  try {
    await conn.query('SET TRANSACTION READ ONLY');
    await conn.query('START TRANSACTION WITH CONSISTENT SNAPSHOT');
    for (const table of ['companies','partners','base_projects','projects','company_billings','price_sets','price_set_lines','price_series','daily_reports','invoices','payments','settlement_lines','settlement_projects','settlement_workflows','daily_report_distance_monthly_results']) {
      const [rows] = await conn.query(`SELECT * FROM \`${table}\``);
      const normalized = rows.map((original) => {
        const row = { ...original };
        if (table === 'company_billings') delete row.billing_name;
        if (table === 'price_sets') {
          delete row.version; delete row.updated_at;
          row.extra_data = object(row.extra_data);
          const extra = row.extra_data;
          if (!row.is_deleted) {
            const status = extra?.legacy_analysis?.calculation_status || 'ordinary';
            result.review_status[status] = (result.review_status[status] || 0)+1;
          }
          for (const item of extra?.fee_items || []) {
            if (!row.is_deleted) result.groups[item.logic_group_code || 'unbound'] = (result.groups[item.logic_group_code || 'unbound'] || 0)+1;
            delete item.logic_group_code;
          }
        }
        return row;
      });
      result.hashes[table] = digest(normalized);
      result.counts[table] = rows.length;
    }
    const [migrations] = await conn.query('SELECT filename FROM schema_migrations ORDER BY filename');
    result.migrations = migrations.map((r) => r.filename);
    await conn.commit();
    if (process.argv[2]) {
      const before = JSON.parse(fs.readFileSync(process.argv[2],'utf8').replace(/^\uFEFF/,''));
      result.mismatches = Object.keys(before.hashes).filter((key) => before.hashes[key] !== result.hashes[key]);
      if (result.mismatches.length) process.exitCode=1;
    }
    console.log(JSON.stringify(result));
  } finally { conn.release(); await pool.end(); }
}
main().catch((error) => { console.error(error.stack); process.exitCode=1; });
