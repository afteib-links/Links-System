(() => {
  /**
   * Shared list table: sticky header, compact rows, sort, inline filter, column layout (A-04〜A-08)
   */
  function normalizeLayout(columns, saved) {
    const byKey = new Map((columns || []).map((c) => [c.key, c]));
    let order = [];
    if (saved?.columns && Array.isArray(saved.columns)) {
      for (const item of saved.columns) {
        const key = typeof item === 'string' ? item : item.key;
        if (byKey.has(key) && !order.includes(key)) order.push(key);
      }
    }
    for (const c of columns) {
      if (!order.includes(c.key) && c.defaultVisible !== false) order.push(c.key);
    }
    const hidden = new Set(
      (saved?.hidden || []).filter((k) => byKey.has(k))
    );
    return { order, hidden };
  }

  function cellText(row, col) {
    if (typeof col.getValue === 'function') return col.getValue(row);
    const v = row?.[col.key];
    return v == null || v === '' ? '-' : String(v);
  }

  function renderTable(options) {
    const {
      screenKey,
      columns,
      rows,
      layout,
      sortKey,
      sortOrder,
      filters,
      escapeHtml,
      actionsHeader = '操作',
      renderActions,
      tableId = 'shared-data-table',
    } = options;

    const { order, hidden } = normalizeLayout(columns, layout);
    const visibleCols = order.map((k) => columns.find((c) => c.key === k)).filter((c) => c && !hidden.has(c.key));
    const filterMap = filters || {};

    let filtered = [...(rows || [])];
    for (const col of visibleCols) {
      const q = String(filterMap[col.key] || '').trim().toLowerCase();
      if (!q) continue;
      filtered = filtered.filter((row) => cellText(row, col).toLowerCase().includes(q));
    }

    if (sortKey) {
      const col = columns.find((c) => c.key === sortKey);
      filtered.sort((a, b) => {
        const av = cellText(a, col || { key: sortKey });
        const bv = cellText(b, col || { key: sortKey });
        const an = Number(av);
        const bn = Number(bv);
        let cmp = 0;
        if (!Number.isNaN(an) && !Number.isNaN(bn) && av !== '-' && bv !== '-') {
          cmp = an - bn;
        } else {
          cmp = String(av).localeCompare(String(bv), 'ja');
        }
        return sortOrder === 'desc' ? -cmp : cmp;
      });
    }

    const head = visibleCols
      .map((c) => {
        const arrow =
          sortKey === c.key ? (sortOrder === 'desc' ? ' ▼' : ' ▲') : '';
        return `<th class="dt-sortable" data-sort-key="${escapeHtml(c.key)}" title="クリックでソート">${escapeHtml(
          c.label
        )}${arrow}</th>`;
      })
      .join('');

    const filterRow = visibleCols
      .map(
        (c) =>
          `<th class="dt-filter-cell"><input type="search" class="dt-filter" data-filter-key="${escapeHtml(
            c.key
          )}" value="${escapeHtml(filterMap[c.key] || '')}" placeholder="絞込" /></th>`
      )
      .join('');

    const body = filtered
      .map((row) => {
        const cells = visibleCols
          .map((c) => `<td>${escapeHtml(cellText(row, c))}</td>`)
          .join('');
        const actions = typeof renderActions === 'function' ? renderActions(row) : '';
        return `<tr>${cells}<td class="dt-actions">${actions}</td></tr>`;
      })
      .join('');

    const colPicker = columns
      .map((c) => {
        const checked = !hidden.has(c.key) && order.includes(c.key) ? 'checked' : '';
        return `<label class="dt-col-item"><input type="checkbox" data-col-key="${escapeHtml(
          c.key
        )}" ${checked}/> ${escapeHtml(c.label)}</label>`;
      })
      .join('');

    return {
      html: `
        <div class="dt-toolbar-extra">
          <button type="button" class="btn btn-ghost btn-small" id="dt-layout-toggle" data-screen="${escapeHtml(
            screenKey || ''
          )}">表示列</button>
          <div class="dt-col-panel" id="dt-col-panel" hidden>
            ${colPicker}
            <button type="button" class="btn btn-small" id="dt-layout-save">保存</button>
          </div>
        </div>
        <div class="table-wrap table-wrap-sticky">
          <table class="data-table data-table-compact" id="${escapeHtml(tableId)}">
            <thead>
              <tr>${head}<th>${escapeHtml(actionsHeader)}</th></tr>
              <tr class="dt-filter-row">${filterRow}<th></th></tr>
            </thead>
            <tbody>${body || `<tr><td colspan="${visibleCols.length + 1}">データがありません</td></tr>`}</tbody>
          </table>
        </div>`,
      visibleCols,
      filteredRows: filtered,
      layoutState: { order, hidden: [...hidden] },
    };
  }

  function bindTable(root, handlers = {}) {
    const el = typeof root === 'string' ? document.querySelector(root) : root;
    if (!el) return;

    el.querySelectorAll('[data-sort-key]').forEach((th) => {
      th.addEventListener('click', () => {
        const key = th.getAttribute('data-sort-key');
        handlers.onSort?.(key);
      });
    });

    let filterTimer = null;
    el.querySelectorAll('.dt-filter').forEach((input) => {
      input.addEventListener('input', () => {
        clearTimeout(filterTimer);
        filterTimer = setTimeout(() => {
          const filters = {};
          el.querySelectorAll('.dt-filter').forEach((inp) => {
            filters[inp.getAttribute('data-filter-key')] = inp.value;
          });
          handlers.onFilter?.(filters);
        }, 200);
      });
    });

    el.querySelector('#dt-layout-toggle')?.addEventListener('click', () => {
      const panel = el.querySelector('#dt-col-panel');
      if (panel) panel.hidden = !panel.hidden;
    });

    el.querySelector('#dt-layout-save')?.addEventListener('click', () => {
      const order = [];
      const hidden = [];
      el.querySelectorAll('[data-col-key]').forEach((cb) => {
        const key = cb.getAttribute('data-col-key');
        if (cb.checked) order.push(key);
        else hidden.push(key);
      });
      handlers.onSaveLayout?.({ columns: order, hidden });
    });
  }

  window.LinksDataTable = { renderTable, bindTable, normalizeLayout };
})();
