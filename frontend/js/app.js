(() => {
  const app = document.getElementById('app');

  const ROLE_LABEL = {
    admin: '管理者',
    staff: '事務担当',
  };

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
              <span>${escapeHtml(ROLE_LABEL[currentUser.role] || currentUser.role)}</span>
            </div>
            <button class="btn btn-secondary" type="button" id="logout-btn">ログアウト</button>
          </div>
        </header>
        <nav class="app-nav">${nav}</nav>
        <main class="app-main">
          ${bodyHtml}
          <section class="perm-summary">
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

      currentUser = data.user;
      featureCatalog = data.features || FEATURE_FALLBACK;
      await showHome();
    });
  }

  async function showHome() {
    currentView = 'home';
    renderLoading();

    const health = await api('/api/health');
    const healthOk = Boolean(health.res.ok && health.data?.ok);
    const dbStatus = healthOk ? health.data.db : 'down';

    const upcoming = FEATURE_FALLBACK.filter((f) => f.key !== 'users')
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
        <p class="lead">ログイン中です。権限のある機能だけメニューとAPIで利用できます。</p>
        <dl class="meta-grid">
          <dt>表示名</dt>
          <dd>${escapeHtml(currentUser.display_name)}</dd>
          <dt>ログインID</dt>
          <dd>${escapeHtml(currentUser.login_id)}</dd>
          <dt>ロール</dt>
          <dd>${escapeHtml(ROLE_LABEL[currentUser.role] || currentUser.role)}</dd>
          <dt>APIヘルス</dt>
          <dd class="${healthOk ? 'status-ok' : 'status-ng'}">
            ${healthOk ? `正常 (DB: ${escapeHtml(dbStatus)})` : '異常'}
          </dd>
        </dl>
        <h2>機能アクセス状況</h2>
        <ul class="feature-status">${upcoming}</ul>
        ${
          can('users')
            ? '<p class="note">ユーザー管理から、各ユーザーのログイン可否と利用機能を設定できます。</p>'
            : '<p class="note">ユーザー管理権限がないため、権限変更は管理者に依頼してください。</p>'
        }
      </section>`
    );
    bindShellEvents();
  }

  function permissionCheckboxes(selectedKeys, role, disabledAll = false) {
    const selected = new Set(selectedKeys || []);
    const locked = role === 'admin';
    return featureCatalog
      .map((f) => {
        const checked = locked || selected.has(f.key);
        return `
          <label class="check-item">
            <input type="checkbox" name="perm" value="${escapeHtml(f.key)}"
              ${checked ? 'checked' : ''} ${locked || disabledAll ? 'disabled' : ''} />
            <span>${escapeHtml(f.label)}</span>
          </label>`;
      })
      .join('');
  }

  function readPermissionInputs(form) {
    return [...form.querySelectorAll('input[name="perm"]:checked')].map((el) => el.value);
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
    const rows = (data.users || [])
      .map((user) => {
        const perms = (user.permissions || []).map((k) => featureLabel(k)).join('、');
        return `
          <tr>
            <td>${escapeHtml(user.login_id)}</td>
            <td>${escapeHtml(user.display_name)}</td>
            <td>${escapeHtml(ROLE_LABEL[user.role] || user.role)}</td>
            <td>${user.is_active ? '<span class="status-ok">有効</span>' : '<span class="status-ng">無効</span>'}</td>
            <td class="perm-cell">${escapeHtml(perms)}</td>
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
                <th>ログインID</th>
                <th>表示名</th>
                <th>ロール</th>
                <th>状態</th>
                <th>利用可能機能</th>
                <th>操作</th>
              </tr>
            </thead>
            <tbody>${rows || '<tr><td colspan="6">ユーザーがいません</td></tr>'}</tbody>
          </table>
        </div>
      </section>
      <div id="user-editor"></div>`
    );
    bindShellEvents();

    document.getElementById('new-user-btn')?.addEventListener('click', () => {
      openUserEditor(null);
    });

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
    const role = user?.role || 'staff';
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
              <label for="edit_login_id">ログインID</label>
              <input id="edit_login_id" ${isNew ? 'required' : 'disabled'}
                value="${escapeHtml(user?.login_id || '')}" autocomplete="off" />
            </div>
            <div>
              <label for="edit_display_name">表示名</label>
              <input id="edit_display_name" required value="${escapeHtml(user?.display_name || '')}" />
            </div>
            <div>
              <label for="edit_role">ロール</label>
              <select id="edit_role">
                <option value="staff" ${role === 'staff' ? 'selected' : ''}>事務担当</option>
                <option value="admin" ${role === 'admin' ? 'selected' : ''}>管理者</option>
              </select>
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
              <p class="field-label">利用できる機能</p>
              <p class="hint">管理者ロールは全機能が自動で付与されます。</p>
              <div class="check-grid" id="perm-grid">
                ${permissionCheckboxes(user?.permissions || [], role)}
              </div>
            </div>
          </div>
          <div class="btn-row">
            <button class="btn" type="submit">${isNew ? '作成' : '保存'}</button>
            <button class="btn btn-secondary" type="button" id="cancel-edit">キャンセル</button>
          </div>
        </form>
      </section>
    `;

    const roleSelect = document.getElementById('edit_role');
    const refreshPerms = () => {
      const selectedRole = roleSelect.value;
      const currentChecked = readPermissionInputs(document.getElementById('user-edit-form'));
      document.getElementById('perm-grid').innerHTML = permissionCheckboxes(
        selectedRole === 'admin' ? featureCatalog.map((f) => f.key) : currentChecked,
        selectedRole
      );
    };
    roleSelect.addEventListener('change', refreshPerms);

    document.getElementById('cancel-edit').addEventListener('click', () => {
      editor.innerHTML = '';
    });

    document.getElementById('user-edit-form').addEventListener('submit', async (event) => {
      event.preventDefault();
      const errorEl = document.getElementById('user-edit-error');
      errorEl.textContent = '';

      const payload = {
        display_name: document.getElementById('edit_display_name').value.trim(),
        role: document.getElementById('edit_role').value,
        is_active: document.getElementById('edit_is_active').checked,
        permissions: readPermissionInputs(event.currentTarget),
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
        currentUser = {
          ...currentUser,
          ...result.data.user,
        };
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
