const express = require('express');
const { getPool, query } = require('../db');
const { requireAuth, requirePermission } = require('../middleware/auth');
const { CYCLE_DAYS, asDate, businessDate } = require('../services/cash_cycle_calendar');
const {
  validateDefinition,
  buildRows,
  serializeCsv,
  checksum,
  fileName,
} = require('../services/bank_csv_export');

const router = express.Router();
router.use(requireAuth, requirePermission('cash_management'));

async function ensureCycles(ym) {
  if (!/^\d{4}-\d{2}$/.test(ym)) throw new Error('対象年月は YYYY-MM で指定してください');
  const [year, month] = ym.split('-').map(Number);
  const last = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const holidayRows = await query('SELECT holiday_date FROM holidays WHERE is_deleted = 0 AND is_active = 1 AND holiday_date BETWEEN ? AND ?', [`${ym}-01`, `${ym}-${String(last).padStart(2, '0')}`]);
  const holidays = new Set(holidayRows.map((r) => String(r.holiday_date).slice(0, 10)));
  for (const [code, day] of CYCLE_DAYS) {
    const base = `${ym}-${String(day || last).padStart(2, '0')}`;
    await query(
      `INSERT IGNORE INTO cash_cycles (target_year_month, cycle_code, base_date, planned_incoming_date, planned_outgoing_date)
       VALUES (?, ?, ?, ?, ?)`,
      [ym, code, base, businessDate(base, 'incoming', holidays), businessDate(base, 'outgoing', holidays)]
    );
  }
}
router.post('/cycles/ensure', async (req, res) => {
  try { await ensureCycles(String(req.body.target_year_month || '')); return res.json({ ok: true }); }
  catch (err) { return res.status(400).json({ ok: false, message: err.message }); }
});
router.get('/cycles', async (req, res) => {
  try {
    const ym = String(req.query.target_year_month || ''); await ensureCycles(ym);
    const cycles = await query('SELECT * FROM cash_cycles WHERE target_year_month = ? ORDER BY FIELD(cycle_code, \'05\',\'10\',\'15\',\'20\',\'25\',\'end\')', [ym]);
    return res.json({ ok: true, cycles });
  } catch (err) { return res.status(400).json({ ok: false, message: err.message }); }
});
router.get('/schedules', async (req, res) => {
  try {
    const ym = String(req.query.target_year_month || ''); await ensureCycles(ym);
    const schedules = await query(
      `SELECT s.*, c.target_year_month, c.cycle_code,
              p.bank_code, p.bank_name, p.branch_code, p.branch_name,
              p.deposit_type, p.account_number, p.account_name, p.account_name_kana,
              COALESCE((SELECT SUM(t.executed_amount) FROM cash_transactions t WHERE t.cash_schedule_id=s.cash_schedule_id AND t.status='executed'), 0) AS executed_amount,
              (SELECT t.executed_date FROM cash_transactions t WHERE t.cash_schedule_id=s.cash_schedule_id ORDER BY t.cash_transaction_id DESC LIMIT 1) AS latest_executed_date
       FROM cash_schedules s JOIN cash_cycles c ON c.cash_cycle_id = s.cash_cycle_id
       LEFT JOIN partners p ON p.partner_id=s.partner_id AND p.is_deleted=0
       WHERE c.target_year_month = ? ORDER BY s.scheduled_date, s.cash_schedule_id`, [ym]);
    return res.json({ ok: true, schedules });
  } catch (err) { return res.status(400).json({ ok: false, message: err.message }); }
});
router.post('/schedules', async (req, res) => {
  try {
    const b = req.body || {}; const cycleId = Number(b.cash_cycle_id); const amount = Number(b.amount);
    if (!cycleId || !['incoming', 'outgoing'].includes(b.direction) || !b.counterparty_name || !b.title || !(amount > 0)) throw new Error('管理回、入出金区分、相手先、件名、正の金額は必須です');
    const cycles = await query('SELECT * FROM cash_cycles WHERE cash_cycle_id = ?', [cycleId]); if (!cycles.length) throw new Error('管理回が見つかりません');
    const defaultDate = b.direction === 'outgoing' ? cycles[0].planned_outgoing_date : cycles[0].planned_incoming_date;
    if (b.scheduled_date && b.scheduled_date !== String(defaultDate).slice(0, 10) && !String(b.override_reason || '').trim()) throw new Error('個別予定日の変更理由を入力してください');
    const [result] = await getPool().query(
      `INSERT INTO cash_schedules (cash_cycle_id,direction,source_type,company_id,partner_id,project_id,counterparty_name,title,amount,scheduled_date,date_overridden,override_reason,created_by)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      [cycleId,b.direction,b.source_type || 'expense',b.company_id || null,b.partner_id || null,b.project_id || null,String(b.counterparty_name).trim(),String(b.title).trim(),amount,b.scheduled_date || defaultDate,b.scheduled_date ? 1 : 0,b.override_reason || null,req.session.user?.user_id || null]
    );
    return res.status(201).json({ ok: true, cash_schedule_id: result.insertId });
  } catch (err) { return res.status(400).json({ ok: false, message: err.message }); }
});
router.put('/schedules/:id', async (req, res) => {
  const pool=getPool(); const conn=await pool.getConnection();
  try {
    const id=Number(req.params.id); const b=req.body || {}; const cycleId=Number(b.cash_cycle_id);
    if(!id || !cycleId || !b.scheduled_date || !String(b.override_reason || '').trim()) throw new Error('管理回、個別予定日、変更理由は必須です');
    await conn.beginTransaction(); const [rows]=await conn.query('SELECT * FROM cash_schedules WHERE cash_schedule_id=? FOR UPDATE',[id]);
    if(!rows.length || !['planned','held'].includes(rows[0].status)) throw new Error('CSV出力済みまたは実行済みの予定は直接変更できません');
    const [cycles]=await conn.query('SELECT cash_cycle_id FROM cash_cycles WHERE cash_cycle_id=?',[cycleId]); if(!cycles.length) throw new Error('管理回が見つかりません');
    await conn.query('UPDATE cash_schedules SET cash_cycle_id=?, scheduled_date=?, date_overridden=1, override_reason=?, version=version+1 WHERE cash_schedule_id=?',[cycleId,b.scheduled_date,String(b.override_reason).trim(),id]);
    await conn.commit(); return res.json({ok:true});
  } catch(err) { await conn.rollback(); return res.status(400).json({ok:false,message:err.message}); } finally {conn.release();}
});
router.post('/schedules/:id/transaction', async (req, res) => {
  const pool = getPool(); const conn = await pool.getConnection();
  try {
    const id = Number(req.params.id); const b = req.body || {}; const amount = Number(b.executed_amount);
    if (!id || !b.executed_date || !(amount >= 0) || !['executed', 'held', 'cancelled'].includes(b.status)) throw new Error('実行日、金額、状態は必須です');
    if (b.status !== 'executed' && !String(b.reason || '').trim()) throw new Error('保留・取消には理由を入力してください');
    await conn.beginTransaction(); const [rows] = await conn.query('SELECT * FROM cash_schedules WHERE cash_schedule_id = ? FOR UPDATE', [id]);
    if (!rows.length || ['executed','cancelled'].includes(rows[0].status)) throw new Error('この予定は実績登録できません');
    await conn.query('INSERT INTO cash_transactions (cash_schedule_id,executed_date,executed_amount,status,reason,bank_name,created_by) VALUES (?,?,?,?,?,?,?)', [id,b.executed_date,amount,b.status,b.reason || null,b.bank_name || null,req.session.user?.user_id || null]);
    await conn.query('UPDATE cash_schedules SET status = ?, version = version + 1 WHERE cash_schedule_id = ?', [b.status, id]);
    if (rows[0].source_type === 'advance' && b.status === 'executed') {
      await conn.query("UPDATE advance_records SET status = 'executed' WHERE cash_schedule_id = ?", [id]);
    }
    await conn.commit(); return res.json({ ok: true });
  } catch (err) { await conn.rollback(); return res.status(400).json({ ok: false, message: err.message }); } finally { conn.release(); }
});
router.post('/exports', async (req, res) => {
  const pool = getPool(); const conn = await pool.getConnection();
  try {
    const cycleId = Number(req.body.cash_cycle_id); if (!cycleId) throw new Error('管理回は必須です');
    await conn.beginTransaction(); const [cycleRows] = await conn.query('SELECT * FROM cash_cycles WHERE cash_cycle_id = ? FOR UPDATE', [cycleId]); if (!cycleRows.length) throw new Error('管理回が見つかりません');
    const groupCode = String(req.body.group_code || '').trim();
    if (groupCode && !['early','middle','late'].includes(groupCode)) throw new Error('前払グループが不正です');
    const itemSql = groupCode
      ? "SELECT * FROM cash_schedules WHERE cash_cycle_id = ? AND direction = 'outgoing' AND status = 'planned' AND source_type='advance' AND JSON_UNQUOTE(JSON_EXTRACT(snapshot_json,'$.group_code'))=? FOR UPDATE"
      : "SELECT * FROM cash_schedules WHERE cash_cycle_id = ? AND direction = 'outgoing' AND status = 'planned' FOR UPDATE";
    const [items] = await conn.query(itemSql, groupCode ? [cycleId,groupCode] : [cycleId]); if (!items.length) throw new Error('出力対象の出金予定がありません');
    const prefix = groupCode ? `advance-${groupCode}` : 'cash';
    const fileName = `${prefix}-${cycleRows[0].target_year_month.replace('-', '')}-${cycleRows[0].cycle_code}.csv`;
    const [batch] = await conn.query('INSERT INTO cash_export_batches (cash_cycle_id,bank_name,file_name,created_by) VALUES (?,?,?,?)', [cycleId,req.body.bank_name || null,fileName,req.session.user?.user_id || null]);
    for (const item of items) { await conn.query('INSERT INTO cash_export_batch_items (cash_export_batch_id,cash_schedule_id) VALUES (?,?)', [batch.insertId,item.cash_schedule_id]); await conn.query("UPDATE cash_schedules SET status = 'exported', version = version + 1 WHERE cash_schedule_id = ?", [item.cash_schedule_id]); }
    await conn.commit();
    const esc = (v) => `"${String(v ?? '').replaceAll('"','""')}"`;
    const csv = ['予定日,相手先,件名,金額,予定ID', ...items.map((i) => [String(i.scheduled_date).slice(0,10),i.counterparty_name,i.title,i.amount,i.cash_schedule_id].map(esc).join(','))].join('\r\n');
    res.setHeader('Content-Type', 'text/csv; charset=utf-8'); res.setHeader('Content-Disposition', `attachment; filename=${fileName}`); return res.send(`\uFEFF${csv}`);
  } catch (err) { await conn.rollback(); return res.status(400).json({ ok: false, message: err.message }); } finally { conn.release(); }
});

function parseJson(value, fallback = null) {
  if (value == null) return fallback;
  if (typeof value === 'object') return value;
  try { return JSON.parse(value); } catch (_error) { return fallback; }
}

async function loadBankExportDefinition(conn, sourceAccountId, lock = false) {
  const suffix = lock ? ' FOR UPDATE' : '';
  const [accounts] = await conn.query(
    `SELECT a.*,p.profile_code,p.profile_name,p.bank_family,
            v.bank_export_profile_version_id,v.version_no,v.status AS profile_version_status,
            v.encoding_code,v.delimiter_text,v.quote_mode,v.quote_char,v.include_header,v.line_ending,v.file_name_pattern,v.verification_note
       FROM source_bank_accounts a
       JOIN bank_export_profiles p ON p.bank_export_profile_id=a.bank_export_profile_id AND p.is_deleted=0 AND p.is_active=1
       LEFT JOIN bank_export_profile_versions v ON v.bank_export_profile_id=p.bank_export_profile_id AND v.status='published'
      WHERE a.source_bank_account_id=? AND a.is_deleted=0 AND a.is_active=1
      ORDER BY v.version_no DESC LIMIT 1${suffix}`,
    [sourceAccountId]
  );
  if (!accounts.length) throw new Error('有効な振込元口座が見つかりません');
  const account = accounts[0];
  if (!account.bank_export_profile_version_id) throw new Error('この振込元口座の銀行CSVプロファイルは未公開です');
  if (!/^\d{4}$/.test(account.bank_code) || !/^\d{3}$/.test(account.branch_code) || !/^\d+$/.test(account.account_number) || !String(account.account_name_kana || '').trim()) {
    throw new Error('振込元口座の銀行コード・支店コード・口座番号・口座名義カナを確認してください');
  }
  const [columns] = await conn.query(
    'SELECT * FROM bank_export_columns WHERE bank_export_profile_version_id=? ORDER BY sort_order,bank_export_column_id',
    [account.bank_export_profile_version_id]
  );
  const errors = validateDefinition(account, columns);
  if (errors.length) throw new Error(errors.join('／'));
  return { account, version: account, columns };
}

function selectedScheduleIds(body) {
  return [...new Set((Array.isArray(body?.schedule_ids) ? body.schedule_ids : []).map(Number).filter(Number.isInteger))];
}

async function loadSelectedOutgoing(conn, ids, lock = false) {
  if (!ids.length) throw new Error('出力対象を1件以上選択してください');
  const marks = ids.map(() => '?').join(',');
  const [items] = await conn.query(
    `SELECT s.*,c.target_year_month,c.cycle_code,
            p.bank_code,p.bank_name,p.branch_code,p.branch_name,p.deposit_type,p.account_number,p.account_name,p.account_name_kana
       FROM cash_schedules s
       JOIN cash_cycles c ON c.cash_cycle_id=s.cash_cycle_id
       LEFT JOIN partners p ON p.partner_id=s.partner_id AND p.is_deleted=0
      WHERE s.cash_schedule_id IN (${marks})${lock ? ' FOR UPDATE' : ''}`,
    ids
  );
  if (items.length !== ids.length) throw new Error('選択した予定の一部が見つかりません。再読み込みしてください');
  if (items.some((item) => item.direction !== 'outgoing' || item.status !== 'planned')) throw new Error('出金・予定作成済み以外はCSV出力できません');
  const cycleIds = new Set(items.map((item) => Number(item.cash_cycle_id)));
  if (cycleIds.size !== 1) throw new Error('異なる管理回の予定を同じCSVへ出力できません');
  return items.sort((a, b) => Number(a.cash_schedule_id) - Number(b.cash_schedule_id));
}

router.get('/bank-export-options', async (_req, res) => {
  try {
    const rows = await query(
      `SELECT a.source_bank_account_id,a.account_label,a.bank_code,a.bank_name,a.branch_code,a.branch_name,a.deposit_type,
              CONCAT('***',RIGHT(a.account_number,4)) masked_account_number,p.profile_name,p.bank_family,
              (SELECT v.version_no FROM bank_export_profile_versions v WHERE v.bank_export_profile_id=a.bank_export_profile_id AND v.status='published' ORDER BY v.version_no DESC LIMIT 1) published_version_no
         FROM source_bank_accounts a JOIN bank_export_profiles p ON p.bank_export_profile_id=a.bank_export_profile_id
        WHERE a.is_deleted=0 AND a.is_active=1 AND p.is_deleted=0 AND p.is_active=1
        ORDER BY a.account_label,a.source_bank_account_id`
    );
    return res.json({ ok: true, accounts: rows });
  } catch (error) {
    return res.status(500).json({ ok: false, message: '振込元口座を取得できませんでした' });
  }
});

router.post('/bank-exports/preview', async (req, res) => {
  try {
    const transferDate = String(req.body?.transfer_date || '');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(transferDate)) throw new Error('振込指定日を入力してください');
    const ids = selectedScheduleIds(req.body);
    const definition = await loadBankExportDefinition(getPool(), Number(req.body.source_bank_account_id));
    const items = await loadSelectedOutgoing(getPool(), ids, false);
    const built = buildRows(items, definition.account, transferDate, definition.columns);
    return res.json({
      ok: true,
      profile: { name: definition.account.profile_name, version_no: definition.account.version_no, encoding_code: definition.version.encoding_code },
      source_account: { account_label: definition.account.account_label, bank_name: definition.account.bank_name, branch_name: definition.account.branch_name },
      columns: definition.columns.map((column) => ({ key: column.column_key, label: column.column_label })),
      rows: built.rows.slice(0, 20),
      errors: built.errors,
      total_count: items.length,
      total_amount: items.reduce((sum, item) => sum + Number(item.amount || 0), 0),
    });
  } catch (error) {
    return res.status(400).json({ ok: false, message: error.message });
  }
});

