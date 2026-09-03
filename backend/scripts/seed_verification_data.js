/*
 * ローカル/NAS テスト用の匿名検証データ。
 * 実行: npm run seed:verification
 * 確認: npm run verify:verification-data
 */
const { getPool } = require('../src/db');
const { applyDailyPriceCalc } = require('../src/services/price_calc');
const fs = require('fs/promises');
const path = require('path');
const { PDF_DIR, writePdf } = require('../src/services/settlement_pdf');

const PREFIX = '【検証】';
const SEED_KEY = 'verification-data-2026-v2';
const MONTHS = Array.from({ length: 8 }, (_, index) => `2026-${String(index + 1).padStart(2, '0')}`);
const SPECIAL_PROJECT_START = 40;

const COMPANY_NAMES = [
  '東都ロジスティクス株式会社', 'みなと流通サービス株式会社', '青葉食品配送株式会社',
  '中央建材輸送株式会社', '北辰ネットワーク便株式会社', '関東メディカル配送株式会社',
  '京浜倉庫サービス株式会社', '西東京共同配送株式会社', '彩都通販物流株式会社',
  '湾岸コンテナ輸送株式会社', '東関東青果流通株式会社', '多摩機工運輸株式会社',
  '城南店舗配送株式会社', '湘南冷蔵物流株式会社', '首都圏ホームセンター便株式会社',
  '武蔵野印刷資材配送株式会社', '東京医療資材輸送株式会社', '千葉県央共同便株式会社',
  '埼玉量販店配送株式会社', '横浜港湾サポート株式会社',
];

const PARTNER_NAMES = [
  '山田 恒一', '佐藤 拓也', '鈴木 翔太', '高橋 健太', '田中 直樹',
  '伊藤 雅人', '渡辺 和也', '山本 優太', '中村 亮介', '小林 大輔',
  '加藤 雄一', '吉田 智也', '山口 修平', '松本 裕介', '井上 誠',
  '木村 達也', '林 浩二', '清水 圭一', '斎藤 拓真', '阿部 隆',
  '森 隼人', '池田 悠人', '橋本 章', '山下 孝之', '石川 俊介',
  '中島 明', '前田 祐樹', '藤田 英樹', '後藤 淳', '岡田 大樹',
];

const BASE_PROJECT_NAMES = [
  '鉄道沿線近接樹木調査における助手業務及び付帯業務',
  '道路施設点検助手',
  '都内23区内のJKK及び都営住宅のPCB事前調査業務',
  'パソコンサポート及びトラブル・アフターサポート業務',
  'フォークリフトを用いた入出荷、倉庫内作業、その他付随する業務',
  '分析会社での事務作業と仕分け及び付帯業務',
  'ボーリング調査の準備、ロットの付け替え、洗浄その他補助業務',
  '企業冷凍車両による食肉の配送業務',
  '橋梁点検調査補助業務',
  '金属探知機を使用しての調査補助および付帯作業',
  '空気・採水・土壌等の試料採取及び測定業務',
  '企業車両による照明器具の配送業務',
  '企業車両による消耗品（モップ・マット等）の配送業務',
  '企業車両による食肉加工品の配送業務',
  '企業車両による食肉の配送業務',
  '企業車両による食品（米・油・調味料等）の配送業務',
  '企業車両によるステンレス製品等の配送業務',
  '企業車両による青果物の配送業務',
  '企業車両による鮮魚・水産加工物の配送業務',
  '企業車両による葬儀用装飾品の配送業務',
  '建築物改修工事に伴う現場調査補助業務',
  '道路交通量調査及び現地確認補助業務',
  '倉庫内商品検品、棚卸し及び付帯業務',
  '事務所移転に伴う搬出入及び設置補助業務',
  '医療機器及び関連資材の配送補助業務',
  '企業車両による飲料製品の配送業務',
  '物流センターにおける梱包及び出荷補助業務',
  '環境測定に伴う現地作業及び試料整理業務',
  '商業施設設備点検における作業補助業務',
  '展示会・イベント用品の搬入搬出及び付帯業務',
];

const PROJECT_VARIANTS = ['第1便', '第2便', '早朝便', '日中便', '夜間便', '土曜便'];

function shortProjectName(name) {
  return name
    .replace('企業車両による', '')
    .replace('企業冷凍車両による', '')
    .replace('における助手業務及び付帯業務', '助手業務')
    .replace('及び付帯業務', '')
    .replace('その他付随する業務', '')
    .slice(0, 18);
}

function priceName(kind, companyName, baseName) {
  return `${kind}（${companyName.replace(PREFIX, '')}：${shortProjectName(baseName)}）`;
}

function cell(billing = '', payment = '') {
  return { billing, payment, lineIds: {} };
}

function matrix(multiplier = 1) {
  return {
    daily: {
      basic: cell(20000 * multiplier, 15500 * multiplier),
      shortage: cell('', ''), overtime: cell('', ''), night: cell('', ''), night_overtime: cell('', ''),
    },
    hourly: {
      basic: cell('', ''),
      shortage: cell(2500 * multiplier, 1900 * multiplier),
      overtime: cell(2600 * multiplier, 2100 * multiplier),
      night: cell(2800 * multiplier, 2250 * multiplier),
      night_overtime: cell(3200 * multiplier, 2600 * multiplier),
    },
  };
}

function priceExtra(projectIndex, companyName, baseName) {
  const special = projectIndex >= SPECIAL_PROJECT_START;
  const normal = {
    id: 'weekday-standard', name: priceName('平日料金', companyName, baseName), mode: 'weekdays',
    weekdays: { weekday: true }, matrix: matrix(1),
  };
  const holiday = {
    id: 'holiday-standard', name: priceName('休日料金', companyName, baseName), mode: 'weekdays',
    weekdays: { holiday: true, sat: true, sun: true }, matrix: matrix(1.25),
  };
  const training = {
    id: 'training', name: priceName('研修料金', companyName, baseName), mode: 'weekdays',
    weekdays: { all: true }, matrix: matrix(0.7),
  };
  const items = [normal, holiday, training, {
    id: 'distance-extra', name: priceName('距離超過料金', companyName, baseName), mode: 'distance',
    matrix: { distance: { basic: cell(80, 55) } },
  }];
  if (special) {
    items.push({
      id: 'manual-special', name: priceName('臨時特別料金', companyName, baseName),
      mode: 'weekdays', weekdays: { all: true }, matrix: matrix(1.45),
    });
  }
  const split = projectIndex === 48;
  return {
    seed_key: SEED_KEY,
    fee_items: items,
    night_rules: {
      billing: { periods: [{ start: '22:00', end: '29:00' }], night_mode: 'separate', night_overtime_mode: 'separate' },
      payment: split
        ? { periods: [{ start: '23:00', end: '30:00' }], night_mode: 'separate', night_overtime_mode: 'separate' }
        : { periods: [{ start: '22:00', end: '29:00' }], night_mode: 'separate', night_overtime_mode: 'separate' },
    },
    rounding: {
      billing: { time_unit_minutes: projectIndex === 49 ? 30 : 15, time_mode: 'floor', amount_mode: 'floor', amount_stage: 'detail' },
      payment: { time_unit_minutes: 15, time_mode: projectIndex === 49 ? 'round' : 'floor', amount_mode: 'floor', amount_stage: 'detail' },
    },
    work_rules: {
      billing: { standard_minutes: 480 },
      payment: { standard_minutes: split ? 540 : 480 },
    },
  };
}

