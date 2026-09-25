'use strict';
// Default is rollback. Only legacy_analysis metadata is writable here.
const fs = require('node:fs'), crypto = require('node:crypto');
const root = process.env.LEGACY_APP_ROOT || '/app/backend';
const { getPool } = require(`${root}/src/db`);
const { verifySemanticModel } = require(`${root}/src/services/legacy_semantic_amount`);
const read = p => JSON.parse(fs.readFileSync(p, 'utf8').replace(/^\uFEFF/, ''));
const hash = p => crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');
const object = x => typeof x === 'string' ? JSON.parse(x) : x || {};
const canonical = x => Array.isArray(x) ? x.map(canonical) : x && typeof x === 'object' ? Object.fromEntries(Object.keys(x).sort().map(k => [k, canonical(x[k])])) : x;
const equal = (a, b) => JSON.stringify(canonical(a)) === JSON.stringify(canonical(b));

async function main() {
  const [planPath, snapshotPath, backupPath, backupHash, mode] = process.argv.slice(2);
  const plan = read(planPath), before = read(snapshotPath), commit = mode === '--commit';
  if (hash(snapshotPath) !== plan.snapshot_sha256) throw new Error('Snapshot checksum mismatch');
  if (commit && (!backupPath || fs.statSync(backupPath).size < 1000 || hash(backupPath) !== backupHash)) throw new Error('Full verified backup required');
  const pool = getPool(), conn = await pool.getConnection();
  const report = { mode: commit ? 'committed' : 'dry_run_rolled_back', sets: 0, rules: 0, matched: 0, unavailable: 0, mismatches: [], pending: 0, already_applied: 0, plan_sha256: hash(planPath), backup_sha256: backupHash || null };
  try {
    await conn.beginTransaction();
    const [rows] = await conn.query('SELECT * FROM price_sets FOR UPDATE');
    for (const change of plan.updates) {
      const current = rows.find(r => r.price_set_id === change.price_set_id);
      const prior = before.tables.price_sets.find(r => r.price_set_id === change.price_set_id);
      if (!current || current.is_deleted) throw new Error('Rate disappeared or was deleted');
      const extra = object(current.extra_data), analysis = extra.legacy_analysis;
      if (analysis?.import_key !== change.import_key) throw new Error('Import identity changed');
      const validation = verifySemanticModel(change.semantic_model);
      const model = { ...change.semantic_model, verification: validation };
      const pending = change.calculation_status === 'review_required' || validation.mismatches.length || validation.unavailable;
      const status = pending ? 'review_required' : 'ready';
      if (equal(analysis.semantic_model, model) && analysis.calculation_status === status) { report.already_applied++; continue; }
      if (!equal(current, prior)) throw new Error(`Concurrent change in price set ${current.price_set_id}`);
      const ownerTable = current.project_id ? 'projects' : 'base_projects';
      const ownerKey = current.project_id ? 'project_id' : 'base_project_id';
      const [[owner]] = await conn.query(`SELECT is_deleted FROM ${ownerTable} WHERE ${ownerKey}=? FOR UPDATE`, [current[ownerKey]]);
      if (!owner || owner.is_deleted) throw new Error('Owner is no longer active');
      const updated = { ...extra, legacy_analysis: { ...analysis, semantic_model: model, calculation_status: status } };
      const [result] = await conn.query('UPDATE price_sets SET extra_data=?,version=version+1,updated_at=CURRENT_TIMESTAMP WHERE price_set_id=? AND version=? AND is_deleted=0', [JSON.stringify(updated), current.price_set_id, current.version]);
      if (result.affectedRows !== 1) throw new Error('Optimistic lock failed');
      await conn.query('INSERT INTO price_set_revision_audit_logs (price_set_id,action_code,before_data,after_data,reason) VALUES (?,?,?,?,?)',
        [current.price_set_id, 'semantic_register', JSON.stringify({legacy_analysis: analysis}), JSON.stringify({legacy_analysis: updated.legacy_analysis}), '原本の計算項目・数量・単価・控除と丸めの意味を登録。実績金額は変更しない']);
      const [[saved]] = await conn.query('SELECT extra_data FROM price_sets WHERE price_set_id=?', [current.price_set_id]);
      if (!equal(object(saved.extra_data), updated)) throw new Error('Read-back mismatch');
      report.sets++; report.rules += model.rules.length; report.matched += validation.matched;
      report.unavailable += validation.unavailable; report.mismatches.push(...validation.mismatches.map(m => ({price_set_id: current.price_set_id, ...m})));
      if (pending) report.pending++;
    }
    if (commit) await conn.commit(); else await conn.rollback();
    console.log(JSON.stringify(report));
  } catch (error) { await conn.rollback(); throw error; }
  finally { conn.release(); await pool.end(); }
}
main().catch(e => { console.error(e.stack); process.exitCode = 1; });
