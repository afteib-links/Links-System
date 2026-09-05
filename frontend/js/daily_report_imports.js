(() => {
  const LinksDailyReportImports = {
    async open(ctx, options = {}) {
      this.ctx = ctx;
      this.kit = window.LinksFeatureKit.createFeatureKit(ctx);
      this.ym = options.targetYearMonth || this.kit.currentYearMonth();
      this.projectId = options.projectId || null;
      this.onBack = options.onBack || (() => ctx.openFeature('daily_reports'));
      this.uploadDraft = null;
      await this.showHome();
    },

    statusLabel(status) {
      return ({ uploaded:'アップロード済み', parsing:'解析中', needs_review:'確認待ち', partial:'一部反映', applied:'反映済み', failed:'エラー', cancelled:'取消済み' }[status] || status || '-');
    },

    rowStatusLabel(status) {
      return ({ ready:'反映可能', warning:'要確認', error:'エラー', applied:'反映済み', skipped:'対象外', pending:'未解析' }[status] || status || '-');
    },

    async showHome(message = '') {
      this.ctx.renderLoading();
      const [history, fields, mappings] = await Promise.all([
        this.ctx.api(`/api/daily-report-imports?target_year_month=${encodeURIComponent(this.ym)}`),
        this.ctx.api('/api/daily-report-imports/fields'),
        this.ctx.api('/api/daily-report-imports/mappings'),
      ]);
      this.fields = fields.data?.fields || [];
      this.mappings = mappings.data?.mappings || [];
      const rows = (history.data?.batches || []).map((batch) => `<tr>
        <td>#${this.ctx.escapeHtml(batch.daily_report_import_batch_id)}</td>
        <td>${this.ctx.escapeHtml(batch.original_filename || '-')}</td>
        <td>${this.ctx.escapeHtml(batch.target_year_month || '-')}</td>
        <td>${this.kit.statusBadge(batch.status, this.statusLabel(batch.status))}</td>
        <td>${this.ctx.escapeHtml(batch.row_count || 0)}件</td>
        <td>${this.ctx.escapeHtml(batch.applied_count || 0)}件</td>
        <td>${this.ctx.escapeHtml(batch.created_by_name || '-')}</td>
        <td><button type="button" class="btn btn-small btn-ghost" data-open-import="${batch.daily_report_import_batch_id}">開く</button></td>
      </tr>`).join('');
      this.ctx.app.innerHTML = this.kit.shell('日報データ取り込み', `
        <section class="panel dr-import-panel">
          ${message ? `<p class="flash">${this.ctx.escapeHtml(message)}</p>` : ''}
          <div class="section-title-row"><div><h3>Excel／CSVを取り込む</h3><p class="muted">原本を保存し、列と日報項目を対応付けてから下書きへ反映します。</p></div></div>
          <form id="daily-import-upload" class="dr-import-upload">
            <label>対象年月<input type="month" name="target_year_month" value="${this.ctx.escapeHtml(this.ym)}" required></label>
            <label>ファイル（.xlsx／.csv、50MBまで）<input type="file" name="file" accept=".xlsx,.csv" required></label>
            <button type="submit" class="btn">アップロードして確認</button>
          </form>
          <p class="muted">同一内容のファイルは二重取込を防ぐため警告します。外部ファイル内の請求額・支払額は使用せず、既存の日報計算で再計算します。</p>
        </section>
        <section class="panel">
          <h3>取込履歴（${this.ctx.escapeHtml(this.ym)}）</h3>
          <div class="table-wrap table-wrap-sticky"><table class="data-table data-table-compact">
            <thead><tr><th>No</th><th>原本</th><th>対象月</th><th>状態</th><th>解析</th><th>反映</th><th>取込者</th><th>操作</th></tr></thead>
            <tbody>${rows || '<tr><td colspan="8">取込履歴はありません</td></tr>'}</tbody>
          </table></div>
        </section>`, { onBack: this.onBack, wide: true });
      this.kit.bindShell({ onBack: this.onBack });
      document.getElementById('daily-import-upload')?.addEventListener('submit', (event) => this.upload(event));
      document.querySelectorAll('[data-open-import]').forEach((button) => button.addEventListener('click', () => this.loadBatch(Number(button.dataset.openImport))));
    },

    async upload(event, duplicateReason = '') {
      event?.preventDefault();
      const form = event?.currentTarget || document.getElementById('daily-import-upload');
      const formData = new FormData(form);
      if (duplicateReason) {
        formData.set('allow_duplicate', '1');
        formData.set('duplicate_reason', duplicateReason);
      }
      const submit = form.querySelector('button[type="submit"]');
      submit.disabled = true;
      submit.textContent = 'アップロード中…';
      const result = await this.ctx.api('/api/daily-report-imports', { method: 'POST', body: formData });
      submit.disabled = false;
      submit.textContent = 'アップロードして確認';
      if (result.res.status === 409 && result.data?.code === 'duplicate_file') {
        if (window.confirm(`${result.data.message}\n既存の取込 #${result.data.duplicate?.daily_report_import_batch_id} を開きますか？`)) {
          await this.loadBatch(Number(result.data.duplicate.daily_report_import_batch_id));
        } else {
          const reason = window.prompt('別バッチとして再取込する理由を入力してください');
          if (reason?.trim()) await this.upload(null, reason.trim());
        }
        return;
      }
      if (!result.res.ok || !result.data?.ok) {
        window.alert(result.data?.message || 'アップロードに失敗しました');
        return;
      }
      this.uploadDraft = result.data;
      this.showMapping();
    },

    mappingOptions(field, selected) {
      const headers = this.uploadDraft?.headers || [];
      return `<option value="">取り込まない</option>${headers.map((header, index) => `<option value="${index}" ${Number(selected) === index ? 'selected' : ''}>${this.ctx.escapeHtml(header || `列${index + 1}`)}</option>`).join('')}`;
    },

    showMapping() {
      const draft = this.uploadDraft;
      if (!draft) return this.showHome();
      const inferred = draft.inferred_mapping || {};
      const mappingRows = this.fields.map((field) => `<label>${this.ctx.escapeHtml(field.label)}<select data-map-field="${this.ctx.escapeHtml(field.key)}">${this.mappingOptions(field, inferred[field.key])}</select></label>`).join('');
      const preview = (draft.preview_rows || []).map((row, index) => `<tr><th>${index + 1}</th>${row.map((cell) => `<td>${this.ctx.escapeHtml(cell ?? '')}</td>`).join('')}</tr>`).join('');
      this.ctx.app.innerHTML = this.kit.shell('Excel列マッピング', `
        <section class="panel dr-import-panel">
          <div class="section-title-row"><div><h3>${this.ctx.escapeHtml(draft.original_filename)}</h3><p class="muted">見出し行と取り込む列を確認してください。</p></div></div>
          <div class="form-grid">
            <label>シート<select id="import-sheet">${(draft.sheet_names || []).map((name) => `<option value="${this.ctx.escapeHtml(name)}" ${name === draft.selected_sheet ? 'selected' : ''}>${this.ctx.escapeHtml(name)}</option>`).join('')}</select></label>
            <label>見出し行<input id="import-header-row" type="number" min="1" value="${Number(draft.header_row || 1)}"></label>
            <label>保存済み列対応<select id="saved-import-mapping"><option value="">使用しない</option>${(this.mappings || []).map((item) => `<option value="${item.daily_report_import_mapping_id}">${this.ctx.escapeHtml(item.mapping_name)}</option>`).join('')}</select></label>
          </div>
          <div class="dr-import-mapping-grid">${mappingRows}</div>
          <details><summary>原本プレビュー</summary><div class="table-wrap"><table class="data-table data-table-compact"><tbody>${preview}</tbody></table></div></details>
          <div class="dr-import-template-row">
            <label><input type="checkbox" id="save-import-mapping"> この列対応を保存する</label>
            <input id="import-mapping-name" placeholder="例：A社 日報形式" disabled>
          </div>
          <div class="btn-row"><button type="button" class="btn" id="parse-import">解析して確認画面へ</button><button type="button" class="btn btn-ghost" id="cancel-import-mapping">戻る</button></div>
        </section>`, { onBack: () => this.showHome(), wide: true });
      this.kit.bindShell({ onBack: () => this.showHome() });
      document.getElementById('save-import-mapping')?.addEventListener('change', (event) => { document.getElementById('import-mapping-name').disabled = !event.target.checked; });
      document.getElementById('import-sheet')?.addEventListener('change', () => this.refreshSetup());
      document.getElementById('import-header-row')?.addEventListener('change', () => this.refreshSetup());
      document.getElementById('saved-import-mapping')?.addEventListener('change', (event) => {
        const selected = (this.mappings || []).find((item) => Number(item.daily_report_import_mapping_id) === Number(event.target.value));
        if (!selected) return;
        document.getElementById('import-header-row').value = Number(selected.header_row || 1);
        document.querySelectorAll('[data-map-field]').forEach((select) => {
          const value = selected.mapping_json?.[select.dataset.mapField];
          select.value = value == null ? '' : String(value);
        });
      });
      document.getElementById('cancel-import-mapping')?.addEventListener('click', () => this.showHome());
      document.getElementById('parse-import')?.addEventListener('click', () => this.parseDraft());
    },

    async refreshSetup() {
      const sheet = document.getElementById('import-sheet')?.value || '';
      const headerRow = Number(document.getElementById('import-header-row')?.value || 1);
      const result = await this.ctx.api(`/api/daily-report-imports/${this.uploadDraft.batch_id}/setup?sheet_name=${encodeURIComponent(sheet)}&header_row=${headerRow}`);
      if (!result.res.ok || !result.data?.ok) {
        window.alert(result.data?.message || 'シート内容を取得できませんでした');
        return;
      }
      this.uploadDraft = result.data;
      this.showMapping();
    },

    collectMapping() {
      const mapping = {};
      document.querySelectorAll('[data-map-field]').forEach((select) => {
        if (select.value !== '') mapping[select.dataset.mapField] = Number(select.value);
      });
      return mapping;
    },

    async parseDraft() {
      const button = document.getElementById('parse-import');
      button.disabled = true;
      button.textContent = '解析中…';
      const mapping = this.collectMapping();
      const headerRow = Number(document.getElementById('import-header-row').value || 1);
      let mappingTemplateId = null;
      if (document.getElementById('save-import-mapping').checked) {
        const name = document.getElementById('import-mapping-name').value.trim();
        if (!name) {
          window.alert('保存する列対応の名前を入力してください');
          button.disabled = false;
          button.textContent = '解析して確認画面へ';
          return;
        }
        const saved = await this.ctx.api('/api/daily-report-imports/mappings', { method:'POST', body:JSON.stringify({ mapping_name:name, header_row:headerRow, sheet_pattern:document.getElementById('import-sheet').value, mapping }) });
        if (!saved.res.ok) {
          window.alert(saved.data?.message || '列対応を保存できませんでした');
          button.disabled = false;
          button.textContent = '解析して確認画面へ';
          return;
        }
        mappingTemplateId = saved.data.mapping_id;
      }
      const parsed = await this.ctx.api(`/api/daily-report-imports/${this.uploadDraft.batch_id}/parse`, {
        method:'POST',
        body:JSON.stringify({ sheet_name:document.getElementById('import-sheet').value, header_row:headerRow, mapping, mapping_template_id:mappingTemplateId || Number(document.getElementById('saved-import-mapping').value) || null, default_project_id:this.projectId }),
      });
      if (!parsed.res.ok || !parsed.data?.ok) {
        window.alert(parsed.data?.message || '解析に失敗しました');
        button.disabled = false;
        button.textContent = '解析して確認画面へ';
        return;
      }
      this.renderBatch(parsed.data);
    },

    async loadBatch(id) {
      this.ctx.renderLoading();
      const result = await this.ctx.api(`/api/daily-report-imports/${id}`);
      if (!result.res.ok || !result.data?.ok) {
        window.alert(result.data?.message || '取込内容を取得できませんでした');
        return this.showHome();
      }
      if (result.data.batch.status === 'uploaded') {
        const setup = await this.ctx.api(`/api/daily-report-imports/${id}/setup`);
        if (!setup.res.ok || !setup.data?.ok) {
          window.alert(setup.data?.message || '列マッピングを再開できませんでした');
          return this.showHome();
        }
        this.uploadDraft = setup.data;
        return this.showMapping();
      }
      this.renderBatch(result.data);
    },

    rowMessages(row) {
      const errors = row.validation_errors || [];
      const warnings = row.validation_warnings || [];
      return [...errors.map((text) => `<span class="dr-import-error">! ${this.ctx.escapeHtml(text)}</span>`), ...warnings.map((text) => `<span class="dr-import-warning">△ ${this.ctx.escapeHtml(text)}</span>`)].join('') || '<span class="dr-import-ok">✓ 検証済み</span>';
    },

    rowInput(row, key, type = 'text', extra = '') {
      const data = row.reviewed_data || row.parsed_data || {};
      const value = data[key] ?? '';
      return `<input data-import-field="${key}" data-row-id="${row.daily_report_import_row_id}" type="${type}" value="${this.ctx.escapeHtml(value)}" ${extra}>`;
    },

    renderBatch(data, message = '') {
      this.currentBatch = data;
      const batch = data.batch;
      const file = data.files?.[0];
      const rows = (data.rows || []).map((row) => {
        const value = row.reviewed_data || row.parsed_data || {};
        const selectable = ['ready','warning'].includes(row.status);
        return `<tr data-import-row="${row.daily_report_import_row_id}">
          <td><input type="checkbox" data-apply-row="${row.daily_report_import_row_id}" ${selectable ? 'checked' : ''} ${selectable ? '' : 'disabled'}></td>
          <td>${this.ctx.escapeHtml(row.source_row_number || '-')}</td>
          <td>${this.kit.statusBadge(row.status, this.rowStatusLabel(row.status))}<div class="dr-import-messages">${this.rowMessages(row)}</div></td>
          <td>${this.rowInput(row,'project_id','number','min="1"')}<small>${this.ctx.escapeHtml(row.template_name || row.match_reason || '')}</small></td>
          <td>${this.rowInput(row,'work_date','date')}</td>
          <td>${this.rowInput(row,'start_time')}</td>
          <td>${this.rowInput(row,'end_time')}</td>
          <td>${this.rowInput(row,'break_minutes','number','min="0"')}<small>分</small></td>
          <td><label><input data-import-check="is_absent" data-row-id="${row.daily_report_import_row_id}" type="checkbox" ${value.is_absent ? 'checked' : ''}>不要</label><label><input data-import-check="is_training" data-row-id="${row.daily_report_import_row_id}" type="checkbox" ${value.is_training ? 'checked' : ''}>研修</label></td>
          <td>${this.rowInput(row,'total_distance','number','min="0"')}</td>
          <td>${this.rowInput(row,'toll_fee','number','min="0"')}</td>
          <td>${this.rowInput(row,'parking_fee','number','min="0"')}</td>
          <td>${this.rowInput(row,'transport_fee','number','min="0"')}</td>
          <td>${this.rowInput(row,'row_comment')}</td>
          <td><label><input type="checkbox" data-same-day-row="${row.daily_report_import_row_id}">同日追加を確認</label><button type="button" class="btn btn-small btn-ghost" data-save-import-row="${row.daily_report_import_row_id}" ${row.status === 'applied' ? 'disabled' : ''}>検証</button></td>
        </tr>`;
      }).join('');
      this.ctx.app.innerHTML = this.kit.shell(`取込確認 #${batch.daily_report_import_batch_id}`, `
        <section class="panel dr-import-panel">
          ${message ? `<p class="flash">${this.ctx.escapeHtml(message)}</p>` : ''}
          <div class="section-title-row"><div><h3>${this.ctx.escapeHtml(file?.original_filename || '-')}</h3><p class="muted">${this.ctx.escapeHtml(batch.target_year_month || '複数月')} / ${this.statusLabel(batch.status)}</p></div>
            ${file ? `<a class="btn btn-ghost" href="/api/daily-report-imports/files/${file.daily_report_import_file_id}" target="_blank" rel="noopener">原本を開く</a>` : ''}
          </div>
          ${this.kit.summaryCardsHtml([{label:'解析行',value:batch.row_count},{label:'反映可能',value:batch.valid_count,tone:'complete'},{label:'要確認',value:batch.warning_count,tone:'waiting'},{label:'エラー',value:batch.error_count,tone:'attention'},{label:'反映済み',value:batch.applied_count,tone:'complete'}])}
          <p class="muted">黄色の行は警告を確認してください。同じ案件・日付に別作業を追加する場合だけ「同日追加を確認」を選びます。</p>
          <div class="table-wrap table-wrap-sticky dr-import-review-wrap"><table class="data-table data-table-compact dr-import-review-table">
            <thead><tr><th>反映</th><th>行</th><th>検証</th><th>案件ID</th><th>勤務日</th><th>開始</th><th>終了</th><th>休憩</th><th>区分</th><th>距離</th><th>通行料</th><th>駐車料</th><th>交通費</th><th>コメント</th><th>操作</th></tr></thead>
            <tbody>${rows || '<tr><td colspan="15">解析行がありません</td></tr>'}</tbody>
          </table></div>
          <div class="btn-row dr-import-actions"><button type="button" class="btn" id="apply-import-rows" ${['applied','cancelled'].includes(batch.status) ? 'disabled' : ''}>選択行を日報へ反映</button><button type="button" class="btn btn-ghost" id="back-import-list">取込履歴へ</button></div>
        </section>`, { onBack: () => this.showHome(), wide: true });
      this.kit.bindShell({ onBack: () => this.showHome() });
      document.querySelectorAll('[data-save-import-row]').forEach((button) => button.addEventListener('click', () => this.saveRow(Number(button.dataset.saveImportRow))));
      document.getElementById('apply-import-rows')?.addEventListener('click', () => this.applyRows());
      document.getElementById('back-import-list')?.addEventListener('click', () => this.showHome());
    },

    collectRow(rowId) {
      const current = this.currentBatch.rows.find((row) => Number(row.daily_report_import_row_id) === Number(rowId));
      const data = { ...(current?.reviewed_data || current?.parsed_data || {}) };
      document.querySelectorAll(`[data-import-field][data-row-id="${rowId}"]`).forEach((input) => {
        const key = input.dataset.importField;
        data[key] = input.type === 'number' ? (input.value === '' ? null : Number(input.value)) : (input.value.trim() || null);
      });
      document.querySelectorAll(`[data-import-check][data-row-id="${rowId}"]`).forEach((input) => { data[input.dataset.importCheck] = input.checked ? 1 : 0; });
      return { current, data };
    },

    async saveRow(rowId, quiet = false) {
      const { current, data } = this.collectRow(rowId);
      const result = await this.ctx.api(`/api/daily-report-imports/${this.currentBatch.batch.daily_report_import_batch_id}/rows/${rowId}`, {
        method:'PUT', body:JSON.stringify({ reviewed_data:data, version:current.version }),
      });
      if (!result.res.ok || !result.data?.ok) {
        if (!quiet) window.alert(result.data?.message || '行を検証できませんでした');
        return false;
      }
      const index = this.currentBatch.rows.findIndex((row) => Number(row.daily_report_import_row_id) === rowId);
      this.currentBatch.rows[index] = { ...this.currentBatch.rows[index], ...result.data.row };
      if (!quiet) await this.loadBatch(this.currentBatch.batch.daily_report_import_batch_id);
      return true;
    },

    async applyRows() {
      const selected = [...document.querySelectorAll('[data-apply-row]:checked')].map((input) => Number(input.dataset.applyRow));
      const sameDay = [...document.querySelectorAll('[data-same-day-row]:checked')].map((input) => Number(input.dataset.sameDayRow));
      if (!selected.length) return window.alert('反映する行を選択してください');
      for (const rowId of selected) {
        const ok = await this.saveRow(rowId, true);
        if (!ok) return window.alert('入力内容を検証できない行があります');
      }
      const refreshedSelected = selected.filter((rowId) => {
        const row = this.currentBatch.rows.find((item) => Number(item.daily_report_import_row_id) === rowId);
        return row && ['ready','warning'].includes(row.status);
      });
      if (refreshedSelected.length !== selected.length) return window.alert('エラーを解消してから反映してください');
      const warnings = refreshedSelected.some((rowId) => this.currentBatch.rows.find((item) => Number(item.daily_report_import_row_id) === rowId)?.status === 'warning');
      if (warnings && !window.confirm('警告のある行が含まれます。原本と内容を確認済みとして反映しますか？')) return;
      const result = await this.ctx.api(`/api/daily-report-imports/${this.currentBatch.batch.daily_report_import_batch_id}/apply`, {
        method:'POST', body:JSON.stringify({ row_ids:refreshedSelected, allow_same_day_row_ids:sameDay, acknowledge_warnings:warnings }),
      });
      if (!result.res.ok || !result.data?.ok) {
        window.alert(result.data?.message || '日報へ反映できませんでした');
        return;
      }
      await this.loadBatch(this.currentBatch.batch.daily_report_import_batch_id);
      this.ctx.showToast(`${result.data.applied.length}件を日報へ反映しました`);
    },
  };

  window.LinksDailyReportImports = LinksDailyReportImports;
})();
