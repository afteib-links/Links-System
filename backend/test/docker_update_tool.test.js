const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.resolve(__dirname, '../..');
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), 'utf8');

test('Docker更新ツールはCompose検証・再構築・DBヘルス確認を必須にする', () => {
  for (const relativePath of ['scripts/docker-update.sh', 'scripts/docker-update.ps1']) {
    const source = read(relativePath);
    assert.match(source, /compose["', )]+config/);
    assert.match(source, /compose["', )]+up/);
    assert.match(source, /--build/);
    assert.match(source, /api\/health/);
    assert.match(source, /db/);
    assert.match(source, /up/);
    assert.doesNotMatch(source, /compose["', )]+down["', )]+-v/);
    assert.doesNotMatch(source, /(?:rm|Remove-Item).+data[\\/]mysql/);
  }
});

test('NASモードはfast-forward同期と任意バックアップを提供する', () => {
  const source = read('scripts/docker-update.sh');
  assert.match(source, /--nas/);
  assert.match(source, /--backup/);
  assert.match(source, /nas-backup\.sh/);
  assert.match(source, /pull --ff-only origin main/);
  assert.match(source, /working tree has uncommitted changes/);

  const compatibilityEntry = read('scripts/nas-sync.sh');
  assert.match(compatibilityEntry, /docker-update\.sh" --nas "\$@"/);
});

test('Docker更新の自動起動条件をSkill・Rule・全AI入口に保持する', () => {
  const skill = read('.cursor/skills/docker-update/SKILL.md');
  const rule = read('.cursor/rules/docker-update.mdc');
  const agents = read('AGENTS.md');

  assert.match(skill, /name: docker-update/);
  assert.match(skill, /Docker更新/);
  assert.doesNotMatch(skill, /disable-model-invocation:\s*true/);
  assert.match(rule, /alwaysApply:\s*true/);
  assert.match(rule, /Docker更新/);
  assert.match(agents, /Docker更新の自動実行/);
  assert.match(agents, /scripts\/docker-update\.ps1/);
  assert.match(agents, /scripts\/docker-update\.sh --nas --backup/);
});
