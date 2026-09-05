const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs/promises');
const os = require('os');
const path = require('path');
const {
  buildImportRows,
  inferMapping,
  normalizeDate,
  parseCsv,
  readSourceFile,
  validateParsedRow,
} = require('../src/services/daily_report_import');

test('日本語見出しから日報項目を推定する', () => {
  const mapping = inferMapping(['案件ID', '勤務日', '開始時刻', '終了時刻', '休憩時間', '走行距離', '備考']);
  assert.deepEqual(mapping, {
    project_id: 0,
    work_date: 1,
    start_time: 2,
    end_time: 3,
    break_minutes: 4,
    total_distance: 5,
    row_comment: 6,
  });
});

test('Excel候補値を日報形式へ正規化し日跨ぎ時刻を48時間表記にする', () => {
  const built = buildImportRows([
    ['案件ID', '勤務日', '開始', '終了', '休憩', '距離', '高速代'],
    [12, '2026/09/05', '20.00', '4:00', '1:00', '123', '1,200'],
  ]);
  assert.equal(built.rows.length, 1);
  assert.deepEqual(built.rows[0].errors, []);
  assert.deepEqual(built.rows[0].parsedData, {
    project_id: 12,
    project_name: null,
    company_name: null,
    partner_name: null,
    work_date: '2026-09-05',
    start_time: '20:00',
    end_time: '28:00',
    break_minutes: 60,
    is_absent: 0,
    is_training: 0,
    total_distance: 123,
    toll_fee: 1200,
    parking_fee: null,
    transport_fee: null,
    row_comment: null,
  });
});

test('不正日付と勤務時刻不足をエラーにする', () => {
  assert.equal(normalizeDate('2026/02/30'), null);
  const result = validateParsedRow({ project_id: 1, work_date: null, start_time: '08:00', end_time: null, break_minutes: 0 });
  assert.ok(result.errors.includes('勤務日を確認してください'));
  assert.ok(result.errors.includes('終了時刻が必要です'));
});

test('UTF-8 CSVの引用符・カンマ・改行を読み取る', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'links-import-'));
  const file = path.join(directory, 'daily.csv');
  try {
    await fs.writeFile(file, '\uFEFF案件ID,勤務日,備考\r\n1,2026/09/05,"積込,荷下ろし"\r\n', 'utf8');
    const source = await readSourceFile(file);
    assert.deepEqual(source.rows, [['案件ID', '勤務日', '備考'], ['1', '2026/09/05', '積込,荷下ろし']]);
  } finally {
    await fs.rm(directory, { recursive: true, force: true });
  }
});

test('閉じていないCSV引用符を拒否する', () => {
  assert.throws(() => parseCsv('案件ID,備考\n1,"未完了'), /引用符が閉じていません/);
});
