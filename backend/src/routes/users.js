const express = require('express');
const bcrypt = require('bcryptjs');
const { query, getPool } = require('../db');
const { requireAuth, requirePermission } = require('../middleware/auth');
const {
  ROLES,
  FEATURES,
  normalizeRoles,
  normalizeStringList,
  publicUser,
  hasPermission,
} = require('../permissions');

const router = express.Router();

router.use(requireAuth, requirePermission('users'));

function validateLoginId(loginId) {
  return /^[a-zA-Z0-9._-]{3,64}$/.test(loginId);
}

function toUserDto(row) {
  return {
    ...publicUser(row),
    version: Number(row.version || 1),
  };
}

function parseListInput(value) {
  if (Array.isArray(value)) {
    return normalizeStringList(value);
  }
  if (typeof value === 'string') {
    return normalizeStringList(
      value
        .split(/[,、\n]/)
        .map((v) => v.trim())
        .filter(Boolean)
    );
  }
  return [];
}

async function findUserById(userId) {
  const rows = await query(
    `SELECT user_id, login_id, display_name, role, roles, is_active,
            permissions, departments, areas, version
     FROM users
     WHERE user_id = ? AND is_deleted = 0
     LIMIT 1`,
    [userId]
  );
  return rows[0] || null;
}

async function countActiveAdmins(excludeUserId = null) {
  const rows = await query(
    `SELECT user_id, roles, role
     FROM users
     WHERE is_deleted = 0 AND is_active = 1`
  );
  return rows.filter((row) => {
    if (excludeUserId != null && Number(row.user_id) === Number(excludeUserId)) {
      return false;
    }
    const dto = publicUser(row);
    return dto.roles.includes('admin');
  }).length;
}

router.get('/', async (_req, res) => {
  try {
    const rows = await query(
      `SELECT user_id, login_id, display_name, role, roles, is_active,
              permissions, departments, areas, version, created_at, updated_at
       FROM users
       WHERE is_deleted = 0
       ORDER BY user_id ASC`
    );
    return res.json({
      ok: true,
      users: rows.map((row) => toUserDto(row)),
      features: FEATURES,
      roles: ROLES,
    });
  } catch (err) {
    console.error('[users/list]', err);
    return res.status(500).json({
      ok: false,
      error: 'server_error',
      message: 'ユーザー一覧の取得に失敗しました',
    });
  }
});

