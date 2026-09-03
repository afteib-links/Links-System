const express = require('express');
const fs = require('fs');
const { getPool, query } = require('../db');
const { requireAuth, requireRole } = require('../middleware/auth');
const { ensureCycles } = require('./cash_management');
const { PDF_DIR, writePdf } = require('../services/settlement_pdf');

const router = express.Router();
router.use(requireAuth);
const SYSTEM_TAX_RATE = 0.1;
const roles = (req) => new Set(req.session.user?.roles || []);
const has = (req, values) => values.some((v) => roles(req).has(v));
const asMoney = (value) => Math.round(Number(value || 0) * 100) / 100;
const effective = (row, kind) => Number(kind === 'invoice' ? (row.override_billing_amount ?? row.calculated_billing_amount ?? 0) : (row.override_payment_amount ?? row.calculated_payment_amount ?? 0));
const tableFor = (kind) => kind === 'invoice' ? 'invoices' : 'payments';
const idFor = (kind) => kind === 'invoice' ? 'invoice_id' : 'payment_id';

function validKind(kind) { return ['invoice', 'payment'].includes(kind); }
function rounding(amount, mode) { return mode === 'ceil' ? Math.ceil(amount) : mode === 'round' ? Math.round(amount) : Math.floor(amount); }
function json(value) { if (!value) return {}; return typeof value === 'string' ? JSON.parse(value) : value; }

async function checkMonthlyApprovals(conn, reports, ym) {
  const projects = [...new Set(reports.map((r) => r.project_id).filter(Boolean))];
  for (const projectId of projects) {
    const [rows] = await conn.query(`SELECT monthly_approval_id, snapshot_data FROM daily_report_monthly_approvals WHERE project_id=? AND target_year_month=? AND status='approved' ORDER BY approval_version DESC LIMIT 1`, [projectId, ym]);
    if (!rows.length) throw new Error('月次承認済みの日報だけを請求・支払の根拠にできます');
  }
}

async function approvedSnapshotReports(conn, reports, ym) {
  const byId = new Map();
  const projects = [...new Set(reports.map((row) => Number(row.project_id)).filter(Boolean))];
  for (const projectId of projects) {
    const [approvals] = await conn.query(
      `SELECT monthly_approval_id, approval_version, snapshot_data
       FROM daily_report_monthly_approvals
       WHERE project_id=? AND target_year_month=? AND status='approved'
       ORDER BY approval_version DESC LIMIT 1`,
      [projectId, ym]
    );
    if (!approvals.length) throw new Error('月次承認済みの日報だけを請求・支払の根拠にできます');
    const approval = approvals[0];
    const snapshot = json(approval.snapshot_data);
    for (const row of Array.isArray(snapshot.reports) ? snapshot.reports : []) {
      byId.set(Number(row.daily_report_id), {
        ...row,
        monthly_approval_id: Number(approval.monthly_approval_id),
        monthly_approval_version: Number(approval.approval_version),
      });
    }
  }
  const selected = reports.map((current) => {
    const snapshot = byId.get(Number(current.daily_report_id));
    if (!snapshot) throw new Error('選択した日報が最新の月次承認スナップショットに含まれていません');
    return { ...snapshot, project_name: current.project_name || snapshot.project_name };
  });
  return selected;
}

async function resolveInvoiceTax(conn, companyId, projectIds) {
  const [companyRows] = await conn.query('SELECT tax_rate,tax_rounding FROM company_invoice_settings WHERE company_id=?', [companyId]);
  if (companyRows[0]?.tax_rate != null) {
    return { rate:Number(companyRows[0].tax_rate), mode:companyRows[0].tax_rounding || 'floor' };
  }
  const ids = [...new Set(projectIds.map(Number).filter(Boolean))];
  let projectRows = [];
  if (ids.length) {
    [projectRows] = await conn.query(
      `SELECT project_id,tax_rate,tax_rounding FROM project_invoice_settings
       WHERE project_id IN (${ids.map(() => '?').join(',')})`, ids
    );
  }
  const [systemRows] = await conn.query("SELECT setting_value FROM system_settings WHERE setting_key='default_tax_rate' AND is_deleted=0 LIMIT 1");
  const configuredSystemRate = Number(systemRows[0]?.setting_value);
  const systemRate = Number.isFinite(configuredSystemRate) ? configuredSystemRate : SYSTEM_TAX_RATE;
  const byProject = new Map(projectRows.map((row) => [Number(row.project_id), row]));
  const resolvedRates = [...new Set(ids.map((projectId) => {
    const value = byProject.get(projectId)?.tax_rate;
    return value == null ? systemRate : Number(value);
  }))];
  const resolvedModes = [...new Set(ids.map((projectId) => byProject.get(projectId)?.tax_rounding || 'floor'))];
  if (resolvedRates.length > 1 || resolvedModes.length > 1) {
    throw new Error('複数案件の税率または端数処理が異なります。請求先設定を登録してください');
  }
  return {
    rate: resolvedRates[0] ?? systemRate,
    mode: resolvedModes[0] || 'floor',
  };
}

async function canAccessSettlement(req, kind, id) {
  const elevated = has(req, ['admin', 'soumu', 'executive']);
  if (elevated) return true;
  const table = tableFor(kind); const key = idFor(kind);
  const entityColumns = kind === 'invoice' ? 'company_id,NULL AS partner_id' : 'NULL AS company_id,partner_id';
  const [rows] = await getPool().query(`SELECT ${entityColumns} FROM ${table} WHERE ${key}=? AND is_deleted=0`, [id]);
  if (!rows.length) return false;
  const row = rows[0];
  if (roles(req).has('company')) return kind === 'invoice' && Number(req.session.user.company_id) === Number(row.company_id);
  if (roles(req).has('partner')) return kind === 'payment' && Number(req.session.user.partner_id) === Number(row.partner_id);
  if (roles(req).has('sales')) {
    const linkTable = kind === 'invoice' ? 'invoice_daily_reports' : 'payment_daily_reports';
    const linkKey = idFor(kind);
    const [reviewed] = await getPool().query(
      `SELECT 1 FROM ${linkTable} l
       JOIN daily_reports d ON d.daily_report_id=l.daily_report_id
       JOIN project_settlement_reviewers r ON r.project_id=d.project_id
       WHERE l.${linkKey}=? AND r.user_id=? LIMIT 1`, [id, req.session.user.user_id]
    );
    return reviewed.length > 0;
  }
  return false;
}

