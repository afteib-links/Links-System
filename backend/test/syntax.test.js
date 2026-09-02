const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

function javascriptFiles(root) {
  const result = [];
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    const full = path.join(root, entry.name);
    if (entry.isDirectory()) result.push(...javascriptFiles(full));
    else if (entry.isFile() && entry.name.endsWith('.js')) result.push(full);
  }
  return result;
}

test('バックエンドJavaScriptに構文エラーがない', () => {
  const backend = path.resolve(__dirname, '..');
  const files = [...javascriptFiles(path.join(backend, 'src')), ...javascriptFiles(path.join(backend, 'scripts'))];
  for (const file of files) {
    const checked = spawnSync(process.execPath, ['--check', file], { encoding: 'utf8' });
    assert.equal(checked.status, 0, `${path.relative(backend, file)}\n${checked.stderr}`);
  }
});
