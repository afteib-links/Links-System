const express = require('express');
const { getPool,query } = require('../db');
const { requireAuth,requirePermission } = require('../middleware/auth');
const { normalizeRules,validateRuleSet,definitionChecksum,executeRuleSet,loadRuleSet,resolvePublishedRuleSet } = require('../services/calculation_rule_engine');
const { applyDailyPriceCalcWithRuleSet } = require('../services/price_calc_rules');
const { resolveInvoiceTax } = require('../services/settlement_tax');

const router = express.Router();
router.use(requireAuth,requirePermission('calculation_rules'));

router.get('/',async (_req,res) => {
  try {
    const ruleSets = await query(`SELECT s.*,(SELECT COUNT(*) FROM calculation_rules r WHERE r.calculation_rule_set_id=s.calculation_rule_set_id) rule_count FROM calculation_rule_sets s ORDER BY s.rule_set_code,s.version_no DESC`);
    return res.json({ ok:true,rule_sets:ruleSets });
  } catch (error) {
    console.error('[calculation_rules/list]',error);
    return res.status(500).json({ ok:false,message:'計算ルール一覧を取得できませんでした' });
  }
});

router.get('/:id',async (req,res) => {
  try {
    const [ruleSet] = await query('SELECT * FROM calculation_rule_sets WHERE calculation_rule_set_id=?',[Number(req.params.id)]);
    if (!ruleSet) return res.status(404).json({ ok:false,message:'計算ルールが見つかりません' });
    const rules = normalizeRules(await query('SELECT * FROM calculation_rules WHERE calculation_rule_set_id=? ORDER BY sort_order,calculation_rule_id',[ruleSet.calculation_rule_set_id]));
    const validation = validateRuleSet(ruleSet,rules);
    return res.json({ ok:true,rule_set:ruleSet,rules,validation,definition_checksum:definitionChecksum(ruleSet,rules) });
  } catch (error) {
    console.error('[calculation_rules/detail]',error);
    return res.status(500).json({ ok:false,message:'計算ルールを取得できませんでした' });
  }
});

router.post('/:id/validate',async (req,res) => {
  try {
    const [ruleSet] = await query('SELECT * FROM calculation_rule_sets WHERE calculation_rule_set_id=?',[Number(req.params.id)]);
    if (!ruleSet) return res.status(404).json({ ok:false,message:'計算ルールが見つかりません' });
    const rules = normalizeRules(await query('SELECT * FROM calculation_rules WHERE calculation_rule_set_id=? ORDER BY sort_order,calculation_rule_id',[ruleSet.calculation_rule_set_id]));
    const validation = validateRuleSet(ruleSet,rules);
    const checksum = definitionChecksum(ruleSet,rules);
    if (ruleSet.status === 'draft') {
      await query('UPDATE calculation_rule_sets SET validation_result_json=?,definition_checksum=? WHERE calculation_rule_set_id=?',[JSON.stringify({ ok:validation.ok,errors:validation.errors,validated_at:new Date().toISOString() }),checksum,ruleSet.calculation_rule_set_id]);
      await query("INSERT INTO calculation_rule_audit_logs (calculation_rule_set_id,event_code,actor_user_id,summary_text,definition_checksum) VALUES (?,'validated',?,?,?)",[ruleSet.calculation_rule_set_id,req.session.user.user_id,validation.ok ? '検証合格' : `検証エラー ${validation.errors.length}件`,checksum]);
    }
    return res.status(validation.ok ? 200 : 422).json({ ok:validation.ok,validation,definition_checksum:checksum });
  } catch (error) {
    console.error('[calculation_rules/validate]',error);
    return res.status(500).json({ ok:false,message:'計算ルールを検証できませんでした' });
  }
});

