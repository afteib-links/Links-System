(() => {
  const GROUP_ORDER = ['early', 'middle', 'late'];
  const STATUS_LABELS = { unplanned: '未作成', planned: '予定作成済み', exported: 'CSV出力済み', held: '保留', executed: '実行済み', cancelled: '取消済み' };

  const ui = {
    async open(ctx) {
      this.ctx = ctx;
      this.kit = window.LinksFeatureKit.createFeatureKit(ctx);
      this.ym = this.kit.currentYearMonth();
      this.filters = { q: '', company_id: '', partner_id: '', closing_date: '', status: '' };
      this.selected = new Set();
      const [companies, partners] = await Promise.all([this.ctx.api('/api/lookups/companies'), this.ctx.api('/api/lookups/partners')]);
      this.companies = companies.data?.companies || [];
      this.partners = partners.data?.partners || [];
      await this.show();
    },
    money(value) { return Math.round(Number(value || 0)).toLocaleString('ja-JP'); },
    status(value) { return STATUS_LABELS[value] || value || '-'; },
    queryString() {
      const params = new URLSearchParams({ target_year_month: this.ym });
      Object.entries(this.filters).forEach(([key, value]) => { if (value) params.set(key, value); });
      return params.toString();
    },
    async show(message = '') {
      const scroll = document.querySelector('.advance-matrix-wrap');
      const oldScroll = scroll ? { left: scroll.scrollLeft, top: scroll.scrollTop } : null;
      this.ctx.renderLoading();
      const { res, data } = await this.ctx.api(`/api/advances/matrix?${this.queryString()}`);
      if (!res.ok || !data?.ok) return this.error(data?.message);
      this.data = data;
      const projects = data.projects || [];
      const groups = Object.fromEntries((data.groups || []).map((group) => [group.group_code, group]));
      const rows = projects.map((project) => this.projectRow(project)).join('');
      const cycleHeaders = GROUP_ORDER.map((code) => {
        const group = groups[code] || {};
        return `<th class="advance-cycle-heading"><strong>${this.ctx.escapeHtml(group.label || code)}</strong><small>支払予定 ${this.ctx.escapeHtml(group.payment_date || '-')}</small></th>`;
      }).join('');
      const footers = GROUP_ORDER.map((code) => {
        const total = (data.summary?.cycles || []).find((row) => row.group_code === code) || {};
        return `<td class="advance-cycle-total"><span>${this.money(total.advance_amount)}円</span><small>${this.money(total.advance_count)}件／手数料 ${this.money(total.transfer_fee_amount)}円</small><div class="advance-total-actions"><button class="btn btn-small" data-create-group="${code}">選択分を予定作成</button><button class="btn btn-ghost btn-small" data-export-group="${code}" data-cycle="${groups[code]?.cash_cycle_id || ''}">CSV出力</button></div></td>`;
      }).join('');
      this.ctx.app.innerHTML = this.kit.shell(
        '先払管理',
        `<section class="panel advance-panel">
          ${message ? `<p class="flash">${this.ctx.escapeHtml(message)}</p>` : ''}
          <div class="advance-topbar">
            ${this.kit.monthNavigatorHtml(this.ym, 'advance-month')}
            <div class="advance-summary"><span>対象月全体 <strong>${this.money(data.summary?.project_count)}案件</strong></span><span>先払 <strong>${this.money(data.summary?.advance_count)}回</strong></span><span>合計 <strong>${this.money(data.summary?.advance_amount)}円</strong></span><span>手数料 <strong>${this.money(data.summary?.transfer_fee_amount)}円</strong></span></div>
          </div>
          <form id="advance-filters" class="advance-filterbar">
            <input name="q" value="${this.ctx.escapeHtml(this.filters.q)}" placeholder="案件・企業・パートナーを検索">
            <select name="company_id"><option value="">全企業</option>${this.companies.map((row) => `<option value="${row.company_id}" ${String(this.filters.company_id) === String(row.company_id) ? 'selected' : ''}>${this.ctx.escapeHtml(row.company_name)}</option>`).join('')}</select>
            <select name="partner_id"><option value="">全パートナー</option>${this.partners.map((row) => `<option value="${row.partner_id}" ${String(this.filters.partner_id) === String(row.partner_id) ? 'selected' : ''}>${this.ctx.escapeHtml(row.partner_name)}</option>`).join('')}</select>
            <select name="closing_date"><option value="">全締日</option>${['5','10','15','20','25','end'].map((v) => `<option value="${v}" ${this.filters.closing_date === v ? 'selected' : ''}>${v === 'end' ? '末日' : `${v}日`}</option>`).join('')}</select>
            <select name="status"><option value="">全状態</option>${Object.entries(STATUS_LABELS).filter(([v]) => v !== 'cancelled').map(([v,l]) => `<option value="${v}" ${this.filters.status === v ? 'selected' : ''}>${l}</option>`).join('')}</select>
            <button class="btn btn-secondary btn-small">絞り込み</button><button type="button" id="advance-clear" class="btn btn-ghost btn-small">クリア</button>
            <span class="muted">表示 ${this.money(data.visible_project_count)}／全 ${this.money(data.summary?.project_count)}案件</span>
          </form>
          <p class="advance-help">支払区分が「分割」の個別案件を、稼働0日を含めて表示します。金額変更時は理由を記録します。</p>
          <div class="advance-matrix-wrap">
            <table class="advance-matrix">
              <thead><tr><th class="advance-project-heading">案件情報</th>${cycleHeaders}<th class="advance-project-total-heading">案件別合計</th></tr></thead>
              <tbody>${rows || '<tr><td colspan="5" class="advance-empty">条件に一致する分割案件はありません</td></tr>'}</tbody>
              <tfoot><tr><td class="advance-project-footer">対象月全体の合計</td>${footers}<td class="advance-grand-total"><strong>${this.money(data.summary?.advance_amount)}円</strong><small>先払 ${this.money(data.summary?.advance_count)}回</small><small>手数料 ${this.money(data.summary?.transfer_fee_amount)}円</small></td></tr></tfoot>
            </table>
          </div>
        </section>`,
        { wide: true }
      );
      this.bind();
      if (oldScroll) {
        const next = document.querySelector('.advance-matrix-wrap');
        next.scrollLeft = oldScroll.left; next.scrollTop = oldScroll.top;
      }
    },
    projectRow(project) {
      const checked = this.selected.has(project.project_id) ? 'checked' : '';
      const cycles = GROUP_ORDER.map((code) => this.cycleCell(project, project.cycles.find((c) => c.group_code === code))).join('');
      return `<tr data-project-id="${project.project_id}">
        <td class="advance-project-cell"><label class="advance-project-select"><input type="checkbox" data-select-project ${checked}><span>#${project.project_id}</span></label><strong class="advance-project-name">${this.ctx.escapeHtml(project.project_name)}</strong><span>${this.ctx.escapeHtml(project.company_name || '-')}</span><span>${this.ctx.escapeHtml(project.partner_name || '-')}</span><small>締日 ${project.closing_date === 'end' ? '末日' : `${project.closing_date}日`}</small></td>
        ${cycles}
        <td class="advance-project-total"><span>先払回数 <strong>${this.money(project.totals.advance_count)}回</strong></span><span>先払合計額 <strong>${this.money(project.totals.advance_amount)}円</strong></span><span>手数料 <strong>${this.money(project.totals.transfer_fee_amount)}円</strong></span></td>
      </tr>`;
    },
    cycleCell(project, cycle) {
      if (!cycle) return '<td class="advance-cycle-cell">-</td>';
      const locked = ['planned','exported','held','executed'].includes(cycle.status) || ['exported','executed'].includes(cycle.cash_status);
      const changedAmount = Number(cycle.advance_amount) !== Number(cycle.calculated_amount);
      const changedFee = Number(cycle.transfer_fee_amount) !== Number(cycle.transfer_fee_base_amount);
      const state = cycle.cash_status || cycle.status;
      return `<td class="advance-cycle-cell" data-cycle="${cycle.group_code}" data-version="${cycle.version}">
        <div class="advance-cycle-line"><label class="advance-switch"><input type="checkbox" data-target ${cycle.is_target ? 'checked' : ''} ${locked ? 'disabled' : ''}><span>先払</span></label>${this.kit.statusBadge(state, this.status(state))}</div>
        <label class="advance-inline-field"><span>支払額</span><input type="number" inputmode="numeric" min="0" max="99999999" data-amount value="${Number(cycle.advance_amount)}" ${locked || !cycle.is_target ? 'disabled' : ''}></label>
        <small class="advance-origin ${changedAmount ? 'is-changed' : ''}">元：${this.money(cycle.calculated_amount)}円（${this.money(cycle.unit_price)}円 × ${cycle.work_days}日）${changedAmount ? '・変更あり' : ''}</small>
        <label class="advance-inline-field"><span>手数料</span><input type="number" inputmode="numeric" min="0" max="99999999" data-fee value="${Number(cycle.transfer_fee_amount)}" ${locked || !cycle.is_target ? 'disabled' : ''}></label>
        <small class="advance-origin ${changedFee ? 'is-changed' : ''}">自動：${this.money(cycle.transfer_fee_base_amount)}円${cycle.transfer_fee_pattern_name ? `（${this.ctx.escapeHtml(cycle.transfer_fee_pattern_name)}）` : ''}${changedFee ? '・変更あり' : ''}</small>
        <small class="advance-period">${cycle.period_start}〜${cycle.period_end}</small>
        <div class="advance-cell-actions">${cycle.status === 'planned' ? `<button class="btn btn-ghost btn-small" data-cancel="${cycle.advance_record_id}">作成取消</button>` : ''}${cycle.status === 'executed' ? `<button class="btn btn-ghost btn-small" data-reverse="${cycle.advance_record_id}">返金・訂正</button>` : ''}</div>
      </td>`;
    },
    bind() {
      this.kit.bindShell();
      this.kit.bindMonthNavigator('advance-month', () => this.ym, (value) => { this.ym = value; this.selected.clear(); }, () => this.show());
      document.querySelectorAll('[data-select-project]').forEach((input) => input.addEventListener('change', (event) => {
        const id = Number(event.target.closest('[data-project-id]').dataset.projectId);
        if (event.target.checked) this.selected.add(id); else this.selected.delete(id);
      }));
      document.querySelectorAll('[data-target]').forEach((input) => input.addEventListener('change', (event) => this.saveCell(event.target.closest('[data-project-id]'), event.target.closest('[data-cycle]'))));
      document.querySelectorAll('[data-amount],[data-fee]').forEach((input) => input.addEventListener('change', (event) => this.saveCell(event.target.closest('[data-project-id]'), event.target.closest('[data-cycle]'))));
      document.querySelectorAll('[data-create-group]').forEach((button) => button.addEventListener('click', () => this.createGroup(button.dataset.createGroup)));
      document.querySelectorAll('[data-export-group]').forEach((button) => button.addEventListener('click', () => this.exportCsv(Number(button.dataset.cycle), button.dataset.exportGroup)));
      document.querySelectorAll('[data-cancel]').forEach((button) => button.addEventListener('click', () => this.cancel(Number(button.dataset.cancel))));
      document.querySelectorAll('[data-reverse]').forEach((button) => button.addEventListener('click', () => this.reversal(Number(button.dataset.reverse))));
      document.getElementById('advance-filters')?.addEventListener('submit', (event) => {
        event.preventDefault(); const form = new FormData(event.currentTarget);
        this.filters.q = String(form.get('q') || '').trim(); this.filters.company_id = String(form.get('company_id') || ''); this.filters.partner_id = String(form.get('partner_id') || ''); this.filters.closing_date = String(form.get('closing_date') || ''); this.filters.status = String(form.get('status') || ''); this.show();
      });
      document.getElementById('advance-clear')?.addEventListener('click', () => { this.filters = { q:'',company_id:'',partner_id:'',closing_date:'',status:'' }; this.show(); });
    },
    findCycle(projectId, code) { return this.data.projects.find((p) => p.project_id === projectId)?.cycles.find((c) => c.group_code === code); },
    async saveCell(row, cell) {
      const projectId = Number(row.dataset.projectId); const code = cell.dataset.cycle; const original = this.findCycle(projectId, code);
      const amount = Number(cell.querySelector('[data-amount]').value || 0); const fee = Number(cell.querySelector('[data-fee]').value || 0);
      let reason = original.adjustment_reason || '';
      if ((amount !== Number(original.calculated_amount) || fee !== Number(original.transfer_fee_base_amount)) && !reason) {
        reason = window.prompt('元の金額または自動手数料から変更する理由を入力してください', '') || '';
        if (!reason.trim()) { window.alert('変更理由は必須です'); return this.show(); }
      }
      const result = await this.ctx.api(`/api/advances/cycles/${projectId}/${code}`, { method:'PUT', body:JSON.stringify({ target_year_month:this.ym, is_target:cell.querySelector('[data-target]').checked, advance_amount:amount, transfer_fee_amount:fee, adjustment_reason:reason.trim(), version:Number(cell.dataset.version || 0) }) });
      if (!result.res.ok) { window.alert(result.data?.message || '保存に失敗しました'); return this.show(); }
      await this.show('先払条件を保存しました');
    },
    async createGroup(code) {
      if (!this.selected.size) return window.alert('予定作成する案件を左端で選択してください');
      const items = [];
      this.selected.forEach((projectId) => {
        const cycle = this.findCycle(projectId, code);
        if (cycle?.is_target && Number(cycle.advance_amount) > 0 && cycle.status === 'unplanned') items.push({ project_id:projectId, advance_amount:Number(cycle.advance_amount), transfer_fee_amount:Number(cycle.transfer_fee_amount), adjustment_reason:cycle.adjustment_reason || '', version:Number(cycle.version || 0) });
      });
      if (!items.length) return window.alert('選択案件に、先払ON・支払額1円以上の未作成セルがありません');
      const result = await this.ctx.api(`/api/advances/groups/${code}/records`, { method:'POST', body:JSON.stringify({ target_year_month:this.ym, items }) });
      if (!result.res.ok) return window.alert(result.data?.message || '予定作成に失敗しました');
      await this.show(`${result.data.payment_date} 支払分を予定作成しました`);
    },
    async cancel(id) {
      const reason = window.prompt('作成取消理由を入力してください', '') || ''; if (!reason.trim()) return;
      const result = await this.ctx.api(`/api/advances/records/${id}/cancel`, { method:'POST', body:JSON.stringify({ reason:reason.trim() }) });
      if (!result.res.ok) return window.alert(result.data?.message || '作成取消に失敗しました');
      await this.show('予定を作成取消し、再作成できる状態に戻しました');
    },
    async exportCsv(cashCycleId, groupCode) {
      if (!cashCycleId) return window.alert('入出金管理回が見つかりません');
      try {
        const response = await fetch('/api/cash-management/exports', { method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json'},body:JSON.stringify({ cash_cycle_id:cashCycleId,group_code:groupCode }) });
        if (!response.ok) { const data = await response.json(); throw new Error(data.message || 'CSV出力に失敗しました'); }
        const blob = await response.blob(); const url = URL.createObjectURL(blob); const link = document.createElement('a'); link.href = url; link.download = `advance-${groupCode}-${this.ym}.csv`; link.click(); URL.revokeObjectURL(url);
        await this.show('サイクルのCSVを出力しました');
      } catch (error) { window.alert(error.message); }
    },
    async reversal(id) {
      const cycle = window.prompt('返金・訂正先の管理回IDを入力してください', ''); const amount = window.prompt('返金・訂正額を入力してください', ''); if (!cycle || !amount) return;
      const result = await this.ctx.api(`/api/advances/records/${id}/reversal`, { method:'POST',body:JSON.stringify({ cash_cycle_id:Number(cycle),amount:Number(amount) }) });
      if (!result.res.ok) return window.alert(result.data?.message || '返金・訂正予定の作成に失敗しました'); await this.show('返金・訂正予定を作成しました');
    },
    error(message) { this.ctx.app.innerHTML = this.kit.shell('先払管理', `<section class="panel"><p class="error">${this.ctx.escapeHtml(message || '先払情報を取得できませんでした')}</p></section>`, { wide:true }); this.kit.bindShell(); },
  };
  window.LinksAdvances = ui;
})();
