const express = require('express');
const { getPool, query } = require('../db');
const { requireAuth, requirePermission } = require('../middleware/auth');

const router = express.Router();
router.use(requireAuth, requirePermission('master_settings'));

function formatSerial(prefix, padDigits, nextNumber) {
  const pad = Math.max(0, Math.min(12, Number(padDigits) || 0));
  const n = Math.max(0, Number(nextNumber) || 0);
  return `${prefix || ''}${String(n).padStart(pad, '0')}`;
}

/** Hub summary */
router.get('/hub', async (_req, res) => {
  try {
    const [staffCnt] = await query(
      `SELECT COUNT(*) AS cnt FROM staff_masters WHERE is_deleted = 0`
    );
    const [codeCnt] = await query(
      `SELECT COUNT(*) AS cnt FROM code_masters WHERE is_deleted = 0 AND is_active = 1`
    );
    const [settingCnt] = await query(
      `SELECT COUNT(*) AS cnt FROM system_settings WHERE is_deleted = 0`
    );
    const [officeCnt] = await query(
      `SELECT COUNT(*) AS cnt FROM office_masters WHERE is_deleted = 0`
    );
    const [ruleCnt] = await query(
      `SELECT COUNT(*) AS cnt FROM numbering_rules WHERE is_deleted = 0`
    );
    const [holidayCnt] = await query(
      `SELECT COUNT(*) AS cnt FROM holidays WHERE is_deleted = 0 AND is_active = 1`
    );
    const [transferFeeCnt] = await query(
      `SELECT COUNT(*) AS cnt FROM transfer_fee_patterns WHERE is_deleted = 0`
    );
    return res.json({
      ok: true,
      hub: {
        staff_masters: Number(staffCnt.cnt || 0),
        code_masters: Number(codeCnt.cnt || 0),
        system_settings: Number(settingCnt.cnt || 0),
        office_masters: Number(officeCnt.cnt || 0),
        numbering_rules: Number(ruleCnt.cnt || 0),
        holidays: Number(holidayCnt.cnt || 0),
        transfer_fee_patterns: Number(transferFeeCnt.cnt || 0),
      },
    });
  } catch (err) {
    console.error('[master_settings/hub]', err);
    return res.status(500).json({ ok: false, message: 'ハブ情報の取得に失敗しました' });
  }
});

router.get('/staff', async (_req, res) => {
  try {
    const rows = await query(
      `SELECT * FROM staff_masters WHERE is_deleted = 0 ORDER BY sort_order ASC, staff_master_id ASC`
    );
    return res.json({ ok: true, staff: rows });
  } catch (err) {
    console.error('[master_settings/staff/list]', err);
    return res.status(500).json({ ok: false, message: '担当者一覧の取得に失敗しました' });
  }
});

router.post('/staff', async (req, res) => {
  try {
    const name = String(req.body.staff_name || '').trim();
    if (!name) return res.status(400).json({ ok: false, message: '氏名は必須です' });
    const result = await query(
      `INSERT INTO staff_masters (staff_name, staff_name_kana, role_label, is_active, sort_order)
       VALUES (?, ?, ?, ?, ?)`,
      [
        name,
        req.body.staff_name_kana || null,
        req.body.role_label || null,
        req.body.is_active === false || req.body.is_active === 0 ? 0 : 1,
        Number(req.body.sort_order || 0),
      ]
    );
    return res.status(201).json({ ok: true, staff_master_id: result.insertId });
  } catch (err) {
    console.error('[master_settings/staff/create]', err);
    return res.status(500).json({ ok: false, message: '担当者の作成に失敗しました' });
  }
});

router.put('/staff/:id', async (req, res) => {
  try {
    const id = Number(req.params.id);
    await query(
      `UPDATE staff_masters
       SET staff_name = ?, staff_name_kana = ?, role_label = ?, is_active = ?, sort_order = ?,
           version = version + 1, updated_at = CURRENT_TIMESTAMP
       WHERE staff_master_id = ? AND is_deleted = 0`,
      [
        String(req.body.staff_name || '').trim(),
        req.body.staff_name_kana || null,
        req.body.role_label || null,
        req.body.is_active === false || req.body.is_active === 0 ? 0 : 1,
        Number(req.body.sort_order || 0),
        id,
      ]
    );
    return res.json({ ok: true });
  } catch (err) {
    console.error('[master_settings/staff/update]', err);
    return res.status(500).json({ ok: false, message: '担当者の更新に失敗しました' });
  }
});

