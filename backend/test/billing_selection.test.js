const test = require('node:test');
const assert = require('node:assert/strict');
const { resolveBillingSelection } = require('../src/services/billing_selection');
const billings = [{ billing_id:5,company_id:1,billing_no:0 },{ billing_id:6,company_id:1,billing_no:1 },{ billing_id:8,company_id:2,billing_no:1 }];
const query = async (sql, p) => billings.filter((b) => sql.includes('billing_id=?') ? b.billing_id===p[0] && b.company_id===p[1] : b.company_id===p[0] && b.billing_no===(sql.includes('billing_no=0') ? 0 : p[1]));
test('No.0と企業別Noを解決し、全角の直接入力にも対応する', async () => {
  for (const no of [0,'0','０',1,'１']) {
    const data = { company_id:1 };
    assert.equal(await resolveBillingSelection(query,data,{ billing_no:no }),null);
    assert.equal(data.billing_id,Number(String(no).normalize('NFKC'))===0 ? 5 : 6);
  }
});
test('未登録・別企業のID・番号ID不一致・小数・負数を拒否', async () => {
  for (const no of [99,-1,1.5,'bad']) assert.ok(await resolveBillingSelection(query,{ company_id:1 },{ billing_no:no }));
  assert.ok(await resolveBillingSelection(query,{ company_id:1,billing_id:8 }));
  assert.ok(await resolveBillingSelection(query,{ company_id:1,billing_id:5 },{ billing_id:5,billing_no:1 }));
});
test('未指定は企業のNo.0へ接続する', async () => {
  const data = { company_id:1 };
  assert.equal(await resolveBillingSelection(query,data),null);
  assert.equal(data.billing_id,5);
});
