/**
 * 認証・ロール・機能権限ミドルウェア
 * requireAuth: ログイン必須
 * requireRole(...roles): 指定ロールのいずれか必須
 * requirePermission(...features): 指定機能のいずれか（または全て）必須
 */

const { hasPermission } = require('../permissions');

function requireAuth(req, res, next) {
  if (!req.session || !req.session.user) {
    return res.status(401).json({
      ok: false,
      error: 'unauthorized',
      message: 'ログインが必要です',
    });
  }
  if (req.session.user.is_active === false) {
    return res.status(403).json({
      ok: false,
      error: 'disabled',
      message: 'このユーザーは無効化されています',
    });
  }
  return next();
}

function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.session || !req.session.user) {
      return res.status(401).json({
        ok: false,
        error: 'unauthorized',
        message: 'ログインが必要です',
      });
    }
    if (!roles.includes(req.session.user.role)) {
      return res.status(403).json({
        ok: false,
        error: 'forbidden',
        message: 'この操作を行う権限がありません',
      });
    }
    return next();
  };
}

/**
 * 指定機能キーのうち1つでも持っていれば許可
 */
function requirePermission(...featureKeys) {
  return (req, res, next) => {
    if (!req.session || !req.session.user) {
      return res.status(401).json({
        ok: false,
        error: 'unauthorized',
        message: 'ログインが必要です',
      });
    }
    const allowed = featureKeys.some((key) => hasPermission(req.session.user, key));
    if (!allowed) {
      return res.status(403).json({
        ok: false,
        error: 'forbidden',
        message: 'この機能を利用する権限がありません',
      });
    }
    return next();
  };
}

module.exports = {
  requireAuth,
  requireRole,
  requirePermission,
};
