const { query } = require('../src/db');
const { createOutputGenerationService } = require('../src/services/test_data/output_generation');

function assertVerificationEnvironment(env = process.env) {
  if (env.LINKS_ENV !== 'verification' || env.TEST_DATA_TOOL_ENABLED !== 'true' || env.NODE_ENV === 'production'
    || !/^links_verification_tool_[a-z0-9_]+$/.test(env.DB_NAME || '')) {
    throw new Error('専用検証DB以外では帳票・入出金データを生成できません');
  }
}

async function main() {
  assertVerificationEnvironment();
  const [parent] = await query("SELECT * FROM test_data_settlement_generation_jobs WHERE status='completed' ORDER BY completed_at DESC LIMIT 1");
  if (!parent) throw new Error('完了した先払・請求・支払生成ジョブがありません');
  const [actor] = await query("SELECT user_id FROM users WHERE is_deleted=0 AND is_active=1 AND (role='admin' OR JSON_CONTAINS(roles,'\"admin\"')) ORDER BY user_id LIMIT 1");
  if (!actor) throw new Error('生成を記録する管理者が見つかりません');
  const service = createOutputGenerationService();
  let job = await service.enqueue(parent.settlement_job_id, actor.user_id);
  if (job.status === 'completed' && process.argv.includes('--verify')) {
    await service.run(job.id, parent, actor.user_id);
    job = await service.get(job.id);
  }
  while (!['completed','failed'].includes(job.status)) {
    await new Promise((resolve) => setTimeout(resolve, 1500));
    job = await service.get(job.id);
    process.stdout.write(`\r${job.status}: ${job.processed}/${job.total}`);
  }
  process.stdout.write('\n');
  if (job.status === 'failed') throw new Error(job.error || '生成に失敗しました');
  console.log(JSON.stringify(job.manifest, null, 2));
}

if (require.main === module) main().then(() => process.exit(0)).catch((error) => {
  console.error(error.message);
  process.exit(1);
});

module.exports = { assertVerificationEnvironment };
