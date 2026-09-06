const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.resolve(__dirname, '..', '..');
const frontend = (rel) => fs.readFileSync(path.join(root, 'frontend', rel), 'utf8');
const backend = (rel) => fs.readFileSync(path.join(root, 'backend', rel), 'utf8');

function loadListScreens() {
  global.window = global;
  const dataTable = path.join(root, 'frontend/js/data-table.js');
  const listScreens = path.join(root, 'frontend/js/list_screens.js');
  delete require.cache[dataTable];
  delete require.cache[listScreens];
  require(dataTable);
  require(listScreens);
  return global.LinksListScreens;
}

function loadMasterHelp() {
  global.window = global;
  const file = path.join(root, 'frontend/js/master_settings.js');
  delete require.cache[file];
  require(file);
  return global.LinksMasterSettings.HELP;
}

function keysFromListColumns(src) {
  const match = src.match(/listColumns\(\)\s*\{[\s\S]*?return\s*\[([\s\S]*?)\];/);
  assert.ok(match, 'listColumns が見つかりません');
  return [...match[1].matchAll(/key:\s*'([^']+)'/g)].map((m) => m[1]);
}

function keysFromRenderTable(src, screenKey) {
  const marker = `screenKey: '${screenKey}'`;
  const start = src.indexOf(marker);
  assert.ok(start >= 0, `${screenKey} の renderTable が見つかりません`);
  const slice = src.slice(start, start + 2500);
  const colsAt = slice.indexOf('columns:');
  const rowsAt = slice.indexOf('rows:', colsAt);
  const body = slice.slice(colsAt, rowsAt > colsAt ? rowsAt : undefined);
  return [...body.matchAll(/key:\s*'([^']+)'/g)].map((m) => m[1]);
}

function keysFromTableHead(src, tableId) {
  const match = src.match(new RegExp(`id="${tableId}"[\\s\\S]*?<thead>([\\s\\S]*?)</thead>`));
  assert.ok(match, `${tableId} の thead が見つかりません`);
  return [...match[1].matchAll(/data-col="([^"]+)"/g)].map((m) => m[1]);
}

function cell(attrs = {}) {
  return {
    getAttribute(name) {
      return Object.prototype.hasOwnProperty.call(attrs, name) ? String(attrs[name]) : null;
    },
    hasAttribute(name) {
      return Object.prototype.hasOwnProperty.call(attrs, name);
    },
    set colSpan(value) {
      attrs.colspan = value;
    },
    get colSpan() {
      return Number(attrs.colspan || 1);
    },
    attrs,
  };
}

function rowOf(cells) {
  const row = {
    children: cells,
    replaceChildren(...nodes) {
      row.children = nodes;
    },
  };
  return row;
}

test('マスターヘルプは全画面キーと記載方法・影響画面を持つ', () => {
  const help = loadMasterHelp();
  const expected = [
    'staff',
    'offices',
    'numbering',
    'codes',
    'settings',
    'holidays',
    'transfer-fees',
    'bank-profiles',
    'source-accounts',
  ];
  assert.deepEqual(Object.keys(help), expected);
  for (const key of expected) {
    assert.ok(help[key].how.length, `${key} の記載方法`);
    assert.ok(help[key].affects.length, `${key} の影響画面`);
  }
  const masterSrc = frontend('js/master_settings.js');
  const bankSrc = frontend('js/bank_export_master.js');
  assert.match(masterSrc, /data-master-help="\$\{key\}"/);
  for (const key of ['staff', 'offices', 'numbering', 'codes', 'settings', 'holidays', 'transfer-fees']) {
    assert.match(masterSrc, new RegExp(`helpButtonHtml\\('${key}'\\)`));
  }
  assert.match(bankSrc, /data-master-help="bank-profiles"/);
  assert.match(bankSrc, /data-master-help="source-accounts"/);
});

test('モーダルは画面内幅と最大2列グリッドにする', () => {
  const css = frontend('css/styles.css');
  assert.match(css, /\.modal-panel\s*\{[\s\S]*width:\s*min\(1080px, calc\(100vw - 2rem\)\)/);
  assert.match(css, /max-height:\s*min\(92vh, 960px\)/);
  assert.match(css, /\.modal-panel \.form-grid[\s\S]*repeat\(2, minmax\(0, 1fr\)\)/);
  assert.match(css, /\.modal-panel \.search-select-list\s*\{[\s\S]*max-width:\s*100%/);
});

test('一覧レイアウトAPIは会社共通テーブルでPUTはui_builder権限', () => {
  const src = backend('src/routes/layouts.js');
  assert.match(src, /requirePermission\('ui_builder'\)/);
  assert.match(src, /FROM company_screen_layouts/);
  assert.match(src, /INSERT INTO company_screen_layouts/);
  assert.equal(src.includes('user_screen_layouts'), false);
  const migration = fs.readFileSync(path.join(root, 'db/migrations/026_company_screen_layouts.sql'), 'utf8');
  assert.match(migration, /CREATE TABLE IF NOT EXISTS company_screen_layouts/);
  assert.match(migration, /FROM user_screen_layouts/);
});

test('UIビルダーカタログは各主一覧の実カラムと一致する', () => {
  const screens = loadListScreens();
  const catalog = (key, area) => screens.catalogKeys(key, area);
  assert.deepEqual(catalog('companies', 'list'), keysFromListColumns(frontend('js/companies.js')));
  assert.deepEqual(catalog('partners', 'list'), keysFromListColumns(frontend('js/partners.js')));
  assert.deepEqual(catalog('base_projects', 'list'), keysFromRenderTable(frontend('js/projects.js'), 'base_projects'));
  assert.deepEqual(catalog('projects', 'list'), keysFromRenderTable(frontend('js/projects.js'), 'projects'));
  assert.deepEqual(catalog('price_sets', 'list'), keysFromRenderTable(frontend('js/price_sets.js'), 'price_sets'));
  assert.deepEqual(catalog('daily_reports', 'list'), keysFromRenderTable(frontend('js/daily_reports.js'), 'daily_reports'));
  assert.deepEqual(catalog('invoices', 'targets'), keysFromTableHead(frontend('js/invoices.js'), 'invoice-targets-table'));
  assert.deepEqual(catalog('invoices', 'issued'), keysFromTableHead(frontend('js/invoices.js'), 'invoice-issued-table'));
  assert.deepEqual(catalog('payments', 'targets'), keysFromTableHead(frontend('js/payments.js'), 'payment-targets-table'));
  assert.deepEqual(catalog('payments', 'issued'), keysFromTableHead(frontend('js/payments.js'), 'payment-issued-table'));
  assert.deepEqual(catalog('cash_management', 'list'), keysFromTableHead(frontend('js/cash_management.js'), 'cash-schedule-table'));
  assert.deepEqual(catalog('users', 'list'), keysFromTableHead(frontend('js/app.js'), 'users-table'));
  const joined = screens.SCREENS.flatMap((screen) => screen.areas.flatMap((area) => area.columns.map((col) => col.key))).join(',');
  assert.equal(joined.includes('office_no'), false);
  assert.equal(/select|action|操作/.test(joined), false);
});

test('areaLayoutはareas優先、単一覧はcolumns_jsonを使う', () => {
  const screens = loadListScreens();
  const saved = {
    columns_json: { columns: ['a'], hidden: [] },
    layout_json: { areas: { targets: { columns: ['b'], hidden: ['c'] } } },
  };
  assert.deepEqual(screens.areaLayout(saved, 'list'), { columns: ['a'], hidden: [] });
  assert.deepEqual(screens.areaLayout(saved, 'targets'), { columns: ['b'], hidden: ['c'] });
  assert.equal(screens.areaLayout(null, 'list'), null);
});

test('plain tableは選択・操作を残して列を並べ替え非表示する', () => {
  const screens = loadListScreens();
  const header = rowOf([
    cell(),
    cell({ 'data-col': 'cycle_code' }),
    cell({ 'data-col': 'scheduled_date' }),
    cell({ 'data-col': 'amount' }),
    cell(),
  ]);
  const body = rowOf([
    cell(),
    cell({ 'data-col': 'cycle_code' }),
    cell({ 'data-col': 'scheduled_date' }),
    cell({ 'data-col': 'amount' }),
    cell(),
  ]);
  const empty = rowOf([cell({ colspan: 5 })]);
  const table = {
    tHead: { rows: [header] },
    tBodies: [{ rows: [body, empty] }],
  };
  screens.applyPlainTable(
    table,
    [
      { key: 'cycle_code', label: '締日' },
      { key: 'scheduled_date', label: '予定日' },
      { key: 'amount', label: '予定額' },
    ],
    { columns: ['amount', 'cycle_code', 'scheduled_date'], hidden: ['scheduled_date'] }
  );
  assert.deepEqual(
    header.children.map((c) => c.getAttribute('data-col')),
    [null, 'amount', 'cycle_code', null]
  );
  assert.deepEqual(
    body.children.map((c) => c.getAttribute('data-col')),
    [null, 'amount', 'cycle_code', null]
  );
  assert.equal(empty.children[0].colSpan, 4);
});

test('index.htmlはlist_screens.jsをdata-tableの直後に読む', () => {
  const html = frontend('index.html');
  const dataTable = html.indexOf('/js/data-table.js');
  const listScreens = html.indexOf('/js/list_screens.js');
  const companies = html.indexOf('/js/companies.js');
  assert.ok(dataTable >= 0 && listScreens > dataTable && companies > listScreens);
});
