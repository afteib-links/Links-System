const express = require('express');
const multer = require('multer');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const { getPool } = require('../db');
const { requireAuth, requirePermission, requireRole } = require('../middleware/auth');
const { getPeriod, periodForDate, assertPeriodEditable, periodError, validMonth } = require('../services/daily_report_periods');
const { applyDailyPriceCalcWithRules } = require('../services/price_calc_rules');
const { FIELDS, SYSTEM_FIELDS, json, validateTemplate, candidate, mergeFields, sameFields } = require('../services/pdf_import');
const router = express.Router();
router.use(requireAuth, requirePermission('daily_reports'), requireRole('admin', 'soumu', 'executive'));
const editor = requireRole('admin', 'soumu');
const root = process.env.DAILY_REPORT_IMPORT_DIR || path.resolve(__dirname, '../../../data/uploads/daily-report-imports');
fs.mkdirSync(root, { recursive: true });
const upload = multer({ storage: multer.diskStorage({ destination: root, filename: (_req, _file, cb) => cb(null, `${crypto.randomUUID()}.pdf`) }),
  limits: { files: 1, fileSize: 50 * 1024 * 1024 }, fileFilter: (_req, file, cb) => cb(null, path.extname(file.originalname).toLowerCase() === '.pdf') });
const hash = value => crypto.createHash('sha256').update(value).digest('hex');
function errorResponse(res, error) {
  if (!error.status) console.error('[pdf-import]', error);
  return res.status(error.status || (error instanceof multer.MulterError ? 400 : 500)).json({ ok: false, code: error.code, message: error.status ? error.message : 'PDF取込処理に失敗しました' });
}
function route(handler, transaction = false) {
  return async (req, res) => {
    const conn = await getPool().getConnection();
    try {
      if (transaction) await conn.beginTransaction();
      const value = await handler(req, conn);
      if (transaction) await conn.commit();
      return res.json({ ok: true, ...value });
    } catch (error) { if (transaction) await conn.rollback(); return errorResponse(res, error); }
    finally { conn.release(); }
  };
}
async function loadBatch(conn, id, lock = false) {
  const [rows] = await conn.query(`SELECT * FROM daily_report_import_batches WHERE daily_report_import_batch_id=? AND source_type='pdf' ${lock ? 'FOR UPDATE' : ''}`, [id]);
  if (!rows.length) throw periodError('PDF取込が見つかりません', 404);
  const batch = rows[0];
  batch.extra_data = json(batch.extra_data);
  const [files] = await conn.query(`SELECT * FROM daily_report_import_files WHERE daily_report_import_batch_id=? AND is_active=1 AND retention_until>=CURDATE()`, [id]);
  if (!files.length) throw periodError('原本の保存期限を過ぎているか、利用できません', 410);
  return { batch, file: files[0] };
}
async function audit(conn, batchId, rowId, before, after, reason, actor, action = 'pdf_apply') {
  await conn.query(`INSERT INTO daily_report_import_audit_logs
    (daily_report_import_batch_id,daily_report_import_row_id,action_code,before_data,after_data,reason,actor_user_id)
    VALUES (?,?,?,?,?,?,?)`, [batchId, rowId, action, before == null ? null : JSON.stringify(before), JSON.stringify(after), reason || null, actor]);
}