router.delete('/staff/:id', async (req, res) => {
  try {
    await query(
      `UPDATE staff_masters SET is_deleted = 1, version = version + 1 WHERE staff_master_id = ?`,
      [Number(req.params.id)]
    );
    return res.json({ ok: true });
  } catch (err) {
    console.error('[master_settings/staff/delete]', err);
    return res.status(500).json({ ok: false, message: '担当者の削除に失敗しました' });
  }
});

router.get('/settings', async (_req, res) => {
  try {
    const rows = await query(
      `SELECT * FROM system_settings WHERE is_deleted = 0 ORDER BY setting_key ASC`
    );
    return res.json({ ok: true, settings: rows });
  } catch (err) {
    console.error('[master_settings/settings/list]', err);
    return res.status(500).json({ ok: false, message: '設定一覧の取得に失敗しました' });
  }
});

router.put('/settings/:key', async (req, res) => {
  try {
    const key = String(req.params.key || '').trim();
    const value = req.body.setting_value != null ? String(req.body.setting_value) : null;
    const label = req.body.setting_label != null ? String(req.body.setting_label) : null;
    if (key === 'document_issuer_logo_data_url') {
      if (value && !/^data:image\/(png|jpeg|webp);base64,/i.test(value)) {
        return res.status(400).json({ ok: false, message: '会社ロゴはPNG、JPEG、WebP画像を指定してください' });
      }
      if (value && value.length > 750000) {
        return res.status(400).json({ ok: false, message: '会社ロゴの画像容量が大きすぎます' });
      }
    }
    const existing = await query(
      `SELECT setting_id FROM system_settings WHERE setting_key = ? AND is_deleted = 0 LIMIT 1`,
      [key]
    );
    if (existing.length) {
      await query(
        `UPDATE system_settings
         SET setting_value = ?, setting_label = COALESCE(?, setting_label),
             version = version + 1, updated_at = CURRENT_TIMESTAMP
         WHERE setting_id = ?`,
        [value, label, existing[0].setting_id]
      );
    } else {
      await query(
        `INSERT INTO system_settings (setting_key, setting_value, setting_label) VALUES (?, ?, ?)`,
        [key, value, label]
      );
    }
    return res.json({ ok: true });
  } catch (err) {
    console.error('[master_settings/settings/put]', err);
    return res.status(500).json({ ok: false, message: '設定の保存に失敗しました' });
  }
});

function validDate(value) {
  return /^\d{4}-\d{2}-\d{2}$/.test(String(value || ''));
}

/** 全案件共通の祝日・案件独自休日 */
router.get('/holidays/projects', async (_req, res) => {
  try {
    const rows = await query(
      `SELECT p.project_id, p.manager_name, p.business_type, c.company_name, pt.partner_name
       FROM projects p
       LEFT JOIN companies c ON c.company_id = p.company_id
       LEFT JOIN partners pt ON pt.partner_id = p.partner_id
       WHERE p.is_deleted = 0
       ORDER BY c.company_name ASC, p.project_id ASC`
    );
    return res.json({ ok: true, projects: rows });
  } catch (err) {
    console.error('[master_settings/holidays/projects]', err);
    return res.status(500).json({ ok: false, message: '案件一覧の取得に失敗しました' });
  }
});

