(() => {
  const app = document.getElementById('app');

  const ROLE_FALLBACK = [
    { key: 'admin', label: '管理者' },
    { key: 'system', label: 'システム担当者' },
    { key: 'executive', label: '経営者' },
    { key: 'soumu', label: '総務' },
    { key: 'sales', label: '営業' },
    { key: 'partner', label: 'パートナー' },
    { key: 'company', label: '企業' },
  ];

  const FEATURE_FALLBACK = [
    { key: 'companies', label: '企業マスタ' },
    { key: 'partners', label: 'パートナーマスタ' },
    { key: 'projects', label: '案件マスタ' },
    { key: 'daily_reports', label: '日報' },
    { key: 'advances', label: '先払い' },
    { key: 'invoices', label: '請求' },
    { key: 'payments', label: '支払' },
    { key: 'users', label: 'ユーザー管理' },
  ];

  let currentUser = null;
  let featureCatalog = FEATURE_FALLBACK;
  let roleCatalog = ROLE_FALLBACK;
  let currentView = 'home';

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

  function can(featureKey) {
    return Boolean(currentUser?.permissions?.includes(featureKey));
  }

  function roleLabel(key) {
    return roleCatalog.find((r) => r.key === key)?.label || key;
  }

  function featureLabel(key) {
    return featureCatalog.find((f) => f.key === key)?.label || key;
  }

  function renderLoading() {
    app.innerHTML = '<div class="loading-panel">読み込み中…</div>';
  }

  function shellHtml(title, bodyHtml) {
    const navItems = [
      { view: 'home', label: 'ホーム', feature: null },
      { view: 'users', label: 'ユーザー管理', feature: 'users' },
    ].filter((item) => !item.feature || can(item.feature));

    const nav = navItems
      .map(
        (item) => `
        <button type="button" class="nav-link ${currentView === item.view ? 'active' : ''}" data-view="${item.view}">
          ${escapeHtml(item.label)}
        </button>`
      )
      .join('');

    const roleChips = (currentUser?.roles || [])
      .map((key) => `<span class="chip">${escapeHtml(roleLabel(key))}</span>`)
      .join('');

    const featureChips = (currentUser?.permissions || [])
      .map((key) => `<span class="chip">${escapeHtml(featureLabel(key))}</span>`)
      .join('');

    return `
      <div class="app-shell">
        <header class="app-header">
          <div>
            <h1 class="brand brand-sm">Links-System</h1>
            <p class="header-sub">${escapeHtml(title)}</p>
          </div>
          <div class="header-actions">
            <div class="user-pill">
              <strong>${escapeHtml(currentUser.display_name)}</strong>
              <span>${escapeHtml((currentUser.roles || []).map(roleLabel).join(' / ') || '権限なし')}</span>
            </div>
            <button class="btn btn-secondary" type="button" id="logout-btn">ログアウト</button>
          </div>
        </header>
        <nav class="app-nav">${nav}</nav>
        <main class="app-main">
          ${bodyHtml}
          <section class="perm-summary">
            <h2>付与権限</h2>
            <div class="chip-row">${roleChips || '<span class="muted">なし</span>'}</div>
            <h2>利用可能な機能</h2>
            <div class="chip-row">${featureChips || '<span class="muted">なし</span>'}</div>
          </section>
        </main>
      </div>
    `;
  }

  function bindShellEvents() {
    document.getElementById('logout-btn')?.addEventListener('click', async () => {
      await api('/api/auth/logout', { method: 'POST', body: '{}' });
      currentUser = null;
      renderLogin();
    });

    document.querySelectorAll('[data-view]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const view = btn.getAttribute('data-view');
        if (view === 'users') {
          showUsers();
        } else {
          showHome();
        }
      });
    });
  }

  function renderLogin(errorMessage = '') {
    currentView = 'login';
    app.innerHTML = `
      <div class="center-wrap">
        <section class="login-card">
          <h1 class="brand">Links-System</h1>
          <p class="lead">運送業務基幹システム（ログイン）</p>
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

      currentUser = data.user;
      featureCatalog = data.features || FEATURE_FALLBACK;
      roleCatalog = data.roles || ROLE_FALLBACK;
      await showHome();
    });
  }

  async function showHome() {
    currentView = 'home';
    renderLoading();

    const health = await api('/api/health');
    const healthOk = Boolean(health.res.ok && health.data?.ok);
    const dbStatus = healthOk ? health.data.db : 'down';

    const upcoming = featureCatalog
      .filter((f) => f.key !== 'users')
      .map((f) => {
        const allowed = can(f.key);
        return `
          <li class="${allowed ? 'allowed' : 'denied'}">
            <span>${escapeHtml(f.label)}</span>
            <em>${allowed ? '利用可' : '権限なし'}</em>
          </li>`;
      })
      .join('');

    app.innerHTML = shellHtml(
      'ホーム',
      `
      <section class="panel">
        <p class="lead">ログイン中です。付与された権限に応じて利用できる機能が決まります（仕様: Login.md）。</p>
        <dl class="meta-grid">
          <dt>No</dt>
          <dd>${escapeHtml(currentUser.user_id)}</dd>
          <dt>ID</dt>
          <dd>${escapeHtml(currentUser.login_id)}</dd>
          <dt>名</dt>
          <dd>${escapeHtml(currentUser.display_name)}</dd>
          <dt>権限</dt>
          <dd>${escapeHtml((currentUser.roles || []).map(roleLabel).join('、') || 'なし')}</dd>
          <dt>所属部署</dt>
          <dd>${escapeHtml((currentUser.departments || []).join('、') || '未設定')}</dd>
          <dt>所属エリア</dt>
          <dd>${escapeHtml((currentUser.areas || []).join('、') || '未設定')}</dd>
          <dt>APIヘルス</dt>
          <dd class="${healthOk ? 'status-ok' : 'status-ng'}">
            ${healthOk ? `正常 (DB: ${escapeHtml(dbStatus)})` : '異常'}
          </dd>
        </dl>
        <h2>機能アクセス状況</h2>
        <ul class="feature-status">${upcoming}</ul>
      </section>`
    );
    bindShellEvents();
  }

  function roleCheckboxes(selectedKeys) {
    const selected = new Set(selectedKeys || []);
    return roleCatalog
      .map((r) => `
        <label class="check-item">
          <input type="checkbox" name="role" value="${escapeHtml(r.key)}" ${selected.has(r.key) ? 'checked' : ''} />
          <span>${escapeHtml(r.label)}</span>
        </label>`)
      .join('');
  }

  function readChecked(form, name) {
    return [...form.querySelectorAll(`input[name="${name}"]:checked`)].map((el) => el.value);
  }

  function listToText(values) {
    return (values || []).join('、');
  }

  function textToList(value) {
    return String(value || '')
      .split(/[,、\n]/)
      .map((v) => v.trim())
      .filter(Boolean);
  }

  async function showUsers(message = '') {
    if (!can('users')) {
      await showHome();
      return;
    }

    currentView = 'users';
    renderLoading();

    const { res, data } = await api('/api/users');
    if (!res.ok || !data?.ok) {
      app.innerHTML = shellHtml(
        'ユーザー管理',
        `<section class="panel"><p class="error">${escapeHtml(data?.message || '一覧を取得できませんでした')}</p></section>`
      );
      bindShellEvents();
      return;
    }

    featureCatalog = data.features || featureCatalog;
    roleCatalog = data.roles || roleCatalog;

    const rows = (data.users || [])
      .map((user) => {
        const roles = (user.roles || []).map(roleLabel).join('、');
        return `
          <tr>
            <td>${escapeHtml(user.user_id)}</td>
            <td>${escapeHtml(user.login_id)}</td>
            <td>${escapeHtml(user.display_name)}</td>
            <td>${escapeHtml(roles)}</td>
            <td>${escapeHtml((user.departments || []).join('、') || '-')}</td>
            <td>${escapeHtml((user.areas || []).join('、') || '-')}</td>
            <td>${user.is_active ? '<span class="status-ok">有効</span>' : '<span class="status-ng">無効</span>'}</td>
            <td>
              <button type="button" class="btn btn-secondary btn-small" data-edit-user="${user.user_id}">編集</button>
              <button type="button" class="btn btn-danger btn-small" data-delete-user="${user.user_id}"
                ${Number(user.user_id) === Number(currentUser.user_id) ? 'disabled' : ''}>削除</button>
            </td>
          </tr>`;
      })
      .join('');

    app.innerHTML = shellHtml(
      'ユーザー管理',
      `
      <section class="panel">
        ${message ? `<p class="flash">${escapeHtml(message)}</p>` : ''}
        <div class="section-head">
          <h2>ユーザー一覧</h2>
          <button type="button" class="btn" id="new-user-btn">＋ 新規ユーザー</button>
        </div>
        <div class="table-wrap">
          <table class="data-table">
            <thead>
              <tr>
                <th>No</th>
                <th>ID</th>
                <th>名</th>
                <th>権限</th>
                <th>所属部署</th>
                <th>所属エリア</th>
                <th>状態</th>
                <th>操作</th>
              </tr>
            </thead>
            <tbody>${rows || '<tr><td colspan="8">ユーザーがいません</td></tr>'}</tbody>
          </table>
        </div>
      </section>
      <div id="user-editor"></div>`
    );
    bindShellEvents();

    document.getElementById('new-user-btn')?.addEventListener('click', () => openUserEditor(null));

    document.querySelectorAll('[data-edit-user]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const id = Number(btn.getAttribute('data-edit-user'));
        const user = data.users.find((u) => Number(u.user_id) === id);
        openUserEditor(user);
      });
    });

    document.querySelectorAll('[data-delete-user]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const id = Number(btn.getAttribute('data-delete-user'));
        if (!window.confirm('このユーザーを削除（無効化）しますか？')) {
          return;
        }
        const result = await api(`/api/users/${id}`, { method: 'DELETE' });
        if (!result.res.ok || !result.data?.ok) {
          window.alert(result.data?.message || '削除に失敗しました');
          return;
        }
        await showUsers('ユーザーを削除しました');
      });
    });
  }

  function openUserEditor(user) {
    const isNew = !user;
    const editor = document.getElementById('user-editor');
    if (!editor) {
      return;
    }

    editor.innerHTML = `
      <section class="panel editor-panel">
        <h2>${isNew ? '新規ユーザー作成' : 'ユーザー編集'}</h2>
        <p class="error" id="user-edit-error"></p>
        <form id="user-edit-form">
          <div class="form-grid">
            <div>
              <label for="edit_login_id">ID</label>
              <input id="edit_login_id" ${isNew ? 'required' : 'disabled'}
                value="${escapeHtml(user?.login_id || '')}" autocomplete="off" />
            </div>
            <div>
              <label for="edit_display_name">名</label>
              <input id="edit_display_name" required value="${escapeHtml(user?.display_name || '')}" />
            </div>
            <div>
              <label for="edit_password">パスワード${isNew ? '' : '（変更時のみ）'}</label>
              <input id="edit_password" type="password" ${isNew ? 'required' : ''} autocomplete="new-password" />
            </div>
            <div class="full">
              <label class="check-item">
                <input type="checkbox" id="edit_is_active" ${user?.is_active !== false ? 'checked' : ''} />
                <span>ログインを許可する（有効）</span>
              </label>
            </div>
            <div class="full">
              <p class="field-label">権限（複数可）</p>
              <div class="check-grid">${roleCheckboxes(user?.roles || [])}</div>
            </div>
            <div>
              <label for="edit_departments">所属部署（複数可・読点区切り）</label>
              <input id="edit_departments" value="${escapeHtml(listToText(user?.departments))}" placeholder="例: 総務、営業" />
            </div>
            <div>
              <label for="edit_areas">所属エリア（複数可・読点区切り）</label>
              <input id="edit_areas" value="${escapeHtml(listToText(user?.areas))}" placeholder="例: 東京、大阪" />
            </div>
          </div>
          <div class="btn-row">
            <button class="btn" type="submit">${isNew ? '作成' : '保存'}</button>
            <button class="btn btn-secondary" type="button" id="cancel-edit">キャンセル</button>
          </div>
        </form>
      </section>
    `;

    document.getElementById('cancel-edit').addEventListener('click', () => {
      editor.innerHTML = '';
    });

    document.getElementById('user-edit-form').addEventListener('submit', async (event) => {
      event.preventDefault();
      const errorEl = document.getElementById('user-edit-error');
      errorEl.textContent = '';

      const payload = {
        display_name: document.getElementById('edit_display_name').value.trim(),
        roles: readChecked(event.currentTarget, 'role'),
        departments: textToList(document.getElementById('edit_departments').value),
        areas: textToList(document.getElementById('edit_areas').value),
        is_active: document.getElementById('edit_is_active').checked,
      };

      const password = document.getElementById('edit_password').value;
      if (password) {
        payload.password = password;
      }

      let result;
      if (isNew) {
        payload.login_id = document.getElementById('edit_login_id').value.trim();
        if (!payload.password) {
          errorEl.textContent = 'パスワードを入力してください';
          return;
        }
        result = await api('/api/users', {
          method: 'POST',
          body: JSON.stringify(payload),
        });
      } else {
        payload.version = user.version;
        result = await api(`/api/users/${user.user_id}`, {
          method: 'PUT',
          body: JSON.stringify(payload),
        });
      }

      if (!result.res.ok || !result.data?.ok) {
        errorEl.textContent = result.data?.message || '保存に失敗しました';
        return;
      }

      if (Number(result.data.user.user_id) === Number(currentUser.user_id)) {
        currentUser = { ...currentUser, ...result.data.user };
      }

      await showUsers(isNew ? 'ユーザーを作成しました' : 'ユーザーを更新しました');
    });
  }

  async function boot() {
    renderLoading();
    const { res, data } = await api('/api/auth/me');
    if (res.ok && data?.ok && data.user) {
      currentUser = data.user;
      featureCatalog = data.features || FEATURE_FALLBACK;
      roleCatalog = data.roles || ROLE_FALLBACK;
      await showHome();
      return;
    }
    renderLogin();
  }

  boot().catch((err) => {
    console.error(err);
    renderLogin('初期化に失敗しました。サーバ起動状態を確認してください。');
  });
})();
