/**
 * UIビルダー（仮組）
 * Step1: 機能画面 → Step2: エリア → Step3: 項目の表示／順序 → layouts API 保存
 */
(function (global) {
  'use strict';

  /** 企業／パートナーの listColumns() と同キー（仮組カタログ） */
  const SCREENS = [
    {
      key: 'companies',
      label: '企業マスタ',
      columns: [
        { key: 'company_id', label: '企業No' },
        { key: 'office_no', label: '事業所' },
        { key: 'company_name', label: '企業名' },
        { key: 'work_mode_code', label: '稼働形態' },
        { key: 'our_manager', label: '営業担当' },
        { key: 'base_project_count', label: '基本案件数' },
        { key: 'closing_date', label: '締日' },
        { key: 'invoice_send_method', label: '請求書送付' }
      ]
    },
    {
      key: 'partners',
      label: 'パートナーマスタ',
      columns: [
        { key: 'partner_id', label: 'No' },
        { key: 'partner_name', label: '名称' },
        { key: 'bank', label: '銀行' },
        { key: 'work_start_date', label: '稼働開始' },
        { key: 'continuity_years', label: '継続年数' },
        { key: 'license_expiry', label: '免許期限' },
        { key: 'insurance_badges', label: '保険' },
        { key: 'project_count', label: '案件数' }
      ]
    }
  ];

  const AREAS = [
    { key: 'list', label: 'リストエリア', supported: true },
    { key: 'header', label: 'ヘッダーエリア', supported: false }
  ];

  let ctx = null;
  let kit = null;
  let state = {
    step: 1,
    screenKey: null,
    areaKey: null,
    /** @type {{key:string,label:string,visible:boolean}[]} */
    items: []
  };

  function screenByKey(key) {
    return SCREENS.find((s) => s.key === key) || null;
  }

  function areaByKey(key) {
    return AREAS.find((a) => a.key === key) || null;
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
          <p class="muted">機能画面 → エリア → 項目の表示／順序を設定します（仮組）</p>
        </div>
        ${renderStepper()}
        <div class="ui-builder-body" style="margin-top:1rem">
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
      { n: 3, label: '項目設定' }
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
      <div class="ui-builder-cards" style="display:grid;grid-template-columns:repeat(auto-fill,minmax(200px,1fr));gap:0.75rem;margin-top:0.75rem">
        ${SCREENS.map(
          (s) => `
          <button type="button" class="btn btn-secondary ui-builder-screen" data-screen="${s.key}" style="text-align:left;padding:1rem;min-height:4.5rem">
            <strong>${escapeHtml(s.label)}</strong>
            <div class="muted" style="font-size:0.8rem;margin-top:0.25rem">${escapeHtml(s.key)}</div>
          </button>`
        ).join('')}
      </div>
    `;
  }

  function renderStep2() {
    const screen = screenByKey(state.screenKey);
    return `
      <h3>Step2. エリアを選択</h3>
      <p class="muted">対象: <strong>${escapeHtml(screen ? screen.label : state.screenKey)}</strong></p>
      <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(200px,1fr));gap:0.75rem;margin-top:0.75rem">
        ${AREAS.map(
          (a) => `
          <button type="button" class="btn btn-secondary ui-builder-area" data-area="${a.key}" style="text-align:left;padding:1rem;min-height:4.5rem">
            <strong>${escapeHtml(a.label)}</strong>
            <div class="muted" style="font-size:0.8rem;margin-top:0.25rem">${a.supported ? '項目設定可' : '未対応（選択可）'}</div>
          </button>`
        ).join('')}
      </div>
      <div style="margin-top:1rem">
        <button type="button" class="btn btn-secondary" id="ui-builder-back">戻る</button>
      </div>
    `;
  }

  function renderStep3() {
    const screen = screenByKey(state.screenKey);
    const area = areaByKey(state.areaKey);
    if (!area || !area.supported) {
      return `
        <h3>Step3. 項目設定</h3>
        <p class="muted">対象: ${escapeHtml(screen ? screen.label : '')} / ${escapeHtml(area ? area.label : state.areaKey)}</p>
        <p class="alert" style="margin-top:1rem">このエリアの項目設定は未対応です（仮組）。リストエリアを選択してください。</p>
        <div style="margin-top:1rem;display:flex;gap:0.5rem">
          <button type="button" class="btn btn-secondary" id="ui-builder-back">戻る</button>
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
          <button type="button" class="btn btn-secondary ui-builder-up" data-idx="${idx}" ${idx === 0 ? 'disabled' : ''}>↑</button>
          <button type="button" class="btn btn-secondary ui-builder-down" data-idx="${idx}" ${idx === state.items.length - 1 ? 'disabled' : ''}>↓</button>
        </td>
      </tr>`
      )
      .join('');

    return `
      <h3>Step3. 表示／非表示と順序</h3>
      <p class="muted">対象: <strong>${escapeHtml(screen ? screen.label : '')}</strong> / ${escapeHtml(area.label)}</p>
      <div class="table-wrap" style="margin-top:0.75rem">
        <table class="data-table">
          <thead>
            <tr><th>表示</th><th>項目名</th><th>キー</th><th>順序</th></tr>
          </thead>
          <tbody>${rows}</tbody>
        </table>
      </div>
      <div style="margin-top:1rem;display:flex;gap:0.5rem;flex-wrap:wrap;align-items:center">
        <button type="button" class="btn btn-secondary" id="ui-builder-back">戻る</button>
        <button type="button" class="btn btn-primary" id="ui-builder-save">保存</button>
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
        const area = areaByKey(state.areaKey);
        if (area && area.supported) {
          await loadItemsForList();
        } else {
          state.items = [];
        }
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
    if (!screen) {
      state.items = [];
      return;
    }

    const catalog = screen.columns.map((c) => ({ ...c, visible: true }));
    let layout = null;
    try {
      layout = await kit.loadLayout(state.screenKey);
    } catch (_) {
      layout = null;
    }

    const cols =
      layout && layout.columns_json && Array.isArray(layout.columns_json.columns)
        ? layout.columns_json.columns
        : catalog.map((c) => c.key);
    const hidden = new Set(
      layout && layout.columns_json && Array.isArray(layout.columns_json.hidden)
        ? layout.columns_json.hidden
        : []
    );

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
    if (!state.screenKey || state.areaKey !== 'list') {
      if (msg) msg.textContent = 'リストエリアのみ保存できます';
      return;
    }

    const columns = state.items.map((i) => i.key);
    const hidden = state.items.filter((i) => !i.visible).map((i) => i.key);
    const columnsJson = { columns, hidden };
    const layoutJson = {
      areas: {
        list: { columns, hidden },
        header: {}
      },
      updated_via: 'ui_builder'
    };

    const { res, data } = await kit.saveLayout(state.screenKey, columnsJson, layoutJson);
    if (!res.ok || !data?.ok) {
      throw new Error(data?.message || '保存に失敗しました');
    }
    if (msg) msg.textContent = '保存しました。一覧を開き直すと反映されます。';
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