router.post('/:id/clone',async (req,res) => {
  const conn = await getPool().getConnection();
  try {
    await conn.beginTransaction();
    const source = await loadRuleSet(conn,Number(req.params.id));
    if (!source) { await conn.rollback(); return res.status(404).json({ ok:false,message:'複製元の計算ルールが見つかりません' }); }
    const [versions] = await conn.query('SELECT COALESCE(MAX(version_no),0)+1 next_version FROM calculation_rule_sets WHERE rule_set_code=? FOR UPDATE',[source.rule_set.rule_set_code]);
    const versionNo = Number(versions[0].next_version);
    const [created] = await conn.query(`INSERT INTO calculation_rule_sets (rule_set_code,version_no,rule_set_name,status,effective_from,effective_to,based_on_rule_set_id,created_by_user_id) VALUES (?,?,?,'draft',?,?,?,?)`,[
      source.rule_set.rule_set_code,versionNo,String(req.body.rule_set_name || `${source.rule_set.rule_set_name} 改定${versionNo}`),req.body.effective_from || null,req.body.effective_to || null,source.rule_set.calculation_rule_set_id,req.session.user.user_id,
    ]);
    for (const rule of source.rules) await conn.query(`INSERT INTO calculation_rules (calculation_rule_set_id,rule_code,rule_name,stage_code,side_code,handler_code,condition_expression,parameter_json,rounding_json,output_code,sort_order,is_active) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,[
      created.insertId,rule.rule_code,rule.rule_name,rule.stage_code,rule.side_code,rule.handler_code,rule.condition_expression || null,JSON.stringify(rule.parameter_json || {}),JSON.stringify(rule.rounding_json || {}),rule.output_code || null,rule.sort_order,rule.is_active ? 1 : 0,
    ]);
    await conn.query("INSERT INTO calculation_rule_audit_logs (calculation_rule_set_id,event_code,actor_user_id,summary_text) VALUES (?,'created',?,'既存版から下書きを作成')",[created.insertId,req.session.user.user_id]);
    await conn.commit();
    return res.status(201).json({ ok:true,calculation_rule_set_id:created.insertId,version_no:versionNo });
  } catch (error) {
    await conn.rollback(); console.error('[calculation_rules/clone]',error);
    return res.status(500).json({ ok:false,message:'計算ルールの下書きを作成できませんでした' });
  } finally { conn.release(); }
});

router.put('/:id',async (req,res) => {
  const conn = await getPool().getConnection();
  try {
    await conn.beginTransaction();
    const [sets] = await conn.query('SELECT * FROM calculation_rule_sets WHERE calculation_rule_set_id=? FOR UPDATE',[Number(req.params.id)]);
    const current = sets[0];
    if (!current) { await conn.rollback(); return res.status(404).json({ ok:false,message:'計算ルールが見つかりません' }); }
    if (current.status !== 'draft') { await conn.rollback(); return res.status(409).json({ ok:false,message:'公開済み・廃止済みの版は変更できません' }); }
    if (Number(req.body.version) !== Number(current.version)) { await conn.rollback(); return res.status(409).json({ ok:false,message:'別の利用者が更新しました。再読み込みしてください' }); }
    const candidate = { ...current,rule_set_name:String(req.body.rule_set_name || '').trim(),effective_from:req.body.effective_from || null,effective_to:req.body.effective_to || null };
    const rules = normalizeRules(req.body.rules || []);
    const validation = validateRuleSet(candidate,rules);
    await conn.query('UPDATE calculation_rule_sets SET rule_set_name=?,effective_from=?,effective_to=?,validation_result_json=NULL,definition_checksum=NULL,version=version+1 WHERE calculation_rule_set_id=?',[candidate.rule_set_name,candidate.effective_from,candidate.effective_to,current.calculation_rule_set_id]);
    await conn.query('DELETE FROM calculation_rules WHERE calculation_rule_set_id=?',[current.calculation_rule_set_id]);
    for (const rule of rules) await conn.query(`INSERT INTO calculation_rules (calculation_rule_set_id,rule_code,rule_name,stage_code,side_code,handler_code,condition_expression,parameter_json,rounding_json,output_code,sort_order,is_active) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,[
      current.calculation_rule_set_id,rule.rule_code,rule.rule_name,rule.stage_code,rule.side_code,rule.handler_code,rule.condition_expression || null,JSON.stringify(rule.parameter_json || {}),JSON.stringify(rule.rounding_json || {}),rule.output_code || null,rule.sort_order,rule.is_active ? 1 : 0,
    ]);
    await conn.query("INSERT INTO calculation_rule_audit_logs (calculation_rule_set_id,event_code,actor_user_id,summary_text) VALUES (?,'updated',?,'下書きを更新')",[current.calculation_rule_set_id,req.session.user.user_id]);
    await conn.commit();
    return res.json({ ok:true,validation });
  } catch (error) {
    await conn.rollback(); console.error('[calculation_rules/update]',error);
    return res.status(500).json({ ok:false,message:'計算ルールを保存できませんでした' });
  } finally { conn.release(); }
});