router.post('/bank-exports', async (req, res) => {
  const conn = await getPool().getConnection();
  try {
    const transferDate = String(req.body?.transfer_date || '');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(transferDate)) throw new Error('振込指定日を入力してください');
    const ids = selectedScheduleIds(req.body);
    await conn.beginTransaction();
    const definition = await loadBankExportDefinition(conn, Number(req.body.source_bank_account_id), true);
    const items = await loadSelectedOutgoing(conn, ids, true);
    const built = buildRows(items, definition.account, transferDate, definition.columns);
    if (built.errors.length) throw new Error(`銀行データに${built.errors.length}件の不備があります。プレビューを確認してください`);
    const buffer = serializeCsv(definition.version, definition.columns, built.rows);
    const digest = checksum(buffer);
    const totalAmount = items.reduce((sum, item) => sum + Number(item.amount || 0), 0);
    const cycle = items[0];
    const definitionSnapshot = JSON.stringify({
      version: {
        encoding_code: definition.version.encoding_code,
        delimiter_text: definition.version.delimiter_text,
        quote_mode: definition.version.quote_mode,
        quote_char: definition.version.quote_char,
        include_header: Number(definition.version.include_header),
        line_ending: definition.version.line_ending,
        file_name_pattern: definition.version.file_name_pattern,
      },
      columns: definition.columns,
      source_account: {
        account_label: definition.account.account_label,
        bank_code: definition.account.bank_code,
        bank_name: definition.account.bank_name,
        branch_code: definition.account.branch_code,
        branch_name: definition.account.branch_name,
        deposit_type: definition.account.deposit_type,
        account_number: definition.account.account_number,
        account_name_kana: definition.account.account_name_kana,
        client_code: definition.account.client_code,
      },
    });
    const [batch] = await conn.query(
      `INSERT INTO cash_export_batches
        (cash_cycle_id,export_kind,bank_name,source_bank_account_id,bank_export_profile_version_id,scheduled_transfer_date,definition_snapshot_json,file_checksum,total_count,total_amount,file_name,created_by)
       VALUES (?,'bank_csv',?,?,?,?,?,?,?,?,?,?)`,
      [cycle.cash_cycle_id, definition.account.bank_name, definition.account.source_bank_account_id, definition.account.bank_export_profile_version_id, transferDate, definitionSnapshot, digest, items.length, totalAmount, '', req.session.user?.user_id || null]
    );
    const outputName = fileName(definition.version.file_name_pattern, {
      transfer_date: transferDate,
      bank: definition.account.bank_name,
      cycle: cycle.cycle_code,
      batch_id: batch.insertId,
    });
    await conn.query('UPDATE cash_export_batches SET file_name=? WHERE cash_export_batch_id=?', [outputName, batch.insertId]);
    for (let index = 0; index < items.length; index += 1) {
      await conn.query(
        'INSERT INTO cash_export_batch_items (cash_export_batch_id,cash_schedule_id,export_row_no,export_row_json) VALUES (?,?,?,?)',
        [batch.insertId, items[index].cash_schedule_id, index + 1, JSON.stringify(built.rows[index].values)]
      );
      await conn.query("UPDATE cash_schedules SET status='exported',version=version+1 WHERE cash_schedule_id=? AND status='planned'", [items[index].cash_schedule_id]);
    }
    await conn.commit();
    res.setHeader('Content-Type', 'text/csv; charset=binary');
    res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(outputName)}`);
    res.setHeader('X-Cash-Export-Batch-Id', String(batch.insertId));
    return res.send(buffer);
  } catch (error) {
    await conn.rollback();
    return res.status(400).json({ ok: false, message: error.message });
  } finally {
    conn.release();
  }
});
router.get('/exports', async (req, res) => {
  try {
    const ym = String(req.query.target_year_month || ''); await ensureCycles(ym);
    const batches = await query(
      `SELECT b.*, c.target_year_month, c.cycle_code, COUNT(i.cash_schedule_id) AS item_count,
              a.account_label,p.profile_name,v.version_no AS profile_version_no
       FROM cash_export_batches b JOIN cash_cycles c ON c.cash_cycle_id=b.cash_cycle_id
       LEFT JOIN cash_export_batch_items i ON i.cash_export_batch_id=b.cash_export_batch_id AND i.status='active'
       LEFT JOIN source_bank_accounts a ON a.source_bank_account_id=b.source_bank_account_id
       LEFT JOIN bank_export_profile_versions v ON v.bank_export_profile_version_id=b.bank_export_profile_version_id
       LEFT JOIN bank_export_profiles p ON p.bank_export_profile_id=v.bank_export_profile_id
       WHERE c.target_year_month=? GROUP BY b.cash_export_batch_id ORDER BY b.cash_export_batch_id DESC`, [ym]
    );
    return res.json({ ok:true, batches });
  } catch(err) { return res.status(400).json({ok:false,message:err.message}); }
});

router.get('/exports/:id/download', async (req, res) => {
  try {
    const id = Number(req.params.id);
    const batches = await query('SELECT * FROM cash_export_batches WHERE cash_export_batch_id=?', [id]);
    if (!batches.length || batches[0].export_kind !== 'bank_csv') return res.status(404).json({ ok: false, message: '再ダウンロードできる銀行CSVが見つかりません' });
    const snapshot = parseJson(batches[0].definition_snapshot_json, {});
    const items = await query(
      `SELECT export_row_json FROM cash_export_batch_items WHERE cash_export_batch_id=? ORDER BY export_row_no,cash_schedule_id`,
      [id]
    );
    const rows = items.map((item) => ({ values: parseJson(item.export_row_json, []) }));
    const buffer = serializeCsv(snapshot.version, snapshot.columns, rows);
    if (checksum(buffer) !== batches[0].file_checksum) return res.status(409).json({ ok: false, message: '保存済みCSVの整合性を確認できませんでした' });
    res.setHeader('Content-Type', 'text/csv; charset=binary');
    res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(batches[0].file_name)}`);
    return res.send(buffer);
  } catch (error) {
    return res.status(400).json({ ok: false, message: error.message });
  }
});
router.post('/exports/:id/cancel', async (req, res) => {
  const pool=getPool(); const conn=await pool.getConnection();
  try {
    const id=Number(req.params.id); await conn.beginTransaction();
    const [batches]=await conn.query('SELECT * FROM cash_export_batches WHERE cash_export_batch_id=? FOR UPDATE',[id]);
    if(!batches.length || !['active','partially_cancelled'].includes(batches[0].status)) throw new Error('取消できるCSV出力が見つかりません');
    const [executed]=await conn.query(`SELECT COUNT(*) AS cnt FROM cash_export_batch_items i JOIN cash_schedules s ON s.cash_schedule_id=i.cash_schedule_id WHERE i.cash_export_batch_id=? AND i.status='active' AND s.status='executed'`,[id]);
    if(Number(executed[0].cnt)) throw new Error('実行済みの予定を含むCSV出力は取消できません');
    await conn.query("UPDATE cash_export_batches SET status='cancelled' WHERE cash_export_batch_id=?",[id]);
    await conn.query(`UPDATE cash_schedules s JOIN cash_export_batch_items i ON i.cash_schedule_id=s.cash_schedule_id SET s.status='planned', s.version=s.version+1 WHERE i.cash_export_batch_id=? AND i.status='active' AND s.status='exported'`,[id]);
    await conn.query(`UPDATE cash_export_batch_items SET status='cancelled',cancelled_at=CURRENT_TIMESTAMP,cancellation_reason=? WHERE cash_export_batch_id=? AND status='active'`,[String(req.body?.reason||'CSV出力取消'),id]);
    await conn.commit(); return res.json({ok:true});
  } catch(err) { await conn.rollback(); return res.status(400).json({ok:false,message:err.message}); } finally {conn.release();}
});
module.exports = { router, ensureCycles };
