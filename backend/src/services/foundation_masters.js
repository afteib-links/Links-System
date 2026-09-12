const CODE_ROWS = [
  ['closing_date','5','5日',10],['closing_date','10','10日',20],['closing_date','15','15日',30],['closing_date','20','20日',40],['closing_date','25','25日',50],['closing_date','end','末日',60],
  ['payment_date','5','5日',10],['payment_date','10','10日',20],['payment_date','15','15日',30],['payment_date','20','20日',40],['payment_date','25','25日',50],['payment_date','end','末日',60],
  ['partner_category','individual','個人',10],['partner_category','company','企業',20],['partner_category','sole_proprietor','個人事業主',30],
  ['employment_type','outsourcing','外注',10],['employment_type','payroll','給与',20],
  ['work_time_type','binding','拘束時間',10],['work_time_type','actual','実働時間',20],
  ['deposit_type','ordinary','普通',10],['deposit_type','checking','当座',20],['deposit_type','savings','貯蓄',30],
  ['invoice_send_method','email','メール',10],['invoice_send_method','post','郵送',20],['invoice_send_method','hand','手渡し',30],['invoice_send_method','other','その他',40],
  ['accident_insurance','joined','加入',10],['accident_insurance','not_joined','未加入',20],
  ['contractor_liability','joined','加入',10],['contractor_liability','not_joined','未加入',20],
  ['cargo_insurance','joined','加入',10],['cargo_insurance','not_joined','未加入',20],
  ['g_association','joined','加入',10],['g_association','not_joined','未加入',20],
  ['tax_return','done','提出済',10],['tax_return','not_done','未提出',20],['loop_code','yes','有',10],['loop_code','no','無',20],
  ['payment_output','type_a','帳票A',10],['payment_output','type_b','帳票B',20],['payment_output','type_c','帳票C',30],
  ['work_mode','regular','レギュラー',10],['work_mode','spot','スポット',20],['work_mode','charter','チャーター',30],
  ['daily_count_type','binding','拘束',10],['daily_count_type','actual','実働',20],
  ['weekday','all','すべて',0],['weekday','mon','月',10],['weekday','tue','火',20],['weekday','wed','水',30],['weekday','thu','木',40],['weekday','fri','金',50],['weekday','sat','土',60],['weekday','sun','日',70],['weekday','holiday','祝',80],
  ['price_type','basic','基本',10],['price_type','overtime','残業',20],['price_type','shortage','不足控除',25],['price_type','night','深夜',30],['price_type','night_overtime','深夜超過',35],['price_type','spot','スポット',40],
  ['price_calc_type','daily','日額',10],['price_calc_type','hourly','時間',20],['price_calc_type','distance','距離',30],
  ['overtime_calc','after_basic','基本後',10],['overtime_calc','binding_over','拘束超過',20],
  ['day_type','weekday','平日',10],['day_type','half','半日',20],['day_type','sat','土曜',30],['day_type','sun','日曜',40],['day_type','holiday','祝日',50],['day_type','other','その他',60],
  ['fee_item_type','daily_basic','基本日極',10],['fee_item_type','hourly','時間単価',20],['fee_item_type','overtime','時間外',30],['fee_item_type','night','深夜単価',40],['fee_item_type','night_overtime','深夜時間外',50],['fee_item_type','unit','単価',60],['fee_item_type','distance','距離単価',70],['fee_item_type','table','テーブル',80],
  ['contract_status','active','稼働中',10],['contract_status','paused','一時休止中',20],['contract_status','ending','終了予定',30],['contract_status','ended','終了',40],
].map(([category_code,code_value,code_label,sort_order]) => ({ category_code,code_value,code_label,sort_order,is_active:1 }));

