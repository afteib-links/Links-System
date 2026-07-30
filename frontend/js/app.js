(() => {
  const app = document.getElementById('app');

  const ROLE_LABEL = {
    admin: '管理者',
    staff: '事務担当',
  };

  async function api(path, options = {}) {
    const res = await fetch(path, {
      credentials: 'include',
      headers: {
        'Content-Type': 'application/json',
        ...(options.headers || {}),
      },
      ...options,
    });

    let data = null;
    try {
      data = await res.json();
    } catch (_err) {
      data = null;
    }

    return { res, data };
  }

  function escapeHtml(value) {
    return String(value ?? '')
      .replaceAll('&', '&amp;')
      .replaceAll('<', '&lt;')
      .replaceAll('>', '&gt;')
      .replaceAll('"', '&quot;')
      .replaceAll("'", '&#39;');
  }

  function renderLoading() {
    app.innerHTML = '<div class="loading-panel">読み込み中…</div>';
  }

  function renderLogin(errorMessage = '') {
    app.innerHTML = `
      <div class="center-wrap">
        <section class="login-card">
          <h1 class="brand">Links-System</h1>
          <p class="lead">運送業務基幹システム（基盤ログイン）</p>
          <p class="error" id="login-error">${escapeHtml(errorMessage)}</p>
          <form id="login-form">
            <label for="login_id">ログインID</label>
            <input id="login_id" name="login_id" autocomplete="username" required />
            <label for="password">パスワード</label>
            <input id="password" name="password" type="password" autocomplete="current-password" required />
            <div class="btn-row">
              <button class="btn" type="submit">ログイン</button>
            </div>
          </form>
        </section>
      </div>
    `;

    document.getElementById('login-form').addEventListener('submit', async (event) => {
      event.preventDefault();
      const loginId = document.getElementById('login_id').value.trim();
      const password = document.getElementById('password').value;
      const errorEl = document.getElementById('login-error');
      errorEl.textContent = '';

      const { res, data } = await api('/api/auth/login', {
        method: 'POST',
        body: JSON.stringify({ login_id: loginId, password }),
      });

      if (!res.ok || !data?.ok) {
        errorEl.textContent = data?.message || 'ログインに失敗しました';
        return;
      }

      await showHome(data.user);
    });
  }

  async function showHome(user) {
    renderLoading();

    const health = await api('/api/health');
    const healthOk = Boolean(health.res.ok && health.data?.ok);
    const dbStatus = healthOk ? health.data.db : 'down';

    app.innerHTML = `
      <div class="center-wrap">
        <section class="home-card">
          <div class="topbar">
            <h1 class="brand">Links-System</h1>
            <button class="btn btn-secondary" type="button" id="logout-btn">ログアウト</button>
          </div>
          <p class="lead">基盤シェルにログイン中です。マスタ機能は次フェーズで追加します。</p>
          <dl class="meta-grid">
            <dt>表示名</dt>
            <dd>${escapeHtml(user.display_name)}</dd>
            <dt>ログインID</dt>
            <dd>${escapeHtml(user.login_id)}</dd>
            <dt>ロール</dt>
            <dd>${escapeHtml(ROLE_LABEL[user.role] || user.role)}</dd>
            <dt>APIヘルス</dt>
            <dd class="${healthOk ? 'status-ok' : 'status-ng'}">
              ${healthOk ? `正常 (DB: ${escapeHtml(dbStatus)})` : '異常'}
            </dd>
          </dl>
          <p class="note">
            次の実装予定: 企業マスタ → パートナーマスタ → 案件マスタ。
            データはブラウザ内ではなく、NAS上の共有DB（MariaDB）に保存されます。
          </p>
        </section>
      </div>
    `;

    document.getElementById('logout-btn').addEventListener('click', async () => {
      await api('/api/auth/logout', { method: 'POST', body: '{}' });
      renderLogin();
    });
  }

  async function boot() {
    renderLoading();
    const { res, data } = await api('/api/auth/me');
    if (res.ok && data?.ok && data.user) {
      await showHome(data.user);
      return;
    }
    renderLogin();
  }

  boot().catch((err) => {
    console.error(err);
    renderLogin('初期化に失敗しました。サーバ起動状態を確認してください。');
  });
})();
