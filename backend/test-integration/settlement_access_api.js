const assert = require('node:assert/strict');
const bcrypt = require('bcryptjs');
const { createApp } = require('../src/server');
const { getPool } = require('../src/db');

const PASSWORD = 'uat-settlement-password';
const LOGIN_PREFIX = 'uat-settlement-';

async function listen(app) {
  return new Promise((resolve, reject) => {
    const server = app.listen(0, '127.0.0.1', () => resolve(server));
    server.once('error', reject);
  });
}

async function close(server) {
  if (!server) return;
  if (typeof server.closeAllConnections === 'function') server.closeAllConnections();
  await new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
}

async function api(baseUrl, cookie, route, options = {}) {
  const headers = { connection: 'close', ...(options.headers || {}) };
  if (options.body != null) headers['content-type'] = 'application/json';
  if (cookie) headers.cookie = cookie;
  const response = await fetch(`${baseUrl}${route}`, { ...options, headers });
  const contentType = response.headers.get('content-type') || '';
  const data = contentType.includes('application/json') ? await response.json() : await response.arrayBuffer();
  return { response, data, cookie: response.headers.get('set-cookie')?.split(';', 1)[0] || cookie };
}

async function login(baseUrl, loginId) {
  const result = await api(baseUrl, '', '/api/auth/login', {
    method: 'POST',
    body: JSON.stringify({ login_id: loginId, password: PASSWORD }),
  });
  assert.equal(result.response.status, 200, `${loginId} login`);
  return result.cookie;
}

