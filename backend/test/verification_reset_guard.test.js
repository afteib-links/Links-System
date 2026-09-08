const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const { spawnSync } = require('node:child_process');

const script = path.join(__dirname, '..', 'scripts', 'seed_verification_data.js');

function resetWith(environment) {
  return spawnSync(process.execPath, [script, '--reset'], {
    cwd: path.join(__dirname, '..'),
    env: { ...process.env, ...environment },
    encoding: 'utf8',
  });
}

test('本番モードでは確認指定があっても検証データをリセットしない', () => {
  const result = resetWith({
    NODE_ENV: 'production',
    VERIFICATION_RESET_CONFIRM: 'DELETE_VERIFICATION_DATA',
  });
  assert.notEqual(result.status, 0);
  assert.match(`${result.stdout}${result.stderr}`, /本番モードでは検証データのリセットを実行できません/);
});

test('確認指定がない検証データリセットを拒否する', () => {
  const result = resetWith({ NODE_ENV: 'test', VERIFICATION_RESET_CONFIRM: '' });
  assert.notEqual(result.status, 0);
  assert.match(`${result.stdout}${result.stderr}`, /VERIFICATION_RESET_CONFIRM=DELETE_VERIFICATION_DATA/);
});

test('確認指定がない検証参照の切離しを拒否する', () => {
  const result = spawnSync(process.execPath, [script, '--detach-external-projects'], {
    env: { ...process.env, NODE_ENV: 'development', VERIFICATION_DETACH_CONFIRM: '' },
    encoding: 'utf8',
  });
  assert.notEqual(result.status, 0);
  assert.match(`${result.stdout}${result.stderr}`, /VERIFICATION_DETACH_CONFIRM=DETACH_EXTERNAL_PROJECTS/);
});

test('本番モードでは検証参照の切離しを拒否する', () => {
  const result = spawnSync(process.execPath, [script, '--detach-external-projects'], {
    env: { ...process.env, NODE_ENV: 'production', VERIFICATION_DETACH_CONFIRM: 'DETACH_EXTERNAL_PROJECTS' },
    encoding: 'utf8',
  });
  assert.notEqual(result.status, 0);
  assert.match(`${result.stdout}${result.stderr}`, /本番モードでは検証データ参照の切離しを実行できません/);
});
