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
    { key: 'companies', label: '企業マスタ', desc: '企業情報を登録・管理します', group: 'master' },
    { key: 'partners', label: 'パートナーマスタ', desc: 'パートナー企業を登録・管理します', group: 'master' },
    { key: 'base_projects', label: '基本案件', desc: '基本案件テンプレートを管理します', group: 'master' },
    { key: 'projects', label: '個別案件', desc: '個別案件を登録・管理します', group: 'master' },
    { key: 'price_sets', label: '金額データ管理', desc: '料金セットを登録・管理します', group: 'master' },
    { key: 'daily_reports', label: '日報', desc: '日々の業務内容を登録・管理します', group: 'daily' },
    { key: 'advances', label: '先払い', desc: '先払いの申請・管理を行います', group: 'billing' },
    { key: 'invoices', label: '請求', desc: '請求の作成・管理を行います', group: 'billing' },
    { key: 'payments', label: '支払', desc: '支払の処理・管理を行います', group: 'billing' },
    { key: 'cash_management', label: '入出金管理・CSV', desc: '予定・実績・確認用CSVを管理します', group: 'billing' },
    { key: 'master_settings', label: 'マスター設定', desc: '担当者・区分・システム設定', group: 'settings' },
    { key: 'ui_builder', label: 'UIビルダー', desc: '画面レイアウトを編集します', group: 'settings' },
    { key: 'users', label: 'ユーザー管理', desc: 'ユーザー情報の登録・管理を行います', group: 'settings' },
  ];

  const GROUPS = [
    { key: 'master', label: 'マスタ' },
    { key: 'daily', label: '日々の運用' },
    { key: 'billing', label: '精算' },
    { key: 'settings', label: '設定' },
  ];

  let currentUser = null;
  let featureCatalog = FEATURE_FALLBACK;
  let roleCatalog = ROLE_FALLBACK;
  let currentView = 'home';
  const SIDEBAR_STORAGE_KEY = 'links.sidebar.collapsed';
  const MOBILE_SIDEBAR_QUERY = '(max-width: 760px)';
  let shellControlsCleanup = null;

  async function api(path, options = {}) {
    const isFormData = typeof FormData !== 'undefined' && options.body instanceof FormData;
    const res = await fetch(path, {
      credentials: 'include',
      headers: {
        ...(isFormData ? {} : { 'Content-Type': 'application/json' }),
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

  function enrichFeatures(list) {
    const source = Array.isArray(list) && list.length ? list : FEATURE_FALLBACK;
    return source.map((f) => {
      const base = FEATURE_FALLBACK.find((x) => x.key === f.key) || {};
      return {
        ...base,
        ...f,
        label: f.label || base.label || f.key,
        desc: f.desc || base.desc || '',
        group: f.group || base.group || 'settings',
      };
    });
  }

  function showToast(message) {
    document.querySelectorAll('.toast').forEach((el) => el.remove());
    const el = document.createElement('div');
    el.className = 'toast';
    el.textContent = message;
    document.body.appendChild(el);
    setTimeout(() => el.remove(), 2200);
  }

  function renderLoading() {
    app.innerHTML = '<div class="loading-panel">読み込み中…</div>';
  }

  function headerHtml() {
    const rolesText = (currentUser.roles || []).map(roleLabel).join(' / ') || '権限なし';
    return `
      <header class="app-header app-topbar">
        <button class="sidebar-toggle" type="button" id="sidebar-toggle" aria-label="メニューを折り畳む" aria-expanded="true" aria-controls="app-sidebar">☰</button>
        <div class="topbar-context"><span>運送業務基幹システム</span></div>
        <div class="header-actions">
          <div class="user-pill">
            <strong>${escapeHtml(currentUser.display_name)}</strong>
            <span>${escapeHtml(rolesText)}</span>
          </div>
          <button class="btn btn-secondary" type="button" id="logout-btn">ログアウト</button>
        </div>
      </header>
    `;
  }

  function sidebarHtml(activeKey = currentView) {
    const groups = GROUPS.map((group) => {
      const items = featureCatalog.filter((feature) => feature.group === group.key && can(feature.key));
      if (!items.length) return '';
      return `<div class="sidebar-group"><div class="sidebar-group-label">${escapeHtml(group.label)}</div>${items.map((feature) => `
        <button type="button" class="sidebar-link ${activeKey === feature.key ? 'is-active' : ''}" data-nav-feature="${escapeHtml(feature.key)}" title="${escapeHtml(feature.label)}">
          <span class="sidebar-icon" aria-hidden="true">${escapeHtml(feature.label.slice(0, 1))}</span>
          <span class="sidebar-text">${escapeHtml(feature.label)}</span>
        </button>`).join('')}</div>`;
    }).join('');
    return `<aside class="app-sidebar" id="app-sidebar" aria-label="機能メニュー">
      <button type="button" class="sidebar-brand" data-nav-home title="ホーム">
        <span class="brand-symbol" aria-hidden="true">L</span><span class="sidebar-text">Links-System</span>
      </button>
      <nav class="sidebar-nav">
        <button type="button" class="sidebar-link ${activeKey === 'home' ? 'is-active' : ''}" data-nav-home title="ホーム">
          <span class="sidebar-icon" aria-hidden="true">⌂</span><span class="sidebar-text">ホーム</span>
        </button>
        ${groups}
      </nav>
    </aside><button type="button" class="sidebar-backdrop" id="sidebar-backdrop" aria-label="メニューを閉じる" tabindex="-1"></button>`;
  }

  function bindChrome() {
    shellControlsCleanup?.();
    bindLogout();
    const shell = document.querySelector('.app-shell');
    if (!shell) return;
    const media = window.matchMedia(MOBILE_SIDEBAR_QUERY);
    const toggle = document.getElementById('sidebar-toggle');
    const backdrop = document.getElementById('sidebar-backdrop');
    const sidebar = document.getElementById('app-sidebar');
    const isMobile = () => media.matches;
    const closeMobileMenu = () => {
      shell.classList.remove('mobile-menu-open');
      document.body.classList.remove('mobile-menu-visible');
    };
    const updateToggle = () => {
      const expanded = isMobile()
        ? shell.classList.contains('mobile-menu-open')
        : !shell.classList.contains('sidebar-collapsed');
      toggle?.setAttribute('aria-expanded', expanded ? 'true' : 'false');
      toggle?.setAttribute('aria-label', isMobile()
        ? (expanded ? 'メニューを閉じる' : 'メニューを開く')
        : (expanded ? 'メニューを折り畳む' : 'メニューを展開する'));
      if (isMobile()) {
        sidebar?.toggleAttribute('inert', !expanded);
        sidebar?.setAttribute('aria-hidden', expanded ? 'false' : 'true');
      } else {
        sidebar?.removeAttribute('inert');
        sidebar?.removeAttribute('aria-hidden');
      }
    };
    const applyViewportState = () => {
      closeMobileMenu();
      if (isMobile()) {
        shell.classList.remove('sidebar-collapsed');
      } else {
        shell.classList.toggle('sidebar-collapsed', localStorage.getItem(SIDEBAR_STORAGE_KEY) === '1' || window.innerWidth <= 1366);
      }
      updateToggle();
    };
    const handleToggle = () => {
      if (isMobile()) {
        shell.classList.toggle('mobile-menu-open');
        document.body.classList.toggle('mobile-menu-visible', shell.classList.contains('mobile-menu-open'));
      } else {
        shell.classList.toggle('sidebar-collapsed');
        localStorage.setItem(SIDEBAR_STORAGE_KEY, shell.classList.contains('sidebar-collapsed') ? '1' : '0');
      }
      updateToggle();
    };
    const handleEscape = (event) => {
      if (event.key === 'Escape' && shell.classList.contains('mobile-menu-open')) {
        closeMobileMenu();
        updateToggle();
        toggle?.focus();
      }
    };
    toggle?.addEventListener('click', handleToggle);
    backdrop?.addEventListener('click', handleToggle);
    document.addEventListener('keydown', handleEscape);
    media.addEventListener('change', applyViewportState);
    document.querySelectorAll('[data-nav-home]').forEach((button) => button.addEventListener('click', () => {
      closeMobileMenu();
      showHome();
    }));
    document.querySelectorAll('[data-nav-feature]').forEach((button) => button.addEventListener('click', () => {
      closeMobileMenu();
      openFeature(button.getAttribute('data-nav-feature'));
    }));
    shellControlsCleanup = () => {
      document.body.classList.remove('mobile-menu-visible');
      document.removeEventListener('keydown', handleEscape);
      media.removeEventListener('change', applyViewportState);
    };
    applyViewportState();
    queueMicrotask(() => window.LinksDataTable?.enhancePlainTables(document));
  }

  function bindLogout() {
    document.getElementById('logout-btn')?.addEventListener('click', async () => {
      await api('/api/auth/logout', { method: 'POST', body: '{}' });
      currentUser = null;
      renderLogin();
    });
  }

  function renderLogin(errorMessage = '') {
    currentView = 'login';
    app.innerHTML = `
      <div class="login-screen">
        <div class="login-inner">
          <h1 class="brand">Links-System</h1>
          <p class="login-lead">運送業務基幹システム</p>
          <p class="error" id="login-error">${escapeHtml(errorMessage)}</p>
          <form class="login-form" id="login-form">
            <div class="field">
              <label for="login_id">ログインID</label>
              <input id="login_id" name="login_id" type="text"
                placeholder="ログインIDを入力してください"
                autocomplete="username" required />
            </div>
            <div class="field">
              <label for="password">パスワード</label>
              <div class="password-wrap">
                <input id="password" name="password" type="password"
                  placeholder="パスワードを入力してください"
                  autocomplete="current-password" required />
                <button type="button" class="password-toggle" id="toggle-password" aria-label="パスワード表示切替">表示</button>
              </div>
            </div>
            <button class="btn btn-block" type="submit">ログイン</button>
          </form>
        </div>
      </div>
    `;

    const passwordInput = document.getElementById('password');
    document.getElementById('toggle-password').addEventListener('click', () => {
      const isPassword = passwordInput.type === 'password';
      passwordInput.type = isPassword ? 'text' : 'password';
      document.getElementById('toggle-password').textContent = isPassword ? '隠す' : '表示';
    });

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
      featureCatalog = enrichFeatures(data.features);
      roleCatalog = data.roles || ROLE_FALLBACK;
      await showHome();
    });
  }

  function featureContext() {
    return {
      app,
      api,
      escapeHtml,
      headerHtml,
      sidebarHtml,
      bindChrome,
      bindLogout,
      showHome,
      renderLoading,
      showToast,
      can,
      openFeature,
      currentUser,
    };
  }

  function openFeature(featureKey, options = {}) {
    currentView = featureKey;
    const ctx = featureContext();
    if (featureKey === 'companies' && window.LinksCompanies) {
      window.LinksCompanies.open(ctx);
      return;
    }
    if (featureKey === 'partners' && window.LinksPartners) {
      window.LinksPartners.open(ctx);
      return;
    }
    if (featureKey === 'base_projects' && window.LinksProjects) {
      window.LinksProjects.open(ctx, { ...options, tab: 'base', featureKey: 'base_projects' });
      return;
    }
    if (featureKey === 'projects' && window.LinksProjects) {
      window.LinksProjects.open(ctx, { ...options, tab: options.tab || 'projects', featureKey: 'projects' });
      return;
    }
    if (featureKey === 'price_sets' && window.LinksPriceSets) {
      window.LinksPriceSets.open(ctx, options);
      return;
    }
    if (featureKey === 'daily_reports' && window.LinksDailyReports) {
      window.LinksDailyReports.open(ctx);
      return;
    }
    if (featureKey === 'advances' && window.LinksAdvances) {
      window.LinksAdvances.open(ctx);
      return;
    }
    if (featureKey === 'invoices' && window.LinksInvoices) {
      window.LinksInvoices.open(ctx);
      return;
    }
    if (featureKey === 'payments' && window.LinksPayments) {
      window.LinksPayments.open(ctx);
      return;
    }
    if (featureKey === 'cash_management' && window.LinksCashManagement) {
      window.LinksCashManagement.open(ctx);
      return;
    }
    if (featureKey === 'master_settings' && window.LinksMasterSettings) {
      window.LinksMasterSettings.open(ctx);
      return;
    }
    if (featureKey === 'ui_builder' && window.LinksUiBuilder) {
      window.LinksUiBuilder.open(ctx, options);
      return;
    }
    if (featureKey === 'users') {
      showUsers();
      return;
    }
    const label = featureCatalog.find((f) => f.key === featureKey)?.label || featureKey;
    showToast(`「${label}」は準備中です`);
  }

  async function showHome() {
    currentView = 'home';
    renderLoading();

    const now = new Date();
    const ym = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    const dashboard = await api(`/api/dashboard/summary?target_year_month=${encodeURIComponent(ym)}`);
    const cards = dashboard.res.ok && dashboard.data?.ok ? dashboard.data.cards || [] : [];
    const cardsHtml = cards.map((item) => `<button type="button" class="dashboard-card" data-feature="${escapeHtml(item.feature_key)}">
      <div class="dashboard-card-head"><span>${escapeHtml(item.label)}</span><strong>${escapeHtml(item.progress_percent)}%</strong></div>
      <div class="progress-track" aria-label="${escapeHtml(item.label)}完了率 ${escapeHtml(item.progress_percent)}%"><span style="width:${Math.max(0, Math.min(100, Number(item.progress_percent || 0)))}%"></span></div>
      <div class="dashboard-card-counts"><span>全件 <strong>${escapeHtml(item.total)}</strong></span><span class="count-waiting">確認待ち <strong>${escapeHtml(item.waiting)}</strong></span><span class="count-attention">要対応 <strong>${escapeHtml(item.attention)}</strong></span><span class="count-done">完了 <strong>${escapeHtml(item.completed)}</strong></span></div>
    </button>`).join('');
    const actionCards = cards.filter((item) => item.incomplete || item.attention).map((item) => `<button type="button" class="action-item" data-feature="${escapeHtml(item.feature_key)}"><span class="status-dot tone-${item.attention ? 'attention' : 'waiting'}">${item.attention ? '!' : '◷'}</span><span><strong>${escapeHtml(item.label)}</strong><small>${item.attention ? `要対応 ${escapeHtml(item.attention)}件` : `未完了 ${escapeHtml(item.incomplete)}件`}</small></span><span aria-hidden="true">›</span></button>`).join('');

    app.innerHTML = `
      <div class="app-shell">
        ${sidebarHtml('home')}
        <div class="app-frame">${headerHtml()}
          <main class="app-main dashboard-main">
            <div class="dashboard-title"><div><p class="eyebrow">${escapeHtml(ym)} 業務状況</p><h1>業務ダッシュボード</h1><p>未完了と確認待ちを先に確認できます。</p></div></div>
            <section class="dashboard-grid">${cardsHtml || '<p class="muted">表示できる業務集計がありません。</p>'}</section>
            <section class="dashboard-section"><div class="section-head"><div><p class="eyebrow">NEXT ACTION</p><h2>次に処理する項目</h2></div></div><div class="action-list">${actionCards || '<div class="empty-state"><strong>✓ 対応が必要な項目はありません</strong><span>現在表示できる業務は完了しています。</span></div>'}</div></section>
          </main>
        </div>
      </div>
    `;

    bindChrome();
    document.querySelectorAll('[data-feature]').forEach((btn) => {
      btn.addEventListener('click', () => openFeature(btn.getAttribute('data-feature')));
    });
  }

  function roleCheckboxes(selectedKeys) {
    const selected = new Set(selectedKeys || []);
    return roleCatalog
      .map(
        (r) => `
        <label class="check-item">
          <input type="checkbox" name="role" value="${escapeHtml(r.key)}" ${selected.has(r.key) ? 'checked' : ''} />
          <span>${escapeHtml(r.label)}</span>
        </label>`
      )
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
      app.innerHTML = `
        <div class="app-shell">
          ${sidebarHtml('users')}<div class="app-frame">${headerHtml()}
          <main class="app-main">
            <section class="panel"><p class="error">${escapeHtml(data?.message || '一覧を取得できませんでした')}</p></section>
          </main>
        </div></div>`;
      bindChrome();
      return;
    }

    featureCatalog = enrichFeatures(data.features);
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
              <button type="button" class="btn btn-ghost btn-small" data-edit-user="${user.user_id}">編集</button>
              <button type="button" class="btn btn-danger btn-small" data-delete-user="${user.user_id}"
                ${Number(user.user_id) === Number(currentUser.user_id) ? 'disabled' : ''}>削除</button>
            </td>
          </tr>`;
      })
      .join('');

    app.innerHTML = `
      <div class="app-shell">
        ${sidebarHtml('users')}<div class="app-frame">${headerHtml()}
        <main class="app-main">
          <div class="page-header-row">
            <div class="back-row">
              <button type="button" class="btn btn-ghost" id="back-home">← 機能一覧へ戻る</button>
            </div>
            <h2 class="page-title">ユーザー管理</h2>
          </div>
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
          <div id="user-editor"></div>
        </main>
      </div></div>`;

    bindChrome();
    document.getElementById('back-home')?.addEventListener('click', () => showHome());
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
          <div class="form-sections"><section class="form-section-card"><h3>アカウント情報</h3><div class="form-grid form-grid-compact">
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
          </div></section><section class="form-section-card"><h3>権限・所属</h3><div class="form-grid form-grid-compact">
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
          </div></section></div>
          <div class="btn-row form-actions-sticky">
            <button class="btn" type="submit">${isNew ? '作成' : '保存'}</button>
            <button class="btn btn-ghost" type="button" id="cancel-edit">キャンセル</button>
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
      featureCatalog = enrichFeatures(data.features);
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
