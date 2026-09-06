(() => {
  const LinksPartners = {
    async open(ctx) {
      this.kit = window.LinksFeatureKit.createFeatureKit(ctx);
      this.ctx = ctx;
      this.listState = { q: '', partner_category_code: '', employment_type_code: '', sortKey: 'partner_id', sortOrder: 'asc', filters: {} };
      this.codes = await this.kit.loadCodes();
      const fees = await this.ctx.api('/api/lookups/transfer-fees');
      this.transferFees = (fees.data?.transfer_fees || []).filter((row) => row.is_active);
      const saved = await this.kit.loadLayout('partners');
      this.layout = saved?.columns_json || null;
      await this.showList();
    },

    insuranceBadge(codes, value, label) {
      if (!value) return '';
      const text = this.kit.codeLabel(codes, value);
      if (!text || text === '-') return '';
      return `${label}:${text}`;
    },

    listColumns() {
      return [
        { key: 'partner_id', label: 'No' },
        { key: 'partner_name', label: '名称' },
        {
          key: 'bank',
          label: '銀行',
          getValue: (p) => [p.bank_name, p.branch_name].filter(Boolean).join(' ') || '-',
        },
        {
          key: 'work_start_date',
          label: '稼働開始',
          getValue: (p) => this.kit.dateValue(p.work_start_date) || '-',
        },
        { key: 'continuity_years', label: '継続年数' },
        {
          key: 'license_expiry',
          label: '免許期限',
          getValue: (p) => this.kit.dateValue(p.license_expiry_date) || '-',
        },
        {
          key: 'insurance_badges',
          label: '保険',
          getValue: (p) =>
            [
              this.insuranceBadge(this.codes.accident_insurance, p.accident_insurance_code, '傷害'),
              this.insuranceBadge(this.codes.contractor_liability, p.contractor_liability_code, '請負'),
              this.insuranceBadge(this.codes.cargo_insurance, p.cargo_insurance_code, '貨物'),
              this.insuranceBadge(this.codes.g_association, p.g_association_code, 'G会'),
            ]
              .filter(Boolean)
              .join(' / ') || '-',
        },
        { key: 'project_count', label: '案件数' },
      ];
    },

    async showList(message = '') {
      this.ctx.renderLoading();
      const params = new URLSearchParams({
        q: this.listState.q || '',
        partner_category_code: this.listState.partner_category_code || '',
        employment_type_code: this.listState.employment_type_code || '',
      });
      const { res, data } = await this.ctx.api(`/api/partners?${params}`);
      if (!res.ok || !data?.ok) {
        this.ctx.app.innerHTML = this.kit.shell(
          'パートナーマスタ',
          `<section class="panel"><p class="error">${this.ctx.escapeHtml(data?.message || '取得失敗')}</p></section>`
        );
        this.kit.bindShell();
        return;
      }
      this.rows = data.partners || [];
      const table = window.LinksDataTable.renderTable({
        screenKey: 'partners',
        columns: this.listColumns(),
        rows: this.rows,
        layout: this.layout,
        sortKey: this.listState.sortKey,
        sortOrder: this.listState.sortOrder,
        filters: this.listState.filters,
        escapeHtml: this.ctx.escapeHtml,
        renderActions: (p) => `
          <span class="desktop-row-actions">
            <button type="button" class="btn btn-ghost btn-small" data-edit="${p.partner_id}">編集</button>
            <button type="button" class="btn btn-ghost btn-small" data-projects="${p.partner_id}">案件一覧</button>
            <button type="button" class="btn btn-danger btn-small" data-del="${p.partner_id}">削除</button>
          </span>
          <button type="button" class="btn btn-ghost btn-small mobile-row-action" data-partner-actions="${p.partner_id}" aria-label="${this.ctx.escapeHtml(p.partner_name || `パートナーNo ${p.partner_id}`)}の操作">操作</button>`,
        rowKey: 'partner_id',
      });

      this.ctx.app.innerHTML = this.kit.shell(
        'パートナーマスタ（仮組）',
        `<section class="panel" id="partners-list-root">
          ${message ? `<p class="flash">${this.ctx.escapeHtml(message)}</p>` : ''}
          <div class="toolbar">
            <input id="q" type="text" placeholder="名称・電話で検索" value="${this.ctx.escapeHtml(this.listState.q)}" />
            <select id="cat">${this.kit.codeOptions(this.codes.partner_category, this.listState.partner_category_code)}</select>
            <select id="emp">${this.kit.codeOptions(this.codes.employment_type, this.listState.employment_type_code)}</select>
            <button type="button" class="btn" id="search">検索</button>
            <button type="button" class="btn" id="new">＋ 新規</button>
          </div>
          ${table.html}
          <div id="modal-host"></div>
        </section>`
      );
      this.kit.bindShell();
      window.LinksDataTable.bindTable('#partners-list-root', {
        onSort: (key) => {
          if (this.listState.sortKey === key) {
            this.listState.sortOrder = this.listState.sortOrder === 'asc' ? 'desc' : 'asc';
          } else {
            this.listState.sortKey = key;
            this.listState.sortOrder = 'asc';
          }
          this.showList(message);
        },
        onFilter: (filters) => {
          this.listState.filters = filters;
          this.showList(message);
        },
        onActivate: (key) => {
          this.kit.pushNav(() => this.showList());
          this.showDetail(Number(key));
        },
      });
      document.getElementById('search')?.addEventListener('click', () => {
        this.listState.q = document.getElementById('q').value.trim();
        this.listState.partner_category_code = document.getElementById('cat').value;
        this.listState.employment_type_code = document.getElementById('emp').value;
        this.showList();
      });
      document.getElementById('new')?.addEventListener('click', () => {
        this.kit.pushNav(() => this.showList());
        this.showDetail(null);
      });
      document.querySelectorAll('[data-edit]').forEach((btn) =>
        btn.addEventListener('click', () => {
          this.kit.pushNav(() => this.showList());
          this.showDetail(Number(btn.getAttribute('data-edit')));
        })
      );
      document.querySelectorAll('[data-projects]').forEach((btn) =>
        btn.addEventListener('click', () => {
          this.ctx.openFeature?.('projects', { partner_id: Number(btn.getAttribute('data-projects')), tab: 'projects' });
        })
      );
      document.querySelectorAll('[data-del]').forEach((btn) =>
        btn.addEventListener('click', async () => {
          if (!window.confirm('削除しますか？')) return;
          const result = await this.ctx.api(`/api/partners/${btn.getAttribute('data-del')}`, { method: 'DELETE' });
          if (!result.res.ok) {
            window.alert(result.data?.message || '削除失敗');
            return;
          }
          await this.showList('削除しました');
        })
      );
      document.querySelectorAll('[data-partner-actions]').forEach((btn) => {
        btn.addEventListener('click', () => this.openListActions(Number(btn.getAttribute('data-partner-actions'))));
      });
    },

    openListActions(id) {
      const partner = this.rows.find((row) => Number(row.partner_id) === Number(id));
      const host = document.getElementById('modal-host');
      if (!partner || !host) return;
      host.innerHTML = this.kit.modalHtml(
        `${partner.partner_name || `パートナーNo ${id}`}の操作`,
        `<div class="mobile-action-list">
          <button type="button" class="btn btn-ghost" data-run-partner-action="edit">編集</button>
          <button type="button" class="btn btn-ghost" data-run-partner-action="projects">案件一覧</button>
          <button type="button" class="btn btn-danger" data-run-partner-action="del">削除</button>
        </div>`
      );
      const close = this.kit.bindModal();
      document.querySelectorAll('[data-run-partner-action]').forEach((button) => {
        button.addEventListener('click', () => {
          const action = button.getAttribute('data-run-partner-action');
          close();
          document.querySelector(`.desktop-row-actions [data-${action}="${id}"]`)?.click();
        });
      });
    },

    emptyVehicle() {
      return {
        vehicle_id: null,
        vehicle_name: '',
        vehicle_number: '',
        inspection_expiry_date: '',
        insurance_expiry_date: '',
      };
    },

    vehiclesTableHtml() {
      const rows = this.detailState.vehicles
        .map(
          (v, idx) => `
          <tr>
            <td>${this.ctx.escapeHtml(v.vehicle_name || '-')}</td>
            <td>${this.ctx.escapeHtml(v.vehicle_number || '-')}</td>
            <td>${this.ctx.escapeHtml(this.kit.dateValue(v.inspection_expiry_date) || '-')}</td>
            <td>${this.ctx.escapeHtml(this.kit.dateValue(v.insurance_expiry_date) || '-')}</td>
            <td>
              <button type="button" class="btn btn-ghost btn-small" data-edit-vehicle="${idx}">編集</button>
              <button type="button" class="btn btn-danger btn-small" data-del-vehicle="${idx}">削除</button>
            </td>
          </tr>`
        )
        .join('');
      return `<table class="data-table data-table-compact"><thead><tr><th>名称</th><th>番号</th><th>車検期限</th><th>保険期限</th><th>操作</th></tr></thead>
        <tbody>${rows || '<tr><td colspan="5">車両なし</td></tr>'}</tbody></table>`;
    },

    async showDetail(id) {
      this.ctx.renderLoading();
      let partner = {
        partner_id: null,
        version: 1,
        partner_name: '',
        partner_name_kana: '',
        zip_code: '',
        address: '',
        contact_phone: '',
        blood_type: '',
        birth_date: '',
        work_start_date: '',
        contract_date: '',
        partner_category_code: '',
        employment_type_code: '',
        invoice_number: '',
        advance_payment_enabled: 0,
        license_expiry_date: '',
        license_types: '',
        safety_conference_history: '',
        accident_insurance_code: '',
        contractor_liability_code: '',
        cargo_insurance_code: '',
        g_association_code: '',
        tax_return_code: '',
        loop_code: '',
        payment_output_code: '',
        bank_name: '',
        bank_code: '',
        branch_name: '',
        branch_code: '',
        account_number: '',
        deposit_type: '',
        account_name: '',
        account_name_kana: '',
        vehicles: [],
      };
      if (id) {
        const { res, data } = await this.ctx.api(`/api/partners/${id}`);
        if (!res.ok || !data?.ok) {
          this.ctx.app.innerHTML = this.kit.shell(
            'パートナー詳細',
            `<section class="panel"><p class="error">${this.ctx.escapeHtml(data?.message || '取得失敗')}</p></section>`,
            { onBack: () => this.showList() }
          );
          this.kit.bindShell({ onBack: () => this.showList() });
          return;
        }
        partner = data.partner;
      }
      this.detailState = {
        partnerId: partner.partner_id,
        version: partner.version || 1,
        vehicles: (partner.vehicles || []).map((v) => ({ ...v })),
      };

      this.ctx.app.innerHTML = this.kit.shell(
        id ? `パートナー編集（No.${id}）` : '新規パートナー',
        `<section class="panel">
          <p class="error" id="form-error"></p>
          <form id="partner-form">
            <div class="form-sections">
            <section class="form-section-card"><h3>基本・契約情報</h3>
            <div class="form-grid form-grid-compact">
              <div><label>名称（必須）</label><input name="partner_name" required value="${this.ctx.escapeHtml(partner.partner_name || '')}" /></div>
              <div><label>カナ</label><input name="partner_name_kana" value="${this.ctx.escapeHtml(partner.partner_name_kana || '')}" /></div>
              <div><label>振込手数料</label><select name="transfer_fee_pattern_id"><option value="">未設定（￥0）</option>${this.transferFees.map((fee) => `<option value="${fee.transfer_fee_pattern_id}" ${Number(partner.transfer_fee_pattern_id) === Number(fee.transfer_fee_pattern_id) ? 'selected' : ''}>${this.ctx.escapeHtml(fee.pattern_name)}（${this.kit.money(fee.amount)}）</option>`).join('')}</select></div>
              <div><label>郵便番号</label><input name="zip_code" value="${this.ctx.escapeHtml(partner.zip_code || '')}" /></div>
              <div class="full"><label>住所</label><input name="address" value="${this.ctx.escapeHtml(partner.address || '')}" /></div>
              <div><label>電話</label><input name="contact_phone" value="${this.ctx.escapeHtml(partner.contact_phone || '')}" /></div>
              <div><label>血液型</label><input name="blood_type" value="${this.ctx.escapeHtml(partner.blood_type || '')}" /></div>
              <div><label>生年月日</label><input type="date" name="birth_date" value="${this.ctx.escapeHtml(this.kit.dateValue(partner.birth_date))}" /></div>
              <div><label>稼働開始日</label><input type="date" name="work_start_date" value="${this.ctx.escapeHtml(this.kit.dateValue(partner.work_start_date))}" /></div>
              <div><label>契約日</label><input type="date" name="contract_date" value="${this.ctx.escapeHtml(this.kit.dateValue(partner.contract_date))}" /></div>
              <div><label>区分</label><select name="partner_category_code">${this.kit.codeOptions(this.codes.partner_category, partner.partner_category_code)}</select></div>
              <div><label>雇用区分</label><select name="employment_type_code">${this.kit.codeOptions(this.codes.employment_type, partner.employment_type_code)}</select></div>
              <div><label>インボイス番号</label><input name="invoice_number" value="${this.ctx.escapeHtml(partner.invoice_number || '')}" /></div>
              <div class="full"><label class="check-item"><input type="checkbox" name="advance_payment_enabled" ${partner.advance_payment_enabled ? 'checked' : ''} /><span>先払い対象</span></label></div>
            </div></section>
            <section class="form-section-card"><h3>免許・安全管理</h3><div class="form-grid form-grid-compact">
              <div><label>免許期限</label><input type="date" name="license_expiry_date" value="${this.ctx.escapeHtml(this.kit.dateValue(partner.license_expiry_date))}" /></div>
              <div class="full"><label>免許種類</label><input name="license_types" value="${this.ctx.escapeHtml(partner.license_types || '')}" /></div>
              <div class="full"><label>安全大会履歴</label><textarea name="safety_conference_history" rows="2">${this.ctx.escapeHtml(partner.safety_conference_history || '')}</textarea></div>
            </div></section>
            <section class="form-section-card"><h3>各種区分</h3><div class="form-grid form-grid-compact">
              <div><label>傷害保険</label><select name="accident_insurance_code">${this.kit.codeOptions(this.codes.accident_insurance, partner.accident_insurance_code)}</select></div>
              <div><label>請負賠償</label><select name="contractor_liability_code">${this.kit.codeOptions(this.codes.contractor_liability, partner.contractor_liability_code)}</select></div>
              <div><label>貨物保険</label><select name="cargo_insurance_code">${this.kit.codeOptions(this.codes.cargo_insurance, partner.cargo_insurance_code)}</select></div>
              <div><label>G会</label><select name="g_association_code">${this.kit.codeOptions(this.codes.g_association, partner.g_association_code)}</select></div>
              <div><label>確定申告</label><select name="tax_return_code">${this.kit.codeOptions(this.codes.tax_return, partner.tax_return_code)}</select></div>
              <div><label>ループ</label><select name="loop_code">${this.kit.codeOptions(this.codes.loop_code, partner.loop_code)}</select></div>
              <div><label>支払出力</label><select name="payment_output_code">${this.kit.codeOptions(this.codes.payment_output, partner.payment_output_code)}</select></div>
            </div></section>
            <section class="form-section-card"><h3>銀行情報</h3><div class="form-grid form-grid-compact">
              <div><label>銀行コード（4桁）</label><input name="bank_code" inputmode="numeric" maxlength="4" pattern="[0-9]{4}" value="${this.ctx.escapeHtml(partner.bank_code || '')}" /></div>
              <div><label>銀行名</label><input name="bank_name" value="${this.ctx.escapeHtml(partner.bank_name || '')}" /></div>
              <div><label>支店コード（3桁）</label><input name="branch_code" inputmode="numeric" maxlength="3" pattern="[0-9]{3}" value="${this.ctx.escapeHtml(partner.branch_code || '')}" /></div>
              <div><label>支店名</label><input name="branch_name" value="${this.ctx.escapeHtml(partner.branch_name || '')}" /></div>
              <div><label>口座種別</label><select name="deposit_type">${this.kit.codeOptions(this.codes.deposit_type, partner.deposit_type)}</select></div>
              <div><label>口座番号</label><input name="account_number" value="${this.ctx.escapeHtml(partner.account_number || '')}" /></div>
              <div><label>口座名義</label><input name="account_name" value="${this.ctx.escapeHtml(partner.account_name || '')}" /></div>
              <div><label>口座名義カナ（CSV用）</label><input name="account_name_kana" value="${this.ctx.escapeHtml(partner.account_name_kana || '')}" /></div>
            </div></section>
            <section class="form-section-card">
            <div class="section-head">
              <h3 class="section-title">車両</h3>
              <button type="button" class="btn btn-ghost" id="add-vehicle">＋ 車両追加</button>
            </div>
            <div class="table-wrap" id="vehicles-mini">${this.vehiclesTableHtml()}</div>
            </section></div>
            <div class="btn-row form-actions-sticky">
              <button class="btn" type="submit">保存</button>
              <button class="btn btn-ghost" type="button" id="cancel">一覧へ</button>
            </div>
          </form>
          <div id="modal-host"></div>
        </section>`,
        { onBack: () => this.showList() }
      );
      this.kit.bindShell({ onBack: () => this.showList() });
      document.getElementById('cancel')?.addEventListener('click', () => this.showList());
      document.getElementById('add-vehicle')?.addEventListener('click', () => this.openVehicleModal(null));
      this.bindVehicleTable();
      document.getElementById('partner-form')?.addEventListener('submit', async (e) => {
        e.preventDefault();
        await this.save(e.currentTarget);
      });
    },

    bindVehicleTable() {
      document.querySelectorAll('[data-edit-vehicle]').forEach((btn) =>
        btn.addEventListener('click', () => this.openVehicleModal(Number(btn.getAttribute('data-edit-vehicle'))))
      );
      document.querySelectorAll('[data-del-vehicle]').forEach((btn) =>
        btn.addEventListener('click', () => {
          this.detailState.vehicles.splice(Number(btn.getAttribute('data-del-vehicle')), 1);
          document.getElementById('vehicles-mini').innerHTML = this.vehiclesTableHtml();
          this.bindVehicleTable();
        })
      );
    },

    openVehicleModal(idx) {
      const isNew = idx == null;
      const v = isNew ? this.emptyVehicle() : { ...this.detailState.vehicles[idx] };
      document.getElementById('modal-host').innerHTML = this.kit.modalHtml(
        isNew ? '車両追加' : '車両編集',
        `<div class="form-grid">
          <div><label>車両名称</label><input id="m_vehicle_name" value="${this.ctx.escapeHtml(v.vehicle_name || '')}" /></div>
          <div><label>車両番号</label><input id="m_vehicle_number" value="${this.ctx.escapeHtml(v.vehicle_number || '')}" /></div>
          <div><label>車検期限</label><input type="date" id="m_inspection" value="${this.ctx.escapeHtml(this.kit.dateValue(v.inspection_expiry_date))}" /></div>
          <div><label>保険期限</label><input type="date" id="m_insurance" value="${this.ctx.escapeHtml(this.kit.dateValue(v.insurance_expiry_date))}" /></div>
        </div>`,
        `<button type="button" class="btn" id="modal-save">保存</button>`
      );
      this.kit.bindModal();
      document.getElementById('modal-save')?.addEventListener('click', () => {
        const row = {
          vehicle_id: v.vehicle_id,
          vehicle_name: document.getElementById('m_vehicle_name').value,
          vehicle_number: document.getElementById('m_vehicle_number').value,
          inspection_expiry_date: document.getElementById('m_inspection').value || null,
          insurance_expiry_date: document.getElementById('m_insurance').value || null,
        };
        if (isNew) this.detailState.vehicles.push(row);
        else this.detailState.vehicles[idx] = row;
        document.getElementById('modal-backdrop')?.remove();
        document.getElementById('vehicles-mini').innerHTML = this.vehiclesTableHtml();
        this.bindVehicleTable();
      });
    },

    async save(form) {
      const errorEl = document.getElementById('form-error');
      errorEl.textContent = '';
      const payload = {
        partner_name: form.partner_name.value.trim(),
        partner_name_kana: form.partner_name_kana.value,
        transfer_fee_pattern_id: form.transfer_fee_pattern_id.value || null,
        zip_code: form.zip_code.value,
        address: form.address.value,
        contact_phone: form.contact_phone.value,
        blood_type: form.blood_type.value,
        birth_date: form.birth_date.value || null,
        work_start_date: form.work_start_date.value || null,
        contract_date: form.contract_date.value || null,
        partner_category_code: form.partner_category_code.value,
        employment_type_code: form.employment_type_code.value,
        invoice_number: form.invoice_number.value,
        advance_payment_enabled: form.advance_payment_enabled.checked,
        license_expiry_date: form.license_expiry_date.value || null,
        license_types: form.license_types.value,
        safety_conference_history: form.safety_conference_history.value,
        accident_insurance_code: form.accident_insurance_code.value,
        contractor_liability_code: form.contractor_liability_code.value,
        cargo_insurance_code: form.cargo_insurance_code.value,
        g_association_code: form.g_association_code.value,
        tax_return_code: form.tax_return_code.value,
        loop_code: form.loop_code.value,
        payment_output_code: form.payment_output_code.value,
        bank_code: form.bank_code.value,
        bank_name: form.bank_name.value,
        branch_code: form.branch_code.value,
        branch_name: form.branch_name.value,
        deposit_type: form.deposit_type.value,
        account_number: form.account_number.value,
        account_name: form.account_name.value,
        account_name_kana: form.account_name_kana.value,
        vehicles: this.detailState.vehicles,
        version: this.detailState.version,
      };
      const result = this.detailState.partnerId
        ? await this.ctx.api(`/api/partners/${this.detailState.partnerId}`, {
            method: 'PUT',
            body: JSON.stringify(payload),
          })
        : await this.ctx.api('/api/partners', { method: 'POST', body: JSON.stringify(payload) });
      if (!result.res.ok || !result.data?.ok) {
        errorEl.textContent = result.data?.message || '保存失敗';
        return;
      }
      await this.showList(this.detailState.partnerId ? '更新しました' : '登録しました');
    },
  };

  window.LinksPartners = LinksPartners;
})();
