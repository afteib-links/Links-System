const {validationError}=require('./night_calc');
function validateQuantityOverrides(value) {
  let input=value;
  if(typeof value==='string'){try{input=JSON.parse(value);}catch{throw validationError('超過採用の形式を確認してください');}}
  if(input==null)return {};
  if(typeof input!=='object'||Array.isArray(input))throw validationError('超過採用の形式を確認してください');
  const output={};
  for(const side of ['billing','payment']) {
    const entry=input[side];if(entry==null)continue;
    if(typeof entry!=='object'||Array.isArray(entry))throw validationError('超過採用の形式を確認してください');
    const values={};
    for(const key of ['overtime_minutes','excess_km']) {
      if(entry[key]==null||entry[key]==='')continue;
      const n=Number(entry[key]);
      if(!Number.isFinite(n)||n<0||n>99999999||(key==='overtime_minutes'&&!Number.isInteger(n)))throw validationError('超過時間は整数分、超過距離は0以上で指定してください');
      values[key]=n;
    }
    if(Object.keys(values).length || String(entry.reason||'').trim()) {
      const reason=String(entry.reason||'').trim();if(!reason)throw validationError('超過値の採用理由を入力してください');
      output[side]={...values,reason:reason.slice(0,1000)};
    }
  }
  return output;
}
module.exports={validateQuantityOverrides};
