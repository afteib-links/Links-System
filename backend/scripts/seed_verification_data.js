/*
 * ローカル/NAS テスト用の匿名検証データ（@_接頭辞）。
 * 実行: npm run seed:verification
 * 確認: npm run verify:verification-data
 * 期間: 2025-11〜2026-09 / 2026-09は検証マトリクス月
 */
const { getPool } = require('../src/db');
const { applyDailyPriceCalc } = require('../src/services/price_calc');
const fs = require('fs/promises');
const path = require('path');
if (!process.env.PDF_DIR) {
  process.env.PDF_DIR = path.join(__dirname, '../../data/pdf');
}
const { PDF_DIR, writePdf } = require('../src/services/settlement_pdf');

const PREFIX = '@_';
const SEED_KEY = 'verification-data-2025-11-2026-09';
const LEGACY_SEED_KEYS = ['verification-data-2026-v2'];
const COMPANY_COUNT = 100;
const PARTNER_COUNT = 150;
const BASE_COUNT = 130;
const PROJECT_COUNT = 150;
const MATRIX_MONTH = '2026-09';
const OPS_SETTLE_MONTHS = ['2026-02', '2026-05', '2026-08'];
const MONTHS = (() => {
  const list = [];
  let y = 2025;
  let m = 11;
  while (y < 2026 || (y === 2026 && m <= 9)) {
    list.push(`${y}-${String(m).padStart(2, '0')}`);
    m += 1;
    if (m > 12) { m = 1; y += 1; }
  }
  return list;
})();
const CLOSING_CODES = ['5', '10', '15', '20', '25', 'end'];

const COMPANY_STEMS = [
  '東都ロジスティクス', 'みなと流通サービス', '青葉食品配送', '中央建材輸送', '北辰ネットワーク便',
  '関東メディカル配送', '京浜倉庫サービス', '西東京共同配送', '彩都通販物流', '湾岸コンテナ輸送',
  '東関東青果流通', '多摩機工運輸', '城南店舗配送', '湘南冷蔵物流', '首都圏ホームセンター便',
  '武蔵野印刷資材配送', '東京医療資材輸送', '千葉県央共同便', '埼玉量販店配送', '横浜港湾サポート',
  '常磐幹線物流', '茨城農産輸送', '群馬部品配送', '栃木建材共配', '山梨精密機器便',
  '長野高原物流', '新潟米穀輸送', '静岡柑橘配送', '愛知部品共配', '岐阜木材輸送',
];
const COMPANY_SUFFIXES = ['株式会社', '有限会社', '合同会社'];

const SURNAMES = [
  '山田', '佐藤', '鈴木', '高橋', '田中', '伊藤', '渡辺', '山本', '中村', '小林',
  '加藤', '吉田', '山口', '松本', '井上', '木村', '林', '清水', '斎藤', '阿部',
  '森', '池田', '橋本', '山下', '石川', '中島', '前田', '藤田', '後藤', '岡田',
  '長谷川', '村上', '近藤', '石井', '斎', '坂本', '遠藤', '青木', '藤原', '福田',
];
const GIVEN_NAMES = [
  '恒一', '拓也', '翔太', '健太', '直樹', '雅人', '和也', '優太', '亮介', '大輔',
  '雄一', '智也', '修平', '裕介', '誠', '達也', '浩二', '圭一', '拓真', '隆',
  '隼人', '悠人', '章', '孝之', '俊介', '明', '祐樹', '英樹', '淳', '大樹',
  '健', '剛', '学', '浩', '誠一', '哲也', '直人', '康平', '慎一', '陽介',
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
  '高速道路施設の日常巡視及び記録補助業務',
  '公共施設の清掃及び日常管理補助業務',
  '工場内部品仕分け及び出荷準備業務',
  '建設現場における安全管理補助業務',
  '電気設備点検の記録補助及び付帯業務',
  '水道施設の点検補助及び試料運搬業務',
  '廃棄物収集運搬の補助業務',
  'レンタル機材の配送及び回収業務',
  '通販商品の仕分け及び梱包業務',
  '冷蔵倉庫内の入出庫管理補助業務',
];
const PROJECT_VARIANTS = ['第1便', '第2便', '早朝便', '日中便', '夜間便', '土曜便', 'ルートA', 'ルートB'];

/** 2026-09 検証マトリクス用プロジェクト index（110〜149） */
const MATRIX_START = 110;

function companyName(index) {
  const stem = COMPANY_STEMS[index % COMPANY_STEMS.length];
  const suffix = COMPANY_SUFFIXES[index % COMPANY_SUFFIXES.length];
  const series = Math.floor(index / COMPANY_STEMS.length) + 1;
  return `${PREFIX}${stem}${series > 1 ? String(series) : ''}${suffix}`;
}

function partnerName(index) {
  return `${PREFIX}${SURNAMES[index % SURNAMES.length]} ${GIVEN_NAMES[index % GIVEN_NAMES.length]}`;
}

function baseProjectName(index) {
  const base = BASE_PROJECT_NAMES[index % BASE_PROJECT_NAMES.length];
  const series = Math.floor(index / BASE_PROJECT_NAMES.length);
  return series ? `${base}（系統${series + 1}）` : base;
}

function shortProjectName(name) {
  return name
    .replace('企業車両による', '')
    .replace('企業冷凍車両による', '')
    .replace('における助手業務及び付帯業務', '助手業務')
    .replace('及び付帯業務', '')
    .replace('その他付随する業務', '')
    .slice(0, 18);
}

function priceName(kind, companyLabel, baseName) {
  return `${kind}（${String(companyLabel).replace(PREFIX, '')}：${shortProjectName(baseName)}）`;
}

function cell(billing = '', payment = '') {
  return { billing, payment, lineIds: {} };
}

function matrix(multiplier = 1, paymentBias = 1) {
  return {
    daily: {
      basic: cell(Math.round(20000 * multiplier), Math.round(15500 * multiplier * paymentBias)),
      shortage: cell('', ''), overtime: cell('', ''), night: cell('', ''), night_overtime: cell('', ''),
    },
    hourly: {
      basic: cell('', ''),
      shortage: cell(Math.round(2500 * multiplier), Math.round(1900 * multiplier * paymentBias)),
      overtime: cell(Math.round(2600 * multiplier), Math.round(2100 * multiplier * paymentBias)),
      night: cell(Math.round(2800 * multiplier), Math.round(2250 * multiplier * paymentBias)),
      night_overtime: cell(Math.round(3200 * multiplier), Math.round(2600 * multiplier * paymentBias)),
    },
  };
}

function monthlyFeeItem(companyLabel, baseName, amountBilling = 180000, amountPayment = 140000) {
  return {
    id: 'monthly-flat',
    name: priceName('月極料金', companyLabel, baseName),
    mode: 'weekdays',
    weekdays: { all: true },
    calc_types: ['monthly'],
    matrix: {
      monthly: {
        basic: cell(amountBilling, amountPayment),
      },
    },
  };
}

function distanceRulesForScenario(scenario) {
  if (scenario === 'distance-daily') {
    return {
      billing: { mode: 'daily_excess', base_distance: 40, unit_price: 80, fixed_amount: 0, tiers: [], rounding: { amount_mode: 'floor', amount_stage: 'detail' } },
      payment: { mode: 'daily_excess', base_distance: 40, unit_price: 55, fixed_amount: 0, tiers: [], rounding: { amount_mode: 'floor', amount_stage: 'detail' } },
    };
  }
  if (scenario === 'distance-monthly') {
    return {
      billing: { mode: 'monthly_excess', base_distance: 500, unit_price: 70, fixed_amount: 0, tiers: [], rounding: { amount_mode: 'floor', amount_stage: 'month' } },
      payment: { mode: 'monthly_excess', base_distance: 500, unit_price: 50, fixed_amount: 0, tiers: [], rounding: { amount_mode: 'floor', amount_stage: 'month' } },
    };
  }
  if (scenario === 'distance-tiered') {
    return {
      billing: {
        mode: 'tiered', base_distance: 0, tier_mode: 'excess_distance', unit_price: 0, fixed_amount: 0,
        tiers: [{ upper_distance: 50, unit_price: 60 }, { upper_distance: 100, unit_price: 80 }, { upper_distance: null, unit_price: 100 }],
        rounding: { amount_mode: 'floor', amount_stage: 'detail' },
      },
      payment: {
        mode: 'tiered', base_distance: 0, tier_mode: 'excess_distance', unit_price: 0, fixed_amount: 0,
        tiers: [{ upper_distance: 50, unit_price: 40 }, { upper_distance: 100, unit_price: 55 }, { upper_distance: null, unit_price: 70 }],
        rounding: { amount_mode: 'floor', amount_stage: 'detail' },
      },
    };
  }
  return {
    billing: { mode: 'daily_excess', base_distance: 50, unit_price: 80, fixed_amount: 0, tiers: [], rounding: { amount_mode: 'floor', amount_stage: 'detail' } },
    payment: { mode: 'daily_excess', base_distance: 50, unit_price: 55, fixed_amount: 0, tiers: [], rounding: { amount_mode: 'floor', amount_stage: 'detail' } },
  };
}

function priceExtra({ index, companyLabel, baseName, paymentBias = 1, scenario = 'standard', revision = false }) {
  const mult = revision ? 1.08 : 1;
  const normal = {
    id: 'weekday-standard', name: priceName(revision ? '平日料金改定' : '平日料金', companyLabel, baseName), mode: 'weekdays',
    weekdays: { weekday: true }, matrix: matrix(mult, paymentBias),
  };
  const holiday = {
    id: 'holiday-standard', name: priceName('休日料金', companyLabel, baseName), mode: 'weekdays',
    weekdays: { holiday: true, sat: true, sun: true }, matrix: matrix(1.25 * mult, paymentBias),
  };
  const training = {
    id: 'training', name: priceName('研修料金', companyLabel, baseName), mode: 'weekdays',
    weekdays: { all: true }, matrix: matrix(0.7 * mult, paymentBias),
  };
  const items = [normal, holiday, training, {
    id: 'distance-extra', name: priceName('距離超過料金', companyLabel, baseName), mode: 'distance',
    matrix: { distance: { basic: cell(80, 55) } },
  }];
  if (['manual-special', 'matrix-manual', 'matrix-monthly'].includes(scenario) || index >= MATRIX_START) {
    items.push({
      id: 'manual-special', name: priceName('臨時特別料金', companyLabel, baseName),
      mode: 'weekdays', weekdays: { all: true }, matrix: matrix(1.45 * mult, paymentBias),
    });
  }
  if (scenario === 'matrix-monthly' || scenario === 'monthly') {
    items.push(monthlyFeeItem(companyLabel, baseName));
  }
  const splitNight = ['matrix-night-split', 'special-split'].includes(scenario);
  const roundDiff = ['matrix-rounding', 'special-round'].includes(scenario);
  let distanceScenario = 'default';
  if (scenario === 'matrix-distance-daily') distanceScenario = 'distance-daily';
  if (scenario === 'matrix-distance-monthly') distanceScenario = 'distance-monthly';
  if (scenario === 'matrix-distance-tiered') distanceScenario = 'distance-tiered';
  let nightModeBilling = 'separate';
  let nightModePayment = 'separate';
  if (scenario === 'matrix-night-include') nightModeBilling = 'include_in_base';
  if (scenario === 'matrix-night-excluded') { nightModeBilling = 'excluded'; nightModePayment = 'excluded'; }

  return {
    seed_key: SEED_KEY,
    fee_items: items,
    night_rules: {
      billing: { periods: [{ start: '22:00', end: '29:00' }], night_mode: nightModeBilling, night_overtime_mode: nightModeBilling },
      payment: {
        periods: [{ start: splitNight ? '23:00' : '22:00', end: splitNight ? '30:00' : '29:00' }],
        night_mode: nightModePayment, night_overtime_mode: nightModePayment,
      },
    },
    rounding: {
      billing: { time_unit_minutes: roundDiff ? 30 : 15, time_mode: 'floor', amount_mode: 'floor', amount_stage: 'detail' },
      payment: { time_unit_minutes: 15, time_mode: roundDiff ? 'round' : 'floor', amount_mode: 'floor', amount_stage: 'detail' },
    },
    work_rules: {
      billing: { standard_minutes: 480 },
      payment: { standard_minutes: splitNight ? 540 : 480 },
    },
    distance_rules: distanceRulesForScenario(distanceScenario),
  };
}

