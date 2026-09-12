const express = require('express');
const { query } = require('../db');
const { requireAuth,requirePermission } = require('../middleware/auth');
const { normalizeRules,validateRuleSet,definitionChecksum } = require('../services/calculation_rule_engine');

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
    if (ruleSet.status === 'draft') await query('UPDATE calculation_rule_sets SET validation_result_json=?,definition_checksum=? WHERE calculation_rule_set_id=?',[JSON.stringify({ ok:validation.ok,errors:validation.errors,validated_at:new Date().toISOString() }),checksum,ruleSet.calculation_rule_set_id]);
    return res.status(validation.ok ? 200 : 422).json({ ok:validation.ok,validation,definition_checksum:checksum });
  } catch (error) {
    console.error('[calculation_rules/validate]',error);
    return res.status(500).json({ ok:false,message:'計算ルールを検証できませんでした' });
  }
});

module.exports = router;
