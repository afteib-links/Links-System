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
      this.ctx.renderLoading();
      this.codes = await this.kit.loadCodes();
      this.calculationSettings = await this.loadCalculationSettings();
      const companies = await this.ctx.api('/api/lookups/companies');
      this.companies = companies.data?.companies || [];
      this.q = '';
      this.listState = { sortKey: 'revision_code', sortOrder: 'asc', filters: {} };
      this.layout = await this.kit.loadAreaLayout('price_sets');
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

    displayRevisionCode(row) {
      return row.series_code
        ? `${row.series_code}-R${String(row.revision_no || 1).padStart(3, '0')}`
        : row.price_set_no || row.price_set_id;
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
          <label class="night-field-standard">日次基準時間
            <input id="standard-${side}-minutes" inputmode="numeric" placeholder="8:00" value="${this.ctx.escapeHtml(this.formatDurationMinutes(workRule.standard_minutes))}" />
          </label>
          <label class="night-field-period">深夜帯（複数はカンマ区切り）
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
          <label class="night-field-tiers">段階JSON（上限なしはnull）
            <textarea id="distance-${side}-tiers" rows="1" title='例: [{"upper_distance":100,"unit_price":10},{"upper_distance":null,"unit_price":20}]'>${this.ctx.escapeHtml(JSON.stringify(distance.tiers || []))}</textarea></label>
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
          { key: 'revision_code', label: '料金コード', getValue: (ps) => this.displayRevisionCode(ps) },
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
        '金額データ管理',
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

    isAdmin() {
      return Array.isArray(this.ctx.currentUser?.roles) && this.ctx.currentUser.roles.includes('admin');
    },

    feeTypeOptions(selected) {
      const master = this.codes?.fee_item_type || Fee().ITEM_TYPES.map(([code, label]) => ({ code_value: code, code_label: label }));
      return master.map((type) => {
        const code = type.code_value || type.value;
        return `<option value="${this.ctx.escapeHtml(code)}" ${code === selected ? 'selected' : ''}>${this.ctx.escapeHtml(type.code_label || type.label || code)}</option>`;
      }).join('');
    },

    feeRuleRowHtml(row, itemIdx, rowIdx) {
      const admin = this.isAdmin();
      const ruleBadge = row.rule_state === 'draft'
        ? `<span class="status-badge status-warning" title="${this.ctx.escapeHtml((row.undefined_variables || []).join(', '))}">下書き</span>`
        : (!admin && row.has_admin_rule ? '<span class="status-badge">管理者設定済み</span>' : '');
      const adminRules = admin ? `
        <div class="fee-rule-admin" data-rule-panel="${itemIdx}:${rowIdx}" hidden>
          <label>適用条件<input data-row-f="condition_expression" value="${this.ctx.escapeHtml(row.condition_expression || '')}" placeholder="例: total_distance > 100 AND work_minutes >= 480"></label>
          <label>請求計算式<input data-row-f="billing_expression" value="${this.ctx.escapeHtml(row.billing_expression || '')}" placeholder="空欄なら請求額を使用"></label>
          <label>支払計算式<input data-row-f="payment_expression" value="${this.ctx.escapeHtml(row.payment_expression || '')}" placeholder="空欄なら支払額を使用"></label>
        </div>` : '';
      const ruleButton = admin
        ? `<button type="button" class="fee-rule-toggle" data-toggle-rule="${itemIdx}:${rowIdx}" aria-expanded="false">適用条件</button>`
        : `<button type="button" class="fee-rule-toggle" disabled>${row.has_admin_rule ? '管理者設定済み' : '適用条件'}</button>`;
      return `
        <div class="fee-rule-row" data-fee-row="${rowIdx}">
          <div class="fee-rule-main">
            <div class="fee-row-actions">
              <button type="button" title="行追加" data-add-row="${itemIdx}:${rowIdx}">＋</button>
              <button type="button" title="行削除" data-del-row="${itemIdx}:${rowIdx}">×</button>
              <button type="button" title="上へ" data-up-row="${itemIdx}:${rowIdx}">▲</button>
              <button type="button" title="下へ" data-down-row="${itemIdx}:${rowIdx}">▼</button>
            </div>
            <input data-row-f="item_name" value="${this.ctx.escapeHtml(row.item_name || '')}" placeholder="料金項目名">
            <select data-row-f="item_type">${this.feeTypeOptions(row.item_type)}</select>
            <span class="money-input-wrap"><span>￥</span><input class="money-input" inputmode="numeric" data-row-f="billing" value="${this.ctx.escapeHtml(this.moneyInputValue(row.billing))}"></span>
            <span class="money-input-wrap"><span>￥</span><input class="money-input" inputmode="numeric" data-row-f="payment" value="${this.ctx.escapeHtml(this.moneyInputValue(row.payment))}"></span>
            <div class="fee-profit-input"><input class="${this.profitWarningClass(this.profitRateValue(row.billing, row.payment)).trim()}" type="number" min="0" max="100" step="0.1" data-row-f="profit" value="${this.ctx.escapeHtml(this.profitRateValue(row.billing, row.payment))}"><span>%</span>${ruleBadge}</div>
            <input data-row-f="billing_detail_name" value="${this.ctx.escapeHtml(row.billing_detail_name || '')}" placeholder="請求詳細名">
            <input data-row-f="payment_detail_name" value="${this.ctx.escapeHtml(row.payment_detail_name || '')}" placeholder="支払詳細名">
            ${ruleButton}
          </div>
          ${adminRules}
        </div>`;
    },

    feeItemCardHtml(item, itemIdx) {
      const weekdayChecks = Fee().WEEKDAY_CODES.map((wd) => `
        <label class="weekday-chip weekday-${wd} ${item.weekdays?.[wd] ? 'is-selected' : ''}">
          <input type="checkbox" data-wd="${wd}" ${item.weekdays?.[wd] ? 'checked' : ''}>
          <span>${this.weekdayLabel(wd)}</span>
        </label>`).join('');
      const rows = (item.rows || []).map((row, rowIdx) => this.feeRuleRowHtml(row, itemIdx, rowIdx)).join('');
      return `
        <article class="fee-item-card panel" data-fee-item="${itemIdx}">
          <div class="fee-item-head">
            <input type="text" class="fee-item-name" data-item="${itemIdx}" value="${this.ctx.escapeHtml(item.name || '')}" placeholder="料金項目名" />
            <div class="fee-weekdays">${weekdayChecks}</div>
            <div class="fee-item-actions">
              <button type="button" class="btn btn-ghost btn-small" data-up-item="${itemIdx}" title="優先順位を上げる">▲</button>
              <button type="button" class="btn btn-ghost btn-small" data-down-item="${itemIdx}" title="優先順位を下げる">▼</button>
              <button type="button" class="btn btn-ghost btn-small" data-dup-item="${itemIdx}">項目コピー</button>
              <button type="button" class="btn btn-danger btn-small" data-del-item="${itemIdx}">削除</button>
            </div>
          </div>
          <div class="fee-rule-scroll">
            <div class="fee-rule-grid-head"><span>操作</span><span>料金項目名</span><span>項目種別</span><span>請求額</span><span>支払額</span><span>利益率</span><span>請求詳細名</span><span>支払詳細名</span><span>条件</span></div>
            ${rows || '<p class="hint">料金行がありません。</p>'}
          </div>
        </article>`;
    },

    feeItemsAreaHtml() {
      const cards = (this.detailState.items || [])
        .map((item, idx) => this.feeItemCardHtml(item, idx))
        .join('');
      return cards || '<p class="hint">料金項目がありません。「＋ 料金項目」で追加してください。</p>';
    },

    feeCoverageWarningHtml() {
      const labels = [];
      const items = this.detailState.items || [];
      Fee().WEEKDAY_CODES.filter((code) => code !== 'all').forEach((code) => {
        const matches = items.filter((item) => item.weekdays?.all || item.weekdays?.[code]);
        if (matches.length > 1) labels.push(this.weekdayLabel(code));
      });
      if (!labels.length) return '<p class="hint">一致したカードを上から優先して適用します。</p>';
      return `<p class="warning">${this.ctx.escapeHtml([...new Set(labels)].join('・'))} は複数カードに一致します。上のカードを優先します。</p>`;
    },

    importBarHtml(currentId) {
      const others = (this.importCandidates || []).filter((ps) => Number(ps.price_set_id) !== Number(currentId));
      if (!others.length) {
        return '<p class="hint">他セットから取込: 取込可能な金額データがありません。</p>';
      }
      const opts = others
        .map(
          (ps) =>
            `<option value="${ps.price_set_id}">${this.ctx.escapeHtml(this.displayRevisionCode(ps))} — ${this.ctx.escapeHtml(ps.price_set_name)}</option>`
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
        Fee().WEEKDAY_CODES.forEach((wd) => {
          const cb = card.querySelector(`input[data-wd="${wd}"]`);
          item.weekdays[wd] = cb ? cb.checked : false;
        });
        item.rows = [...card.querySelectorAll('[data-fee-row]')].map((rowEl, rowIdx) => {
          const before = item.rows?.[rowIdx] || Fee().blankRuleRow();
          const val = (field) => rowEl.querySelector(`[data-row-f="${field}"]`)?.value ?? before[field] ?? '';
          return Fee().normalizeRuleRow({
            ...before,
            item_name: val('item_name').trim(), item_type: val('item_type'),
            billing: val('billing') === '' ? '' : this.moneyValue(val('billing')),
            payment: val('payment') === '' ? '' : this.moneyValue(val('payment')),
            billing_detail_name: val('billing_detail_name').trim(), payment_detail_name: val('payment_detail_name').trim(),
            condition_expression: val('condition_expression').trim(), billing_expression: val('billing_expression').trim(),
            payment_expression: val('payment_expression').trim(), sort_order: (rowIdx + 1) * 10,
          }, rowIdx);
        });
        item.sort_order = (itemIdx + 1) * 10;
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
      const billing = cell.querySelector('[data-row-f="billing"],[data-f="billing"]')?.value;
      const payment = cell.querySelector('[data-row-f="payment"],[data-f="payment"]')?.value;
      const profit = cell.querySelector('[data-row-f="profit"],[data-f="profit"]');
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
      document.body.insertAdjacentHTML('beforeend', this.kit.modalHtml(
        '料金カードを追加',
        `<form id="add-fee-item-form" class="form-grid">
          <label>カード名<input name="name" required value="料金カード"></label>
          <p class="error full" id="add-fee-item-error"></p>
        </form>`,
        '<button type="button" class="btn" id="confirm-add-fee-item">追加</button>'
      ));
      const close = this.kit.bindModal();
      document.getElementById('confirm-add-fee-item')?.addEventListener('click', () => {
        const form = document.getElementById('add-fee-item-form');
        const name = form.elements.name.value.trim();
        if (!name) {
          document.getElementById('add-fee-item-error').textContent = 'カード名を入力してください';
          return;
        }
        const weekdays = Fee().emptyWeekdays();
        weekdays.mon = weekdays.tue = weekdays.wed = weekdays.thu = weekdays.fri = true;
        this.detailState.items.push(Fee().ensureRowsModel({ name, weekdays, rows: [Fee().blankRuleRow('基本料金')] }, this.detailState.items.length));
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
      document.querySelectorAll('[data-up-item],[data-down-item]').forEach((btn) => btn.addEventListener('click', () => {
        this.collectFeeItemsFromDom();
        const attr = btn.hasAttribute('data-up-item') ? 'data-up-item' : 'data-down-item';
        const idx = Number(btn.getAttribute(attr));
        const target = idx + (attr === 'data-up-item' ? -1 : 1);
        if (target < 0 || target >= this.detailState.items.length) return;
        [this.detailState.items[idx], this.detailState.items[target]] = [this.detailState.items[target], this.detailState.items[idx]];
        this.refreshFeeItemsDom();
      }));
      document.querySelectorAll('[data-add-row],[data-del-row],[data-up-row],[data-down-row]').forEach((btn) => btn.addEventListener('click', () => {
        this.collectFeeItemsFromDom();
        const attr = ['data-add-row', 'data-del-row', 'data-up-row', 'data-down-row'].find((name) => btn.hasAttribute(name));
        const [itemIdx, rowIdx] = btn.getAttribute(attr).split(':').map(Number);
        const rows = this.detailState.items[itemIdx].rows;
        if (attr === 'data-add-row') rows.splice(rowIdx + 1, 0, Fee().blankRuleRow('料金項目'));
        if (attr === 'data-del-row' && rows.length > 1) rows.splice(rowIdx, 1);
        const target = rowIdx + (attr === 'data-up-row' ? -1 : attr === 'data-down-row' ? 1 : 0);
        if ((attr === 'data-up-row' || attr === 'data-down-row') && target >= 0 && target < rows.length) {
          [rows[rowIdx], rows[target]] = [rows[target], rows[rowIdx]];
        }
        this.refreshFeeItemsDom();
      }));
      document.querySelectorAll('.weekday-chip input').forEach((input) => input.addEventListener('change', () => {
        const card = input.closest('[data-fee-item]');
        if (input.dataset.wd === 'all' && input.checked) {
          card.querySelectorAll('.weekday-chip input:not([data-wd="all"])').forEach((box) => { box.checked = false; });
        } else if (input.checked) {
          const all = card.querySelector('[data-wd="all"]');
          if (all) all.checked = false;
        }
        card.querySelectorAll('.weekday-chip').forEach((chip) => chip.classList.toggle('is-selected', chip.querySelector('input').checked));
      }));
      document.querySelectorAll('[data-toggle-rule]').forEach((button) => button.addEventListener('click', () => {
        const panel = document.querySelector(`[data-rule-panel="${button.getAttribute('data-toggle-rule')}"]`);
        if (!panel) return;
        const opening = panel.hidden;
        panel.hidden = !opening;
        button.setAttribute('aria-expanded', opening ? 'true' : 'false');
        button.textContent = opening ? '条件を閉じる' : '適用条件';
      }));
      document.querySelectorAll('.fee-rule-row input[data-row-f="billing"],.fee-rule-row input[data-row-f="payment"]').forEach((inp) => {
        inp.addEventListener('input', () => {
          const cell = inp.closest('.fee-rule-row');
          this.updateProfitInput(cell);
        });
      });
      document.querySelectorAll('.fee-rule-row .money-input').forEach((inp) => {
        inp.addEventListener('input', () => {
          const cleaned = inp.value.replace(/[^0-9,，]/g, '');
          if (inp.value !== cleaned) inp.value = cleaned;
        });
        inp.addEventListener('blur', () => {
          inp.value = this.moneyInputValue(inp.value);
          this.updateProfitInput(inp.closest('.fee-rule-row'));
        });
      });
      document.querySelectorAll('.fee-rule-row input[data-row-f="profit"]').forEach((inp) => {
        inp.addEventListener('input', () => {
          const cell = inp.closest('.fee-rule-row');
          const billing = cell.querySelector('[data-row-f="billing"]');
          const payment = cell.querySelector('[data-row-f="payment"]');
          if (!billing || !payment || billing.value === '') return;
          payment.value = this.moneyInputValue(this.paymentFromProfitRate(this.moneyValue(billing.value), inp.value));
          inp.classList.toggle('profit-below-threshold', this.profitWarningClass(inp.value).includes('profit-below-threshold'));
        });
      });
    },

    refreshFeeItemsDom() {
      const area = document.getElementById('fee-items-area');
      if (area) area.innerHTML = this.feeItemsAreaHtml();
      const warning = document.getElementById('fee-coverage-warning');
      if (warning) warning.innerHTML = this.feeCoverageWarningHtml();
      this.bindFeeItemsArea();
    },

    async loadImportCandidates(row) {
      const params = new URLSearchParams();
      if (row.base_project_id) params.set('base_project_id', row.base_project_id);
      if (row.project_id) params.set('project_id', row.project_id);
      const { res, data } = await this.ctx.api(`/api/price-sets?${params}`);
      this.importCandidates = res.ok && data?.ok ? data.price_sets || [] : [];
    },

    async createRevision(row) {
      const applyStart = await this.promptApplyStartDate();
      if (!applyStart) return;
      const reason = window.prompt('料金改定理由（必須）', '料金改定')?.trim();
      if (!reason) return;
      const result = await this.ctx.api(`/api/price-sets/${row.price_set_id}/revise`, {
        method: 'POST', body: JSON.stringify({ apply_start_date: applyStart, reason }),
      });
      if (!result.res.ok || !result.data?.ok) return window.alert(result.data?.message || '料金改定の作成に失敗しました');
      await this.showDetail(result.data.price_set.price_set_id);
    },

    async propagateRevision(row) {
      const preview = await this.ctx.api(`/api/price-sets/${row.price_set_id}/propagation-preview`);
      if (!preview.res.ok || !preview.data?.ok) return window.alert(preview.data?.message || '反映候補の取得に失敗しました');
      const candidates = (preview.data.targets || []).filter((target) => target.can_apply);
      if (!candidates.length) return window.alert('反映できる個別案件がありません');
      if (!window.confirm(`${candidates.length}件の個別案件が反映候補です。対象を選択しますか？`)) return;
      const selected = candidates.filter((target) => window.confirm(
        `${target.series_code}（案件 No.${target.project_id}${target.manager_name ? ` / ${target.manager_name}` : ''}）を反映対象に含めますか？`
      ));
      if (!selected.length) return window.alert('反映対象が選択されませんでした');
      const targets = selected.map((target) => {
        const resolutions = {};
        (target.conflicts || []).forEach((conflict) => {
          resolutions[conflict.path] = window.confirm(
            `${target.series_code}\n「${conflict.path}」は基本案件と個別案件の両方で変更されています。\nOK: 基本案件を採用 / キャンセル: 個別案件を維持`
          ) ? 'base' : 'individual';
        });
        return { price_series_id: target.price_series_id, resolutions };
      });
      const reason = window.prompt('反映理由（必須）', `基本料金 ${row.revision_code} の反映`)?.trim();
      if (!reason) return;
      const result = await this.ctx.api(`/api/price-sets/${row.price_set_id}/propagate`, {
        method: 'POST', body: JSON.stringify({ targets, reason }),
      });
      if (!result.res.ok || !result.data?.ok) return window.alert(result.data?.message || '個別案件への反映に失敗しました');
      window.alert(`${result.data.created.length}件の新しい改定版を作成しました`);
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
      let revisions = [];
      if (id) {
        const history = await this.ctx.api(`/api/price-sets/${id}/revisions`);
        revisions = history.res.ok && history.data?.ok ? history.data.revisions || [] : [];
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
        revisions,
      };

      const revisionIndex = revisions.findIndex((revision) => Number(revision.price_set_id) === Number(id));
      const revisionToolbar = id ? `<div class="fee-revision-toolbar">
        <strong>${this.ctx.escapeHtml(row.revision_code || row.price_set_no || '')}</strong>
        <span>改定 ${row.revision_no || 1}/${revisions.length || 1}</span>
        <button type="button" class="btn btn-ghost btn-small" id="prev-revision" ${revisionIndex <= 0 ? 'disabled' : ''}>← 前版</button>
        <button type="button" class="btn btn-ghost btn-small" id="next-revision" ${revisionIndex < 0 || revisionIndex >= revisions.length - 1 ? 'disabled' : ''}>次版 →</button>
        ${Number(row.is_current_revision) ? '<button type="button" class="btn btn-small" id="create-revision">料金改定</button>' : '<span class="status-badge">履歴版</span>'}
        ${Number(row.is_current_revision) && row.base_project_id && !row.project_id ? '<button type="button" class="btn btn-ghost btn-small" id="propagate-revision">個別案件へ反映</button>' : ''}
      </div>` : '';

      this.ctx.app.innerHTML = this.kit.shell(
        id ? `金額データ編集（No.${id}）` : '金額データ新規',
        `${revisionToolbar}<section class="panel price-set-editor">
          <p class="error" id="form-error"></p>
          <form id="ps-form">
            <div class="form-sections"><section class="form-section-card price-set-basic-card"><div class="price-set-basic-grid">
              <div><label>適用開始（必須）</label><input type="date" name="apply_start_date" required value="${this.ctx.escapeHtml(this.kit.dateValue(row.apply_start_date))}" /></div>
              <div><label>適用終了</label><input type="date" name="apply_end_date" value="${this.ctx.escapeHtml(this.kit.dateValue(row.apply_end_date))}" /></div>
              <div><label>企業</label>${this.kit.searchSelectHtml('company_id', this.companies, 'company_id', 'company_name', row.company_id)}</div>
              <div><label>名称（必須）</label><input name="price_set_name" required value="${this.ctx.escapeHtml(row.price_set_name || '')}" /></div>
            </div></section>
            <section class="form-section-card price-set-night-card">
            <div class="section-head"><h3 class="section-title">勤務・深夜・丸め条件</h3></div>
            ${this.nightSettingsHtml()}
            </section>
            <section class="form-section-card price-set-fee-card">
            ${id ? this.importBarHtml(id) : ''}
            <div class="section-head">
              <h3 class="section-title">料金カード（上から優先）</h3>
              <button type="button" class="btn btn-ghost" id="add-fee-item">＋ 料金カード</button>
            </div>
            <div id="fee-coverage-warning">${this.feeCoverageWarningHtml()}</div>
            <p class="hint">請求詳細名・支払詳細名は保存のみです。帳票への反映は後続作業で行います。</p>
            <div id="fee-items-area" class="fee-items-stack">${this.feeItemsAreaHtml()}</div>
            </section>
            <section class="form-section-card price-set-note-card"><label>備考<input name="note" value="${this.ctx.escapeHtml(row.note || '')}" /></label></section></div>
            <div class="btn-row form-actions-sticky">
              <button class="btn" type="submit">保存</button>
              ${id ? '<button type="button" class="btn btn-ghost" id="copy-revision">コピーして改定</button>' : ''}
              <button class="btn btn-ghost" type="button" id="cancel">一覧へ</button>
            </div>
          </form>
        </section>
        <style>
          .price-set-basic-grid { display:grid; grid-template-columns:160px 160px minmax(220px,1fr) minmax(240px,1.15fr); gap:10px; align-items:end; }
          .price-set-basic-grid label, .price-set-note-card label { display:flex; flex-direction:column; gap:4px; font-weight:700; }
          .price-set-basic-grid input, .price-set-basic-grid select, .price-set-note-card input { width:100%; margin:0; }
          .fee-items-stack { display:grid; grid-template-columns:repeat(3,minmax(0,1fr)); gap:0.65rem; margin-top:0.5rem; }
          .fee-item-card { border:1px solid var(--border,#ccc); padding:0.65rem !important; border-radius:7px; box-shadow:0 1px 2px rgba(16,24,40,.05); }
          .fee-item-head { display:grid !important; grid-template-columns:minmax(120px,1fr) auto !important; gap:0.45rem !important; align-items:center; margin-bottom:0.45rem !important; }
          .fee-item-name { flex: 1; font-weight: 600; }
          .fee-weekdays { grid-column:1/-1; display:grid; grid-template-columns:repeat(5,minmax(0,1fr)); gap:5px; width:100%; }
          .weekday-chip { display:flex; justify-content:center; min-height:34px; padding:5px 3px; border-radius:6px; font-size:0.9rem; }
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
          .price-set-night-card { padding:10px 16px !important; }
          .price-set-night-card > h3 { margin:0 0 5px; }
          .night-settings-grid { display:grid; grid-template-columns:repeat(2,minmax(0,1fr)); gap:0.55rem; margin-bottom:0; }
          .night-setting-card { display:grid; grid-template-columns:repeat(4,minmax(0,1fr)); gap:5px 6px; border:1px solid var(--border,#ccc); padding:6px 8px 8px; }
          .night-setting-card label { display:flex; flex-direction:column; gap:2px; min-width:0; font-size:11px; }
          .night-setting-card input, .night-setting-card select, .night-setting-card textarea { width:100%; min-width:0; min-height:30px; padding:4px 6px; }
          .night-setting-card .night-field-standard { max-width:4.5rem; }
          .night-setting-card .night-field-period { grid-column:span 2; }
          .night-setting-card .night-field-tiers { grid-column:span 2; }
          .hint { color: var(--muted, #666); font-size: 0.9rem; }
          @media (max-width: 1100px) { .fee-items-stack { grid-template-columns: repeat(2, minmax(0, 1fr)); } }
          @media (max-width: 900px) { .price-set-basic-grid { grid-template-columns:repeat(2,minmax(0,1fr)); } }
          @media (max-width: 900px) { .night-settings-grid { grid-template-columns: 1fr; } }
          @media (max-width: 680px) { .fee-items-stack,.price-set-basic-grid { grid-template-columns:1fr; } .night-setting-card { grid-template-columns:repeat(2,minmax(0,1fr)); } .night-setting-card .night-field-tiers { grid-column:1/-1; } }
        </style>`,
        { onBack: () => this.showList() }
      );
      this.kit.bindShell({ onBack: () => this.showList() });
      this.kit.bindSearchSelects(document.getElementById('ps-form'));
      this.bindFeeItemsArea();

      document.getElementById('prev-revision')?.addEventListener('click', () => this.showDetail(revisions[revisionIndex - 1].price_set_id));
      document.getElementById('next-revision')?.addEventListener('click', () => this.showDetail(revisions[revisionIndex + 1].price_set_id));
      document.getElementById('create-revision')?.addEventListener('click', () => this.createRevision(row));
      document.getElementById('propagate-revision')?.addEventListener('click', () => this.propagateRevision(row));

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
            if (!(item.rows || []).length) throw new Error(`${item.name || '料金カード'}の料金行を1つ以上設定してください`);
            if (!Fee().WEEKDAY_CODES.some((weekday) => item.weekdays?.[weekday])) {
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
          schema: 'fee_items_v2',
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
        let historicalReason = '';
        if (id && !Number(row.is_current_revision)) {
          const reason = window.prompt('過去の改定版を修正する理由（必須）')?.trim();
          if (!reason) return;
          payload.revision_reason = reason;
          historicalReason = reason;
        }
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
        if (historicalReason) {
          const impact = await this.ctx.api(`/api/price-sets/${id}/unconfirmed-impact`);
          const count = impact.res.ok && impact.data?.ok ? Number(impact.data.recalculable_count || 0) : 0;
          if (count && window.confirm(`未確定・未締めの日報が${count}件あります。新しい料金で再計算しますか？`)) {
            const recalculated = await this.ctx.api(`/api/price-sets/${id}/recalculate-unconfirmed`, {
              method: 'POST', body: JSON.stringify({ reason: historicalReason }),
            });
            if (!recalculated.res.ok || !recalculated.data?.ok) {
              window.alert(recalculated.data?.message || '日報の再計算に失敗しました');
              return;
            }
          }
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
