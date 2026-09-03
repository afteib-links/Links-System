const assert = require('node:assert/strict');
const path = require('path');
const { spawnSync } = require('node:child_process');
const { getPool } = require('../src/db');

const SEED_KEY = 'verification-data-2026-v2';
const SENTINEL = 'CI非検証データ保持確認';

async function main() {
  const pool = getPool();
  try {
    await pool.query('DELETE FROM companies WHERE company_name=?', [SENTINEL]);
    const [sentinel] = await pool.query(
      `INSERT INTO companies (company_name,extra_data) VALUES (?,?)`,
      [SENTINEL, JSON.stringify({ test_key: 'must-survive-verification-reset' })]
    );

    const result = spawnSync(process.execPath, [path.join('scripts', 'seed_verification_data.js'), '--reset'], {
      cwd: path.join(__dirname, '..'),
      env: {
        ...process.env,
        NODE_ENV: 'test',
        VERIFICATION_RESET_CONFIRM: 'DELETE_VERIFICATION_DATA',
      },
      encoding: 'utf8',
      timeout: 180000,
    });
    assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);

    const [survivors] = await pool.query('SELECT company_id FROM companies WHERE company_id=? AND company_name=?', [sentinel.insertId, SENTINEL]);
    assert.equal(survivors.length, 1, 'seed_keyを持たない既存企業が削除されてはいけません');

    const [counts] = await pool.query(
      `SELECT
        (SELECT COUNT(*) FROM companies WHERE JSON_UNQUOTE(JSON_EXTRACT(extra_data,'$.seed_key'))=?) companies,
        (SELECT COUNT(*) FROM projects WHERE JSON_UNQUOTE(JSON_EXTRACT(extra_data,'$.seed_key'))=?) projects,
        (SELECT COUNT(*) FROM invoices WHERE JSON_UNQUOTE(JSON_EXTRACT(extra_data,'$.seed_key'))=?) invoices,
        (SELECT COUNT(*) FROM payments WHERE JSON_UNQUOTE(JSON_EXTRACT(extra_data,'$.seed_key'))=?) payments,
        (SELECT COUNT(*) FROM settlement_documents d JOIN invoices i ON d.settlement_type='invoice' AND d.settlement_id=i.invoice_id WHERE JSON_UNQUOTE(JSON_EXTRACT(i.extra_data,'$.seed_key'))=?) +
        (SELECT COUNT(*) FROM settlement_documents d JOIN payments p ON d.settlement_type='payment' AND d.settlement_id=p.payment_id WHERE JSON_UNQUOTE(JSON_EXTRACT(p.extra_data,'$.seed_key'))=?) documents`,
      [SEED_KEY, SEED_KEY, SEED_KEY, SEED_KEY, SEED_KEY, SEED_KEY]
    );
    assert.deepEqual(
      { companies: Number(counts[0].companies), projects: Number(counts[0].projects), invoices: Number(counts[0].invoices), payments: Number(counts[0].payments), documents: Number(counts[0].documents) },
      { companies: 20, projects: 50, invoices: 2, payments: 2, documents: 5 }
    );

    const [types] = await pool.query(
      `SELECT DISTINCT d.document_type
       FROM settlement_documents d
       LEFT JOIN invoices i ON d.settlement_type='invoice' AND d.settlement_id=i.invoice_id
       LEFT JOIN payments p ON d.settlement_type='payment' AND d.settlement_id=p.payment_id
       WHERE COALESCE(JSON_UNQUOTE(JSON_EXTRACT(i.extra_data,'$.seed_key')),JSON_UNQUOTE(JSON_EXTRACT(p.extra_data,'$.seed_key')))=?`,
      [SEED_KEY]
    );
    assert.deepEqual(types.map((row) => row.document_type).sort(), ['invoice', 'invoice_summary', 'payment_statement', 'salary_statement']);
    await pool.query('DELETE FROM companies WHERE company_id=?', [sentinel.insertId]);
    console.log('[integration] verification-only reset preserved non-seed data and restored all scenarios');
  } finally {
    await pool.query('DELETE FROM companies WHERE company_name=?', [SENTINEL]).catch(() => {});
    await pool.end();
  }
}

main().then(() => process.exit(0)).catch((error) => {
  console.error('[integration] verification reset failed', error);
  process.exit(1);
});