const SETTING_ROWS = [
  ['default_tax_rate','0.10','消費税率'],['default_transfer_fee','0','振込手数料デフォルト'],['ui_builder_enabled','1','UIビルダー有効'],
  ['price_matrix_profit_warning_percent','10','利益率警告基準（%）'],['price_matrix_overtime_multiplier','1.25','時間外倍率'],['price_matrix_night_multiplier','1.35','深夜倍率'],['price_matrix_night_overtime_multiplier','1.6','深夜超過倍率'],
  ['daily_report_input_font_size_px','16','日報入力文字サイズ（px）'],['daily_report_reference_text_color','#A7B0BE','日報未入力欄の文字色'],['daily_report_saturday_background_color','#EAF4FF','日報土曜背景色'],['daily_report_saturday_text_color','#1D4ED8','日報土曜文字色'],['daily_report_holiday_background_color','#FDECEC','日報日曜・祝日背景色'],['daily_report_holiday_text_color','#B42318','日報日曜・祝日文字色'],['daily_report_fallback_time_step_minutes','5','日報時間の代替刻み（分）'],['daily_report_distance_step','1','日報距離の増減単位'],['daily_report_expense_step','100','日報経費の増減単位'],
  ['settlement_line_display_order','basic,overtime,night,night_overtime,distance,shortage','請求・支払摘要の表示順'],['settlement_line_display_labels','基本料金,時間超過,深夜料金,深夜時間外,その他,不足時間','請求・支払摘要の表示名'],
  ['daily_report_submission_grace_days','1','日報提出の猶予日数'],['settlement_supervisor_approval_required','0','日報・請求・支払の上長承認を必須にする'],['document_invalidation_supervisor_approval_required','0','発行済み書類の無効化に上長承認を必須にする'],
  ['document_issuer_name','','帳票 発行元名称'],['document_issuer_zip_code','','帳票 発行元郵便番号'],['document_issuer_address','','帳票 発行元住所'],['document_issuer_registration_number','','帳票 適格請求書発行事業者登録番号'],['document_issuer_tel','','帳票 発行元電話番号'],['document_issuer_fax','','帳票 発行元FAX番号'],['document_issuer_bank_accounts','[]','帳票 振込口座一覧（JSON）'],['document_issuer_logo_data_url','','帳票 会社ロゴ（data URL）'],['document_issuer_stamp_data_url','','帳票 社印（data URL）'],['document_transfer_fee_note','恐れ入りますが、振込手数料は御社でご負担をお願い申し上げます。','帳票 振込手数料注記'],
  ['status_color_neutral','#64748B','状態色：未処理・未作成'],['status_color_working','#2563EB','状態色：作業中'],['status_color_waiting','#D97706','状態色：確認待ち・保留'],['status_color_complete','#16805B','状態色：完了・確定'],['status_color_attention','#D92D20','状態色：差戻し・エラー'],['status_color_inactive','#6B7280','状態色：取消・無効'],
  ['price_screen_weekday_color','#34C759','金額データ：月～金の色'],['price_screen_saturday_color','#1683EA','金額データ：土曜の色'],['price_screen_sunday_holiday_color','#FFB8BD','金額データ：日曜・祝日の色'],['price_screen_project_holiday_color','#FF3B46','金額データ：休の色'],['price_screen_billing_amount_color','#1D4ED8','金額データ：請求額の文字色'],['price_screen_payment_amount_color','#C65D00','金額データ：支払額の文字色'],
  ['status_label_draft','下書き','状態名称：下書き'],['status_label_submitted','承認待ち','状態名称：承認待ち'],['status_label_awaiting_approval','日報承認待ち','状態名称：日報承認待ち'],['status_label_confirmed','日次確認済み','状態名称：日次確認済み'],['status_label_sales_reviewed','営業確認済み','状態名称：営業確認済み'],['status_label_approved','承認済み','状態名称：承認済み'],['status_label_finalized','最終確定済み','状態名称：最終確定済み'],['status_label_issued','発行済み','状態名称：発行済み'],['status_label_paid','支払済み','状態名称：支払済み'],['status_label_cancelled','取消済み','状態名称：取消済み'],['status_label_active','有効','状態名称：有効'],['status_label_inactive','無効','状態名称：無効'],
].map(([setting_key,setting_value,setting_label]) => ({ setting_key,setting_value,setting_label }));

