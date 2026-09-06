(() => {
  const GROUP_ORDER = ['early', 'middle', 'late'];
  const STATUS_LABELS = { unsubmitted: '未提出', submitted: '提出済み', overdue: '期限超過' };

  const ui = {
    async open(ctx) {
      this.ctx = ctx;
      this.kit = window.LinksFeatureKit.createFeatureKit(ctx);
      this.ym = this.kit.currentYearMonth();
      this.filters = { q: '', company_id: '', partner_id: '', closing_date: '', status: '' };
      const [companies, partners] = await Promise.all([this.ctx.api('/api/lookups/companies'), this.ctx.api('/api/lookups/partners')]);
      this.companies = companies.data?.companies || [];
      this.partners = partners.data?.partners || [];
      await this.show();
    },
    number(value) { return Math.round(Number(value || 0)).toLocaleString('ja-JP'); },
    todayLocal() { return new Date().toLocaleDateString('en-CA'); },
    md(value) {
      const match = String(value || '').slice(0, 10).match(/^(\d{4})-(\d{2})-(\d{2})$/);
      if (!match) return this.ctx.escapeHtml(value || '-');
      return `${Number(match[2])}/${Number(match[3])}`;
    },
    ymdJa(value) {
      const match = String(value || '').slice(0, 10).match(/^(\d{4})-(\d{2})-(\d{2})$/);
      if (!match) return this.ctx.escapeHtml(value || '-');
      return `${match[1]}年${match[2]}月${match[3]}日`;
    },
    periodHtml(start, end) {
      return `<strong>${this.md(start)}〜${this.md(end)}</strong>`;
    },
    dateHtml(value) { return this.md(value); },
    cycleRoot(row, groupCode, selector) {
      return row.querySelector(`[data-cycle="${groupCode}"] ${selector}`);
    },
    queryString() {
      const params = new URLSearchParams({ target_year_month: this.ym });
      Object.entries(this.filters).forEach(([key, value]) => { if (value) params.set(key, value); });
      return params.toString();
    },
    async show(message = '') {
      const scroll = document.querySelector('.submission-matrix-wrap');
      const oldScroll = scroll ? { left: scroll.scrollLeft, top: scroll.scrollTop } : null;
      this.ctx.renderLoading();
      const { res, data } = await this.ctx.api(`/api/daily-report-submissions/matrix?${this.queryString()}`);
      if (!res.ok || !data?.ok) return this.error(data?.message);
      this.data = data;
      const projects = data.projects || [];
      const groups = Object.fromEntries((data.groups || []).map((group) => [group.group_code, group]));
      const rows = projects.map((project) => this.projectRow(project)).join('');
      const cycleHeaders = GROUP_ORDER.map((code) => {
        const group = groups[code] || {};
        return `<th class="submission-cycle-heading" colspan="3"><strong>${this.ctx.escapeHtml(group.label || code)}</strong></th>`;
      }).join('');
      const cycleSubHeaders = GROUP_ORDER.map(() => '<th class="submission-period-heading">対象期間 / 予定提出日</th><th class="submission-status-heading">提出状態</th><th class="submission-date-heading">提出日</th>').join('');
      const monthTotals = GROUP_ORDER.map((code) => {
        const total = (data.summary?.cycles || []).find((row) => row.group_code === code) || {};
        return `<th class="submission-cycle-total" colspan="3"><span>提出 ${this.number(total.submitted_count)}／未提出 ${this.number(total.unsubmitted_count)}</span><small>遅延 ${this.number(total.overdue_count)}件／${this.number(total.overdue_days)}日</small></th>`;
      }).join('');
      this.ctx.app.innerHTML = this.kit.shell(
        '日報提出一覧',
        `<section class="panel advance-panel submission-panel">
          ${message ? `<p class="flash">${this.ctx.escapeHtml(message)}</p>` : ''}
          <div class="submission-summary-top">
            ${this.kit.summaryCardsHtml([
              { label: '案件数', value: `${this.number(data.summary?.project_count)}件`, tone: 'neutral', filter: '', active: !this.filters.status },
              { label: '提出済み', value: `${this.number(data.summary?.submitted_count)}件`, tone: 'complete', filter: 'submitted', active: this.filters.status === 'submitted' },
              { label: '未提出', value: `${this.number(data.summary?.unsubmitted_count)}件`, tone: 'waiting', filter: 'unsubmitted', active: this.filters.status === 'unsubmitted' },
              { label: '期限超過', value: `${this.number(data.summary?.overdue_count)}件`, tone: 'attention', filter: 'overdue', active: this.filters.status === 'overdue' },
            ])}
          </div>
          <div class="advance-topbar">
            ${this.kit.monthNavigatorHtml(this.ym, 'submission-month')}
            <span class="submission-grace">猶予 <strong>${this.number(data.grace_days)}日</strong></span>
            <span class="submission-today"><small>今日</small><strong>${this.ymdJa(data.today)}</strong></span>
          </div>
          <form id="submission-filters" class="advance-filterbar">
            <input name="q" value="${this.ctx.escapeHtml(this.filters.q)}" placeholder="案件・企業・パートナーを検索">
            <select name="company_id"><option value="">全企業</option>${this.companies.map((row) => `<option value="${row.company_id}" ${String(this.filters.company_id) === String(row.company_id) ? 'selected' : ''}>${this.ctx.escapeHtml(row.company_name)}</option>`).join('')}</select>
            <select name="partner_id"><option value="">全パートナー</option>${this.partners.map((row) => `<option value="${row.partner_id}" ${String(this.filters.partner_id) === String(row.partner_id) ? 'selected' : ''}>${this.ctx.escapeHtml(row.partner_name)}</option>`).join('')}</select>
            <select name="closing_date"><option value="">全締日</option>${['5','10','15','20','25','end'].map((value) => `<option value="${value}" ${this.filters.closing_date === value ? 'selected' : ''}>${value === 'end' ? '末日' : `${value}日`}</option>`).join('')}</select>
            <select name="status"><option value="">全状態</option>${Object.entries(STATUS_LABELS).map(([value, label]) => `<option value="${value}" ${this.filters.status === value ? 'selected' : ''}>${label}</option>`).join('')}</select>
            <button class="btn btn-secondary btn-small">絞り込み</button><button type="button" id="submission-clear" class="btn btn-ghost btn-small">クリア</button>
            <span class="muted">表示 ${this.number(data.visible_project_count)}／全 ${this.number(data.summary?.project_count)}案件</span>
          </form>
          <div class="submission-matrix-wrap">
            <table class="submission-matrix">
              <colgroup><col class="submission-project-col">${GROUP_ORDER.map(() => '<col class="submission-period-col"><col class="submission-status-col"><col class="submission-date-col">').join('')}<col class="submission-total-col"></colgroup>
              <thead>
                <tr class="submission-heading-main"><th class="submission-project-heading" rowspan="2">案件情報</th>${cycleHeaders}<th class="submission-project-total-heading" rowspan="2">案件別</th></tr>
                <tr class="submission-heading-fields">${cycleSubHeaders}</tr>
                <tr class="submission-month-total"><th class="submission-project-footer">対象月全体</th>${monthTotals}<th class="submission-grand-total"><strong>提出 ${this.number(data.summary?.submitted_count)}</strong><small>未提出 ${this.number(data.summary?.unsubmitted_count)}</small><small>遅延 ${this.number(data.summary?.overdue_count)}件</small></th></tr>
              </thead>
              <tbody>${rows || '<tr><td colspan="11" class="advance-empty">条件に一致する案件はありません</td></tr>'}</tbody>
            </table>
          </div>
        </section>`,
        { wide: true }
      );
      this.bind();
      if (oldScroll) {
        const next = document.querySelector('.submission-matrix-wrap');
        next.scrollLeft = oldScroll.left;
        next.scrollTop = oldScroll.top;
      }
    },
    projectRow(project) {
      const cycles = GROUP_ORDER.map((code) => this.cycleCells(project.cycles.find((cycle) => cycle.group_code === code))).join('');
      const partner = project.partner_name || '-';
      const closing = project.closing_date === 'end' ? '末日' : `${project.closing_date}日`;
      return `<tr data-project-id="${project.project_id}">
        <td class="submission-project-cell">
          <div class="submission-partner-row">
            <strong class="submission-partner-name">${this.ctx.escapeHtml(partner)}</strong>
            <small>パートナー</small>
            <span class="submission-closing">${closing}</span>
          </div>
          <div class="submission-company">${this.ctx.escapeHtml(project.company_name || '-')}</div>
          <div class="submission-project-meta"><span>#${project.project_id}</span><span>${this.ctx.escapeHtml(project.project_name)}</span></div>
        </td>
        ${cycles}
        <td class="submission-project-total"><span>提出 <strong>${this.number(project.totals.submitted_count)}/3</strong></span><span>遅延 <strong>${this.number(project.totals.overdue_count)}件</strong></span><span>遅延合計 <strong>${project.totals.overdue_days ? `+${this.number(project.totals.overdue_days)}日` : '0日'}</strong></span></td>
      </tr>`;
    },
    cycleCells(cycle) {
      if (!cycle) return '<td class="submission-period-cell" colspan="3">-</td>';
      const overdue = Number(cycle.overdue_days) > 0;
      const tone = overdue ? 'is-overdue' : '';
      const common = `data-cycle="${cycle.group_code}" data-version="${cycle.version}"`;
      return `<td class="submission-period-cell ${tone}" ${common}>
          <div class="submission-period-range">${this.periodHtml(cycle.period_start, cycle.period_end)}</div>
          <div class="submission-planned">予定 <strong>${this.dateHtml(cycle.planned_submit_date)}</strong></div>
        </td>
        <td class="submission-status-cell ${tone}" ${common}>
          <label class="submission-switch"><input type="checkbox" data-submitted ${cycle.is_submitted ? 'checked' : ''}><span data-submitted-label>${cycle.is_submitted ? '提出済み' : '未提出'}</span></label>
        </td>
        <td class="submission-date-cell ${tone}" ${common}>
          <div class="submission-date-wrap">
            <input class="submission-date" type="date" data-submitted-date value="${this.ctx.escapeHtml(cycle.submitted_date || '')}" ${cycle.is_submitted ? '' : 'disabled'} aria-label="提出日">
            <label class="submission-overdue ${overdue ? 'is-overdue' : ''}">+<input class="submission-overdue-input" type="number" min="0" max="365" step="1" data-overdue-days value="${Number(cycle.overdue_days || 0)}" aria-label="遅延日数">日</label>
          </div>
        </td>`;
    },
    bind() {
      this.kit.bindShell();
      this.kit.bindMonthNavigator('submission-month', () => this.ym, (value) => { this.ym = value; }, () => this.show());
      document.querySelectorAll('[data-summary-filter]').forEach((button) => button.addEventListener('click', () => {
        this.filters.status = button.dataset.summaryFilter || '';
        this.show();
      }));
      document.querySelectorAll('[data-submitted]').forEach((input) => input.addEventListener('change', (event) => {
        const cell = event.target.closest('[data-cycle]');
        const row = event.target.closest('[data-project-id]');
        const groupCode = cell.dataset.cycle;
        const dateInput = this.cycleRoot(row, groupCode, '[data-submitted-date]');
        const label = this.cycleRoot(row, groupCode, '[data-submitted-label]');
        if (event.target.checked) {
          if (!dateInput.value) dateInput.value = this.todayLocal();
          dateInput.disabled = false;
          if (label) label.textContent = '提出済み';
        } else {
          dateInput.value = '';
          dateInput.disabled = true;
          if (label) label.textContent = '未提出';
        }
        this.saveCell(row, groupCode);
      }));
      document.querySelectorAll('[data-submitted-date]').forEach((input) => input.addEventListener('change', (event) => {
        const cell = event.target.closest('[data-cycle]');
        const row = event.target.closest('[data-project-id]');
        const groupCode = cell.dataset.cycle;
        const toggle = this.cycleRoot(row, groupCode, '[data-submitted]');
        const label = this.cycleRoot(row, groupCode, '[data-submitted-label]');
        toggle.checked = Boolean(event.target.value);
        if (label) label.textContent = toggle.checked ? '提出済み' : '未提出';
        this.saveCell(row, groupCode);
      }));
      document.querySelectorAll('[data-overdue-days]').forEach((input) => input.addEventListener('change', (event) => {
        const cell = event.target.closest('[data-cycle]');
        this.saveCell(event.target.closest('[data-project-id]'), cell.dataset.cycle, { overdueManual: true });
      }));
      document.getElementById('submission-filters')?.addEventListener('submit', (event) => {
        event.preventDefault();
        const form = new FormData(event.currentTarget);
        this.filters.q = String(form.get('q') || '').trim();
        this.filters.company_id = String(form.get('company_id') || '');
        this.filters.partner_id = String(form.get('partner_id') || '');
        this.filters.closing_date = String(form.get('closing_date') || '');
        this.filters.status = String(form.get('status') || '');
        this.show();
      });
      document.getElementById('submission-clear')?.addEventListener('click', () => {
        this.filters = { q: '', company_id: '', partner_id: '', closing_date: '', status: '' };
        this.show();
      });
    },
    async saveCell(row, groupCode, { overdueManual = false } = {}) {
      const projectId = Number(row.dataset.projectId);
      const submitted = this.cycleRoot(row, groupCode, '[data-submitted]').checked;
      const submittedDate = this.cycleRoot(row, groupCode, '[data-submitted-date]').value;
      const overdueInput = this.cycleRoot(row, groupCode, '[data-overdue-days]');
      const version = Number(row.querySelector(`[data-cycle="${groupCode}"]`)?.dataset.version || 0);
      const result = await this.ctx.api(`/api/daily-report-submissions/cycles/${projectId}/${groupCode}`, {
        method: 'PUT',
        body: JSON.stringify({
          target_year_month: this.ym,
          is_submitted: submitted,
          submitted_date: submitted ? submittedDate : null,
          overdue_days: overdueManual ? Number(overdueInput.value || 0) : null,
          version,
        }),
      });
      if (!result.res.ok) {
        window.alert(result.data?.message || '保存に失敗しました');
        return this.show();
      }
      const message = overdueManual
        ? '遅延日数を更新しました'
        : (submitted ? '提出済みに更新しました' : '未提出に戻しました');
      await this.show(message);
    },
    error(message) {
      this.ctx.app.innerHTML = this.kit.shell('日報提出一覧', `<section class="panel"><p class="flash">${this.ctx.escapeHtml(message || '読み込みに失敗しました')}</p></section>`);
      this.kit.bindShell();
    },
  };

  window.LinksDailyReportSubmissions = ui;
})();
