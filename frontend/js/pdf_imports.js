(() => {
  const labels = { work_date:'勤務日', start_time:'開始', end_time:'終了', break_minutes:'休憩', total_distance:'距離', toll_fee:'通行料', parking_fee:'駐車料', transport_fee:'交通費', row_comment:'コメント' };
  const observationLabels = {work_interval:'業務稼働時間',reported_overtime:'時間超過 (h)',reported_excess_distance:'距離超過 (km)',business_expense:'業務経費 (円)',alcohol_check:'酒気帯び確認',confirmation_mark:'確認印'};
  const mainFields = ['work_date','start_time','end_time','break_minutes'];
  const ui = {
    async open(ctx, options) {
      this.ctx = ctx; this.options = options; this.id = options.batchId;
      this.kit = window.LinksFeatureKit.createFeatureKit(ctx);
      this.editable = (ctx.currentUser?.roles || []).some(role => ['admin','soumu'].includes(role));
      this.drafts = new Map(); this.dirty = false;
      await this.load();
    },
    escape(value) { return this.ctx.escapeHtml(String(value ?? '')); },
    async request(suffix, body) {
      const out = await this.ctx.api(`/api/daily-report-imports/pdf/${this.id}${suffix}`, body === undefined ? {} : { method:'POST',body:JSON.stringify(body) });
      if (!out.res.ok || !out.data?.ok) throw new Error(out.data?.message || '処理に失敗しました');
      return out.data;
    },
    async load() {
      try {
        this.data = await this.request('');
        this.drafts.clear(); this.dirty = false;
        for (const row of this.data.rows) this.drafts.set(Number(row.daily_report_import_row_id), {
          row, values:{...row.candidate}, ocr:{...row.candidate}, selected:row.initially_selected,
          fields:new Set(row.initially_selected ? Object.keys(row.candidate).filter(k => row.candidate[k] != null) : []),
          edited:new Set(), clears:new Set(), target:row.daily_report_id || (row.current_ids.length === 1 ? row.current_ids[0] : ''),
          confirmed:!Object.keys(row.warnings).length, reason:'', adoption:{}, observations:{}, evidence:[],
        });
        for(const draft of this.drafts.values()){
          const current=this.data.current_reports.find(r=>Number(r.daily_report_id)===Number(draft.target));
          let quantity=current?.quantity_overrides||{};if(typeof quantity==='string'){try{quantity=JSON.parse(quantity);}catch{quantity={};}}
          for(const side of ['billing','payment']){
            draft.adoption[side+'_hours']=quantity[side]?.overtime_minutes==null?'':quantity[side].overtime_minutes/60;
            draft.adoption[side+'_km']=quantity[side]?.excess_km??'';
          }
        }
        this.render();
      } catch (error) { window.alert(error.message); }
    },
    value(field, value) {
      if (value == null) return '';
      if (field === 'break_minutes') return typeof value === 'number' ? window.LinksTimeInput.format(value) : String(value);
      return ['start_time','end_time'].includes(field) && /^\d{2}:\d{2}:\d{2}$/.test(String(value)) ? String(value).slice(0,5) : String(value);
    },
    input(field, value, side) {
      const clock = ['start_time','end_time','break_minutes'].includes(field);
      return `<span class="pdf-input-control"><input data-value="${field}" data-side="${side}" ${clock ? `data-f="${field}" inputmode="decimal"` : field === 'work_date' ? 'type="date"' : field === 'row_comment' ? '' : 'inputmode="decimal"'} value="${this.escape(this.value(field,value))}" ${this.editable ? '' : 'disabled'} aria-label="${side === 'ocr' ? 'OCR修正' : '反映予定'} ${labels[field]}">${clock ? `<button type="button" class="btn btn-ghost" data-picker tabindex="-1" aria-label="時分選択">⌄</button>` : ''}</span>`;
    },
    rowHtml(draft) {
      const {row} = draft, id = row.daily_report_import_row_id;
      const current = this.data.current_reports.find(r => Number(r.daily_report_id) === Number(draft.target));
      const matches = this.data.current_reports.filter(r => r.work_date === draft.values.work_date);
      const fields = Object.keys(labels).map(field => {
        const different = current && this.value(field,current[field]) !== this.value(field,draft.values[field]);
        const warning = row.warnings[field];
        return `<div class="pdf-field ${mainFields.includes(field) ? '' : 'pdf-extra-field'} ${different ? 'pdf-different' : ''}" data-field="${field}">
          <div><label title="${this.escape(warning || '')}">${labels[field]} ${warning ? '<span class="pdf-warning">?</span>' : ''}${this.input(field,draft.ocr[field],'ocr')}${row.supplements?.[field]?`<small>${this.escape(row.supplements[field])}から補完</small>`:''}</label></div>
          <div><label><input type="checkbox" data-include="${field}" ${draft.fields.has(field) ? 'checked' : ''} ${this.editable ? '' : 'disabled'}> ${labels[field]}を反映</label>
          <small>現在: ${this.escape(current ? this.value(field,current[field]) || '空欄' : '未登録')}${different ? ' / 差分あり' : ''}</small>${this.input(field,draft.values[field],'proposed')}
          <small data-edited="${field}">${draft.edited.has(field) ? '手修正を優先' : ''}</small>
          </div></div>`;
      }).join('');
      return `<article class="pdf-compare-row" data-row="${id}">
        <div class="pdf-row-select"><label><input type="checkbox" data-select ${draft.selected ? 'checked' : ''} ${this.editable ? '' : 'disabled'}> 取込</label><strong>行${this.escape(row.source_row_number)}</strong><small>${row.previously_imported ? '既取込' : current ? '既存値を保護' : Object.keys(row.warnings).length ? '要確認' : '新規'}</small></div>
        <div class="pdf-original-row">${row.has_image ? `<button class="pdf-crop-button" type="button" data-zoom tabindex="-1"><img src="/api/daily-report-imports/pdf/${this.id}/image/row/${id}" alt="PDF原本の行${this.escape(row.source_row_number)}"></button>` : `<p>原本を開いて確認してください</p>${row.extra_data?.source_cells?`<small>シート: ${this.escape(row.source_sheet)} / ${this.escape(JSON.stringify(row.extra_data.source_cells))}</small>`:''}`}<button type="button" class="btn btn-small" data-page tabindex="-1">ページと位置を表示</button></div>
        <div class="pdf-values">${fields}<div class="pdf-extra-field pdf-observations">${this.observationsHtml(row)}${this.adoptionHtml(draft)}</div><details class="pdf-row-details"><summary>対応先・原読取・理由 ${Object.keys(row.warnings).length ? '<span class="pdf-warning">要確認</span>' : ''}</summary><div class="pdf-target"><label>反映先<select data-target ${this.editable ? '' : 'disabled'}><option value="">${matches.length ? '反映先を選択' : '新規日報'}</option>${matches.map(r => `<option value="${r.daily_report_id}" ${Number(draft.target) === Number(r.daily_report_id) ? 'selected' : ''}>日報#${r.daily_report_id} / ${this.escape(r.start_time || '時刻未入力')} / ${this.escape(r.row_comment || '')}</option>`).join('')}${matches.length ? `<option value="new" ${draft.target === 'new' ? 'selected' : ''}>新しい作業行を追加する</option>` : ''}</select></label>
          <label><input type="checkbox" data-date-confirmed ${draft.confirmed ? 'checked' : ''} ${this.editable ? '' : 'disabled'}> 原本の勤務日を確認した</label><label>更新・再取込理由<input data-reason value="${this.escape(draft.reason)}" placeholder="既存値の更新時は必須" ${this.editable ? '' : 'disabled'}></label></div>
          <div class="pdf-raw-fields">${Object.keys(row.raw_data).map(field=>`<div><strong>${this.escape(labels[field] || observationLabels[field] || row.extra_data?.column_labels?.[field] || field)}</strong> 原読取: ${this.escape(row.raw_data[field] || '空欄')}${row.warnings[field]?`<span class="pdf-warning"> ${this.escape(row.warnings[field])}</span>`:''}${field!=='work_date'&&labels[field]?`<label class="pdf-clear"><input type="checkbox" data-clear="${field}" ${draft.clears.has(field)?'checked':''} ${this.editable?'':'disabled'}> 明示消去</label>`:''}</div>`).join('')}</div>
          ${['time','alignment','duplicate','reported_overtime','reported_excess_distance','business_expense'].map(key=>row.warnings[key]?`<p class="pdf-warning">${this.escape(row.warnings[key])}</p>`:'').join('')}</details>
          <p class="pdf-row-error" role="alert"></p></div></article>`;
    },
    adoptionHtml(draft) {
      const d=draft.adoption||{}, obs=draft.row.observations||{};
      const input=(key,label,value='')=>`<label>${label}<input data-adoption="${key}" inputmode="decimal" value="${this.escape(d[key]??value)}"></label>`;
      return `<details class="pdf-adoption"><summary>超過・経費の採用／記入状態・証憑</summary><fieldset ${this.editable?'':'disabled'}>
        <p>帳票: 超過 ${this.escape(obs.reported_overtime??'不明')} h / 距離超過 ${this.escape(obs.reported_excess_distance??'不明')} km。月間距離契約は日別超過を参照に留め、日報の総距離を確認してください。</p>
        <label><input type="checkbox" data-adoption="quantity" ${d.quantity?'checked':''}> 超過採用を変更（空欄は自動計算へ戻す）</label>
        ${['billing','payment'].map(side=>`<div class="form-grid"><strong>${side==='billing'?'請求':'支払'}</strong>${input(side+'_hours','採用する時間超過 (h)')}${input(side+'_km','採用する距離超過 (km)')}</div>`).join('')}
        <label><input type="checkbox" data-adoption="expense" ${d.expense?'checked':''}> 業務経費を追加項目に反映</label>
        <label>経費の対象<select data-adoption="applies_to">${[['','選択してください'],['billing','請求'],['payment','支払'],['both','両方']].map(([v,l])=>`<option value="${v}" ${d.applies_to===v?'selected':''}>${l}</option>`).join('')}</select></label>
        ${input('billing_amount','請求額 (円)',obs.business_expense??'')}${input('payment_amount','支払額 (円)',obs.business_expense??'')}
        <label>税区分<select data-adoption="tax_category">${[['tax_inclusive','税込'],['taxable','税別'],['non_taxable','非課税']].map(([v,l])=>`<option value="${v}" ${(d.tax_category||'tax_inclusive')===v?'selected':''}>${l}</option>`).join('')}</select></label>
        <p>採用理由は「対応先・原読取・理由」に入力してください。計算を確認してから反映します。</p><button type="button" class="btn btn-small" data-preview-adoption>計算して確認</button><div data-adoption-preview role="status"></div>
        ${['alcohol_check','confirmation_mark'].map(key=>`<label>${observationLabels[key]}<select data-observation="${key}">${[['','変更しない'],['marked','記入あり'],['blank','空欄'],['unknown','不明']].map(([v,l])=>`<option value="${v}" ${draft.observations?.[key]===v?'selected':''}>${l}</option>`).join('')}</select></label>`).join('')}
        ${(this.data.pages||[]).filter(p=>p.rectification?.page_kind==='evidence').map(p=>`<label><input type="checkbox" data-evidence="${p.pdf_page_id}" ${draft.evidence?.includes(p.pdf_page_id)?'checked':''}> 証憑 ${p.page_number}ページ <a target="_blank" rel="noopener" href="/api/daily-report-imports/pdf/${this.id}/image/page/${p.pdf_page_id}">画像を確認</a></label>`).join('')}
        </fieldset></details>`;
    },
    rowRequest(d) {
      const current=this.data.current_reports.find(r=>Number(r.daily_report_id)===Number(d.target));
      const request={import_row_id:d.row.daily_report_import_row_id,import_version:d.row.version,target_daily_report_id:current?.daily_report_id||null,expected_version:current?.version||null,
        fields:[...d.fields],values:d.values,clear_fields:[...d.clears],reason:d.reason,date_confirmed:d.confirmed,allow_new_work_row:d.target==='new'};
      const a=d.adoption||{};
      if(a.quantity){
        request.quantity_overrides={};
        for(const side of ['billing','payment']){
          const values={reason:d.reason};
          if(a[side+'_hours']!=null&&a[side+'_hours']!==''){const n=Number(a[side+'_hours'])*60;if(!Number.isFinite(n)||n<0||Math.abs(n-Math.round(n))>1e-6)throw new Error('超過時間は1分単位の小数時間で指定してください');values.overtime_minutes=Math.round(n);}
          if(a[side+'_km']!=null&&a[side+'_km']!==''){const n=Number(a[side+'_km']);if(!Number.isFinite(n)||n<0)throw new Error('距離超過は0以上の数値で指定してください');values.excess_km=n;}
          request.quantity_overrides[side]=values;
        }
      }
      if(a.expense){
        const item=(this.data.expense_items||[]).find(i=>i.request_key===`ocr-expense-${current?.daily_report_id}`);
        request.expense={applies_to:a.applies_to,tax_category:a.tax_category||'tax_inclusive',billing_amount:a.billing_amount??d.row.observations?.business_expense,payment_amount:a.payment_amount??d.row.observations?.business_expense,expected_version:item?.version??null};
      }
      if(Object.keys(d.observations||{}).length)request.reviewed_observations=d.observations;
      if(d.evidence?.length)request.evidence_pages=d.evidence;
      if(!request.fields.length&&(a.quantity||a.expense||request.reviewed_observations||request.evidence_pages))request.fields=['work_date'];
      if(d.previewToken)request.preview_token=d.previewToken;
      return request;
    },
    render() {
      const latest = this.data.jobs[0];
      const busy = latest && ['queued','running'].includes(latest.status);
      this.ctx.app.innerHTML = this.kit.shell('帳票日報の比較・取込', `<section class="panel pdf-import-screen">
        <div class="pdf-import-toolbar"><h2>${this.escape(this.data.file.name)}</h2><p>${this.data.period ? `対象期間 ${this.escape(this.data.period.period_start)}〜${this.escape(this.data.period.period_end)}` : '案件と様式を設定してください'}</p>
          <p role="status">${busy ? `解析 ${this.escape(latest.progress)}%（${latest.status === 'queued' ? '待機' : '処理中'}）。日報入力へ戻っても処理は続きます。` : latest?.error_message ? this.escape(latest.error_message) : '選択した行と項目だけを日報へ反映します。空欄は既存値を消しません。'}</p>
          <div class="btn-row"><a class="btn btn-secondary" href="/api/daily-report-imports/pdf/${this.id}/image/original/0" target="_blank" rel="noopener">原本を開く</a><button class="btn btn-secondary" id="pdf-refresh">現在値・進捗を再取得</button>${this.editable ? `<button class="btn btn-secondary" id="pdf-template">案件・様式を設定</button><button class="btn btn-secondary" id="pdf-manual">原本を見て手入力</button><button class="btn" id="pdf-apply" ${busy ? 'disabled' : ''}>選択内容を反映</button>` : ''}${latest?.status === 'failed' && this.editable ? '<button class="btn" id="pdf-retry">失敗した解析を再試行</button>' : ''}<button class="btn btn-ghost" id="pdf-back">取込一覧へ</button></div>
          <label><input type="checkbox" id="pdf-extra"> 距離・経費・帳票項目・コメントを表示</label><p id="pdf-message" role="status"></p></div>
        <div class="pdf-comparison-heading"><span>取込</span><span>補正画像の該当行</span><span>OCR候補・修正</span><span>現在値・反映予定値</span></div>
        <div id="pdf-rows">${[...this.drafts.values()].map(d => this.rowHtml(d)).join('') || '<p>解析が終わったら現在値・進捗を再取得してください。OCRが利用できない場合も原本を見て手入力できます。</p>'}</div>
      </section>`, {wide:true,onBack:() => this.leave()});
      this.kit.bindShell({onBack:() => this.leave()});
      document.getElementById('pdf-back').onclick = () => this.leave();
      document.getElementById('pdf-refresh').onclick = () => { if (!this.dirty || window.confirm('未反映の修正内容を破棄して現在値を再取得しますか？')) this.load(); };
      document.getElementById('pdf-template')?.addEventListener('click', () => this.configure());
      document.getElementById('pdf-manual')?.addEventListener('click', () => this.manual());
      document.getElementById('pdf-apply')?.addEventListener('click', () => this.apply());
      document.getElementById('pdf-retry')?.addEventListener('click', async () => { try { await this.request('/retry',{job_id:latest.ocr_job_id}); await this.load(); } catch (error) { window.alert(error.message); } });
      document.getElementById('pdf-extra').onchange = event => this.ctx.app.querySelector('.pdf-import-screen').classList.toggle('pdf-show-extras',event.target.checked);
      this.bindRows();
      document.getElementById('pdf-rows').addEventListener('input',event=>{const draft=this.drafts.get(Number(event.target.closest('[data-row]')?.dataset.row));if(draft)draft.previewToken=null;});
    },
    leave() { if (!this.dirty || window.confirm('未反映の修正があります。取込一覧へ戻りますか？')) this.options.onBack(); },
    bindRows() {
      this.ctx.app.querySelectorAll('[data-row]').forEach(article => {
        const draft = this.drafts.get(Number(article.dataset.row));
        article.querySelectorAll('[data-adoption]').forEach(el=>el.onchange=()=>{draft.adoption[el.dataset.adoption]=el.type==='checkbox'?el.checked:el.value;draft.previewToken=null;this.dirty=true;});
        article.querySelectorAll('[data-observation]').forEach(el=>el.onchange=()=>{if(el.value)draft.observations[el.dataset.observation]=el.value;else delete draft.observations[el.dataset.observation];this.dirty=true;});
        article.querySelectorAll('[data-evidence]').forEach(el=>el.onchange=()=>{draft.evidence=[...article.querySelectorAll('[data-evidence]:checked')].map(e=>Number(e.dataset.evidence));this.dirty=true;});
        article.querySelector('[data-preview-adoption]').onclick=async()=>{
          const output=article.querySelector('[data-adoption-preview]');
          try {
            const result=await this.request('/calculation-preview',this.rowRequest(draft));draft.previewToken=result.preview_token;
            output.innerHTML=['billing','payment'].map(side=>`<p>${side==='billing'?'請求':'支払'}: 超過 ${this.escape(result.automatic?.[side]?.overtime_minutes??0)} → ${this.escape(result.calculated?.[side]?.overtime_minutes??0)} 分 / 距離超過 ${this.escape(result.automatic?.distance?.[side]?.excess_distance_km??0)} → ${this.escape(result.calculated?.distance?.[side]?.excess_distance_km??0)} km / 日報額 ${this.escape(result[side+'_amount'])}円${result.expense?` / 追加経費 ${this.escape(result.expense[side+'_amount'])}円`:''}</p>`).join('');
          }catch(error){draft.previewToken=null;output.textContent=error.message;}
        };
        article.querySelector('[data-select]').onchange = event => { draft.selected = event.target.checked; this.dirty = true; };
        article.querySelector('[data-date-confirmed]').onchange = event => { draft.confirmed = event.target.checked; };
        article.querySelector('[data-reason]').oninput = event => { draft.reason = event.target.value; this.dirty = true; };
        article.querySelector('[data-target]').onchange = event => { draft.target = event.target.value; draft.fields.clear(); this.dirty = true; this.replaceRow(article,draft); };
        article.querySelectorAll('[data-include]').forEach(el => el.onchange = () => { el.checked ? draft.fields.add(el.dataset.include) : draft.fields.delete(el.dataset.include); this.dirty = true; });
        article.querySelectorAll('[data-clear]').forEach(el => el.onchange = () => {
          const field = el.dataset.clear; el.checked ? draft.clears.add(field) : draft.clears.delete(field);
          if (el.checked) { draft.fields.add(field); draft.values[field] = null; article.querySelector(`[data-side="proposed"][data-value="${field}"]`).value = ''; article.querySelector(`[data-include="${field}"]`).checked = true; }
          this.dirty = true;
        });
        article.querySelectorAll('[data-value]').forEach(input => input.onchange = () => {
          const field = input.dataset.value, side = input.dataset.side;
          try {
            let value = input.value;
            if (['start_time','end_time','break_minutes'].includes(field)) {
              const minutes = window.LinksTimeInput.parse(value,{maxMinutes:2879});
              input.value = window.LinksTimeInput.format(minutes); value = field === 'break_minutes' ? minutes : input.value;
            }
            if (side === 'ocr') {
              draft.ocr[field] = value;
              if (!draft.edited.has(field)) { draft.values[field] = value; article.querySelector(`[data-side="proposed"][data-value="${field}"]`).value = this.value(field,value); }
            } else { draft.values[field] = value; draft.edited.add(field); article.querySelector(`[data-edited="${field}"]`).textContent = '手修正を優先'; }
            input.setCustomValidity(''); article.querySelector('.pdf-row-error').textContent = '';
            this.dirty = true;
            if (field === 'work_date') { draft.confirmed = false; draft.target = ''; draft.fields.clear(); this.replaceRow(article,draft); }
          } catch (error) { if (side === 'proposed') draft.values[field] = input.value; else draft.ocr[field] = input.value; input.setCustomValidity(error.message); article.querySelector('.pdf-row-error').textContent = error.message; }
        });
        article.querySelectorAll('[data-picker]').forEach(button => button.onclick = () => this.openEntryTimePicker(button.previousElementSibling));
        article.querySelector('[data-page]').onclick = () => this.showOriginal(draft,false);
        article.querySelector('[data-zoom]')?.addEventListener('click', () => this.showOriginal(draft,true));
      });
      this.ctx.app.querySelector('.pdf-import-screen').onkeydown = event => {
        if (event.altKey && event.key === 'ArrowDown' && event.target.dataset.f) { event.preventDefault(); this.openEntryTimePicker(event.target); }
        if (event.key === 'Tab') {
          const inputs = this.entryInputs(this.ctx.app.querySelector('.pdf-import-screen'));
          const i = inputs.indexOf(event.target);
          if (i >= 0) { event.preventDefault(); inputs[(i + (event.shiftKey ? -1 : 1) + inputs.length) % inputs.length]?.focus(); }
        }
      };
    },
    replaceRow(article,draft) { const open=article.querySelector('details')?.open; article.outerHTML = this.rowHtml(draft); const next=this.ctx.app.querySelector(`[data-row="${draft.row.daily_report_import_row_id}"] details`); if(next) next.open=Boolean(open); this.bindRows(); },
    entryInputs(root) { return [...root.querySelectorAll('input,select,textarea')].filter(el => !el.disabled && !el.readOnly && el.getClientRects().length); },
    entryTimeOptions() { return {maxMinutes:2879,padHours:true}; },
    openEntryTimePicker(input) { return window.LinksDailyEntryUI.openEntryTimePicker.call(this,input); },
    async projectOptions() {
      const result = await this.ctx.api(`/api/daily-reports/month-projects?target_year_month=${encodeURIComponent(this.data.batch.target_year_month)}`);
      if (!result.res.ok) throw new Error(result.data?.message || '案件一覧の取得に失敗しました');
      const selected = Number(this.data.batch.extra_data.project_id || this.options.projectId);
      const clean=v=>String(v||'').normalize('NFKC').replace(/株式会社|有限会社|御中|\s/g,'');
      const headers=clean((this.data.pages||[]).flatMap(p=>p.rectification?.proposal?.header_text||[]).concat((this.data.batch.extra_data.workbook_sheets||[]).filter(s=>s.name==='原本').flatMap(s=>s.header||[])).join(' '));
      const ranked=(result.data.rows||[]).map(r=>({...r,match:[r.company_name,r.partner_name].reduce((n,v)=>n+(clean(v).length>=2&&headers.includes(clean(v))?1:0),0)})).sort((a,b)=>b.match-a.match);
      return '<option value="">案件を選択してください</option>' + ranked.map(r => `<option value="${r.project_id}" ${Number(r.project_id) === selected ? 'selected' : ''}>${r.match?'照合候補 / ':''}#${r.project_id} ${this.escape(r.company_name)} / ${this.escape(r.template_name || r.manager_name || '')} / ${this.escape(r.partner_name)}</option>`).join('');
    },
    showOriginal(draft, crop) {
      const page = this.data.pages.find(p => Number(p.pdf_page_id) === Number(draft.row.pdf_page_id));
      if (!page) return window.open(`/api/daily-report-imports/pdf/${this.id}/image/original/0`,'_blank','noopener');
      const region = draft.row.source_region?.row;
      const url = `/api/daily-report-imports/pdf/${this.id}/image/${crop ? 'row/' + draft.row.daily_report_import_row_id : 'page/' + page.pdf_page_id}`;
      const dialog = document.createElement('dialog'); dialog.className = 'pdf-original-dialog';
      dialog.innerHTML = `<form method="dialog"><button class="btn">閉じる</button></form><div class="pdf-original-image"><img src="${url}" alt="原本ページ${page.page_number}">${!crop && region ? `<span class="pdf-highlight" style="left:${region[0]*100}%;top:${region[1]*100}%;width:${(region[2]-region[0])*100}%;height:${(region[3]-region[1])*100}%"></span>` : ''}</div>`;
      document.body.append(dialog); dialog.addEventListener('close',() => dialog.remove()); dialog.showModal();
    },
    observationsHtml(row) {
      const state={marked:'記入あり',blank:'空欄',unknown:'不明・要確認'};
      return Object.entries(row.observations||{}).map(([key,value])=>`<div><strong>${this.escape(observationLabels[key]||row.extra_data?.column_labels?.[key]||key)}</strong>: ${this.escape(state[value]??value??'空欄')} <small>原読取: ${this.escape(row.raw_data[key]||'空欄')}</small></div>`).join('')+
        `<details><summary>読取り比較（原画像／補正画像）</summary>${Object.entries(row.extra_data?.alternatives||{}).map(([k,v])=>`<div>${this.escape(labels[k]||observationLabels[k]||k)}: ${v.map(a=>this.escape(a.text||'空欄')).join(' / ')}</div>`).join('')}</details>`;
    },
    async configureWorkbook() {
      const sheets=this.data.batch.extra_data.workbook_sheets;
      const preferred=this.data.batch.extra_data.sheet_name || sheets.find(s=>s.name==='原本')?.name || '';
      document.body.insertAdjacentHTML('beforeend',this.kit.modalHtml('Excel帳票のシート確認',`<label>案件<select id="xlsx-project">${await this.projectOptions()}</select></label><label>シート<select id="xlsx-sheet"><option value="">選択してください</option>${sheets.map(s=>`<option value="${this.escape(s.name)}" ${s.name===preferred?'selected':''}>${this.escape(s.name)} (${s.row_count}行)</option>`).join('')}</select></label><p>対象年月・会社・受託者を原本で確認してください。見本は自動採用しません。</p><p id="xlsx-heading"></p><p id="xlsx-error" role="alert"></p>`,'<button class="btn" id="xlsx-confirm">選択シートを比較画面へ</button>'));
      const close=this.kit.bindModal(),select=document.getElementById('xlsx-sheet');
      select.onchange=()=>{document.getElementById('xlsx-heading').textContent=(sheets.find(s=>s.name===select.value)?.header||[]).join(' / ');};select.onchange();
      document.getElementById('xlsx-confirm').onclick=async()=>{try{await this.request('/workbook',{project_id:Number(document.getElementById('xlsx-project').value),sheet_name:select.value});close();await this.load();}catch(e){document.getElementById('xlsx-error').textContent=e.message;}};
    },
    async showRecords(ctx, dailyId) {
      const kit=window.LinksFeatureKit.createFeatureKit(ctx),escape=v=>ctx.escapeHtml(String(v??''));
      const result=await ctx.api(`/api/daily-report-imports/pdf/records/${dailyId}`);
      if(!result.res.ok)return window.alert(result.data?.message||'記録を取得できません');
      const records=result.data.records||[];
      document.body.insertAdjacentHTML('beforeend',kit.modalHtml('OCR・帳票連携記録',records.map(r=>`<section><h3>${escape(r.original_filename)} / ${escape(r.source_sheet)} 行${r.source_row_number}</h3>${r.available?`<a class="btn" target="_blank" rel="noopener" href="/api/daily-report-imports/pdf/${r.daily_report_import_batch_id}/image/original/0">原本</a>${r.source_region?.row?`<img style="max-width:100%" src="/api/daily-report-imports/pdf/${r.daily_report_import_batch_id}/image/row/${r.daily_report_import_row_id}" alt="補正済み原本行">`:""}${(r.evidence||[]).map(p=>`<a class="btn" target="_blank" rel="noopener" href="/api/daily-report-imports/pdf/${r.daily_report_import_batch_id}/image/page/${p.pdf_page_id}">証憑 ${p.page_number}ページ${p.additional_item_id?"（経費連携）":""}</a>`).join("")}<details open><summary>原読取・反映値</summary><pre>${escape(JSON.stringify({original:r.raw_data,adopted:r.reviewed_data,checks:r.reviewed_observations},null,2))}</pre></details><details><summary>反映履歴</summary><pre>${escape(JSON.stringify(r.history,null,2))}</pre></details>`:'保存期限切れ・原本利用不可'}</section>`).join('')||'<p>連携記録はありません</p>',''));
      kit.bindModal();
    },
    chooseCorners(page,input) {
      const dialog=document.createElement('dialog');dialog.className='pdf-original-dialog';
      dialog.innerHTML=`<p>画像上で左上 → 右上 → 右下 → 左下の順に表または書類の四隅をクリックしてください。</p><div class="btn-row"><button type="button" data-reset>やり直す</button><button type="button" data-accept disabled>四隅を設定</button><button type="button" data-cancel>閉じる</button></div><div style="position:relative" data-corner-image><img style="display:block;max-width:100%;cursor:crosshair" src="/api/daily-report-imports/pdf/${this.id}/image/source/${page.pdf_page_id}" alt="補正前の四隅選択画像"><div data-corner-points style="pointer-events:none;position:absolute;inset:0"></div></div>`;
      let points=[];
      const draw=()=>{dialog.querySelector('[data-corner-points]').innerHTML=points.map(([x,y],i)=>`<span style="position:absolute;left:${x*100}%;top:${y*100}%;background:#fff;color:#b00;border:2px solid #b00;border-radius:50%;padding:2px;transform:translate(-50%,-50%)">${i+1}</span>`).join('');dialog.querySelector('[data-accept]').disabled=points.length!==4;};
      dialog.querySelector('img').onclick=e=>{if(points.length===4)return;const r=e.currentTarget.getBoundingClientRect();points.push([+(Math.min(1,Math.max(0,(e.clientX-r.left)/r.width))).toFixed(6),+(Math.min(1,Math.max(0,(e.clientY-r.top)/r.height))).toFixed(6)]);draw();};
      dialog.querySelector('[data-reset]').onclick=()=>{points=[];draw();};
      dialog.querySelector('[data-accept]').onclick=()=>{input.value=JSON.stringify(points);dialog.close();};
      dialog.querySelector('[data-cancel]').onclick=()=>dialog.close();
      dialog.addEventListener('close',()=>dialog.remove());document.body.append(dialog);dialog.showModal();
    },
    async configure() {
      if(this.data.batch.extra_data.workbook_sheets) return this.configureWorkbook();
      if (this.dirty && !window.confirm('未反映の修正を破棄して様式設定へ進みますか？')) return;
      const result = await this.ctx.api('/api/daily-report-imports/pdf/templates');
      const templates = result.data?.templates || [];
      const pages = this.data.pages.length ? this.data.pages : [{page_number:1}];
      const existing = this.data.batch.extra_data.template;
      const projectOptions = await this.projectOptions();
      const defaultPage = page => ({page_number:page.page_number,top:.15,bottom:.9,row_count:31,rotation:page.rotation||0,columns:{work_date:[.03,.17],work_interval:[.17,.59]},...page.rectification?.proposal});
      const content = `<p>保存した補正画像を基準に、日付・開始・終了などの範囲を指定します。「検出した行を使用」で実際の罫線に合わせます。緑線は行境界です。日付は行番号から推測しません。</p><label>個別案件<select id="pdf-project" required>${projectOptions}</select></label><label>保存済み様式<select id="pdf-saved-template"><option value="">新規設定</option>${templates.map(t => `<option value="${t.daily_report_import_mapping_id}">${this.escape(t.mapping_name)}</option>`).join('')}</select></label>
        <div id="pdf-template-pages"></div><label>再利用する様式名（任意）<input id="pdf-template-name"></label><p id="pdf-template-error" role="alert"></p>`;
      document.body.insertAdjacentHTML('beforeend',this.kit.modalHtml('帳票の様式設定',content,'<button type="button" class="btn btn-secondary" id="pdf-preview">補正プレビューを更新</button><button type="button" class="btn" id="pdf-start">様式を保存して解析</button>'));
      const close = this.kit.bindModal();
      const draw = template => { document.getElementById('pdf-template-pages').innerHTML = template.pages.map(p => `<fieldset data-page-config="${p.page_number}"><legend>${p.page_number}ページ</legend><label>ページ種別<select data-page-kind>${[['daily','日報'],['evidence','証憑'],['pending','判定保留']].map(([k,v])=>`<option value="${k}" ${(p.page_kind||'daily')===k?'selected':''}>${v}</option>`).join('')}</select></label><p>${this.escape((pages.find(x=>x.page_number===p.page_number)?.rectification?.proposal?.header_text||[]).join(' / '))}</p><div class="form-grid"><label>回転<select data-config="rotation">${[0,90,180,270].map(v=>`<option ${Number(p.rotation)===v?'selected':''}>${v}</option>`).join('')}</select></label><label>表上端 %<input type="number" data-config="top" step="0.1" value="${p.top*100}"></label><label>表下端 %<input type="number" data-config="bottom" step="0.1" value="${p.bottom*100}"></label><label>行数<input type="number" data-config="row_count" value="${p.row_count}"></label></div>${Object.entries(p.columns || {}).map(([key,bounds])=>`<label>${this.escape(p.column_labels?.[key] || labels[key] || observationLabels[key] || key)} <select data-map-key="${key}">${[...Object.entries(labels),...Object.entries(observationLabels),[key,key.startsWith('extra_')?'その他（表示のみ）':'元の項目']].map(([k,v])=>`<option value="${k}" ${k===key?'selected':''}>${this.escape(v)}</option>`).join('')}</select> 左端/右端 % <input type="number" step="0.1" data-column="${key}" data-edge="0" value="${bounds[0]*100}"><input type="number" step="0.1" data-column="${key}" data-edge="1" value="${bounds[1]*100}"></label>`).join('')}</fieldset>`).join(''); };
      const drawWithPreview = template => {
        draw(template);
        document.querySelectorAll('[data-page-config]').forEach(el => {
          const page=pages.find(p=>Number(p.page_number)===Number(el.dataset.pageConfig));
          const config=template.pages.find(p=>Number(p.page_number)===Number(el.dataset.pageConfig));
          el.querySelectorAll('[data-column][data-edge="0"]').forEach(input=>{

            input.closest('label').insertAdjacentHTML('afterbegin',`<input type="checkbox" data-column-enabled="${input.dataset.column}" checked> 読取 `);
          });
          const detected=page?.rectification?.row_edges || [];
          el.insertAdjacentHTML('beforeend',`<button type="button" class="btn btn-small" data-add-column>列を追加</button><label>四隅（左上・右上・右下・左下の x,y、0〜1。変更時は先に補正プレビュー）<input data-source-quad value="${this.escape(config.source_quad?JSON.stringify(config.source_quad):'')}"></label><label><input type="checkbox" data-skip-heading checked> 検出した先頭行は見出し</label><button type="button" class="btn btn-secondary" data-use-lines ${detected.length<2?'disabled':''}>検出した行を使用</button><p>${page?.rectification?.status==='rectified'?'台形・罫線の湾曲を補正済み':'罫線を確認してください（自動補正未確定）'}</p><label>行境界 %（上端から下端まで、カンマ区切り。空欄は自動検出）<textarea data-row-edges rows="2">${(config.row_edges||[]).map(v=>+(v*100).toFixed(6)).join(', ')}</textarea></label>${page?.pdf_page_id?`<a target="_blank" rel="noopener" href="/api/daily-report-imports/pdf/${this.id}/image/source/${page.pdf_page_id}">補正前画像（四隅の指定元）</a><div class="pdf-template-preview"><img src="/api/daily-report-imports/pdf/${this.id}/image/page/${page.pdf_page_id}" alt="保存した補正画像"><div data-preview-lines></div></div>`:''}`);
          el.querySelector('[data-add-column]').onclick=()=>{const key=`extra_col_${Date.now()}`;el.insertAdjacentHTML('beforeend',`<label>列名<input data-new-label="${key}" value="追加列"><select data-map-key="${key}">${[...Object.entries(labels),...Object.entries(observationLabels),[key,'その他（表示のみ）']].map(([k,v])=>`<option value="${k}" ${k===key?'selected':''}>${this.escape(v)}</option>`).join('')}</select> 左端/右端 % <input type="number" data-column="${key}" data-edge="0" value="0"><input type="number" data-column="${key}" data-edge="1" value="100"></label>`);};
          if(page?.pdf_page_id){const button=document.createElement('button');button.type='button';button.className='btn btn-small';button.textContent='画像上で四隅を指定';button.onclick=()=>this.chooseCorners(page,el.querySelector('[data-source-quad]'));el.querySelector('[data-source-quad]').after(button);}
          const edgesInput=el.querySelector('[data-row-edges]');
          const refresh=()=>{ const layer=el.querySelector('[data-preview-lines]'); if(layer) layer.innerHTML=edgesInput.value.split(/[,\s]+/).filter(Boolean).map(Number).filter(v=>Number.isFinite(v)&&v>=0&&v<=100).map(v=>`<span style="top:${v}%"></span>`).join(''); };
          el.querySelector('[data-use-lines]').onclick=()=>{
            const edges=detected.slice(el.querySelector('[data-skip-heading]').checked?1:0);
            if(edges.length<2) return;
            el.querySelector('[data-config="top"]').value=edges[0]*100;
            el.querySelector('[data-config="bottom"]').value=edges.at(-1)*100;
            el.querySelector('[data-config="row_count"]').value=edges.length-1;
            edgesInput.value=edges.map(v=>+(v*100).toFixed(6)).join(', '); refresh();
          };
          edgesInput.oninput=refresh;
          el.querySelectorAll('[data-config]').forEach(input=>input.addEventListener('change',()=>{ edgesInput.value='';refresh(); }));
          refresh();
        });
      };
      drawWithPreview(existing || {pages:pages.map(defaultPage)});
      document.getElementById('pdf-saved-template').onchange = event => { const t = templates.find(t => Number(t.daily_report_import_mapping_id) === Number(event.target.value)); if (t) drawWithPreview(t.mapping_json); };
      const submitTemplate = async (event,preview=false) => {
        try {
        const template = {pages:[...document.querySelectorAll('[data-page-config]')].map(el => {
          const p={page_number:Number(el.dataset.pageConfig),columns:{},column_labels:{},deskew:true,page_kind:el.querySelector('[data-page-kind]').value};
          const quad=el.querySelector('[data-source-quad]').value.trim();if(quad)p.source_quad=JSON.parse(quad);
          el.querySelectorAll('[data-config]').forEach(input => p[input.dataset.config]=Number(input.value)/(['top','bottom'].includes(input.dataset.config)?100:1));
          el.querySelectorAll('[data-column]').forEach(input => { if(el.querySelector(`[data-column-enabled="${input.dataset.column}"]`)?.checked===false)return; const key=el.querySelector(`[data-map-key="${input.dataset.column}"]`).value;p.columns[key] ||= [];p.columns[key][Number(input.dataset.edge)] = Number(input.value)/100;p.column_labels[key]=el.querySelector(`[data-new-label="${input.dataset.column}"]`)?.value || labels[key] || observationLabels[key] || key; });
          const edges=el.querySelector('[data-row-edges]').value.trim();
          if(edges) p.row_edges=edges.split(/[,\s]+/).filter(Boolean).map(v=>Number(v)/100);
          return p;
        })};
        event.currentTarget.disabled = true;
        try { await this.request('/configure',{preview,project_id:Number(document.getElementById('pdf-project').value),template,template_name:document.getElementById('pdf-template-name').value}); close(); await this.load(); }
        catch(error) { document.getElementById('pdf-template-error').textContent=error.message; document.getElementById('pdf-start').disabled=false;event.currentTarget.disabled=false; }
        } catch(error){document.getElementById('pdf-template-error').textContent=error.message;}
      };
      document.getElementById('pdf-start').onclick=e=>submitTemplate(e,false);
      document.getElementById('pdf-preview').onclick=e=>submitTemplate(e,true);
    },
    async manual() {
      if (this.dirty && !window.confirm('未反映の修正を破棄して手入力行を追加しますか？')) return;
      const options = await this.projectOptions();
      document.body.insertAdjacentHTML('beforeend',this.kit.modalHtml('原本を見て手入力',`<label>個別案件<select id="pdf-manual-project" ${this.data.batch.extra_data.project_id ? 'disabled' : ''}>${options}</select></label><label>入力する行数<input id="pdf-manual-count" type="number" min="1" max="62" value="1"></label><p id="pdf-manual-error" role="alert"></p>`,'<button type="button" class="btn" id="pdf-add-manual">入力行を追加</button>'));
      const close = this.kit.bindModal();
      document.getElementById('pdf-add-manual').onclick = async () => {
        try { await this.request('/manual-rows',{project_id:Number(document.getElementById('pdf-manual-project').value),count:Number(document.getElementById('pdf-manual-count').value)}); close(); await this.load(); }
        catch(error) { document.getElementById('pdf-manual-error').textContent = error.message; }
      };
    },
    async apply() {
      const message = document.getElementById('pdf-message');
      const selected = [...this.drafts.values()].filter(d => d.selected);
      if (!selected.length) { message.textContent='反映する行を選択してください'; return; }
      if (this.ctx.app.querySelector('input:invalid')) { message.textContent='入力エラーを修正してください'; return; }
      let rows;try{rows=selected.map(d=>this.rowRequest(d));}catch(error){message.textContent=error.message;return;}
      document.getElementById('pdf-apply').disabled=true;
      try {
        const result=await this.request('/apply',{rows});
        await this.load(); document.getElementById('pdf-message').textContent=`${result.applied.filter(r=>!r.skipped).length}行を反映、${result.applied.filter(r=>r.skipped).length}行は変更なしでした`;
      } catch(error) { message.textContent=error.message; document.getElementById('pdf-apply').disabled=false; }
    },
  };
  window.LinksPdfImports = ui;
})();
