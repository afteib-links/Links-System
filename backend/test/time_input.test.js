const test = require('node:test');
const assert = require('node:assert/strict');
const time = require('../../frontend/js/time-input');

test('テンキー・全角・翌日時刻を同一の時分として解釈する', () => {
  for (const value of ['2.30', '２．３０', '2:30', '230']) assert.equal(time.normalize(value), '02:30');
  assert.equal(time.normalize('1730'), '17:30');
  assert.equal(time.normalize('8'), '08:00');
  assert.equal(time.normalize('0'), '00:00');
  assert.equal(time.normalize(''), '');
  assert.equal(time.normalize('28:00', { maxMinutes: 2879 }), '28:00');
  assert.equal(time.normalize('4759', { maxMinutes: 2879 }), '47:59');
  assert.equal(time.normalize('－２．３０', { signed: true }), '-02:30');
});

test('曖昧な小数・分の超過・48時以降を補正せず拒否する', () => {
  for (const value of ['2.3', '2:3', '7:o0', '12:60', '-2.30', 'Infinity', 'abc']) assert.throws(() => time.parse(value));
  assert.throws(() => time.parse('48:00', { maxMinutes: 2879 }));
  assert.equal(time.parse('0:30'), 30);
  assert.equal(time.parse('30'), 1800);
});
