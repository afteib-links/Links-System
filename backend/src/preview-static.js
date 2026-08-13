/**
 * DB なしで SPA をブラウザ確認するための簡易サーバー（ログイン・API は不可）
 * 本番同等の動作確認は docker compose または npm start（MariaDB 接続）を使う。
 */
const express = require('express');
const path = require('path');

const port = Number(process.env.APP_PORT || 8080);
const frontendDir = path.resolve(__dirname, '../../frontend');

const noCache = (res) => {
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
  res.setHeader('Pragma', 'no-cache');
};

const app = express();

app.use((req, res, next) => {
  if (!req.path.startsWith('/api/')) {
    next();
    return;
  }
  res.status(503).json({
    ok: false,
    error: 'preview_mode',
    message:
      'プレビューモードです。ログインするには Docker で `docker compose up --build -d` を実行してください。',
  });
});

app.use(
  express.static(frontendDir, {
    etag: false,
    lastModified: false,
    setHeaders: noCache,
  })
);

app.use((req, res, next) => {
  if (req.method !== 'GET') {
    next();
    return;
  }
  noCache(res);
  res.sendFile(path.join(frontendDir, 'index.html'));
});

app.listen(port, '0.0.0.0', () => {
  console.log(`[preview] Links-System UI only: http://localhost:${port}`);
  console.log('[preview] ログインには MariaDB + API サーバーが必要です（README の docker compose 参照）');
});
