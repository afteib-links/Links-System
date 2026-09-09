const express = require('express');
const { query } = require('../db');
const { requireAuth, requireRole } = require('../middleware/auth');

const router = express.Router();
router.use(requireAuth);

router.get('/', requireRole('admin', 'system'), async (_req, res) => {
  try {
    const rows = await query(`SELECT * FROM help_contents WHERE is_deleted=0 ORDER BY screen_key`);
    return res.json({ ok: true, help_contents: rows });
  } catch (err) {
    console.error('[help/list]', err);
    return res.status(500).json({ ok: false, message: 'ヘルプ一覧の取得に失敗しました' });
  }
});

router.get('/:screenKey', async (req, res) => {
  try {
    const rows = await query(
      `SELECT screen_key,help_title,overview_text,input_effect_text,version,updated_at
       FROM help_contents WHERE screen_key=? AND is_deleted=0 LIMIT 1`,
      [String(req.params.screenKey || '').slice(0, 64)]
    );
    return res.json({
      ok: true,
      help: rows[0] || {
        screen_key: req.params.screenKey,
        help_title: 'この画面のヘルプ',
        overview_text: 'ヘルプ内容はまだ登録されていません。',
        input_effect_text: '',
      },
    });
  } catch (err) {
    console.error('[help/get]', err);
    return res.status(500).json({ ok: false, message: 'ヘルプの取得に失敗しました' });
  }
});

router.put('/:screenKey', requireRole('admin', 'system'), async (req, res) => {
  try {
    const screenKey = String(req.params.screenKey || '').trim().slice(0, 64);
    const title = String(req.body.help_title || '').trim().slice(0, 200);
    if (!screenKey || !title) return res.status(400).json({ ok: false, message: '画面キーとタイトルは必須です' });
    await query(
      `INSERT INTO help_contents (screen_key,help_title,overview_text,input_effect_text)
       VALUES (?,?,?,?)
       ON DUPLICATE KEY UPDATE help_title=VALUES(help_title),overview_text=VALUES(overview_text),
         input_effect_text=VALUES(input_effect_text),is_deleted=0,version=version+1,updated_at=CURRENT_TIMESTAMP`,
      [screenKey, title, String(req.body.overview_text || ''), String(req.body.input_effect_text || '')]
    );
    return res.json({ ok: true });
  } catch (err) {
    console.error('[help/update]', err);
    return res.status(500).json({ ok: false, message: 'ヘルプの保存に失敗しました' });
  }
});

module.exports = router;