router.post('/uploads', editor, (req, res) => upload.single('file')(req, res, async error => {
  if (error) return errorResponse(res, error);
  if (!req.file) return res.status(400).json({ ok: false, message: 'PDFを選択してください' });
  const conn = await getPool().getConnection();
  try {
    const buffer = await fsp.readFile(req.file.path);
    if (!buffer.subarray(0, 1024).includes(Buffer.from('%PDF-'))) throw periodError('PDF形式のファイルではありません', 400);
    const digest = hash(buffer);
    const [existing] = await conn.query(`SELECT f.daily_report_import_batch_id FROM daily_report_import_files f
      JOIN daily_report_import_batches b USING(daily_report_import_batch_id)
      WHERE f.sha256=? AND f.is_active=1 AND b.status<>'cancelled' LIMIT 1`, [digest]);
    if (existing.length && req.body.allow_duplicate !== '1') {
      await fsp.unlink(req.file.path);
      return res.status(409).json({ ok: false, code: 'duplicate_file', message: '同じPDFは取込済みです', duplicate: existing[0] });
    }
    const reason = String(req.body.duplicate_reason || '').trim();
    if (existing.length && !reason) throw periodError('再取込理由を入力してください', 400);
    if (!validMonth(req.body.target_year_month)) throw periodError('対象年月を指定してください', 400);
    await conn.beginTransaction();
    const [result] = await conn.query(`INSERT INTO daily_report_import_batches
      (source_type,status,target_year_month,parser_name,parser_version,created_by_user_id,extra_data)
      VALUES ('pdf','uploaded',?,'PP-OCRv5','3.2.0',?,?)`, [req.body.target_year_month, req.session.user.user_id, JSON.stringify({ duplicate_reason: reason })]);
    const id = Number(result.insertId);
    const [file] = await conn.query(`INSERT INTO daily_report_import_files
      (daily_report_import_batch_id,original_filename,stored_filename,storage_path,mime_type,file_size,sha256,retention_until)
      VALUES (?,?,?,?,'application/pdf',?,?,DATE_ADD(CURDATE(),INTERVAL 3 YEAR))`, [id, req.file.originalname, req.file.filename, req.file.path, req.file.size, digest]);
    await conn.query(`INSERT INTO daily_report_ocr_jobs(daily_report_import_batch_id,job_type,payload) VALUES (?,'render',?)`, [id, JSON.stringify({ source_file_id: file.insertId })]);
    await audit(conn, id, null, null, { file_id: file.insertId }, reason, req.session.user.user_id, 'pdf_upload');
    await conn.commit();
    return res.status(201).json({ ok: true, batch_id: id, source_type: 'pdf' });
  } catch (err) {
    await conn.rollback();
    await fsp.unlink(req.file.path).catch(() => {});
    return errorResponse(res, err);
  } finally { conn.release(); }
}));

router.get('/templates', route(async (_req, conn) => {
  const [templates] = await conn.query("SELECT * FROM daily_report_import_mappings WHERE source_type='pdf' AND is_deleted=0 AND is_active=1 ORDER BY mapping_name");
  return { templates: templates.map(t => ({ ...t, mapping_json: json(t.mapping_json) })) };
}));
router.get('/:id', route(async (req, conn) => {
  const { batch, file } = await loadBatch(conn, req.params.id);
  const [jobs] = await conn.query(`SELECT ocr_job_id,job_type,status,progress,attempts,error_message,metrics,heartbeat_at FROM daily_report_ocr_jobs WHERE daily_report_import_batch_id=? ORDER BY ocr_job_id DESC`, [req.params.id]);
  const [pages] = await conn.query('SELECT pdf_page_id,page_number,width,height,rotation,deskew_angle FROM daily_report_pdf_pages WHERE source_file_id=? ORDER BY page_number', [file.daily_report_import_file_id]);
  const [rows] = await conn.query('SELECT * FROM daily_report_import_rows WHERE daily_report_import_batch_id=? ORDER BY source_row_number', [req.params.id]);
  let current = [], period = null;
  const projectId = batch.extra_data.project_id;
  if (projectId) {
    period = await getPeriod(projectId, batch.target_year_month, conn);
    [current] = await conn.query(`SELECT * FROM daily_reports WHERE project_id=? AND is_deleted=0 AND work_date BETWEEN ? AND ? ORDER BY work_date,daily_report_id`, [projectId, period.period_start, period.period_end]);
  }
  return { batch, jobs, pages, period, file: { file_id: file.daily_report_import_file_id, name: file.original_filename }, current_reports: current,
    rows: rows.map(row => {
      const raw = json(row.raw_data), confidence = json(row.ocr_confidence);
      const parsed = period ? candidate(raw, confidence, period) : { values: {}, warnings: { date: '案件と対象期間を指定してください' } };
      const matches = current.filter(r => r.work_date === parsed.values.work_date);
      const { source_image_path, ...safe } = row;
      return { ...safe, raw_data: raw, source_region: json(row.source_region), confidence, candidate: parsed.values, warnings: parsed.warnings,
        has_image: Boolean(source_image_path), previously_imported: Boolean(row.daily_report_id), current_ids: matches.map(r => r.daily_report_id),
        initially_selected: !row.daily_report_id && !matches.length && !Object.keys(parsed.warnings).length };
    }) };
}));

