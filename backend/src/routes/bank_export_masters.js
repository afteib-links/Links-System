const express = require('express');
const { getPool, query } = require('../db');
const { requireAuth, requireRole } = require('../middleware/auth');
const { SOURCE_FIELDS, validateDefinition } = require('../services/bank_csv_export');

const router = express.Router();
router.use(requireAuth, requireRole('admin', 'system'));

const VALID_BANK_FAMILIES = new Set(['resona', 'mizuho', 'smbc', 'other']);
const VALID_ENCODINGS = new Set(['utf8', 'utf8_bom', 'cp932']);
const VALID_QUOTE_MODES = new Set(['all', 'minimal', 'none']);
const VALID_LINE_ENDINGS = new Set(['crlf', 'lf']);
const VALID_TRANSFORMS = new Set(['none', 'digits', 'half_width', 'katakana', 'upper']);

function bool(value, fallback = true) {
  if (value == null) return fallback ? 1 : 0;
  return value === false || value === 0 || value === '0' ? 0 : 1;
}

function validateAccount(body) {
  const required = ['account_label', 'bank_export_profile_id', 'bank_code', 'bank_name', 'branch_code', 'branch_name', 'deposit_type', 'account_number', 'account_name_kana'];
  const missing = required.filter((key) => !String(body[key] ?? '').trim());
  if (missing.length) throw new Error('振込元口座の必須項目を入力してください');
  if (!/^\d{4}$/.test(String(body.bank_code))) throw new Error('銀行コードは4桁で入力してください');
  if (!/^\d{3}$/.test(String(body.branch_code))) throw new Error('支店コードは3桁で入力してください');
  if (!/^\d{1,20}$/.test(String(body.account_number))) throw new Error('口座番号は数字で入力してください');
}

function normalizeVersion(body) {
  const version = {
    encoding_code: VALID_ENCODINGS.has(body.encoding_code) ? body.encoding_code : 'utf8_bom',
    delimiter_text: String(body.delimiter_text ?? ','),
    quote_mode: VALID_QUOTE_MODES.has(body.quote_mode) ? body.quote_mode : 'all',
    quote_char: String(body.quote_char || '"').slice(0, 1),
    include_header: bool(body.include_header),
    line_ending: VALID_LINE_ENDINGS.has(body.line_ending) ? body.line_ending : 'crlf',
    file_name_pattern: String(body.file_name_pattern || '{bank}_{YYYYMMDD}_{cycle}.csv').trim(),
    verification_note: String(body.verification_note || '').trim() || null,
  };
  if (!version.delimiter_text || version.delimiter_text.length > 8) throw new Error('区切り文字は1〜8文字で入力してください');
  if (!version.quote_char) throw new Error('引用符を入力してください');
  if (!version.file_name_pattern) throw new Error('ファイル名規則を入力してください');
  return version;
}

function normalizeColumns(input) {
  if (!Array.isArray(input)) return [];
  return input.map((column, index) => ({
    column_key: String(column.column_key || `column_${index + 1}`).trim(),
    column_label: String(column.column_label || '').trim(),
    source_key: String(column.source_key || 'blank').trim(),
    fixed_value: column.fixed_value == null ? null : String(column.fixed_value),
    is_required: bool(column.is_required, false),
    format_code: column.format_code ? String(column.format_code) : null,
    zero_pad_length: column.zero_pad_length ? Math.min(1000, Math.max(1, Number(column.zero_pad_length))) : null,
    max_length: column.max_length ? Math.min(10000, Math.max(1, Number(column.max_length))) : null,
    transform_code: VALID_TRANSFORMS.has(column.transform_code) ? column.transform_code : 'none',
    sort_order: (index + 1) * 10,
  }));
}

async function loadVersion(conn, id, lock = false) {
  const suffix = lock ? ' FOR UPDATE' : '';
  const [versions] = await conn.query(
    `SELECT v.*,p.profile_code,p.profile_name,p.bank_family
       FROM bank_export_profile_versions v
       JOIN bank_export_profiles p ON p.bank_export_profile_id=v.bank_export_profile_id
      WHERE v.bank_export_profile_version_id=?${suffix}`,
    [id]
  );
  if (!versions.length) return null;
  const [columns] = await conn.query(
    `SELECT * FROM bank_export_columns WHERE bank_export_profile_version_id=? ORDER BY sort_order,bank_export_column_id`,
    [id]
  );
  return { ...versions[0], columns };
}

