const fs = require('fs');
const path = require('path');
const { version } = require('../../package.json');

const BUILD_INFO_PATH = path.resolve(__dirname, '../../build-info.json');

function getSystemVersion(filePath = BUILD_INFO_PATH) {
  try {
    const info = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    if (info.version === version && /^[a-f0-9]{12}$/.test(info.build_id) && !Number.isNaN(Date.parse(info.built_at))) {
      return { version, build_id: info.build_id, built_at: info.built_at };
    }
  } catch (_error) {
    // Development runs do not have a Docker-generated build record.
  }
  return { version, build_id: null, built_at: null };
}

module.exports = { BUILD_INFO_PATH, getSystemVersion };
