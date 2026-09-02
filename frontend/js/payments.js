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

    statusText(p) {
      const parts = [];
      if (p.is_confirmed) parts.push('確定');
      else parts.push(p.payment_status || '下書き');
      if (p.approval_status === 'approved') parts.push('承認済');
      if (p.is_printed) parts.push('印刷済');
      return parts.join(' / ');
    },

    async showTargets(message = '') {
      this.ctx.renderLoading();
      const params = new URLSearchParams({
        target_year_month: this.ym,
        closing_date: this.closing,
      });
      const [targetsRes, issuedRes, cyclesRes] = await Promise.all([
        this.ctx.api(`/api/payments/targets?${params}`),
        this.ctx.api(`/api/payments?target_year_month=${encodeURIComponent(this.ym)}`),
        this.ctx.api(`/api/cash-management/cycles?target_year_month=${encodeURIComponent(this.ym)}`),
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
              <button type="button" class="btn btn-small" data-close-idx="${idx}">作成</button>
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
            <td>${this.ctx.escapeHtml(this.statusText(p))}</td>
            <td>
              <button type="button" class="btn btn-ghost btn-small" data-open="${p.payment_id}">詳細</button>
              <button type="button" class="btn btn-ghost btn-small" data-approve="${p.payment_id}">承認</button>
              <button type="button" class="btn btn-ghost btn-small" data-unconfirm="${p.payment_id}">確定解除</button>
              <button type="button" class="btn btn-ghost btn-small" data-print="${p.payment_id}">印刷</button>
            </td>
          </tr>`
        )
        .join('');

      this._targets = targetsRes.data.targets || [];
      this.ctx.app.innerHTML = this.kit.shell(
        '支払（仮組）',
        `<section class="panel">
          ${message ? `<p class="flash">${this.ctx.escapeHtml(message)}</p>` : ''}
          <div class="toolbar">
            <input type="month" id="ym" value="${this.ctx.escapeHtml(this.ym)}" />
            <select id="closing">${this.kit.codeOptions(this.codes.closing_date, this.closing)}</select>
            <select id="cash-cycle"><option value="">入出金予定を作らない</option>${(cyclesRes.data?.cycles || []).map((c) => `<option value="${c.cash_cycle_id}">${c.cycle_code === 'end' ? '末日' : Number(c.cycle_code)}日回へ予定作成</option>`).join('')}</select>
            <button type="button" class="btn" id="search">表示</button>
          </div>
          <h3 class="section-title">締め対象（仮集計）</h3>
          <div class="table-wrap">
            <table class="data-table data-table-compact">
              <thead><tr><th>パートナー</th><th>区分</th><th>帳票</th><th>総額</th><th>先払控除</th><th>実振込</th><th>操作</th></tr></thead>
              <tbody>${targetRows || '<tr><td colspan="7">対象なし</td></tr>'}</tbody>
            </table>
          </div>
          <h3 class="section-title">発行済み</h3>
          <div class="table-wrap">
            <table class="data-table data-table-compact">
              <thead><tr><th>No</th><th>パートナー</th><th>実振込</th><th>状態</th><th>操作</th></tr></thead>
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
              cash_cycle_id: Number(document.getElementById('cash-cycle').value) || null,
            }),
          });
          if (!result.res.ok || !result.data?.ok) {
            window.alert(result.data?.message || '締め失敗');
            return;
          }
          this.kit.pushNav(() => this.showTargets());
          await this.showDetail(result.data.payment?.payment_id || result.data.payment_id);
        });
      });
      document.querySelectorAll('[data-open]').forEach((btn) =>
        btn.addEventListener('click', () => {
          this.kit.pushNav(() => this.showTargets());
          this.showDetail(Number(btn.getAttribute('data-open')));
        })
      );
      const postAction = async (path, msg) => {
        const result = await this.ctx.api(path, { method: 'POST', body: '{}' });
        if (!result.res.ok) {
          window.alert(result.data?.message || '失敗');
          return;
        }
        await this.showTargets(msg);
      };
      document.querySelectorAll('[data-approve]').forEach((btn) =>
        btn.addEventListener('click', () =>
          postAction(`/api/payments/${btn.getAttribute('data-approve')}/approve`, '承認しました')
        )
      );
      document.querySelectorAll('[data-unconfirm]').forEach((btn) =>
        btn.addEventListener('click', () =>
          postAction(`/api/payments/${btn.getAttribute('data-unconfirm')}/unconfirm`, '確定を解除しました')
        )
      );
      document.querySelectorAll('[data-print]').forEach((btn) =>
        btn.addEventListener('click', () =>
          postAction(`/api/payments/${btn.getAttribute('data-print')}/print`, '印刷済みにしました')
        )
      );
    },

    async showDetail(id) {
      if (!id) {
        await this.showTargets();
        return;
      }
      this.ctx.renderLoading();
      const { res, data } = await this.ctx.api(`/api/payments/${id}`);
      if (!res.ok || !data?.ok) {
        this.ctx.app.innerHTML = this.kit.shell(
          '支払詳細',
          `<section class="panel"><p class="error">${this.ctx.escapeHtml(data?.message || '取得失敗')}</p></section>`,
          { onBack: () => this.showTargets() }
        );
        this.kit.bindShell({ onBack: () => this.showTargets() });
        return;
      }
      const p = data.payment;
      this.ctx.app.innerHTML = this.kit.shell(
        `支払詳細（No.${id}）`,
        `<section class="panel">
          <div class="preview-sheet">
            <h3>支払明細書プレビュー</h3>
            <p>${this.ctx.escapeHtml(p.partner_name || p.partner_id)} 様</p>
            <p>対象月: ${this.ctx.escapeHtml(p.target_year_month)}</p>
            <p>状態: ${this.ctx.escapeHtml(this.statusText(p))}</p>
            <p>総額 ${this.ctx.escapeHtml(p.gross_amount)} − 先払 ${this.ctx.escapeHtml(p.advance_deduction_amount)} = <strong>${this.ctx.escapeHtml(p.final_transfer_amount)}</strong></p>
          </div>
          <div class="btn-row">
            <button type="button" class="btn btn-ghost" id="approve">承認</button>
            <button type="button" class="btn btn-ghost" id="unconfirm">確定解除</button>
            <button type="button" class="btn btn-ghost" id="print">印刷</button>
            <button type="button" class="btn btn-ghost" id="back">一覧へ</button>
          </div>
        </section>`,
        { onBack: () => this.showTargets() }
      );
      this.kit.bindShell({ onBack: () => this.showTargets() });
      document.getElementById('back')?.addEventListener('click', () => this.showTargets());
      const act = async (action) => {
        const result = await this.ctx.api(`/api/payments/${id}/${action}`, { method: 'POST', body: '{}' });
        if (!result.res.ok) {
          window.alert(result.data?.message || '失敗');
          return;
        }
        await this.showDetail(id);
      };
      document.getElementById('approve')?.addEventListener('click', () => act('approve'));
      document.getElementById('unconfirm')?.addEventListener('click', () => act('unconfirm'));
      document.getElementById('print')?.addEventListener('click', () => act('print'));
    },
  };

  window.LinksPayments = LinksPayments;
})();
