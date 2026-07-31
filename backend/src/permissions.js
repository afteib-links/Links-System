/**
 * 機能権限カタログ
 * key: API・画面で使う識別子
 * label: 画面表示用の日本語名
 */
const FEATURES = [
  { key: 'companies', label: '企業マスタ' },
  { key: 'partners', label: 'パートナーマスタ' },
  { key: 'projects', label: '案件マスタ' },
  { key: 'daily_reports', label: '日報' },
  { key: 'advances', label: '先払い' },
  { key: 'invoices', label: '請求' },
  { key: 'payments', label: '支払' },
  { key: 'users', label: 'ユーザー管理' },
];

const FEATURE_KEYS = FEATURES.map((f) => f.key);

function allFeatureKeys() {
  return [...FEATURE_KEYS];
}

function parsePermissions(raw) {
  if (Array.isArray(raw)) {
    return raw.filter((key) => FEATURE_KEYS.includes(key));
  }
  if (typeof raw === 'string') {
    try {
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed)
        ? parsed.filter((key) => FEATURE_KEYS.includes(key))
        : [];
    } catch (_err) {
      return [];
    }
  }
  return [];
}

function normalizePermissions(input, role) {
  if (role === 'admin') {
    return allFeatureKeys();
  }
  if (!Array.isArray(input)) {
    return [];
  }
  const unique = [...new Set(input.map(String))];
  return unique.filter((key) => FEATURE_KEYS.includes(key));
}

function resolvePermissions(user) {
  if (!user) {
    return [];
  }
  if (user.role === 'admin') {
    return allFeatureKeys();
  }
  return parsePermissions(user.permissions);
}

function hasPermission(user, featureKey) {
  return resolvePermissions(user).includes(featureKey);
}

function publicUser(row) {
  const permissions = resolvePermissions({
    role: row.role,
    permissions: row.permissions,
  });
  return {
    user_id: row.user_id,
    login_id: row.login_id,
    display_name: row.display_name,
    role: row.role,
    is_active: row.is_active === undefined ? true : Boolean(Number(row.is_active)),
    permissions,
  };
}

module.exports = {
  FEATURES,
  FEATURE_KEYS,
  allFeatureKeys,
  parsePermissions,
  normalizePermissions,
  resolvePermissions,
  hasPermission,
  publicUser,
};