router.get('/catalog', async (_req, res) => {
  try {
    const profiles = await query(
      `SELECT p.*,
              (SELECT v.bank_export_profile_version_id FROM bank_export_profile_versions v WHERE v.bank_export_profile_id=p.bank_export_profile_id AND v.status='published' ORDER BY v.version_no DESC LIMIT 1) published_version_id,
              (SELECT v.version_no FROM bank_export_profile_versions v WHERE v.bank_export_profile_id=p.bank_export_profile_id AND v.status='published' ORDER BY v.version_no DESC LIMIT 1) published_version_no,
              (SELECT v.bank_export_profile_version_id FROM bank_export_profile_versions v WHERE v.bank_export_profile_id=p.bank_export_profile_id ORDER BY v.version_no DESC LIMIT 1) latest_version_id,
              (SELECT v.version_no FROM bank_export_profile_versions v WHERE v.bank_export_profile_id=p.bank_export_profile_id ORDER BY v.version_no DESC LIMIT 1) latest_version_no,
              (SELECT v.status FROM bank_export_profile_versions v WHERE v.bank_export_profile_id=p.bank_export_profile_id ORDER BY v.version_no DESC LIMIT 1) latest_version_status
         FROM bank_export_profiles p WHERE p.is_deleted=0 ORDER BY p.bank_export_profile_id`
    );
    const accounts = await query(
      `SELECT a.*,p.profile_name,p.bank_family
         FROM source_bank_accounts a JOIN bank_export_profiles p ON p.bank_export_profile_id=a.bank_export_profile_id
        WHERE a.is_deleted=0 ORDER BY a.account_label,a.source_bank_account_id`
    );
    return res.json({ ok: true, profiles, accounts, source_fields: SOURCE_FIELDS.map(([key, label]) => ({ key, label })) });
  } catch (error) {
    console.error('[bank_export_masters/catalog]', error);
    return res.status(500).json({ ok: false, message: '銀行CSVマスターを取得できませんでした' });
  }
});

router.get('/versions/:id', async (req, res) => {
  try {
    const version = await loadVersion(getPool(), Number(req.params.id));
    if (!version) return res.status(404).json({ ok: false, message: 'プロファイル版が見つかりません' });
    return res.json({ ok: true, version, source_fields: SOURCE_FIELDS.map(([key, label]) => ({ key, label })) });
  } catch (error) {
    return res.status(500).json({ ok: false, message: 'プロファイル版を取得できませんでした' });
  }
});

router.post('/profiles', async (req, res) => {
  try {
    const code = String(req.body.profile_code || '').trim();
    const name = String(req.body.profile_name || '').trim();
    const family = VALID_BANK_FAMILIES.has(req.body.bank_family) ? req.body.bank_family : 'other';
    if (!/^[a-z0-9_]+$/.test(code) || !name) return res.status(400).json({ ok: false, message: 'コードは英小文字・数字・_、名称は必須です' });
    const result = await query(
      `INSERT INTO bank_export_profiles (profile_code,profile_name,bank_family,description,is_active) VALUES (?,?,?,?,?)`,
      [code, name, family, req.body.description || null, bool(req.body.is_active)]
    );
    return res.status(201).json({ ok: true, bank_export_profile_id: result.insertId });
  } catch (error) {
    if (error?.code === 'ER_DUP_ENTRY') return res.status(409).json({ ok: false, message: '同じプロファイルコードが既にあります' });
    return res.status(500).json({ ok: false, message: 'プロファイルを作成できませんでした' });
  }
});

