const crypto = require('crypto');
const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');
const express = require('express');
const multer = require('multer');
const unzipper = require('unzipper');
const { getPool, query } = require('../db');
const { requireAuth, requirePermission, requireRole } = require('../middleware/auth');
const { applyDailyPriceCalc } = require('../services/price_calc');
const {
  IMPORT_FIELDS,
  buildImportRows,
  fingerprint,
  inferMapping,
  normalizeKey,
  readSourceFile,
  validateParsedRow,
} = require('../services/daily_report_import');

const router = express.Router();
const IMPORT_DIR = process.env.DAILY_REPORT_IMPORT_DIR || (process.platform === 'win32'
  ? path.resolve(__dirname, '../../../data/uploads/daily-report-imports')
  : '/app/uploads/daily-report-imports');
const MAX_FILE_SIZE = Number(process.env.DAILY_REPORT_IMPORT_MAX_FILE_SIZE || 50 * 1024 * 1024);
const MAX_ROWS = Number(process.env.DAILY_REPORT_IMPORT_MAX_ROWS || 10000);
const MAX_COLUMNS = Number(process.env.DAILY_REPORT_IMPORT_MAX_COLUMNS || 200);
const MAX_EXPANDED_SIZE = Number(process.env.DAILY_REPORT_IMPORT_MAX_EXPANDED_SIZE || 200 * 1024 * 1024);
const ALLOWED_EXTENSIONS = new Set(['.xlsx', '.csv']);
const JSON_COLUMNS = [
  'extra_data', 'sheet_names', 'raw_data', 'parsed_data', 'reviewed_data',
  'validation_errors', 'validation_warnings', 'mapping_json',
];
const DAILY_INPUT_FIELDS = [
  'project_id', 'company_id', 'partner_id', 'target_year_month', 'work_date', 'start_time', 'end_time',
  'break_minutes', 'is_absent', 'is_training', 'total_distance', 'toll_fee', 'parking_fee',
  'transport_fee', 'row_comment', 'input_source_type',
];
const DAILY_SYSTEM_FIELDS = [
  'applied_price_set_id', 'selected_fee_item_id', 'selected_fee_item_name', 'fee_item_selection_source',
  'break_time', 'break_minutes', 'binding_hours', 'work_hours', 'overtime_hours', 'shortage_hours',
  'shortage_minutes_billing', 'shortage_minutes_payment', 'shortage_amount_billing', 'shortage_amount_payment',
  'distance_amount_billing', 'distance_amount_payment', 'distance_calculation_mode', 'night_hours',
  'night_minutes_billing', 'night_minutes_payment', 'night_overtime_minutes_billing',
  'night_overtime_minutes_payment', 'regular_overtime_minutes_billing', 'regular_overtime_minutes_payment',
  'calculated_billing_amount', 'calculated_payment_amount', 'calculation_detail',
];

fs.mkdirSync(IMPORT_DIR, { recursive: true });

const storage = multer.diskStorage({
  destination: (_req, _file, callback) => callback(null, IMPORT_DIR),
  filename: (_req, file, callback) => {
    const extension = path.extname(file.originalname || '').toLowerCase();
    callback(null, `${crypto.randomUUID()}${extension}`);
  },
});
const upload = multer({
  storage,
  limits: { fileSize: MAX_FILE_SIZE, files: 1 },
  fileFilter: (_req, file, callback) => {
    const extension = path.extname(file.originalname || '').toLowerCase();
    if (!ALLOWED_EXTENSIONS.has(extension)) return callback(new Error('初期版で取り込める形式は.xlsxと.csvです'));
    return callback(null, true);
  },
});

const requireImportViewer = requireRole('admin', 'soumu', 'executive');
const requireImportEditor = requireRole('admin', 'soumu');
router.use(requireAuth, requirePermission('daily_reports'), requireImportViewer);

function parseJson(value, fallback = null) {
  if (value == null || value === '') return fallback;
  if (typeof value === 'object') return value;
  try { return JSON.parse(value); } catch (_error) { return fallback; }
}

function hydrate(row) {
  if (!row) return row;
  const output = { ...row };
  for (const key of JSON_COLUMNS) {
    if (Object.prototype.hasOwnProperty.call(output, key)) output[key] = parseJson(output[key], key === 'mapping_json' ? {} : null);
  }
  return output;
}

function routeError(res, error, fallback) {
  if (error instanceof multer.MulterError) {
    return res.status(400).json({ ok: false, code: error.code, message: error.code === 'LIMIT_FILE_SIZE' ? 'ファイルサイズが上限を超えています' : error.message });
  }
  if (error?.status) return res.status(error.status).json({ ok: false, code: error.code || 'validation_error', message: error.message });
  if (error?.message?.includes('初期版で取り込める形式')) return res.status(400).json({ ok: false, code: 'unsupported_file_type', message: error.message });
  console.error(`[daily-report-imports] ${fallback}`, error);
  return res.status(500).json({ ok: false, message: fallback });
}

