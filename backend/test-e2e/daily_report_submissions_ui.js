const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const express = require('express');
const { chromium } = require('playwright');

const outputDir = path.resolve(__dirname, '../test-results/daily-report-submissions');
const groups = [
  { group_code: 'early', number: 1, label: '5日・10日締め' },
  { group_code: 'middle', number: 2, label: '15日・20日締め' },
  { group_code: 'late', number: 3, label: '25日・末日締め' },
];

function cycle(group, index, project) {
  const closing = project.closing_date;
  const five = ['5', '15', '25'].includes(closing);
  const periods = five
    ? [['2026-08-26', '2026-09-05'], ['2026-09-06', '2026-09-15'], ['2026-09-16', '2026-09-25']]
    : [['2026-09-01', '2026-09-10'], ['2026-09-11', '2026-09-20'], ['2026-09-21', '2026-09-30']];
  const planned = ['2026-09-06', '2026-09-16', '2026-09-26'];
  const tenPlanned = ['2026-09-11', '2026-09-21', '2026-10-01'];
  const states = project.states[index];
  return {
    ...group,
    period_start: periods[index][0],
    period_end: periods[index][1],
    planned_submit_date: five ? planned[index] : tenPlanned[index],
    deadline_date: five ? planned[index] : tenPlanned[index],
    is_submitted: states.submitted,
    submitted_date: states.date,
    overdue_days: states.overdue,
    version: 0,
  };
}

const projectDefs = [
  { project_id: 101, project_name: '定期便A', company_name: '東洋建設株式会社', partner_name: '佐藤', closing_date: '10', states: [{ submitted: true, date: '2026-09-11', overdue: 0 }, { submitted: true, date: '2026-09-23', overdue: 1 }, { submitted: false, date: null, overdue: 0 }] },
  { project_id: 102, project_name: '配送B', company_name: '東都運送株式会社', partner_name: '山田太郎', closing_date: '5', states: [{ submitted: false, date: null, overdue: 3 }, { submitted: true, date: '2026-09-16', overdue: 0 }, { submitted: false, date: null, overdue: 0 }] },
  { project_id: 103, project_name: 'スポットC', company_name: '南港物流株式会社', partner_name: '高橋', closing_date: 'end', states: [{ submitted: false, date: null, overdue: 0 }, { submitted: false, date: null, overdue: 0 }, { submitted: false, date: null, overdue: 0 }] },
];

const projects = projectDefs.map((project) => {
  const cycles = groups.map((group, index) => cycle(group, index, project));
  return {
    ...project,
    company_id: 1,
    partner_id: project.partner_name === '-' ? null : 10,
    cycles,
    totals: {
      submitted_count: cycles.filter((row) => row.is_submitted).length,
      overdue_count: cycles.filter((row) => row.overdue_days > 0).length,
      overdue_days: cycles.reduce((sum, row) => sum + row.overdue_days, 0),
    },
  };
});

const summary = {
  project_count: projects.length,
  submitted_count: 3,
  unsubmitted_count: 6,
  overdue_count: 2,
  overdue_days: 4,
  cycles: groups.map((group) => ({ group_code: group.group_code, submitted_count: 1, unsubmitted_count: 2, overdue_count: 1, overdue_days: 2 })),
};

