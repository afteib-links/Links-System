const express = require('express');
const { getPool, query } = require('../db');
const { requireAuth, requirePermission } = require('../middleware/auth');
const {
  GROUPS,
  GROUP_ORDER,
  VALID_CLOSINGS,
  periodForCycle,
  todayJst,
  parseGraceDays,
  parseOverdueDays,
  baseSubmitDate,
  deadlineDate,
  overdueDays,
} = require('../services/closing_cycles');

const router = express.Router();
router.use(requireAuth, requirePermission('daily_report_submissions'));

function bool(value) {
  return value === true || value === 1 || value === '1' || value === 'true';
}

function ymd(value) {
  const text = String(value || '').slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(text) ? text : null;
}

async function loadGraceDays() {
  const rows = await query(
    `SELECT setting_value FROM system_settings
      WHERE setting_key='daily_report_submission_grace_days' AND is_deleted=0 LIMIT 1`
  );
  return parseGraceDays(rows[0]?.setting_value);
}

function storedOverdueDays(record) {
  if (record == null || record.overdue_days == null || record.overdue_days === '') return null;
  return Number(record.overdue_days);
}

function presentCycle(ym, closing, groupCode, record, graceDays, today) {
  const period = periodForCycle(ym, closing, groupCode);
  const planned = baseSubmitDate(period.end);
  const deadline = deadlineDate(planned, graceDays);
  const isSubmitted = Boolean(Number(record?.is_submitted));
  const submittedDate = isSubmitted ? ymd(record.submitted_date) : null;
  const calculated = overdueDays({ submitted: isSubmitted, submittedDate, deadline, today });
  const stored = storedOverdueDays(record);
  const hasManual = stored != null && Number.isInteger(stored);
  return {
    group_code: groupCode,
    label: GROUPS[groupCode].label,
    period_start: period.start,
    period_end: period.end,
    planned_submit_date: planned,
    deadline_date: deadline,
    is_submitted: isSubmitted,
    submitted_date: submittedDate,
    overdue_days: hasManual ? stored : calculated,
    calculated_overdue_days: calculated,
    overdue_days_manual: hasManual,
    version: Number(record?.version || 0),
    daily_report_submission_id: record?.daily_report_submission_id || null,
  };
}

function cellStatus(cycle) {
  if (Number(cycle.overdue_days) > 0) return 'overdue';
  return cycle.is_submitted ? 'submitted' : 'unsubmitted';
}

function projectTotals(cycles) {
  return {
    submitted_count: cycles.filter((cycle) => cycle.is_submitted).length,
    overdue_count: cycles.filter((cycle) => Number(cycle.overdue_days) > 0).length,
    overdue_days: cycles.reduce((sum, cycle) => sum + Number(cycle.overdue_days || 0), 0),
  };
}

async function matrixData(ym, today = todayJst()) {
  if (!/^\d{4}-\d{2}$/.test(ym)) throw new Error('対象年月は YYYY-MM で指定してください');
  const graceDays = await loadGraceDays();
  const projects = await query(
    `SELECT p.project_id,p.company_id,p.partner_id,p.closing_date,p.business_type,p.manager_name,
            b.template_name,c.company_name,pt.partner_name
       FROM projects p
       LEFT JOIN base_projects b ON b.base_project_id=p.base_project_id
       LEFT JOIN companies c ON c.company_id=p.company_id
       LEFT JOIN partners pt ON pt.partner_id=p.partner_id
      WHERE p.is_deleted=0 AND p.closing_date IN ('5','10','15','20','25','end')
      ORDER BY (pt.partner_name IS NULL OR pt.partner_name=''), pt.partner_name, p.project_id`
  );
  const ids = projects.map((row) => Number(row.project_id));
  const records = new Map();
  if (ids.length) {
    const marks = ids.map(() => '?').join(',');
    const rows = await query(
      `SELECT * FROM daily_report_submissions
        WHERE target_year_month=? AND project_id IN (${marks})`,
      [ym, ...ids]
    );
    rows.forEach((row) => records.set(`${row.project_id}:${row.group_code}`, row));
  }
  const output = projects.map((project) => {
    const cycles = GROUP_ORDER.map((groupCode) => presentCycle(
      ym,
      project.closing_date,
      groupCode,
      records.get(`${project.project_id}:${groupCode}`),
      graceDays,
      today
    ));
    return {
      project_id: Number(project.project_id),
      project_name: project.template_name || project.manager_name || project.business_type || `案件 #${project.project_id}`,
      company_id: project.company_id == null ? null : Number(project.company_id),
      company_name: project.company_name || '',
      partner_id: project.partner_id == null ? null : Number(project.partner_id),
      partner_name: project.partner_name || '',
      closing_date: project.closing_date,
      cycles,
      totals: projectTotals(cycles),
    };
  });
  return { grace_days: graceDays, today, groups: GROUP_ORDER.map((code) => ({ group_code: code, ...GROUPS[code] })), projects: output };
}