function badRequest(message, code = 'validation_error') {
  const error = new Error(message);
  error.status = 400;
  error.code = code;
  return error;
}

function requestError(status, message, code) {
  const error = new Error(message);
  error.status = status;
  error.code = code;
  return error;
}

async function sha256(filePath) {
  const hash = crypto.createHash('sha256');
  const stream = fs.createReadStream(filePath);
  for await (const chunk of stream) hash.update(chunk);
  return hash.digest('hex');
}

async function validateFileSignature(file) {
  const handle = await fsp.open(file.path, 'r');
  try {
    const buffer = Buffer.alloc(8);
    const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
    const extension = path.extname(file.originalname || '').toLowerCase();
    if (extension === '.xlsx' && (bytesRead < 4 || buffer[0] !== 0x50 || buffer[1] !== 0x4b)) {
      throw badRequest('Excelファイルの内容が.xlsx形式ではありません', 'invalid_file_signature');
    }
    if (extension === '.csv' && buffer.subarray(0, bytesRead).includes(0)) {
      throw badRequest('CSVとして読み取れないファイルです', 'invalid_file_signature');
    }
  } finally { await handle.close(); }
  if (path.extname(file.originalname || '').toLowerCase() === '.xlsx') {
    const directory = await unzipper.Open.file(file.path);
    const expandedSize = directory.files.reduce((total, entry) => total + Number(entry.vars?.uncompressedSize || 0), 0);
    if (expandedSize > MAX_EXPANDED_SIZE) throw badRequest('Excelの展開後サイズが上限を超えています', 'expanded_size_limit');
  }
}

async function fetchBatch(id) {
  const batches = await query(
    `SELECT b.*,u.display_name AS created_by_name,m.mapping_name
       FROM daily_report_import_batches b
       LEFT JOIN users u ON u.user_id=b.created_by_user_id
       LEFT JOIN daily_report_import_mappings m ON m.daily_report_import_mapping_id=b.mapping_template_id
      WHERE b.daily_report_import_batch_id=?`,
    [id]
  );
  if (!batches.length) return null;
  const files = await query('SELECT * FROM daily_report_import_files WHERE daily_report_import_batch_id=? ORDER BY daily_report_import_file_id', [id]);
  const rows = await query(
    `SELECT r.*,bp.template_name,c.company_name,p.partner_name
       FROM daily_report_import_rows r
       LEFT JOIN projects pr ON pr.project_id=r.matched_project_id
       LEFT JOIN base_projects bp ON bp.base_project_id=pr.base_project_id
       LEFT JOIN companies c ON c.company_id=pr.company_id
       LEFT JOIN partners p ON p.partner_id=pr.partner_id
      WHERE r.daily_report_import_batch_id=? ORDER BY r.source_row_number,r.daily_report_import_row_id`,
    [id]
  );
  return { batch: hydrate(batches[0]), files: files.map(hydrate), rows: rows.map(hydrate) };
}

async function activeProjects(conn = getPool()) {
  const [rows] = await conn.query(
    `SELECT pr.project_id,pr.company_id,pr.partner_id,DATE_FORMAT(pr.operation_start_date,'%Y-%m-%d') AS start_date,NULL AS end_date,
            bp.template_name,pr.manager_name,pr.business_type,c.company_name,p.partner_name
       FROM projects pr
       LEFT JOIN base_projects bp ON bp.base_project_id=pr.base_project_id
       LEFT JOIN companies c ON c.company_id=pr.company_id
       LEFT JOIN partners p ON p.partner_id=pr.partner_id
      WHERE pr.is_deleted=0 ORDER BY pr.project_id`
  );
  return rows;
}

function matchProject(data, projects) {
  let candidates = projects;
  if (data.project_id) {
    candidates = candidates.filter((row) => Number(row.project_id) === Number(data.project_id));
  } else {
    if (data.project_name) {
      const name = normalizeKey(data.project_name);
      candidates = candidates.filter((row) => [row.template_name, row.manager_name, row.business_type].some((value) => normalizeKey(value) === name));
    }
    if (data.company_name) {
      const company = normalizeKey(data.company_name);
      candidates = candidates.filter((row) => normalizeKey(row.company_name) === company);
    }
    if (data.partner_name) {
      const partner = normalizeKey(data.partner_name);
      candidates = candidates.filter((row) => normalizeKey(row.partner_name) === partner);
    }
  }
  if (data.work_date) {
    candidates = candidates.filter((row) => {
      const start = row.start_date ? String(row.start_date).slice(0, 10) : null;
      const end = row.end_date ? String(row.end_date).slice(0, 10) : null;
      return (!start || start <= data.work_date) && (!end || end >= data.work_date);
    });
  }
  if (candidates.length === 1) {
    const row = candidates[0];
    return { project: row, reason: data.project_id ? '案件IDが一致' : '案件名・企業・パートナー・対象期間が一致', error: null };
  }
  return {
    project: null,
    reason: candidates.length ? `${candidates.length}件の案件候補があります` : '一致する有効案件がありません',
    error: candidates.length ? '案件候補を1件選択してください' : '一致する案件がありません',
  };
}

