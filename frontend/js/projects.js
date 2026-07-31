(() => {
  const LinksProjects = {
    async open(ctx, options = {}) {
      this.kit = window.LinksFeatureKit.createFeatureKit(ctx);
      this.ctx = ctx;
      this.companyFilter = options.company_id ? Number(options.company_id) : null;
      this.partnerFilter = options.partner_id ? Number(options.partner_id) : null;
      this.tab = options.tab || (options.featureKey === 'base_projects' ? 'base' : 'projects');
      this.codes = await this.kit.loadCodes();
      const [companies, partners, priceSets] = await Promise.all([
        this.ctx.api('/api/lookups/companies'),
        this.ctx.api('/api/lookups/partners'),
        this.ctx.api('/api/price-sets').catch(() => ({ res: { ok: false }, data: null })),
      ]);
      this.companies = companies.data?.companies || [];
      this.partners = partners.data?.partners || [];
      this.priceSets = priceSets.data?.price_sets || [];
      if (this.tab === 'base') await this.showBaseList();
      else await this.showProjectList();
    },

    titleBase() {
      return '基本案件（仮組）';
    },
    titleProjects() {
      return '個別案件（仮組）';
    },

    sharedFieldsHtml(row, isBase) {
      return `
        <div><label>稼働形態</label><select name="work_mode_code">${this.kit.codeOptions(this.codes.work_mode, row.work_mode_code)}</select></div>
        <div><label>日報カウント区分</label><select name="daily_count_type">${this.kit.codeOptions(this.codes.daily_count || this.codes.daily_count_type, row.daily_count_type)}</select></div>
        <div><label>残業計算区分</label><select name="overtime_calc_type">${this.kit.codeOptions(this.codes.overtime_calc, row.overtime_calc_type)}</select></div>
        <div><label>開始時刻</label><input type="time" name="execution_time_start" value="${this.ctx.escapeHtml(this.kit.timeValue(row.execution_time_start))}" /></div>
        <div><label>終了時刻</label><input type="time" name="execution_time_end" value="${this.ctx.escapeHtml(this.kit.timeValue(row.execution_time_end))}" /></div>
        <div><label>拘束時間</label><input name="binding_time" type="number" step="0.25" value="${this.ctx.escapeHtml(row.binding_time ?? '')}" /></div>
        <div><label>休憩</label><input name="break_time" type="number" step="0.25" value="${this.ctx.escapeHtml(row.break_time ?? '')}" /></div>
        <div><label>金額データ</label><select name="price_set_id">${this.kit.optionsFromList(this.priceSets, 'price_set_id', 'price_set_name', row.price_set_id)}</select></div>
        <div><label>支払区分</label>
          <select name="payment_type">
            <option value="normal" ${row.payment_type !== 'installment' ? 'selected' : ''}>通常</option>
            <option value="installment" ${row.payment_type === 'installment' ? 'selected' : ''}>分割</option>
          </select>
        </div>
        <div><label>分割単価</label><input name="installment_amount" type="number" step="0.01" value="${this.ctx.escapeHtml(row.installment_amount ?? '')}" /></div>
        <div><label>運用開始日</label><input type="date" name="operation_start_date" value="${this.ctx.escapeHtml(this.kit.dateValue(row.operation_start_date))}" /></div>
        <div><label>締日</label><select name="closing_date">${this.kit.codeOptions(this.codes.closing_date, row.closing_date)}</select></div>
        ${isBase ? '' : ''}
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
        price_set_id: form.price_set_id?.value ? Number(form.price_set_id.value) : null,
        payment_type: form.payment_type?.value || 'normal',
        installment_amount: form.installment_amount?.value || null,
        operation_start_date: form.operation_start_date?.value || null,
        closing_date: form.closing_date?.value || null,
      };
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
      const rows = (data.base_projects || [])
        .map(
          (b) => `
          <tr>
            <td>${this.ctx.escapeHtml(b.base_project_id)}</td>
            <td>${this.ctx.escapeHtml(b.company_name || b.company_id)}</td>
            <td>${this.ctx.escapeHtml(b.template_name)}</td>
            <td>${this.ctx.escapeHtml(b.default_manager || '-')}</td>
            <td>${this.ctx.escapeHtml(this.kit.codeLabel(this.codes.work_mode, b.work_mode_code))}</td>
            <td>
              <button type="button" class="btn btn-ghost btn-small" data-edit-base="${b.base_project_id}">編集</button>
              <button type="button" class="btn btn-small" data-create-project="${b.base_project_id}">案件作成</button>
              <button type="button" class="btn btn-danger btn-small" data-del-base="${b.base_project_id}">削除</button>
            </td>
          </tr>`
        )
        .join('');
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
          <div class="table-wrap table-wrap-sticky">
            <table class="data-table data-table-compact">
              <thead><tr><th>No</th><th>企業</th><th>テンプレ名</th><th>担当</th><th>稼働形態</th><th>操作</th></tr></thead>
              <tbody>${rows || '<tr><td colspan="6">データがありません</td></tr>'}</tbody>
            </table>
          </div>
        </section>`
      );
      this.kit.bindShell();
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
        price_set_id: '',
        payment_type: 'normal',
        installment_amount: '',
        operation_start_date: '',
        closing_date: '',
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
            <div class="form-grid">
              <div><label>企業（必須）</label><select name="company_id" required>${this.kit.optionsFromList(this.companies, 'company_id', 'company_name', row.company_id)}</select></div>
              <div><label>テンプレ名（必須）</label><input name="template_name" required value="${this.ctx.escapeHtml(row.template_name || '')}" /></div>
              <div><label>デフォルト担当</label><input name="default_manager" value="${this.ctx.escapeHtml(row.default_manager || '')}" /></div>
              <div><label>業種</label><input name="business_type" value="${this.ctx.escapeHtml(row.business_type || '')}" /></div>
              <div><label>基本勤務時間</label><input name="basic_work_hours" type="number" step="0.25" value="${this.ctx.escapeHtml(row.basic_work_hours ?? '')}" /></div>
              <div><label>時間種別</label><select name="work_time_type">${this.kit.codeOptions(this.codes.work_time_type, row.work_time_type)}</select></div>
              ${this.sharedFieldsHtml(row, true)}
            </div>
            <div class="btn-row">
              <button class="btn" type="submit">保存</button>
              ${id ? '<button class="btn" type="button" id="create-from-base">案件作成</button>' : ''}
              <button class="btn btn-ghost" type="button" id="cancel">一覧へ</button>
            </div>
          </form>
        </section>`,
        { onBack: () => this.showBaseList() }
      );
      this.kit.bindShell({ onBack: () => this.showBaseList() });
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
      const rows = (data.projects || [])
        .map(
          (p) => `
          <tr>
            <td>${this.ctx.escapeHtml(p.project_id)}</td>
            <td>${this.ctx.escapeHtml(p.company_name || p.company_id)}</td>
            <td>${this.ctx.escapeHtml(p.partner_name || '-')}</td>
            <td>${this.ctx.escapeHtml(p.base_template_name || '-')}</td>
            <td>${this.ctx.escapeHtml(p.payment_type === 'installment' ? '分割' : '通常')}</td>
            <td>
              <button type="button" class="btn btn-ghost btn-small" data-edit="${p.project_id}">編集</button>
              <button type="button" class="btn btn-danger btn-small" data-del="${p.project_id}">削除</button>
            </td>
          </tr>`
        )
        .join('');
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
          <div class="table-wrap table-wrap-sticky">
            <table class="data-table data-table-compact">
              <thead><tr><th>No</th><th>企業</th><th>パートナー</th><th>基本案件</th><th>支払</th><th>操作</th></tr></thead>
              <tbody>${rows || '<tr><td colspan="6">データがありません</td></tr>'}</tbody>
            </table>
          </div>
        </section>`
      );
      this.kit.bindShell();
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
        price_set_id: '',
        revisions: [],
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

      const revRows = (project.revisions || [])
        .map(
          (r) => `
          <tr>
            <td>${this.ctx.escapeHtml(this.kit.dateValue(r.revision_start_date))}</td>
            <td>${this.ctx.escapeHtml(this.kit.dateValue(r.revision_end_date) || '〜')}</td>
            <td>${r.is_auto_generated ? '自動' : '手動'}</td>
            <td>${this.ctx.escapeHtml(r.billing_base_price ?? '-')}</td>
            <td>${this.ctx.escapeHtml(r.payment_base_price ?? '-')}</td>
            <td><button type="button" class="btn btn-danger btn-small" data-del-rev="${r.revision_id}">削除</button></td>
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
                ? `<div class="toolbar">
              <label>基本案件テンプレート</label>
              <select id="template-select">${this.kit.optionsFromList(this.baseProjects, 'base_project_id', 'template_name', '')}</select>
              <button type="button" class="btn btn-ghost" id="apply-template">テンプレ反映</button>
            </div>`
                : ''
            }
            <div class="form-grid">
              <div><label>企業（必須）</label><select name="company_id" required id="company-id">${this.kit.optionsFromList(this.companies, 'company_id', 'company_name', project.company_id)}</select></div>
              <div><label>基本案件</label><select name="base_project_id">${this.kit.optionsFromList(this.baseProjects, 'base_project_id', 'template_name', project.base_project_id)}</select></div>
              <div><label>パートナー</label><select name="partner_id">${this.kit.optionsFromList(this.partners, 'partner_id', 'partner_name', project.partner_id)}</select></div>
              <div><label>車両ID</label><input name="vehicle_id" type="number" value="${this.ctx.escapeHtml(project.vehicle_id || '')}" /></div>
              <div><label>担当者</label><input name="manager_name" value="${this.ctx.escapeHtml(project.manager_name || '')}" /></div>
              <div><label>業種</label><input name="business_type" value="${this.ctx.escapeHtml(project.business_type || '')}" /></div>
              ${this.sharedFieldsHtml(project, false)}
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
            <div class="btn-row">
              <button class="btn" type="submit">保存</button>
              <button class="btn btn-ghost" type="button" id="cancel">一覧へ</button>
            </div>
          </form>
          ${
            id
              ? `<h3 class="section-title">改定履歴</h3>
            <div class="toolbar">
              <input type="date" id="new-rev-start" />
              <input type="number" step="0.01" id="new-rev-billing" placeholder="請求基本" />
              <input type="number" step="0.01" id="new-rev-payment" placeholder="支払基本" />
              <button type="button" class="btn" id="add-rev">＋ 改定追加</button>
            </div>
            <div class="table-wrap">
              <table class="data-table data-table-compact">
                <thead><tr><th>開始</th><th>終了</th><th>種別</th><th>請求単価</th><th>支払単価</th><th></th></tr></thead>
                <tbody>${revRows || '<tr><td colspan="6">改定なし</td></tr>'}</tbody>
              </table>
            </div>`
              : ''
          }
        </section>`,
        { onBack: () => this.showProjectList() }
      );
      this.kit.bindShell({ onBack: () => this.showProjectList() });
      document.getElementById('cancel')?.addEventListener('click', () => this.showProjectList());
      document.getElementById('company-id')?.addEventListener('change', async (e) => {
        const cid = e.target.value;
        const basesRes = await this.ctx.api(`/api/lookups/base-projects?company_id=${cid}`);
        this.baseProjects = basesRes.data?.base_projects || [];
        const sel = document.querySelector('[name="base_project_id"]');
        if (sel) sel.innerHTML = this.kit.optionsFromList(this.baseProjects, 'base_project_id', 'template_name', '');
        const tpl = document.getElementById('template-select');
        if (tpl) tpl.innerHTML = this.kit.optionsFromList(this.baseProjects, 'base_project_id', 'template_name', '');
      });
      document.getElementById('apply-template')?.addEventListener('click', async () => {
        const baseId = document.getElementById('template-select')?.value;
        if (!baseId) return;
        const { res, data } = await this.ctx.api(`/api/projects/base/${baseId}`);
        if (!res.ok || !data?.ok) {
          window.alert(data?.message || 'テンプレ取得失敗');
          return;
        }
        const b = data.base_project;
        const form = document.getElementById('project-form');
        if (!form) return;
        form.company_id.value = b.company_id || '';
        form.base_project_id.value = b.base_project_id;
        form.manager_name.value = b.default_manager || '';
        form.business_type.value = b.business_type || '';
        form.work_mode_code.value = b.work_mode_code || '';
        form.daily_count_type.value = b.daily_count_type || '';
        form.overtime_calc_type.value = b.overtime_calc_type || '';
        form.execution_time_start.value = this.kit.timeValue(b.execution_time_start);
        form.execution_time_end.value = this.kit.timeValue(b.execution_time_end);
        form.binding_time.value = b.binding_time ?? '';
        form.break_time.value = b.break_time ?? '';
        form.price_set_id.value = b.price_set_id || '';
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
        else await this.showProjectList('登録しました');
      });
      document.getElementById('add-rev')?.addEventListener('click', async () => {
        const start = document.getElementById('new-rev-start').value;
        if (!start) {
          window.alert('適用開始日を入力してください');
          return;
        }
        const result = await this.ctx.api(`/api/projects/${id}/revisions`, {
          method: 'POST',
          body: JSON.stringify({
            revision_start_date: start,
            billing_base_price: document.getElementById('new-rev-billing').value || null,
            payment_base_price: document.getElementById('new-rev-payment').value || null,
          }),
        });
        if (!result.res.ok) {
          window.alert(result.data?.message || '改定追加失敗');
          return;
        }
        await this.showProjectDetail(id);
      });
      document.querySelectorAll('[data-del-rev]').forEach((btn) =>
        btn.addEventListener('click', async () => {
          if (!window.confirm('この改定を削除しますか？')) return;
          const result = await this.ctx.api(
            `/api/projects/${id}/revisions/${btn.getAttribute('data-del-rev')}`,
            { method: 'DELETE' }
          );
          if (!result.res.ok) {
            window.alert(result.data?.message || '削除失敗');
            return;
          }
          await this.showProjectDetail(id);
        })
      );
    },
  };

  window.LinksProjects = LinksProjects;
})();
