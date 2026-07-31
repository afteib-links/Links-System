require('dotenv').config({ path: require('path').resolve(__dirname, '../../.env') });

const path = require('path');
const express = require('express');
const { runInitSql } = require('./db');
const { ensureAdminUser, login } = require('./auth');
const companiesRouter = require('./routes/companies');

const app = express();
const PORT = Number(process.env.APP_PORT || 3000);

app.use(express.json());

// ヘルスチェック（環境確認用）。
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', time: new Date().toISOString() });
});

// ログイン。
app.post('/api/auth/login', async (req, res) => {
  const { login_id, password } = req.body || {};
  if (!login_id || !password) {
    return res.status(400).json({ error: 'login_id と password は必須です' });
  }
  const result = await login(login_id, password);
  if (!result) {
    return res.status(401).json({ error: 'IDまたはパスワードが違います' });
  }
  res.json(result);
});

// マスタAPI。
app.use('/api/companies', companiesRouter);

// フロントエンド（SPA）を同一オリジンで配信（仕様 §7）。
app.use('/', express.static(path.resolve(__dirname, '../../frontend')));

async function start() {
  await runInitSql();
  await ensureAdminUser();
  app.listen(PORT, () => {
    console.log(`Links-System API を起動しました: http://localhost:${PORT}`);
  });
}

start().catch((err) => {
  console.error('起動に失敗しました:', err);
  process.exit(1);
});
