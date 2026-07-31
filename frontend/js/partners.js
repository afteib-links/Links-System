(() => {
  const LinksPartners = {
    async open(ctx) {
      this.kit = window.LinksFeatureKit.createFeatureKit(ctx);
      this.ctx = ctx;
      this.listState = { q: '', partner_category_code: '', employment_type_code: '', sort: 'partner_id', order: 'asc' };
      this.codes = await this.kit.loadCodes();
      await this.showList();
    },

    async showList(message = '') {
      this.ctx.renderLoading();
      const params = new URLSearchParams(this.listState);
      const { res, data } = await this.ctx.api(`/api/partners?${params}`);
      if (!res.ok || !data?.ok) {
        this.ctx.app.innerHTML = this.kit.shell(
          'パートナーマスタ',
          `<section class="panel"><p class="error">${this.ctx.escapeHtml(data?.message || '取得失敗')}</p></section>`
        );
        this.kit.bindShell();
        return;
      }
      const rows = (data.partners || [])
        .map(
          (p) => `
          <tr>
            <td>${this.ctx.escapeHtml(p.partner_id)}</td>
            <td>${this.ctx.escapeHtml(p.partner_name)}</td>
            <td>${this.ctx.escapeHtml(this.kit.codeLabel(this.codes.partner_category, p.partner_category_code))}</td>
            <td>${this.ctx.escapeHtml(this.kit.codeLabel(this.codes.employment_type, p.employment_type_code))}</td>
            <td>${this.ctx.escapeHtml(p.contact_phone || '-')}</td>
            <td>
              <button type="button" class="btn btn-ghost btn-small" data-edit="${p.partner_id}">編集</button>
              <button type="button" class="btn btn-danger btn-small" data-del="${p.partner_id}">削除</button>
            </td>
          </tr>`
        )
        .join('');

      this.ctx.app.innerHTML = this.kit.shell(
        'パートナーマスタ（仮組）',
        `<section class="panel">
          ${message ? `<p class="flash">${this.ctx.escapeHtml(message)}</p>` : ''}
          <div class="toolbar">
            <input id="q" type="text" placeholder="名称・電話で検索" value="${this.ctx.escapeHtml(this.listState.q)}" />
            <select id="cat">${this.kit.codeOptions(this.codes.partner_category, this.listState.partner_category_code)}</select>
            <select id="emp">${this.kit.codeOptions(this.codes.employment_type, this.listState.employment_type_code)}</select>
            <button type="button" class="btn" id="search">検索</button>
            <button type="button" class="btn" id="new">＋ 新規</button>
          </div>
          <div class="table-wrap">
            <table class="data-table">
              <thead><tr><th>No</th><th>名称</th><th>区分</th><th>雇用</th><th>電話</th><th>操作</th></tr></thead>
              <tbody>${rows || '<tr><td colspan="6">データがありません</td></tr>'}</tbody>
            </table>
          </div>
        </section>`
      );
      this.kit.bindShell();
      document.getElementById('search')?.addEventListener('click', () => {
        this.listState.q = document.getElementById('q').value.trim();
        this.listState.partner_category_code = document.getElementById('cat').value;
        this.listState.employment_type_code = document.getElementById('emp').value;
        this.showList();
      });
      document.getElementById('new')?.addEventListener('click', () => this.showDetail(null));
      document.querySelectorAll('[data-edit]').forEach((btn) =>
        btn.addEventListener('click', () => this.showDetail(Number(btn.getAttribute('data-edit'))))
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

    vehicleHtml(v, idx) {
      return `
        <div class="child-block">
          <input type="hidden" name="vehicle_id_${idx}" value="${this.ctx.escapeHtml(v.vehicle_id || '')}" />
          <div class="form-grid">
            <div><label>車両名称</label><input name="vehicle_name_${idx}" value="${this.ctx.escapeHtml(v.vehicle_name || '')}" /></div>
            <div><label>車両番号</label><input name="vehicle_number_${idx}" value="${this.ctx.escapeHtml(v.vehicle_number || '')}" /></div>
            <div><label>車検期限</label><input type="date" name="inspection_expiry_date_${idx}" value="${this.ctx.escapeHtml(this.kit.dateValue(v.inspection_expiry_date))}" /></div>
            <div><label>保険期限</label><input type="date" name="insurance_expiry_date_${idx}" value="${this.ctx.escapeHtml(this.kit.dateValue(v.insurance_expiry_date))}" /></div>
          </div>
          <button type="button" class="btn btn-danger btn-small" data-remove-vehicle="${idx}">削除</button>
        </div>`;
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
        branch_name: '',
        account_number: '',
        deposit_type: '',
        account_name: '',
        vehicles: [],
      };
      if (id) {
        const { res, data } = await this.ctx.api(`/api/partners/${id}`);
        if (!res.ok || !data?.ok) {
          this.ctx.app.innerHTML = this.kit.shell('パートナー詳細', `<section class="panel"><p class="error">${this.ctx.escapeHtml(data?.message || '取得失敗')}</p></section>`);
          this.kit.bindShell();
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
            <h3 class="section-title">基本情報</h3>
            <div class="form-grid">
              <div><label>名称（必須）</label><input name="partner_name" required value="${this.ctx.escapeHtml(partner.partner_name || '')}" /></div>
              <div><label>カナ</label><input name="partner_name_kana" value="${this.ctx.escapeHtml(partner.partner_name_kana || '')}" /></div>
              <div><label>郵便番号</label><input name="zip_code" value="${this.ctx.escapeHtml(partner.zip_code || '')}" /></div>
              <div class="full"><label>住所</label><input name="address" value="${this.ctx.escapeHtml(partner.address || '')}" /></div>
              <div><label>電話</label><input name="contact_phone" value="${this.ctx.escapeHtml(partner.contact_phone || '')}" /></div>
              <div><label>契約日</label><input type="date" name="contract_date" value="${this.ctx.escapeHtml(this.kit.dateValue(partner.contract_date))}" /></div>
              <div><label>区分</label><select name="partner_category_code">${this.kit.codeOptions(this.codes.partner_category, partner.partner_category_code)}</select></div>
              <div><label>雇用区分</label><select name="employment_type_code">${this.kit.codeOptions(this.codes.employment_type, partner.employment_type_code)}</select></div>
              <div><label>インボイス番号</label><input name="invoice_number" value="${this.ctx.escapeHtml(partner.invoice_number || '')}" /></div>
              <div class="full"><label class="check-item"><input type="checkbox" name="advance_payment_enabled" ${partner.advance_payment_enabled ? 'checked' : ''} /><span>先払い対象</span></label></div>
            </div>
            <h3 class="section-title">免許・各種区分・銀行</h3>
            <div class="form-grid">
              <div><label>免許期限</label><input type="date" name="license_expiry_date" value="${this.ctx.escapeHtml(this.kit.dateValue(partner.license_expiry_date))}" /></div>
              <div class="full"><label>免許種類</label><input name="license_types" value="${this.ctx.escapeHtml(partner.license_types || '')}" /></div>
              <div class="full"><label>安全大会履歴</label><textarea name="safety_conference_history" rows="2">${this.ctx.escapeHtml(partner.safety_conference_history || '')}</textarea></div>
              <div><label>傷害保険</label><select name="accident_insurance_code">${this.kit.codeOptions(this.codes.accident_insurance, partner.accident_insurance_code)}</select></div>
              <div><label>請負賠償</label><select name="contractor_liability_code">${this.kit.codeOptions(this.codes.contractor_liability, partner.contractor_liability_code)}</select></div>
              <div><label>貨物保険</label><select name="cargo_insurance_code">${this.kit.codeOptions(this.codes.cargo_insurance, partner.cargo_insurance_code)}</select></div>
              <div><label>G会</label><select name="g_association_code">${this.kit.codeOptions(this.codes.g_association, partner.g_association_code)}</select></div>
              <div><label>確定申告</label><select name="tax_return_code">${this.kit.codeOptions(this.codes.tax_return, partner.tax_return_code)}</select></div>
              <div><label>ループ</label><select name="loop_code">${this.kit.codeOptions(this.codes.loop_code, partner.loop_code)}</select></div>
              <div><label>支払出力</label><select name="payment_output_code">${this.kit.codeOptions(this.codes.payment_output, partner.payment_output_code)}</select></div>
              <div><label>銀行名</label><input name="bank_name" value="${this.ctx.escapeHtml(partner.bank_name || '')}" /></div>
              <div><label>支店名</label><input name="branch_name" value="${this.ctx.escapeHtml(partner.branch_name || '')}" /></div>
              <div><label>口座種別</label><select name="deposit_type">${this.kit.codeOptions(this.codes.deposit_type, partner.deposit_type)}</select></div>
              <div><label>口座番号</label><input name="account_number" value="${this.ctx.escapeHtml(partner.account_number || '')}" /></div>
              <div><label>口座名義</label><input name="account_name" value="${this.ctx.escapeHtml(partner.account_name || '')}" /></div>
            </div>
            <div class="section-head">
              <h3 class="section-title">車両</h3>
              <button type="button" class="btn btn-ghost" id="add-vehicle">＋ 車両追加</button>
            </div>
            <div id="vehicles-area">${this.detailState.vehicles.map((v, i) => this.vehicleHtml(v, i)).join('') || '<p class="muted">車両なし</p>'}</div>
            <div class="btn-row">
              <button class="btn" type="submit">保存</button>
              <button class="btn btn-ghost" type="button" id="cancel">一覧へ</button>
            </div>
          </form>
        </section>`
      );
      this.kit.bindShell();
      document.getElementById('cancel')?.addEventListener('click', () => this.showList());
      document.getElementById('add-vehicle')?.addEventListener('click', () => {
        this.collectVehicles();
        this.detailState.vehicles.push(this.emptyVehicle());
        this.rerenderVehicles();
      });
      this.bindVehicleRemove();
      document.getElementById('partner-form')?.addEventListener('submit', async (e) => {
        e.preventDefault();
        await this.save(e.currentTarget);
      });
    },

    collectVehicles() {
      const form = document.getElementById('partner-form');
      if (!form) return;
      const vehicles = [];
      for (let i = 0; i < this.detailState.vehicles.length; i += 1) {
        if (!form[`vehicle_name_${i}`]) continue;
        const idVal = form[`vehicle_id_${i}`]?.value;
        vehicles.push({
          vehicle_id: idVal ? Number(idVal) : null,
          vehicle_name: form[`vehicle_name_${i}`].value,
          vehicle_number: form[`vehicle_number_${i}`].value,
          inspection_expiry_date: form[`inspection_expiry_date_${i}`].value || null,
          insurance_expiry_date: form[`insurance_expiry_date_${i}`].value || null,
        });
      }
      this.detailState.vehicles = vehicles;
    },

    rerenderVehicles() {
      const area = document.getElementById('vehicles-area');
      if (!area) return;
      area.innerHTML = this.detailState.vehicles.length
        ? this.detailState.vehicles.map((v, i) => this.vehicleHtml(v, i)).join('')
        : '<p class="muted">車両なし</p>';
      this.bindVehicleRemove();
    },

    bindVehicleRemove() {
      document.querySelectorAll('[data-remove-vehicle]').forEach((btn) => {
        btn.addEventListener('click', () => {
          this.collectVehicles();
          this.detailState.vehicles.splice(Number(btn.getAttribute('data-remove-vehicle')), 1);
          this.rerenderVehicles();
        });
      });
    },

    async save(form) {
      const errorEl = document.getElementById('form-error');
      errorEl.textContent = '';
      this.collectVehicles();
      const payload = {
        partner_name: form.partner_name.value.trim(),
        partner_name_kana: form.partner_name_kana.value,
        zip_code: form.zip_code.value,
        address: form.address.value,
        contact_phone: form.contact_phone.value,
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
        bank_name: form.bank_name.value,
        branch_name: form.branch_name.value,
        deposit_type: form.deposit_type.value,
        account_number: form.account_number.value,
        account_name: form.account_name.value,
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