function ymd(ym, day) { return `${ym}-${String(day).padStart(2, '0')}`; }
function weekday(date) { return new Date(`${date}T12:00:00Z`).getUTCDay(); }
function daysInMonth(ym) { return new Date(Date.UTC(Number(ym.slice(0, 4)), Number(ym.slice(5, 7)), 0)).getUTCDate(); }

function reportDates(projectIndex, ym) {
  if ([38, 39].includes(projectIndex) || ([45, 46, 47].includes(projectIndex) && ym === '2026-08')) return [];
  const dates = [];
  for (let day = 1; day <= daysInMonth(ym); day += 1) {
    const date = ymd(ym, day);
    const dow = weekday(date);
    if (dow === 0 || dow === 6) continue;
    const group = projectIndex < 10 ? 'high' : projectIndex < 35 ? 'normal' : projectIndex < 45 ? 'low' : 'minimal';
    if (group === 'high' && day % 5 !== 0) dates.push(date);
    if (group === 'normal' && (dow === 1 || dow === 3 || dow === 5)) dates.push(date);
    if (group === 'low' && dow === 5 && day % 2 === 1) dates.push(date);
    if (group === 'minimal' && dow === 1 && day <= 7) dates.push(date);
  }
  if (projectIndex === 44 && ym === '2026-05') dates.push('2026-05-06');
  return [...new Set(dates)].sort();
}

function reportInput(project, date, position) {
  const special = project.index - SPECIAL_PROJECT_START;
  const input = {
    project_id: project.projectId, company_id: project.companyId, partner_id: project.partnerId,
    vehicle_id: project.vehicleId, target_year_month: date.slice(0, 7), work_date: date,
    start_time: '08:00', end_time: '17:00', break_minutes: 60,
    start_meter: 1000 + position * 10, end_meter: 1040 + position * 10, total_distance: 40,
    toll_fee: position % 11 === 0 ? 600 : 0, parking_fee: position % 17 === 0 ? 500 : 0,
    transport_fee: 0, row_comment: `${shortProjectName(project.baseName)}｜${project.variant}｜日報入力`, input_source_type: 'manual',
  };
  if (special === 0 && position % 5 === 0) input.end_time = '20:00';
  if (special === 1 && position % 5 === 0) input.end_time = '13:00';
  if (special === 2 && position % 5 === 0) { input.start_time = '20:00'; input.end_time = '28:00'; input.night_break_minutes_billing = 30; input.night_break_minutes_payment = 30; }
  if (special === 3 && position % 5 === 0) { input.start_time = '18:00'; input.end_time = '31:00'; input.night_break_minutes_billing = 30; input.night_break_minutes_payment = 30; }
  if (special === 4 && position % 5 === 0) input.row_comment = '休日料金検証';
  if (special === 5 && position % 5 === 0) { input.is_training = 1; input.row_comment = '研修料金自動選択検証'; }
  if (special === 6 && position % 5 === 0) { input.selected_fee_item_id = 'manual-special'; input.fee_item_selection_source = 'manual'; input.row_comment = '料金項目手動選択検証'; }
  if (special === 7 && position % 5 === 0) { input.rate_overrides = { billing: { basic: 22500 }, payment: { basic: 17100 } }; input.rate_override_reason = '匿名検証用の一時単価変更'; }
  if (special === 8 && position % 5 === 0) { input.start_time = '21:00'; input.end_time = '29:00'; input.night_break_minutes_billing = 30; input.night_break_minutes_payment = 30; }
  if (special === 9 && position % 5 === 0) { input.start_time = '08:07'; input.end_time = '18:11'; input.total_distance = 85; }
  return input;
}

async function assertSchema(conn) {
  const [rows] = await conn.query(`SHOW TABLES LIKE 'daily_report_monthly_approvals'`);
  if (!rows.length) throw new Error('必要なマイグレーションが未適用です。先にアプリを起動してマイグレーションを適用してください。');
}

async function verificationSummary(conn) {
  const names = ['companies', 'partners'];
  const result = {};
  for (const name of names) {
    const nameColumn = name === 'companies' ? 'company_name' : name === 'partners' ? 'partner_name' : null;
    if (nameColumn) {
      const pattern = name === 'companies' ? `${PREFIX}%` : '%（検証）';
      const [rows] = await conn.execute(`SELECT COUNT(*) AS count FROM ${name} WHERE ${nameColumn} LIKE ? AND is_deleted = 0`, [pattern]);
      result[name] = Number(rows[0].count);
    }
  }
  const seedWhere = "JSON_UNQUOTE(JSON_EXTRACT(extra_data, '$.seed_key')) = ? AND is_deleted = 0";
  const [projectRows] = await conn.execute(`SELECT COUNT(*) AS count FROM projects WHERE ${seedWhere}`, [SEED_KEY]);
  const [reportRows] = await conn.execute(`SELECT COUNT(*) AS count FROM daily_reports WHERE ${seedWhere}`, [SEED_KEY]);
  const [advanceRows] = await conn.execute(`SELECT COUNT(*) AS count FROM advance_records ar JOIN projects p ON p.project_id=ar.project_id WHERE JSON_UNQUOTE(JSON_EXTRACT(p.extra_data,'$.seed_key'))=?`, [SEED_KEY]);
  const [baseRows] = await conn.execute(`SELECT COUNT(*) AS count FROM base_projects WHERE ${seedWhere}`, [SEED_KEY]);
  const [priceSetRows] = await conn.execute(`SELECT COUNT(*) AS count FROM price_sets WHERE JSON_UNQUOTE(JSON_EXTRACT(extra_data, '$.seed_key')) = ? AND is_deleted = 0`, [SEED_KEY]);
  const [invoiceRows] = await conn.execute(`SELECT COUNT(*) AS count FROM invoices WHERE ${seedWhere}`, [SEED_KEY]);
  const [paymentRows] = await conn.execute(`SELECT COUNT(*) AS count FROM payments WHERE ${seedWhere}`, [SEED_KEY]);
  const [workflowRows] = await conn.execute(`SELECT COUNT(*) count FROM settlement_workflows w WHERE (w.settlement_type='invoice' AND w.settlement_id IN (SELECT invoice_id FROM invoices WHERE ${seedWhere})) OR (w.settlement_type='payment' AND w.settlement_id IN (SELECT payment_id FROM payments WHERE ${seedWhere}))`,[SEED_KEY,SEED_KEY]);
  const [documentRows] = await conn.execute(`SELECT COUNT(*) count FROM settlement_documents d WHERE (d.settlement_type='invoice' AND d.settlement_id IN (SELECT invoice_id FROM invoices WHERE ${seedWhere})) OR (d.settlement_type='payment' AND d.settlement_id IN (SELECT payment_id FROM payments WHERE ${seedWhere}))`,[SEED_KEY,SEED_KEY]);
  const [noReportRows] = await conn.execute(
    `SELECT COUNT(*) AS count FROM projects p
     WHERE ${seedWhere.replaceAll('extra_data', 'p.extra_data')}
       AND NOT EXISTS (SELECT 1 FROM daily_reports d WHERE d.project_id = p.project_id AND d.is_deleted = 0)`
    , [SEED_KEY]
  );
  const [noAugustRows] = await conn.execute(
    `SELECT COUNT(*) AS count FROM projects p
     WHERE ${seedWhere.replaceAll('extra_data', 'p.extra_data')}
       AND NOT EXISTS (SELECT 1 FROM daily_reports d WHERE d.project_id = p.project_id AND d.target_year_month = '2026-08' AND d.is_deleted = 0)`
    , [SEED_KEY]
  );
  const [missingPriceRows] = await conn.execute(
    `SELECT COUNT(*) AS count FROM daily_reports WHERE ${seedWhere} AND applied_price_set_id IS NULL`, [SEED_KEY]
  );
  result.base_projects = Number(baseRows[0].count);
  result.projects = Number(projectRows[0].count);
  result.price_sets = Number(priceSetRows[0].count);
  result.daily_reports = Number(reportRows[0].count);
  result.advance_records = Number(advanceRows[0].count);
  result.invoices = Number(invoiceRows[0].count);
  result.payments = Number(paymentRows[0].count);
  result.settlement_workflows = Number(workflowRows[0].count);
  result.settlement_documents = Number(documentRows[0].count);
  result.projects_without_reports = Number(noReportRows[0].count);
  result.projects_without_august_reports = Number(noAugustRows[0].count);
  result.daily_reports_without_price_set = Number(missingPriceRows[0].count);
  return result;
}

