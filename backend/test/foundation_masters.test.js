const test = require('node:test');
const assert = require('node:assert/strict');
const {
  CODE_ROWS,
  SETTING_ROWS,
  HELP_ROWS,
  validateCatalog,
  syncSimple,
} = require('../src/services/foundation_masters');

test('基盤マスター定義の安定キーに重複がない', () => {
  assert.doesNotThrow(validateCatalog);
  assert.equal(new Set(CODE_ROWS.map((row) => `${row.category_code}:${row.code_value}`)).size, CODE_ROWS.length);
  assert.equal(new Set(SETTING_ROWS.map((row) => row.setting_key)).size, SETTING_ROWS.length);
  assert.equal(new Set(HELP_ROWS.map((row) => row.screen_key)).size, HELP_ROWS.length);
});

test('物理的にない初期値だけを追加し既存の利用者設定は上書きしない', async () => {
  const inserted = [];
  const conn = {
    async query(sql, params = []) {
      if (sql.startsWith('SELECT')) return [[{ setting_key:'existing',setting_value:'利用者設定',is_deleted:0 }]];
      inserted.push({ sql,params });
      return [{ insertId:1 }];
    },
  };
  const issues = [];
  const created = await syncSimple(conn,{
    type:'setting',table:'system_settings',key:(row) => row.setting_key,
    rows:[
      { setting_key:'existing',setting_value:'初期値',setting_label:'既存' },
      { setting_key:'missing',setting_value:'初期値',setting_label:'不足' },
    ],
  },issues);
  assert.equal(created,1);
  assert.equal(inserted.length,1);
  assert.deepEqual(inserted[0].params,['missing','初期値','不足']);
  assert.deepEqual(issues,[]);
});

test('削除・無効化された初期値を復活させず警告する', async () => {
  const inserted = [];
  const conn = {
    async query(sql) {
      if (sql.startsWith('SELECT')) return [[
        { category_code:'sample',code_value:'deleted',is_deleted:1,is_active:1 },
        { category_code:'sample',code_value:'inactive',is_deleted:0,is_active:0 },
      ]];
      inserted.push(sql); return [{}];
    },
  };
  const issues = [];
  const created = await syncSimple(conn,{
    type:'code',table:'code_masters',key:(row) => `${row.category_code}:${row.code_value}`,
    rows:[
      { category_code:'sample',code_value:'deleted',code_label:'削除',sort_order:1,is_active:1 },
      { category_code:'sample',code_value:'inactive',code_label:'無効',sort_order:2,is_active:1 },
    ],
  },issues);
  assert.equal(created,0);
  assert.equal(inserted.length,0);
  assert.deepEqual(issues.map((issue) => issue.reason),['論理削除されています','無効化されています']);
});