function ymd(ym, day) { return `${ym}-${String(day).padStart(2, '0')}`; }
function weekday(date) { return new Date(`${date}T12:00:00Z`).getUTCDay(); }
function daysInMonth(ym) { return new Date(Date.UTC(Number(ym.slice(0, 4)), Number(ym.slice(5, 7)), 0)).getUTCDate(); }

function matrixScenario(index) {
  if (index < MATRIX_START) return null;
  const offset = index - MATRIX_START;
  const map = [
    'matrix-overtime', 'matrix-shortage', 'matrix-night', 'matrix-night-ot',
    'matrix-holiday', 'matrix-training', 'matrix-manual', 'matrix-override',
    'matrix-distance-daily', 'matrix-distance-monthly', 'matrix-distance-tiered', 'matrix-night-split',
    'matrix-rounding', 'matrix-absent', 'matrix-unnecessary', 'matrix-multi-row',
    'matrix-expense', 'matrix-status-mix', 'matrix-reject', 'matrix-monthly',
    'matrix-installment', 'matrix-installment-zero', 'matrix-unassigned', 'matrix-late-start',
    'matrix-ended', 'matrix-payment-bias-a', 'matrix-payment-bias-b', 'matrix-consolidate-a',
    'matrix-consolidate-b', 'matrix-consolidate-c', 'matrix-draft-invoice', 'matrix-carry',
    'matrix-night-include', 'matrix-night-excluded', 'matrix-submission', 'matrix-account-ok',
    'matrix-revision-cross', 'matrix-sep-revision', 'matrix-no-report', 'matrix-standard',
  ];
  return map[offset] || `matrix-${offset + 1}`;
}

function reportDates(project, ym) {
  const scenario = project.scenario;
  if (['matrix-no-report', 'matrix-installment-zero', 'matrix-unassigned'].includes(scenario)) return [];
  if (scenario === 'matrix-ended' && ym >= '2026-07') return [];
  if (scenario === 'matrix-late-start' && ym < '2026-06') return [];
  if (project.operationStart && ym < project.operationStart.slice(0, 7)) return [];
  if (project.operationEnd && ym > project.operationEnd.slice(0, 7)) return [];

  const dates = [];
  const pushWeekdays = (predicate) => {
    for (let day = 1; day <= daysInMonth(ym); day += 1) {
      const date = ymd(ym, day);
      const dow = weekday(date);
      if (dow === 0 || dow === 6) continue;
      if (predicate(day, dow, date)) dates.push(date);
    }
  };

  if (ym === MATRIX_MONTH && scenario) {
    if (scenario === 'matrix-holiday') {
      dates.push('2026-09-21', '2026-09-22', '2026-09-23');
      return [...new Set(dates)].sort();
    }
    if (scenario === 'matrix-multi-row') {
      dates.push('2026-09-02', '2026-09-02');
      return dates;
    }
    pushWeekdays((day, dow) => dow === 1 || dow === 3 || (scenario === 'matrix-status-mix' && dow === 5));
    return [...new Set(dates)].sort();
  }

  const group = project.index < 20 ? 'high' : project.index < 90 ? 'normal' : project.index < 120 ? 'low' : 'minimal';
  if (group === 'high') pushWeekdays((day, dow) => dow === 1 || dow === 3 || dow === 5);
  else if (group === 'normal') pushWeekdays((day, dow) => dow === 2 || dow === 4);
  else if (group === 'low') pushWeekdays((day, dow) => dow === 5 && day <= 21);
  else pushWeekdays((day, dow) => dow === 1 && day <= 7);

  if (ym <= '2026-01' && group !== 'high') {
    return dates.filter((_, i) => i % 2 === 0);
  }
  return [...new Set(dates)].sort();
}

function reportInput(project, date, position, options = {}) {
  const scenario = project.scenario || '';
  const input = {
    project_id: project.projectId,
    company_id: project.companyId,
    partner_id: project.partnerId,
    vehicle_id: project.vehicleId,
    target_year_month: date.slice(0, 7),
    work_date: date,
    start_time: project.execStart || '08:00',
    end_time: project.execEnd || '17:00',
    break_minutes: project.breakMinutes != null ? project.breakMinutes : 60,
    start_meter: 1000 + position * 10,
    end_meter: 1040 + position * 10,
    total_distance: 40,
    toll_fee: position % 11 === 0 ? 600 : 0,
    parking_fee: position % 17 === 0 ? 500 : 0,
    transport_fee: 0,
    row_comment: `${shortProjectName(project.baseName)}｜${project.variant}｜日報`,
    input_source_type: 'manual',
  };

  if (options.secondRow) {
    input.start_time = '18:00';
    input.end_time = '21:00';
    input.break_minutes = 0;
    input.row_comment = '同日2行目｜夜間便';
    input.selected_fee_item_id = 'manual-special';
    input.fee_item_selection_source = 'manual';
    return input;
  }

  if (scenario === 'matrix-overtime' && position % 2 === 0) input.end_time = '20:00';
  if (scenario === 'matrix-shortage' && position % 2 === 0) input.end_time = '13:00';
  if (scenario === 'matrix-night' && position % 2 === 0) {
    input.start_time = '20:00'; input.end_time = '28:00';
    input.night_break_minutes_billing = 30; input.night_break_minutes_payment = 30;
  }
  if (scenario === 'matrix-night-ot' && position % 2 === 0) {
    input.start_time = '18:00'; input.end_time = '31:00';
    input.night_break_minutes_billing = 30; input.night_break_minutes_payment = 30;
  }
  if (scenario === 'matrix-training' && position % 2 === 0) {
    input.is_training = 1; input.row_comment = '研修料金自動選択';
  }
  if (scenario === 'matrix-manual' && position % 2 === 0) {
    input.selected_fee_item_id = 'manual-special';
    input.fee_item_selection_source = 'manual';
    input.row_comment = '料金項目手動選択';
  }
  if (scenario === 'matrix-override' && position % 2 === 0) {
    input.rate_overrides = { billing: { basic: 22500 }, payment: { basic: 17100 } };
    input.rate_override_reason = '匿名検証用の一時単価変更';
  }
  if (['matrix-distance-daily', 'matrix-distance-tiered'].includes(scenario) && position % 2 === 0) {
    input.total_distance = 95; input.end_meter = input.start_meter + 95;
  }
  if (scenario === 'matrix-distance-monthly') {
    input.total_distance = 120; input.end_meter = input.start_meter + 120;
  }
  if (scenario === 'matrix-night-split' && position % 2 === 0) {
    input.start_time = '21:00'; input.end_time = '29:00';
    input.night_break_minutes_billing = 30; input.night_break_minutes_payment = 30;
  }
  if (scenario === 'matrix-rounding' && position % 2 === 0) {
    input.start_time = '08:07'; input.end_time = '18:11'; input.total_distance = 85;
  }
  if (scenario === 'matrix-absent') {
    input.is_absent = 1; input.row_comment = '欠勤';
  }
  if (scenario === 'matrix-unnecessary') {
    input.is_absent = 1; input.row_comment = '不要（非稼働）';
  }
  if (scenario === 'matrix-expense') {
    input.toll_fee = 1200; input.parking_fee = 800; input.transport_fee = 450;
    input.row_comment = '経費混在';
  }
  if (scenario === 'matrix-monthly' && position === 0) {
    input.selected_fee_item_id = 'monthly-flat';
    input.fee_item_selection_source = 'manual';
    input.row_comment = '月極料金';
  }
  return input;
}

async function assertSchema(conn) {
  const [approvalRows] = await conn.query(`SHOW TABLES LIKE 'daily_report_monthly_approvals'`);
  const [settlementProjectRows] = await conn.query(`SHOW TABLES LIKE 'settlement_projects'`);
  if (!approvalRows.length || !settlementProjectRows.length) throw new Error('必要なマイグレーションが未適用です。先にアプリを起動してマイグレーションを適用してください。');
}

function seedKeyWhere(alias = '') {
  const col = alias ? `${alias}.extra_data` : 'extra_data';
  return `JSON_UNQUOTE(JSON_EXTRACT(${col}, '$.seed_key')) = ? AND ${alias ? `${alias}.` : ''}is_deleted = 0`;
}

async function verificationSummary(conn) {
  const result = {};
  const [companyRows] = await conn.execute(
    `SELECT COUNT(*) AS count FROM companies WHERE company_name LIKE ? AND is_deleted = 0`,
    [`${PREFIX}%`]
  );
  const [partnerRows] = await conn.execute(
    `SELECT COUNT(*) AS count FROM partners WHERE partner_name LIKE ? AND is_deleted = 0`,
    [`${PREFIX}%`]
  );
  result.companies = Number(companyRows[0].count);
  result.partners = Number(partnerRows[0].count);

  const seedWhere = "JSON_UNQUOTE(JSON_EXTRACT(extra_data, '$.seed_key')) = ? AND is_deleted = 0";
  const countSeed = async (table) => {
    const [rows] = await conn.execute(`SELECT COUNT(*) AS count FROM ${table} WHERE ${seedWhere}`, [SEED_KEY]);
    return Number(rows[0].count);
  };
  result.base_projects = await countSeed('base_projects');
  result.projects = await countSeed('projects');
  result.price_sets = await countSeed('price_sets');
  result.daily_reports = await countSeed('daily_reports');
  result.invoices = await countSeed('invoices');
  result.payments = await countSeed('payments');

  const [projectBillingRows] = await conn.execute(
    `SELECT COUNT(*) AS count FROM projects WHERE ${seedWhere} AND billing_id IS NOT NULL`,
    [SEED_KEY]
  );
  const [billingNoRows] = await conn.execute(
    `SELECT COUNT(*) AS count FROM company_billings WHERE ${seedWhere} AND billing_no IS NOT NULL`,
    [SEED_KEY]
  );
  const [settlementProjectRows] = await conn.execute(
    `SELECT COUNT(*) AS count FROM settlement_projects sp
     WHERE (sp.settlement_type='invoice' AND sp.settlement_id IN (SELECT invoice_id FROM invoices WHERE ${seedWhere}))
        OR (sp.settlement_type='payment' AND sp.settlement_id IN (SELECT payment_id FROM payments WHERE ${seedWhere}))`,
    [SEED_KEY, SEED_KEY]
  );
  result.projects_with_billing = Number(projectBillingRows[0].count);
  result.company_billings_with_no = Number(billingNoRows[0].count);
  result.settlement_project_links = Number(settlementProjectRows[0].count);

  const [advanceRows] = await conn.execute(
    `SELECT COUNT(*) AS count FROM advance_records ar
     JOIN projects p ON p.project_id = ar.project_id
     WHERE JSON_UNQUOTE(JSON_EXTRACT(p.extra_data,'$.seed_key')) = ?`,
    [SEED_KEY]
  );
  result.advance_records = Number(advanceRows[0].count);

  const [workflowRows] = await conn.execute(
    `SELECT COUNT(*) count FROM settlement_workflows w
     WHERE (w.settlement_type='invoice' AND w.settlement_id IN (SELECT invoice_id FROM invoices WHERE ${seedWhere}))
        OR (w.settlement_type='payment' AND w.settlement_id IN (SELECT payment_id FROM payments WHERE ${seedWhere}))`,
    [SEED_KEY, SEED_KEY]
  );
  const [documentRows] = await conn.execute(
    `SELECT COUNT(*) count FROM settlement_documents d
     WHERE (d.settlement_type='invoice' AND d.settlement_id IN (SELECT invoice_id FROM invoices WHERE ${seedWhere}))
        OR (d.settlement_type='payment' AND d.settlement_id IN (SELECT payment_id FROM payments WHERE ${seedWhere}))`,
    [SEED_KEY, SEED_KEY]
  );
  result.settlement_workflows = Number(workflowRows[0].count);
  result.settlement_documents = Number(documentRows[0].count);

  const [noReportRows] = await conn.execute(
    `SELECT COUNT(*) AS count FROM projects p
     WHERE ${seedKeyWhere('p')}
       AND NOT EXISTS (SELECT 1 FROM daily_reports d WHERE d.project_id = p.project_id AND d.is_deleted = 0)`,
    [SEED_KEY]
  );
  const [installmentRows] = await conn.execute(
    `SELECT COUNT(*) AS count FROM projects WHERE ${seedWhere} AND payment_type = 'installment'`,
    [SEED_KEY]
  );
  const [revisionRows] = await conn.execute(
    `SELECT COUNT(*) AS count FROM price_sets
     WHERE ${seedWhere} AND JSON_EXTRACT(extra_data, '$.revision') = true`,
    [SEED_KEY]
  );
  const [submissionRows] = await conn.execute(
    `SELECT COUNT(*) AS count FROM daily_report_submissions s
     JOIN projects p ON p.project_id = s.project_id
     WHERE JSON_UNQUOTE(JSON_EXTRACT(p.extra_data,'$.seed_key')) = ?`,
    [SEED_KEY]
  );
  const [matrixReportRows] = await conn.execute(
    `SELECT COUNT(*) AS count FROM daily_reports WHERE ${seedWhere} AND target_year_month = ?`,
    [SEED_KEY, MATRIX_MONTH]
  );
  result.projects_without_reports = Number(noReportRows[0].count);
  result.installment_projects = Number(installmentRows[0].count);
  result.price_set_revisions = Number(revisionRows[0].count);
  result.daily_report_submissions = Number(submissionRows[0].count);
  result.matrix_month_reports = Number(matrixReportRows[0].count);
  result.seed_key = SEED_KEY;
  result.months = MONTHS;
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
  const lastDay = new Date(Date.UTC(Number(ym.slice(0, 4)), Number(ym.slice(5, 7)), 0)).getUTCDate();
  for (const [code, day] of [['05', 5], ['10', 10], ['15', 15], ['20', 20], ['25', 25], ['end', lastDay]]) {
    const date = `${ym}-${String(day).padStart(2, '0')}`;
    await conn.execute(
      `INSERT IGNORE INTO cash_cycles (target_year_month,cycle_code,base_date,planned_incoming_date,planned_outgoing_date) VALUES (?,?,?,?,?)`,
      [ym, code, date, date, date]
    );
  }
  const [rows] = await conn.execute(
    `SELECT * FROM cash_cycles WHERE target_year_month=? ORDER BY FIELD(cycle_code,'05','10','15','20','25','end')`,
    [ym]
  );
  return rows;
}

