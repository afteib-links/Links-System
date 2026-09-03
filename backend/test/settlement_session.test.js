const test = require('node:test');
const assert = require('node:assert/strict');
const { publicUser, featuresFromRoles } = require('../src/permissions');

test('外部帳票の対象IDをセッション用ユーザーに保持する', () => {
  const company = publicUser({ user_id:1,login_id:'company',display_name:'企業',roles:['company'],company_id:'12',partner_id:null,is_active:1 });
  const partner = publicUser({ user_id:2,login_id:'partner',display_name:'パートナー',roles:['partner'],company_id:null,partner_id:'34',is_active:1 });
  assert.equal(company.company_id, 12);
  assert.equal(company.partner_id, null);
  assert.equal(partner.company_id, null);
  assert.equal(partner.partner_id, 34);
});

test('営業とパートナーは支払の参照機能を利用できる', () => {
  assert.equal(featuresFromRoles(['sales']).includes('payments'), true);
  assert.equal(featuresFromRoles(['partner']).includes('payments'), true);
});
