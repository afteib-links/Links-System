const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

test('全機能のスクリプトを共通部品と依存順を保って読み込む', async () => {
  // 機能ごとに空のwindowで検証し、他画面の訪問順に依存しないことを確認する。
  for (const key of ['companies', 'partners', 'base_projects', 'projects', 'price_sets', 'daily_reports', 'advances', 'invoices', 'payments', 'cash_management', 'master_settings', 'ui_builder', 'users']) {
    const loaded = [];
    const context = vm.createContext({ window: {}, setTimeout, clearTimeout, console });
    context.document = {
      createElement: () => ({ remove() {} }),
      head: { appendChild(script) {
        const file = script.src.split('?')[0].split('/').pop();
        loaded.push(file);
        vm.runInContext(fs.readFileSync(path.resolve(__dirname, '../../frontend/js', file), 'utf8'), context);
        script.onload();
      } },
    };
    vm.runInContext(fs.readFileSync(path.resolve(__dirname, '../../frontend/js/feature-loader.js'), 'utf8'), context);
    const module = await context.window.LinksFeatureLoader.openModule(key);
    if (key !== 'users') assert.equal(typeof module.open, 'function', key);
    assert.ok(context.window.LinksListScreens, key);
    assert.ok(context.window.LinksDataTable, key);
    assert.ok(context.window.LinksFeatureKit, key);
    const count = loaded.length;
    await context.window.LinksFeatureLoader.openModule(key);
    assert.equal(loaded.length, count, '成功したファイルは二重実行しない');
  }
});
