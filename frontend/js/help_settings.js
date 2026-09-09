(() => {
  const LinksHelpSettings = {
    async open(ctx) {
      this.ctx = ctx;
      this.kit = window.LinksFeatureKit.createFeatureKit(ctx);
      await this.load();
    },
    async load(message = '') {
      this.ctx.renderLoading();
      const { res, data } = await this.ctx.api('/api/help');
      if (!res.ok || !data?.ok) {
        this.ctx.app.innerHTML = this.kit.shell('ヘルプ編集設定', `<section class="panel"><p class="error">${this.ctx.escapeHtml(data?.message || '取得失敗')}</p></section>`);
        this.kit.bindShell();
        return;
      }
      this.rows = data.help_contents || [];
      const rows = this.rows.map((row) => `<tr data-help-row="${this.ctx.escapeHtml(row.screen_key)}">
        <td>${this.ctx.escapeHtml(row.screen_key)}</td><td>${this.ctx.escapeHtml(row.help_title)}</td>
        <td>${this.ctx.escapeHtml(row.overview_text || '-')}</td><td><button class="btn btn-ghost btn-small" data-edit-help="${this.ctx.escapeHtml(row.screen_key)}">編集</button></td>
      </tr>`).join('');
      this.ctx.app.innerHTML = this.kit.shell('ヘルプ編集設定', `<section class="panel"><p class="muted">各機能のヘッダーにある「ヘルプ」で表示する説明を編集します。</p>${message ? `<p class="flash">${this.ctx.escapeHtml(message)}</p>` : ''}<div class="table-wrap"><table class="data-table data-table-compact"><thead><tr><th>画面キー</th><th>タイトル</th><th>概要</th><th>操作</th></tr></thead><tbody>${rows}</tbody></table></div><div id="modal-host"></div></section>`);
      this.kit.bindShell();
      document.querySelectorAll('[data-edit-help]').forEach((button) => button.addEventListener('click', () => this.edit(button.dataset.editHelp)));
    },
    edit(key) {
      const row = this.rows.find((item) => item.screen_key === key);
      if (!row) return;
      document.getElementById('modal-host').innerHTML = this.kit.modalHtml('ヘルプ内容の編集', `<form id="help-edit-form" class="form-grid"><div class="full"><label>タイトル</label><input name="help_title" required value="${this.ctx.escapeHtml(row.help_title)}"></div><div class="full"><label>画面の概要</label><textarea name="overview_text" rows="5">${this.ctx.escapeHtml(row.overview_text || '')}</textarea></div><div class="full"><label>何を入力するとどうなるか・操作説明</label><textarea name="input_effect_text" rows="9">${this.ctx.escapeHtml(row.input_effect_text || '')}</textarea></div></form>`, '<button class="btn" id="save-help">保存</button>', 'modal-wide');
      const close = this.kit.bindModal();
      document.getElementById('save-help').addEventListener('click', async () => {
        const form = document.getElementById('help-edit-form');
        if (!form.reportValidity()) return;
        const values = Object.fromEntries(new FormData(form));
        const result = await this.ctx.api(`/api/help/${encodeURIComponent(key)}`, { method:'PUT', body:JSON.stringify(values) });
        if (!result.res.ok) return window.alert(result.data?.message || '保存に失敗しました');
        close();
        await this.load('ヘルプを更新しました');
      });
    },
  };
  window.LinksHelpSettings = LinksHelpSettings;
})();
