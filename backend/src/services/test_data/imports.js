const { TYPES, fictional, fail } = require('./model');
const FIELDS = { code: ['code', 'no', 'コード', '番号'], name: ['name', '名称', '名前', '氏名', '企業名', '案件名', 'パートナー名'],
  companyCode: ['companycode', '企業コード'], partnerCode: ['partnercode', 'パートナーコード'], baseCode: ['basecode', '基本案件コード'] };
const header = s => String(s ?? '').normalize('NFKC').replace(/[\s_．.]/g, '').toLowerCase();
function parseCsv(text) {
  const rows = []; let row = [], value = '', quoted = false, closed = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === '"') { if (quoted && text[i + 1] === '"') { value += '"'; i++; } else { if (!quoted && (value || closed)) fail('CSVの引用符が不正です'); closed = quoted; quoted = !quoted; } }
    else if (c === ',' && !quoted) { row.push(value); value = ''; closed = false; }
    else if ((c === '\n' || c === '\r') && !quoted) { if (c === '\r' && text[i + 1] === '\n') i++; row.push(value); rows.push(row); row = []; value = ''; closed = false; }
    else { if (closed) fail('CSVの閉じ引用符の後に文字があります'); value += c; }
  }
  if (quoted) fail('CSVの引用符が閉じていません');
  if (value || row.length) { row.push(value); rows.push(row); }
  return rows;
}
function sheet(name, rows) {
  if (!rows.length || rows.length > 501 || rows.some(r => r.length > 40)) fail('各シートは見出し＋500行、40列までです');
  if (rows.some(r => r.some(c => c != null && String(c).length > 200))) fail('セルは200文字以内です');
  const headers = rows[0].map(c => String(c ?? '').replace(/^\ufeff/, ''));
  return { name, headers, rows: rows.slice(1).filter(r => r.some(c => c != null && c !== '')).map(r => headers.map((_, i) => r[i] == null ? '' : String(r[i]))),
    suggestedMapping: headers.map((h, column) => ({ column, field: Object.keys(FIELDS).find(k => FIELDS[k].some(s => header(h) === header(s))) || '', mode: 'preserve' })) };
}
async function parseFiles(files, encoding = 'utf8') {
  if (!files.length || files.length > 5 || files.reduce((n, f) => n + f.buffer.length, 0) > 10 * 1024 * 1024) fail('合計10MB、5ファイルまでです');
  if (!['utf8', 'cp932'].includes(encoding)) fail('文字コードはUTF-8またはCP932です');
  const sheets = [];
  for (const file of files) {
    if (/\.csv$/i.test(file.originalname)) {
      const decoded = require('iconv-lite').decode(file.buffer, encoding);
      if (decoded.includes('\ufffd')) fail('文字コードを確認してください');
      sheets.push(sheet(file.originalname, parseCsv(decoded)));
    } else if (/\.xlsx$/i.test(file.originalname)) {
      const zip = await require('unzipper').Open.buffer(file.buffer);
      if (zip.files.length > 1000 || zip.files.reduce((n, f) => n + f.uncompressedSize, 0) > 20 * 1024 * 1024) fail('xlsxの展開サイズ上限を超えています');
      let expanded = 0;
      for (const f of zip.files) {
        if (/vbaProject|externalLinks/i.test(f.path)) fail('マクロ・外部リンクは取り込めません');
        if (f.type !== 'Directory') {
          let bytes = 0, previous = '';
          for await (const part of f.stream()) {
            bytes += part.length; expanded += part.length;
            if (bytes > 20 * 1024 * 1024 || expanded > 20 * 1024 * 1024) fail('展開サイズ上限を超えています');
            const content = previous + part.toString('utf8');
            if (/^xl\/worksheets\/.*\.xml$/.test(f.path) && /<(?:\w+:)?f(?:\s|\/?>)/.test(content)) fail('数式セルは値に変換してから取り込んでください');
            previous = content.slice(-100);
          }
        }
      }
      const excel = require('read-excel-file/node');
      const names = await excel.readSheetNames(file.buffer);
      if (names.length > 10) fail('xlsxは10シートまでです');
      for (const name of names) sheets.push(sheet(`${file.originalname} / ${name}`, await excel(file.buffer, { sheet: name })));
    } else fail('xlsxまたはcsvを選択してください');
  }
  return sheets;
}
function normalize(sheets) {
  if (!Array.isArray(sheets) || sheets.length > 50) fail('シート指定が不正です');
  const catalog = {}, issues = [], fills = [];
  for (const s of sheets) {
    if (!Object.hasOwn(TYPES, s.type)) fail('取込先の種類を選択してください');
    if (!Array.isArray(s.rows) || s.rows.length > 500 || !Array.isArray(s.mapping)) fail('シート形式が不正です');
    const mapping = s.mapping.filter(m => m.mode !== 'unused' && m.field);
    if (mapping.some(m => !Object.hasOwn(FIELDS, m.field) || !['preserve', 'fictional'].includes(m.mode) || !Number.isInteger(m.column) || m.column < 0 || m.column >= 40)) fail('列割当が不正です');
    if (new Set(mapping.map(m => m.field)).size !== mapping.length) fail('同じ項目へ複数列を割り当てないでください');
    if (mapping.some(m => m.field !== 'name' && m.mode === 'fictional')) fail('コードの仮想化は参照を壊すため初回では未対応です。コードは維持してください');
    catalog[s.type] ||= [];
    for (const values of s.rows) {
      if (!Array.isArray(values)) fail('行形式が不正です');
      const row = {};
      for (const m of mapping) {
        const raw = values[m.column] ?? '';
        if (typeof raw !== 'string' || raw.length > 200) fail('セルは200文字以内の文字列です');
        row[m.field] = m.mode === 'fictional' ? fictional(s.type, catalog[s.type].length).name : raw.trim();
      }
      if (!row.code) issues.push(`${s.type} ${catalog[s.type].length + 1}行目: コードが必要です`);
      if (!row.name) fills.push(`${s.type} ${row.code}: 名称を仮想補完します`);
      if (catalog[s.type].some(r => r.code === row.code)) issues.push(`${s.type}: コード ${row.code} が重複しています`);
      catalog[s.type].push(row);
    }
    if (catalog[s.type].length > 500) fail('各種類500件までです');
  }
  return { catalog, issues, fills, counts: Object.fromEntries(Object.entries(catalog).map(([k, r]) => [k, r.length])) };
}
module.exports = { parseCsv, sheet, parseFiles, normalize, FIELDS };