function filterMatrix(projects, req) {
  const q = String(req.query.q || '').trim().toLowerCase();
  const companyId = Number(req.query.company_id || 0);
  const partnerId = Number(req.query.partner_id || 0);
  const closing = String(req.query.closing_date || '');
  const status = String(req.query.status || '');
  return projects.filter((project) => (
    (!companyId || project.company_id === companyId)
    && (!partnerId || project.partner_id === partnerId)
    && (!closing || String(project.closing_date) === closing)
    && (!status || project.cycles.some((cycle) => cellStatus(cycle) === status))
    && (!q || `${project.project_id} ${project.project_name} ${project.company_name} ${project.partner_name}`.toLowerCase().includes(q))
  ));
}

function summarize(projects) {
  const cycles = projects.flatMap((project) => project.cycles);
  const cycleSummaries = GROUP_ORDER.map((code) => {
    const rows = cycles.filter((cycle) => cycle.group_code === code);
    return {
      group_code: code,
      submitted_count: rows.filter((cycle) => cycle.is_submitted).length,
      unsubmitted_count: rows.filter((cycle) => !cycle.is_submitted).length,
      overdue_count: rows.filter((cycle) => Number(cycle.overdue_days) > 0).length,
      overdue_days: rows.reduce((sum, cycle) => sum + Number(cycle.overdue_days || 0), 0),
    };
  });
  return {
    project_count: projects.length,
    submitted_count: cycles.filter((cycle) => cycle.is_submitted).length,
    unsubmitted_count: cycles.filter((cycle) => !cycle.is_submitted).length,
    overdue_count: cycles.filter((cycle) => Number(cycle.overdue_days) > 0).length,
    overdue_days: cycles.reduce((sum, cycle) => sum + Number(cycle.overdue_days || 0), 0),
    cycles: cycleSummaries,
  };
}

function resolveSubmittedDate(body, today) {
  const submitted = bool(body.is_submitted);
  if (!submitted) return { is_submitted: 0, submitted_date: null };
  const requested = ymd(body.submitted_date) || today;
  if (requested > today) throw new Error('提出日に未来日は指定できません');
  return { is_submitted: 1, submitted_date: requested };
}

function resolveOverdueDays(body) {
  if (!Object.prototype.hasOwnProperty.call(body || {}, 'overdue_days')) return null;
  if (body.overdue_days === null || body.overdue_days === '') return null;
  return parseOverdueDays(body.overdue_days);
}

router.get('/matrix', async (req, res) => {
  try {
    const ym = String(req.query.target_year_month || '').trim();
    const data = await matrixData(ym);
    const visible = filterMatrix(data.projects, req);
    return res.json({
      ok: true,
      target_year_month: ym,
      grace_days: data.grace_days,
      today: data.today,
      groups: data.groups,
      projects: visible,
      visible_project_count: visible.length,
      summary: summarize(data.projects),
    });
  } catch (error) {
    return res.status(400).json({ ok: false, message: error.message || '日報提出一覧を取得できませんでした' });
  }
});

