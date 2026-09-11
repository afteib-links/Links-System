const express = require('express');
const { randomUUID } = require('node:crypto');
const multer = require('multer');
const { query } = require('../db');
const { requireAuth, requireRole } = require('../middleware/auth');
const model = require('../services/test_data/model');
const imports = require('../services/test_data/imports');
const { loadRegisteredCatalog } = require('../services/test_data/registered_masters');
const { createGenerationService } = require('../services/test_data/generation');

function enabled(env = process.env) {
  return env.LINKS_ENV === 'verification' && env.TEST_DATA_TOOL_ENABLED === 'true' && env.NODE_ENV !== 'production'
    && /^links_verification_tool_[a-z0-9_]+$/.test(env.DB_NAME || '');
}
function createRouter(runQuery = query, env = process.env, suppliedGeneration = null) {
  const router = express.Router();
  const generation = suppliedGeneration || createGenerationService({ runQuery });
  router.use((req, res, next) => enabled(env) ? next() : res.sendStatus(404));
  router.use(requireAuth, requireRole('admin'));
  router.use((req, res, next) => {
    res.setHeader('Cache-Control', 'no-store');
    if (req.get('Sec-Fetch-Site') === 'cross-site') return res.sendStatus(403);
    next();
  });
  const wrap = fn => (req, res, next) => Promise.resolve(fn(req, res)).catch(next);
  const getDraft = async id => {
    if (!/^[0-9a-f-]{36}$/.test(id)) model.fail('設定IDが不正です');
    const rows = await runQuery('SELECT * FROM test_data_drafts WHERE draft_id = ?', [id]);
    if (!rows.length) { const e = new Error('設定が見つかりません'); e.status = 404; throw e; }
    const r = rows[0]; return { id: r.draft_id, revision: r.revision, config: JSON.parse(r.payload_json), approvedHash: r.approved_hash };
  };
  router.get('/meta', (req, res) => res.json({ ok: true, defaults: model.defaults(), cases: model.CASES, presets: model.PRESETS,
    fields: Object.keys(imports.FIELDS), importFields: require('../services/test_data/fields').IMPORT_FIELDS, types: model.LABELS, generationAvailable: true, stage: 'daily_reports' }));
  const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 2 * 1024 * 1024, files: 5, fields: 1, parts: 6 } });
  router.post('/imports', upload.array('files', 5), wrap(async (req, res) => res.json({ ok: true, sheets: await imports.parseFiles(req.files || [], req.body.encoding || 'utf8') })));
  router.post('/normalize', wrap(async (req, res) => res.json({ ok: true, ...imports.normalize(req.body.sheets) })));
  router.get('/registered-masters', wrap(async (req, res) => res.json({ ok: true, ...(await loadRegisteredCatalog(runQuery)) })));
  router.get('/drafts', wrap(async (req, res) => res.json({ ok: true, drafts: await runQuery('SELECT draft_id, revision, approved_hash, updated_at FROM test_data_drafts ORDER BY updated_at DESC LIMIT 100') })));
  router.post('/drafts', wrap(async (req, res) => {
    const config = model.validate(req.body.config); model.catalogs(config);
    const id = randomUUID();
    await runQuery('INSERT INTO test_data_drafts (draft_id, payload_json, created_by) VALUES (?, ?, ?)', [id, JSON.stringify(config), req.session.user.user_id]);
    res.status(201).json({ ok: true, draft: await getDraft(id) });
  }));
  router.get('/drafts/:id', wrap(async (req, res) => res.json({ ok: true, draft: await getDraft(req.params.id) })));
  router.put('/drafts/:id', wrap(async (req, res) => {
    const config = model.validate(req.body.config); model.catalogs(config);
    const result = await runQuery('UPDATE test_data_drafts SET payload_json = ?, revision = revision + 1, approved_hash = NULL, updated_at = CURRENT_TIMESTAMP(3) WHERE draft_id = ? AND revision = ?',
      [JSON.stringify(config), req.params.id, req.body.revision]);
    if (result.affectedRows !== 1) return res.status(409).json({ ok: false, message: '他の更新があります。再読込してください' });
    res.json({ ok: true, draft: await getDraft(req.params.id) });
  }));
  router.post('/drafts/:id/preview', wrap(async (req, res) => {
    const d = await getDraft(req.params.id);
    res.json({ ok: true, revision: d.revision, preview: model.preview(d.config) });
  }));
  router.post('/drafts/:id/approve', wrap(async (req, res) => {
    const d = await getDraft(req.params.id), p = model.preview(d.config);
    if (req.body.revision !== d.revision || req.body.hash !== p.hash || !p.approvable) return res.status(409).json({ ok: false, message: '最新サンプル、必須ケース、補完内容、要調整ケースを確認してください' });
    const result = await runQuery('UPDATE test_data_drafts SET approved_hash = ?, updated_at = CURRENT_TIMESTAMP(3) WHERE draft_id = ? AND revision = ?', [p.hash, d.id, d.revision]);
    if (result.affectedRows !== 1) return res.status(409).json({ ok: false, message: '設定が更新されました' });
    res.json({ ok: true, draft: await getDraft(d.id) });
  }));
  router.get('/drafts/:id/share', wrap(async (req, res) => {
    const d = await getDraft(req.params.id), data = model.share(d.config);
    if (req.query.format === 'csv') {
      res.type('text/csv').attachment('anonymous-daily-sample.csv').send(model.csv(data.preview.reports));
    } else res.json({ ok: true, package: data });
  }));
  router.get('/jobs', wrap(async (req, res) => res.json({ ok: true, jobs: await generation.list() })));
  router.get('/jobs/:id', wrap(async (req, res) => {
    const job = await generation.get(req.params.id);
    if (!job) return res.status(404).json({ ok: false, message: '生成ジョブが見つかりません' });
    return res.json({ ok: true, job });
  }));
  router.post('/drafts/:id/generate', wrap(async (req, res) => {
    const d = await getDraft(req.params.id);
    if (d.approvedHash !== model.hash(d.config)) return res.status(409).json({ ok: false, message: 'サンプル承認が必要です' });
    const job = await generation.enqueue(d, req.session.user.user_id);
    return res.status(job.status === 'completed' ? 200 : 202).json({ ok: true, job });
  }));
  router.use((err, req, res, next) => {
    const status = err.status || (err instanceof multer.MulterError ? 413 : 500);
    res.status(status).json({ ok: false, message: status < 500 ? err.message : '処理に失敗しました。管理テーブルのマイグレーションと入力ファイルを確認してください。' });
  });
  return router;
}
module.exports = { createRouter, enabled };
