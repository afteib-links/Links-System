const express = require('express');
const { query, getPool } = require('../db');
const { requireAuth, requirePermission } = require('../middleware/auth');
const { hasPermission } = require('../permissions');
const { invalid, json, validateDefinition, validateSamples, validDate } = require('../services/fee_logic');
const router = express.Router();
router.use(requireAuth);
function failure(res, error) {
  if (!error.status) console.error('[fee_logic]', error);
  return res.status(error.status || 500).json({ ok: false, message: error.status ? error.message : '料金ロジックの処理に失敗しました' });
}
router.get('/', requirePermission('calculation_rules', 'price_sets', 'master_settings'), async (req, res) => {
  try {
    const masters = await query('SELECT * FROM fee_logic_masters ORDER BY kind,code');
    const versions = await query('SELECT * FROM fee_logic_versions ORDER BY master_code,version_no DESC');
    return res.json({ ok: true, can_edit: hasPermission(req.session.user, 'calculation_rules'), masters: masters.map((master) => ({ ...master, versions: versions.filter((v) => v.master_code === master.code).map((v) => ({ ...v, definition_json: json(v.definition_json) })) })) });
  } catch (error) { return failure(res, error); }
});
router.post('/:code/preview', requirePermission('calculation_rules'), async (req, res) => {
  try {
    const [master] = await query('SELECT * FROM fee_logic_masters WHERE code=?', [req.params.code]);
    if (!master) throw invalid('マスターがありません', 404);
    const definition = validateDefinition(master.kind, req.body.definition);
    const results = master.kind === 'logic' ? validateSamples(master.code, definition, req.body.samples) : [];
    return res.json({ ok: true, definition, results });
  } catch (error) { return failure(res, error); }
});
router.post('/:code/versions', requirePermission('calculation_rules'), async (req, res) => {
  let conn;
  try {
    conn = await getPool().getConnection();
    await conn.beginTransaction();
    const [masters] = await conn.query('SELECT * FROM fee_logic_masters WHERE code=? FOR UPDATE', [req.params.code]);
    const master = masters[0];
    if (!master) throw invalid('マスターがありません', 404);
    const [versions] = await conn.query('SELECT * FROM fee_logic_versions WHERE master_code=? ORDER BY version_no DESC LIMIT 1', [master.code]);
    const latest = versions[0];
    if (Number(req.body.previous_version) !== Number(latest?.version_no)) throw invalid('別の利用者が公開しました。再読み込みしてください', 409);
    const start = req.body.effective_from;
    if (!validDate(start) || start <= String(latest.effective_from).slice(0, 10)) throw invalid('適用開始日は最終公開版より後の日付を指定してください');
    const reason = String(req.body.reason || '').trim();
    if (!reason || reason.length > 1000) throw invalid('変更理由を1～1000文字で入力してください');
    const definition = validateDefinition(master.kind, req.body.definition);
    const samples = master.kind === 'logic' ? validateSamples(master.code, definition, req.body.samples) : [];
    const [created] = await conn.query('INSERT INTO fee_logic_versions(master_code,version_no,effective_from,definition_json,reason,actor_user_id) VALUES(?,?,?,?,?,?)', [master.code, latest.version_no + 1, start, JSON.stringify({ ...definition, validation_samples: samples }), reason, req.session.user.user_id]);
    await conn.commit();
    return res.status(201).json({ ok: true, id: created.insertId, version_no: latest.version_no + 1 });
  } catch (error) { if (conn) await conn.rollback(); return failure(res, error); }
  finally { if (conn) conn.release(); }
});
module.exports = router;