async function insertLines(conn, kind, settlementId, lines) {
  const ids = [];
  for (const line of lines) {
    const [result] = await conn.query(`INSERT INTO settlement_lines (settlement_type,settlement_id,line_type,source_type,source_id,project_id,daily_report_id,item_name,quantity,unit_price,amount,tax_category,reason,snapshot_json) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`, [kind, settlementId, line.line_type, line.source_type, line.source_id || null, line.project_id || null, line.daily_report_id || null, line.item_name, line.quantity ?? 1, line.unit_price ?? line.amount, line.amount, line.tax_category || 'taxable', line.reason || null, JSON.stringify(line.snapshot || {})]);
    ids.push(Number(result.insertId));
  }
  return ids;
}

async function addCompatibilityLines(conn, kind, id, lines) {
  if (kind === 'invoice') {
    for (const line of lines) await conn.query(`INSERT INTO invoice_details (invoice_id,price_name,unit_price,quantity,amount,is_adjustment_row,extra_data) VALUES (?,?,?,?,?,?,?)`, [id,line.item_name,line.unit_price ?? line.amount,line.quantity ?? 1,line.amount,line.line_type === 'adjustment' ? 1 : 0,JSON.stringify({ source_type: line.source_type, tax_category: line.tax_category, reason: line.reason || null })]);
  } else {
    for (const line of lines) await conn.query(`INSERT INTO payment_details (payment_id,detail_type,item_name,unit_price,quantity,amount,extra_data) VALUES (?,?,?,?,?,?,?)`, [id, line.line_type === 'work' ? 'work_item' : line.line_type === 'adjustment' ? 'adjustment_item' : 'deduction_item', line.item_name,line.unit_price ?? line.amount,line.quantity ?? 1,line.amount,JSON.stringify({ source_type: line.source_type, tax_category: line.tax_category, reason: line.reason || null })]);
  }
}

async function applicableRules(conn, partnerId, ym) {
  const [rows] = await conn.query(`SELECT r.* FROM settlement_deduction_rules r WHERE r.is_active=1 AND r.valid_from <= ? AND (r.valid_to IS NULL OR r.valid_to >= ?) AND (r.scope='common' OR r.partner_id=?) ORDER BY r.rule_code, CASE WHEN r.scope='partner' THEN 0 ELSE 1 END, r.valid_from DESC`, [`${ym}-31`, `${ym}-01`, partnerId]);
  const used = new Set();
  return rows.filter((r) => !used.has(r.rule_code) && used.add(r.rule_code));
}

router.get('/settings/deduction-rules', requireRole('admin','soumu'), async (_req,res) => {
  try { return res.json({ok:true,rules:await query(`SELECT r.*,p.partner_name FROM settlement_deduction_rules r LEFT JOIN partners p ON p.partner_id=r.partner_id ORDER BY r.rule_code,r.valid_from DESC`)}); }
  catch (_err) { return res.status(500).json({ok:false,message:'控除ルールの取得に失敗しました'}); }
});
router.post('/settings/deduction-rules', requireRole('admin','soumu'), async (req,res) => {
  const b=req.body||{}; if(!String(b.rule_code||'').trim()||!String(b.display_name||'').trim()||!b.valid_from||!Number.isFinite(Number(b.amount))) return res.status(400).json({ok:false,message:'ルールコード、名称、金額、適用開始日は必須です'});
  try { const [result]=await getPool().query(`INSERT INTO settlement_deduction_rules (rule_code,scope,partner_id,display_name,amount,tax_category,valid_from,valid_to,is_active) VALUES (?,?,?,?,?,?,?,?,?)`,[String(b.rule_code).trim(),b.scope==='partner'?'partner':'common',b.scope==='partner'?Number(b.partner_id):null,String(b.display_name).trim(),Number(b.amount),b.tax_category||'taxable',b.valid_from,b.valid_to||null,b.is_active===false?0:1]); return res.status(201).json({ok:true,settlement_deduction_rule_id:result.insertId}); }
  catch(err){return res.status(400).json({ok:false,message:err.message});}
});
router.put('/settings/company/:companyId', requireRole('admin','soumu'), async(req,res)=>{const b=req.body||{};try{await getPool().query(`INSERT INTO company_invoice_settings (company_id,display_mode,tax_rate,tax_rounding) VALUES (?,?,?,?) ON DUPLICATE KEY UPDATE display_mode=VALUES(display_mode),tax_rate=VALUES(tax_rate),tax_rounding=VALUES(tax_rounding)`,[Number(req.params.companyId),b.display_mode==='project_aggregated'?'project_aggregated':'detailed',b.tax_rate??null,b.tax_rounding||'floor']);return res.json({ok:true});}catch(err){return res.status(400).json({ok:false,message:err.message});}});
router.put('/settings/project/:projectId', requireRole('admin','soumu'), async(req,res)=>{const b=req.body||{};try{await getPool().query(`INSERT INTO project_invoice_settings (project_id,tax_rate,tax_rounding) VALUES (?,?,?) ON DUPLICATE KEY UPDATE tax_rate=VALUES(tax_rate),tax_rounding=VALUES(tax_rounding)`,[Number(req.params.projectId),b.tax_rate??null,b.tax_rounding||null]);return res.json({ok:true});}catch(err){return res.status(400).json({ok:false,message:err.message});}});
router.put('/settings/project/:projectId/reviewers', requireRole('admin','soumu'), async(req,res)=>{const ids=Array.isArray(req.body?.user_ids)?req.body.user_ids.map(Number).filter(Boolean):[];const conn=await getPool().getConnection();try{await conn.beginTransaction();await conn.query('DELETE FROM project_settlement_reviewers WHERE project_id=?',[Number(req.params.projectId)]);for(const userId of ids)await conn.query(`INSERT INTO project_settlement_reviewers (project_id,user_id) SELECT ?,user_id FROM users WHERE user_id=? AND is_deleted=0`,[Number(req.params.projectId),userId]);await conn.commit();return res.json({ok:true});}catch(err){await conn.rollback();return res.status(400).json({ok:false,message:err.message});}finally{conn.release();}});

