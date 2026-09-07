(() => {
  const TYPES = {
    daily: { label: '日報', feature: 'daily_reports' },
    invoice: { label: '請求', feature: 'invoices' },
    payment: { label: '支払', feature: 'payments' },
  };

  const ui = {
    async open(ctx, options = {}) {
      this.ctx = ctx;
      this.kit = window.LinksFeatureKit.createFeatureKit(ctx);
      this.ym = /^\d{4}-\d{2}$/.test(options.targetYearMonth || '') ? options.targetYearMonth : this.kit.currentYearMonth();
      this.type = TYPES[options.type] ? options.type : 'daily';
      this.companyId = options.companyId ? Number(options.companyId) : null;
      this.partnerId = options.partnerId ? Number(options.partnerId) : null;
      this.query = '';
      this.clickTimer = null;
      await this.load();
    },

    async load() {
      this.ctx.renderLoading();
      const ym = encodeURIComponent(this.ym);
      const [daily, invoices, payments] = await Promise.all([
        this.ctx.api(`/api/daily-reports/month-projects?target_year_month=${ym}`),
        this.ctx.api(`/api/invoices/targets?target_year_month=${ym}`),
        this.ctx.api(`/api/payments/targets?target_year_month=${ym}`),
      ]);
      if (!daily.res.ok) return this.error(daily.data?.message || '事務作業データを取得できませんでした');
      this.projects = (daily.data.rows || []).map((row) => ({ ...row, project_id: Number(row.project_id), company_id: Number(row.company_id), partner_id: Number(row.partner_id) }));
      this.invoiceTargets = invoices.res.ok ? (invoices.data.targets || []) : [];
      this.paymentTargets = payments.res.ok ? (payments.data.targets || []) : [];
      this.render();
    },

    companies() {
      const map = new Map();
      this.projects.forEach((p) => {
        if (p.company_id && !map.has(p.company_id)) map.set(p.company_id, { id: p.company_id, name: p.company_name || `企業 #${p.company_id}` });
      });
      return [...map.values()].sort((a, b) => a.name.localeCompare(b.name, 'ja'));
    },

    partners() {
      const map = new Map();
      this.projects.filter((p) => !this.companyId || p.company_id === this.companyId).forEach((p) => {
        if (p.partner_id && !map.has(p.partner_id)) map.set(p.partner_id, { id: p.partner_id, name: p.partner_name || `パートナー #${p.partner_id}` });
      });
      return [...map.values()].sort((a, b) => a.name.localeCompare(b.name, 'ja'));
    },

    selectedProjects() {
      const q = this.query.toLocaleLowerCase('ja');
      return this.projects.filter((p) => (!this.companyId || p.company_id === this.companyId)
        && (!this.partnerId || p.partner_id === this.partnerId)
        && (!q || `${p.project_id} ${p.template_name || ''} ${p.company_name || ''} ${p.partner_name || ''}`.toLocaleLowerCase('ja').includes(q)));
    },

    targetFor(type, projectId) {
      const list = type === 'invoice' ? this.invoiceTargets : this.paymentTargets;
      return list.find((row) => Number(row.project_id) === Number(projectId)) || null;
    },

    tone(status) {
      if (['approved', 'finalized'].includes(status)) return 'success';
      if (['rejected', 'correcting', 'no_reports', 'not_started'].includes(status)) return 'danger';
      if (['submitted', 'awaiting_approval', 'sales_reviewed'].includes(status)) return 'warning';
      return 'working';
    },

    status(type, project) {
      if (type === 'daily') return project.workflow_status_label || project.input_status || '未入力';
      const target = this.targetFor(type, project.project_id);
      const value = target?.target_status;
      return ({ available: type === 'invoice' ? '請求可能' : '支払可能', draft: '下書き', sales_reviewed: '営業確認済み', finalized: '最終確定', awaiting_approval: '日報承認待ち', not_available: '対象なし', no_reports: '日報未登録' }[value] || value || '対象なし');
    },

    render() {
      const body = `<section class="office-screen">
        <div class="office-toolbar">
          ${this.kit.monthNavigatorHtml(this.ym, 'office-month')}
          <label class="office-search"><span>絞り込み</span><input id="office-q" value="${this.ctx.escapeHtml(this.query)}" placeholder="案件No・名称・企業・パートナー"></label>
          <p class="office-guide"><strong>操作：</strong>シングルクリック＝詳細表示 ／ ダブルクリック＝入力画面</p>
        </div>
        <div class="office-workspace">
          <section class="office-column"><h2>企業</h2><div class="office-column-list" id="office-companies"></div></section>
          <section class="office-column"><h2>パートナー</h2><div class="office-column-list" id="office-partners"></div></section>
          <section class="office-column"><h2>業務項目</h2><div class="office-column-list" id="office-types"></div></section>
          <section class="office-preview" id="office-preview"></section>
        </div>
      </section>`;
      this.ctx.app.innerHTML = this.kit.shell('事務作業', body, { wide: true, scrollBodyOnly: true, showHistoryBack: false });
      this.kit.bindShell();
      this.kit.bindMonthNavigator('office-month', () => this.ym, (value) => { this.ym = value; }, () => this.load());
      document.getElementById('office-q').addEventListener('input', (event) => { this.query = event.target.value.trim(); this.renderColumns(); });
      this.renderColumns();
    },

    renderColumns() {
      const companies = this.companies();
      if (this.companyId && !companies.some((x) => x.id === this.companyId)) this.companyId = null;
      const companyRows = [{ id: null, name: '全企業' }, ...companies].map((c) => this.columnRow('company', c.id, c.name, `${c.id ? this.projects.filter((p) => p.company_id === c.id).length : this.projects.length}案件`, this.companyId === c.id)).join('');
      document.getElementById('office-companies').innerHTML = companyRows || '<p class="office-empty">対象企業がありません</p>';

      const partners = this.partners();
      if (this.partnerId && !partners.some((x) => x.id === this.partnerId)) this.partnerId = null;
      document.getElementById('office-partners').innerHTML = [{ id: null, name: '全パートナー' }, ...partners].map((p) => this.columnRow('partner', p.id, p.name, `${this.projects.filter((row) => (!this.companyId || row.company_id === this.companyId) && (!p.id || row.partner_id === p.id)).length}案件`, this.partnerId === p.id)).join('');

      const selected = this.selectedProjects();
      document.getElementById('office-types').innerHTML = Object.entries(TYPES).map(([key, info]) => {
        const attention = selected.filter((p) => this.tone(key === 'daily' ? p.workflow_status : this.targetFor(key, p.project_id)?.target_status) === 'danger').length;
        return this.columnRow('type', key, info.label, attention ? `要対応 ${attention}件 / ${selected.length}案件` : `${selected.length}案件`, this.type === key, true);
      }).join('');
      this.bindColumnEvents();
      this.renderPreview();
    },

    columnRow(kind, id, name, meta, selected, inputLink = false) {
      const value = id == null ? '' : id;
      return `<button type="button" class="office-column-row ${selected ? 'is-selected' : ''}" data-${kind}="${this.ctx.escapeHtml(value)}"><span><strong>${this.ctx.escapeHtml(name)}</strong><small>${this.ctx.escapeHtml(meta)}</small>${inputLink ? '<em>ダブルクリックで入力画面</em>' : ''}</span><b>›</b></button>`;
    },

    bindColumnEvents() {
      document.querySelectorAll('[data-company]').forEach((row) => row.addEventListener('click', () => { this.companyId = row.dataset.company ? Number(row.dataset.company) : null; this.partnerId = null; this.renderColumns(); }));
      document.querySelectorAll('[data-partner]').forEach((row) => row.addEventListener('click', () => { this.partnerId = row.dataset.partner ? Number(row.dataset.partner) : null; this.renderColumns(); }));
      document.querySelectorAll('[data-type]').forEach((row) => {
        row.addEventListener('click', () => {
          clearTimeout(this.clickTimer);
          this.clickTimer = setTimeout(() => { this.type = row.dataset.type; this.renderColumns(); }, 220);
        });
        row.addEventListener('dblclick', () => { clearTimeout(this.clickTimer); this.type = row.dataset.type; this.openSelected(); });
      });
    },

    renderPreview() {
      const projects = this.selectedProjects();
      const company = this.companyId ? this.companies().find((x) => x.id === this.companyId)?.name : '全企業';
      const partner = this.partnerId ? this.partners().find((x) => x.id === this.partnerId)?.name : '全パートナー';
      const label = TYPES[this.type].label;
      const amounts = projects.map((p) => this.targetFor(this.type, p.project_id));
      const total = this.type === 'invoice' ? amounts.reduce((sum, x) => sum + Number(x?.total_amount || x?.subtotal_amount || 0), 0)
        : this.type === 'payment' ? amounts.reduce((sum, x) => sum + Number(x?.final_transfer_amount || 0), 0) : 0;
      const inputDays = projects.reduce((sum, p) => sum + Number(p.input_days || 0), 0);
      const possibleDays = projects.reduce((sum, p) => sum + Number(p.days_in_month || 0), 0);
      const approved = projects.filter((p) => p.workflow_status === 'approved').length;
      const settlements = [...new Set(amounts.map((x) => Number(x?.settlement_id)).filter(Boolean))];
      const headerButton = this.type === 'daily'
        ? '<button type="button" class="btn office-header-action" id="office-check">日報チェック</button>'
        : `<button type="button" class="btn office-header-action" id="office-pdf" ${settlements.length ? '' : 'disabled'}>${settlements.length ? 'PDF表示' : 'PDF未作成'}</button>`;
      const metrics = this.type === 'daily'
        ? [['入力日数', `${inputDays}日`], ['未入力日数', `${Math.max(0, possibleDays - inputDays)}日`], ['月次承認', `${approved}/${projects.length}案件`], ['日次確認', `${projects.reduce((s, p) => s + Number(p.status_summary?.confirmed || 0), 0)}件`]]
        : this.type === 'invoice'
          ? [['対象案件', `${projects.length}件`], ['日報承認済み', `${approved}件`], ['請求見込額', this.kit.money(total)], ['PDF対象', `${settlements.length}件`]]
          : [['対象案件', `${projects.length}件`], ['支払総額', this.kit.money(amounts.reduce((s, x) => s + Number(x?.gross_amount || 0), 0))], ['控除合計', this.kit.money(amounts.reduce((s, x) => s + Number(x?.advance_deduction_amount || 0) + Number(x?.transfer_fee_deduction_amount || 0) + Number(x?.rule_deduction_amount || 0), 0))], ['振込予定額', this.kit.money(total)]];
      const rows = projects.map((p) => {
        const target = this.targetFor(this.type, p.project_id);
        const amount = this.type === 'invoice' ? Number(target?.total_amount || target?.subtotal_amount || 0) : this.type === 'payment' ? Number(target?.final_transfer_amount || 0) : null;
        return `<tr data-preview-project="${p.project_id}"><td>#${p.project_id}</td><td>${this.ctx.escapeHtml(p.template_name || `案件 #${p.project_id}`)}</td><td>${this.ctx.escapeHtml(p.closing_date === 'end' ? '末日' : `${p.closing_date || '-'}日`)}</td><td><span class="office-status office-status-${this.tone(this.type === 'daily' ? p.workflow_status : target?.target_status)}">${this.ctx.escapeHtml(this.status(this.type, p))}</span>${this.type === 'daily' ? `<small class="office-progress">入力 ${p.input_days || 0}/${p.days_in_month || 0}日</small>` : ''}</td><td class="num">${amount == null ? '-' : this.kit.money(amount)}</td><td><button type="button" class="btn btn-ghost btn-small" data-open-project="${p.project_id}">${this.type === 'daily' ? '日報確認' : '入力画面'}</button></td></tr>`;
      }).join('');
      const next = !projects.length ? '対象案件がありません' : this.type === 'daily' && approved < projects.length ? '未入力・未確認の日報を確認し、月次承認へ進めてください' : this.type !== 'daily' && !settlements.length ? `${label}の下書きを作成してください` : '状態を確認し、必要な処理を続けてください';
      document.getElementById('office-preview').innerHTML = `<article class="office-preview-card">
        <header class="office-preview-head"><div><small>${label}・選択範囲の集計</small><h2>${this.ctx.escapeHtml(company)} / ${this.ctx.escapeHtml(partner)}</h2><p>${this.ctx.escapeHtml(this.ym)}　対象 ${projects.length}案件　締日 ${this.closingSummary(projects)}</p></div>${headerButton}</header>
        <p class="office-scope-note">金額・件数は「選択中の企業 × パートナー × 対象月」の集計です。</p>
        <div class="office-metrics">${metrics.map(([name, value]) => `<div><small>${name}</small><strong>${value}</strong></div>`).join('')}</div>
        <div class="office-next"><small>次に必要な作業</small><strong>${this.ctx.escapeHtml(next)}</strong></div>
        <div class="office-project-table"><table class="data-table data-table-compact"><thead><tr><th>案件No</th><th>案件名</th><th>締日</th><th>進捗・状態</th><th>金額</th><th>操作</th></tr></thead><tbody>${rows || '<tr><td colspan="6">対象案件がありません</td></tr>'}</tbody></table></div>
        <footer><button type="button" class="btn" id="office-open" ${projects.length ? '' : 'disabled'}>入力画面を開く</button><span>最終更新：画面表示時点　更新者：各既存画面の履歴を参照</span></footer>
      </article>`;
      document.getElementById('office-open')?.addEventListener('click', () => this.openSelected());
      document.getElementById('office-check')?.addEventListener('click', () => this.openSelected('daily'));
      document.getElementById('office-pdf')?.addEventListener('click', () => this.openPdf(settlements));
      document.querySelectorAll('[data-open-project]').forEach((button) => button.addEventListener('click', () => this.openProject(Number(button.dataset.openProject), this.type)));
      document.querySelectorAll('[data-preview-project]').forEach((row) => row.addEventListener('dblclick', (event) => { if (!event.target.closest('button')) this.openProject(Number(row.dataset.previewProject), this.type); }));
    },

    closingSummary(projects) {
      const values = [...new Set(projects.map((p) => p.closing_date === 'end' ? '末日' : `${p.closing_date || '-'}日`))];
      return values.length > 2 ? `${values.slice(0, 2).join('・')}ほか` : values.join('・') || '-';
    },

    openSelected(type = this.type) {
      const projects = this.selectedProjects();
      if (!projects.length) return this.ctx.showToast('対象案件がありません');
      if (projects.length === 1) return this.openProject(projects[0].project_id, type);
      const rows = projects.map((p) => {
        const target = this.targetFor(type, p.project_id);
        const amount = type === 'invoice' ? Number(target?.total_amount || target?.subtotal_amount || 0) : type === 'payment' ? Number(target?.final_transfer_amount || 0) : null;
        return `<tr data-pick-project="${p.project_id}"><td>#${p.project_id}</td><td>${this.ctx.escapeHtml(p.template_name || '-')}</td><td>${p.closing_date === 'end' ? '末日' : `${this.ctx.escapeHtml(p.closing_date || '-')}日`}</td><td>${this.ctx.escapeHtml(this.status(type, p))}</td><td class="num">${amount == null ? '-' : this.kit.money(amount)}</td></tr>`;
      }).join('');
      document.body.insertAdjacentHTML('beforeend', this.kit.modalHtml('案件を選択', `<p class="muted">行をダブルクリックするか、選択して開いてください。</p><div class="table-wrap office-picker"><table class="data-table"><thead><tr><th>案件No</th><th>案件名</th><th>締日</th><th>進捗・状態</th><th>金額</th></tr></thead><tbody>${rows}</tbody></table></div>`, '<button type="button" class="btn btn-ghost" data-modal-close>キャンセル</button><button type="button" class="btn" id="office-pick-open" disabled>選択して開く</button>'));
      const close = this.kit.bindModal();
      let selectedId = null;
      document.querySelectorAll('[data-pick-project]').forEach((row) => {
        row.addEventListener('click', () => { document.querySelectorAll('[data-pick-project]').forEach((x) => x.classList.remove('is-selected')); row.classList.add('is-selected'); selectedId = Number(row.dataset.pickProject); document.getElementById('office-pick-open').disabled = false; });
        row.addEventListener('dblclick', () => { close(); this.openProject(Number(row.dataset.pickProject), type); });
      });
      document.getElementById('office-pick-open').addEventListener('click', () => { if (selectedId) { close(); this.openProject(selectedId, type); } });
    },

    openProject(projectId, type) {
      const project = this.projects.find((p) => p.project_id === Number(projectId));
      if (!project) return;
      const target = this.targetFor(type, projectId);
      this.ctx.openFeature(TYPES[type].feature, { targetYearMonth: this.ym, projectId, companyId: project.company_id, partnerId: project.partner_id, settlementId: target?.settlement_id || null, query: String(projectId) });
    },

    openPdf(ids) {
      if (!ids.length) return;
      if (ids.length === 1) return window.open(`/api/settlements/${this.type}/${ids[0]}/preview`, '_blank', 'noopener');
      document.body.insertAdjacentHTML('beforeend', this.kit.modalHtml('PDFを選択', `<div class="office-pdf-list">${ids.map((id) => `<button type="button" class="btn btn-secondary" data-pdf-id="${id}">${TYPES[this.type].label} #${id} のPDFを表示</button>`).join('')}</div>`));
      const close = this.kit.bindModal();
      document.querySelectorAll('[data-pdf-id]').forEach((button) => button.addEventListener('click', () => { window.open(`/api/settlements/${this.type}/${button.dataset.pdfId}/preview`, '_blank', 'noopener'); close(); }));
    },

    error(message) {
      this.ctx.app.innerHTML = this.kit.shell('事務作業', `<section class="panel"><p class="error">${this.ctx.escapeHtml(message)}</p><button type="button" class="btn" id="office-retry">再試行</button></section>`, { wide: true });
      this.kit.bindShell();
      document.getElementById('office-retry').addEventListener('click', () => this.load());
    },
  };

  window.LinksOfficeWork = ui;
})();
