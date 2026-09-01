const assert = require('node:assert/strict');
const { getPool } = require('../src/db');
const { config } = require('../src/config');

const REQUIRED_COLUMNS = [
  'shortage_minutes_billing',
  'shortage_minutes_payment',
  'shortage_amount_billing',
  'shortage_amount_payment',
];

async function main() {
  const pool = getPool();
  try {
    const [columns] = await pool.query(
      `SELECT COLUMN_NAME FROM information_schema.COLUMNS
       WHERE TABLE_SCHEMA = ? AND TABLE_NAME = 'daily_reports'`,
      [config.db.database]
    );
    const names = new Set(columns.map((row) => row.COLUMN_NAME));
    for (const column of REQUIRED_COLUMNS) assert.equal(names.has(column), true, `${column} is missing`);
    const [codes] = await pool.query(
      `SELECT COUNT(*) AS count FROM code_masters
       WHERE category_code = 'price_type' AND code_value = 'shortage'`
    );
    assert.equal(Number(codes[0].count), 1);
    const [migrations] = await pool.query(
      `SELECT COUNT(*) AS count FROM schema_migrations
       WHERE filename = '015_daily_report_shortage.sql'`
    );
    assert.equal(Number(migrations[0].count), 1);
    console.log('[integration] migration 015 schema verified');
  } finally {
    await pool.end();
  }
}

main().catch((error) => {
  console.error('[integration] migration 015 verification failed', error);
  process.exitCode = 1;
});