const VERIFICATION_ISSUER = {
  name: `${PREFIX}リンクスシステム株式会社`,
  zip_code: '000-0000',
  address: '東京都サンプル区テスト1-2-3',
  registration_number: 'T0000000000000',
  tel: '00-0000-0000',
  fax: '00-0000-0001',
  bank_accounts: [
    { bank_name: 'サンプル銀行', branch_name: '本店', deposit_type: '普通', account_number: '0000000', account_name: 'リンクスシステム（カ' },
  ],
};

async function createSeedDocument(conn, kind, settlementId, type, entity, total, lines, sequence, amounts = {}, ym = '2026-05') {
  const number = `VS-${type.toUpperCase().replace(/_/g, '')}-${ym.replace('-', '')}-${String(sequence).padStart(4, '0')}`;
  const document = {
    settlement_type: kind,
    document_type: type,
    document_number: number,
    issued_date: `${ym}-28`,
    due_date: ymd(ym === '2026-09' ? '2026-10' : ym, 30),
    payment_date: ymd(ym === '2026-09' ? '2026-10' : ym, 30),
    target_year_month: ym,
    total_amount: total,
    company_name: entity.company_name,
    partner_name: entity.partner_name,
    issuer: VERIFICATION_ISSUER,
    recipient: {
      name: entity.company_name || entity.partner_name,
      zip_code: entity.zip_code || '000-0000',
      address: entity.address || '匿名化住所',
      bank_name: entity.bank_name || '',
      branch_name: entity.branch_name || '',
      deposit_type: entity.deposit_type || '',
      account_number: entity.account_number || '',
      account_name: entity.account_name || '',
    },
    transfer_fee_note: '恐れ入りますが、振込手数料は御社でご負担をお願い申し上げます。',
    tax_rate: 0.1,
    ...amounts,
  };
  let fileName;
  const canRenderPdf = process.env.VERIFICATION_SEED_PDF !== '0'
    && Boolean(process.env.PDF_CHROMIUM_EXECUTABLE_PATH || process.env.VERIFICATION_SEED_FORCE_PDF === '1');
  if (canRenderPdf) {
    try {
      const pdf = await writePdf(document, lines);
      fileName = pdf.fileName;
    } catch (error) {
      console.warn(`[verification-seed] PDF生成失敗のためスタブを使用: ${error.message.split('\n')[0]}`);
    }
  }
  if (!fileName) {
    await fs.mkdir(PDF_DIR, { recursive: true });
    fileName = `seed-stub-${number.replace(/[^A-Za-z0-9_-]/g, '_')}.pdf`;
    await fs.writeFile(
      path.join(PDF_DIR, fileName),
      Buffer.from(`%PDF-1.4\n% verification-seed-stub ${number}\n`)
    );
  }
  await insert(conn, 'settlement_documents', {
    settlement_type: kind,
    settlement_id: settlementId,
    document_type: type,
    document_year: Number(ym.slice(0, 4)),
    document_number: number,
    company_id: entity.company_id || null,
    partner_id: entity.partner_id || null,
    file_path: fileName,
    snapshot_json: JSON.stringify({ seed_key: SEED_KEY, document, lines }),
  });
}

