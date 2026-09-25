import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { marked } from 'marked';

const require = createRequire(import.meta.url);
const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(scriptDir, '..', '..');
const sourceDir = path.join(root, '仕様MD', 'システム設計');
const featureDir = path.join(sourceDir, '機能');
const generatedDir = path.join(sourceDir, 'generated');
const outputDir = path.join(root, 'システム設計書');
const schemaFile = path.join(generatedDir, 'schema.json');
const { FEATURES, FEATURE_ROLE_MAP, ROLES } = require('../src/permissions');

const REQUIRED_FEATURE_HEADINGS = [
  '目的と設計意図',
  '利用場面と操作手順',
  'なぜこの手順で利用するか',
  '利用例と完了の確認',
  '作成・変更の経緯と根拠',
  '利用者・権限',
  '前提・入力・処理・出力',
  '関連機能・前後工程',
  '主要API・データ',
  '状態・制御・注意点',
  '現行業務との乖離・確認事項',
  '今後の改善',
];

function read(file) {
  return fs.readFileSync(file, 'utf8').replaceAll('\r\n', '\n');
}

function write(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, value.replaceAll('\r\n', '\n'), 'utf8');
}

function parseFrontmatter(raw, file) {
  if (!raw.startsWith('---\n')) throw new Error(`${file}: frontmatter がありません`);
  const end = raw.indexOf('\n---\n', 4);
  if (end < 0) throw new Error(`${file}: frontmatter の終端がありません`);
  const metadata = {};
  for (const line of raw.slice(4, end).split('\n')) {
    if (!line.trim()) continue;
    const separator = line.indexOf(':');
    if (separator < 1) throw new Error(`${file}: frontmatter の形式が不正です: ${line}`);
    const key = line.slice(0, separator).trim();
    const value = line.slice(separator + 1).trim();
    metadata[key] = value;
  }
  for (const key of ['related_features', 'primary_tables', 'api_prefixes', 'specs']) {
    metadata[key] = String(metadata[key] || '').split(',').map((item) => item.trim()).filter(Boolean);
  }
  return { metadata, body: raw.slice(end + 5).trim() + '\n' };
}

function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function slug(value) {
  return String(value).toLowerCase().replace(/[^a-z0-9_\-\u3040-\u30ff\u3400-\u9fff]+/g, '-').replace(/^-|-$/g, '');
}

