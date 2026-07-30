const express = require('express');
const bcrypt = require('bcryptjs');
const { query } = require('../db');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();

function publicUser(row) {
  return {
    user_id: row.user_id,
    login_id: row.login_id,
    display_name: row.display_name,
    role: row.role,
  };
}

router.post('/login', async (req, res) => {
  try {
    const loginId = String(req.body.login_id || '').trim();
    const password = String(req.body.password || '');

    if (!loginId || !password) {
      return res.status(400).json({
        ok: false,
        error: 'validation_error',
        message: 'ログインIDとパスワードを入力してください',
      });
    }

    const rows = await query(
      `SELECT user_id, login_id, password_hash, display_name, role
       FROM users
       WHERE login_id = ? AND is_deleted = 0
       LIMIT 1`,
      [loginId]
    );

    if (!rows.length) {
      return res.status(401).json({
        ok: false,
        error: 'invalid_credentials',
        message: 'ログインIDまたはパスワードが違います',
      });
    }

    const user = rows[0];
    const matched = await bcrypt.compare(password, user.password_hash);
    if (!matched) {
      return res.status(401).json({
        ok: false,
        error: 'invalid_credentials',
        message: 'ログインIDまたはパスワードが違います',
      });
    }

    req.session.user = publicUser(user);
    return res.json({
      ok: true,
      user: req.session.user,
    });
  } catch (err) {
    console.error('[auth/login]', err);
    return res.status(500).json({
      ok: false,
      error: 'server_error',
      message: 'ログイン処理に失敗しました',
    });
  }
});

router.post('/logout', (req, res) => {
  req.session.destroy((err) => {
    if (err) {
      console.error('[auth/logout]', err);
      return res.status(500).json({
        ok: false,
        error: 'server_error',
        message: 'ログアウトに失敗しました',
      });
    }
    res.clearCookie('connect.sid');
    return res.json({ ok: true });
  });
});

router.get('/me', requireAuth, (req, res) => {
  return res.json({
    ok: true,
    user: req.session.user,
  });
});

module.exports = router;
