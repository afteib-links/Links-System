const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const { FEATURES } = require('../src/permissions');

const root = path.resolve(__dirname, '..', '..');
const source = path.join(root, '仕様MD', 'システム設計');
const output = path.join(root, 'システム設計書');
const requiredHeadings = [
  '目的と設計意図', '利用者・権限', '前提・入力・処理・出力', '関連機能・前後工程',
  '主要API・データ', '状態・制御・注意点', '現行業務との乖離・確認事項', '今後の改善',
];

test('登録済みの全機能に手動編集可能な設計章がある', () => {
  assert.equal(FEATURES.length, 25);
  for (const feature of FEATURES) {
    const file = path.join(source, '機能', `${feature.key}.md`);
    assert.ok(fs.existsSync(file), `${feature.key} の設計章がありません`);
    const body = fs.readFileSync(file, 'utf8');
    assert.match(body, new RegExp(`^feature_key: ${feature.key}$`, 'm'));
    for (const heading of requiredHeadings) assert.ok(body.includes(`## ${heading}`), `${feature.key}: ${heading} がありません`);
  }
});

test('設計書は生成物、検索資産、匿名スキーマを持つ', () => {
  for (const name of ['index.html', 'catalog.json', 'system-design.css', 'system-design.js']) {
    assert.ok(fs.existsSync(path.join(output, name)), `${name} がありません`);
  }
  const html = fs.readFileSync(path.join(output, 'index.html'), 'utf8');
  assert.equal((html.match(/class="doc-section feature-section searchable"/g) || []).length, FEATURES.length);
  assert.match(html, /DB一覧（自動スナップショット）/);
  assert.doesNotMatch(html, /admin1234/);
  const schema = JSON.parse(fs.readFileSync(path.join(source, 'generated', 'schema.json'), 'utf8'));
  assert.equal(schema.source, 'information_schema');
  assert.ok(Array.isArray(schema.tables));
});

test('サーバーとDockerは認証付き設計書を配信する', () => {
  const server = fs.readFileSync(path.join(root, 'backend', 'src', 'server.js'), 'utf8');
  const dockerfile = fs.readFileSync(path.join(root, 'Dockerfile'), 'utf8');
  const app = fs.readFileSync(path.join(root, 'frontend', 'js', 'app.js'), 'utf8');
  assert.match(server, /'\/system-design'[\s\S]*requireAuth[\s\S]*requireRole\('admin', 'system'\)[\s\S]*express\.static\(systemDesignDir/);
  assert.match(dockerfile, /COPY \["システム設計書", "\.\/システム設計書"\]/);
  assert.match(app, /href="\/system-design\/"/);
  assert.match(app, /searchParams\.get\('feature'\)/);
});