async function insert(conn, table, data) {
  const columns = Object.keys(data);
  const [result] = await conn.execute(
    `INSERT INTO ${table} (${columns.join(', ')}) VALUES (${columns.map(() => '?').join(', ')})`,
    columns.map((column) => data[column])
  );
  return Number(result.insertId);
}

async function ensureVerificationCycles(conn, ym) {
  const lastDay = new Date(Date.UTC(Number(ym.slice(0,4)),Number(ym.slice(5,7)),0)).getUTCDate();
  for (const [code,day] of [['05',5],['10',10],['15',15],['20',20],['25',25],['end',lastDay]]) {
    const date=`${ym}-${String(day).padStart(2,'0')}`;
    await conn.execute(`INSERT IGNORE INTO cash_cycles (target_year_month,cycle_code,base_date,planned_incoming_date,planned_outgoing_date) VALUES (?,?,?,?,?)`,[ym,code,date,date,date]);
  }
  const [rows]=await conn.execute(`SELECT * FROM cash_cycles WHERE target_year_month=? ORDER BY FIELD(cycle_code,'05','10','15','20','25','end')`,[ym]);
  return rows;
}

const VERIFICATION_ISSUER = {
  name:'【検証】リンクスシステム株式会社',
  zip_code:'000-0000',
  address:'東京都サンプル区テスト1-2-3',
  registration_number:'T0000000000000',
  tel:'00-0000-0000',
  fax:'00-0000-0001',
  bank_accounts:[
    { bank_name:'検証銀行', branch_name:'本店', deposit_type:'普通', account_number:'0000000', account_name:'リンクスシステム（カ' },
  ],
};

async function createSeedDocument(conn, kind, settlementId, type, entity, total, lines, sequence, amounts = {}) {
  const number=`TEST-${type.toUpperCase()}-2026-${String(sequence).padStart(4,'0')}`;
  const document={
    settlement_type:kind,
    document_type:type,
    document_number:number,
    issued_date:'2026-06-01',
    due_date:'2026-06-30',
    payment_date:'2026-06-30',
    target_year_month:'2026-05',
    total_amount:total,
    company_name:entity.company_name,
    partner_name:entity.partner_name,
    issuer:VERIFICATION_ISSUER,
    recipient:{
      name:entity.company_name || entity.partner_name,
      zip_code:entity.zip_code || '000-0000',
      address:entity.address || '匿名化住所',
      bank_name:entity.bank_name || '',
      branch_name:entity.branch_name || '',
      deposit_type:entity.deposit_type || '',
      account_number:entity.account_number || '',
      account_name:entity.account_name || '',
    },
    transfer_fee_note:'恐れ入りますが、振込手数料は御社でご負担をお願い申し上げます。',
    tax_rate:0.1,
    ...amounts,
  };
  const pdf=await writePdf(document,lines);
  await insert(conn,'settlement_documents',{settlement_type:kind,settlement_id:settlementId,document_type:type,document_year:2026,document_number:number,company_id:entity.company_id||null,partner_id:entity.partner_id||null,file_path:pdf.fileName,snapshot_json:JSON.stringify({seed_key:SEED_KEY,document,lines})});
}

