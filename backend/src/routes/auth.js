const express = require('express');
const bcrypt = require('bcryptjs');
const { query } = require('../db');
const { requireAuth } = require('../middleware/auth');
const { ROLES, FEATURES, publicUser } = require('../permissions');

const router = express.Router();

router.get('/features', (_req, res) => {
  res.json({ ok: true, features: FEATURES, roles: ROLES });
});

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
      `SELECT user_id, login_id, password_hash, display_name, role, roles,
              is_active, permissions, departments, areas, company_id, partner_id
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
    if (!Number(user.is_active)) {
      return res.status(403).json({
        ok: false,
        error: 'disabled',
        message: 'このユーザーは無効化されています。管理者に連絡してください',
      });
    }

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
      features: FEATURES,
      roles: ROLES,
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

router.get('/me', requireAuth, async (req, res) => {
  try {
    const userId = Number(req.session.user?.user_id);
    if (!Number.isInteger(userId) || userId <= 0) {
      return res.status(401).json({
        ok: false,
        error: 'unauthorized',
        message: 'ログインが必要です',
      });
    }

    const rows = await query(
      `SELECT user_id, login_id, password_hash, display_name, role, roles,
              is_active, permissions, departments, areas, company_id, partner_id
       FROM users
       WHERE user_id = ? AND is_deleted = 0
       LIMIT 1`,
      [userId]
    );
    const row = rows[0];
    if (!row || !Number(row.is_active)) {
      return req.session.destroy((err) => {
        if (err) {
          console.error('[auth/me]', err);
          return res.status(500).json({
            ok: false,
            error: 'server_error',
            message: 'ログイン状態の確認に失敗しました',
          });
        }
        res.clearCookie('connect.sid');
        return res.status(401).json({
          ok: false,
          error: 'unauthorized',
          message: 'ログインが必要です',
        });
      });
    }

    req.session.user = publicUser(row);
    return req.session.save((err) => {
      if (err) {
        console.error('[auth/me]', err);
        return res.status(500).json({
          ok: false,
          error: 'server_error',
          message: 'ログイン状態の確認に失敗しました',
        });
      }
      return res.json({
        ok: true,
        user: req.session.user,
        features: FEATURES,
        roles: ROLES,
      });
    });
  } catch (err) {
    console.error('[auth/me]', err);
    return res.status(500).json({
      ok: false,
      error: 'server_error',
      message: 'ログイン状態の確認に失敗しました',
    });
  }
});

module.exports = router;
