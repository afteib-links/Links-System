(() => {
  const LinksCompanies = {
    async open(ctx) {
      this.kit = window.LinksFeatureKit.createFeatureKit(ctx);
      this.ctx = ctx;
      this.ctx.renderLoading();
      this.listState = { q: '', sortKey: 'company_id', sortOrder: 'asc', filters: {} };
      const [codes, staffRes, layout] = await Promise.all([
        this.kit.loadCodes(), this.ctx.api('/api/master-settings/staff'), this.kit.loadAreaLayout('companies'),
      ]);
      this.codes = codes;
      this.staff = staffRes.data?.staff || [];
      this.layout = layout;
      await this.showList();
    },

    listColumns() {
      return [
        { key: 'company_id', label: '企業No' },
        { key: 'company_name', label: '企業名' },
        { key: 'office_name', label: '事業所名' },
        {
          key: 'work_mode_code',
          label: '稼働形態',
          getValue: (r) => this.kit.codeLabel(this.codes.work_mode, r.work_mode_code),
        },
        { key: 'our_manager', label: '営業担当' },
        { key: 'base_project_count', label: '基本案件数' },
        {
          key: 'closing_date',
          label: '締日',
          getValue: (r) => this.kit.codeLabel(this.codes.closing_date, r.closing_date_code),
        },
        {
          key: 'invoice_send_method',
          label: '請求書送付',
          getValue: (r) => this.kit.codeLabel(this.codes.invoice_send_method, r.invoice_send_method),
        },
      ];
    },

    async showList(message = '') {
      this.ctx.renderLoading();
      const params = new URLSearchParams({ q: this.listState.q || '' });
      const { res, data } = await this.ctx.api(`/api/companies?${params}`);
      if (!res.ok || !data?.ok) {
        this.ctx.app.innerHTML = this.kit.shell(
          '企業マスタ',
          `<section class="panel"><p class="error">${this.ctx.escapeHtml(data?.message || '取得失敗')}</p></section>`
        );
        this.kit.bindShell();
        return;
      }
      this.rows = data.companies || [];
      const table = window.LinksDataTable.renderTable({
        screenKey: 'companies',
        columns: this.listColumns(),
        rows: this.rows,
        layout: this.layout,
        sortKey: this.listState.sortKey,
        sortOrder: this.listState.sortOrder,
        filters: this.listState.filters,
        escapeHtml: this.ctx.escapeHtml,
        renderActions: (c) => `
          <span class="desktop-row-actions">
            <button type="button" class="btn btn-ghost btn-small" data-edit="${c.company_id}">編集</button>
            <button type="button" class="btn btn-danger btn-small" data-del="${c.company_id}">削除</button>
            <button type="button" class="btn btn-ghost btn-small" data-base="${c.company_id}">基本案件</button>
          </span>
          <button type="button" class="btn btn-ghost btn-small mobile-row-action" data-company-actions="${c.company_id}" aria-label="${this.ctx.escapeHtml(c.company_name || `企業No ${c.company_id}`)}の操作">操作</button>`,
        rowKey: 'company_id',
      });

      this.ctx.app.innerHTML = this.kit.shell(
        '企業マスタ（仮組）',
        `<section class="panel" id="companies-list-root">
          ${message ? `<p class="flash">${this.ctx.escapeHtml(message)}</p>` : ''}
          <div class="toolbar">
            <input id="company-q" type="text" placeholder="企業名で検索" value="${this.ctx.escapeHtml(this.listState.q)}" />
            <button type="button" class="btn" id="company-search">検索</button>
            <button type="button" class="btn" id="company-new">＋ 新規企業登録</button>
          </div>
          ${table.html}
          <div id="modal-host"></div>
        </section>`
      );
      this.kit.bindShell();
      window.LinksDataTable.bindTable('#companies-list-root', {
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
      document.getElementById('company-search')?.addEventListener('click', () => {
        this.listState.q = document.getElementById('company-q').value.trim();
        this.showList();
      });
      document.getElementById('company-new')?.addEventListener('click', () => {
        this.kit.pushNav(() => this.showList());
        this.showDetail(null);
      });
      document.querySelectorAll('[data-edit]').forEach((btn) => {
        btn.addEventListener('click', () => {
          this.kit.pushNav(() => this.showList());
          this.showDetail(Number(btn.getAttribute('data-edit')));
        });
      });
      document.querySelectorAll('[data-del]').forEach((btn) => {
        btn.addEventListener('click', async () => {
          const id = Number(btn.getAttribute('data-del'));
          if (!window.confirm(`企業No ${id} を削除しますか？`)) return;
          const result = await this.ctx.api(`/api/companies/${id}`, { method: 'DELETE' });
          if (!result.res.ok || !result.data?.ok) {
            window.alert(result.data?.message || '削除に失敗しました');
            return;
          }
          await this.showList('企業を削除しました');
        });
      });
      document.querySelectorAll('[data-base]').forEach((btn) => {
        btn.addEventListener('click', () => {
          this.ctx.openFeature?.('base_projects', { company_id: Number(btn.getAttribute('data-base')) });
        });
      });
      document.querySelectorAll('[data-company-actions]').forEach((btn) => {
        btn.addEventListener('click', () => this.openListActions(Number(btn.getAttribute('data-company-actions'))));
      });
    },

    openListActions(id) {
      const company = this.rows.find((row) => Number(row.company_id) === Number(id));
      const host = document.getElementById('modal-host');
      if (!company || !host) return;
      host.innerHTML = this.kit.modalHtml(
        `${company.company_name || `企業No ${id}`}の操作`,
        `<div class="mobile-action-list">
          <button type="button" class="btn btn-ghost" data-run-company-action="edit">編集</button>
          <button type="button" class="btn btn-ghost" data-run-company-action="base">基本案件</button>
          <button type="button" class="btn btn-danger" data-run-company-action="del">削除</button>
        </div>`
      );
      const close = this.kit.bindModal();
      document.querySelectorAll('[data-run-company-action]').forEach((button) => {
        button.addEventListener('click', () => {
          const action = button.getAttribute('data-run-company-action');
          close();
          document.querySelector(`.desktop-row-actions [data-${action}="${id}"]`)?.click();
        });
      });
    },

    emptyBilling() {
      return {
        billing_id: null,
        billing_print_name: '',
        billing_zip_code: '',
        billing_address: '',
        billing_phone: '',
        billing_fax: '',
        billing_email: '',
        invoice_send_method: '',
        billing_manager: '',
        billing_summary_no: '',
      };
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

    emptyPeriod() {
      return {
        period_id: null,
        role_type: 'our_manager',
        name_or_user: '',
        staff_master_id: null,
        start_date: '',
        end_date: '',
      };
    },

    async showDetail(companyId) {
      this.ctx.renderLoading();
      let company = {
        company_id: null,
        version: 1,
        office_no: '',
        office_name: '',
        company_name: '',
        company_name_kana: '',
        zip_code: '',
        address: '',
        contact: '',
        fax: '',
        contract_manager: '',
        our_manager: '',
        our_contract_manager: '',
        closing_date_code: '',
        payment_date_code: '',
        contract_date: '',
        business_content: '',
        bank_name: '',
        bank_code: '',
        branch_name: '',
        branch_code: '',
        account_number: '',
        deposit_type: '',
        account_name: '',
        account_name_kana: '',
        invoice_send_method: '',
        invoice_send_address: '',
        work_mode_code: '',
        billings: [],
        vehicles: [],
        manager_periods: [],
      };
      if (companyId) {
        const { res, data } = await this.ctx.api(`/api/companies/${companyId}`);
        if (!res.ok || !data?.ok) {
          this.ctx.app.innerHTML = this.kit.shell(
            '企業詳細',
            `<section class="panel"><p class="error">${this.ctx.escapeHtml(data?.message || '取得失敗')}</p></section>`,
            { onBack: () => this.showList() }
          );
          this.kit.bindShell({ onBack: () => this.showList() });
          return;
        }
        company = data.company;
      }
      this.detailState = {
        companyId: company.company_id || null,
        version: company.version || 1,
        billings: (company.billings || []).map((b) => ({ ...b })),
        vehicles: (company.vehicles || []).map((v) => ({ ...v })),
        manager_periods: (company.manager_periods || []).map((p) => ({ ...p })),
      };

      this.ctx.app.innerHTML = this.kit.shell(
        companyId ? `企業編集（No.${companyId}）` : '新規企業登録',
        `<section class="panel">
          <p class="error" id="company-form-error"></p>
          <form id="company-form">
            <div class="form-sections">
            <section class="form-section-card"><h3>基本・契約情報</h3>
            <div class="form-grid form-grid-compact">
              <div><label>企業名カナ</label><input name="company_name_kana" value="${this.ctx.escapeHtml(company.company_name_kana || '')}" /></div>
              <div><label>事業所名</label><input name="office_name" value="${this.ctx.escapeHtml(company.office_name || '')}" placeholder="任意（入力なし可）" /></div>
              <div class="full"><label>企業名（必須）</label><input name="company_name" required value="${this.ctx.escapeHtml(company.company_name || '')}" /></div>
              <div><label>郵便番号</label><input name="zip_code" value="${this.ctx.escapeHtml(company.zip_code || '')}" /></div>
              <div class="full"><label>住所</label><input name="address" value="${this.ctx.escapeHtml(company.address || '')}" /></div>
              <div><label>連絡先</label><input name="contact" value="${this.ctx.escapeHtml(company.contact || '')}" /></div>
              <div><label>FAX</label><input name="fax" value="${this.ctx.escapeHtml(company.fax || '')}" /></div>
              <div><label>契約担当者</label><input name="contract_manager" value="${this.ctx.escapeHtml(company.contract_manager || '')}" /></div>
              <div><label>稼働形態</label><select name="work_mode_code">${this.kit.codeOptions(this.codes.work_mode, company.work_mode_code)}</select></div>
              <div><label>基本締日</label><select name="closing_date_code">${this.kit.codeOptions(this.codes.closing_date, company.closing_date_code)}</select></div>
              <div><label>基本支払日</label><select name="payment_date_code">${this.kit.codeOptions(this.codes.payment_date, company.payment_date_code)}</select></div>
              <div><label>基本契約日</label><input type="date" name="contract_date" value="${this.ctx.escapeHtml(this.kit.dateValue(company.contract_date))}" /></div>
              <div class="full"><label>業務内容および付帯作業</label><textarea name="business_content" rows="3">${this.ctx.escapeHtml(company.business_content || '')}</textarea></div>
            </div></section>
            <section class="form-section-card"><h3>銀行情報</h3><div class="form-grid form-grid-compact">
              <div><label>銀行コード（4桁）</label><input name="bank_code" inputmode="numeric" maxlength="4" pattern="[0-9]{4}" value="${this.ctx.escapeHtml(company.bank_code || '')}" /></div>
              <div><label>銀行名</label><input name="bank_name" value="${this.ctx.escapeHtml(company.bank_name || '')}" /></div>
              <div><label>支店コード（3桁）</label><input name="branch_code" inputmode="numeric" maxlength="3" pattern="[0-9]{3}" value="${this.ctx.escapeHtml(company.branch_code || '')}" /></div>
              <div><label>支店名</label><input name="branch_name" value="${this.ctx.escapeHtml(company.branch_name || '')}" /></div>
              <div><label>口座種別</label><select name="deposit_type">${this.kit.codeOptions(this.codes.deposit_type, company.deposit_type)}</select></div>
              <div><label>口座番号</label><input name="account_number" value="${this.ctx.escapeHtml(company.account_number || '')}" /></div>
              <div><label>口座名義</label><input name="account_name" value="${this.ctx.escapeHtml(company.account_name || '')}" /></div>
              <div><label>口座名義カナ</label><input name="account_name_kana" value="${this.ctx.escapeHtml(company.account_name_kana || '')}" /></div>
            </div></section>

            <section class="form-section-card">
            <div class="section-head">
              <h3 class="section-title">請求先情報</h3>
              <button type="button" class="btn btn-ghost" id="add-billing">＋ 請求先を追加</button>
            </div>
            <div class="table-wrap" id="billings-mini">${this.billingsTableHtml()}</div>
            </section>

            <section class="form-section-card">
            <div class="section-head">
              <h3 class="section-title">車両情報</h3>
              <button type="button" class="btn btn-ghost" id="add-vehicle">＋ 車両を追加</button>
            </div>
            <div class="table-wrap" id="vehicles-mini">${this.vehiclesTableHtml()}</div>
            </section>

            <section class="form-section-card">
            <div class="section-head">
              <h3 class="section-title">担当履歴</h3>
              <button type="button" class="btn btn-ghost" id="add-period">＋ 期間追加</button>
            </div>
            <div class="table-wrap" id="periods-mini">${this.periodsTableHtml()}</div>
            </section>
            </div>

            <div class="btn-row form-actions-sticky">
              <button class="btn" type="submit">保存</button>
              <button class="btn btn-ghost" type="button" id="cancel-company">一覧へ戻る</button>
            </div>
          </form>
          <div id="modal-host"></div>
        </section>`,
        { onBack: () => this.showList() }
      );

      this.kit.bindShell({ onBack: () => this.showList() });
      document.getElementById('cancel-company')?.addEventListener('click', () => this.showList());
      document.getElementById('add-billing')?.addEventListener('click', () => this.openBillingModal(null));
      document.getElementById('add-vehicle')?.addEventListener('click', () => this.openVehicleModal(null));
      document.getElementById('add-period')?.addEventListener('click', () => this.openPeriodModal(null));
      this.bindChildTables();
      document.getElementById('company-form')?.addEventListener('submit', async (e) => {
        e.preventDefault();
        await this.saveCompany(e.currentTarget);
      });
    },

    billingsTableHtml() {
      const rows = this.detailState.billings
        .map(
          (b, idx) => `
          <tr>
            <td>${this.ctx.escapeHtml(b.billing_print_name || '-')}</td>
            <td>${this.ctx.escapeHtml(`${b.billing_zip_code?`〒${b.billing_zip_code} `:''}${b.billing_address||''}`||'-')}</td>
            <td>${this.ctx.escapeHtml(b.billing_email || '-')}</td>
            <td>${this.ctx.escapeHtml(this.kit.codeLabel(this.codes.invoice_send_method,b.invoice_send_method)||'-')}</td>
            <td>${this.ctx.escapeHtml(b.billing_summary_no || '-')}</td>
            <td>
              <button type="button" class="btn btn-ghost btn-small" data-edit-billing="${idx}">編集</button>
              <button type="button" class="btn btn-danger btn-small" data-del-billing="${idx}">削除</button>
            </td>
          </tr>`
        )
        .join('');
      return `<table class="data-table data-table-compact"><thead><tr><th>印字名称</th><th>送付先</th><th>メール</th><th>送付方法</th><th>取り纏めNo</th><th>操作</th></tr></thead>
        <tbody>${rows || '<tr><td colspan="6">請求先はまだありません</td></tr>'}</tbody></table>`;
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
        <tbody>${rows || '<tr><td colspan="5">車両はまだありません</td></tr>'}</tbody></table>`;
    },

    periodsTableHtml() {
      const roleLabel = (t) => (t === 'our_contract_manager' ? '契約担当' : '営業担当');
      const rows = this.detailState.manager_periods
        .map(
          (p, idx) => `
          <tr>
            <td>${this.ctx.escapeHtml(roleLabel(p.role_type))}</td>
            <td>${this.ctx.escapeHtml(p.name_or_user || '-')}</td>
            <td>${this.ctx.escapeHtml(this.kit.dateValue(p.start_date) || '-')}</td>
            <td>${this.ctx.escapeHtml(this.kit.dateValue(p.end_date) || '〜')}</td>
            <td>
              <button type="button" class="btn btn-ghost btn-small" data-edit-period="${idx}">編集</button>
              <button type="button" class="btn btn-danger btn-small" data-del-period="${idx}">削除</button>
            </td>
          </tr>`
        )
        .join('');
      return `<table class="data-table data-table-compact"><thead><tr><th>種別</th><th>氏名</th><th>開始</th><th>終了</th><th>操作</th></tr></thead>
        <tbody>${rows || '<tr><td colspan="5">担当履歴はまだありません</td></tr>'}</tbody></table>`;
    },

    refreshChildTables() {
      const b = document.getElementById('billings-mini');
      const v = document.getElementById('vehicles-mini');
      const p = document.getElementById('periods-mini');
      if (b) b.innerHTML = this.billingsTableHtml();
      if (v) v.innerHTML = this.vehiclesTableHtml();
      if (p) p.innerHTML = this.periodsTableHtml();
      this.bindChildTables();
    },

    bindChildTables() {
      document.querySelectorAll('[data-edit-billing]').forEach((btn) =>
        btn.addEventListener('click', () => this.openBillingModal(Number(btn.getAttribute('data-edit-billing'))))
      );
      document.querySelectorAll('[data-del-billing]').forEach((btn) =>
        btn.addEventListener('click', () => {
          this.detailState.billings.splice(Number(btn.getAttribute('data-del-billing')), 1);
          this.refreshChildTables();
        })
      );
      document.querySelectorAll('[data-edit-vehicle]').forEach((btn) =>
        btn.addEventListener('click', () => this.openVehicleModal(Number(btn.getAttribute('data-edit-vehicle'))))
      );
      document.querySelectorAll('[data-del-vehicle]').forEach((btn) =>
        btn.addEventListener('click', () => {
          this.detailState.vehicles.splice(Number(btn.getAttribute('data-del-vehicle')), 1);
          this.refreshChildTables();
        })
      );
      document.querySelectorAll('[data-edit-period]').forEach((btn) =>
        btn.addEventListener('click', () => this.openPeriodModal(Number(btn.getAttribute('data-edit-period'))))
      );
      document.querySelectorAll('[data-del-period]').forEach((btn) =>
        btn.addEventListener('click', () => {
          this.detailState.manager_periods.splice(Number(btn.getAttribute('data-del-period')), 1);
          this.refreshChildTables();
        })
      );
    },

    openBillingModal(idx) {
      const isNew = idx == null;
      const b = isNew ? this.emptyBilling() : { ...this.detailState.billings[idx] };
      const host = document.getElementById('modal-host');
      host.innerHTML = this.kit.modalHtml(
        isNew ? '請求先追加' : '請求先編集',
        `<div class="form-grid">
          <div class="full"><label>請求先印字名称</label><input id="m_billing_print_name" value="${this.ctx.escapeHtml(b.billing_print_name || '')}" /></div>
          <div><label>請求先郵便番号</label><input id="m_billing_zip_code" value="${this.ctx.escapeHtml(b.billing_zip_code || '')}" /></div>
          <div><label>請求書送付方法</label><select id="m_invoice_send_method">${this.kit.codeOptions(this.codes.invoice_send_method,b.invoice_send_method)}</select></div>
          <div class="full"><label>請求書送付先住所</label><input id="m_billing_address" value="${this.ctx.escapeHtml(b.billing_address || '')}" /></div>
          <div><label>電話</label><input id="m_billing_phone" value="${this.ctx.escapeHtml(b.billing_phone || '')}" /></div>
          <div><label>FAX</label><input id="m_billing_fax" value="${this.ctx.escapeHtml(b.billing_fax || '')}" /></div>
          <div><label>メールアドレス</label><input type="email" id="m_billing_email" value="${this.ctx.escapeHtml(b.billing_email || '')}" /></div>
          <div><label>担当者</label><input id="m_billing_manager" value="${this.ctx.escapeHtml(b.billing_manager || '')}" /></div>
          <div><label>取り纏めNo</label><input id="m_billing_summary_no" value="${this.ctx.escapeHtml(b.billing_summary_no || '')}" /></div>
        </div>`,
        `<button type="button" class="btn" id="modal-save">保存</button>`,
        'modal-wide'
      );
      this.kit.bindModal();
      document.getElementById('modal-save')?.addEventListener('click', () => {
        const row = {
          billing_id: b.billing_id,
          billing_print_name: document.getElementById('m_billing_print_name').value,
          billing_zip_code: document.getElementById('m_billing_zip_code').value,
          billing_address: document.getElementById('m_billing_address').value,
          billing_phone: document.getElementById('m_billing_phone').value,
          billing_fax: document.getElementById('m_billing_fax').value,
          billing_email: document.getElementById('m_billing_email').value,
          invoice_send_method: document.getElementById('m_invoice_send_method').value,
          billing_manager: document.getElementById('m_billing_manager').value,
          billing_summary_no: document.getElementById('m_billing_summary_no').value,
        };
        if (isNew) this.detailState.billings.push(row);
        else this.detailState.billings[idx] = row;
        document.getElementById('modal-backdrop')?.remove();
        this.refreshChildTables();
      });
    },

    openVehicleModal(idx) {
      const isNew = idx == null;
      const v = isNew ? this.emptyVehicle() : { ...this.detailState.vehicles[idx] };
      const host = document.getElementById('modal-host');
      host.innerHTML = this.kit.modalHtml(
        isNew ? '車両追加' : '車両編集',
        `<div class="form-grid">
          <div><label>車両名称</label><input id="m_vehicle_name" value="${this.ctx.escapeHtml(v.vehicle_name || '')}" /></div>
          <div><label>車両番号</label><input id="m_vehicle_number" value="${this.ctx.escapeHtml(v.vehicle_number || '')}" /></div>
          <div><label>車検証有効期限</label><input type="date" id="m_inspection" value="${this.ctx.escapeHtml(this.kit.dateValue(v.inspection_expiry_date))}" /></div>
          <div><label>任意保険有効期限</label><input type="date" id="m_insurance" value="${this.ctx.escapeHtml(this.kit.dateValue(v.insurance_expiry_date))}" /></div>
        </div>`,
        `<button type="button" class="btn" id="modal-save">保存</button>`,
        'modal-wide'
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
        this.refreshChildTables();
      });
    },

    openPeriodModal(idx) {
      const isNew = idx == null;
      const p = isNew ? this.emptyPeriod() : { ...this.detailState.manager_periods[idx] };
      const host = document.getElementById('modal-host');
      host.innerHTML = this.kit.modalHtml(
        isNew ? '担当期間追加' : '担当期間編集',
        `<div class="form-grid">
          <div><label>種別</label>
            <select id="m_role_type">
              <option value="our_manager" ${p.role_type !== 'our_contract_manager' ? 'selected' : ''}>営業担当</option>
              <option value="our_contract_manager" ${p.role_type === 'our_contract_manager' ? 'selected' : ''}>契約担当</option>
            </select>
          </div>
          <div><label>氏名</label>${this.kit.comboHtml('m_name_or_user', this.staff, 'staff_master_id', 'staff_name', p.name_or_user, 'period-staff')}</div>
          <div><label>開始日</label><input type="date" id="m_start_date" value="${this.ctx.escapeHtml(this.kit.dateValue(p.start_date))}" /></div>
          ${isNew?'<div><label>終了日</label><input value="担当変更時に自動設定" disabled /></div>':`<div><label>終了日</label><input type="date" id="m_end_date" value="${this.ctx.escapeHtml(this.kit.dateValue(p.end_date))}" /></div>`}
        </div>`,
        `<button type="button" class="btn" id="modal-save">保存</button>`,
        'modal-wide'
      );
      this.kit.bindModal();
      document.getElementById('modal-save')?.addEventListener('click', () => {
        const name = document.getElementById('m_name_or_user').value.trim();
        const start = document.getElementById('m_start_date').value;
        if (!name || !start) {
          window.alert('氏名と開始日は必須です');
          return;
        }
        const staffHit = this.staff.find((s) => s.staff_name === name);
        const row = {
          period_id: p.period_id,
          role_type: document.getElementById('m_role_type').value,
          name_or_user: name,
          staff_master_id: staffHit?.staff_master_id || null,
          start_date: start,
          end_date: document.getElementById('m_end_date')?.value || null,
        };
        if (isNew) this.detailState.manager_periods.push(row);
        else this.detailState.manager_periods[idx] = row;
        document.getElementById('modal-backdrop')?.remove();
        this.refreshChildTables();
      });
    },

    async saveCompany(form) {
      const errorEl = document.getElementById('company-form-error');
      errorEl.textContent = '';
      const payload = {
        office_name: form.office_name.value,
        company_name: form.company_name.value.trim(),
        company_name_kana: form.company_name_kana.value,
        zip_code: form.zip_code.value,
        address: form.address.value,
        contact: form.contact.value,
        fax: form.fax.value,
        contract_manager: form.contract_manager.value,
        closing_date_code: form.closing_date_code.value,
        payment_date_code: form.payment_date_code.value,
        contract_date: form.contract_date.value || null,
        business_content: form.business_content.value,
        bank_code: form.bank_code.value,
        bank_name: form.bank_name.value,
        branch_code: form.branch_code.value,
        branch_name: form.branch_name.value,
        account_number: form.account_number.value,
        deposit_type: form.deposit_type.value,
        account_name: form.account_name.value,
        account_name_kana: form.account_name_kana.value,
        work_mode_code: form.work_mode_code.value,
        billings: this.detailState.billings,
        vehicles: this.detailState.vehicles,
        manager_periods: this.detailState.manager_periods,
        version: this.detailState.version,
      };
      if (!payload.company_name) {
        errorEl.textContent = '企業名は必須です';
        return;
      }
      const result = this.detailState.companyId
        ? await this.ctx.api(`/api/companies/${this.detailState.companyId}`, {
            method: 'PUT',
            body: JSON.stringify(payload),
          })
        : await this.ctx.api('/api/companies', { method: 'POST', body: JSON.stringify(payload) });
      if (!result.res.ok || !result.data?.ok) {
        errorEl.textContent = result.data?.message || '保存に失敗しました';
        return;
      }
      await this.showList(this.detailState.companyId ? '企業を更新しました' : '企業を登録しました');
    },
  };

  window.LinksCompanies = LinksCompanies;
})();
