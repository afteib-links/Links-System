/**
 * UIビルダー
 * Step1: 機能画面 → Step2: エリア → Step3: 項目の表示／順序 → 会社共通 layouts API 保存
 */
(function (global) {
  'use strict';

  let ctx = null;
  let kit = null;
  let state = {
    step: 1,
    screenKey: null,
    areaKey: null,
    items: [],
  };

  function screens() {
    return global.LinksListScreens?.SCREENS || [];
  }

  function screenByKey(key) {
    return global.LinksListScreens?.screenByKey(key) || null;
  }

  function areaByKey(screen, key) {
    return global.LinksListScreens?.areaByKey(screen, key) || null;
  }

  function open(appCtx) {
    ctx = appCtx;
    kit = global.LinksFeatureKit.createFeatureKit(ctx);
    state = { step: 1, screenKey: null, areaKey: null, items: [] };
    render();
  }

  function render() {
    if (!ctx || !kit) return;
    ctx.app.innerHTML = kit.shell(
      'UIビルダー',
      `
      <section class="panel ui-builder">
        <div class="panel-header">
          <h2>UIビルダー</h2>
          <p class="muted">機能画面 → エリア → 項目の表示／順序を設定します。保存内容は全利用者の一覧に反映されます。</p>
        </div>
        ${renderStepper()}
        <div class="ui-builder-body">
          ${state.step === 1 ? renderStep1() : ''}
          ${state.step === 2 ? renderStep2() : ''}
          ${state.step === 3 ? renderStep3() : ''}
        </div>
      </section>`
    );
    kit.bindShell();
    bind();
  }

  function renderStepper() {
    const steps = [
      { n: 1, label: '機能画面' },
      { n: 2, label: 'エリア' },
      { n: 3, label: '項目設定' },
    ];
    return `
      <ol class="ui-builder-steps" style="display:flex;gap:0.75rem;list-style:none;padding:0;margin:0.75rem 0 0;flex-wrap:wrap">
        ${steps
          .map(
            (s) => `
          <li style="padding:0.35rem 0.75rem;border-radius:999px;border:1px solid #cbd5e1;font-size:0.85rem;${
            state.step === s.n
              ? 'background:#1e3a5f;color:#fff;border-color:#1e3a5f'
              : state.step > s.n
                ? 'background:#e2e8f0'
                : ''
          }">Step${s.n}. ${s.label}</li>`
          )
          .join('')}
      </ol>
    `;
  }

  function renderStep1() {
    return `
      <h3>Step1. 機能画面を選択</h3>
      <div class="ui-builder-cards">
        ${screens()
          .map(
            (s) => `
          <button type="button" class="ui-builder-card ui-builder-screen" data-screen="${s.key}">
            <strong>${escapeHtml(s.label)}</strong>
            <span class="ui-builder-card-key">${escapeHtml(s.key)}</span>
          </button>`
          )
          .join('')}
      </div>
    `;
  }

  function renderStep2() {
    const screen = screenByKey(state.screenKey);
    const areas = screen?.areas || [];
    return `
      <h3>Step2. エリアを選択</h3>
      <p class="muted">対象: <strong>${escapeHtml(screen ? screen.label : state.screenKey)}</strong></p>
      <div class="ui-builder-cards">
        ${areas
          .map(
            (a) => `
          <button type="button" class="ui-builder-card ui-builder-area" data-area="${a.key}">
            <strong>${escapeHtml(a.label)}</strong>
            <span class="ui-builder-card-key">項目設定可</span>
          </button>`
          )
          .join('')}
      </div>
      <div class="ui-builder-actions">
        <button type="button" class="btn btn-ghost" id="ui-builder-back">戻る</button>
      </div>
    `;
  }

  function renderStep3() {
    const screen = screenByKey(state.screenKey);
    const area = areaByKey(screen, state.areaKey);
    if (!area) {
      return `
        <h3>Step3. 項目設定</h3>
        <p class="alert" style="margin-top:1rem">このエリアの項目設定は未対応です。一覧エリアを選択してください。</p>
        <div class="ui-builder-actions">
          <button type="button" class="btn btn-ghost" id="ui-builder-back">戻る</button>
        </div>
      `;
    }

    const rows = state.items
      .map(
        (item, idx) => `
      <tr data-idx="${idx}">
        <td><input type="checkbox" class="ui-builder-vis" data-idx="${idx}" ${item.visible ? 'checked' : ''} aria-label="表示"></td>
        <td>${escapeHtml(item.label)}</td>
        <td class="muted" style="font-size:0.8rem">${escapeHtml(item.key)}</td>
        <td style="white-space:nowrap">
          <button type="button" class="btn btn-ghost btn-small ui-builder-up" data-idx="${idx}" ${idx === 0 ? 'disabled' : ''}>↑</button>
          <button type="button" class="btn btn-ghost btn-small ui-builder-down" data-idx="${idx}" ${idx === state.items.length - 1 ? 'disabled' : ''}>↓</button>
        </td>
      </tr>`
      )
      .join('');

    return `
      <h3>Step3. 表示／非表示と順序</h3>
      <p class="muted">対象: <strong>${escapeHtml(screen ? screen.label : '')}</strong> / ${escapeHtml(area.label)}。操作列と選択チェックは変更できません。</p>
      <div class="table-wrap" style="margin-top:0.75rem">
        <table class="data-table">
          <thead>
            <tr><th>表示</th><th>項目名</th><th>キー</th><th>順序</th></tr>
          </thead>
          <tbody>${rows}</tbody>
        </table>
      </div>
      <div class="ui-builder-actions">
        <button type="button" class="btn btn-ghost" id="ui-builder-back">戻る</button>
        <button type="button" class="btn" id="ui-builder-save">保存</button>
        <span id="ui-builder-msg" class="muted" role="status"></span>
      </div>
    `;
  }

  function bind() {
    document.querySelectorAll('.ui-builder-screen').forEach((btn) => {
      btn.addEventListener('click', () => {
        state.screenKey = btn.getAttribute('data-screen');
        state.areaKey = null;
        state.items = [];
        state.step = 2;
        render();
      });
    });

    document.querySelectorAll('.ui-builder-area').forEach((btn) => {
      btn.addEventListener('click', async () => {
        state.areaKey = btn.getAttribute('data-area');
        state.step = 3;
        await loadItemsForList();
        render();
      });
    });

    const back = document.getElementById('ui-builder-back');
    if (back) {
      back.addEventListener('click', () => {
        if (state.step === 3) {
          state.step = 2;
          state.areaKey = null;
          state.items = [];
        } else if (state.step === 2) {
          state.step = 1;
          state.screenKey = null;
        }
        render();
      });
    }

    document.querySelectorAll('.ui-builder-vis').forEach((el) => {
      el.addEventListener('change', () => {
        const idx = Number(el.getAttribute('data-idx'));
        if (state.items[idx]) state.items[idx].visible = el.checked;
      });
    });

    document.querySelectorAll('.ui-builder-up').forEach((btn) => {
      btn.addEventListener('click', () => {
        const idx = Number(btn.getAttribute('data-idx'));
        if (idx <= 0) return;
        const tmp = state.items[idx - 1];
        state.items[idx - 1] = state.items[idx];
        state.items[idx] = tmp;
        render();
      });
    });

    document.querySelectorAll('.ui-builder-down').forEach((btn) => {
      btn.addEventListener('click', () => {
        const idx = Number(btn.getAttribute('data-idx'));
        if (idx >= state.items.length - 1) return;
        const tmp = state.items[idx + 1];
        state.items[idx + 1] = state.items[idx];
        state.items[idx] = tmp;
        render();
      });
    });

    const saveBtn = document.getElementById('ui-builder-save');
    if (saveBtn) {
      saveBtn.addEventListener('click', () => {
        persistLayout().catch((err) => {
          const msg = document.getElementById('ui-builder-msg');
          if (msg) msg.textContent = err.message || String(err);
        });
      });
    }
  }

  async function loadItemsForList() {
    const screen = screenByKey(state.screenKey);
    const area = areaByKey(screen, state.areaKey);
    if (!area) {
      state.items = [];
      return;
    }

    const catalog = area.columns.map((c) => ({ ...c, visible: true }));
    let layout = null;
    try {
      const saved = await kit.loadLayout(state.screenKey);
      layout = global.LinksListScreens.areaLayout(saved, state.areaKey);
    } catch (_) {
      layout = null;
    }

    const cols = layout && Array.isArray(layout.columns) ? layout.columns : catalog.map((c) => c.key);
    const hidden = new Set(layout && Array.isArray(layout.hidden) ? layout.hidden : []);
    const byKey = Object.fromEntries(catalog.map((c) => [c.key, c]));
    const ordered = [];
    const seen = new Set();

    cols.forEach((key) => {
      const base = byKey[key];
      if (!base || seen.has(key)) return;
      ordered.push({ key, label: base.label, visible: !hidden.has(key) });
      seen.add(key);
    });
    catalog.forEach((c) => {
      if (seen.has(c.key)) return;
      ordered.push({ key: c.key, label: c.label, visible: !hidden.has(c.key) });
      seen.add(c.key);
    });

    state.items = ordered;
  }

  async function persistLayout() {
    const msg = document.getElementById('ui-builder-msg');
    const screen = screenByKey(state.screenKey);
    const area = areaByKey(screen, state.areaKey);
    if (!screen || !area) {
      if (msg) msg.textContent = '一覧エリアのみ保存できます';
      return;
    }

    const columns = state.items.map((i) => i.key);
    const hidden = state.items.filter((i) => !i.visible).map((i) => i.key);
    const areaPayload = { columns, hidden };
    const current = await kit.loadLayout(state.screenKey);
    const areas = { ...(current?.layout_json?.areas || {}) };
    areas[state.areaKey] = areaPayload;
    const primaryKey = screen.areas[0]?.key;
    const columnsJson = state.areaKey === primaryKey ? areaPayload : current?.columns_json || areaPayload;
    const layoutJson = { areas, updated_via: 'ui_builder' };

    const { res, data } = await kit.saveLayout(state.screenKey, columnsJson, layoutJson);
    if (!res.ok || !data?.ok) {
      throw new Error(data?.message || '保存に失敗しました');
    }
    if (msg) msg.textContent = '保存しました。一覧を開き直すと全利用者へ反映されます。';
  }

  function escapeHtml(value) {
    return String(value == null ? '' : value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  global.LinksUiBuilder = { open };
})(window);
