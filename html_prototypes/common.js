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

// ======== DOMContentLoaded で初期化 ========
document.addEventListener('DOMContentLoaded', () => {
  initSidebar();
});
