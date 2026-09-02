(() => {
  const LinksInvoices = {
    async open(ctx) {
      this.kit = window.LinksFeatureKit.createFeatureKit(ctx);
      this.ctx = ctx;
      this.codes = await this.kit.loadCodes();
      this.ym = this.kit.currentYearMonth();
      this.closing = '';
      await this.showTargets();
    },

    statusText(inv) {
      const parts = [];
      if (inv.is_confirmed) parts.push('確定');
      else parts.push(inv.invoice_status || '下書き');
      if (inv.approval_status === 'approved') parts.push('承認済');
      if (inv.is_printed) parts.push('印刷済');
      return parts.join(' / ');
    },

    async showTargets(message = '') {
      this.ctx.renderLoading();
      const params = new URLSearchParams({
        target_year_month: this.ym,
        closing_date: this.closing,
      });
      const [targetsRes, issuedRes, cyclesRes] = await Promise.all([
        this.ctx.api(`/api/invoices/targets?${params}`),
        this.ctx.api(`/api/invoices?target_year_month=${encodeURIComponent(this.ym)}`),
        this.ctx.api(`/api/cash-management/cycles?target_year_month=${encodeURIComponent(this.ym)}`),
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
              <button type="button" class="btn btn-small" data-close-idx="${idx}">作成</button>
              <button type="button" class="btn btn-ghost btn-small" data-exclude-idx="${idx}">除外</button>
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
            <td>${this.ctx.escapeHtml(this.statusText(i))}</td>
            <td>
              <button type="button" class="btn btn-ghost btn-small" data-open="${i.invoice_id}">詳細</button>
              <button type="button" class="btn btn-ghost btn-small" data-approve="${i.invoice_id}">承認</button>
              <button type="button" class="btn btn-ghost btn-small" data-confirm="${i.invoice_id}">確定</button>
              <button type="button" class="btn btn-ghost btn-small" data-unconfirm="${i.invoice_id}">確定解除</button>
              <button type="button" class="btn btn-ghost btn-small" data-print="${i.invoice_id}">印刷</button>
            </td>
          </tr>`
        )
        .join('');

      this._targets = targetsRes.data.targets || [];
      this.ctx.app.innerHTML = this.kit.shell(
        '請求（仮組）',
        `<section class="panel">
          ${message ? `<p class="flash">${this.ctx.escapeHtml(message)}</p>` : ''}
          <div class="toolbar">
            <input type="month" id="ym" value="${this.ctx.escapeHtml(this.ym)}" />
            <select id="closing">${this.kit.codeOptions(this.codes.closing_date, this.closing)}</select>
            <select id="cash-cycle"><option value="">入出金予定を作らない</option>${(cyclesRes.data?.cycles || []).map((c) => `<option value="${c.cash_cycle_id}">${c.cycle_code === 'end' ? '末日' : Number(c.cycle_code)}日回へ予定作成</option>`).join('')}</select>
            <button type="button" class="btn" id="search">表示</button>
          </div>
          <h3 class="section-title">月次TODO（締め対象）</h3>
          <div class="table-wrap">
            <table class="data-table data-table-compact">
              <thead><tr><th>請求先</th><th>取り纏めNo</th><th>案件数</th><th>日報数</th><th>税抜</th><th>税</th><th>税込</th><th>操作</th></tr></thead>
              <tbody>${targetRows || '<tr><td colspan="8">対象なし</td></tr>'}</tbody>
            </table>
          </div>
          <h3 class="section-title">発行済み</h3>
          <div class="table-wrap">
            <table class="data-table data-table-compact">
              <thead><tr><th>No</th><th>企業</th><th>請求先</th><th>税込</th><th>状態</th><th>操作</th></tr></thead>
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
              cash_cycle_id: Number(document.getElementById('cash-cycle').value) || null,
            }),
          });
          if (!result.res.ok || !result.data?.ok) {
            window.alert(result.data?.message || '作成失敗');
            return;
          }
          this.kit.pushNav(() => this.showTargets());
          await this.showDetail(result.data.invoice.invoice_id);
        });
      });
      document.querySelectorAll('[data-exclude-idx]').forEach((btn) => {
        btn.addEventListener('click', async () => {
          const t = this._targets[Number(btn.getAttribute('data-exclude-idx'))];
          if (!t) return;
          const reason = window.prompt('除外理由（任意）', '') ?? '';
          const result = await this.ctx.api('/api/invoices/exclude', {
            method: 'POST',
            body: JSON.stringify({
              company_id: t.company_id,
              target_year_month: this.ym,
              reason,
            }),
          });
          if (!result.res.ok) {
            window.alert(result.data?.message || '除外失敗');
            return;
          }
          await this.showTargets('リストから除外しました');
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
        btn.addEventListener('click', () => postAction(`/api/invoices/${btn.getAttribute('data-approve')}/approve`, '承認しました'))
      );
      document.querySelectorAll('[data-confirm]').forEach((btn) =>
        btn.addEventListener('click', () => postAction(`/api/invoices/${btn.getAttribute('data-confirm')}/confirm`, '確定しました'))
      );
      document.querySelectorAll('[data-unconfirm]').forEach((btn) =>
        btn.addEventListener('click', () =>
          postAction(`/api/invoices/${btn.getAttribute('data-unconfirm')}/unconfirm`, '確定を解除しました')
        )
      );
      document.querySelectorAll('[data-print]').forEach((btn) =>
        btn.addEventListener('click', () => postAction(`/api/invoices/${btn.getAttribute('data-print')}/print`, '印刷済みにしました'))
      );
    },

    async showDetail(id) {
      this.ctx.renderLoading();
      const { res, data } = await this.ctx.api(`/api/invoices/${id}`);
      if (!res.ok || !data?.ok) {
        this.ctx.app.innerHTML = this.kit.shell(
          '請求詳細',
          `<section class="panel"><p class="error">${this.ctx.escapeHtml(data?.message || '取得失敗')}</p></section>`,
          { onBack: () => this.showTargets() }
        );
        this.kit.bindShell({ onBack: () => this.showTargets() });
        return;
      }
      const inv = data.invoice;
      const locked = Number(inv.is_confirmed) === 1;
      const detailRows = (inv.details || [])
        .map(
          (d, idx) => `
          <tr data-detail-idx="${idx}">
            <td><input data-f="price_name" value="${this.ctx.escapeHtml(d.price_name || '')}" ${locked ? 'disabled' : ''} /></td>
            <td><input type="number" step="0.01" data-f="unit_price" value="${this.ctx.escapeHtml(d.unit_price ?? 0)}" ${locked ? 'disabled' : ''} /></td>
            <td><input type="number" step="0.01" data-f="quantity" value="${this.ctx.escapeHtml(d.quantity ?? 1)}" ${locked ? 'disabled' : ''} /></td>
            <td><input type="number" step="0.01" data-f="amount" value="${this.ctx.escapeHtml(d.amount ?? 0)}" ${locked ? 'disabled' : ''} /></td>
          </tr>`
        )
        .join('');

      this.ctx.app.innerHTML = this.kit.shell(
        `請求詳細（No.${id}）`,
        `<section class="panel">
          <p class="error" id="form-error"></p>
          <div class="preview-sheet">
            <h3>請求書プレビュー</h3>
            <p>${this.ctx.escapeHtml(inv.company_name || '')} 御中</p>
            <p>請求先: ${this.ctx.escapeHtml(inv.billing_print_name || '-')}</p>
            <p>対象月: ${this.ctx.escapeHtml(inv.target_year_month)} / 状態: ${this.ctx.escapeHtml(this.statusText(inv))}</p>
            <p>税抜 ${this.ctx.escapeHtml(inv.subtotal_amount)} + 調整 ${this.ctx.escapeHtml(inv.adjustment_amount)} + 税 ${this.ctx.escapeHtml(inv.tax_amount)} = <strong>${this.ctx.escapeHtml(inv.total_amount)}</strong></p>
          </div>
          <div class="form-grid">
            <div><label>調整額</label><input type="number" step="0.01" id="adj" value="${this.ctx.escapeHtml(inv.adjustment_amount ?? 0)}" ${locked ? 'disabled' : ''} /></div>
            <div><label>発行区分</label>
              <select id="issue_type" ${locked ? 'disabled' : ''}>
                <option value="draft" ${inv.issue_type === 'draft' ? 'selected' : ''}>仮</option>
                <option value="final" ${inv.issue_type !== 'draft' ? 'selected' : ''}>本</option>
              </select>
            </div>
          </div>
          <h3 class="section-title">明細</h3>
          <div class="table-wrap">
            <table class="data-table data-table-compact" id="inv-details">
              <thead><tr><th>名称</th><th>単価</th><th>数量</th><th>金額</th></tr></thead>
              <tbody>${detailRows || '<tr><td colspan="4">明細なし</td></tr>'}</tbody>
            </table>
          </div>
          <div class="btn-row">
            ${locked ? '' : '<button type="button" class="btn" id="save-inv">明細保存</button>'}
            <button type="button" class="btn btn-ghost" id="approve">承認</button>
            <button type="button" class="btn btn-ghost" id="confirm">確定</button>
            <button type="button" class="btn btn-ghost" id="unconfirm">確定解除</button>
            <button type="button" class="btn btn-ghost" id="print">印刷</button>
            <button type="button" class="btn btn-ghost" id="back">一覧へ</button>
          </div>
        </section>`,
        { onBack: () => this.showTargets() }
      );
      this.kit.bindShell({ onBack: () => this.showTargets() });
      document.getElementById('back')?.addEventListener('click', () => this.showTargets());
      document.getElementById('save-inv')?.addEventListener('click', async () => {
        const details = [];
        document.querySelectorAll('#inv-details tbody tr[data-detail-idx]').forEach((tr) => {
          details.push({
            price_name: tr.querySelector('[data-f="price_name"]').value,
            unit_price: Number(tr.querySelector('[data-f="unit_price"]').value || 0),
            quantity: Number(tr.querySelector('[data-f="quantity"]').value || 1),
            amount: Number(tr.querySelector('[data-f="amount"]').value || 0),
          });
        });
        const result = await this.ctx.api(`/api/invoices/${id}`, {
          method: 'PUT',
          body: JSON.stringify({
            adjustment_amount: Number(document.getElementById('adj').value || 0),
            issue_type: document.getElementById('issue_type').value,
            details,
          }),
        });
        if (!result.res.ok || !result.data?.ok) {
          document.getElementById('form-error').textContent = result.data?.message || '保存失敗';
          return;
        }
        await this.showDetail(id);
      });
      const act = async (action) => {
        const result = await this.ctx.api(`/api/invoices/${id}/${action}`, { method: 'POST', body: '{}' });
        if (!result.res.ok) {
          window.alert(result.data?.message || '失敗');
          return;
        }
        await this.showDetail(id);
      };
      document.getElementById('approve')?.addEventListener('click', () => act('approve'));
      document.getElementById('confirm')?.addEventListener('click', () => act('confirm'));
      document.getElementById('unconfirm')?.addEventListener('click', () => act('unconfirm'));
      document.getElementById('print')?.addEventListener('click', () => act('print'));
    },
  };

  window.LinksInvoices = LinksInvoices;
})();
