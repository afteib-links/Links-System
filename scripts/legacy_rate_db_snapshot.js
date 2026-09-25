'use strict';
// Read-only inventory. Run inside the application container with node on stdin.
const { getPool } = require('/app/backend/src/db');
async function main() {
  const pool = getPool();
  const snapshot = { generated_at: new Date().toISOString(), tables: {}, schema: {}, counts: {} };
  try {
    const [tables] = await pool.query('SHOW TABLES');
    for (const entry of tables) {
      const table = Object.values(entry)[0];
      const [columns] = await pool.query(`SHOW COLUMNS FROM \`${table}\``);
      snapshot.schema[table] = columns;
      if (columns.some(c => c.Field === 'is_deleted')) {
        const [[count]] = await pool.query(`SELECT COUNT(*) total,SUM(is_deleted=0) active FROM \`${table}\``);
        snapshot.counts[table] = count;
      }
    }
    for (const table of ['companies','partners','base_projects','projects','price_sets','price_set_lines','price_series']) {
      const [rows] = await pool.query(`SELECT * FROM \`${table}\``);
      snapshot.tables[table] = rows;
    }
    for (const [table, fields] of Object.entries({
      daily_reports: 'daily_report_id,project_id,company_id,partner_id,work_date,approval_status,billing_status,payment_status,is_deleted,extra_data,applied_price_set_id',
      invoices: 'invoice_id,company_id,target_year_month,is_deleted,extra_data',
      payments: 'payment_id,partner_id,target_year_month,is_deleted,extra_data',
      settlement_projects: '*',
    })) {
      const available = fields === '*' ? '*' : fields.split(',').filter(f => snapshot.schema[table].some(c => c.Field === f)).join(',');
      const [rows] = await pool.query(`SELECT ${available} FROM \`${table}\``);
      snapshot.tables[table] = rows;
    }
    const [foreignKeys] = await pool.query('SELECT TABLE_NAME,COLUMN_NAME,REFERENCED_TABLE_NAME,REFERENCED_COLUMN_NAME FROM information_schema.KEY_COLUMN_USAGE WHERE TABLE_SCHEMA=DATABASE() AND REFERENCED_TABLE_NAME IS NOT NULL');
    snapshot.foreign_keys = foreignKeys;
    console.log(JSON.stringify(snapshot));
  } finally { await pool.end(); }
}
main().catch(e => { console.error(e.stack); process.exitCode=1; });
