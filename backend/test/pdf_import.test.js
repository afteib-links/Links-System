const test = require('node:test');
const assert = require('node:assert/strict');
const { candidate, mergeFields, validateTemplate, sameFields } = require('../src/services/pdf_import');
const { closingPeriod } = require('../src/services/daily_report_periods');
const period = closingPeriod('2026-09', 'end');
const confidence = { work_date: .99, start_time: .99, end_time: .99, break_minutes: .99 };
test('原読取の文字を置換せず不確かな日付・時刻を要確認にする', () => {
  for (const date of ['9/h', '9/3?', '', '9/31']) {
    const result = candidate({work_date:date,start_time:'7:o0',end_time:'17:15'},confidence,period);
    assert.equal(result.values.work_date,null);
    assert.ok(result.warnings.work_date);
    assert.equal(result.values.start_time,null);
    assert.ok(result.warnings.start_time);
  }
  const result = candidate({work_date:'９／８',start_time:'８．００',end_time:'1730',break_minutes:'1:00'},confidence,period);
  assert.equal(result.values.work_date,'2026-09-08');
  assert.equal(result.values.start_time,'08:00');
  assert.equal(result.values.end_time,'17:30');
  assert.deepEqual(result.warnings,{});
});
test('低信頼度と年跨ぎ期間を扱い、日付の行番号補完をしない', () => {
  const result = candidate({work_date:'12/25',start_time:'08:00',end_time:'17:00'}, { ...confidence,work_date:.6 }, closingPeriod('2027-01','20'));
  assert.equal(result.values.work_date,'2026-12-25');
  assert.ok(result.warnings.work_date);
});
test('欄選択と明示消去以外の現在値・初回入力元を保持する', () => {
  const current={work_date:'2026-09-01',start_time:'08:00:00',end_time:'17:00:00',break_minutes:60,toll_fee:1500,input_source_type:'manual'};
  const changed=mergeFields(current,{fields:['end_time','toll_fee'],values:{end_time:'1800',toll_fee:''}});
  assert.equal(changed.start_time,'08:00:00'); assert.equal(changed.end_time,'18:00');
  assert.equal(changed.toll_fee,1500); assert.equal(changed.input_source_type,'manual');
  const cleared=mergeFields(current,{fields:['toll_fee','break_minutes'],values:{},clear_fields:['toll_fee','break_minutes']});
  assert.equal(cleared.toll_fee,null); assert.equal(cleared.break_minutes,0);
  assert.throws(()=>mergeFields(current,{fields:['work_date'],values:{},clear_fields:['work_date']}));
  assert.throws(()=>mergeFields(current,{fields:['start_time'],values:{start_time:'2.3'}}));
  assert.ok(sameFields(current,{...current,start_time:'08:00'}));
});
test('様式の範囲外座標・重複ページ・不正列を拒否する', () => {
  const p={page_number:1,top:.1,bottom:.9,row_count:31,columns:{work_date:[0,.1],start_time:[.1,.3],end_time:[.3,.5]}};
  assert.equal(validateTemplate({pages:[p]}).pages[0].row_count,31);
  assert.throws(()=>validateTemplate({pages:[p,p]}));
  assert.throws(()=>validateTemplate({pages:[{...p,top:-1}]}));
  assert.throws(()=>validateTemplate({pages:[{...p,columns:{...p.columns,unexpected:[0,1]}}]}));
});
