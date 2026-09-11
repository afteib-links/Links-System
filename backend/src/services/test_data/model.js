const crypto = require('node:crypto');

const TYPES = { companies: 'C', partners: 'P', baseProjects: 'B', projects: 'J', staff: 'S' };
const LABELS = { companies: '企業', partners: 'パートナー', baseProjects: '基本案件', projects: '個別案件', staff: '担当者' };
const CASES = [
  ['normal', '通常勤務', '勤務・料金の基本確認'], ['early', '早朝勤務', '食品配送の早朝稼働'],
  ['night', '翌日終了', '22:00〜31:00の深夜稼働'], ['overtime', '残業', '終了を2時間延長'],
  ['short', '早退', '終了を2時間短縮'], ['training', '研修', '研修区分で稼働'],
  ['absent', '欠勤', '時間・距離・通常料金なし'], ['unnecessary', '不要', '非稼働日を未入力と区別'],
  ['holiday', '休日出勤', '日曜日に稼働'],
].map(([id, name, purpose]) => ({ id, name, purpose, screen: '日報', supported: true }));
const PRESETS = {
  realistic: { normal: 70, early: 5, night: 2, overtime: 10, short: 2, training: 5, absent: 2, holiday: 4 },
  coverage: { normal: 20, early: 10, night: 10, overtime: 15, short: 10, training: 15, absent: 10, holiday: 10 },
  mixed: { normal: 45, early: 7, night: 5, overtime: 15, short: 5, training: 10, absent: 5, holiday: 8 },
};
function fail(message) { const e = new Error(message); e.status = 422; throw e; }
function date(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value || '') || !Number.isFinite(Date.parse(value)) || new Date(value).toISOString().slice(0, 10) !== value) fail('日付が不正です');
  return value;
}
function defaults(asOf = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Tokyo' }).format(new Date())) {
  date(asOf); const start = new Date(`${asOf.slice(0, 7)}-01T00:00:00Z`); start.setUTCMonth(start.getUTCMonth() - 2);
  return { version: 1, seed: 'links-test-1', asOf, start: start.toISOString().slice(0, 10), preset: 'realistic',
    counts: { companies: 5, partners: 10, baseProjects: 5, projects: 10, staff: 3 },
    weights: { ...PRESETS.realistic }, required: ['normal'], catalog: {}, acceptFill: false, decisions: {} };
}
function validate(input) {
  const c = structuredClone(input);
  if (c.version !== 1) fail('未対応の設定版です');
  date(c.asOf); date(c.start);
  const days = (Date.parse(c.asOf) - Date.parse(c.start)) / 86400000 + 1;
  if (days < 1 || days > 366) fail('対象期間は1〜366日で指定してください');
  if (typeof c.seed !== 'string' || !c.seed.length || c.seed.length > 100) fail('シードは1〜100文字です');
  if (!Object.hasOwn(PRESETS, c.preset)) fail('プリセットが不正です');
  for (const type of Object.keys(TYPES)) {
    if (!Number.isInteger(c.counts?.[type]) || c.counts[type] < 1 || c.counts[type] > 500) fail(`${LABELS[type]}は1〜500件です`);
    const rows = c.catalog?.[type] || [];
    if (!Array.isArray(rows) || rows.length > c.counts[type]) fail(`${LABELS[type]}の取込件数より少ない件数は指定できません`);
    const codes = new Set();
    for (const r of rows) {
      if (!r.code || typeof r.code !== 'string' || codes.has(r.code)) fail(`${LABELS[type]}のコード不足・重複があります`);
      codes.add(r.code);
      for (const value of Object.values(r)) if (typeof value !== 'string' || value.length > 200) fail('取込値は200文字以内の文字列にしてください');
    }
  }
  if (days * c.counts.projects > 50000) fail('サンプルは最大50,000案件日です。期間または件数を減らしてください');
  if (!c.weights || Object.keys(c.weights).some(k => !Object.hasOwn(PRESETS.realistic, k))) fail('勤務割合に未知のケースがあります');
  let sum = 0;
  for (const k of Object.keys(PRESETS.realistic)) { const w = c.weights[k]; if (!Number.isFinite(w) || w < 0 || w > 100) fail('勤務割合は0〜100です'); sum += w; }
  if (sum !== 100) fail('勤務割合の合計を100にしてください');
  if (!Array.isArray(c.required) || c.required.some(k => !CASES.some(s => s.id === k))) fail('未対応の必須ケースです');
  for (const [key, d] of Object.entries(c.decisions || {})) {
    if (!CASES.some(s => s.id === key) || !['accept', 'adjust', 'exclude'].includes(d.status) || typeof d.comment !== 'string' || d.comment.length > 1000) fail('ケースの採否またはコメントが不正です');
    if (d.status === 'exclude' && (c.required.includes(key) || (c.weights[key] || 0) > 0 || key === 'unnecessary')) fail('除外ケースは必須指定と割合から外してください。不要日は除外できません');
  }
  return c;
}
const family = ['佐藤', '鈴木', '高橋', '田中', '伊藤', '渡辺', '山本', '中村', '小林', '加藤', '吉田', '山田', '佐々木'];
const given = ['拓海', '美咲', '健太', '彩花', '直樹', '結衣', '大輔', '陽菜', '翔太', '真由', '悠人', '千尋', '亮介'];
const jobs = ['企業車両による食品の配送業務', '橋梁点検調査補助業務', '倉庫内入出荷及び付帯業務', '分析会社での事務・仕分け業務', 'パソコンサポート及びアフターサポート業務'];
function fictional(type, i) {
  const code = `${TYPES[type]}${String(i + 1).padStart(5, '0')}`;
  const name = type === 'partners' || type === 'staff' ? `${family[i % family.length]} ${given[Math.floor(i / family.length + i) % given.length]}`
    : type === 'companies' ? `${['青葉食品', '若葉建材', 'みらい環境分析', '東都倉庫', 'あさひ情報設備'][i % 5]}株式会社 ${i + 1}`
      : `${jobs[i % 5]}（${i % 2 ? '関西' : '関東'}・第${i + 1}現場）`;
  return { code, name };
}
function catalogs(c) {
  const result = {}, fills = [];
  for (const type of Object.keys(TYPES)) {
    const imported = c.catalog?.[type] || [];
    result[type] = Array.from({ length: c.counts[type] }, (_, i) => {
      const row = { ...fictional(type, i), ...imported[i] };
      if (!imported[i]?.name) { row.name = fictional(type, i).name; fills.push(`${LABELS[type]} ${row.code}: 名称を仮想補完`); }
      return row;
    });
    if (new Set(result[type].map(r => r.code)).size !== result[type].length) fail(`${LABELS[type]}の補完コードが取込コードと重複します。件数・コードを調整してください`);
  }
  for (const [i, row] of result.projects.entries()) {
    const refs = { companyCode: 'companies', partnerCode: 'partners', baseCode: 'baseProjects' };
    for (const [field, type] of Object.entries(refs)) {
      if (!row[field]) { row[field] = result[type][i % result[type].length].code; fills.push(`${row.code}: ${field} → ${row[field]}`); }
      if (!result[type].some(r => r.code === row[field])) fail(`${row.code}: ${field}の参照先がありません`);
    }
  }
  return { catalog: result, fills };
}
function hash(value) { return crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex'); }
function preview(input) {
  const config = validate(input), { catalog, fills } = catalogs(config), reports = [], achieved = {};
  let seed = parseInt(hash(config.seed).slice(0, 8), 16);
  const rand = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; };
  const required = [...new Set(config.required)].filter(k => k !== 'unnecessary');
  const projectsByPartner = new Map();
  for (const project of catalog.projects) {
    if (!projectsByPartner.has(project.partnerCode)) projectsByPartner.set(project.partnerCode, []);
    projectsByPartner.get(project.partnerCode).push(project.code);
  }
  const previousMonth = new Date(`${config.asOf.slice(0, 7)}-01T00:00:00Z`);
  previousMonth.setUTCMonth(previousMonth.getUTCMonth() - 1);
  for (const project of catalog.projects) {
    let lastEnd = 0;
    const delivery = /配送|運送|運行|集配|ドライバー/.test(project.name);
    const canNight = /点検|調査|倉庫/.test(project.name);
    for (let time = Date.parse(config.start); time <= Date.parse(config.asOf); time += 86400000) {
      const day = new Date(time), workDate = day.toISOString().slice(0, 10), dow = day.getUTCDay();
      let kind = 'unnecessary';
      const assignments = projectsByPartner.get(project.partnerCode) || [project.code];
      const scheduledProject = assignments[Math.floor(time / 86400000) % assignments.length];
      const available = scheduledProject === project.code;
      const applicable = k => (k !== 'early' || delivery) && (k !== 'night' || canNight);
      const eligible = k => applicable(k) && (k === 'holiday' ? dow === 0 : dow > 0 && dow < 6);
      const forced = available ? required.find(eligible) : null;
      if (forced) { kind = forced; required.splice(required.indexOf(forced), 1); }
      else if (available && dow > 0 && dow < 6) {
        const entries = Object.entries(config.weights).filter(([k]) => k !== 'holiday' && applicable(k));
        let n = rand() * entries.reduce((s, [, w]) => s + w, 0);
        kind = entries.find(([, w]) => (n -= w) < 0)?.[0] || 'unnecessary';
      } else if (available && dow === 0 && rand() * 100 < config.weights.holiday) kind = 'holiday';
      const working = !['unnecessary', 'absent'].includes(kind);
      const start = kind === 'night' ? 22 * 60 : kind === 'early' || delivery ? 5 * 60 : 8 * 60;
      const end = start + 540 + (kind === 'overtime' ? 120 : kind === 'short' ? -120 : 0);
      if (working && (time + start * 60000 < lastEnd || time + end * 60000 > Date.parse(config.asOf) + 86400000)) { kind = 'unnecessary'; }
      const active = !['unnecessary', 'absent'].includes(kind);
      if (active) lastEnd = time + end * 60000;
      achieved[kind] = (achieved[kind] || 0) + 1;
      const fmt = m => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
      reports.push({ scenario: kind, projectCode: project.code, partnerCode: project.partnerCode, workDate,
        startTime: active ? fmt(start) : null, endTime: active ? fmt(end) : null, breakMinutes: active ? 60 : 0,
        distanceKm: active && delivery ? 60 + Math.floor(rand() * 80) : 0,
        isTraining: kind === 'training', state: kind === 'unnecessary' ? '不要' : kind === 'absent' ? '欠勤' : '入力予定',
        monthlyTarget: workDate.slice(0, 7) === config.asOf.slice(0, 7) ? '入力中' : workDate.slice(0, 7) === previousMonth.toISOString().slice(0, 7) ? '処理中' : '完了予定',
        billingAmount: null, paymentAmount: null });
    }
  }
  const missing = config.required.filter(k => !achieved[k]);
  const warnings = ['サンプル段階です。承認・精算・金額計算・帳票はまだ作成していません。', '祝日マスター・契約改定・担当者別集計の適用は業務生成アダプター接続後に検証します。', '早朝は配送、夜勤は点検・調査・倉庫だけに適用します。勤務重複・基準日翌日への勤務は不要とし、割合の差は実現件数で確認してください。'];
  if (missing.length) warnings.push(`必須ケース未達: ${missing.join(', ')}`);
  return { hash: hash(config), catalog, reports, achieved, fills, warnings, missing,
    approvable: missing.length === 0 && (!fills.length || config.acceptFill === true) && !Object.values(config.decisions || {}).some(d => d.status === 'adjust') };
}
function share(config) {
  // Allowlist only. Never export preserved source values, file names, custom seeds or free text.
  const clean = defaults(config.asOf);
  Object.assign(clean, { start: config.start, counts: config.counts, weights: config.weights, required: config.required,
    preset: config.preset, seed: 'shared-anonymous', acceptFill: true });
  const p = preview(clean);
  return { format: 'links-test-data-share-v1', anonymous: true, config: clean, cases: CASES.map(s => ({ ...s, decision: config.decisions?.[s.id]?.status || 'unreviewed' })), preview: p,
    excluded: ['元ファイル', '維持した値', '自由コメント', '接続情報', '元の乱数シード'], note: '匿名版は再サンプリングです。元サンプルと同一の勤務配置ではありません。' };
}
function csv(rows) {
  const fields = ['projectCode', 'partnerCode', 'workDate', 'scenario', 'startTime', 'endTime', 'breakMinutes', 'distanceKm'];
  const cell = value => { let s = String(value ?? ''); if (/^[\s]*[=+@\-]/.test(s)) s = `'${s}`; return `"${s.replaceAll('"', '""')}"`; };
  return '\ufeff' + [fields, ...rows.map(r => fields.map(f => r[f]))].map(r => r.map(cell).join(',')).join('\r\n');
}
module.exports = { TYPES, LABELS, CASES, PRESETS, defaults, validate, catalogs, fictional, preview, share, csv, hash, fail };
