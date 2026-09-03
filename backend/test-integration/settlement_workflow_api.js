const assert = require('node:assert/strict');
const { createApp } = require('../src/server');
const { getPool } = require('../src/db');

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

function parseJson(value) {
  return typeof value === 'string' ? JSON.parse(value) : value;
}

async function main() {
  const pool = getPool();
  let server;
  try {
    const loginId = process.env.ADMIN_LOGIN_ID;
    const password = process.env.ADMIN_PASSWORD;
    assert.ok(loginId && password, 'ADMIN_LOGIN_ID と ADMIN_PASSWORD が必要です');

    const app = await createApp();
    server = await listen(app);
    const baseUrl = `http://127.0.0.1:${server.address().port}`;
    let cookie = '';
    async function request(route, options = {}) {
      const headers = { connection: 'close', ...(options.headers || {}) };
      if (options.body != null) headers['content-type'] = 'application/json';
      if (cookie) headers.cookie = cookie;
      const response = await fetch(`${baseUrl}${route}`, { ...options, headers });
      const setCookie = response.headers.get('set-cookie');
      if (setCookie) cookie = setCookie.split(';', 1)[0];
      const data = await response.json();
      return { response, data };
    }
    const post = (route, body) => request(route, { method: 'POST', body: JSON.stringify(body) });

    const login = await post('/api/auth/login', { login_id: loginId, password });
    assert.equal(login.response.status, 200);

    const [cycles] = await pool.query("SELECT cash_cycle_id FROM cash_cycles WHERE target_year_month='2026-05' AND cycle_code='end' LIMIT 1");
    assert.equal(cycles.length, 1);
    const cashCycleId = Number(cycles[0].cash_cycle_id);

    const invoiceTargets = await request('/api/invoices/targets?target_year_month=2026-05');
    assert.equal(invoiceTargets.response.status, 200);
    assert.ok(invoiceTargets.data.targets.length >= 2);
    const invoiceTarget = invoiceTargets.data.targets[0];
    const setting = await request(`/api/settlements/settings/company/${invoiceTarget.company_id}`, {
      method: 'PUT', body: JSON.stringify({ display_mode: 'project_aggregated', tax_rate: 0.08, tax_rounding: 'ceil' }),
    });
    assert.equal(setting.response.status, 200);
    const invoiceBody = {
      target_year_month: '2026-05', company_id: invoiceTarget.company_id,
      daily_report_ids: invoiceTarget.report_ids, closing_date: invoiceTarget.closing_date || 'end',
      adjustments: [{ item_name: 'UAT調整', amount: -500, reason: '運用受入確認', tax_category: 'taxable' }],
    };
    const invoiceDraft = await post('/api/settlements/invoice/drafts', invoiceBody);
    assert.equal(invoiceDraft.response.status, 201);
    const invoiceId = Number(invoiceDraft.data.settlement_id);
    assert.equal((await post('/api/settlements/invoice/drafts', invoiceBody)).response.status, 400, '同じ日報の二重予約を拒否する');
    const invoiceBefore = await request(`/api/settlements/invoice/${invoiceId}`);
    assert.ok(invoiceBefore.data.lines.every((line) => line.source_type === 'monthly_approval_snapshot' || line.source_type === 'manual_adjustment'));
    assert.equal((await post(`/api/settlements/invoice/${invoiceId}/sales-review`, {})).response.status, 200);
    assert.equal((await post(`/api/settlements/invoice/${invoiceId}/finalize`, { cash_cycle_id: cashCycleId })).response.status, 200);
    const [finalInvoices] = await pool.query('SELECT total_amount,finalized_snapshot FROM invoices WHERE invoice_id=?', [invoiceId]);
    const invoiceSnapshot = parseJson(finalInvoices[0].finalized_snapshot);
    assert.equal(Number(invoiceSnapshot.tax_rate), 0.08);
    assert.equal(invoiceSnapshot.tax_rounding, 'ceil');
    assert.ok(invoiceSnapshot.display_lines.length <= invoiceSnapshot.lines.length);
    const [invoiceDocs] = await pool.query("SELECT document_number FROM settlement_documents WHERE settlement_type='invoice' AND settlement_id=? AND status='issued'", [invoiceId]);
    assert.equal(invoiceDocs.length, 2);
    assert.equal((await post(`/api/settlements/invoice/${invoiceId}/cancel`, { reason: 'UAT未実行取消' })).response.status, 200);
    const [restoredInvoiceReports] = await pool.query(`SELECT DISTINCT billing_status FROM daily_reports WHERE daily_report_id IN (${invoiceTarget.report_ids.map(() => '?').join(',')})`, invoiceTarget.report_ids);
    assert.deepEqual(restoredInvoiceReports.map((row) => row.billing_status), ['none']);

    const paymentTargets = await request('/api/payments/targets?target_year_month=2026-05');
    assert.equal(paymentTargets.response.status, 200);
    assert.ok(paymentTargets.data.targets.length >= 2);
    const zeroTarget = paymentTargets.data.targets[0];
    const [rule] = await pool.query(
      `INSERT INTO settlement_deduction_rules
        (rule_code,scope,partner_id,display_name,amount,tax_category,valid_from,valid_to,is_active)
       VALUES ('uat_zero_transfer','partner',?,'UAT全額控除',100000000,'non_taxable','2026-01-01','2026-12-31',1)`,
      [zeroTarget.partner_id]
    );
    const zeroDraft = await post('/api/settlements/payment/drafts', {
      target_year_month: '2026-05', partner_id: zeroTarget.partner_id,
      daily_report_ids: zeroTarget.report_ids, closing_date: zeroTarget.closing_date || 'end',
    });
    assert.equal(zeroDraft.response.status, 201);
    const zeroPaymentId = Number(zeroDraft.data.settlement_id);
    assert.equal((await post(`/api/settlements/payment/${zeroPaymentId}/sales-review`, {})).response.status, 200);
    const zeroFinal = await post(`/api/settlements/payment/${zeroPaymentId}/finalize`, { cash_cycle_id: cashCycleId });
    assert.equal(zeroFinal.response.status, 200);
    assert.equal(Number(zeroFinal.data.total_amount), 0);
    const [zeroSchedules] = await pool.query("SELECT cash_schedule_id FROM cash_schedules WHERE source_type='payment' AND source_id=?", [zeroPaymentId]);
    assert.equal(zeroSchedules.length, 0);
    const [carry] = await pool.query("SELECT settlement_carry_forward_id,status,remaining_amount FROM settlement_carry_forwards WHERE source_payment_id=? AND item_name='UAT全額控除'", [zeroPaymentId]);
    assert.equal(carry.length, 1);
    assert.ok(Number(carry[0].remaining_amount) > 0);
    assert.equal((await post(`/api/settlements/payment/${zeroPaymentId}/cancel`, { reason: 'UAT 0円取消' })).response.status, 200);
    const [cancelledCarry] = await pool.query('SELECT status FROM settlement_carry_forwards WHERE settlement_carry_forward_id=?', [carry[0].settlement_carry_forward_id]);
    assert.equal(cancelledCarry[0].status, 'cancelled');
    await pool.query('UPDATE settlement_deduction_rules SET is_active=0 WHERE settlement_deduction_rule_id=?', [rule.insertId]);

    const refreshedTargets = await request('/api/payments/targets?target_year_month=2026-05');
    const correctionTarget = refreshedTargets.data.targets.find((target) => Number(target.partner_id) !== Number(zeroTarget.partner_id));
    assert.ok(correctionTarget);
    const paymentDraft = await post('/api/settlements/payment/drafts', {
      target_year_month: '2026-05', partner_id: correctionTarget.partner_id,
      daily_report_ids: correctionTarget.report_ids, closing_date: correctionTarget.closing_date || 'end', issue_salary_statement: true,
    });
    assert.equal(paymentDraft.response.status, 201);
    const paymentId = Number(paymentDraft.data.settlement_id);
    assert.equal((await post(`/api/settlements/payment/${paymentId}/sales-review`, {})).response.status, 200);
    const paymentFinal = await post(`/api/settlements/payment/${paymentId}/finalize`, { cash_cycle_id: cashCycleId });
    assert.equal(paymentFinal.response.status, 200);
    assert.ok(Number(paymentFinal.data.total_amount) > 1000);
    const [paymentSchedules] = await pool.query("SELECT cash_schedule_id,amount FROM cash_schedules WHERE source_type='payment' AND source_id=? AND status='planned'", [paymentId]);
    assert.equal(paymentSchedules.length, 1);
    assert.equal((await post(`/api/cash-management/schedules/${paymentSchedules[0].cash_schedule_id}/transaction`, {
      executed_date: '2026-06-01', executed_amount: Number(paymentSchedules[0].amount), status: 'executed', bank_name: 'UAT銀行',
    })).response.status, 200);
    const blockedCancel = await post(`/api/settlements/payment/${paymentId}/cancel`, { reason: '実行済み取消確認' });
    assert.equal(blockedCancel.response.status, 409);
    assert.equal(blockedCancel.data.error, 'correction_required');

    const correction = await post(`/api/settlements/payment/${paymentId}/corrections`, {
      reason: 'UAT差額訂正', adjustments: [{ item_name: '訂正減額', amount: -1000, reason: 'UAT差額訂正', tax_category: 'non_taxable' }],
    });
    assert.equal(correction.response.status, 201);
    const correctionId = Number(correction.data.settlement_id);
    assert.equal((await post(`/api/settlements/payment/${correctionId}/sales-review`, {})).response.status, 200);
    assert.equal((await post(`/api/settlements/payment/${correctionId}/finalize`, { cash_cycle_id: cashCycleId })).response.status, 200);
    const [adjustments] = await pool.query("SELECT direction,amount FROM cash_schedules WHERE source_type='adjustment' AND source_id=? AND status='planned'", [correctionId]);
    assert.equal(adjustments.length, 1);
    assert.equal(adjustments[0].direction, 'incoming');
    assert.equal(Number(adjustments[0].amount), 1000);
    const [correctionDocs] = await pool.query("SELECT document_number FROM settlement_documents WHERE settlement_type='payment' AND settlement_id=? AND status='issued'", [correctionId]);
    assert.equal(correctionDocs.length, 2);
    assert.ok(!correctionDocs.some((doc) => invoiceDocs.some((invoiceDoc) => invoiceDoc.document_number === doc.document_number)));
    assert.equal((await post(`/api/settlements/payment/${correctionId}/cancel`, { reason: 'UAT訂正予定取消' })).response.status, 200);
    const [originalReportStates] = await pool.query(`SELECT DISTINCT payment_status FROM daily_reports WHERE daily_report_id IN (${correctionTarget.report_ids.map(() => '?').join(',')})`, correctionTarget.report_ids);
    assert.deepEqual(originalReportStates.map((row) => row.payment_status), ['paid']);

    assert.equal((await post('/api/invoices/close', {})).response.status, 410);
    assert.equal((await post('/api/payments/close', {})).response.status, 410);
    console.log('[integration] settlement snapshots, reservations, tax, zero payment, cancellation and correction verified');
  } finally {
    await close(server);
    await pool.end();
  }
}

main().then(() => process.exit(0)).catch((error) => {
  console.error('[integration] settlement workflow verification failed', error);
  process.exit(1);
});
