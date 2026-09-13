/**
 * Login.md に基づく権限・機能カタログ（06機能追加の仮キー含む）
 */

const ROLES = [
  { key: 'admin', label: '管理者' },
  { key: 'system', label: 'システム担当者' },
  { key: 'executive', label: '経営者' },
  { key: 'soumu', label: '総務' },
  { key: 'sales', label: '営業' },
  { key: 'partner', label: 'パートナー' },
  { key: 'company', label: '企業' },
];

const ROLE_KEYS = ROLES.map((r) => r.key);

const FEATURES = [
  { key: 'base_management', label: '基本管理', group: 'master' },
  { key: 'companies', label: '企業マスタ', group: 'master' },
  { key: 'partners', label: 'パートナーマスタ', group: 'master' },
  { key: 'base_projects', label: '基本案件', group: 'master' },
  { key: 'projects', label: '個別案件', group: 'master' },
  { key: 'price_sets', label: '金額データ管理', group: 'master' },
  { key: 'master_data_preparation', label: 'マスターデータ取込', group: 'system' },
  { key: 'db_import', label: 'DB取込', group: 'system' },
  { key: 'db_export', label: 'DB出力', group: 'system' },
  { key: 'master_data_export', label: 'マスターデータ出力', group: 'system' },
  { key: 'test_data', label: '検証用データ', group: 'system' },
  { key: 'calculation_rules', label: '計算ルール管理', group: 'system' },
  { key: 'office_work', label: '事務作業', group: 'daily' },
  { key: 'daily_reports', label: '日報', group: 'daily' },
  { key: 'daily_report_submissions', label: '日報提出', group: 'daily' },
  { key: 'advances', label: '先払い', group: 'billing' },
  { key: 'invoices', label: '請求', group: 'billing' },
  { key: 'payments', label: '支払', group: 'billing' },
  { key: 'cash_management', label: '入出金管理・FB出力', group: 'billing' },
  { key: 'analytics', label: '収支分析', group: 'analysis' },
  { key: 'master_settings', label: 'マスター設定', group: 'settings' },
  { key: 'help_settings', label: 'ヘルプ編集設定', group: 'system' },
  { key: 'menu_access_settings', label: '利用可能メニュー選択', group: 'system' },
  { key: 'ui_builder', label: 'UIビルダー', group: 'settings' },
  { key: 'users', label: 'ユーザー管理', group: 'settings' },
];

const FEATURE_KEYS = FEATURES.map((f) => f.key);

/** 機能キー → 利用可能な権限キー */
const FEATURE_ROLE_MAP = {
  base_management: ['admin', 'system', 'soumu'],
  companies: ['admin', 'system', 'soumu'],
  partners: ['admin', 'system', 'soumu'],
  base_projects: ['admin', 'system', 'soumu', 'sales'],
  projects: ['admin', 'system', 'soumu', 'sales'],
  price_sets: ['admin', 'system', 'soumu', 'sales'],
  master_data_preparation: ['admin', 'system'],
  db_import: ['admin', 'system'],
  db_export: ['admin', 'system'],
  master_data_export: ['admin', 'system'],
  test_data: ['admin', 'system'],
  calculation_rules: ['admin', 'system'],
  office_work: ['admin', 'soumu', 'sales', 'executive'],
  daily_reports: ['admin', 'system', 'soumu', 'sales', 'partner', 'executive'],
  daily_report_submissions: ['admin', 'system', 'soumu', 'sales', 'executive'],
  advances: ['admin', 'executive', 'soumu'],
  invoices: ['admin', 'executive', 'soumu', 'sales', 'company'],
  payments: ['admin', 'executive', 'soumu', 'sales', 'partner'],
  cash_management: ['admin', 'executive', 'soumu'],
  analytics: ['admin', 'executive', 'soumu'],
  master_settings: ['admin', 'system', 'soumu'],
  help_settings: ['admin', 'system'],
  menu_access_settings: ['admin', 'system'],
  ui_builder: ['admin', 'system'],
  users: ['admin', 'system'],
};

let activeRoleMap = FEATURE_ROLE_MAP;
function roleMatrix() {
  return Object.fromEntries(FEATURE_KEYS.map((key) => [key, [...(activeRoleMap[key] || [])]]));
}
async function refreshRoleMatrix(runQuery) {
  const rows = await runQuery('SELECT role_key,feature_key,is_allowed FROM feature_role_permissions');
  const next = Object.fromEntries(FEATURE_KEYS.map((key) => [key, [...(FEATURE_ROLE_MAP[key] || [])]]));
  for (const row of rows) {
    if (!FEATURE_KEYS.includes(row.feature_key) || !ROLE_KEYS.includes(row.role_key)) continue;
    next[row.feature_key] = next[row.feature_key].filter((role) => role !== row.role_key);
    if (Number(row.is_allowed)) next[row.feature_key].push(row.role_key);
  }
  activeRoleMap = next;
  return roleMatrix();
}

function parseJsonArray(raw) {
  if (Array.isArray(raw)) {
    return raw.map(String).filter(Boolean);
  }
  if (typeof raw === 'string') {
    try {
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed.map(String).filter(Boolean) : [];
    } catch (_err) {
      return [];
    }
  }
  return [];
}

function normalizeRoles(input) {
  if (!Array.isArray(input)) {
    return [];
  }
  return [...new Set(input.map(String))].filter((key) => ROLE_KEYS.includes(key));
}

function normalizeStringList(input) {
  if (!Array.isArray(input)) {
    return [];
  }
  return [...new Set(input.map((v) => String(v).trim()).filter(Boolean))];
}

function resolveRoles(userOrRoles) {
  if (Array.isArray(userOrRoles)) {
    return normalizeRoles(userOrRoles);
  }
  if (!userOrRoles) {
    return [];
  }
  if (Array.isArray(userOrRoles.roles)) {
    return normalizeRoles(userOrRoles.roles);
  }
  if (userOrRoles.role === 'admin') {
    return ['admin'];
  }
  if (userOrRoles.role === 'staff') {
    return ['soumu'];
  }
  return parseJsonArray(userOrRoles.roles).filter((key) => ROLE_KEYS.includes(key));
}

function featuresFromRoles(roles) {
  const roleSet = new Set(resolveRoles(roles));
  return FEATURE_KEYS.filter((featureKey) => {
    const allowedRoles = activeRoleMap[featureKey] || [];
    return allowedRoles.some((role) => roleSet.has(role));
  });
}

function hasPermission(user, featureKey) {
  return featuresFromRoles(user).includes(featureKey);
}

function publicUser(row) {
  const roles = resolveRoles(row);
  const departments = normalizeStringList(
    Array.isArray(row.departments) ? row.departments : parseJsonArray(row.departments)
  );
  const areas = normalizeStringList(
    Array.isArray(row.areas) ? row.areas : parseJsonArray(row.areas)
  );

  return {
    user_id: row.user_id,
    login_id: row.login_id,
    display_name: row.display_name,
    roles,
    permissions: featuresFromRoles(roles),
    departments,
    areas,
    company_id: row.company_id == null ? null : Number(row.company_id),
    partner_id: row.partner_id == null ? null : Number(row.partner_id),
    is_active: row.is_active === undefined ? true : Boolean(Number(row.is_active)),
  };
}

module.exports = {
  ROLES,
  ROLE_KEYS,
  FEATURES,
  FEATURE_KEYS,
  FEATURE_ROLE_MAP,
  roleMatrix,
  refreshRoleMatrix,
  parseJsonArray,
  normalizeRoles,
  normalizeStringList,
  resolveRoles,
  featuresFromRoles,
  hasPermission,
  publicUser,
};
