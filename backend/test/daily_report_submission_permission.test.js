const test = require('node:test');
const assert = require('node:assert/strict');
const { requirePermission } = require('../src/middleware/auth');
const { featuresFromRoles } = require('../src/permissions');

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

test('パートナーと企業ロールは日報提出を使えない', () => {
  assert.equal(featuresFromRoles(['partner']).includes('daily_report_submissions'), false);
  assert.equal(featuresFromRoles(['company']).includes('daily_report_submissions'), false);
  assert.equal(featuresFromRoles(['soumu']).includes('daily_report_submissions'), true);
  const res = responseRecorder();
  let called = false;
  requirePermission('daily_report_submissions')(
    { session: { user: { roles: ['partner'] } } },
    res,
    () => { called = true; }
  );
  assert.equal(called, false);
  assert.equal(res.statusCode, 403);
});
