const express = require('express');
const multer = require('multer');
const os = require('node:os');
const path = require('node:path');
const fs = require('node:fs/promises');
const crypto = require('node:crypto');
const unzipper = require('unzipper');
const { getPool } = require('../db');
const { requireAuth, requirePermission } = require('../middleware/auth');
const { transformSourceWorkbook, workbookBuffer, parseCompletedWorkbook } = require('../services/master_data_workbook');
const { validateRows, classifyRows, commitRows } = require('../services/master_data_import');

const router = express.Router();
router.use(requireAuth, requirePermission('master_data_preparation'));

const TTL_MS = 30 * 60 * 1000;
const MAX_FILE_SIZE = 25 * 1024 * 1024;
const downloads = new Map();
const previews = new Map();
const errors = new Map();
const upload = multer({ dest: path.join(os.tmpdir(), 'links-master-import'), limits: { fileSize: MAX_FILE_SIZE, files: 1 }, fileFilter: (_req, file, callback) => callback(path.extname(file.originalname || '').toLowerCase() === '.xlsx' ? null : new Error('取り込める形式は.xlsxだけです'), path.extname(file.originalname || '').toLowerCase() === '.xlsx') });

function token() { return crypto.randomBytes(24).toString('base64url'); }
function owner(req) { return `${req.sessionID}:${req.session.user.user_id}`; }
function put(store, req, value) { const id = token(); store.set(id, { owner: owner(req), expires: Date.now() + TTL_MS, value }); return id; }
function take(store, req, id, consume = true) {
  const entry = store.get(id);
  if (!entry || entry.expires < Date.now() || entry.owner !== owner(req)) { if (entry?.expires < Date.now()) store.delete(id); return null; }
  if (consume) store.delete(id); return entry.value;
}
function cleanup() { const now = Date.now(); for (const store of [downloads, previews, errors]) for (const [id, entry] of store) if (entry.expires < now) store.delete(id); }
const cleanupTimer = setInterval(cleanup, 60 * 1000); cleanupTimer.unref();
async function readAndDelete(file) { try { return await fs.readFile(file.path); } finally { await fs.unlink(file.path).catch(() => {}); } }
async function validateXlsxBuffer(input) {
  if (input[0] !== 0x50 || input[1] !== 0x4b) throw new Error('有効な.xlsxファイルではありません');
  const directory = await unzipper.Open.buffer(input);
  const expanded = directory.files.reduce((sum, entry) => sum + Number(entry.vars?.uncompressedSize || 0), 0);
  if (expanded > 200 * 1024 * 1024) throw new Error('Excelの展開後サイズが上限を超えています');
  if (directory.files.some((entry) => /vbaProject\.bin|externalLinks\//i.test(entry.path))) throw new Error('マクロまたは外部リンクを含むExcelは取り込めません');
}
function uploadError(err, _req, res, next) {
  if (!err) return next();
  if (err instanceof multer.MulterError) return res.status(400).json({ ok: false, message: err.code === 'LIMIT_FILE_SIZE' ? 'Excelは25MB以下にしてください' : 'Excelを1ファイル選択してください' });
  if (err.message === '取り込める形式は.xlsxだけです') return res.status(400).json({ ok: false, message: err.message });
  return next(err);
}
function workbookName() { return `master_data_${new Date().toISOString().slice(0, 10).replaceAll('-', '')}.xlsx`; }

router.post('/master-data-preparations', upload.single('file'), uploadError, async (req, res) => {
  if (!req.file) return res.status(400).json({ ok: false, message: 'Excelファイルを選択してください' });
  try {
    const input = await readAndDelete(req.file);
    await validateXlsxBuffer(input);
    const prepared = await transformSourceWorkbook(input);
    const { buffer, summary } = await workbookBuffer(prepared);
    const download_token = put(downloads, req, Buffer.from(buffer));
    return res.json({ ok: true, summary, warning_count: prepared['要確認']?.length || 0, download_token, expires_in_seconds: TTL_MS / 1000 });
  } catch (err) {
    if (req.file) await fs.unlink(req.file.path).catch(() => {});
    return res.status(400).json({ ok: false, message: err.message || '原本Excelの変換に失敗しました' });
  }
});

router.get('/master-data-preparations/:token.xlsx', (req, res) => {
  const buffer = take(downloads, req, req.params.token);
  if (!buffer) return res.status(404).json({ ok: false, message: 'ダウンロード期限切れ、使用済み、または別セッションのトークンです' });
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename="${workbookName()}"`);
  return res.send(buffer);
});

router.post('/master-data-imports/preview', upload.single('file'), uploadError, async (req, res) => {
  if (!req.file) return res.status(400).json({ ok: false, message: '完成Excelを選択してください' });
  let conn;
  try {
    const input = await readAndDelete(req.file);
    await validateXlsxBuffer(input);
    const parsed = await parseCompletedWorkbook(input);
    const validated = validateRows(parsed);
    conn = await getPool().getConnection();
    const preview = await classifyRows(conn, validated);
    const preview_token = put(previews, req, preview);
    const issueRows = preview.rows.filter((r) => ['error', 'dependency_error', 'conflict'].includes(r.status));
    let error_download_token = null;
    if (issueRows.length) {
      const errorData = Object.fromEntries(Object.keys(parsed).map((name) => [name, issueRows.filter((r) => r.sheet === name).map((r) => ({ ...r.row, input_status: r.status, review_reason: r.errors.join(' / ') }))]));
      errorData['要確認'] = issueRows.flatMap((r) => r.errors.map((message) => [r.sheet, r.key, message, r.row.source_sheet || '', r.row.source_row || r.row.__row]));
      const built = await workbookBuffer(errorData); error_download_token = put(errors, req, Buffer.from(built.buffer));
    }
    return res.json({ ok: true, counts: preview.counts, rows: preview.rows.map((r) => ({ sheet: r.sheet, row: r.row.__row, import_key: r.key, status: r.status, messages: r.errors })), preview_token, error_download_token, expires_in_seconds: TTL_MS / 1000 });
  } catch (err) {
    if (req.file) await fs.unlink(req.file.path).catch(() => {});
    return res.status(400).json({ ok: false, message: err.message || '完成Excelの検証に失敗しました' });
  } finally { conn?.release(); }
});

router.get('/master-data-imports/:token/errors.xlsx', (req, res) => {
  const buffer = take(errors, req, req.params.token);
  if (!buffer) return res.status(404).json({ ok: false, message: 'エラーExcelの期限切れ、使用済み、または別セッションです' });
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', 'attachment; filename="master_data_errors.xlsx"');
  return res.send(buffer);
});

router.post('/master-data-imports/:token/commit', async (req, res) => {
  const preview = take(previews, req, req.params.token);
  if (!preview) return res.status(404).json({ ok: false, message: '登録トークンの期限切れ、使用済み、または別セッションです' });
  const conn = await getPool().getConnection();
  try {
    await conn.beginTransaction();
    const result = await commitRows(conn, preview, Number(req.session.user.user_id));
    await conn.commit();
    return res.json({ ok: true, ...result });
  } catch (err) {
    await conn.rollback();
    return res.status(err.code === 'version_conflict' ? 409 : 500).json({ ok: false, message: err.code === 'version_conflict' ? err.message : 'DB登録に失敗したため、今回の正常行をすべて取り消しました' });
  } finally { conn.release(); }
});

module.exports = router;