router.post('/:kind/drafts', requireRole('admin', 'soumu'), async (req, res) => {
  const kind = req.params.kind;
  if (!validKind(kind)) return res.status(404).json({ ok:false, message:'対象が不正です' });
  const b = req.body || {}; const ym = String(b.target_year_month || ''); const entityId = Number(kind === 'invoice' ? b.company_id : b.partner_id);
  const ids = [...new Set(Array.isArray(b.daily_report_ids) ? b.daily_report_ids.map(Number).filter(Boolean) : [])];
  if (!/^\d{4}-\d{2}$/.test(ym) || !entityId || !ids.length) return res.status(400).json({ok:false,message:'対象年月、相手先、月次承認済み日報は必須です'});
  const pool=getPool(); const conn=await pool.getConnection();
  try {
    await conn.beginTransaction();
    const [reports] = await conn.query(`SELECT d.*,bp.template_name AS project_name,pr.company_id AS project_company_id FROM daily_reports d LEFT JOIN projects pr ON pr.project_id=d.project_id LEFT JOIN base_projects bp ON bp.base_project_id=pr.base_project_id WHERE d.daily_report_id IN (${ids.map(()=>'?').join(',')}) AND d.is_deleted=0 AND d.target_year_month=? AND d.status='approved' AND ${kind === 'invoice' ? 'd.company_id=? AND d.billing_status=\'none\'' : 'd.partner_id=? AND d.payment_status=\'none\''} FOR UPDATE`, [...ids, ym, entityId]);
    if (reports.length !== ids.length) throw new Error('対象日報には承認済みでない、または既に確定対象となったものが含まれます');
    await checkMonthlyApprovals(conn, reports, ym);
    const approvedReports = await approvedSnapshotReports(conn, reports, ym);
    const workLines = approvedReports.map((r) => ({ line_type:'work',source_type:'monthly_approval_snapshot',source_id:r.monthly_approval_id,project_id:r.project_id,daily_report_id:r.daily_report_id,item_name:`${r.project_name || '案件'} ${String(r.work_date).slice(0,10)}`,quantity:1,unit_price:effective(r,kind),amount:effective(r,kind),tax_category:'taxable',snapshot:r }));
    const manual = Array.isArray(b.adjustments) ? b.adjustments.map((x) => ({ line_type:'adjustment',source_type:'manual_adjustment',item_name:String(x.item_name || '調整'),quantity:1,unit_price:asMoney(x.amount),amount:asMoney(x.amount),tax_category:x.tax_category || 'taxable',reason:String(x.reason || '').trim() || null,snapshot:x })) : [];
    if (manual.some((x)=>x.amount < 0 && !x.reason)) throw new Error('負額調整には理由が必要です');
    const lines = [...workLines, ...manual];
    let settlementId;
    if (kind === 'invoice') {
      const [company] = await conn.query('SELECT company_name FROM companies WHERE company_id=? AND is_deleted=0',[entityId]); if (!company.length) throw new Error('企業が見つかりません');
      const [result] = await conn.query(`INSERT INTO invoices (company_id,target_year_month,closing_date,invoice_status,settlement_status,subtotal_amount,adjustment_amount,taxable_amount,tax_amount,total_amount,extra_data) VALUES (?,?,?,'draft','draft',0,0,0,0,0,?)`,[entityId,ym,String(b.closing_date || 'end'),JSON.stringify({ draft_source:'settlement' })]); settlementId=result.insertId;
    } else {
      const [partner] = await conn.query('SELECT partner_name,payment_output_code FROM partners WHERE partner_id=? AND is_deleted=0',[entityId]); if (!partner.length) throw new Error('パートナーが見つかりません');
      const [result] = await conn.query(`INSERT INTO payments (partner_id,target_year_month,closing_date,payment_status,settlement_status,gross_amount,final_transfer_amount,payment_output_code,extra_data) VALUES (?,?,?,'draft','draft',0,0,?,?)`,[entityId,ym,String(b.closing_date || 'end'),partner[0].payment_output_code || null,JSON.stringify({ draft_source:'settlement', issue_salary_statement: Boolean(b.issue_salary_statement) })]); settlementId=result.insertId;
    }
    await insertLines(conn,kind,settlementId,lines); await addCompatibilityLines(conn,kind,settlementId,lines);
    for (const r of reports) await conn.query(kind === 'invoice' ? 'INSERT INTO invoice_daily_reports (invoice_id,daily_report_id) VALUES (?,?)' : 'INSERT INTO payment_daily_reports (payment_id,daily_report_id) VALUES (?,?)',[settlementId,r.daily_report_id]);
    for (const r of reports) await conn.query(kind === 'invoice' ? "UPDATE daily_reports SET billing_status='reserved',version=version+1 WHERE daily_report_id=?" : "UPDATE daily_reports SET payment_status='reserved',version=version+1 WHERE daily_report_id=?", [r.daily_report_id]);
    await conn.query(`INSERT INTO settlement_workflows (settlement_type,settlement_id,drafted_by_user_id) VALUES (?,?,?)`,[kind,settlementId,req.session.user.user_id]);
    await conn.commit(); return res.status(201).json({ok:true, settlement_id:settlementId, status:'draft'});
  } catch(err) { await conn.rollback(); return res.status(400).json({ok:false,message:err.message}); } finally { conn.release(); }
});

router.post('/:kind/:id/sales-review', requireRole('admin','sales'), async (req,res) => {
  const kind=req.params.kind, id=Number(req.params.id); if(!validKind(kind)) return res.status(404).end(); const conn=await getPool().getConnection();
  try { await conn.beginTransaction(); const [wf]=await conn.query(`SELECT * FROM settlement_workflows WHERE settlement_type=? AND settlement_id=? FOR UPDATE`,[kind,id]); if(!wf.length || wf[0].status!=='draft') throw new Error('下書き状態のものだけ営業確認できます');
    const links=await conn.query(kind==='invoice'?`SELECT d.project_id FROM invoice_daily_reports l JOIN daily_reports d ON d.daily_report_id=l.daily_report_id WHERE l.invoice_id=?`:`SELECT d.project_id FROM payment_daily_reports l JOIN daily_reports d ON d.daily_report_id=l.daily_report_id WHERE l.payment_id=?`,[id]);
    const projectIds=[...new Set(links[0].map(x=>x.project_id).filter(Boolean))]; const actor=req.session.user.user_id;
    if (!roles(req).has('admin')) for(const projectId of projectIds){const [reviewers]=await conn.query('SELECT user_id FROM project_settlement_reviewers WHERE project_id=?',[projectId]); if(!reviewers.some(x=>Number(x.user_id)===Number(actor))) throw new Error('担当営業者だけが確認できます。案件に営業確認者を設定してください');}
    await conn.query(`UPDATE settlement_workflows SET status='sales_reviewed',sales_reviewed_by_user_id=?,sales_reviewed_at=CURRENT_TIMESTAMP WHERE settlement_workflow_id=?`,[actor,wf[0].settlement_workflow_id]); await conn.query(`UPDATE ${tableFor(kind)} SET settlement_status='sales_reviewed' WHERE ${idFor(kind)}=?`,[id]); await conn.commit(); return res.json({ok:true,status:'sales_reviewed'});
  } catch(err){await conn.rollback();return res.status(400).json({ok:false,message:err.message});} finally{conn.release();}
});

