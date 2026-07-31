const fs = require('fs');
const path = require('path');
const mysql = require('mysql2/promise');

// DB接続プール。環境変数で接続先を切り替える（ローカル/NAS共通）。
const pool = mysql.createPool({
  host: process.env.DB_HOST || '127.0.0.1',
  port: Number(process.env.DB_PORT || 3306),
  user: process.env.DB_USER || 'links',
  password: process.env.DB_PASSWORD || 'changeme',
  database: process.env.DB_NAME || 'links_system',
  waitForConnections: true,
  connectionLimit: 10,
  timezone: 'Z',
  charset: 'utf8mb4',
});

// db/init.sql（スキーマ定義）を起動時に適用する。
// 開発環境ではこの自動マイグレーションでテーブルを用意し、
// 本番（NAS）では docker-entrypoint 経由でも同じSQLを適用できる。
async function runInitSql() {
  const sqlPath = path.resolve(__dirname, '../../db/init.sql');
  const sql = fs.readFileSync(sqlPath, 'utf8');
  const conn = await mysql.createConnection({
    host: process.env.DB_HOST || '127.0.0.1',
    port: Number(process.env.DB_PORT || 3306),
    user: process.env.DB_USER || 'links',
    password: process.env.DB_PASSWORD || 'changeme',
    database: process.env.DB_NAME || 'links_system',
    multipleStatements: true,
  });
  try {
    await conn.query(sql);
  } finally {
    await conn.end();
  }
}

module.exports = { pool, runInitSql };
