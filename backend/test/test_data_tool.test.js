const test = require('node:test');
const assert = require('node:assert/strict');
const m = require('../src/services/test_data/model');
const imp = require('../src/services/test_data/imports');
const { workbook, zip } = require('../test-support/xlsx_buffer');
const { IMPORT_FIELDS, suggest } = require('../src/services/test_data/fields');

test('Japanese company fields retain source values and stay out of anonymous share', () => {
  const headers = ['担当','形態','検索用','企業番号','企業名'];
  const mapping = suggest(headers,'companies');
  assert.deepEqual(mapping.map(m => m.field),['managerName','workMode','searchText','code','name']);
  const n = imp.normalize([{type:'companies',mapping,rows:[['PRIVATE_MANAGER','PRIVATE_FORM','PRIVATE_SEARCH','00001','PRIVATE_NAME']]}]);
  assert.deepEqual(n.issues,[]); assert.equal(n.catalog.companies[0].workMode,'PRIVATE_FORM');
  const c = m.defaults('2026-09-11'); c.catalog = n.catalog; c.counts.companies = 1;
  c.importMappings = [{name:'PRIVATE_SHEET',headers,mapping,type:'companies'}];
  assert.ok(!JSON.stringify(m.share(c)).includes('PRIVATE'));
  assert.ok(IMPORT_FIELDS.companies.every(f => f.label));
});

test('missing partner codes are deterministically completed', () => {
  const n = imp.normalize([{type:'partners',rows:[['架空 太郎'],['架空 花子']],mapping:[{column:0,field:'name',mode:'preserve'}]}]);
  assert.deepEqual(n.issues,[]);
  assert.deepEqual(n.catalog.partners.map(r => r.code),['P00001','P00002']);
  assert.equal(n.fills.length,2);
});
test('invalid type field, duplicate column and missing source column are refused', () => {
  const s = {type:'companies',rows:[['001','name']],mapping:[{column:0,field:'code',mode:'preserve'},{column:1,field:'name',mode:'preserve'}]};
  for (const change of [x => x.mapping[1].field='partnerCode', x => x.mapping[1].column=0, x => x.mapping[1].column=3]) {
    const x = structuredClone(s); change(x); assert.throws(() => imp.normalize([x]));
  }
  assert.equal(suggest(['企業名','会社名'],'companies').filter(x=>x.field).length,1);
});

test('real XLSX buffer parsing preserves string codes and rejects formulas/macros', async () => {
  const result = await imp.parseFiles([{ originalname:'fictional.xlsx', buffer:workbook() }]);
  assert.equal(result[0].rows[0][0],'00001'); assert.equal(result[0].rows[0][1],'架空 太郎');
  await assert.rejects(() => imp.parseFiles([{ originalname:'formula.xlsx', buffer:workbook(true) }]), /数式/);
  await assert.rejects(() => imp.parseFiles([{ originalname:'macro.xlsx', buffer:zip({'xl/vbaProject.bin':'fake'}) }]), /マクロ/);
  await assert.rejects(() => imp.parseFiles([{ originalname:'macro.xlsm', buffer:workbook() }]), /xlsx/);
});
test('CP932 import explicitly decodes Japanese names', async () => {
  const buffer = require('iconv-lite').encode('code,name\r\n00001,架空 太郎','cp932');
  const sheets = await imp.parseFiles([{originalname:'fictional.csv',buffer}],'cp932');
  assert.equal(sheets[0].rows[0][1],'架空 太郎');
});

test('default period crosses year safely', () => {
  const c = m.defaults('2026-01-07'); assert.equal(c.start, '2025-11-01');
  const p = m.preview(c);
  assert.equal(p.reports.find(r => r.workDate === '2025-12-01').monthlyTarget, '処理中');
  assert.equal(p.reports.find(r => r.workDate === '2025-11-01').monthlyTarget, '完了予定');
});
test('deterministic preview, no future dates and no invented amounts', () => {
  const c = m.defaults('2026-09-10'); const a = m.preview(c); assert.deepEqual(a, m.preview(c));
  assert.ok(a.reports.every(r => r.workDate <= c.asOf && r.billingAmount === null));
  assert.ok(new Set(a.catalog.partners.map(r => r.name)).size === 10);
});
test('non-delivery has no fictitious distance and work intervals do not overlap', () => {
  const p = m.preview(m.defaults('2026-09-10')); const end = new Map();
  const minutes = s => { const [h,m] = s.split(':').map(Number); return h * 60 + m; };
  for (const r of p.reports) {
    const job = p.catalog.projects.find(j => j.code === r.projectCode);
    if (!job.name.includes('配送')) assert.equal(r.distanceKm, 0);
    if (!r.startTime) continue;
    const start = Date.parse(r.workDate) + minutes(r.startTime) * 60000;
    assert.ok(Date.parse(r.workDate) + minutes(r.endTime) * 60000 <= Date.parse('2026-09-11'));
    assert.ok(start >= (end.get(r.partnerCode) || 0));
    end.set(r.partnerCode, Date.parse(r.workDate) + minutes(r.endTime) * 60000);
  }
});
test('fill confirmation and unmet mandatory cases block approval', () => {
  const c = m.defaults('2026-09-10'); assert.equal(m.preview(c).approvable, false);
  c.acceptFill = true; assert.equal(m.preview(c).approvable, true);
  c.start = c.asOf; c.required = ['holiday']; assert.deepEqual(m.preview(c).missing, ['holiday']);
});
test('invalid counts, weights, dates and source relationships are rejected', () => {
  for (const change of [c => c.counts.projects = 11, c => c.weights.normal = 99, c => c.asOf = '2026-02-30',
    c => c.catalog.projects = [{ code:'J1', name:'test', partnerCode:'missing' }]]) {
    const c = m.defaults('2026-09-10'); change(c); assert.throws(() => m.preview(c));
  }
});
test('CSV preserves leading zero, quotes and CP932-independent strings', () => {
  assert.deepEqual(imp.parseCsv('code,name\r\n001,"佐藤,太郎"\r\n002,"A""B"'), [['code','name'],['001','佐藤,太郎'],['002','A"B']]);
  assert.throws(() => imp.parseCsv('a,"open'));
  assert.throws(() => imp.parseCsv('a,"closed"junk'));
});
test('mapping preserves keys, detects duplicates, refuses relation pseudonymization', () => {
  const s = { type:'partners', rows:[['001','機密氏名'],['001','other']], mapping:[{column:0,field:'code',mode:'preserve'},{column:1,field:'name',mode:'fictional'}] };
  const n = imp.normalize([s]); assert.equal(n.catalog.partners[0].code,'001'); assert.notEqual(n.catalog.partners[0].name,'機密氏名'); assert.equal(n.issues.length,1);
  s.mapping[0].mode = 'fictional'; assert.throws(() => imp.normalize([s]));
});
test('anonymous share strips source names, arbitrary fields, comments and seed', () => {
  const c = m.defaults('2026-09-10'); c.catalog.companies = [{ code:'SECRET-CODE', name:'SECRET-NAME' }];
  c.seed = 'SECRET-SEED'; c.decisions.normal = { status:'accept', comment:'SECRET-COMMENT' }; c.secret = 'SECRET-EXTRA';
  assert.ok(!JSON.stringify(m.share(c)).includes('SECRET'));
  assert.ok(m.csv([{ projectCode:'=HYPERLINK("x")' }]).includes("'=HYPERLINK"));
});