router.post('/:id/compare',async (req,res) => {
  const conn = await getPool().getConnection();
  try {
    const candidate = await loadRuleSet(conn,Number(req.params.id));
    if (!candidate) return res.status(404).json({ ok:false,message:'計算ルールが見つかりません' });
    const targetDate = req.body.target_date || candidate.rule_set.effective_from || new Date().toISOString().slice(0,10);
    const current = await resolvePublishedRuleSet(conn,targetDate);
    const scenarios = Array.isArray(req.body.scenarios) && req.body.scenarios.length ? req.body.scenarios.slice(0,50) : [
      { name:'標準請求',side:'billing',lines:[{ amount:40000,tax_category:'taxable' }],deductions:[] },
      { name:'標準支払',side:'payment',lines:[{ amount:18500,tax_category:'taxable' }],deductions:[{ amount:1100 }] },
    ];
    const defaultTax = await resolveInvoiceTax(conn,null,[]);
    const run = async (selected,scenario) => executeRuleSet(selected.rule_set,selected.rules,{
      ...scenario,
      tax_rate:(scenario.side || 'billing') === 'billing' ? (scenario.tax_rate ?? defaultTax.rate) : scenario.tax_rate,
      tax_rounding:(scenario.side || 'billing') === 'billing' ? (scenario.tax_rounding ?? { mode:defaultTax.mode,unit:1 }) : scenario.tax_rounding,
      input:{},
    },{ dailyCalculator:async () => ({ calculated_billing_amount:0,calculated_payment_amount:0,calculation_detail:'{}' }) });
    const results = [];
    for (const scenario of scenarios) {
      const after = await run(candidate,scenario);
      const before = current ? await run(current,scenario) : null;
      results.push({ name:String(scenario.name || '比較'),side:scenario.side || 'billing',before_total:before?.total_amount ?? null,after_total:after.total_amount,difference:before ? after.total_amount-before.total_amount : null });
    }
    return res.json({ ok:true,current_rule_set_id:current?.rule_set.calculation_rule_set_id || null,candidate_rule_set_id:candidate.rule_set.calculation_rule_set_id,results });
  } catch (error) {
    console.error('[calculation_rules/compare]',error);
    return res.status(422).json({ ok:false,message:error.message || '比較計算に失敗しました' });
  } finally { conn.release(); }
});

