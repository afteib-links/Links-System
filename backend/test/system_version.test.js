const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { createBuildInfo } = require('../scripts/generate_build_info');
const { getSystemVersion } = require('../src/services/system_version');
const { version } = require('../package.json');

function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'links-build-version-'));
  for (const directory of ['backend/src', 'backend/scripts', 'frontend', 'db', '利用マニュアル']) {
    fs.mkdirSync(path.join(root, directory), { recursive:true });
  }
  fs.writeFileSync(path.join(root, 'backend/package.json'), JSON.stringify({ version:'1.2.3' }));
  fs.writeFileSync(path.join(root, 'backend/src/app.js'), 'first');
  return root;
}

test('ビルド識別子はコピーしたソース変更で変わり、生成日時だけでは変わらない', () => {
  const root = fixture();
  try {
    const first = createBuildInfo(root, new Date('2026-09-12T00:00:00Z'));
    assert.equal(first.version, '1.2.3');
    assert.match(first.build_id, /^[a-f0-9]{12}$/);
    const rebuilt = createBuildInfo(root, new Date('2026-09-13T00:00:00Z'));
    assert.equal(first.build_id, rebuilt.build_id);
    assert.notEqual(first.built_at, rebuilt.built_at);
    fs.writeFileSync(path.join(root, 'backend/src/app.js'), 'second');
    assert.notEqual(createBuildInfo(root).build_id, first.build_id);
  } finally {
    fs.rmSync(root, { recursive:true,force:true });
  }
});

test('稼働ビルド情報が無い・不正なときは版を推測しない', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'links-version-record-'));
  const file = path.join(root, 'build-info.json');
  try {
    assert.equal(getSystemVersion(file).build_id, null);
    fs.writeFileSync(file, JSON.stringify({ version,build_id:crypto.randomBytes(6).toString('hex'),built_at:'2026-09-12T00:00:00.000Z' }));
    assert.match(getSystemVersion(file).build_id,/^[a-f0-9]{12}$/);
    fs.writeFileSync(file, JSON.stringify({ version,build_id:'not-a-build',built_at:'2026-09-12T00:00:00.000Z' }));
    assert.equal(getSystemVersion(file).build_id, null);
  } finally {
    fs.rmSync(root, { recursive:true,force:true });
  }
});

test('ダッシュボードヘルプだけに自動版情報を表示する', () => {
  const server = fs.readFileSync(path.join(__dirname, '../src/routes/help.js'), 'utf8');
  const ui = fs.readFileSync(path.join(__dirname, '../../frontend/js/app.js'), 'utf8');
  assert.match(server, /screenKey === 'home'.*system_version/);
  assert.match(ui, /currentView === 'home' \? data\.system_version/);
  assert.match(ui, /ビルドID/);
});
