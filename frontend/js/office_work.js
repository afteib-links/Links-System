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
      this.type = TYPES[options.type] ? options.type : null;
      this.companyId = options.companyId ? Number(options.companyId) : null;
      this.partnerId = options.partnerId ? Number(options.partnerId) : null;
      this.query = '';
      this.allCompanies = false;
      this.allPartners = false;
      this.typeFilter = null;
      this.companySort = 'number';
      this.companySortAsc = true;
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
      const rows = [...map.values()].map((company) => {
        const projects = this.projects.filter((p) => p.company_id === company.id);
        return {
          ...company,
          closing: projects[0]?.company_closing_date || projects[0]?.closing_date || '',
          kana: projects[0]?.company_name_kana || company.name
        };
      });
      const direction = this.companySortAsc ? 1 : -1;
      return rows.sort((a, b) => direction * (this.companySort === 'number'
        ? a.id - b.id
        : this.companySort === 'closing'
          ? String(a.closing).localeCompare(String(b.closing), 'ja', { numeric: true })
          : a.kana.localeCompare(b.kana, 'ja')));
    },

    partners() {
      if (!this.companyId) return [];
      const map = new Map();
      this.projects.filter((p) => p.company_id === this.companyId).forEach((p) => {
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
      const target = this.targetFor(type, project.project_id);
      if (type === 'daily') {
        const invoice = this.targetFor('invoice', project.project_id)?.target_status;
        const payment = this.targetFor('payment', project.project_id)?.target_status;
        if (project.workflow_status === 'approved' && [invoice, payment].every((value) => ['draft', 'sales_reviewed', 'finalized'].includes(value))) return '請求支払';
        if (project.workflow_status === 'approved') return '承認済み';
        if (project.workflow_status === 'submitted') return '承認中';
        if (project.workflow_status === 'not_started') return '未入力';
        if (['rejected', 'correcting'].includes(project.workflow_status)) return '差戻し';
        return '入力済み';
      }
      if (project.workflow_status !== 'approved') return '日報未承認';
      if (target?.target_status === 'finalized') return '出力済み';
      if (target?.approval_status === 'approved') return '承認済み';
      return ({ available: '入力中', draft: '入力済み', sales_reviewed: '承認中', finalized: '出力済み' }[target?.target_status] || '入力中');
    },

    render() {
      const body = `<section class="office-screen">
        <div class="office-toolbar">
          ${this.kit.monthNavigatorHtml(this.ym, 'office-month')}
          <label class="office-search"><span>絞り込み</span><input id="office-q" value="${this.ctx.escapeHtml(this.query)}" placeholder="案件No・名称・企業・パートナー"></label>
          <p class="office-guide"><strong>操作：</strong>シングルクリック＝詳細表示 ／ ダブルクリック＝入力画面</p>
        </div>
        <nav class="office-breadcrumb" id="office-breadcrumb" aria-label="現在の選択"></nav>
        <div class="office-workspace">
          <section class="office-column"><div class="office-column-head"><div><h2>企業</h2><span id="office-company-count"></span></div><div class="office-head-actions"><button type="button" class="btn btn-ghost btn-small" id="office-all-companies">全対象</button><button type="button" class="btn btn-ghost btn-small is-active" data-company-sort="number">企業No ▲</button><button type="button" class="btn btn-ghost btn-small" data-company-sort="closing">締日</button><button type="button" class="btn btn-ghost btn-small" data-company-sort="kana">フリガナ</button></div></div><div class="office-column-list" id="office-companies"></div></section>
          <section class="office-column"><div class="office-column-head"><div><h2>パートナー</h2><span id="office-partner-count"></span></div><div class="office-head-actions"><button type="button" class="btn btn-ghost btn-small" id="office-all-partners">全対象</button></div></div><div class="office-column-list" id="office-partners"></div></section>
          <section class="office-column"><div class="office-column-head"><div><h2>業務項目</h2><span id="office-type-count"></span></div><div class="office-head-actions">${Object.entries(TYPES).map(([key, item]) => `<button type="button" class="btn btn-ghost btn-small" data-type-filter="${key}">${item.label}</button>`).join('')}</div></div><div class="office-column-list" id="office-types"></div></section>
          <div class="office-all-table" id="office-all-table" hidden></div>
          <section class="office-preview-column"><div class="office-column-head"><div><h2>詳細プレビュー</h2></div></div><div class="office-preview" id="office-preview"></div></section>
        </div>
      </section>`;
      this.ctx.app.innerHTML = this.kit.shell('事務作業', body, { wide: true, scrollBodyOnly: true, showHistoryBack: false });
      this.kit.bindShell();
      this.kit.bindMonthNavigator('office-month', () => this.ym, (value) => { this.ym = value; }, () => this.load());
      document.getElementById('office-q').addEventListener('input', (event) => { this.query = event.target.value.trim(); this.renderColumns(); });
      document.getElementById('office-all-companies').addEventListener('click', () => { this.allCompanies = !this.allCompanies; this.allPartners = false; this.companyId = null; this.partnerId = null; this.type = null; this.renderColumns(); });
      document.getElementById('office-all-partners').addEventListener('click', () => { if (!this.companyId) return this.ctx.showToast('先に企業を選択してください'); this.allPartners = !this.allPartners; this.allCompanies = false; this.partnerId = null; this.type = null; this.renderColumns(); });
      document.querySelectorAll('[data-company-sort]').forEach((button) => button.addEventListener('click', () => {
        const key = button.dataset.companySort;
        if (this.companySort === key) this.companySortAsc = !this.companySortAsc;
        else { this.companySort = key; this.companySortAsc = true; }
        this.renderColumns();
      }));
      document.querySelectorAll('[data-type-filter]').forEach((button) => button.addEventListener('click', () => {
        const key = button.dataset.typeFilter;
        this.typeFilter = this.typeFilter === key ? null : key;
        if (this.typeFilter && this.type && this.type !== this.typeFilter) this.type = null;
        this.renderColumns();
      }));
      this.renderColumns();
    },

    renderColumns() {
      const companies = this.companies();
      if (this.companyId && !companies.some((x) => x.id === this.companyId)) this.companyId = null;
      const companyRows = companies.map((c) => this.columnRow('company', c.id, c.name, `No.${c.id}　締日 ${c.closing === 'end' ? '末日' : `${c.closing || '-'}日`}　${c.kana}`, this.companyId === c.id)).join('');
      document.getElementById('office-companies').innerHTML = companyRows || '<p class="office-empty">対象企業がありません</p>';

      const partners = this.partners();
      if (this.partnerId && !partners.some((x) => x.id === this.partnerId)) this.partnerId = null;
      document.getElementById('office-partners').innerHTML = partners.map((p) => this.columnRow('partner', p.id, p.name, `${this.projects.filter((row) => (!this.companyId || row.company_id === this.companyId) && row.partner_id === p.id).length}案件`, this.partnerId === p.id)).join('') || '<p class="office-empty">企業を選択してください</p>';

      const selected = this.companyId && this.partnerId ? this.selectedProjects() : [];
      const visibleTypes = Object.entries(TYPES).filter(([key]) => !this.typeFilter || key === this.typeFilter);
      document.getElementById('office-types').innerHTML = this.companyId && this.partnerId ? visibleTypes.map(([key, info]) => {
        const summary = this.statusSummary(selected, key);
        return this.columnRow('type', key, info.label, `${selected.length}案件`, this.type === key, true, summary.label, summary.tone);
      }).join('') : '<p class="office-empty">パートナーを選択してください</p>';
      document.getElementById('office-company-count').textContent = companies.length;
      document.getElementById('office-partner-count').textContent = partners.length;
      document.getElementById('office-type-count').textContent = this.companyId && this.partnerId ? visibleTypes.length : 0;
      document.getElementById('office-all-companies').classList.toggle('is-active', this.allCompanies);
      document.getElementById('office-all-partners').classList.toggle('is-active', this.allPartners);
      document.getElementById('office-all-partners').disabled = !this.companyId;
      document.querySelectorAll('[data-company-sort]').forEach((button) => {
        const active = button.dataset.companySort === this.companySort;
        button.classList.toggle('is-active', active);
        const labels = { number: '企業No', closing: '締日', kana: 'フリガナ' };
        button.textContent = `${labels[button.dataset.companySort]}${active ? (this.companySortAsc ? ' ▲' : ' ▼') : ''}`;
      });
      document.querySelectorAll('[data-type-filter]').forEach((button) => button.classList.toggle('is-active', button.dataset.typeFilter === this.typeFilter));
      const allTable = document.getElementById('office-all-table');
      const allMode = this.allCompanies || this.allPartners;
      allTable.hidden = !allMode;
      document.querySelectorAll('.office-column-list').forEach((list) => list.classList.toggle('is-all-mode', allMode));
      if (allMode) this.renderAllTable(allTable, visibleTypes.map(([key]) => key));
      this.bindColumnEvents();
      this.renderPreview();
      this.renderBreadcrumb();
    },

    renderAllTable(container, typeKeys) {
      const source = this.projects.filter((p) => (!this.allPartners || p.company_id === this.companyId) && (!this.query || `${p.project_id} ${p.template_name || ''} ${p.company_name || ''} ${p.partner_name || ''}`.toLocaleLowerCase('ja').includes(this.query.toLocaleLowerCase('ja'))));
      const companies = this.companies().filter((company) => source.some((p) => p.company_id === company.id));
      let html = '';
      let partnerCount = 0;
      let itemCount = 0;
      companies.forEach((company) => {
        const companyProjects = source.filter((p) => p.company_id === company.id);
        const partnerIds = [...new Set(companyProjects.map((p) => p.partner_id).filter(Boolean))];
        const companySpan = partnerIds.length * typeKeys.length;
        partnerIds.forEach((partnerId, partnerIndex) => {
          partnerCount += 1;
          const partnerProjects = companyProjects.filter((p) => p.partner_id === partnerId);
          const partnerName = partnerProjects[0]?.partner_name || `パートナー #${partnerId}`;
          typeKeys.forEach((type, typeIndex) => {
            itemCount += 1;
            const firstCompany = partnerIndex === 0 && typeIndex === 0;
            const firstPartner = typeIndex === 0;
            const summary = this.statusSummary(partnerProjects, type);
            html += `<tr class="office-all-business ${this.companyId === company.id && this.partnerId === partnerId && this.type === type ? 'is-selected' : ''}" data-all-company="${company.id}" data-all-partner="${partnerId}" data-all-type="${type}">${firstCompany ? `<td rowspan="${companySpan}" class="office-all-company"><strong>${this.ctx.escapeHtml(company.name)}</strong><span class="office-all-meta">No.${company.id}　締日 ${company.closing === 'end' ? '末日' : `${company.closing || '-'}日`}　${this.ctx.escapeHtml(company.kana)}</span></td>` : ''}${firstPartner ? `<td rowspan="${typeKeys.length}" class="office-all-partner"><strong>${this.ctx.escapeHtml(partnerName)}</strong><span class="office-all-meta">${partnerProjects.length}案件</span></td>` : ''}<td class="office-all-type"><strong>${TYPES[type].label}</strong><span class="office-row-meta"><span class="office-status office-status-${summary.tone}">${summary.label}</span><small>${partnerProjects.length}案件</small></span><em>ダブルクリックで入力画面</em></td></tr>`;
          });
        });
      });
      document.getElementById('office-company-count').textContent = companies.length;
      document.getElementById('office-partner-count').textContent = partnerCount;
      document.getElementById('office-type-count').textContent = itemCount;
      container.innerHTML = `<table><colgroup><col><col><col></colgroup><tbody>${html || '<tr><td colspan="3" class="office-empty">対象がありません</td></tr>'}</tbody></table>`;
      container.querySelectorAll('[data-all-type]').forEach((row) => {
        row.addEventListener('click', () => { clearTimeout(this.clickTimer); this.clickTimer = setTimeout(() => { this.companyId = Number(row.dataset.allCompany); this.partnerId = Number(row.dataset.allPartner); this.type = row.dataset.allType; this.renderColumns(); }, 220); });
        row.addEventListener('dblclick', () => { clearTimeout(this.clickTimer); this.companyId = Number(row.dataset.allCompany); this.partnerId = Number(row.dataset.allPartner); this.type = row.dataset.allType; this.openSelected(); });
      });
    },

    renderBreadcrumb() {
      const company = this.companyId ? this.companies().find((x) => x.id === this.companyId)?.name : this.allCompanies ? '全企業' : '企業を選択';
      const partner = this.partnerId ? this.partners().find((x) => x.id === this.partnerId)?.name : this.allPartners ? '全パートナー' : '';
      const parts = [company, partner, this.partnerId && this.type ? TYPES[this.type].label : ''].filter(Boolean);
      document.getElementById('office-breadcrumb').innerHTML = parts.map((part, index) => `<span class="${index === parts.length - 1 ? 'is-current' : ''}">${this.ctx.escapeHtml(part)}</span>`).join('<b>›</b>');
    },

    columnRow(kind, id, name, meta, selected, inputLink = false, statusLabel = '', statusTone = 'working') {
      const value = id == null ? '' : id;
      return `<button type="button" class="office-column-row ${selected ? 'is-selected' : ''}" data-${kind}="${this.ctx.escapeHtml(value)}"><span class="office-row-main"><strong>${this.ctx.escapeHtml(name)}</strong><span class="office-row-meta">${statusLabel ? `<span class="office-status office-status-${statusTone}">${this.ctx.escapeHtml(statusLabel)}</span>` : ''}<small>${this.ctx.escapeHtml(meta)}</small></span>${inputLink ? '<em>ダブルクリックで入力画面</em>' : ''}</span><b>›</b></button>`;
    },

    bindColumnEvents() {
      document.querySelectorAll('[data-company]').forEach((row) => row.addEventListener('click', () => { this.allCompanies = false; this.allPartners = false; this.companyId = Number(row.dataset.company); this.partnerId = null; this.renderColumns(); }));
      document.querySelectorAll('[data-partner]').forEach((row) => row.addEventListener('click', () => { this.allCompanies = false; this.allPartners = false; this.partnerId = Number(row.dataset.partner); this.renderColumns(); }));
      document.querySelectorAll('[data-type]').forEach((row) => {
        row.addEventListener('click', () => {
          clearTimeout(this.clickTimer);
          this.clickTimer = setTimeout(() => { this.type = row.dataset.type; this.renderColumns(); }, 220);
        });
        row.addEventListener('dblclick', () => { clearTimeout(this.clickTimer); this.type = row.dataset.type; this.openSelected(); });
      });
    },

    renderPreview() {
      if (!this.companyId || !this.partnerId || !this.type) {
        document.getElementById('office-preview').innerHTML = '<div class="office-preview-placeholder">企業、パートナー、業務項目の順に選択してください</div>';
        return;
      }
      const projects = this.selectedProjects();
      const company = this.companyId ? this.companies().find((x) => x.id === this.companyId)?.name : '全企業';
      const partner = this.partnerId ? this.partners().find((x) => x.id === this.partnerId)?.name : '全パートナー';
      const label = TYPES[this.type].label;
      const amounts = projects.map((p) => this.targetFor(this.type, p.project_id));
      const invoiceAmounts = projects.map((p) => this.targetFor('invoice', p.project_id));
      const paymentAmounts = projects.map((p) => this.targetFor('payment', p.project_id));
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
        ? [['入力日数', `${inputDays}/${possibleDays}日`], ['日次確認', `${projects.reduce((s, p) => s + Number(p.status_summary?.confirmed || 0), 0)}/${possibleDays}日`], ['請求見込額', this.kit.money(invoiceAmounts.reduce((sum, x) => sum + Number(x?.total_amount || x?.subtotal_amount || 0), 0)), 'money'], ['支払見込額', this.kit.money(paymentAmounts.reduce((sum, x) => sum + Number(x?.final_transfer_amount || 0), 0)), 'money']]
        : this.type === 'invoice'
          ? [['対象案件', `${projects.length}件`], ['日報承認済み', `${approved}/${projects.length}件`], ['請求見込額（税込）', this.kit.money(total), 'money'], ['PDF発行', settlements.length ? '発行済み' : '未発行']]
          : [['支払総額', this.kit.money(amounts.reduce((s, x) => s + Number(x?.gross_amount || 0), 0)), 'money'], ['前払控除', this.kit.money(amounts.reduce((s, x) => s + Number(x?.advance_deduction_amount || 0), 0)), 'money'], ['手数料等', this.kit.money(amounts.reduce((s, x) => s + Number(x?.transfer_fee_deduction_amount || 0) + Number(x?.rule_deduction_amount || 0), 0)), 'money'], ['最終振込予定額', this.kit.money(total), 'money']];
      const breakdown = this.statusBreakdown(projects, this.type);
      const summary = this.statusSummary(projects, this.type);
      const next = this.nextAction(summary.label, this.type, projects.length);
      const warningCount = breakdown.filter((item) => item.tone === 'danger').reduce((sum, item) => sum + item.count, 0);
      document.getElementById('office-preview').innerHTML = `<article class="office-preview-card">
        <header class="office-preview-head"><div><small>${label}・選択範囲の集計</small><h2>${this.ctx.escapeHtml(company)} / ${this.ctx.escapeHtml(partner)}</h2><p>${this.ctx.escapeHtml(this.ym)}　<span class="office-status office-status-${summary.tone}">${this.ctx.escapeHtml(summary.label)}</span></p></div>${headerButton}</header>
        <section class="office-preview-section"><div class="office-context-grid"><div><small>対象月</small><strong>${this.ctx.escapeHtml(this.ym)}</strong></div><div><small>企業No</small><strong>${this.companyId ? `No.${this.companyId}` : '全対象'}</strong></div><div><small>対象案件</small><strong>${projects.length}件</strong></div><div><small>締日</small><strong>${this.closingSummary(projects)}</strong></div></div><p class="office-scope-note">表示金額・件数は、選択中の企業 × パートナー × 対象月の集計です。</p></section>
        <section class="office-preview-section"><h3>処理状況</h3><div class="office-metrics">${metrics.map(([name, value, style]) => `<div><small>${name}</small><strong class="${style || ''}">${value}</strong></div>`).join('')}</div>${warningCount ? `<p class="office-warning">⚠ 要対応の案件が ${warningCount}件あります</p>` : ''}</section>
        <section class="office-preview-section"><div class="office-next office-next-${summary.tone}"><small>次に必要な作業</small><strong>${this.ctx.escapeHtml(next)}</strong></div></section>
        <section class="office-breakdown"><h3>進行状況</h3><div>${breakdown.map((item) => `<article class="office-breakdown-${item.tone}"><small>${item.label}</small><strong>${item.count}件</strong></article>`).join('')}</div></section>
        <footer><button type="button" class="btn" id="office-open" ${projects.length ? '' : 'disabled'}>入力画面を開く</button><span>最終更新：画面表示時点　更新者：各既存画面の履歴を参照</span></footer>
      </article>`;
      document.getElementById('office-open')?.addEventListener('click', () => this.openSelected());
      document.getElementById('office-check')?.addEventListener('click', () => this.openSelected('daily'));
      document.getElementById('office-pdf')?.addEventListener('click', () => this.openPdf(settlements));
    },

    statusBreakdown(projects, type) {
      const groups = type === 'daily'
        ? [{ label: '未入力', tone: 'danger' }, { label: '入力済み', tone: 'working' }, { label: '承認中', tone: 'warning' }, { label: '承認済み', tone: 'success' }, { label: '請求支払', tone: 'success' }, { label: '差戻し', tone: 'danger' }]
        : [{ label: '日報未承認', tone: 'danger' }, { label: '入力中', tone: 'working' }, { label: '入力済み', tone: 'working' }, { label: '承認中', tone: 'warning' }, { label: '承認済み', tone: 'success' }, { label: '出力済み', tone: 'success' }];
      return groups.map((group) => ({ ...group, count: projects.filter((project) => this.status(type, project) === group.label).length }));
    },

    statusSummary(projects, type) {
      const breakdown = this.statusBreakdown(projects, type);
      return breakdown.find((item) => item.count > 0) || { label: '対象なし', tone: 'working', count: 0 };
    },

    nextAction(status, type, count) {
      if (!count) return '対象案件がありません';
      if (status === '差戻し') return '差戻し内容を確認し、対象日を修正してください';
      if (status === '未入力') return '未入力日を入力し、日次確認を完了してください';
      if (status === '入力済み' && type === 'daily') return '日次確認を完了し、月次承認を依頼してください';
      if (status === '承認中') return type === 'daily' ? '承認担当者の確認を待っています' : '承認処理を完了してください';
      if (status === '日報未承認') return '日報の承認状態を確認してください';
      if (status === '入力中') return `${TYPES[type].label}下書きを作成してください`;
      if (status === '入力済み') return `${TYPES[type].label}明細を確認し、承認を依頼してください`;
      if (status === '承認済み') return type === 'daily' ? '請求・支払へ進めます' : '最終確定し、PDFを発行してください';
      if (status === '請求支払') return '請求・支払の処理状況を確認してください';
      return `${TYPES[type].label}処理は完了しています`;
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