router.post('/:id/publish',async (req,res) => {
  const conn = await getPool().getConnection();
  try {
    await conn.beginTransaction();
    await conn.query('SELECT calculation_rule_set_id FROM calculation_rule_sets WHERE calculation_rule_set_id=? FOR UPDATE',[Number(req.params.id)]);
    const selected = await loadRuleSet(conn,Number(req.params.id));
    if (!selected) { await conn.rollback(); return res.status(404).json({ ok:false,message:'計算ルールが見つかりません' }); }
    if (selected.rule_set.status !== 'draft') { await conn.rollback(); return res.status(409).json({ ok:false,message:'下書きだけを公開できます' }); }
    if (!selected.rule_set.effective_from) { await conn.rollback(); return res.status(422).json({ ok:false,message:'適用開始日は必須です' }); }
    const validation = validateRuleSet(selected.rule_set,selected.rules);
    if (!validation.ok) { await conn.rollback(); return res.status(422).json({ ok:false,message:'検証エラーを修正してください',validation }); }
    const [future] = await conn.query(`SELECT calculation_rule_set_id FROM calculation_rule_sets WHERE rule_set_code=? AND status='published' AND calculation_rule_set_id<>? AND effective_from>=? LIMIT 1 FOR UPDATE`,[selected.rule_set.rule_set_code,selected.rule_set.calculation_rule_set_id,selected.rule_set.effective_from]);
    if (future.length) { await conn.rollback(); return res.status(409).json({ ok:false,message:'同日以降に開始する公開版があります。適用期間を整理してください' }); }
    await conn.query(`UPDATE calculation_rule_sets SET effective_to=DATE_SUB(?,INTERVAL 1 DAY),version=version+1 WHERE rule_set_code=? AND status='published' AND calculation_rule_set_id<>? AND effective_from<? AND (effective_to IS NULL OR effective_to>=?)`,[selected.rule_set.effective_from,selected.rule_set.rule_set_code,selected.rule_set.calculation_rule_set_id,selected.rule_set.effective_from,selected.rule_set.effective_from]);
    const checksum = definitionChecksum(selected.rule_set,selected.rules);
    await conn.query(`UPDATE calculation_rule_sets SET status='published',definition_checksum=?,validation_result_json=?,published_by_user_id=?,published_at=CURRENT_TIMESTAMP,version=version+1 WHERE calculation_rule_set_id=?`,[checksum,JSON.stringify({ ok:true,errors:[] }),req.session.user.user_id,selected.rule_set.calculation_rule_set_id]);
    await conn.query("INSERT INTO calculation_rule_audit_logs (calculation_rule_set_id,event_code,actor_user_id,summary_text,definition_checksum) VALUES (?,'published',?,'検証済み版を公開',?)",[selected.rule_set.calculation_rule_set_id,req.session.user.user_id,checksum]);
    await conn.commit();
    return res.json({ ok:true,definition_checksum:checksum });
  } catch (error) {
    await conn.rollback(); console.error('[calculation_rules/publish]',error);
    return res.status(500).json({ ok:false,message:'計算ルールを公開できませんでした' });
  } finally { conn.release(); }
});

router.get('/:id/recalculation-candidates',async (req,res) => {
  try {
    const limit = Math.min(500,Math.max(1,Number(req.query.limit || 100)));
    const dailyReports = await query(`SELECT d.daily_report_id,d.work_date,d.calculated_billing_amount,d.calculated_payment_amount,c.company_name,p.partner_name FROM daily_reports d LEFT JOIN companies c ON c.company_id=d.company_id LEFT JOIN partners p ON p.partner_id=d.partner_id WHERE d.is_deleted=0 AND d.status='draft' AND d.billing_status='none' AND d.payment_status='none' ORDER BY d.work_date DESC,d.daily_report_id DESC LIMIT ${limit}`);
    const invoices = await query(`SELECT i.invoice_id,i.target_year_month,i.total_amount,c.company_name FROM invoices i LEFT JOIN companies c ON c.company_id=i.company_id WHERE i.is_deleted=0 AND i.settlement_status='draft' AND i.finalized_snapshot IS NULL ORDER BY i.target_year_month DESC,i.invoice_id DESC LIMIT ${limit}`);
    const payments = await query(`SELECT p.payment_id,p.target_year_month,p.final_transfer_amount,m.partner_name FROM payments p LEFT JOIN partners m ON m.partner_id=p.partner_id WHERE p.is_deleted=0 AND p.settlement_status='draft' AND p.finalized_snapshot IS NULL ORDER BY p.target_year_month DESC,p.payment_id DESC LIMIT ${limit}`);
    return res.json({ ok:true,daily_reports:dailyReports,invoices,payments });
  } catch (error) {
    console.error('[calculation_rules/recalculation_candidates]',error);
    return res.status(500).json({ ok:false,message:'再計算候補を取得できませんでした' });
  }
});

