const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');
const { createApp } = require('../src/server');
const { getPool } = require('../src/db');

function rateCell(billing, payment) {
  return { billing, payment, lineIds: {} };
}

function feeMatrix() {
  return {
    daily: {
      basic: rateCell(20000, 15000),
      shortage: rateCell('', ''),
      overtime: rateCell('', ''),
      night: rateCell('', ''),
      night_overtime: rateCell('', ''),
    },
    hourly: {
      basic: rateCell('', ''),
      shortage: rateCell(1200, 900),
      overtime: rateCell(2000, 1500),
      night: rateCell(2500, 2000),
      night_overtime: rateCell(3000, 2500),
    },
  };
}

function buildPriceExtra(split = false) {
  const billing = {
    periods: [{ start: '22:00', end: '29:00' }],
    night_mode: 'separate',
    night_overtime_mode: 'separate',
  };
  const payment = split
    ? { ...billing, periods: [{ start: '23:00', end: '30:00' }] }
    : JSON.parse(JSON.stringify(billing));
  const specialMatrix = feeMatrix();
  specialMatrix.daily.basic = rateCell(30000, 22000);
  return {
    fee_items: [
      {
        id: 'e2e-normal',
        name: 'E2E通常料金',
        mode: 'weekdays',
        weekdays: { all: true },
        matrix: feeMatrix(),
      },
      {
        id: 'e2e-special',
        name: 'E2E特別料金',
        mode: 'weekdays',
        weekdays: { all: true },
        matrix: specialMatrix,
      },
    ],
    night_rules: { billing, payment },
    rounding: {
      billing: { time_unit_minutes: 15, time_mode: 'floor', amount_mode: 'floor', amount_stage: 'detail' },
      payment: { time_unit_minutes: 15, time_mode: 'floor', amount_mode: 'floor', amount_stage: 'detail' },
    },
    work_rules: {
      billing: { standard_minutes: 480 },
      payment: { standard_minutes: 540 },
    },
  };
}

async function listen(app) {
  return new Promise((resolve, reject) => {
    const server = app.listen(0, '127.0.0.1', () => resolve(server));
    server.once('error', reject);
  });
}

