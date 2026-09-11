const { randomUUID } = require('node:crypto');
const fs = require('node:fs/promises');
const path = require('node:path');
const { getPool, query } = require('../../db');
const settlementAdapter = require('../../routes/settlements').testDataAdapter;
const { ensureCycles, createBankExport } = require('../../routes/cash_management');
const { PDF_DIR, withPdfBatch } = require('../settlement_pdf');
const { serializeCsv, checksum } = require('../bank_csv_export');

const PROFILE_DEFINITIONS = [
  { code:'verification_resona', name:'検証専用・りそな型CSV', bank:'検証りそな銀行', bankCode:'9001', branchCode:'101', account:'1000001', encoding:'cp932' },
  { code:'verification_mizuho', name:'検証専用・みずほ型CSV', bank:'検証みずほ銀行', bankCode:'9002', branchCode:'102', account:'1000002', encoding:'utf8_bom' },
  { code:'verification_smbc', name:'検証専用・三井住友型CSV', bank:'検証三井住友銀行', bankCode:'9003', branchCode:'103', account:'1000003', encoding:'utf8' },
];

const BANK_COLUMNS = [
  ['transfer_date','振込指定日','transfer_date',1,'YYYYMMDD',null,8,'none',10],
  ['bank_code','銀行コード','beneficiary_bank_code',1,null,4,4,'digits',20],
  ['branch_code','支店コード','beneficiary_branch_code',1,null,3,3,'digits',30],
  ['deposit_type','口座種別','beneficiary_deposit_type',1,null,null,16,'none',40],
  ['account_number','口座番号','beneficiary_account_number',1,null,7,7,'digits',50],
  ['account_name','口座名義カナ','beneficiary_account_name_kana',1,null,null,100,'katakana',60],
  ['amount','振込金額','amount',1,null,null,14,'digits',70],
  ['schedule_id','予定ID','cash_schedule_id',0,null,null,20,'digits',80],
];

function publicOutputJob(row) {
  if (!row) return null;
  let manifest = null;
  try { manifest = row.manifest_json ? JSON.parse(row.manifest_json) : null; } catch (_error) { manifest = null; }
  return {
    id:row.output_job_id,
    settlementJobId:row.settlement_job_id,
    status:row.status,
    total:Number(row.total_count || 0),
    processed:Number(row.processed_count || 0),
    manifest,
    error:row.error_message || null,
    createdAt:row.created_at,
    completedAt:row.completed_at,
  };
}

