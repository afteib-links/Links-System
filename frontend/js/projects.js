(() => {
  const LinksProjects = {
    async open(ctx, options = {}) {
      this.kit = window.LinksFeatureKit.createFeatureKit(ctx);
      this.ctx = ctx;
      this.companyFilter = options.company_id ? Number(options.company_id) : null;
      this.partnerFilter = options.partner_id ? Number(options.partner_id) : null;
      this.tab = options.tab || (options.featureKey === 'base_projects' ? 'base' : 'projects');
      this.baseListState = { sortKey: 'base_project_id', sortOrder: 'asc', filters: {} };
      this.projectListState = { sortKey: 'project_id', sortOrder: 'asc', filters: {} };
      this.codes = await this.kit.loadCodes();
      const [companies, partners, fees] = await Promise.all([
        this.ctx.api('/api/lookups/companies'),
        this.ctx.api('/api/lookups/partners'),
        this.ctx.api('/api/lookups/transfer-fees'),
      ]);
      this.companies = companies.data?.companies || [];
      this.partners = partners.data?.partners || [];
      this.transferFees = (fees.data?.transfer_fees || []).filter((row) => row.is_active);
      if (this.tab === 'base') await this.showBaseList();
      else await this.showProjectList();
    },

    titleBase() {
      return '基本案件（仮組）';
    },
    titleProjects() {
      return '個別案件（仮組）';
    },

    workFieldsHtml(row) {
      return `
        <div><label>稼働形態</label><select name="work_mode_code">${this.kit.codeOptions(this.codes.work_mode, row.work_mode_code)}</select></div>
        <div><label>日報カウント区分</label><select name="daily_count_type">${this.kit.codeOptions(this.codes.daily_count || this.codes.daily_count_type, row.daily_count_type)}</select></div>
        <div><label>残業計算区分</label><select name="overtime_calc_type">${this.kit.codeOptions(this.codes.overtime_calc, row.overtime_calc_type)}</select></div>
        <div><label>開始時刻</label><input type="time" name="execution_time_start" value="${this.ctx.escapeHtml(this.kit.timeValue(row.execution_time_start))}" /></div>
        <div><label>終了時刻</label><input type="time" name="execution_time_end" value="${this.ctx.escapeHtml(this.kit.timeValue(row.execution_time_end))}" /></div>
        <div><label>拘束時間</label><input name="binding_time" type="number" step="0.25" value="${this.ctx.escapeHtml(row.binding_time ?? '')}" /></div>
        <div><label>休憩</label><input name="break_time" type="number" step="0.25" value="${this.ctx.escapeHtml(row.break_time ?? '')}" /></div>
      `;
    },

    settlementFieldsHtml(row) {
      return `
        <div><label>支払区分</label>
          <select name="payment_type">
            <option value="normal" ${row.payment_type !== 'installment' ? 'selected' : ''}>通常</option>
            <option value="installment" ${row.payment_type === 'installment' ? 'selected' : ''}>分割</option>
          </select>
        </div>
        <div><label>分割単価</label><input name="installment_amount" type="number" step="0.01" value="${this.ctx.escapeHtml(row.installment_amount ?? '')}" /></div>
        ${isBase ? '' : `<div><label>振込手数料</label><select name="transfer_fee_pattern_id"><option value="">パートナー設定を使用</option>${this.transferFees.map((fee) => `<option value="${fee.transfer_fee_pattern_id}" ${Number(row.transfer_fee_pattern_id) === Number(fee.transfer_fee_pattern_id) ? 'selected' : ''}>${this.ctx.escapeHtml(fee.pattern_name)}（${Number(fee.amount).toLocaleString('ja-JP')}円）</option>`).join('')}</select></div>`}
        <div><label>運用開始日</label><input type="date" name="operation_start_date" value="${this.ctx.escapeHtml(this.kit.dateValue(row.operation_start_date))}" /></div>
        <div><label>締日</label><select name="closing_date">${this.kit.codeOptions(this.codes.closing_date, row.closing_date)}</select></div>
      `;
    },

    pickShared(form) {
      return {
        work_mode_code: form.work_mode_code?.value || null,
        daily_count_type: form.daily_count_type?.value || null,
        overtime_calc_type: form.overtime_calc_type?.value || null,
        execution_time_start: form.execution_time_start?.value || null,
        execution_time_end: form.execution_time_end?.value || null,
        binding_time: form.binding_time?.value || null,
        break_time: form.break_time?.value || null,
        payment_type: form.payment_type?.value || 'normal',
        installment_amount: form.installment_amount?.value || null,
        ...(form.transfer_fee_pattern_id ? { transfer_fee_pattern_id: form.transfer_fee_pattern_id.value || null } : {}),
        operation_start_date: form.operation_start_date?.value || null,
        closing_date: form.closing_date?.value || null,
      };
    },

    priceSetsSectionHtml(priceSets, ownerKind, ownerId, companyId) {
      const rows = (priceSets || [])
        .map(
          (ps) => `
          <tr>
            <td>${this.ctx.escapeHtml(ps.price_set_no || ps.price_set_id)}</td>
            <td>${this.ctx.escapeHtml(ps.price_set_name)}</td>
            <td>${this.ctx.escapeHtml(this.kit.dateValue(ps.apply_start_date) || '-')}</td>
            <td>${this.ctx.escapeHtml(this.kit.dateValue(ps.apply_end_date) || '〜')}</td>
            <td>${this.ctx.escapeHtml(ps.line_count ?? 0)}</td>
            <td>
              <button type="button" class="btn btn-ghost btn-small" data-edit-ps="${ps.price_set_id}">編集</button>
              <button type="button" class="btn btn-ghost btn-small" data-copy-ps="${ps.price_set_id}">コピー</button>
            </td>
          </tr>`
        )
        .join('');
      const ownerAttr =
        ownerKind === 'base'
          ? `data-owner-base="${ownerId}" data-owner-company="${companyId || ''}"`
          : `data-owner-project="${ownerId}" data-owner-company="${companyId || ''}"`;
      return `
        <h3 class="section-title">金額データ</h3>
        <p class="muted">前回の金額をコピーし、適用開始日・単価を変更して登録できます（期間が重なっても可。日報は開始日が新しいセットを優先）。</p>
        <div class="toolbar">
          <button type="button" class="btn" id="add-price-set" ${ownerAttr}>＋ 金額データ追加</button>
        </div>
        <div class="table-wrap">
          <table class="data-table data-table-compact" data-no-list-enhance>
            <thead><tr><th>No</th><th>名称</th><th>適用開始</th><th>適用終了</th><th>行数</th><th></th></tr></thead>
            <tbody>${rows || '<tr><td colspan="6">金額データがありません</td></tr>'}</tbody>
          </table>
        </div>`;
    },

    bindPriceSetsSection(ownerKind, ownerId, companyId, refreshFn) {
      document.getElementById('add-price-set')?.addEventListener('click', () => {
        const opts =
          ownerKind === 'base'
            ? {
                base_project_id: ownerId,
                company_id: companyId,
                new_with_owner: true,
                returnTo: refreshFn,
              }
            : {
                project_id: ownerId,
                company_id: companyId,
                new_with_owner: true,
                returnTo: refreshFn,
              };
        this.ctx.openFeature?.('price_sets', opts);
      });
      document.querySelectorAll('[data-edit-ps]').forEach((btn) =>
        btn.addEventListener('click', () => {
          const psId = Number(btn.getAttribute('data-edit-ps'));
          this.ctx.openFeature?.('price_sets', { price_set_id: psId, returnTo: refreshFn });
        })
      );
      document.querySelectorAll('[data-copy-ps]').forEach((btn) =>
        btn.addEventListener('click', async () => {
          const psId = Number(btn.getAttribute('data-copy-ps'));
          const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Tokyo' }).format(new Date());
          const applyStart = window.prompt('新しい適用開始日（必須）', today);
          if (!applyStart || !applyStart.trim()) return;
          const body =
            ownerKind === 'base'
              ? { base_project_id: ownerId, apply_start_date: applyStart.trim() }
              : { project_id: ownerId, apply_start_date: applyStart.trim() };
          const result = await this.ctx.api(`/api/price-sets/${psId}/copy`, {
            method: 'POST',
            body: JSON.stringify(body),
          });
          if (!result.res.ok || !result.data?.ok) {
            window.alert(result.data?.message || 'コピー失敗');
            return;
          }
          const newId = result.data.price_set?.price_set_id;
          this.ctx.openFeature?.('price_sets', { price_set_id: newId, returnTo: refreshFn });
        })
      );
    },

    async showBaseList(message = '') {
      this.ctx.renderLoading();
      const params = new URLSearchParams();
      if (this.companyFilter) params.set('company_id', this.companyFilter);
      const { res, data } = await this.ctx.api(`/api/projects/base?${params}`);
      if (!res.ok || !data?.ok) {
        this.ctx.app.innerHTML = this.kit.shell(
          this.titleBase(),
          `<section class="panel"><p class="error">${this.ctx.escapeHtml(data?.message || '取得失敗')}</p></section>`
        );
        this.kit.bindShell();
        return;
      }
      const baseRows = data.base_projects || [];
      const table = window.LinksDataTable.renderTable({
        screenKey: 'base_projects',
        columns: [
          { key: 'base_project_id', label: 'No' },
          { key: 'company_name', label: '企業', getValue: (row) => row.company_name || row.company_id },
          { key: 'template_name', label: 'テンプレ名' },
          { key: 'default_manager', label: '担当' },
          { key: 'work_mode_code', label: '稼働形態', getValue: (row) => this.kit.codeLabel(this.codes.work_mode, row.work_mode_code) },
          { key: 'closing_date', label: '締日', getValue: (row) => this.kit.codeLabel(this.codes.closing_date, row.closing_date) },
        ],
        rows: baseRows,
        sortKey: this.baseListState.sortKey,
        sortOrder: this.baseListState.sortOrder,
        filters: this.baseListState.filters,
        escapeHtml: this.ctx.escapeHtml,
        rowKey: 'base_project_id',
        tableId: 'base-projects-table',
        renderActions: (b) => `<button type="button" class="btn btn-ghost btn-small" data-edit-base="${b.base_project_id}">編集</button>
          <button type="button" class="btn btn-small" data-create-project="${b.base_project_id}">案件作成</button>
          <button type="button" class="btn btn-danger btn-small" data-del-base="${b.base_project_id}">削除</button>`,
      });
      this.ctx.app.innerHTML = this.kit.shell(
        this.titleBase(),
        `<section class="panel">
          ${message ? `<p class="flash">${this.ctx.escapeHtml(message)}</p>` : ''}
          <div class="toolbar">
            <select id="company-filter">
              <option value="">企業すべて</option>
              ${this.companies
                .map(
                  (c) =>
                    `<option value="${c.company_id}" ${
                      Number(this.companyFilter) === Number(c.company_id) ? 'selected' : ''
                    }>${this.ctx.escapeHtml(c.company_name)}</option>`
                )
                .join('')}
            </select>
            <button type="button" class="btn" id="apply-filter">絞込</button>
            <button type="button" class="btn" id="new-base">＋ 基本案件</button>
          </div>
          <div id="base-list-root">${table.html}</div>
        </section>`
      );
      this.kit.bindShell();
      window.LinksDataTable.bindTable('#base-list-root', {
        onSort: (key) => {
          this.baseListState.sortOrder = this.baseListState.sortKey === key && this.baseListState.sortOrder === 'asc' ? 'desc' : 'asc';
          this.baseListState.sortKey = key;
          this.showBaseList(message);
        },
        onFilter: (filters) => { this.baseListState.filters = filters; this.showBaseList(message); },
        onActivate: (key) => { this.kit.pushNav(() => this.showBaseList()); this.showBaseDetail(Number(key)); },
      });
      document.getElementById('apply-filter')?.addEventListener('click', () => {
        const v = document.getElementById('company-filter').value;
        this.companyFilter = v ? Number(v) : null;
        this.showBaseList();
      });
      document.getElementById('new-base')?.addEventListener('click', () => {
        this.kit.pushNav(() => this.showBaseList());
        this.showBaseDetail(null);
      });
      document.querySelectorAll('[data-edit-base]').forEach((btn) =>
        btn.addEventListener('click', () => {
          this.kit.pushNav(() => this.showBaseList());
          this.showBaseDetail(Number(btn.getAttribute('data-edit-base')));
        })
      );
      document.querySelectorAll('[data-create-project]').forEach((btn) =>
        btn.addEventListener('click', async () => {
          const baseId = btn.getAttribute('data-create-project');
          const result = await this.ctx.api(`/api/projects/base/${baseId}/create-project`, {
            method: 'POST',
            body: '{}',
          });
          if (!result.res.ok || !result.data?.ok) {
            window.alert(result.data?.message || '案件作成失敗');
            return;
          }
          const n = result.data.copied_price_set_count;
          if (n != null) this.ctx.showToast(`金額データを${n}件コピーしました`);
          const projectId = result.data.project?.project_id;
          this.tab = 'projects';
          this.kit.pushNav(() => this.showBaseList());
          await this.showProjectDetail(projectId);
        })
      );
      document.querySelectorAll('[data-del-base]').forEach((btn) =>
        btn.addEventListener('click', async () => {
          if (!window.confirm('削除しますか？')) return;
          const result = await this.ctx.api(`/api/projects/base/${btn.getAttribute('data-del-base')}`, {
            method: 'DELETE',
          });
          if (!result.res.ok) {
            window.alert(result.data?.message || '削除失敗');
            return;
          }
          await this.showBaseList('削除しました');
        })
      );
    },

    async showBaseDetail(id) {
      this.ctx.renderLoading();
      let row = {
        base_project_id: null,
        version: 1,
        company_id: this.companyFilter || '',
        template_name: '',
        default_manager: '',
        business_type: '',
        basic_work_hours: '',
        work_time_type: '',
        work_mode_code: '',
        daily_count_type: '',
        overtime_calc_type: '',
        execution_time_start: '',
        execution_time_end: '',
        binding_time: '',
        break_time: '',
        payment_type: 'normal',
        installment_amount: '',
        operation_start_date: '',
        closing_date: '',
        price_sets: [],
      };
      if (id) {
        const { res, data } = await this.ctx.api(`/api/projects/base/${id}`);
        if (!res.ok || !data?.ok) {
          this.ctx.app.innerHTML = this.kit.shell(
            '基本案件',
            `<section class="panel"><p class="error">${this.ctx.escapeHtml(data?.message || '取得失敗')}</p></section>`,
            { onBack: () => this.showBaseList() }
          );
          this.kit.bindShell({ onBack: () => this.showBaseList() });
          return;
        }
        row = data.base_project;
      }
      this.ctx.app.innerHTML = this.kit.shell(
        id ? `基本案件編集（No.${id}）` : '基本案件登録',
        `<section class="panel">
          <p class="error" id="form-error"></p>
          <form id="base-form">
            <div class="form-sections">
              <section class="form-section-card"><h3>基本情報</h3><div class="form-grid form-grid-compact">
                <div class="field-md"><label>企業（必須）</label>${this.kit.searchSelectHtml('company_id', this.companies, 'company_id', 'company_name', row.company_id, { required:true })}</div>
                <div class="field-md"><label>テンプレ名（必須）</label><input name="template_name" required value="${this.ctx.escapeHtml(row.template_name || '')}" /></div>
                <div class="field-md"><label>デフォルト担当</label><input name="default_manager" value="${this.ctx.escapeHtml(row.default_manager || '')}" /></div>
                <div class="field-md"><label>業種</label><input name="business_type" value="${this.ctx.escapeHtml(row.business_type || '')}" /></div>
              </div></section>
              <section class="form-section-card"><h3>勤務・稼働条件</h3><div class="form-grid form-grid-compact">
                <div class="field-sm"><label>基本勤務時間</label><input name="basic_work_hours" type="number" step="0.25" value="${this.ctx.escapeHtml(row.basic_work_hours ?? '')}" /></div>
                <div class="field-sm"><label>時間種別</label><select name="work_time_type">${this.kit.codeOptions(this.codes.work_time_type, row.work_time_type)}</select></div>
                ${this.workFieldsHtml(row)}
              </div></section>
              <section class="form-section-card"><h3>支払・締め条件</h3><div class="form-grid form-grid-compact">${this.settlementFieldsHtml(row)}</div></section>
            </div>
            <div class="btn-row form-actions-sticky">
              <button class="btn" type="submit">保存</button>
              ${id ? '<button class="btn" type="button" id="create-from-base">案件作成</button>' : ''}
              <button class="btn btn-ghost" type="button" id="cancel">一覧へ</button>
            </div>
          </form>
          ${id ? this.priceSetsSectionHtml(row.price_sets, 'base', id, row.company_id) : ''}
        </section>`,
        { onBack: () => this.showBaseList() }
      );
      this.kit.bindShell({ onBack: () => this.showBaseList() });
      this.kit.bindSearchSelects(document.getElementById('base-form'));
      document.getElementById('cancel')?.addEventListener('click', () => this.showBaseList());
      document.getElementById('create-from-base')?.addEventListener('click', async () => {
        const result = await this.ctx.api(`/api/projects/base/${id}/create-project`, {
          method: 'POST',
          body: '{}',
        });
        if (!result.res.ok || !result.data?.ok) {
          window.alert(result.data?.message || '案件作成失敗');
          return;
        }
        const n = result.data.copied_price_set_count;
        if (n != null) this.ctx.showToast(`金額データを${n}件コピーしました`);
        this.tab = 'projects';
        this.kit.pushNav(() => this.showBaseList());
        await this.showProjectDetail(result.data.project.project_id);
      });
      document.getElementById('base-form')?.addEventListener('submit', async (e) => {
        e.preventDefault();
        const form = e.currentTarget;
        const payload = {
          company_id: Number(form.company_id.value),
          template_name: form.template_name.value.trim(),
          default_manager: form.default_manager.value,
          business_type: form.business_type.value,
          basic_work_hours: form.basic_work_hours.value || null,
          work_time_type: form.work_time_type.value || null,
          ...this.pickShared(form),
          version: row.version || 1,
        };
        const result = id
          ? await this.ctx.api(`/api/projects/base/${id}`, { method: 'PUT', body: JSON.stringify(payload) })
          : await this.ctx.api('/api/projects/base', { method: 'POST', body: JSON.stringify(payload) });
        if (!result.res.ok || !result.data?.ok) {
          document.getElementById('form-error').textContent = result.data?.message || '保存失敗';
          return;
        }
        await this.showBaseList(id ? '更新しました' : '登録しました');
      });
      if (id) {
        this.bindPriceSetsSection('base', id, row.company_id, () => this.showBaseDetail(id));
      }
    },

    async showProjectList(message = '') {
      this.ctx.renderLoading();
      const params = new URLSearchParams();
      if (this.companyFilter) params.set('company_id', this.companyFilter);
      if (this.partnerFilter) params.set('partner_id', this.partnerFilter);
      const { res, data } = await this.ctx.api(`/api/projects?${params}`);
      if (!res.ok || !data?.ok) {
        this.ctx.app.innerHTML = this.kit.shell(
          this.titleProjects(),
          `<section class="panel"><p class="error">${this.ctx.escapeHtml(data?.message || '取得失敗')}</p></section>`
        );
        this.kit.bindShell();
        return;
      }
      const projectRows = data.projects || [];
      const table = window.LinksDataTable.renderTable({
        screenKey: 'projects',
        columns: [
          { key: 'project_id', label: 'No' },
          { key: 'company_name', label: '企業', getValue: (row) => row.company_name || row.company_id },
          { key: 'partner_name', label: 'パートナー' },
          { key: 'base_template_name', label: '基本案件' },
          { key: 'payment_type', label: '支払', getValue: (row) => row.payment_type === 'installment' ? '分割' : '通常', filterOptions: [{value:'通常',label:'通常'},{value:'分割',label:'分割'}], filterMode: 'exact' },
          { key: 'closing_date', label: '締日', getValue: (row) => this.kit.codeLabel(this.codes.closing_date, row.closing_date) },
        ],
        rows: projectRows,
        sortKey: this.projectListState.sortKey,
        sortOrder: this.projectListState.sortOrder,
        filters: this.projectListState.filters,
        escapeHtml: this.ctx.escapeHtml,
        rowKey: 'project_id',
        tableId: 'projects-table',
        renderActions: (p) => `<button type="button" class="btn btn-ghost btn-small" data-edit="${p.project_id}">編集</button>
          <button type="button" class="btn btn-danger btn-small" data-del="${p.project_id}">削除</button>`,
      });
      this.ctx.app.innerHTML = this.kit.shell(
        this.titleProjects(),
        `<section class="panel">
          ${message ? `<p class="flash">${this.ctx.escapeHtml(message)}</p>` : ''}
          ${this.partnerFilter ? `<p class="muted">パートナーNo.${this.partnerFilter} で絞込中</p>` : ''}
          <div class="toolbar">
            <select id="company-filter">
              <option value="">企業すべて</option>
              ${this.companies
                .map(
                  (c) =>
                    `<option value="${c.company_id}" ${
                      Number(this.companyFilter) === Number(c.company_id) ? 'selected' : ''
                    }>${this.ctx.escapeHtml(c.company_name)}</option>`
                )
                .join('')}
            </select>
            <button type="button" class="btn" id="apply-filter">絞込</button>
            <button type="button" class="btn btn-ghost" id="clear-partner" ${this.partnerFilter ? '' : 'hidden'}>パートナー絞込解除</button>
            <button type="button" class="btn" id="new-project">＋ 個別案件</button>
          </div>
          <div id="project-list-root">${table.html}</div>
        </section>`
      );
      this.kit.bindShell();
      window.LinksDataTable.bindTable('#project-list-root', {
        onSort: (key) => {
          this.projectListState.sortOrder = this.projectListState.sortKey === key && this.projectListState.sortOrder === 'asc' ? 'desc' : 'asc';
          this.projectListState.sortKey = key;
          this.showProjectList(message);
        },
        onFilter: (filters) => { this.projectListState.filters = filters; this.showProjectList(message); },
        onActivate: (key) => { this.kit.pushNav(() => this.showProjectList()); this.showProjectDetail(Number(key)); },
      });
      document.getElementById('apply-filter')?.addEventListener('click', () => {
        const v = document.getElementById('company-filter').value;
        this.companyFilter = v ? Number(v) : null;
        this.showProjectList();
      });
      document.getElementById('clear-partner')?.addEventListener('click', () => {
        this.partnerFilter = null;
        this.showProjectList();
      });
      document.getElementById('new-project')?.addEventListener('click', () => {
        this.kit.pushNav(() => this.showProjectList());
        this.showProjectDetail(null);
      });
      document.querySelectorAll('[data-edit]').forEach((btn) =>
        btn.addEventListener('click', () => {
          this.kit.pushNav(() => this.showProjectList());
          this.showProjectDetail(Number(btn.getAttribute('data-edit')));
        })
      );
      document.querySelectorAll('[data-del]').forEach((btn) =>
        btn.addEventListener('click', async () => {
          if (!window.confirm('削除しますか？')) return;
          const result = await this.ctx.api(`/api/projects/${btn.getAttribute('data-del')}`, { method: 'DELETE' });
          if (!result.res.ok) {
            window.alert(result.data?.message || '削除失敗');
            return;
          }
          await this.showProjectList('削除しました');
        })
      );
    },

    async showProjectDetail(id) {
      this.ctx.renderLoading();
      let project = {
        project_id: null,
        version: 1,
        company_id: this.companyFilter || '',
        base_project_id: '',
        partner_id: this.partnerFilter || '',
        vehicle_id: '',
        vehicle_owner_type: '',
        manager_name: '',
        business_type: '',
        payment_type: 'normal',
        installment_amount: '',
        operation_start_date: '',
        closing_date: '',
        execution_time_start: '',
        execution_time_end: '',
        binding_time: '',
        break_time: '',
        work_mode_code: '',
        daily_count_type: '',
        overtime_calc_type: '',
        revisions: [],
        price_sets: [],
      };
      if (id) {
        const { res, data } = await this.ctx.api(`/api/projects/${id}`);
        if (!res.ok || !data?.ok) {
          this.ctx.app.innerHTML = this.kit.shell(
            '案件詳細',
            `<section class="panel"><p class="error">${this.ctx.escapeHtml(data?.message || '取得失敗')}</p></section>`,
            { onBack: () => this.showProjectList() }
          );
          this.kit.bindShell({ onBack: () => this.showProjectList() });
          return;
        }
        project = data.project;
      }
      const bases = await this.ctx.api(
        `/api/lookups/base-projects${project.company_id ? `?company_id=${project.company_id}` : ''}`
      );
      this.baseProjects = bases.data?.base_projects || [];
      this.projectVehicles = [];
      if (project.vehicle_owner_type) {
        const ownerId = project.vehicle_owner_type === 'company' ? project.company_id : project.partner_id;
        if (ownerId) {
          const vehicles = await this.ctx.api(`/api/lookups/vehicles?owner_type=${project.vehicle_owner_type}&owner_id=${ownerId}`);
          this.projectVehicles = vehicles.data?.vehicles || [];
        }
      }

      const revRows = (project.revisions || [])
        .map(
          (r) => `
          <tr>
            <td>${this.ctx.escapeHtml(this.kit.dateValue(r.revision_start_date))}</td>
            <td>${this.ctx.escapeHtml(this.kit.dateValue(r.revision_end_date) || '〜')}</td>
            <td>${r.is_auto_generated ? '自動' : '手動'}</td>
            <td>${this.ctx.escapeHtml(r.billing_base_price ?? '-')}</td>
            <td>${this.ctx.escapeHtml(r.payment_base_price ?? '-')}</td>
          </tr>`
        )
        .join('');

      this.ctx.app.innerHTML = this.kit.shell(
        id ? `個別案件編集（No.${id}）` : '個別案件登録',
        `<section class="panel">
          <p class="error" id="form-error"></p>
          <form id="project-form">
            ${
              !id
                ? `<section class="form-section-card"><div class="toolbar">
              <label>基本案件テンプレート</label>
              <div id="template-picker">${this.kit.searchSelectHtml('template_picker', this.baseProjects, 'base_project_id', 'template_name', '')}</div>
              <button type="button" class="btn btn-ghost" id="apply-template">テンプレ反映</button>
            </div></section>`
                : ''
            }
            <div class="form-sections">
              <section class="form-section-card"><h3>基本情報・担当</h3><div class="form-grid form-grid-compact">
                <div class="field-md"><label>企業（必須）</label><div id="project-company">${this.kit.searchSelectHtml('company_id', this.companies, 'company_id', 'company_name', project.company_id, { required:true })}</div></div>
                <div class="field-md"><label>基本案件</label><div id="project-base">${this.kit.searchSelectHtml('base_project_id', this.baseProjects, 'base_project_id', 'template_name', project.base_project_id)}</div></div>
                <div class="field-md"><label>パートナー</label>${this.kit.searchSelectHtml('partner_id', this.partners, 'partner_id', 'partner_name', project.partner_id)}</div>
                <div class="field-md"><label>担当者</label><input name="manager_name" value="${this.ctx.escapeHtml(project.manager_name || '')}" /></div>
                <div class="field-md"><label>業種</label><input name="business_type" value="${this.ctx.escapeHtml(project.business_type || '')}" /></div>
              </div></section>
              <section class="form-section-card"><h3>車両</h3><div class="form-grid form-grid-compact">
                <div class="field-sm"><label>車両所有元</label><select name="vehicle_owner_type" id="vehicle-owner-type"><option value="">（未選択）</option><option value="company" ${project.vehicle_owner_type === 'company' ? 'selected' : ''}>企業</option><option value="partner" ${project.vehicle_owner_type === 'partner' ? 'selected' : ''}>パートナー</option></select></div>
                <div class="field-md"><label>車両</label><div id="project-vehicle">${this.kit.searchSelectHtml('vehicle_id', this.projectVehicles, 'vehicle_id', 'vehicle_name', project.vehicle_id, { formatLabel:(row) => `${row.vehicle_name || '名称なし'} / ${row.vehicle_number || '番号なし'} (#${row.vehicle_id})`, aliasKeys:['vehicle_number'] })}</div></div>
                ${project.vehicle_id && !project.vehicle_owner_type ? '<div class="full field-warning">既存車両の所有元を判定できません。所有元と車両を選び直してください。</div>' : ''}
              </div></section>
              <section class="form-section-card"><h3>勤務・稼働条件</h3><div class="form-grid form-grid-compact">${this.workFieldsHtml(project)}</div></section>
              <section class="form-section-card"><h3>支払・締め条件</h3><div class="form-grid form-grid-compact">${this.settlementFieldsHtml(project)}</div></section>
            </div>
            ${
              id
                ? ''
                : `<h3 class="section-title">初回改定（任意）</h3>
            <div class="form-grid">
              <div><label>適用開始日</label><input type="date" name="rev_start" /></div>
              <div><label>請求基本単価</label><input type="number" step="0.01" name="rev_billing" /></div>
              <div><label>支払基本単価</label><input type="number" step="0.01" name="rev_payment" /></div>
            </div>`
            }
            <div class="btn-row form-actions-sticky">
              <button class="btn" type="submit">保存</button>
              <button class="btn btn-ghost" type="button" id="cancel">一覧へ</button>
            </div>
          </form>
          ${id ? this.priceSetsSectionHtml(project.price_sets, 'project', id, project.company_id) : ''}
          ${
            id
              ? `<h3 class="section-title">改定履歴（レガシー・参照のみ）</h3>
            <p class="muted">金額の正は上の金額データ（PriceSet）です。改定履歴は移行前データの参照用です。</p>
            <div class="table-wrap">
              <table class="data-table data-table-compact" data-no-list-enhance>
                <thead><tr><th>開始</th><th>終了</th><th>種別</th><th>請求単価</th><th>支払単価</th></tr></thead>
                <tbody>${revRows || '<tr><td colspan="5">改定なし</td></tr>'}</tbody>
              </table>
            </div>`
              : ''
          }
        </section>`,
        { onBack: () => this.showProjectList() }
      );
      this.kit.bindShell({ onBack: () => this.showProjectList() });
      this.kit.bindSearchSelects(document.getElementById('project-form'));
      document.getElementById('cancel')?.addEventListener('click', () => this.showProjectList());
      const projectForm = document.getElementById('project-form');
      const replaceSearchSelect = (containerId, name, list, valueKey, labelKey, selected, options = {}) => {
        const container = document.getElementById(containerId);
        if (!container) return;
        container.innerHTML = this.kit.searchSelectHtml(name, list, valueKey, labelKey, selected, options);
        this.kit.bindSearchSelects(container);
      };
      const reloadVehicles = async () => {
        const ownerType = projectForm.vehicle_owner_type.value;
        const ownerId = ownerType === 'company' ? projectForm.company_id.value : projectForm.partner_id.value;
        this.projectVehicles = [];
        if (ownerType && ownerId) {
          const response = await this.ctx.api(`/api/lookups/vehicles?owner_type=${ownerType}&owner_id=${ownerId}`);
          this.projectVehicles = response.data?.vehicles || [];
        }
        replaceSearchSelect('project-vehicle', 'vehicle_id', this.projectVehicles, 'vehicle_id', 'vehicle_name', '', {
          formatLabel:(row) => `${row.vehicle_name || '名称なし'} / ${row.vehicle_number || '番号なし'} (#${row.vehicle_id})`,
          aliasKeys:['vehicle_number'],
        });
      };
      projectForm.company_id?.addEventListener('change', async (e) => {
        const cid = e.target.value;
        const basesRes = await this.ctx.api(`/api/lookups/base-projects?company_id=${cid}`);
        this.baseProjects = basesRes.data?.base_projects || [];
        replaceSearchSelect('project-base', 'base_project_id', this.baseProjects, 'base_project_id', 'template_name', '');
        replaceSearchSelect('template-picker', 'template_picker', this.baseProjects, 'base_project_id', 'template_name', '');
        if (projectForm.vehicle_owner_type.value === 'company') await reloadVehicles();
      });
      projectForm.partner_id?.addEventListener('change', async () => {
        if (projectForm.vehicle_owner_type.value === 'partner') await reloadVehicles();
      });
      projectForm.vehicle_owner_type?.addEventListener('change', reloadVehicles);
      document.getElementById('apply-template')?.addEventListener('click', async () => {
        const baseId = projectForm.template_picker?.value;
        if (!baseId) return;
        const { res, data } = await this.ctx.api(`/api/projects/base/${baseId}`);
        if (!res.ok || !data?.ok) {
          window.alert(data?.message || 'テンプレ取得失敗');
          return;
        }
        const b = data.base_project;
        const form = document.getElementById('project-form');
        if (!form) return;
        const companyOption = document.querySelector(`[data-search-select="company_id"] .search-select-option[data-value="${b.company_id}"]`);
        if (companyOption) {
          form.company_id.value = String(b.company_id || '');
          const input = companyOption.closest('.search-select').querySelector('.search-select-input');
          input.value = companyOption.dataset.label;
          input.dataset.selectedLabel = companyOption.dataset.label;
        }
        const basesRes = await this.ctx.api(`/api/lookups/base-projects?company_id=${b.company_id}`);
        this.baseProjects = basesRes.data?.base_projects || [];
        replaceSearchSelect('project-base', 'base_project_id', this.baseProjects, 'base_project_id', 'template_name', b.base_project_id);
        if (form.vehicle_owner_type.value === 'company') await reloadVehicles();
        form.manager_name.value = b.default_manager || '';
        form.business_type.value = b.business_type || '';
        form.work_mode_code.value = b.work_mode_code || '';
        form.daily_count_type.value = b.daily_count_type || '';
        form.overtime_calc_type.value = b.overtime_calc_type || '';
        form.execution_time_start.value = this.kit.timeValue(b.execution_time_start);
        form.execution_time_end.value = this.kit.timeValue(b.execution_time_end);
        form.binding_time.value = b.binding_time ?? '';
        form.break_time.value = b.break_time ?? '';
        form.payment_type.value = b.payment_type || 'normal';
        form.installment_amount.value = b.installment_amount ?? '';
        form.operation_start_date.value = this.kit.dateValue(b.operation_start_date);
        form.closing_date.value = b.closing_date || '';
        this.ctx.showToast('テンプレートを反映しました');
      });
      document.getElementById('project-form')?.addEventListener('submit', async (e) => {
        e.preventDefault();
        const form = e.currentTarget;
        const payload = {
          company_id: Number(form.company_id.value),
          base_project_id: form.base_project_id.value ? Number(form.base_project_id.value) : null,
          partner_id: form.partner_id.value ? Number(form.partner_id.value) : null,
          vehicle_id: form.vehicle_id.value ? Number(form.vehicle_id.value) : null,
          vehicle_owner_type: form.vehicle_id.value ? (form.vehicle_owner_type.value || null) : null,
          manager_name: form.manager_name.value,
          business_type: form.business_type.value,
          ...this.pickShared(form),
          version: project.version || 1,
        };
        if (!id && form.rev_start?.value) {
          payload.initial_revision = {
            revision_start_date: form.rev_start.value,
            billing_base_price: form.rev_billing.value || null,
            payment_base_price: form.rev_payment.value || null,
          };
        }
        const result = id
          ? await this.ctx.api(`/api/projects/${id}`, { method: 'PUT', body: JSON.stringify(payload) })
          : await this.ctx.api('/api/projects', { method: 'POST', body: JSON.stringify(payload) });
        if (!result.res.ok || !result.data?.ok) {
          document.getElementById('form-error').textContent = result.data?.message || '保存失敗';
          return;
        }
        if (id) await this.showProjectDetail(id);
        else {
          const n = result.data.copied_price_set_count;
          if (n != null && n > 0) this.ctx.showToast(`金額データを${n}件コピーしました`);
          await this.showProjectList('登録しました');
        }
      });
      if (id) {
        this.bindPriceSetsSection('project', id, project.company_id, () => this.showProjectDetail(id));
      }
    },
  };

  window.LinksProjects = LinksProjects;
})();
