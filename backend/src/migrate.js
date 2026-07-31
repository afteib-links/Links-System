const fs = require('fs');
const path = require('path');
const bcrypt = require('bcryptjs');
const { getPool, waitForDb } = require('./db');
const { config } = require('./config');

const MIGRATIONS_DIR = path.resolve(__dirname, '../../db/migrations');

async function ensureMigrationsTable(conn) {
  await conn.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      id INT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
      filename VARCHAR(255) NOT NULL UNIQUE,
      applied_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);
}

async function getAppliedFilenames(conn) {
  const [rows] = await conn.query('SELECT filename FROM schema_migrations ORDER BY filename ASC');
  return new Set(rows.map((r) => r.filename));
}

function listMigrationFiles() {
  if (!fs.existsSync(MIGRATIONS_DIR)) {
    throw new Error(`マイグレーションディレクトリが見つかりません: ${MIGRATIONS_DIR}`);
  }
  return fs
    .readdirSync(MIGRATIONS_DIR)
    .filter((name) => name.endsWith('.sql'))
    .sort();
}

async function applyMigrations() {
  await waitForDb();
  const pool = getPool();
  const conn = await pool.getConnection();

  try {
    await ensureMigrationsTable(conn);
    const applied = await getAppliedFilenames(conn);
    const files = listMigrationFiles();

    for (const filename of files) {
      if (applied.has(filename)) {
        console.log(`[migrate] skip: ${filename}`);
        continue;
      }

      const fullPath = path.join(MIGRATIONS_DIR, filename);
      const sql = fs.readFileSync(fullPath, 'utf8');
      console.log(`[migrate] apply: ${filename}`);

      await conn.beginTransaction();
      try {
        await conn.query(sql);
        await conn.query('INSERT INTO schema_migrations (filename) VALUES (?)', [filename]);
        await conn.commit();
        console.log(`[migrate] done: ${filename}`);
      } catch (err) {
        await conn.rollback();
        throw err;
      }
    }
  } finally {
    conn.release();
  }
}

async function seedAdminIfNeeded() {
  const pool = getPool();
  const [rows] = await pool.execute(
    'SELECT COUNT(*) AS cnt FROM users WHERE is_deleted = 0'
  );
  const count = Number(rows[0].cnt);
  if (count > 0) {
    console.log('[seed] users already exist, skip admin seed');
    return;
  }

  const hash = await bcrypt.hash(config.admin.password, 10);
  await pool.execute(
    `INSERT INTO users (login_id, password_hash, display_name, role)
     VALUES (?, ?, ?, 'admin')`,
    [config.admin.loginId, hash, config.admin.displayName]
  );
  console.log(`[seed] created admin user: ${config.admin.loginId}`);
}

async function runMigrationsAndSeed() {
  await applyMigrations();
  await seedAdminIfNeeded();
}

if (require.main === module) {
  runMigrationsAndSeed()
    .then(() => {
      console.log('[migrate] completed');
      process.exit(0);
    })
    .catch((err) => {
      console.error('[migrate] failed:', err);
      process.exit(1);
    });
}

module.exports = {
  applyMigrations,
  seedAdminIfNeeded,
  runMigrationsAndSeed,
};
