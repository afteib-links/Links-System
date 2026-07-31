const express = require('express');
const path = require('path');
const session = require('express-session');
const MySQLStoreFactory = require('express-mysql-session');
const { config } = require('./config');
const { getPool, ping } = require('./db');
const { runMigrationsAndSeed } = require('./migrate');
const { requireAuth, requireRole } = require('./middleware/auth');
const authRoutes = require('./routes/auth');
const usersRoutes = require('./routes/users');
const mastersRoutes = require('./routes/masters');
const companiesRoutes = require('./routes/companies');
const partnersRoutes = require('./routes/partners');
const projectsRoutes = require('./routes/projects');
const dailyReportsRoutes = require('./routes/daily_reports');
const advancesRoutes = require('./routes/advances');
const invoicesRoutes = require('./routes/invoices');
const paymentsRoutes = require('./routes/payments');
const lookupsRoutes = require('./routes/lookups');
const layoutsRoutes = require('./routes/layouts');
const priceSetsRoutes = require('./routes/price_sets');
const masterSettingsRoutes = require('./routes/master_settings');


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
  app.use('/api/users', usersRoutes);
  app.use('/api/masters', mastersRoutes);
  app.use('/api/lookups', lookupsRoutes);
  app.use('/api/companies', companiesRoutes);
  app.use('/api/partners', partnersRoutes);
  app.use('/api/projects', projectsRoutes);
  app.use('/api/daily-reports', dailyReportsRoutes);
  app.use('/api/advances', advancesRoutes);
  app.use('/api/invoices', invoicesRoutes);
  app.use('/api/payments', paymentsRoutes);
  app.use('/api/layouts', layoutsRoutes);
  app.use('/api/price-sets', priceSetsRoutes);
  app.use('/api/master-settings', masterSettingsRoutes);

  // ロール／機能権限の動作確認用
  app.get('/api/admin/ping', requireAuth, requireRole('admin'), (req, res) => {
    res.json({
      ok: true,
      message: 'admin role ok',
      user: req.session.user,
    });
  });

  app.get('/api/permissions/check/:feature', requireAuth, (req, res) => {
    const { hasPermission } = require('./permissions');
    const feature = String(req.params.feature || '');
    const allowed = hasPermission(req.session.user, feature);
    if (!allowed) {
      return res.status(403).json({
        ok: false,
        error: 'forbidden',
        message: 'この機能を利用する権限がありません',
        feature,
        allowed: false,
      });
    }
    return res.json({
      ok: true,
      feature,
      allowed: true,
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
