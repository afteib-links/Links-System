(() => {
  const LinksDailyReports = {
    async open(ctx) {
      this.kit = window.LinksFeatureKit.createFeatureKit(ctx);
      this.ctx = ctx;
      this.ym = this.kit.currentYearMonth();
      await this.showMonthList();
    },

    shiftMonth(delta) {
      const [y, m] = this.ym.split('-').map(Number);
      const d = new Date(y, m - 1 + delta, 1);
      this.ym = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    },

    statusLabel(s) {
      return (
        {
          draft: '下書き',
          confirmed: '確認済み',
          approved: '月次承認済み',
          rejected: '差戻し',
        }[s] || s || '-'
      );
    },

    parseJson(raw, fallback = {}) {
      if (!raw) return fallback;
      if (typeof raw === 'object') return raw;
      try {
        return JSON.parse(raw);
      } catch {
        return fallback;
      }
    },

    formatMinutes(value) {
      if (value == null || value === '') return '';
      const minutes = Math.round(Number(value));
      if (!Number.isFinite(minutes)) return '';
      const sign = minutes < 0 ? '-' : '';
      const abs = Math.abs(minutes);
      return `${sign}${Math.floor(abs / 60)}:${String(abs % 60).padStart(2, '0')}`;
    },

    parseMinutesInput(value, signed = false) {
      const text = String(value || '').trim();
      if (!text) return 0;
      const match = text.match(signed ? /^(-?)(\d{1,3}):(\d{2})$/ : /^(\d{1,3}):(\d{2})$/);
      if (!match) throw new Error('時間はH:MM形式で入力してください');
      const sign = signed && match[1] === '-' ? -1 : 1;
      const hour = Number(match[signed ? 2 : 1]);
      const minute = Number(match[signed ? 3 : 2]);
      if (minute > 59) throw new Error('分は00～59で入力してください');
      return sign * (hour * 60 + minute);
    },

    parseClockInput(value) {
      const minutes = this.parseMinutesInput(value);
      if (minutes > 47 * 60 + 59) throw new Error('開始・終了時刻は47:59までで入力してください');
      return minutes;
    },

    formatClockMinutes(value) {
      const minutes = Math.max(0, Math.min(47 * 60 + 59, Math.round(Number(value) || 0)));
      return `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;
    },

    normalizeTimeText(value, duration = false) {
      const text = String(value ?? '').normalize('NFKC').trim();
      if (!text) return '';
      const normalized = /^\d{1,2}$/.test(text) ? `${text}:00` : text.replace('.', ':');
      const minutes = duration ? this.parseMinutesInput(normalized) : this.parseClockInput(normalized);
      return duration ? this.formatMinutes(minutes) : this.formatClockMinutes(minutes);
    },

    inputTimeStep(row) {
      const billing = Number(row?._calcContext?.rounding?.billing?.time_unit_minutes);
      const payment = Number(row?._calcContext?.rounding?.payment?.time_unit_minutes);
      if (Number.isInteger(billing) && billing > 0) return billing;
      if (Number.isInteger(payment) && payment > 0) return payment;
      const fallback = Number(this.dailyReportUiSettings?.fallback_time_step_minutes);
      return Number.isInteger(fallback) && fallback > 0 ? fallback : 5;
    },

    durationInput(row, minuteField, decimalField = null) {
      if (row[minuteField] != null && row[minuteField] !== '') return this.formatMinutes(row[minuteField]);
      if (decimalField && row[decimalField] != null && row[decimalField] !== '') {
        return this.formatMinutes(Number(row[decimalField]) * 60);
      }
      return '0:00';
    },

    rowCalculation(row) {
      return this.parseJson(row.calculation_detail, {});
    },

    rateForItem(item, priceType, side) {
      const preferred = priceType === 'basic'
        ? ['daily', 'hourly']
        : priceType === 'shortage'
          ? ['hourly']
          : ['hourly', 'daily'];
      for (const calcType of preferred) {
        const value = item?.matrix?.[calcType]?.[priceType]?.[side];
        if (value !== '' && value != null && Number.isFinite(Number(value))) {
          return { rate: Number(value), calc_type: calcType };
        }
      }
      return { rate: 0, calc_type: preferred[0] };
    },

    rateInfo(row, side, priceType) {
      const detail = this.rowCalculation(row);
      const calculated = detail?.[side]?.amounts?.details?.[priceType];
      if (calculated) return calculated;
      return this.rateForItem(row._calcContext?.fee_item, priceType, side);
    },

    async ensureContext(idx, force = false) {
      const row = this.gridRows[idx];
      if (!row || (row._calcContext && !force)) return;
      const params = new URLSearchParams({
        project_id: row.project_id || this.gridMeta.project_id,
        work_date: this.kit.dateValue(row.work_date),
        is_training: row.is_training ? '1' : '0',
      });
      if (row.fee_item_selection_source === 'manual' && row.selected_fee_item_id) {
        params.set('selected_fee_item_id', row.selected_fee_item_id);
      }
      const result = await this.ctx.api(`/api/daily-reports/calculation-context?${params}`);
      row._calcContext = result.res.ok && result.data?.ok ? result.data.context : null;
    },

    weekdayLabel(dateStr) {
      const s = this.kit.dateValue(dateStr);
      if (!s || s.length < 10) return '';
      const d = new Date(`${s}T00:00:00`);
      if (Number.isNaN(d.getTime())) return '';
      return ['日', '月', '火', '水', '木', '金', '土'][d.getDay()];
    },

    formatDateWithWeekday(dateStr) {
      const s = this.kit.dateValue(dateStr);
      if (!s || s.length < 10) return s || '';
      const w = this.weekdayLabel(s);
      const md = `${Number(s.slice(5, 7))}/${Number(s.slice(8, 10))}`;
      return w ? `${md}（${w}）` : md;
    },

    dayRowClass(dateStr) {
      const date = this.kit.dateValue(dateStr);
      if (this.dailyReportHolidayDates?.has(date) || this.weekdayLabel(date) === '日') return 'dr-holiday-row';
      if (this.weekdayLabel(date) === '土') return 'dr-saturday-row';
      return '';
    },

    rowEffectiveAmount(row, side) {
      const effective = row[`effective_${side}_amount`];
      if (effective !== '' && effective != null) return Number(effective || 0);
      const override = row[`override_${side}_amount`];
      if (override !== '' && override != null) return Number(override || 0);
      return Number(row[`calculated_${side}_amount`] || 0);
    },

    dayTotals(date) {
      return this.gridRows
        .filter((row) => this.kit.dateValue(row.work_date) === date)
        .reduce(
          (totals, row) => ({
            billing: totals.billing + this.rowEffectiveAmount(row, 'billing'),
            payment: totals.payment + this.rowEffectiveAmount(row, 'payment'),
          }),
          { billing: 0, payment: 0 }
        );
    },

    updateDayTotalCells(date) {
      const totals = this.dayTotals(date);
      ['billing', 'payment'].forEach((side) => {
        document.querySelectorAll(`[data-day-total="${side}"][data-work-date="${date}"]`).forEach((cell) => {
          cell.textContent = `¥${Math.round(totals[side]).toLocaleString()}`;
        });
      });
    },

    captureGridViewState() {
      const wrap = document.querySelector('.dr-grid-wrap');
      return {
        gridScrollTop: wrap?.scrollTop || 0,
        gridScrollLeft: wrap?.scrollLeft || 0,
        windowScrollX: window.scrollX || 0,
        windowScrollY: window.scrollY || 0,
      };
    },

    mergeStatusReports(reports = []) {
      const byId = new Map((reports || []).map((report) => [Number(report.daily_report_id), report]));
      this.gridRows = this.gridRows.map((row) => {
        const updated = byId.get(Number(row.daily_report_id));
        if (!updated) return row;
        return {
          ...row,
          ...updated,
          _calcContext: row._calcContext,
          _dirty: false,
          _expanded: row._expanded,
        };
      });
    },

    renderGridWithViewState(viewState, focusIdx = null) {
      this.renderGrid();
      const restore = () => {
        const wrap = document.querySelector('.dr-grid-wrap');
        if (wrap) {
          wrap.scrollTop = viewState?.gridScrollTop || 0;
          wrap.scrollLeft = viewState?.gridScrollLeft || 0;
        }
        window.scrollTo(viewState?.windowScrollX || 0, viewState?.windowScrollY || 0);
        if (focusIdx != null) {
          document.querySelector(`.status-button[data-idx="${focusIdx}"]`)?.focus({ preventScroll: true });
        }
      };
      restore();
      window.requestAnimationFrame(restore);
    },

    async previewRow(idx) {
      const row = this.gridRows[idx];
      if (!row) return false;
      const result = await this.ctx.api('/api/daily-reports/preview', {
        method: 'POST',
        body: JSON.stringify(this.rowPayload(row)),
      });
      if (!result.res.ok || !result.data?.ok) {
        window.alert(result.data?.message || '料金の再計算に失敗しました');
        return false;
      }
      this.gridRows[idx] = {
        ...row,
        ...result.data.preview,
        _calcContext: row._calcContext,
        _dirty: true,
        _expanded: true,
      };
      return true;
    },

    async showMonthList(message = '') {
      this.ctx.renderLoading();
      const { res, data } = await this.ctx.api(
        `/api/daily-reports/month-projects?target_year_month=${encodeURIComponent(this.ym)}`
      );
      if (!res.ok || !data?.ok) {
        this.ctx.app.innerHTML = this.kit.shell(
          '日報',
          `<section class="panel"><p class="error">${this.ctx.escapeHtml(data?.message || '取得失敗')}</p></section>`
        );
        this.kit.bindShell();
        return;
      }
      const summary = data.summary || {};
      const rows = (data.rows || [])
        .map(
          (r) => `
          <tr>
            <td>${this.ctx.escapeHtml(r.project_id)}</td>
            <td>${this.ctx.escapeHtml(r.company_name || '-')}</td>
            <td>${this.ctx.escapeHtml(r.partner_name || '-')}</td>
            <td>${this.ctx.escapeHtml(r.template_name || r.manager_name || '-')}</td>
            <td>${this.ctx.escapeHtml(r.input_days)}/${this.ctx.escapeHtml(r.days_in_month)}</td>
            <td>${this.ctx.escapeHtml(r.completion_rate)}%</td>
            <td>${this.ctx.escapeHtml(r.input_status)}</td>
            <td>
              <button type="button" class="btn btn-small" data-input="${r.project_id}"
                data-company="${r.company_id || ''}" data-partner="${r.partner_id || ''}">入力</button>
            </td>
          </tr>`
        )
        .join('');
      this.ctx.app.innerHTML = this.kit.shell(
        '日報（仮組）',
        `<section class="panel">
          ${message ? `<p class="flash">${this.ctx.escapeHtml(message)}</p>` : ''}
          <div class="toolbar">
            <button type="button" class="btn btn-ghost" id="prev-month">← 前月</button>
            <input type="month" id="ym" value="${this.ctx.escapeHtml(this.ym)}" />
            <button type="button" class="btn btn-ghost" id="next-month">次月 →</button>
            <button type="button" class="btn" id="reload">表示</button>
          </div>
          <p class="muted">対象案件 ${this.ctx.escapeHtml(summary.project_count ?? 0)} /
            入力あり ${this.ctx.escapeHtml(summary.input_project_count ?? 0)} /
            平均完了率 ${this.ctx.escapeHtml(summary.avg_completion_rate ?? 0)}%</p>
          <div class="table-wrap table-wrap-sticky">
            <table class="data-table data-table-compact">
              <thead><tr><th>案件</th><th>企業</th><th>パートナー</th><th>名称</th><th>入力日数</th><th>完了率</th><th>状況</th><th>操作</th></tr></thead>
              <tbody>${rows || '<tr><td colspan="8">案件がありません</td></tr>'}</tbody>
            </table>
          </div>
        </section>`
      );
      this.kit.bindShell();
      document.getElementById('prev-month')?.addEventListener('click', () => {
        this.shiftMonth(-1);
        this.showMonthList();
      });
      document.getElementById('next-month')?.addEventListener('click', () => {
        this.shiftMonth(1);
        this.showMonthList();
      });
      document.getElementById('reload')?.addEventListener('click', () => {
        this.ym = document.getElementById('ym').value || this.ym;
        this.showMonthList();
      });
      document.querySelectorAll('[data-input]').forEach((btn) =>
        btn.addEventListener('click', () => {
          this.kit.pushNav(() => this.showMonthList());
          this.showInputGrid({
            project_id: Number(btn.getAttribute('data-input')),
            company_id: Number(btn.getAttribute('data-company') || 0) || null,
            partner_id: Number(btn.getAttribute('data-partner') || 0) || null,
          });
        })
      );
    },

    daysInMonth(ym) {
      const [y, m] = ym.split('-').map(Number);
      return new Date(y, m, 0).getDate();
    },

    emptyDay(dateStr, meta) {
      return {
        daily_report_id: null,
        version: 1,
        status: 'draft',
        project_id: meta.project_id,
        company_id: meta.company_id,
        partner_id: meta.partner_id,
        target_year_month: this.ym,
        work_date: dateStr,
        start_time: '',
        end_time: '',
        break_time: '',
        break_minutes: 0,
        is_absent: 0,
        is_training: 0,
        binding_hours: '',
        work_hours: '',
        overtime_hours: '',
        shortage_hours: '',
        start_meter: '',
        end_meter: '',
        total_distance: '',
        toll_fee: '',
        parking_fee: '',
        transport_fee: '',
        night_hours: '',
        night_break_minutes_billing: 0,
        night_break_minutes_payment: 0,
        night_adjustment_minutes_billing: 0,
        night_adjustment_minutes_payment: 0,
        night_adjustment_reason_billing: '',
        night_adjustment_reason_payment: '',
        night_minutes_billing: null,
        night_minutes_payment: null,
        night_overtime_minutes_billing: null,
        night_overtime_minutes_payment: null,
        regular_overtime_minutes_billing: null,
        regular_overtime_minutes_payment: null,
        selected_fee_item_id: '',
        selected_fee_item_name: '',
        fee_item_selection_source: 'auto',
        rate_overrides: {},
        rate_override_reason: '',
        calculation_detail: null,
        spot_amount: '',
        row_comment: '',
        override_billing_amount: '',
        override_payment_amount: '',
        calculated_billing_amount: '',
        calculated_payment_amount: '',
        _dirty: false,
        _expanded: false,
      };
    },

    async showInputGrid(meta) {
      this.ctx.renderLoading();
      this.gridMeta = meta;
      const params = new URLSearchParams({
        target_year_month: this.ym,
        project_id: meta.project_id,
      });
      const { res, data } = await this.ctx.api(`/api/daily-reports?${params}`);
      if (!res.ok || !data?.ok) {
        this.ctx.app.innerHTML = this.kit.shell(
          '日報入力',
          `<section class="panel"><p class="error">${this.ctx.escapeHtml(data?.message || '取得失敗')}</p></section>`,
          { onBack: () => this.showMonthList() }
        );
        this.kit.bindShell({ onBack: () => this.showMonthList() });
        return;
      }
      const byDate = new Map();
      for (const r of data.reports || []) {
        const date = this.kit.dateValue(r.work_date);
        if (!byDate.has(date)) byDate.set(date, []);
        byDate.get(date).push({ ...r, _dirty: false, _expanded: false });
      }
      const days = this.daysInMonth(this.ym);
      this.gridRows = [];
      for (let d = 1; d <= days; d += 1) {
        const dateStr = `${this.ym}-${String(d).padStart(2, '0')}`;
        const rows = byDate.get(dateStr) || [];
        if (rows.length) this.gridRows.push(...rows);
        else this.gridRows.push(this.emptyDay(dateStr, meta));
      }
      const [monthly, inputDefaults, uiSettings] = await Promise.all([
        this.ctx.api(`/api/daily-reports/monthly-approval?project_id=${encodeURIComponent(meta.project_id)}&target_year_month=${encodeURIComponent(this.ym)}`),
        this.ctx.api(`/api/daily-reports/input-defaults?project_id=${encodeURIComponent(meta.project_id)}`),
        this.ctx.api(`/api/daily-reports/ui-settings?project_id=${encodeURIComponent(meta.project_id)}&target_year_month=${encodeURIComponent(this.ym)}`),
      ]);
      this.monthlyApproval = monthly.res.ok && monthly.data?.ok ? monthly.data.approval : null;
      const monthlyDistance = await this.ctx.api(
        `/api/daily-reports/distance-monthly?project_id=${encodeURIComponent(meta.project_id)}&target_year_month=${encodeURIComponent(this.ym)}`
      );
      this.monthlyDistance = monthlyDistance.res.ok && monthlyDistance.data?.ok ? monthlyDistance.data.results : {};
      this.projectInputDefaults = inputDefaults.res.ok && inputDefaults.data?.ok ? inputDefaults.data.defaults : {};
      this.dailyReportUiSettings = uiSettings.res.ok && uiSettings.data?.ok ? uiSettings.data.settings : {};
      this.dailyReportHolidayDates = new Set(uiSettings.res.ok && uiSettings.data?.ok ? uiSettings.data.holiday_dates || [] : []);
      this.renderGrid();
    },

    summaryFromGrid() {
      let workDays = 0;
      let overtime = 0;
      let shortage = 0;
      let distance = 0;
      for (const r of this.gridRows) {
        if (r.daily_report_id || r.start_time || r.is_absent || r.is_training) workDays += 1;
        overtime += Number(r.overtime_hours || 0);
        shortage += Number(r.shortage_hours || 0);
        distance += Number(r.total_distance || 0);
      }
      return { workDays, overtime, shortage, distance };
    },

    availableFeeItems(row) {
      const detail = this.rowCalculation(row);
      return row._calcContext?.fee_items || detail.available_fee_items || [];
    },

    feeItemOptions(row) {
      const items = this.availableFeeItems(row);
      const autoName = row.selected_fee_item_name || row._calcContext?.selected_fee_item_name || '';
      if (!items.length && row.selected_fee_item_id) {
        return `<option value="" ${row.fee_item_selection_source !== 'manual' ? 'selected' : ''}>${this.ctx.escapeHtml(autoName ? `自動: ${autoName}` : '自動選択')}</option><option value="${this.ctx.escapeHtml(row.selected_fee_item_id)}" ${row.fee_item_selection_source === 'manual' ? 'selected' : ''}>${this.ctx.escapeHtml(row.selected_fee_item_name || '料金区分')}</option>`;
      }
      return `<option value="" ${row.fee_item_selection_source !== 'manual' ? 'selected' : ''}>${this.ctx.escapeHtml(autoName ? `自動: ${autoName}` : '自動選択')}</option>${items
        .map(
          (item) => `<option value="${this.ctx.escapeHtml(item.id)}" ${row.fee_item_selection_source === 'manual' && String(item.id) === String(row.selected_fee_item_id) ? 'selected' : ''}>${this.ctx.escapeHtml(item.name)}</option>`
        )
        .join('')}`;
    },

    sameNightInput(row) {
      const detail = this.rowCalculation(row);
      const rules = row._calcContext?.night_rules;
      const billingRule = rules?.billing || detail.billing?.modes;
      const paymentRule = rules?.payment || detail.payment?.modes;
      return JSON.stringify(billingRule || {}) === JSON.stringify(paymentRule || {});
    },

    rateTableHtml(row, idx, locked) {
      const labels = { basic: '基本単価', shortage: '不足控除', overtime: '超過', night: '深夜', night_overtime: '深夜超過' };
      const overrides = this.parseJson(row.rate_overrides, {});
      const cells = (side, priceType) => {
        const info = this.rateInfo(row, side, priceType);
        const original = Number(info.original_rate ?? info.rate ?? 0);
        const override = overrides?.[side]?.[priceType];
        const value = override !== '' && override != null ? Number(override) : '';
        const reference = original ? `¥${original.toLocaleString()}` : '-';
        return `<td><input class="dr-rate-input" type="number" step="1" inputmode="numeric" data-rate-side="${side}" data-rate-type="${priceType}" data-idx="${idx}" data-original="${original}" value="${this.ctx.escapeHtml(value)}" placeholder="${this.ctx.escapeHtml(original || '')}" ${locked ? 'disabled' : ''} /><small class="dr-rate-original">元: ${this.ctx.escapeHtml(reference)}${info.calc_type ? ` / ${this.ctx.escapeHtml(info.calc_type)}` : ''}</small></td>`;
      };
      const types = ['basic', 'shortage', 'overtime', 'night', 'night_overtime'];
      const header = types.map((type) => `<th>${labels[type]}</th>`).join('');
      const rows = ['billing', 'payment']
        .map((side) => `<tr><th>${side === 'billing' ? '請求' : '支払'}</th>${types.map((type) => cells(side, type)).join('')}</tr>`)
        .join('');
      return `<div class="dr-rate-wrap"><table class="data-table data-table-compact dr-rate-table">
        <thead><tr><th></th>${header}</tr></thead><tbody>${rows}</tbody>
      </table></div>
      <label>一時変更理由<input data-f="rate_override_reason" data-idx="${idx}" value="${this.ctx.escapeHtml(row.rate_override_reason || '')}" ${locked ? 'disabled' : ''} /></label>`;
    },

    timeInputHtml(row, idx, field, locked, options = {}) {
      const isDuration = Boolean(options.duration);
      let value = isDuration
        ? this.durationInput(row, field, options.decimalField || null)
        : this.kit.timeValue(row[field]);
      const isEmpty = !value || (isDuration && this.parseMinutesInput(value) === 0);
      if (isEmpty) value = '';
      const fieldAttr = isDuration ? `data-minutes-f="${field}"` : `data-f="${field}"`;
      const defaultKind = options.defaultKind || field;
      return `<div class="dr-time-control">
        <button type="button" class="dr-step-button" data-time-step="${field}" data-direction="-1" data-idx="${idx}" ${locked ? 'disabled' : ''} aria-label="時間を減らす">−</button>
        <input class="dr-time-input dr-large-input ${isEmpty ? 'dr-input-empty' : ''}" ${fieldAttr} data-idx="${idx}" data-default-time="${defaultKind}" value="${this.ctx.escapeHtml(value)}" placeholder="${isDuration ? '0:00' : field === 'end_time' ? '28:00' : '08:00'}" ${locked ? 'disabled' : ''} />
        <button type="button" class="dr-step-button" data-time-step="${field}" data-direction="1" data-idx="${idx}" ${locked ? 'disabled' : ''} aria-label="時間を増やす">＋</button>
      </div>`;
    },

    nightInputHtml(row, idx, locked) {
      const common = this.sameNightInput(row);
      const billingBreak = Number(row.night_break_minutes_billing || 0);
      const paymentBreak = Number(row.night_break_minutes_payment || 0);
      const breakSame = billingBreak === paymentBreak;
      const billingAdjustment = Number(row.night_adjustment_minutes_billing || 0);
      const paymentAdjustment = Number(row.night_adjustment_minutes_payment || 0);
      const adjustmentSame = billingAdjustment === paymentAdjustment;
      const billingReason = String(row.night_adjustment_reason_billing || '');
      const paymentReason = String(row.night_adjustment_reason_payment || '');
      const reasonSame = billingReason === paymentReason;
      const breakPlaceholder = breakSame
        ? ''
        : `placeholder="${this.ctx.escapeHtml(`請求 ${this.formatMinutes(billingBreak)} / 支払 ${this.formatMinutes(paymentBreak)}`)}"`;
      const adjustmentPlaceholder = adjustmentSame
        ? ''
        : `placeholder="${this.ctx.escapeHtml(`請求 ${this.formatMinutes(billingAdjustment)} / 支払 ${this.formatMinutes(paymentAdjustment)}`)}"`;
      const reasonPlaceholder = reasonSame ? '' : 'placeholder="請求・支払の既存理由を保持中"';
      const breakHtml = common
        ? `<label>深夜帯内休憩（共通）<input data-common-minutes="night_break" data-idx="${idx}" value="${breakSame ? this.formatMinutes(billingBreak) : ''}" ${breakPlaceholder} ${locked ? 'disabled' : ''} /></label>`
        : `<label>深夜帯内休憩（請求）<input data-minutes-f="night_break_minutes_billing" data-idx="${idx}" value="${this.durationInput(row, 'night_break_minutes_billing')}" ${locked ? 'disabled' : ''} /></label>
           <label>深夜帯内休憩（支払）<input data-minutes-f="night_break_minutes_payment" data-idx="${idx}" value="${this.durationInput(row, 'night_break_minutes_payment')}" ${locked ? 'disabled' : ''} /></label>`;
      const adjustmentHtml = common
        ? `<label>深夜時間調整（共通）<input data-common-minutes="night_adjustment" data-idx="${idx}" value="${adjustmentSame ? this.formatMinutes(billingAdjustment) : ''}" ${adjustmentPlaceholder} ${locked ? 'disabled' : ''} /></label>
           <label>調整理由（共通）<input data-common-reason="night_adjustment" data-idx="${idx}" value="${reasonSame ? this.ctx.escapeHtml(billingReason) : ''}" ${reasonPlaceholder} ${locked ? 'disabled' : ''} /></label>`
        : `<label>深夜時間調整（請求）<input data-signed-minutes-f="night_adjustment_minutes_billing" data-idx="${idx}" value="${this.formatMinutes(row.night_adjustment_minutes_billing || 0)}" ${locked ? 'disabled' : ''} /></label>
           <label>調整理由（請求）<input data-f="night_adjustment_reason_billing" data-idx="${idx}" value="${this.ctx.escapeHtml(row.night_adjustment_reason_billing || '')}" ${locked ? 'disabled' : ''} /></label>
           <label>深夜時間調整（支払）<input data-signed-minutes-f="night_adjustment_minutes_payment" data-idx="${idx}" value="${this.formatMinutes(row.night_adjustment_minutes_payment || 0)}" ${locked ? 'disabled' : ''} /></label>
           <label>調整理由（支払）<input data-f="night_adjustment_reason_payment" data-idx="${idx}" value="${this.ctx.escapeHtml(row.night_adjustment_reason_payment || '')}" ${locked ? 'disabled' : ''} /></label>`;
      return `${breakHtml}${adjustmentHtml}`;
    },

    calculationSummaryHtml(row) {
      const detail = this.rowCalculation(row);
      const side = (key, label) => {
        const value = detail[key] || {};
        const amount = value.amounts?.total ?? (key === 'billing' ? row.calculated_billing_amount : row.calculated_payment_amount);
        const shortageAmount = value.amounts?.details?.shortage?.amount ?? row[`shortage_amount_${key}`] ?? 0;
        return `<div class="dr-calc-card"><strong>${label}</strong>
          <span>不足 ${this.formatMinutes(value.shortage_minutes ?? row[`shortage_minutes_${key}`]) || '0:00'} / ¥${Number(shortageAmount || 0).toLocaleString()}</span>
          <span>超過 ${this.formatMinutes(value.regular_overtime_minutes ?? row[`regular_overtime_minutes_${key}`]) || '-'}</span>
          <span>深夜 ${this.formatMinutes(value.night_minutes ?? row[`night_minutes_${key}`]) || '対象外'}</span>
          <span>深夜超過 ${this.formatMinutes(value.night_overtime_minutes ?? row[`night_overtime_minutes_${key}`]) || '対象外'}</span>
          <span>金額 ¥${Number(amount || 0).toLocaleString()}</span></div>`;
      };
      return `<div class="dr-calc-summary">${side('billing', '請求計算')}${side('payment', '支払計算')}</div>`;
    },

    monthlyButtonsHtml() {
      const status = this.monthlyApproval?.status || 'draft';
      if (status === 'approved') return '<span class="status-badge status-approved">月次承認済み</span>';
      if (status === 'submitted') {
        return `<span class="status-badge status-confirmed">承認依頼中</span>
          <button type="button" class="btn" data-month-action="approve">月次承認</button>
          <button type="button" class="btn btn-ghost" data-month-action="reject">差戻し</button>
          <button type="button" class="btn btn-ghost" data-month-action="cancel">依頼取消</button>`;
      }
      return `<button type="button" class="btn" data-month-action="submit">月次承認依頼</button>`;
    },

    renderGrid(message = '') {
      const sum = this.summaryFromGrid();
      const ui = this.dailyReportUiSettings || {};
      const distanceStep = Number(ui.distance_step || 1);
      const expenseStep = Number(ui.expense_step || 100);
      const body = this.gridRows
        .map((r, idx) => {
          const locked = r.status === 'confirmed' || r.status === 'approved';
          const fullyLocked = r.status === 'approved';
          const date = this.kit.dateValue(r.work_date);
          const sameDateRows = this.gridRows.filter((row) => this.kit.dateValue(row.work_date) === date);
          const firstOfDate = idx === 0 || this.kit.dateValue(this.gridRows[idx - 1].work_date) !== date;
          const totals = this.dayTotals(date);
          const dayConfirmed = sameDateRows.some((row) => row.daily_report_id) &&
            sameDateRows.filter((row) => row.daily_report_id).every((row) => ['confirmed', 'approved'].includes(row.status));
          const main = `
            <tr class="dr-main ${this.dayRowClass(date)}" data-idx="${idx}" data-work-date="${this.ctx.escapeHtml(date)}">
              <td class="dr-expand-cell"><button type="button" class="btn btn-ghost btn-small" data-expand="${idx}" aria-label="行を展開">${r._expanded ? '▼' : '▶'}</button></td>
              <td class="dr-date-cell">${this.ctx.escapeHtml(this.formatDateWithWeekday(r.work_date))}</td>
              <td><input type="checkbox" data-f="is_absent" data-idx="${idx}" ${r.is_absent ? 'checked' : ''} ${locked ? 'disabled' : ''} /></td>
              <td><input type="checkbox" data-f="is_training" data-idx="${idx}" ${r.is_training ? 'checked' : ''} ${locked ? 'disabled' : ''} /></td>
              <td>${this.timeInputHtml(r, idx, 'start_time', locked)}</td>
              <td>${this.timeInputHtml(r, idx, 'end_time', locked)}</td>
              <td>${this.timeInputHtml(r, idx, 'break_minutes', locked, { duration: true, decimalField: 'break_time', defaultKind: 'break_minutes' })}</td>
              <td><span>${this.formatMinutes(Number(r.work_hours || 0) * 60) || '-'}</span></td>
              <td><span>${this.formatMinutes(Number(r.overtime_hours || 0) * 60) || '-'}</span></td>
              <td><span>${this.formatMinutes(Number(r.shortage_hours || 0) * 60) || '-'}</span></td>
              <td><input class="dr-large-input dr-distance-input" type="number" step="${distanceStep}" min="0" inputmode="numeric" data-f="total_distance" data-idx="${idx}" value="${this.ctx.escapeHtml(r.total_distance ?? '')}" ${locked ? 'disabled' : ''} /></td>
              <td><input class="dr-large-input dr-fee-input" type="number" step="${expenseStep}" min="0" inputmode="numeric" data-f="toll_fee" data-idx="${idx}" value="${this.ctx.escapeHtml(r.toll_fee ?? '')}" ${locked ? 'disabled' : ''} /></td>
              <td><input class="dr-large-input dr-fee-input" type="number" step="${expenseStep}" min="0" inputmode="numeric" data-f="parking_fee" data-idx="${idx}" value="${this.ctx.escapeHtml(r.parking_fee ?? '')}" ${locked ? 'disabled' : ''} /></td>
              <td><input class="dr-large-input dr-fee-input" type="number" step="${expenseStep}" min="0" inputmode="numeric" data-f="transport_fee" data-idx="${idx}" value="${this.ctx.escapeHtml(r.transport_fee ?? '')}" ${locked ? 'disabled' : ''} /></td>
              <td><button type="button" class="status-badge status-button status-${this.ctx.escapeHtml(r.status || 'draft')}" data-day-status="${dayConfirmed ? 'draft' : 'confirmed'}" data-idx="${idx}" ${fullyLocked ? 'disabled' : ''} title="${dayConfirmed ? 'クリックしてこの日のロックを解除' : 'クリックしてこの日をロック'}">${this.ctx.escapeHtml(this.statusLabel(r.status))}</button></td>
              <td class="btn-row">
                <button type="button" class="btn btn-ghost btn-small" data-add-work="${idx}" ${dayConfirmed ? 'disabled' : ''} title="同じ日に作業行を追加">＋</button>
                ${sameDateRows.length > 1 || r.daily_report_id ? `<button type="button" class="btn btn-ghost btn-small" data-remove-work="${idx}" ${locked ? 'disabled' : ''} title="作業行を削除">×</button>` : ''}
              </td>
              <td class="dr-day-total-cell" data-day-total="billing" data-work-date="${this.ctx.escapeHtml(date)}">¥${Math.round(totals.billing).toLocaleString()}</td>
              <td class="dr-day-total-cell" data-day-total="payment" data-work-date="${this.ctx.escapeHtml(date)}">¥${Math.round(totals.payment).toLocaleString()}</td>
            </tr>`;
          const expand = r._expanded
            ? `<tr class="dr-expand" data-expand-row="${idx}">
                <td colspan="18">
                  <div class="dr-detail-grid">
                    <section class="dr-detail-section">
                      <h4>料金区分</h4>
                      <label>料金名
                        <select data-fee-item="${idx}" ${locked ? 'disabled' : ''}>${this.feeItemOptions(r) || '<option value="">料金設定なし</option>'}</select>
                      </label>
                      <small>${r.fee_item_selection_source === 'manual' ? '手動選択' : `自動選択: ${this.ctx.escapeHtml(r.selected_fee_item_name || r._calcContext?.selected_fee_item_name || '-')}`}${r._calcContext?.holiday ? ` / 休日判定: ${this.ctx.escapeHtml(r._calcContext.holiday.name || '休日')}（${r._calcContext.holiday.scope === 'project' ? '案件独自' : '全案件共通'}）` : ''}</small>
                    </section>
                    <section class="dr-detail-section"><h4>深夜時間</h4><div class="form-grid">${this.nightInputHtml(r, idx, locked)}</div></section>
                    <section class="dr-detail-section"><h4>契約料金</h4>${this.rateTableHtml(r, idx, locked)}</section>
                    <section class="dr-detail-section"><h4>計算結果</h4>${this.calculationSummaryHtml(r)}</section>
                    <div class="full"><label>行コメント</label><input data-f="row_comment" data-idx="${idx}" value="${this.ctx.escapeHtml(r.row_comment || '')}" ${fullyLocked ? 'disabled' : ''} /></div>
                    <div class="full btn-row">
                      <button type="button" class="btn btn-small" data-save-row="${idx}" ${fullyLocked ? 'disabled' : ''}>行保存</button>
                      ${firstOfDate && !dayConfirmed && sameDateRows.some((row) => row.daily_report_id)
                        ? `<button type="button" class="btn btn-small" data-day-status="confirmed" data-idx="${idx}">この日を確認</button>`
                        : ''}
                      ${firstOfDate && dayConfirmed && !fullyLocked
                        ? `<button type="button" class="btn btn-ghost btn-small" data-day-status="draft" data-idx="${idx}">この日の確認解除</button>`
                        : ''}
                    </div>
                  </div>
                </td>
              </tr>`
            : '';
          return main + expand;
        })
        .join('');

      this.ctx.app.innerHTML = this.kit.shell(
        `日報入力（案件#${this.gridMeta.project_id} / ${this.ym}）`,
        `<section class="panel dr-grid-screen" style="--dr-input-font-size:${this.ctx.escapeHtml(ui.input_font_size_px || 16)}px;--dr-reference-color:${this.ctx.escapeHtml(ui.reference_text_color || '#A7B0BE')};--dr-saturday-bg:${this.ctx.escapeHtml(ui.saturday_background_color || '#EAF4FF')};--dr-saturday-text:${this.ctx.escapeHtml(ui.saturday_text_color || '#1D4ED8')};--dr-holiday-bg:${this.ctx.escapeHtml(ui.holiday_background_color || '#FDECEC')};--dr-holiday-text:${this.ctx.escapeHtml(ui.holiday_text_color || '#B42318')}">
          ${message ? `<p class="flash">${this.ctx.escapeHtml(message)}</p>` : ''}
          <div class="dr-toolbar">
            <div class="dr-summary">
              <span>稼働日数: <strong>${sum.workDays}</strong></span>
              <span>超過合計: <strong>${sum.overtime}</strong></span>
              <span>不足合計（請求）: <strong>${sum.shortage}</strong></span>
              <span>総距離: <strong>${sum.distance}</strong></span>
              ${this.monthlyDistance?.billing ? `<span>距離超過（請求/月）: <strong>¥${Number(this.monthlyDistance.billing.amount || 0).toLocaleString()}</strong></span>` : ''}
              ${this.monthlyDistance?.payment ? `<span>距離超過（支払/月）: <strong>¥${Number(this.monthlyDistance.payment.amount || 0).toLocaleString()}</strong></span>` : ''}
            </div>
            <div class="btn-row">
              ${this.monthlyButtonsHtml()}
              <button type="button" class="btn" id="save-all">一括保存</button>
              <button type="button" class="btn btn-ghost" id="amount-check">金額確認</button>
              <button type="button" class="btn btn-ghost" id="expand-all">一括表示</button>
              <button type="button" class="btn btn-ghost" id="back-month">一覧へ</button>
            </div>
          </div>
          <div class="table-wrap table-wrap-sticky dr-grid-wrap">
            <table class="data-table data-table-compact dr-month-table">
              <thead>
                <tr>
                  <th></th><th>日付</th><th>不要</th><th>研修</th><th>開始</th><th>終了</th>
                  <th>休憩</th><th>稼働</th><th>超過</th><th>不足（請求）</th><th>距離</th>
                  <th>通行料</th><th>駐車料</th><th>交通費</th><th>状態</th><th>操作</th>
                  <th class="dr-day-total-header">請求合計</th><th class="dr-day-total-header">支払合計</th>
                </tr>
              </thead>
              <tbody>${body}</tbody>
            </table>
          </div>
        </section>`,
        { onBack: () => this.showMonthList(), wide: true }
      );
      this.kit.bindShell({ onBack: () => this.showMonthList() });
      this.bindGrid();
    },

    collectField(el) {
      const idx = Number(el.getAttribute('data-idx'));
      const field = el.getAttribute('data-f');
      const row = this.gridRows[idx];
      if (!row) return;
      if (el.type === 'checkbox') row[field] = el.checked ? 1 : 0;
      else row[field] = el.value;
      row._dirty = true;
    },

    bindGrid() {
      document.querySelectorAll('[data-f][data-idx]').forEach((el) => {
        el.addEventListener('change', () => {
          const field = el.getAttribute('data-f');
          if (field === 'start_time' || field === 'end_time') {
            try {
              el.value = this.normalizeTimeText(el.value);
            } catch (error) {
              window.alert(error.message);
              return;
            }
          }
          this.collectField(el);
        });
        el.addEventListener('input', () => this.collectField(el));
      });
      document.querySelectorAll('[data-minutes-f][data-idx]').forEach((el) => {
        el.addEventListener('change', () => {
          const idx = Number(el.getAttribute('data-idx'));
          const field = el.getAttribute('data-minutes-f');
          try {
            el.value = this.normalizeTimeText(el.value, true);
            this.gridRows[idx][field] = this.parseMinutesInput(el.value);
            this.gridRows[idx]._dirty = true;
          } catch (error) {
            window.alert(error.message);
          }
        });
      });
      document.querySelectorAll('[data-default-time][data-idx]').forEach((el) => {
        el.addEventListener('input', () => {
          const empty = !el.value || el.value === '0:00' || el.value === '00:00';
          el.classList.toggle('dr-input-empty', empty);
        });
      });
      document.querySelectorAll('[data-signed-minutes-f][data-idx]').forEach((el) => {
        el.addEventListener('change', () => {
          const idx = Number(el.getAttribute('data-idx'));
          const field = el.getAttribute('data-signed-minutes-f');
          try {
            this.gridRows[idx][field] = this.parseMinutesInput(el.value, true);
            this.gridRows[idx]._dirty = true;
          } catch (error) {
            window.alert(error.message);
          }
        });
      });
      document.querySelectorAll('[data-common-minutes][data-idx]').forEach((el) => {
        el.addEventListener('change', () => {
          const idx = Number(el.getAttribute('data-idx'));
          const kind = el.getAttribute('data-common-minutes');
          try {
            const value = this.parseMinutesInput(el.value, kind === 'night_adjustment');
            const fields = kind === 'night_break'
              ? ['night_break_minutes_billing', 'night_break_minutes_payment']
              : ['night_adjustment_minutes_billing', 'night_adjustment_minutes_payment'];
            fields.forEach((field) => { this.gridRows[idx][field] = value; });
            this.gridRows[idx]._dirty = true;
          } catch (error) {
            window.alert(error.message);
          }
        });
      });
      document.querySelectorAll('[data-common-reason][data-idx]').forEach((el) => {
        el.addEventListener('input', () => {
          const idx = Number(el.getAttribute('data-idx'));
          this.gridRows[idx].night_adjustment_reason_billing = el.value;
          this.gridRows[idx].night_adjustment_reason_payment = el.value;
          this.gridRows[idx]._dirty = true;
        });
      });
      document.querySelectorAll('[data-rate-side][data-rate-type][data-idx]').forEach((el) => {
        el.addEventListener('input', () => {
          const idx = Number(el.getAttribute('data-idx'));
          const side = el.getAttribute('data-rate-side');
          const type = el.getAttribute('data-rate-type');
          const original = Number(el.getAttribute('data-original') || 0);
          const value = el.value === '' ? null : Number(el.value);
          const overrides = this.parseJson(this.gridRows[idx].rate_overrides, {});
          if (!overrides[side]) overrides[side] = {};
          if (value == null || value === original) delete overrides[side][type];
          else overrides[side][type] = value;
          this.gridRows[idx].rate_overrides = overrides;
          this.gridRows[idx]._dirty = true;
        });
      });
      document.querySelectorAll('[data-default-time][data-idx]').forEach((el) => {
        el.addEventListener('dblclick', () => {
          const idx = Number(el.getAttribute('data-idx'));
          const field = el.getAttribute('data-default-time');
          const defaults = this.projectInputDefaults || {};
          const row = this.gridRows[idx];
          if (!row) return;
          if (field === 'break_minutes') {
            row.break_minutes = Number(defaults.break_minutes || 0);
            el.value = this.formatMinutes(row.break_minutes);
          } else {
            const value = this.kit.timeValue(defaults[field]);
            if (!value) return;
            row[field] = value;
            el.value = value;
          }
          el.classList.toggle('dr-input-empty', !el.value || el.value === '0:00' || el.value === '00:00');
          row._dirty = true;
        });
      });
      document.querySelectorAll('[data-time-step][data-direction][data-idx]').forEach((btn) => {
        btn.addEventListener('click', async () => {
          const idx = Number(btn.getAttribute('data-idx'));
          const field = btn.getAttribute('data-time-step');
          const direction = Number(btn.getAttribute('data-direction'));
          const row = this.gridRows[idx];
          if (!row) return;
          if (!row._calcContext) await this.ensureContext(idx);
          const step = this.inputTimeStep(row);
          try {
            if (field === 'break_minutes') {
              row.break_minutes = Math.max(0, Number(row.break_minutes || 0) + direction * step);
              const input = btn.parentElement.querySelector('input');
              input.value = this.formatMinutes(row.break_minutes);
              input.classList.toggle('dr-input-empty', row.break_minutes === 0);
            } else {
              const current = row[field] ? this.parseClockInput(this.kit.timeValue(row[field])) : 0;
              const next = Math.min(47 * 60 + 59, Math.max(0, current + direction * step));
              row[field] = this.formatClockMinutes(next);
              const input = btn.parentElement.querySelector('input');
              input.value = row[field];
              input.classList.remove('dr-input-empty');
            }
            row._dirty = true;
          } catch (error) {
            window.alert(error.message);
          }
        });
      });
      document.querySelectorAll('[data-fee-item]').forEach((select) => {
        select.addEventListener('change', async () => {
          const idx = Number(select.getAttribute('data-fee-item'));
          const row = this.gridRows[idx];
          row.selected_fee_item_id = select.value || null;
          row.fee_item_selection_source = select.value ? 'manual' : 'auto';
          row.rate_overrides = {};
          row.rate_override_reason = '';
          row.calculation_detail = null;
          row._dirty = true;
          select.disabled = true;
          await this.ensureContext(idx, true);
          const calculated = await this.previewRow(idx);
          if (!calculated) {
            select.disabled = false;
            return;
          }
          row._expanded = true;
          this.renderGrid();
        });
      });
      document.querySelectorAll('[data-expand]').forEach((btn) =>
        btn.addEventListener('click', async () => {
          document.querySelectorAll('[data-f][data-idx]').forEach((el) => this.collectField(el));
          const idx = Number(btn.getAttribute('data-expand'));
          const opening = !this.gridRows[idx]._expanded;
          this.gridRows[idx]._expanded = opening;
          if (opening) await this.ensureContext(idx);
          this.renderGrid();
        })
      );
      document.getElementById('expand-all')?.addEventListener('click', async () => {
        document.querySelectorAll('[data-f][data-idx]').forEach((el) => this.collectField(el));
        const anyClosed = this.gridRows.some((r) => !r._expanded);
        this.gridRows.forEach((r) => {
          r._expanded = anyClosed;
        });
        if (anyClosed) {
          await Promise.all(
            this.gridRows.map((row, idx) =>
              row.daily_report_id || row.start_time || row.is_absent || row.is_training ? this.ensureContext(idx) : null
            )
          );
        }
        this.renderGrid();
      });
      document.getElementById('amount-check')?.addEventListener('click', () => {
        document.querySelectorAll('[data-f][data-idx]').forEach((el) => this.collectField(el));
        let billing = 0;
        let payment = 0;
        for (const r of this.gridRows) {
          billing += Number(r.override_billing_amount ?? r.calculated_billing_amount ?? 0);
          payment += Number(r.override_payment_amount ?? r.calculated_payment_amount ?? 0);
        }
        window.alert(`請求合計: ${billing}\n支払合計: ${payment}`);
      });
      document.getElementById('back-month')?.addEventListener('click', () => this.showMonthList());
      document.getElementById('save-all')?.addEventListener('click', () => this.saveAll());
      document.querySelectorAll('[data-month-action]').forEach((btn) =>
        btn.addEventListener('click', () => this.handleMonthlyAction(btn.getAttribute('data-month-action')))
      );
      document.querySelectorAll('[data-save-row]').forEach((btn) =>
        btn.addEventListener('click', async () => {
          document.querySelectorAll('[data-f][data-idx]').forEach((el) => this.collectField(el));
          await this.saveRow(Number(btn.getAttribute('data-save-row')));
        })
      );
      document.querySelectorAll('[data-status-row]').forEach((btn) =>
        btn.addEventListener('click', async () => {
          const viewState = this.captureGridViewState();
          const idx = Number(btn.getAttribute('data-status-row'));
          const status = btn.getAttribute('data-status');
          const row = this.gridRows[idx];
          if (!row.daily_report_id) return;
          if (status === 'confirmed' && row._dirty) {
            const saved = await this.saveRow(idx);
            if (!saved) return;
          }
          let result = await this.ctx.api(`/api/daily-reports/${row.daily_report_id}/status`, {
            method: 'POST',
            body: JSON.stringify({ status }),
          });
          if (result.res.status === 409 && result.data?.code === 'confirmation_warning') {
            if (!window.confirm(`${result.data.message}\n\n問題がなければ日次確認を続行しますか？`)) return;
            result = await this.ctx.api(`/api/daily-reports/${row.daily_report_id}/status`, {
              method: 'POST',
              body: JSON.stringify({ status, acknowledge_warnings: true }),
            });
          }
          if (!result.res.ok) {
            window.alert(result.data?.message || 'ステータス更新失敗');
            return;
          }
          if (result.data?.report) this.mergeStatusReports([result.data.report]);
          this.renderGridWithViewState(viewState, idx);
        })
      );
      document.querySelectorAll('[data-add-work]').forEach((btn) =>
        btn.addEventListener('click', () => {
          document.querySelectorAll('[data-f][data-idx]').forEach((el) => this.collectField(el));
          const idx = Number(btn.getAttribute('data-add-work'));
          const date = this.kit.dateValue(this.gridRows[idx].work_date);
          let insertAt = idx + 1;
          while (insertAt < this.gridRows.length && this.kit.dateValue(this.gridRows[insertAt].work_date) === date) {
            insertAt += 1;
          }
          const row = this.emptyDay(date, this.gridMeta);
          row._calcContext = this.gridRows[idx]._calcContext || null;
          row._expanded = true;
          this.gridRows.splice(insertAt, 0, row);
          this.renderGrid();
        })
      );
      document.querySelectorAll('[data-remove-work]').forEach((btn) =>
        btn.addEventListener('click', async () => {
          const idx = Number(btn.getAttribute('data-remove-work'));
          const row = this.gridRows[idx];
          if (row.daily_report_id) {
            if (!window.confirm(`${this.kit.dateValue(row.work_date)} の作業行を削除しますか？`)) return;
            const result = await this.ctx.api(`/api/daily-reports/${row.daily_report_id}`, { method: 'DELETE' });
            if (!result.res.ok || !result.data?.ok) {
              window.alert(result.data?.message || '作業行の削除に失敗しました');
              return;
            }
          }
          this.gridRows.splice(idx, 1);
          const date = this.kit.dateValue(row.work_date);
          if (!this.gridRows.some((item) => this.kit.dateValue(item.work_date) === date)) {
            const replacement = this.emptyDay(date, this.gridMeta);
            const nextIndex = this.gridRows.findIndex((item) => this.kit.dateValue(item.work_date) > date);
            this.gridRows.splice(nextIndex < 0 ? this.gridRows.length : nextIndex, 0, replacement);
          }
          this.renderGrid();
        })
      );
      document.querySelectorAll('[data-day-status][data-idx]').forEach((btn) =>
        btn.addEventListener('click', async () => {
          const viewState = this.captureGridViewState();
          document.querySelectorAll('[data-f][data-idx]').forEach((el) => this.collectField(el));
          const idx = Number(btn.getAttribute('data-idx'));
          const status = btn.getAttribute('data-day-status');
          const workDate = this.kit.dateValue(this.gridRows[idx].work_date);
          if (status === 'confirmed') {
            for (let rowIndex = 0; rowIndex < this.gridRows.length; rowIndex += 1) {
              const row = this.gridRows[rowIndex];
              if (this.kit.dateValue(row.work_date) !== workDate || !row._dirty) continue;
              const saved = await this.saveRow(rowIndex);
              if (!saved) return;
            }
          }
          const payload = {
            project_id: this.gridMeta.project_id,
            work_date: workDate,
            status,
          };
          let result = await this.ctx.api('/api/daily-reports/day-status', {
            method: 'POST',
            body: JSON.stringify(payload),
          });
          if (result.res.status === 409 && result.data?.code === 'confirmation_warning') {
            if (!window.confirm(`${result.data.message}\n\n問題がなければこの日の確認を続行しますか？`)) return;
            result = await this.ctx.api('/api/daily-reports/day-status', {
              method: 'POST',
              body: JSON.stringify({ ...payload, acknowledge_warnings: true }),
            });
          }
          if (!result.res.ok || !result.data?.ok) {
            window.alert(result.data?.message || '日次確認処理に失敗しました');
            return;
          }
          this.mergeStatusReports(result.data.reports || []);
          this.renderGridWithViewState(viewState, idx);
        })
      );
    },

    async handleMonthlyAction(action) {
      if (action === 'submit') await this.saveAll();
      let note = null;
      if (action === 'reject') {
        note = window.prompt('差戻し理由を入力してください');
        if (!note?.trim()) return;
      }
      let result = await this.ctx.api('/api/daily-reports/monthly-approval', {
        method: 'POST',
        body: JSON.stringify({
          project_id: this.gridMeta.project_id,
          target_year_month: this.ym,
          action,
          note,
        }),
      });
      if (result.res.status === 409 && result.data?.code === 'unchecked_days_warning') {
        const dates = (result.data.unchecked_dates || []).join(', ');
        if (!window.confirm(`日次確認が未完了の日があります。\n${dates}\n\n問題がなければ承認依頼を続行しますか？`)) return;
        result = await this.ctx.api('/api/daily-reports/monthly-approval', {
          method: 'POST',
          body: JSON.stringify({
            project_id: this.gridMeta.project_id,
            target_year_month: this.ym,
            action,
            note,
            acknowledge_warnings: true,
          }),
        });
      }
      if (!result.res.ok || !result.data?.ok) {
        window.alert(result.data?.message || '月次承認処理に失敗しました');
        return;
      }
      await this.showInputGrid(this.gridMeta);
    },

    rowPayload(row) {
      return {
        project_id: row.project_id || this.gridMeta.project_id,
        company_id: row.company_id || this.gridMeta.company_id,
        partner_id: row.partner_id || this.gridMeta.partner_id || null,
        target_year_month: this.ym,
        work_date: this.kit.dateValue(row.work_date),
        start_time: row.start_time || null,
        end_time: row.end_time || null,
        break_minutes: Number(row.break_minutes || 0),
        is_absent: row.is_absent ? 1 : 0,
        is_training: row.is_training ? 1 : 0,
        total_distance: row.total_distance || null,
        toll_fee: row.toll_fee || null,
        parking_fee: row.parking_fee || null,
        transport_fee: row.transport_fee || null,
        selected_fee_item_id: row.selected_fee_item_id || row._calcContext?.selected_fee_item_id || null,
        selected_fee_item_name: row.selected_fee_item_name || row._calcContext?.selected_fee_item_name || null,
        fee_item_selection_source: row.fee_item_selection_source || 'auto',
        night_break_minutes_billing: Number(row.night_break_minutes_billing || 0),
        night_break_minutes_payment: Number(row.night_break_minutes_payment || 0),
        night_adjustment_minutes_billing: Number(row.night_adjustment_minutes_billing || 0),
        night_adjustment_minutes_payment: Number(row.night_adjustment_minutes_payment || 0),
        night_adjustment_reason_billing: row.night_adjustment_reason_billing || null,
        night_adjustment_reason_payment: row.night_adjustment_reason_payment || null,
        rate_overrides: row.rate_overrides || {},
        rate_override_reason: row.rate_override_reason || null,
        row_comment: row.row_comment || null,
        version: row.version || 1,
      };
    },

    async saveRow(idx) {
      const row = this.gridRows[idx];
      const hasData =
        row.start_time ||
        row.end_time ||
        row.is_absent ||
        row.is_training ||
        row.toll_fee ||
        row.parking_fee ||
        row.transport_fee ||
        row.row_comment;
      if (!hasData && !row.daily_report_id) return true;
      if (!row.company_id && !this.gridMeta.company_id) {
        window.alert('企業情報がありません');
        return false;
      }
      const payload = this.rowPayload(row);
      const result = row.daily_report_id
        ? await this.ctx.api(`/api/daily-reports/${row.daily_report_id}`, {
            method: 'PUT',
            body: JSON.stringify(payload),
          })
        : await this.ctx.api('/api/daily-reports', { method: 'POST', body: JSON.stringify(payload) });
      if (!result.res.ok || !result.data?.ok) {
        window.alert(result.data?.message || `${row.work_date} の保存に失敗`);
        return false;
      }
      const saved = result.data.report;
      if (saved) {
        this.gridRows[idx] = { ...this.gridRows[idx], ...saved, _dirty: false, _expanded: row._expanded };
        this.updateDayTotalCells(this.kit.dateValue(saved.work_date || row.work_date));
      }
      return true;
    },

    async saveAll() {
      document.querySelectorAll('[data-f][data-idx]').forEach((el) => this.collectField(el));
      for (let i = 0; i < this.gridRows.length; i += 1) {
        const row = this.gridRows[i];
        if (!row._dirty && !row.daily_report_id) {
          const hasData = row.start_time || row.end_time || row.is_absent || row.is_training;
          if (!hasData) continue;
        }
        if (row._dirty || (!row.daily_report_id && (row.start_time || row.is_absent || row.is_training))) {
          const ok = await this.saveRow(i);
          if (!ok) return;
        }
      }
      this.ctx.showToast('保存しました');
    },
  };

  window.LinksDailyReports = LinksDailyReports;
})();
