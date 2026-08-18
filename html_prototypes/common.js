/* ============================================================
   LinksSys - 共通JavaScript (common.js)
   ============================================================ */

// ======== サイドバーのアクティブ状態管理 ========
function initSidebar() {
  const currentFile = location.pathname.split('/').pop();
  document.querySelectorAll('.sidebar-item[data-page]').forEach(el => {
    if (el.dataset.page === currentFile) {
      el.classList.add('active');
    }
    el.addEventListener('click', () => {
      const href = el.dataset.href;
      if (href) location.href = href;
    });
  });
}

// ======== モーダル管理 ========
function openModal(id) {
  document.getElementById(id).classList.remove('hidden');
  document.body.style.overflow = 'hidden';
}

function closeModal(id) {
  document.getElementById(id).classList.add('hidden');
  document.body.style.overflow = '';
}

// オーバーレイクリックで閉じる
document.addEventListener('click', (e) => {
  if (e.target.classList.contains('modal-overlay')) {
    e.target.classList.add('hidden');
    document.body.style.overflow = '';
  }
});

// ======== テーブル行フィルター（簡易検索）========
function initTableSearch(inputId, tableId) {
  const input = document.getElementById(inputId);
  if (!input) return;
  input.addEventListener('input', () => {
    const q = input.value.toLowerCase();
    document.querySelectorAll(`#${tableId} tbody tr`).forEach(tr => {
      const text = tr.textContent.toLowerCase();
      tr.style.display = text.includes(q) ? '' : 'none';
    });
  });
}

// ======== アコーディオン（日報グリッド行展開）========
function toggleAccordion(btn) {
  const row = btn.closest('tr');
  const detailRow = row.nextElementSibling;
  if (!detailRow || !detailRow.classList.contains('accordion-row')) return;

  const isOpen = !detailRow.classList.contains('hidden');
  if (isOpen) {
    detailRow.classList.add('hidden');
    btn.textContent = '▶';
    row.classList.remove('accordion-open');
  } else {
    detailRow.classList.remove('hidden');
    btn.textContent = '▼';
    row.classList.add('accordion-open');
  }
}

// ======== タブ切り替え ========
function initTabs(tabGroupId) {
  const group = document.getElementById(tabGroupId);
  if (!group) return;
  const tabs = group.querySelectorAll('[data-tab]');
  tabs.forEach(tab => {
    tab.addEventListener('click', () => {
      const target = tab.dataset.tab;
      // タブボタンのアクティブ切り替え
      tabs.forEach(t => t.classList.remove('tab-active'));
      tab.classList.add('tab-active');
      // パネルの表示切り替え
      group.querySelectorAll('[data-panel]').forEach(panel => {
        panel.classList.toggle('hidden', panel.dataset.panel !== target);
      });
    });
  });
}

// ======== トースト通知 ========
function showToast(message, type = 'success') {
  const colors = {
    success: { bg: '#f0fdf4', border: '#bbf7d0', text: '#15803d', icon: '✓' },
    error: { bg: '#fef2f2', border: '#fecaca', text: '#b91c1c', icon: '✕' },
    info: { bg: '#eff6ff', border: '#bfdbfe', text: '#1d4ed8', icon: 'ℹ' },
    warning: { bg: '#fffbeb', border: '#fde68a', text: '#b45309', icon: '⚠' },
  };
  const c = colors[type] || colors.success;
  const toast = document.createElement('div');
  toast.style.cssText = `
    position: fixed; bottom: 24px; right: 24px; z-index: 9999;
    background: ${c.bg}; border: 1px solid ${c.border}; color: ${c.text};
    padding: 12px 18px; border-radius: 8px; font-size: 13px; font-weight: 500;
    box-shadow: 0 4px 12px rgba(0,0,0,0.12);
    display: flex; align-items: center; gap: 8px;
    animation: slideIn 0.2s ease;
    font-family: 'Inter', 'Noto Sans JP', sans-serif;
  `;
  toast.innerHTML = `<span>${c.icon}</span><span>${message}</span>`;
  document.body.appendChild(toast);
  setTimeout(() => { toast.style.opacity = '0'; toast.style.transition = 'opacity 0.3s'; }, 2500);
  setTimeout(() => toast.remove(), 2900);
}

