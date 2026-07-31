(() => {
  const LinksDailyReports = {
    async open(ctx) {
      this.kit = window.LinksFeatureKit.createFeatureKit(ctx);
      this.ctx = ctx;
      this.ym = this.kit.currentYearMonth();
      await this.showMonthList();
    },

    shiftMonth(delta) {
      const [y, m] = this.ym.split('-').map(Number);
      const d = new Date(y, m - 1 + delta, 1);
      this.ym = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    },

    statusLabel(s) {
      return (
        {
          draft: '下書き',
          confirmed: '確定',
          approved: '承認',
          rejected: '却下',
        }[s] || s || '-'
      );
    },

    async showMonthList(message = '') {
      this.ctx.renderLoading();
      const { res, data } = await this.ctx.api(
        `/api/daily-reports/month-projects?target_year_month=${encodeURIComponent(this.ym)}`
      );
      if (!res.ok || !data?.ok) {
        this.ctx.app.innerHTML = this.kit.shell(
          '日報',
          `<section class="panel"><p class="error">${this.ctx.escapeHtml(data?.message || '取得失敗')}</p></section>`
        );
        this.kit.bindShell();
        return;
      }
      const summary = data.summary || {};
      const rows = (data.rows || [])
        .map(
          (r) => `
          <tr>
            <td>${this.ctx.escapeHtml(r.project_id)}</td>
            <td>${this.ctx.escapeHtml(r.company_name || '-')}</td>
            <td>${this.ctx.escapeHtml(r.partner_name || '-')}</td>
            <td>${this.ctx.escapeHtml(r.template_name || r.manager_name || '-')}</td>
            <td>${this.ctx.escapeHtml(r.input_days)}/${this.ctx.escapeHtml(r.days_in_month)}</td>
            <td>${this.ctx.escapeHtml(r.completion_rate)}%</td>
            <td>${this.ctx.escapeHtml(r.input_status)}</td>
            <td>
              <button type="button" class="btn btn-small" data-input="${r.project_id}"
                data-company="${r.company_id || ''}" data-partner="${r.partner_id || ''}">入力</button>
            </td>
          </tr>`
        )
        .join('');
      this.ctx.app.innerHTML = this.kit.shell(
        '日報（仮組）',
        `<section class="panel">
          ${message ? `<p class="flash">${this.ctx.escapeHtml(message)}</p>` : ''}
          <div class="toolbar">
            <button type="button" class="btn btn-ghost" id="prev-month">← 前月</button>
            <input type="month" id="ym" value="${this.ctx.escapeHtml(this.ym)}" />
            <button type="button" class="btn btn-ghost" id="next-month">次月 →</button>
            <button type="button" class="btn" id="reload">表示</button>
          </div>
          <p class="muted">対象案件 ${this.ctx.escapeHtml(summary.project_count ?? 0)} /
            入力あり ${this.ctx.escapeHtml(summary.input_project_count ?? 0)} /
            平均完了率 ${this.ctx.escapeHtml(summary.avg_completion_rate ?? 0)}%</p>
          <div class="table-wrap table-wrap-sticky">
            <table class="data-table data-table-compact">
              <thead><tr><th>案件</th><th>企業</th><th>パートナー</th><th>名称</th><th>入力日数</th><th>完了率</th><th>状況</th><th>操作</th></tr></thead>
              <tbody>${rows || '<tr><td colspan="8">案件がありません</td></tr>'}</tbody>
            </table>
          </div>
        </section>`
      );
      this.kit.bindShell();
      document.getElementById('prev-month')?.addEventListener('click', () => {
        this.shiftMonth(-1);
        this.showMonthList();
      });
      document.getElementById('next-month')?.addEventListener('click', () => {
        this.shiftMonth(1);
        this.showMonthList();
      });
      document.getElementById('reload')?.addEventListener('click', () => {
        this.ym = document.getElementById('ym').value || this.ym;
        this.showMonthList();
      });
      document.querySelectorAll('[data-input]').forEach((btn) =>
        btn.addEventListener('click', () => {
          this.kit.pushNav(() => this.showMonthList());
          this.showInputGrid({
            project_id: Number(btn.getAttribute('data-input')),
            company_id: Number(btn.getAttribute('data-company') || 0) || null,
            partner_id: Number(btn.getAttribute('data-partner') || 0) || null,
          });
        })
      );
    },

    daysInMonth(ym) {
      const [y, m] = ym.split('-').map(Number);
      return new Date(y, m, 0).getDate();
    },

    emptyDay(dateStr, meta) {
      return {
        daily_report_id: null,
        version: 1,
        status: 'draft',
        project_id: meta.project_id,
        company_id: meta.company_id,
        partner_id: meta.partner_id,
        target_year_month: this.ym,
        work_date: dateStr,
        start_time: '',
        end_time: '',
        break_time: '',
        is_absent: 0,
        is_training: 0,
        binding_hours: '',
        work_hours: '',
        overtime_hours: '',
        shortage_hours: '',
        start_meter: '',
        end_meter: '',
        total_distance: '',
        toll_fee: '',
        parking_fee: '',
        transport_fee: '',
        night_hours: '',
        spot_amount: '',
        row_comment: '',
        override_billing_amount: '',
        override_payment_amount: '',
        calculated_billing_amount: '',
        calculated_payment_amount: '',
        _dirty: false,
        _expanded: false,
      };
    },

    async showInputGrid(meta) {
      this.ctx.renderLoading();
      this.gridMeta = meta;
      const params = new URLSearchParams({
        target_year_month: this.ym,
        project_id: meta.project_id,
      });
      const { res, data } = await this.ctx.api(`/api/daily-reports?${params}`);
      if (!res.ok || !data?.ok) {
        this.ctx.app.innerHTML = this.kit.shell(
          '日報入力',
          `<section class="panel"><p class="error">${this.ctx.escapeHtml(data?.message || '取得失敗')}</p></section>`,
          { onBack: () => this.showMonthList() }
        );
        this.kit.bindShell({ onBack: () => this.showMonthList() });
        return;
      }
      const byDate = new Map();
      for (const r of data.reports || []) {
        byDate.set(this.kit.dateValue(r.work_date), { ...r, _dirty: false, _expanded: false });
      }
      const days = this.daysInMonth(this.ym);
      this.gridRows = [];
      for (let d = 1; d <= days; d += 1) {
        const dateStr = `${this.ym}-${String(d).padStart(2, '0')}`;
        this.gridRows.push(byDate.get(dateStr) || this.emptyDay(dateStr, meta));
      }
      this.renderGrid();
    },

    summaryFromGrid() {
      let workDays = 0;
      let overtime = 0;
      let shortage = 0;
      let distance = 0;
      for (const r of this.gridRows) {
        if (r.daily_report_id || r.start_time || r.is_absent || r.is_training) workDays += 1;
        overtime += Number(r.overtime_hours || 0);
        shortage += Number(r.shortage_hours || 0);
        distance += Number(r.total_distance || 0);
      }
      return { workDays, overtime, shortage, distance };
    },

    renderGrid(message = '') {
      const sum = this.summaryFromGrid();
      const body = this.gridRows
        .map((r, idx) => {
          const locked = r.status === 'approved';
          const main = `
            <tr class="dr-main" data-idx="${idx}">
              <td><button type="button" class="btn btn-ghost btn-small" data-expand="${idx}">${r._expanded ? '▼' : '▶'}</button> ${this.ctx.escapeHtml(this.kit.dateValue(r.work_date))}</td>
              <td><input type="checkbox" data-f="is_absent" data-idx="${idx}" ${r.is_absent ? 'checked' : ''} ${locked ? 'disabled' : ''} /></td>
              <td><input type="checkbox" data-f="is_training" data-idx="${idx}" ${r.is_training ? 'checked' : ''} ${locked ? 'disabled' : ''} /></td>
              <td><input type="time" data-f="start_time" data-idx="${idx}" value="${this.ctx.escapeHtml(this.kit.timeValue(r.start_time))}" ${locked ? 'disabled' : ''} /></td>
              <td><input type="time" data-f="end_time" data-idx="${idx}" value="${this.ctx.escapeHtml(this.kit.timeValue(r.end_time))}" ${locked ? 'disabled' : ''} /></td>
              <td><input type="number" step="0.25" style="width:4rem" data-f="binding_hours" data-idx="${idx}" value="${this.ctx.escapeHtml(r.binding_hours ?? '')}" ${locked ? 'disabled' : ''} /></td>
              <td><input type="number" step="0.25" style="width:4rem" data-f="work_hours" data-idx="${idx}" value="${this.ctx.escapeHtml(r.work_hours ?? '')}" ${locked ? 'disabled' : ''} /></td>
              <td><input type="number" step="0.25" style="width:4rem" data-f="overtime_hours" data-idx="${idx}" value="${this.ctx.escapeHtml(r.overtime_hours ?? '')}" ${locked ? 'disabled' : ''} /></td>
              <td><input type="number" step="0.25" style="width:4rem" data-f="shortage_hours" data-idx="${idx}" value="${this.ctx.escapeHtml(r.shortage_hours ?? '')}" ${locked ? 'disabled' : ''} /></td>
              <td><input type="number" step="0.1" style="width:5rem" data-f="total_distance" data-idx="${idx}" value="${this.ctx.escapeHtml(r.total_distance ?? '')}" ${locked ? 'disabled' : ''} /></td>
              <td><input type="number" step="1" style="width:5rem" data-f="toll_fee" data-idx="${idx}" value="${this.ctx.escapeHtml(r.toll_fee ?? '')}" ${locked ? 'disabled' : ''} /></td>
              <td><input type="number" step="1" style="width:5rem" data-f="parking_fee" data-idx="${idx}" value="${this.ctx.escapeHtml(r.parking_fee ?? '')}" ${locked ? 'disabled' : ''} /></td>
              <td><input type="number" step="1" style="width:5rem" data-f="transport_fee" data-idx="${idx}" value="${this.ctx.escapeHtml(r.transport_fee ?? '')}" ${locked ? 'disabled' : ''} /></td>
              <td><span class="status-badge status-${this.ctx.escapeHtml(r.status || 'draft')}">${this.ctx.escapeHtml(this.statusLabel(r.status))}</span></td>
            </tr>`;
          const expand = r._expanded
            ? `<tr class="dr-expand" data-expand-row="${idx}">
                <td colspan="14">
                  <div class="form-grid">
                    <div><label>深夜時間</label><input type="number" step="0.25" data-f="night_hours" data-idx="${idx}" value="${this.ctx.escapeHtml(r.night_hours ?? '')}" ${locked ? 'disabled' : ''} /></div>
                    <div><label>スポット加算</label><input type="number" step="0.01" data-f="spot_amount" data-idx="${idx}" value="${this.ctx.escapeHtml(r.spot_amount ?? '')}" ${locked ? 'disabled' : ''} /></div>
                    <div><label>上書・請求</label><input type="number" step="0.01" data-f="override_billing_amount" data-idx="${idx}" value="${this.ctx.escapeHtml(r.override_billing_amount ?? '')}" ${locked ? 'disabled' : ''} /></div>
                    <div><label>上書・支払</label><input type="number" step="0.01" data-f="override_payment_amount" data-idx="${idx}" value="${this.ctx.escapeHtml(r.override_payment_amount ?? '')}" ${locked ? 'disabled' : ''} /></div>
                    <div class="full"><label>行コメント</label><input data-f="row_comment" data-idx="${idx}" value="${this.ctx.escapeHtml(r.row_comment || '')}" ${locked ? 'disabled' : ''} /></div>
                    <div class="full btn-row">
                      <button type="button" class="btn btn-small" data-save-row="${idx}" ${locked ? 'disabled' : ''}>行保存</button>
                      ${
                        r.daily_report_id && (r.status === 'draft' || r.status === 'rejected')
                          ? `<button type="button" class="btn btn-small" data-status-row="${idx}" data-status="confirmed">承認依頼</button>`
                          : ''
                      }
                      ${
                        r.daily_report_id && r.status === 'confirmed'
                          ? `<button type="button" class="btn btn-small" data-status-row="${idx}" data-status="approved">承認</button>`
                          : ''
                      }
                    </div>
                  </div>
                </td>
              </tr>`
            : '';
          return main + expand;
        })
        .join('');

      this.ctx.app.innerHTML = this.kit.shell(
        `日報入力（案件#${this.gridMeta.project_id} / ${this.ym}）`,
        `<section class="panel">
          ${message ? `<p class="flash">${this.ctx.escapeHtml(message)}</p>` : ''}
          <div class="dr-summary">
            <span>稼働日数: <strong>${sum.workDays}</strong></span>
            <span>超過合計: <strong>${sum.overtime}</strong></span>
            <span>不足合計: <strong>${sum.shortage}</strong></span>
            <span>総距離: <strong>${sum.distance}</strong></span>
          </div>
          <div class="btn-row">
            <button type="button" class="btn" id="save-all">一括保存</button>
            <button type="button" class="btn btn-ghost" id="amount-check">金額確認</button>
            <button type="button" class="btn btn-ghost" id="expand-all">一括表示</button>
            <button type="button" class="btn btn-ghost" id="back-month">一覧へ</button>
          </div>
          <div class="table-wrap table-wrap-sticky">
            <table class="data-table data-table-compact">
              <thead>
                <tr>
                  <th>日付</th><th>不参</th><th>研修</th><th>開始</th><th>終了</th>
                  <th>拘束</th><th>稼働</th><th>超過</th><th>不足</th><th>距離</th>
                  <th>通行料</th><th>駐車料</th><th>交通費</th><th>状態</th>
                </tr>
              </thead>
              <tbody>${body}</tbody>
            </table>
          </div>
        </section>`,
        { onBack: () => this.showMonthList() }
      );
      this.kit.bindShell({ onBack: () => this.showMonthList() });
      this.bindGrid();
    },

    collectField(el) {
      const idx = Number(el.getAttribute('data-idx'));
      const field = el.getAttribute('data-f');
      const row = this.gridRows[idx];
      if (!row) return;
      if (el.type === 'checkbox') row[field] = el.checked ? 1 : 0;
      else row[field] = el.value;
      row._dirty = true;
    },

    bindGrid() {
      document.querySelectorAll('[data-f][data-idx]').forEach((el) => {
        el.addEventListener('change', () => this.collectField(el));
        el.addEventListener('input', () => this.collectField(el));
      });
      document.querySelectorAll('[data-expand]').forEach((btn) =>
        btn.addEventListener('click', () => {
          document.querySelectorAll('[data-f][data-idx]').forEach((el) => this.collectField(el));
          const idx = Number(btn.getAttribute('data-expand'));
          this.gridRows[idx]._expanded = !this.gridRows[idx]._expanded;
          this.renderGrid();
        })
      );
      document.getElementById('expand-all')?.addEventListener('click', () => {
        document.querySelectorAll('[data-f][data-idx]').forEach((el) => this.collectField(el));
        const anyClosed = this.gridRows.some((r) => !r._expanded);
        this.gridRows.forEach((r) => {
          r._expanded = anyClosed;
        });
        this.renderGrid();
      });
      document.getElementById('amount-check')?.addEventListener('click', () => {
        document.querySelectorAll('[data-f][data-idx]').forEach((el) => this.collectField(el));
        let billing = 0;
        let payment = 0;
        for (const r of this.gridRows) {
          billing += Number(r.override_billing_amount ?? r.calculated_billing_amount ?? 0);
          payment += Number(r.override_payment_amount ?? r.calculated_payment_amount ?? 0);
        }
        window.alert(`請求合計: ${billing}\n支払合計: ${payment}`);
      });
      document.getElementById('back-month')?.addEventListener('click', () => this.showMonthList());
      document.getElementById('save-all')?.addEventListener('click', () => this.saveAll());
      document.querySelectorAll('[data-save-row]').forEach((btn) =>
        btn.addEventListener('click', async () => {
          document.querySelectorAll('[data-f][data-idx]').forEach((el) => this.collectField(el));
          await this.saveRow(Number(btn.getAttribute('data-save-row')));
        })
      );
      document.querySelectorAll('[data-status-row]').forEach((btn) =>
        btn.addEventListener('click', async () => {
          const idx = Number(btn.getAttribute('data-status-row'));
          const status = btn.getAttribute('data-status');
          const row = this.gridRows[idx];
          if (!row.daily_report_id) return;
          const result = await this.ctx.api(`/api/daily-reports/${row.daily_report_id}/status`, {
            method: 'POST',
            body: JSON.stringify({ status }),
          });
          if (!result.res.ok) {
            window.alert(result.data?.message || 'ステータス更新失敗');
            return;
          }
          await this.showInputGrid(this.gridMeta);
        })
      );
    },

    rowPayload(row) {
      return {
        project_id: row.project_id || this.gridMeta.project_id,
        company_id: row.company_id || this.gridMeta.company_id,
        partner_id: row.partner_id || this.gridMeta.partner_id || null,
        target_year_month: this.ym,
        work_date: this.kit.dateValue(row.work_date),
        start_time: row.start_time || null,
        end_time: row.end_time || null,
        break_time: row.break_time || null,
        is_absent: row.is_absent ? 1 : 0,
        is_training: row.is_training ? 1 : 0,
        binding_hours: row.binding_hours || null,
        work_hours: row.work_hours || null,
        overtime_hours: row.overtime_hours || null,
        shortage_hours: row.shortage_hours || null,
        total_distance: row.total_distance || null,
        toll_fee: row.toll_fee || null,
        parking_fee: row.parking_fee || null,
        transport_fee: row.transport_fee || null,
        night_hours: row.night_hours || null,
        spot_amount: row.spot_amount || null,
        row_comment: row.row_comment || null,
        override_billing_amount: row.override_billing_amount || null,
        override_payment_amount: row.override_payment_amount || null,
        version: row.version || 1,
      };
    },

    async saveRow(idx) {
      const row = this.gridRows[idx];
      const hasData =
        row.start_time ||
        row.end_time ||
        row.is_absent ||
        row.is_training ||
        row.toll_fee ||
        row.parking_fee ||
        row.transport_fee ||
        row.row_comment;
      if (!hasData && !row.daily_report_id) return true;
      if (!row.company_id && !this.gridMeta.company_id) {
        window.alert('企業情報がありません');
        return false;
      }
      const payload = this.rowPayload(row);
      const result = row.daily_report_id
        ? await this.ctx.api(`/api/daily-reports/${row.daily_report_id}`, {
            method: 'PUT',
            body: JSON.stringify(payload),
          })
        : await this.ctx.api('/api/daily-reports', { method: 'POST', body: JSON.stringify(payload) });
      if (!result.res.ok || !result.data?.ok) {
        window.alert(result.data?.message || `${row.work_date} の保存に失敗`);
        return false;
      }
      const saved = result.data.report;
      if (saved) {
        this.gridRows[idx] = { ...this.gridRows[idx], ...saved, _dirty: false, _expanded: row._expanded };
      }
      return true;
    },

    async saveAll() {
      document.querySelectorAll('[data-f][data-idx]').forEach((el) => this.collectField(el));
      for (let i = 0; i < this.gridRows.length; i += 1) {
        const row = this.gridRows[i];
        if (!row._dirty && !row.daily_report_id) {
          const hasData = row.start_time || row.end_time || row.is_absent || row.is_training;
          if (!hasData) continue;
        }
        if (row._dirty || (!row.daily_report_id && (row.start_time || row.is_absent || row.is_training))) {
          const ok = await this.saveRow(i);
          if (!ok) return;
        }
      }
      await this.showInputGrid(this.gridMeta);
      this.ctx.showToast('保存しました');
    },
  };

  window.LinksDailyReports = LinksDailyReports;
})();
