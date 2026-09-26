const test=require('node:test'),assert=require('node:assert/strict');
const {candidate,validateTemplate}=require('../src/services/pdf_import');
const {closingPeriod}=require('../src/services/daily_report_periods');
const {documentFields}=require('../src/services/document_fields');
const {inspectSheet}=require('../src/services/document_workbook');
const ExcelJS=require('exceljs');
test('帳票単位・日付注記・夜勤を別々に解析し原文を保持する',()=>{
 const raw={work_date:'※２１',work_interval:'23:00 ～ 6:30',reported_overtime:'0.25h',reported_excess_distance:'70km',business_expense:'1,500円',alcohol_check:'✓',extra_memo:'A'};
 const result=candidate(raw,{work_date:1,work_interval:1},closingPeriod('2026-07','20'));
 assert.equal(raw.work_date,'※２１');assert.equal(result.values.work_date,'2026-06-21');
 assert.equal(result.values.end_time,'30:30');assert.ok(result.warnings.end_time);
 assert.equal(result.observations.reported_overtime,.25);assert.equal(result.observations.business_expense,1500);
 assert.equal(result.observations.alcohol_check,'marked');assert.equal(result.observations.extra_memo,'A');
});
test('印刷のみ・取消訂正候補を確定しない',()=>{
 const result=documentFields({work_interval:': ～ :',reported_overtime:'h',business_expense:'円',confirmation_mark:'印',start_time:':'});
 assert.equal(result.normalized.start_time,'');assert.equal(result.observations.reported_overtime,null);
 assert.equal(result.observations.confirmation_mark,'unknown');
 assert.ok(documentFields({work_interval:'8:00 9:00 ～ 17:00'}).warnings.time);
 assert.ok(documentFields({business_expense:'1.5円'}).warnings.business_expense);
});
test('証憑・保留は日報列不要、未知列は明示したextra名だけ',()=>{
 assert.equal(validateTemplate({pages:[{page_kind:'evidence',page_number:1}]}).pages[0].page_kind,'evidence');
 const p={page_number:1,top:.1,bottom:.9,row_count:31,columns:{work_date:[0,.1],work_interval:[.1,.4],extra_note:[.4,.9]}};
 assert.ok(validateTemplate({pages:[p]}));
 assert.throws(()=>validateTemplate({pages:[{...p,source_quad:[[0,0],[1,0],[2,1],[0,1]]}]}));
});
test('Excelは日付セルが結合されても一度だけ読む',()=>{
 const book=new ExcelJS.Workbook(),s=book.addWorksheet('原本');
 s.getCell('A1').value='日付';s.getCell('B1').value='業務稼働時間';s.getCell('E1').value='距離超過';
 s.mergeCells('A2:A3');s.getCell('A2').value=1;
 s.getCell('B2').value='09:00';s.getCell('C2').value='～';s.getCell('D2').value='18:00';s.getCell('E2').value=70;s.getCell('F2').value='km';
 const result=inspectSheet(s);assert.equal(result.rows.length,1);assert.equal(result.rows[0].raw.work_interval,'09:00 ～ 18:00');
 assert.equal(result.rows[0].raw.reported_excess_distance,'70 km');
});
