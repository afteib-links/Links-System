(() => {
  const LinksAdvances = {
    async open(ctx) {
      this.kit = window.LinksFeatureKit.createFeatureKit(ctx);
      this.ctx = ctx;
      this.ym = this.kit.currentYearMonth();
      this.q = '';
      await this.showList();
    },

    calcTotal(isTarget, unitPrice, days) {
      if (!isTarget) return 0;
      return Math.round(Number(unitPrice || 0) * Number(days || 0) * 100) / 100;
    },

    async showList(message = '') {
      this.ctx.renderLoading();
      const params = new URLSearchParams({ target_year_month: this.ym, q: this.q });
      const { res, data } = await this.ctx.api(`/api/advances?${params}`);
      if (!res.ok || !data?.ok) {
        this.ctx.app.innerHTML = this.kit.shell(
          '先払い',
          `<section class="panel"><p class="error">${this.ctx.escapeHtml(data?.message || '取得失敗')}</p></section>`
        );
        this.kit.bindShell();
        return;
      }

      const bodyRows = (data.rows || [])
        .map((row) => {
          const cycles = row.cycles
            .map((c) => {
              const days =
                c.work_days_input != null && c.work_days_input !== ''
                  ? Number(c.work_days_input)
                  : Number(c.work_days || 0);
              const total = this.calcTotal(c.is_target, c.unit_price, days);
              return `
              <td class="adv-cycle" data-p="${row.project_id}" data-c="${c.cycle_number}">
                <div class="adv-title">
                  <input type="text" placeholder="タイトル" data-field="title" value="${this.ctx.escapeHtml(c.title || `${row.template_name || ''} 第${c.cycle_number}回`)}" />
                </div>
                <label class="check-item"><input type="checkbox" data-field="is_target" ${c.is_target ? 'checked' : ''} /><span>対象</span></label>
                <div class="adv-row">
                  <label>単価</label>
                  <input type="number" step="0.01" data-field="unit_price" value="${this.ctx.escapeHtml(c.unit_price)}" />
                  ${c.is_price_overridden ? '<span class="muted">（変）</span>' : ''}
                </div>
                <div class="adv-row">
                  <label>日数</label>
                  <button type="button" class="btn btn-ghost btn-small" data-spin="-1">−</button>
                  <input type="number" step="0.1" data-field="work_days_input" value="${this.ctx.escapeHtml(days)}" />
                  <button type="button" class="btn btn-ghost btn-small" data-spin="1">＋</button>
                  <span class="muted">自動:${this.ctx.escapeHtml(c.work_days)}</span>
                </div>
                <div class="adv-row">
                  <label>手数料</label>
                  <input type="number" step="0.01" data-field="applied_transfer_fee" value="${this.ctx.escapeHtml(c.applied_transfer_fee)}" />
                </div>
                <div class="adv-total">合計: <strong data-total>${this.ctx.escapeHtml(total)}</strong></div>
              </td>`;
            })
            .join('');
          return `
            <tr>
              <td>
                <div><strong>#${this.ctx.escapeHtml(row.project_id)}</strong></div>
                <div class="muted">${this.ctx.escapeHtml(row.template_name || '')}</div>
              </td>
              <td>${this.ctx.escapeHtml(row.company_name || '-')}</td>
              <td>${this.ctx.escapeHtml(row.partner_name || '-')}</td>
              ${cycles}
            </tr>`;
        })
        .join('');

      this.ctx.app.innerHTML = this.kit.shell(
        '先払い（仮組）',
        `<section class="panel">
          ${message ? `<p class="flash">${this.ctx.escapeHtml(message)}</p>` : ''}
          <p class="muted">分割案件のみ。日数は小数第1位まで手入力可。スピンは1刻み。</p>
          <div class="toolbar">
            <input type="month" id="ym" value="${this.ctx.escapeHtml(this.ym)}" />
            <input id="q" type="text" placeholder="企業・パートナー・案件" value="${this.ctx.escapeHtml(this.q)}" />
            <button type="button" class="btn" id="search">表示</button>
            <button type="button" class="btn" id="save">保存</button>
          </div>
          <div class="table-wrap">
            <table class="data-table data-table-compact">
              <thead>
                <tr>
                  <th>案件</th><th>企業</th><th>パートナー</th>
                  <th>第1サイクル</th><th>第2サイクル</th><th>第3サイクル</th>
                </tr>
              </thead>
              <tbody>${bodyRows || '<tr><td colspan="6">分割案件がありません</td></tr>'}</tbody>
            </table>
          </div>
        </section>`
      );
      this.kit.bindShell();
      document.getElementById('search')?.addEventListener('click', () => {
        this.ym = document.getElementById('ym').value;
        this.q = document.getElementById('q').value.trim();
        this.showList();
      });
      document.getElementById('save')?.addEventListener('click', () => this.save());
      this.bindLiveCalc();
    },

    recalcCell(cell) {
      const isTarget = cell.querySelector('[data-field="is_target"]')?.checked;
      const unit = cell.querySelector('[data-field="unit_price"]')?.value;
      const days = cell.querySelector('[data-field="work_days_input"]')?.value;
      const totalEl = cell.querySelector('[data-total]');
      if (totalEl) totalEl.textContent = String(this.calcTotal(isTarget, unit, days));
    },

    bindLiveCalc() {
      document.querySelectorAll('.adv-cycle').forEach((cell) => {
        cell.querySelectorAll('[data-field]').forEach((el) => {
          el.addEventListener('input', () => this.recalcCell(cell));
          el.addEventListener('change', () => this.recalcCell(cell));
        });
        cell.querySelectorAll('[data-spin]').forEach((btn) => {
          btn.addEventListener('click', () => {
            const input = cell.querySelector('[data-field="work_days_input"]');
            if (!input) return;
            const delta = Number(btn.getAttribute('data-spin'));
            const next = Math.round((Number(input.value || 0) + delta) * 10) / 10;
            input.value = String(Math.max(0, next));
            this.recalcCell(cell);
          });
        });
      });
    },

    async save() {
      const map = new Map();
      document.querySelectorAll('.adv-cycle').forEach((cell) => {
        const key = `${cell.getAttribute('data-p')}:${cell.getAttribute('data-c')}`;
        const item = {
          project_id: Number(cell.getAttribute('data-p')),
          cycle_number: Number(cell.getAttribute('data-c')),
        };
        cell.querySelectorAll('[data-field]').forEach((el) => {
          const field = el.getAttribute('data-field');
          if (field === 'is_target') item.is_target = el.checked;
          else item[field] = el.value;
        });
        map.set(key, item);
      });
      const result = await this.ctx.api('/api/advances/upsert', {
        method: 'PUT',
        body: JSON.stringify({
          target_year_month: this.ym,
          items: [...map.values()],
        }),
      });
      if (!result.res.ok || !result.data?.ok) {
        window.alert(result.data?.message || '保存失敗');
        return;
      }
      await this.showList('保存しました');
    },
  };

  window.LinksAdvances = LinksAdvances;
})();