async function createSettlementsForMonth(conn, ym, { maxCompanies = 8, maxPartners = 6, withDocuments = false, documentSequenceStart = 1 } = {}) {
  const [actors] = await conn.execute(
    `SELECT user_id FROM users WHERE is_deleted=0 AND is_active=1 ORDER BY CASE WHEN role='admin' THEN 0 ELSE 1 END, user_id LIMIT 1`
  );
  if (!actors.length) throw new Error('検証用精算の作成に必要な有効ユーザーがいません');
  const actorId = Number(actors[0].user_id);
  const cycles = await ensureVerificationCycles(conn, ym);
  const cycle = cycles.find((x) => x.cycle_code === 'end') || cycles[0];
  const [reports] = await conn.execute(
    `SELECT d.*, COALESCE(bp.template_name, CONCAT('案件 #', d.project_id)) AS project_name,
            cb.billing_summary_no
       FROM daily_reports d
       LEFT JOIN projects p ON p.project_id = d.project_id
       LEFT JOIN base_projects bp ON bp.base_project_id = p.base_project_id
       LEFT JOIN company_billings cb ON cb.company_id = d.company_id AND cb.is_deleted = 0
      WHERE d.target_year_month = ? AND d.status = 'approved'
        AND d.is_deleted = 0 AND JSON_UNQUOTE(JSON_EXTRACT(d.extra_data, '$.seed_key')) = ?
      ORDER BY d.company_id, d.partner_id, d.work_date`,
    [ym, SEED_KEY]
  );
  const byCompany = new Map();
  const byPartner = new Map();
  for (const row of reports) {
    if (!byCompany.has(row.company_id)) byCompany.set(row.company_id, []);
    if (row.partner_id != null) {
      if (!byPartner.has(row.partner_id)) byPartner.set(row.partner_id, []);
      byPartner.get(row.partner_id).push(row);
    }
    byCompany.get(row.company_id).push(row);
  }

  let documentSequence = documentSequenceStart;
  let invoiceCount = 0;
  const companyEntries = [...byCompany.entries()].slice(0, maxCompanies);
  for (const [invoiceIndex, [companyId, rows]] of companyEntries.entries()) {
    const projectIds = [...new Set(rows.map((r) => r.project_id))];
    const subtotal = rows.reduce((sum, row) => sum + Number(row.calculated_billing_amount || 0), 0);
    if (subtotal <= 0 && ym !== MATRIX_MONTH) continue;
    const adjustment = invoiceIndex === 2 ? -500 : (companyId % 9 === 0 ? -300 : 0);
    const taxable = Math.max(0, subtotal + adjustment);
    const tax = Math.floor(taxable * 0.1);
    const [companyRows] = await conn.execute(
      'SELECT company_name, zip_code, address FROM companies WHERE company_id=?',
      [companyId]
    );
    const displayMode = invoiceIndex % 2 === 0 ? 'detailed' : 'project_aggregated';
    await conn.execute(
      `INSERT INTO company_invoice_settings (company_id, display_mode, tax_rate, tax_rounding)
       VALUES (?,?,0.10,'floor')
       ON DUPLICATE KEY UPDATE display_mode=VALUES(display_mode), tax_rate=VALUES(tax_rate), tax_rounding=VALUES(tax_rounding)`,
      [companyId, displayMode]
    );
    const invoiceStatus = (ym === MATRIX_MONTH && invoiceIndex === 0) ? 'draft' : 'finalized';
    const invoiceId = await insert(conn, 'invoices', {
      company_id: companyId,
      target_year_month: ym,
      closing_date: 'end',
      subtotal_amount: subtotal,
      adjustment_amount: adjustment,
      taxable_amount: taxable,
      tax_amount: tax,
      total_amount: taxable + tax,
      invoice_status: invoiceStatus,
      settlement_status: invoiceStatus,
      approval_status: invoiceStatus === 'finalized' ? 'approved' : 'draft',
      is_confirmed: invoiceStatus === 'finalized' ? 1 : 0,
      extra_data: JSON.stringify({
        seed_key: SEED_KEY,
        selected_project_ids: projectIds,
        billing_summary_no: rows[0]?.billing_summary_no || null,
        consolidated: projectIds.length > 1,
        pattern: projectIds.length > 1 ? 'T-BILL-02' : 'T-BILL-01',
      }),
    });
    invoiceCount += 1;
    const lines = rows.map((row) => ({
      line_type: 'work',
      source_type: 'monthly_approval_snapshot',
      source_id: row.daily_report_id,
      project_id: row.project_id,
      daily_report_id: row.daily_report_id,
      item_name: `稼働 ${String(row.work_date).slice(0, 10)}`,
      quantity: 1,
      unit_price: Number(row.calculated_billing_amount || 0),
      amount: Number(row.calculated_billing_amount || 0),
      tax_category: 'taxable',
      snapshot_json: JSON.stringify({ ...row, seed_key: SEED_KEY }),
    }));
    if (adjustment !== 0) {
      lines.push({
        line_type: 'adjustment', source_type: 'manual', source_id: null, project_id: null, daily_report_id: null,
        item_name: '値引き調整', quantity: 1, unit_price: adjustment, amount: adjustment, tax_category: 'taxable',
        snapshot_json: JSON.stringify({ seed_key: SEED_KEY, reason: '匿名検証用調整' }),
      });
    }
    for (const line of lines) await insert(conn, 'settlement_lines', { settlement_type: 'invoice', settlement_id: invoiceId, ...line });
    for (const projectId of projectIds) {
      await insert(conn, 'settlement_projects', { settlement_type: 'invoice', settlement_id: invoiceId, project_id: projectId });
    }
    await insert(conn, 'invoice_details', {
      invoice_id: invoiceId, price_name: '稼働分（匿名検証用）', unit_price: subtotal, quantity: 1, amount: subtotal, is_adjustment_row: 0,
    });
    for (const row of rows) {
      await conn.execute('INSERT INTO invoice_daily_reports (invoice_id, daily_report_id) VALUES (?, ?)', [invoiceId, row.daily_report_id]);
      if (invoiceStatus === 'finalized') {
        await conn.execute("UPDATE daily_reports SET billing_status = 'billed' WHERE daily_report_id = ?", [row.daily_report_id]);
      } else {
        await conn.execute("UPDATE daily_reports SET billing_status = 'reserved' WHERE daily_report_id = ?", [row.daily_report_id]);
      }
    }
    await insert(conn, 'settlement_workflows', {
      settlement_type: 'invoice', settlement_id: invoiceId, status: invoiceStatus,
      drafted_by_user_id: actorId,
      sales_reviewed_by_user_id: invoiceStatus === 'finalized' ? actorId : null,
      sales_reviewed_at: invoiceStatus === 'finalized' ? `${ym}-28` : null,
      finalized_by_user_id: invoiceStatus === 'finalized' ? actorId : null,
      finalized_at: invoiceStatus === 'finalized' ? `${ym}-28` : null,
    });
    if (invoiceStatus === 'finalized') {
      const scheduleId = await insert(conn, 'cash_schedules', {
        cash_cycle_id: cycle.cash_cycle_id, direction: 'incoming', source_type: 'invoice', source_id: invoiceId,
        company_id: companyId, counterparty_name: companyRows[0].company_name, title: '請求入金（匿名検証用）',
        amount: taxable + tax, scheduled_date: cycle.planned_incoming_date,
        status: invoiceIndex === 1 ? 'executed' : 'planned',
        snapshot_json: JSON.stringify({ seed_key: SEED_KEY, settlement_type: 'invoice', settlement_id: invoiceId }),
      });
      if (invoiceIndex === 1) {
        await insert(conn, 'cash_transactions', {
          cash_schedule_id: scheduleId, executed_date: cycle.planned_incoming_date,
          executed_amount: taxable + tax, status: 'executed', bank_name: 'サンプル銀行',
        });
      }
    }
    if (withDocuments && invoiceStatus === 'finalized' && invoiceIndex < 2) {
      await createSeedDocument(
        conn, 'invoice', invoiceId, displayMode === 'project_aggregated' ? 'invoice_summary' : 'invoice',
        { company_id: companyId, ...companyRows[0] }, taxable + tax, lines, documentSequence++, { subtotal_amount: taxable, tax_amount: tax }, ym
      );
    }
  }

  let paymentCount = 0;
  const partnerEntries = [...byPartner.entries()].slice(0, maxPartners);
  for (const [paymentIndex, [partnerId, rows]] of partnerEntries.entries()) {
    const projectIds = [...new Set(rows.map((row) => row.project_id))];
    const gross = rows.reduce((sum, row) => sum + Number(row.calculated_payment_amount || 0), 0);
    if (gross <= 0 && ym !== MATRIX_MONTH) continue;
    const [partnerRows] = await conn.execute(
      'SELECT partner_name,zip_code,address,bank_name,branch_name,deposit_type,account_number,account_name FROM partners WHERE partner_id=?',
      [partnerId]
    );
    const [advance] = await conn.execute(
      `SELECT ar.advance_record_id,
              ar.advance_amount - COALESCE(SUM(CASE WHEN aa.status='active' THEN aa.amount ELSE 0 END),0) AS amount
         FROM advance_records ar
         LEFT JOIN advance_payment_allocations aa ON aa.advance_record_id = ar.advance_record_id
        WHERE ar.partner_id = ? AND ar.status = 'executed'
        GROUP BY ar.advance_record_id, ar.advance_amount
        ORDER BY ar.advance_record_id LIMIT 1`,
      [partnerId]
    );
    const advanceAmount = Math.min(gross, Number(advance[0]?.amount || 0));
    const [rules] = await conn.execute(
      `SELECT * FROM settlement_deduction_rules
        WHERE is_active=1 AND valid_from<=? AND (valid_to IS NULL OR valid_to>=?)
          AND (scope='common' OR (scope='partner' AND partner_id=?))
        ORDER BY CASE WHEN scope='partner' THEN 0 ELSE 1 END, settlement_deduction_rule_id`,
      [`${ym}-28`, `${ym}-01`, partnerId]
    );
    let remaining = Math.max(0, gross - advanceAmount);
    const appliedRules = [];
    for (const rule of rules) {
      const amount = Math.min(remaining, Number(rule.amount));
      appliedRules.push({ ...rule, applied: amount });
      remaining -= amount;
    }
    // T-PAY-08: 振込0・繰越（意図的に控除を大きくする）
    if (ym === MATRIX_MONTH && paymentIndex === 0 && remaining > 0) {
      appliedRules.push({
        settlement_deduction_rule_id: null,
        rule_code: 'force_carry',
        display_name: '検証用追加控除',
        tax_category: 'non_taxable',
        applied: remaining + 1000,
      });
      remaining = 0;
    }
    const finalAmount = Math.max(0, remaining);
    const paymentId = await insert(conn, 'payments', {
      partner_id: partnerId,
      target_year_month: ym,
      closing_date: 'end',
      gross_amount: gross,
      advance_deduction_amount: advanceAmount,
      transfer_fee_deduction_amount: 0,
      office_fee_amount: appliedRules.find((x) => x.rule_code === 'office_fee')?.applied || 0,
      safety_fee_amount: appliedRules.find((x) => x.rule_code === 'safety_fee')?.applied || 0,
      other_adjustment_amount: appliedRules.find((x) => x.rule_code === 'force_carry')?.applied || 0,
      final_transfer_amount: finalAmount,
      payment_output_code: 'type_a',
      payment_status: 'finalized',
      settlement_status: 'finalized',
      approval_status: 'approved',
      is_confirmed: 1,
      extra_data: JSON.stringify({
        seed_key: SEED_KEY,
        issue_salary_statement: paymentIndex === 1,
        pattern: finalAmount === 0 ? 'T-PAY-08' : 'T-PAY-01',
      }),
    });
    paymentCount += 1;
    const lines = rows.map((row) => ({
      settlement_type: 'payment', settlement_id: paymentId, line_type: 'work',
      source_type: 'monthly_approval_snapshot', source_id: row.daily_report_id,
      project_id: row.project_id, daily_report_id: row.daily_report_id,
      item_name: `稼働 ${String(row.work_date).slice(0, 10)}`, quantity: 1,
      unit_price: Number(row.calculated_payment_amount || 0),
      amount: Number(row.calculated_payment_amount || 0),
      tax_category: 'taxable',
      snapshot_json: JSON.stringify({ ...row, seed_key: SEED_KEY }),
    }));
    if (advanceAmount > 0) {
      lines.push({
        settlement_type: 'payment', settlement_id: paymentId, line_type: 'advance', source_type: 'advance',
        source_id: advance[0].advance_record_id, item_name: '前払控除', quantity: 1,
        unit_price: -advanceAmount, amount: -advanceAmount, tax_category: 'non_taxable',
        snapshot_json: JSON.stringify({ seed_key: SEED_KEY }),
      });
    }
    for (const rule of appliedRules.filter((x) => x.applied > 0)) {
      lines.push({
        settlement_type: 'payment', settlement_id: paymentId, line_type: 'deduction',
        source_type: rule.settlement_deduction_rule_id ? 'rule' : 'manual',
        source_id: rule.settlement_deduction_rule_id, item_name: rule.display_name, quantity: 1,
        unit_price: -rule.applied, amount: -rule.applied, tax_category: rule.tax_category,
        snapshot_json: JSON.stringify({ seed_key: SEED_KEY }),
      });
    }
    for (const line of lines) await insert(conn, 'settlement_lines', line);
    for (const projectId of projectIds) {
      await insert(conn, 'settlement_projects', { settlement_type: 'payment', settlement_id: paymentId, project_id: projectId });
    }
    if (advanceAmount > 0) {
      await insert(conn, 'advance_payment_allocations', {
        advance_record_id: advance[0].advance_record_id, payment_id: paymentId, amount: advanceAmount,
      });
    }
    await insert(conn, 'payment_details', {
      payment_id: paymentId, detail_type: 'work_item', item_name: '稼働分（匿名検証用）',
      unit_price: gross, quantity: 1, amount: gross,
    });
    for (const row of rows) {
      await conn.execute('INSERT INTO payment_daily_reports (payment_id, daily_report_id) VALUES (?, ?)', [paymentId, row.daily_report_id]);
      await conn.execute("UPDATE daily_reports SET payment_status = 'paid' WHERE daily_report_id = ?", [row.daily_report_id]);
    }
    await insert(conn, 'settlement_workflows', {
      settlement_type: 'payment', settlement_id: paymentId, status: 'finalized',
      drafted_by_user_id: actorId, sales_reviewed_by_user_id: actorId, sales_reviewed_at: `${ym}-28`,
      finalized_by_user_id: actorId, finalized_at: `${ym}-28`,
    });
    if (finalAmount > 0) {
      const scheduleStatus = paymentIndex === 0 ? 'exported' : (paymentIndex === 1 ? 'executed' : 'planned');
      const scheduleId = await insert(conn, 'cash_schedules', {
        cash_cycle_id: cycle.cash_cycle_id, direction: 'outgoing', source_type: 'payment', source_id: paymentId,
        partner_id: partnerId, counterparty_name: partnerRows[0].partner_name, title: '通常支払（匿名検証用）',
        amount: finalAmount, scheduled_date: cycle.planned_outgoing_date, status: scheduleStatus,
        snapshot_json: JSON.stringify({ seed_key: SEED_KEY, settlement_type: 'payment', settlement_id: paymentId }),
      });
      if (scheduleStatus === 'executed') {
        await insert(conn, 'cash_transactions', {
          cash_schedule_id: scheduleId, executed_date: cycle.planned_outgoing_date,
          executed_amount: finalAmount, status: 'executed', bank_name: 'サンプル銀行',
        });
      }
      if (scheduleStatus === 'exported' && withDocuments) {
        const batchId = await insert(conn, 'cash_export_batches', {
          cash_cycle_id: cycle.cash_cycle_id, bank_name: 'サンプル銀行',
          file_name: `vs-export-${ym}-${paymentId}.csv`, created_by: actorId,
          total_count: 1, total_amount: finalAmount,
        });
        await insert(conn, 'cash_export_batch_items', { cash_export_batch_id: batchId, cash_schedule_id: scheduleId });
      }
    }
    if (withDocuments && paymentIndex < 2) {
      await createSeedDocument(
        conn, 'payment', paymentId, 'payment_statement',
        { partner_id: partnerId, ...partnerRows[0] }, finalAmount, lines, documentSequence++, { gross_amount: gross }, ym
      );
      if (paymentIndex === 1) {
        await createSeedDocument(
          conn, 'payment', paymentId, 'salary_statement',
          { partner_id: partnerId, ...partnerRows[0] }, finalAmount, lines, documentSequence++, { gross_amount: gross }, ym
        );
      }
    }
  }
  return { invoiceCount, paymentCount, documentSequence };
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
  const allKeys = [SEED_KEY, ...LEGACY_SEED_KEYS];
  try {
    await assertSchema(conn);
    const marks = (values) => values.map(() => '?').join(',');
    const idsByKeys = async (table, column = 'extra_data') => {
      const [rows] = await conn.query(
        `SELECT * FROM ${table} WHERE JSON_UNQUOTE(JSON_EXTRACT(${column}, '$.seed_key')) IN (${marks(allKeys)})`,
        allKeys
      );
      return rows;
    };
    let companies = await idsByKeys('companies');
    let partners = await idsByKeys('partners');
    // レガシー【検証】接頭辞の取りこぼし吸収
    const [legacyCompanies] = await conn.query(
      `SELECT * FROM companies WHERE company_name LIKE ? AND is_deleted = 0`,
      ['【検証】%']
    );
    const [legacyPartners] = await conn.query(
      `SELECT * FROM partners WHERE (partner_name LIKE ? OR partner_name LIKE ?) AND is_deleted = 0`,
      ['%（検証）', `${PREFIX}%`]
    );
    const [prefixCompanies] = await conn.query(
      `SELECT * FROM companies WHERE company_name LIKE ? AND is_deleted = 0`,
      [`${PREFIX}%`]
    );
    companies = [...new Map([...companies, ...legacyCompanies, ...prefixCompanies].map((x) => [x.company_id, x])).values()];
    partners = [...new Map([...partners, ...legacyPartners].map((x) => [x.partner_id, x])).values()];

    const projects = await idsByKeys('projects');
    const bases = await idsByKeys('base_projects');
    const priceSets = await idsByKeys('price_sets');
    const invoices = await idsByKeys('invoices');
    const payments = await idsByKeys('payments');
    const companyIds = companies.map((x) => x.company_id);
    const partnerIds = partners.map((x) => x.partner_id);
    const projectIds = projects.map((x) => x.project_id);
    const baseIds = bases.map((x) => x.base_project_id);
    const priceSetIds = priceSets.map((x) => x.price_set_id);
    let invoiceIds = invoices.map((x) => x.invoice_id);
    let paymentIds = payments.map((x) => x.payment_id);
    const [reports] = projectIds.length
      ? await conn.query(`SELECT * FROM daily_reports WHERE project_id IN (${marks(projectIds)})`, projectIds)
      : [[]];
    const reportIds = reports.map((x) => x.daily_report_id);
    if (reportIds.length) {
      const [linkedInvoices] = await conn.query(
        `SELECT DISTINCT invoice_id FROM invoice_daily_reports WHERE daily_report_id IN (${marks(reportIds)})`,
        reportIds
      );
      const [linkedPayments] = await conn.query(
        `SELECT DISTINCT payment_id FROM payment_daily_reports WHERE daily_report_id IN (${marks(reportIds)})`,
        reportIds
      );
      invoiceIds = [...new Set([...invoiceIds, ...linkedInvoices.map((x) => x.invoice_id)])];
      paymentIds = [...new Set([...paymentIds, ...linkedPayments.map((x) => x.payment_id)])];
    }
    const [advanceRecords] = projectIds.length
      ? await conn.query(`SELECT advance_record_id FROM advance_records WHERE project_id IN (${marks(projectIds)})`, projectIds)
      : [[]];
    const advanceRecordIds = advanceRecords.map((x) => x.advance_record_id);
    const removeWhere = async (table, column, values, extraCondition = '') => {
      if (values.length) {
        const suffix = extraCondition ? ` AND ${extraCondition}` : '';
        await conn.query(`DELETE FROM ${table} WHERE ${column} IN (${marks(values)})${suffix}`, values);
      }
    };

    await conn.beginTransaction();
    let documentFiles = [];
    if (invoiceIds.length || paymentIds.length) {
      const conditions = [];
      const params = [];
      if (invoiceIds.length) {
        conditions.push(`(settlement_type='invoice' AND settlement_id IN (${marks(invoiceIds)}))`);
        params.push(...invoiceIds);
      }
      if (paymentIds.length) {
        conditions.push(`(settlement_type='payment' AND settlement_id IN (${marks(paymentIds)}))`);
        params.push(...paymentIds);
      }
      const [documents] = await conn.query(`SELECT file_path FROM settlement_documents WHERE ${conditions.join(' OR ')}`, params);
      documentFiles = documents.map((x) => x.file_path).filter(Boolean);
      await conn.query(`DELETE FROM settlement_documents WHERE ${conditions.join(' OR ')}`, params);
      await conn.query(`DELETE FROM settlement_workflows WHERE ${conditions.join(' OR ')}`, params);
      const [seedLines] = await conn.query(`SELECT settlement_line_id FROM settlement_lines WHERE ${conditions.join(' OR ')}`, params);
      const settlementLineIds = seedLines.map((x) => x.settlement_line_id);
      await removeWhere('settlement_line_audit_logs', 'settlement_line_id', settlementLineIds);
      await removeWhere('settlement_line_sources', 'settlement_line_id', settlementLineIds);
      await conn.query(`DELETE FROM settlement_lines WHERE ${conditions.join(' OR ')}`, params);
    }
    await removeWhere('settlement_carry_forward_allocations', 'payment_id', paymentIds);
    await removeWhere('settlement_projects', 'settlement_id', invoiceIds, "settlement_type='invoice'");
    await removeWhere('settlement_projects', 'settlement_id', paymentIds, "settlement_type='payment'");
    await removeWhere('settlement_projects', 'project_id', projectIds);
    await removeWhere('advance_payment_allocations', 'payment_id', paymentIds);
    await removeWhere('advance_payment_allocations', 'advance_record_id', advanceRecordIds);
    await removeWhere('settlement_carry_forwards', 'source_payment_id', paymentIds);
    await removeWhere('payment_daily_reports', 'payment_id', paymentIds);
    await removeWhere('invoice_daily_reports', 'invoice_id', invoiceIds);
    await removeWhere('payment_details', 'payment_id', paymentIds);
    await removeWhere('invoice_details', 'invoice_id', invoiceIds);
    const scheduleConditions = [];
    const scheduleParams = [];
    if (projectIds.length) {
      scheduleConditions.push(`project_id IN (${marks(projectIds)})`);
      scheduleParams.push(...projectIds);
    }
    if (partnerIds.length) {
      scheduleConditions.push(`partner_id IN (${marks(partnerIds)})`);
      scheduleParams.push(...partnerIds);
    }
    if (companyIds.length) {
      scheduleConditions.push(`company_id IN (${marks(companyIds)})`);
      scheduleParams.push(...companyIds);
    }
    if (invoiceIds.length) {
      scheduleConditions.push(`source_type='invoice' AND source_id IN (${marks(invoiceIds)})`);
      scheduleParams.push(...invoiceIds);
    }
    if (paymentIds.length) {
      scheduleConditions.push(`source_type IN ('payment','adjustment') AND source_id IN (${marks(paymentIds)})`);
      scheduleParams.push(...paymentIds);
    }
    if (advanceRecordIds.length) {
      scheduleConditions.push(`source_type='advance' AND source_id IN (${marks(advanceRecordIds)})`);
      scheduleParams.push(...advanceRecordIds);
    }
    scheduleConditions.push(`JSON_UNQUOTE(JSON_EXTRACT(snapshot_json,'$.seed_key')) IN (${marks(allKeys)})`);
    scheduleParams.push(...allKeys);
    const [seedSchedules] = await conn.query(
      `SELECT cash_schedule_id FROM cash_schedules WHERE ${scheduleConditions.map((x) => `(${x})`).join(' OR ')}`,
      scheduleParams
    );
    const scheduleIds = seedSchedules.map((x) => x.cash_schedule_id);
    if (scheduleIds.length) {
      const [batchIds] = await conn.query(
        `SELECT DISTINCT cash_export_batch_id FROM cash_export_batch_items WHERE cash_schedule_id IN (${marks(scheduleIds)})`,
        scheduleIds
      );
      await removeWhere('cash_export_batch_items', 'cash_schedule_id', scheduleIds);
      await removeWhere('cash_transactions', 'cash_schedule_id', scheduleIds);
      await removeWhere('cash_schedules', 'cash_schedule_id', scheduleIds);
      for (const batch of batchIds) {
        await conn.query(
          'DELETE FROM cash_export_batches WHERE cash_export_batch_id=? AND NOT EXISTS (SELECT 1 FROM cash_export_batch_items WHERE cash_export_batch_id=?)',
          [batch.cash_export_batch_id, batch.cash_export_batch_id]
        );
      }
    }
    await removeWhere('advance_record_audit_logs', 'advance_record_id', advanceRecordIds);
    await removeWhere('advance_records', 'project_id', projectIds);
    await removeWhere('project_advance_terms', 'project_id', projectIds);
    await removeWhere('payments', 'payment_id', paymentIds);
    await removeWhere('invoices', 'invoice_id', invoiceIds);
    await removeWhere('advance_payments', 'project_id', projectIds);
    await removeWhere('daily_report_confirmation_snapshots', 'daily_report_id', reportIds);
    await removeWhere('daily_report_audit_logs', 'daily_report_id', reportIds);
    await removeWhere('daily_report_monthly_approvals', 'project_id', projectIds);
    await removeWhere('daily_report_submissions', 'project_id', projectIds);
    await removeWhere('daily_reports', 'daily_report_id', reportIds);
    // 休日は案件FKがあるため、案件削除より先に必ず消す（seed_key のみ対象）
    await conn.query(
      `DELETE FROM holidays
        WHERE JSON_UNQUOTE(JSON_EXTRACT(extra_data,'$.seed_key')) IN (${marks(allKeys)})`,
      allKeys
    );
    if (projectIds.length) {
      await conn.query(
        `DELETE FROM holidays
          WHERE project_id IN (${marks(projectIds)})
            AND JSON_UNQUOTE(JSON_EXTRACT(extra_data,'$.seed_key')) IN (${marks(allKeys)})`,
        [...projectIds, ...allKeys]
      );
    }
    await removeWhere('price_set_lines', 'price_set_id', priceSetIds);
    await removeWhere('price_sets', 'price_set_id', priceSetIds);
    await removeWhere('project_revisions', 'project_id', projectIds);
    await removeWhere('project_settlement_reviewers', 'project_id', projectIds);
    await removeWhere('project_invoice_settings', 'project_id', projectIds);
    await removeWhere('partner_vehicles', 'partner_id', partnerIds);
    await removeWhere('company_vehicles', 'company_id', companyIds);
    await removeWhere('company_manager_periods', 'company_id', companyIds);
    await removeWhere('company_invoice_settings', 'company_id', companyIds);
    await removeWhere('invoice_exclusions', 'company_id', companyIds);
    await removeWhere('settlement_deduction_rules', 'partner_id', partnerIds);
    await removeWhere('projects', 'project_id', projectIds);
    await removeWhere('company_billings', 'company_id', companyIds);
    await removeWhere('base_projects', 'base_project_id', baseIds);
    await removeWhere('partners', 'partner_id', partnerIds);
    await removeWhere('companies', 'company_id', companyIds);
    await conn.commit();
    for (const file of documentFiles) {
      try { await fs.unlink(path.join(PDF_DIR, file)); } catch (_err) { /* ignore missing pdf */ }
    }
    console.log('[verification-seed] 匿名検証データだけを削除しました');
  } catch (error) {
    await conn.rollback();
    throw error;
  } finally {
    conn.release();
  }
}

