/**
 * 認証・ロール関連ミドルウェア
 * requireAuth: ログイン必須
 * requireRole(...roles): 指定ロールのいずれか必須
 */

function requireAuth(req, res, next) {
  if (!req.session || !req.session.user) {
    return res.status(401).json({
      ok: false,
      error: 'unauthorized',
      message: 'ログインが必要です',
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

module.exports = {
  requireAuth,
  requireRole,
};
