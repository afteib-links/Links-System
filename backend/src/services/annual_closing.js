const {getPeriod,nextDate,periodError}=require('./daily_report_periods');
const {loadItems,validateAttendance,digest}=require('./additional_items');
const json=value=>typeof value==='string'?JSON.parse(value):value||{};
const amount=(report,side)=>Number(report[`override_${side}_amount`]??report[`calculated_${side}_amount`]??0);
const money=value=>Math.round(Number(value||0));
function fiscalYear(value){const n=Number(value);if(!Number.isInteger(n)||n<1901||n>9998)throw periodError('年度を確認してください',400);return n;}
function annualTotals(normal,tail,previous,includePrevious=false){const result={};for(const side of ['billing','payment'])result[side]=money(normal[side]+tail[side]-(includePrevious?0:previous[side]));result.profit=result.billing-result.payment;result.profit_rate=result.billing?result.profit/result.billing*100:null;return result;}
function tailDaily(report,side) {
  const detail=json(report.calculation_detail),components=detail?.[side]?.amounts?.details||{};
  const fixed=Object.values(components).filter(c=>['monthly','month','fixed_month'].includes(c?.calc_type));
  return fixed.length&&report[`override_${side}_amount`]!=null?0:amount(report,side)-fixed.reduce((s,c)=>s+Number(c.amount||0),0);
}
async function build(conn,yearValue,input={}) {
  if(!input || typeof input!=='object' || Array.isArray(input) || (input.tail_adjustments!=null && (!Array.isArray(input.tail_adjustments)||input.tail_adjustments.some(v=>!v||typeof v!=='object'))))throw periodError('年度入力の形式を確認してください',400);
  const year=fiscalYear(yearValue),from=`${year-1}-12`,to=`${year}-11`,end=`${year}-11-30`;
  const [settingsRows]=await conn.query('SELECT * FROM annual_closing_settings WHERE setting_id=1');const settings=settingsRows[0];
  const [projects]=await conn.query(`SELECT p.project_id,p.company_id,p.partner_id,p.closing_date,c.company_name,pt.partner_name,b.template_name FROM projects p
    LEFT JOIN companies c ON c.company_id=p.company_id LEFT JOIN partners pt ON pt.partner_id=p.partner_id LEFT JOIN base_projects b ON b.base_project_id=p.base_project_id
    WHERE EXISTS (SELECT 1 FROM daily_reports d WHERE d.project_id=p.project_id AND d.is_deleted=0 AND (d.target_year_month BETWEEN ? AND ? OR d.work_date BETWEEN ? AND ?)) ORDER BY p.project_id`,[from,to,`${year}-11-01`,end]);
  const [previousRows]=await conn.query("SELECT * FROM annual_closings WHERE fiscal_year=? AND status='finalized' ORDER BY revision_no DESC LIMIT 1",[year-1]);
  const previous=previousRows[0],prior=previous?json(previous.snapshot_data).tail:{billing:Number(input.previous_billing||0),payment:Number(input.previous_payment||0)};
  const blockers=[],warnings=[],details=[],normal={billing:0,payment:0},tail={billing:0,payment:0},locks=[],sourceReports=[],sourceItems=[];
  if(!previous && (!input.previous_confirmed || ((!input.previous_none)&&(input.previous_billing==null||input.previous_payment==null||!String(input.previous_reason||'').trim()))))blockers.push('初年度の前年11月尾部を登録するか、該当なしを確認してください');
  if(input.previous_none&&!previous){prior.billing=0;prior.payment=0;}
  for(const n of [prior.billing,prior.payment])if(!Number.isSafeInteger(n))throw periodError('前年調整額は整数円で指定してください',400);
  for(const project of projects) {
    const id=Number(project.project_id),november=await getPeriod(id,to,conn);
    const [reports]=await conn.query('SELECT * FROM daily_reports WHERE project_id=? AND is_deleted=0 AND (target_year_month BETWEEN ? AND ? OR work_date BETWEEN ? AND ?) ORDER BY work_date,daily_report_id',[id,from,to,`${year}-11-01`,end]);
    const [approvals]=await conn.query('SELECT * FROM daily_report_monthly_approvals WHERE project_id=? AND target_year_month BETWEEN ? AND ? ORDER BY approval_version DESC',[id,from,to]);
    const record={project,...Object.fromEntries(['normal','tail_auto','tail_manual','tail'].map(k=>[k,{billing:0,payment:0}])),normal_sources:[],tail_reports:[],tail_items:[],tail_start:november.period_end<end?nextDate(november.period_end):null,tail_end:end};
    const months=[...new Set(reports.filter(r=>r.target_year_month>=from&&r.target_year_month<=to).map(r=>r.target_year_month))].sort();
    let start=record.tail_start||`${year}-11-01`;
    for(const ym of months) {
      const period=await getPeriod(id,ym,conn);if(period.period_start<start)start=period.period_start;
      const latest=approvals.find(a=>a.target_year_month===ym),snapshot=latest?.status==='approved'?json(latest.snapshot_data):null;
      const monthly=snapshot?.reports||reports.filter(r=>r.target_year_month===ym);
      const items=snapshot?.additional_items||await loadItems(conn,id,ym);
      if(!snapshot)warnings.push({project_id:id,month:ym,message:'通常締めの月次承認が未完了です。現時点実績を集計しています'});
      try{validateAttendance(monthly,items);}catch(error){blockers.push(`案件#${id} ${ym}: ${error.message}`);}
      const [distanceRows]=snapshot?[[]]:await conn.query('SELECT side_code,result_data FROM daily_report_distance_monthly_results WHERE project_id=? AND target_year_month=?',[id,ym]);
      const distance=snapshot?.monthly_distance_results||Object.fromEntries(distanceRows.map(r=>[r.side_code,{result:json(r.result_data)}]));
      const sums={};for(const side of ['billing','payment']){sums[side]=monthly.reduce((s,r)=>s+amount(r,side),0)+items.reduce((s,r)=>s+Number(r[`${side}_amount`]),0)+Number(distance[side]?.result?.amount||0);record.normal[side]+=money(sums[side]);}
      record.normal_sources.push({target_year_month:ym,period,approval_id:latest?.monthly_approval_id||null,approval_version:latest?.approval_version||null,approved:Boolean(snapshot),reports:monthly,additional_items:items,monthly_distance_results:distance,totals:sums});
      sourceItems.push(...items);
    }
    if(record.tail_start) {
      const tailReports=reports.filter(r=>r.work_date>=record.tail_start&&r.work_date<=end);
      record.tail_reports=tailReports;
      if(tailReports.some(r=>!['confirmed','approved'].includes(r.status)))warnings.push({project_id:id,message:'11月締日後に日次確認が未完了の実績があります'});
      for(const side of ['billing','payment'])record.tail_auto[side]=money(tailReports.reduce((s,r)=>s+tailDaily(r,side),0));
      const tailMonths=[...new Set(tailReports.map(r=>r.target_year_month))];
      for(const ym of tailMonths) {
        const items=await loadItems(conn,id,ym);sourceItems.push(...items);
        try{validateAttendance(reports.filter(r=>r.target_year_month===ym),items);}catch(error){
          // The December period may include dates beyond the fiscal cutoff; validate with its complete report set.
          const [all]=await conn.query('SELECT * FROM daily_reports WHERE project_id=? AND target_year_month=? AND is_deleted=0',[id,ym]);try{validateAttendance(all,items);}catch(e){blockers.push(`案件#${id}: ${e.message}`);}
        }
        for(const item of items) {
          const itemCopy={...item};let used=false;
          for(const side of ['billing','payment']) {
            let value=0;
            if(item.work_date && item.work_date>=record.tail_start&&item.work_date<=end)value=Number(item[`${side}_amount`]);
            else if(!item.work_date && item.calculation_method==='fuel' && item.calculation_data?.[`${side}_calculated`]==null && (item.applies_to==='both'||item.applies_to===side))value=(item.calculation_data.fuel?.days||[]).filter(d=>d.work_date>=record.tail_start&&d.work_date<=end).reduce((s,d)=>s+d.daily_amount,0);
            record.tail_auto[side]+=money(value);if(value)used=true;
          }
          if(used)record.tail_items.push(itemCopy);
        }
      }
      const manual=(input.tail_adjustments||[]).find(row=>Number(row.project_id)===id);
      if(!manual?.confirmed||!String(manual.reason||'').trim()||['billing','payment'].some(side=>!Number.isSafeInteger(Number(manual[side]))))blockers.push(`案件#${id}: 11月尾部の月額・月間距離・期間一括項目の計上額と理由を確認してください（該当なしは0円）`);
      else {record.tail_manual={billing:Number(manual.billing),payment:Number(manual.payment),reason:String(manual.reason).trim()};}
    }
    for(const side of ['billing','payment']){record.tail[side]=record.tail_auto[side]+record.tail_manual[side];normal[side]+=record.normal[side];tail[side]+=record.tail[side];}
    locks.push({project_id:id,period_start:start,period_end:end});sourceReports.push(...reports);details.push(record);
  }
  const [documentAdjustments]=await conn.query(`SELECT l.settlement_line_id,l.settlement_type,l.settlement_id,l.item_name,l.amount,l.reason,l.version FROM settlement_lines l
    JOIN settlement_workflows w ON w.settlement_type=l.settlement_type AND w.settlement_id=l.settlement_id AND w.status='finalized'
    LEFT JOIN invoices i ON l.settlement_type='invoice' AND i.invoice_id=l.settlement_id
    LEFT JOIN payments p ON l.settlement_type='payment' AND p.payment_id=l.settlement_id
    WHERE l.status='active' AND l.line_type='adjustment' AND COALESCE(i.target_year_month,p.target_year_month) BETWEEN ? AND ? ORDER BY l.settlement_line_id`,[from,to]);
  for(const line of documentAdjustments)normal[line.settlement_type==='invoice'?'billing':'payment']+=money(line.amount);
  const snapshot={fiscal_year:year,label:`${year}年11月期`,period_start:`${year-1}-12-01`,period_end:end,settings,normal,tail,previous:prior,previous_closing_id:previous?.annual_closing_id||null,previous_revision:previous?.revision_no||null,totals:annualTotals(normal,tail,prior,Boolean(settings.include_previous_tail)),details,document_adjustments:documentAdjustments,blockers,warnings,locks,source_items:sourceItems,source_reports:sourceReports};
  return {...snapshot,source_token:digest(snapshot)};
}
async function lockedRanges(conn,projectId,workDate=null) {
  const [rows]=await conn.query('SELECT * FROM annual_closing_locks WHERE project_id=? AND is_active=1 AND (? IS NULL OR ? BETWEEN period_start AND period_end)',[projectId,workDate,workDate]);return rows;
}
async function assertDailyEditable(conn,projectId,workDate){if((await lockedRanges(conn,projectId,workDate)).length)throw periodError('年度締めで固定された勤務日の入力は変更できません。年度訂正を作成してください');}
async function assertItemEditable(conn,before,after) {
  const item=after||before;if(!item)return;
  for(const source of [before,after].filter(Boolean))if(source.work_date)await assertDailyEditable(conn,source.project_id,source.work_date);
  const ranges=await lockedRanges(conn,item.project_id);if(!ranges.length)return;
  const period=await getPeriod(item.project_id,item.target_year_month,conn);
  if(ranges.some(r=>period.period_start>=r.period_start&&period.period_end<=r.period_end))throw periodError('年度締めで固定された期間の追加項目は変更できません。年度訂正を作成してください');
  const locked=date=>ranges.some(r=>date>=r.period_start&&date<=r.period_end);
  // A monthly fixed charge is apportioned explicitly in the annual snapshot; December ordinary billing stays independent.
  if(before?.calculation_method!=='fuel'&&after?.calculation_method!=='fuel')return;
  const values=source=>{
    const data=json(source?.calculation_data),sides={};
    for(const side of ['billing','payment'])sides[side]=(data.fuel?.days||[]).filter(d=>locked(d.work_date)).map(d=>[d.work_date,source.applies_to==='both'||source.applies_to===side?d.daily_amount:0]);
    if(Object.values(sides).some(v=>v.length))sides.overrides=[data.billing_calculated!=null?source.billing_amount:null,data.payment_calculated!=null?source.payment_amount:null];
    return sides;
  };
  if(digest(values(before))!==digest(values(after)))throw periodError('年度締め済みの燃料費の日別金額を変更できません。12月以降の実績だけを変更してください');
}
module.exports={json,fiscalYear,annualTotals,tailDaily,build,lockedRanges,assertDailyEditable,assertItemEditable};
