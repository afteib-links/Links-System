/*
 * ローカル/NAS テスト用の匿名検証データ。
 * 実行: npm run seed:verification
 * 確認: npm run verify:verification-data
 */
const { getPool } = require('../src/db');
const { applyDailyPriceCalc } = require('../src/services/price_calc');

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
  const [advanceRows] = await conn.execute(`SELECT COUNT(*) AS count FROM advance_payments WHERE ${seedWhere}`, [SEED_KEY]);
  const [baseRows] = await conn.execute(`SELECT COUNT(*) AS count FROM base_projects WHERE ${seedWhere}`, [SEED_KEY]);
  const [priceSetRows] = await conn.execute(`SELECT COUNT(*) AS count FROM price_sets WHERE JSON_UNQUOTE(JSON_EXTRACT(extra_data, '$.seed_key')) = ? AND is_deleted = 0`, [SEED_KEY]);
  const [invoiceRows] = await conn.execute(`SELECT COUNT(*) AS count FROM invoices WHERE ${seedWhere}`, [SEED_KEY]);
  const [paymentRows] = await conn.execute(`SELECT COUNT(*) AS count FROM payments WHERE ${seedWhere}`, [SEED_KEY]);
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
  result.advance_payments = Number(advanceRows[0].count);
  result.invoices = Number(invoiceRows[0].count);
  result.payments = Number(paymentRows[0].count);
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

async function createInvoicesAndPayments(conn) {
  const ym = '2026-05';
  const [reports] = await conn.execute(
    `SELECT * FROM daily_reports WHERE target_year_month = ? AND status = 'approved'
       AND is_deleted = 0 AND JSON_UNQUOTE(JSON_EXTRACT(extra_data, '$.seed_key')) = ? ORDER BY company_id, partner_id, work_date`, [ym, SEED_KEY]
  );
  const byCompany = new Map();
  const byPartner = new Map();
  for (const row of reports) {
    if (!byCompany.has(row.company_id)) byCompany.set(row.company_id, []);
    if (!byPartner.has(row.partner_id)) byPartner.set(row.partner_id, []);
    byCompany.get(row.company_id).push(row);
    byPartner.get(row.partner_id).push(row);
  }
  for (const [companyId, rows] of [...byCompany.entries()].slice(0, 12)) {
    const subtotal = rows.reduce((sum, row) => sum + Number(row.calculated_billing_amount || 0), 0);
    const adjustment = companyId % 4 === 0 ? -500 : 0;
    const taxable = subtotal + adjustment; const tax = Math.floor(taxable * 0.1);
    const invoiceId = await insert(conn, 'invoices', {
      company_id: companyId, target_year_month: ym, closing_date: 'end', subtotal_amount: subtotal,
      adjustment_amount: adjustment, taxable_amount: taxable, tax_amount: tax, total_amount: taxable + tax,
      invoice_status: 'issued', approval_status: 'approved', is_confirmed: 1,
      extra_data: JSON.stringify({ seed_key: SEED_KEY }),
    });
    await insert(conn, 'invoice_details', { invoice_id: invoiceId, price_name: '稼働分（匿名検証用）', unit_price: subtotal, quantity: 1, amount: subtotal, is_adjustment_row: 0 });
    for (const row of rows) {
      await conn.execute('INSERT INTO invoice_daily_reports (invoice_id, daily_report_id) VALUES (?, ?)', [invoiceId, row.daily_report_id]);
      await conn.execute("UPDATE daily_reports SET billing_status = 'billed' WHERE daily_report_id = ?", [row.daily_report_id]);
    }
  }
  for (const [partnerId, rows] of [...byPartner.entries()].slice(0, 12)) {
    const gross = rows.reduce((sum, row) => sum + Number(row.calculated_payment_amount || 0), 0);
    const [advance] = await conn.execute(
      `SELECT COALESCE(SUM(total_amount), 0) AS amount, COALESCE(SUM(applied_transfer_fee), 0) AS fee
       FROM advance_payments WHERE partner_id = ? AND target_year_month = ? AND is_target = 1 AND is_deleted = 0`, [partnerId, ym]
    );
    const advanceAmount = Number(advance[0].amount); const transferFee = Number(advance[0].fee);
    const other = partnerId % 5 === 0 ? 300 : 0;
    const finalAmount = gross - advanceAmount - transferFee - 1100 - 8800 + other;
    const paymentId = await insert(conn, 'payments', {
      partner_id: partnerId, target_year_month: ym, closing_date: 'end', gross_amount: gross,
      advance_deduction_amount: advanceAmount, transfer_fee_deduction_amount: transferFee,
      office_fee_amount: 1100, safety_fee_amount: 8800, other_adjustment_amount: other,
      final_transfer_amount: finalAmount, payment_output_code: 'type_a', payment_status: 'issued',
      approval_status: 'approved', is_confirmed: 1, extra_data: JSON.stringify({ seed_key: SEED_KEY }),
    });
    await insert(conn, 'payment_details', { payment_id: paymentId, detail_type: 'work_item', item_name: '稼働分（匿名検証用）', unit_price: gross, quantity: 1, amount: gross });
    for (const row of rows) {
      await conn.execute('INSERT INTO payment_daily_reports (payment_id, daily_report_id) VALUES (?, ?)', [paymentId, row.daily_report_id]);
      await conn.execute("UPDATE daily_reports SET payment_status = 'paid' WHERE daily_report_id = ?", [row.daily_report_id]);
    }
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

const BUSINESS_TABLES_TO_RESET = [
  'payment_daily_reports', 'invoice_daily_reports', 'payment_details', 'invoice_details',
  'payments', 'invoices', 'advance_payments', 'daily_report_confirmation_snapshots',
  'daily_report_audit_logs', 'daily_report_monthly_approvals', 'daily_reports', 'holidays',
  'price_set_lines', 'price_sets', 'project_revisions', 'projects', 'base_projects',
  'partner_vehicles', 'company_vehicles', 'company_billings', 'company_manager_periods',
  'invoice_exclusions', 'partners', 'companies',
];

async function resetBusinessData() {
  const pool = getPool();
  const conn = await pool.getConnection();
  try {
    await assertSchema(conn);
    const before = {};
    for (const table of BUSINESS_TABLES_TO_RESET) {
      const [rows] = await conn.query(`SELECT COUNT(*) AS count FROM ${table}`);
      before[table] = Number(rows[0].count);
    }
    await conn.beginTransaction();
    for (const table of BUSINESS_TABLES_TO_RESET) await conn.query(`DELETE FROM ${table}`);
    await conn.commit();
    console.log('[verification-seed] 業務データを削除しました:', JSON.stringify(before));
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
    for (const project of projects.slice(0, 5)) {
      for (const ym of MONTHS) {
        for (const cycle of [1, 2, 3]) {
          const [days] = await conn.execute(`SELECT COUNT(DISTINCT work_date) AS count FROM daily_reports WHERE project_id = ? AND target_year_month = ? AND is_deleted = 0`, [project.projectId, ym]);
          const workDays = Number(days[0].count);
          const target = cycle === 1;
          await insert(conn, 'advance_payments', { project_id: project.projectId, partner_id: project.partnerId, company_id: project.companyId, target_year_month: ym, cycle_number: cycle, record_type: 'cycle', title: `${PREFIX} 前払${cycle}回`, is_target: target ? 1 : 0, unit_price: 7000, is_price_overridden: 0, work_days: workDays, total_amount: target ? workDays * 7000 : 0, applied_transfer_fee: target ? 220 : 0, extra_data: JSON.stringify({ seed_key: SEED_KEY }) });
        }
      }
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
