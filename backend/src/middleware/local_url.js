// Docker Desktopのlocalhost経路で接続がリセットされる環境ではIPv4を使う。
// NASのIP・独自ホスト名とAPIリクエストは変更しない。
function localUrl(req, res, next) {
  const host = req.get('host') || '';
  if (req.method !== 'GET' || req.path !== '/' || !/^localhost(?::\d+)?$/i.test(host)) return next();
  const target = new URL(req.originalUrl, `http://${host.replace(/^localhost/i, '127.0.0.1')}`);
  res.setHeader('Cache-Control', 'no-store');
  return res.redirect(302, target.href);
}

module.exports = { localUrl };
