(() => {
  const LinksDailyReports = {
    async open(ctx) {
      this.kit = window.LinksFeatureKit.createFeatureKit(ctx);
      this.ctx = ctx;
      this.listState = {
        target_year_month: this.kit.currentYearMonth(),
        status: '',
        q: '',
      };
      const [companies, partners, projects] = await Promise.all([
        this.ctx.api('/api/lookups/companies'),
        this.ctx.api('/api/lookups/partners'),
        this.ctx.api('/api/lookups/projects'),
      ]);
      this.companies = companies.data?.companies || [];
      this.partners = partners.data?.partners || [];
      this.projects = projects.data?.projects || [];
      await this.showList();
    },

    statusLabel(s) {
      return (
        {
          draft: '下書き',
          confirmed: '確定',
          approved: '承認',
          rejected: '却下',
        }[s] || s
      );
    },

    async showList(message = '') {
      this.ctx.renderLoading();
      const params = new URLSearchParams(this.listState);
      const { res, data } = await this.ctx.api(`/api/daily-reports?${params}`);
      if (!res.ok || !data?.ok) {
        this.ctx.app.innerHTML = this.kit.shell(
          '日報',
          `<section class="panel"><p class="error">${this.ctx.escapeHtml(data?.message || '取得失敗')}</p></section>`
        );
        this.kit.bindShell();
        return;
      }
      const rows = (data.reports || [])
        .map(
          (r) => `
          <tr>
            <td>${this.ctx.escapeHtml(r.daily_report_id)}</td>
            <td>${this.ctx.escapeHtml(this.kit.dateValue(r.work_date))}</td>
            <td>${this.ctx.escapeHtml(r.company_name || r.company_id)}</td>
            <td>${this.ctx.escapeHtml(r.partner_name || '-')}</td>
            <td>${this.ctx.escapeHtml(r.project_id)}</td>
            <td><span class="status-badge status-${this.ctx.escapeHtml(r.status)}">${this.ctx.escapeHtml(
              this.statusLabel(r.status)
            )}</span></td>
            <td>${this.ctx.escapeHtml(r.effective_billing_amount)}</td>
            <td>${this.ctx.escapeHtml(r.effective_payment_amount)}</td>
            <td>
              <button type="button" class="btn btn-ghost btn-small" data-edit="${r.daily_report_id}">開く</button>
              <button type="button" class="btn btn-danger btn-small" data-del="${r.daily_report_id}">削除</button>
            </td>
          </tr>`
        )
        .join('');
      this.ctx.app.innerHTML = this.kit.shell(
        '日報（仮組）',
        `<section class="panel">
          ${message ? `<p class="flash">${this.ctx.escapeHtml(message)}</p>` : ''}
          <div class="toolbar">
            <input type="month" id="ym" value="${this.ctx.escapeHtml(this.listState.target_year_month)}" />
            <select id="status">
              <option value="">ステータスすべて</option>
              <option value="draft" ${this.listState.status === 'draft' ? 'selected' : ''}>下書き</option>
              <option value="confirmed" ${this.listState.status === 'confirmed' ? 'selected' : ''}>確定</option>
              <option value="approved" ${this.listState.status === 'approved' ? 'selected' : ''}>承認</option>
              <option value="rejected" ${this.listState.status === 'rejected' ? 'selected' : ''}>却下</option>
            </select>
            <input id="q" type="text" placeholder="企業・パートナー・案件No" value="${this.ctx.escapeHtml(this.listState.q)}" />
            <button type="button" class="btn" id="search">検索</button>
            <button type="button" class="btn" id="new">＋ 新規日報</button>
          </div>
          <div class="table-wrap">
            <table class="data-table">
              <thead><tr><th>No</th><th>勤務日</th><th>企業</th><th>パートナー</th><th>案件</th><th>状態</th><th>請求</th><th>支払</th><th>操作</th></tr></thead>
              <tbody>${rows || '<tr><td colspan="9">データがありません</td></tr>'}</tbody>
            </table>
          </div>
        </section>`
      );
      this.kit.bindShell();
      document.getElementById('search')?.addEventListener('click', () => {
        this.listState.target_year_month = document.getElementById('ym').value;
        this.listState.status = document.getElementById('status').value;
        this.listState.q = document.getElementById('q').value.trim();
        this.showList();
      });
      document.getElementById('new')?.addEventListener('click', () => this.showDetail(null));
      document.querySelectorAll('[data-edit]').forEach((btn) =>
        btn.addEventListener('click', () => this.showDetail(Number(btn.getAttribute('data-edit'))))
      );
      document.querySelectorAll('[data-del]').forEach((btn) =>
        btn.addEventListener('click', async () => {
          if (!window.confirm('削除しますか？')) return;
          const result = await this.ctx.api(`/api/daily-reports/${btn.getAttribute('data-del')}`, {
            method: 'DELETE',
          });
          if (!result.res.ok) {
            window.alert(result.data?.message || '削除失敗');
            return;
          }
          await this.showList('削除しました');
        })
      );
    },

    async showDetail(id) {
      this.ctx.renderLoading();
      let report = {
        daily_report_id: null,
        version: 1,
        status: 'draft',
        project_id: '',
        company_id: '',
        partner_id: '',
        vehicle_id: '',
        target_year_month: this.listState.target_year_month,
        work_date: '',
        start_time: '',
        end_time: '',
        break_time: '',
        memo: '',
        calculated_billing_amount: '',
        calculated_payment_amount: '',
        override_billing_amount: '',
        override_payment_amount: '',
        rejection_reason: '',
      };
      if (id) {
        const { res, data } = await this.ctx.api(`/api/daily-reports/${id}`);
        if (!res.ok || !data?.ok) {
          this.ctx.app.innerHTML = this.kit.shell(
            '日報詳細',
            `<section class="panel"><p class="error">${this.ctx.escapeHtml(data?.message || '取得失敗')}</p></section>`
          );
          this.kit.bindShell();
          return;
        }
        report = data.report;
      }
      const locked = report.status === 'approved';
      const confirmedLock = report.status === 'confirmed';

      this.ctx.app.innerHTML = this.kit.shell(
        id ? `日報（No.${id} / ${this.statusLabel(report.status)}）` : '日報新規',
        `<section class="panel">
          <p class="error" id="form-error"></p>
          ${report.rejection_reason ? `<p class="flash">却下理由: ${this.ctx.escapeHtml(report.rejection_reason)}</p>` : ''}
          <form id="report-form">
            <div class="form-grid">
              <div><label>対象年月</label><input type="month" name="target_year_month" value="${this.ctx.escapeHtml(report.target_year_month || '')}" ${locked || confirmedLock ? 'disabled' : ''} /></div>
              <div><label>勤務日（必須）</label><input type="date" name="work_date" required value="${this.ctx.escapeHtml(this.kit.dateValue(report.work_date))}" ${locked || confirmedLock ? 'disabled' : ''} /></div>
              <div><label>案件（必須）</label><select name="project_id" required ${locked || confirmedLock ? 'disabled' : ''}>${this.kit.optionsFromList(this.projects, 'project_id', 'template_name', report.project_id).replace(/template_name/g, 'project_id') /* fallback */}</select></div>
              <div><label>企業（必須）</label><select name="company_id" required ${locked || confirmedLock ? 'disabled' : ''}>${this.kit.optionsFromList(this.companies, 'company_id', 'company_name', report.company_id)}</select></div>
              <div><label>パートナー</label><select name="partner_id" ${locked || confirmedLock ? 'disabled' : ''}>${this.kit.optionsFromList(this.partners, 'partner_id', 'partner_name', report.partner_id)}</select></div>
              <div><label>車両ID</label><input type="number" name="vehicle_id" value="${this.ctx.escapeHtml(report.vehicle_id || '')}" ${locked || confirmedLock ? 'disabled' : ''} /></div>
              <div><label>開始</label><input type="time" name="start_time" value="${this.ctx.escapeHtml(this.kit.timeValue(report.start_time))}" ${locked || confirmedLock ? 'disabled' : ''} /></div>
              <div><label>終了</label><input type="time" name="end_time" value="${this.ctx.escapeHtml(this.kit.timeValue(report.end_time))}" ${locked || confirmedLock ? 'disabled' : ''} /></div>
              <div><label>休憩(h)</label><input type="number" step="0.25" name="break_time" value="${this.ctx.escapeHtml(report.break_time ?? '')}" ${locked || confirmedLock ? 'disabled' : ''} /></div>
              <div class="full"><label>メモ</label><textarea name="memo" rows="2" ${locked ? 'disabled' : ''}>${this.ctx.escapeHtml(report.memo || '')}</textarea></div>
              <div><label>計算・請求</label><input type="number" step="0.01" name="calculated_billing_amount" value="${this.ctx.escapeHtml(report.calculated_billing_amount ?? '')}" ${locked || confirmedLock ? 'disabled' : ''} /></div>
              <div><label>計算・支払</label><input type="number" step="0.01" name="calculated_payment_amount" value="${this.ctx.escapeHtml(report.calculated_payment_amount ?? '')}" ${locked || confirmedLock ? 'disabled' : ''} /></div>
              <div><label>上書・請求</label><input type="number" step="0.01" name="override_billing_amount" value="${this.ctx.escapeHtml(report.override_billing_amount ?? '')}" ${locked ? 'disabled' : ''} /></div>
              <div><label>上書・支払</label><input type="number" step="0.01" name="override_payment_amount" value="${this.ctx.escapeHtml(report.override_payment_amount ?? '')}" ${locked ? 'disabled' : ''} /></div>
            </div>
            <div class="btn-row">
              ${locked ? '' : '<button class="btn" type="submit">保存</button>'}
              <button class="btn btn-ghost" type="button" id="cancel">一覧へ</button>
            </div>
          </form>
          ${
            id
              ? `<div class="btn-row" style="margin-top:1rem">
            ${report.status === 'draft' || report.status === 'rejected' ? '<button type="button" class="btn" id="to-confirmed">確定する</button>' : ''}
            ${report.status === 'confirmed' ? '<button type="button" class="btn" id="to-approved">承認する</button>' : ''}
            ${report.status === 'confirmed' ? '<button type="button" class="btn btn-danger" id="to-rejected">却下する</button>' : ''}
            ${report.status === 'confirmed' ? '<button type="button" class="btn btn-ghost" id="to-draft">下書きに戻す</button>' : ''}
          </div>`
              : ''
          }
        </section>`
      );

      // Fix project options to show readable labels
      const projectSelect = document.querySelector('[name="project_id"]');
      if (projectSelect) {
        projectSelect.innerHTML = [`<option value="">（未選択）</option>`]
          .concat(
            this.projects.map((p) => {
              const label = `${p.company_name || ''} / ${p.partner_name || '-'} / ${p.template_name || p.manager_name || ''}`;
              return `<option value="${p.project_id}" ${
                Number(p.project_id) === Number(report.project_id) ? 'selected' : ''
              }>${this.ctx.escapeHtml(label)} (#${p.project_id})</option>`;
            })
          )
          .join('');
        if (locked || confirmedLock) projectSelect.disabled = true;
      }

      this.kit.bindShell();
      document.getElementById('cancel')?.addEventListener('click', () => this.showList());
      document.getElementById('report-form')?.addEventListener('submit', async (e) => {
        e.preventDefault();
        const form = e.currentTarget;
        const payload = {
          target_year_month: form.target_year_month?.value || report.target_year_month,
          work_date: form.work_date?.value || report.work_date,
          project_id: Number(form.project_id?.value || report.project_id),
          company_id: Number(form.company_id?.value || report.company_id),
          partner_id: form.partner_id?.value ? Number(form.partner_id.value) : report.partner_id,
          vehicle_id: form.vehicle_id?.value ? Number(form.vehicle_id.value) : null,
          start_time: form.start_time?.value || null,
          end_time: form.end_time?.value || null,
          break_time: form.break_time?.value || null,
          memo: form.memo.value,
          calculated_billing_amount: form.calculated_billing_amount?.value || null,
          calculated_payment_amount: form.calculated_payment_amount?.value || null,
          override_billing_amount: form.override_billing_amount.value || null,
          override_payment_amount: form.override_payment_amount.value || null,
          version: report.version || 1,
        };
        const result = id
          ? await this.ctx.api(`/api/daily-reports/${id}`, { method: 'PUT', body: JSON.stringify(payload) })
          : await this.ctx.api('/api/daily-reports', { method: 'POST', body: JSON.stringify(payload) });
        if (!result.res.ok || !result.data?.ok) {
          document.getElementById('form-error').textContent = result.data?.message || '保存失敗';
          return;
        }
        await this.showList(id ? '更新しました' : '登録しました');
      });

      const changeStatus = async (status) => {
        let rejection_reason = null;
        if (status === 'rejected') {
          rejection_reason = window.prompt('却下理由を入力してください');
          if (!rejection_reason) return;
        }
        const result = await this.ctx.api(`/api/daily-reports/${id}/status`, {
          method: 'POST',
          body: JSON.stringify({ status, rejection_reason }),
        });
        if (!result.res.ok) {
          window.alert(result.data?.message || 'ステータス更新失敗');
          return;
        }
        await this.showDetail(id);
      };
      document.getElementById('to-confirmed')?.addEventListener('click', () => changeStatus('confirmed'));
      document.getElementById('to-approved')?.addEventListener('click', () => changeStatus('approved'));
      document.getElementById('to-rejected')?.addEventListener('click', () => changeStatus('rejected'));
      document.getElementById('to-draft')?.addEventListener('click', () => changeStatus('draft'));
    },
  };

  window.LinksDailyReports = LinksDailyReports;
})();