async function close(server) {
  if (!server) return;
  if (typeof server.closeAllConnections === 'function') server.closeAllConnections();
  await new Promise((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
}

async function seed(pool, yearMonth) {
  const [company] = await pool.execute(
    `INSERT INTO companies (company_name) VALUES ('E2E匿名企業')`
  );
  const [partner] = await pool.execute(
    `INSERT INTO partners (partner_name) VALUES ('E2E匿名パートナー')`
  );
  const [project] = await pool.execute(
    `INSERT INTO projects
      (company_id, partner_id, manager_name, business_type, execution_time_start, execution_time_end, break_time)
     VALUES (?, ?, 'E2E担当', '日報画面E2E', '08:00:00', '17:00:00', 1)`,
    [company.insertId, partner.insertId]
  );
  const [priceSet] = await pool.execute(
    `INSERT INTO price_sets
      (price_set_no, price_set_name, company_id, project_id, apply_start_date, extra_data)
     VALUES ('PS-E2E-001', 'E2E料金設定', ?, ?, ?, ?)`,
    [
      company.insertId,
      project.insertId,
      `${yearMonth}-01`,
      JSON.stringify(buildPriceExtra(false)),
    ]
  );
  await pool.execute(
    `INSERT INTO holidays (holiday_date, holiday_name, project_id)
     VALUES (?, 'E2E案件独自休日', ?)`,
    [`${yearMonth}-01`, project.insertId]
  );
  return {
    companyId: Number(company.insertId),
    partnerId: Number(partner.insertId),
    projectId: Number(project.insertId),
    priceSetId: Number(priceSet.insertId),
  };
}

async function main() {
  const pool = getPool();
  let server;
  let browser;
  let page;
  const now = new Date();
  const yearMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  const workDate = `${yearMonth}-01`;
  const screenshotDir = path.resolve(__dirname, '../test-results');
  const screenshotPath = path.join(screenshotDir, 'daily-report-ui.png');
  const holidayScreenshotPath = path.join(screenshotDir, 'daily-report-holiday-detail.png');

  try {
    const ids = await seed(pool, yearMonth);
    const app = await createApp();
    server = await listen(app);
    const baseUrl = `http://127.0.0.1:${server.address().port}`;
    browser = await chromium.launch({ headless: true });
    const context = await browser.newContext({
      timezoneId: 'Asia/Tokyo',
      viewport: { width: 1800, height: 1100 },
    });
    page = await context.newPage();

    async function openDailyReport() {
      await page.locator('.dashboard-card[data-feature="daily_reports"]').click();
      await page.locator(`[data-input="${ids.projectId}"]`).click();
      await page.locator('.dr-month-table').waitFor();
    }

    async function dateRows() {
      return page.locator(`tr.dr-main[data-work-date="${workDate}"]`);
    }

    await page.goto(baseUrl);
    await page.locator('#login_id').fill(process.env.ADMIN_LOGIN_ID || 'ci-admin');
    await page.locator('#password').fill(process.env.ADMIN_PASSWORD || 'ci-admin-password');
    await page.locator('#login-form button[type="submit"]').click();
    await page.locator('.dashboard-card[data-feature="daily_reports"]').waitFor();

    const created = await page.evaluate(async ({ ids: seedIds, workDate: date, yearMonth: ym }) => {
      const payloads = [
        { start_time: '20:00', end_time: '24:00', row_comment: '前半作業' },
        { start_time: '24:00', end_time: '28:00', row_comment: '後半作業' },
      ];
      const results = [];
      for (const work of payloads) {
        const response = await fetch('/api/daily-reports', {
          method: 'POST',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            project_id: seedIds.projectId,
            company_id: seedIds.companyId,
            partner_id: seedIds.partnerId,
            target_year_month: ym,
            work_date: date,
            break_minutes: 60,
            ...work,
          }),
        });
        results.push({ status: response.status, body: await response.json() });
      }
      return results;
    }, { ids, workDate, yearMonth });
    assert.deepEqual(created.map((item) => item.status), [201, 201]);
    assert.equal(created[0].body.report.shortage_minutes_billing, 300);
    assert.equal(created[0].body.report.shortage_minutes_payment, 360);
    assert.equal(Number(created[0].body.report.shortage_amount_billing), -6000);
    assert.equal(Number(created[0].body.report.shortage_amount_payment), -5400);

    await openDailyReport();
    assert.equal(await (await dateRows()).count(), 2, '同日の2作業行が表示されること');
    assert.match(
      await (await dateRows()).first().getAttribute('class'),
      /dr-holiday-row/,
      '祝日マスターの日付は日祝色の行として表示すること'
    );

    let firstRow = (await dateRows()).first();
    await firstRow.locator('[data-expand]').click();
    let detail = page.locator('tr.dr-expand').first();
    await detail.locator('[data-common-minutes="night_break"]').waitFor();
    await detail.getByText(/休日判定: E2E案件独自休日（案件独自）/).waitFor();
    assert.match(
      await detail.locator('[data-fee-item] option:checked').textContent(),
      /自動: E2E通常料金/,
      '自動選択された料金名を料金名欄に表示すること'
    );
    await detail.getByText(/不足 5:00 \/ ¥-6,000/).waitFor();
    await detail.getByText(/不足 6:00 \/ ¥-5,400/).waitFor();
    const previewResponse = page.waitForResponse(
      (response) => response.url().includes('/api/daily-reports/preview') && response.status() === 200
    );
    await detail.locator('[data-fee-item]').selectOption('e2e-special');
    await previewResponse;
    detail = page.locator('tr.dr-expand').first();
    assert.equal(
      await detail.locator('[data-rate-side="billing"][data-rate-type="basic"]').getAttribute('placeholder'),
      '30000',
      '料金種類の変更直後に新しい契約単価へ再計算すること'
    );
    fs.mkdirSync(screenshotDir, { recursive: true });
    await page.screenshot({ path: holidayScreenshotPath, fullPage: true });
    assert.equal(
      await detail.locator('[data-common-minutes="night_break"]').count(),
      1,
      '請求・支払条件が同じ場合は共通入力を表示すること'
    );

    const billingBasic = detail.locator('[data-rate-side="billing"][data-rate-type="basic"]');
    await billingBasic.fill('21000');
    const missingReasonDialog = page.waitForEvent('dialog');
    await detail.locator('[data-save-row]').click();
    const missingReason = await missingReasonDialog;
    assert.match(missingReason.message(), /変更理由/);
    await missingReason.accept();

    await detail.locator('[data-f="rate_override_reason"]').fill('E2E一時変更');
    const successfulSave = page.waitForResponse(
      (response) => response.url().includes('/api/daily-reports/') &&
        response.request().method() === 'PUT' && response.status() === 200
    );
    await detail.locator('[data-save-row]').click();
    await successfulSave;

    firstRow = (await dateRows()).first();
    const warningDialog = page.waitForEvent('dialog');
    await firstRow.locator('[data-day-status="confirmed"]').click();
    const warning = await warningDialog;
    assert.match(warning.message(), /深夜帯内休憩時間が0:00/);
    await warning.accept();
    await page.locator('.status-confirmed').first().waitFor();
    await page.locator('tr.dr-expand').first().waitFor();
    assert.equal(await (await dateRows()).count(), 2);
    assert.equal(
      await (await dateRows()).first().locator('[data-f="start_time"]').isDisabled(),
      true,
      '日次確認後は計算項目をロックすること'
    );

    firstRow = (await dateRows()).first();
    await firstRow.locator('[data-day-status="draft"]').click();
    await page.locator('.status-draft').first().waitFor();
    await page.locator('tr.dr-expand').first().waitFor();
    firstRow = (await dateRows()).first();
    await firstRow.locator('[data-add-work]').click();
    assert.equal(await (await dateRows()).count(), 3, '同日に作業行を追加できること');
    const addedRow = (await dateRows()).nth(2);
    await addedRow.locator('[data-f="start_time"]').fill('8.00');
    await addedRow.locator('[data-f="start_time"]').blur();
    assert.equal(await addedRow.locator('[data-f="start_time"]').inputValue(), '08:00');
    await addedRow.locator('[data-default-time="start_time"]').dblclick();
    await addedRow.locator('[data-default-time="end_time"]').dblclick();
    await addedRow.locator('[data-default-time="break_minutes"]').dblclick();
    assert.equal(await addedRow.locator('[data-f="start_time"]').inputValue(), '08:00');
    assert.equal(await addedRow.locator('[data-f="end_time"]').inputValue(), '17:00');
    assert.equal(await addedRow.locator('[data-minutes-f="break_minutes"]').inputValue(), '1:00');
    await addedRow.locator('[data-time-step="start_time"][data-direction="1"]').click();
    assert.equal(await addedRow.locator('[data-f="start_time"]').inputValue(), '08:15');
    assert.equal(await addedRow.locator('[data-f="total_distance"]').getAttribute('step'), '1');
    assert.equal(await addedRow.locator('[data-f="toll_fee"]').getAttribute('step'), '100');
    assert.equal(await addedRow.locator('[data-f="parking_fee"]').getAttribute('step'), '100');
    assert.equal(await addedRow.locator('[data-f="transport_fee"]').getAttribute('step'), '100');

    await pool.execute(
      `UPDATE price_sets SET extra_data = ?, version = version + 1 WHERE price_set_id = ?`,
      [JSON.stringify(buildPriceExtra(true)), ids.priceSetId]
    );
    await page.reload();
    await page.locator('.dashboard-card[data-feature="daily_reports"]').waitFor();
    await openDailyReport();
    firstRow = (await dateRows()).first();
    await firstRow.locator('[data-expand]').click();
    detail = page.locator('tr.dr-expand').first();
    await detail.locator('[data-minutes-f="night_break_minutes_billing"]').waitFor();
    await detail.locator('[data-minutes-f="night_break_minutes_payment"]').waitFor();
    assert.equal(await detail.locator('[data-minutes-f="night_break_minutes_billing"]').count(), 1);
    assert.equal(await detail.locator('[data-minutes-f="night_break_minutes_payment"]').count(), 1);

    const monthlyWarningDialog = page.waitForEvent('dialog');
    await page.locator('[data-month-action="submit"]').click();
    const monthlyWarning = await monthlyWarningDialog;
    assert.match(monthlyWarning.message(), /日次確認が未完了/);
    await monthlyWarning.dismiss();

    fs.mkdirSync(screenshotDir, { recursive: true });
    await page.screenshot({ path: screenshotPath, fullPage: true });
    console.log(`[e2e] daily report UI verified: ${screenshotPath}`);
  } catch (error) {
    if (page) {
      fs.mkdirSync(screenshotDir, { recursive: true });
      await page.screenshot({ path: screenshotPath, fullPage: true }).catch(() => {});
    }
    throw error;
  } finally {
    if (browser) await browser.close();
    await close(server);
    await pool.end();
  }
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error('[e2e] daily report UI verification failed', error);
    process.exit(1);
  });
