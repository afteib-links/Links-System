(() => {
  /**
   * Shared list table: sticky header, compact rows, sort, inline filter。
   * 列の表示／順序は layout 読込で適用（操作UIは UIビルダー側）。
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
    const v = typeof col.getValue === 'function' ? col.getValue(row) : row?.[col.key];
    return v == null || v === '' ? '-' : String(v);
  }

  function compareValues(a, b) {
    const emptyA = a == null || a === '' || a === '-';
    const emptyB = b == null || b === '' || b === '-';
    if (emptyA || emptyB) return emptyA === emptyB ? 0 : emptyA ? 1 : -1;
    const an = Number(a);
    const bn = Number(b);
    if (!Number.isNaN(an) && !Number.isNaN(bn)) return an - bn;
    return String(a).localeCompare(String(b), 'ja', { numeric: true, sensitivity: 'base' });
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
      rowKey = 'id',
      selectedKey = null,
    } = options;

    const { order, hidden } = normalizeLayout(columns, layout);
    const visibleCols = order.map((k) => columns.find((c) => c.key === k)).filter((c) => c && !hidden.has(c.key));
    const filterMap = filters || {};

    let filtered = [...(rows || [])];
    for (const col of visibleCols) {
      const q = String(filterMap[col.key] || '').trim().toLowerCase();
      if (!q) continue;
      filtered = filtered.filter((row) => {
        const value = cellText(row, col).toLowerCase();
        return col.filterMode === 'exact' ? value === q : value.includes(q);
      });
    }

    if (sortKey) {
      const col = columns.find((c) => c.key === sortKey);
      filtered.sort((a, b) => {
        const av = typeof col?.getSortValue === 'function' ? col.getSortValue(a) : cellText(a, col || { key: sortKey });
        const bv = typeof col?.getSortValue === 'function' ? col.getSortValue(b) : cellText(b, col || { key: sortKey });
        const cmp = compareValues(av, bv);
        return sortOrder === 'desc' ? -cmp : cmp;
      });
    }

    const head = visibleCols
      .map((c) => {
        const arrow =
          sortKey === c.key ? (sortOrder === 'desc' ? ' ▼' : ' ▲') : '';
        return c.sortable === false
          ? `<th>${escapeHtml(c.label)}</th>`
          : `<th class="dt-sortable" data-sort-key="${escapeHtml(c.key)}" title="クリックでソート" aria-sort="${sortKey === c.key ? (sortOrder === 'desc' ? 'descending' : 'ascending') : 'none'}">${escapeHtml(c.label)}${arrow}</th>`;
      })
      .join('');

    const filterRow = visibleCols
      .map((c) => {
        if (c.filterable === false) return '<th class="dt-filter-cell"></th>';
        if (Array.isArray(c.filterOptions)) {
          const opts = c.filterOptions.map((item) => {
            const value = typeof item === 'string' ? item : item.value;
            const label = typeof item === 'string' ? item : item.label;
            return `<option value="${escapeHtml(value)}" ${String(filterMap[c.key] || '') === String(value) ? 'selected' : ''}>${escapeHtml(label)}</option>`;
          }).join('');
          return `<th class="dt-filter-cell"><select class="dt-filter" data-filter-key="${escapeHtml(c.key)}" aria-label="${escapeHtml(c.label)}で絞り込み"><option value="">すべて</option>${opts}</select></th>`;
        }
        return `<th class="dt-filter-cell"><input type="search" class="dt-filter" data-filter-key="${escapeHtml(c.key)}" value="${escapeHtml(filterMap[c.key] || '')}" placeholder="絞込" aria-label="${escapeHtml(c.label)}で絞り込み" /></th>`;
      })
      .join('');

    const body = filtered
      .map((row) => {
        const cells = visibleCols
          .map((c) => `<td class="${escapeHtml(c.className || '')}">${typeof c.renderCell === 'function' ? c.renderCell(row) : escapeHtml(cellText(row, c))}</td>`)
          .join('');
        const actions = typeof renderActions === 'function' ? renderActions(row) : '';
        const key = typeof rowKey === 'function' ? rowKey(row) : row?.[rowKey];
        const isSelected = selectedKey != null && String(key) === String(selectedKey);
        return `<tr data-row-key="${escapeHtml(key)}" tabindex="0" aria-selected="${isSelected ? 'true' : 'false'}" class="${isSelected ? 'is-selected' : ''}">${cells}<td class="dt-actions">${actions}</td></tr>`;
      })
      .join('');

    // 表示列操作UIは置かない（編集は UIビルダー）。layout の読込適用のみ行う。
    return {
      html: `
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
      const eventName = input.tagName === 'SELECT' ? 'change' : 'input';
      input.addEventListener(eventName, () => {
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

    const isInteractive = (target) => Boolean(target.closest('button, a, input, select, textarea, label, [role="button"]'));
    el.querySelectorAll('tbody tr[data-row-key]').forEach((row) => {
      const key = row.getAttribute('data-row-key');
      const selectRow = () => {
        el.querySelectorAll('tbody tr[data-row-key]').forEach((candidate) => {
          const selected = candidate === row;
          candidate.classList.toggle('is-selected', selected);
          candidate.setAttribute('aria-selected', selected ? 'true' : 'false');
        });
        handlers.onSelect?.(key);
      };
      row.addEventListener('click', (event) => {
        if (!isInteractive(event.target)) selectRow();
      });
      row.addEventListener('dblclick', (event) => {
        if (!isInteractive(event.target)) handlers.onActivate?.(key);
      });
      row.addEventListener('keydown', (event) => {
        if (event.key === 'Enter') handlers.onActivate?.(key);
        if (event.key === ' ') {
          event.preventDefault();
          selectRow();
        }
      });
    });
  }

  function enhancePlainTables(root = document) {
    root.querySelectorAll?.('table.data-table').forEach((table) => {
      if (table.dataset.listEnhanced === '1' || table.querySelector('.dt-filter-row')) return;
      if (table.hasAttribute('data-no-list-enhance') || table.matches('.fee-matrix, .dr-grid-table, .dr-month-table, .dr-import-review-table') || table.closest('form, .document-preview, .panel-sub, [id$="-mini"]')) return;
      const headerRow = table.tHead?.rows?.[0];
      const body = table.tBodies?.[0];
      if (!headerRow || !body) return;
      table.dataset.listEnhanced = '1';
      const filterRow = table.tHead.insertRow(1);
      filterRow.className = 'dt-filter-row';
      [...headerRow.cells].forEach((cell, index) => {
        const filterCell = document.createElement('th');
        filterCell.className = 'dt-filter-cell';
        const label = cell.textContent.trim();
        if (!['操作', '選択', '編集', ''].includes(label)) {
          const input = document.createElement('input');
          input.type = 'search';
          input.className = 'dt-filter';
          input.placeholder = '絞込';
          input.setAttribute('aria-label', `${label}で絞り込み`);
          input.addEventListener('input', () => {
            const filters = [...filterRow.querySelectorAll('.dt-filter')].map((item) => ({ index:Number(item.dataset.column), value:item.value.trim().toLowerCase() }));
            [...body.rows].forEach((row) => {
              if (row.cells.length < headerRow.cells.length) return;
              row.hidden = filters.some((item) => item.value && !String(row.cells[item.index]?.textContent || '').toLowerCase().includes(item.value));
            });
          });
          input.dataset.column = String(index);
          filterCell.appendChild(input);
          cell.classList.add('dt-sortable');
          cell.title = 'クリックでソート';
          cell.addEventListener('click', () => {
            const nextOrder = cell.dataset.sortOrder === 'asc' ? 'desc' : 'asc';
            [...headerRow.cells].forEach((item) => { delete item.dataset.sortOrder; item.setAttribute('aria-sort', 'none'); });
            cell.dataset.sortOrder = nextOrder;
            cell.setAttribute('aria-sort', nextOrder === 'asc' ? 'ascending' : 'descending');
            const rows = [...body.rows].filter((row) => row.cells.length >= headerRow.cells.length);
            rows.sort((a, b) => {
              const cmp = compareValues(a.cells[index]?.textContent.trim(), b.cells[index]?.textContent.trim());
              return nextOrder === 'desc' ? -cmp : cmp;
            }).forEach((row) => body.appendChild(row));
          });
        }
        filterRow.appendChild(filterCell);
      });
      [...body.rows].forEach((row) => {
        if (row.cells.length < headerRow.cells.length) return;
        row.tabIndex = 0;
        row.setAttribute('aria-selected', 'false');
        const interactive = (target) => Boolean(target.closest('button, a, input, select, textarea, label, [role="button"]'));
        row.addEventListener('click', (event) => {
          if (interactive(event.target)) return;
          [...body.rows].forEach((candidate) => {
            const selected = candidate === row;
            candidate.classList.toggle('is-selected', selected);
            candidate.setAttribute('aria-selected', selected ? 'true' : 'false');
          });
        });
        const activate = () => row.querySelector('[data-open], [data-open-import], [data-input], [data-edit], [data-edit-base], [data-edit-user], [data-edit-staff], [data-edit-office], [data-edit-holiday], [data-edit-ps]')?.click();
        row.addEventListener('dblclick', (event) => { if (!interactive(event.target)) activate(); });
        row.addEventListener('keydown', (event) => { if (event.key === 'Enter') activate(); });
      });
    });
  }

  window.LinksDataTable = { renderTable, bindTable, normalizeLayout, compareValues, enhancePlainTables };
})();
