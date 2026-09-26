const ExcelJS = require('exceljs');
const { periodError } = require('./daily_report_periods');
const aliases = [
  ['work_date', /日付/],['work_interval', /業務稼働時間|稼働時間/],['start_time',/開始|始業/],['end_time',/終了|終業/],
  ['break_minutes',/休憩/],['reported_overtime',/時間超過/],['reported_excess_distance',/距離超過/],
  ['total_distance',/走行距離/],['business_expense',/業務経費/],['alcohol_check',/酒気帯び/],['row_comment',/備考/],['confirmation_mark',/確認印/],
];
function cellValue(cell) {
  let v=cell.value;
  if (v && typeof v==='object' && !(v instanceof Date)) v=v.result ?? v.text ?? (v.richText?.map(t=>t.text).join('')) ?? '';
  if (v instanceof Date) return `${String(v.getUTCHours()).padStart(2,'0')}:${String(v.getUTCMinutes()).padStart(2,'0')}`;
  if (typeof v==='number' && v>=0 && v<2 && /[hH].*[mM]/.test(cell.numFmt || '')) {
    const minutes=Math.round(v*1440);return `${String(Math.floor(minutes/60)).padStart(2,'0')}:${String(minutes%60).padStart(2,'0')}`;
  }
  return String(v ?? '').trim();
}
async function readWorkbook(file) {
  const workbook=new ExcelJS.Workbook();await workbook.xlsx.readFile(file);
  if(workbook.worksheets.length>30) throw periodError('シート数は30までです',400);
  return workbook;
}
function inspectSheet(sheet) {
  if(sheet.rowCount>5000 || sheet.columnCount>200) throw periodError('帳票の行数・列数が大きすぎます',400);
  let heading=null, columns=[];
  for(let r=1;r<=Math.min(sheet.rowCount,40);r++) {
    const found=[];
    sheet.getRow(r).eachCell((cell,col)=>{
      if(cell.isMerged && cell.master.address!==cell.address)return;
      const label=cellValue(cell), clean=label.normalize('NFKC').replace(/\s/g,'');
      if(!clean)return;
      const key=aliases.find(([,pattern])=>pattern.test(clean))?.[0] || `extra_col_${col}`;
      found.push({key,label,col});
    });
    if(found.some(c=>c.key==='work_date') && found.some(c=>['work_interval','start_time'].includes(c.key))) {heading=r;columns=found;break;}
  }
  if(!heading)return {name:sheet.name,rows:[],columns:[],warning:'日付と勤務時間の見出しを特定できません'};
  const rows=[];
  for(let r=heading+1;r<=sheet.rowCount;r++) {
    const dateCol=columns.find(c=>c.key==='work_date').col;
    const dateCell=sheet.getRow(r).getCell(dateCol);
    if(dateCell.isMerged && dateCell.master.row!==r)continue;
    const date=cellValue(dateCell);
    if(!/^[※*＊]?\s*\d{1,2}(?:日)?$/.test(date))continue;
    const raw={}, cells={}, column_labels={};
    columns.forEach((c,i)=>{
      const end=columns[i+1]?.col || sheet.columnCount+1, values=[];
      for(let col=c.col;col<end;col++) {
        const cell=sheet.getRow(r).getCell(col);
        if(cell.isMerged && cell.master.address!==cell.address)continue;
        const value=cellValue(cell);if(value)values.push(value);
      }
      raw[c.key]=values.join(' ');cells[c.key]=`${sheet.getRow(r).getCell(c.col).address}:${sheet.getRow(r).getCell(end-1).address}`;
      column_labels[c.key]=c.label;
    });
    rows.push({source_row:r,raw,cells,column_labels});
  }
  const header=[];
  for(let r=1;r<heading;r++)sheet.getRow(r).eachCell(cell=>{if(!cell.isMerged||cell.master.address===cell.address) {const v=cellValue(cell);if(v)header.push(v);}});
  return {name:sheet.name,rows,columns,header};
}
module.exports={readWorkbook,inspectSheet,cellValue};