async function insertImportRow(conn, values) {
  const [result] = await conn.query(
    `INSERT INTO daily_report_import_rows
      (daily_report_import_batch_id,source_file_id,source_sheet,source_row_number,status,
       raw_data,parsed_data,reviewed_data,validation_errors,validation_warnings,
       matched_project_id,matched_partner_id,match_reason,row_fingerprint,extra_data)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    values
  );
  return Number(result.insertId);
}

async function updateBatchCounts(conn, batchId) {
  await conn.query(
    `UPDATE daily_report_import_batches b SET
       row_count=(SELECT COUNT(*) FROM daily_report_import_rows r WHERE r.daily_report_import_batch_id=b.daily_report_import_batch_id),
       valid_count=(SELECT COUNT(*) FROM daily_report_import_rows r WHERE r.daily_report_import_batch_id=b.daily_report_import_batch_id AND r.status='ready'),
       warning_count=(SELECT COUNT(*) FROM daily_report_import_rows r WHERE r.daily_report_import_batch_id=b.daily_report_import_batch_id AND r.status='warning'),
       error_count=(SELECT COUNT(*) FROM daily_report_import_rows r WHERE r.daily_report_import_batch_id=b.daily_report_import_batch_id AND r.status='error'),
       applied_count=(SELECT COUNT(*) FROM daily_report_import_rows r WHERE r.daily_report_import_batch_id=b.daily_report_import_batch_id AND r.status='applied')
     WHERE b.daily_report_import_batch_id=?`,
    [batchId]
  );
}

async function insertImportAudit(conn, values) {
  await conn.query(
    `INSERT INTO daily_report_import_audit_logs
      (daily_report_import_batch_id,daily_report_import_file_id,daily_report_import_row_id,
       action_code,before_data,after_data,reason,actor_user_id)
     VALUES (?,?,?,?,?,?,?,?)`,
    values
  );
}

router.post('/', requireImportEditor, (req, res) => {
  upload.single('file')(req, res, async (uploadError) => {
    if (uploadError) return routeError(res, uploadError, 'ファイルのアップロードに失敗しました');
    const file = req.file;
    if (!file) return res.status(400).json({ ok: false, message: '取込ファイルを選択してください' });
    const pool = getPool();
    const conn = await pool.getConnection();
    try {
      await validateFileSignature(file);
      const hash = await sha256(file.path);
      const [duplicates] = await conn.query(
        `SELECT f.daily_report_import_batch_id,b.status,b.created_at
           FROM daily_report_import_files f JOIN daily_report_import_batches b USING(daily_report_import_batch_id)
          WHERE f.sha256=? AND f.is_active=1 AND b.status<>'cancelled' ORDER BY f.daily_report_import_file_id DESC LIMIT 1`,
        [hash]
      );
      if (duplicates.length && req.body.allow_duplicate !== '1') {
        await fsp.unlink(file.path).catch(() => {});
        return res.status(409).json({ ok: false, code: 'duplicate_file', message: '同じ内容のファイルはすでに取り込まれています', duplicate: duplicates[0] });
      }
      const duplicateReason = String(req.body.duplicate_reason || '').trim();
      if (duplicates.length && !duplicateReason) throw badRequest('同じファイルを別バッチとして取り込む理由を入力してください', 'duplicate_reason_required');
      const source = await readSourceFile(file.path);
      const headers = (source.rows[0] || []).map((value, index) => String(value ?? `列${index + 1}`));
      const inferred = inferMapping(headers);
      await conn.beginTransaction();
      const [batchResult] = await conn.query(
        `INSERT INTO daily_report_import_batches
          (source_type,status,target_year_month,parser_name,parser_version,created_by_user_id,extra_data)
         VALUES ('excel','uploaded',?,'read-excel-file','6',?,?)`,
        [req.body.target_year_month || null, req.session.user.user_id, JSON.stringify({ duplicate_override: Boolean(duplicates.length), duplicate_reason: duplicateReason || null, initial_mapping: inferred })]
      );
      const batchId = Number(batchResult.insertId);
      const [fileResult] = await conn.query(
        `INSERT INTO daily_report_import_files
          (daily_report_import_batch_id,original_filename,stored_filename,storage_path,mime_type,file_size,sha256,sheet_names,retention_until)
         VALUES (?,?,?,?,?,?,?, ?,DATE_ADD(CURDATE(),INTERVAL 3 YEAR))`,
        [batchId, file.originalname, file.filename, file.path, file.mimetype || 'application/octet-stream', file.size, hash, JSON.stringify(source.sheetNames)]
      );
      await insertImportAudit(conn, [batchId, Number(fileResult.insertId), null, 'upload', null, JSON.stringify({ original_filename: file.originalname, file_size: file.size, sha256: hash }), duplicateReason || null, req.session.user.user_id]);
      await conn.commit();
      return res.status(201).json({
        ok: true,
        batch_id: batchId,
        file_id: Number(fileResult.insertId),
        original_filename: file.originalname,
        sheet_names: source.sheetNames,
        selected_sheet: source.sheetName,
        headers,
        inferred_mapping: inferred,
        preview_rows: source.rows.slice(0, 11).map((row) => row.map((value) => value instanceof Date ? value.toISOString() : value)),
      });
    } catch (error) {
      await conn.rollback().catch(() => {});
      await fsp.unlink(file.path).catch(() => {});
      return routeError(res, error, '取込ファイルの登録に失敗しました');
    } finally {
      conn.release();
    }
  });
});

router.get('/', async (req, res) => {
  try {
    const clauses = [];
    const params = [];
    if (req.query.target_year_month) { clauses.push('b.target_year_month=?'); params.push(String(req.query.target_year_month)); }
    if (req.query.status) { clauses.push('b.status=?'); params.push(String(req.query.status)); }
    const rows = await query(
      `SELECT b.*,u.display_name AS created_by_name,f.original_filename
         FROM daily_report_import_batches b
         LEFT JOIN users u ON u.user_id=b.created_by_user_id
         LEFT JOIN daily_report_import_files f ON f.daily_report_import_batch_id=b.daily_report_import_batch_id AND f.parent_file_id IS NULL
        ${clauses.length ? `WHERE ${clauses.join(' AND ')}` : ''}
        ORDER BY b.daily_report_import_batch_id DESC LIMIT 100`,
      params
    );
    return res.json({ ok: true, batches: rows.map(hydrate) });
  } catch (error) { return routeError(res, error, '取込履歴の取得に失敗しました'); }
});

router.get('/fields', (_req, res) => res.json({ ok: true, fields: IMPORT_FIELDS }));

router.get('/mappings', async (_req, res) => {
  try {
    const rows = await query("SELECT * FROM daily_report_import_mappings WHERE source_type='excel' AND is_active=1 AND is_deleted=0 ORDER BY mapping_name");
    return res.json({ ok: true, mappings: rows.map(hydrate) });
  } catch (error) { return routeError(res, error, '列マッピングの取得に失敗しました'); }
});

router.post('/mappings', requireImportEditor, async (req, res) => {
  try {
    const name = String(req.body.mapping_name || '').trim();
    const mapping = req.body.mapping;
    if (!name || !mapping || typeof mapping !== 'object') throw badRequest('マッピング名と列対応は必須です');
    const [result] = await getPool().query(
      `INSERT INTO daily_report_import_mappings
        (mapping_name,source_type,filename_pattern,sheet_pattern,header_row,mapping_json,created_by_user_id)
       VALUES (?,'excel',?,?,?,?,?)`,
      [name, req.body.filename_pattern || null, req.body.sheet_pattern || null, Number(req.body.header_row || 1), JSON.stringify(mapping), req.session.user.user_id]
    );
    return res.status(201).json({ ok: true, mapping_id: Number(result.insertId) });
  } catch (error) { return routeError(res, error, '列マッピングの保存に失敗しました'); }
});

router.get('/files/:fileId', async (req, res) => {
  try {
    const rows = await query('SELECT * FROM daily_report_import_files WHERE daily_report_import_file_id=? AND is_active=1 AND deleted_at IS NULL', [Number(req.params.fileId)]);
    if (!rows.length) return res.status(404).json({ ok: false, message: '原本ファイルが見つかりません' });
    const file = rows[0];
    const resolved = path.resolve(file.storage_path);
    const root = path.resolve(IMPORT_DIR);
    if (resolved !== root && !resolved.startsWith(`${root}${path.sep}`)) return res.status(400).json({ ok: false, message: '保存先が不正です' });
    await getPool().query(
      `INSERT INTO daily_report_import_audit_logs
        (daily_report_import_batch_id,daily_report_import_file_id,action_code,actor_user_id)
       VALUES (?,?,'download',?)`,
      [file.daily_report_import_batch_id, file.daily_report_import_file_id, req.session.user.user_id]
    );
    return res.download(resolved, file.original_filename);
  } catch (error) { return routeError(res, error, '原本ファイルの取得に失敗しました'); }
});

router.get('/:id/setup', async (req, res) => {
  try {
    const result = await fetchBatch(Number(req.params.id));
    if (!result) return res.status(404).json({ ok: false, message: '取込バッチが見つかりません' });
    if (result.batch.status !== 'uploaded') throw badRequest('列マッピング済みの取込です');
    const file = result.files[0];
    const source = await readSourceFile(file.storage_path, req.query.sheet_name);
    const headerRow = Math.max(1, Number(req.query.header_row || 1));
    const headers = (source.rows[headerRow - 1] || []).map((value, index) => String(value ?? `列${index + 1}`));
    return res.json({
      ok: true,
      batch_id: Number(result.batch.daily_report_import_batch_id),
      file_id: Number(file.daily_report_import_file_id),
      original_filename: file.original_filename,
      sheet_names: source.sheetNames,
      selected_sheet: source.sheetName,
      header_row: headerRow,
      headers,
      inferred_mapping: inferMapping(headers),
      preview_rows: source.rows.slice(0, 11).map((row) => row.map((value) => value instanceof Date ? value.toISOString() : value)),
    });
  } catch (error) { return routeError(res, error, '取込設定の取得に失敗しました'); }
});

router.post('/:id/parse', requireImportEditor, async (req, res) => {
  const batchId = Number(req.params.id);
  const conn = await getPool().getConnection();
  try {
    await conn.beginTransaction();
    const [batches] = await conn.query('SELECT * FROM daily_report_import_batches WHERE daily_report_import_batch_id=? FOR UPDATE', [batchId]);
    if (!batches.length) throw requestError(404, '取込バッチが見つかりません', 'not_found');
    if (['applied', 'cancelled'].includes(batches[0].status)) throw badRequest('反映済みまたは取消済みの取込は再解析できません');
    const [files] = await conn.query('SELECT * FROM daily_report_import_files WHERE daily_report_import_batch_id=? AND is_active=1 ORDER BY daily_report_import_file_id LIMIT 1', [batchId]);
    if (!files.length) throw badRequest('取込ファイルが見つかりません');
    const headerRow = Math.max(1, Number(req.body.header_row || 1));
    const mapping = req.body.mapping && typeof req.body.mapping === 'object' ? req.body.mapping : {};
    const source = await readSourceFile(files[0].storage_path, req.body.sheet_name);
    if (source.rows.length > MAX_ROWS + headerRow) throw badRequest(`データ行は${MAX_ROWS.toLocaleString()}件までです`, 'row_limit_exceeded');
    if (source.rows.some((row) => row.length > MAX_COLUMNS)) throw badRequest(`列数は${MAX_COLUMNS}列までです`, 'column_limit_exceeded');
    const built = buildImportRows(source.rows, { headerRow, mapping });
    if (!built.rows.length) throw badRequest('取り込めるデータ行がありません');
    const projects = await activeProjects(conn);
    await conn.query('DELETE FROM daily_report_import_rows WHERE daily_report_import_batch_id=? AND daily_report_id IS NULL', [batchId]);
    let minMonth = null;
    let mixedMonth = false;
    for (const row of built.rows) {
      if (!row.parsedData.project_id && req.body.default_project_id) row.parsedData.project_id = Number(req.body.default_project_id);
      const validation = validateParsedRow(row.parsedData);
      const errors = [...validation.errors];
      const warnings = [...validation.warnings];
      const matched = matchProject(row.parsedData, projects);
      if (matched.error) errors.push(matched.error);
      const month = row.parsedData.work_date?.slice(0, 7) || null;
      if (month && minMonth && month !== minMonth) mixedMonth = true;
      if (month && !minMonth) minMonth = month;
      const rowFingerprint = fingerprint(row.parsedData);
      const [duplicates] = await conn.query("SELECT daily_report_import_row_id,daily_report_id FROM daily_report_import_rows WHERE row_fingerprint=? AND status='applied' LIMIT 1", [rowFingerprint]);
      if (duplicates.length) warnings.push(`同じ内容が日報#${duplicates[0].daily_report_id}へ反映済みです`);
      if (matched.project && row.parsedData.work_date) {
        const [sameDay] = await conn.query('SELECT daily_report_id,status FROM daily_reports WHERE project_id=? AND work_date=? AND is_deleted=0 LIMIT 5', [matched.project.project_id, row.parsedData.work_date]);
        if (sameDay.length) warnings.push(`同じ案件・勤務日に${sameDay.length}件の日報があります`);
      }
      const status = errors.length ? 'error' : warnings.length ? 'warning' : 'ready';
      await insertImportRow(conn, [
        batchId, files[0].daily_report_import_file_id, source.sheetName, row.sourceRowNumber, status,
        JSON.stringify(row.rawData), JSON.stringify(row.parsedData), JSON.stringify(row.parsedData),
        JSON.stringify(errors), JSON.stringify(warnings), matched.project?.project_id || null,
        matched.project?.partner_id || null, matched.reason, rowFingerprint,
        JSON.stringify({ mapping: built.mapping, headers: built.headers }),
      ]);
    }
    await conn.query(
      `UPDATE daily_report_import_batches SET status='needs_review',target_year_month=?,mapping_template_id=?,
       parser_name=?,parser_version='6',parsed_at=CURRENT_TIMESTAMP,error_summary=NULL,extra_data=?
       WHERE daily_report_import_batch_id=?`,
      [mixedMonth ? null : minMonth, req.body.mapping_template_id || null, path.extname(files[0].original_filename).toLowerCase() === '.csv' ? 'csv-parser' : 'read-excel-file', JSON.stringify({ sheet_name: source.sheetName, header_row: headerRow, mapping: built.mapping, headers: built.headers }), batchId]
    );
    await updateBatchCounts(conn, batchId);
    await insertImportAudit(conn, [batchId, files[0].daily_report_import_file_id, null, 'parse', null, JSON.stringify({ sheet_name: source.sheetName, header_row: headerRow, mapping: built.mapping, row_count: built.rows.length }), null, req.session.user.user_id]);
    await conn.commit();
    return res.json({ ok: true, ...(await fetchBatch(batchId)) });
  } catch (error) {
    await conn.rollback().catch(() => {});
    return routeError(res, error, 'Excel／CSVの解析に失敗しました');
  } finally { conn.release(); }
});