const HELP_ROWS = [
  ['home','業務ダッシュボードのヘルプ','各業務の件数と対応状況を確認する画面です。','カードを選ぶと対象機能を開きます。'],
  ['base_management','基本管理のヘルプ','企業から金額データまでの紐付きを横断確認します。','項目をクリックすると詳細、ダブルクリックすると編集画面を開きます。全対象は再度押すと解除できます。'],
  ['companies','企業マスタのヘルプ','請求元となる企業情報と請求先を管理します。','契約状況が終了、または稼働終了日を過ぎた企業は通常一覧から除外されます。'],
  ['partners','パートナーマスタのヘルプ','支払先となるパートナー情報を管理します。','先払い対象を有効にすると、新しく紐付ける個別案件も先払い対象になります。'],
  ['base_projects','基本案件のヘルプ','繰り返し利用する案件条件のひな形を管理します。','勤務条件と金額データは個別案件作成時に複製されます。'],
  ['projects','個別案件のヘルプ','実際に稼働する企業・パートナー・請求先を紐付けます。','請求先Noは請求作成時の宛先に使われ、勤務条件は日報計算へ反映されます。'],
  ['price_sets','金額データのヘルプ','案件へ適用する請求・支払単価を期間別に管理します。','基本案件の金額は個別案件作成時に独立コピーされ、既存案件へ遡及しません。'],
  ['office_work','事務作業のヘルプ','日報・請求・支払の進捗を横断確認します。','対象月や企業等で絞り込み、各処理画面へ移動できます。'],
  ['daily_reports','日報のヘルプ','日々の開始・終了時刻、休憩時間、経費等を入力します。','入力内容から請求・支払の計算明細が作成されます。'],
  ['daily_report_submissions','日報提出のヘルプ','案件ごとの提出状況と遅延を確認します。','提出状態は日報の月次承認前の確認に使われます。'],
  ['advances','先払管理のヘルプ','対象案件の先払額と振込手数料を管理します。','作成した先払実績は正式支払時の控除候補になります。'],
  ['invoices','請求管理のヘルプ','案件を請求先単位にまとめ、請求書を作成します。','日報から再反映はその時点のデータを取り込みます。最終確定には月次承認が必要です。'],
  ['payments','支払管理のヘルプ','パートナー単位の支払明細と控除を作成します。','日報から再反映はその時点のデータを取り込みます。最終確定には月次承認が必要です。'],
  ['cash_management','入出金管理のヘルプ','入出金予定・実績と銀行CSVを管理します。','最終確定した請求・支払は指定した締日の予定へ反映されます。'],
  ['analytics','収支分析のヘルプ','企業・パートナー・案件の収支を確認します。','対象月や条件を変更すると集計範囲が変わります。'],
  ['master_settings','マスター設定のヘルプ','各機能で使う名称・色・計算設定を管理します。','変更は保存後の画面表示や新しい計算へ反映されます。'],
  ['master_data_preparation','マスターデータ取込のヘルプ','旧Excelを編集用マスターへ変換し、検証後に正常行を登録します。','取込キーで再取込と更新を判定し、エラー行は登録しません。'],
  ['calculation_rules','計算ルール管理のヘルプ','請求・支払の計算方法を版ごとに管理します。','公開済み版は変更できません。下書きを検証・比較して公開し、必要な未確定データだけを選択再計算します。'],
  ['help_settings','ヘルプ編集設定のヘルプ','全機能のヘルプ本文を編集します。','保存した内容は各画面のヘルプボタンから全利用者へ表示されます。'],
  ['ui_builder','UIビルダーのヘルプ','各一覧画面の列順と表示・非表示を設定します。','保存したレイアウトは同じ会社の利用者が開く一覧へ反映されます。'],
  ['users','ユーザー管理のヘルプ','利用者、ロール、利用可能機能を管理します。','権限変更は対象利用者の次回画面表示から反映されます。'],
].map(([screen_key,help_title,overview_text,input_effect_text]) => ({ screen_key,help_title,overview_text,input_effect_text }));