router.post('/', async (req, res) => {
  try {
    const loginId = String(req.body.login_id || '').trim();
    const displayName = String(req.body.display_name || '').trim();
    const password = String(req.body.password || '');
    const roles = normalizeRoles(req.body.roles);
    const departments = parseListInput(req.body.departments);
    const areas = parseListInput(req.body.areas);
    const isActive = req.body.is_active === false || req.body.is_active === 0 ? 0 : 1;
    const legacyRole = roles.includes('admin') ? 'admin' : 'staff';

    if (!validateLoginId(loginId)) {
      return res.status(400).json({
        ok: false,
        error: 'validation_error',
        message: 'ログインIDは半角英数字・._- で3〜64文字にしてください',
      });
    }
    if (!displayName) {
      return res.status(400).json({
        ok: false,
        error: 'validation_error',
        message: '表示名を入力してください',
      });
    }
    if (password.length < 6) {
      return res.status(400).json({
        ok: false,
        error: 'validation_error',
        message: 'パスワードは6文字以上にしてください',
      });
    }
    if (roles.length === 0) {
      return res.status(400).json({
        ok: false,
        error: 'validation_error',
        message: '権限を1つ以上選択してください',
      });
    }

    const existing = await query(
      'SELECT user_id FROM users WHERE login_id = ? AND is_deleted = 0 LIMIT 1',
      [loginId]
    );
    if (existing.length) {
      return res.status(409).json({
        ok: false,
        error: 'conflict',
        message: 'このログインIDは既に使われています',
      });
    }

    const hash = await bcrypt.hash(password, 10);
    const pool = getPool();
    const [result] = await pool.execute(
      `INSERT INTO users
        (login_id, password_hash, display_name, role, roles, is_active, departments, areas)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        loginId,
        hash,
        displayName,
        legacyRole,
        JSON.stringify(roles),
        isActive,
        JSON.stringify(departments),
        JSON.stringify(areas),
      ]
    );

    const created = await findUserById(result.insertId);
    return res.status(201).json({
      ok: true,
      user: toUserDto(created),
    });
  } catch (err) {
    console.error('[users/create]', err);
    return res.status(500).json({
      ok: false,
      error: 'server_error',
      message: 'ユーザーの作成に失敗しました',
    });
  }
});

router.put('/:id', async (req, res) => {
  try {
    const userId = Number(req.params.id);
    if (!Number.isInteger(userId) || userId <= 0) {
      return res.status(400).json({
        ok: false,
        error: 'validation_error',
        message: 'ユーザーIDが不正です',
      });
    }

    const current = await findUserById(userId);
    if (!current) {
      return res.status(404).json({
        ok: false,
        error: 'not_found',
        message: 'ユーザーが見つかりません',
      });
    }

    const currentDto = toUserDto(current);
    const displayName = String(req.body.display_name ?? current.display_name).trim();
    const roles = req.body.roles !== undefined
      ? normalizeRoles(req.body.roles)
      : currentDto.roles;
    const departments = req.body.departments !== undefined
      ? parseListInput(req.body.departments)
      : currentDto.departments;
    const areas = req.body.areas !== undefined
      ? parseListInput(req.body.areas)
      : currentDto.areas;
    const isActive = req.body.is_active === false || req.body.is_active === 0
      ? 0
      : (req.body.is_active === true || req.body.is_active === 1 ? 1 : Number(current.is_active));
    const password = req.body.password != null ? String(req.body.password) : '';
    const expectedVersion = req.body.version != null ? Number(req.body.version) : null;
    const legacyRole = roles.includes('admin') ? 'admin' : 'staff';

    if (!displayName) {
      return res.status(400).json({
        ok: false,
        error: 'validation_error',
        message: '表示名を入力してください',
      });
    }
    if (roles.length === 0) {
      return res.status(400).json({
        ok: false,
        error: 'validation_error',
        message: '権限を1つ以上選択してください',
      });
    }
    if (password && password.length < 6) {
      return res.status(400).json({
        ok: false,
        error: 'validation_error',
        message: 'パスワードは6文字以上にしてください',
      });
    }

    if (Number(req.session.user.user_id) === userId) {
      if (!isActive) {
        return res.status(400).json({
          ok: false,
          error: 'validation_error',
          message: '自分自身を無効化することはできません',
        });
      }
      const selfFeatures = publicUser({ ...current, roles, is_active: isActive });
      if (!hasPermission(selfFeatures, 'users')) {
        return res.status(400).json({
          ok: false,
          error: 'validation_error',
          message: '自分自身からユーザー管理権限を外すことはできません',
        });
      }
    }

    const willRemainAdmin = roles.includes('admin') && isActive;
    if (currentDto.roles.includes('admin') && !willRemainAdmin) {
      const remaining = await countActiveAdmins(userId);
      if (remaining === 0) {
        return res.status(400).json({
          ok: false,
          error: 'validation_error',
          message: '有効な管理者がいなくなる変更はできません',
        });
      }
    }

    const params = [
      displayName,
      legacyRole,
      JSON.stringify(roles),
      isActive,
      JSON.stringify(departments),
      JSON.stringify(areas),
    ];
    let sql = `
      UPDATE users
      SET display_name = ?,
          role = ?,
          roles = ?,
          is_active = ?,
          departments = ?,
          areas = ?,
          version = version + 1,
          updated_at = CURRENT_TIMESTAMP
    `;

    if (password) {
      const hash = await bcrypt.hash(password, 10);
      sql += ', password_hash = ?';
      params.push(hash);
    }

    sql += ' WHERE user_id = ? AND is_deleted = 0';
    params.push(userId);

    if (expectedVersion != null && Number.isInteger(expectedVersion)) {
      sql += ' AND version = ?';
      params.push(expectedVersion);
    }

    const pool = getPool();
    const [result] = await pool.execute(sql, params);
    if (result.affectedRows === 0) {
      return res.status(409).json({
        ok: false,
        error: 'conflict',
        message: '他のユーザーが先に更新しました。再読み込みしてください',
      });
    }

    const updated = await findUserById(userId);
    if (Number(req.session.user.user_id) === userId) {
      req.session.user = publicUser(updated);
    }

    return res.json({
      ok: true,
      user: toUserDto(updated),
    });
  } catch (err) {
    console.error('[users/update]', err);
    return res.status(500).json({
      ok: false,
      error: 'server_error',
      message: 'ユーザーの更新に失敗しました',
    });
  }
});

router.delete('/:id', async (req, res) => {
  try {
    const userId = Number(req.params.id);
    if (!Number.isInteger(userId) || userId <= 0) {
      return res.status(400).json({
        ok: false,
        error: 'validation_error',
        message: 'ユーザーIDが不正です',
      });
    }

    if (Number(req.session.user.user_id) === userId) {
      return res.status(400).json({
        ok: false,
        error: 'validation_error',
        message: '自分自身を削除することはできません',
      });
    }

    const current = await findUserById(userId);
    if (!current) {
      return res.status(404).json({
        ok: false,
        error: 'not_found',
        message: 'ユーザーが見つかりません',
      });
    }

    const currentDto = toUserDto(current);
    if (currentDto.roles.includes('admin')) {
      const remaining = await countActiveAdmins(userId);
      if (remaining === 0) {
        return res.status(400).json({
          ok: false,
          error: 'validation_error',
          message: '最後の管理者は削除できません',
        });
      }
    }

    await query(
      `UPDATE users
       SET is_deleted = 1, is_active = 0, version = version + 1, updated_at = CURRENT_TIMESTAMP
       WHERE user_id = ? AND is_deleted = 0`,
      [userId]
    );

    return res.json({ ok: true });
  } catch (err) {
    console.error('[users/delete]', err);
    return res.status(500).json({
      ok: false,
      error: 'server_error',
      message: 'ユーザーの削除に失敗しました',
    });
  }
});

module.exports = router;