router.put('/:id/rows/:rowId', requireImportEditor, async (req, res) => {
  const conn = await getPool().getConnection();
  try {
    await conn.beginTransaction();
    const batchId = Number(req.params.id);
    const rowId = Number(req.params.rowId);
    const [rows] = await conn.query('SELECT * FROM daily_report_import_rows WHERE daily_report_import_row_id=? AND daily_report_import_batch_id=? FOR UPDATE', [rowId, batchId]);
    if (!rows.length) throw requestError(404, '取込行が見つかりません', 'not_found');
    if (rows[0].status === 'applied') throw badRequest('反映済みの取込行は変更できません');
    const data = req.body.reviewed_data && typeof req.body.reviewed_data === 'object' ? req.body.reviewed_data : {};
    const validation = validateParsedRow(data);
    const projects = await activeProjects(conn);
    const matched = matchProject(data, projects);
    if (matched.error) validation.errors.push(matched.error);
    const warnings = [...validation.warnings];
    if (matched.project && data.work_date) {
      const [sameDay] = await conn.query('SELECT daily_report_id,status FROM daily_reports WHERE project_id=? AND work_date=? AND is_deleted=0 LIMIT 5', [matched.project.project_id, data.work_date]);
      if (sameDay.length) warnings.push(`同じ案件・勤務日に${sameDay.length}件の日報があります`);
    }
    const status = req.body.skip ? 'skipped' : validation.errors.length ? 'error' : warnings.length ? 'warning' : 'ready';
    const expectedVersion = Number(req.body.version || rows[0].version);
    const [result] = await conn.query(
      `UPDATE daily_report_import_rows SET reviewed_data=?,status=?,validation_errors=?,validation_warnings=?,row_fingerprint=?,
       matched_project_id=?,matched_partner_id=?,match_reason=?,reviewed_by_user_id=?,reviewed_at=CURRENT_TIMESTAMP,
       version=version+1 WHERE daily_report_import_row_id=? AND version=?`,
      [JSON.stringify(data), status, JSON.stringify(validation.errors), JSON.stringify(warnings), fingerprint(data), matched.project?.project_id || null,
        matched.project?.partner_id || null, matched.reason, req.session.user.user_id, rowId, expectedVersion]
    );
    if (!result.affectedRows) throw requestError(409, '他の利用者が更新しました。再読込してください', 'version_conflict');
    await insertImportAudit(conn, [batchId, rows[0].source_file_id, rowId, 'review', JSON.stringify(parseJson(rows[0].reviewed_data, null)), JSON.stringify(data), null, req.session.user.user_id]);
    await updateBatchCounts(conn, batchId);
    const [updated] = await conn.query('SELECT * FROM daily_report_import_rows WHERE daily_report_import_row_id=?', [rowId]);
    await conn.commit();
    return res.json({ ok: true, row: hydrate(updated[0]) });
  } catch (error) {
    await conn.rollback().catch(() => {});
    return routeError(res, error, '取込行の更新に失敗しました');
  }
  finally { conn.release(); }
});

