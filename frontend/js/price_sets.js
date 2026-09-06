(() => {
  const Fee = () => window.LinksPriceSetFeeModel;
  const DEFAULT_CALCULATION_SETTINGS = Object.freeze({
    profit_warning_percent: 10,
    overtime_multiplier: 1.25,
    night_multiplier: 1.35,
    night_overtime_multiplier: 1.6,
  });

  const LinksPriceSets = {
    async open(ctx, options = {}) {
      this.kit = window.LinksFeatureKit.createFeatureKit(ctx);
      this.ctx = ctx;
      this.codes = await this.kit.loadCodes();
      this.calculationSettings = await this.loadCalculationSettings();
      const companies = await this.ctx.api('/api/lookups/companies');
      this.companies = companies.data?.companies || [];
      this.q = '';
      this.listState = { sortKey: 'price_set_no', sortOrder: 'asc', filters: {} };
      this.layout = window.LinksListScreens.areaLayout(await this.kit.loadLayout('price_sets'), 'list');
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

    async loadCalculationSettings() {
      const { res, data } = await this.ctx.api('/api/price-sets/calculation-settings');
      if (!res.ok || !data?.ok) return { ...DEFAULT_CALCULATION_SETTINGS };
      return { ...DEFAULT_CALCULATION_SETTINGS, ...(data.settings || {}) };
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

    calculationTypeList() {
      const list = this.codes?.price_calc_type || [];
      return list.length ? list : [
        { code_value: 'daily', code_label: '日極' },
        { code_value: 'hourly', code_label: '時間' },
        { code_value: 'distance', code_label: '距離' },
      ];
    },

    calculationTypeChecks(item, itemIdx) {
      return this.calculationTypeList().map((calc) => {
        const code = calc.code_value || calc.value;
        const supported = ['daily', 'hourly', 'distance'].includes(code);
        return `<label class="calc-type-chip"><input type="checkbox" data-calc-type="${this.ctx.escapeHtml(code)}" data-item="${itemIdx}" ${(item.calc_types || []).includes(code) ? 'checked' : ''}><span>${this.ctx.escapeHtml(calc.code_label || calc.label || code)}</span>${supported ? '' : '<small>計算未対応</small>'}</label>`;
      }).join('');
    },

    profitRate(billing, payment) {
      const b = Number(billing || 0);
      const p = Number(payment || 0);
      if (!b) return '-';
      return `${Math.round(((b - p) / b) * 1000) / 10}%`;
    },

    profitRateValue(billing, payment) {
      const b = Number(billing || 0);
      const p = Number(payment || 0);
      if (!b) return '';
      return String(Math.round(((b - p) / b) * 1000) / 10);
    },

    formatDurationMinutes(value) {
      const minutes = Math.max(0, Math.floor(Number(value) || 0));
      return `${Math.floor(minutes / 60)}:${String(minutes % 60).padStart(2, '0')}`;
    },

    parseDurationMinutes(value, fieldName = '時間') {
      const text = String(value ?? '').trim();
      if (!text) return 0;
      const match = text.match(/^(\d+):([0-5]\d)$/);
      if (!match) throw new Error(`${fieldName}はH:MM形式で入力してください`);
      return Number(match[1]) * 60 + Number(match[2]);
    },

    paymentFromProfitRate(billing, profitRate) {
      const b = Number(billing);
      const rate = Number(profitRate);
      if (!Number.isFinite(b) || !Number.isFinite(rate)) return '';
      return String(Math.round(b * (1 - rate / 100)));
    },

    moneyValue(value) {
      const text = String(value ?? '').replace(/[，,\s]/g, '');
      if (!text) return 0;
      const amount = Number(text);
      return Number.isFinite(amount) ? Math.round(amount) : 0;
    },

    moneyInputValue(value) {
      const text = String(value ?? '').trim();
      if (!text) return '';
      return this.moneyValue(text).toLocaleString('ja-JP');
    },

    profitWarningClass(rate) {
      const threshold = Number(this.calculationSettings?.profit_warning_percent ?? DEFAULT_CALCULATION_SETTINGS.profit_warning_percent);
      return Number.isFinite(Number(rate)) && Number(rate) < threshold ? ' profit-below-threshold' : '';
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
      const legacyStandardMinutes = Number(extra.work_rules?.standard_minutes ?? 480);
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
        work_rules: {
          billing: {
            standard_minutes: Number(extra.work_rules?.billing?.standard_minutes ?? legacyStandardMinutes),
          },
          payment: {
            standard_minutes: Number(extra.work_rules?.payment?.standard_minutes ?? legacyStandardMinutes),
          },
        },
        night_rules: {
          billing: { ...defaultSide, ...(extra.night_rules?.billing || {}) },
          payment: { ...defaultSide, ...(extra.night_rules?.payment || {}) },
        },
        rounding: {
          billing: { ...defaultRounding, ...(extra.rounding?.billing || {}) },
          payment: { ...defaultRounding, ...(extra.rounding?.payment || {}) },
        },
        distance_rules: {
          billing: { mode: '', base_distance: 0, tier_mode: 'excess_distance', unit_price: 0, fixed_amount: 0, tiers: [], ...(extra.distance_rules?.billing || {}) },
          payment: { mode: '', base_distance: 0, tier_mode: 'excess_distance', unit_price: 0, fixed_amount: 0, tiers: [], ...(extra.distance_rules?.payment || {}) },
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
        const workRule = settings.work_rules[side];
        const distance = settings.distance_rules[side];
        return `<fieldset class="night-setting-card">
          <legend>${label}</legend>
          <label>日次基準時間
            <input id="standard-${side}-minutes" inputmode="numeric" placeholder="8:00" value="${this.ctx.escapeHtml(this.formatDurationMinutes(workRule.standard_minutes))}" />
          </label>
          <label>深夜帯（複数はカンマ区切り）
            <input id="night-${side}-periods" value="${this.ctx.escapeHtml(this.periodsText(rule.periods))}" placeholder="22:00-29:00" />
          </label>
          <label>深夜 <select id="night-${side}-mode">${modeOptions(rule.night_mode)}</select></label>
          <label>深夜超過 <select id="night-${side}-overtime-mode">${modeOptions(rule.night_overtime_mode)}</select></label>
          <label>時間丸め単位（分） <input id="round-${side}-unit" type="number" min="1" step="1" value="${this.ctx.escapeHtml(round.time_unit_minutes)}" /></label>
          <label>時間丸め <select id="round-${side}-time-mode">${roundingOptions(round.time_mode)}</select></label>
          <label>金額丸め <select id="round-${side}-amount-mode">${roundingOptions(round.amount_mode)}</select></label>
          <label>金額丸め段階 <select id="round-${side}-amount-stage">${amountStageOptions(round.amount_stage)}</select></label>
          <label>距離計算方式 <select id="distance-${side}-mode">
            <option value="" ${!distance.mode ? 'selected' : ''}>対象外</option>
            <option value="daily_excess" ${distance.mode === 'daily_excess' ? 'selected' : ''}>日次基準距離超過</option>
            <option value="monthly_excess" ${distance.mode === 'monthly_excess' ? 'selected' : ''}>月間累計基準距離超過</option>
            <option value="tiered" ${distance.mode === 'tiered' ? 'selected' : ''}>段階テーブル</option>
          </select></label>
          <label>基準距離（km） <input id="distance-${side}-base" type="number" min="0" step="1" value="${this.ctx.escapeHtml(distance.base_distance)}" /></label>
          <label>距離単価（円/km） <input id="distance-${side}-unit" type="number" step="0.01" value="${this.ctx.escapeHtml(distance.unit_price)}" /></label>
          <label>固定額（円） <input id="distance-${side}-fixed" type="number" step="0.01" value="${this.ctx.escapeHtml(distance.fixed_amount)}" /></label>
          <label>段階の計算方式 <select id="distance-${side}-tier-mode">
            <option value="fixed" ${distance.tier_mode === 'fixed' ? 'selected' : ''}>該当段階の固定額</option>
            <option value="all_distance" ${distance.tier_mode === 'all_distance' ? 'selected' : ''}>該当段階単価×全距離</option>
            <option value="excess_distance" ${(!distance.tier_mode || distance.tier_mode === 'excess_distance') ? 'selected' : ''}>該当段階単価×超過距離</option>
            <option value="progressive" ${distance.tier_mode === 'progressive' ? 'selected' : ''}>各段階内距離の累積</option>
          </select></label>
          <label class="full">段階JSON（上限なしはnull、例: [{"upper_distance":100,"unit_price":10},{"upper_distance":null,"unit_price":20}]）
            <textarea id="distance-${side}-tiers" rows="2">${this.ctx.escapeHtml(JSON.stringify(distance.tiers || []))}</textarea></label>
        </fieldset>`;
      };
      return `<div class="night-settings-grid">
        ${sideCard('billing', '請求側')}
        ${sideCard('payment', '支払側')}
      </div>`;
    },

    collectNightSettings() {
      const settings = this.detailState.nightSettings;
      for (const side of ['billing', 'payment']) {
        settings.work_rules[side] = {
          standard_minutes: this.parseDurationMinutes(
            document.getElementById(`standard-${side}-minutes`)?.value,
            '日次基準時間'
          ),
        };
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
        let tiers = [];
        const tiersText = document.getElementById(`distance-${side}-tiers`)?.value || '[]';
        try { tiers = JSON.parse(tiersText); } catch { throw new Error(`${side === 'billing' ? '請求' : '支払'}側の距離段階JSONが不正です`); }
        settings.distance_rules[side] = {
          mode: document.getElementById(`distance-${side}-mode`)?.value || '',
          base_distance: Math.max(0, Number(document.getElementById(`distance-${side}-base`)?.value || 0)),
          tier_mode: document.getElementById(`distance-${side}-tier-mode`)?.value || 'excess_distance',
          unit_price: Number(document.getElementById(`distance-${side}-unit`)?.value || 0),
          fixed_amount: Number(document.getElementById(`distance-${side}-fixed`)?.value || 0),
          tiers,
          rounding: { amount_mode: settings.rounding[side].amount_mode, amount_stage: settings.rounding[side].amount_stage },
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
      this.priceSets = data.price_sets || [];
      const table = window.LinksDataTable.renderTable({
        screenKey: 'price_sets',
        columns: [
          { key: 'price_set_no', label: 'No', getValue: (ps) => ps.price_set_no || ps.price_set_id },
          { key: 'price_set_name', label: '名称' },
          { key: 'company_name', label: '企業' },
          { key: 'link', label: '連携先', getValue: (ps) => this.linkLabel(ps) },
          { key: 'apply_start_date', label: '適用開始', getValue: (ps) => this.kit.dateValue(ps.apply_start_date) || '-' },
          { key: 'apply_end_date', label: '適用終了', getValue: (ps) => this.kit.dateValue(ps.apply_end_date) || '〜' },
          { key: 'line_count', label: '行数' },
        ],
        rows: this.priceSets,
        layout: this.layout,
        sortKey: this.listState.sortKey,
        sortOrder: this.listState.sortOrder,
        filters: this.listState.filters,
        escapeHtml: this.ctx.escapeHtml,
        rowKey: 'price_set_id',
        tableId: 'price-sets-table',
        renderActions: (ps) => `<div class="table-action-row">
              <button type="button" class="btn btn-ghost btn-small" data-edit="${ps.price_set_id}">編集</button>
              <button type="button" class="btn btn-ghost btn-small" data-copy="${ps.price_set_id}">コピー</button>
              <button type="button" class="btn btn-danger btn-small" data-del="${ps.price_set_id}">削除</button>
            </div>`,
      });
      this.ctx.app.innerHTML = this.kit.shell(
        '金額データ管理（仮組）',
        `<section class="panel">
          ${message ? `<p class="flash">${this.ctx.escapeHtml(message)}</p>` : ''}
          <div class="toolbar">
            <input id="q" type="text" placeholder="名称・企業で検索" value="${this.ctx.escapeHtml(this.q)}" />
            <button type="button" class="btn" id="search">検索</button>
            <button type="button" class="btn" id="new">＋ 新規</button>
          </div>
          <div id="price-sets-list-root">${table.html}</div>
        </section>`
      );
      this.kit.bindShell();
      window.LinksDataTable.bindTable('#price-sets-list-root', {
        onSort: (key) => {
          this.listState.sortOrder = this.listState.sortKey === key && this.listState.sortOrder === 'asc' ? 'desc' : 'asc';
          this.listState.sortKey = key;
          this.showList(message);
        },
        onFilter: (filters) => { this.listState.filters = filters; this.showList(message); },
        onActivate: (key) => { this.kit.pushNav(() => this.showList()); this.showDetail(Number(key)); },
      });
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
      const calcs = (item.calc_types || []).map((code) => ({ code, label: this.calcLabel(code) || code }));
      const headPts = pts.map((p) => this.ctx.escapeHtml(p.code_label || p.code_value)).join('</th><th>');
      const rows = calcs
        .map((calc) => {
          const cells = pts
            .map((p) => {
              const pt = p.code_value || p.value;
              if (pt === 'shortage' && calc.code === 'daily') {
                return '<td class="muted">時間単価で設定</td>';
              }
              const cell = item.matrix?.[calc.code]?.[pt] || Fee().emptyCell();
              return `
                <td class="fee-matrix-cell" data-item="${itemIdx}" data-calc="${calc.code}" data-pt="${pt}">
                  <div class="fee-matrix-pair">
                    <label>請求</label><span class="money-input-wrap"><span>￥</span><input class="money-input" inputmode="numeric" data-f="billing" value="${this.ctx.escapeHtml(this.moneyInputValue(cell.billing))}" /></span>
                    <label>支払</label><span class="money-input-wrap"><span>￥</span><input class="money-input" inputmode="numeric" data-f="payment" value="${this.ctx.escapeHtml(this.moneyInputValue(cell.payment))}" /></span>
                    <label>利益率</label><div class="fee-profit-input"><input class="${this.profitWarningClass(this.profitRateValue(cell.billing, cell.payment)).trim()}" type="number" min="0" max="100" step="0.1" data-f="profit" value="${this.ctx.escapeHtml(this.profitRateValue(cell.billing, cell.payment))}" /><span>%</span></div>
                  </div>
                </td>`;
            })
            .join('');
          const unsupported = ['daily', 'hourly', 'distance'].includes(calc.code) ? '' : '<small class="calc-unsupported">計算未対応</small>';
          return `<tr><th>${this.ctx.escapeHtml(calc.label)}${unsupported}</th>${cells}</tr>`;
        })
        .join('');
      return `
        <table class="data-table data-table-compact fee-matrix fee-matrix-wide">
          <thead><tr><th>計算</th><th>${headPts}</th></tr></thead>
          <tbody>${rows}</tbody>
        </table>`;
    },

    feeItemCardHtml(item, itemIdx) {
      const hasWeekdayCalc = (item.calc_types || []).some((calc) => calc !== 'distance');
      const weekdayChecks =
        !hasWeekdayCalc
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
        !hasWeekdayCalc
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
            <div class="fee-calc-types">${this.calculationTypeChecks(item, itemIdx)}</div>
            <div class="fee-weekdays">${weekdayChecks}${quick}</div>
            <div class="fee-item-actions">
              ${(item.calc_types || []).some((calc) => calc === 'daily' || calc === 'hourly') ? `<button type="button" class="btn btn-ghost btn-small" data-auto-calc-item="${itemIdx}">自動計算</button>` : ''}
              <button type="button" class="btn btn-ghost btn-small" data-dup-item="${itemIdx}">項目コピー</button>
              <button type="button" class="btn btn-danger btn-small" data-del-item="${itemIdx}">削除</button>
            </div>
          </div>
          <div class="form-grid form-grid-compact fee-summary-names">
            <div><label>請求摘要グループ名</label><input data-summary="billing" value="${this.ctx.escapeHtml(item.billing_summary_template||'{企業名} {料金名}')}" placeholder="例: {企業名} 平日料金"></div>
            <div><label>支払摘要グループ名</label><input data-summary="payment" value="${this.ctx.escapeHtml(item.payment_summary_template||'{パートナー名} {料金名}')}" placeholder="例: {パートナー名} 平日料金"></div>
          </div>
          <p class="error fee-auto-error">${this.ctx.escapeHtml(this.detailState.autoErrors?.[itemIdx] || '')}</p>
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
        item.billing_summary_template=card.querySelector('[data-summary="billing"]')?.value.trim()||'{企業名} {料金名}';
        item.payment_summary_template=card.querySelector('[data-summary="payment"]')?.value.trim()||'{パートナー名} {料金名}';
        if ((item.calc_types || []).some((calc) => calc !== 'distance')) {
          Fee().WEEKDAY_CODES.forEach((wd) => {
            const cb = card.querySelector(`input[data-wd="${wd}"]`);
            item.weekdays[wd] = cb ? cb.checked : false;
          });
        }
        card.querySelectorAll('.fee-matrix-cell').forEach((td) => {
            const calc = td.getAttribute('data-calc');
            const pt = td.getAttribute('data-pt');
            const billing = td.querySelector('[data-f="billing"]')?.value;
            const payment = td.querySelector('[data-f="payment"]')?.value;
            if (!item.matrix[calc]) item.matrix[calc] = {};
            if (!item.matrix[calc][pt]) item.matrix[calc][pt] = Fee().emptyCell();
            const cell = item.matrix[calc][pt];
            cell.billing = billing === '' ? '' : this.moneyValue(billing);
            cell.payment = payment === '' ? '' : this.moneyValue(payment);
        });
      });
      this.detailState.items = items;
    },

    setCalculatedValue(item, calc, priceType, side, amount) {
      const cell = item.matrix?.[calc]?.[priceType];
      if (cell) cell[side] = Math.round(amount);
    },

    autoCalculateFeeItem(itemIdx) {
      this.collectFeeItemsFromDom();
      const item = this.detailState.items?.[itemIdx];
      if (!item || item.mode === 'distance') return;
      const errors = [];
      const minutesBySide = {};
      for (const side of ['billing', 'payment']) {
        try {
          minutesBySide[side] = this.parseDurationMinutes(
            document.getElementById(`standard-${side}-minutes`)?.value,
            '日次基準時間'
          );
        } catch (error) {
          errors.push(error.message);
          continue;
        }
        if (minutesBySide[side] <= 0) errors.push(`${side === 'billing' ? '請求' : '支払'}の日次基準時間を入力してください`);
      }
      for (const side of ['billing', 'payment']) {
        const base = this.moneyValue(item.matrix?.daily?.basic?.[side]);
        if (base <= 0) errors.push(`${side === 'billing' ? '請求' : '支払'}の日額基本単価を入力してください`);
      }
      if (errors.length) {
        this.detailState.autoErrors[itemIdx] = [...new Set(errors)].join(' / ');
        this.refreshFeeItemsDom();
        return;
      }

      const multipliers = {
        overtime: Number(this.calculationSettings.overtime_multiplier),
        night: Number(this.calculationSettings.night_multiplier),
        night_overtime: Number(this.calculationSettings.night_overtime_multiplier),
      };
      for (const side of ['billing', 'payment']) {
        const dailyBasic = this.moneyValue(item.matrix?.daily?.basic?.[side]);
        const hourlyBasic = dailyBasic / (minutesBySide[side] / 60);
        this.setCalculatedValue(item, 'hourly', 'basic', side, hourlyBasic);
        this.setCalculatedValue(item, 'hourly', 'shortage', side, hourlyBasic);
        Object.entries(multipliers).forEach(([priceType, multiplier]) => {
          this.setCalculatedValue(item, 'daily', priceType, side, dailyBasic * multiplier);
          this.setCalculatedValue(item, 'hourly', priceType, side, hourlyBasic * multiplier);
        });
      }
      delete this.detailState.autoErrors[itemIdx];
      this.refreshFeeItemsDom();
    },

    updateProfitInput(cell) {
      const billing = cell.querySelector('[data-f="billing"]')?.value;
      const payment = cell.querySelector('[data-f="payment"]')?.value;
      const profit = cell.querySelector('[data-f="profit"]');
      if (!profit) return;
      const rate = this.profitRateValue(this.moneyValue(billing), this.moneyValue(payment));
      profit.value = rate;
      profit.classList.toggle('profit-below-threshold', this.profitWarningClass(rate).includes('profit-below-threshold'));
    },

    matrixTabOrder(row) {
      const cells = [...row.querySelectorAll('.fee-matrix-cell')];
      if (!cells.length) return [];
      return ['billing', 'payment', 'profit'].flatMap((field) =>
        cells.map((cell) => cell.querySelector(`[data-f="${field}"]`)).filter(Boolean)
      );
    },

    openAddFeeItemDialog() {
      this.collectFeeItemsFromDom();
      const choices = this.calculationTypeList().map((calc) => {
        const code = calc.code_value || calc.value;
        const checked = code === 'daily' || code === 'hourly' ? 'checked' : '';
        return `<label class="check-item"><input type="checkbox" name="new_calc_type" value="${this.ctx.escapeHtml(code)}" ${checked}><span>${this.ctx.escapeHtml(calc.code_label || calc.label || code)}</span></label>`;
      }).join('');
      document.body.insertAdjacentHTML('beforeend', this.kit.modalHtml(
        '料金項目を追加',
        `<form id="add-fee-item-form" class="form-grid">
          <label>料金名称<input name="name" required value="料金項目"></label>
          <fieldset class="full"><legend>計算種別（複数選択可）</legend><div class="fee-calc-types">${choices}</div></fieldset>
          <p class="error full" id="add-fee-item-error"></p>
        </form>`,
        '<button type="button" class="btn" id="confirm-add-fee-item">追加</button>'
      ));
      const close = this.kit.bindModal();
      document.getElementById('confirm-add-fee-item')?.addEventListener('click', () => {
        const form = document.getElementById('add-fee-item-form');
        const name = form.elements.name.value.trim();
        const calcTypes = [...form.querySelectorAll('[name="new_calc_type"]:checked')].map((input) => input.value);
        if (!name || !calcTypes.length) {
          document.getElementById('add-fee-item-error').textContent = '料金名称と計算種別を1つ以上指定してください';
          return;
        }
        const weekdays = Fee().emptyWeekdays();
        if (calcTypes.some((calc) => calc !== 'distance')) {
          weekdays.mon = weekdays.tue = weekdays.wed = weekdays.thu = weekdays.fri = true;
        }
        this.detailState.items.push(Fee().normalizeItem({ name, calc_types:calcTypes, weekdays }, Fee().defaultPriceTypeCodes(this.codes)));
        close();
        this.refreshFeeItemsDom();
      });
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
      document.querySelectorAll('[data-calc-type]').forEach((input) => input.addEventListener('change', () => {
        this.collectFeeItemsFromDom();
        const idx = Number(input.getAttribute('data-item'));
        const card = input.closest('[data-fee-item]');
        const selected = [...card.querySelectorAll('[data-calc-type]:checked')].map((item) => item.getAttribute('data-calc-type'));
        if (!selected.length) {
          input.checked = true;
          window.alert('計算種別を1つ以上選択してください');
          return;
        }
        this.detailState.items[idx] = Fee().normalizeItem({ ...this.detailState.items[idx], calc_types:selected }, Fee().defaultPriceTypeCodes(this.codes));
        this.refreshFeeItemsDom();
      }));
      document.querySelectorAll('[data-auto-calc-item]').forEach((btn) =>
        btn.addEventListener('click', () => this.autoCalculateFeeItem(Number(btn.getAttribute('data-auto-calc-item'))))
      );
      document.querySelectorAll('.fee-matrix input[data-f]:not([data-f="profit"])').forEach((inp) => {
        inp.addEventListener('input', () => {
          const cell = inp.closest('.fee-matrix-cell') || inp.closest('tr');
          this.updateProfitInput(cell);
        });
      });
      document.querySelectorAll('.money-input').forEach((inp) => {
        inp.addEventListener('input', () => {
          const cleaned = inp.value.replace(/[^0-9,，]/g, '');
          if (inp.value !== cleaned) inp.value = cleaned;
        });
        inp.addEventListener('blur', () => {
          inp.value = this.moneyInputValue(inp.value);
          this.updateProfitInput(inp.closest('.fee-matrix-cell') || inp.closest('tr'));
        });
      });
      document.querySelectorAll('.fee-matrix input[data-f="profit"]').forEach((inp) => {
        inp.addEventListener('input', () => {
          const cell = inp.closest('.fee-matrix-cell') || inp.closest('tr');
          const billing = cell.querySelector('[data-f="billing"]');
          const payment = cell.querySelector('[data-f="payment"]');
          if (!billing || !payment || billing.value === '') return;
          payment.value = this.moneyInputValue(this.paymentFromProfitRate(this.moneyValue(billing.value), inp.value));
          inp.classList.toggle('profit-below-threshold', this.profitWarningClass(inp.value).includes('profit-below-threshold'));
        });
      });
      document.querySelectorAll('.fee-matrix input[data-f]').forEach((inp) => {
        inp.addEventListener('keydown', (event) => {
          if (event.key !== 'Tab') return;
          const row = inp.closest('tr');
          const inputs = row ? this.matrixTabOrder(row) : [];
          const index = inputs.indexOf(inp);
          const target = inputs[index + (event.shiftKey ? -1 : 1)];
          if (!target) return;
          event.preventDefault();
          target.focus();
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
        autoErrors: {},
        nightSettings: this.normalizeNightSettings(row.extra_data),
        rowMeta: row,
      };

      this.ctx.app.innerHTML = this.kit.shell(
        id ? `金額データ編集（No.${id}）` : '金額データ新規',
        `<section class="panel">
          <p class="error" id="form-error"></p>
          <form id="ps-form">
            <div class="form-sections"><section class="form-section-card"><h3>基本情報・適用期間</h3><div class="form-grid form-grid-compact">
              <div><label>名称（必須）</label><input name="price_set_name" required value="${this.ctx.escapeHtml(row.price_set_name || '')}" /></div>
              <div><label>企業</label>${this.kit.searchSelectHtml('company_id', this.companies, 'company_id', 'company_name', row.company_id)}</div>
              <div><label>適用開始（必須）</label><input type="date" name="apply_start_date" required value="${this.ctx.escapeHtml(this.kit.dateValue(row.apply_start_date))}" /></div>
              <div><label>適用終了</label><input type="date" name="apply_end_date" value="${this.ctx.escapeHtml(this.kit.dateValue(row.apply_end_date))}" /></div>
              <div class="full"><label>備考</label><input name="note" value="${this.ctx.escapeHtml(row.note || '')}" /></div>
            </div></section>
            <section class="form-section-card">
            <div class="section-head"><h3 class="section-title">勤務・深夜・丸め条件</h3></div>
            ${this.nightSettingsHtml()}
            </section>
            <section class="form-section-card">
            ${id ? this.importBarHtml(id) : ''}
            <div class="section-head">
              <h3 class="section-title">料金項目（曜日 × 計算 × 種別）</h3>
              <button type="button" class="btn btn-ghost" id="add-fee-item">＋ 料金項目</button>
            </div>
            <div id="fee-items-area" class="fee-items-stack">${this.feeItemsAreaHtml()}</div>
            </section></div>
            <div class="btn-row form-actions-sticky">
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
          .fee-matrix .money-input { width: 9ch; min-width: 9ch; font-size: 1.15rem; font-variant-numeric: tabular-nums; text-align: right; }
          .fee-profit-input { display: flex; align-items: center; gap: 0.2rem; }
          .fee-profit-input input { max-width: 5rem; }
          .fee-profit-input input.profit-below-threshold { color: #b42318; border-color: #d92d20; background: #fef3f2; font-weight: 700; }
          .fee-auto-error { min-height: 1.2rem; margin: 0.25rem 0; }
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
      this.kit.bindSearchSelects(document.getElementById('ps-form'));
      this.bindFeeItemsArea();

      document.getElementById('add-fee-item')?.addEventListener('click', () => this.openAddFeeItemDialog());

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
          for (const item of this.detailState.items || []) {
            if (!(item.calc_types || []).length) throw new Error(`${item.name || '料金項目'}の計算種別を1つ以上選択してください`);
            if ((item.calc_types || []).some((calc) => calc !== 'distance') && !Fee().WEEKDAY_CODES.some((weekday) => item.weekdays?.[weekday])) {
              throw new Error(`${item.name || '料金項目'}の曜日を1つ以上選択してください`);
            }
          }
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
          work_rules: nightSettings.work_rules,
          distance_rules: nightSettings.distance_rules,
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