async function main() {
  const pool = getPool();
  let server;
  const createdUserIds = [];
  try {
    const [invoices] = await pool.query(
      `SELECT invoice_id, company_id FROM invoices
       WHERE JSON_UNQUOTE(JSON_EXTRACT(extra_data, '$.seed_key'))='verification-data-2026-v2'
       ORDER BY invoice_id LIMIT 2`
    );
    const [payments] = await pool.query(
      `SELECT payment_id, partner_id FROM payments
       WHERE JSON_UNQUOTE(JSON_EXTRACT(extra_data, '$.seed_key'))='verification-data-2026-v2'
       ORDER BY payment_id LIMIT 2`
    );
    assert.equal(invoices.length, 2, '匿名検証用請求が2件必要です');
    assert.equal(payments.length, 2, '匿名検証用支払が2件必要です');

    const passwordHash = await bcrypt.hash(PASSWORD, 4);
    const users = [
      ['admin', null, null], ['soumu', null, null], ['executive', null, null],
      ['sales', null, null], ['company', invoices[0].company_id, null],
      ['partner', null, payments[0].partner_id],
    ];
    const loginIds = {};
    for (const [role, companyId, partnerId] of users) {
      const loginId = `${LOGIN_PREFIX}${role}`;
      loginIds[role] = loginId;
      await pool.query('DELETE FROM users WHERE login_id=?', [loginId]);
      const [created] = await pool.query(
        `INSERT INTO users
          (login_id,password_hash,display_name,role,roles,is_active,permissions,departments,areas,company_id,partner_id,extra_data)
         VALUES (?,?,?, ?,?,1,JSON_ARRAY(),JSON_ARRAY(),JSON_ARRAY(),?,?,?)`,
        [loginId, passwordHash, `UAT ${role}`, role === 'admin' ? 'admin' : 'staff', JSON.stringify([role]), companyId, partnerId, JSON.stringify({ test_key: 'settlement-access-uat' })]
      );
      createdUserIds.push(Number(created.insertId));
    }

    const salesId = createdUserIds[3];
    const [reviewProjects] = await pool.query(
      `SELECT DISTINCT project_id FROM settlement_lines
       WHERE project_id IS NOT NULL AND (
         (settlement_type='invoice' AND settlement_id=?) OR
         (settlement_type='payment' AND settlement_id=?))`,
      [invoices[0].invoice_id, payments[0].payment_id]
    );
    for (const row of reviewProjects) {
      await pool.query('INSERT IGNORE INTO project_settlement_reviewers (project_id,user_id) VALUES (?,?)', [row.project_id, salesId]);
    }

    const app = await createApp();
    server = await listen(app);
    const baseUrl = `http://127.0.0.1:${server.address().port}`;
    const cookies = {};
    for (const [role] of users) cookies[role] = await login(baseUrl, loginIds[role]);

    for (const role of ['admin', 'soumu', 'executive']) {
      const invoiceList = await api(baseUrl, cookies[role], '/api/invoices?target_year_month=2026-05');
      const paymentList = await api(baseUrl, cookies[role], '/api/payments?target_year_month=2026-05');
      const documents = await api(baseUrl, cookies[role], '/api/settlements/documents');
      assert.equal(invoiceList.response.status, 200, `${role} invoice list`);
      assert.equal(paymentList.response.status, 200, `${role} payment list`);
      assert.equal(documents.response.status, 200, `${role} document list`);
      assert.ok(invoiceList.data.invoices.length >= 2);
      assert.ok(paymentList.data.payments.length >= 2);
      assert.ok(documents.data.documents.length >= 5);
    }

    const companyInvoices = await api(baseUrl, cookies.company, '/api/invoices?target_year_month=2026-05');
    assert.equal(companyInvoices.response.status, 200);
    assert.deepEqual([...new Set(companyInvoices.data.invoices.map((row) => Number(row.company_id)))], [Number(invoices[0].company_id)]);
    assert.equal((await api(baseUrl, cookies.company, `/api/settlements/invoice/${invoices[0].invoice_id}`)).response.status, 200);
    assert.equal((await api(baseUrl, cookies.company, `/api/settlements/invoice/${invoices[1].invoice_id}`)).response.status, 403);
    assert.equal((await api(baseUrl, cookies.company, '/api/payments?target_year_month=2026-05')).response.status, 403);

    const companyDocuments = await api(baseUrl, cookies.company, '/api/settlements/documents');
    assert.ok(companyDocuments.data.documents.length >= 1);
    assert.ok(companyDocuments.data.documents.every((row) => row.settlement_type === 'invoice'));
    const companyPdf = await api(baseUrl, cookies.company, `/api/settlements/documents/${companyDocuments.data.documents[0].settlement_document_id}/download`);
    assert.equal(companyPdf.response.status, 200);
    assert.match(companyPdf.response.headers.get('content-type') || '', /application\/pdf/);

    const partnerPayments = await api(baseUrl, cookies.partner, '/api/payments?target_year_month=2026-05');
    assert.equal(partnerPayments.response.status, 200);
    assert.deepEqual([...new Set(partnerPayments.data.payments.map((row) => Number(row.partner_id)))], [Number(payments[0].partner_id)]);
    assert.equal((await api(baseUrl, cookies.partner, `/api/settlements/payment/${payments[0].payment_id}`)).response.status, 200);
    assert.equal((await api(baseUrl, cookies.partner, `/api/settlements/payment/${payments[1].payment_id}`)).response.status, 403);
    assert.equal((await api(baseUrl, cookies.partner, '/api/invoices?target_year_month=2026-05')).response.status, 403);
    assert.equal((await api(baseUrl, cookies.partner, `/api/settlements/payment/${payments[0].payment_id}/cancel`, { method: 'POST', body: JSON.stringify({ reason: '権限確認' }) })).response.status, 403);

    const partnerDocuments = await api(baseUrl, cookies.partner, '/api/settlements/documents');
    assert.ok(partnerDocuments.data.documents.length >= 1);
    assert.ok(partnerDocuments.data.documents.every((row) => row.settlement_type === 'payment'));
    const partnerPdf = await api(baseUrl, cookies.partner, `/api/settlements/documents/${partnerDocuments.data.documents[0].settlement_document_id}/download`);
    assert.equal(partnerPdf.response.status, 200);
    assert.match(partnerPdf.response.headers.get('content-type') || '', /application\/pdf/);

    const salesInvoices = await api(baseUrl, cookies.sales, '/api/invoices?target_year_month=2026-05');
    const salesPayments = await api(baseUrl, cookies.sales, '/api/payments?target_year_month=2026-05');
    const salesDocuments = await api(baseUrl, cookies.sales, '/api/settlements/documents');
    assert.equal(salesInvoices.response.status, 200);
    assert.equal(salesPayments.response.status, 200);
    assert.equal(salesDocuments.response.status, 200);
    assert.ok(salesInvoices.data.invoices.some((row) => Number(row.invoice_id) === Number(invoices[0].invoice_id)));
    assert.ok(salesPayments.data.payments.some((row) => Number(row.payment_id) === Number(payments[0].payment_id)));
    assert.equal((await api(baseUrl, cookies.sales, `/api/settlements/invoice/${invoices[0].invoice_id}`)).response.status, 200);

    const otherCompanyDoc = (await pool.query(
      `SELECT settlement_document_id FROM settlement_documents
       WHERE settlement_type='invoice' AND settlement_id=? AND status='issued' LIMIT 1`, [invoices[1].invoice_id]
    ))[0][0];
    assert.equal((await api(baseUrl, cookies.company, `/api/settlements/documents/${otherCompanyDoc.settlement_document_id}/download`)).response.status, 403);

    console.log('[integration] settlement role access and PDF authorization verified');
  } finally {
    await close(server);
    if (createdUserIds.length) {
      await pool.query(`DELETE FROM project_settlement_reviewers WHERE user_id IN (${createdUserIds.map(() => '?').join(',')})`, createdUserIds);
      await pool.query(`DELETE FROM users WHERE user_id IN (${createdUserIds.map(() => '?').join(',')})`, createdUserIds);
    }
    await pool.end();
  }
}

main().then(() => process.exit(0)).catch((error) => {
  console.error('[integration] settlement access verification failed', error);
  process.exit(1);
});