router.get('/:id/image/:kind/:imageId', async (req, res) => {
  try {
    const conn = getPool();
    const { file } = await loadBatch(conn, req.params.id);
    let stored, mime = 'image/png';
    if (req.params.kind === 'original') { stored = file.storage_path; mime = 'application/pdf'; }
    else if (req.params.kind === 'page') {
      const [rows] = await conn.query('SELECT image_path FROM daily_report_pdf_pages WHERE pdf_page_id=? AND source_file_id=?', [req.params.imageId, file.daily_report_import_file_id]);
      stored = rows[0]?.image_path;
    } else if (req.params.kind === 'row') {
      const [rows] = await conn.query('SELECT source_image_path FROM daily_report_import_rows WHERE daily_report_import_row_id=? AND daily_report_import_batch_id=?', [req.params.imageId, req.params.id]);
      stored = rows[0]?.source_image_path;
    }
    const resolved = stored && path.resolve(stored);
    if (!resolved || !resolved.startsWith(path.resolve(root) + path.sep)) throw periodError('画像が見つかりません', 404);
    await fsp.access(resolved);
    res.set('Cache-Control', 'private, no-store').type(mime).sendFile(resolved);
  } catch (error) { errorResponse(res, error); }
});

router.post('/:id/configure', editor, route(async (req, conn) => {
  const { batch, file } = await loadBatch(conn, req.params.id, true);
  const [applied] = await conn.query('SELECT daily_report_import_row_id FROM daily_report_import_rows WHERE daily_report_import_batch_id=? AND daily_report_id IS NOT NULL LIMIT 1', [req.params.id]);
  if (applied.length) throw periodError('反映済みの原読取値は再解析できません。必要なら理由を付けて別バッチで取り込んでください');
  const projectId = Number(req.body.project_id);
  const period = await getPeriod(projectId, batch.target_year_month, conn);
  const [projects] = await conn.query('SELECT partner_id FROM projects WHERE project_id=?', [projectId]);
  const template = validateTemplate(req.body.template);
  const [running] = await conn.query("SELECT ocr_job_id FROM daily_report_ocr_jobs WHERE daily_report_import_batch_id=? AND status IN ('queued','running')", [req.params.id]);
  if (running.length) throw periodError('現在の解析が終わってから設定してください');
  let templateId = null;
  if (String(req.body.template_name || '').trim()) {
    const [saved] = await conn.query(`INSERT INTO daily_report_import_mappings(mapping_name,source_type,mapping_json,created_by_user_id) VALUES (?,'pdf',?,?)`, [String(req.body.template_name).trim().slice(0, 120), JSON.stringify(template), req.session.user.user_id]);
    templateId = saved.insertId;
  }
  const config = { ...batch.extra_data, project_id: projectId, partner_id: projects[0]?.partner_id, template, period };
  await conn.query("UPDATE daily_report_import_batches SET status='parsing',mapping_template_id=?,extra_data=? WHERE daily_report_import_batch_id=?", [templateId, JSON.stringify(config), req.params.id]);
  await conn.query("DELETE FROM daily_report_import_rows WHERE daily_report_import_batch_id=? AND daily_report_id IS NULL", [req.params.id]);
  await conn.query(`INSERT INTO daily_report_ocr_jobs(daily_report_import_batch_id,job_type,payload) VALUES (?,'recognize',?)`, [req.params.id, JSON.stringify({ source_file_id: file.daily_report_import_file_id, ...config })]);
  await audit(conn, req.params.id, null, batch.extra_data, config, '様式設定', req.session.user.user_id, 'pdf_configure');
  return {};
}, true));

router.post('/:id/retry', editor, route(async (req, conn) => {
  await loadBatch(conn, req.params.id, true);
  const [result] = await conn.query(`UPDATE daily_report_ocr_jobs SET status='queued',error_message=NULL,progress=0 WHERE ocr_job_id=? AND daily_report_import_batch_id=? AND status='failed'`, [req.body.job_id, req.params.id]);
  if (!result.affectedRows) throw periodError('再試行可能なジョブではありません');
  return {};
}, true));

