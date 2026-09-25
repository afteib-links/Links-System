(() => {
  const regions='北海道 青森県 岩手県 宮城県 秋田県 山形県 福島県 茨城県 栃木県 群馬県 埼玉県 千葉県 東京都 神奈川県 新潟県 富山県 石川県 福井県 山梨県 長野県 岐阜県 静岡県 愛知県 三重県 滋賀県 京都府 大阪府 兵庫県 奈良県 和歌山県 鳥取県 島根県 岡山県 広島県 山口県 徳島県 香川県 愛媛県 高知県 福岡県 佐賀県 長崎県 熊本県 大分県 宮崎県 鹿児島県 沖縄県'.split(' ');
  const methods={direct:'金額直接入力',quantity:'単価 × 数量',fuel:'自家用燃料費'},sides={billing:'請求のみ',payment:'支払のみ',both:'両方'},taxes={taxable:'税別・課税',tax_inclusive:'税込・課税',non_taxable:'非課税',tax_exempt:'免税'};
  const ui={
    async open(ctx,options={}) {this.ctx=ctx;this.options=options;this.kit=window.LinksFeatureKit.createFeatureKit(ctx);this.projectId=options.projectId;this.ym=options.ym;this.editable=(ctx.currentUser?.roles||[]).some(r=>['admin','soumu'].includes(r));await this.load();},
    e(value){return this.ctx.escapeHtml(String(value??''));},
    money(value){return `${Number(value||0).toLocaleString()}円`;},
    async api(path,body) {const out=await this.ctx.api(`/api/additional-items${path}`,body===undefined?{}:{method:'POST',body:JSON.stringify(body)});if(!out.res.ok||!out.data?.ok)throw new Error(out.data?.message||'取得に失敗しました');return out.data;},
    optionsHtml(values,selected){return Object.entries(values).map(([key,label])=>`<option value="${this.e(key)}" ${String(selected)===key?'selected':''}>${this.e(label)}</option>`).join('');},
    regionOptions(selected){return '<option value="">上位設定を使用</option>'+regions.map((name,i)=>`<option value="${String(i+1).padStart(2,'0')}" ${Number(selected)===i+1?'selected':''}>${name}</option>`).join('');},
    async load(){
      try {
        this.masters=(await this.api('/masters')).masters;
        this.data=this.projectId?await this.api(`?project_id=${this.projectId}&target_year_month=${this.ym}`):{items:[]};
        this.ctx.app.innerHTML=this.kit.shell('追加請求・支払項目',`<section class="panel"><h2>${this.e(this.options.projectName||'項目・燃料設定')}</h2>${this.data.period?`<p>${this.e(this.data.period.period_start)}〜${this.e(this.data.period.period_end)}</p>`:''}<div class="btn-row">${this.projectId&&this.editable?'<button class="btn" id="extra-new">追加項目を登録</button>':''}${this.editable?'<button class="btn btn-secondary" id="extra-master">項目マスターを追加</button>':''}<button class="btn btn-secondary" id="extra-fuel">燃料の設定・価格履歴</button><button class="btn btn-ghost" id="extra-back">戻る</button></div><p>追加項目は通常の勤務金額と別に保持し、月次承認後に請求・支払へ反映します。</p>
          <div class="extra-item-list">${this.data.items.map(item=>`<article class="panel"><h3>${this.e(item.item_name)} <small>${this.e(item.work_date||'締め期間全体')} / ${taxes[item.tax_category]}</small></h3><p>請求 ${this.money(item.billing_amount)} ／ 支払 ${this.money(item.payment_amount)}</p>${this.detail(item)}<p>理由: ${this.e(item.reason||'初回登録')}</p>${this.editable?`<div class="btn-row"><button class="btn btn-secondary" data-edit-item="${item.additional_item_id}">変更・再計算</button><button class="btn btn-ghost" data-delete-item="${item.additional_item_id}">削除</button></div>`:''}</article>`).join('')||'<p>追加項目はまだありません。</p>'}</div></section>`,{wide:true,onBack:this.options.onBack});
        this.kit.bindShell({onBack:this.options.onBack});
        document.getElementById('extra-back').onclick=this.options.onBack;
        document.getElementById('extra-new')?.addEventListener('click',()=>this.editItem());
        document.getElementById('extra-master')?.addEventListener('click',()=>this.master());
        document.getElementById('extra-fuel').onclick=()=>this.fuel();
        this.ctx.app.querySelectorAll('[data-edit-item]').forEach(el=>el.onclick=()=>this.editItem(this.data.items.find(i=>Number(i.additional_item_id)===Number(el.dataset.editItem))));
        this.ctx.app.querySelectorAll('[data-delete-item]').forEach(el=>el.onclick=async()=>{const item=this.data.items.find(i=>Number(i.additional_item_id)===Number(el.dataset.deleteItem)),reason=window.prompt('削除理由を入力してください');if(!reason)return;try{await this.api(`/${item.additional_item_id}/delete`,{version:item.version,reason});await this.load();}catch(e){window.alert(e.message);}});
      }catch(e){window.alert(e.message);}
    },
    detail(item){const fuel=item.calculation_data?.fuel;if(!fuel)return `<small>${methods[item.calculation_method]}</small>`;return `<details><summary>計算根拠: ${fuel.attendance_days}日 / 基準日 ${this.e(fuel.reference_date)}</summary><div class="table-wrap"><table class="data-table"><thead><tr><th>勤務日</th><th>往復距離</th><th>燃費</th><th>価格日・単価</th><th>日額（税込）</th></tr></thead><tbody>${fuel.days.map(d=>`<tr><td>${this.e(d.work_date)}</td><td>${this.e(d.settings.roundtrip_km.value)}km（${this.source(d.settings.roundtrip_km.scope)}）</td><td>${this.e(d.settings.efficiency.value)}km/L（${this.source(d.settings.efficiency.scope)}）</td><td>${this.e(d.price.price_date)} / ${this.e(d.price.regular_price)}円/L${d.price_reason?` / ${this.e(d.price_reason)}`:''}</td><td>${this.money(d.daily_amount)}</td></tr>`).join('')}</tbody></table></div></details>`;},
    source(scope){return {global:'全社',partner:'パートナー',project:'案件'}[scope]||scope;},
    modal(title,html,footer){document.body.insertAdjacentHTML('beforeend',this.kit.modalHtml(title,html,footer));return this.kit.bindModal();},
    input(name,label,value='',type='text',attrs=''){return `<label>${label}<input name="${name}" type="${type}" value="${this.e(value)}" ${attrs}></label>`;},
    async editItem(item){
      const current=item?.calculation_data||{},inputs=current.inputs||{};
      const close=this.modal(item?'追加項目の変更・再計算':'追加項目を登録',`<form id="extra-form"><div class="form-grid"><label>項目<select name="additional_item_master_id">${this.masters.map(m=>`<option value="${m.additional_item_master_id}" ${Number(item?.additional_item_master_id)===Number(m.additional_item_master_id)?'selected':''}>${this.e(m.item_name)} / ${methods[m.calculation_method]}</option>`).join('')}</select></label><label>対象<select name="applies_to">${this.optionsHtml(sides,item?.applies_to||'payment')}</select></label>${this.input('work_date','勤務日（空欄は期間全体）',item?.work_date||this.options.workDate||'','date')}
        <div data-method="direct">${this.input('billing_amount','請求金額（円）',inputs.billing_amount??0,'number','step="1"')}${this.input('payment_amount','支払金額（円）',inputs.payment_amount??0,'number','step="1"')}</div>
        <div data-method="quantity">${this.input('quantity','数量',inputs.quantity??1,'number','step="0.0001"')}${this.input('billing_unit_price','請求単価（円）',inputs.billing_unit_price??0,'number','step="0.0001"')}${this.input('payment_unit_price','支払単価（円）',inputs.payment_unit_price??0,'number','step="0.0001"')}</div>
        <div data-method="fuel">${this.input('reference_date','燃料価格の基準日',inputs.reference_date||new Date(Date.now()+9*3600000).toISOString().slice(0,10),'date')}<small>往復距離 ÷ 燃費 × 単価を日ごとに切り上げ、対象勤務日を合計します。</small><div id="extra-price-choices"></div></div>
        ${this.input('billing_override','請求金額の手動変更（任意）',current.billing_calculated!=null?item.billing_amount:'','number','step="1"')}${this.input('payment_override','支払金額の手動変更（任意）',current.payment_calculated!=null?item.payment_amount:'','number','step="1"')}${this.input('reason','変更・調整理由',item?.reason||'')}</div></form><div id="extra-preview"></div><p id="extra-error" role="alert"></p>`,'<button type="button" class="btn btn-secondary" id="extra-calc">計算・差分確認</button><button type="button" class="btn" id="extra-save" disabled>確認した内容を保存</button>');
      const form=document.getElementById('extra-form'),preview=document.getElementById('extra-preview');
      const update=()=>{const master=this.masters.find(m=>Number(m.additional_item_master_id)===Number(form.elements.additional_item_master_id.value));form.querySelectorAll('[data-method]').forEach(el=>el.hidden=el.dataset.method!==master?.calculation_method);document.getElementById('extra-save').disabled=true;};
      form.oninput=()=>{document.getElementById('extra-save').disabled=true;};form.elements.additional_item_master_id.onchange=update;update();
      let payload;const requestKey=item?.request_key||Array.from(crypto.getRandomValues(new Uint32Array(4)),n=>n.toString(16).padStart(8,'0')).join(''),choices={...(inputs.price_choices||{})};
      document.getElementById('extra-calc').onclick=async()=>{
        try {
          const v=Object.fromEntries(new FormData(form));
          payload={project_id:this.projectId,target_year_month:this.ym,additional_item_id:item?.additional_item_id,version:item?.version,request_key:requestKey,additional_item_master_id:Number(v.additional_item_master_id),applies_to:v.applies_to,work_date:v.work_date||null,reason:v.reason,billing_override:v.billing_override,payment_override:v.payment_override,inputs:{billing_amount:v.billing_amount,payment_amount:v.payment_amount,quantity:v.quantity,billing_unit_price:v.billing_unit_price,payment_unit_price:v.payment_unit_price,reference_date:v.reference_date,price_choices:choices}};
          const calculated=(await this.api('/preview',payload)).preview;payload.preview_token=calculated.preview_token;
          preview.innerHTML=`<h3>計算結果</h3><p>請求 ${this.money(calculated.billing_amount)} ／ 支払 ${this.money(calculated.payment_amount)}${item?`（変更前: 請求 ${this.money(item.billing_amount)} ／ 支払 ${this.money(item.payment_amount)}）`:''}</p>${this.detail(calculated)}`;
          const missing=calculated.calculation_data.fuel?.missing||[];
          document.getElementById('extra-error').textContent=missing.length?missing.map(m=>`${m.work_date}: ${m.message}`).join('\n'):'';
          document.getElementById('extra-price-choices').innerHTML=[...new Map(missing.filter(m=>m.candidate).map(m=>[m.prefecture_code,m])).values()].map(m=>`<p>${regions[Number(m.prefecture_code)-1]}: 過去価格候補 ${this.e(m.candidate.price_date)} / ${this.e(m.candidate.regular_price)}円/L <button type="button" class="btn btn-small" data-adopt="${m.prefecture_code}" data-price="${m.candidate.fuel_price_id}">理由を付けて採用</button></p>`).join('');
          form.querySelectorAll('[data-adopt]').forEach(button=>button.onclick=()=>{const reason=window.prompt('過去価格を採用する理由');if(reason){choices[button.dataset.adopt]={fuel_price_id:Number(button.dataset.price),reason};button.textContent='採用済み・再計算してください';}});
          document.getElementById('extra-save').disabled=missing.length>0;
        }catch(e){document.getElementById('extra-error').textContent=e.message;}
      };
      document.getElementById('extra-save').onclick=async event=>{event.currentTarget.disabled=true;try{await this.api('',payload);close();await this.load();}catch(e){document.getElementById('extra-error').textContent=e.message;}};
    },
    master(){
      const close=this.modal('追加項目マスター',`<form id="extra-master-form"><div class="form-grid">${this.input('item_name','項目名')}<label>計算方法<select name="calculation_method">${this.optionsHtml(methods,'direct')}</select></label><label>対象<select name="applies_to">${this.optionsHtml(sides,'both')}</select></label><label>税区分<select name="tax_category">${this.optionsHtml(taxes,'taxable')}</select></label></div></form><p id="extra-master-error" role="alert"></p>`,'<button class="btn" id="extra-master-save">登録</button>');
      document.getElementById('extra-master-save').onclick=async()=>{try{await this.api('/masters',Object.fromEntries(new FormData(document.getElementById('extra-master-form'))));close();await this.load();}catch(e){document.getElementById('extra-master-error').textContent=e.message;}};
    },
    async fuel(){
      try {
        const data=await this.api(`/fuel?project_id=${this.projectId||0}`),today=new Date(Date.now()+9*3600000).toISOString().slice(0,10);
        const scope={global:'全社マスター',...(data.project?{partner:'この案件のパートナー',project:'この個別案件'}:{})};
        const content=`<p>燃費: パートナー→全社 ／ 往復距離: 案件→パートナー ／ 都道府県: 案件→パートナー→全社。空欄は上位設定を使用します。</p>
        ${this.editable?`<details open><summary>適用開始日を指定して設定を追加</summary><form id="fuel-condition"><div class="form-grid"><label>設定対象<select name="scope_type">${this.optionsHtml(scope,this.projectId?'partner':'global')}</select></label>${this.input('valid_from','適用開始日',today,'date')}${this.input('efficiency','燃費（km/L、全社・パートナー）','','number','step="0.0001" min="0.0001"')}${this.input('roundtrip_km','往復距離（km、案件・パートナー）','','number','step="0.0001" min="0"')}<label>都道府県<select name="prefecture_code">${this.regionOptions()}</select></label>${this.input('reason','登録・変更理由')}</div><button type="button" class="btn" id="fuel-condition-save">設定を追加</button></form></details>
        <details><summary>燃料価格の手動登録</summary><form id="fuel-price"><div class="form-grid"><label>都道府県<select name="prefecture_code">${this.regionOptions()}</select></label>${this.input('price_date','価格日',today,'date')}${this.input('regular_price','レギュラー平均価格（税込 円/L）','','number','step="0.0001" min="0.0001"')}${this.input('reason','取得元・登録理由')}</div><button type="button" class="btn" id="fuel-price-save">価格を登録</button></form></details>
        <details><summary>毎日の取得時刻（日本時間）</summary><p>利用許諾・取得方法が未確認のため自動取得は無効です。</p><input id="fuel-time" type="time" value="${this.e(data.settings.fetch_time_jst.slice(0,5))}"><button class="btn" id="fuel-time-save">時刻を保存</button></details>`:''}
        <p id="fuel-error" role="alert"></p><details><summary>適用設定の履歴 ${data.conditions.length}件</summary>${data.conditions.map(c=>`<p>${this.e(c.valid_from)} ${this.source(c.scope_type)} / 燃費 ${this.e(c.efficiency??'上位設定')} / 往復距離 ${this.e(c.roundtrip_km??'上位設定')} / ${regions[Number(c.prefecture_code)-1]||'上位設定'} / ${this.e(c.reason)}</p>`).join('')}</details><details><summary>価格履歴 ${data.prices.length}件</summary>${data.prices.map(p=>`<p>${this.e(p.price_date)} ${regions[Number(p.prefecture_code)-1]} ${this.e(p.regular_price)}円/L / ${this.e(p.reason)}</p>`).join('')}</details><details><summary>取得結果</summary>${data.runs.map(r=>`<p>${this.e(r.scheduled_date)}: ${this.e(r.message)}</p>`).join('')}</details>`;
        const close=this.modal('燃料の設定・価格履歴',content,'');
        const save=async(path,body)=>{try{await this.api(path,body);close();await this.fuel();}catch(e){document.getElementById('fuel-error').textContent=e.message;}};
        document.getElementById('fuel-condition-save')?.addEventListener('click',()=>{const b=Object.fromEntries(new FormData(document.getElementById('fuel-condition')));b.scope_id=b.scope_type==='project'?this.projectId:b.scope_type==='partner'?data.project.partner_id:0;save('/fuel/conditions',b);});
        document.getElementById('fuel-price-save')?.addEventListener('click',()=>save('/fuel/prices',Object.fromEntries(new FormData(document.getElementById('fuel-price')))));
        document.getElementById('fuel-time-save')?.addEventListener('click',()=>save('/fuel/schedule',{fetch_time_jst:document.getElementById('fuel-time').value,version:data.settings.version}));
      }catch(e){window.alert(e.message);}
    },
  };
  window.LinksAdditionalItems=ui;
})();
