const express = require('express');
const { query } = require('../db');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();

router.use(requireAuth);

router.get('/codes', async (req, res) => {
  try {
    const category = String(req.query.category || '').trim();
    let rows;
    if (category) {
      rows = await query(
        `SELECT category_code, code_value, code_label, sort_order
         FROM code_masters
         WHERE is_deleted = 0 AND is_active = 1 AND category_code = ?
         ORDER BY sort_order ASC, code_master_id ASC`,
        [category]
      );
    } else {
      rows = await query(
        `SELECT category_code, code_value, code_label, sort_order
         FROM code_masters
         WHERE is_deleted = 0 AND is_active = 1
         ORDER BY category_code ASC, sort_order ASC, code_master_id ASC`
      );
    }
    return res.json({ ok: true, codes: rows });
  } catch (err) {
    console.error('[masters/codes]', err);
    return res.status(500).json({
      ok: false,
      error: 'server_error',
      message: '区分マスタの取得に失敗しました',
    });
  }
});

router.get('/ui-settings', async (_req, res) => {
  try {
    const rows = await query(
      `SELECT setting_key, setting_value FROM system_settings
       WHERE is_deleted = 0 AND (setting_key LIKE 'status_color_%' OR setting_key LIKE 'status_label_%')`
    );
    return res.json({ ok:true, settings:Object.fromEntries(rows.map((row) => [row.setting_key, row.setting_value])) });
  } catch (err) {
    console.error('[masters/ui-settings]', err);
    return res.status(500).json({ ok:false, message:'表示設定の取得に失敗しました' });
  }
});

module.exports = router;
