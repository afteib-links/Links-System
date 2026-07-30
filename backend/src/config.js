const path = require('path');
const dotenv = require('dotenv');

dotenv.config({ path: path.resolve(__dirname, '../../.env') });

const config = {
  appPort: Number(process.env.APP_PORT || 3000),
  tz: process.env.TZ || 'Asia/Tokyo',
  sessionSecret: process.env.SESSION_SECRET || 'dev-only-session-secret',
  db: {
    host: process.env.DB_HOST || '127.0.0.1',
    port: Number(process.env.DB_PORT || 3306),
    user: process.env.DB_USER || 'links',
    password: process.env.DB_PASSWORD || 'links_pass_change_me',
    database: process.env.DB_NAME || 'links_system',
  },
  admin: {
    loginId: process.env.ADMIN_LOGIN_ID || 'admin',
    password: process.env.ADMIN_PASSWORD || 'admin1234',
    displayName: process.env.ADMIN_DISPLAY_NAME || '管理者',
  },
};

module.exports = { config };