router.get('/holidays', async (req, res) => {
  try {
    const values = [];
    const where = ['h.is_deleted = 0'];
    if (req.query.from) {
      if (!validDate(req.query.from)) return res.status(400).json({ ok: false, message: '開始日が不正です' });
      where.push('h.holiday_date >= ?');
      values.push(req.query.from);
    }
    if (req.query.to) {
      if (!validDate(req.query.to)) return res.status(400).json({ ok: false, message: '終了日が不正です' });
      where.push('h.holiday_date <= ?');
      values.push(req.query.to);
    }
    if (req.query.project_id) {
      where.push('(h.project_id IS NULL OR h.project_id = ?)');
      values.push(Number(req.query.project_id));
    }
    const rows = await query(
      `SELECT h.*, p.manager_name AS project_name, p.business_type,
              c.company_name, pt.partner_name
       FROM holidays h
       LEFT JOIN projects p ON p.project_id = h.project_id
       LEFT JOIN companies c ON c.company_id = p.company_id
       LEFT JOIN partners pt ON pt.partner_id = p.partner_id
       WHERE ${where.join(' AND ')}
       ORDER BY h.holiday_date DESC, h.project_id IS NOT NULL ASC, h.holiday_id DESC`,
      values
    );
    return res.json({ ok: true, holidays: rows });
  } catch (err) {
    console.error('[master_settings/holidays/list]', err);
    return res.status(500).json({ ok: false, message: '休日一覧の取得に失敗しました' });
  }
});

router.post('/holidays', async (req, res) => {
  try {
    const date = String(req.body.holiday_date || '').trim();
    const name = String(req.body.holiday_name || '').trim();
    const hasProject = req.body.project_id != null && req.body.project_id !== '';
    const projectId = hasProject ? Number(req.body.project_id) : null;
    if (!validDate(date) || !name) {
      return res.status(400).json({ ok: false, message: '日付と休日名は必須です' });
    }
    if (hasProject && (!Number.isInteger(projectId) || projectId <= 0)) {
      return res.status(400).json({ ok: false, message: '案件が不正です' });
    }
    const result = await query(
      `INSERT INTO holidays (holiday_date, holiday_name, project_id, is_active)
       VALUES (?, ?, ?, ?)`,
      [date, name, projectId, req.body.is_active === false || req.body.is_active === 0 ? 0 : 1]
    );
    return res.status(201).json({ ok: true, holiday_id: result.insertId });
  } catch (err) {
    console.error('[master_settings/holidays/create]', err);
    if (err && err.code === 'ER_DUP_ENTRY') {
      return res.status(409).json({ ok: false, message: '同じ適用範囲・日付の休日が既にあります' });
    }
    return res.status(500).json({ ok: false, message: '休日の登録に失敗しました' });
  }
});

router.put('/holidays/:id', async (req, res) => {
  try {
    const date = String(req.body.holiday_date || '').trim();
    const name = String(req.body.holiday_name || '').trim();
    const hasProject = req.body.project_id != null && req.body.project_id !== '';
    const projectId = hasProject ? Number(req.body.project_id) : null;
    if (!validDate(date) || !name) {
      return res.status(400).json({ ok: false, message: '日付と休日名は必須です' });
    }
    if (hasProject && (!Number.isInteger(projectId) || projectId <= 0)) {
      return res.status(400).json({ ok: false, message: '案件が不正です' });
    }
    const result = await query(
      `UPDATE holidays
       SET holiday_date = ?, holiday_name = ?, project_id = ?, is_active = ?,
           version = version + 1, updated_at = CURRENT_TIMESTAMP
       WHERE holiday_id = ? AND is_deleted = 0`,
      [
        date,
        name,
        projectId,
        req.body.is_active === false || req.body.is_active === 0 ? 0 : 1,
        Number(req.params.id),
      ]
    );
    if (!result.affectedRows) return res.status(404).json({ ok: false, message: '休日が見つかりません' });
    return res.json({ ok: true });
  } catch (err) {
    console.error('[master_settings/holidays/update]', err);
    if (err && err.code === 'ER_DUP_ENTRY') {
      return res.status(409).json({ ok: false, message: '同じ適用範囲・日付の休日が既にあります' });
    }
    return res.status(500).json({ ok: false, message: '休日の更新に失敗しました' });
  }
});

router.delete('/holidays/:id', async (req, res) => {
  try {
    const result = await query(
      `UPDATE holidays
       SET is_deleted = 1, version = version + 1, updated_at = CURRENT_TIMESTAMP
       WHERE holiday_id = ? AND is_deleted = 0`,
      [Number(req.params.id)]
    );
    if (!result.affectedRows) return res.status(404).json({ ok: false, message: '休日が見つかりません' });
    return res.json({ ok: true });
  } catch (err) {
    console.error('[master_settings/holidays/delete]', err);
    return res.status(500).json({ ok: false, message: '休日の削除に失敗しました' });
  }
});

