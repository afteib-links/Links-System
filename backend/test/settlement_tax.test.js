const test = require('node:test');
const assert = require('node:assert/strict');
const { resolveInvoiceTax } = require('../src/services/settlement_tax');

function connection({ company = null,projects = [],system = '0.1' } = {}) {
  return {
    async query(sql) {
      if (sql.includes('company_invoice_settings')) return [[company].filter(Boolean)];
      if (sql.includes('project_invoice_settings')) return [projects];
      if (sql.includes('system_settings')) return [[{ setting_value:system }]];
      throw new Error(`Unexpected query: ${sql}`);
    },
  };
}

test('税率・端数は請求先設定を最優先する',async () => {
  const tax = await resolveInvoiceTax(connection({
    company:{ tax_rate:'0.08',tax_rounding:'ceil' },
    projects:[{ project_id:1,tax_rate:'0.05',tax_rounding:'round' }],
  }),12,[1]);
  assert.deepEqual(tax,{ rate:0.08,mode:'ceil' });
});

test('請求先未設定なら案件設定、案件未設定ならシステム税率を使う',async () => {
  const projectTax = await resolveInvoiceTax(connection({ projects:[{ project_id:1,tax_rate:'0.08',tax_rounding:'round' }] }),12,[1]);
  assert.deepEqual(projectTax,{ rate:0.08,mode:'round' });
  const systemTax = await resolveInvoiceTax(connection({ system:'0.09' }),12,[1]);
  assert.deepEqual(systemTax,{ rate:0.09,mode:'floor' });
  const comparisonTax = await resolveInvoiceTax(connection({ system:'0.09' }),null,[]);
  assert.deepEqual(comparisonTax,{ rate:0.09,mode:'floor' });
});

test('請求先設定なしで複数案件の税率が衝突すると確定前に止める',async () => {
  await assert.rejects(resolveInvoiceTax(connection({
    projects:[{ project_id:1,tax_rate:'0.08' },{ project_id:2,tax_rate:'0.1' }],
  }),12,[1,2]),/複数案件の税率または端数処理が異なります/);
});
