(() => {
  const timeSelector = '[data-f="start_time"], [data-f="end_time"], [data-minutes-f], [data-signed-minutes-f], [data-common-minutes]';
  const inputSelector = 'input:not([type="hidden"]), select, textarea';
  const visibleEditable = (el) => !el.disabled && !el.readOnly && el.getClientRects().length > 0;
  window.LinksDailyEntryUI = {
    entryFieldKey(el) {
      return el.dataset.f || el.dataset.minutesF || el.dataset.signedMinutesF || el.dataset.commonMinutes || (el.dataset.rateSide ? `rate:${el.dataset.rateSide}:${el.dataset.rateType}` : '');
    },
    entryTimeOptions(el) {
      const clock = ['start_time', 'end_time'].includes(el.dataset.f);
      return { signed: el.hasAttribute('data-signed-minutes-f') || el.dataset.commonMinutes === 'night_adjustment', maxMinutes: clock ? 2879 : 59999, padHours: clock };
    },
    entryError(el, message = '') {
      const id = el.dataset.errorId || `dr-error-${this.entryErrorSequence = (this.entryErrorSequence || 0) + 1}`;
      el.dataset.errorId = id;
      let note = document.getElementById(id);
      if (message && !note) {
        note = document.createElement('small');
        note.id = id;
        note.className = 'dr-input-error';
        note.setAttribute('role', 'alert');
        (el.closest('.dr-time-control') || el).insertAdjacentElement('afterend', note);
      }
      if (note) { note.textContent = message; note.hidden = !message; }
      el.setAttribute('aria-invalid', message ? 'true' : 'false');
      if (message) el.setAttribute('aria-describedby', id);
      else el.removeAttribute('aria-describedby');
      el.setCustomValidity(message);
      const row = el.dataset.idx != null ? this.gridRows[Number(el.dataset.idx)] : null;
      const key = this.entryFieldKey(el);
      if (row && key) { row._inputErrors ||= {}; if (message) row._inputErrors[key] = message; else delete row._inputErrors[key]; }
      this.updateEntrySummary();
    },
    validateEntryInput(el) {
      if (el.disabled || el.readOnly) return true;
      try {
        if (el.matches(timeSelector)) el.value = window.LinksTimeInput.normalize(el.value, this.entryTimeOptions(el));
        if (['total_distance', 'toll_fee', 'parking_fee', 'transport_fee'].includes(el.dataset.f) &&
            el.value !== '' && (!Number.isSafeInteger(Number(el.value)) || Number(el.value) < 0)) {
          throw new Error('0以上の整数で入力してください');
        }
        if (el.hasAttribute('data-rate-side') && el.value !== '' && !Number.isSafeInteger(Number(el.value)) && el.value !== el.dataset.initialValue && Number(el.value) !== Number(el.dataset.original)) {
          throw new Error('変更する金額は整数円で入力してください（既存の小数単価は保持します）');
        }
        this.entryError(el);
        return true;
      } catch (error) { this.entryError(el, error.message); return false; }
    },
    flushEntryInputs(idx = null) {
      const root = this.ctx.app.querySelector('.dr-grid-screen');
      if (!root) return true;
      let firstError = null;
      root.querySelectorAll(inputSelector).forEach(el => {
        if (el.dataset.idx == null || (idx != null && Number(el.dataset.idx) !== idx) || el.disabled || el.readOnly) return;
        if (!this.validateEntryInput(el)) firstError ||= el;
        else if (el.matches(timeSelector) || el.hasAttribute('data-f')) el.dispatchEvent(new Event('change', { bubbles: true }));
      });
      if (firstError) { firstError.focus(); return false; }
      const invalidRow = this.gridRows.find((row, rowIdx) => (idx == null || idx === rowIdx) && Object.keys(row._inputErrors || {}).length);
      if (invalidRow) { this.ctx.showToast(`${this.formatDateWithWeekday(invalidRow.work_date)} の入力エラーを修正してください（詳細欄も確認）`); return false; }
      return true;
    },
    entryRowLabel(row, idx) {
      if (Object.keys(row._inputErrors || {}).length) return '入力エラー';
      if (row._dirty) return '未保存';
      return row.daily_report_id ? (row.status === 'draft' ? '保存済み' : this.statusLabel(row.status)) : '未入力';
    },
    updateEntrySummary() {
      const screen = this.ctx.app.querySelector('.dr-grid-screen');
      if (!screen) return;
      let extraCount = 0, expenses = 0, billing = 0, payment = 0;
      this.gridRows.forEach((row, idx) => {
        const label = this.entryRowLabel(row, idx);
        const badge = screen.querySelector(`[data-entry-state="${idx}"]`);
        if (badge) { badge.textContent = label; badge.dataset.state = label; }
        const tr = screen.querySelector(`.dr-main[data-idx="${idx}"]`);
        if (tr) tr.classList.toggle('dr-unsaved', !!row._dirty);
        if (['total_distance','toll_fee','parking_fee','transport_fee'].some(f => Number(row[f]))) extraCount++;
        expenses += ['toll_fee','parking_fee','transport_fee'].reduce((s, f) => s + Number(row[f] || 0), 0);
        billing += this.rowEffectiveAmount(row, 'billing'); payment += this.rowEffectiveAmount(row, 'payment');
      });
      const extras = screen.querySelector('[data-hidden-extras]');
      if (extras) extras.textContent = `距離・経費の入力あり ${extraCount}行 / 経費 ${this.kit.money(expenses)}`;
      const totals = screen.querySelector('[data-entry-totals]');
      const items=this.additionalItems||[],extraBilling=items.reduce((sum,r)=>sum+Number(r.billing_amount),0),extraPayment=items.reduce((sum,r)=>sum+Number(r.payment_amount),0);
      if (totals) totals.textContent = `期間合計（保存時の計算） 請求 ${this.kit.money(billing+extraBilling)} / 支払 ${this.kit.money(payment+extraPayment)}${items.length?`（追加項目 ${items.length}件: 請求 ${this.kit.money(extraBilling)} / 支払 ${this.kit.money(extraPayment)}を含む）`:''}`;
      const selected = this.gridRows[this.activeEntryIdx];
      const active = screen.querySelector('[data-entry-selected]');
      if (active) active.textContent = selected ? `${this.formatDateWithWeekday(selected.work_date)} 選択行: 請求 ${this.kit.money(this.rowEffectiveAmount(selected, 'billing'))} / 支払 ${this.kit.money(this.rowEffectiveAmount(selected, 'payment'))}${selected._dirty ? '（未保存・再計算前）' : ''}` : '入力する行を選択してください';
    },
    entryInputs(root) { return Array.from(root.querySelectorAll(inputSelector)).filter(visibleEditable); },
    applyEntryMode() {
      const screen = this.ctx.app.querySelector('.dr-grid-screen');
      if (!screen) return;
      screen.dataset.entryMode = this.entryMode || 'time';
      screen.querySelectorAll('button, a, summary').forEach(el => el.tabIndex = -1);
      screen.querySelectorAll('.dr-main input').forEach(el => {
        el.tabIndex = this.entryMode === 'all' || el.matches(timeSelector) ? 0 : -1;
      });
      screen.querySelectorAll('[data-entry-mode]').forEach(el => el.setAttribute('aria-pressed', String(el.dataset.entryMode === (this.entryMode || 'time'))));
      this.updateEntryColumns();
    },
    updateEntryColumns() {
      const screen=this.ctx.app.querySelector('.dr-grid-screen');
      if (!screen) return;
      const count=Array.from(screen.querySelectorAll('.dr-month-table > thead > tr > th')).filter(el=>getComputedStyle(el).display!=='none').length;
      screen.querySelectorAll('.dr-expand > td').forEach(cell=>{ if(cell.colSpan!==count) cell.colSpan=count; });
    },
    async openEntryDetail(idx) {
      if (!this.gridRows[idx]) return;
      if (!this.gridRows[idx]._expanded) {
        const state = this.captureGridViewState();
        this.gridRows[idx]._expanded = true;
        await this.ensureContext(idx);
        this.renderGridWithViewState(state);
      }
      const detail = this.ctx.app.querySelector(`[data-expand-row="${idx}"]`);
      if (detail) this.entryInputs(detail)[0]?.focus();
    },
    openEntryTimePicker(input) {
      if (!input || input.disabled) return;
      const options = this.entryTimeOptions(input);
      let current;
      try { current = window.LinksTimeInput.parse(input.value, options) || 0; }
      catch { current = 0; }
      const dialog = document.createElement('dialog');
      dialog.className = 'dr-time-picker';
      dialog.setAttribute('aria-label', '時分を選択');
      const maxHours = Math.floor(options.maxMinutes / 60);
      dialog.innerHTML = `<form method="dialog"><h3>時分を選択</h3><div class="dr-picker-fields">${options.signed ? '<label>符号<select name="sign"><option value="1">＋</option><option value="-1">−</option></select></label>' : ''}<label>時<select name="hour">${Array.from({length:maxHours + 1}, (_, n) => `<option value="${n}">${String(n).padStart(2,'0')}</option>`).join('')}</select></label><label>分<select name="minute">${Array.from({length:60}, (_, n) => `<option value="${n}">${String(n).padStart(2,'0')}</option>`).join('')}</select></label></div><div class="btn-row"><button type="submit" class="btn" value="apply">選択</button><button type="submit" class="btn btn-ghost" value="cancel">取消</button></div></form>`;
      dialog.querySelector('[name=hour]').value = String(Math.floor(Math.abs(current) / 60));
      dialog.querySelector('[name=minute]').value = String(Math.abs(current) % 60);
      if (options.signed) dialog.querySelector('[name=sign]').value = current < 0 ? '-1' : '1';
      dialog.querySelectorAll('button').forEach(el => el.tabIndex = -1);
      dialog.addEventListener('keydown', event => {
        if (event.key !== 'Tab') return;
        event.preventDefault();
        const inputs = this.entryInputs(dialog), pos = inputs.indexOf(document.activeElement);
        inputs[(pos + (event.shiftKey ? -1 : 1) + inputs.length) % inputs.length]?.focus();
      });
      dialog.addEventListener('close', () => {
        if (dialog.returnValue === 'apply') {
          const minutes = Number(dialog.querySelector('[name=hour]').value) * 60 + Number(dialog.querySelector('[name=minute]').value);
          input.value = window.LinksTimeInput.format(minutes * Number(dialog.querySelector('[name=sign]')?.value || 1), options);
          input.dispatchEvent(new Event('input', { bubbles: true }));
          input.dispatchEvent(new Event('change', { bubbles: true }));
        }
        dialog.remove(); input.focus();
      });
      this.ctx.app.append(dialog); dialog.showModal();
    },
    bindEntryUI() {
      this.entryResizeObserver?.disconnect();
      this.entryResizeObserver=new ResizeObserver(()=>this.updateEntryColumns());
      this.entryResizeObserver.observe(this.ctx.app);
      const screen = this.ctx.app.querySelector('.dr-grid-screen');
      if (!screen) return;
      this.applyEntryMode();
      screen.querySelectorAll('[data-rate-side]').forEach(el => {
        const row = this.gridRows[Number(el.dataset.idx)], key = this.entryFieldKey(el);
        row._rateInitials ||= {};
        if (!Object.hasOwn(row._rateInitials, key)) row._rateInitials[key] = el.value;
        el.dataset.initialValue = row._rateInitials[key];
      });
      screen.querySelectorAll(timeSelector).forEach(el => {
        el.inputMode = 'decimal';
        if (!el.getAttribute('aria-label')) el.setAttribute('aria-label', el.closest('label')?.textContent.trim() || el.dataset.f || el.dataset.minutesF);
        if (!el.closest('.dr-time-control')) {
          const button = document.createElement('button');
          button.type = 'button'; button.className = 'dr-picker-button'; button.textContent = '▾';
          button.setAttribute('aria-label','時分選択'); button.title='時分選択（Alt＋↓）';
          button.tabIndex = -1; button.disabled = el.disabled;
          button.addEventListener('click', () => this.openEntryTimePicker(el));
          const control=document.createElement('span'); control.className='dr-time-control dr-detail-time-control';
          el.before(control); control.append(el,button);
        }
      });
      screen.querySelectorAll('[data-idx]').forEach(el => {
        const row = this.gridRows[Number(el.dataset.idx)];
        const key = this.entryFieldKey(el);
        if (key && row?._inputDrafts && Object.hasOwn(row._inputDrafts, key)) {
          if (el.type !== 'checkbox') el.value = row._inputDrafts[key];
          this.validateEntryInput(el);
        }
      });
      screen.querySelectorAll('.dr-expand details').forEach((el) => {
        const row = this.gridRows[Number(el.closest('[data-expand-row]').dataset.expandRow)];
        const key = el.querySelector('summary').textContent;
        el.open = !!row._openSections?.[key];
        el.addEventListener('toggle', () => { row._openSections ||= {}; row._openSections[key] = el.open; });
      });
      screen.querySelectorAll('[data-time-picker]').forEach(button => button.addEventListener('click', () => this.openEntryTimePicker(button.parentElement.querySelector('input'))));
      // Capture validation before legacy change handlers can mutate stored values.
      screen.addEventListener('change', event => {
        if (!event.target.matches(inputSelector) || event.target.dataset.idx == null) return;
        if (!this.validateEntryInput(event.target)) event.stopImmediatePropagation();
      }, true);
      screen.addEventListener('input', event => {
        const idx = Number(event.target.dataset.idx);
        if (event.target.dataset.idx != null && this.gridRows[idx]) {
          this.gridRows[idx]._dirty = true;
          this.gridRows[idx]._editRevision = (this.gridRows[idx]._editRevision || 0) + 1;
          const key = this.entryFieldKey(event.target);
          if (key && event.target.type !== 'checkbox') {
            this.gridRows[idx]._inputDrafts ||= {};
            this.gridRows[idx]._inputDrafts[key] = event.target.value;
          }
        }
        if (event.target.dataset.f && event.target.dataset.idx != null) screen.querySelectorAll(`[data-f="${event.target.dataset.f}"][data-idx="${event.target.dataset.idx}"]`).forEach(el => {
          if (el !== event.target) { el.value = event.target.value; this.entryError(el); }
        });
        this.updateEntrySummary();
      });
      screen.addEventListener('change', event => {
        if (event.isTrusted && event.target.dataset.idx != null) {
          const row = this.gridRows[Number(event.target.dataset.idx)];
          if (row) row._editRevision = (row._editRevision || 0) + 1;
        }
        this.updateEntrySummary();
      });
      screen.addEventListener('focusin', event => {
        const idx = event.target.dataset.idx ?? event.target.closest('[data-expand-row]')?.dataset.expandRow;
        if (idx != null) {
          this.activeEntryIdx = Number(idx);
          screen.querySelectorAll('.dr-main').forEach(row => row.classList.toggle('dr-selected', row.dataset.idx === String(idx)));
          this.updateEntrySummary();
        }
      });
      screen.querySelectorAll('[data-entry-mode]').forEach(button => button.addEventListener('click', () => { this.entryMode = button.dataset.entryMode; this.applyEntryMode(); }));
      screen.addEventListener('keydown', event => {
        if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') { event.preventDefault(); this.saveAll(); return; }
        if (event.key === 'F2') { event.preventDefault(); this.openEntryDetail(this.activeEntryIdx ?? 0); return; }
        if (event.altKey && event.key === 'ArrowDown' && event.target.matches(timeSelector)) { event.preventDefault(); this.openEntryTimePicker(event.target); return; }
        if (event.key === 'Escape' && event.target.closest('.dr-expand')) {
          event.preventDefault(); screen.querySelector(`.dr-main[data-idx="${this.activeEntryIdx}"] [data-f="start_time"]`)?.focus(); return;
        }
        if (event.key !== 'Tab') return;
        const detail = event.target.closest('.dr-expand');
        const inputs = detail ? this.entryInputs(detail) : this.entryInputs(screen).filter(el => el.closest('.dr-main') && (this.entryMode === 'all' || el.matches(timeSelector)));
        if (!inputs.length) return;
        event.preventDefault();
        const index = inputs.indexOf(event.target);
        const next = index < 0 ? (event.shiftKey ? inputs.length - 1 : 0) : (index + (event.shiftKey ? -1 : 1) + inputs.length) % inputs.length;
        inputs[next].focus();
      });
      this.updateEntrySummary();
    },
  };
})();