async function createInvoicesAndPayments(conn) {
  const ym = '2026-05';
  const [actors]=await conn.execute(`SELECT user_id FROM users WHERE is_deleted=0 AND is_active=1 ORDER BY CASE WHEN role='admin' THEN 0 ELSE 1 END,user_id LIMIT 1`);
  if(!actors.length)throw new Error('検証用精算の作成に必要な有効ユーザーがいません');
  const actorId=Number(actors[0].user_id);
  const cycles=await ensureVerificationCycles(conn,ym);const cycle=cycles.find(x=>x.cycle_code==='end')||cycles[0];
  const [reports] = await conn.execute(
    `SELECT d.*,COALESCE(bp.template_name,CONCAT('案件 #',d.project_id)) AS project_name
       FROM daily_reports d
       LEFT JOIN projects p ON p.project_id=d.project_id
       LEFT JOIN base_projects bp ON bp.base_project_id=p.base_project_id
      WHERE d.target_year_month = ? AND d.status = 'approved'
        AND d.is_deleted = 0 AND JSON_UNQUOTE(JSON_EXTRACT(d.extra_data, '$.seed_key')) = ?
      ORDER BY d.company_id, d.partner_id, d.work_date`, [ym, SEED_KEY]
  );
  const byCompany = new Map();
  const byPartner = new Map();
  for (const row of reports) {
    if (!byCompany.has(row.company_id)) byCompany.set(row.company_id, []);
    if (!byPartner.has(row.partner_id)) byPartner.set(row.partner_id, []);
    byCompany.get(row.company_id).push(row);
    byPartner.get(row.partner_id).push(row);
  }
  let documentSequence=1;
  for (const [invoiceIndex, [companyId, rows]] of [...byCompany.entries()].slice(0, 2).entries()) {
    const subtotal = rows.reduce((sum, row) => sum + Number(row.calculated_billing_amount || 0), 0);
    const adjustment = companyId % 4 === 0 ? -500 : 0;
    const taxable = subtotal + adjustment; const tax = Math.floor(taxable * 0.1);
    const [companyRows]=await conn.execute('SELECT company_name,zip_code,address FROM companies WHERE company_id=?',[companyId]);
    const displayMode=invoiceIndex===0?'detailed':'project_aggregated';
    await conn.execute(
      `INSERT INTO company_invoice_settings (company_id,display_mode,tax_rate,tax_rounding)
       VALUES (?,?,0.10,'floor') ON DUPLICATE KEY UPDATE display_mode=VALUES(display_mode),tax_rate=VALUES(tax_rate),tax_rounding=VALUES(tax_rounding)`,
      [companyId,displayMode]
    );
    const invoiceId = await insert(conn, 'invoices', {
      company_id: companyId, target_year_month: ym, closing_date: 'end', subtotal_amount: subtotal,
      adjustment_amount: adjustment, taxable_amount: taxable, tax_amount: tax, total_amount: taxable + tax,
      invoice_status: 'finalized', settlement_status:'finalized', approval_status: 'approved', is_confirmed: 1,
      extra_data: JSON.stringify({ seed_key: SEED_KEY }),
    });
    const lines=rows.map(row=>({line_type:'work',source_type:'monthly_approval_snapshot',source_id:row.daily_report_id,project_id:row.project_id,daily_report_id:row.daily_report_id,item_name:`稼働 ${String(row.work_date).slice(0,10)}`,quantity:1,unit_price:Number(row.calculated_billing_amount||0),amount:Number(row.calculated_billing_amount||0),tax_category:'taxable',snapshot_json:JSON.stringify({...row,seed_key:SEED_KEY})}));
    for(const line of lines)await insert(conn,'settlement_lines',{settlement_type:'invoice',settlement_id:invoiceId,...line});
    await insert(conn, 'invoice_details', { invoice_id: invoiceId, price_name: '稼働分（匿名検証用）', unit_price: subtotal, quantity: 1, amount: subtotal, is_adjustment_row: 0 });
    for (const row of rows) {
      await conn.execute('INSERT INTO invoice_daily_reports (invoice_id, daily_report_id) VALUES (?, ?)', [invoiceId, row.daily_report_id]);
      await conn.execute("UPDATE daily_reports SET billing_status = 'billed' WHERE daily_report_id = ?", [row.daily_report_id]);
    }
    await insert(conn,'settlement_workflows',{settlement_type:'invoice',settlement_id:invoiceId,status:'finalized',drafted_by_user_id:actorId,sales_reviewed_by_user_id:actorId,sales_reviewed_at:'2026-06-01',finalized_by_user_id:actorId,finalized_at:'2026-06-01'});
    await insert(conn,'cash_schedules',{cash_cycle_id:cycle.cash_cycle_id,direction:'incoming',source_type:'invoice',source_id:invoiceId,company_id:companyId,counterparty_name:companyRows[0].company_name,title:'請求入金（匿名検証用）',amount:taxable+tax,scheduled_date:cycle.planned_incoming_date,snapshot_json:JSON.stringify({seed_key:SEED_KEY,settlement_type:'invoice',settlement_id:invoiceId})});
    await createSeedDocument(
      conn,'invoice',invoiceId,displayMode==='project_aggregated'?'invoice_summary':'invoice',
      {company_id:companyId,...companyRows[0]},taxable+tax,lines,documentSequence++,
      {subtotal_amount:taxable,tax_amount:tax}
    );
  }
  const paymentGroups = [...byPartner.entries()].slice(0, 2);
  for (const [paymentIndex, [partnerId, rows]] of paymentGroups.entries()) {
    const gross = rows.reduce((sum, row) => sum + Number(row.calculated_payment_amount || 0), 0);
    const [partnerRows]=await conn.execute(
      'SELECT partner_name,zip_code,address,bank_name,branch_name,deposit_type,account_number,account_name FROM partners WHERE partner_id=?',
      [partnerId]
    );
    const [advance]=await conn.execute(`SELECT ar.advance_record_id,ar.advance_amount-COALESCE(SUM(CASE WHEN aa.status='active' THEN aa.amount ELSE 0 END),0) amount FROM advance_records ar LEFT JOIN advance_payment_allocations aa ON aa.advance_record_id=ar.advance_record_id WHERE ar.partner_id=? AND ar.status='executed' GROUP BY ar.advance_record_id,ar.advance_amount ORDER BY ar.advance_record_id LIMIT 1`,[partnerId]);
    const advanceAmount=Math.min(gross,Number(advance[0]?.amount||0));
    const [rules]=await conn.execute(`SELECT * FROM settlement_deduction_rules WHERE scope='common' AND is_active=1 AND valid_from<=? AND (valid_to IS NULL OR valid_to>=?) ORDER BY settlement_deduction_rule_id`,[`${ym}-31`,`${ym}-01`]);
    let remaining=Math.max(0,gross-advanceAmount);const appliedRules=[];
    for(const rule of rules){const amount=Math.min(remaining,Number(rule.amount));appliedRules.push({...rule,applied:amount});remaining-=amount;}
    const finalAmount=Math.max(0,remaining);
    const paymentId = await insert(conn, 'payments', {
      partner_id: partnerId, target_year_month: ym, closing_date: 'end', gross_amount: gross,
      advance_deduction_amount: advanceAmount, transfer_fee_deduction_amount: 0,
      office_fee_amount: appliedRules.find(x=>x.rule_code==='office_fee')?.applied||0, safety_fee_amount: appliedRules.find(x=>x.rule_code==='safety_fee')?.applied||0, other_adjustment_amount: 0,
      final_transfer_amount: finalAmount, payment_output_code: 'type_a', payment_status: 'finalized', settlement_status:'finalized',
      approval_status: 'approved', is_confirmed: 1,
      extra_data: JSON.stringify({ seed_key: SEED_KEY, issue_salary_statement: paymentIndex === 1 }),
    });
    const lines=rows.map(row=>({settlement_type:'payment',settlement_id:paymentId,line_type:'work',source_type:'monthly_approval_snapshot',source_id:row.daily_report_id,project_id:row.project_id,daily_report_id:row.daily_report_id,item_name:`稼働 ${String(row.work_date).slice(0,10)}`,quantity:1,unit_price:Number(row.calculated_payment_amount||0),amount:Number(row.calculated_payment_amount||0),tax_category:'taxable',snapshot_json:JSON.stringify({...row,seed_key:SEED_KEY})}));
    if(advanceAmount>0)lines.push({settlement_type:'payment',settlement_id:paymentId,line_type:'advance',source_type:'advance',source_id:advance[0].advance_record_id,item_name:'前払控除',quantity:1,unit_price:-advanceAmount,amount:-advanceAmount,tax_category:'non_taxable',snapshot_json:JSON.stringify({seed_key:SEED_KEY})});
    for(const rule of appliedRules.filter(x=>x.applied>0))lines.push({settlement_type:'payment',settlement_id:paymentId,line_type:'deduction',source_type:'rule',source_id:rule.settlement_deduction_rule_id,item_name:rule.display_name,quantity:1,unit_price:-rule.applied,amount:-rule.applied,tax_category:rule.tax_category,snapshot_json:JSON.stringify({seed_key:SEED_KEY})});
    for(const line of lines)await insert(conn,'settlement_lines',line);
    if(advanceAmount>0)await insert(conn,'advance_payment_allocations',{advance_record_id:advance[0].advance_record_id,payment_id:paymentId,amount:advanceAmount});
    await insert(conn, 'payment_details', { payment_id: paymentId, detail_type: 'work_item', item_name: '稼働分（匿名検証用）', unit_price: gross, quantity: 1, amount: gross });
    for (const row of rows) {
      await conn.execute('INSERT INTO payment_daily_reports (payment_id, daily_report_id) VALUES (?, ?)', [paymentId, row.daily_report_id]);
      await conn.execute("UPDATE daily_reports SET payment_status = 'paid' WHERE daily_report_id = ?", [row.daily_report_id]);
    }
    await insert(conn,'settlement_workflows',{settlement_type:'payment',settlement_id:paymentId,status:'finalized',drafted_by_user_id:actorId,sales_reviewed_by_user_id:actorId,sales_reviewed_at:'2026-06-01',finalized_by_user_id:actorId,finalized_at:'2026-06-01'});
    if(finalAmount>0)await insert(conn,'cash_schedules',{cash_cycle_id:cycle.cash_cycle_id,direction:'outgoing',source_type:'payment',source_id:paymentId,partner_id:partnerId,counterparty_name:partnerRows[0].partner_name,title:'通常支払（匿名検証用）',amount:finalAmount,scheduled_date:cycle.planned_outgoing_date,snapshot_json:JSON.stringify({seed_key:SEED_KEY,settlement_type:'payment',settlement_id:paymentId})});
    await createSeedDocument(conn,'payment',paymentId,'payment_statement',{partner_id:partnerId,...partnerRows[0]},finalAmount,lines,documentSequence++,{gross_amount:gross});
    if(paymentIndex===1)await createSeedDocument(conn,'payment',paymentId,'salary_statement',{partner_id:partnerId,...partnerRows[0]},finalAmount,lines,documentSequence++,{gross_amount:gross});
  }
}