async function repairIssue100Data() {
  const pool = getPool();
  const conn = await pool.getConnection();
  try {
    await assertSchema(conn);
    await conn.beginTransaction();
    const [billingResult] = await conn.query(
      `UPDATE projects p
       JOIN (
         SELECT company_id,MIN(billing_id) billing_id
         FROM company_billings
         WHERE is_deleted=0
         GROUP BY company_id
       ) cb ON cb.company_id=p.company_id
       SET p.billing_id=cb.billing_id,p.version=p.version+1
       WHERE JSON_UNQUOTE(JSON_EXTRACT(p.extra_data,'$.seed_key'))=? AND p.billing_id IS NULL`,
      [SEED_KEY]
    );
    await conn.query(
      `INSERT IGNORE INTO settlement_projects (settlement_type,settlement_id,project_id)
       SELECT 'invoice',l.invoice_id,d.project_id
       FROM invoice_daily_reports l
       JOIN daily_reports d ON d.daily_report_id=l.daily_report_id
       JOIN invoices i ON i.invoice_id=l.invoice_id
       WHERE JSON_UNQUOTE(JSON_EXTRACT(i.extra_data,'$.seed_key'))=?
       GROUP BY l.invoice_id,d.project_id`,
      [SEED_KEY]
    );
    await conn.query(
      `INSERT IGNORE INTO settlement_projects (settlement_type,settlement_id,project_id)
       SELECT 'payment',l.payment_id,d.project_id
       FROM payment_daily_reports l
       JOIN daily_reports d ON d.daily_report_id=l.daily_report_id
       JOIN payments p ON p.payment_id=l.payment_id
       WHERE JSON_UNQUOTE(JSON_EXTRACT(p.extra_data,'$.seed_key'))=?
       GROUP BY l.payment_id,d.project_id`,
      [SEED_KEY]
    );
    await conn.commit();
    console.log(`[verification-seed] Issue #100追従: 案件請求先 ${Number(billingResult.affectedRows||0)}件を設定しました`);
    console.log(JSON.stringify(await verificationSummary(conn), null, 2));
  } catch (error) {
    await conn.rollback();
    throw error;
  } finally {
    conn.release();
    await pool.end();
  }
}

function detachedExtra(value, source) {
  let extra = {};
  try { extra = typeof value === 'string' ? JSON.parse(value || '{}') : {...(value || {})}; } catch (_error) { extra = {}; }
  delete extra.seed_key;
  extra.detached_from_verification = source;
  return JSON.stringify(extra);
}

function clonedRow(row, idField, overrides) {
  const data = {...row, ...overrides};
  delete data[idField];
  delete data.created_at;
  delete data.updated_at;
  data.version = 1;
  return data;
}

