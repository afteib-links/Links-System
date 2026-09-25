const express=require('express');
const {getPool}=require('../db');
const {requireAuth,requirePermission,requireRole}=require('../middleware/auth');
const {getPeriod,periodError}=require('../services/daily_report_periods');
const service=require('../services/additional_items');
const router=express.Router();
router.use(requireAuth,requirePermission('daily_reports','master_settings'),requireRole('admin','soumu','executive'));
const edit=requireRole('admin','soumu');
function route(fn,write=false) { return async(req,res)=>{
  const conn=await getPool().getConnection();
  try { if(write) await conn.beginTransaction(); const result=await fn(req,conn); if(write) await conn.commit(); res.json({ok:true,...result}); }
  catch(e) {if(write) await conn.rollback(); if(!e.status)console.error('[additional-items]',e);res.status(e.status||500).json({ok:false,message:e.status?e.message:'追加項目の処理に失敗しました'});}
  finally {conn.release();}
}; }
const audit=async(conn,id,before,after,reason,actor)=>conn.query('INSERT INTO additional_item_audits(additional_item_id,before_data,after_data,reason,actor_user_id) VALUES (?,?,?,?,?)',[id,before?JSON.stringify(before):null,JSON.stringify(after),reason,actor]);
router.get('/masters',route(async(_req,conn)=>{
  const [masters]=await conn.query('SELECT * FROM additional_item_masters WHERE is_active=1 ORDER BY additional_item_master_id');return {masters};
}));
router.post('/masters',edit,route(async(req,conn)=>{
  const b=req.body,name=String(b.item_name||'').trim();
  if(!name||name.length>120||!['direct','quantity','fuel'].includes(b.calculation_method)||!['billing','payment','both'].includes(b.applies_to)||!['taxable','tax_inclusive','non_taxable','tax_exempt'].includes(b.tax_category)) throw periodError('項目名・計算方法・対象・税区分を確認してください',400);
  const [row]=await conn.query('INSERT INTO additional_item_masters(item_name,calculation_method,applies_to,tax_category) VALUES (?,?,?,?)',[name,b.calculation_method,b.applies_to,b.calculation_method==='fuel'?'tax_inclusive':b.tax_category]);
  return {additional_item_master_id:row.insertId};
},true));
router.get('/fuel',route(async(req,conn)=>{
  await service.fetchTick(conn);
  const id=Number(req.query.project_id),[projects]=id?await conn.query('SELECT project_id,partner_id FROM projects WHERE project_id=? AND is_deleted=0',[id]):[[]];
  const project=projects[0];
  const [conditions]=await conn.query("SELECT * FROM fuel_conditions WHERE scope_type='global' OR (scope_type='project' AND scope_id=?) OR (scope_type='partner' AND scope_id=?) ORDER BY valid_from DESC,fuel_condition_id DESC",[id||0,project?.partner_id||0]);
  const [prices]=await conn.query('SELECT * FROM fuel_prices ORDER BY price_date DESC,fuel_price_id DESC LIMIT 2000');
  const [settings]=await conn.query('SELECT * FROM fuel_fetch_settings WHERE setting_id=1');
  const [runs]=await conn.query('SELECT * FROM fuel_fetch_runs ORDER BY scheduled_date DESC LIMIT 30');
  return {conditions,prices,settings:settings[0],runs,project,automatic_available:false};
}));
router.post('/fuel/conditions',edit,route(async(req,conn)=>{
  const b=req.body,scope=b.scope_type,id=scope==='global'?0:Number(b.scope_id);
  if(!['global','partner','project'].includes(scope)||!Number.isSafeInteger(id)||(scope!=='global'&&id<=0)) throw periodError('設定対象を選択してください',400);
  if(scope!=='global') {
    const table=scope==='partner'?'partners':'projects',key=scope==='partner'?'partner_id':'project_id';
    const [rows]=await conn.query(`SELECT ${key} FROM ${table} WHERE ${key}=? AND is_deleted=0`,[id]);if(!rows.length)throw periodError('設定対象が見つかりません',404);
  }
  const efficiency=b.efficiency==null||b.efficiency===''?null:service.decimal(b.efficiency,true),distance=b.roundtrip_km==null||b.roundtrip_km===''?null:service.decimal(b.roundtrip_km);
  const region=b.prefecture_code ? String(b.prefecture_code).padStart(2,'0'):null,reason=String(b.reason||'').trim();
  if((distance!=null&&distance<0)||(region&&(!/^\d{2}$/.test(region)||Number(region)<1||Number(region)>47))||!reason)throw periodError('距離・都道府県・変更理由を確認してください',400);
  if(scope==='project'&&efficiency!=null)throw periodError('燃費はパートナーまたは全社に設定してください',400);
  if(scope==='global'&&distance!=null)throw periodError('往復距離は案件またはパートナーに設定してください',400);
  const [result]=await conn.query('INSERT INTO fuel_conditions(scope_type,scope_id,valid_from,efficiency,roundtrip_km,prefecture_code,reason,created_by_user_id) VALUES (?,?,?,?,?,?,?,?)',[scope,id,service.date(b.valid_from),efficiency,distance,region,reason,req.session.user.user_id]);return {fuel_condition_id:result.insertId};
},true));
router.post('/fuel/prices',edit,route(async(req,conn)=>{
  const b=req.body,region=String(b.prefecture_code||'').padStart(2,'0'),reason=String(b.reason||'').trim();
  if(!/^\d{2}$/.test(region)||Number(region)<1||Number(region)>47||!reason)throw periodError('都道府県と登録理由を確認してください',400);
  const [r]=await conn.query('INSERT INTO fuel_prices(prefecture_code,price_date,regular_price,reason,created_by_user_id) VALUES (?,?,?,?,?)',[region,service.date(b.price_date),service.decimal(b.regular_price,true),reason,req.session.user.user_id]); return {fuel_price_id:r.insertId};
},true));
router.post('/fuel/schedule',edit,route(async(req,conn)=>{
  if(req.body.enabled)throw periodError('利用許諾・取得方法の確認前は自動取得を有効化できません',400);
  const time=String(req.body.fetch_time_jst||''); if(!/^([01]\d|2[0-3]):[0-5]\d$/.test(time))throw periodError('取得時刻を日本時間の時分で指定してください',400);
  const [r]=await conn.query('UPDATE fuel_fetch_settings SET fetch_time_jst=?,enabled=0,version=version+1 WHERE setting_id=1 AND version=?',[time,req.body.version]);if(!r.affectedRows)throw periodError('設定が更新されました。再取得してください');return {};
},true));
router.get('/',route(async(req,conn)=>{
  const id=Number(req.query.project_id),ym=req.query.target_year_month;
  return {period:await getPeriod(id,ym,conn),items:await service.loadItems(conn,id,ym)};
}));
router.post('/preview',edit,route(async(req,conn)=>({preview:await service.calculate(conn,Number(req.body.project_id),req.body.target_year_month,req.body)})));
router.post('/',edit,route(async(req,conn)=>{
  const b=req.body,id=Number(b.project_id),ym=b.target_year_month;
  await service.assertEditable(conn,id,ym,b.work_date||null);
  if(!/^[\w-]{8,80}$/.test(String(b.request_key||'')))throw periodError('再実行確認キーが必要です',400);
  const [existing]=await conn.query('SELECT * FROM daily_additional_items WHERE project_id=? AND request_key=? FOR UPDATE',[id,b.request_key]);
  if(existing.length&&!b.additional_item_id) {
    const previous=typeof existing[0].calculation_data==='string'?JSON.parse(existing[0].calculation_data):existing[0].calculation_data;
    if(previous.request_digest===service.digest({...b,preview_token:undefined}))return {additional_item_id:existing[0].additional_item_id,skipped:true};
    throw periodError('同じ登録キーで内容が変更されています。一覧を再取得してください');
  }
  let before=null;
  if(b.additional_item_id) {
    const [rows]=await conn.query('SELECT * FROM daily_additional_items WHERE additional_item_id=? AND project_id=? AND target_year_month=? AND is_deleted=0 FOR UPDATE',[b.additional_item_id,id,ym]);before=rows[0];
    if(!before||Number(before.version)!==Number(b.version))throw periodError('追加項目が更新されました。再取得してください');
    await service.assertEditable(conn,id,ym,before.work_date);
    if(!String(b.reason||'').trim())throw periodError('変更理由を入力してください',400);
  }
  const calculated=await service.calculate(conn,id,ym,b);
  if(calculated.calculation_data.fuel?.missing.length)throw periodError('燃料の設定・価格の不足を解消してください',400);
  if(calculated.preview_token!==b.preview_token)throw periodError('勤務実績・設定・価格が変更されました。計算結果を再確認してください');
  const {preview_token,period,...values}=calculated;
  values.calculation_data.request_digest=service.digest({...b,preview_token:undefined});
  values.calculation_data=JSON.stringify(values.calculation_data);
  const keys=Object.keys(values);let itemId=before?.additional_item_id;
  if(before)await conn.query(`UPDATE daily_additional_items SET ${keys.map(k=>`${k}=?`).join(',')},version=version+1 WHERE additional_item_id=?`,[...keys.map(k=>values[k]),itemId]);
  else {const [r]=await conn.query(`INSERT INTO daily_additional_items(${keys.join(',')},request_key) VALUES (${keys.map(()=>'?').join(',')},?)`,[...keys.map(k=>values[k]),b.request_key]);itemId=r.insertId;}
  await audit(conn,itemId,before,values,b.reason||'初回登録',req.session.user.user_id);return {additional_item_id:itemId};
},true));
router.post('/:id/delete',edit,route(async(req,conn)=>{
  const [rows]=await conn.query('SELECT * FROM daily_additional_items WHERE additional_item_id=?',[req.params.id]);const item=rows[0];
  if(!item)throw periodError('追加項目が見つかりません',404);
  await service.assertEditable(conn,item.project_id,item.target_year_month,item.work_date);
  if(!String(req.body.reason||'').trim())throw periodError('削除理由を入力してください',400);
  const [r]=await conn.query('UPDATE daily_additional_items SET is_deleted=1,version=version+1 WHERE additional_item_id=? AND version=? AND is_deleted=0',[req.params.id,req.body.version]);if(!r.affectedRows)throw periodError('追加項目が更新されています');
  await audit(conn,item.additional_item_id,item,{is_deleted:true},req.body.reason,req.session.user.user_id);return {};
},true));
module.exports=router;