/** CRUD for selected code categories used by K-08 */
router.get('/codes/:category', async (req, res) => {
  try {
    const category = String(req.params.category || '').trim();
    const rows = await query(
      `SELECT * FROM code_masters
       WHERE category_code = ? AND is_deleted = 0
       ORDER BY sort_order ASC, code_master_id ASC`,
      [category]
    );
    return res.json({ ok: true, codes: rows });
  } catch (err) {
    console.error('[master_settings/codes]', err);
    return res.status(500).json({ ok: false, message: '区分一覧の取得に失敗しました' });
  }
});

router.post('/codes', async (req, res) => {
  try {
    const category = String(req.body.category_code || '').trim();
    const value = String(req.body.code_value || '').trim();
    const label = String(req.body.code_label || '').trim();
    if (!category || !value || !label) {
      return res.status(400).json({ ok: false, message: 'カテゴリ・値・表示名は必須です' });
    }
    const result = await query(
      `INSERT INTO code_masters (category_code, code_value, code_label, sort_order, is_active)
       VALUES (?, ?, ?, ?, 1)`,
      [category, value, label, Number(req.body.sort_order || 0)]
    );
    return res.status(201).json({ ok: true, code_master_id: result.insertId });
  } catch (err) {
    console.error('[master_settings/codes/create]', err);
    return res.status(500).json({ ok: false, message: '区分の作成に失敗しました' });
  }
});

router.put('/codes/:id', async (req, res) => {
  try {
    await query(
      `UPDATE code_masters
       SET code_label = ?, sort_order = ?, is_active = ?, version = version + 1
       WHERE code_master_id = ? AND is_deleted = 0`,
      [
        String(req.body.code_label || '').trim(),
        Number(req.body.sort_order || 0),
        req.body.is_active === false || req.body.is_active === 0 ? 0 : 1,
        Number(req.params.id),
      ]
    );
    return res.json({ ok: true });
  } catch (err) {
    console.error('[master_settings/codes/update]', err);
    return res.status(500).json({ ok: false, message: '区分の更新に失敗しました' });
  }
});

/** 事業所マスタ */
router.get('/offices', async (_req, res) => {
  try {
    const rows = await query(
      `SELECT * FROM office_masters
       WHERE is_deleted = 0
       ORDER BY sort_order ASC, office_no ASC, office_id ASC`
    );
    return res.json({ ok: true, offices: rows });
  } catch (err) {
    console.error('[master_settings/offices/list]', err);
    return res.status(500).json({ ok: false, message: '事業所一覧の取得に失敗しました' });
  }
});

router.post('/offices', async (req, res) => {
  const pool = getPool();
  const conn = await pool.getConnection();
  try {
    const name = String(req.body.office_name || '').trim();
    const sortOrder = Number(req.body.sort_order || 0);
    const isActive = req.body.is_active === false || req.body.is_active === 0 ? 0 : 1;

    await conn.beginTransaction();
    const [rules] = await conn.query(
      `SELECT * FROM numbering_rules
       WHERE rule_key = 'office' AND is_deleted = 0
       LIMIT 1
       FOR UPDATE`
    );
    if (!rules.length) {
      await conn.rollback();
      return res.status(400).json({ ok: false, message: '事業所の採番ルールが未登録です' });
    }
    const rule = rules[0];
    if (!Number(rule.is_active)) {
      await conn.rollback();
      return res.status(400).json({ ok: false, message: '事業所の採番ルールが無効です' });
    }

    let nextNum = Number(rule.next_number) || 1;
    let officeNo = formatSerial(rule.prefix, rule.pad_digits, nextNum);
    // 衝突時は次番号を進めて再試行（仮組）
    for (let i = 0; i < 50; i += 1) {
      const [dup] = await conn.query(
        `SELECT office_id FROM office_masters WHERE office_no = ? AND is_deleted = 0 LIMIT 1`,
        [officeNo]
      );
      if (!dup.length) break;
      nextNum += 1;
      officeNo = formatSerial(rule.prefix, rule.pad_digits, nextNum);
    }

    const [result] = await conn.query(
      `INSERT INTO office_masters (office_no, office_name, is_active, sort_order)
       VALUES (?, ?, ?, ?)`,
      [officeNo, name || '', isActive, sortOrder]
    );
    await conn.query(
      `UPDATE numbering_rules
       SET next_number = ?, version = version + 1, updated_at = CURRENT_TIMESTAMP
       WHERE numbering_rule_id = ?`,
      [nextNum + 1, rule.numbering_rule_id]
    );
    await conn.commit();
    return res.status(201).json({
      ok: true,
      office_id: result.insertId,
      office_no: officeNo,
    });
  } catch (err) {
    await conn.rollback();
    console.error('[master_settings/offices/create]', err);
    return res.status(500).json({ ok: false, message: '事業所の作成に失敗しました' });
  } finally {
    conn.release();
  }
});