async function repairSpecialAugust() {
  const pool = getPool();
  const conn = await pool.getConnection();
  try {
    await assertSchema(conn);
    const [projects] = await conn.execute(
      `SELECT project_id, company_id, partner_id, vehicle_id,
              JSON_UNQUOTE(JSON_EXTRACT(extra_data, '$.scenario')) AS scenario
       FROM projects
       WHERE JSON_UNQUOTE(JSON_EXTRACT(extra_data, '$.seed_key')) = ?
         AND JSON_UNQUOTE(JSON_EXTRACT(extra_data, '$.scenario')) IN ('special-9', 'special-10')
         AND is_deleted = 0`, [SEED_KEY]
    );
    await conn.beginTransaction();
    for (const row of projects) {
      const index = Number(String(row.scenario).replace('special-', '')) + SPECIAL_PROJECT_START - 1;
      const date = index === 48 ? '2026-08-03' : '2026-08-04';
      const [exists] = await conn.execute(
        `SELECT daily_report_id FROM daily_reports WHERE project_id = ? AND work_date = ? AND is_deleted = 0 LIMIT 1`,
        [row.project_id, date]
      );
      if (exists.length) continue;
      const data = await applyDailyPriceCalc(reportInput({
        index, projectId: row.project_id, companyId: row.company_id, partnerId: row.partner_id, vehicleId: row.vehicle_id,
      }, date, 5));
      const reportId = await insert(conn, 'daily_reports', {
        project_id: data.project_id, company_id: data.company_id, partner_id: data.partner_id, vehicle_id: data.vehicle_id,
        target_year_month: data.target_year_month, work_date: data.work_date, start_time: data.start_time, end_time: data.end_time,
        break_time: data.break_time, break_minutes: data.break_minutes, is_training: data.is_training || 0,
        total_distance: data.total_distance, selected_fee_item_id: data.selected_fee_item_id, selected_fee_item_name: data.selected_fee_item_name,
        fee_item_selection_source: data.fee_item_selection_source || 'auto', applied_price_set_id: data.applied_price_set_id,
        calculated_billing_amount: data.calculated_billing_amount, calculated_payment_amount: data.calculated_payment_amount,
        calculation_detail: data.calculation_detail, status: 'confirmed', extra_data: JSON.stringify({ seed_key: SEED_KEY }),
      });
      await insert(conn, 'daily_report_confirmation_snapshots', {
        daily_report_id: reportId, confirmation_version: 1, snapshot_data: JSON.stringify({ seed_key: SEED_KEY, source: 'verification-seed-repair' }),
      });
    }
    await conn.commit();
    console.log(JSON.stringify(await verificationSummary(conn), null, 2));
  } catch (error) {
    await conn.rollback();
    throw error;
  } finally {
    conn.release();
    await pool.end();
  }
}