router.post('/:id/recalculate',async (req,res) => {
  const ids = {
    daily_reports:[...new Set((req.body.daily_report_ids || []).map(Number).filter(Number.isInteger))].slice(0,500),
    invoices:[...new Set((req.body.invoice_ids || []).map(Number).filter(Number.isInteger))].slice(0,500),
    payments:[...new Set((req.body.payment_ids || []).map(Number).filter(Number.isInteger))].slice(0,500),
  };
  const conn = await getPool().getConnection();
  try {
    await conn.beginTransaction();
    const selected = await loadRuleSet(conn,Number(req.params.id));
    if (!selected || selected.rule_set.status !== 'published') { await conn.rollback(); return res.status(409).json({ ok:false,message:'公開済みの計算ルールを指定してください' }); }
    const result = { daily_reports:0,invoices:0,payments:0,skipped:[] };
    for (const id of ids.daily_reports) {
      const [rows] = await conn.query("SELECT * FROM daily_reports WHERE daily_report_id=? AND is_deleted=0 FOR UPDATE",[id]); const row=rows[0];
      if (!row || row.status !== 'draft' || row.billing_status !== 'none' || row.payment_status !== 'none') { result.skipped.push({ type:'daily_report',id,reason:'未確定の下書きではありません' }); continue; }
      const calculated = await applyDailyPriceCalcWithRuleSet(row,selected);
      await conn.query('UPDATE daily_reports SET calculated_billing_amount=?,calculated_payment_amount=?,calculation_detail=?,calculation_rule_set_id=?,calculation_engine_code=?,version=version+1 WHERE daily_report_id=?',[calculated.calculated_billing_amount,calculated.calculated_payment_amount,calculated.calculation_detail,selected.rule_set.calculation_rule_set_id,'typed-rules-v1',id]); result.daily_reports += 1;
    }
    for (const [type,idList,side] of [['invoice',ids.invoices,'billing'],['payment',ids.payments,'payment']]) for (const id of idList) {
      const table = type === 'invoice' ? 'invoices' : 'payments'; const idColumn=`${type}_id`;
      const [rows] = await conn.query(`SELECT * FROM ${table} WHERE ${idColumn}=? AND is_deleted=0 FOR UPDATE`,[id]); const row=rows[0];
      if (!row || row.settlement_status !== 'draft' || row.finalized_snapshot) { result.skipped.push({ type,id,reason:'未確定の下書きではありません' }); continue; }
      const [allLines] = await conn.query('SELECT * FROM settlement_lines WHERE settlement_type=? AND settlement_id=?',[type,id]);
      const workLines = allLines.filter((line) => ['work','adjustment','carry_forward'].includes(line.line_type));
      const deductions = allLines.filter((line) => ['deduction','advance','installment'].includes(line.line_type));
      const projectIds = [...new Set(allLines.map((line) => Number(line.project_id)).filter(Boolean))];
      const tax = type === 'invoice' ? await resolveInvoiceTax(conn,row.company_id,projectIds) : null;
      const calculated = await executeRuleSet(selected.rule_set,selected.rules,{
        side,lines:workLines,deductions,
        ...(tax ? { tax_rate:tax.rate,tax_rounding:{ mode:tax.mode,unit:1 } } : {}),
        input:{},
      },{ dailyCalculator:async () => ({ calculated_billing_amount:0,calculated_payment_amount:0,calculation_detail:'{}' }) });
      if (type === 'invoice') await conn.query('UPDATE invoices SET subtotal_amount=?,adjustment_amount=?,taxable_amount=?,tax_amount=?,total_amount=?,calculation_rule_set_id=?,version=version+1 WHERE invoice_id=?',[calculated.work_amount,calculated.adjustment_amount,calculated.taxable_amount,calculated.tax_amount,calculated.total_amount,selected.rule_set.calculation_rule_set_id,id]);
      else await conn.query('UPDATE payments SET gross_amount=?,final_transfer_amount=?,calculation_rule_set_id=?,version=version+1 WHERE payment_id=?',[calculated.subtotal_amount,calculated.total_amount,selected.rule_set.calculation_rule_set_id,id]);
      result[`${type}s`] += 1;
    }
    await conn.commit();
    return res.json({ ok:true,result });
  } catch (error) {
    await conn.rollback(); console.error('[calculation_rules/recalculate]',error);
    return res.status(500).json({ ok:false,message:'選択した下書きの再計算を完了できませんでした' });
  } finally { conn.release(); }
});

module.exports = router;
