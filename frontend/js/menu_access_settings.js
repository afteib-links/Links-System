(() => {
  window.LinksMenuAccessSettings = {
    async open(ctx) {
      this.ctx = ctx;
      await this.load();
    },
    async load(message = '') {
      const { res, data } = await this.ctx.api('/api/menu-access');
      if (!res.ok || !data?.ok) return this.renderError(data?.message || 'メニュー権限を取得できませんでした');
      this.state = data;
      this.render(message);
    },
    renderError(message) {
      this.ctx.app.innerHTML = `<div class="app-shell">${this.ctx.sidebarHtml('menu_access_settings')}<div class="app-frame">${this.ctx.headerHtml('利用可能メニュー選択')}<main class="app-main"><section class="panel"><p role="alert">${this.ctx.escapeHtml(message)}</p></section></main></div></div>`;
      this.ctx.bindChrome();
    },
    render(message = '') {
      const e = this.ctx.escapeHtml;
      const state = this.state;
      const groups = ['master','daily','billing','analysis','settings','system'];
      const labels = { master:'マスタ',daily:'日々の運用',billing:'精算',analysis:'分析',settings:'設定',system:'システム専用' };
      const rows = groups.flatMap(group => [
        `<tr class="menu-access-group"><th colspan="${state.roles.length + 1}">${e(labels[group])}</th></tr>`,
        ...state.features.filter(f => f.group === group).map(feature => `<tr><th scope="row">${e(feature.label)}</th>${state.roles.map(role => `<td><label class="check-item"><input type="checkbox" data-menu-key="${e(feature.key)}" data-role-key="${e(role.key)}" aria-label="${e(feature.label)} ${e(role.label)}" ${state.roles_by_feature[feature.key]?.includes(role.key) ? 'checked' : ''}></label></td>`).join('')}</tr>`)
      ]).join('');
      this.ctx.app.innerHTML = `<div class="app-shell">${this.ctx.sidebarHtml('menu_access_settings')}<div class="app-frame">${this.ctx.headerHtml('利用可能メニュー選択')}<main class="app-main"><section class="panel"><p>役割ごとに利用可能なメニューを選択します。承認・取消などの操作別制限は別途維持されます。</p><p>検証用データの生成は、チェックを付けても検証専用環境・DB以外では利用できません。</p>${message ? `<p class="flash" role="status">${e(message)}</p>` : ''}<div class="table-wrap"><table class="data-table"><thead><tr><th scope="col">メニュー</th>${state.roles.map(role => `<th scope="col">${e(role.label)}</th>`).join('')}</tr></thead><tbody>${rows}</tbody></table></div><div class="btn-row"><button type="button" class="btn" id="menu-access-save">保存する</button><button type="button" class="btn btn-secondary" id="menu-access-reload">再読込</button></div></section></main></div></div>`;
      this.ctx.bindChrome();
      document.getElementById('menu-access-reload').onclick = () => this.load();
      document.getElementById('menu-access-save').onclick = () => this.save();
    },
    async save() {
      const rolesByFeature = Object.fromEntries(this.state.features.map(feature => [feature.key, [...document.querySelectorAll(`[data-menu-key="${feature.key}"]:checked`)].map(input => input.dataset.roleKey)]));
      const { res, data } = await this.ctx.api('/api/menu-access', { method:'PUT', body:JSON.stringify({ revision:this.state.revision, roles_by_feature:rolesByFeature }) });
      if (!res.ok || !data?.ok) return this.render(data?.message || '保存に失敗しました');
      this.state.revision = data.revision;
      this.state.roles_by_feature = data.roles_by_feature;
      const me = await this.ctx.api('/api/auth/me');
      if (me.res.ok && me.data?.ok) this.ctx.currentUser.permissions = me.data.user.permissions;
      this.render('保存しました。変更は各利用者の次の操作から反映されます。');
    },
  };
})();
