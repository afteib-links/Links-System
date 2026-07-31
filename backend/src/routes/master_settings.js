const express = require('express');
const { query } = require('../db');
const { requireAuth, requirePermission } = require('../middleware/auth');

const router = express.Router();
router.use(requireAuth, requirePermission('master_settings'));

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
    return res.json({
      ok: true,
      hub: {
        staff_masters: Number(staffCnt.cnt || 0),
        code_masters: Number(codeCnt.cnt || 0),
        system_settings: Number(settingCnt.cnt || 0),
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

module.exports = router;