function shiftMonth(ym, offset = 1) {
  const [year, month] = String(ym).split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1 + offset, 1));
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`;
}

function shouldExecute(targetYearMonth, index, asOf) {
  return targetYearMonth <= shiftMonth(String(asOf).slice(0,7),-2) && index % 23 !== 0;
}

async function getJob(runQuery, id) {
  const rows = await runQuery('SELECT * FROM test_data_output_generation_jobs WHERE output_job_id=?', [id]);
  return publicOutputJob(rows[0]);
}

async function ensureVerificationProfiles(runQuery, actor) {
  const accounts = [];
  for (const profile of PROFILE_DEFINITIONS) {
    await runQuery(`INSERT INTO bank_export_profiles (profile_code,profile_name,bank_family,description,is_active)
      VALUES (?,?,'verification','検証環境専用。銀行送信不可。',1)
      ON DUPLICATE KEY UPDATE profile_name=VALUES(profile_name),description=VALUES(description),is_active=1,is_deleted=0`, [profile.code,profile.name]);
    const profileRows = await runQuery('SELECT bank_export_profile_id FROM bank_export_profiles WHERE profile_code=?', [profile.code]);
    const profileId = Number(profileRows[0].bank_export_profile_id);
    await runQuery(`INSERT INTO bank_export_profile_versions
      (bank_export_profile_id,version_no,status,encoding_code,delimiter_text,quote_mode,quote_char,include_header,line_ending,file_name_pattern,verification_note,published_at,published_by,created_by)
      VALUES (?,1,'published',?,',','all','"',1,'crlf',?,'検証専用定義。実銀行へ送信しないこと。',CURRENT_TIMESTAMP,?,?)
      ON DUPLICATE KEY UPDATE status='published',encoding_code=VALUES(encoding_code),verification_note=VALUES(verification_note)`,
      [profileId,profile.encoding,`${profile.code}_{YYYYMMDD}_{cycle}_{batchId}.csv`,actor,actor]);
    const versions = await runQuery('SELECT bank_export_profile_version_id FROM bank_export_profile_versions WHERE bank_export_profile_id=? AND version_no=1', [profileId]);
    const versionId = Number(versions[0].bank_export_profile_version_id);
    for (const column of BANK_COLUMNS) {
      await runQuery(`INSERT INTO bank_export_columns
        (bank_export_profile_version_id,column_key,column_label,source_key,is_required,format_code,zero_pad_length,max_length,transform_code,sort_order)
        VALUES (?,?,?,?,?,?,?,?,?,?) ON DUPLICATE KEY UPDATE column_label=VALUES(column_label),source_key=VALUES(source_key),is_required=VALUES(is_required),format_code=VALUES(format_code),zero_pad_length=VALUES(zero_pad_length),max_length=VALUES(max_length),transform_code=VALUES(transform_code),sort_order=VALUES(sort_order)`,
        [versionId,...column]);
    }
    await runQuery(`INSERT INTO source_bank_accounts
      (account_label,bank_export_profile_id,bank_code,bank_name,branch_code,branch_name,deposit_type,account_number,account_name_kana,client_code,opening_balance,is_active)
      SELECT ?,?,?,?,?,?,'ordinary',?,'リンクスケンショウ','TEST-ONLY',50000000,1
      WHERE NOT EXISTS (SELECT 1 FROM source_bank_accounts WHERE account_label=? AND is_deleted=0)`,
      [`${profile.bank} 検証口座`,profileId,profile.bankCode,profile.bank,profile.branchCode,'検証支店',profile.account,`${profile.bank} 検証口座`]);
    const accountRows = await runQuery('SELECT source_bank_account_id FROM source_bank_accounts WHERE account_label=? AND is_deleted=0 ORDER BY source_bank_account_id DESC LIMIT 1', [`${profile.bank} 検証口座`]);
    accounts.push(Number(accountRows[0].source_bank_account_id));
  }
  return accounts;
}

async function ensurePartnerBankData(runQuery, settlementJobId) {
  const rows = await runQuery(`SELECT DISTINCT p.partner_id FROM partners p
    JOIN payments pay ON pay.partner_id=p.partner_id
    JOIN test_data_generated_settlements g ON g.settlement_type='payment' AND g.settlement_id=pay.payment_id
    WHERE g.settlement_job_id=? ORDER BY p.partner_id`, [settlementJobId]);
  for (const row of rows) {
    const id=Number(row.partner_id);
    await runQuery(`UPDATE partners SET
      bank_code=IF(bank_code REGEXP '^[0-9]{4}$',bank_code,LPAD(MOD(partner_id,9000)+1000,4,'0')),
      bank_name=COALESCE(NULLIF(bank_name,''),'検証受取銀行'),
      branch_code=IF(branch_code REGEXP '^[0-9]{3}$',branch_code,LPAD(MOD(partner_id,900)+100,3,'0')),
      branch_name=COALESCE(NULLIF(branch_name,''),'検証支店'),
      deposit_type=COALESCE(NULLIF(deposit_type,''),'ordinary'),
      account_number=IF(account_number REGEXP '^[0-9]{7}$',account_number,LPAD(MOD(partner_id,9000000)+1000000,7,'0')),
      account_name=COALESCE(NULLIF(account_name,''),CONCAT('検証名義',partner_id)),
      account_name_kana=COALESCE(NULLIF(account_name_kana,''),CONCAT('ケンショウメイギ',partner_id)),
      version=version+1 WHERE partner_id=? AND
      (bank_code IS NULL OR bank_code NOT REGEXP '^[0-9]{4}$' OR branch_code IS NULL OR branch_code NOT REGEXP '^[0-9]{3}$'
       OR account_number IS NULL OR account_number NOT REGEXP '^[0-9]{7}$' OR NULLIF(bank_name,'') IS NULL OR NULLIF(branch_name,'') IS NULL
       OR NULLIF(deposit_type,'') IS NULL OR NULLIF(account_name,'') IS NULL OR NULLIF(account_name_kana,'') IS NULL)`, [id]);
  }
  return rows.length;
}

async function finalizationPlans(runQuery, settlementJobId) {
  return runQuery(`SELECT g.settlement_type,g.settlement_id,w.status,
      CASE WHEN g.settlement_type='invoice' THEN i.target_year_month ELSE p.target_year_month END target_year_month
    FROM test_data_generated_settlements g
    JOIN settlement_workflows w ON w.settlement_type=CAST(g.settlement_type AS CHAR) COLLATE utf8mb4_unicode_ci AND w.settlement_id=g.settlement_id
    LEFT JOIN invoices i ON g.settlement_type='invoice' AND i.invoice_id=g.settlement_id
    LEFT JOIN payments p ON g.settlement_type='payment' AND p.payment_id=g.settlement_id
    WHERE g.settlement_job_id=? AND w.status IN ('approved','finalized')
    ORDER BY target_year_month,g.settlement_type,g.settlement_id`, [settlementJobId]);
}

async function cashCycleFor(runQuery, ym) {
  const cashYm=shiftMonth(ym,1);
  await ensureCycles(cashYm);
  const rows=await runQuery("SELECT cash_cycle_id FROM cash_cycles WHERE target_year_month=? AND cycle_code='end'", [cashYm]);
  if(!rows.length)throw new Error(`${cashYm} の入出金管理回を作成できません`);
  return Number(rows[0].cash_cycle_id);
}

async function recordFinalized(runQuery, outputJobId, plan) {
  const schedules=await runQuery(`SELECT cash_schedule_id FROM cash_schedules
    WHERE source_type=CAST(? AS CHAR) COLLATE utf8mb4_unicode_ci AND source_id=? ORDER BY cash_schedule_id DESC LIMIT 1`, [plan.settlement_type,plan.settlement_id]);
  const documents=await runQuery('SELECT settlement_document_id,file_path FROM settlement_documents WHERE settlement_type=? AND settlement_id=? AND status=\'issued\'', [plan.settlement_type,plan.settlement_id]);
  await runQuery(`INSERT IGNORE INTO test_data_finalized_settlements
    (output_job_id,settlement_type,settlement_id,cash_schedule_id,document_count) VALUES (?,?,?,?,?)`,
    [outputJobId,plan.settlement_type,plan.settlement_id,schedules[0]?.cash_schedule_id||null,documents.length]);
  for(const document of documents)await runQuery(`INSERT IGNORE INTO test_data_generated_output_artifacts
    (output_job_id,scenario_key,artifact_type,artifact_id,file_name) VALUES (?,?,'document',?,?)`,
    [outputJobId,`document:${document.settlement_document_id}`,document.settlement_document_id,document.file_path]);
}

async function createManualSchedules(runQuery, outputJobId, actor, asOf) {
  const existing=await runQuery("SELECT COUNT(*) count FROM test_data_generated_output_artifacts WHERE output_job_id=? AND artifact_type='manual_schedule'", [outputJobId]);
  if(Number(existing[0].count)>=6)return;
  const ym=String(asOf).slice(0,7); await ensureCycles(ym);
  const cycles=await runQuery("SELECT cash_cycle_id,planned_incoming_date,planned_outgoing_date FROM cash_cycles WHERE target_year_month=? AND cycle_code IN ('10','end') ORDER BY FIELD(cycle_code,'10','end')", [ym]);
  const names=['資料再発行費','駐車場立替精算','備品購入費','研修会場費','過入金返金','臨時交通費'];
  for(let index=0;index<6;index+=1){
    const direction=index<2?'incoming':'outgoing',cycle=cycles[index%cycles.length];
    const key=`manual:${index+1}`;
    const mapped=await runQuery('SELECT artifact_id FROM test_data_generated_output_artifacts WHERE output_job_id=? AND scenario_key=?',[outputJobId,key]);
    if(mapped.length)continue;
    const result=await runQuery(`INSERT INTO cash_schedules
      (cash_cycle_id,direction,source_type,counterparty_name,title,amount,scheduled_date,status,snapshot_json,created_by)
      VALUES (?,?, 'expense','検証用手入力先',?,?,?,'planned',?,?)`,
      [cycle.cash_cycle_id,direction,names[index],3000+index*1250,direction==='incoming'?cycle.planned_incoming_date:cycle.planned_outgoing_date,JSON.stringify({test_data:true,output_job_id:outputJobId,manual:true,reason:'検証用手入力予定'}),actor]);
    await runQuery("INSERT INTO test_data_generated_output_artifacts (output_job_id,scenario_key,artifact_type,artifact_id) VALUES (?,?,'manual_schedule',?)",[outputJobId,key,result.insertId]);
  }
}

async function createBankExports(runQuery, pool, outputJobId, settlementJobId, actor, accounts) {
  const existing=await runQuery("SELECT COUNT(*) count FROM test_data_generated_output_artifacts WHERE output_job_id=? AND artifact_type='bank_export'", [outputJobId]);
  const existingCount=Number(existing[0].count);
  if(existingCount>=3)return existingCount;
  const groups=await runQuery(`SELECT s.cash_cycle_id,MIN(s.scheduled_date) transfer_date,GROUP_CONCAT(s.cash_schedule_id ORDER BY s.cash_schedule_id) schedule_ids
    FROM cash_schedules s JOIN test_data_finalized_settlements f ON f.cash_schedule_id=s.cash_schedule_id
    WHERE f.output_job_id=? AND s.direction='outgoing' AND s.status='planned' AND s.partner_id IS NOT NULL
    GROUP BY s.cash_cycle_id ORDER BY s.cash_cycle_id LIMIT 3`, [outputJobId]);
  for(let index=0;index<groups.length;index+=1){
    const group=groups[index],key=`bank-export:${group.cash_cycle_id}`;
    const mapped=await runQuery('SELECT artifact_id FROM test_data_generated_output_artifacts WHERE output_job_id=? AND scenario_key=?',[outputJobId,key]);if(mapped.length)continue;
    const result=await createBankExport({sourceBankAccountId:accounts[index%accounts.length],requestedDate:String(group.transfer_date).slice(0,10),scheduleIds:String(group.schedule_ids).split(',').map(Number),actorUserId:actor,pool});
    await runQuery("INSERT INTO test_data_generated_output_artifacts (output_job_id,scenario_key,artifact_type,artifact_id,file_name,file_checksum) VALUES (?,?,'bank_export',?,?,?)",[outputJobId,key,result.batchId,result.outputName,result.checksum]);
  }
  return existingCount+groups.length;
}

async function createTransactions(runQuery, outputJobId, actor, asOf) {
  const schedules=await runQuery(`SELECT f.settlement_type,f.settlement_id,f.cash_schedule_id,
      CASE WHEN f.settlement_type='invoice' THEN i.target_year_month ELSE p.target_year_month END target_year_month,
      s.scheduled_date,s.amount,s.status,s.direction
    FROM test_data_finalized_settlements f
    JOIN cash_schedules s ON s.cash_schedule_id=f.cash_schedule_id
    LEFT JOIN invoices i ON f.settlement_type='invoice' AND i.invoice_id=f.settlement_id
    LEFT JOIN payments p ON f.settlement_type='payment' AND p.payment_id=f.settlement_id
    WHERE f.output_job_id=? ORDER BY target_year_month,f.settlement_type,f.settlement_id`, [outputJobId]);
  for(let index=0;index<schedules.length;index+=1){
    const row=schedules[index];if(!shouldExecute(String(row.target_year_month),index,asOf))continue;
    const key=`transaction:${row.cash_schedule_id}`;
    const mapped=await runQuery('SELECT artifact_id FROM test_data_generated_output_artifacts WHERE output_job_id=? AND scenario_key=?',[outputJobId,key]);if(mapped.length)continue;
    const result=await runQuery(`INSERT INTO cash_transactions
      (cash_schedule_id,executed_date,executed_amount,status,reason,bank_name,created_by)
      VALUES (?,?,?,'executed','検証データ：入出金実績','検証用口座',?)`,[row.cash_schedule_id,row.scheduled_date,row.amount,actor]);
    await runQuery("UPDATE cash_schedules SET status='executed',version=version+1 WHERE cash_schedule_id=? AND status IN ('planned','exported')",[row.cash_schedule_id]);
    await runQuery("INSERT INTO test_data_generated_output_artifacts (output_job_id,scenario_key,artifact_type,artifact_id) VALUES (?,?,'cash_transaction',?)",[outputJobId,key,result.insertId]);
  }
}

function createOutputGenerationService(deps={}) {
  const runQuery=deps.runQuery||query,pool=deps.pool||getPool(),dispatch=deps.dispatch||(fn=>setImmediate(fn));
  const finalize=deps.finalizeSettlement||settlementAdapter.finalizeSettlement;
  const pdfBatch=deps.withPdfBatch||withPdfBatch;
  async function list(){return (await runQuery('SELECT * FROM test_data_output_generation_jobs ORDER BY created_at DESC LIMIT 50')).map(publicOutputJob);}
  async function enqueue(settlementJobId,actor){
    const parents=await runQuery("SELECT * FROM test_data_settlement_generation_jobs WHERE settlement_job_id=? AND status='completed'",[settlementJobId]);
    if(!parents.length)throw Object.assign(new Error('完了した先払・請求・支払生成ジョブが必要です'),{status:409});
    let rows=await runQuery('SELECT * FROM test_data_output_generation_jobs WHERE settlement_job_id=?',[settlementJobId]);let job;
    if(rows.length){job=publicOutputJob(rows[0]);if(['queued','running','completed'].includes(job.status))return job;await runQuery("UPDATE test_data_output_generation_jobs SET status='queued',error_message=NULL WHERE output_job_id=?",[job.id]);job.status='queued';}
    else{const id=randomUUID();await runQuery("INSERT INTO test_data_output_generation_jobs (output_job_id,settlement_job_id,status,created_by) VALUES (?,?,'queued',?)",[id,settlementJobId,actor]);job=await getJob(runQuery,id);}
    dispatch(()=>run(job.id,parents[0],actor));return job;
  }
  async function run(outputJobId,parent,actor){
    try{
      await runQuery("UPDATE test_data_output_generation_jobs SET status='running',started_at=COALESCE(started_at,CURRENT_TIMESTAMP(3)) WHERE output_job_id=?",[outputJobId]);
      const configRows=await runQuery(`SELECT d.payload_json FROM test_data_settlement_generation_jobs s
        JOIN test_data_monthly_generation_jobs m ON m.monthly_job_id=s.monthly_job_id
        JOIN test_data_generation_jobs g ON g.job_id=m.daily_job_id
        JOIN test_data_drafts d ON d.draft_id=g.draft_id AND d.revision=g.draft_revision
        WHERE s.settlement_job_id=?`,[parent.settlement_job_id]);
      const asOf=JSON.parse(configRows[0].payload_json).asOf;
      const plans=await finalizationPlans(runQuery,parent.settlement_job_id);
      await runQuery('UPDATE test_data_output_generation_jobs SET total_count=? WHERE output_job_id=?',[plans.length+9,outputJobId]);
      await ensurePartnerBankData(runQuery,parent.settlement_job_id);
      let processed=0;
      await pdfBatch(async()=>{
        for(const plan of plans){
          const mapped=await runQuery('SELECT 1 FROM test_data_finalized_settlements WHERE output_job_id=? AND settlement_type=? AND settlement_id=?',[outputJobId,plan.settlement_type,plan.settlement_id]);
          if(!mapped.length){
            if(plan.status==='approved')await finalize({kind:plan.settlement_type,id:plan.settlement_id,cashCycleId:await cashCycleFor(runQuery,plan.target_year_month),actorUserId:actor,issuedDate:`${plan.target_year_month}-28`});
            await recordFinalized(runQuery,outputJobId,plan);
          }
          processed+=1;if(processed%10===0)await runQuery('UPDATE test_data_output_generation_jobs SET processed_count=? WHERE output_job_id=?',[processed,outputJobId]);
        }
      });
      await createManualSchedules(runQuery,outputJobId,actor,asOf);
      const accounts=await ensureVerificationProfiles(runQuery,actor);
      const exportCount=await createBankExports(runQuery,pool,outputJobId,parent.settlement_job_id,actor,accounts);
      await createTransactions(runQuery,outputJobId,actor,asOf);
      const counts=(await runQuery(`SELECT
        (SELECT COUNT(*) FROM test_data_finalized_settlements WHERE output_job_id=?) finalized,
        (SELECT COALESCE(SUM(document_count),0) FROM test_data_finalized_settlements WHERE output_job_id=?) documents,
        (SELECT COUNT(*) FROM test_data_generated_output_artifacts WHERE output_job_id=? AND artifact_type='manual_schedule') manual_schedules,
        (SELECT COUNT(*) FROM test_data_generated_output_artifacts WHERE output_job_id=? AND artifact_type='cash_transaction') transactions,
        (SELECT COUNT(*) FROM test_data_generated_output_artifacts WHERE output_job_id=? AND artifact_type='bank_export') bank_exports,
        (SELECT COUNT(*) FROM advance_payment_allocations a JOIN test_data_finalized_settlements f ON f.settlement_type='payment' AND f.settlement_id=a.payment_id WHERE f.output_job_id=? AND a.status='active') advance_allocations,
        (SELECT COUNT(*) FROM test_data_finalized_settlements f LEFT JOIN settlement_documents d ON d.settlement_type=CAST(f.settlement_type AS CHAR) COLLATE utf8mb4_unicode_ci AND d.settlement_id=f.settlement_id AND d.status='issued' WHERE f.output_job_id=? AND d.settlement_document_id IS NULL) missing_documents,
        (SELECT COUNT(*) FROM test_data_generated_output_artifacts a JOIN cash_export_batches b ON a.artifact_type='bank_export' AND a.artifact_id=b.cash_export_batch_id WHERE a.output_job_id=? AND (b.file_checksum IS NULL OR b.total_count=0)) invalid_exports`,[outputJobId,outputJobId,outputJobId,outputJobId,outputJobId,outputJobId,outputJobId,outputJobId]))[0];
      const documentRows=await runQuery(`SELECT d.file_path FROM settlement_documents d JOIN test_data_finalized_settlements f
        ON d.settlement_type=CAST(f.settlement_type AS CHAR) COLLATE utf8mb4_unicode_ci AND d.settlement_id=f.settlement_id
        WHERE f.output_job_id=? AND d.status='issued'`,[outputJobId]);
      let missingFiles=0;
      for(const document of documentRows){try{await fs.access(path.join(PDF_DIR,document.file_path));}catch(_error){missingFiles+=1;}}
      const futureRows=await runQuery(`SELECT COUNT(*) count FROM test_data_generated_output_artifacts a JOIN cash_transactions t
        ON a.artifact_type='cash_transaction' AND a.artifact_id=t.cash_transaction_id
        WHERE a.output_job_id=? AND t.executed_date>?`,[outputJobId,asOf]);
      const exportRows=await runQuery(`SELECT b.cash_export_batch_id,b.definition_snapshot_json,b.file_checksum
        FROM cash_export_batches b JOIN test_data_generated_output_artifacts a
          ON a.artifact_type='bank_export' AND a.artifact_id=b.cash_export_batch_id
        WHERE a.output_job_id=?`,[outputJobId]);
      let checksumMismatches=0;
      for(const batch of exportRows){
        const snapshot=typeof batch.definition_snapshot_json==='string'?JSON.parse(batch.definition_snapshot_json):batch.definition_snapshot_json;
        const items=await runQuery('SELECT export_row_json FROM cash_export_batch_items WHERE cash_export_batch_id=? ORDER BY export_row_no,cash_schedule_id',[batch.cash_export_batch_id]);
        const rows=items.map(item=>({values:typeof item.export_row_json==='string'?JSON.parse(item.export_row_json):item.export_row_json}));
        if(checksum(serializeCsv(snapshot.version,snapshot.columns,rows))!==batch.file_checksum)checksumMismatches+=1;
      }
      const manifest={version:1,asOf,finalized:Number(counts.finalized),documents:Number(counts.documents),documentFiles:Number(documentRows.length)-missingFiles,manualSchedules:Number(counts.manual_schedules),cashTransactions:Number(counts.transactions),bankExports:Number(counts.bank_exports),verificationProfiles:accounts.length,advanceAllocations:Number(counts.advance_allocations),missingDocuments:Number(counts.missing_documents),missingDocumentFiles:missingFiles,futureTransactions:Number(futureRows[0].count),invalidExports:Number(counts.invalid_exports),csvChecksumMismatches:checksumMismatches,formalFb:'現行未対応。検証専用銀行CSVのみ生成'};
      if(manifest.finalized!==plans.length||manifest.missingDocuments||manifest.missingDocumentFiles||manifest.futureTransactions||manifest.invalidExports||manifest.csvChecksumMismatches||manifest.manualSchedules!==6||manifest.bankExports!==Number(exportCount)||manifest.bankExports<1||manifest.bankExports>3||manifest.verificationProfiles!==3)throw new Error(`出力生成後検証に失敗しました: ${JSON.stringify(manifest)}`);
      await runQuery("UPDATE test_data_output_generation_jobs SET status='completed',processed_count=total_count,manifest_json=?,completed_at=CURRENT_TIMESTAMP(3),error_message=NULL WHERE output_job_id=?",[JSON.stringify(manifest),outputJobId]);
    }catch(error){await runQuery("UPDATE test_data_output_generation_jobs SET status='failed',error_message=? WHERE output_job_id=?",[String(error.message||error).slice(0,1000),outputJobId]);}
  }
  return {list,get:id=>getJob(runQuery,id),enqueue,run};
}

module.exports={createOutputGenerationService,publicOutputJob,shiftMonth,shouldExecute,PROFILE_DEFINITIONS};
