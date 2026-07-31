(() => {
  const CODE_CATEGORIES = [
    { key: 'price_type', label: '料金種別' },
    { key: 'overtime_calc', label: '残業計算区分' },
    { key: 'price_calc_type', label: '料金計算区分' },
  ];

  const LinksMasterSettings = {
    async open(ctx) {
      this.kit = window.LinksFeatureKit.createFeatureKit(ctx);
      this.ctx = ctx;
      await this.showHub();
    },

    async showHub() {
      this.ctx.renderLoading();
      const { res, data } = await this.ctx.api('/api/master-settings/hub');
      const hub = data?.hub || {};
      this.ctx.app.innerHTML = this.kit.shell(
        'マスター設定（仮組）',
        `<section class="panel">
          <p class="muted">共通小口マスタへの入口です。</p>
          <div class="hub-grid">
            <button type="button" class="hub-card" data-hub="staff">
              <strong>営業担当者マスタ</strong>
              <span>${this.ctx.escapeHtml(hub.staff_masters ?? 0)} 件</span>
            </button>
            <button type="button" class="hub-card" data-hub="codes">
              <strong>区分マスタ</strong>
              <span>${this.ctx.escapeHtml(hub.code_masters ?? 0)} 件</span>
            </button>
            <button type="button" class="hub-card" data-hub="settings">
              <strong>システム設定</strong>
              <span>${this.ctx.escapeHtml(hub.system_settings ?? 0)} 件</span>
            </button>
          </div>
        </section>`
      );
      this.kit.bindShell();
      document.querySelectorAll('[data-hub]').forEach((btn) => {
        btn.addEventListener('click', () => {
          const key = btn.getAttribute('data-hub');
          this.kit.pushNav(() => this.showHub());
          if (key === 'staff') this.showStaff();
          else if (key === 'codes') this.showCodes();
          else this.showSettings();
        });
      });
    },

    async showStaff(message = '') {
      this.ctx.renderLoading();
      const { res, data } = await this.ctx.api('/api/master-settings/staff');
      if (!res.ok || !data?.ok) {
        this.ctx.app.innerHTML = this.kit.shell(
          '営業担当者マスタ',
          `<section class="panel"><p class="error">${this.ctx.escapeHtml(data?.message || '取得失敗')}</p></section>`,
          { onBack: () => this.showHub() }
        );
        this.kit.bindShell({ onBack: () => this.showHub() });
        return;
      }
      const rows = (data.staff || [])
        .map(
          (s) => `
          <tr>
            <td>${this.ctx.escapeHtml(s.staff_master_id)}</td>
            <td>${this.ctx.escapeHtml(s.staff_name)}</td>
            <td>${this.ctx.escapeHtml(s.staff_name_kana || '-')}</td>
            <td>${this.ctx.escapeHtml(s.role_label || '-')}</td>
            <td>${s.is_active ? '有効' : '無効'}</td>
            <td>
              <button type="button" class="btn btn-ghost btn-small" data-edit="${s.staff_master_id}">編集</button>
              <button type="button" class="btn btn-danger btn-small" data-del="${s.staff_master_id}">削除</button>
            </td>
          </tr>`
        )
        .join('');
      this._staff = data.staff || [];
      this.ctx.app.innerHTML = this.kit.shell(
        '営業担当者マスタ',
        `<section class="panel">
          ${message ? `<p class="flash">${this.ctx.escapeHtml(message)}</p>` : ''}
          <div class="toolbar"><button type="button" class="btn" id="new-staff">＋ 追加</button></div>
          <div class="table-wrap">
            <table class="data-table data-table-compact">
              <thead><tr><th>No</th><th>氏名</th><th>カナ</th><th>役割</th><th>状態</th><th>操作</th></tr></thead>
              <tbody>${rows || '<tr><td colspan="6">なし</td></tr>'}</tbody>
            </table>
          </div>
          <div id="modal-host"></div>
        </section>`,
        { onBack: () => this.showHub() }
      );
      this.kit.bindShell({ onBack: () => this.showHub() });
      document.getElementById('new-staff')?.addEventListener('click', () => this.openStaffModal(null));
      document.querySelectorAll('[data-edit]').forEach((btn) =>
        btn.addEventListener('click', () => {
          const row = this._staff.find((s) => Number(s.staff_master_id) === Number(btn.getAttribute('data-edit')));
          this.openStaffModal(row);
        })
      );
      document.querySelectorAll('[data-del]').forEach((btn) =>
        btn.addEventListener('click', async () => {
          if (!window.confirm('削除しますか？')) return;
          await this.ctx.api(`/api/master-settings/staff/${btn.getAttribute('data-del')}`, { method: 'DELETE' });
          await this.showStaff('削除しました');
        })
      );
    },

    openStaffModal(row) {
      const isNew = !row;
      document.getElementById('modal-host').innerHTML = this.kit.modalHtml(
        isNew ? '担当者追加' : '担当者編集',
        `<div class="form-grid">
          <div><label>氏名</label><input id="m_name" value="${this.ctx.escapeHtml(row?.staff_name || '')}" /></div>
          <div><label>カナ</label><input id="m_kana" value="${this.ctx.escapeHtml(row?.staff_name_kana || '')}" /></div>
          <div><label>役割</label><input id="m_role" value="${this.ctx.escapeHtml(row?.role_label || '')}" /></div>
          <div><label>並び順</label><input type="number" id="m_sort" value="${this.ctx.escapeHtml(row?.sort_order ?? 0)}" /></div>
          <div class="full"><label class="check-item"><input type="checkbox" id="m_active" ${row?.is_active !== 0 ? 'checked' : ''} /><span>有効</span></label></div>
        </div>`,
        `<button type="button" class="btn" id="modal-save">保存</button>`
      );
      this.kit.bindModal();
      document.getElementById('modal-save')?.addEventListener('click', async () => {
        const payload = {
          staff_name: document.getElementById('m_name').value.trim(),
          staff_name_kana: document.getElementById('m_kana').value,
          role_label: document.getElementById('m_role').value,
          sort_order: Number(document.getElementById('m_sort').value || 0),
          is_active: document.getElementById('m_active').checked,
        };
        if (!payload.staff_name) {
          window.alert('氏名は必須です');
          return;
        }
        const result = isNew
          ? await this.ctx.api('/api/master-settings/staff', { method: 'POST', body: JSON.stringify(payload) })
          : await this.ctx.api(`/api/master-settings/staff/${row.staff_master_id}`, {
              method: 'PUT',
              body: JSON.stringify(payload),
            });
        if (!result.res.ok) {
          window.alert(result.data?.message || '保存失敗');
          return;
        }
        document.getElementById('modal-backdrop')?.remove();
        await this.showStaff(isNew ? '追加しました' : '更新しました');
      });
    },

    async showCodes() {
      this.ctx.renderLoading();
      this.codeCategory = this.codeCategory || 'price_type';
      const { res, data } = await this.ctx.api(`/api/master-settings/codes/${this.codeCategory}`);
      const rows = (data?.codes || [])
        .map(
          (c) => `
          <tr>
            <td>${this.ctx.escapeHtml(c.code_value)}</td>
            <td><input data-id="${c.code_master_id}" data-f="code_label" value="${this.ctx.escapeHtml(c.code_label)}" /></td>
            <td><input type="number" data-id="${c.code_master_id}" data-f="sort_order" value="${this.ctx.escapeHtml(c.sort_order ?? 0)}" style="width:5rem" /></td>
            <td><label class="check-item"><input type="checkbox" data-id="${c.code_master_id}" data-f="is_active" ${c.is_active ? 'checked' : ''} /><span>有効</span></label></td>
            <td><button type="button" class="btn btn-ghost btn-small" data-save-code="${c.code_master_id}">保存</button></td>
          </tr>`
        )
        .join('');
      this.ctx.app.innerHTML = this.kit.shell(
        '区分マスタ',
        `<section class="panel">
          <div class="toolbar">
            ${CODE_CATEGORIES.map(
              (c) =>
                `<button type="button" class="btn ${this.codeCategory === c.key ? '' : 'btn-ghost'} btn-small" data-cat="${c.key}">${this.ctx.escapeHtml(c.label)}</button>`
            ).join('')}
          </div>
          <div class="toolbar">
            <input id="new-value" placeholder="値" />
            <input id="new-label" placeholder="表示名" />
            <button type="button" class="btn" id="add-code">＋ 追加</button>
          </div>
          <div class="table-wrap">
            <table class="data-table data-table-compact">
              <thead><tr><th>値</th><th>表示名</th><th>並び</th><th>状態</th><th></th></tr></thead>
              <tbody>${rows || '<tr><td colspan="5">なし</td></tr>'}</tbody>
            </table>
          </div>
        </section>`,
        { onBack: () => this.showHub() }
      );
      this.kit.bindShell({ onBack: () => this.showHub() });
      document.querySelectorAll('[data-cat]').forEach((btn) =>
        btn.addEventListener('click', () => {
          this.codeCategory = btn.getAttribute('data-cat');
          this.showCodes();
        })
      );
      document.getElementById('add-code')?.addEventListener('click', async () => {
        const result = await this.ctx.api('/api/master-settings/codes', {
          method: 'POST',
          body: JSON.stringify({
            category_code: this.codeCategory,
            code_value: document.getElementById('new-value').value.trim(),
            code_label: document.getElementById('new-label').value.trim(),
          }),
        });
        if (!result.res.ok) {
          window.alert(result.data?.message || '追加失敗');
          return;
        }
        await this.showCodes();
      });
      document.querySelectorAll('[data-save-code]').forEach((btn) =>
        btn.addEventListener('click', async () => {
          const id = btn.getAttribute('data-save-code');
          const label = document.querySelector(`[data-id="${id}"][data-f="code_label"]`)?.value;
          const sort = document.querySelector(`[data-id="${id}"][data-f="sort_order"]`)?.value;
          const active = document.querySelector(`[data-id="${id}"][data-f="is_active"]`)?.checked;
          const result = await this.ctx.api(`/api/master-settings/codes/${id}`, {
            method: 'PUT',
            body: JSON.stringify({ code_label: label, sort_order: Number(sort || 0), is_active: active }),
          });
          if (!result.res.ok) window.alert(result.data?.message || '保存失敗');
          else this.ctx.showToast('保存しました');
        })
      );
    },

    async showSettings() {
      this.ctx.renderLoading();
      const { res, data } = await this.ctx.api('/api/master-settings/settings');
      const rows = (data?.settings || [])
        .map(
          (s) => `
          <tr>
            <td>${this.ctx.escapeHtml(s.setting_key)}</td>
            <td>${this.ctx.escapeHtml(s.setting_label || '-')}</td>
            <td><input data-key="${this.ctx.escapeHtml(s.setting_key)}" value="${this.ctx.escapeHtml(s.setting_value || '')}" /></td>
            <td><button type="button" class="btn btn-ghost btn-small" data-save-setting="${this.ctx.escapeHtml(s.setting_key)}">保存</button></td>
          </tr>`
        )
        .join('');
      this.ctx.app.innerHTML = this.kit.shell(
        'システム設定',
        `<section class="panel">
          <div class="toolbar">
            <input id="new-key" placeholder="キー" />
            <input id="new-label" placeholder="ラベル" />
            <input id="new-value" placeholder="値" />
            <button type="button" class="btn" id="add-setting">＋ 追加</button>
          </div>
          <div class="table-wrap">
            <table class="data-table data-table-compact">
              <thead><tr><th>キー</th><th>ラベル</th><th>値</th><th></th></tr></thead>
              <tbody>${rows || '<tr><td colspan="4">なし</td></tr>'}</tbody>
            </table>
          </div>
        </section>`,
        { onBack: () => this.showHub() }
      );
      this.kit.bindShell({ onBack: () => this.showHub() });
      document.getElementById('add-setting')?.addEventListener('click', async () => {
        const key = document.getElementById('new-key').value.trim();
        if (!key) return;
        await this.ctx.api(`/api/master-settings/settings/${encodeURIComponent(key)}`, {
          method: 'PUT',
          body: JSON.stringify({
            setting_value: document.getElementById('new-value').value,
            setting_label: document.getElementById('new-label').value,
          }),
        });
        await this.showSettings();
      });
      document.querySelectorAll('[data-save-setting]').forEach((btn) =>
        btn.addEventListener('click', async () => {
          const key = btn.getAttribute('data-save-setting');
          const value = document.querySelector(`input[data-key="${key}"]`)?.value;
          const result = await this.ctx.api(`/api/master-settings/settings/${encodeURIComponent(key)}`, {
            method: 'PUT',
            body: JSON.stringify({ setting_value: value }),
          });
          if (!result.res.ok) window.alert(result.data?.message || '保存失敗');
          else this.ctx.showToast('保存しました');
        })
      );
    },
  };

  window.LinksMasterSettings = LinksMasterSettings;
})();
