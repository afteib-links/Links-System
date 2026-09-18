const POSTAL_API_URL = 'https://zipcloud.ibsnet.co.jp/api/search';

function normalizePostalCode(value) {
  const digits = String(value || '').normalize('NFKC').replace(/\D/g, '');
  return /^\d{7}$/.test(digits) ? digits : '';
}

async function lookupPostalCode(value, options = {}) {
  const postalCode = normalizePostalCode(value);
  if (!postalCode) {
    const error = new Error('郵便番号は7桁で入力してください');
    error.statusCode = 400;
    throw error;
  }

  const fetchImpl = options.fetchImpl || global.fetch;
  if (typeof fetchImpl !== 'function') throw new Error('住所検索を利用できません');
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), options.timeoutMs || 5000);
  try {
    const response = await fetchImpl(`${POSTAL_API_URL}?zipcode=${encodeURIComponent(postalCode)}`, {
      headers: { Accept: 'application/json' },
      signal: controller.signal,
    });
    if (!response.ok) throw new Error(`住所検索サービス応答エラー: ${response.status}`);
    const data = await response.json();
    const results = Array.isArray(data?.results) ? data.results : [];
    return results.map((row) => ({
      postal_code: postalCode,
      prefecture: String(row.address1 || ''),
      city: String(row.address2 || ''),
      town: String(row.address3 || ''),
      address: `${row.address1 || ''}${row.address2 || ''}${row.address3 || ''}`,
    })).filter((row) => row.address);
  } finally {
    clearTimeout(timer);
  }
}

module.exports = { lookupPostalCode, normalizePostalCode, POSTAL_API_URL };