router.put('/cycles/:projectId/:groupCode', async (req, res) => {
  const pool = getPool();
  const conn = await pool.getConnection();
  try {
    const projectId = Number(req.params.projectId);
    const groupCode = String(req.params.groupCode || '');
    const ym = String(req.body?.target_year_month || '').trim();
    const version = Number(req.body?.version || 0);
    if (!projectId || !GROUPS[groupCode] || !/^\d{4}-\d{2}$/.test(ym)) {
      throw new Error('案件、サイクル、対象年月は必須です');
    }
    const today = todayJst();
    const next = resolveSubmittedDate(req.body || {}, today);
    const overdue = resolveOverdueDays(req.body || {});
    await conn.beginTransaction();
    const [projects] = await conn.query(
      `SELECT project_id, closing_date FROM projects
        WHERE project_id=? AND is_deleted=0 AND closing_date IN ('5','10','15','20','25','end') FOR UPDATE`,
      [projectId]
    );
    if (!projects.length) throw new Error('案件が見つかりません');
    periodForCycle(ym, projects[0].closing_date, groupCode);
    const [rows] = await conn.query(
      `SELECT * FROM daily_report_submissions
        WHERE target_year_month=? AND project_id=? AND group_code=? FOR UPDATE`,
      [ym, projectId, groupCode]
    );
    const existing = rows[0] || null;
    if (existing && Number(existing.version) !== version) {
      const error = new Error('他の利用者が更新しました。再読み込みしてください');
      error.statusCode = 409;
      throw error;
    }
    const actor = req.session.user?.user_id || null;
    if (existing) {
      await conn.query(
        `UPDATE daily_report_submissions
            SET is_submitted=?, submitted_date=?, overdue_days=?, updated_by=?, version=version+1
          WHERE daily_report_submission_id=?`,
        [next.is_submitted, next.submitted_date, overdue, actor, existing.daily_report_submission_id]
      );
    } else {
      if (version !== 0) {
        const error = new Error('他の利用者が更新しました。再読み込みしてください');
        error.statusCode = 409;
        throw error;
      }
      await conn.query(
        `INSERT INTO daily_report_submissions
          (target_year_month,project_id,group_code,is_submitted,submitted_date,overdue_days,updated_by)
         VALUES (?,?,?,?,?,?,?)`,
        [ym, projectId, groupCode, next.is_submitted, next.submitted_date, overdue, actor]
      );
    }
    await conn.commit();
    const graceDays = await loadGraceDays();
    const [saved] = await conn.query(
      `SELECT * FROM daily_report_submissions
        WHERE target_year_month=? AND project_id=? AND group_code=? LIMIT 1`,
      [ym, projectId, groupCode]
    );
    return res.json({
      ok: true,
      cycle: presentCycle(ym, projects[0].closing_date, groupCode, saved[0], graceDays, today),
    });
  } catch (error) {
    try { await conn.rollback(); } catch (_ignored) { /* no active transaction */ }
    const status = error.statusCode || 400;
    return res.status(status).json({ ok: false, message: error.message || '日報提出を保存できませんでした' });
  } finally {
    conn.release();
  }
});

router.GROUPS = GROUPS;
router.GROUP_ORDER = GROUP_ORDER;
router.VALID_CLOSINGS = VALID_CLOSINGS;
router.presentCycle = presentCycle;
router.cellStatus = cellStatus;
router.projectTotals = projectTotals;
router.filterMatrix = filterMatrix;
router.summarize = summarize;
router.resolveSubmittedDate = resolveSubmittedDate;
router.resolveOverdueDays = resolveOverdueDays;
router.storedOverdueDays = storedOverdueDays;
router.bool = bool;
module.exports = router;
