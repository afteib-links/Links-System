const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { pool } = require('./db');

const JWT_SECRET = process.env.SESSION_SECRET || 'changeme';
const TOKEN_TTL = '12h';

// 初期管理者ユーザーを1名だけ用意する（存在しなければ作成）。
// 仕様 9.1: 平文保存禁止・配備時に管理者を作成できること。
async function ensureAdminUser() {
  const loginId = process.env.ADMIN_LOGIN_ID || 'admin';
  const password = process.env.ADMIN_PASSWORD || 'admin123';
  const [rows] = await pool.query(
    'SELECT id FROM users WHERE login_id = ? LIMIT 1',
    [loginId]
  );
  if (rows.length === 0) {
    const hash = await bcrypt.hash(password, 10);
    await pool.query(
      'INSERT INTO users (login_id, password_hash, display_name, role) VALUES (?, ?, ?, ?)',
      [loginId, hash, '初期管理者', 'admin']
    );
    // 開発用途のため初期認証情報をログに出す（本番では削除想定）。
    console.log(`[seed] 初期管理者を作成しました login_id=${loginId} password=${password}`);
  }
}

async function login(loginId, password) {
  const [rows] = await pool.query(
    'SELECT id, login_id, password_hash, display_name, role FROM users WHERE login_id = ? AND is_deleted = 0 LIMIT 1',
    [loginId]
  );
  if (rows.length === 0) return null;
  const user = rows[0];
  const ok = await bcrypt.compare(password, user.password_hash);
  if (!ok) return null;
  const token = jwt.sign(
    { sub: user.id, login_id: user.login_id, role: user.role },
    JWT_SECRET,
    { expiresIn: TOKEN_TTL }
  );
  return {
    token,
    user: {
      id: user.id,
      login_id: user.login_id,
      display_name: user.display_name,
      role: user.role,
    },
  };
}

// APIを保護する認証ミドルウェア（Bearerトークン）。
function requireAuth(req, res, next) {
  const header = req.headers.authorization || '';
  const parts = header.split(' ');
  if (parts.length !== 2 || parts[0] !== 'Bearer') {
    return res.status(401).json({ error: '認証が必要です' });
  }
  try {
    req.user = jwt.verify(parts[1], JWT_SECRET);
    next();
  } catch (e) {
    return res.status(401).json({ error: 'トークンが無効です' });
  }
}

// 管理者のみ許可（マスタ編集など）。
function requireAdmin(req, res, next) {
  if (!req.user || req.user.role !== 'admin') {
    return res.status(403).json({ error: '管理者権限が必要です' });
  }
  next();
}

module.exports = { ensureAdminUser, login, requireAuth, requireAdmin };
