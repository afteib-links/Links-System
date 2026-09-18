const { getFunctionRuleCatalog } = require('./calculation_rule_engine');

const CATEGORY_LABELS = Object.freeze({
  workflow:'業務フロー',
  daily:'日報・料金',
  time:'時間計算',
  distance:'距離計算',
  settlement:'請求・支払',
  arithmetic:'四則・数値演算',
  comparison:'比較演算',
  logical:'条件・論理',
  rounding:'端数処理',
});

const existing = (category_code, function_code, function_name, summary, formula, inputs, outputs, source, usage) => ({
  category_code,function_code,function_name,summary,formula,inputs,outputs,source,usage,
  implementation_status:'existing_process',selection_status:'unselected',
});

const expression = (category_code, function_code, function_name, formula, summary) => ({
  category_code,function_code,function_name,summary,formula,inputs:['値・変数・式'],outputs:['数値または真偽値'],
  source:'backend/src/services/price_rule_expression.js',usage:'料金行の条件式・請求式・支払式',
  implementation_status:'expression_available',selection_status:'unselected',
});

const FUNCTION_CANDIDATES = Object.freeze([
  existing('daily','select_price_set','適用金額データ選択','勤務日が適用期間内の金額データから、開始日とIDが最新の1件を選びます。','適用開始日 ≤ 勤務日 ≤ 適用終了日', ['案件','勤務日','金額データ版'],['PriceSet'], 'backend/src/services/price_calc.js','日報計算の開始時'),
  existing('daily','select_fee_item','料金項目選択','勤務日、曜日、休日、研修、手動指定から使用する料金項目を決定します。','手動指定を優先し、条件一致する料金項目を選択', ['料金項目','勤務日','休日状態','研修区分','手動指定'],['料金項目','選択理由'], 'backend/src/services/price_calc_config.js','日報の単価解決'),
  existing('daily','first_matching_fee_rule','料金行の先勝ち選択','同じ項目種別では並び順が最初で条件に一致した有効行を採用します。','項目種別ごとに first(condition = true)', ['料金行','日報変数'],['選択料金行','警告'], 'backend/src/services/fee_item_rules.js','料金項目内のルール選択'),
  existing('daily','evaluate_fee_amount','料金行金額式','請求式または支払式を評価し、式がなければ登録単価を使います。','式あり: EVAL(expression) / 式なし: 登録金額', ['料金行','請求・支払区分','日報変数'],['単価・金額'], 'backend/src/services/fee_item_rules.js','日報の料金行'),
  existing('daily','apply_rate_override','一時単価上書き','理由付きの一時単価がある場合に、登録単価より優先します。','effective_rate = override ?? configured_rate', ['登録単価','一時単価','変更理由'],['適用単価','上書き有無'], 'backend/src/services/night_calc.js','日報の時間別金額'),
  existing('time','parse_clock_minutes','時刻の分変換','H:MM形式の時刻を0時からの分へ変換し、0:00～47:59を検証します。','minutes = hour × 60 + minute', ['時刻文字列'],['分'], 'backend/src/services/night_calc.js','開始・終了時刻'),
  existing('time','parse_duration_minutes','時間量の分変換','H:MM、分、または小数時間を分へ正規化します。','H:MM → 分 / 小数時間 × 60 → 分', ['時間量'],['分'], 'backend/src/services/night_calc.js','休憩時間等'),
  existing('time','classify_work_minutes','勤務時間区分','拘束・休憩・標準時間・深夜帯から通常、不足、時間外、深夜、深夜時間外を分単位で分類します。','勤務 = 終了 - 開始 - 休憩。各区分の重複を除いて配分', ['開始・終了','休憩','標準時間','深夜帯','調整'],['各時間区分（分）'], 'backend/src/services/night_calc.js','日報の請求側・支払側'),
  existing('time','calculate_time_amounts','時間別金額','基本、不足、時間外、深夜、深夜時間外を日額または時間単価で計算します。','日額 または 単価 × 分 ÷ 60。不足は負額', ['時間区分','料金項目','適用単価','端数設定'],['区分別金額','日次合計'], 'backend/src/services/night_calc.js','日報金額'),
  existing('time','round_minutes','時間丸め','指定分単位で切捨て、四捨五入、切上げを行います。','ROUND_MODE(minutes ÷ unit) × unit', ['分','丸め単位','丸め方式'],['丸め後の分'], 'backend/src/services/night_calc.js','通常・不足・時間外・深夜時間'),
  existing('distance','calculate_distance_daily','日次・段階距離金額','日次超過または段階制の距離料金を、固定・全距離・超過距離・段階累積方式で計算します。','距離条件に応じて固定額または対象km × 単価', ['日次距離','距離ルール','端数設定'],['距離金額','計算根拠'], 'backend/src/services/distance_calc.js','日報の請求側・支払側'),
  existing('distance','calculate_distance_monthly','月間距離金額','対象月の日報距離を合計し、月間超過ルールを一度だけ適用します。','月間距離 = Σ日次距離', ['日次距離一覧','月間距離ルール'],['月間距離金額','計算根拠'], 'backend/src/services/distance_calc.js','月次承認・精算'),
  existing('settlement','effective_report_amount','日報有効金額','日報に手入力上書き額がある場合は計算額より優先します。','effective = override ?? calculated', ['計算額','手入力上書き額','請求・支払区分'],['有効金額'], 'backend/src/services/settlement_line_builder.js','請求・支払明細作成'),
  existing('settlement','build_monthly_lines','月次明細集約','日報の計算内訳を案件・料金要素・単価・税区分単位で請求または支払明細へ集約します。','同一キーの数量・金額を合計。上書き時は調整後料金へ集約', ['承認済み日報','請求・支払区分','明細設定'],['月次明細'], 'backend/src/services/settlement_line_builder.js','請求・支払下書き'),
  existing('settlement','resolve_invoice_tax','請求税率・端数解決','請求先、案件、システム設定の優先順位で税率と端数方式を決定します。','請求先設定 > 案件設定 > システム設定', ['請求先','対象案件'],['税率','端数方式'], 'backend/src/services/settlement_tax.js','請求再計算・確定'),
  expression('arithmetic','ADD','加算','a + b','2つの数値を加えます。'),
  expression('arithmetic','SUBTRACT','減算','a - b','左の数値から右の数値を引きます。'),
  expression('arithmetic','MULTIPLY','乗算','a * b','2つの数値を掛けます。'),
  expression('arithmetic','DIVIDE','除算','a / b','左の数値を右の数値で割ります。0除算はエラーです。'),
  expression('arithmetic','MOD','剰余','a % b','除算の余りを返します。0除算はエラーです。'),
  expression('arithmetic','POWER','べき乗','a ^ b','aをb乗します。'),
  expression('comparison','EQUAL','等しい','a = b','2つの値が等しいか判定します。'),
  expression('comparison','NOT_EQUAL','等しくない','a <> b','2つの値が異なるか判定します。'),
  expression('comparison','LESS_THAN','未満','a < b','左の値が右の値より小さいか判定します。'),
  expression('comparison','LESS_OR_EQUAL','以下','a <= b','左の値が右の値以下か判定します。'),
  expression('comparison','GREATER_THAN','超過','a > b','左の値が右の値より大きいか判定します。'),
  expression('comparison','GREATER_OR_EQUAL','以上','a >= b','左の値が右の値以上か判定します。'),
  expression('logical','IF','条件分岐','IF(condition, yes, no)','条件により2つの値から1つを返します。'),
  expression('logical','AND','すべて一致','AND(value, ...)','すべての条件が真か判定します。'),
  expression('logical','OR','いずれか一致','OR(value, ...)','いずれかの条件が真か判定します。'),
  expression('logical','NOT','否定','NOT(value)','真偽を反転します。'),
  expression('arithmetic','ABS','絶対値','ABS(value)','数値の絶対値を返します。'),
  expression('arithmetic','MIN','最小値','MIN(value, ...)','複数値の最小値を返します。'),
  expression('arithmetic','MAX','最大値','MAX(value, ...)','複数値の最大値を返します。'),
  expression('rounding','ROUND','四捨五入','ROUND(value, digits)','指定桁で四捨五入します。'),
  expression('rounding','ROUNDDOWN','切捨て','ROUNDDOWN(value, digits)','指定桁で0方向へ切り捨てます。'),
  expression('rounding','ROUNDUP','切上げ','ROUNDUP(value, digits)','指定桁で0から離れる方向へ切り上げます。'),
]);

function getCalculationFunctionCatalog() {
  const workflow = getFunctionRuleCatalog().map((rule) => ({
    ...rule,category_code:'workflow',usage:`${rule.stage_code} / ${rule.side_code}`,
    implementation_status:'active_handler',selection_status:'unselected',
  }));
  return [...workflow,...FUNCTION_CANDIDATES].map((rule) => ({
    ...rule,category_name:CATEGORY_LABELS[rule.category_code] || rule.category_code,
    inputs:[...(rule.inputs || [])],outputs:[...(rule.outputs || [])],
  }));
}

module.exports = { CATEGORY_LABELS,FUNCTION_CANDIDATES,getCalculationFunctionCatalog };
