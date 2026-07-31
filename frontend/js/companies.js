(() => {
  const LinksCompanies = {
    async open(ctx) {
      this.ctx = ctx;
      this.codes = { closing_date: [], payment_date: [], deposit_type: [], invoice_send_method: [] };
      this.listState = { q: '', closing_date_code: '', sort: 'company_id', order: 'asc' };
      await this.loadCodes();
      await this.showList();
    },

    async loadCodes() {
      const { res, data } = await this.ctx.api('/api/masters/codes');
      if (!res.ok || !data?.ok) return;
      const grouped = {
        closing_date: [],
        payment_date: [],
        deposit_type: [],
        invoice_send_method: [],
      };
      for (const row of data.codes || []) {
        if (grouped[row.category_code]) {
          grouped[row.category_code].push(row);
        }
      }
      this.codes = grouped;
    },

    codeLabel(category, value) {
      if (!value) return '-';
      const hit = (this.codes[category] || []).find((c) => c.code_value === value);
      return hit ? hit.code_label : value;
    },

    dateValue(value) {
      if (!value) return '';
      const s = String(value);
      return s.length >= 10 ? s.slice(0, 10) : s;
    },

    optionsHtml(category, selected) {
      const opts = [`<option value="">（未選択）</option>`]
        .concat(
          (this.codes[category] || []).map(
            (c) =>
              `<option value="${this.ctx.escapeHtml(c.code_value)}" ${
                c.code_value === selected ? 'selected' : ''
              }>${this.ctx.escapeHtml(c.code_label)}</option>`
          )
        );
      return opts.join('');
    },

    shell(title, bodyHtml) {
      return `
        <div class="app-shell">
          ${this.ctx.headerHtml()}
          <main class="app-main">
            <div class="back-row">
              <button type="button" class="btn btn-ghost" id="back-launcher">← 機能一覧へ戻る</button>
            </div>
            <h2 class="page-title">${this.ctx.escapeHtml(title)}</h2>
            ${bodyHtml}
          </main>
        </div>`;
    },

    bindShell() {
      this.ctx.bindLogout();
      document.getElementById('back-launcher')?.addEventListener('click', () => this.ctx.showHome());
    },

    async showList(message = '') {
      this.ctx.renderLoading();
      const params = new URLSearchParams({
        q: this.listState.q,
        closing_date_code: this.listState.closing_date_code,
        sort: this.listState.sort,
        order: this.listState.order,
      });
      const { res, data } = await this.ctx.api(`/api/companies?${params.toString()}`);
      if (!res.ok || !data?.ok) {
        this.ctx.app.innerHTML = this.shell(
          '企業マスタ',
          `<section class="panel"><p class="error">${this.ctx.escapeHtml(
            data?.message || '一覧を取得できませんでした'
          )}</p></section>`
        );
        this.bindShell();
        return;
      }

      const rows = (data.companies || [])
        .map(
          (c) => `
          <tr>
            <td>${this.ctx.escapeHtml(c.company_id)}</td>
            <td>${this.ctx.escapeHtml(c.company_name)}</td>
            <td>${this.ctx.escapeHtml(this.codeLabel('closing_date', c.closing_date_code))}</td>
            <td>${this.ctx.escapeHtml(this.codeLabel('invoice_send_method', c.invoice_send_method))}</td>
            <td>
              <button type="button" class="btn btn-ghost btn-small" data-edit="${c.company_id}">編集</button>
              <button type="button" class="btn btn-danger btn-small" data-del="${c.company_id}">削除</button>
              <button type="button" class="btn btn-ghost btn-small" data-base-project="${c.company_id}">基本案件</button>
            </td>
          </tr>`
        )
        .join('');

      this.ctx.app.innerHTML = this.shell(
        '企業マスタ（仮組）',
        `
        <section class="panel">
          ${message ? `<p class="flash">${this.ctx.escapeHtml(message)}</p>` : ''}
          <div class="toolbar">
            <input id="company-q" type="text" placeholder="企業名で検索" value="${this.ctx.escapeHtml(this.listState.q)}" />
            <select id="company-closing">
              <option value="">締日すべて</option>
              ${(this.codes.closing_date || [])
                .map(
                  (c) =>
                    `<option value="${this.ctx.escapeHtml(c.code_value)}" ${
                      this.listState.closing_date_code === c.code_value ? 'selected' : ''
                    }>${this.ctx.escapeHtml(c.code_label)}</option>`
                )
                .join('')}
            </select>
            <select id="company-sort">
              <option value="company_id" ${this.listState.sort === 'company_id' ? 'selected' : ''}>企業No</option>
              <option value="company_name" ${this.listState.sort === 'company_name' ? 'selected' : ''}>企業名</option>
              <option value="closing_date_code" ${this.listState.sort === 'closing_date_code' ? 'selected' : ''}>締日</option>
            </select>
            <select id="company-order">
              <option value="asc" ${this.listState.order === 'asc' ? 'selected' : ''}>昇順</option>
              <option value="desc" ${this.listState.order === 'desc' ? 'selected' : ''}>降順</option>
            </select>
            <button type="button" class="btn" id="company-search">検索</button>
            <button type="button" class="btn" id="company-new">＋ 新規企業登録</button>
          </div>
          <div class="table-wrap">
            <table class="data-table">
              <thead>
                <tr>
                  <th>企業No</th>
                  <th>企業名</th>
                  <th>締日</th>
                  <th>請求書送付方法</th>
                  <th>操作</th>
                </tr>
              </thead>
              <tbody>${rows || '<tr><td colspan="5">データがありません</td></tr>'}</tbody>
            </table>
          </div>
        </section>`
      );

      this.bindShell();
      document.getElementById('company-search')?.addEventListener('click', () => {
        this.listState.q = document.getElementById('company-q').value.trim();
        this.listState.closing_date_code = document.getElementById('company-closing').value;
        this.listState.sort = document.getElementById('company-sort').value;
        this.listState.order = document.getElementById('company-order').value;
        this.showList();
      });
      document.getElementById('company-new')?.addEventListener('click', () => this.showDetail(null));
      document.querySelectorAll('[data-edit]').forEach((btn) => {
        btn.addEventListener('click', () => this.showDetail(Number(btn.getAttribute('data-edit'))));
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
      document.querySelectorAll('[data-base-project]').forEach((btn) => {
        btn.addEventListener('click', () => {
          const id = Number(btn.getAttribute('data-base-project'));
          if (this.ctx.openFeature) {
            this.ctx.openFeature('projects', { company_id: id, tab: 'base' });
          } else {
            this.ctx.showToast('基本案件画面は準備中です');
          }
        });
      });
    },

    emptyBilling() {
      return {
        billing_id: null,
        billing_print_name: '',
        billing_address: '',
        billing_phone: '',
        billing_fax: '',
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

    async showDetail(companyId) {
      this.ctx.renderLoading();
      let company = {
        company_id: null,
        version: 1,
        office_no: '',
        company_name: '',
        company_name_kana: '',
        zip_code: '',
        address: '',
        contact: '',
        contract_manager: '',
        our_manager: '',
        our_contract_manager: '',
        closing_date_code: '',
        payment_date_code: '',
        contract_date: '',
        business_content: '',
        bank_name: '',
        branch_name: '',
        account_number: '',
        deposit_type: '',
        account_name: '',
        invoice_send_method: '',
        billings: [],
        vehicles: [],
      };

      if (companyId) {
        const { res, data } = await this.ctx.api(`/api/companies/${companyId}`);
        if (!res.ok || !data?.ok) {
          this.ctx.app.innerHTML = this.shell(
            '企業詳細',
            `<section class="panel"><p class="error">${this.ctx.escapeHtml(
              data?.message || '取得に失敗しました'
            )}</p></section>`
          );
          this.bindShell();
          return;
        }
        company = data.company;
        company.billings = company.billings || [];
        company.vehicles = company.vehicles || [];
      }

      const billingBlocks = (company.billings.length ? company.billings : [])
        .map((b, idx) => this.billingBlockHtml(b, idx))
        .join('');
      const vehicleBlocks = (company.vehicles.length ? company.vehicles : [])
        .map((v, idx) => this.vehicleBlockHtml(v, idx))
        .join('');

      this.ctx.app.innerHTML = this.shell(
        companyId ? `企業編集（No.${companyId}）` : '新規企業登録',
        `
        <section class="panel">
          <p class="error" id="company-form-error"></p>
          <form id="company-form">
            <h3 class="section-title">基本情報・銀行情報</h3>
            <div class="form-grid">
              <div>
                <label>事業所No</label>
                <input name="office_no" value="${this.ctx.escapeHtml(company.office_no || '')}" />
              </div>
              <div>
                <label>企業名（必須）</label>
                <input name="company_name" required value="${this.ctx.escapeHtml(company.company_name || '')}" />
              </div>
              <div>
                <label>企業名カナ</label>
                <input name="company_name_kana" value="${this.ctx.escapeHtml(company.company_name_kana || '')}" />
              </div>
              <div>
                <label>郵便番号</label>
                <input name="zip_code" value="${this.ctx.escapeHtml(company.zip_code || '')}" />
              </div>
              <div class="full">
                <label>住所</label>
                <input name="address" value="${this.ctx.escapeHtml(company.address || '')}" />
              </div>
              <div>
                <label>連絡先</label>
                <input name="contact" value="${this.ctx.escapeHtml(company.contact || '')}" />
              </div>
              <div>
                <label>契約担当者</label>
                <input name="contract_manager" value="${this.ctx.escapeHtml(company.contract_manager || '')}" />
              </div>
              <div>
                <label>弊社担当者</label>
                <input name="our_manager" value="${this.ctx.escapeHtml(company.our_manager || '')}" />
              </div>
              <div>
                <label>弊社契約担当者</label>
                <input name="our_contract_manager" value="${this.ctx.escapeHtml(company.our_contract_manager || '')}" />
              </div>
              <div>
                <label>基本締日</label>
                <select name="closing_date_code">${this.optionsHtml('closing_date', company.closing_date_code)}</select>
              </div>
              <div>
                <label>基本支払日</label>
                <select name="payment_date_code">${this.optionsHtml('payment_date', company.payment_date_code)}</select>
              </div>
              <div>
                <label>請求書送付方法</label>
                <select name="invoice_send_method">${this.optionsHtml('invoice_send_method', company.invoice_send_method)}</select>
              </div>
              <div>
                <label>基本契約日</label>
                <input type="date" name="contract_date" value="${this.ctx.escapeHtml(this.dateValue(company.contract_date))}" />
              </div>
              <div class="full">
                <label>業務内容および付帯作業</label>
                <textarea name="business_content" rows="3">${this.ctx.escapeHtml(company.business_content || '')}</textarea>
              </div>
              <div>
                <label>銀行名</label>
                <input name="bank_name" value="${this.ctx.escapeHtml(company.bank_name || '')}" />
              </div>
              <div>
                <label>支店名</label>
                <input name="branch_name" value="${this.ctx.escapeHtml(company.branch_name || '')}" />
              </div>
              <div>
                <label>口座種別</label>
                <select name="deposit_type">${this.optionsHtml('deposit_type', company.deposit_type)}</select>
              </div>
              <div>
                <label>口座番号</label>
                <input name="account_number" value="${this.ctx.escapeHtml(company.account_number || '')}" />
              </div>
              <div>
                <label>口座名義</label>
                <input name="account_name" value="${this.ctx.escapeHtml(company.account_name || '')}" />
              </div>
            </div>

            <div class="section-head">
              <h3 class="section-title">請求先情報</h3>
              <button type="button" class="btn btn-ghost" id="add-billing">＋ 請求先を追加</button>
            </div>
            <div id="billings-area">${billingBlocks || '<p class="muted">請求先はまだありません</p>'}</div>

            <div class="section-head">
              <h3 class="section-title">車両情報</h3>
              <button type="button" class="btn btn-ghost" id="add-vehicle">＋ 車両を追加</button>
            </div>
            <div id="vehicles-area">${vehicleBlocks || '<p class="muted">車両はまだありません</p>'}</div>

            <div class="btn-row">
              <button class="btn" type="submit">保存</button>
              <button class="btn btn-ghost" type="button" id="cancel-company">一覧へ戻る</button>
            </div>
          </form>
        </section>`
      );

      this.bindShell();
      this.detailState = {
        companyId: company.company_id || null,
        version: company.version || 1,
        billings: company.billings.length ? company.billings.map((b) => ({ ...b })) : [],
        vehicles: company.vehicles.length ? company.vehicles.map((v) => ({ ...v })) : [],
      };

      document.getElementById('cancel-company')?.addEventListener('click', () => this.showList());
      document.getElementById('add-billing')?.addEventListener('click', () => {
        this.detailState.billings.push(this.emptyBilling());
        this.rerenderChildren();
      });
      document.getElementById('add-vehicle')?.addEventListener('click', () => {
        this.detailState.vehicles.push(this.emptyVehicle());
        this.rerenderChildren();
      });
      this.bindChildEvents();

      document.getElementById('company-form')?.addEventListener('submit', async (event) => {
        event.preventDefault();
        await this.saveCompany(event.currentTarget);
      });
    },

    billingBlockHtml(b, idx) {
      return `
        <div class="child-block" data-billing-idx="${idx}">
          <input type="hidden" name="billing_id_${idx}" value="${this.ctx.escapeHtml(b.billing_id || '')}" />
          <div class="form-grid">
            <div class="full">
              <label>請求先印字名称</label>
              <input name="billing_print_name_${idx}" value="${this.ctx.escapeHtml(b.billing_print_name || '')}" />
            </div>
            <div class="full">
              <label>請求先住所</label>
              <input name="billing_address_${idx}" value="${this.ctx.escapeHtml(b.billing_address || '')}" />
            </div>
            <div>
              <label>電話</label>
              <input name="billing_phone_${idx}" value="${this.ctx.escapeHtml(b.billing_phone || '')}" />
            </div>
            <div>
              <label>FAX</label>
              <input name="billing_fax_${idx}" value="${this.ctx.escapeHtml(b.billing_fax || '')}" />
            </div>
            <div>
              <label>担当者</label>
              <input name="billing_manager_${idx}" value="${this.ctx.escapeHtml(b.billing_manager || '')}" />
            </div>
            <div>
              <label>請求書取り纏めNo</label>
              <input name="billing_summary_no_${idx}" value="${this.ctx.escapeHtml(b.billing_summary_no || '')}" />
            </div>
          </div>
          <button type="button" class="btn btn-danger btn-small" data-remove-billing="${idx}">この請求先を削除</button>
        </div>`;
    },

    vehicleBlockHtml(v, idx) {
      return `
        <div class="child-block" data-vehicle-idx="${idx}">
          <input type="hidden" name="vehicle_id_${idx}" value="${this.ctx.escapeHtml(v.vehicle_id || '')}" />
          <div class="form-grid">
            <div>
              <label>車両名称</label>
              <input name="vehicle_name_${idx}" value="${this.ctx.escapeHtml(v.vehicle_name || '')}" />
            </div>
            <div>
              <label>車両番号</label>
              <input name="vehicle_number_${idx}" value="${this.ctx.escapeHtml(v.vehicle_number || '')}" />
            </div>
            <div>
              <label>車検証有効期限</label>
              <input type="date" name="inspection_expiry_date_${idx}" value="${this.ctx.escapeHtml(this.dateValue(v.inspection_expiry_date))}" />
            </div>
            <div>
              <label>任意保険有効期限</label>
              <input type="date" name="insurance_expiry_date_${idx}" value="${this.ctx.escapeHtml(this.dateValue(v.insurance_expiry_date))}" />
            </div>
          </div>
          <button type="button" class="btn btn-danger btn-small" data-remove-vehicle="${idx}">この車両を削除</button>
        </div>`;
    },

    collectChildrenFromForm(form) {
      const billings = [];
      for (let i = 0; i < this.detailState.billings.length; i += 1) {
        if (!form.querySelector(`[name="billing_print_name_${i}"]`)) continue;
        const idVal = form[`billing_id_${i}`]?.value;
        billings.push({
          billing_id: idVal ? Number(idVal) : null,
          billing_print_name: form[`billing_print_name_${i}`].value,
          billing_address: form[`billing_address_${i}`].value,
          billing_phone: form[`billing_phone_${i}`].value,
          billing_fax: form[`billing_fax_${i}`].value,
          billing_manager: form[`billing_manager_${i}`].value,
          billing_summary_no: form[`billing_summary_no_${i}`].value,
        });
      }
      const vehicles = [];
      for (let i = 0; i < this.detailState.vehicles.length; i += 1) {
        if (!form.querySelector(`[name="vehicle_name_${i}"]`)) continue;
        const idVal = form[`vehicle_id_${i}`]?.value;
        vehicles.push({
          vehicle_id: idVal ? Number(idVal) : null,
          vehicle_name: form[`vehicle_name_${i}`].value,
          vehicle_number: form[`vehicle_number_${i}`].value,
          inspection_expiry_date: form[`inspection_expiry_date_${i}`].value || null,
          insurance_expiry_date: form[`insurance_expiry_date_${i}`].value || null,
        });
      }
      this.detailState.billings = billings;
      this.detailState.vehicles = vehicles;
    },

    rerenderChildren() {
      const form = document.getElementById('company-form');
      if (form) this.collectChildrenFromForm(form);
      const billingsArea = document.getElementById('billings-area');
      const vehiclesArea = document.getElementById('vehicles-area');
      if (billingsArea) {
        billingsArea.innerHTML = this.detailState.billings.length
          ? this.detailState.billings.map((b, i) => this.billingBlockHtml(b, i)).join('')
          : '<p class="muted">請求先はまだありません</p>';
      }
      if (vehiclesArea) {
        vehiclesArea.innerHTML = this.detailState.vehicles.length
          ? this.detailState.vehicles.map((v, i) => this.vehicleBlockHtml(v, i)).join('')
          : '<p class="muted">車両はまだありません</p>';
      }
      this.bindChildEvents();
    },

    bindChildEvents() {
      document.querySelectorAll('[data-remove-billing]').forEach((btn) => {
        btn.addEventListener('click', () => {
          const form = document.getElementById('company-form');
          if (form) this.collectChildrenFromForm(form);
          const idx = Number(btn.getAttribute('data-remove-billing'));
          this.detailState.billings.splice(idx, 1);
          this.rerenderChildren();
        });
      });
      document.querySelectorAll('[data-remove-vehicle]').forEach((btn) => {
        btn.addEventListener('click', () => {
          const form = document.getElementById('company-form');
          if (form) this.collectChildrenFromForm(form);
          const idx = Number(btn.getAttribute('data-remove-vehicle'));
          this.detailState.vehicles.splice(idx, 1);
          this.rerenderChildren();
        });
      });
    },

    async saveCompany(form) {
      const errorEl = document.getElementById('company-form-error');
      errorEl.textContent = '';
      this.collectChildrenFromForm(form);

      const payload = {
        office_no: form.office_no.value,
        company_name: form.company_name.value.trim(),
        company_name_kana: form.company_name_kana.value,
        zip_code: form.zip_code.value,
        address: form.address.value,
        contact: form.contact.value,
        contract_manager: form.contract_manager.value,
        our_manager: form.our_manager.value,
        our_contract_manager: form.our_contract_manager.value,
        closing_date_code: form.closing_date_code.value,
        payment_date_code: form.payment_date_code.value,
        contract_date: form.contract_date.value || null,
        business_content: form.business_content.value,
        bank_name: form.bank_name.value,
        branch_name: form.branch_name.value,
        account_number: form.account_number.value,
        deposit_type: form.deposit_type.value,
        account_name: form.account_name.value,
        invoice_send_method: form.invoice_send_method.value,
        billings: this.detailState.billings,
        vehicles: this.detailState.vehicles,
        version: this.detailState.version,
      };

      if (!payload.company_name) {
        errorEl.textContent = '企業名は必須です';
        return;
      }

      let result;
      if (this.detailState.companyId) {
        result = await this.ctx.api(`/api/companies/${this.detailState.companyId}`, {
          method: 'PUT',
          body: JSON.stringify(payload),
        });
      } else {
        result = await this.ctx.api('/api/companies', {
          method: 'POST',
          body: JSON.stringify(payload),
        });
      }

      if (!result.res.ok || !result.data?.ok) {
        errorEl.textContent = result.data?.message || '保存に失敗しました';
        return;
      }

      await this.showList(this.detailState.companyId ? '企業を更新しました' : '企業を登録しました');
    },
  };

  window.LinksCompanies = LinksCompanies;
})();
