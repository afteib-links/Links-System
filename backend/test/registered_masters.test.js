const test = require('node:test');
const assert = require('node:assert/strict');
const { loadRegisteredCatalog } = require('../src/services/test_data/registered_masters');

test('registered master mappings become deterministic scenario catalogs', async () => {
  const sets = [
    [{record_id:11,import_key:'company:private',name:'架空食品株式会社'}],
    [{record_id:21,import_key:'partner:private',name:'佐藤 拓海'}],
    [{record_id:31,import_key:'base:private',name:'食品配送業務'}],
    [{record_id:41,import_key:'project:private',name:'食品配送業務',company_id:11,partner_id:21,base_project_id:31}],
  ];
  let index = 0;
  const result = await loadRegisteredCatalog(async () => sets[index++]);
  assert.deepEqual(result.counts,{companies:1,partners:1,baseProjects:1,projects:1});
  assert.deepEqual(result.catalog.projects[0],{
    code:'J00001',name:'食品配送業務',
    companyCode:'C00001',partnerCode:'P00001',baseCode:'B00001',
  });
});

test('registered master adapter rejects missing relationships', async () => {
  const sets = [
    [{record_id:11,import_key:'company:1',name:'企業'}],
    [{record_id:21,import_key:'partner:1',name:'人物'}],
    [{record_id:31,import_key:'base:1',name:'基本案件'}],
    [{record_id:41,import_key:'project:1',name:'案件',company_id:99,partner_id:21,base_project_id:31}],
  ];
  let index = 0;
  await assert.rejects(() => loadRegisteredCatalog(async () => sets[index++]), /参照先/);
});
