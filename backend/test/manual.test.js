const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const test = require('node:test');

const root = path.resolve(__dirname, '..', '..');
const manualDir = path.join(root, '利用マニュアル');
const html = fs.readFileSync(path.join(manualDir, 'index.html'), 'utf8');

const featureKeys = [
  'base_management', 'companies', 'partners', 'base_projects', 'projects', 'price_sets',
  'office_work', 'daily_reports', 'daily_report_submissions', 'advances', 'invoices',
  'payments', 'cash_management', 'analytics', 'master_settings', 'help_settings',
  'ui_builder', 'users',
];

test('利用マニュアルは全18機能と各3件の具体例を持つ', () => {
  for (const key of featureKeys) {
    const start = html.indexOf(`id="${key}" data-chapter="${key}"`);
    assert.ok(start >= 0, `${key} の章がありません`);
    const next = html.indexOf('<article class="manual-chapter', start + 1);
    const chapter = html.slice(start, next >= 0 ? next : undefined);
    assert.equal((chapter.match(/<section><h3>[123]\./g) || []).length, 3, `${key} の具体例は3件必要です`);
    assert.match(chapter, /<figure>/, `${key} に画面イメージがありません`);
  }
});

test('利用マニュアルのローカル画像と資産参照は存在する', () => {
  const refs = [...html.matchAll(/(?:src|href)="([^"#]+)"/g)].map((match) => match[1]);
  for (const ref of refs) {
    if (ref.startsWith('/') || /^[a-z]+:/i.test(ref)) continue;
    const clean = ref.split('?')[0];
    assert.ok(fs.existsSync(path.resolve(manualDir, clean)), `参照先がありません: ${ref}`);
  }
});

test('利用マニュアルJavaScriptに構文エラーがない', () => {
  const file = path.join(manualDir, 'manual.js');
  const checked = spawnSync(process.execPath, ['--check', file], { encoding: 'utf8' });
  assert.equal(checked.status, 0, checked.stderr);
});

test('システムはマニュアルを公開し共通ヘッダーから新規タブで開く', () => {
  const server = fs.readFileSync(path.join(root, 'backend/src/server.js'), 'utf8');
  const dockerfile = fs.readFileSync(path.join(root, 'Dockerfile'), 'utf8');
  const app = fs.readFileSync(path.join(root, 'frontend/js/app.js'), 'utf8');
  assert.match(server, /app\.use\(\s*'\/manual'/);
  assert.ok(server.indexOf("'/manual'") < server.indexOf('express.static(frontendDir'), 'manualルートはSPAより前に置く');
  assert.match(dockerfile, /COPY \["利用マニュアル", "\.\/利用マニュアル"\]/);
  assert.match(app, /href="\/manual\/" target="_blank" rel="noopener noreferrer"/);
});

test('重複して見える主要機能の作成理由を説明する', () => {
  for (const phrase of [
    '基本管理 と 各マスタ', '基本案件 と 個別案件', '日報 と 日報提出',
    '請求 と 支払', '先払い・支払・入出金管理', '画面ヘルプ と 利用マニュアル',
  ]) assert.ok(html.includes(phrase), `${phrase} の説明がありません`);
});