async function main() {
  await fs.mkdir(outputDir, { recursive: true });
  const app = express();
  app.use(express.static(path.resolve(__dirname, '../../frontend')));
  app.get('*', (_req, res) => res.sendFile(path.resolve(__dirname, '../../frontend/index.html')));
  const server = app.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  const browser = await chromium.launch({
    headless: true,
    ...(process.env.PLAYWRIGHT_EXECUTABLE_PATH ? { executablePath: process.env.PLAYWRIGHT_EXECUTABLE_PATH } : {}),
  });
  try {
    for (const viewport of [{ width: 1920, height: 1080 }, { width: 1366, height: 768 }, { width: 430, height: 932 }]) {
      const page = await browser.newPage({ viewport });
      await page.route('**/api/**', async (route) => {
        const url = new URL(route.request().url());
        let body = { ok: true };
        if (url.pathname === '/api/auth/me') {
          body = {
            ok: true,
            user: { user_id: 1, display_name: '管理者', roles: ['admin'], permissions: ['daily_report_submissions'] },
            features: [{ key: 'daily_report_submissions', label: '日報提出', group: 'daily' }],
            roles: [{ key: 'admin', label: '管理者' }],
          };
        } else if (url.pathname === '/api/dashboard/summary') body = { ok: true, cards: [] };
        else if (url.pathname === '/api/lookups/companies') body = { ok: true, companies: [{ company_id: 1, company_name: '東洋建設株式会社' }] };
        else if (url.pathname === '/api/lookups/partners') body = { ok: true, partners: [{ partner_id: 10, partner_name: '佐藤' }, { partner_id: 11, partner_name: '山田太郎' }] };
        else if (url.pathname === '/api/daily-report-submissions/matrix') {
          body = {
            ok: true,
            target_year_month: '2026-09',
            grace_days: 1,
            today: '2026-09-15',
            groups,
            projects,
            visible_project_count: projects.length,
            summary,
          };
        } else if (url.pathname.startsWith('/api/daily-report-submissions/cycles/') && route.request().method() === 'PUT') {
          body = { ok: true, cycle: projects[2].cycles[0] };
        }
        await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
      });
      await page.goto(baseUrl, { waitUntil: 'networkidle' });
      if (viewport.width <= 760) await page.locator('#sidebar-toggle').click();
      await page.locator('[data-nav-feature="daily_report_submissions"]').click();
      await page.locator('.submission-matrix').waitFor();
      const layout = await page.evaluate(() => {
        const wrap = document.querySelector('.submission-matrix-wrap');
        return {
          doc: document.documentElement.scrollWidth,
          client: document.documentElement.clientWidth,
          matrix: document.querySelector('.submission-matrix').scrollWidth,
          wrap: wrap.clientWidth,
          stickyLeft: getComputedStyle(document.querySelector('.submission-project-cell')).position,
          stickyRight: getComputedStyle(document.querySelector('.submission-project-total')).position,
          grace: document.querySelector('.submission-grace')?.textContent.trim(),
          planned: document.querySelector('.submission-planned')?.textContent.includes('予定'),
          heading: document.querySelector('.submission-project-heading')?.textContent.trim(),
          partner: document.querySelector('.submission-partner-name')?.textContent.trim(),
          company: document.querySelector('.submission-company')?.textContent.trim(),
          monthTotalTop: Boolean(document.querySelector('thead .submission-month-total')),
          hasFooter: Boolean(document.querySelector('.submission-matrix tfoot')),
          statusHeading: document.querySelector('.submission-status-heading')?.textContent.trim(),
          hidden: document.body.innerText.includes('不要'),
          overdue: Array.from(document.querySelectorAll('[data-overdue-days]')).map((node) => node.value),
        };
      });
      assert.ok(layout.doc <= layout.client + 1, `${viewport.width}pxでページ全体を横スクロールさせない`);
      assert.equal(layout.stickyLeft, 'sticky');
      if (viewport.width > 760) assert.equal(layout.stickyRight, 'sticky');
      assert.equal(layout.grace, '猶予 1日');
      assert.equal(layout.planned, true);
      assert.equal(layout.heading, '案件情報');
      assert.equal(layout.partner, '佐藤');
      assert.equal(layout.company, '東洋建設株式会社');
      assert.equal(layout.monthTotalTop, true);
      assert.equal(layout.hasFooter, false);
      assert.equal(layout.statusHeading, '提出状態');
      assert.equal(layout.hidden, false);
      assert.ok(layout.overdue.includes('1'));
      assert.ok(layout.overdue.includes('3'));
      const stacked = await page.evaluate(() => {
        const date = document.querySelector('[data-submitted-date]')?.getBoundingClientRect();
        const overdue = document.querySelector('[data-overdue-days]')?.getBoundingClientRect();
        return Boolean(date && overdue && overdue.top >= date.bottom - 1);
      });
      assert.equal(stacked, true, '遅延日数は提出日の下段へ改行する');
      if (viewport.width === 1920) {
        const dateInput = page.locator('[data-project-id="103"] [data-cycle="early"] [data-submitted-date]');
        assert.equal(await dateInput.inputValue(), '');
        const saveRequest = page.waitForRequest((request) => request.method() === 'PUT' && request.url().includes('/api/daily-report-submissions/cycles/103/early'));
        await page.locator('[data-project-id="103"] [data-cycle="early"] [data-submitted]').click();
        const payload = (await saveRequest).postDataJSON();
        assert.equal(payload.is_submitted, true);
        assert.equal(payload.overdue_days, null);
        assert.match(payload.submitted_date, /^\d{4}-\d{2}-\d{2}$/);
        await page.getByText('提出済みに更新しました').waitFor();
        const overdueInput = page.locator('[data-project-id="101"] [data-cycle="middle"] [data-overdue-days]');
        assert.equal(await overdueInput.inputValue(), '1');
        const overdueSave = page.waitForRequest((request) => request.method() === 'PUT' && request.url().includes('/api/daily-report-submissions/cycles/101/middle'));
        await overdueInput.fill('5');
        await overdueInput.blur();
        const overduePayload = (await overdueSave).postDataJSON();
        assert.equal(overduePayload.overdue_days, 5);
        await page.getByText('遅延日数を更新しました').waitFor();
      }
      try {
        await page.screenshot({
          path: path.join(outputDir, `submission-${viewport.width}x${viewport.height}.png`),
          fullPage: false,
        });
      } catch (error) {
        if (!String(error.message || error).includes('ENOMEM')) throw error;
        console.warn(`[daily-report-submissions-ui] screenshot skipped (${viewport.width}px, ENOMEM)`);
      }
      await page.close();
    }
  } finally {
    await browser.close();
    await new Promise((resolve) => server.close(resolve));
  }
  console.log('[daily-report-submissions-ui] 案件情報・パートナー主表示・遅延手修正を確認しました');
}

main().catch((error) => { console.error(error); process.exit(1); });
