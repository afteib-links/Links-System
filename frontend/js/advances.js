(() => {
  const LinksAdvances = {
    async open(ctx) {
      this.kit = window.LinksFeatureKit.createFeatureKit(ctx);
      this.ctx = ctx;
      this.ym = this.kit.currentYearMonth();
      this.q = '';
      await this.showList();
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
            .map(
              (c) => `
              <td>
                <label class="check-item"><input type="checkbox" data-p="${row.project_id}" data-c="${c.cycle_number}" data-field="is_target" ${c.is_target ? 'checked' : ''} /><span>対象</span></label>
                <input type="number" step="0.01" style="width:6rem" data-p="${row.project_id}" data-c="${c.cycle_number}" data-field="unit_price" value="${this.ctx.escapeHtml(c.unit_price)}" />
                ${c.is_price_overridden ? '<span class="muted">（変）</span>' : ''}
                <div class="muted">日数:${c.work_days} / 合計:${c.total_amount}</div>
                <input type="number" step="0.01" style="width:6rem" placeholder="手数料" data-p="${row.project_id}" data-c="${c.cycle_number}" data-field="applied_transfer_fee" value="${this.ctx.escapeHtml(c.applied_transfer_fee)}" />
              </td>`
            )
            .join('');
          return `
            <tr>
              <td>${this.ctx.escapeHtml(row.project_id)}<br/><span class="muted">${this.ctx.escapeHtml(row.template_name || '')}</span></td>
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
          <p class="muted">分割案件のみ表示。サイクル境界は仮組固定（1-10 / 11-20 / 21-末）。PDFなし。</p>
          <div class="toolbar">
            <input type="month" id="ym" value="${this.ctx.escapeHtml(this.ym)}" />
            <input id="q" type="text" placeholder="企業・パートナー・案件" value="${this.ctx.escapeHtml(this.q)}" />
            <button type="button" class="btn" id="search">表示</button>
            <button type="button" class="btn" id="save">保存</button>
          </div>
          <div class="table-wrap">
            <table class="data-table">
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
    },

    async save() {
      const map = new Map();
      document.querySelectorAll('[data-p][data-c][data-field]').forEach((el) => {
        const key = `${el.getAttribute('data-p')}:${el.getAttribute('data-c')}`;
        if (!map.has(key)) {
          map.set(key, {
            project_id: Number(el.getAttribute('data-p')),
            cycle_number: Number(el.getAttribute('data-c')),
          });
        }
        const item = map.get(key);
        const field = el.getAttribute('data-field');
        if (field === 'is_target') item.is_target = el.checked;
        else item[field] = el.value;
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