const BANK_PROFILES = [
  ['resona_group_csv','りそなグループ CSV','resona','りそな銀行・埼玉りそな銀行向け。正式仕様確認後に公開する。'],
  ['mizuho_csv','みずほ銀行 CSV','mizuho','契約サービスの正式仕様確認後に公開する。'],
  ['smbc_csv','三井住友銀行 CSV','smbc','契約サービスの正式仕様確認後に公開する。'],
].map(([profile_code,profile_name,bank_family,description]) => ({ profile_code,profile_name,bank_family,description,is_active:1 }));
const BANK_COLUMNS = [
  ['transfer_date','振込指定日','transfer_date',1,'YYYYMMDD',null,8,'none',10],['bank_code','銀行コード','beneficiary_bank_code',1,null,4,4,'digits',20],['branch_code','支店コード','beneficiary_branch_code',1,null,3,3,'digits',30],['deposit_type','口座種別','beneficiary_deposit_type',1,null,null,16,'none',40],['account_number','口座番号','beneficiary_account_number',1,null,7,7,'digits',50],['account_name','口座名義カナ','beneficiary_account_name_kana',1,null,null,100,'katakana',60],['amount','振込金額','amount',1,null,null,14,'digits',70],['schedule_id','予定ID','cash_schedule_id',0,null,null,20,'digits',80],
];
const DEDUCTIONS = [
  { rule_code:'office_fee',display_name:'事務手数料',amount:1100 },
  { rule_code:'safety_fee',display_name:'安全協力会費',amount:8800 },
];

let lastStatus = { status:'unknown', warning_count:0, created_count:0, issues:[] };
const stable = {
  code: (r) => `${r.category_code}:${r.code_value}`,
  setting: (r) => r.setting_key,
  help: (r) => r.screen_key,
  profile: (r) => r.profile_code,
};

function validateCatalog() {
  for (const [name,rows,key] of [['code',CODE_ROWS,stable.code],['setting',SETTING_ROWS,stable.setting],['help',HELP_ROWS,stable.help],['profile',BANK_PROFILES,stable.profile]]) {
    const keys = rows.map(key);
    if (new Set(keys).size !== keys.length) throw new Error(`基盤マスター定義に重複があります: ${name}`);
  }
  if (BANK_COLUMNS.some((r) => !r[0] || !r[2])) throw new Error('銀行CSV列定義が不正です');
}

async function syncSimple(conn, config, issues) {
  const [existing] = await conn.query(`SELECT * FROM ${config.table}`);
  const byKey = new Map(existing.map((row) => [config.key(row),row]));
  let created = 0;
  for (const row of config.rows) {
    const key = config.key(row); const current = byKey.get(key);
    if (!current) {
      const fields = Object.keys(row);
      await conn.query(`INSERT INTO ${config.table} (${fields.join(',')}) VALUES (${fields.map(() => '?').join(',')})`, fields.map((field) => row[field]));
      created += 1;
    } else if (Number(current.is_deleted || 0) || ('is_active' in current && !Number(current.is_active))) {
      issues.push({ type:config.type,key,reason:Number(current.is_deleted || 0) ? '論理削除されています' : '無効化されています' });
    }
  }
  return created;
}