async function nextDocumentNumber(conn, type, year) { await conn.query(`INSERT INTO settlement_document_sequences (document_type,document_year,last_number) VALUES (?,?,1) ON DUPLICATE KEY UPDATE last_number=LAST_INSERT_ID(last_number+1)`,[type,year]); const [rows]=await conn.query('SELECT last_number FROM settlement_document_sequences WHERE document_type=? AND document_year=?',[type,year]); return `${type.toUpperCase()}-${year}-${String(rows[0].last_number).padStart(5,'0')}`; }

async function executedNetForCorrectionChain(conn, kind, workflow) {
  const ids = [];
  let current = Number(workflow.correction_of_settlement_id || 0);
  while (current && !ids.includes(current)) {
    ids.push(current);
    const [parents] = await conn.query(
      `SELECT correction_of_settlement_id FROM settlement_workflows
       WHERE settlement_type=? AND settlement_id=?`, [kind,current]
    );
    current = Number(parents[0]?.correction_of_settlement_id || 0);
  }
  if (!ids.length) return 0;
  const [rows] = await conn.query(
    `SELECT s.direction,COALESCE(SUM(t.executed_amount),0) amount
     FROM cash_schedules s JOIN cash_transactions t ON t.cash_schedule_id=s.cash_schedule_id AND t.status='executed'
     WHERE s.source_id IN (${ids.map(()=>'?').join(',')})
       AND (s.source_type=? OR (s.source_type='adjustment' AND JSON_UNQUOTE(JSON_EXTRACT(s.snapshot_json,'$.settlement_type'))=?))
     GROUP BY s.direction`, [...ids,kind,kind]
  );
  const baseDirection=kind==='invoice'?'incoming':'outgoing';
  return rows.reduce((sum,row)=>sum+(row.direction===baseDirection?1:-1)*Number(row.amount),0);
}

const DOCUMENT_SETTING_KEYS = [
  'document_issuer_name',
  'document_issuer_zip_code',
  'document_issuer_address',
  'document_issuer_registration_number',
  'document_issuer_tel',
  'document_issuer_fax',
  'document_issuer_bank_accounts',
  'document_issuer_logo_data_url',
  'document_issuer_stamp_data_url',
  'document_transfer_fee_note',
];

async function documentSettings(conn) {
  const [rows] = await conn.query(
    `SELECT setting_key,setting_value FROM system_settings
     WHERE is_deleted=0 AND setting_key IN (${DOCUMENT_SETTING_KEYS.map(() => '?').join(',')})`,
    DOCUMENT_SETTING_KEYS
  );
  const values = Object.fromEntries(rows.map((row) => [row.setting_key, row.setting_value]));
  return {
    issuer: {
      name:values.document_issuer_name || '',
      zip_code:values.document_issuer_zip_code || '',
      address:values.document_issuer_address || '',
      registration_number:values.document_issuer_registration_number || '',
      tel:values.document_issuer_tel || '',
      fax:values.document_issuer_fax || '',
      bank_accounts:json(values.document_issuer_bank_accounts),
      logo_data_url:values.document_issuer_logo_data_url || '',
      stamp_data_url:values.document_issuer_stamp_data_url || '',
    },
    transfer_fee_note:values.document_transfer_fee_note || '恐れ入りますが、振込手数料は御社でご負担をお願い申し上げます。',
  };
}

async function documentRecipient(conn, kind, header) {
  if (kind === 'invoice') {
    const [rows] = await conn.query(
      `SELECT c.company_name,c.zip_code,c.address,c.contact,c.fax,
              cb.billing_print_name,cb.billing_address,cb.billing_phone,cb.billing_fax
       FROM companies c
       LEFT JOIN company_billings cb ON cb.billing_id=? AND cb.company_id=c.company_id AND cb.is_deleted=0
       WHERE c.company_id=? LIMIT 1`,
      [header.billing_id || null,header.company_id]
    );
    const row=rows[0] || {};
    return {
      name:header.billing_print_name || row.billing_print_name || row.company_name || header.company_name || '',
      zip_code:row.zip_code || '',
      address:row.billing_address || row.address || '',
      tel:row.billing_phone || row.contact || '',
      fax:row.billing_fax || row.fax || '',
    };
  }
  const [rows] = await conn.query(
    `SELECT partner_name,zip_code,address,contact_phone,bank_name,branch_name,
            account_number,deposit_type,account_name,invoice_number
     FROM partners WHERE partner_id=? LIMIT 1`,
    [header.partner_id]
  );
  const row=rows[0] || {};
  return {
    name:row.partner_name || header.partner_name || '',
    zip_code:row.zip_code || '',
    address:row.address || '',
    tel:row.contact_phone || '',
    registration_number:row.invoice_number || '',
    bank_name:row.bank_name || '',
    branch_name:row.branch_name || '',
    account_number:row.account_number || '',
    deposit_type:row.deposit_type || '',
    account_name:row.account_name || '',
  };
}

async function cancelScheduleExports(conn, kind, settlementId, reason) {
  const [batchRows] = await conn.query(
    `SELECT DISTINCT i.cash_export_batch_id
     FROM cash_export_batch_items i JOIN cash_schedules s ON s.cash_schedule_id=i.cash_schedule_id
     WHERE s.source_id=? AND (s.source_type=? OR (s.source_type='adjustment' AND JSON_UNQUOTE(JSON_EXTRACT(s.snapshot_json,'$.settlement_type'))=?))
       AND i.status='active'`, [settlementId,kind,kind]
  );
  await conn.query(
    `UPDATE cash_export_batch_items i JOIN cash_schedules s ON s.cash_schedule_id=i.cash_schedule_id
     SET i.status='cancelled',i.cancelled_at=CURRENT_TIMESTAMP,i.cancellation_reason=?
     WHERE s.source_id=? AND (s.source_type=? OR (s.source_type='adjustment' AND JSON_UNQUOTE(JSON_EXTRACT(s.snapshot_json,'$.settlement_type'))=?))
       AND i.status='active'`, [reason,settlementId,kind,kind]
  );
  for (const row of batchRows) {
    await conn.query(
      `UPDATE cash_export_batches b SET b.status=
       CASE
         WHEN NOT EXISTS (SELECT 1 FROM cash_export_batch_items i WHERE i.cash_export_batch_id=b.cash_export_batch_id AND i.status='active') THEN 'cancelled'
         ELSE 'partially_cancelled'
       END WHERE b.cash_export_batch_id=?`, [row.cash_export_batch_id]
    );
  }
  await conn.query(
    `UPDATE cash_schedules SET status='cancelled',version=version+1
     WHERE source_id=? AND (source_type=? OR (source_type='adjustment' AND JSON_UNQUOTE(JSON_EXTRACT(snapshot_json,'$.settlement_type'))=?))
       AND status IN ('planned','exported','held')`, [settlementId,kind,kind]
  );
}

