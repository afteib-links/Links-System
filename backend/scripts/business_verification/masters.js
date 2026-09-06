const fs=require('node:fs');
const vm=require('node:vm');
const path=require('node:path');
const bcrypt=require('bcryptjs');
const {catalog,price,number,HOLIDAYS,VERSION,START,addDays}=require('./scenarios');
const {insert,ROOT}=require('./runtime');
async function masters(pool){
  const c=catalog(),extra=(x={})=>({seed_key:VERSION,...x});
  const [seededUsers]=await pool.query('SELECT user_id,login_id FROM users WHERE is_deleted=0');
  if(seededUsers.some(u=>u.login_id!=='verification-admin'))throw new Error('Unexpected existing user in verification DB');
  c.actor=seededUsers[0]?.user_id||await insert(pool,'users',{login_id:'verification-admin',password_hash:await bcrypt.hash(process.env.VERIFICATION_PASSWORD||'Verification93!',10),display_name:'検証環境 管理者',role:'admin',roles:JSON.stringify(['admin']),is_active:1});
  for(const s of c.staff)s.id=await insert(pool,'staff_masters',{staff_name:s.name,role_label:s.role,area_name:s.area,extra_data:extra({scenario_no:s.no})});
  c.fees=[];for(const amount of [0,220,440])c.fees.push(await insert(pool,'transfer_fee_patterns',{pattern_name:`検証振込手数料 ${amount}円`,amount}));
  for(const [date,name]of Object.entries(HOLIDAYS))await insert(pool,'holidays',{holiday_date:date,holiday_name:name,extra_data:extra()});
  for(const [i,area]of ['関東','関西'].entries())await insert(pool,'office_masters',{office_no:number('O',i),office_name:`${area}事業所`,extra_data:extra()});
  for(const co of c.companies){
    const manager=c.staff[co.area==='関西'?8+co.index%3:co.index%8];
    co.id=await insert(pool,'companies',{company_name:`${co.no} ${co.name}`,business_content:co.sector,our_manager:manager.name,closing_date_code:['5','10','15','20','25','end'][co.index%6],zip_code:'000-0000',address:`${co.location}市 テスト用架空所在地`,extra_data:extra({scenario_no:co.no,sector:co.sector,area:co.area})});
    co.billing=await insert(pool,'company_billings',{company_id:co.id,billing_print_name:co.name,billing_summary_no:number('I',co.index),extra_data:extra()});
    co.manager=manager;
    await insert(pool,'company_invoice_settings',{company_id:co.id,display_mode:co.index%3===0?'project_aggregated':'detailed',tax_rate:.1,tax_rounding:['floor','round','ceil'][co.index%3]});
    if(co.driving)co.vehicle=await insert(pool,'company_vehicles',{company_id:co.id,vehicle_name:'企業車両（検証用）',vehicle_number:`検証 ${number('V',co.index)}`,extra_data:extra()});
  }
  for(const p of c.partners)p.id=await insert(pool,'partners',{partner_name:`${p.no} ${p.name}${p.ended?'（契約終了）':''}`,partner_name_kana:`テストパートナー`,contract_date:START,advance_payment_enabled:p.advance?1:0,transfer_fee_pattern_id:p.index%3===2?null:c.fees[p.index%3],bank_code:'0009',bank_name:'三井住友銀行',branch_code:'999',branch_name:'検証専用架空支店',deposit_type:'ordinary',account_number:String(8000000+p.index),account_name_kana:'テストパートナー',extra_data:extra({scenario_no:p.no,contract_end_date:p.endedOn,contract_status:p.ended?'ended':'active'})});
  const ctx={window:{}};vm.runInNewContext(fs.readFileSync(path.join(ROOT,'frontend/js/price_set_fee_model.js'),'utf8'),ctx);
  const model=ctx.window.LinksPriceSetFeeModel;
  c.priceIds=[];
  async function set(owner,p,co,start,revision=false){
    const configuration=price(p,co,revision),id=await insert(pool,'price_sets',{...owner,company_id:co.id,price_set_no:number('R',c.priceIds.length),price_set_name:`料金設定（${co.name}：${co.job.slice(0,18)}）${revision?'改定後':''}`,apply_start_date:start,extra_data:configuration});
    for(const line of model.itemsToLines(configuration.fee_items))await insert(pool,'price_set_lines',{price_set_id:id,...line});
    c.priceIds.push(id);return id;
  }
  for(const co of c.companies){
    co.base=await insert(pool,'base_projects',{company_id:co.id,template_name:`${number('B',co.index)} ${co.job}／${co.location}`,default_manager:co.manager.name,business_type:co.sector,work_time_type:'actual',basic_work_hours:8,execution_time_start:`${String(co.start).padStart(2,'0')}:00`,execution_time_end:`${String(co.start+9).padStart(2,'0')}:00`,break_time:1,closing_date:['5','10','15','20','25','end'][co.index%6],extra_data:extra({scenario_no:number('B',co.index)})});
    await set({base_project_id:co.base},c.projects[co.index],co,START);
  }
  for(const p of c.projects){
    const co=c.companies[p.base],partner=c.partners[p.partner];
    p.id=await insert(pool,'projects',{company_id:co.id,base_project_id:co.base,partner_id:partner.id,manager_name:co.manager.name,business_type:`${p.no} ${p.change||co.sector}`,payment_type:partner.advance?'installment':'normal',installment_amount:partner.advance?6000:null,transfer_fee_pattern_id:p.index%3===0?c.fees[2]:null,operation_start_date:p.start,execution_time_start:`${String(co.start+(p.change==='勤務条件改定'?1:0)).padStart(2,'0')}:00`,execution_time_end:`${String(co.start+9+(p.change==='勤務条件改定'?1:0)).padStart(2,'0')}:00`,break_time:1,binding_time:9,closing_date:['5','10','15','20','25','end'][p.base%6],vehicle_id:co.vehicle||null,vehicle_owner_type:co.vehicle?'company':null,extra_data:extra({scenario_no:p.no,contract_end_date:p.end,predecessor_project_id:p.predecessor==null?null:c.projects[p.predecessor].id,change_reason:p.change})});
    p.set=await set({project_id:p.id},p,co,p.start);
    if(p.index>=30&&p.index<50){p.revisionDate=['2025-12-01','2026-04-01','2026-06-16'][p.index%3];p.revisedSet=await set({project_id:p.id},p,co,p.revisionDate,true);await pool.query('UPDATE price_sets SET apply_end_date=? WHERE price_set_id=?',[addDays(p.revisionDate,-1),p.set]);}
  }
  c.accounts=[];
  for(const [i,bank]of ['りそな銀行','みずほ銀行','三井住友銀行'].entries()){
    const profile=await insert(pool,'bank_export_profiles',{profile_code:`test_only_${i}`,profile_name:`検証専用・銀行送信不可 ${bank}`,bank_family:['resona','mizuho','smbc'][i]});
    const ver=await insert(pool,'bank_export_profile_versions',{bank_export_profile_id:profile,version_no:1,status:'published',encoding_code:['utf8_bom','utf8','cp932'][i],file_name_pattern:`TEST_ONLY_${i}_{YYYYMMDD}_{batch_id}.csv`,verification_note:'検証専用。正式銀行定義ではありません。送信不可。',published_by:c.actor,published_at:START});
    for(const [n,field]of ['transfer_date','beneficiary_bank_code','beneficiary_branch_code','beneficiary_deposit_type','beneficiary_account_number','beneficiary_account_name_kana','amount'].entries())await insert(pool,'bank_export_columns',{bank_export_profile_version_id:ver,column_key:field,column_label:field,source_key:field,is_required:1,sort_order:n});
    c.accounts.push(await insert(pool,'source_bank_accounts',{bank_export_profile_id:profile,account_label:`検証専用・送信不可 ${bank}`,bank_code:['0010','0001','0009'][i],bank_name:bank,branch_code:'999',branch_name:'検証専用架空支店',deposit_type:'ordinary',account_number:`900000${i}`,account_name_kana:'ケンショウセンヨウ',opening_balance:10000000}));
  }
  for(const [key,value]of Object.entries({document_issuer_name:'業務検証株式会社（架空）',document_issuer_address:'テスト用架空所在地',document_issuer_bank_accounts:'[]'}))await pool.query('UPDATE system_settings SET setting_value=? WHERE setting_key=?',[value,key]);
  await insert(pool,'settlement_deduction_rules',{rule_code:'test_office',scope:'common',display_name:'事務手数料（検証）',amount:1000,tax_category:'non_taxable',valid_from:START});
  return c;
}
module.exports={masters};