router.post('/:id/apply', requireImportEditor, async (req, res) => {
  const batchId = Number(req.params.id);
  const rowIds = [...new Set((Array.isArray(req.body.row_ids) ? req.body.row_ids : []).map(Number).filter(Boolean))];
  const allowSameDay = new Set((Array.isArray(req.body.allow_same_day_row_ids) ? req.body.allow_same_day_row_ids : []).map(Number));
  if (!rowIds.length) return res.status(400).json({ ok: false, message: '反映する行を選択してください' });
  const conn = await getPool().getConnection();
  try {
    await conn.beginTransaction();
    const [batches] = await conn.query('SELECT * FROM daily_report_import_batches WHERE daily_report_import_batch_id=? FOR UPDATE', [batchId]);
    if (!batches.length) throw badRequest('取込バッチが見つかりません');
    if (batches[0].status === 'cancelled') throw badRequest('取消済みの取込は反映できません');
    const [rows] = await conn.query(
      `SELECT * FROM daily_report_import_rows WHERE daily_report_import_batch_id=?
       AND daily_report_import_row_id IN (${rowIds.map(() => '?').join(',')}) FOR UPDATE`,
      [batchId, ...rowIds]
    );
    if (rows.length !== rowIds.length) throw badRequest('選択した取込行に存在しない行が含まれます');
    const applied = [];
    for (const rawRow of rows) {
      const row = hydrate(rawRow);
      if (!['ready', 'warning'].includes(row.status)) throw badRequest(`行${row.source_row_number}はエラーを解消してから反映してください`);
      if (row.status === 'warning' && !req.body.acknowledge_warnings) throw badRequest('警告内容を確認してから反映してください', 'warnings_require_acknowledgement');
      const data = row.reviewed_data || row.parsed_data;
      const [alreadyApplied] = await conn.query(
        "SELECT daily_report_id FROM daily_report_import_rows WHERE row_fingerprint=? AND status='applied' AND daily_report_import_row_id<>? LIMIT 1 FOR UPDATE",
        [row.row_fingerprint, row.daily_report_import_row_id]
      );
      if (alreadyApplied.length) throw badRequest(`行${row.source_row_number}と同じ内容は日報#${alreadyApplied[0].daily_report_id}へ反映済みです`, 'duplicate_row');
      const [projects] = await conn.query('SELECT * FROM projects WHERE project_id=? AND is_deleted=0 LIMIT 1', [row.matched_project_id]);
      if (!projects.length) throw badRequest(`行${row.source_row_number}の案件が見つかりません`);
      const project = projects[0];
      const [monthly] = await conn.query(
        `SELECT status FROM daily_report_monthly_approvals WHERE project_id=? AND target_year_month=?
         ORDER BY approval_version DESC LIMIT 1 FOR UPDATE`,
        [project.project_id, data.work_date.slice(0, 7)]
      );
      if (monthly.length && ['submitted', 'approved'].includes(monthly[0].status)) throw badRequest(`行${row.source_row_number}の対象月は承認処理中または承認済みです`);
      const [sameDay] = await conn.query('SELECT daily_report_id,status,billing_status,payment_status FROM daily_reports WHERE project_id=? AND work_date=? AND is_deleted=0 FOR UPDATE', [project.project_id, data.work_date]);
      if (sameDay.some((item) => ['confirmed', 'approved'].includes(item.status))) throw badRequest(`行${row.source_row_number}と同じ日に確認済みの日報があります`);
      if (sameDay.some((item) => !['none', null].includes(item.billing_status) || !['none', null].includes(item.payment_status))) throw badRequest(`行${row.source_row_number}と同じ日に精算処理中または処理済みの日報があります`);
      if (sameDay.length && !allowSameDay.has(Number(row.daily_report_import_row_id))) throw badRequest(`行${row.source_row_number}と同じ案件・勤務日の日報があります。同日追加を確認してください`, 'same_day_confirmation_required');
      const input = {
        project_id: Number(project.project_id),
        company_id: Number(project.company_id),
        partner_id: project.partner_id ? Number(project.partner_id) : null,
        target_year_month: data.work_date.slice(0, 7),
        work_date: data.work_date,
        start_time: data.start_time || null,
        end_time: data.end_time || null,
        break_minutes: Number(data.break_minutes || 0),
        is_absent: data.is_absent ? 1 : 0,
        is_training: data.is_training ? 1 : 0,
        total_distance: data.total_distance == null ? null : Number(data.total_distance),
        toll_fee: data.toll_fee == null ? null : Number(data.toll_fee),
        parking_fee: data.parking_fee == null ? null : Number(data.parking_fee),
        transport_fee: data.transport_fee == null ? null : Number(data.transport_fee),
        row_comment: data.row_comment || null,
        input_source_type: batches[0].source_type,
      };
      const calculated = await applyDailyPriceCalc(input);
      const insertData = {};
      for (const key of DAILY_INPUT_FIELDS) if (Object.prototype.hasOwnProperty.call(input, key)) insertData[key] = input[key];
      for (const key of DAILY_SYSTEM_FIELDS) if (Object.prototype.hasOwnProperty.call(calculated, key)) insertData[key] = calculated[key];
      for (const key of ['calculation_detail']) if (insertData[key] && typeof insertData[key] !== 'string') insertData[key] = JSON.stringify(insertData[key]);
      const columns = Object.keys(insertData);
      const [created] = await conn.query(
        `INSERT INTO daily_reports (${columns.join(',')}) VALUES (${columns.map(() => '?').join(',')})`,
        columns.map((key) => insertData[key])
      );
      const reportId = Number(created.insertId);
      await conn.query(
        `INSERT INTO daily_report_audit_logs
          (daily_report_id,action_code,before_data,after_data,reason,actor_user_id)
         VALUES (?,'import_create',NULL,?,'Excel／CSV取込',?)`,
        [reportId, JSON.stringify({ import_batch_id: batchId, import_row_id: row.daily_report_import_row_id, input }), req.session.user.user_id]
      );
      await insertImportAudit(conn, [batchId, row.source_file_id, row.daily_report_import_row_id, 'apply', JSON.stringify(data), JSON.stringify({ daily_report_id: reportId }), null, req.session.user.user_id]);
      await conn.query(
        `UPDATE daily_report_import_rows SET status='applied',daily_report_id=?,applied_by_user_id=?,applied_at=CURRENT_TIMESTAMP,version=version+1
         WHERE daily_report_import_row_id=?`,
        [reportId, req.session.user.user_id, row.daily_report_import_row_id]
      );
      applied.push({ row_id: Number(row.daily_report_import_row_id), daily_report_id: reportId });
    }
    await updateBatchCounts(conn, batchId);
    const [remaining] = await conn.query("SELECT COUNT(*) count FROM daily_report_import_rows WHERE daily_report_import_batch_id=? AND status NOT IN ('applied','skipped')", [batchId]);
    await conn.query(
      `UPDATE daily_report_import_batches SET status=?,completed_at=IF(?='applied',CURRENT_TIMESTAMP,NULL) WHERE daily_report_import_batch_id=?`,
      [Number(remaining[0].count) === 0 ? 'applied' : 'partial', Number(remaining[0].count) === 0 ? 'applied' : 'partial', batchId]
    );
    await conn.commit();
    return res.json({ ok: true, applied });
  } catch (error) {
    await conn.rollback().catch(() => {});
    return routeError(res, error, '日報への反映に失敗しました');
  } finally { conn.release(); }
});