async function detachExternalDerivedProjects() {
  if (process.env.NODE_ENV === 'production') throw new Error('本番モードでは検証データ参照の切離しを実行できません。');
  if (process.env.VERIFICATION_DETACH_CONFIRM !== 'DETACH_EXTERNAL_PROJECTS') throw new Error('VERIFICATION_DETACH_CONFIRM=DETACH_EXTERNAL_PROJECTS の明示指定が必要です。');
  const pool = getPool();
  const conn = await pool.getConnection();
  try {
    await assertSchema(conn);
    const [projects] = await conn.query(
      `SELECT p.* FROM projects p
       JOIN base_projects b ON b.base_project_id=p.base_project_id
       WHERE JSON_UNQUOTE(JSON_EXTRACT(b.extra_data,'$.seed_key'))=?
         AND (p.extra_data IS NULL OR JSON_UNQUOTE(JSON_EXTRACT(p.extra_data,'$.seed_key'))<>?)
       FOR UPDATE`,
      [SEED_KEY,SEED_KEY]
    );
    if (!projects.length) { console.log('[verification-seed] 切離し対象の案件はありません'); return; }
    await conn.beginTransaction();
    const companyMap = new Map(); const partnerMap = new Map(); const billingMap = new Map(); const baseMap = new Map();
    for (const project of projects) {
      if (!companyMap.has(Number(project.company_id))) {
        const [[source]] = await conn.query('SELECT * FROM companies WHERE company_id=? FOR UPDATE',[project.company_id]);
        const companyName = `${String(source.company_name||'').replace(PREFIX,'').replace(/（保持）$/,'')}（保持）`;
        const companyId = await insert(conn,'companies',clonedRow(source,'company_id',{
          company_name:companyName,
          office_no:`KEEP-${project.project_id}-${source.office_no||source.company_id}`.slice(0,50),
          extra_data:detachedExtra(source.extra_data,`company:${source.company_id}`),
        }));
        companyMap.set(Number(project.company_id),companyId);
        const [billings] = await conn.query('SELECT * FROM company_billings WHERE company_id=? AND is_deleted=0 ORDER BY billing_no,billing_id LIMIT 1',[project.company_id]);
        if (billings.length) {
          const billingId=await insert(conn,'company_billings',clonedRow(billings[0],'billing_id',{
            company_id:companyId,billing_no:1,billing_print_name:companyName,
            extra_data:detachedExtra(billings[0].extra_data,`billing:${billings[0].billing_id}`),
          }));
          billingMap.set(Number(project.company_id),billingId);
        }
      }
      if (project.partner_id && !partnerMap.has(Number(project.partner_id))) {
        const [[source]] = await conn.query('SELECT * FROM partners WHERE partner_id=? FOR UPDATE',[project.partner_id]);
        const partnerId=await insert(conn,'partners',clonedRow(source,'partner_id',{
          partner_name:`${String(source.partner_name||'').replace(/（検証）$/,'').replace(/（保持）$/,'')}（保持）`,
          extra_data:detachedExtra(source.extra_data,`partner:${source.partner_id}`),
        }));
        partnerMap.set(Number(project.partner_id),partnerId);
      }
      if (!baseMap.has(Number(project.base_project_id))) {
        const [[source]] = await conn.query('SELECT * FROM base_projects WHERE base_project_id=? FOR UPDATE',[project.base_project_id]);
        const baseProjectId=await insert(conn,'base_projects',clonedRow(source,'base_project_id',{
          company_id:companyMap.get(Number(project.company_id)),
          partner_id:source.partner_id ? partnerMap.get(Number(source.partner_id)) || null : null,
          template_name:`${String(source.template_name||'').replace(/（保持）$/,'')}（保持）`,
          extra_data:detachedExtra(source.extra_data,`base_project:${source.base_project_id}`),
        }));
        baseMap.set(Number(project.base_project_id),baseProjectId);
      }
      await conn.query(
        `UPDATE projects SET base_project_id=?,company_id=?,billing_id=?,partner_id=?,version=version+1,updated_at=CURRENT_TIMESTAMP WHERE project_id=?`,
        [baseMap.get(Number(project.base_project_id)),companyMap.get(Number(project.company_id)),billingMap.get(Number(project.company_id))||null,project.partner_id?partnerMap.get(Number(project.partner_id)):null,project.project_id]
      );
      const [priceSets]=await conn.query('SELECT price_set_id,extra_data FROM price_sets WHERE project_id=? FOR UPDATE',[project.project_id]);
      for(const priceSet of priceSets)await conn.query(
        'UPDATE price_sets SET company_id=?,base_project_id=NULL,extra_data=?,version=version+1,updated_at=CURRENT_TIMESTAMP WHERE price_set_id=?',
        [companyMap.get(Number(project.company_id)),detachedExtra(priceSet.extra_data,`price_set:${priceSet.price_set_id}`),priceSet.price_set_id]
      );
    }
    await conn.commit();
    console.log(`[verification-seed] 検証データ参照から通常案件 ${projects.length}件を切り離しました`);
  } catch (error) {
    await conn.rollback();
    throw error;
  } finally {
    conn.release();
    await pool.end();
  }
}

