const test = require('node:test');
const assert = require('node:assert/strict');
const { requireAuth, requirePermission } = require('../src/middleware/auth');

function responseRecorder() {
  return {
    statusCode: 200,
    body: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(body) {
      this.body = body;
      return this;
    },
  };
}

test('未認証の日報APIアクセスを拒否する', () => {
  const res = responseRecorder();
  let called = false;
  requireAuth({}, res, () => { called = true; });
  assert.equal(called, false);
  assert.equal(res.statusCode, 401);
  assert.equal(res.body.error, 'unauthorized');
});

test('日報権限がない企業ユーザーを拒否する', () => {
  const res = responseRecorder();
  let called = false;
  requirePermission('daily_reports')(
    { session: { user: { roles: ['company'] } } },
    res,
    () => { called = true; }
  );
  assert.equal(called, false);
  assert.equal(res.statusCode, 403);
  assert.equal(res.body.error, 'forbidden');
});

test('日報権限がある事務員を許可する', () => {
  const res = responseRecorder();
  let called = false;
  requirePermission('daily_reports')(
    { session: { user: { roles: ['soumu'] } } },
    res,
    () => { called = true; }
  );
  assert.equal(called, true);
  assert.equal(res.statusCode, 200);
});
