(() => {
  window.LinksAnalytics = {
    ctx: null,
    kit: null,
    tab: 'pl',
    ym: null,
    months: '12',
    area: '',
    staff: '',
    companyId: '',
    fold: { area: false, kubun: false, staff: false, company: false },
    showSum: { area: true, staff: true, company: true },
    meta: { areas: [], staff: [], companies: [], profit_warning_percent: 10 },
    data: null,

    async open(ctx) {
      this.ctx = ctx;
      this.kit = window.LinksFeatureKit.createFeatureKit(ctx);
      this.ym = this.kit.currentYearMonth();
      this.kit.clearNav();
      await this.loadMeta();
      await this.show();
    },

    async loadMeta() {
      const { res, data } = await this.ctx.api('/api/analytics/meta');
      if (res.ok && data?.ok) this.meta = data;
    },

    query() {
      const p = new URLSearchParams();
      if (this.ym) p.set('ym', this.ym);
      if (this.area) p.set('area', this.area);
      if (this.staff) p.set('staff', this.staff);
      if (this.companyId) p.set('company_id', this.companyId);
      if (this.tab !== 'pl') p.set('months', this.months);
      return p.toString();
    },

    async show() {
      const path = this.tab === 'pl' ? '/api/analytics/pl' : this.tab === 'margin' ? '/api/analytics/margin' : '/api/analytics/days';
      const { res, data } = await this.ctx.api(`${path}?${this.query()}`);
      if (!res.ok || !data?.ok) {
        this.ctx.app.innerHTML = this.kit.shell(
          '収支分析',
          `<section class="panel"><p class="error">${this.ctx.escapeHtml(data?.message || '取得できませんでした')}</p></section>`,
          { wide: true }
        );
        this.kit.bindShell();
        return;
      }
      this.data = data;
      if (data.profit_warning_percent != null) this.meta.profit_warning_percent = data.profit_warning_percent;
      this.ctx.app.innerHTML = this.kit.shell('収支分析', this.screenHtml(), { wide: true });
      this.kit.bindShell();
      this.bind();
    },

    screenHtml() {
      const tab = (key, label) =>
        `<button type="button" class="tab ${this.tab === key ? 'is-active' : ''}" data-tab="${key}">${label}</button>`;
      return `<section class="analytics-screen">
        <p class="muted">承認済み日報と確定済み請求・支払を集計します。利益率の赤表示基準はマスター設定の利益率警告基準（現在 ${this.meta.profit_warning_percent}%）です。</p>
        <div class="tabs">${tab('pl', '収支分析一覧表')}${tab('margin', '企業別利益率一覧表')}${tab('days', '稼働日一覧表')}</div>
        ${this.tab === 'pl' ? this.plFilters() : this.monthFilters()}
        <div class="table-wrap analytics-table-wrap">${this.tab === 'pl' ? this.plTable() : this.tab === 'margin' ? this.marginTable() : this.daysTable()}</div>
      </section>`;
    },

    options(list, value, labelKey, valueKey) {
      return [`<option value="">すべて</option>`]
        .concat((list || []).map((item) => {
          const val = valueKey ? item[valueKey] : item;
          const label = labelKey ? item[labelKey] : item;
          return `<option value="${this.ctx.escapeHtml(val)}" ${String(val) === String(value) ? 'selected' : ''}>${this.ctx.escapeHtml(label)}</option>`;
        }))
        .join('');
    },

    plFilters() {
      return `<section class="panel">
        ${this.kit.monthNavigatorHtml(this.ym, 'an-month')}
        <div class="filter-grid">
          <label>エリア<select id="an-area">${this.options(this.meta.areas, this.area)}</select></label>
          <label>担当者<select id="an-staff">${this.options(this.meta.staff, this.staff, 'staff_name', 'staff_master_id')}</select></label>
        </div>
        <div class="check-row"><span>折りたたみ</span>
          ${this.check('fold-area', this.fold.area, 'エリアで畳む')}
          ${this.check('fold-kubun', this.fold.kubun, '区分で畳む（外注／給与）')}
          ${this.check('fold-staff', this.fold.staff, '担当者で畳む')}
          ${this.check('fold-company', this.fold.company, '企業で畳む')}
          ${this.check('fold-expand', !this.fold.area && !this.fold.kubun && !this.fold.staff && !this.fold.company, 'すべて展開')}
        </div>
        <div class="check-row"><span>合計額</span>
          ${this.check('sum-area', this.showSum.area, 'エリア合計')}
          ${this.check('sum-staff', this.showSum.staff, '担当者合計')}
          ${this.check('sum-company', this.showSum.company, '企業合計')}
        </div>
      </section>`;
    },

    monthFilters() {
      return `<section class="panel"><div class="filter-grid">
        <label>エリア<select id="an-area">${this.options(this.meta.areas, this.area)}</select></label>
        <label>担当者<select id="an-staff">${this.options(this.meta.staff, this.staff, 'staff_name', 'staff_master_id')}</select></label>
        ${this.tab === 'days' ? `<label>企業<select id="an-company">${this.options(this.meta.companies, this.companyId, 'company_name', 'company_id')}</select></label>` : ''}
        <label>表示月<select id="an-range"><option value="12" ${this.months === '12' ? 'selected' : ''}>直近12か月</option><option value="all" ${this.months === 'all' ? 'selected' : ''}>全期間</option></select></label>
      </div></section>`;
    },

    check(id, on, label) {
      return `<label><input type="checkbox" id="${id}" ${on ? 'checked' : ''}><span>${label}</span></label>`;
    },

    yen(n) {
      if (n == null || n === '') return '';
      return `￥${Math.round(Number(n) || 0).toLocaleString('ja-JP')}`;
    },

    pct(rate) {
      if (rate == null || Number.isNaN(Number(rate))) return '—';
      return `${Number(rate).toFixed(1)}%`;
    },

    cells(tot, show) {
      if (!show) return '<td class="num"></td>'.repeat(8);
      const cls = Number(tot.profit) < 0 ? 'neg' : 'pos';
      return `<td class="num">${this.yen(tot.sales)}</td><td class="num">${this.yen(tot.bill)}</td><td class="num">${this.yen(tot.pay)}</td><td class="num">${this.yen(tot.pay_bill)}</td><td class="num ${cls}">${this.yen(tot.profit)}</td><td class="num">${this.pct(tot.profit_rate)}</td><td class="num">${tot.tax ? this.yen(tot.tax) : ''}</td><td class="num">${tot.days ?? ''}</td>`;
    },

    partnerCells(p) {
      const cls = Number(p.profit) < 0 ? 'neg' : 'pos';
      return `<td class="num">${this.yen(p.sales)}</td><td class="num">${this.yen(p.bill)}</td><td class="num">${this.yen(p.pay)}</td><td class="num">${this.yen(p.pay_bill)}</td><td class="num ${cls}">${this.yen(p.profit)}</td><td class="num">${this.pct(p.profit_rate)}</td><td class="num"></td><td class="num">${p.days}</td>`;
    },

    plTable() {
      const foldA = this.fold.area;
      const foldS = this.fold.staff;
      const foldC = this.fold.company;
      const foldK = this.fold.kubun;
      let body = '';
      for (const area of this.data.areas || []) {
        body += `<tr class="row-area"><td colspan="2">${this.ctx.escapeHtml(area.area_name)}</td>${this.cells(area.totals, this.showSum.area)}</tr>`;
        if (foldA) continue;
        for (const staff of area.staffs || []) {
          body += `<tr class="row-staff"><td colspan="2" class="indent-1">${this.ctx.escapeHtml(staff.staff_name)}</td>${this.cells(staff.totals, this.showSum.staff)}</tr>`;
          if (foldS) continue;
          for (const c of staff.companies || []) {
            const note = c.invoice_diff ? `<div class="diff-note">請求書合計を使用（累計 ${this.yen(c.sales)}）</div>` : '';
            body += `<tr class="row-company"><td class="indent-2">${this.ctx.escapeHtml(c.company_no)}</td><td>${this.ctx.escapeHtml(c.company_name)}${note}</td>${this.cells(c, this.showSum.company)}</tr>`;
            if (foldC) continue;
            if (foldK) {
              for (const k of ['外注', '給与']) {
                const ps = (c.partners || []).filter((p) => p.kubun === k);
                if (!ps.length) continue;
                const tot = ps.reduce((a, p) => ({
                  sales: a.sales + Number(p.sales || 0),
                  pay: a.pay + Number(p.pay || 0),
                  bill: a.bill + Number(p.bill || 0),
                  pay_bill: a.pay_bill + Number(p.pay_bill || 0),
                  tax: 0,
                  days: a.days + Number(p.days || 0),
                  profit: a.profit + Number(p.profit || 0),
                }), { sales: 0, pay: 0, bill: 0, pay_bill: 0, days: 0, profit: 0 });
                tot.profit_rate = tot.sales ? (tot.profit / tot.sales) * 100 : null;
                body += `<tr class="row-kubun"><td></td><td class="indent-3">${k}（${ps.length}名）</td>${this.cells(tot, true)}</tr>`;
              }
            } else {
              for (const p of c.partners || []) {
                body += `<tr class="row-partner"><td></td><td class="indent-3">${this.ctx.escapeHtml(p.partner_name)}　<span class="diff-note">${this.ctx.escapeHtml(p.kubun)}</span></td>${this.partnerCells(p)}</tr>`;
              }
            }
          }
        }
      }
      return `<table class="data-table"><thead><tr>
        <th rowspan="2">No</th><th rowspan="2">企業 / パートナー</th>
        <th colspan="2">売上側</th><th colspan="2">支払側</th>
        <th rowspan="2" class="num">利益額</th><th rowspan="2" class="num">利益率</th>
        <th rowspan="2" class="num">消費税</th><th rowspan="2" class="num">稼働日数</th>
      </tr><tr>
        <th class="num">売　上</th><th class="num">請求金額</th>
        <th class="num">支　払</th><th class="num">請求金額</th>
      </tr></thead><tbody>${body || '<tr><td colspan="10">該当なし</td></tr>'}</tbody></table>`;
    },

    ymLabel(ym) {
      const [y, m] = String(ym).split('-');
      return `${y}年${Number(m)}月`;
    },

    marginTable() {
      const months = this.data.months || [];
      const warn = Number(this.meta.profit_warning_percent || 10);
      const heads = months.map((m) => `<th class="num">${this.ymLabel(m)}</th>`).join('');
      let body = '';
      let last = '';
      for (const c of this.data.rows || []) {
        const key = `${c.area_name}|${c.staff_name}`;
        if (key !== last) {
          body += `<tr class="row-area"><td colspan="2">${this.ctx.escapeHtml(c.area_name)}　／　${this.ctx.escapeHtml(c.staff_name)}</td>${months.map(() => '<td></td>').join('')}</tr>`;
          last = key;
        }
        const cells = (c.rates || []).map((v) => {
          if (v == null) return '<td class="num">—</td>';
          const cls = v < warn ? 'neg' : 'pos';
          return `<td class="num ${cls}">${Number(v).toFixed(1)}%</td>`;
        }).join('');
        body += `<tr class="row-company"><td class="sticky-left">${this.ctx.escapeHtml(c.company_no)}</td><td class="sticky-left">${this.ctx.escapeHtml(c.company_name)}</td>${cells}</tr>`;
      }
      return `<table class="data-table month-table"><thead><tr><th class="sticky-left">No</th><th class="sticky-left">企業</th>${heads}</tr></thead><tbody>${body || '<tr><td colspan="2">該当なし</td></tr>'}</tbody></table>`;
    },

    daysTable() {
      const months = this.data.months || [];
      const heads = months.map((m) => `<th class="num">${this.ymLabel(m)}</th>`).join('');
      let body = '';
      let lastArea = '';
      const counters = new Map();
      for (const r of this.data.rows || []) {
        if (r.area_name !== lastArea) {
          body += `<tr class="row-area"><td colspan="4">${this.ctx.escapeHtml(r.area_name)}</td>${months.map(() => '<td></td>').join('')}</tr>`;
          lastArea = r.area_name;
        }
        const n = (counters.get(r.company_no) || 0) + 1;
        counters.set(r.company_no, n);
        const cells = (r.days || []).map((d) => `<td class="num">${d}日</td>`).join('');
        body += `<tr><td>${this.ctx.escapeHtml(r.company_no)}-${n}</td><td>${this.ctx.escapeHtml(r.staff_name)}</td><td>${this.ctx.escapeHtml(r.company_name)}</td><td>${this.ctx.escapeHtml(r.partner_name)}</td>${cells}</tr>`;
      }
      return `<table class="data-table month-table"><thead><tr><th>No</th><th>担当者</th><th>企業</th><th>パートナー</th>${heads}</tr></thead><tbody>${body || '<tr><td colspan="4">該当なし</td></tr>'}</tbody></table>`;
    },

    bind() {
      document.querySelectorAll('[data-tab]').forEach((btn) => {
        btn.addEventListener('click', () => {
          this.tab = btn.getAttribute('data-tab');
          this.show();
        });
      });
      this.kit.bindMonthNavigator('an-month', () => this.ym, (v) => { this.ym = v; }, () => this.show());
      const area = document.getElementById('an-area');
      const staff = document.getElementById('an-staff');
      const company = document.getElementById('an-company');
      const range = document.getElementById('an-range');
      area?.addEventListener('change', () => { this.area = area.value; this.show(); });
      staff?.addEventListener('change', () => { this.staff = staff.value; this.show(); });
      company?.addEventListener('change', () => { this.companyId = company.value; this.show(); });
      range?.addEventListener('change', () => { this.months = range.value; this.show(); });
      const applyFold = () => this.show();
      document.getElementById('fold-expand')?.addEventListener('change', (e) => {
        if (e.target.checked) this.fold = { area: false, kubun: false, staff: false, company: false };
        applyFold();
      });
      ['area', 'kubun', 'staff', 'company'].forEach((key) => {
        document.getElementById(`fold-${key}`)?.addEventListener('change', (e) => {
          this.fold[key] = e.target.checked;
          applyFold();
        });
      });
      ['area', 'staff', 'company'].forEach((key) => {
        document.getElementById(`sum-${key}`)?.addEventListener('change', (e) => {
          this.showSum[key] = e.target.checked;
          this.show();
        });
      });
    },
  };
})();
