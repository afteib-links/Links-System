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
  { key: 'companies', label: '企業マスタ', group: 'master' },
  { key: 'partners', label: 'パートナーマスタ', group: 'master' },
  { key: 'base_projects', label: '基本案件', group: 'master' },
  { key: 'projects', label: '個別案件', group: 'master' },
  { key: 'price_sets', label: '金額データ管理', group: 'master' },
  { key: 'daily_reports', label: '日報', group: 'daily' },
  { key: 'advances', label: '先払い', group: 'billing' },
  { key: 'invoices', label: '請求', group: 'billing' },
  { key: 'payments', label: '支払', group: 'billing' },
  { key: 'cash_management', label: '入出金管理・CSV', group: 'billing' },
  { key: 'master_settings', label: 'マスター設定', group: 'settings' },
  { key: 'ui_builder', label: 'UIビルダー', group: 'settings' },
  { key: 'users', label: 'ユーザー管理', group: 'settings' },
];

const FEATURE_KEYS = FEATURES.map((f) => f.key);

/** 機能キー → 利用可能な権限キー */
const FEATURE_ROLE_MAP = {
  companies: ['admin', 'system', 'soumu'],
  partners: ['admin', 'system', 'soumu'],
  base_projects: ['admin', 'system', 'soumu', 'sales'],
  projects: ['admin', 'system', 'soumu', 'sales'],
  price_sets: ['admin', 'system', 'soumu', 'sales'],
  daily_reports: ['admin', 'system', 'soumu', 'sales', 'partner', 'executive'],
  advances: ['admin', 'executive', 'soumu'],
  invoices: ['admin', 'executive', 'soumu', 'sales', 'company'],
  payments: ['admin', 'executive', 'soumu', 'sales', 'partner'],
  cash_management: ['admin', 'executive', 'soumu'],
  master_settings: ['admin', 'system', 'soumu'],
  ui_builder: ['admin', 'system'],
  users: ['admin', 'system'],
};

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
  if (roleSet.has('admin')) {
    return [...FEATURE_KEYS];
  }
  return FEATURE_KEYS.filter((featureKey) => {
    const allowedRoles = FEATURE_ROLE_MAP[featureKey] || [];
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
  parseJsonArray,
  normalizeRoles,
  normalizeStringList,
  resolveRoles,
  featuresFromRoles,
  hasPermission,
  publicUser,
};