router.put('/offices/:id', async (req, res) => {
  try {
    const id = Number(req.params.id);
    const name = String(req.body.office_name || '').trim();
    await query(
      `UPDATE office_masters
       SET office_name = ?, is_active = ?, sort_order = ?,
           version = version + 1, updated_at = CURRENT_TIMESTAMP
       WHERE office_id = ? AND is_deleted = 0`,
      [
        name || '',
        req.body.is_active === false || req.body.is_active === 0 ? 0 : 1,
        Number(req.body.sort_order || 0),
        id,
      ]
    );
    return res.json({ ok: true });
  } catch (err) {
    console.error('[master_settings/offices/update]', err);
    return res.status(500).json({ ok: false, message: '事業所の更新に失敗しました' });
  }
});

router.delete('/offices/:id', async (req, res) => {
  try {
    await query(
      `UPDATE office_masters SET is_deleted = 1, version = version + 1 WHERE office_id = ?`,
      [Number(req.params.id)]
    );
    return res.json({ ok: true });
  } catch (err) {
    console.error('[master_settings/offices/delete]', err);
    return res.status(500).json({ ok: false, message: '事業所の削除に失敗しました' });
  }
});

/** 採番ルール */
router.get('/numbering-rules', async (_req, res) => {
  try {
    const rows = await query(
      `SELECT * FROM numbering_rules
       WHERE is_deleted = 0
       ORDER BY rule_key ASC`
    );
    return res.json({ ok: true, rules: rows });
  } catch (err) {
    console.error('[master_settings/numbering-rules/list]', err);
    return res.status(500).json({ ok: false, message: '採番ルール一覧の取得に失敗しました' });
  }
});