// ======== 確認ダイアログ（モックアップ用）========
function confirmAction(message, callback) {
  if (window.confirm(message)) callback();
}

// ======== 数値フォーマット ========
function formatYen(n) {
  return '¥' + Number(n).toLocaleString('ja-JP');
}

// ======== 日付フォーマット ========
function formatDate(d) {
  const dt = new Date(d);
  return `${dt.getFullYear()}/${String(dt.getMonth()+1).padStart(2,'0')}/${String(dt.getDate()).padStart(2,'0')}`;
}

/**
 * プロトタイプ用一覧テーブル（frontend/js/data-table.js 相当）
 * - 列ヘッダークリックでソート
 * - 列直下インラインフィルタ
 * - 表示列／順序は layout（localStorage）で後から変更可能（UIビルダー想定）
 * 一覧画面には表示列操作UIを置かない（A-08 と同じ）
 */
window.ProtoDataTable = (() => {
  function escapeHtml(s) {
    return String(s ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function loadLayout(screenKey) {
    try {
      const raw = localStorage.getItem(`proto_layout_${screenKey}`);
      return raw ? JSON.parse(raw) : null;
    } catch {
      return null;
    }
  }

  function saveLayout(screenKey, layout) {
    localStorage.setItem(`proto_layout_${screenKey}`, JSON.stringify(layout));
  }

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
    const hidden = new Set((saved?.hidden || []).filter((k) => byKey.has(k)));
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
      actionsHeader = '操作',
      renderActions,
      tableId = 'shared-data-table',
      renderHtml,
    } = options;

    const { order, hidden } = normalizeLayout(columns, layout);
    const visibleCols = order
      .map((k) => columns.find((c) => c.key === k))
      .filter((c) => c && !hidden.has(c.key));
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
        const arrow = sortKey === c.key ? (sortOrder === 'desc' ? ' ▼' : ' ▲') : '';
        return `<th class="dt-sortable" data-sort-key="${escapeHtml(c.key)}" title="クリックでソート">${escapeHtml(c.label)}${arrow}</th>`;
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
          .map((c) => {
            if (typeof renderHtml === 'function') {
              const html = renderHtml(row, c);
              if (html != null) return `<td>${html}</td>`;
            }
            return `<td>${escapeHtml(cellText(row, c))}</td>`;
          })
          .join('');
        const actions = typeof renderActions === 'function' ? renderActions(row) : '';
        return `<tr data-id="${escapeHtml(row.id || row.company_id || '')}">${cells}<td class="dt-actions">${actions}</td></tr>`;
      })
      .join('');

    return {
      html: `
        <div class="table-wrap table-wrap-sticky">
          <table class="data-table data-table-compact" id="${escapeHtml(tableId)}">
            <thead>
              <tr>${head}<th>${escapeHtml(actionsHeader)}</th></tr>
              <tr class="dt-filter-row">${filterRow}<th></th></tr>
            </thead>
            <tbody>${
              body ||
              `<tr><td colspan="${visibleCols.length + 1}">データがありません</td></tr>`
            }</tbody>
          </table>
        </div>`,
      visibleCols,
      filteredRows: filtered,
      layoutState: { order, hidden: [...hidden] },
      screenKey,
    };
  }

  function bindTable(root, handlers = {}) {
    const el = typeof root === 'string' ? document.querySelector(root) : root;
    if (!el) return;
    el.querySelectorAll('.dt-sortable').forEach((th) => {
      th.addEventListener('click', () => {
        const key = th.getAttribute('data-sort-key');
        if (key && handlers.onSort) handlers.onSort(key);
      });
    });
    el.querySelectorAll('.dt-filter').forEach((input) => {
      input.addEventListener('input', () => {
        if (!handlers.onFilter) return;
        const next = {};
        el.querySelectorAll('.dt-filter').forEach((inp) => {
          next[inp.getAttribute('data-filter-key')] = inp.value;
        });
        handlers.onFilter(next);
      });
    });
  }

  return { escapeHtml, loadLayout, saveLayout, normalizeLayout, renderTable, bindTable };
})();

// ======== DOMContentLoaded で初期化 ========
document.addEventListener('DOMContentLoaded', () => {
  initSidebar();
});