router.post('/:id/manual-rows', editor, route(async (req, conn) => {
  const { batch, file } = await loadBatch(conn, req.params.id, true);
  const projectId = Number(req.body.project_id || batch.extra_data.project_id);
  if (batch.extra_data.project_id && projectId !== Number(batch.extra_data.project_id)) throw periodError('手入力行は同じ案件に追加してください');
  await getPeriod(projectId, batch.target_year_month, conn);
  const [project] = await conn.query('SELECT partner_id FROM projects WHERE project_id=?', [projectId]);
  const [running] = await conn.query("SELECT ocr_job_id FROM daily_report_ocr_jobs WHERE daily_report_import_batch_id=? AND status='running' FOR UPDATE", [req.params.id]);
  if (running.length) throw periodError('解析の完了または失敗を待ってから手入力に切り替えてください');
  await conn.query("UPDATE daily_report_ocr_jobs SET status='cancelled' WHERE daily_report_import_batch_id=? AND status='queued'", [req.params.id]);
  const count = Number(req.body.count || 1);
  if (!Number.isInteger(count) || count < 1 || count > 62) throw periodError('行数は1〜62行で指定してください', 400);
  const [last] = await conn.query('SELECT COALESCE(MAX(source_row_number),0) n FROM daily_report_import_rows WHERE daily_report_import_batch_id=?', [req.params.id]);
  for (let i = 0; i < count; i++) await conn.query(`INSERT INTO daily_report_import_rows
    (daily_report_import_batch_id,source_file_id,source_sheet,source_row_number,status,raw_data,parsed_data,matched_project_id,matched_partner_id,row_fingerprint)
    VALUES (?,?,'manual',?,'warning','{}','{}',?,?,?)`, [req.params.id, file.daily_report_import_file_id, Number(last[0].n) + i + 1, projectId, project[0].partner_id, hash(`${file.sha256}:manual:${Number(last[0].n) + i + 1}:${projectId}`)]);
  const config = { ...batch.extra_data, project_id: projectId, partner_id: project[0].partner_id };
  await conn.query("UPDATE daily_report_import_batches SET status='needs_review',extra_data=?,row_count=row_count+? WHERE daily_report_import_batch_id=?", [JSON.stringify(config), count, req.params.id]);
  await audit(conn, req.params.id, null, null, { count }, '原本を見て手入力', req.session.user.user_id, 'pdf_manual');
  return {};
}, true));

