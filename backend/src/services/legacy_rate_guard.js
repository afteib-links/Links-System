'use strict';

function assertLegacyRateReady(analysis) {
  if (analysis?.calculation_status !== 'review_required') return;
  const error = new Error('旧Excelの料金条件に未確認事項があります。金額データ管理の「原本照合・計算ロジック」を確認してください。既存実績の金額は変更していません。');
  error.status = 422;
  error.code = 'legacy_rate_review_required';
  throw error;
}

module.exports = { assertLegacyRateReady };