async function resetBusinessData() {
  if (process.env.NODE_ENV === 'production') {
    throw new Error('本番モードでは検証データのリセットを実行できません。NODE_ENVをdevelopmentまたはtestにしてください。');
  }
  if (process.env.VERIFICATION_RESET_CONFIRM !== 'DELETE_VERIFICATION_DATA') {
    throw new Error('VERIFICATION_RESET_CONFIRM=DELETE_VERIFICATION_DATA の明示指定が必要です。');
  }
  const pool = getPool();
  const conn = await pool.getConnection();
  try {
    await assertSchema(conn);
    const ids = async (table, column='extra_data') => {
      const [rows] = await conn.query(`SELECT * FROM ${table} WHERE JSON_UNQUOTE(JSON_EXTRACT(${column}, '$.seed_key')) = ?`, [SEED_KEY]);
      return rows;
    };
    const companies=await ids('companies'); const partners=await ids('partners');
    const projects=await ids('projects'); const bases=await ids('base_projects');
    const priceSets=await ids('price_sets');
    const invoices=await ids('invoices'); const payments=await ids('payments');
    const companyIds=companies.map(x=>x.company_id),partnerIds=partners.map(x=>x.partner_id),projectIds=projects.map(x=>x.project_id),baseIds=bases.map(x=>x.base_project_id),priceSetIds=priceSets.map(x=>x.price_set_id);
    let invoiceIds=invoices.map(x=>x.invoice_id),paymentIds=payments.map(x=>x.payment_id);
    const marks=(values)=>values.map(()=>'?').join(',');
    const [reports]=projectIds.length?await conn.query(`SELECT * FROM daily_reports WHERE project_id IN (${marks(projectIds)})`,projectIds):[[]];
    const reportIds=reports.map(x=>x.daily_report_id);
    if(reportIds.length){
      const [linkedInvoices]=await conn.query(`SELECT DISTINCT invoice_id FROM invoice_daily_reports WHERE daily_report_id IN (${marks(reportIds)})`,reportIds);
      const [linkedPayments]=await conn.query(`SELECT DISTINCT payment_id FROM payment_daily_reports WHERE daily_report_id IN (${marks(reportIds)})`,reportIds);
      invoiceIds=[...new Set([...invoiceIds,...linkedInvoices.map(x=>x.invoice_id)])];
      paymentIds=[...new Set([...paymentIds,...linkedPayments.map(x=>x.payment_id)])];
    }
    const [advanceRecords]=projectIds.length?await conn.query(`SELECT advance_record_id FROM advance_records WHERE project_id IN (${marks(projectIds)})`,projectIds):[[]];
    const advanceRecordIds=advanceRecords.map(x=>x.advance_record_id);
    const removeWhere=async(table,column,values)=>{if(values.length)await conn.query(`DELETE FROM ${table} WHERE ${column} IN (${marks(values)})`,values);};
    await conn.beginTransaction();
    let documentFiles=[];
    if(invoiceIds.length||paymentIds.length){
      const conditions=[];const params=[];
      if(invoiceIds.length){conditions.push(`(settlement_type='invoice' AND settlement_id IN (${marks(invoiceIds)}))`);params.push(...invoiceIds);}
      if(paymentIds.length){conditions.push(`(settlement_type='payment' AND settlement_id IN (${marks(paymentIds)}))`);params.push(...paymentIds);}
      const [documents]=await conn.query(`SELECT file_path FROM settlement_documents WHERE ${conditions.join(' OR ')}`,params);
      documentFiles=documents.map(x=>x.file_path).filter(Boolean);
      await conn.query(`DELETE FROM settlement_documents WHERE ${conditions.join(' OR ')}`,params);
      await conn.query(`DELETE FROM settlement_workflows WHERE ${conditions.join(' OR ')}`,params);
      await conn.query(`DELETE FROM settlement_lines WHERE ${conditions.join(' OR ')}`,params);
    }
    await removeWhere('settlement_carry_forward_allocations','payment_id',paymentIds);
    await removeWhere('advance_payment_allocations','payment_id',paymentIds);
    await removeWhere('advance_payment_allocations','advance_record_id',advanceRecordIds);
    await removeWhere('settlement_carry_forwards','source_payment_id',paymentIds);
    await removeWhere('payment_daily_reports','payment_id',paymentIds);
    await removeWhere('invoice_daily_reports','invoice_id',invoiceIds);
    await removeWhere('payment_details','payment_id',paymentIds);
    await removeWhere('invoice_details','invoice_id',invoiceIds);
    const scheduleConditions=[];const scheduleParams=[];
    if(projectIds.length){scheduleConditions.push(`project_id IN (${marks(projectIds)})`);scheduleParams.push(...projectIds);}
    if(invoiceIds.length){scheduleConditions.push(`source_type='invoice' AND source_id IN (${marks(invoiceIds)})`);scheduleParams.push(...invoiceIds);}
    if(paymentIds.length){scheduleConditions.push(`source_type IN ('payment','adjustment') AND source_id IN (${marks(paymentIds)})`);scheduleParams.push(...paymentIds);}
    const [seedSchedules]=scheduleConditions.length?await conn.query(`SELECT cash_schedule_id FROM cash_schedules WHERE ${scheduleConditions.map(x=>`(${x})`).join(' OR ')}`,scheduleParams):[[]];
    const scheduleIds=seedSchedules.map(x=>x.cash_schedule_id);
    if(scheduleIds.length){
      const [batchIds]=await conn.query(`SELECT DISTINCT cash_export_batch_id FROM cash_export_batch_items WHERE cash_schedule_id IN (${marks(scheduleIds)})`,scheduleIds);
      await removeWhere('cash_export_batch_items','cash_schedule_id',scheduleIds);
      await removeWhere('cash_transactions','cash_schedule_id',scheduleIds);
      await removeWhere('cash_schedules','cash_schedule_id',scheduleIds);
      for(const batch of batchIds)await conn.query('DELETE FROM cash_export_batches WHERE cash_export_batch_id=? AND NOT EXISTS (SELECT 1 FROM cash_export_batch_items WHERE cash_export_batch_id=?)',[batch.cash_export_batch_id,batch.cash_export_batch_id]);
    }
    await removeWhere('advance_records','project_id',projectIds);
    await removeWhere('project_advance_terms','project_id',projectIds);
    await removeWhere('payments','payment_id',paymentIds);
    await removeWhere('invoices','invoice_id',invoiceIds);
    await removeWhere('advance_payments','project_id',projectIds);
    await removeWhere('daily_report_confirmation_snapshots','daily_report_id',reportIds);
    await removeWhere('daily_report_audit_logs','daily_report_id',reportIds);
    await removeWhere('daily_report_monthly_approvals','project_id',projectIds);
    await removeWhere('daily_reports','daily_report_id',reportIds);
    await removeWhere('price_set_lines','price_set_id',priceSetIds);
    await removeWhere('price_sets','price_set_id',priceSetIds);
    await removeWhere('project_revisions','project_id',projectIds);
    await removeWhere('project_settlement_reviewers','project_id',projectIds);
    await removeWhere('project_invoice_settings','project_id',projectIds);
    await removeWhere('partner_vehicles','partner_id',partnerIds);
    await removeWhere('company_vehicles','company_id',companyIds);
    await removeWhere('company_billings','company_id',companyIds);
    await removeWhere('company_manager_periods','company_id',companyIds);
    await removeWhere('company_invoice_settings','company_id',companyIds);
    await removeWhere('invoice_exclusions','company_id',companyIds);
    await removeWhere('settlement_deduction_rules','partner_id',partnerIds);
    await removeWhere('projects','project_id',projectIds);
    await removeWhere('base_projects','base_project_id',baseIds);
    await removeWhere('holidays','extra_data',[]);
    await conn.query(`DELETE FROM holidays WHERE JSON_UNQUOTE(JSON_EXTRACT(extra_data,'$.seed_key'))=?`,[SEED_KEY]);
    await removeWhere('partners','partner_id',partnerIds);
    await removeWhere('companies','company_id',companyIds);
    await conn.commit();
    for(const file of documentFiles){try{await fs.unlink(path.join(PDF_DIR,file));}catch(_err){/* DBを正とし、存在しないファイルは無視 */}}
    console.log('[verification-seed] 匿名検証データだけを削除しました');
  } catch (error) {
    await conn.rollback();
    throw error;
  } finally {
    conn.release();
  }
}

