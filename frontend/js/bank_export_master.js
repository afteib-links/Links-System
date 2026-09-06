(() => {
  const API = '/api/master-settings/bank-export';
  const FAMILY_LABELS = { resona:'りそなグループ', mizuho:'みずほ銀行', smbc:'三井住友銀行', other:'その他' };
  const STATUS_LABELS = { draft:'下書き・未検証', published:'公開中', retired:'旧版' };

  const BankExportMaster = {
    init(ctx, onBack) {
      this.ctx = ctx;
      this.kit = window.LinksFeatureKit.createFeatureKit(ctx);
      this.onBack = onBack;
    },

    async catalog() {
      const result = await this.ctx.api(`${API}/catalog`);
      if (!result.res.ok) throw new Error(result.data?.message || '銀行CSVマスターを取得できませんでした');
      this.data = result.data;
      return result.data;
    },

    async openProfiles(ctx, onBack, message = '') {
      this.init(ctx, onBack);
      this.ctx.renderLoading();
      try { await this.catalog(); } catch (error) { window.alert(error.message); return onBack(); }
      const rows = (this.data.profiles || []).map((profile) => `<tr>
        <td>${this.ctx.escapeHtml(FAMILY_LABELS[profile.bank_family] || profile.bank_family)}</td>
        <td><strong>${this.ctx.escapeHtml(profile.profile_name)}</strong><small class="cell-sub">${this.ctx.escapeHtml(profile.profile_code)}</small></td>
        <td>${profile.latest_version_no ? `v${profile.latest_version_no} ${this.kit.statusBadge(profile.latest_version_status, STATUS_LABELS[profile.latest_version_status] || profile.latest_version_status)}` : '版なし'}</td>
        <td>${profile.published_version_no ? `v${profile.published_version_no}` : '<span class="status-text warning">未公開</span>'}</td>
        <td class="table-action-row">
          ${profile.latest_version_id ? `<button class="btn btn-ghost btn-small" data-edit-version="${profile.latest_version_id}">列・形式を編集</button>` : ''}
          ${profile.latest_version_status !== 'draft' ? `<button class="btn btn-secondary btn-small" data-new-version="${profile.bank_export_profile_id}">新しい版</button>` : ''}
        </td>
      </tr>`).join('');
      this.ctx.app.innerHTML = this.kit.shell('銀行CSVフォーマットマスター', `<section class="panel">
        ${message ? `<p class="flash">${this.ctx.escapeHtml(message)}</p>` : ''}
        <div class="section-title-row"><div><h2>出力プロファイル</h2><p class="muted">公開済み版は変更せず、新しい下書き版を作成して改定します。</p></div><div class="btn-row"><button type="button" class="btn btn-ghost" data-master-help="bank-profiles">ヘルプ</button><button class="btn" id="add-bank-profile">＋ プロファイル</button></div></div>
        <div class="table-wrap"><table class="data-table data-table-compact"><thead><tr><th>銀行系列</th><th>名称</th><th>最新の版</th><th>出力中の版</th><th>操作</th></tr></thead><tbody>${rows || '<tr><td colspan="5">プロファイルがありません</td></tr>'}</tbody></table></div>
        <div id="modal-host"></div>
      </section>`, { onBack:this.onBack });
      this.kit.bindShell({ onBack:this.onBack });
      window.LinksMasterSettings.ctx = this.ctx;
      window.LinksMasterSettings.kit = this.kit;
      window.LinksMasterSettings.bindHelp();
      document.getElementById('add-bank-profile').onclick = () => this.profileModal();
      document.querySelectorAll('[data-edit-version]').forEach((button) => button.onclick = () => this.openVersion(Number(button.dataset.editVersion)));
      document.querySelectorAll('[data-new-version]').forEach((button) => button.onclick = async () => {
        const result = await this.ctx.api(`${API}/profiles/${button.dataset.newVersion}/versions`, { method:'POST', body:'{}' });
        if (!result.res.ok) return window.alert(result.data?.message || '下書き版を作成できませんでした');
        this.openVersion(Number(result.data.bank_export_profile_version_id));
      });
    },

    profileModal() {
      document.getElementById('modal-host').innerHTML = this.kit.modalHtml('出力プロファイル追加', `<div class="form-grid">
        <div><label>プロファイルコード</label><input id="bp-code" placeholder="bank_service_csv"></div>
        <div><label>銀行系列</label><select id="bp-family"><option value="other">その他</option><option value="resona">りそなグループ</option><option value="mizuho">みずほ</option><option value="smbc">三井住友</option></select></div>
        <div class="full"><label>名称</label><input id="bp-name"></div><div class="full"><label>説明</label><input id="bp-description"></div>
      </div>`, '<button class="btn" id="bp-save">追加</button>', 'modal-wide');
      this.kit.bindModal();
      document.getElementById('bp-save').onclick = async () => {
        const payload = { profile_code:document.getElementById('bp-code').value.trim(), profile_name:document.getElementById('bp-name').value.trim(), bank_family:document.getElementById('bp-family').value, description:document.getElementById('bp-description').value };
        const result = await this.ctx.api(`${API}/profiles`, { method:'POST', body:JSON.stringify(payload) });
        if (!result.res.ok) return window.alert(result.data?.message || '追加できませんでした');
        document.getElementById('modal-backdrop')?.remove();
        const version = await this.ctx.api(`${API}/profiles/${result.data.bank_export_profile_id}/versions`, { method:'POST', body:'{}' });
        if (!version.res.ok) return this.openProfiles(this.ctx, this.onBack, 'プロファイルを追加しました。下書き版を作成してください。');
        this.openVersion(Number(version.data.bank_export_profile_version_id));
      };
    },

    async openVersion(id, message = '') {
      this.ctx.renderLoading();
      const result = await this.ctx.api(`${API}/versions/${id}`);
      if (!result.res.ok) return window.alert(result.data?.message || '版を取得できませんでした');
      this.version = result.data.version;
      this.sourceFields = result.data.source_fields || [];
      this.columns = (this.version.columns || []).map((column) => ({ ...column }));
      this.renderVersion(message);
    },

    sourceOptions(selected) {
      return this.sourceFields.map((field) => `<option value="${field.key}" ${field.key === selected ? 'selected' : ''}>${this.ctx.escapeHtml(field.label)}</option>`).join('');
    },

    renderVersion(message = '') {
      const editable = this.version.status === 'draft';
      const columnRows = this.columns.map((column, index) => `<tr data-column-index="${index}">
        <td class="num">${index + 1}</td>
        <td><input data-col="column_key" value="${this.ctx.escapeHtml(column.column_key || '')}" ${editable ? '' : 'disabled'}></td>
        <td><input data-col="column_label" value="${this.ctx.escapeHtml(column.column_label || '')}" ${editable ? '' : 'disabled'}></td>
        <td><select data-col="source_key" ${editable ? '' : 'disabled'}>${this.sourceOptions(column.source_key)}</select></td>
        <td><input data-col="fixed_value" value="${this.ctx.escapeHtml(column.fixed_value || '')}" ${editable ? '' : 'disabled'}></td>
        <td><select data-col="transform_code" ${editable ? '' : 'disabled'}>${['none','digits','half_width','katakana','upper'].map((v) => `<option value="${v}" ${v === (column.transform_code || 'none') ? 'selected' : ''}>${v}</option>`).join('')}</select></td>
        <td><input data-col="format_code" value="${this.ctx.escapeHtml(column.format_code || '')}" placeholder="YYYYMMDD" ${editable ? '' : 'disabled'}></td>
        <td><input data-col="zero_pad_length" type="number" min="1" value="${column.zero_pad_length || ''}" ${editable ? '' : 'disabled'}></td>
        <td><input data-col="max_length" type="number" min="1" value="${column.max_length || ''}" ${editable ? '' : 'disabled'}></td>
        <td><input data-col="is_required" type="checkbox" ${Number(column.is_required) ? 'checked' : ''} ${editable ? '' : 'disabled'}></td>
        <td class="table-action-row">${editable ? `<button class="btn btn-ghost btn-small" data-move="up">↑</button><button class="btn btn-ghost btn-small" data-move="down">↓</button><button class="btn btn-danger btn-small" data-remove-column>削除</button>` : ''}</td>
      </tr>`).join('');
      this.ctx.app.innerHTML = this.kit.shell(`${this.version.profile_name} v${this.version.version_no}`, `<section class="panel bank-format-editor">
        ${message ? `<p class="flash">${this.ctx.escapeHtml(message)}</p>` : ''}
        <div class="section-title-row"><div><h2>ファイル設定</h2><p class="muted">${this.kit.statusBadge(this.version.status, STATUS_LABELS[this.version.status])}</p></div>${editable ? '<button class="btn btn-secondary" id="add-bank-column">＋ 列を追加</button>' : ''}</div>
        <div class="form-grid form-grid-compact">
          <div><label>文字コード</label><select id="bf-encoding" ${editable ? '' : 'disabled'}><option value="utf8" ${this.version.encoding_code === 'utf8' ? 'selected' : ''}>UTF-8</option><option value="utf8_bom" ${this.version.encoding_code === 'utf8_bom' ? 'selected' : ''}>UTF-8 BOM</option><option value="cp932" ${this.version.encoding_code === 'cp932' ? 'selected' : ''}>CP932</option></select></div>
          <div><label>区切り文字</label><input id="bf-delimiter" value="${this.ctx.escapeHtml(this.version.delimiter_text || ',')}" ${editable ? '' : 'disabled'}></div>
          <div><label>引用方式</label><select id="bf-quote-mode" ${editable ? '' : 'disabled'}>${['all','minimal','none'].map((v) => `<option value="${v}" ${v === this.version.quote_mode ? 'selected' : ''}>${v}</option>`).join('')}</select></div>
          <div><label>引用符</label><input id="bf-quote" maxlength="1" value="${this.ctx.escapeHtml(this.version.quote_char || '&quot;')}" ${editable ? '' : 'disabled'}></div>
          <div><label>改行</label><select id="bf-line-ending" ${editable ? '' : 'disabled'}><option value="crlf" ${this.version.line_ending === 'crlf' ? 'selected' : ''}>CRLF</option><option value="lf" ${this.version.line_ending === 'lf' ? 'selected' : ''}>LF</option></select></div>
          <div><label class="check-item"><input id="bf-header" type="checkbox" ${Number(this.version.include_header) ? 'checked' : ''} ${editable ? '' : 'disabled'}><span>ヘッダーを出力</span></label></div>
          <div class="full"><label>ファイル名規則</label><input id="bf-filename" value="${this.ctx.escapeHtml(this.version.file_name_pattern || '')}" ${editable ? '' : 'disabled'}><small>{bank} {YYYYMMDD} {YYYYMM} {MMDD} {cycle} {batchId}</small></div>
          <div class="full"><label>仕様書・取込試験の確認記録</label><textarea id="bf-note" rows="2" ${editable ? '' : 'disabled'}>${this.ctx.escapeHtml(this.version.verification_note || '')}</textarea></div>
        </div>
        <h3 class="section-title">列定義</h3>
        <div class="table-wrap bank-column-grid"><table class="data-table data-table-compact"><thead><tr><th>No</th><th>列キー</th><th>列名</th><th>参照項目</th><th>固定値</th><th>変換</th><th>書式</th><th>0埋め</th><th>最大長</th><th>必須</th><th>操作</th></tr></thead><tbody>${columnRows || '<tr><td colspan="11">列がありません</td></tr>'}</tbody></table></div>
        <div class="btn-row form-actions-sticky">${editable ? '<button class="btn" id="save-bank-format">下書きを保存</button><button class="btn btn-secondary" id="publish-bank-format">この版を公開</button>' : ''}<button class="btn btn-ghost" id="back-bank-formats">一覧へ</button></div>
      </section>`, { onBack:() => this.openProfiles(this.ctx, this.onBack) });
      this.kit.bindShell({ onBack:() => this.openProfiles(this.ctx, this.onBack) });
      document.getElementById('back-bank-formats').onclick = () => this.openProfiles(this.ctx, this.onBack);
      document.getElementById('add-bank-column')?.addEventListener('click', () => { this.collectColumns(); this.columns.push({ column_key:`column_${this.columns.length + 1}`, column_label:'', source_key:'blank', transform_code:'none', is_required:0 }); this.renderVersion(); });
      document.querySelectorAll('[data-remove-column]').forEach((button) => button.onclick = () => { this.collectColumns(); this.columns.splice(Number(button.closest('tr').dataset.columnIndex), 1); this.renderVersion(); });
      document.querySelectorAll('[data-move]').forEach((button) => button.onclick = () => { this.collectColumns(); const index=Number(button.closest('tr').dataset.columnIndex), next=button.dataset.move === 'up' ? index-1 : index+1; if(next<0||next>=this.columns.length)return; [this.columns[index],this.columns[next]]=[this.columns[next],this.columns[index]]; this.renderVersion(); });
      document.getElementById('save-bank-format')?.addEventListener('click', () => this.saveVersion(false));
      document.getElementById('publish-bank-format')?.addEventListener('click', () => this.saveVersion(true));
    },

    collectColumns() {
      this.columns = [...document.querySelectorAll('[data-column-index]')].map((row) => {
        const value = (name) => row.querySelector(`[data-col="${name}"]`);
        return { column_key:value('column_key').value.trim(), column_label:value('column_label').value.trim(), source_key:value('source_key').value, fixed_value:value('fixed_value').value, transform_code:value('transform_code').value, format_code:value('format_code').value || null, zero_pad_length:value('zero_pad_length').value || null, max_length:value('max_length').value || null, is_required:value('is_required').checked };
      });
    },

    versionPayload() {
      this.collectColumns();
      return { encoding_code:document.getElementById('bf-encoding').value, delimiter_text:document.getElementById('bf-delimiter').value, quote_mode:document.getElementById('bf-quote-mode').value, quote_char:document.getElementById('bf-quote').value, include_header:document.getElementById('bf-header').checked, line_ending:document.getElementById('bf-line-ending').value, file_name_pattern:document.getElementById('bf-filename').value.trim(), verification_note:document.getElementById('bf-note').value.trim(), columns:this.columns };
    },

    async saveVersion(publish) {
      const payload = this.versionPayload();
      const saved = await this.ctx.api(`${API}/versions/${this.version.bank_export_profile_version_id}`, { method:'PUT', body:JSON.stringify(payload) });
      if (!saved.res.ok) return window.alert(saved.data?.message || '保存できませんでした');
      if (publish) {
        if (!payload.verification_note) return window.alert('公開には仕様書または取込試験の確認記録が必要です');
        if (!window.confirm('現在の公開版を旧版にして、この下書き版をCSV出力に使用しますか？')) return this.openVersion(this.version.bank_export_profile_version_id, '下書きを保存しました');
        const result = await this.ctx.api(`${API}/versions/${this.version.bank_export_profile_version_id}/publish`, { method:'POST', body:JSON.stringify({ verification_note:payload.verification_note }) });
        if (!result.res.ok) return window.alert(result.data?.message || '公開できませんでした');
        return this.openProfiles(this.ctx, this.onBack, 'プロファイル版を公開しました');
      }
      return this.openVersion(this.version.bank_export_profile_version_id, '下書きを保存しました');
    },

    async openAccounts(ctx, onBack, message = '') {
      this.init(ctx, onBack);
      this.ctx.renderLoading();
      try { await this.catalog(); } catch (error) { window.alert(error.message); return onBack(); }
      const rows = (this.data.accounts || []).map((account) => `<tr><td>${this.ctx.escapeHtml(account.account_label)}</td><td>${this.ctx.escapeHtml(account.bank_name)} ${this.ctx.escapeHtml(account.branch_name)}</td><td>${this.ctx.escapeHtml(account.deposit_type)} ***${this.ctx.escapeHtml(String(account.account_number).slice(-4))}</td><td class="num">${this.kit.money(Number(account.opening_balance || 0))}</td><td>${this.ctx.escapeHtml(account.profile_name)}</td><td>${account.is_active ? '有効' : '無効'}</td><td class="table-action-row"><button class="btn btn-ghost btn-small" data-edit-account="${account.source_bank_account_id}">編集</button><button class="btn btn-danger btn-small" data-delete-account="${account.source_bank_account_id}">削除</button></td></tr>`).join('');
      this.ctx.app.innerHTML = this.kit.shell('振込元口座マスター', `<section class="panel">${message ? `<p class="flash">${this.ctx.escapeHtml(message)}</p>` : ''}<div class="section-title-row"><div><h2>自社の振込元口座</h2><p class="muted">銀行CSVの契約口座、委託者コード、期首預金残高を管理します。</p></div><div class="btn-row"><button type="button" class="btn btn-ghost" data-master-help="source-accounts">ヘルプ</button><button class="btn" id="add-source-account">＋ 口座を追加</button></div></div><div class="table-wrap"><table class="data-table data-table-compact"><thead><tr><th>表示名</th><th>銀行・支店</th><th>口座</th><th>期首残高</th><th>CSV形式</th><th>状態</th><th>操作</th></tr></thead><tbody>${rows || '<tr><td colspan="7">振込元口座がありません</td></tr>'}</tbody></table></div><div id="modal-host"></div></section>`, { onBack:this.onBack });
      this.kit.bindShell({ onBack:this.onBack });
      window.LinksMasterSettings.ctx = this.ctx;
      window.LinksMasterSettings.kit = this.kit;
      window.LinksMasterSettings.bindHelp();
      document.getElementById('add-source-account').onclick = () => this.accountModal(null);
      document.querySelectorAll('[data-edit-account]').forEach((button) => button.onclick = () => this.accountModal(this.data.accounts.find((row) => Number(row.source_bank_account_id) === Number(button.dataset.editAccount))));
      document.querySelectorAll('[data-delete-account]').forEach((button) => button.onclick = async () => { if(!window.confirm('この振込元口座を削除しますか？'))return; const result=await this.ctx.api(`${API}/accounts/${button.dataset.deleteAccount}`,{method:'DELETE'}); if(!result.res.ok)return window.alert(result.data?.message||'削除できませんでした'); this.openAccounts(this.ctx,this.onBack,'削除しました'); });
    },

    accountModal(account) {
      const profiles = (this.data.profiles || []).map((profile) => `<option value="${profile.bank_export_profile_id}" ${Number(account?.bank_export_profile_id) === Number(profile.bank_export_profile_id) ? 'selected' : ''}>${this.ctx.escapeHtml(profile.profile_name)}</option>`).join('');
      document.getElementById('modal-host').innerHTML = this.kit.modalHtml(account ? '振込元口座編集' : '振込元口座追加', `<div class="form-grid">
        <div class="full"><label>表示名</label><input id="sa-label" value="${this.ctx.escapeHtml(account?.account_label || '')}"></div><div><label>CSVプロファイル</label><select id="sa-profile">${profiles}</select></div><div><label>銀行コード</label><input id="sa-bank-code" maxlength="4" inputmode="numeric" value="${this.ctx.escapeHtml(account?.bank_code || '')}"></div><div><label>銀行名</label><input id="sa-bank-name" value="${this.ctx.escapeHtml(account?.bank_name || '')}"></div><div><label>支店コード</label><input id="sa-branch-code" maxlength="3" inputmode="numeric" value="${this.ctx.escapeHtml(account?.branch_code || '')}"></div><div><label>支店名</label><input id="sa-branch-name" value="${this.ctx.escapeHtml(account?.branch_name || '')}"></div><div><label>口座種別</label><input id="sa-type" value="${this.ctx.escapeHtml(account?.deposit_type || 'ordinary')}"></div><div><label>口座番号</label><input id="sa-number" inputmode="numeric" value="${this.ctx.escapeHtml(account?.account_number || '')}"></div><div><label>口座名義カナ</label><input id="sa-name" value="${this.ctx.escapeHtml(account?.account_name_kana || '')}"></div><div><label>委託者コード</label><input id="sa-client" value="${this.ctx.escapeHtml(account?.client_code || '')}"></div><div><label>期首預金残高</label><input id="sa-opening" type="number" step="1" value="${this.ctx.escapeHtml(String(account?.opening_balance ?? 0))}"></div><div class="full"><label class="check-item"><input id="sa-active" type="checkbox" ${account?.is_active !== 0 ? 'checked' : ''}><span>有効</span></label></div>
      </div>`, '<button class="btn" id="sa-save">保存</button>', 'modal-wide');
      this.kit.bindModal();
      document.getElementById('sa-save').onclick = async () => {
        const get = (id) => document.getElementById(id).value.trim();
        const payload = { account_label:get('sa-label'), bank_export_profile_id:Number(get('sa-profile')), bank_code:get('sa-bank-code'), bank_name:get('sa-bank-name'), branch_code:get('sa-branch-code'), branch_name:get('sa-branch-name'), deposit_type:get('sa-type'), account_number:get('sa-number'), account_name_kana:get('sa-name'), client_code:get('sa-client'), opening_balance:Number(get('sa-opening') || 0), is_active:document.getElementById('sa-active').checked, version:Number(account?.version || 0) };
        const result = await this.ctx.api(account ? `${API}/accounts/${account.source_bank_account_id}` : `${API}/accounts`, { method:account ? 'PUT' : 'POST', body:JSON.stringify(payload) });
        if (!result.res.ok) return window.alert(result.data?.message || '保存できませんでした');
        document.getElementById('modal-backdrop')?.remove(); this.openAccounts(this.ctx, this.onBack, account ? '更新しました' : '追加しました');
      };
    },
  };

  window.LinksBankExportMaster = BankExportMaster;
})();
