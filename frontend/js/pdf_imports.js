(() => {
  const labels = { work_date:'勤務日', start_time:'開始', end_time:'終了', break_minutes:'休憩', total_distance:'距離', toll_fee:'通行料', parking_fee:'駐車料', transport_fee:'交通費', row_comment:'コメント' };
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
          confirmed:!Object.keys(row.warnings).length, reason:'',
        });
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
          <div><label>${labels[field]} ${warning ? '<span class="pdf-warning">? 要確認</span>' : ''}${this.input(field,draft.ocr[field],'ocr')}</label><small>原読取: ${this.escape(row.raw_data[field] || '空欄')}</small>${warning ? `<small class="pdf-warning">${this.escape(warning)}</small>` : ''}</div>
          <div><label><input type="checkbox" data-include="${field}" ${draft.fields.has(field) ? 'checked' : ''} ${this.editable ? '' : 'disabled'}> ${labels[field]}を反映</label>
          <small>現在: ${this.escape(current ? this.value(field,current[field]) || '空欄' : '未登録')}${different ? ' / 差分あり' : ''}</small>${this.input(field,draft.values[field],'proposed')}
          <small data-edited="${field}">${draft.edited.has(field) ? '手修正を優先' : ''}</small>
          ${field !== 'work_date' ? `<label class="pdf-clear"><input type="checkbox" data-clear="${field}" ${draft.clears.has(field) ? 'checked' : ''} ${this.editable ? '' : 'disabled'}> 明示消去</label>` : ''}</div></div>`;
      }).join('');
      return `<article class="pdf-compare-row" data-row="${id}">
        <div class="pdf-row-select"><label><input type="checkbox" data-select ${draft.selected ? 'checked' : ''} ${this.editable ? '' : 'disabled'}> 取込</label><strong>行${this.escape(row.source_row_number)}</strong><small>${row.previously_imported ? '既取込' : current ? '既存値を保護' : Object.keys(row.warnings).length ? '要確認' : '新規'}</small></div>
        <div class="pdf-original-row">${row.has_image ? `<button class="pdf-crop-button" type="button" data-zoom tabindex="-1"><img src="/api/daily-report-imports/pdf/${this.id}/image/row/${id}" alt="PDF原本の行${this.escape(row.source_row_number)}"></button>` : '<p>原本PDFを開いて確認してください</p>'}<button type="button" class="btn btn-small" data-page tabindex="-1">ページと位置を表示</button></div>
        <div class="pdf-values"><div class="pdf-target"><label>反映先<select data-target ${this.editable ? '' : 'disabled'}><option value="">${matches.length ? '反映先を選択' : '新規日報'}</option>${matches.map(r => `<option value="${r.daily_report_id}" ${Number(draft.target) === Number(r.daily_report_id) ? 'selected' : ''}>日報#${r.daily_report_id} / ${this.escape(r.start_time || '時刻未入力')} / ${this.escape(r.row_comment || '')}</option>`).join('')}${matches.length ? `<option value="new" ${draft.target === 'new' ? 'selected' : ''}>新しい作業行を追加する</option>` : ''}</select></label>
          <label><input type="checkbox" data-date-confirmed ${draft.confirmed ? 'checked' : ''}> 原本の勤務日を確認した</label><label>更新・再取込理由<input data-reason value="${this.escape(draft.reason)}" placeholder="既存値の更新時は必須"></label></div>${fields}
          <p class="pdf-row-error" role="alert"></p></div></article>`;
    },
    render() {
      const latest = this.data.jobs[0];
      const busy = latest && ['queued','running'].includes(latest.status);
      this.ctx.app.innerHTML = this.kit.shell('PDF日報の比較・取込', `<section class="panel pdf-import-screen">
        <div class="pdf-import-toolbar"><h2>${this.escape(this.data.file.name)}</h2><p>${this.data.period ? `対象期間 ${this.escape(this.data.period.period_start)}〜${this.escape(this.data.period.period_end)}` : '案件と様式を設定してください'}</p>
          <p role="status">${busy ? `解析 ${this.escape(latest.progress)}%（${latest.status === 'queued' ? '待機' : '処理中'}）。日報入力へ戻っても処理は続きます。` : latest?.error_message ? this.escape(latest.error_message) : '選択した行と項目だけを日報へ反映します。空欄は既存値を消しません。'}</p>
          <div class="btn-row"><a class="btn btn-secondary" href="/api/daily-report-imports/pdf/${this.id}/image/original/0" target="_blank" rel="noopener">PDF原本を開く</a><button class="btn btn-secondary" id="pdf-refresh">現在値・進捗を再取得</button>${this.editable ? `<button class="btn btn-secondary" id="pdf-template">案件・様式を設定</button><button class="btn btn-secondary" id="pdf-manual">原本を見て手入力</button><button class="btn" id="pdf-apply" ${busy ? 'disabled' : ''}>選択内容を反映</button>` : ''}${latest?.status === 'failed' && this.editable ? '<button class="btn" id="pdf-retry">失敗した解析を再試行</button>' : ''}<button class="btn btn-ghost" id="pdf-back">取込一覧へ</button></div>
          <label><input type="checkbox" id="pdf-extra"> 距離・経費・コメントを表示</label><p id="pdf-message" role="status"></p></div>
        <div class="pdf-comparison-heading"><span>取込</span><span>PDF原本の該当行</span><span>OCR候補・修正</span><span>現在値・反映予定値</span></div>
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
    },
    leave() { if (!this.dirty || window.confirm('未反映の修正があります。取込一覧へ戻りますか？')) this.options.onBack(); },
    bindRows() {
      this.ctx.app.querySelectorAll('[data-row]').forEach(article => {
        const draft = this.drafts.get(Number(article.dataset.row));
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
    replaceRow(article,draft) { article.outerHTML = this.rowHtml(draft); this.bindRows(); },
    entryInputs(root) { return [...root.querySelectorAll('input,select,textarea')].filter(el => !el.disabled && !el.readOnly && el.getClientRects().length); },
    entryTimeOptions() { return {maxMinutes:2879,padHours:true}; },
    openEntryTimePicker(input) { return window.LinksDailyEntryUI.openEntryTimePicker.call(this,input); },
    async projectOptions() {
      const result = await this.ctx.api(`/api/daily-reports/month-projects?target_year_month=${encodeURIComponent(this.data.batch.target_year_month)}`);
      if (!result.res.ok) throw new Error(result.data?.message || '案件一覧の取得に失敗しました');
      const selected = Number(this.data.batch.extra_data.project_id || this.options.projectId);
      return '<option value="">案件を選択してください</option>' + (result.data.rows || []).map(r => `<option value="${r.project_id}" ${Number(r.project_id) === selected ? 'selected' : ''}>#${r.project_id} ${this.escape(r.company_name)} / ${this.escape(r.template_name || r.manager_name || '')} / ${this.escape(r.partner_name)}</option>`).join('');
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
    async configure() {
      if (this.dirty && !window.confirm('未反映の修正を破棄して様式設定へ進みますか？')) return;
      const result = await this.ctx.api('/api/daily-report-imports/pdf/templates');
      const templates = result.data?.templates || [];
      const pages = this.data.pages.length ? this.data.pages : [{page_number:1}];
      const existing = this.data.batch.extra_data.template;
      const projectOptions = await this.projectOptions();
      const defaultPage = page => ({page_number:page.page_number,top:.15,bottom:.9,row_count:31,rotation:0,columns:{work_date:[.03,.17],start_time:[.17,.38],end_time:[.38,.59],break_minutes:[.59,.75]}});
      const content = `<p>原本に合わせて表の上下・行数・各列の左右を割合（%）で設定します。原本は別タブで開けます。</p><label>個別案件<select id="pdf-project" required>${projectOptions}</select></label><label>保存済み様式<select id="pdf-saved-template"><option value="">新規設定</option>${templates.map(t => `<option value="${t.daily_report_import_mapping_id}">${this.escape(t.mapping_name)}</option>`).join('')}</select></label>
        <div id="pdf-template-pages"></div><label>再利用する様式名（任意）<input id="pdf-template-name"></label><p id="pdf-template-error" role="alert"></p>`;
      document.body.insertAdjacentHTML('beforeend',this.kit.modalHtml('PDFの様式設定',content,'<button type="button" class="btn" id="pdf-start">様式を保存して解析</button>'));
      const close = this.kit.bindModal();
      const draw = template => { document.getElementById('pdf-template-pages').innerHTML = template.pages.map(p => `<fieldset data-page-config="${p.page_number}"><legend>${p.page_number}ページ</legend><div class="form-grid"><label>回転<select data-config="rotation">${[0,90,180,270].map(v=>`<option ${Number(p.rotation)===v?'selected':''}>${v}</option>`).join('')}</select></label><label>表上端 %<input type="number" data-config="top" step="0.1" value="${p.top*100}"></label><label>表下端 %<input type="number" data-config="bottom" step="0.1" value="${p.bottom*100}"></label><label>行数<input type="number" data-config="row_count" value="${p.row_count}"></label></div>${Object.entries(p.columns).map(([key,bounds])=>`<label>${labels[key]} 左端/右端 % <input type="number" step="0.1" data-column="${key}" data-edge="0" value="${bounds[0]*100}"><input type="number" step="0.1" data-column="${key}" data-edge="1" value="${bounds[1]*100}"></label>`).join('')}</fieldset>`).join(''); };
      draw(existing || {pages:pages.map(defaultPage)});
      document.getElementById('pdf-saved-template').onchange = event => { const t = templates.find(t => Number(t.daily_report_import_mapping_id) === Number(event.target.value)); if (t) draw(t.mapping_json); };
      document.getElementById('pdf-start').onclick = async event => {
        const template = {pages:[...document.querySelectorAll('[data-page-config]')].map(el => {
          const p={page_number:Number(el.dataset.pageConfig),columns:{},deskew:true};
          el.querySelectorAll('[data-config]').forEach(input => p[input.dataset.config]=Number(input.value)/(['top','bottom'].includes(input.dataset.config)?100:1));
          el.querySelectorAll('[data-column]').forEach(input => { p.columns[input.dataset.column] ||= []; p.columns[input.dataset.column][Number(input.dataset.edge)] = Number(input.value)/100; });
          return p;
        })};
        event.currentTarget.disabled = true;
        try { await this.request('/configure',{project_id:Number(document.getElementById('pdf-project').value),template,template_name:document.getElementById('pdf-template-name').value}); close(); await this.load(); }
        catch(error) { document.getElementById('pdf-template-error').textContent=error.message; document.getElementById('pdf-start').disabled=false; }
      };
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
      const rows = selected.map(d => {
        const current = this.data.current_reports.find(r => Number(r.daily_report_id) === Number(d.target));
        return {import_row_id:d.row.daily_report_import_row_id,import_version:d.row.version,target_daily_report_id:current?.daily_report_id || null,expected_version:current?.version || null,
          fields:[...d.fields],values:d.values,clear_fields:[...d.clears],reason:d.reason,date_confirmed:d.confirmed,allow_new_work_row:d.target==='new'};
      });
      document.getElementById('pdf-apply').disabled=true;
      try {
        const result=await this.request('/apply',{rows});
        await this.load(); document.getElementById('pdf-message').textContent=`${result.applied.filter(r=>!r.skipped).length}行を反映、${result.applied.filter(r=>r.skipped).length}行は変更なしでした`;
      } catch(error) { message.textContent=error.message; document.getElementById('pdf-apply').disabled=false; }
    },
  };
  window.LinksPdfImports = ui;
})();
