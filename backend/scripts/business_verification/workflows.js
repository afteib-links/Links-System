const fs=require('node:fs/promises');
const path=require('node:path');
const {months,START,addDays,lastDay,input,monthState,VERSION,EXCEPTIONS,intentionallyMissing}=require('./scenarios');
const {at,insert}=require('./runtime');
const {applyDailyPriceCalc}=require('../../src/services/price_calc');
const {periodForCycle}=require('../../src/services/closing_cycles');
async function eachLimit(rows,limit,callback){for(let i=0;i<rows.length;i+=limit){const results=await Promise.allSettled(rows.slice(i,i+limit).map(callback));const error=results.find(r=>r.status==='rejected');if(error)throw error.reason;}}

async function workflows(pool,c,api,env){
  const log=[];
  const [[mi]]=await pool.query("SELECT COUNT(*) n FROM settlement_lines WHERE settlement_type='invoice' AND source_type='manual_adjustment'");
  const [[mp]]=await pool.query("SELECT COUNT(*) n FROM settlement_lines WHERE settlement_type='payment' AND source_type='manual_adjustment'");
  let manualInvoice=Number(mi.n),manualPayment=Number(mp.n);
  const request=api.request;
  async function exportsAndTransactions(upper){
    const [schedules]=await pool.query("SELECT * FROM cash_schedules WHERE status='planned' AND scheduled_date<=? ORDER BY scheduled_date,cash_schedule_id",[upper]);
    const groups=new Map();
    for(const s of schedules.filter(s=>s.direction==='outgoing')){
      const key=`${s.cash_cycle_id}:${s.scheduled_date}:${Number(s.partner_id||0)%3}`;
      if(!groups.has(key))groups.set(key,[]);groups.get(key).push(s);
    }
    for(const rows of groups.values()){
      at(`${rows[0].scheduled_date}T08:00:00Z`);
      const result=await request('/cash/bank-exports',{transfer_date:rows[0].scheduled_date,source_bank_account_id:c.accounts[Number(rows[0].partner_id||0)%3],schedule_ids:rows.map(s=>s.cash_schedule_id)});
      await fs.mkdir(path.join(env.out,'csv'),{recursive:true});
      await fs.writeFile(path.join(env.out,'csv',`batch-${result.batchId}.csv`),result.buffer,{flag:'wx'});
    }
    for(const s of schedules){
      at(`${s.scheduled_date}T10:00:00Z`);
      await request(`/cash/schedules/${s.cash_schedule_id}/transaction`,{executed_date:s.scheduled_date,executed_amount:Number(s.amount),status:'executed',bank_name:s.direction==='outgoing'?'検証口座':'検証入金'});
    }
  }
  for(const ym of months(env.asOf)){
    console.log(`[business-verification] ${ym}: daily reports`);
    const monthEnd=lastDay(ym),end=monthEnd<env.asOf?monthEnd:env.asOf;
    const active=c.projects.filter(p=>p.start<=end&&(!p.end||p.end>=`${ym}-01`));
    const monthRows=new Map();
    const [existingRows]=await pool.query('SELECT project_id,daily_report_id,work_date,status FROM daily_reports WHERE target_year_month=?',[ym]);
    const existingByDate=new Map(existingRows.map(r=>[`${r.project_id}:${r.work_date}`,r]));
    for(const p of active)monthRows.set(p.id,[]);
    for(let date=`${ym}-01`;date<=end;date=addDays(date,1)){
      at(`${date}T09:00:00Z`);
      await eachLimit(active,6,async p=>{
        if(intentionallyMissing(p,date))return;
        const co=c.companies[p.base],partner=c.partners[p.partner],ids=monthRows.get(p.id);
        const existing=existingByDate.get(`${p.id}:${date}`);
        if(existing){if(existing.status==='draft')await request('/daily/day-status',{project_id:p.id,work_date:date,status:'confirmed',acknowledge_warnings:true});ids.push(existing.daily_report_id);return;}
        const {data,scenario}=input(p,co,date,env.seed);
        // Contract boundary days still get a zero/non-working confirmation, but never a work record.
        at(`${date}T09:00:00Z`);
        const r=await applyDailyPriceCalc({...data,project_id:p.id,company_id:co.id,partner_id:partner.id});
        const stored={...r,status:'confirmed',extra_data:{seed_key:VERSION,scenario,scenario_no:p.no}};
        const reportId=await insert(pool,'daily_reports',stored);
        // Same versioned project/day snapshot shape as day-status; no calculation is reimplemented.
        await insert(pool,'daily_report_confirmation_snapshots',{daily_report_id:reportId,confirmation_version:1,confirmed_by_user_id:c.actor,snapshot_data:{scope:'project_work_date',project_id:p.id,work_date:date,confirmation_version:1,reports:[{...stored,daily_report_id:reportId,confirmation_version:1}]}});
        await insert(pool,'daily_report_audit_logs',{daily_report_id:reportId,action_code:'daily_confirm',after_data:{status:'confirmed',confirmation_version:1},reason:`検証生成：${scenario}`,actor_user_id:c.actor});
        ids.push(reportId);
      });
    }
    console.log(`[business-verification] ${ym}: advances and approvals`);
    // Advance dates and transactions are processed before monthly settlements, so deduction candidates
    // cannot accidentally include a future advance from a later month.
    const matrix=await request(`/advances/matrix?target_year_month=${ym}`);
    for(const project of matrix.projects){
      const p=c.projects.find(x=>x.id===project.project_id);
      if(!active.includes(p))continue;
      for(const cell of project.cycles){
        if(cell.period_end>env.asOf||cell.advance_record_id)continue;
        at(addDays(cell.period_end,1));
        if(p.index===48&&ym==='2026-08'&&cell.group_code==='middle'){
          await request(`/advances/cycles/${p.id}/${cell.group_code}`,{target_year_month:ym,is_target:false,version:cell.version,adjustment_reason:'当サイクルは先払不要の申出'},'PUT');continue;
        }
        if(cell.work_days===0)continue;
        const changed=p.index===47&&ym==='2026-06'&&cell.group_code==='middle';
        const body={target_year_month:ym,items:[{project_id:p.id,version:cell.version,advance_amount:cell.calculated_amount+(changed?1000:0),transfer_fee_amount:cell.transfer_fee_amount,adjustment_reason:changed?'臨時の先払増額申請':undefined}]};
        const created=await request(`/advances/groups/${cell.group_code}/records`,body);
        if(p.index===46&&ym==='2026-08'&&cell.group_code==='middle'){
          await request(`/advances/records/${created.advance_record_ids[0]}/cancel`,{reason:'対象金額を再確認して再作成'});
          const fresh=await request(`/advances/matrix?target_year_month=${ym}`);
          body.items[0].version=fresh.projects.find(x=>x.project_id===p.id).cycles.find(x=>x.group_code===cell.group_code).version;
          await request(`/advances/groups/${cell.group_code}/records`,body);
        }
      }
    }
    const finalizeDate=addDays(monthEnd,ym<'2026-08'?15:4);
    await exportsAndTransactions(finalizeDate<env.asOf?finalizeDate:env.asOf);
    if(ym===env.asOf.slice(0,7))continue;
    for(const p of active){
      const state=monthState(p,ym),nextMonth=addDays(monthEnd,1).slice(0,7),submit=addDays(monthEnd,1),approve=addDays(monthEnd,2);
      if(['unsubmitted','inputting'].includes(state)){log.push({project:p.no,month:ym,state});continue;}
      const [priorApprovals]=await pool.query('SELECT status FROM daily_report_monthly_approvals WHERE project_id=? AND target_year_month=? ORDER BY approval_version DESC LIMIT 1',[p.id,ym]);
      if(priorApprovals[0]?.status==='approved'||priorApprovals[0]?.status===state)continue;
      at(submit);
      await request(`/daily/distance-monthly?project_id=${p.id}&target_year_month=${ym}`);
      if(priorApprovals[0]?.status!=='submitted')await request('/daily/monthly-approval',{project_id:p.id,target_year_month:ym,action:'submit'});
      if(state==='submitted'){log.push({project:p.no,month:ym,state});continue;}
      at(approve);
      if(state==='rejected'){await request('/daily/monthly-approval',{project_id:p.id,target_year_month:ym,action:'reject',note:'検証：勤務時間の再確認をお願いします'});log.push({project:p.no,month:ym,state});continue;}
      await request('/daily/monthly-approval',{project_id:p.id,target_year_month:ym,action:'approve'});
    }
    at(addDays(monthEnd,3));
    await request('/cash/cycles/ensure',{target_year_month:addDays(monthEnd,1).slice(0,7)});
    const [cycles]=await pool.query("SELECT * FROM cash_cycles WHERE target_year_month=? AND cycle_code='20'",[addDays(monthEnd,1).slice(0,7)]);
    // Settlements sharing an entity and closing are grouped, so contract handovers do not duplicate bills.
    for(const kind of ['invoice','payment']){
      const grouped=new Map();
      for(const p of active){
        const state=monthState(p,ym);if(['unsubmitted','submitted','rejected','inputting'].includes(state))continue;
        const entity=kind==='invoice'?c.companies[p.base].id:c.partners[p.partner].id;
        const key=`${entity}:${p.base%6}`;if(!grouped.has(key))grouped.set(key,{entity,projects:[],ids:[],state:'complete'});
        const g=grouped.get(key);g.projects.push(p);g.ids.push(...monthRows.get(p.id));if(state!=='complete')g.state=state;
      }
      console.log(`[business-verification] ${ym}: ${kind} ${grouped.size}`);
      const pending=[];
      at(addDays(monthEnd,ym<'2026-08'?13:3));
      // Choose the six manual examples before running concurrent requests.
      for(const g of grouped.values()){
        const idField=kind==='invoice'?'invoice_id':'payment_id';
        const [previous]=await pool.query(`SELECT h.${idField} id,h.settlement_status,w.status workflow FROM ${kind==='invoice'?'invoices':'payments'} h JOIN ${kind==='invoice'?'invoice_daily_reports':'payment_daily_reports'} l ON l.${idField}=h.${idField} JOIN settlement_workflows w ON w.settlement_type=? AND w.settlement_id=h.${idField} WHERE l.daily_report_id=?`,[kind,g.ids[0]]);
        if(previous[0]?.settlement_status==='finalized')continue;
        at(addDays(monthEnd,ym<'2026-08'?13:3));
        const manual=!previous.length&&(kind==='invoice'?manualInvoice<6:manualPayment<6);
        const adjustments=manual?[{item_name:kind==='invoice'?'臨時搬入作業加算':'備品立替精算調整',amount:kind==='invoice'?2400:-1200,reason:'検証：担当者が依頼書と照合して手入力',tax_category:kind==='invoice'?'taxable':'non_taxable'}]:[];
        if(manual){if(kind==='invoice')manualInvoice++;else manualPayment++;}
        pending.push({g,previous:previous[0],adjustments});
      }
      await eachLimit(pending,4,async task=>{
        const {g,previous,adjustments}=task;
        const result=previous?{settlement_id:previous.id}:await request(`/settlements/${kind}/drafts`,{target_year_month:ym,[kind==='invoice'?'company_id':'partner_id']:g.entity,daily_report_ids:g.ids,adjustments,issue_salary_statement:kind==='payment'&&g.projects[0].index%20===0});
        task.id=result.settlement_id;
      });
      const finalizing=pending.filter(t=>t.g.state!==`${kind}_draft`);
      at(addDays(monthEnd,ym<'2026-08'?14:4));
      await eachLimit(finalizing,4,async t=>{if(t.previous?.workflow!=='sales_reviewed')await request(`/settlements/${kind}/${t.id}/sales-review`,{});});
      at(addDays(monthEnd,ym<'2026-08'?15:5));
      // Number allocation in PDF finalization is serialized by the existing service.
      for(const {g,id} of finalizing){
        await request(`/settlements/${kind}/${id}/finalize`,{cash_cycle_id:cycles[0].cash_cycle_id});
        if(g.state==='payment_held'&&kind==='payment'){
          const [s]=await pool.query("SELECT * FROM cash_schedules WHERE source_type='payment' AND source_id=?",[id]);
          await request(`/cash/schedules/${s[0].cash_schedule_id}/transaction`,{executed_date:addDays(monthEnd,15),executed_amount:0,status:'held',reason:'支払内容の照会中'});
        }
      }
    }
    if(ym==='2026-02'){
      for(let i=0;i<6;i++){
        const [existing]=await pool.query("SELECT cash_schedule_id FROM cash_schedules WHERE source_type IN ('expense','adjustment') AND title LIKE '手入力：%' AND partner_id=?",[c.partners[80+i].id]);
        if(!existing.length)await request('/cash/schedules',{cash_cycle_id:cycles[0].cash_cycle_id,direction:i<3?'outgoing':'incoming',source_type:i<3?'expense':'adjustment',partner_id:c.partners[80+i].id,counterparty_name:c.partners[80+i].name,title:i<3?'手入力：配送備品精算':'手入力：過入金調整',amount:1500+i*100});
      }
    }
    const settleEnd=lastDay(addDays(monthEnd,1).slice(0,7));
    await exportsAndTransactions(settleEnd<env.asOf?settleEnd:env.asOf);
  }
  // Future cash schedules remain planned, with one exported example for downloading/review before execution.
  at(env.asOf);
  const [future]=await pool.query("SELECT * FROM cash_schedules WHERE direction='outgoing' AND status='planned' AND scheduled_date>? ORDER BY cash_schedule_id LIMIT 1",[env.asOf]);
  if(future.length){const s=future[0],result=await request('/cash/bank-exports',{transfer_date:s.scheduled_date,source_bank_account_id:c.accounts[0],schedule_ids:[s.cash_schedule_id]});await fs.writeFile(path.join(env.out,'csv',`batch-${result.batchId}.csv`),result.buffer,{flag:'wx'});}
  return {states:log,exceptions:EXCEPTIONS,manualInvoice,manualPayment};
}
module.exports={workflows};
