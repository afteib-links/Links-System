const express = require('express');
const path = require('path');
const session = require('express-session');
const MySQLStoreFactory = require('express-mysql-session');
const { config } = require('./config');
const { getPool, ping } = require('./db');
const { runMigrationsAndSeed } = require('./migrate');
const { requireAuth, requireRole } = require('./middleware/auth');
const authRoutes = require('./routes/auth');


async function createApp() {
  const app = express();
  const MySQLStore = MySQLStoreFactory(session);

  app.set('trust proxy', 1);
  app.use(express.json({ limit: '1mb' }));
  app.use(express.urlencoded({ extended: false }));

  const sessionStore = new MySQLStore(
    {
      clearExpired: true,
      checkExpirationInterval: 15 * 60 * 1000,
      expiration: 7 * 24 * 60 * 60 * 1000,
      createDatabaseTable: false,
      schema: {
        tableName: 'sessions',
        columnNames: {
          session_id: 'session_id',
          expires: 'expires',
          data: 'data',
        },
      },
    },
    getPool()
  );

  app.use(
    session({
      name: 'connect.sid',
      secret: config.sessionSecret,
      resave: false,
      saveUninitialized: false,
      store: sessionStore,
      cookie: {
        httpOnly: true,
        sameSite: 'lax',
        secure: false,
        maxAge: 7 * 24 * 60 * 60 * 1000,
      },
    })
  );

  app.get('/api/health', async (_req, res) => {
    try {
      await ping();
      return res.json({
        ok: true,
        service: 'links-system',
        db: 'up',
        time: new Date().toISOString(),
      });
    } catch (err) {
      console.error('[health]', err);
      return res.status(503).json({
        ok: false,
        service: 'links-system',
        db: 'down',
        message: 'データベースに接続できません',
      });
    }
  });

  app.use('/api/auth', authRoutes);

  // ロールミドルウェアの動作確認用（管理画面は後続フェーズ）
  app.get('/api/admin/ping', requireAuth, requireRole('admin'), (req, res) => {
    res.json({
      ok: true,
      message: 'admin role ok',
      user: req.session.user,
    });
  });

  // 以降の /api/* はログイン必須（auth / health 以外の土台）
  app.use('/api', requireAuth, (_req, res) => {
    res.status(404).json({
      ok: false,
      error: 'not_found',
      message: 'APIが見つかりません',
    });
  });

  const frontendDir = path.resolve(__dirname, '../../frontend');
  app.use(express.static(frontendDir));

  // SPAフォールバック（API以外のGET）
  app.use((req, res, next) => {
    if (req.method !== 'GET' || req.path.startsWith('/api/')) {
      return next();
    }
    return res.sendFile(path.join(frontendDir, 'index.html'));
  });

  return app;
}

async function start() {
  console.log('[boot] waiting for DB and applying migrations...');
  await runMigrationsAndSeed();
  const app = await createApp();
  app.listen(config.appPort, '0.0.0.0', () => {
    console.log(`[boot] Links-System listening on :${config.appPort}`);
  });
}

if (require.main === module) {
  start().catch((err) => {
    console.error('[boot] failed:', err);
    process.exit(1);
  });
}

module.exports = { createApp, start };
