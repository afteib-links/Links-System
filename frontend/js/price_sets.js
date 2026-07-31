(() => {
  const LinksPriceSets = {
    async open(ctx) {
      this.kit = window.LinksFeatureKit.createFeatureKit(ctx);
      this.ctx = ctx;
      this.codes = await this.kit.loadCodes();
      const companies = await this.ctx.api('/api/lookups/companies');
      this.companies = companies.data?.companies || [];
      this.q = '';
      await this.showList();
    },

    weekdayLabel(code) {
      return (
        {
          all: '全日',
          mon: '月',
          tue: '火',
          wed: '水',
          thu: '木',
          fri: '金',
          sat: '土',
          sun: '日',
        }[code] || code || '-'
      );
    },

    async showList(message = '') {
      this.ctx.renderLoading();
      const params = new URLSearchParams({ q: this.q || '' });
      const { res, data } = await this.ctx.api(`/api/price-sets?${params}`);
      if (!res.ok || !data?.ok) {
        this.ctx.app.innerHTML = this.kit.shell(
          '金額データ管理',
          `<section class="panel"><p class="error">${this.ctx.escapeHtml(data?.message || '取得失敗')}</p></section>`
        );
        this.kit.bindShell();
        return;
      }
      const rows = (data.price_sets || [])
        .map(
          (ps) => `
          <tr>
            <td>${this.ctx.escapeHtml(ps.price_set_id)}</td>
            <td>${this.ctx.escapeHtml(ps.price_set_name)}</td>
            <td>${this.ctx.escapeHtml(ps.company_name || '-')}</td>
            <td>${this.ctx.escapeHtml(this.kit.dateValue(ps.apply_start_date) || '-')}</td>
            <td>${this.ctx.escapeHtml(this.kit.dateValue(ps.apply_end_date) || '〜')}</td>
            <td>${this.ctx.escapeHtml(ps.line_count ?? 0)}</td>
            <td>
              <button type="button" class="btn btn-ghost btn-small" data-edit="${ps.price_set_id}">編集</button>
              <button type="button" class="btn btn-ghost btn-small" data-copy="${ps.price_set_id}">コピー</button>
              <button type="button" class="btn btn-danger btn-small" data-del="${ps.price_set_id}">削除</button>
            </td>
          </tr>`
        )
        .join('');
      this.ctx.app.innerHTML = this.kit.shell(
        '金額データ管理（仮組）',
        `<section class="panel">
          ${message ? `<p class="flash">${this.ctx.escapeHtml(message)}</p>` : ''}
          <div class="toolbar">
            <input id="q" type="text" placeholder="名称・企業で検索" value="${this.ctx.escapeHtml(this.q)}" />
            <button type="button" class="btn" id="search">検索</button>
            <button type="button" class="btn" id="new">＋ 新規</button>
          </div>
          <div class="table-wrap table-wrap-sticky">
            <table class="data-table data-table-compact">
              <thead><tr><th>No</th><th>名称</th><th>企業</th><th>適用開始</th><th>適用終了</th><th>行数</th><th>操作</th></tr></thead>
              <tbody>${rows || '<tr><td colspan="7">データがありません</td></tr>'}</tbody>
            </table>
          </div>
        </section>`
      );
      this.kit.bindShell();
      document.getElementById('search')?.addEventListener('click', () => {
        this.q = document.getElementById('q').value.trim();
        this.showList();
      });
      document.getElementById('new')?.addEventListener('click', () => {
        this.kit.pushNav(() => this.showList());
        this.showDetail(null);
      });
      document.querySelectorAll('[data-edit]').forEach((btn) =>
        btn.addEventListener('click', () => {
          this.kit.pushNav(() => this.showList());
          this.showDetail(Number(btn.getAttribute('data-edit')));
        })
      );
      document.querySelectorAll('[data-copy]').forEach((btn) =>
        btn.addEventListener('click', async () => {
          const result = await this.ctx.api(`/api/price-sets/${btn.getAttribute('data-copy')}/copy`, {
            method: 'POST',
            body: '{}',
          });
          if (!result.res.ok || !result.data?.ok) {
            window.alert(result.data?.message || 'コピー失敗');
            return;
          }
          const newId = result.data.price_set?.price_set_id;
          this.kit.pushNav(() => this.showList());
          await this.showDetail(newId);
        })
      );
      document.querySelectorAll('[data-del]').forEach((btn) =>
        btn.addEventListener('click', async () => {
          if (!window.confirm('削除しますか？')) return;
          const result = await this.ctx.api(`/api/price-sets/${btn.getAttribute('data-del')}`, {
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

    emptyLine() {
      return {
        price_set_line_id: null,
        weekday_code: 'all',
        calc_type_code: '',
        price_type_code: '',
        billing_unit_price: 0,
        payment_unit_price: 0,
        sort_order: (this.detailState?.lines?.length || 0) * 10,
        profit_rate: null,
      };
    },

    profitRate(billing, payment) {
      const b = Number(billing || 0);
      const p = Number(payment || 0);
      if (!b) return '-';
      return `${Math.round(((b - p) / b) * 1000) / 10}%`;
    },

    linesGridHtml() {
      const weekdayOpts = ['all', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun']
        .map((c) => `<option value="${c}">${this.weekdayLabel(c)}</option>`)
        .join('');
      const rows = this.detailState.lines
        .map((l, idx) => {
          const wOpts = weekdayOpts.replace(
            `value="${l.weekday_code || 'all'}"`,
            `value="${l.weekday_code || 'all'}" selected`
          );
          return `
          <tr data-line-idx="${idx}">
            <td><select data-f="weekday_code">${wOpts}</select></td>
            <td><select data-f="calc_type_code">${this.kit.codeOptions(this.codes.price_calc_type || this.codes.overtime_calc, l.calc_type_code)}</select></td>
            <td><select data-f="price_type_code">${this.kit.codeOptions(this.codes.price_type, l.price_type_code)}</select></td>
            <td><input type="number" step="0.01" data-f="billing_unit_price" value="${this.ctx.escapeHtml(l.billing_unit_price ?? 0)}" /></td>
            <td><input type="number" step="0.01" data-f="payment_unit_price" value="${this.ctx.escapeHtml(l.payment_unit_price ?? 0)}" /></td>
            <td class="dt-profit">${this.ctx.escapeHtml(this.profitRate(l.billing_unit_price, l.payment_unit_price))}</td>
            <td><button type="button" class="btn btn-danger btn-small" data-del-line="${idx}">削除</button></td>
          </tr>`;
        })
        .join('');
      return `
        <table class="data-table data-table-compact" id="lines-grid">
          <thead><tr><th>曜日</th><th>計算区分</th><th>料金種別</th><th>請求単価</th><th>支払単価</th><th>利益率</th><th></th></tr></thead>
          <tbody>${rows || '<tr><td colspan="7">行がありません</td></tr>'}</tbody>
        </table>`;
    },

    collectLines() {
      const lines = [];
      document.querySelectorAll('#lines-grid tbody tr[data-line-idx]').forEach((tr) => {
        const idx = Number(tr.getAttribute('data-line-idx'));
        const prev = this.detailState.lines[idx] || {};
        const billing = tr.querySelector('[data-f="billing_unit_price"]')?.value;
        const payment = tr.querySelector('[data-f="payment_unit_price"]')?.value;
        lines.push({
          price_set_line_id: prev.price_set_line_id || null,
          weekday_code: tr.querySelector('[data-f="weekday_code"]')?.value || 'all',
          calc_type_code: tr.querySelector('[data-f="calc_type_code"]')?.value || null,
          price_type_code: tr.querySelector('[data-f="price_type_code"]')?.value || null,
          billing_unit_price: Number(billing || 0),
          payment_unit_price: Number(payment || 0),
          sort_order: idx * 10,
        });
      });
      this.detailState.lines = lines;
    },

    bindLinesGrid() {
      document.querySelectorAll('[data-del-line]').forEach((btn) =>
        btn.addEventListener('click', () => {
          this.collectLines();
          this.detailState.lines.splice(Number(btn.getAttribute('data-del-line')), 1);
          document.getElementById('lines-area').innerHTML = this.linesGridHtml();
          this.bindLinesGrid();
        })
      );
      document.querySelectorAll('#lines-grid [data-f="billing_unit_price"], #lines-grid [data-f="payment_unit_price"]').forEach((inp) => {
        inp.addEventListener('input', () => {
          const tr = inp.closest('tr');
          const b = tr.querySelector('[data-f="billing_unit_price"]').value;
          const p = tr.querySelector('[data-f="payment_unit_price"]').value;
          const cell = tr.querySelector('.dt-profit');
          if (cell) cell.textContent = this.profitRate(b, p);
        });
      });
    },

    async showDetail(id) {
      this.ctx.renderLoading();
      let row = {
        price_set_id: null,
        version: 1,
        price_set_name: '',
        company_id: '',
        apply_start_date: '',
        apply_end_date: '',
        note: '',
        lines: [],
      };
      if (id) {
        const { res, data } = await this.ctx.api(`/api/price-sets/${id}`);
        if (!res.ok || !data?.ok) {
          this.ctx.app.innerHTML = this.kit.shell(
            '金額データ詳細',
            `<section class="panel"><p class="error">${this.ctx.escapeHtml(data?.message || '取得失敗')}</p></section>`,
            { onBack: () => this.showList() }
          );
          this.kit.bindShell({ onBack: () => this.showList() });
          return;
        }
        row = data.price_set;
      }
      this.detailState = {
        id: row.price_set_id,
        version: row.version || 1,
        lines: (row.lines || []).map((l) => ({ ...l })),
      };
      this.ctx.app.innerHTML = this.kit.shell(
        id ? `金額データ編集（No.${id}）` : '金額データ新規',
        `<section class="panel">
          <p class="error" id="form-error"></p>
          <form id="ps-form">
            <div class="form-grid">
              <div><label>名称（必須）</label><input name="price_set_name" required value="${this.ctx.escapeHtml(row.price_set_name || '')}" /></div>
              <div><label>企業</label><select name="company_id">${this.kit.optionsFromList(this.companies, 'company_id', 'company_name', row.company_id)}</select></div>
              <div><label>適用開始</label><input type="date" name="apply_start_date" value="${this.ctx.escapeHtml(this.kit.dateValue(row.apply_start_date))}" /></div>
              <div><label>適用終了</label><input type="date" name="apply_end_date" value="${this.ctx.escapeHtml(this.kit.dateValue(row.apply_end_date))}" /></div>
              <div class="full"><label>備考</label><input name="note" value="${this.ctx.escapeHtml(row.note || '')}" /></div>
            </div>
            <div class="section-head">
              <h3 class="section-title">料金行</h3>
              <button type="button" class="btn btn-ghost" id="add-line">＋ 行追加</button>
            </div>
            <div class="table-wrap" id="lines-area">${this.linesGridHtml()}</div>
            <div class="btn-row">
              <button class="btn" type="submit">保存</button>
              <button class="btn btn-ghost" type="button" id="cancel">一覧へ</button>
            </div>
          </form>
        </section>`,
        { onBack: () => this.showList() }
      );
      this.kit.bindShell({ onBack: () => this.showList() });
      this.bindLinesGrid();
      document.getElementById('add-line')?.addEventListener('click', () => {
        this.collectLines();
        this.detailState.lines.push(this.emptyLine());
        document.getElementById('lines-area').innerHTML = this.linesGridHtml();
        this.bindLinesGrid();
      });
      document.getElementById('cancel')?.addEventListener('click', () => this.showList());
      document.getElementById('ps-form')?.addEventListener('submit', async (e) => {
        e.preventDefault();
        const form = e.currentTarget;
        this.collectLines();
        const payload = {
          price_set_name: form.price_set_name.value.trim(),
          company_id: form.company_id.value ? Number(form.company_id.value) : null,
          apply_start_date: form.apply_start_date.value || null,
          apply_end_date: form.apply_end_date.value || null,
          note: form.note.value,
          lines: this.detailState.lines,
          version: this.detailState.version,
        };
        const result = this.detailState.id
          ? await this.ctx.api(`/api/price-sets/${this.detailState.id}`, {
              method: 'PUT',
              body: JSON.stringify(payload),
            })
          : await this.ctx.api('/api/price-sets', { method: 'POST', body: JSON.stringify(payload) });
        if (!result.res.ok || !result.data?.ok) {
          document.getElementById('form-error').textContent = result.data?.message || '保存失敗';
          return;
        }
        await this.showList(this.detailState.id ? '更新しました' : '登録しました');
      });
    },
  };

  window.LinksPriceSets = LinksPriceSets;
})();
