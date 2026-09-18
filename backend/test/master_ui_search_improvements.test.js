const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { lookupPostalCode, normalizePostalCode } = require('../src/services/postal_code');

const readFrontend = (name) => fs.readFileSync(path.resolve(__dirname, `../../frontend/js/${name}`), 'utf8');

test('郵便番号は全角とハイフンを正規化し7桁だけを受け付ける', () => {
  assert.equal(normalizePostalCode('１００－０００１'), '1000001');
  assert.equal(normalizePostalCode('123-456'), '');
  assert.equal(normalizePostalCode('abc'), '');
});

test('住所検索結果は都道府県・市区町村・町域を結合する', async () => {
  const addresses = await lookupPostalCode('100-0001', {
    fetchImpl: async () => ({
      ok: true,
      json: async () => ({ results: [{ address1: '東京都', address2: '千代田区', address3: '千代田' }] }),
    }),
  });
  assert.deepEqual(addresses, [{
    postal_code: '1000001',
    prefecture: '東京都',
    city: '千代田区',
    town: '千代田',
    address: '東京都千代田区千代田',
  }]);
});

test('企業・請求先・パートナーの住所入力に共通郵便番号検索を結び付ける', () => {
  const companies = readFrontend('companies.js');
  const partners = readFrontend('partners.js');
  assert.match(companies, /bindPostalLookup\(companyForm\)/);
  assert.match(companies, /bindPostalLookup\(document\.getElementById\('modal-backdrop'\)/);
  assert.match(partners, /bindPostalLookup\(document\.getElementById\('partner-form'\)\)/);
});

test('企業名カナ補完と基本管理のIME・締日・五十音フィルターを備える', () => {
  const kit = readFrontend('feature-kit.js');
  const companies = readFrontend('companies.js');
  const base = readFrontend('base_management.js');
  assert.match(kit, /bindAutoKana/);
  assert.match(companies, /bindAutoKana\(companyForm\)/);
  assert.match(base, /企業名・カナで検索/);
  assert.match(base, /bm-company-closing/);
  assert.match(base, /data-kana-group/);
  assert.match(base, /compositionstart/);
  assert.match(base, /compositionend/);
});

test('パートナー入力はメールと指定順、振込手数料の銀行配置を持つ', () => {
  const partners = readFrontend('partners.js');
  const basicStart = partners.indexOf('partner-basic-grid');
  const bankStart = partners.indexOf('<h3>銀行情報');
  assert.ok(basicStart >= 0 && bankStart > basicStart);
  assert.ok(partners.indexOf('name="zip_code"', basicStart) < partners.indexOf('name="address"', basicStart));
  assert.ok(partners.indexOf('name="contact_phone"', basicStart) < partners.indexOf('name="email"', basicStart));
  assert.ok(partners.indexOf('name="transfer_fee_pattern_id"', bankStart) > bankStart);
  assert.match(partners, /email: form\.email\.value/);
});
