const express=require('express');const path=require('node:path');const fs=require('node:fs/promises');const crypto=require('node:crypto');
const {getPool}=require('../db');const {requireAuth,requirePermission,requireRole}=require('../middleware/auth');
const {periodError}=require('../services/daily_report_periods');const annual=require('../services/annual_closing');
const {PDF_DIR,writeHtmlPdf}=require('../services/settlement_pdf');const {renderAnnual}=require('../services/annual_pdf');
const router=express.Router();router.use(requireAuth,requirePermission('office_work','analytics'),requireRole('admin','soumu','sales','executive'));
const office=requireRole('admin','soumu'),finalizer=requireRole('admin','executive');
const internal=req=>(req.session.user.roles||[]).some(r=>['admin','soumu','executive'].includes(r));
const audit=(conn,id,action,before,after,reason,actor)=>conn.query('INSERT INTO annual_closing_audits(annual_closing_id,action_code,before_data,after_data,reason,actor_user_id) VALUES (?,?,?,?,?,?)',[id,action,before?JSON.stringify(before):null,JSON.stringify(after),reason||action,actor]);
function route(fn,write=false){return async(req,res)=>{const conn=await getPool().getConnection();try{if(write){await conn.query('SET TRANSACTION ISOLATION LEVEL READ COMMITTED');await conn.beginTransaction();await conn.query('SELECT setting_id FROM annual_closing_settings WHERE setting_id=1 FOR UPDATE');}const out=await fn(req,conn);if(write)await conn.commit();res.json({ok:true,...out});}catch(e){if(write)await conn.rollback();if(!e.status)console.error('[annual-closing]',e);res.status(e.status||500).json({ok:false,message:e.status?e.message:'年度締めの処理に失敗しました'});}finally{conn.release();}};}
async function load(conn,id,req,lock=false){const [rows]=await conn.query(`SELECT * FROM annual_closings WHERE annual_closing_id=? ${lock?'FOR UPDATE':''}`,[id]);if(!rows.length)throw periodError('年度締めが見つかりません',404);const row=rows[0];if(!internal(req)){const [access]=await conn.query('SELECT 1 FROM annual_closing_reviews WHERE annual_closing_id=? AND reviewer_user_id=?',[id,req.session.user.user_id]);if(!access.length)throw periodError('担当する年度確認ではありません',403);}return {...row,input_data:annual.json(row.input_data),snapshot_data:annual.json(row.snapshot_data)};}
const expected=(row,req)=>{if(Number(row.version)!==Number(req.body.version))throw periodError('年度締めが更新されています。再読み込みしてください');};
async function lockProjects(conn,snapshot){const ids=snapshot.details.map(d=>d.project.project_id);if(ids.length)await conn.query(`SELECT project_id FROM projects WHERE project_id IN (${ids.map(()=>'?')}) ORDER BY project_id FOR UPDATE`,ids);}
router.get('/settings',route(async(_req,conn)=>{const [rows]=await conn.query('SELECT * FROM annual_closing_settings WHERE setting_id=1');return {settings:rows[0]};}));
router.post('/settings',finalizer,route(async(req,conn)=>{const [before]=await conn.query('SELECT * FROM annual_closing_settings WHERE setting_id=1');if(typeof req.body.include_previous_tail!=='boolean'||!String(req.body.reason||'').trim())throw periodError('設定と変更理由を確認してください',400);const [r]=await conn.query('UPDATE annual_closing_settings SET include_previous_tail=?,version=version+1 WHERE setting_id=1 AND version=?',[req.body.include_previous_tail?1:0,req.body.version]);if(!r.affectedRows)throw periodError('設定が更新されています');await audit(conn,null,'settings',before[0],req.body,req.body.reason,req.session.user.user_id);return {};},true));
router.get('/',route(async(req,conn)=>{const [rows]=await conn.query(`SELECT annual_closing_id,fiscal_year,revision_no,status,version,reason,finalized_at FROM annual_closings a ${internal(req)?'':'WHERE EXISTS (SELECT 1 FROM annual_closing_reviews r WHERE r.annual_closing_id=a.annual_closing_id AND r.reviewer_user_id=?)'} ORDER BY fiscal_year DESC,revision_no DESC`,internal(req)?[]:[req.session.user.user_id]);return {closings:rows};}));
router.post('/preview',office,route(async(req,conn)=>({preview:await annual.build(conn,req.body.fiscal_year,req.body.input||{})})));
router.post('/draft',office,route(async(req,conn)=>{
  const year=annual.fiscalYear(req.body.fiscal_year),input=req.body.input||{},reason=String(req.body.reason||'').trim();
  if(!reason)throw periodError('作成・訂正理由を入力してください',400);
  let preview=await annual.build(conn,year,input);await lockProjects(conn,preview);preview=await annual.build(conn,year,input);
  if(req.body.source_token!==preview.source_token)throw periodError('根拠実績・設定が変わりました。差分を再計算してください');
  const [latestRows]=await conn.query('SELECT * FROM annual_closings WHERE fiscal_year=? ORDER BY revision_no DESC LIMIT 1 FOR UPDATE',[year]),latest=latestRows[0];
  let id;
  if(latest && ['draft','returned'].includes(latest.status)) {
    if(Number(req.body.annual_closing_id)!==Number(latest.annual_closing_id)||Number(req.body.version)!==Number(latest.version))throw periodError('既存の年度下書きを開いて更新してください');
    id=latest.annual_closing_id;await conn.query("UPDATE annual_closings SET status='draft',input_data=?,snapshot_data=?,source_token=?,reason=?,version=version+1 WHERE annual_closing_id=?",[JSON.stringify(input),JSON.stringify(preview),preview.source_token,reason,id]);
  } else {
    if(latest&&latest.status!=='finalized')throw periodError('営業確認中の年度締めがあります');
    if(latest && Number(req.body.correction_of_id)!==Number(latest.annual_closing_id))throw periodError('確定済みです。理由付きの訂正版として作成してください');
    const [created]=await conn.query('INSERT INTO annual_closings(fiscal_year,revision_no,correction_of_id,reason,input_data,snapshot_data,source_token,created_by_user_id) VALUES (?,?,?,?,?,?,?,?)',[year,Number(latest?.revision_no||0)+1,latest?.annual_closing_id||null,reason,JSON.stringify(input),JSON.stringify(preview),preview.source_token,req.session.user.user_id]);id=created.insertId;
    if(latest)await conn.query('UPDATE annual_closing_locks SET is_active=0 WHERE annual_closing_id=?',[latest.annual_closing_id]);
  }
  await audit(conn,id,latest?.status==='finalized'?'correction_draft':'draft',latest||null,{snapshot:preview,input},reason,req.session.user.user_id);return {annual_closing_id:id};
},true));
router.get('/:id',route(async(req,conn)=>{
  const row=await load(conn,req.params.id,req),[reviews]=await conn.query('SELECT r.*,u.display_name FROM annual_closing_reviews r LEFT JOIN users u ON u.user_id=r.reviewer_user_id WHERE r.annual_closing_id=? ORDER BY r.project_id,r.reviewer_user_id',[req.params.id]);
  const [documents]=await conn.query('SELECT annual_document_id,document_type,document_number,sha256 FROM annual_closing_documents WHERE annual_closing_id=?',[req.params.id]);
  let reconciliation=null;
  if(internal(req)) {
    const current=await annual.build(conn,row.fiscal_year,row.input_data);reconciliation={normal:current.normal,tail:current.tail,totals:current.totals,difference:{billing:current.totals.billing-row.snapshot_data.totals.billing,payment:current.totals.payment-row.snapshot_data.totals.payment},source_changed:current.source_token!==row.source_token};
  } else {
    const ids=new Set(reviews.filter(r=>Number(r.reviewer_user_id)===Number(req.session.user.user_id)).map(r=>Number(r.project_id)));
    row.snapshot_data={label:row.snapshot_data.label,details:row.snapshot_data.details.filter(d=>ids.has(Number(d.project.project_id)))};delete row.input_data;delete row.source_token;
  }
  return {closing:row,reviews:internal(req)?reviews:reviews.filter(r=>Number(r.reviewer_user_id)===Number(req.session.user.user_id)),documents:internal(req)?documents:[],reconciliation};
}));
router.post('/:id/submit',office,route(async(req,conn)=>{
  const row=await load(conn,req.params.id,req,true);expected(row,req);if(!['draft','returned'].includes(row.status))throw periodError('申請できる下書きではありません');
  await lockProjects(conn,row.snapshot_data);const fresh=await annual.build(conn,row.fiscal_year,row.input_data);
  if(fresh.source_token!==row.source_token)throw periodError('根拠が変更されています。下書きを再計算・保存してください');
  if(fresh.blockers.length)throw periodError(fresh.blockers.join('\n'),400);
  if(fresh.warnings.length&&(!row.input_data.acknowledge_warnings||!String(row.input_data.warning_reason||'').trim()))throw periodError('未確認項目を確認し、確認理由を入力してください',400);
  await conn.query("UPDATE annual_closing_reviews SET status='superseded' WHERE annual_closing_id=?",[row.annual_closing_id]);
  for(const detail of fresh.details) {
    const projectId=detail.project.project_id;let [reviewers]=await conn.query('SELECT u.user_id FROM project_settlement_reviewers r JOIN users u ON u.user_id=r.user_id AND u.is_active=1 AND u.is_deleted=0 WHERE r.project_id=?',[projectId]);let source='project';
    if(!reviewers.length){[reviewers]=await conn.query("SELECT user_id FROM users WHERE is_deleted=0 AND is_active=1 AND (role='admin' OR JSON_CONTAINS(COALESCE(roles,JSON_ARRAY()),JSON_QUOTE('admin'))) ORDER BY user_id LIMIT 1");source='admin_fallback';}
    if(!reviewers.length)throw periodError('営業確認者と代替管理者が見つかりません');
    for(const reviewer of reviewers)await conn.query("INSERT INTO annual_closing_reviews(annual_closing_id,project_id,reviewer_user_id,assignment_source) VALUES (?,?,?,?) ON DUPLICATE KEY UPDATE status='pending',note=NULL,decided_at=NULL,assignment_source=VALUES(assignment_source)",[row.annual_closing_id,projectId,reviewer.user_id,source]);
  }
  for(const range of fresh.locks)await conn.query('INSERT INTO annual_closing_locks(annual_closing_id,project_id,period_start,period_end) VALUES (?,?,?,?)',[row.annual_closing_id,range.project_id,range.period_start,range.period_end]);
  const status=fresh.details.length?'sales_review':'reviewed';await conn.query('UPDATE annual_closings SET status=?,version=version+1 WHERE annual_closing_id=?',[status,row.annual_closing_id]);
  await audit(conn,row.annual_closing_id,'submit',{status:row.status},{status,source_token:row.source_token},row.reason,req.session.user.user_id);return {status};
},true));
router.post('/:id/review',route(async(req,conn)=>{
  const row=await load(conn,req.params.id,req,true);expected(row,req);if(row.status!=='sales_review')throw periodError('営業確認中ではありません');
  const action=req.body.action,reason=String(req.body.reason||'').trim();if(!['approve','return'].includes(action)||(action==='return'&&!reason))throw periodError('確認操作と差戻し理由を確認してください',400);
  const ids=[...new Set((Array.isArray(req.body.project_ids)?req.body.project_ids:[]).map(Number))];if(!ids.length)throw periodError('確認した案件を選択してください',400);
  for(const id of ids){const [updated]=await conn.query("UPDATE annual_closing_reviews SET status=?,note=?,decided_at=CURRENT_TIMESTAMP WHERE annual_closing_id=? AND project_id=? AND reviewer_user_id=? AND status='pending'",[action==='approve'?'approved':'returned',reason,row.annual_closing_id,id,req.session.user.user_id]);if(!updated.affectedRows)throw periodError('自分に割り当てられた未確認案件だけを確認できます',403);}
  const [pending]=await conn.query("SELECT COUNT(*) n FROM annual_closing_reviews WHERE annual_closing_id=? AND status IN ('pending','returned')",[row.annual_closing_id]);
  const status=action==='return'?'returned':Number(pending[0].n)?'sales_review':'reviewed';
  if(status==='returned')await conn.query('UPDATE annual_closing_locks SET is_active=0 WHERE annual_closing_id=?',[row.annual_closing_id]);
  await conn.query('UPDATE annual_closings SET status=?,version=version+1 WHERE annual_closing_id=?',[status,row.annual_closing_id]);await audit(conn,row.annual_closing_id,'review',null,{status,project_ids:ids,action},reason||'担当案件確認',req.session.user.user_id);return {status};
},true));
router.post('/:id/finalize',finalizer,route(async(req,conn)=>{
  const row=await load(conn,req.params.id,req,true);expected(row,req);if(row.status!=='reviewed')throw periodError('すべての担当営業の確認が必要です');
  const [pending]=await conn.query("SELECT 1 FROM annual_closing_reviews WHERE annual_closing_id=? AND status IN ('pending','returned') LIMIT 1",[row.annual_closing_id]);if(pending.length)throw periodError('未確認の担当案件があります');
  const documents=[];
  for(const type of ['invoice','payment']) {
    const number=`ANNUAL-${row.fiscal_year}-R${row.revision_no}-${type}-${crypto.randomUUID()}`;
    const file=await writeHtmlPdf(`${number}.pdf`,renderAnnual(row,type));
    const hash=crypto.createHash('sha256').update(await fs.readFile(file.absolutePath)).digest('hex');
    await conn.query('INSERT INTO annual_closing_documents(annual_closing_id,document_type,document_number,file_name,sha256,snapshot_data) VALUES (?,?,?,?,?,?)',[row.annual_closing_id,type,number,file.fileName,hash,JSON.stringify(row.snapshot_data)]);documents.push({document_type:type,document_number:number,sha256:hash});
  }
  await conn.query("UPDATE annual_closings SET status='finalized',version=version+1,finalized_at=CURRENT_TIMESTAMP,finalized_by_user_id=? WHERE annual_closing_id=?",[req.session.user.user_id,row.annual_closing_id]);await audit(conn,row.annual_closing_id,'finalize',{status:row.status},{status:'finalized',documents},row.reason,req.session.user.user_id);return {documents};
},true));
router.get('/:id/documents/:documentId',async(req,res)=>{try{const conn=getPool();await load(conn,req.params.id,req);if(!internal(req))throw periodError('保存帳票の閲覧権限がありません',403);const [rows]=await conn.query('SELECT file_name FROM annual_closing_documents WHERE annual_document_id=? AND annual_closing_id=?',[req.params.documentId,req.params.id]);if(!rows.length)throw periodError('帳票が見つかりません',404);res.set('Cache-Control','private, no-store').type('application/pdf').sendFile(path.resolve(PDF_DIR,path.basename(rows[0].file_name)));}catch(e){res.status(e.status||500).json({ok:false,message:e.message});}});
module.exports=router;
