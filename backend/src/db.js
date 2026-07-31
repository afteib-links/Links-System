const mysql = require('mysql2/promise');
const { config } = require('./config');

let pool = null;

function getPool() {
  if (!pool) {
    pool = mysql.createPool({
      host: config.db.host,
      port: config.db.port,
      user: config.db.user,
      password: config.db.password,
      database: config.db.database,
      waitForConnections: true,
      connectionLimit: 10,
      namedPlaceholders: true,
      timezone: 'Z',
      dateStrings: true,
      multipleStatements: true,
    });
  }
  return pool;
}

async function query(sql, params) {
  const [rows] = await getPool().execute(sql, params);
  return rows;
}

async function ping() {
  const conn = await getPool().getConnection();
  try {
    await conn.ping();
    return true;
  } finally {
    conn.release();
  }
}

async function waitForDb(retries = 40, delayMs = 1500) {
  let lastError = null;
  for (let i = 0; i < retries; i += 1) {
    try {
      await ping();
      return;
    } catch (err) {
      lastError = err;
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }
  throw lastError || new Error('DB接続に失敗しました');
}

module.exports = {
  getPool,
  query,
  ping,
  waitForDb,
};