function scanApiRoutes() {
  const serverFile = path.join(root, 'backend', 'src', 'server.js');
  const server = read(serverFile);
  const imports = new Map();
  for (const match of server.matchAll(/const\s+(\w+)\s*=\s*require\(['"]\.\/routes\/([^'"]+)['"]\)/g)) {
    imports.set(match[1], match[2]);
  }
  const mounts = [];
  for (const match of server.matchAll(/app\.use\(\s*['"]([^'"]+)['"]\s*,([\s\S]*?)\);/g)) {
    const prefix = match[1];
    if (!prefix.startsWith('/api')) continue;
    const expression = match[2];
    const variable = [...imports.keys()].find((name) => new RegExp(`\\b${name}(?:\\.router)?\\b`).test(expression));
    const inline = expression.match(/require\(['"]\.\/routes\/([^'"]+)['"]\)/)?.[1];
    const routeFile = variable ? imports.get(variable) : inline;
    if (routeFile) mounts.push({ prefix, routeFile });
  }

  const endpoints = [];
  const seen = new Set();
  const add = (method, endpointPath, source, guard = 'ログイン必須') => {
    const key = `${method}:${endpointPath}:${source}`;
    if (seen.has(key)) return;
    seen.add(key);
    endpoints.push({ method, path: endpointPath, guard, source });
  };

  for (const { prefix, routeFile } of mounts) {
    const file = path.join(root, 'backend', 'src', 'routes', `${routeFile}.js`);
    if (!fs.existsSync(file)) continue;
    const body = read(file);
    const fileGuard = /router\.use\(\s*requireAuth/.test(body) ? 'ログイン必須' : 'ルート定義による';
    const patterns = [
      /router\.(get|post|put|patch|delete)\(\s*['"]([^'"]*)['"]([\s\S]*?)(?=\n\s*router\.|\n\s*module\.exports|$)/gi,
      /router\.route\(\s*['"]([^'"]*)['"]\s*\)([\s\S]*?)(?=\n\s*router\.|\n\s*module\.exports|$)/gi,
    ];
    for (const match of body.matchAll(patterns[0])) {
      const method = match[1].toUpperCase();
      const localPath = match[2];
      const permission = match[3].match(/requirePermission\(\s*['"]([^'"]+)['"]/i)?.[1];
      const guard = permission ? `機能権限: ${permission}` : fileGuard;
      add(method, `${prefix}${localPath === '/' ? '' : localPath}`.replace(/\/+/g, '/'), `backend/src/routes/${routeFile}.js`, guard);
    }
    for (const match of body.matchAll(patterns[1])) {
      for (const verb of match[2].matchAll(/\.(get|post|put|patch|delete)\s*\(/gi)) {
        add(verb[1].toUpperCase(), `${prefix}${match[1] === '/' ? '' : match[1]}`.replace(/\/+/g, '/'), `backend/src/routes/${routeFile}.js`, fileGuard);
      }
    }
  }

  for (const match of server.matchAll(/app\.(get|post|put|patch|delete)\(\s*['"](\/api\/[^'"]+)['"]([\s\S]*?)(?=\n\s*app\.|\n\s*\/\/|$)/gi)) {
    const permission = match[3].match(/requireRole\(([^)]+)\)/)?.[1]?.replaceAll(/["']/g, '');
    add(match[1].toUpperCase(), match[2], 'backend/src/server.js', permission ? `ロール: ${permission}` : 'ルート定義による');
  }
  return endpoints.sort((a, b) => a.path.localeCompare(b.path, 'ja') || a.method.localeCompare(b.method));
}

function loadFeatureDocuments(schema) {
  const schemaTables = new Set((schema.tables || []).map((table) => table.name));
  const featureKeys = new Set(FEATURES.map((feature) => feature.key));
  const errors = [];
  const documents = FEATURES.map((feature) => {
    const file = path.join(featureDir, `${feature.key}.md`);
    if (!fs.existsSync(file)) {
      errors.push(`${feature.key}: 機能設計Markdownがありません`);
      return { feature, metadata: {}, body: '' };
    }
    const parsed = parseFrontmatter(read(file), file);
    if (parsed.metadata.feature_key !== feature.key) errors.push(`${file}: feature_key が ${feature.key} と一致しません`);
    for (const heading of REQUIRED_FEATURE_HEADINGS) {
      if (!new RegExp(`^##\\s+${heading.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*$`, 'm').test(parsed.body)) {
        errors.push(`${file}: 必須見出し「${heading}」がありません`);
      }
    }
    for (const related of parsed.metadata.related_features) {
      if (!featureKeys.has(related)) errors.push(`${file}: 未登録の関連機能 ${related}`);
    }
    for (const table of parsed.metadata.primary_tables) {
      if (schemaTables.size && !schemaTables.has(table)) errors.push(`${file}: スキーマに存在しない主要テーブル ${table}`);
    }
    return { feature, ...parsed, file: path.relative(root, file).replaceAll('\\', '/') };
  });
  const extra = fs.existsSync(featureDir)
    ? fs.readdirSync(featureDir).filter((name) => name.endsWith('.md') && !featureKeys.has(name.slice(0, -3)))
    : [];
  for (const file of extra) errors.push(`${file}: 機能カタログに存在しない設計Markdownです`);
  if (errors.length) throw new Error(`システム設計書の整合性エラー:\n- ${errors.join('\n- ')}`);
  return documents;
}

function renderMetadata(document, endpointRows, schema) {
  const roles = (FEATURE_ROLE_MAP[document.feature.key] || []).map((key) => ROLES.find((role) => role.key === key)?.label || key);
  const endpoints = endpointRows.filter((endpoint) => document.metadata.api_prefixes.some((prefix) => endpoint.path === prefix || endpoint.path.startsWith(`${prefix}/`)));
  const tableMap = new Map((schema.tables || []).map((table) => [table.name, table]));
  const related = document.metadata.related_features.map((key) => FEATURES.find((feature) => feature.key === key)).filter(Boolean);
  return `<details class="generated-details"><summary>コードから自動抽出した技術情報</summary>
    <dl class="facts"><div><dt>機能キー</dt><dd><code>${escapeHtml(document.feature.key)}</code></dd></div><div><dt>既定ロール</dt><dd>${escapeHtml(roles.join('、') || 'なし')}</dd></div><div><dt>編集元</dt><dd><code>${escapeHtml(document.file)}</code></dd></div></dl>
    <h3>関連機能</h3><div class="tag-list">${related.map((item) => `<a href="#feature-${escapeHtml(item.key)}">${escapeHtml(item.label)}</a>`).join('') || '<span>登録なし</span>'}</div>
    <h3>API</h3>${renderApiTable(endpoints)}
    <h3>主要テーブル</h3>${document.metadata.primary_tables.length ? `<div class="tag-list">${document.metadata.primary_tables.map((name) => `<a href="#table-${escapeHtml(name)}">${escapeHtml(name)}${tableMap.has(name) ? '' : '（スナップショット未収録）'}</a>`).join('')}</div>` : '<p>直接参照する主要テーブルはありません。</p>'}
  </details>`;
}

function renderApiTable(endpoints) {
  if (!endpoints.length) return '<p class="empty">抽出対象のAPIはありません。</p>';
  return `<div class="table-scroll"><table><thead><tr><th>メソッド</th><th>パス</th><th>認証・権限</th><th>実装</th></tr></thead><tbody>${endpoints.map((endpoint) => `<tr><td><span class="method method-${endpoint.method.toLowerCase()}">${endpoint.method}</span></td><td><code>${escapeHtml(endpoint.path)}</code></td><td>${escapeHtml(endpoint.guard)}</td><td><code>${escapeHtml(endpoint.source)}</code></td></tr>`).join('')}</tbody></table></div>`;
}

function renderSchema(schema) {
  if (!schema.tables?.length) return '<p class="warning">DBスキーマスナップショットが未作成です。設計書更新コマンドで取得してください。</p>';
  const rows = schema.tables.map((table) => {
    const columns = table.columns.map((column) => `${column.name} ${column.type}${column.nullable ? '' : ' NOT NULL'}${column.key ? ` [${column.key}]` : ''}`).join('\n');
    const relations = table.foreign_keys.map((fk) => `${fk.column} → ${fk.referenced_table}.${fk.referenced_column}`).join('\n') || '外部キーなし';
    const indexes = table.indexes.map((index) => `${index.name}: ${index.columns.join(', ')}${index.unique ? ' (UNIQUE)' : ''}`).join('\n') || 'インデックスなし';
    return `<article class="schema-card searchable" id="table-${escapeHtml(table.name)}" data-search="${escapeHtml(`${table.name} ${columns} ${relations}`)}"><h3>${escapeHtml(table.name)}</h3><div class="schema-grid"><div><h4>カラム</h4><pre>${escapeHtml(columns)}</pre></div><div><h4>外部キー</h4><pre>${escapeHtml(relations)}</pre><h4>インデックス</h4><pre>${escapeHtml(indexes)}</pre></div></div></article>`;
  }).join('');
  return `<p>取得元: <code>information_schema</code> / テーブル数: ${schema.tables.length}。業務データの値は含みません。</p><div class="schema-list">${rows}</div>`;
}

function renderDocument(raw) {
  return marked.parse(raw, { gfm: true, breaks: false })
    .replaceAll('<table>', '<div class="table-scroll"><table>')
    .replaceAll('</table>', '</table></div>');
}

function sourceLink(id, title) {
  return `<p class="source-action"><a href="/system-design/sources/${encodeURIComponent(id)}.html" target="_blank" rel="noopener noreferrer">${escapeHtml(title)}の原稿（Markdown）を開く</a></p>`;
}

function sourcePage(id, title, file, content) {
  return `<!doctype html><html lang="ja"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(title)}の原稿</title><link rel="stylesheet" href="/system-design/source.css"></head>
<body><main><a href="/system-design/#${encodeURIComponent(id)}">設計書のこの章へ戻る</a><h1>${escapeHtml(title)}の原稿</h1>
<p>編集するファイル：<code id="source-path">${escapeHtml(file)}</code></p>
<p>下の本文はHTML生成時の閲覧用コピーです。修正はお手元のプロジェクト内のMarkdownへ保存し、設計書を再生成してください。</p>
<section aria-labelledby="edit-heading"><h2 id="edit-heading">元のMarkdownを編集する</h2>
<p>初回だけ、このPCにある LinksSystem フォルダーの場所を入力してください。設定はこのブラウザに記憶します。</p>
<label for="project-folder">編集用プロジェクトフォルダー（絶対パス）</label><input id="project-folder" type="text" placeholder="例：C:\\作業\\LinksSystem" autocomplete="off" spellcheck="false">
<label for="editor-choice">編集ソフト</label><select id="editor-choice"><option value="vscode">VS Code</option><option value="cursor">Cursor</option></select>
<p><a id="open-editor" hidden>元のMarkdownを編集ソフトで開く</a> <button id="copy-path" type="button">編集ファイルのパスをコピー</button></p>
<label for="resolved-path">編集するファイルの場所</label><input id="resolved-path" type="text" readonly value="${escapeHtml(file)}">
<p id="source-status" role="status" aria-live="polite"></p>
<p>リンクには選んだ編集ソフトのインストールが必要です。開けない場合はパスをコピーし、お使いの編集ソフトの「ファイルを開く」に貼り付けてください。NASで閲覧している場合も、ここには編集用PC側のフォルダーを指定します。</p></section>
<h2>原稿の内容（閲覧用）</h2><a href="${encodeURIComponent(id)}.md" download="${escapeHtml(title.replace(/[\\/:*?"<>|]/g, '_'))}.md">${escapeHtml(title)}.md をダウンロード</a>
<p>ダウンロードしたコピーの編集だけでは正本に反映されません。上記の編集元ファイルへ変更内容を反映してください。</p>
<textarea id="source-content" readonly aria-label="Markdown原稿" spellcheck="false">${escapeHtml(content)}</textarea>
<h2>保存後の反映</h2><p>プロジェクトフォルダーで次を実行し、稼働環境へ更新します。</p><pre>npm run docs:system-design --prefix backend\nnpm run docs:system-design:check --prefix backend</pre>
</main><script src="/system-design/source.js" defer></script></body></html>`;
}

function buildArtifacts() {
  if (!fs.existsSync(schemaFile)) throw new Error(`DBスキーマがありません: ${path.relative(root, schemaFile)}。先に docs:system-design:schema を実行してください。`);
  const schema = JSON.parse(read(schemaFile));
  const endpointRows = scanApiRoutes();
  const featureDocuments = loadFeatureDocuments(schema);
  const overviewFiles = fs.readdirSync(sourceDir)
    .filter((name) => /^\d{2}_.+\.md$/.test(name))
    .sort((a, b) => a.localeCompare(b, 'ja'));
  const overviewDocuments = overviewFiles.map((name) => ({ name, id: `chapter-${slug(name.slice(0, -3))}`, html: renderDocument(read(path.join(sourceDir, name))) }));
  const sourceArtifacts = {};
  for (const document of overviewDocuments) {
    const title = document.name.replace(/^\d{2}_|\.md$/g, '');
    const file = `仕様MD/システム設計/${document.name}`;
    const content = read(path.join(root, file));
    sourceArtifacts[`sources/${document.id}.html`] = sourcePage(document.id, title, file, content);
    sourceArtifacts[`sources/${document.id}.md`] = content;
    document.html = sourceLink(document.id, title) + document.html;
  }
  for (const document of featureDocuments) {
    const id = `feature-${document.feature.key}`;
    const content = read(path.join(root, document.file));
    sourceArtifacts[`sources/${id}.html`] = sourcePage(id, document.feature.label, document.file, content);
    sourceArtifacts[`sources/${id}.md`] = content;
  }
  const featureHtml = featureDocuments.map((document) => `<article class="doc-section feature-section searchable" id="feature-${escapeHtml(document.feature.key)}" data-search="${escapeHtml(`${document.feature.label} ${document.feature.key} ${document.body}`)}"><div class="section-kicker">機能設計 / ${escapeHtml(document.feature.group)}</div>${sourceLink(`feature-${document.feature.key}`, document.feature.label)}${renderDocument(document.body)}<p class="feature-actions"><a class="open-app" href="/?feature=${encodeURIComponent(document.feature.key)}" target="_blank" rel="noopener noreferrer">システムでこの機能を開く</a></p>${renderMetadata(document, endpointRows, schema)}</article>`).join('');
  const catalog = {
    generated_from: ['backend/src/permissions.js', 'backend/src/server.js', 'backend/src/routes/', '仕様MD/システム設計/', 'information_schema'],
    features: featureDocuments.map((document) => ({
      key: document.feature.key,
      label: document.feature.label,
      group: document.feature.group,
      default_roles: FEATURE_ROLE_MAP[document.feature.key] || [],
      related_features: document.metadata.related_features,
      primary_tables: document.metadata.primary_tables,
      api_prefixes: document.metadata.api_prefixes,
      specs: document.metadata.specs,
    })),
    endpoints: endpointRows,
    schema_summary: { tables: schema.tables.length, foreign_keys: schema.tables.reduce((sum, table) => sum + table.foreign_keys.length, 0) },
  };
  const navigation = [
    ...overviewDocuments.map((document) => `<a href="#${document.id}">${escapeHtml(document.name.replace(/^\d{2}_|\.md$/g, ''))}</a>`),
    '<span class="nav-heading">機能別設計</span>',
    ...featureDocuments.map((document) => `<a href="#feature-${escapeHtml(document.feature.key)}">${escapeHtml(document.feature.label)}</a>`),
    '<a href="#api-inventory">API一覧</a>',
    '<a href="#database-inventory">DB一覧</a>',
  ].join('');
  const html = `<!doctype html>
<html lang="ja"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex,nofollow"><title>Links-System 現行システム設計書</title><link rel="stylesheet" href="/system-design/system-design.css"></head>
<body><a class="skip" href="#main">本文へ</a><header class="topbar"><div><strong>Links-System</strong><span>現行システム設計書</span></div><div class="top-actions"><label>設計書内検索<input id="design-search" type="search" placeholder="機能・API・テーブル"></label><button id="print-design" type="button">印刷</button><a href="/">システムへ戻る</a></div></header>
<div class="layout"><nav class="toc" aria-label="設計書目次">${navigation}</nav><main id="main"><header class="hero"><p class="eyebrow">CURRENT SYSTEM DESIGN</p><h1>現行システム設計書</h1><p>業務意図、機能間連携、DB構造、現行業務との乖離、今後の改善候補を、現行コードと正式仕様に照らして確認する資料です。</p><div class="hero-note">Markdownを正本とし、機能・API・DBの技術情報は自動生成しています。実在する顧客・個人・口座・帳票データは含みません。</div></header>
${overviewDocuments.map((document) => `<article class="doc-section searchable" id="${document.id}">${document.html}</article>`).join('')}
<section class="section-divider"><p class="eyebrow">FEATURE DESIGN</p><h2>機能別設計</h2><p>登録済みの全${featureDocuments.length}機能を掲載しています。</p></section>${featureHtml}
<article class="doc-section searchable" id="api-inventory"><h1>API一覧（自動抽出）</h1><p>Expressのマウントとルート定義から生成しています。複雑な動的ルートは実装ファイルも併せて確認してください。</p>${renderApiTable(endpointRows)}</article>
<article class="doc-section searchable" id="database-inventory"><h1>DB一覧（自動スナップショット）</h1>${renderSchema(schema)}</article>
<p id="no-results" hidden>検索条件に一致する章がありません。</p></main></div><script src="/system-design/system-design.js" defer></script></body></html>`;
  return {
    ...sourceArtifacts,
    'source.js': read(path.join(sourceDir, 'assets', 'source.js')),
    'source.css': read(path.join(sourceDir, 'assets', 'source.css')),
    'index.html': html,
    'catalog.json': `${JSON.stringify(catalog, null, 2)}\n`,
    'system-design.css': read(path.join(sourceDir, 'assets', 'system-design.css')),
    'system-design.js': read(path.join(sourceDir, 'assets', 'system-design.js')),
  };
}

async function snapshotSchema(checkOnly = false) {
  const { getPool } = require('../src/db');
  const pool = getPool();
  try {
    const [tables] = await pool.query(`SELECT TABLE_NAME name, TABLE_COMMENT comment FROM information_schema.TABLES WHERE TABLE_SCHEMA=DATABASE() AND TABLE_TYPE='BASE TABLE' ORDER BY TABLE_NAME`);
    const [columns] = await pool.query(`SELECT TABLE_NAME table_name,COLUMN_NAME name,COLUMN_TYPE type,IS_NULLABLE nullable,COLUMN_KEY column_key,COLUMN_DEFAULT default_value,EXTRA extra,COLUMN_COMMENT comment FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() ORDER BY TABLE_NAME,ORDINAL_POSITION`);
    const [foreignKeys] = await pool.query(`SELECT TABLE_NAME table_name,CONSTRAINT_NAME name,COLUMN_NAME column_name,REFERENCED_TABLE_NAME referenced_table,REFERENCED_COLUMN_NAME referenced_column FROM information_schema.KEY_COLUMN_USAGE WHERE TABLE_SCHEMA=DATABASE() AND REFERENCED_TABLE_NAME IS NOT NULL ORDER BY TABLE_NAME,CONSTRAINT_NAME,ORDINAL_POSITION`);
    const [indexes] = await pool.query(`SELECT TABLE_NAME table_name,INDEX_NAME name,NON_UNIQUE non_unique,COLUMN_NAME column_name,SEQ_IN_INDEX position FROM information_schema.STATISTICS WHERE TABLE_SCHEMA=DATABASE() ORDER BY TABLE_NAME,INDEX_NAME,SEQ_IN_INDEX`);
    const snapshot = {
      format_version: 1,
      source: 'information_schema',
      tables: tables.map((table) => ({
        name: table.name,
        comment: table.comment || '',
        columns: columns.filter((column) => column.table_name === table.name).map((column) => ({ name: column.name, type: column.type, nullable: column.nullable === 'YES', key: column.column_key || '', default: column.default_value, extra: column.extra || '', comment: column.comment || '' })),
        foreign_keys: foreignKeys.filter((fk) => fk.table_name === table.name).map((fk) => ({ name: fk.name, column: fk.column_name, referenced_table: fk.referenced_table, referenced_column: fk.referenced_column })),
        indexes: [...new Set(indexes.filter((index) => index.table_name === table.name).map((index) => index.name))].map((name) => { const parts = indexes.filter((index) => index.table_name === table.name && index.name === name); return { name, unique: Number(parts[0]?.non_unique) === 0, columns: parts.sort((a,b) => a.position-b.position).map((part) => part.column_name) }; }),
      })),
    };
    const serialized = `${JSON.stringify(snapshot, null, 2)}\n`;
    if (checkOnly) {
      if (!fs.existsSync(schemaFile) || read(schemaFile) !== serialized) throw new Error('DBスキーマスナップショットが現行migration適用後の構造と一致しません。');
      console.log('DBスキーマスナップショットは最新です。');
    } else {
      write(schemaFile, serialized);
      console.log(`DBスキーマを更新しました: ${path.relative(root, schemaFile)}`);
    }
  } finally {
    await pool.end();
  }
}

function scaffold(featureKey) {
  const feature = FEATURES.find((item) => item.key === featureKey);
  if (!feature) throw new Error(`機能カタログに ${featureKey} はありません。先に backend/src/permissions.js へ登録してください。`);
  const file = path.join(featureDir, `${feature.key}.md`);
  if (fs.existsSync(file)) throw new Error(`${path.relative(root, file)} は既に存在します。`);
  const headings = REQUIRED_FEATURE_HEADINGS.map((heading) => `## ${heading}\n\nTODO\n`).join('\n');
  write(file, `---\nfeature_key: ${feature.key}\nrelated_features:\nprimary_tables:\napi_prefixes:\nspecs:\n---\n# ${feature.label}\n\n${headings}`);
  console.log(`機能設計の雛形を作成しました: ${path.relative(root, file)}`);
}

function build(checkOnly = false) {
  const artifacts = buildArtifacts();
  const errors = [];
  for (const [name, content] of Object.entries(artifacts)) {
    const file = path.join(outputDir, name);
    if (checkOnly) {
      if (!fs.existsSync(file)) errors.push(`${path.relative(root, file)} がありません`);
      else if (read(file) !== content) errors.push(`${path.relative(root, file)} が生成元と一致しません`);
    } else write(file, content);
  }
  if (errors.length) throw new Error(`設計書生成物が古くなっています:\n- ${errors.join('\n- ')}\nnode backend/scripts/system_design.mjs build を実行してください。`);
  console.log(checkOnly ? 'システム設計書の整合性を確認しました。' : `システム設計書を生成しました: ${path.relative(root, outputDir)}`);
}

const command = process.argv[2] || 'build';
try {
  if (command === 'build') build(false);
  else if (command === 'check') build(true);
  else if (command === 'schema') await snapshotSchema(process.argv.includes('--check'));
  else if (command === 'scaffold') scaffold(process.argv[3]);
  else throw new Error(`不明なコマンドです: ${command}`);
} catch (error) {
  console.error(error.message || error);
  process.exitCode = 1;
}
