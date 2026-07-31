// Links-System フロントエンド（SPA）
// データは常にAPI経由でMariaDBへ保存する（仕様: IndexedDBに逃がさない）。

const state = {
  token: localStorage.getItem('token') || null,
  user: JSON.parse(localStorage.getItem('user') || 'null'),
};

const $ = (sel) => document.querySelector(sel);

async function api(path, options = {}) {
  const headers = { 'Content-Type': 'application/json', ...(options.headers || {}) };
  if (state.token) headers['Authorization'] = `Bearer ${state.token}`;
  const res = await fetch(path, { ...options, headers });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `エラー (${res.status})`);
  return data;
}

function showLoggedIn() {
  $('#login-view').classList.add('hidden');
  $('#companies-view').classList.remove('hidden');
  $('#user-box').classList.remove('hidden');
  $('#user-name').textContent = `${state.user.display_name}（${state.user.role}）`;
  loadCompanies();
}

function showLoggedOut() {
  $('#login-view').classList.remove('hidden');
  $('#companies-view').classList.add('hidden');
  $('#user-box').classList.add('hidden');
}

async function loadCompanies() {
  const tbody = $('#companies-table tbody');
  tbody.innerHTML = '';
  const rows = await api('/api/companies');
  for (const c of rows) {
    const tr = document.createElement('tr');
    tr.innerHTML = `<td>${c.id}</td><td>${escapeHtml(c.name)}</td><td>${escapeHtml(c.closing_day)}</td>` +
      `<td>${escapeHtml(c.invoice_delivery_method || '')}</td><td>${escapeHtml(c.payment_due || '')}</td><td>${c.version}</td>`;
    tbody.appendChild(tr);
  }
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (ch) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[ch]));
}

$('#login-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  $('#login-error').textContent = '';
  try {
    const data = await api('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({
        login_id: $('#login-id').value,
        password: $('#login-password').value,
      }),
    });
    state.token = data.token;
    state.user = data.user;
    localStorage.setItem('token', data.token);
    localStorage.setItem('user', JSON.stringify(data.user));
    showLoggedIn();
  } catch (err) {
    $('#login-error').textContent = err.message;
  }
});

$('#company-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  $('#company-error').textContent = '';
  try {
    await api('/api/companies', {
      method: 'POST',
      body: JSON.stringify({
        name: $('#company-name').value,
        closing_day: $('#company-closing-day').value,
        invoice_delivery_method: $('#company-invoice').value,
        payment_due: $('#company-payment-due').value,
      }),
    });
    $('#company-form').reset();
    await loadCompanies();
  } catch (err) {
    $('#company-error').textContent = err.message;
  }
});

$('#logout-btn').addEventListener('click', () => {
  state.token = null;
  state.user = null;
  localStorage.removeItem('token');
  localStorage.removeItem('user');
  showLoggedOut();
});

// 起動時: トークンがあればログイン状態を復元。
if (state.token && state.user) {
  showLoggedIn();
} else {
  showLoggedOut();
}