router.post('/:id/apply', editor, route(async (req, conn) => {
  const { batch } = await loadBatch(conn, req.params.id, true);
  if (['cancelled', 'parsing'].includes(batch.status)) throw periodError('解析中または取消済みの取込は反映できません');
  const requests = req.body.rows;
  if (!Array.isArray(requests) || !requests.length || requests.length > 200) throw periodError('反映行を1〜200件選択してください', 400);
  const projectId = Number(batch.extra_data.project_id);
  await getPeriod(projectId, batch.target_year_month, conn, true);
  const [projects] = await conn.query('SELECT * FROM projects WHERE project_id=? AND is_deleted=0 FOR UPDATE', [projectId]);
  const project = projects[0];
  if (!project || Number(project.partner_id) !== Number(batch.extra_data.partner_id)) throw periodError('案件のパートナーが変更されています。対象を再確認してください');
  const output = [];
  for (const request of requests) {
    if (!request || typeof request !== 'object' || Array.isArray(request)) throw periodError('反映行の形式を確認してください', 400);
    const [rows] = await conn.query('SELECT * FROM daily_report_import_rows WHERE daily_report_import_row_id=? AND daily_report_import_batch_id=? FOR UPDATE', [request.import_row_id, req.params.id]);
    if (!rows.length) throw periodError('選択した取込行が見つかりません', 404);
    const row = rows[0];
    const digest = hash(JSON.stringify(request));
    const [done] = await conn.query('SELECT daily_report_id FROM daily_report_import_applications WHERE daily_report_import_row_id=? AND request_hash=?', [request.import_row_id, digest]);
    if (done.length) { output.push({ row_id: row.daily_report_import_row_id, daily_report_id: done[0].daily_report_id, skipped: true }); continue; }
    if (Number(request.import_version) !== Number(row.version)) throw periodError('取込行が更新されました。比較画面を再読み込みしてください');
    let current = null;
    if (request.target_daily_report_id) {
      const [targets] = await conn.query('SELECT * FROM daily_reports WHERE daily_report_id=? AND project_id=? AND is_deleted=0 FOR UPDATE', [request.target_daily_report_id, projectId]);
      current = targets[0];
      if (!current || Number(current.version) !== Number(request.expected_version)) throw periodError('日報が別の担当者によって更新されました。現在値を再取得してください');
      if (['confirmed', 'approved'].includes(current.status) || [current.billing_status, current.payment_status].some(s => s && s !== 'none')) throw periodError('確認・承認・精算で保護された日報は取り込めません');
      if (!String(request.reason || '').trim()) throw periodError('既存日報の更新理由を入力してください', 400);
    } else if (row.daily_report_id) throw periodError('既取込行は反映先の日報を明示してください');
    const merged = mergeFields(current || {}, request);
    if (!request.date_confirmed) throw periodError('勤務日を原本で確認してください', 400);
    if (current && current.work_date !== merged.work_date) throw periodError('反映先の日報と勤務日が異なります');
    const period = await periodForDate(projectId, merged.work_date, conn, true);
    if (period.target_year_month !== batch.target_year_month) throw periodError('指定した勤務日は取込対象の締め期間外です');
    await assertPeriodEditable(conn, projectId, period.target_year_month);
    if (!current) {
      const [sameDay] = await conn.query('SELECT daily_report_id,status,billing_status,payment_status FROM daily_reports WHERE project_id=? AND work_date=? AND is_deleted=0 FOR UPDATE', [projectId, merged.work_date]);
      if (sameDay.some(r => ['confirmed', 'approved'].includes(r.status) || [r.billing_status, r.payment_status].some(s => s && s !== 'none'))) throw periodError('確認・承認・精算で保護された勤務日に作業行を追加できません');
      if (sameDay.length && (!request.allow_new_work_row || !String(request.reason || '').trim())) throw periodError('同日に日報があります。反映先を選ぶか、新しい作業行の理由を指定してください');
    }
    if (current && sameFields(current, merged)) { output.push({ row_id: row.daily_report_import_row_id, daily_report_id: current.daily_report_id, skipped: true }); continue; }
    const input = { ...merged, project_id: projectId, company_id: project.company_id, partner_id: project.partner_id,
      target_year_month: period.target_year_month, daily_report_period_id: period.daily_report_period_id };
    const calculated = await applyDailyPriceCalcWithRules(input);
    const values = {};
    for (const key of [...FIELDS, 'project_id', 'company_id', 'partner_id', 'target_year_month', 'daily_report_period_id']) if (input[key] !== undefined) values[key] = input[key];
    for (const key of SYSTEM_FIELDS) if (calculated[key] !== undefined) values[key] = calculated[key];
    if (values.calculation_detail && typeof values.calculation_detail !== 'string') values.calculation_detail = JSON.stringify(values.calculation_detail);
    let id = current?.daily_report_id;
    if (current) {
      const keys = Object.keys(values);
      await conn.query(`UPDATE daily_reports SET ${keys.map(k => `${k}=?`).join(',')},version=version+1 WHERE daily_report_id=?`, [...keys.map(k => values[k]), id]);
    } else {
      values.input_source_type = 'pdf';
      const keys = Object.keys(values);
      const [created] = await conn.query(`INSERT INTO daily_reports(${keys.join(',')}) VALUES (${keys.map(() => '?').join(',')})`, keys.map(k => values[k]));
      id = created.insertId;
    }
    await conn.query(`INSERT INTO daily_report_import_applications(daily_report_import_row_id,request_hash,daily_report_id,before_data,after_data,reason,actor_user_id)
      VALUES (?,?,?,?,?,?,?)`, [row.daily_report_import_row_id, digest, id, current ? JSON.stringify(current) : null, JSON.stringify(values), request.reason || null, req.session.user.user_id]);
    await conn.query(`INSERT INTO daily_report_audit_logs(daily_report_id,action_code,before_data,after_data,reason,actor_user_id)
      VALUES (?,'pdf_import',?,?,?,?)`, [id, current ? JSON.stringify(current) : null, JSON.stringify(values), request.reason || 'PDF初回取込', req.session.user.user_id]);
    await audit(conn, req.params.id, row.daily_report_import_row_id, current, { ...values, selected_fields: request.fields, clear_fields: request.clear_fields }, request.reason, req.session.user.user_id);
    await conn.query(`UPDATE daily_report_import_rows SET status='applied',reviewed_data=?,daily_report_id=COALESCE(daily_report_id,?),applied_by_user_id=?,applied_at=CURRENT_TIMESTAMP,version=version+1 WHERE daily_report_import_row_id=?`, [JSON.stringify(values), id, req.session.user.user_id, row.daily_report_import_row_id]);
    output.push({ row_id: row.daily_report_import_row_id, daily_report_id: id, skipped: false });
  }
  await conn.query(`UPDATE daily_report_import_batches SET applied_count=(SELECT COUNT(*) FROM daily_report_import_rows r WHERE r.daily_report_import_batch_id=? AND r.status='applied'),status='partial' WHERE daily_report_import_batch_id=?`, [req.params.id, req.params.id]);
  await conn.query("UPDATE daily_report_import_batches SET status='applied' WHERE daily_report_import_batch_id=? AND applied_count=row_count AND row_count>0", [req.params.id]);
  return { applied: output };
}, true));
module.exports = router;
