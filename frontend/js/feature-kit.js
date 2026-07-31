(() => {
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
      /** A-10 / A-11: launcher + previous-screen back */
      shell(title, bodyHtml, options = {}) {
        const showHistoryBack = options.showHistoryBack !== false && (options.onBack || navStack.length);
        return `
          <div class="app-shell">
            ${ctx.headerHtml()}
            <main class="app-main">
              <div class="back-row">
                <button type="button" class="btn btn-ghost" id="back-launcher">← 機能一覧へ</button>
                ${
                  showHistoryBack
                    ? '<button type="button" class="btn btn-ghost" id="back-history">← 戻る</button>'
                    : ''
                }
              </div>
              <h2 class="page-title">${ctx.escapeHtml(title)}</h2>
              ${bodyHtml}
            </main>
          </div>`;
      },
      bindShell(options = {}) {
        ctx.bindLogout();
        document.getElementById('back-launcher')?.addEventListener('click', () => {
          navStack.length = 0;
          ctx.showHome();
        });
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
      async loadLayout(screenKey) {
        const { res, data } = await ctx.api(`/api/layouts/${encodeURIComponent(screenKey)}`);
        if (!res.ok || !data?.ok) return null;
        return data.layout || null;
      },
      async saveLayout(screenKey, columnsJson, layoutJson = null) {
        return ctx.api(`/api/layouts/${encodeURIComponent(screenKey)}`, {
          method: 'PUT',
          body: JSON.stringify({ columns_json: columnsJson, layout_json: layoutJson }),
        });
      },
      modalHtml(title, bodyHtml, footerHtml = '') {
        return `
          <div class="modal-backdrop" id="modal-backdrop">
            <div class="modal-panel" role="dialog" aria-modal="true">
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
})();