async function seed() {
  const pool = getPool();
  const conn = await pool.getConnection();
  try {
    await assertSchema(conn);
    const [existing] = await conn.execute(`SELECT COUNT(*) AS count FROM companies WHERE company_name LIKE ? AND is_deleted = 0`, [`${PREFIX}%`]);
    if (Number(existing[0].count) > 0) throw new Error(`「${PREFIX}」データは既に存在します。重複投入は行いません。`);
    await conn.beginTransaction();
    const companies = []; const partners = []; const baseProjects = []; const projects = [];
    for (let index = 0; index < 20; index += 1) {
      const no = String(index + 1).padStart(2, '0');
      const companyName = `${PREFIX}${COMPANY_NAMES[index]}`;
      const companyId = await insert(conn, 'companies', {
        office_no: `TEST-${no}`, office_name: `首都圏営業所${no}`, company_name: companyName,
        company_name_kana: `ケンショウ${no}`, closing_date_code: ['5', '10', '15', '20', '25', 'end'][index % 6],
        payment_date_code: 'end', invoice_send_method: index % 2 ? 'email' : 'post', deposit_type: 'ordinary',
        extra_data: JSON.stringify({ seed_key: SEED_KEY }),
      });
      companies.push({ id: companyId, name: companyName });
      await insert(conn, 'company_billings', { company_id: companyId, billing_print_name: companyName, billing_summary_no: `TEST-BILL-${no}`, extra_data: JSON.stringify({ seed_key: SEED_KEY }) });
    }
    for (let index = 0; index < 30; index += 1) {
      const no = String(index + 1).padStart(2, '0');
      const partnerId = await insert(conn, 'partners', {
        partner_name: `${PARTNER_NAMES[index]}（検証）`, partner_name_kana: `ケンショウパートナー${no}`,
        partner_category_code: index % 3 === 0 ? 'individual' : 'sole_proprietor', employment_type_code: 'outsourcing',
        advance_payment_enabled: index < 5 ? 1 : 0, payment_output_code: 'type_a', deposit_type: 'ordinary',
        extra_data: JSON.stringify({ seed_key: SEED_KEY }),
      });
      partners.push(partnerId);
      await insert(conn, 'partner_vehicles', { partner_id: partnerId, vehicle_name: `営業車両${no}`, vehicle_number: `検証-${String(index + 1).padStart(3, '0')}`, extra_data: JSON.stringify({ seed_key: SEED_KEY }) });
    }
    for (let index = 0; index < 30; index += 1) {
      const company = companies[index % companies.length]; const partnerId = partners[index];
      const baseName = BASE_PROJECT_NAMES[index];
      const baseProjectId = await insert(conn, 'base_projects', {
        company_id: company.id, partner_id: partnerId, template_name: baseName,
        default_manager: '業務管理部', business_type: shortProjectName(baseName), basic_work_hours: 8,
        work_time_type: 'actual', payment_type: 'normal', operation_start_date: '2026-01-01', closing_date: ['5', '10', '15', '20', '25', 'end'][index % 6],
        execution_time_start: '08:00', execution_time_end: '17:00', binding_time: 9, break_time: 1,
        overtime_calc_type: 'after_basic', daily_count_type: 'actual', work_mode_code: 'regular', rounding_timing_type: 'daily',
        overtime_accumulation_type: 'daily', distance_calc_mode: 'per_km', distance_calc_amount: 80,
        extra_data: JSON.stringify({ seed_key: SEED_KEY }),
      });
      baseProjects.push(baseProjectId);
      const extra = priceExtra(index, company.name, baseName);
      const setId = await insert(conn, 'price_sets', { price_set_no: `TEST-B-${String(index + 1).padStart(3, '0')}`, price_set_name: priceName('平日料金', company.name, baseName), company_id: company.id, base_project_id: baseProjectId, apply_start_date: '2026-01-01', extra_data: JSON.stringify(extra) });
      await insert(conn, 'price_set_lines', { price_set_id: setId, weekday_code: 'weekday', calc_type_code: 'daily', price_type_code: 'basic', billing_unit_price: 20000, payment_unit_price: 15500, sort_order: 10 });
    }
    for (let index = 0; index < 50; index += 1) {
      const baseIndex = index < 30 ? index : index - 30;
      const company = companies[baseIndex % companies.length]; const partnerId = partners[index % partners.length];
      const baseName = BASE_PROJECT_NAMES[baseIndex]; const variant = PROJECT_VARIANTS[Math.floor(index / 10) % PROJECT_VARIANTS.length];
      const [vehicleRows] = await conn.execute('SELECT vehicle_id FROM partner_vehicles WHERE partner_id = ? AND is_deleted = 0 LIMIT 1', [partnerId]);
      const projectId = await insert(conn, 'projects', {
        base_project_id: baseProjects[baseIndex], company_id: company.id, partner_id: partnerId, vehicle_id: vehicleRows[0].vehicle_id,
        manager_name: `${variant}担当`, business_type: `${shortProjectName(baseName)}｜${variant}`,
        payment_type: 'normal', installment_amount: index < 5 ? 7000 : null, operation_start_date: index >= 45 ? '2026-06-01' : '2026-01-01',
        closing_date: ['5', '10', '15', '20', '25', 'end'][index % 6], execution_time_start: '08:00', execution_time_end: '17:00', binding_time: 9, break_time: 1,
        overtime_calc_type: 'after_basic', daily_count_type: 'actual', work_mode_code: 'regular', rounding_timing_type: 'daily', overtime_accumulation_type: 'daily',
        distance_calc_mode: 'per_km', distance_calc_amount: 80, distance_table_json: JSON.stringify([{ from: 0, to: 100, unit_price: 80 }]),
        extra_data: JSON.stringify({ seed_key: SEED_KEY, scenario: index >= SPECIAL_PROJECT_START ? `special-${index - SPECIAL_PROJECT_START + 1}` : 'standard' }),
      });
      const setId = await insert(conn, 'price_sets', { price_set_no: `TEST-P-${String(index + 1).padStart(3, '0')}`, price_set_name: priceName('平日料金', company.name, baseName), company_id: company.id, project_id: projectId, apply_start_date: '2026-01-01', extra_data: JSON.stringify(priceExtra(index, company.name, baseName)) });
      await insert(conn, 'price_set_lines', { price_set_id: setId, weekday_code: 'weekday', calc_type_code: 'daily', price_type_code: 'basic', billing_unit_price: 20000, payment_unit_price: 15500, sort_order: 10 });
      projects.push({ index, projectId, companyId: company.id, partnerId, vehicleId: vehicleRows[0].vehicle_id, baseName, variant });
    }
    for (const holiday of ['2026-01-01', '2026-02-11', '2026-03-20', '2026-04-29', '2026-05-06', '2026-07-20', '2026-08-11']) {
      await insert(conn, 'holidays', { holiday_date: holiday, holiday_name: `${PREFIX} 共通休日`, is_active: 1, extra_data: JSON.stringify({ seed_key: SEED_KEY }) });
    }
    // applyDailyPriceCalc は別接続で PriceSet を読むため、料金・休日を先に確定する。
    await conn.commit();
    await conn.beginTransaction();
    for (const project of projects) {
      let position = 0;
      for (const ym of MONTHS) {
        for (const date of reportDates(project.index, ym)) {
          const data = await applyDailyPriceCalc(reportInput(project, date, position));
          const status = ym <= '2026-05' && project.index < 35 ? 'approved' : (position % 4 === 0 ? 'draft' : 'confirmed');
          const reportId = await insert(conn, 'daily_reports', {
            project_id: data.project_id, company_id: data.company_id, partner_id: data.partner_id, vehicle_id: data.vehicle_id,
            target_year_month: data.target_year_month, work_date: data.work_date, start_time: data.start_time, end_time: data.end_time,
            break_time: data.break_time, break_minutes: data.break_minutes, is_absent: 0, is_training: data.is_training || 0,
            start_meter: data.start_meter, end_meter: data.end_meter, total_distance: data.total_distance, toll_fee: data.toll_fee, parking_fee: data.parking_fee, transport_fee: data.transport_fee,
            row_comment: data.row_comment, input_source_type: data.input_source_type, selected_fee_item_id: data.selected_fee_item_id, selected_fee_item_name: data.selected_fee_item_name,
            fee_item_selection_source: data.fee_item_selection_source || 'auto', rate_overrides: data.rate_overrides ? JSON.stringify(data.rate_overrides) : null, rate_override_reason: data.rate_override_reason || null,
            applied_price_set_id: data.applied_price_set_id, binding_hours: data.binding_hours, work_hours: data.work_hours, overtime_hours: data.overtime_hours, shortage_hours: data.shortage_hours,
            shortage_minutes_billing: data.shortage_minutes_billing || 0, shortage_minutes_payment: data.shortage_minutes_payment || 0, shortage_amount_billing: data.shortage_amount_billing || 0, shortage_amount_payment: data.shortage_amount_payment || 0,
            night_hours: data.night_hours, night_break_minutes_billing: data.night_break_minutes_billing || 0, night_break_minutes_payment: data.night_break_minutes_payment || 0,
            night_minutes_billing: data.night_minutes_billing, night_minutes_payment: data.night_minutes_payment, night_overtime_minutes_billing: data.night_overtime_minutes_billing,
            night_overtime_minutes_payment: data.night_overtime_minutes_payment, regular_overtime_minutes_billing: data.regular_overtime_minutes_billing, regular_overtime_minutes_payment: data.regular_overtime_minutes_payment,
            calculated_billing_amount: data.calculated_billing_amount, calculated_payment_amount: data.calculated_payment_amount, calculation_detail: data.calculation_detail,
            status, extra_data: JSON.stringify({ seed_key: SEED_KEY }),
          });
          if (status === 'confirmed') await insert(conn, 'daily_report_confirmation_snapshots', { daily_report_id: reportId, confirmation_version: 1, snapshot_data: JSON.stringify({ seed_key: SEED_KEY, source: 'verification-seed' }) });
          position += 1;
        }
      }
    }
    const advanceCycles=await ensureVerificationCycles(conn,'2026-05');
    const advanceCycle=advanceCycles.find(x=>x.cycle_code==='20')||advanceCycles[0];
    for (const project of projects.slice(0, 5)) {
      const termId=await insert(conn,'project_advance_terms',{project_id:project.projectId,valid_from:'2026-01-01',is_enabled:1,unit_price:7000});
      const [days]=await conn.execute(`SELECT COUNT(DISTINCT work_date) count FROM daily_reports WHERE project_id=? AND target_year_month='2026-05' AND status='approved' AND is_deleted=0`,[project.projectId]);
      const workDays=Number(days[0].count);if(!workDays)continue;
      const amount=workDays*7000;
      const scheduleId=await insert(conn,'cash_schedules',{cash_cycle_id:advanceCycle.cash_cycle_id,direction:'outgoing',source_type:'advance',company_id:project.companyId,partner_id:project.partnerId,project_id:project.projectId,counterparty_name:`${PREFIX}パートナー`,title:'前払（匿名検証用）',amount,scheduled_date:advanceCycle.planned_outgoing_date,status:'executed',snapshot_json:JSON.stringify({seed_key:SEED_KEY})});
      const recordId=await insert(conn,'advance_records',{project_id:project.projectId,partner_id:project.partnerId,company_id:project.companyId,project_advance_term_id:termId,period_start:'2026-05-01',period_end:'2026-05-31',work_days:workDays,calculated_amount:amount,advance_amount:amount,status:'executed',cash_schedule_id:scheduleId});
      await conn.execute(`UPDATE cash_schedules SET source_id=?,snapshot_json=? WHERE cash_schedule_id=?`,[recordId,JSON.stringify({seed_key:SEED_KEY,advance_record_id:recordId}),scheduleId]);
      await insert(conn,'cash_transactions',{cash_schedule_id:scheduleId,executed_date:advanceCycle.planned_outgoing_date,executed_amount:amount,status:'executed',bank_name:'検証銀行'});
    }
    const [approvedGroups]=await conn.execute(`SELECT project_id,target_year_month FROM daily_reports WHERE status='approved' AND JSON_UNQUOTE(JSON_EXTRACT(extra_data,'$.seed_key'))=? GROUP BY project_id,target_year_month`,[SEED_KEY]);
    for(const group of approvedGroups){
      const [approvedReports]=await conn.execute(`SELECT * FROM daily_reports WHERE project_id=? AND target_year_month=? AND status='approved' AND is_deleted=0 ORDER BY work_date,daily_report_id`,[group.project_id,group.target_year_month]);
      await insert(conn,'daily_report_monthly_approvals',{project_id:group.project_id,target_year_month:group.target_year_month,approval_version:1,status:'approved',snapshot_data:JSON.stringify({seed_key:SEED_KEY,project_id:group.project_id,target_year_month:group.target_year_month,reports:approvedReports}),note:'匿名検証用月次承認'});
    }
    await createInvoicesAndPayments(conn);
    await conn.commit();
    console.log(JSON.stringify(await verificationSummary(conn), null, 2));
  } catch (error) {
    await conn.rollback();
    throw error;
  } finally {
    conn.release();
    await pool.end();
  }
}

async function main() {
  if (process.argv.includes('--reset')) {
    await resetBusinessData();
    await seed();
    return;
  }
  if (process.argv.includes('--repair-special-august')) {
    await repairSpecialAugust();
    return;
  }
  if (process.argv.includes('--verify')) {
    const pool = getPool();
    const conn = await pool.getConnection();
    try { await assertSchema(conn); console.log(JSON.stringify(await verificationSummary(conn), null, 2)); }
    finally { conn.release(); await pool.end(); }
    return;
  }
  await seed();
}

main().catch((error) => { console.error('[verification-seed] failed:', error.message); process.exit(1); });