async function restorePaymentAllocations(conn, paymentId, actor, reason) {
  const [carryAllocations] = await conn.query(
    `SELECT * FROM settlement_carry_forward_allocations
     WHERE payment_id=? AND status='active' FOR UPDATE`, [paymentId]
  );
  for (const allocation of carryAllocations) {
    await conn.query(
      `UPDATE settlement_carry_forwards
       SET remaining_amount=remaining_amount+?,status='open'
       WHERE settlement_carry_forward_id=?`,
      [allocation.amount,allocation.settlement_carry_forward_id]
    );
  }
  await conn.query(
    `UPDATE settlement_carry_forward_allocations
     SET status='cancelled',cancelled_at=CURRENT_TIMESTAMP,cancelled_by_user_id=?,cancellation_reason=?
     WHERE payment_id=? AND status='active'`, [actor,reason,paymentId]
  );
  await conn.query(
    `UPDATE advance_payment_allocations
     SET status='cancelled',cancelled_at=CURRENT_TIMESTAMP,cancelled_by_user_id=?,cancellation_reason=?
     WHERE payment_id=? AND status='active'`, [actor,reason,paymentId]
  );
  await conn.query(
    `UPDATE settlement_carry_forwards SET status='cancelled'
     WHERE source_payment_id=? AND status='open'`, [paymentId]
  );
}