router.post('/numbering-rules', async (req, res) => {
  try {
    const ruleKey = String(req.body.rule_key || '').trim();
    const ruleLabel = String(req.body.rule_label || '').trim();
    if (!ruleKey || !ruleLabel) {
      return res.status(400).json({ ok: false, message: 'キーと表示名は必須です' });
    }
    const result = await query(
      `INSERT INTO numbering_rules (rule_key, rule_label, prefix, pad_digits, next_number, is_active)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [
        ruleKey,
        ruleLabel,
        String(req.body.prefix || ''),
        Math.max(0, Math.min(12, Number(req.body.pad_digits ?? 4))),
        Math.max(1, Number(req.body.next_number || 1)),
        req.body.is_active === false || req.body.is_active === 0 ? 0 : 1,
      ]
    );
    return res.status(201).json({ ok: true, numbering_rule_id: result.insertId });
  } catch (err) {
    console.error('[master_settings/numbering-rules/create]', err);
    if (err && err.code === 'ER_DUP_ENTRY') {
      return res.status(409).json({ ok: false, message: '同じキーの採番ルールが既にあります' });
    }
    return res.status(500).json({ ok: false, message: '採番ルールの作成に失敗しました' });
  }
});

router.put('/numbering-rules/:id', async (req, res) => {
  try {
    const id = Number(req.params.id);
    const ruleLabel = String(req.body.rule_label || '').trim();
    if (!ruleLabel) {
      return res.status(400).json({ ok: false, message: '表示名は必須です' });
    }
    await query(
      `UPDATE numbering_rules
       SET rule_label = ?, prefix = ?, pad_digits = ?, next_number = ?, is_active = ?,
           version = version + 1, updated_at = CURRENT_TIMESTAMP
       WHERE numbering_rule_id = ? AND is_deleted = 0`,
      [
        ruleLabel,
        String(req.body.prefix || ''),
        Math.max(0, Math.min(12, Number(req.body.pad_digits ?? 4))),
        Math.max(1, Number(req.body.next_number || 1)),
        req.body.is_active === false || req.body.is_active === 0 ? 0 : 1,
        id,
      ]
    );
    return res.json({ ok: true });
  } catch (err) {
    console.error('[master_settings/numbering-rules/update]', err);
    return res.status(500).json({ ok: false, message: '採番ルールの更新に失敗しました' });
  }
});

router.get('/transfer-fees', async (_req, res) => {
  try {
    const rows = await query(`SELECT * FROM transfer_fee_patterns WHERE is_deleted=0 ORDER BY sort_order,transfer_fee_pattern_id`);
    return res.json({ ok: true, transfer_fees: rows });
  } catch (err) {
    console.error('[master_settings/transfer-fees/list]', err);
    return res.status(500).json({ ok: false, message: '振込手数料マスターの取得に失敗しました' });
  }
});

router.post('/transfer-fees', async (req, res) => {
  try {
    const name = String(req.body?.pattern_name || '').trim();
    const amount = Number(req.body?.amount);
    if (!name || !Number.isFinite(amount) || amount < 0) return res.status(400).json({ ok: false, message: '名称と0円以上の固定金額は必須です' });
    const result = await query(
      `INSERT INTO transfer_fee_patterns (pattern_name,amount,is_active,sort_order) VALUES (?,?,?,?)`,
      [name,amount,req.body?.is_active === false ? 0 : 1,Number(req.body?.sort_order || 0)]
    );
    return res.status(201).json({ ok: true, transfer_fee_pattern_id: result.insertId });
  } catch (err) {
    console.error('[master_settings/transfer-fees/create]', err);
    return res.status(500).json({ ok: false, message: '振込手数料マスターの作成に失敗しました' });
  }
});

router.put('/transfer-fees/:id', async (req, res) => {
  try {
    const name = String(req.body?.pattern_name || '').trim();
    const amount = Number(req.body?.amount);
    if (!name || !Number.isFinite(amount) || amount < 0) return res.status(400).json({ ok: false, message: '名称と0円以上の固定金額は必須です' });
    const result = await query(
      `UPDATE transfer_fee_patterns SET pattern_name=?,amount=?,is_active=?,sort_order=?,version=version+1
       WHERE transfer_fee_pattern_id=? AND is_deleted=0 AND version=?`,
      [name,amount,req.body?.is_active === false ? 0 : 1,Number(req.body?.sort_order || 0),Number(req.params.id),Number(req.body?.version)]
    );
    if (!result?.affectedRows) return res.status(409).json({ ok: false, message: '他の利用者が更新しました。再読み込みしてください' });
    return res.json({ ok: true });
  } catch (err) {
    console.error('[master_settings/transfer-fees/update]', err);
    return res.status(500).json({ ok: false, message: '振込手数料マスターの更新に失敗しました' });
  }
});

router.delete('/transfer-fees/:id', async (req, res) => {
  try {
    const result = await query(`UPDATE transfer_fee_patterns SET is_deleted=1,is_active=0,version=version+1 WHERE transfer_fee_pattern_id=? AND is_deleted=0`, [Number(req.params.id)]);
    if (!result?.affectedRows) return res.status(404).json({ ok: false, message: '振込手数料マスターが見つかりません' });
    return res.json({ ok: true });
  } catch (err) {
    console.error('[master_settings/transfer-fees/delete]', err);
    return res.status(500).json({ ok: false, message: '振込手数料マスターの削除に失敗しました' });
  }
});

module.exports = router;
