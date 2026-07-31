(() => {
  const LinksPayments = {
    async open(ctx) {
      this.kit = window.LinksFeatureKit.createFeatureKit(ctx);
      this.ctx = ctx;
      this.codes = await this.kit.loadCodes();
      this.ym = this.kit.currentYearMonth();
      this.closing = '';
      await this.showTargets();
    },

    async showTargets(message = '') {
      this.ctx.renderLoading();
      const params = new URLSearchParams({
        target_year_month: this.ym,
        closing_date: this.closing,
      });
      const [targetsRes, issuedRes] = await Promise.all([
        this.ctx.api(`/api/payments/targets?${params}`),
        this.ctx.api(`/api/payments?target_year_month=${encodeURIComponent(this.ym)}`),
      ]);
      if (!targetsRes.res.ok || !targetsRes.data?.ok) {
        this.ctx.app.innerHTML = this.kit.shell(
          '支払',
          `<section class="panel"><p class="error">${this.ctx.escapeHtml(targetsRes.data?.message || '取得失敗')}</p></section>`
        );
        this.kit.bindShell();
        return;
      }

      const targetRows = (targetsRes.data.targets || [])
        .map(
          (t, idx) => `
          <tr>
            <td>${this.ctx.escapeHtml(t.partner_name)}</td>
            <td>${this.ctx.escapeHtml(this.kit.codeLabel(this.codes.partner_category, t.partner_category_code))}</td>
            <td>${this.ctx.escapeHtml(this.kit.codeLabel(this.codes.payment_output, t.payment_output_code))}</td>
            <td>${this.ctx.escapeHtml(t.gross_amount)}</td>
            <td>${this.ctx.escapeHtml(t.advance_deduction_amount)}</td>
            <td>${this.ctx.escapeHtml(t.final_transfer_amount)}</td>
            <td>
              <button type="button" class="btn btn-small" data-close-idx="${idx}">締め確定</button>
            </td>
          </tr>`
        )
        .join('');

      const issuedRows = (issuedRes.data?.payments || [])
        .map(
          (p) => `
          <tr>
            <td>${this.ctx.escapeHtml(p.payment_id)}</td>
            <td>${this.ctx.escapeHtml(p.partner_name || p.partner_id)}</td>
            <td>${this.ctx.escapeHtml(p.final_transfer_amount)}</td>
            <td>${this.ctx.escapeHtml(p.payment_status)}</td>
            <td><button type="button" class="btn btn-ghost btn-small" data-print="${p.payment_id}">印刷(準備中)</button></td>
          </tr>`
        )
        .join('');

      this._targets = targetsRes.data.targets || [];
      this.ctx.app.innerHTML = this.kit.shell(
        '支払（仮組）',
        `<section class="panel">
          ${message ? `<p class="flash">${this.ctx.escapeHtml(message)}</p>` : ''}
          <p class="muted">承認済み日報＋先払い控除＋定額（事務1100・安全8800）。帳票PDFは本作成。</p>
          <div class="toolbar">
            <input type="month" id="ym" value="${this.ctx.escapeHtml(this.ym)}" />
            <select id="closing">${this.kit.codeOptions(this.codes.closing_date, this.closing)}</select>
            <button type="button" class="btn" id="search">表示</button>
          </div>
          <h3 class="section-title">締め対象（仮集計）</h3>
          <div class="table-wrap">
            <table class="data-table">
              <thead><tr><th>パートナー</th><th>区分</th><th>帳票</th><th>総額</th><th>先払控除</th><th>実振込</th><th>操作</th></tr></thead>
              <tbody>${targetRows || '<tr><td colspan="7">対象なし</td></tr>'}</tbody>
            </table>
          </div>
          <h3 class="section-title">発行済み</h3>
          <div class="table-wrap">
            <table class="data-table">
              <thead><tr><th>No</th><th>パートナー</th><th>実振込</th><th>状態</th><th></th></tr></thead>
              <tbody>${issuedRows || '<tr><td colspan="5">なし</td></tr>'}</tbody>
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
          const adj = window.prompt('その他調整額（なければ0）', '0');
          if (adj == null) return;
          const result = await this.ctx.api('/api/payments/close', {
            method: 'POST',
            body: JSON.stringify({
              target_year_month: this.ym,
              partner_id: t.partner_id,
              report_ids: t.report_ids,
              closing_date: t.closing_date || this.closing || 'end',
              payment_output_code: t.payment_output_code,
              other_adjustment_amount: Number(adj) || 0,
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
        btn.addEventListener('click', () => this.ctx.showToast('支払明細書PDFは準備中です'))
      );
    },
  };

  window.LinksPayments = LinksPayments;
})();