router.post('/:kind/:id/finalize', requireRole('admin','executive'), async (req,res) => {
  const kind=req.params.kind,id=Number(req.params.id); if(!validKind(kind)) return res.status(404).end(); const b=req.body||{}; const conn=await getPool().getConnection(); const generated=[];
  try { await conn.beginTransaction(); const [headerRows]=await conn.query(`SELECT s.*, ${kind==='invoice'?'c.company_name':'p.partner_name'} FROM ${tableFor(kind)} s LEFT JOIN ${kind==='invoice'?'companies c ON c.company_id=s.company_id':'partners p ON p.partner_id=s.partner_id'} WHERE s.${idFor(kind)}=? FOR UPDATE`,[id]); const header=headerRows[0]; if(!header) throw new Error('対象が見つかりません'); const [wf]=await conn.query('SELECT * FROM settlement_workflows WHERE settlement_type=? AND settlement_id=? FOR UPDATE',[kind,id]); if(!wf.length || wf[0].status!=='sales_reviewed') throw new Error('営業確認済みの下書きだけ最終確定できます');
    const [lines]=await conn.query('SELECT * FROM settlement_lines WHERE settlement_type=? AND settlement_id=? ORDER BY settlement_line_id',[kind,id]); let finalLines=lines.map(x=>({...x,amount:Number(x.amount),unit_price:Number(x.unit_price),quantity:Number(x.quantity)}));
    let pdfLines = finalLines;
    let invoiceDisplayMode = 'detailed';
    let invoiceTaxRate = SYSTEM_TAX_RATE;
    let invoiceTaxAmount = 0;
    let invoiceSubtotal = 0;
    if(kind==='invoice'){
      const [setting]=await conn.query('SELECT * FROM company_invoice_settings WHERE company_id=?',[header.company_id]);
      invoiceDisplayMode=setting[0]?.display_mode || 'detailed';
      const projects=[...new Set(finalLines.map(x=>x.project_id).filter(Boolean))];
      const resolvedTax = await resolveInvoiceTax(conn, header.company_id, projects);
      const taxRate=resolvedTax.rate, taxMode=resolvedTax.mode;
      const taxable=finalLines.filter(x=>x.tax_category==='taxable').reduce((n,x)=>n+x.amount,0);
      const tax=rounding(taxable*taxRate,taxMode);
      const total=asMoney(finalLines.reduce((n,x)=>n+x.amount,0)+tax);
      if(setting[0]?.display_mode === 'project_aggregated'){
        const grouped=new Map();
        for(const line of finalLines){
          const key=line.project_id||`other:${line.line_type}`;
          const old=grouped.get(key)||{...line,item_name:line.project_id?`案件 #${line.project_id}`:line.item_name,quantity:0,unit_price:0,amount:0};
          old.quantity+=Number(line.quantity||1); old.amount+=Number(line.amount); grouped.set(key,old);
        }
        pdfLines=[...grouped.values()];
      }
      await conn.query(`UPDATE invoices SET subtotal_amount=?,adjustment_amount=?,taxable_amount=?,tax_amount=?,total_amount=?,invoice_status='finalized',settlement_status='finalized',finalized_snapshot=? WHERE invoice_id=?`,[finalLines.filter(x=>x.line_type==='work').reduce((n,x)=>n+x.amount,0),finalLines.filter(x=>x.line_type==='adjustment').reduce((n,x)=>n+x.amount,0),taxable,tax,total,JSON.stringify({header,lines:finalLines,display_lines:pdfLines,tax_rate:taxRate,tax_rounding:taxMode}),id]);
      invoiceTaxRate=taxRate;
      invoiceTaxAmount=tax;
      invoiceSubtotal=asMoney(finalLines.reduce((n,x)=>n+x.amount,0));
      header.total_amount=total;
    } else {
      const gross=finalLines.filter(x=>x.line_type==='work'||x.line_type==='adjustment').reduce((n,x)=>n+x.amount,0);
      let final;
      if (wf[0].correction_of_settlement_id) {
        final = Math.max(0, asMoney(finalLines.reduce((n,x)=>n+x.amount,0)));
      } else {
        const rules=await applicableRules(conn,header.partner_id,header.target_year_month);
        const [carries]=await conn.query(`SELECT * FROM settlement_carry_forwards WHERE partner_id=? AND status='open' FOR UPDATE`,[header.partner_id]);
        const [advances]=await conn.query(
          `SELECT ar.advance_record_id, ar.advance_amount-COALESCE(SUM(CASE WHEN a.status='active' THEN a.amount ELSE 0 END),0) remaining
           FROM advance_records ar
           JOIN cash_schedules cs ON cs.cash_schedule_id=ar.cash_schedule_id AND cs.status='executed'
           LEFT JOIN advance_payment_allocations a ON a.advance_record_id=ar.advance_record_id
           WHERE ar.partner_id=? AND ar.status='executed'
           GROUP BY ar.advance_record_id,ar.advance_amount HAVING remaining>0 FOR UPDATE`,[header.partner_id]
        );
        const candidates=[
          ...carries.map(x=>({type:'carry',row:x,name:x.item_name,amount:Number(x.remaining_amount),tax:x.tax_category})),
          ...advances.map(x=>({type:'advance',row:x,name:'前払控除',amount:Number(x.remaining),tax:'non_taxable'})),
          ...rules.map(x=>({type:'rule',row:x,name:x.display_name,amount:Number(x.amount),tax:x.tax_category})),
        ];
        let available=Math.max(0,gross);
        for(const c of candidates){
          const applied=Math.min(available,c.amount);
          if(applied>0){
            const line={line_type:c.type==='advance'?'advance':c.type==='carry'?'carry_forward':'deduction',source_type:c.type,source_id:c.type==='rule'?c.row.settlement_deduction_rule_id:c.type==='advance'?c.row.advance_record_id:c.row.settlement_carry_forward_id,item_name:c.name,quantity:1,unit_price:-applied,amount:-applied,tax_category:c.tax,snapshot:c.row};
            finalLines.push(line);
            await insertLines(conn,kind,id,[line]);
            await addCompatibilityLines(conn,kind,id,[line]);
            if(c.type==='carry'){
              await conn.query(`UPDATE settlement_carry_forwards SET remaining_amount=remaining_amount-?,status=IF(remaining_amount-?<=0,'settled','open') WHERE settlement_carry_forward_id=?`,[applied,applied,c.row.settlement_carry_forward_id]);
              await conn.query('INSERT INTO settlement_carry_forward_allocations (settlement_carry_forward_id,payment_id,amount) VALUES (?,?,?)',[c.row.settlement_carry_forward_id,id,applied]);
            }
            if(c.type==='advance') await conn.query('INSERT INTO advance_payment_allocations (advance_record_id,payment_id,amount) VALUES (?,?,?)',[c.row.advance_record_id,id,applied]);
          }
          const remainder=c.amount-applied;
          if(remainder>0 && c.type==='rule'){
            await conn.query(`INSERT INTO settlement_carry_forwards (partner_id,source_payment_id,source_line_id,item_name,original_amount,remaining_amount,tax_category) VALUES (?,?,?,?,?,?,?)`,[header.partner_id,id,null,c.name,remainder,remainder,c.tax]);
          }
          available-=applied;
        }
        final=asMoney(available);
      }
      await conn.query(`UPDATE payments SET gross_amount=?,advance_deduction_amount=?,office_fee_amount=?,safety_fee_amount=?,final_transfer_amount=?,payment_status='finalized',settlement_status='finalized',finalized_snapshot=? WHERE payment_id=?`,[gross,finalLines.filter(x=>x.line_type==='advance').reduce((n,x)=>n+Math.abs(x.amount),0),finalLines.filter(x=>x.item_name==='事務手数料').reduce((n,x)=>n+Math.abs(x.amount),0),finalLines.filter(x=>x.item_name==='安全協力会費').reduce((n,x)=>n+Math.abs(x.amount),0),final,JSON.stringify({header,lines:finalLines}),id]);
      header.gross_amount=gross;
      header.total_amount=final;
    }
    const cycleId=Number(b.cash_cycle_id);
    if(!cycleId) throw new Error('最終確定には入出金管理回を指定してください');
    const [cycles]=await conn.query('SELECT * FROM cash_cycles WHERE cash_cycle_id=? FOR UPDATE',[cycleId]);
    if(!cycles.length) throw new Error('入出金管理回が見つかりません');
    const baseDirection=kind==='invoice'?'incoming':'outgoing';
    const correctionExecuted=await executedNetForCorrectionChain(conn,kind,wf[0]);
    const scheduleDelta=wf[0].correction_of_settlement_id?asMoney(Number(header.total_amount)-correctionExecuted):Number(header.total_amount);
    if(scheduleDelta!==0){
      const direction=scheduleDelta>0?baseDirection:(baseDirection==='incoming'?'outgoing':'incoming');
      await conn.query(`INSERT INTO cash_schedules (cash_cycle_id,direction,source_type,source_id,company_id,partner_id,counterparty_name,title,amount,scheduled_date,snapshot_json,created_by) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,[cycleId,direction,wf[0].correction_of_settlement_id?'adjustment':kind,id,header.company_id||null,header.partner_id||null,header.company_name||header.partner_name,wf[0].correction_of_settlement_id?'訂正差額':kind==='invoice'?'請求入金':'通常支払',Math.abs(scheduleDelta),direction==='incoming'?cycles[0].planned_incoming_date:cycles[0].planned_outgoing_date,JSON.stringify({settlement_type:kind,settlement_id:id,total_amount:header.total_amount,executed_net:correctionExecuted,difference:scheduleDelta}),req.session.user.user_id]);
    }
    const types=kind==='invoice'
      ? [invoiceDisplayMode==='project_aggregated'?'invoice_summary':'invoice']
      : ['payment_statement', ...(json(header.extra_data).issue_salary_statement?['salary_statement']:[])];
    const year=Number(String(header.target_year_month).slice(0,4));
    const settings=await documentSettings(conn);
    const recipient=await documentRecipient(conn,kind,header);
    for(const type of types){
      const number=await nextDocumentNumber(conn,type,year);
      const document={
        settlement_type:kind,
        document_type:type,
        document_number:number,
        issued_date:new Date().toISOString().slice(0,10),
        due_date:cycles[0].planned_incoming_date,
        payment_date:cycles[0].planned_outgoing_date,
        target_year_month:header.target_year_month,
        total_amount:header.total_amount,
        gross_amount:header.gross_amount,
        subtotal_amount:kind==='invoice'?invoiceSubtotal:undefined,
        tax_amount:kind==='invoice'?invoiceTaxAmount:undefined,
        tax_rate:kind==='invoice'?invoiceTaxRate:SYSTEM_TAX_RATE,
        company_name:header.company_name,
        partner_name:header.partner_name,
        recipient,
        ...settings,
      };
      // 帳票側で日報明細から詳細／案件集約を組み立てるため、集約前の正本明細を渡す。
      const pdf=await writePdf(document,finalLines);
      generated.push(pdf.absolutePath);
      await conn.query(
        `INSERT INTO settlement_documents (settlement_type,settlement_id,document_type,document_year,document_number,company_id,partner_id,file_path,snapshot_json) VALUES (?,?,?,?,?,?,?,?,?)`,
        [kind,id,type,year,number,header.company_id||null,header.partner_id||null,pdf.fileName,JSON.stringify({document,lines:pdfLines,internal_lines:finalLines})]
      );
    }
    await conn.query(`UPDATE settlement_workflows SET status='finalized',finalized_by_user_id=?,finalized_at=CURRENT_TIMESTAMP WHERE settlement_workflow_id=?`,[req.session.user.user_id,wf[0].settlement_workflow_id]); for(const l of finalLines.filter(x=>x.daily_report_id)) await conn.query(kind==='invoice'?`UPDATE daily_reports SET billing_status='billed' WHERE daily_report_id=?`:`UPDATE daily_reports SET payment_status='paid' WHERE daily_report_id=?`,[l.daily_report_id]); await conn.commit(); return res.json({ok:true,status:'finalized',total_amount:header.total_amount});
  } catch(err){await conn.rollback();for(const file of generated){try{fs.unlinkSync(file);}catch(_unlinkErr){/* best effort */}}return res.status(400).json({ok:false,message:err.message});} finally {conn.release();}
});

router.post('/:kind/:id/cancel', requireRole('admin','executive'), async(req,res)=>{
  const kind=req.params.kind,id=Number(req.params.id),reason=String(req.body?.reason||'').trim();
  if(!validKind(kind))return res.status(404).end();
  if(!reason)return res.status(400).json({ok:false,message:'取消理由は必須です'});
  const conn=await getPool().getConnection();
  try{
    await conn.beginTransaction();
    const [wf]=await conn.query('SELECT * FROM settlement_workflows WHERE settlement_type=? AND settlement_id=? FOR UPDATE',[kind,id]);
    if(!wf.length||wf[0].status==='cancelled')throw new Error('取消可能な精算が見つかりません');
    const [executed]=await conn.query(
      `SELECT COUNT(*) cnt FROM cash_schedules s JOIN cash_transactions t ON t.cash_schedule_id=s.cash_schedule_id AND t.status='executed'
       WHERE s.source_id=? AND (s.source_type=? OR (s.source_type='adjustment' AND JSON_UNQUOTE(JSON_EXTRACT(s.snapshot_json,'$.settlement_type'))=?))`,[id,kind,kind]
    );
    if(Number(executed[0].cnt)>0){
      await conn.rollback();
      return res.status(409).json({ok:false,error:'correction_required',message:'入出金実行済みのため、取消ではなく訂正下書きを作成してください'});
    }
    if(kind==='payment')await restorePaymentAllocations(conn,id,req.session.user.user_id,reason);
    await cancelScheduleExports(conn,kind,id,reason);
    await conn.query(`UPDATE settlement_documents SET status='cancelled',cancelled_at=CURRENT_TIMESTAMP,cancelled_by_user_id=?,cancellation_reason=? WHERE settlement_type=? AND settlement_id=? AND status='issued'`,[req.session.user.user_id,reason,kind,id]);
    await conn.query(`UPDATE settlement_workflows SET status='cancelled',cancelled_by_user_id=?,cancelled_at=CURRENT_TIMESTAMP,cancellation_reason=? WHERE settlement_workflow_id=?`,[req.session.user.user_id,reason,wf[0].settlement_workflow_id]);
    await conn.query(`UPDATE ${tableFor(kind)} SET settlement_status='cancelled',${kind==='invoice'?'invoice_status':'payment_status'}='cancelled' WHERE ${idFor(kind)}=?`,[id]);
    const linkTable=kind==='invoice'?'invoice_daily_reports':'payment_daily_reports';
    const restoredReportStatus = wf[0].correction_of_settlement_id
      ? (kind === 'invoice' ? 'billed' : 'paid')
      : 'none';
    await conn.query(`UPDATE daily_reports d JOIN ${linkTable} l ON l.daily_report_id=d.daily_report_id SET d.${kind==='invoice'?'billing_status':'payment_status'}=?,d.version=d.version+1 WHERE l.${idFor(kind)}=?`,[restoredReportStatus,id]);
    await conn.commit();return res.json({ok:true,status:'cancelled'});
  }catch(err){await conn.rollback();return res.status(400).json({ok:false,message:err.message});}finally{conn.release();}
});

router.post('/:kind/:id/corrections', requireRole('admin','executive'), async(req,res)=>{
  const kind=req.params.kind,id=Number(req.params.id),reason=String(req.body?.reason||'').trim();
  if(!validKind(kind))return res.status(404).end();
  if(!reason)return res.status(400).json({ok:false,message:'訂正理由は必須です'});
  const conn=await getPool().getConnection();
  try{
    await conn.beginTransaction();
    const [sourceWf]=await conn.query(`SELECT * FROM settlement_workflows WHERE settlement_type=? AND settlement_id=? AND status='finalized' FOR UPDATE`,[kind,id]);
    if(!sourceWf.length)throw new Error('最終確定済みの精算だけ訂正できます');
    const [executed]=await conn.query(`SELECT COUNT(*) cnt FROM cash_schedules s JOIN cash_transactions t ON t.cash_schedule_id=s.cash_schedule_id AND t.status='executed' WHERE s.source_id=? AND (s.source_type=? OR (s.source_type='adjustment' AND JSON_UNQUOTE(JSON_EXTRACT(s.snapshot_json,'$.settlement_type'))=?))`,[id,kind,kind]);
    if(!Number(executed[0].cnt))throw new Error('未実行の精算は通常の取消を使用してください');
    const [sourceHeaders]=await conn.query(`SELECT * FROM ${tableFor(kind)} WHERE ${idFor(kind)}=? FOR UPDATE`,[id]);
    const source=sourceHeaders[0];
    let newId;
    const correctionExtra={...json(source.extra_data),correction_of_settlement_id:id,correction_reason:reason};
    if(kind==='invoice'){
      const [result]=await conn.query(`INSERT INTO invoices (company_id,target_year_month,closing_date,invoice_status,settlement_status,subtotal_amount,adjustment_amount,taxable_amount,tax_amount,total_amount,extra_data) VALUES (?,?,?,'draft','draft',0,0,0,0,0,?)`,[source.company_id,source.target_year_month,source.closing_date,JSON.stringify(correctionExtra)]);newId=result.insertId;
    }else{
      const [result]=await conn.query(`INSERT INTO payments (partner_id,target_year_month,closing_date,payment_status,settlement_status,gross_amount,final_transfer_amount,payment_output_code,extra_data) VALUES (?,?,?,'draft','draft',0,0,?,?)`,[source.partner_id,source.target_year_month,source.closing_date,source.payment_output_code,JSON.stringify(correctionExtra)]);newId=result.insertId;
    }
    const [sourceLines]=await conn.query('SELECT * FROM settlement_lines WHERE settlement_type=? AND settlement_id=? ORDER BY settlement_line_id',[kind,id]);
    const copied=sourceLines.map(line=>({line_type:line.line_type,source_type:'correction_copy',source_id:line.settlement_line_id,project_id:line.project_id,daily_report_id:line.daily_report_id,item_name:line.item_name,quantity:Number(line.quantity),unit_price:Number(line.unit_price),amount:Number(line.amount),tax_category:line.tax_category,reason:line.reason,snapshot:{correction_of_line_id:line.settlement_line_id,original_snapshot:json(line.snapshot_json)}}));
    const adjustments=Array.isArray(req.body?.adjustments)?req.body.adjustments.map(x=>({line_type:'adjustment',source_type:'correction_adjustment',item_name:String(x.item_name||'訂正調整'),quantity:1,unit_price:asMoney(x.amount),amount:asMoney(x.amount),tax_category:x.tax_category||'taxable',reason:String(x.reason||reason),snapshot:x})):[];
    const allLines=[...copied,...adjustments];
    await insertLines(conn,kind,newId,allLines);await addCompatibilityLines(conn,kind,newId,allLines);
    const linkTable=kind==='invoice'?'invoice_daily_reports':'payment_daily_reports';
    const [links]=await conn.query(`SELECT daily_report_id FROM ${linkTable} WHERE ${idFor(kind)}=?`,[id]);
    for(const link of links){await conn.query(`INSERT INTO ${linkTable} (${idFor(kind)},daily_report_id) VALUES (?,?)`,[newId,link.daily_report_id]);await conn.query(`UPDATE daily_reports SET ${kind==='invoice'?'billing_status':'payment_status'}='reserved',version=version+1 WHERE daily_report_id=?`,[link.daily_report_id]);}
    await conn.query(`INSERT INTO settlement_workflows (settlement_type,settlement_id,drafted_by_user_id,correction_of_settlement_id,correction_reason) VALUES (?,?,?,?,?)`,[kind,newId,req.session.user.user_id,id,reason]);
    await cancelScheduleExports(conn,kind,id,reason);
    await conn.query(`UPDATE settlement_documents SET status='cancelled',cancelled_at=CURRENT_TIMESTAMP,cancelled_by_user_id=?,cancellation_reason=? WHERE settlement_type=? AND settlement_id=? AND status='issued'`,[req.session.user.user_id,reason,kind,id]);
    await conn.query(`UPDATE settlement_workflows SET status='cancelled',cancelled_by_user_id=?,cancelled_at=CURRENT_TIMESTAMP,cancellation_reason=? WHERE settlement_workflow_id=?`,[req.session.user.user_id,reason,sourceWf[0].settlement_workflow_id]);
    await conn.query(`UPDATE ${tableFor(kind)} SET settlement_status='cancelled',${kind==='invoice'?'invoice_status':'payment_status'}='cancelled' WHERE ${idFor(kind)}=?`,[id]);
    await conn.commit();return res.status(201).json({ok:true,settlement_id:newId,status:'draft',correction_of_settlement_id:id});
  }catch(err){await conn.rollback();return res.status(400).json({ok:false,message:err.message});}finally{conn.release();}
});

router.get('/documents', async(req,res)=>{
  try{
    const clauses=[];const params=[];
    if(roles(req).has('company')){clauses.push("d.company_id=? AND d.document_type IN ('invoice','invoice_summary')");params.push(req.session.user.company_id);}
    else if(roles(req).has('partner')){clauses.push("d.partner_id=? AND d.document_type IN ('payment_statement','salary_statement')");params.push(req.session.user.partner_id);}
    else if(roles(req).has('sales')){clauses.push(`EXISTS (SELECT 1 FROM settlement_lines sl JOIN project_settlement_reviewers psr ON psr.project_id=sl.project_id WHERE sl.settlement_type=d.settlement_type AND sl.settlement_id=d.settlement_id AND psr.user_id=?)`);params.push(req.session.user.user_id);}
    else if(!has(req,['admin','soumu','executive']))return res.status(403).json({ok:false,message:'帳票を閲覧できません'});
    const documents=await query(`SELECT d.settlement_document_id,d.settlement_type,d.settlement_id,d.document_type,d.document_number,d.status,d.issued_at FROM settlement_documents d ${clauses.length?`WHERE ${clauses.join(' AND ')}`:''} ORDER BY d.settlement_document_id DESC`,params);
    return res.json({ok:true,documents});
  }catch(_err){return res.status(500).json({ok:false,message:'帳票一覧の取得に失敗しました'});}
});

router.get('/documents/:id/download', async(req,res)=>{
  try{
    const docs=await query('SELECT * FROM settlement_documents WHERE settlement_document_id=?',[Number(req.params.id)]);const doc=docs[0];
    if(!doc)return res.status(404).json({ok:false,message:'帳票が見つかりません'});
    if(!(await canAccessSettlement(req,doc.settlement_type,doc.settlement_id)))return res.status(403).json({ok:false,message:'この帳票は閲覧できません'});
    if(doc.status!=='issued')return res.status(410).json({ok:false,message:'この帳票は取消済みです'});
    return res.download(require('path').join(PDF_DIR,doc.file_path),doc.file_path);
  }catch(_err){return res.status(500).json({ok:false,message:'帳票の取得に失敗しました'});}
});

router.get('/:kind/:id', async(req,res)=>{
  const kind=req.params.kind,id=Number(req.params.id);if(!validKind(kind))return res.status(404).end();
  try{
    if(!(await canAccessSettlement(req,kind,id)))return res.status(403).json({ok:false,message:'この精算は閲覧できません'});
    const [header]=await query(`SELECT * FROM ${tableFor(kind)} WHERE ${idFor(kind)}=? AND is_deleted=0`,[id]);if(!header)return res.status(404).json({ok:false,message:'対象が見つかりません'});
    const lines=await query('SELECT * FROM settlement_lines WHERE settlement_type=? AND settlement_id=? ORDER BY settlement_line_id',[kind,id]);
    const workflow=await query('SELECT * FROM settlement_workflows WHERE settlement_type=? AND settlement_id=?',[kind,id]);
    const documents=await query('SELECT settlement_document_id,document_type,document_number,status,issued_at FROM settlement_documents WHERE settlement_type=? AND settlement_id=?',[kind,id]);
    return res.json({ok:true,settlement:header,lines,workflow:workflow[0]||null,documents});
  }catch(_err){return res.status(500).json({ok:false,message:'取得に失敗しました'});}
});

module.exports = router;