router.post('/:id/cancel', requireImportEditor, async (req, res) => {
  const conn = await getPool().getConnection();
  try {
    const reason = String(req.body.reason || '').trim();
    if (!reason) throw badRequest('取消理由は必須です');
    await conn.beginTransaction();
    const [result] = await conn.query(
      `UPDATE daily_report_import_batches SET status='cancelled',cancelled_at=CURRENT_TIMESTAMP,
       cancelled_by_user_id=?,cancellation_reason=? WHERE daily_report_import_batch_id=? AND applied_count=0 AND status<>'cancelled'`,
      [req.session.user.user_id, reason, Number(req.params.id)]
    );
    if (!result.affectedRows) throw badRequest('反映済みの取込は取消できません');
    await conn.query(
      `INSERT INTO daily_report_import_audit_logs
        (daily_report_import_batch_id,action_code,reason,actor_user_id) VALUES (?,'cancel',?,?)`,
      [Number(req.params.id), reason, req.session.user.user_id]
    );
    await conn.commit();
    return res.json({ ok: true });
  } catch (error) {
    await conn.rollback().catch(() => {});
    return routeError(res, error, '取込の取消に失敗しました');
  } finally { conn.release(); }
});

router.get('/:id', async (req, res) => {
  try {
    const result = await fetchBatch(Number(req.params.id));
    if (!result) return res.status(404).json({ ok: false, message: '取込バッチが見つかりません' });
    return res.json({ ok: true, ...result });
  } catch (error) { return routeError(res, error, '取込内容の取得に失敗しました'); }
});

router.IMPORT_DIR = IMPORT_DIR;
module.exports = router;
