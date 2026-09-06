/**
 * 一覧の表示列カタログと、UIビルダー／各画面の共通適用。
 */
(function (global) {
  'use strict';

  const SCREENS = [
    {
      key: 'companies',
      label: '企業マスタ',
      areas: [
        {
          key: 'list',
          label: 'リストエリア',
          columns: [
            { key: 'company_id', label: '企業No' },
            { key: 'company_name', label: '企業名' },
            { key: 'office_name', label: '事業所名' },
            { key: 'work_mode_code', label: '稼働形態' },
            { key: 'our_manager', label: '営業担当' },
            { key: 'base_project_count', label: '基本案件数' },
            { key: 'closing_date', label: '締日' },
            { key: 'invoice_send_method', label: '請求書送付' },
          ],
        },
      ],
    },
    {
      key: 'partners',
      label: 'パートナーマスタ',
      areas: [
        {
          key: 'list',
          label: 'リストエリア',
          columns: [
            { key: 'partner_id', label: 'No' },
            { key: 'partner_name', label: '名称' },
            { key: 'bank', label: '銀行' },
            { key: 'work_start_date', label: '稼働開始' },
            { key: 'continuity_years', label: '継続年数' },
            { key: 'license_expiry', label: '免許期限' },
            { key: 'insurance_badges', label: '保険' },
            { key: 'project_count', label: '案件数' },
          ],
        },
      ],
    },
    {
      key: 'base_projects',
      label: '基本案件',
      areas: [
        {
          key: 'list',
          label: 'リストエリア',
          columns: [
            { key: 'base_project_id', label: 'No' },
            { key: 'company_name', label: '企業' },
            { key: 'template_name', label: 'テンプレ名' },
            { key: 'default_manager', label: '担当' },
            { key: 'work_mode_code', label: '稼働形態' },
            { key: 'closing_date', label: '締日' },
          ],
        },
      ],
    },
    {
      key: 'projects',
      label: '個別案件',
      areas: [
        {
          key: 'list',
          label: 'リストエリア',
          columns: [
            { key: 'project_id', label: 'No' },
            { key: 'company_name', label: '企業' },
            { key: 'partner_name', label: 'パートナー' },
            { key: 'base_template_name', label: '基本案件' },
            { key: 'payment_type', label: '支払' },
            { key: 'closing_date', label: '締日' },
          ],
        },
      ],
    },
    {
      key: 'price_sets',
      label: '金額データ管理',
      areas: [
        {
          key: 'list',
          label: 'リストエリア',
          columns: [
            { key: 'price_set_no', label: 'No' },
            { key: 'price_set_name', label: '名称' },
            { key: 'company_name', label: '企業' },
            { key: 'link', label: '連携先' },
            { key: 'apply_start_date', label: '適用開始' },
            { key: 'apply_end_date', label: '適用終了' },
            { key: 'line_count', label: '行数' },
          ],
        },
      ],
    },
    {
      key: 'daily_reports',
      label: '日報',
      areas: [
        {
          key: 'list',
          label: '案件一覧',
          columns: [
            { key: 'project_id', label: '案件No' },
            { key: 'template_name', label: '案件名' },
            { key: 'company_name', label: '企業' },
            { key: 'partner_name', label: 'パートナー' },
            { key: 'closing_date', label: '締日' },
            { key: 'input_progress', label: '入力進捗' },
            { key: 'workflow_status', label: '月次承認状態' },
          ],
        },
      ],
    },
    {
      key: 'invoices',
      label: '請求',
      areas: [
        {
          key: 'targets',
          label: '請求対象案件',
          columns: [
            { key: 'project_id', label: '案件No' },
            { key: 'company_name', label: '会社' },
            { key: 'project_name', label: '案件名' },
            { key: 'closing_date', label: '締日' },
            { key: 'target_month', label: '対象月' },
            { key: 'amount', label: '請求予定額' },
            { key: 'status', label: '状態' },
          ],
        },
        {
          key: 'issued',
          label: '作成済み請求書',
          columns: [
            { key: 'invoice_id', label: 'No' },
            { key: 'billing_print_name', label: '請求先' },
            { key: 'closing_date', label: '締日' },
            { key: 'total_amount', label: '請求額' },
            { key: 'status', label: '状態' },
          ],
        },
      ],
    },
    {
      key: 'payments',
      label: '支払',
      areas: [
        {
          key: 'targets',
          label: '月次支払対象案件',
          columns: [
            { key: 'partner_name', label: 'パートナー' },
            { key: 'project', label: '案件' },
            { key: 'closing_date', label: '締日' },
            { key: 'gross_amount', label: '支払総額' },
            { key: 'final_transfer_amount', label: '予定振込額' },
            { key: 'status', label: '状態' },
          ],
        },
        {
          key: 'issued',
          label: '作成済み支払',
          columns: [
            { key: 'payment_id', label: 'No' },
            { key: 'partner_name', label: 'パートナー' },
            { key: 'gross_amount', label: '支払総額' },
            { key: 'final_transfer_amount', label: '最終振込額' },
            { key: 'status', label: '状態' },
          ],
        },
      ],
    },
    {
      key: 'cash_management',
      label: '入出金管理・FB出力',
      areas: [
        {
          key: 'list',
          label: '予定一覧',
          columns: [
            { key: 'cycle_code', label: '管理回' },
            { key: 'scheduled_date', label: '予定日' },
            { key: 'counterparty', label: '相手先・件名' },
            { key: 'amount', label: '予定額' },
            { key: 'executed_amount', label: '実行額' },
            { key: 'bank', label: '振込先' },
            { key: 'data_check', label: 'データ確認' },
            { key: 'status', label: '状態' },
          ],
        },
      ],
    },
    {
      key: 'users',
      label: 'ユーザー管理',
      areas: [
        {
          key: 'list',
          label: 'リストエリア',
          columns: [
            { key: 'user_id', label: 'No' },
            { key: 'login_id', label: 'ID' },
            { key: 'display_name', label: '名' },
            { key: 'roles', label: '権限' },
            { key: 'departments', label: '所属部署' },
            { key: 'areas', label: '所属エリア' },
            { key: 'is_active', label: '状態' },
          ],
        },
      ],
    },
  ];

  function screenByKey(key) {
    return SCREENS.find((screen) => screen.key === key) || null;
  }

  function areaByKey(screen, areaKey) {
    return (screen?.areas || []).find((area) => area.key === areaKey) || null;
  }

  function areaLayout(saved, areaKey) {
    if (!saved) return null;
    const fromArea = saved.layout_json && saved.layout_json.areas && saved.layout_json.areas[areaKey];
    if (fromArea && Array.isArray(fromArea.columns)) return fromArea;
    if (areaKey === 'list' && saved.columns_json) return saved.columns_json;
    return null;
  }

  function catalogKeys(screenKey, areaKey) {
    const area = areaByKey(screenByKey(screenKey), areaKey);
    return (area?.columns || []).map((column) => column.key);
  }

  function applyPlainTable(table, columns, layout) {
    if (!table || !columns || !columns.length) return;
    const normalize = global.LinksDataTable?.normalizeLayout;
    if (typeof normalize !== 'function') return;
    const { order, hidden } = normalize(columns, layout);
    const visibleKeys = order.filter((key) => !hidden.has(key));

    const splitRow = (row) => {
      const prefix = [];
      const byKey = new Map();
      const suffix = [];
      let seenData = false;
      [...row.children].forEach((cell) => {
        const key = cell.getAttribute('data-col');
        if (key) {
          seenData = true;
          byKey.set(key, cell);
        } else if (!seenData) {
          prefix.push(cell);
        } else {
          suffix.push(cell);
        }
      });
      return { prefix, byKey, suffix };
    };

    const headerSplit = table.tHead?.rows?.[0] ? splitRow(table.tHead.rows[0]) : { prefix: [], suffix: [] };
    const emptySpan = Math.max(1, headerSplit.prefix.length + visibleKeys.length + headerSplit.suffix.length);

    const reorderRow = (row) => {
      if (row.children.length === 1 && row.children[0].hasAttribute('colspan')) {
        row.children[0].colSpan = emptySpan;
        return;
      }
      const { prefix, byKey, suffix } = splitRow(row);
      if (!byKey.size) return;
      row.replaceChildren(...prefix, ...visibleKeys.map((key) => byKey.get(key)).filter(Boolean), ...suffix);
    };

    [...(table.tHead?.rows || [])].forEach(reorderRow);
    [...(table.tBodies[0]?.rows || [])].forEach(reorderRow);
  }

  function applyScreenTable(table, screenKey, areaKey, saved) {
    const area = areaByKey(screenByKey(screenKey), areaKey);
    if (!table || !area) return;
    applyPlainTable(table, area.columns, areaLayout(saved, areaKey));
  }

  global.LinksListScreens = {
    SCREENS,
    screenByKey,
    areaByKey,
    areaLayout,
    catalogKeys,
    applyPlainTable,
    applyScreenTable,
  };
})(typeof window !== 'undefined' ? window : global);
