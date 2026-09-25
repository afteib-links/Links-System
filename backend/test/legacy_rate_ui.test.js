const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const source=fs.readFileSync(path.resolve(__dirname,'../../frontend/js/price_sets.js'),'utf8');
function feature(){
  const context={window:{}};
  vm.runInNewContext(source,context);
  const f=context.window.LinksPriceSets;
  f.ctx={escapeHtml:x=>String(x).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;')};
  return f;
}
test('source evidence escapes imported strings and distinguishes blanks from zero',()=>{
  const html=feature().legacyAnalysisHtml({legacy_analysis:{source_file:'<img onerror="x">',warnings:['<script>x</script>'],source_rows:[{label:'blank',unit_price:null},{label:'zero',unit_price:0,amount_difference:0}],calculation_status:'review_required'}});
  assert.ok(!html.includes('<img'));
  assert.ok(!html.includes('<script'));
  assert.match(html,/未記入/);
  assert.match(html,/>0<\/td>/);
  assert.match(html,/自動計算は保留/);
});
test('ordinary rates do not gain an analysis panel',()=>{
  assert.equal(feature().legacyAnalysisHtml(null),'');
  assert.equal(feature().legacyAnalysisHtml('invalid json'),'');
});
test('saving rate edits retains source evidence instead of dropping the review guard',()=>{
  assert.match(source,/const extra_data = \{\s*\.\.\.\(this\.legacyAnalysis\(row\.extra_data\)/);
});
test('business calculation view shows units and named formula, escaping all imported text',()=>{
  const side={input_items:['<img>'],quantity_rule:'対象日数を合計',quantity_unit_label:'日',unit_price:0,amount_description:'日数 × 単価',amount_expression:'unit_price * quantity',sample:{quantity:0,source_amount:0},operation:'加算'};
  const html=feature().semanticCalculationHtml({rules:[{category:'通常',item_name:'日極',billing:side,payment:side}],verification:{matched:2,unavailable:0,mismatches:[]}});
  assert.ok(!html.includes('<img>'));assert.match(html,/unit_price \* quantity/);assert.match(html,/日数 × 単価/);assert.match(html,/>0 → 0円/);assert.match(html,/一致 2件/);
});
