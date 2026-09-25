const crypto = require('node:crypto');
const { getPeriod, assertPeriodEditable, periodError } = require('./daily_report_periods');
const json = value => typeof value === 'string' ? JSON.parse(value) : value;
const digest = value => crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
function date(value) {
  const text=String(value || '');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text) || !Number.isFinite(Date.parse(text)) || new Date(text).toISOString().slice(0,10)!==text) throw periodError('日付を確認してください',400);
  return text;
}
function decimal(value, positive=false) {
  if (!/^-?\d{1,8}(\.\d{1,4})?$/.test(String(value)) || (positive && Number(value)<=0)) throw periodError('数値は小数4桁までで入力してください',400);
  return Number(value);
}
function scaled(value) {
  decimal(value);
  const [whole, fraction='']=String(value).replace('-','').split('.');
  return BigInt(whole)*10000n+BigInt(fraction.padEnd(4,'0'));
}
function fuelDaily(distance, efficiency, price) {
  decimal(distance); decimal(efficiency,true); decimal(price,true);
  if (Number(distance)<0) throw periodError('往復距離は0以上で指定してください',400);
  const numerator=scaled(distance)*scaled(price), denominator=scaled(efficiency)*10000n;
  return Number((numerator+denominator-1n)/denominator);
}
function resolveConditions(conditions, projectId, partnerId, workDate) {
  const latest=(scope,id)=>conditions.filter(r=>r.scope_type===scope && Number(r.scope_id)===Number(id) && r.valid_from<=workDate)
    .sort((a,b)=>b.valid_from.localeCompare(a.valid_from)||Number(b.fuel_condition_id)-Number(a.fuel_condition_id))[0] || {};
  const global=latest('global',0),partner=latest('partner',partnerId),project=latest('project',projectId);
  const pick=(key,list)=> { const row=list.find(r=>r[key]!=null && r[key]!==''); return row ? {value:row[key],scope:row.scope_type,condition_id:row.fuel_condition_id} : null; };
  return {efficiency:pick('efficiency',[partner,global]),roundtrip_km:pick('roundtrip_km',[project,partner]),prefecture_code:pick('prefecture_code',[project,partner,global])};
}
function calculateFuel({reports,conditions,prices,project,reference_date,price_choices={},work_date=null}) {
  date(reference_date);
  const dates=[...new Set(reports.filter(r=>!Number(r.is_absent) && (r.start_time || Number(r.is_training)) && (!work_date || r.work_date===work_date)).map(r=>r.work_date))].sort();
  const days=[],missing=[];
  for(const workDate of dates) {
    const settings=resolveConditions(conditions,project.project_id,project.partner_id,workDate);
    if(Object.values(settings).some(v=>!v)) { missing.push({work_date:workDate,message:'燃費・往復距離・都道府県の設定が不足しています',settings}); continue; }
    const region=settings.prefecture_code.value;
    const available=prices.filter(p=>p.prefecture_code===region && p.price_date<=reference_date).sort((a,b)=>b.price_date.localeCompare(a.price_date)||Number(b.fuel_price_id)-Number(a.fuel_price_id));
    const choice=price_choices[region];
    let price=available.find(p=>p.price_date===reference_date);
    if(choice?.fuel_price_id) {
      price=available.find(p=>Number(p.fuel_price_id)===Number(choice.fuel_price_id));
      if(!String(choice.reason||'').trim()) throw periodError('代替価格を採用する理由を入力してください',400);
    }
    if(!price) { missing.push({work_date:workDate,prefecture_code:region,message:'基準日の価格がありません。過去価格の採用理由または手動登録が必要です',candidate:available[0]||null}); continue; }
    days.push({work_date:workDate,settings,price,price_reason:choice?.reason||null,daily_amount:fuelDaily(settings.roundtrip_km.value,settings.efficiency.value,price.regular_price)});
  }
  return {reference_date,days,attendance_days:dates.length,amount:days.reduce((sum,d)=>sum+d.daily_amount,0),missing};
}
async function loadItems(conn,projectId,ym) {
  const [rows]=await conn.query('SELECT * FROM daily_additional_items WHERE project_id=? AND target_year_month=? AND is_deleted=0 ORDER BY work_date,additional_item_id',[projectId,ym]);
  return rows.map(r=>({...r,calculation_data:json(r.calculation_data)}));
}
async function calculate(conn, projectId, ym, body) {
  const period=await getPeriod(projectId,ym,conn);
  const [projects]=await conn.query('SELECT project_id,company_id,partner_id FROM projects WHERE project_id=? AND is_deleted=0',[projectId]);
  if(!projects.length) throw periodError('案件が見つかりません',404);
  const [masters]=await conn.query('SELECT * FROM additional_item_masters WHERE additional_item_master_id=? AND is_active=1',[body.additional_item_master_id]);
  const master=masters[0]; if(!master) throw periodError('有効な追加項目を選択してください',400);
  const workDate=body.work_date ? date(body.work_date) : null;
  if(workDate && (workDate<period.period_start || workDate>period.period_end)) throw periodError('勤務日が締め期間外です',400);
  const side=body.applies_to || master.applies_to;
  if(!['billing','payment','both'].includes(side)) throw periodError('請求・支払の対象を確認してください',400);
  const [reports]=await conn.query('SELECT * FROM daily_reports WHERE project_id=? AND target_year_month=? AND is_deleted=0 ORDER BY work_date,daily_report_id',[projectId,ym]);
  if(!reports.length) throw periodError('追加項目を登録する期間の日報を先に保存してください',400);
  if(workDate && !reports.some(r=>r.work_date===workDate)) throw periodError('日別項目は勤務日の日報を先に保存してください',400);
  const detail={method:master.calculation_method,inputs:body.inputs || {},report_versions:reports.map(r=>[r.daily_report_id,r.version])};
  let billing=0,payment=0;
  if(master.calculation_method==='fuel') {
    const [conditions]=await conn.query("SELECT * FROM fuel_conditions WHERE (scope_type='global' OR (scope_type='partner' AND scope_id=?) OR (scope_type='project' AND scope_id=?)) AND valid_from<=?",[projects[0].partner_id,projectId,period.period_end]);
    const ref=date(detail.inputs.reference_date);
    const [prices]=await conn.query('SELECT * FROM fuel_prices WHERE price_date<=?',[ref]);
    detail.fuel=calculateFuel({reports,conditions,prices,project:projects[0],reference_date:ref,price_choices:detail.inputs.price_choices,work_date:workDate});
    billing=payment=detail.fuel.amount;
  } else if(master.calculation_method==='quantity') {
    const qty=decimal(detail.inputs.quantity),b=decimal(detail.inputs.billing_unit_price||0),p=decimal(detail.inputs.payment_unit_price||0);
    detail.quantity=qty; detail.billing_unit_price=b; detail.payment_unit_price=p;
    billing=Math.round(qty*b); payment=Math.round(qty*p);
  } else {
    billing=Number(detail.inputs.billing_amount||0); payment=Number(detail.inputs.payment_amount||0);
  }
  let changed=false;
  for(const [key,computed] of [['billing',billing],['payment',payment]]) {
    const override=body[`${key}_override`];
    if(override!=null && override!=='') { detail[`${key}_calculated`]=computed; if(key==='billing') billing=Number(override); else payment=Number(override); changed=true; }
  }
  if(side==='payment') billing=0;
  if(side==='billing') payment=0;
  if([billing,payment].some(n=>!Number.isSafeInteger(n)||Math.abs(n)>999999999999)) throw periodError('金額は整数円で入力してください',400);
  const reason=String(body.reason||'').trim();
  if((changed||billing<0||payment<0)&&!reason) throw periodError('手動変更・負額調整には理由が必要です',400);
  const result={project_id:Number(projectId),daily_report_period_id:period.daily_report_period_id,target_year_month:ym,work_date:workDate,additional_item_master_id:master.additional_item_master_id,item_name:master.item_name,calculation_method:master.calculation_method,applies_to:side,tax_category:master.calculation_method==='fuel'?'tax_inclusive':master.tax_category,billing_amount:billing,payment_amount:payment,calculation_data:detail,reason};
  return {...result,preview_token:digest(result),period};
}
async function assertEditable(conn, projectId, ym, workDate) {
  await getPeriod(projectId,ym,conn,true);
  await assertPeriodEditable(conn,projectId,ym);
  const [reports]=await conn.query('SELECT status,billing_status,payment_status FROM daily_reports WHERE project_id=? AND target_year_month=? AND is_deleted=0 AND (? IS NULL OR work_date=?) FOR UPDATE',[projectId,ym,workDate,workDate]);
  if(reports.some(r=>['approved',...(workDate?['confirmed']:[])].includes(r.status) || [r.billing_status,r.payment_status].some(s=>s&&s!=='none'))) throw periodError('確認・承認・精算で保護された追加項目は変更できません');
}
function attachItems(reports,items) {
  const seen=new Set();
  return reports.map(report=>({...report,additional_items:items.filter(item=> {
    if(seen.has(Number(item.additional_item_id)) || (item.work_date && item.work_date!==report.work_date)) return false;
    seen.add(Number(item.additional_item_id)); return true;
  })}));
}
function validateAttendance(reports,items) {
  for(const item of items) {
    const fuel=item.calculation_data?.fuel;
    if(!fuel)continue;
    const dates=[...new Set(reports.filter(r=>!Number(r.is_absent)&&(r.start_time||Number(r.is_training))&&(!item.work_date||r.work_date===item.work_date)).map(r=>r.work_date))].sort();
    if(JSON.stringify(dates)!==JSON.stringify(fuel.days.map(d=>d.work_date).sort()))throw periodError(`「${item.item_name}」の対象勤務日が変更されています。追加項目を再計算してください`);
  }
}
async function fetchTick(conn, now=new Date()) {
  const jst=new Date(now.getTime()+9*60*60*1000).toISOString(),day=jst.slice(0,10),clock=jst.slice(11,19);
  const [settings]=await conn.query('SELECT * FROM fuel_fetch_settings WHERE setting_id=1');
  if(settings[0] && clock>=settings[0].fetch_time_jst) await conn.query("INSERT IGNORE INTO fuel_fetch_runs(scheduled_date,status,message) VALUES (?,'disabled','利用許諾・取得方法が未確認のため自動取得は実行していません。価格を手動登録してください')",[day]);
}
module.exports={date,decimal,digest,fuelDaily,resolveConditions,calculateFuel,calculate,loadItems,assertEditable,attachItems,validateAttendance,fetchTick};