router.put('/profiles/:id', async (req, res) => {
  try {
    const name = String(req.body.profile_name || '').trim();
    if (!name) return res.status(400).json({ ok: false, message: '名称は必須です' });
    const result = await query(
      `UPDATE bank_export_profiles SET profile_name=?,description=?,is_active=?,version=version+1
        WHERE bank_export_profile_id=? AND is_deleted=0 AND version=?`,
      [name, req.body.description || null, bool(req.body.is_active), Number(req.params.id), Number(req.body.version)]
    );
    if (!result.affectedRows) return res.status(409).json({ ok: false, message: '他の利用者が更新しました。再読み込みしてください' });
    return res.json({ ok: true });
  } catch (error) {
    return res.status(500).json({ ok: false, message: 'プロファイルを更新できませんでした' });
  }
});

router.post('/profiles/:id/versions', async (req, res) => {
  const conn = await getPool().getConnection();
  try {
    const profileId = Number(req.params.id);
    await conn.beginTransaction();
    const [profiles] = await conn.query('SELECT * FROM bank_export_profiles WHERE bank_export_profile_id=? AND is_deleted=0 FOR UPDATE', [profileId]);
    if (!profiles.length) throw new Error('プロファイルが見つかりません');
    const [latest] = await conn.query('SELECT * FROM bank_export_profile_versions WHERE bank_export_profile_id=? ORDER BY version_no DESC LIMIT 1 FOR UPDATE', [profileId]);
    if (latest[0]?.status === 'draft') throw new Error('編集中の下書き版が既にあります');
    const nextNo = Number(latest[0]?.version_no || 0) + 1;
    const base = latest[0] || normalizeVersion({});
    const [created] = await conn.query(
      `INSERT INTO bank_export_profile_versions
        (bank_export_profile_id,version_no,status,encoding_code,delimiter_text,quote_mode,quote_char,include_header,line_ending,file_name_pattern,verification_note,created_by)
       VALUES (?,?,'draft',?,?,?,?,?,?,?,?,?)`,
      [profileId, nextNo, base.encoding_code, base.delimiter_text, base.quote_mode, base.quote_char || '"', Number(base.include_header), base.line_ending, base.file_name_pattern, null, req.session.user.user_id]
    );
    if (latest[0]) {
      await conn.query(
        `INSERT INTO bank_export_columns
          (bank_export_profile_version_id,column_key,column_label,source_key,fixed_value,is_required,format_code,zero_pad_length,max_length,transform_code,sort_order)
         SELECT ?,column_key,column_label,source_key,fixed_value,is_required,format_code,zero_pad_length,max_length,transform_code,sort_order
           FROM bank_export_columns WHERE bank_export_profile_version_id=?`,
        [created.insertId, latest[0].bank_export_profile_version_id]
      );
    }
    await conn.commit();
    return res.status(201).json({ ok: true, bank_export_profile_version_id: created.insertId, version_no: nextNo });
  } catch (error) {
    await conn.rollback();
    return res.status(400).json({ ok: false, message: error.message });
  } finally {
    conn.release();
  }
});