async function syncBankProfiles(conn, issues) {
  let created = await syncSimple(conn,{ type:'bank_profile',table:'bank_export_profiles',rows:BANK_PROFILES,key:stable.profile },issues);
  const [profiles] = await conn.query('SELECT * FROM bank_export_profiles');
  for (const profile of BANK_PROFILES) {
    const current = profiles.find((row) => row.profile_code === profile.profile_code);
    if (!current || Number(current.is_deleted || 0) || !Number(current.is_active)) continue;
    const [versions] = await conn.query('SELECT * FROM bank_export_profile_versions WHERE bank_export_profile_id=? AND version_no=1',[current.bank_export_profile_id]);
    let version = versions[0];
    if (!version) {
      const [result] = await conn.query("INSERT INTO bank_export_profile_versions (bank_export_profile_id,version_no,status,encoding_code,delimiter_text,quote_mode,include_header,line_ending,file_name_pattern,verification_note) VALUES (?,1,'draft','utf8_bom',',','all',1,'crlf',?,?)",[current.bank_export_profile_id,`${profile.profile_code}_{YYYYMMDD}_{cycle}.csv`,'未検証。契約中の銀行サービス仕様書と取込試験結果を確認してから公開してください。']);
      version = { bank_export_profile_version_id:result.insertId }; created += 1;
    }
    const [columns] = await conn.query('SELECT column_key FROM bank_export_columns WHERE bank_export_profile_version_id=?',[version.bank_export_profile_version_id]);
    const columnKeys = new Set(columns.map((row) => row.column_key));
    for (const [column_key,column_label,source_key,is_required,format_code,zero_pad_length,max_length,transform_code,sort_order] of BANK_COLUMNS) {
      if (columnKeys.has(column_key)) continue;
      await conn.query('INSERT INTO bank_export_columns (bank_export_profile_version_id,column_key,column_label,source_key,is_required,format_code,zero_pad_length,max_length,transform_code,sort_order) VALUES (?,?,?,?,?,?,?,?,?,?)',[version.bank_export_profile_version_id,column_key,column_label,source_key,is_required,format_code,zero_pad_length,max_length,transform_code,sort_order]);
      created += 1;
    }
  }
  return created;
}

async function syncFoundationMasters(pool) {
  validateCatalog();
  const conn = await pool.getConnection(); const issues = []; let created = 0;
  try {
    await conn.beginTransaction();
    created += await syncSimple(conn,{ type:'code',table:'code_masters',rows:CODE_ROWS,key:stable.code },issues);
    created += await syncSimple(conn,{ type:'setting',table:'system_settings',rows:SETTING_ROWS,key:stable.setting },issues);
    created += await syncSimple(conn,{ type:'help',table:'help_contents',rows:HELP_ROWS,key:stable.help },issues);
    created += await syncSimple(conn,{ type:'numbering_rule',table:'numbering_rules',rows:[{rule_key:'office',rule_label:'事業所No',prefix:'',pad_digits:4,next_number:1,is_active:1}],key:(r)=>r.rule_key },issues);
    created += await syncBankProfiles(conn,issues);
    const [deductions] = await conn.query("SELECT * FROM settlement_deduction_rules WHERE scope='common' AND partner_id IS NULL");
    for (const row of DEDUCTIONS) {
      const current = deductions.find((value) => {
        const date = value.valid_from instanceof Date
          ? value.valid_from.toISOString().slice(0,10)
          : String(value.valid_from).slice(0,10);
        return value.rule_code === row.rule_code && date === '2026-01-01';
      });
      if (!current) { await conn.query("INSERT INTO settlement_deduction_rules (rule_code,scope,partner_id,display_name,amount,tax_category,valid_from,is_active) VALUES (?,'common',NULL,?,?,'taxable','2026-01-01',1)",[row.rule_code,row.display_name,row.amount]); created += 1; }
      else if (!Number(current.is_active)) issues.push({type:'deduction',key:row.rule_code,reason:'無効化されています'});
    }
    await conn.commit();
    lastStatus = { status:issues.length ? 'warning' : 'up',warning_count:issues.length,created_count:created,issues };
    return lastStatus;
  } catch (error) { await conn.rollback(); lastStatus={status:'error',warning_count:0,created_count:0,issues:[],message:error.message}; throw error; }
  finally { conn.release(); }
}

function getFoundationMasterStatus() { return { ...lastStatus,issues:lastStatus.issues.map((issue) => ({...issue})) }; }

module.exports = { CODE_ROWS,SETTING_ROWS,HELP_ROWS,BANK_PROFILES,BANK_COLUMNS,DEDUCTIONS,validateCatalog,syncSimple,syncFoundationMasters,getFoundationMasterStatus };