async function seed() {
  const pool = getPool();
  const conn = await pool.getConnection();
  let priceSetCount = 0;
  try {
    await assertSchema(conn);
    const [existing] = await conn.execute(
      `SELECT COUNT(*) AS count FROM companies WHERE company_name LIKE ? AND is_deleted = 0`,
      [`${PREFIX}%`]
    );
    if (Number(existing[0].count) > 0) {
      throw new Error(`「${PREFIX}」データは既に存在します。重複投入は行いません。reset-and-seed を使ってください。`);
    }

    await conn.beginTransaction();
    // 共通控除マスタは変更しない（精算作成月は 2026-02 以降で既存 valid_from=2026-01-01 が適用される）

    const companies = [];
    for (let index = 0; index < COMPANY_COUNT; index += 1) {
      const no = String(index + 1).padStart(3, '0');
      const name = companyName(index);
      const closing = CLOSING_CODES[index % CLOSING_CODES.length];
      const companyId = await insert(conn, 'companies', {
        office_no: `VS-${no}`,
        office_name: `首都圏営業所${no}`,
        company_name: name,
        company_name_kana: `ケンショウキギヨウ${no}`,
        zip_code: `10${String(index % 90).padStart(1, '0')}-000${index % 10}`,
        address: `東京都サンプル区検証${index % 40 + 1}-${(index % 9) + 1}-${(index % 5) + 1}`,
        contact: `03-${String(1000 + index).slice(-4)}-${String(2000 + index).slice(-4)}`,
        contract_manager: `${PREFIX}契約担当${no}`,
        our_manager: `${PREFIX}担当${no}`,
        our_contract_manager: `${PREFIX}契約管理${no}`,
        closing_date_code: closing,
        payment_date_code: CLOSING_CODES[(index + 2) % CLOSING_CODES.length],
        contract_date: '2025-10-01',
        business_content: '配送・調査・倉庫作業の請負',
        bank_name: 'サンプル銀行',
        branch_name: `支店${(index % 20) + 1}`,
        branch_code: String(100 + (index % 800)).padStart(3, '0'),
        account_number: String(1000000 + index),
        deposit_type: 'ordinary',
        account_name: name.replace(PREFIX, ''),
        account_name_kana: `ケンショウキギヨウ${no}`,
        invoice_send_method: index % 2 ? 'email' : 'post',
        extra_data: JSON.stringify({ seed_key: SEED_KEY, patterns: ['T-MST-01'] }),
      });
      // 合算用: 先頭12社を4グループにまとめ同一 summary_no
      const summaryGroup = index < 12 ? String(Math.floor(index / 3) + 1).padStart(2, '0') : no;
      const billingId = await insert(conn, 'company_billings', {
        company_id: companyId,
        billing_no: 0,
        billing_print_name: name,
        billing_address: `東京都サンプル区請求宛${index % 40 + 1}`,
        billing_phone: `03-${String(3000 + index).slice(-4)}-${String(4000 + index).slice(-4)}`,
        billing_fax: `03-${String(5000 + index).slice(-4)}-${String(6000 + index).slice(-4)}`,
        billing_manager: `${PREFIX}請求担当${no}`,
        billing_summary_no: `VS-BILL-${summaryGroup}`,
        extra_data: JSON.stringify({ seed_key: SEED_KEY, patterns: ['T-MST-02'] }),
      });
      await insert(conn, 'company_vehicles', {
        company_id: companyId,
        vehicle_name: `社有車${no}`,
        vehicle_number: `品川${300 + index}あ${String(1000 + index).slice(-4)}`,
        extra_data: JSON.stringify({ seed_key: SEED_KEY }),
      });
      await conn.execute(
        `INSERT INTO company_invoice_settings (company_id, display_mode, tax_rate, tax_rounding)
         VALUES (?,?,0.10,'floor')
         ON DUPLICATE KEY UPDATE display_mode=VALUES(display_mode)`,
        [companyId, index % 3 === 0 ? 'project_aggregated' : 'detailed']
      );
      companies.push({ id: companyId, billingId, name, closing, summaryGroup });
    }

    const partners = [];
    for (let index = 0; index < PARTNER_COUNT; index += 1) {
      const no = String(index + 1).padStart(3, '0');
      const incompleteAccount = index >= 140 && index < 145;
      const partnerId = await insert(conn, 'partners', {
        partner_name: partnerName(index),
        partner_name_kana: `ケンショウパートナー${no}`,
        zip_code: `20${index % 10}-00${String(index % 100).padStart(2, '0')}`,
        address: `埼玉県サンプル市検証${index % 30 + 1}-${(index % 8) + 1}`,
        contact_phone: `090-${String(1000 + index).slice(-4)}-${String(2000 + index).slice(-4)}`,
        contract_date: '2025-10-15',
        partner_category_code: index % 3 === 0 ? 'individual' : 'sole_proprietor',
        employment_type_code: 'outsourcing',
        advance_payment_enabled: index < 25 ? 1 : 0,
        payment_output_code: index % 7 === 0 ? 'type_b' : 'type_a',
        bank_name: incompleteAccount ? 'サンプル銀行' : 'サンプル銀行',
        branch_name: incompleteAccount ? null : `出張所${(index % 15) + 1}`,
        branch_code: incompleteAccount ? null : String(200 + (index % 700)).padStart(3, '0'),
        account_number: incompleteAccount ? null : String(2000000 + index),
        deposit_type: 'ordinary',
        account_name: incompleteAccount ? null : partnerName(index).replace(PREFIX, ''),
        account_name_kana: incompleteAccount ? null : `ケンショウパートナー${no}`,
        extra_data: JSON.stringify({
          seed_key: SEED_KEY,
          patterns: incompleteAccount ? ['T-MST-05', 'T-CASH-07'] : ['T-MST-05'],
          account_incomplete: incompleteAccount,
        }),
      });
      const vehicleId = await insert(conn, 'partner_vehicles', {
        partner_id: partnerId,
        vehicle_name: `営業車両${no}`,
        vehicle_number: `埼玉${400 + index}い${String(2000 + index).slice(-4)}`,
        extra_data: JSON.stringify({ seed_key: SEED_KEY }),
      });
      partners.push({ id: partnerId, vehicleId, incompleteAccount, advance: index < 25 });
      if (index === 3) {
        await insert(conn, 'settlement_deduction_rules', {
          rule_code: 'office_fee',
          scope: 'partner',
          partner_id: partnerId,
          display_name: '事務手数料（個別上書き）',
          amount: 2200,
          tax_category: 'taxable',
          valid_from: '2025-11-01',
          is_active: 1,
        });
      }
    }

    const baseProjects = [];
    for (let index = 0; index < BASE_COUNT; index += 1) {
      const company = companies[index % companies.length];
      const baseName = baseProjectName(index);
      const baseProjectId = await insert(conn, 'base_projects', {
        company_id: company.id,
        billing_id: company.billingId,
        partner_id: null,
        template_name: baseName,
        default_manager: '業務管理部',
        business_type: shortProjectName(baseName),
        basic_work_hours: 8,
        work_time_type: 'actual',
        payment_type: 'normal',
        operation_start_date: '2025-11-01',
        closing_date: CLOSING_CODES[index % CLOSING_CODES.length],
        execution_time_start: '08:00',
        execution_time_end: '17:00',
        binding_time: 9,
        break_time: 1,
        overtime_calc_type: 'after_basic',
        daily_count_type: 'actual',
        work_mode_code: 'regular',
        rounding_timing_type: 'daily',
        overtime_accumulation_type: 'daily',
        distance_calc_mode: 'per_km',
        distance_calc_amount: 80,
        extra_data: JSON.stringify({ seed_key: SEED_KEY, patterns: ['T-PRJ-01'] }),
      });
      baseProjects.push({ id: baseProjectId, name: baseName, companyId: company.id, companyName: company.name });
    }
    // 金額200件目標: 基本テンプレ50 + 個別150 (+改定分)
    for (let index = 0; index < 50; index += 1) {
      const base = baseProjects[index];
      const extra = priceExtra({ index, companyLabel: base.companyName, baseName: base.name });
      const setId = await insert(conn, 'price_sets', {
        price_set_no: `VS-B-${String(index + 1).padStart(3, '0')}`,
        price_set_name: priceName('平日料金', base.companyName, base.name),
        company_id: base.companyId,
        base_project_id: base.id,
        apply_start_date: '2025-11-01',
        extra_data: JSON.stringify(extra),
      });
      priceSetCount += 1;
      await insert(conn, 'price_set_lines', {
        price_set_id: setId,
        weekday_code: 'weekday',
        calc_type_code: 'daily',
        price_type_code: 'basic',
        billing_unit_price: 20000,
        payment_unit_price: 15500,
        sort_order: 10,
      });
    }

    const projects = [];
    for (let index = 0; index < PROJECT_COUNT; index += 1) {
      const scenario = matrixScenario(index) || (index < 100 ? 'standard' : 'ops');
      const baseIndex = index < BASE_COUNT ? index : index % BASE_COUNT;
      // 合算マトリクス: 同一企業に複数案件
      let company;
      if (['matrix-consolidate-a', 'matrix-consolidate-b', 'matrix-consolidate-c'].includes(scenario)) {
        company = companies[0];
      } else if (scenario === 'matrix-payment-bias-a' || scenario === 'matrix-payment-bias-b') {
        company = companies[1];
      } else {
        company = companies[baseIndex % companies.length];
      }
      const partner = scenario === 'matrix-unassigned' ? null : partners[index % partners.length];
      // 支払額差ペアは同一パートナー系統で別インデックス
      const paymentBias = scenario === 'matrix-payment-bias-b' ? 0.92 : (index % 17 === 0 ? 0.95 : 1);
      const base = baseProjects[baseIndex];
      const variant = PROJECT_VARIANTS[Math.floor(index / 10) % PROJECT_VARIANTS.length];
      const isInstallment = scenario === 'matrix-installment'
        || scenario === 'matrix-installment-zero'
        || (index < 18 && partners[index % partners.length]?.advance);
      const operationStart = scenario === 'matrix-late-start'
        ? '2026-06-01'
        : (index >= 100 && index < MATRIX_START ? '2026-03-01' : '2025-11-01');
      const operationEnd = scenario === 'matrix-ended' ? '2026-06-30' : null;
      const execStart = scenario === 'matrix-standard' || index === 42 ? '07:30' : '08:00';
      const execEnd = scenario === 'matrix-standard' || index === 42 ? '16:30' : '17:00';
      const breakMinutes = index === 42 ? 45 : 60;
      const projectId = await insert(conn, 'projects', {
        base_project_id: base.id,
        company_id: company.id,
        billing_id: company.billingId,
        partner_id: partner?.id || null,
        vehicle_id: partner?.vehicleId || null,
        manager_name: `${variant}担当`,
        business_type: `${shortProjectName(base.name)}｜${variant}`,
        payment_type: isInstallment ? 'installment' : 'normal',
        installment_amount: isInstallment ? 7000 : null,
        operation_start_date: operationStart,
        closing_date: CLOSING_CODES[index % CLOSING_CODES.length],
        execution_time_start: execStart,
        execution_time_end: execEnd,
        binding_time: 9,
        break_time: breakMinutes / 60,
        overtime_calc_type: 'after_basic',
        daily_count_type: 'actual',
        work_mode_code: 'regular',
        rounding_timing_type: 'daily',
        overtime_accumulation_type: 'daily',
        distance_calc_mode: 'per_km',
        distance_calc_amount: 80,
        distance_table_json: JSON.stringify([{ from: 0, to: 100, unit_price: 80 }]),
        extra_data: JSON.stringify({
          seed_key: SEED_KEY,
          scenario,
          operation_end: operationEnd,
          patterns: scenario && scenario.startsWith('matrix-') ? [scenario] : ['T-PRJ-04'],
        }),
      });

      const setId = await insert(conn, 'price_sets', {
        price_set_no: `VS-P-${String(index + 1).padStart(3, '0')}`,
        price_set_name: priceName('平日料金', company.name, base.name),
        company_id: company.id,
        project_id: projectId,
        apply_start_date: operationStart,
        extra_data: JSON.stringify(priceExtra({
          index, companyLabel: company.name, baseName: base.name, paymentBias, scenario,
        })),
      });
      priceSetCount += 1;
      await insert(conn, 'price_set_lines', {
        price_set_id: setId,
        weekday_code: 'weekday',
        calc_type_code: 'daily',
        price_type_code: 'basic',
        billing_unit_price: Math.round(20000 * (scenario === 'matrix-sep-revision' ? 1 : 1)),
        payment_unit_price: Math.round(15500 * paymentBias),
        sort_order: 10,
      });

      // 途中改定: 一部案件に追加PriceSet
      const needsRevision = [
        'matrix-revision-cross', 'matrix-sep-revision',
      ].includes(scenario) || (index > 0 && index % 11 === 0 && index < MATRIX_START);
      if (needsRevision) {
        const revisionStart = scenario === 'matrix-sep-revision' ? '2026-09-01' : '2026-04-01';
        const revExtra = priceExtra({
          index, companyLabel: company.name, baseName: base.name, paymentBias, scenario, revision: true,
        });
        revExtra.revision = true;
        const revId = await insert(conn, 'price_sets', {
          price_set_no: `VS-P-${String(index + 1).padStart(3, '0')}-R`,
          price_set_name: priceName('平日料金改定', company.name, base.name),
          company_id: company.id,
          project_id: projectId,
          apply_start_date: revisionStart,
          extra_data: JSON.stringify(revExtra),
        });
        priceSetCount += 1;
        await insert(conn, 'price_set_lines', {
          price_set_id: revId,
          weekday_code: 'weekday',
          calc_type_code: 'daily',
          price_type_code: 'basic',
          billing_unit_price: 21600,
          payment_unit_price: Math.round(16740 * paymentBias),
          sort_order: 10,
        });
      }

      if (isInstallment && partner) {
        await insert(conn, 'project_advance_terms', {
          project_id: projectId,
          valid_from: operationStart,
          is_enabled: 1,
          unit_price: 7000,
        });
      }

      projects.push({
        index,
        projectId,
        companyId: company.id,
        partnerId: partner?.id || null,
        vehicleId: partner?.vehicleId || null,
        baseName: base.name,
        variant,
        scenario,
        operationStart,
        operationEnd,
        execStart,
        execEnd,
        breakMinutes,
        isInstallment,
        paymentBias,
      });
    }

    const holidays = [
      '2025-11-03', '2025-11-24', '2025-12-23',
      '2026-01-01', '2026-01-12', '2026-02-11', '2026-02-23', '2026-03-20',
      '2026-04-29', '2026-05-03', '2026-05-04', '2026-05-05', '2026-05-06',
      '2026-07-20', '2026-08-11', '2026-09-21', '2026-09-22', '2026-09-23',
    ];
    for (const holiday of holidays) {
      await insert(conn, 'holidays', {
        holiday_date: holiday,
        holiday_name: `${PREFIX}共通休日`,
        is_active: 1,
        extra_data: JSON.stringify({ seed_key: SEED_KEY }),
      });
    }
    // 案件独自休日（先頭マトリクス案件）
    if (projects[MATRIX_START]) {
      await insert(conn, 'holidays', {
        holiday_date: '2026-09-18',
        holiday_name: `${PREFIX}案件独自休日`,
        project_id: projects[MATRIX_START].projectId,
        is_active: 1,
        extra_data: JSON.stringify({ seed_key: SEED_KEY, patterns: ['T-MST-10'] }),
      });
    }

    // applyDailyPriceCalc は別接続のため料金・休日を先に確定
    await conn.commit();
    await conn.beginTransaction();

    console.log('[verification-seed] creating daily reports...');
    for (const project of projects) {
      let position = 0;
      for (const ym of MONTHS) {
        const dates = reportDates(project, ym);
        const uniqueDates = [...new Set(dates)];
        for (const date of uniqueDates) {
          const multi = dates.filter((d) => d === date).length > 1;
          const inputs = [reportInput(project, date, position)];
          if (multi) inputs.push(reportInput(project, date, position, { secondRow: true }));
          for (const raw of inputs) {
            let data;
            try {
              data = await applyDailyPriceCalc(raw);
            } catch (error) {
              // 欠勤などは計算スキップがあり得るため、最低限の行を残す
              data = {
                ...raw,
                break_time: (raw.break_minutes || 0) / 60,
                calculated_billing_amount: 0,
                calculated_payment_amount: 0,
                calculation_detail: JSON.stringify({ seed_fallback: true, message: error.message }),
                binding_hours: null, work_hours: null, overtime_hours: null, shortage_hours: null,
                shortage_minutes_billing: 0, shortage_minutes_payment: 0,
                shortage_amount_billing: 0, shortage_amount_payment: 0,
                night_hours: null, night_minutes_billing: null, night_minutes_payment: null,
                night_overtime_minutes_billing: null, night_overtime_minutes_payment: null,
                regular_overtime_minutes_billing: null, regular_overtime_minutes_payment: null,
                selected_fee_item_id: raw.selected_fee_item_id || null,
                selected_fee_item_name: null,
                fee_item_selection_source: raw.fee_item_selection_source || 'auto',
                applied_price_set_id: null,
              };
            }
            let status = 'confirmed';
            if (ym < '2026-08' && project.index < 100) status = 'approved';
            else if (ym === '2026-08' && project.index < 80) status = 'approved';
            else if (ym === MATRIX_MONTH) {
              if (project.scenario === 'matrix-status-mix') {
                status = position % 3 === 0 ? 'draft' : (position % 3 === 1 ? 'confirmed' : 'approved');
              } else if (project.scenario === 'matrix-reject') {
                status = 'confirmed';
              } else if (project.scenario === 'matrix-draft-invoice') {
                status = 'approved';
              } else if (project.index >= MATRIX_START) {
                status = 'approved';
              } else {
                status = position % 5 === 0 ? 'draft' : 'confirmed';
              }
            } else if (position % 5 === 0) status = 'draft';

            const reportId = await insert(conn, 'daily_reports', {
              project_id: data.project_id,
              company_id: data.company_id,
              partner_id: data.partner_id,
              vehicle_id: data.vehicle_id,
              target_year_month: data.target_year_month,
              work_date: data.work_date,
              start_time: data.start_time,
              end_time: data.end_time,
              break_time: data.break_time,
              break_minutes: data.break_minutes,
              is_absent: data.is_absent || 0,
              is_training: data.is_training || 0,
              start_meter: data.start_meter,
              end_meter: data.end_meter,
              total_distance: data.total_distance,
              toll_fee: data.toll_fee,
              parking_fee: data.parking_fee,
              transport_fee: data.transport_fee,
              row_comment: data.row_comment,
              input_source_type: data.input_source_type,
              selected_fee_item_id: data.selected_fee_item_id,
              selected_fee_item_name: data.selected_fee_item_name,
              fee_item_selection_source: data.fee_item_selection_source || 'auto',
              rate_overrides: data.rate_overrides ? JSON.stringify(data.rate_overrides) : null,
              rate_override_reason: data.rate_override_reason || null,
              applied_price_set_id: data.applied_price_set_id,
              binding_hours: data.binding_hours,
              work_hours: data.work_hours,
              overtime_hours: data.overtime_hours,
              shortage_hours: data.shortage_hours,
              shortage_minutes_billing: data.shortage_minutes_billing || 0,
              shortage_minutes_payment: data.shortage_minutes_payment || 0,
              shortage_amount_billing: data.shortage_amount_billing || 0,
              shortage_amount_payment: data.shortage_amount_payment || 0,
              night_hours: data.night_hours,
              night_break_minutes_billing: data.night_break_minutes_billing || 0,
              night_break_minutes_payment: data.night_break_minutes_payment || 0,
              night_minutes_billing: data.night_minutes_billing,
              night_minutes_payment: data.night_minutes_payment,
              night_overtime_minutes_billing: data.night_overtime_minutes_billing,
              night_overtime_minutes_payment: data.night_overtime_minutes_payment,
              regular_overtime_minutes_billing: data.regular_overtime_minutes_billing,
              regular_overtime_minutes_payment: data.regular_overtime_minutes_payment,
              calculated_billing_amount: data.calculated_billing_amount,
              calculated_payment_amount: data.calculated_payment_amount,
              calculation_detail: data.calculation_detail,
              status,
              extra_data: JSON.stringify({ seed_key: SEED_KEY, scenario: project.scenario }),
            });
            if (status === 'confirmed') {
              await insert(conn, 'daily_report_confirmation_snapshots', {
                daily_report_id: reportId,
                confirmation_version: 1,
                snapshot_data: JSON.stringify({ seed_key: SEED_KEY, source: 'verification-seed' }),
              });
            }
            if (project.scenario === 'matrix-reject' && status === 'confirmed') {
              await conn.execute(
                `UPDATE daily_reports SET status='draft',
                  extra_data = JSON_SET(COALESCE(extra_data, JSON_OBJECT()), '$.rejected', true, '$.reject_reason', '検証用差戻し')
                 WHERE daily_report_id = ?`,
                [reportId]
              );
            }
            position += 1;
          }
        }
      }
    }

    // 提出一覧（2026-09）
    console.log('[verification-seed] creating submissions / advances / approvals...');
    for (const project of projects.filter((p) => p.index >= MATRIX_START || p.index < 30)) {
      for (const [groupIndex, groupCode] of ['early', 'middle', 'late'].entries()) {
        let isSubmitted = 0;
        let submittedDate = null;
        let overdueDays = null;
        if (project.scenario === 'matrix-submission') {
          if (groupCode === 'early') { isSubmitted = 1; submittedDate = '2026-09-06'; overdueDays = 0; }
          else if (groupCode === 'middle') { isSubmitted = 0; overdueDays = 3; }
          else { isSubmitted = 1; submittedDate = '2026-09-28'; overdueDays = 2; }
        } else if (groupIndex === 0) {
          isSubmitted = 1; submittedDate = `${MATRIX_MONTH}-08`; overdueDays = 0;
        }
        await insert(conn, 'daily_report_submissions', {
          target_year_month: MATRIX_MONTH,
          project_id: project.projectId,
          group_code: groupCode,
          is_submitted: isSubmitted,
          submitted_date: submittedDate,
          overdue_days: overdueDays,
        });
      }
    }

    // 先払（運用月 + マトリクス）
    for (const ym of ['2026-05', '2026-08', MATRIX_MONTH]) {
      const advanceCycles = await ensureVerificationCycles(conn, ym);
      const advanceCycle = advanceCycles.find((x) => x.cycle_code === '20') || advanceCycles[0];
      for (const project of projects.filter((p) => p.isInstallment && p.partnerId)) {
        if (project.scenario === 'matrix-installment-zero' && ym === MATRIX_MONTH) {
          const termRows = await conn.execute(
            `SELECT project_advance_term_id FROM project_advance_terms WHERE project_id=? AND is_deleted=0 LIMIT 1`,
            [project.projectId]
          );
          const termId = termRows[0][0]?.project_advance_term_id;
          await insert(conn, 'advance_records', {
            project_id: project.projectId,
            partner_id: project.partnerId,
            company_id: project.companyId,
            target_year_month: ym,
            group_code: 'early',
            project_advance_term_id: termId || null,
            period_start: `${ym}-01`,
            period_end: `${ym}-10`,
            payment_date: `${ym}-20`,
            work_days: 0,
            calculated_amount: 0,
            advance_amount: 0,
            status: 'planned',
          });
          continue;
        }
        const [days] = await conn.execute(
          `SELECT COUNT(DISTINCT work_date) count FROM daily_reports
            WHERE project_id=? AND target_year_month=? AND status IN ('approved','confirmed') AND is_deleted=0 AND is_absent=0`,
          [project.projectId, ym]
        );
        const workDays = Number(days[0].count);
        if (!workDays && project.scenario !== 'matrix-installment') continue;
        const amount = Math.max(workDays, project.scenario === 'matrix-installment' ? 1 : 0) * 7000;
        const effectiveDays = workDays || (project.scenario === 'matrix-installment' ? 1 : 0);
        if (!effectiveDays) continue;
        const [termRows] = await conn.execute(
          `SELECT project_advance_term_id FROM project_advance_terms WHERE project_id=? AND is_deleted=0 LIMIT 1`,
          [project.projectId]
        );
        const termId = termRows[0]?.project_advance_term_id || null;
        const adjusted = project.scenario === 'matrix-installment' && ym === MATRIX_MONTH;
        const scheduleId = await insert(conn, 'cash_schedules', {
          cash_cycle_id: advanceCycle.cash_cycle_id,
          direction: 'outgoing',
          source_type: 'advance',
          company_id: project.companyId,
          partner_id: project.partnerId,
          project_id: project.projectId,
          counterparty_name: `${PREFIX}パートナー`,
          title: '前払（匿名検証用）',
          amount: adjusted ? amount + 500 : amount,
          scheduled_date: advanceCycle.planned_outgoing_date,
          status: ym === MATRIX_MONTH && project.scenario === 'matrix-installment' ? 'planned' : 'executed',
          snapshot_json: JSON.stringify({ seed_key: SEED_KEY }),
        });
        const recordId = await insert(conn, 'advance_records', {
          project_id: project.projectId,
          partner_id: project.partnerId,
          company_id: project.companyId,
          target_year_month: ym,
          group_code: 'middle',
          project_advance_term_id: termId,
          period_start: `${ym}-11`,
          period_end: `${ym}-20`,
          payment_date: `${ym}-20`,
          work_days: effectiveDays,
          calculated_amount: amount,
          advance_amount: adjusted ? amount + 500 : amount,
          transfer_fee_amount: adjusted ? 330 : 0,
          adjustment_reason: adjusted ? '検証用手修正' : null,
          status: ym === MATRIX_MONTH && project.scenario === 'matrix-installment' ? 'planned' : 'executed',
          cash_schedule_id: scheduleId,
        });
        await conn.execute(
          `UPDATE cash_schedules SET source_id=?, snapshot_json=? WHERE cash_schedule_id=?`,
          [recordId, JSON.stringify({ seed_key: SEED_KEY, advance_record_id: recordId }), scheduleId]
        );
        if (ym !== MATRIX_MONTH || project.scenario !== 'matrix-installment') {
          await insert(conn, 'cash_transactions', {
            cash_schedule_id: scheduleId,
            executed_date: advanceCycle.planned_outgoing_date,
            executed_amount: adjusted ? amount + 500 : amount,
            status: 'executed',
            bank_name: 'サンプル銀行',
          });
        }
      }
    }

    // 取消済み先払サンプル（T-PAY-05）
    const cancelProject = projects.find((p) => p.scenario === 'matrix-installment');
    if (cancelProject) {
      const cycles = await ensureVerificationCycles(conn, MATRIX_MONTH);
      const cycle = cycles.find((x) => x.cycle_code === 'end') || cycles[0];
      const scheduleId = await insert(conn, 'cash_schedules', {
        cash_cycle_id: cycle.cash_cycle_id, direction: 'outgoing', source_type: 'advance',
        company_id: cancelProject.companyId, partner_id: cancelProject.partnerId, project_id: cancelProject.projectId,
        counterparty_name: `${PREFIX}パートナー`, title: '前払取消サンプル', amount: 7000,
        scheduled_date: cycle.planned_outgoing_date, status: 'cancelled',
        snapshot_json: JSON.stringify({ seed_key: SEED_KEY, pattern: 'T-PAY-05' }),
      });
      await insert(conn, 'advance_records', {
        project_id: cancelProject.projectId, partner_id: cancelProject.partnerId, company_id: cancelProject.companyId,
        target_year_month: MATRIX_MONTH, group_code: 'late',
        period_start: `${MATRIX_MONTH}-21`, period_end: `${MATRIX_MONTH}-30`, payment_date: `${MATRIX_MONTH}-30`,
        work_days: 1, calculated_amount: 7000, advance_amount: 7000, status: 'cancelled', cash_schedule_id: scheduleId,
      });
    }

    const [approvedGroups] = await conn.execute(
      `SELECT project_id, target_year_month FROM daily_reports
        WHERE status='approved' AND JSON_UNQUOTE(JSON_EXTRACT(extra_data,'$.seed_key'))=?
        GROUP BY project_id, target_year_month`,
      [SEED_KEY]
    );
    for (const group of approvedGroups) {
      const [approvedReports] = await conn.execute(
        `SELECT * FROM daily_reports
          WHERE project_id=? AND target_year_month=? AND status='approved' AND is_deleted=0
          ORDER BY work_date, daily_report_id`,
        [group.project_id, group.target_year_month]
      );
      await insert(conn, 'daily_report_monthly_approvals', {
        project_id: group.project_id,
        target_year_month: group.target_year_month,
        approval_version: 1,
        status: 'approved',
        snapshot_data: JSON.stringify({
          seed_key: SEED_KEY,
          project_id: group.project_id,
          target_year_month: group.target_year_month,
          reports: approvedReports,
        }),
        note: '匿名検証用月次承認',
      });
    }

    console.log('[verification-seed] creating settlements...');
    let docSeq = 1;
    for (const ym of OPS_SETTLE_MONTHS) {
      const result = await createSettlementsForMonth(conn, ym, {
        maxCompanies: ym === '2026-05' ? 12 : 6,
        maxPartners: ym === '2026-05' ? 10 : 5,
        withDocuments: ym === '2026-05',
        documentSequenceStart: docSeq,
      });
      docSeq = result.documentSequence;
    }
    await createSettlementsForMonth(conn, MATRIX_MONTH, {
      maxCompanies: 10,
      maxPartners: 8,
      withDocuments: true,
      documentSequenceStart: docSeq,
    });

    // 口座不備パートナー向けの出金予定（T-CASH-07）
    const incomplete = partners.find((p) => p.incompleteAccount);
    if (incomplete) {
      const cycles = await ensureVerificationCycles(conn, MATRIX_MONTH);
      const cycle = cycles.find((x) => x.cycle_code === '25') || cycles[0];
      await insert(conn, 'cash_schedules', {
        cash_cycle_id: cycle.cash_cycle_id,
        direction: 'outgoing',
        source_type: 'payment',
        partner_id: incomplete.id,
        counterparty_name: partnerName(140),
        title: '口座不備検証用出金',
        amount: 10000,
        scheduled_date: cycle.planned_outgoing_date,
        status: 'planned',
        snapshot_json: JSON.stringify({ seed_key: SEED_KEY, pattern: 'T-CASH-07', account_incomplete: true }),
      });
    }

    await conn.commit();
    const summary = await verificationSummary(conn);
    summary.price_sets_created = priceSetCount;
    console.log(JSON.stringify(summary, null, 2));
  } catch (error) {
    await conn.rollback();
    throw error;
  } finally {
    conn.release();
    await pool.end();
  }
}

async function main() {
  if (process.argv.includes('--repair-issue100')) {
    await repairIssue100Data();
    return;
  }
  if (process.argv.includes('--detach-external-projects')) {
    await detachExternalDerivedProjects();
    return;
  }
  if (process.argv.includes('--reset')) {
    await resetBusinessData();
    await seed();
    return;
  }
  if (process.argv.includes('--verify')) {
    const pool = getPool();
    const conn = await pool.getConnection();
    try {
      await assertSchema(conn);
      console.log(JSON.stringify(await verificationSummary(conn), null, 2));
    } finally {
      conn.release();
      await pool.end();
    }
    return;
  }
  await seed();
}

main().catch((error) => {
  console.error('[verification-seed] failed:', error.message);
  console.error(error.stack);
  process.exit(1);
});
