const assert = require('node:assert/strict');
const { getPool } = require('../src/db');
const { config } = require('../src/config');

const REQUIRED_DAILY_REPORT_COLUMNS = [
  'break_minutes',
  'selected_fee_item_id',
  'selected_fee_item_name',
  'fee_item_selection_source',
  'night_break_minutes_billing',
  'night_break_minutes_payment',
  'night_adjustment_minutes_billing',
  'night_adjustment_minutes_payment',
  'night_minutes_billing',
  'night_minutes_payment',
  'night_overtime_minutes_billing',
  'night_overtime_minutes_payment',
  'regular_overtime_minutes_billing',
  'regular_overtime_minutes_payment',
  'rate_overrides',
  'rate_override_reason',
  'calculation_detail',
];

const REQUIRED_TABLES = [
  'daily_report_audit_logs',
  'daily_report_confirmation_snapshots',
  'daily_report_monthly_approvals',
];

async function main() {
  const pool = getPool();
  try {
    const [columns] = await pool.query(
      `SELECT COLUMN_NAME
       FROM information_schema.COLUMNS
       WHERE TABLE_SCHEMA = ? AND TABLE_NAME = 'daily_reports'`,
      [config.db.database]
    );
    const columnNames = new Set(columns.map((row) => row.COLUMN_NAME));
    for (const column of REQUIRED_DAILY_REPORT_COLUMNS) {
      assert.equal(columnNames.has(column), true, `daily_reports.${column} is missing`);
    }

    const [tables] = await pool.query(
      `SELECT TABLE_NAME
       FROM information_schema.TABLES
       WHERE TABLE_SCHEMA = ? AND TABLE_NAME IN (?)`,
      [config.db.database, REQUIRED_TABLES]
    );
    const tableNames = new Set(tables.map((row) => row.TABLE_NAME));
    for (const table of REQUIRED_TABLES) {
      assert.equal(tableNames.has(table), true, `${table} is missing`);
    }

    const [codes] = await pool.query(
      `SELECT COUNT(*) AS count
       FROM code_masters
       WHERE category_code = 'price_type' AND code_value = 'night_overtime'`
    );
    assert.equal(Number(codes[0].count), 1, 'night_overtime code is missing or duplicated');

    const [migrations] = await pool.query(
      `SELECT COUNT(*) AS count
       FROM schema_migrations
       WHERE filename = '013_daily_report_night_calculation.sql'`
    );
    assert.equal(Number(migrations[0].count), 1, 'migration 013 was not recorded exactly once');
    console.log('[integration] migration 013 schema verified');
  } finally {
    await pool.end();
  }
}

main().catch((error) => {
  console.error('[integration] migration 013 verification failed', error);
  process.exitCode = 1;
});
