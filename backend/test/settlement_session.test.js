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

test('管理者の現行機能一覧に入出金管理が含まれる', () => {
  const user = publicUser({
    user_id: 1,
    login_id: 'admin',
    display_name: '管理者',
    roles: ['admin'],
    permissions: JSON.stringify(['advances', 'invoices', 'payments']),
    is_active: 1,
  });
  assert.equal(featuresFromRoles(['admin']).includes('cash_management'), true);
  assert.equal(user.permissions.includes('cash_management'), true);
});

test('総務と経営者は入出金管理を利用できる', () => {
  assert.equal(featuresFromRoles(['soumu']).includes('cash_management'), true);
  assert.equal(featuresFromRoles(['executive']).includes('cash_management'), true);
  assert.equal(featuresFromRoles(['sales']).includes('cash_management'), false);
});
