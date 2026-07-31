(() => {
  const LinksInvoices = {
    async open(ctx) {
      this.kit = window.LinksFeatureKit.createFeatureKit(ctx);
      this.ctx = ctx;
      this.codes = await this.kit.loadCodes();
      this.ym = this.kit.currentYearMonth();
      this.closing = '';
      this.mode = 'targets';
      await this.showTargets();
    },

    async showTargets(message = '') {
      this.ctx.renderLoading();
      const params = new URLSearchParams({
        target_year_month: this.ym,
        closing_date: this.closing,
      });
      const [targetsRes, issuedRes] = await Promise.all([
        this.ctx.api(`/api/invoices/targets?${params}`),
        this.ctx.api(`/api/invoices?target_year_month=${encodeURIComponent(this.ym)}`),
      ]);
      if (!targetsRes.res.ok || !targetsRes.data?.ok) {
        this.ctx.app.innerHTML = this.kit.shell(
          '請求',
          `<section class="panel"><p class="error">${this.ctx.escapeHtml(targetsRes.data?.message || '取得失敗')}</p></section>`
        );
        this.kit.bindShell();
        return;
      }

      const targetRows = (targetsRes.data.targets || [])
        .map(
          (t, idx) => `
          <tr>
            <td>${this.ctx.escapeHtml(t.billing_print_name || t.company_name)}</td>
            <td>${this.ctx.escapeHtml(t.billing_summary_no || '-')}</td>
            <td>${this.ctx.escapeHtml(t.project_count)}</td>
            <td>${this.ctx.escapeHtml(t.report_count)}</td>
            <td>${this.ctx.escapeHtml(t.subtotal_amount)}</td>
            <td>${this.ctx.escapeHtml(t.tax_amount)}</td>
            <td>${this.ctx.escapeHtml(t.total_amount)}</td>
            <td>
              <button type="button" class="btn btn-small" data-close-idx="${idx}">締め確定</button>
            </td>
          </tr>`
        )
        .join('');

      const issuedRows = (issuedRes.data?.invoices || [])
        .map(
          (i) => `
          <tr>
            <td>${this.ctx.escapeHtml(i.invoice_id)}</td>
            <td>${this.ctx.escapeHtml(i.company_name || i.company_id)}</td>
            <td>${this.ctx.escapeHtml(i.billing_print_name || '-')}</td>
            <td>${this.ctx.escapeHtml(i.total_amount)}</td>
            <td>${this.ctx.escapeHtml(i.invoice_status)}</td>
            <td><button type="button" class="btn btn-ghost btn-small" data-print="${i.invoice_id}">印刷(準備中)</button></td>
          </tr>`
        )
        .join('');

      this._targets = targetsRes.data.targets || [];
      this.ctx.app.innerHTML = this.kit.shell(
        '請求（仮組）',
        `<section class="panel">
          ${message ? `<p class="flash">${this.ctx.escapeHtml(message)}</p>` : ''}
          <p class="muted">承認済み・未請求の日報を合算して締めます。PDFは本作成。</p>
          <div class="toolbar">
            <input type="month" id="ym" value="${this.ctx.escapeHtml(this.ym)}" />
            <select id="closing">${this.kit.codeOptions(this.codes.closing_date, this.closing)}</select>
            <button type="button" class="btn" id="search">表示</button>
          </div>
          <h3 class="section-title">締め対象（仮集計）</h3>
          <div class="table-wrap">
            <table class="data-table">
              <thead><tr><th>請求先</th><th>取り纏めNo</th><th>案件数</th><th>日報数</th><th>税抜</th><th>税</th><th>税込</th><th>操作</th></tr></thead>
              <tbody>${targetRows || '<tr><td colspan="8">対象なし</td></tr>'}</tbody>
            </table>
          </div>
          <h3 class="section-title">発行済み</h3>
          <div class="table-wrap">
            <table class="data-table">
              <thead><tr><th>No</th><th>企業</th><th>請求先</th><th>税込</th><th>状態</th><th></th></tr></thead>
              <tbody>${issuedRows || '<tr><td colspan="6">なし</td></tr>'}</tbody>
            </table>
          </div>
        </section>`
      );
      this.kit.bindShell();
      document.getElementById('search')?.addEventListener('click', () => {
        this.ym = document.getElementById('ym').value;
        this.closing = document.getElementById('closing').value;
        this.showTargets();
      });
      document.querySelectorAll('[data-close-idx]').forEach((btn) => {
        btn.addEventListener('click', async () => {
          const t = this._targets[Number(btn.getAttribute('data-close-idx'))];
          if (!t) return;
          const adj = window.prompt('調整額（なければ0）', '0');
          if (adj == null) return;
          const result = await this.ctx.api('/api/invoices/close', {
            method: 'POST',
            body: JSON.stringify({
              target_year_month: this.ym,
              company_id: t.company_id,
              report_ids: t.report_ids,
              billing_id: t.billing_id,
              billing_summary_no: t.billing_summary_no,
              billing_print_name: t.billing_print_name,
              closing_date: t.closing_date || this.closing || 'end',
              adjustment_amount: Number(adj) || 0,
            }),
          });
          if (!result.res.ok || !result.data?.ok) {
            window.alert(result.data?.message || '締め失敗');
            return;
          }
          await this.showTargets('締めを確定しました');
        });
      });
      document.querySelectorAll('[data-print]').forEach((btn) =>
        btn.addEventListener('click', () => this.ctx.showToast('請求書PDFは準備中です'))
      );
    },
  };

  window.LinksInvoices = LinksInvoices;
})();
