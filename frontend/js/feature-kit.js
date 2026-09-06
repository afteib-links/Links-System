(() => {
  function numeric(value) {
    const parsed = Number(String(value ?? 0).replace(/[￥¥,，\s]/g, ''));
    return Number.isFinite(parsed) ? parsed : 0;
  }

  const moneyFormat = {
    amount(value) {
      return `￥${Math.round(numeric(value)).toLocaleString('ja-JP')}`;
    },
    unit(value) {
      const number = numeric(value);
      return `￥${number.toLocaleString('ja-JP', { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`;
    },
  };

  function createFeatureKit(ctx) {
    const navStack = [];

    return {
      ctx,
      dateValue(value) {
        if (!value) return '';
        const s = String(value);
        return s.length >= 10 ? s.slice(0, 10) : s;
      },
      timeValue(value) {
        if (!value) return '';
        const s = String(value);
        return s.length >= 5 ? s.slice(0, 5) : s;
      },
      /** 共通画面シェル。詳細画面だけ前画面へ戻る導線を表示する。 */
      shell(title, bodyHtml, options = {}) {
        const showHistoryBack = options.showHistoryBack !== false && (options.onBack || navStack.length);
        const mainClass = `${options.wide ? 'app-main app-main-wide' : 'app-main'}${options.scrollBodyOnly ? ' app-main-scroll-body' : ''}`;
        const shellClass = `${options.wide ? 'app-shell app-shell-wide' : 'app-shell'}${options.scrollBodyOnly ? ' app-shell-scroll-body' : ''}`;
        return `
          <div class="${shellClass}">
            ${ctx.sidebarHtml?.() || ''}
            <div class="app-frame">
            ${ctx.headerHtml(title)}
            <main class="${mainClass}">
              ${showHistoryBack ? '<div class="page-header-row page-header-actions-only"><div class="back-row"><button type="button" class="btn btn-ghost" id="back-history">← 戻る</button></div></div>' : ''}
              ${bodyHtml}
            </main>
            </div>
          </div>`;
      },
      bindShell(options = {}) {
        if (ctx.bindChrome) ctx.bindChrome();
        else ctx.bindLogout();
        document.getElementById('back-history')?.addEventListener('click', () => {
          if (typeof options.onBack === 'function') {
            options.onBack();
            return;
          }
          const prev = navStack.pop();
          if (typeof prev === 'function') prev();
          else ctx.showHome();
        });
      },
      pushNav(fn) {
        if (typeof fn === 'function') navStack.push(fn);
      },
      popNav() {
        return navStack.pop();
      },
      clearNav() {
        navStack.length = 0;
      },
      optionsFromList(list, valueKey, labelKey, selected) {
        return [`<option value="">（未選択）</option>`]
          .concat(
            (list || []).map((row) => {
              const val = row[valueKey];
              const label = row[labelKey];
              return `<option value="${ctx.escapeHtml(val)}" ${
                String(val) === String(selected) ? 'selected' : ''
              }>${ctx.escapeHtml(label)} (#${ctx.escapeHtml(val)})</option>`;
            })
          )
          .join('');
      },
      codeOptions(codes, selected) {
        return [`<option value="">（未選択）</option>`]
          .concat(
            (codes || []).map(
              (c) =>
                `<option value="${ctx.escapeHtml(c.code_value)}" ${
                  c.code_value === selected ? 'selected' : ''
                }>${ctx.escapeHtml(c.code_label)}</option>`
            )
          )
          .join('');
      },
      /** Combo: master options + free text allowed via datalist */
      comboHtml(id, list, valueKey, labelKey, selected, listId) {
        const opts = (list || [])
          .map((row) => `<option value="${ctx.escapeHtml(row[labelKey] || row[valueKey])}"></option>`)
          .join('');
        return `
          <input id="${ctx.escapeHtml(id)}" list="${ctx.escapeHtml(listId)}" value="${ctx.escapeHtml(
            selected || ''
          )}" autocomplete="off" />
          <datalist id="${ctx.escapeHtml(listId)}">${opts}</datalist>`;
      },
      searchSelectHtml(name, list, valueKey, labelKey, selected, options = {}) {
        const selectedRow = (list || []).find((row) => String(row[valueKey]) === String(selected ?? ''));
        const display = selectedRow ? (options.formatLabel?.(selectedRow) || selectedRow[labelKey] || '') : '';
        const required = options.required ? 'required' : '';
        const placeholder = options.placeholder || '名称・番号で検索';
        const aliases = options.aliasKeys || [];
        const items = (list || []).map((row) => {
          const label = options.formatLabel?.(row) || row[labelKey] || row[valueKey];
          const search = [label, row[valueKey], ...aliases.map((key) => row[key])].filter(Boolean).join(' ');
          return `<button type="button" class="search-select-option" role="option" data-value="${ctx.escapeHtml(row[valueKey])}" data-label="${ctx.escapeHtml(label)}" data-search="${ctx.escapeHtml(search)}">${ctx.escapeHtml(label)}</button>`;
        }).join('');
        return `<div class="search-select" data-search-select="${ctx.escapeHtml(name)}">
          <input type="search" class="search-select-input" value="${ctx.escapeHtml(display)}" placeholder="${ctx.escapeHtml(placeholder)}" autocomplete="off" ${required} aria-autocomplete="list" aria-expanded="false">
          <input type="hidden" name="${ctx.escapeHtml(name)}" value="${ctx.escapeHtml(selectedRow ? selectedRow[valueKey] : '')}">
          <div class="search-select-list" role="listbox" hidden>${items || '<p class="search-select-empty">候補がありません</p>'}</div>
        </div>`;
      },
      bindSearchSelects(root = document, onChange = null) {
        const normalize = (value) => String(value || '').normalize('NFKC').toLowerCase().replace(/[ァ-ヶ]/g, (char) => String.fromCharCode(char.charCodeAt(0) - 0x60));
        root.querySelectorAll?.('[data-search-select]').forEach((wrap) => {
          if (wrap.dataset.bound === '1') return;
          wrap.dataset.bound = '1';
          const input = wrap.querySelector('.search-select-input');
          const hidden = wrap.querySelector('input[type="hidden"]');
          const list = wrap.querySelector('.search-select-list');
          const options = [...wrap.querySelectorAll('.search-select-option')];
          const open = () => { list.hidden = false; input.setAttribute('aria-expanded', 'true'); };
          const close = () => { list.hidden = true; input.setAttribute('aria-expanded', 'false'); };
          const choose = (option) => {
            input.value = option.dataset.label || '';
            input.dataset.selectedLabel = input.value;
            hidden.value = option.dataset.value || '';
            input.setCustomValidity('');
            close();
            onChange?.(wrap.dataset.searchSelect, hidden.value, option);
            hidden.dispatchEvent(new Event('change', { bubbles: true }));
          };
          const filter = () => {
            if (input.value !== input.dataset.selectedLabel) hidden.value = '';
            const terms = normalize(input.value).split(/\s+/).filter(Boolean);
            let visible = 0;
            options.forEach((option) => {
              const haystack = normalize(option.dataset.search);
              option.hidden = !terms.every((term) => haystack.includes(term));
              if (!option.hidden) visible += 1;
            });
            input.setCustomValidity(input.value && !hidden.value ? '候補から選択してください' : '');
            open();
            const empty = wrap.querySelector('.search-select-empty');
            if (empty) empty.hidden = visible > 0;
          };
          input.dataset.selectedLabel = input.value;
          input.addEventListener('focus', open);
          input.addEventListener('input', filter);
          input.addEventListener('keydown', (event) => {
            const visible = options.filter((option) => !option.hidden);
            const current = visible.indexOf(document.activeElement);
            if (event.key === 'ArrowDown' && visible.length) { event.preventDefault(); visible[Math.min(current + 1, visible.length - 1)].focus(); }
            if (event.key === 'Escape') close();
            if (event.key === 'Enter' && visible.length === 1) { event.preventDefault(); choose(visible[0]); }
          });
          options.forEach((option) => {
            option.addEventListener('click', () => { input.dataset.selectedLabel = option.dataset.label || ''; choose(option); });
            option.addEventListener('keydown', (event) => {
              if (event.key === 'Escape') { close(); input.focus(); }
            });
          });
          wrap.addEventListener('focusout', () => setTimeout(() => {
            if (!wrap.contains(document.activeElement)) close();
          }, 0));
        });
      },
      codeLabel(codes, value) {
        if (!value) return '-';
        const hit = (codes || []).find((c) => c.code_value === value);
        return hit ? hit.code_label : value;
      },
      async loadCodes() {
        const { res, data } = await ctx.api('/api/masters/codes');
        const grouped = {};
        if (res.ok && data?.ok) {
          for (const row of data.codes || []) {
            if (!grouped[row.category_code]) grouped[row.category_code] = [];
            grouped[row.category_code].push(row);
          }
        }
        return grouped;
      },
      currentYearMonth() {
        const d = new Date();
        return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
      },
      statusMeta(code, label = '') {
        const map = {
          not_started:['neutral','○','未着手'], unplanned:['neutral','○','未作成'], none:['neutral','○','未処理'],
          draft:['working','●','下書き'], inputting:['working','●','入力中'], ready:['working','●','申請可能'], planned:['working','●','予定作成済み'], open:['working','●','処理中'], uploaded:['working','●','アップロード済み'], parsing:['working','●','解析中'],
          submitted:['waiting','◷','承認待ち'], confirmed:['waiting','◷','日次確認済み'], sales_reviewed:['waiting','◷','営業確認済み'], exported:['waiting','◷','CSV出力済み'], held:['waiting','◷','保留'], reserved:['waiting','◷','処理予約済み'], needs_review:['waiting','◷','確認待ち'], partial:['waiting','◷','一部反映'], warning:['waiting','△','要確認'],
          approved:['complete','✓','承認済み'], finalized:['complete','✓','最終確定済み'], executed:['complete','✓','実行済み'], closed:['complete','✓','完了'], issued:['complete','✓','発行済み'], billed:['complete','✓','請求済み'], paid:['complete','✓','支払済み'], active:['complete','✓','有効'],
          rejected:['attention','!','差戻し'], correcting:['attention','!','訂正中'], error:['attention','!','エラー'], failed:['attention','!','失敗'], overdue:['attention','!','期限超過'],
          cancelled:['inactive','—','取消済み'], disabled:['inactive','—','無効'], inactive:['inactive','—','無効'], skipped:['inactive','—','対象外'],
        };
        const [tone, icon, defaultLabel] = map[String(code || '').toLowerCase()] || ['neutral','○',label || code || '未設定'];
        return { code:String(code || ''), tone, icon, label:label || defaultLabel };
      },
      statusBadge(code, label = '') {
        const meta = this.statusMeta(code, label);
        return `<span class="status-badge tone-${meta.tone}" data-status="${ctx.escapeHtml(meta.code)}" aria-label="${ctx.escapeHtml(meta.label)}">${ctx.escapeHtml(meta.label)}</span>`;
      },
      money(value) {
        return moneyFormat.amount(value);
      },
      unitPrice(value) {
        return moneyFormat.unit(value);
      },
      summaryCardsHtml(items = []) {
        return `<div class="summary-cards">${items.map((item) => {
          const tag = item.filter != null ? 'button' : 'div';
          const attrs = item.filter != null
            ? ` type="button" data-summary-filter="${ctx.escapeHtml(item.filter)}" aria-pressed="${item.active ? 'true' : 'false'}"`
            : '';
          return `<${tag}${attrs} class="summary-card tone-${ctx.escapeHtml(item.tone || 'neutral')} ${item.active ? 'is-active' : ''}"><span>${ctx.escapeHtml(item.label)}</span><strong>${ctx.escapeHtml(item.value ?? 0)}</strong></${tag}>`;
        }).join('')}</div>`;
      },
      shiftYearMonth(value, delta) {
        const [year, month] = String(value || this.currentYearMonth()).split('-').map(Number);
        const date = new Date(year, month - 1 + delta, 1);
        return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
      },
      monthNavigatorHtml(value, prefix = 'month-nav') {
        return `<div class="toolbar month-navigator">
          <button type="button" class="btn btn-ghost" id="${prefix}-prev">← 前月</button>
          <input id="${prefix}-value" type="month" value="${ctx.escapeHtml(value)}" aria-label="対象年月">
          <button type="button" class="btn" id="${prefix}-load">表示</button>
          <button type="button" class="btn btn-ghost" id="${prefix}-next">翌月 →</button>
        </div>`;
      },
      bindMonthNavigator(prefix, getValue, setValue, reload) {
        const current = () => getValue?.() || document.getElementById(`${prefix}-value`)?.value || this.currentYearMonth();
        document.getElementById(`${prefix}-prev`)?.addEventListener('click', () => { setValue(this.shiftYearMonth(current(), -1)); reload(); });
        document.getElementById(`${prefix}-next`)?.addEventListener('click', () => { setValue(this.shiftYearMonth(current(), 1)); reload(); });
        document.getElementById(`${prefix}-load`)?.addEventListener('click', () => { setValue(document.getElementById(`${prefix}-value`)?.value || current()); reload(); });
      },
      async loadLayout(screenKey) {
        try {
          const { res, data } = await ctx.api(`/api/layouts/${encodeURIComponent(screenKey)}`);
          if (!res.ok || !data?.ok) return null;
          return data.layout || null;
        } catch (_error) {
          return null;
        }
      },
      async loadAreaLayout(screenKey, areaKey = 'list') {
        const saved = await this.loadLayout(screenKey);
        return window.LinksListScreens?.areaLayout?.(saved, areaKey) || null;
      },
      async saveLayout(screenKey, columnsJson, layoutJson = null) {
        return ctx.api(`/api/layouts/${encodeURIComponent(screenKey)}`, {
          method: 'PUT',
          body: JSON.stringify({ columns_json: columnsJson, layout_json: layoutJson }),
        });
      },
      modalHtml(title, bodyHtml, footerHtml = '', extraClass = '') {
        return `
          <div class="modal-backdrop" id="modal-backdrop">
            <div class="modal-panel ${ctx.escapeHtml(extraClass)}" role="dialog" aria-modal="true">
              <div class="modal-head">
                <h3>${ctx.escapeHtml(title)}</h3>
                <button type="button" class="btn btn-ghost btn-small" id="modal-close">閉じる</button>
              </div>
              <div class="modal-body">${bodyHtml}</div>
              ${footerHtml ? `<div class="modal-foot">${footerHtml}</div>` : ''}
            </div>
          </div>`;
      },
      bindModal(onClose) {
        const close = () => {
          document.getElementById('modal-backdrop')?.remove();
          onClose?.();
        };
        document.getElementById('modal-close')?.addEventListener('click', close);
        document.getElementById('modal-backdrop')?.addEventListener('click', (e) => {
          if (e.target.id === 'modal-backdrop') close();
        });
        return close;
      },
    };
  }

  window.LinksFeatureKit = { createFeatureKit };
  window.LinksMoney = moneyFormat;
})();
