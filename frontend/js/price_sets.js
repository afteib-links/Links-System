(() => {
  const Fee = () => window.LinksPriceSetFeeModel;

  const LinksPriceSets = {
    async open(ctx, options = {}) {
      this.kit = window.LinksFeatureKit.createFeatureKit(ctx);
      this.ctx = ctx;
      this.codes = await this.kit.loadCodes();
      const companies = await this.ctx.api('/api/lookups/companies');
      this.companies = companies.data?.companies || [];
      this.q = '';
      this.filterBaseProjectId = options.base_project_id ? Number(options.base_project_id) : null;
      this.filterProjectId = options.project_id ? Number(options.project_id) : null;
      this.prefillCompanyId = options.company_id ? Number(options.company_id) : null;
      this.returnTo = options.returnTo || null;
      if (options.price_set_id) {
        this.kit.pushNav(() => this.showList());
        await this.showDetail(Number(options.price_set_id));
        return;
      }
      if (options.new_with_owner) {
        this.kit.pushNav(() => this.showList());
        await this.showDetail(null, {
          base_project_id: this.filterBaseProjectId,
          project_id: this.filterProjectId,
          company_id: this.prefillCompanyId,
        });
        return;
      }
      await this.showList();
    },

    linkLabel(ps) {
      if (ps.project_id) {
        const name = ps.project_manager_name || ps.project_id;
        return `個別案件 No.${ps.project_id}（${name}）`;
      }
      if (ps.base_project_id) {
        const name = ps.base_template_name || ps.base_project_id;
        return `基本案件 No.${ps.base_project_id}（${name}）`;
      }
      return '未紐付け';
    },

    todayTokyoDate() {
      return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Tokyo' }).format(new Date());
    },

    async promptApplyStartDate() {
      const v = window.prompt('新しい適用開始日（必須）', this.todayTokyoDate());
      if (!v) return null;
      const trimmed = v.trim();
      return trimmed || null;
    },

    async copyPriceSet(priceSetId, extraBody = {}) {
      const applyStart = extraBody.apply_start_date || (await this.promptApplyStartDate());
      if (!applyStart) return null;
      const result = await this.ctx.api(`/api/price-sets/${priceSetId}/copy`, {
        method: 'POST',
        body: JSON.stringify({ apply_start_date: applyStart, ...extraBody }),
      });
      if (!result.res.ok || !result.data?.ok) {
        window.alert(result.data?.message || 'コピー失敗');
        return null;
      }
      return result.data.price_set;
    },

    weekdayLabel(code) {
      return Fee().WEEKDAY_LABELS[code] || code || '-';
    },

    priceTypeList() {
      const list = this.codes?.price_type || [];
      if (!list.length) return [{ code_value: 'basic', code_label: '基本' }];
      return list;
    },

    priceTypeLabel(code) {
      const hit = this.priceTypeList().find((c) => (c.code_value || c.value) === code);
      return hit?.code_label || hit?.label || code;
    },

    calcLabel(code) {
      const list = this.codes?.price_calc_type || this.codes?.overtime_calc || [];
      const hit = list.find((c) => (c.code_value || c.value) === code);
      return hit?.code_label || code;
    },

    profitRate(billing, payment) {
      const b = Number(billing || 0);
      const p = Number(payment || 0);
      if (!b) return '-';
      return `${Math.round(((b - p) / b) * 1000) / 10}%`;
    },

    parseExtraData(raw) {
      if (!raw) return {};
      if (typeof raw === 'object') return raw;
      try {
        return JSON.parse(raw);
      } catch {
        return {};
      }
    },

    normalizeNightSettings(raw) {
      const extra = this.parseExtraData(raw);
      const defaultSide = {
        periods: [{ start: '22:00', end: '29:00' }],
        night_mode: 'separate',
        night_overtime_mode: 'separate',
      };
      const defaultRounding = {
        time_unit_minutes: 15,
        time_mode: 'floor',
        amount_mode: 'floor',
        amount_stage: 'detail',
      };
      return {
        standard_minutes: Number(extra.work_rules?.standard_minutes ?? 480),
        night_rules: {
          billing: { ...defaultSide, ...(extra.night_rules?.billing || {}) },
          payment: { ...defaultSide, ...(extra.night_rules?.payment || {}) },
        },
        rounding: {
          billing: { ...defaultRounding, ...(extra.rounding?.billing || {}) },
          payment: { ...defaultRounding, ...(extra.rounding?.payment || {}) },
        },
      };
    },

    periodsText(periods) {
      const list = Array.isArray(periods) && periods.length ? periods : [{ start: '22:00', end: '29:00' }];
      return list.map((period) => `${period.start}-${period.end}`).join(', ');
    },

    parsePeriodsText(text) {
      const parts = String(text || '')
        .split(',')
        .map((part) => part.trim())
        .filter(Boolean);
      if (!parts.length) return [{ start: '22:00', end: '29:00' }];
      return parts.map((part) => {
        const match = part.match(/^(\d{1,2}:\d{2})\s*[-～]\s*(\d{1,2}:\d{2})$/);
        if (!match) throw new Error(`深夜帯「${part}」は22:00-29:00の形式で入力してください`);
        return { start: match[1], end: match[2] };
      });
    },

    nightSettingsHtml() {
      const settings = this.detailState.nightSettings;
      const modeOptions = (selected) => [
        ['separate', '別途計算'],
        ['included', '基本料金に含む'],
        ['excluded', '対象外'],
      ]
        .map(([value, label]) => `<option value="${value}" ${selected === value ? 'selected' : ''}>${label}</option>`)
        .join('');
      const roundingOptions = (selected) => [
        ['floor', '切り捨て'],
        ['round', '四捨五入'],
        ['ceil', '切り上げ'],
      ]
        .map(([value, label]) => `<option value="${value}" ${selected === value ? 'selected' : ''}>${label}</option>`)
        .join('');
      const amountStageOptions = (selected) => [
        ['detail', '明細ごと'],
        ['day', '日ごと'],
        ['month', '月合計後'],
      ]
        .map(([value, label]) => `<option value="${value}" ${selected === value ? 'selected' : ''}>${label}</option>`)
        .join('');
      const sideCard = (side, label) => {
        const rule = settings.night_rules[side];
        const round = settings.rounding[side];
        return `<fieldset class="night-setting-card">
          <legend>${label}</legend>
          <label>深夜帯（複数はカンマ区切り）
            <input id="night-${side}-periods" value="${this.ctx.escapeHtml(this.periodsText(rule.periods))}" placeholder="22:00-29:00" />
          </label>
          <label>深夜 <select id="night-${side}-mode">${modeOptions(rule.night_mode)}</select></label>
          <label>深夜超過 <select id="night-${side}-overtime-mode">${modeOptions(rule.night_overtime_mode)}</select></label>
          <label>時間丸め単位（分） <input id="round-${side}-unit" type="number" min="1" step="1" value="${this.ctx.escapeHtml(round.time_unit_minutes)}" /></label>
          <label>時間丸め <select id="round-${side}-time-mode">${roundingOptions(round.time_mode)}</select></label>
          <label>金額丸め <select id="round-${side}-amount-mode">${roundingOptions(round.amount_mode)}</select></label>
          <label>金額丸め段階 <select id="round-${side}-amount-stage">${amountStageOptions(round.amount_stage)}</select></label>
        </fieldset>`;
      };
      return `<div class="night-settings-grid">
        <label>日次基準時間（分）
          <input id="standard-minutes" type="number" min="0" step="1" value="${this.ctx.escapeHtml(settings.standard_minutes)}" />
        </label>
        ${sideCard('billing', '請求側')}
        ${sideCard('payment', '支払側')}
      </div>`;
    },

    collectNightSettings() {
      const settings = this.detailState.nightSettings;
      settings.standard_minutes = Math.max(0, Number(document.getElementById('standard-minutes')?.value || 0));
      for (const side of ['billing', 'payment']) {
        settings.night_rules[side] = {
          periods: this.parsePeriodsText(document.getElementById(`night-${side}-periods`)?.value),
          night_mode: document.getElementById(`night-${side}-mode`)?.value || 'separate',
          night_overtime_mode: document.getElementById(`night-${side}-overtime-mode`)?.value || 'separate',
        };
        settings.rounding[side] = {
          time_unit_minutes: Math.max(1, Number(document.getElementById(`round-${side}-unit`)?.value || 1)),
          time_mode: document.getElementById(`round-${side}-time-mode`)?.value || 'floor',
          amount_mode: document.getElementById(`round-${side}-amount-mode`)?.value || 'floor',
          amount_stage: document.getElementById(`round-${side}-amount-stage`)?.value || 'detail',
        };
      }
      return settings;
    },

    async showList(message = '') {
      this.ctx.renderLoading();
      const params = new URLSearchParams({ q: this.q || '' });
      if (this.filterBaseProjectId) params.set('base_project_id', this.filterBaseProjectId);
      if (this.filterProjectId) params.set('project_id', this.filterProjectId);
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
            <td>${this.ctx.escapeHtml(ps.price_set_no || ps.price_set_id)}</td>
            <td>${this.ctx.escapeHtml(ps.price_set_name)}</td>
            <td>${this.ctx.escapeHtml(ps.company_name || '-')}</td>
            <td>${this.ctx.escapeHtml(this.linkLabel(ps))}</td>
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
              <thead><tr><th>No</th><th>名称</th><th>企業</th><th>連携先</th><th>適用開始</th><th>適用終了</th><th>行数</th><th>操作</th></tr></thead>
              <tbody>${rows || '<tr><td colspan="8">データがありません</td></tr>'}</tbody>
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
        this.showDetail(null, {
          base_project_id: this.filterBaseProjectId,
          project_id: this.filterProjectId,
          company_id: this.prefillCompanyId,
        });
      });
      document.querySelectorAll('[data-edit]').forEach((btn) =>
        btn.addEventListener('click', () => {
          this.kit.pushNav(() => this.showList());
          this.showDetail(Number(btn.getAttribute('data-edit')));
        })
      );
      document.querySelectorAll('[data-copy]').forEach((btn) =>
        btn.addEventListener('click', async () => {
          const copied = await this.copyPriceSet(Number(btn.getAttribute('data-copy')));
          if (!copied) return;
          this.kit.pushNav(() => this.showList());
          await this.showDetail(copied.price_set_id);
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

    feeItemMatrixHtml(item, itemIdx) {
      const pts = this.priceTypeList();
      if (item.mode === 'distance') {
        const pt = pts[0]?.code_value || 'basic';
        const cell = item.matrix?.distance?.[pt] || Fee().emptyCell();
        return `
          <p class="hint">距離超過は曜日に依存しません（計算区分: 距離）。</p>
          <table class="data-table data-table-compact fee-matrix">
            <thead><tr><th>料金種別</th><th>請求単価</th><th>支払単価</th><th>利益率</th></tr></thead>
            <tbody>
              <tr data-item="${itemIdx}" data-calc="distance" data-pt="${pt}">
                <td>${this.ctx.escapeHtml(this.priceTypeLabel(pt))}</td>
                <td><input type="number" step="0.01" data-f="billing" value="${this.ctx.escapeHtml(cell.billing ?? '')}" /></td>
                <td><input type="number" step="0.01" data-f="payment" value="${this.ctx.escapeHtml(cell.payment ?? '')}" /></td>
                <td class="dt-profit">${this.ctx.escapeHtml(this.profitRate(cell.billing, cell.payment))}</td>
              </tr>
            </tbody>
          </table>`;
      }
      const calcs = [
        { code: 'daily', label: this.calcLabel('daily') || '日極' },
        { code: 'hourly', label: this.calcLabel('hourly') || '時間' },
      ];
      const headPts = pts.map((p) => this.ctx.escapeHtml(p.code_label || p.code_value)).join('</th><th>');
      const rows = calcs
        .map((calc) => {
          const cells = pts
            .map((p) => {
              const pt = p.code_value || p.value;
              const cell = item.matrix?.[calc.code]?.[pt] || Fee().emptyCell();
              return `
                <td class="fee-matrix-cell" data-item="${itemIdx}" data-calc="${calc.code}" data-pt="${pt}">
                  <div class="fee-matrix-pair">
                    <label>請求</label><input type="number" step="0.01" data-f="billing" value="${this.ctx.escapeHtml(cell.billing ?? '')}" />
                    <label>支払</label><input type="number" step="0.01" data-f="payment" value="${this.ctx.escapeHtml(cell.payment ?? '')}" />
                    <span class="dt-profit">${this.ctx.escapeHtml(this.profitRate(cell.billing, cell.payment))}</span>
                  </div>
                </td>`;
            })
            .join('');
          return `<tr><th>${this.ctx.escapeHtml(calc.label)}</th>${cells}</tr>`;
        })
        .join('');
      return `
        <table class="data-table data-table-compact fee-matrix fee-matrix-wide">
          <thead><tr><th>計算</th><th>${headPts}</th></tr></thead>
          <tbody>${rows}</tbody>
        </table>`;
    },

    feeItemCardHtml(item, itemIdx) {
      const weekdayChecks =
        item.mode === 'distance'
          ? '<p class="hint">曜日の指定は不要です。</p>'
          : Fee()
              .WEEKDAY_CODES.map(
                (wd) => `
            <label class="weekday-chip">
              <input type="checkbox" data-wd="${wd}" ${item.weekdays?.[wd] ? 'checked' : ''} />
              ${this.weekdayLabel(wd)}
            </label>`
              )
              .join('');
      const quick =
        item.mode === 'distance'
          ? ''
          : `
          <div class="weekday-quick">
            <button type="button" class="btn btn-ghost btn-small" data-preset="weekdays" data-item="${itemIdx}">月〜金</button>
            <button type="button" class="btn btn-ghost btn-small" data-preset="weekend_holiday" data-item="${itemIdx}">土日祝</button>
            <button type="button" class="btn btn-ghost btn-small" data-preset="all" data-item="${itemIdx}">全曜日</button>
          </div>`;
      return `
        <article class="fee-item-card panel" data-fee-item="${itemIdx}">
          <div class="fee-item-head">
            <input type="text" class="fee-item-name" data-item="${itemIdx}" value="${this.ctx.escapeHtml(item.name || '')}" placeholder="料金項目名" />
            <div class="fee-item-actions">
              <button type="button" class="btn btn-ghost btn-small" data-dup-item="${itemIdx}">項目コピー</button>
              <button type="button" class="btn btn-danger btn-small" data-del-item="${itemIdx}">削除</button>
            </div>
          </div>
          <div class="fee-weekdays">${weekdayChecks}${quick}</div>
          <div class="fee-matrix-wrap" data-matrix-for="${itemIdx}">${this.feeItemMatrixHtml(item, itemIdx)}</div>
        </article>`;
    },

    feeItemsAreaHtml() {
      const cards = (this.detailState.items || [])
        .map((item, idx) => this.feeItemCardHtml(item, idx))
        .join('');
      return cards || '<p class="hint">料金項目がありません。「＋ 料金項目」で追加してください。</p>';
    },

    importBarHtml(currentId) {
      const others = (this.importCandidates || []).filter((ps) => Number(ps.price_set_id) !== Number(currentId));
      if (!others.length) {
        return '<p class="hint">他セットから取込: 取込可能な金額データがありません。</p>';
      }
      const opts = others
        .map(
          (ps) =>
            `<option value="${ps.price_set_id}">${this.ctx.escapeHtml(ps.price_set_no || ps.price_set_id)} — ${this.ctx.escapeHtml(ps.price_set_name)}</option>`
        )
        .join('');
      return `
        <div class="toolbar fee-import-bar">
          <label>他セットから行を取込</label>
          <select id="import-source">${opts}</select>
          <select id="import-mode">
            <option value="replace">上書き</option>
            <option value="merge">マージ</option>
          </select>
          <button type="button" class="btn btn-ghost" id="import-lines-btn">取込</button>
        </div>`;
    },

    collectFeeItemsFromDom() {
      const items = this.detailState.items || [];
      items.forEach((item, itemIdx) => {
        const card = document.querySelector(`[data-fee-item="${itemIdx}"]`);
        if (!card) return;
        const nameInp = card.querySelector('.fee-item-name');
        if (nameInp) item.name = nameInp.value.trim();
        if (item.mode !== 'distance') {
          Fee().WEEKDAY_CODES.forEach((wd) => {
            const cb = card.querySelector(`input[data-wd="${wd}"]`);
            item.weekdays[wd] = cb ? cb.checked : false;
          });
        }
        if (item.mode === 'distance') {
          const tr = card.querySelector('tr[data-calc="distance"]');
          if (tr) {
            const pt = tr.getAttribute('data-pt');
            const billing = tr.querySelector('[data-f="billing"]')?.value;
            const payment = tr.querySelector('[data-f="payment"]')?.value;
            if (!item.matrix.distance[pt]) item.matrix.distance[pt] = Fee().emptyCell();
            const cell = item.matrix.distance[pt];
            cell.billing = billing;
            cell.payment = payment;
          }
        } else {
          card.querySelectorAll('.fee-matrix-cell').forEach((td) => {
            const calc = td.getAttribute('data-calc');
            const pt = td.getAttribute('data-pt');
            const billing = td.querySelector('[data-f="billing"]')?.value;
            const payment = td.querySelector('[data-f="payment"]')?.value;
            if (!item.matrix[calc]) item.matrix[calc] = {};
            if (!item.matrix[calc][pt]) item.matrix[calc][pt] = Fee().emptyCell();
            const cell = item.matrix[calc][pt];
            cell.billing = billing;
            cell.payment = payment;
          });
        }
      });
      this.detailState.items = items;
    },

    bindFeeItemsArea() {
      document.querySelectorAll('[data-del-item]').forEach((btn) =>
        btn.addEventListener('click', () => {
          this.collectFeeItemsFromDom();
          const idx = Number(btn.getAttribute('data-del-item'));
          this.detailState.items.splice(idx, 1);
          this.refreshFeeItemsDom();
        })
      );
      document.querySelectorAll('[data-dup-item]').forEach((btn) =>
        btn.addEventListener('click', () => {
          this.collectFeeItemsFromDom();
          const idx = Number(btn.getAttribute('data-dup-item'));
          const copy = Fee().duplicateFeeItem(this.detailState.items[idx], this.codes);
          this.detailState.items.splice(idx + 1, 0, copy);
          this.refreshFeeItemsDom();
        })
      );
      document.querySelectorAll('[data-preset]').forEach((btn) =>
        btn.addEventListener('click', () => {
          this.collectFeeItemsFromDom();
          const idx = Number(btn.getAttribute('data-item'));
          const preset = btn.getAttribute('data-preset');
          Fee().applyWeekdayPreset(this.detailState.items[idx], preset);
          this.refreshFeeItemsDom();
        })
      );
      document.querySelectorAll('.fee-matrix input[data-f]').forEach((inp) => {
        inp.addEventListener('input', () => {
          const cell = inp.closest('.fee-matrix-cell') || inp.closest('tr');
          const b = cell.querySelector('[data-f="billing"]')?.value;
          const p = cell.querySelector('[data-f="payment"]')?.value;
          const profit = cell.querySelector('.dt-profit');
          if (profit) profit.textContent = this.profitRate(b, p);
        });
      });
    },

    refreshFeeItemsDom() {
      const area = document.getElementById('fee-items-area');
      if (area) area.innerHTML = this.feeItemsAreaHtml();
      this.bindFeeItemsArea();
    },

    async loadImportCandidates(row) {
      const params = new URLSearchParams();
      if (row.base_project_id) params.set('base_project_id', row.base_project_id);
      if (row.project_id) params.set('project_id', row.project_id);
      const { res, data } = await this.ctx.api(`/api/price-sets?${params}`);
      this.importCandidates = res.ok && data?.ok ? data.price_sets || [] : [];
    },

    async showDetail(id, prefill = null) {
      this.ctx.renderLoading();
      let row = {
        price_set_id: null,
        version: 1,
        price_set_name: '',
        company_id: prefill?.company_id || this.prefillCompanyId || '',
        base_project_id: prefill?.base_project_id || this.filterBaseProjectId || null,
        project_id: prefill?.project_id || this.filterProjectId || null,
        apply_start_date: '',
        apply_end_date: '',
        note: '',
        lines: [],
        extra_data: null,
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
      await this.loadImportCandidates(row);

      let items = Fee().hydrateFeeItems(row, this.codes);
      const isBlankNew = !id && !(row.lines || []).length;
      if (!items && isBlankNew) {
        items = Fee().defaultFeeItemTemplates(this.codes);
      }
      if (!items) items = [];

      this.detailState = {
        id: row.price_set_id,
        version: row.version || 1,
        items,
        nightSettings: this.normalizeNightSettings(row.extra_data),
        rowMeta: row,
      };

      this.ctx.app.innerHTML = this.kit.shell(
        id ? `金額データ編集（No.${id}）` : '金額データ新規',
        `<section class="panel">
          <p class="error" id="form-error"></p>
          <form id="ps-form">
            <div class="form-grid">
              <div><label>名称（必須）</label><input name="price_set_name" required value="${this.ctx.escapeHtml(row.price_set_name || '')}" /></div>
              <div><label>企業</label><select name="company_id">${this.kit.optionsFromList(this.companies, 'company_id', 'company_name', row.company_id)}</select></div>
              <div><label>適用開始（必須）</label><input type="date" name="apply_start_date" required value="${this.ctx.escapeHtml(this.kit.dateValue(row.apply_start_date))}" /></div>
              <div><label>適用終了</label><input type="date" name="apply_end_date" value="${this.ctx.escapeHtml(this.kit.dateValue(row.apply_end_date))}" /></div>
              <div class="full"><label>備考</label><input name="note" value="${this.ctx.escapeHtml(row.note || '')}" /></div>
            </div>
            <div class="section-head"><h3 class="section-title">勤務・深夜・丸め条件</h3></div>
            ${this.nightSettingsHtml()}
            ${id ? this.importBarHtml(id) : ''}
            <div class="section-head">
              <h3 class="section-title">料金項目（曜日 × 計算 × 種別）</h3>
              <button type="button" class="btn btn-ghost" id="add-fee-item">＋ 料金項目</button>
            </div>
            <div id="fee-items-area" class="fee-items-stack">${this.feeItemsAreaHtml()}</div>
            <div class="btn-row">
              <button class="btn" type="submit">保存</button>
              ${id ? '<button type="button" class="btn btn-ghost" id="copy-revision">コピーして改定</button>' : ''}
              <button class="btn btn-ghost" type="button" id="cancel">一覧へ</button>
            </div>
          </form>
        </section>
        <style>
          .fee-items-stack { display: flex; flex-direction: column; gap: 1rem; margin-top: 0.5rem; }
          .fee-item-card { border: 1px solid var(--border, #ccc); padding: 0.75rem; }
          .fee-item-head { display: flex; gap: 0.5rem; align-items: center; margin-bottom: 0.5rem; }
          .fee-item-name { flex: 1; font-weight: 600; }
          .fee-weekdays { display: flex; flex-wrap: wrap; gap: 0.35rem 0.75rem; align-items: center; margin-bottom: 0.5rem; }
          .weekday-chip { display: inline-flex; gap: 0.25rem; align-items: center; font-size: 0.9rem; }
          .weekday-quick { display: flex; gap: 0.25rem; flex-wrap: wrap; }
          .fee-matrix-pair { display: flex; flex-direction: column; gap: 0.15rem; font-size: 0.85rem; }
          .fee-matrix-pair input { width: 100%; max-width: 7rem; }
          .fee-matrix-wide th, .fee-matrix-wide td { vertical-align: top; }
          .fee-import-bar { margin: 1rem 0; flex-wrap: wrap; gap: 0.5rem; align-items: center; }
          .night-settings-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 0.75rem; margin-bottom: 1rem; }
          .night-setting-card { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 0.5rem; border: 1px solid var(--border, #ccc); }
          .night-setting-card > label:first-of-type { grid-column: 1 / -1; }
          .night-setting-card label { display: flex; flex-direction: column; gap: 0.2rem; }
          .hint { color: var(--muted, #666); font-size: 0.9rem; }
          @media (max-width: 900px) { .night-settings-grid { grid-template-columns: 1fr; } }
        </style>`,
        { onBack: () => this.showList() }
      );
      this.kit.bindShell({ onBack: () => this.showList() });
      this.bindFeeItemsArea();

      document.getElementById('add-fee-item')?.addEventListener('click', () => {
        this.collectFeeItemsFromDom();
        const pts = Fee().defaultPriceTypeCodes(this.codes);
        this.detailState.items.push(
          Fee().normalizeItem(
            {
              id: Fee().nextItemId(),
              name: '料金項目',
              mode: 'weekdays',
              weekdays: Fee().emptyWeekdays(),
            },
            pts
          )
        );
        this.refreshFeeItemsDom();
      });

      document.getElementById('import-lines-btn')?.addEventListener('click', async () => {
        const sourceId = document.getElementById('import-source')?.value;
        const mode = document.getElementById('import-mode')?.value || 'replace';
        if (!sourceId) return;
        const msg =
          mode === 'merge'
            ? '選択した金額データの行をマージします。続行しますか？'
            : '現在の行を上書きして取込します。続行しますか？';
        if (!window.confirm(msg)) return;
        const result = await this.ctx.api(`/api/price-sets/${id}/import-lines`, {
          method: 'POST',
          body: JSON.stringify({ source_price_set_id: Number(sourceId), mode }),
        });
        if (!result.res.ok || !result.data?.ok) {
          window.alert(result.data?.message || '取込失敗');
          return;
        }
        await this.showDetail(id);
      });

      document.getElementById('cancel')?.addEventListener('click', () => {
        if (this.returnTo) {
          this.returnTo();
          return;
        }
        this.showList();
      });
      document.getElementById('copy-revision')?.addEventListener('click', async () => {
        const copied = await this.copyPriceSet(id);
        if (!copied) return;
        this.kit.pushNav(() => this.showDetail(id));
        await this.showDetail(copied.price_set_id);
      });
      document.getElementById('ps-form')?.addEventListener('submit', async (e) => {
        e.preventDefault();
        const form = e.currentTarget;
        let nightSettings;
        try {
          this.collectFeeItemsFromDom();
          nightSettings = this.collectNightSettings();
        } catch (error) {
          document.getElementById('form-error').textContent = error.message || '深夜条件を確認してください';
          return;
        }
        const lines = Fee().itemsToLines(this.detailState.items);
        const extra_data = {
          fee_items: Fee().feeItemsForExtraData(this.detailState.items),
          night_rules: nightSettings.night_rules,
          rounding: nightSettings.rounding,
          work_rules: { standard_minutes: nightSettings.standard_minutes },
        };
        const payload = {
          price_set_name: form.price_set_name.value.trim(),
          company_id: form.company_id.value ? Number(form.company_id.value) : null,
          base_project_id: row.base_project_id || null,
          project_id: row.project_id || null,
          apply_start_date: form.apply_start_date.value || null,
          apply_end_date: form.apply_end_date.value || null,
          note: form.note.value,
          lines,
          extra_data,
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
        if (this.returnTo) {
          await this.returnTo();
          return;
        }
        await this.showList(this.detailState.id ? '更新しました' : '登録しました');
      });
    },
  };

  window.LinksPriceSets = LinksPriceSets;
})();