router.put('/versions/:id', async (req, res) => {
  const conn = await getPool().getConnection();
  try {
    const id = Number(req.params.id);
    const normalized = normalizeVersion(req.body || {});
    const columns = normalizeColumns(req.body.columns);
    const definitionErrors = validateDefinition(normalized, columns);
    if (definitionErrors.length) return res.status(400).json({ ok: false, message: definitionErrors.join('／') });
    await conn.beginTransaction();
    const version = await loadVersion(conn, id, true);
    if (!version || version.status !== 'draft') throw new Error('公開済み版は編集できません。新しい版を作成してください');
    await conn.query(
      `UPDATE bank_export_profile_versions SET encoding_code=?,delimiter_text=?,quote_mode=?,quote_char=?,include_header=?,line_ending=?,file_name_pattern=?,verification_note=?
        WHERE bank_export_profile_version_id=?`,
      [normalized.encoding_code, normalized.delimiter_text, normalized.quote_mode, normalized.quote_char, normalized.include_header, normalized.line_ending, normalized.file_name_pattern, normalized.verification_note, id]
    );
    await conn.query('DELETE FROM bank_export_columns WHERE bank_export_profile_version_id=?', [id]);
    for (const column of columns) {
      await conn.query(
        `INSERT INTO bank_export_columns
          (bank_export_profile_version_id,column_key,column_label,source_key,fixed_value,is_required,format_code,zero_pad_length,max_length,transform_code,sort_order)
         VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
        [id, column.column_key, column.column_label, column.source_key, column.fixed_value, column.is_required, column.format_code, column.zero_pad_length, column.max_length, column.transform_code, column.sort_order]
      );
    }
    await conn.commit();
    return res.json({ ok: true });
  } catch (error) {
    await conn.rollback();
    return res.status(400).json({ ok: false, message: error.message });
  } finally {
    conn.release();
  }
});

router.post('/versions/:id/publish', async (req, res) => {
  const conn = await getPool().getConnection();
  try {
    const id = Number(req.params.id);
    await conn.beginTransaction();
    const version = await loadVersion(conn, id, true);
    if (!version || version.status !== 'draft') throw new Error('公開できる下書き版がありません');
    const errors = validateDefinition(version, version.columns);
    if (errors.length) throw new Error(errors.join('／'));
    const note = String(req.body.verification_note || version.verification_note || '').trim();
    if (!note) throw new Error('仕様書または取込試験の確認内容を入力してください');
    await conn.query(
      `UPDATE bank_export_profile_versions SET status='retired'
        WHERE bank_export_profile_id=? AND status='published'`,
      [version.bank_export_profile_id]
    );
    await conn.query(
      `UPDATE bank_export_profile_versions SET status='published',verification_note=?,published_at=CURRENT_TIMESTAMP,published_by=?
        WHERE bank_export_profile_version_id=?`,
      [note, req.session.user.user_id, id]
    );
    await conn.commit();
    return res.json({ ok: true });
  } catch (error) {
    await conn.rollback();
    return res.status(400).json({ ok: false, message: error.message });
  } finally {
    conn.release();
  }
});

router.post('/accounts', async (req, res) => {
  try {
    validateAccount(req.body || {});
    const b = req.body;
    const result = await query(
      `INSERT INTO source_bank_accounts
        (account_label,bank_export_profile_id,bank_code,bank_name,branch_code,branch_name,deposit_type,account_number,account_name_kana,client_code,is_active)
       VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
      [b.account_label, Number(b.bank_export_profile_id), b.bank_code, b.bank_name, b.branch_code, b.branch_name, b.deposit_type, b.account_number, b.account_name_kana, b.client_code || null, bool(b.is_active)]
    );
    return res.status(201).json({ ok: true, source_bank_account_id: result.insertId });
  } catch (error) {
    return res.status(400).json({ ok: false, message: error.message });
  }
});

router.put('/accounts/:id', async (req, res) => {
  try {
    validateAccount(req.body || {});
    const b = req.body;
    const result = await query(
      `UPDATE source_bank_accounts SET account_label=?,bank_export_profile_id=?,bank_code=?,bank_name=?,branch_code=?,branch_name=?,deposit_type=?,account_number=?,account_name_kana=?,client_code=?,is_active=?,version=version+1
        WHERE source_bank_account_id=? AND is_deleted=0 AND version=?`,
      [b.account_label, Number(b.bank_export_profile_id), b.bank_code, b.bank_name, b.branch_code, b.branch_name, b.deposit_type, b.account_number, b.account_name_kana, b.client_code || null, bool(b.is_active), Number(req.params.id), Number(b.version)]
    );
    if (!result.affectedRows) return res.status(409).json({ ok: false, message: '他の利用者が更新しました。再読み込みしてください' });
    return res.json({ ok: true });
  } catch (error) {
    return res.status(400).json({ ok: false, message: error.message });
  }
});

router.delete('/accounts/:id', async (req, res) => {
  try {
    const result = await query('UPDATE source_bank_accounts SET is_deleted=1,is_active=0,version=version+1 WHERE source_bank_account_id=? AND is_deleted=0', [Number(req.params.id)]);
    if (!result.affectedRows) return res.status(404).json({ ok: false, message: '振込元口座が見つかりません' });
    return res.json({ ok: true });
  } catch (error) {
    return res.status(400).json({ ok: false, message: '使用履歴がある口座は削除できません。無効にしてください' });
  }
});

module.exports = { router, normalizeColumns, normalizeVersion, validateAccount };

