const express = require('express');
const { getPool, query } = require('../db');
const { requireAuth, requirePermission } = require('../middleware/auth');
const { ROLES, FEATURES, FEATURE_KEYS, ROLE_KEYS, roleMatrix, refreshRoleMatrix } = require('../permissions');

const router = express.Router();
router.use(requireAuth, requirePermission('menu_access_settings'));

router.get('/', async (_req, res) => {
  try {
    const [state] = await query('SELECT revision FROM feature_role_permission_revision WHERE singleton_id=1');
    return res.json({ ok: true, roles: ROLES, features: FEATURES, roles_by_feature: roleMatrix(), revision: Number(state.revision) });
  } catch (error) {
    return res.status(500).json({ ok: false, message: 'メニュー権限を取得できませんでした' });
  }
});

router.put('/', async (req, res) => {
  const input = req.body?.roles_by_feature;
  const expected = Number(req.body?.revision);
  if (!input || typeof input !== 'object' || Array.isArray(input) || !Number.isInteger(expected) || expected < 1 ||
      Object.keys(input).length !== FEATURE_KEYS.length || FEATURE_KEYS.some((key) => !Array.isArray(input[key]) ||
        input[key].some((role) => !ROLE_KEYS.includes(role)))) {
    return res.status(400).json({ ok: false, message: '権限設定の形式が不正です' });
  }
  if (!input.menu_access_settings.includes('admin')) {
    return res.status(400).json({ ok: false, message: '最後の管理者の権限設定アクセスは解除できません' });
  }
  const conn = await getPool().getConnection();
  try {
    await conn.beginTransaction();
    const [states] = await conn.query('SELECT revision FROM feature_role_permission_revision WHERE singleton_id=1 FOR UPDATE');
    if (Number(states[0]?.revision) !== expected) {
      await conn.rollback();
      return res.status(409).json({ ok: false, message: '他の利用者が権限を変更しました。再読込してください' });
    }
    for (const key of FEATURE_KEYS) for (const role of ROLE_KEYS) {
      await conn.query('INSERT INTO feature_role_permissions (role_key,feature_key,is_allowed) VALUES (?,?,?) ON DUPLICATE KEY UPDATE is_allowed=VALUES(is_allowed)', [role, key, input[key].includes(role) ? 1 : 0]);
    }
    await conn.query('UPDATE feature_role_permission_revision SET revision=revision+1 WHERE singleton_id=1');
    await conn.commit();
    await refreshRoleMatrix(query);
    return res.json({ ok: true, roles_by_feature: roleMatrix(), revision: expected + 1 });
  } catch (error) {
    await conn.rollback();
    return res.status(500).json({ ok: false, message: '権限設定の保存に失敗しました' });
  } finally { conn.release(); }
});

module.exports = router;
