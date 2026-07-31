const express = require('express');
const { query } = require('../db');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();
router.use(requireAuth);

function parseJson(value, fallback = null) {
  if (value == null) return fallback;
  if (typeof value === 'object') return value;
  try {
    return JSON.parse(value);
  } catch (_e) {
    return fallback;
  }
}

router.get('/:screenKey', async (req, res) => {
  try {
    const screenKey = String(req.params.screenKey || '').trim();
    const userId = req.session.user.user_id;
    if (!screenKey) {
      return res.status(400).json({ ok: false, message: 'screen_key は必須です' });
    }
    const rows = await query(
      `SELECT * FROM user_screen_layouts
       WHERE user_id = ? AND screen_key = ? AND is_deleted = 0
       LIMIT 1`,
      [userId, screenKey]
    );
    if (!rows.length) {
      return res.json({ ok: true, layout: null });
    }
    const row = rows[0];
    return res.json({
      ok: true,
      layout: {
        ...row,
        columns_json: parseJson(row.columns_json, null),
        layout_json: parseJson(row.layout_json, null),
      },
    });
  } catch (err) {
    console.error('[layouts/get]', err);
    return res.status(500).json({ ok: false, message: 'レイアウト取得に失敗しました' });
  }
});

router.put('/:screenKey', async (req, res) => {
  try {
    const screenKey = String(req.params.screenKey || '').trim();
    const userId = req.session.user.user_id;
    if (!screenKey) {
      return res.status(400).json({ ok: false, message: 'screen_key は必須です' });
    }
    const columnsJson = req.body.columns_json ?? null;
    const layoutJson = req.body.layout_json ?? null;
    const columnsStr = columnsJson == null ? null : JSON.stringify(columnsJson);
    const layoutStr = layoutJson == null ? null : JSON.stringify(layoutJson);

    const existing = await query(
      `SELECT layout_id FROM user_screen_layouts
       WHERE user_id = ? AND screen_key = ? AND is_deleted = 0
       LIMIT 1`,
      [userId, screenKey]
    );

    if (existing.length) {
      await query(
        `UPDATE user_screen_layouts
         SET columns_json = ?, layout_json = ?, version = version + 1, updated_at = CURRENT_TIMESTAMP
         WHERE layout_id = ?`,
        [columnsStr, layoutStr, existing[0].layout_id]
      );
    } else {
      await query(
        `INSERT INTO user_screen_layouts (user_id, screen_key, columns_json, layout_json)
         VALUES (?, ?, ?, ?)`,
        [userId, screenKey, columnsStr, layoutStr]
      );
    }

    return res.json({ ok: true });
  } catch (err) {
    console.error('[layouts/put]', err);
    return res.status(500).json({ ok: false, message: 'レイアウト保存に失敗しました' });
  }
});

module.exports = router;
