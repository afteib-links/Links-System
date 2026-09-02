const express = require('express');
const { getPool, query } = require('../db');
const { requireAuth, requirePermission } = require('../middleware/auth');
const { CYCLE_DAYS, asDate, businessDate } = require('../services/cash_cycle_calendar');

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
              COALESCE((SELECT SUM(t.executed_amount) FROM cash_transactions t WHERE t.cash_schedule_id=s.cash_schedule_id AND t.status='executed'), 0) AS executed_amount,
              (SELECT t.executed_date FROM cash_transactions t WHERE t.cash_schedule_id=s.cash_schedule_id ORDER BY t.cash_transaction_id DESC LIMIT 1) AS latest_executed_date
       FROM cash_schedules s JOIN cash_cycles c ON c.cash_cycle_id = s.cash_cycle_id
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
    const [items] = await conn.query("SELECT * FROM cash_schedules WHERE cash_cycle_id = ? AND direction = 'outgoing' AND status = 'planned' FOR UPDATE", [cycleId]); if (!items.length) throw new Error('出力対象の出金予定がありません');
    const fileName = `cash-${cycleRows[0].target_year_month.replace('-', '')}-${cycleRows[0].cycle_code}.csv`;
    const [batch] = await conn.query('INSERT INTO cash_export_batches (cash_cycle_id,bank_name,file_name,created_by) VALUES (?,?,?,?)', [cycleId,req.body.bank_name || null,fileName,req.session.user?.user_id || null]);
    for (const item of items) { await conn.query('INSERT INTO cash_export_batch_items (cash_export_batch_id,cash_schedule_id) VALUES (?,?)', [batch.insertId,item.cash_schedule_id]); await conn.query("UPDATE cash_schedules SET status = 'exported', version = version + 1 WHERE cash_schedule_id = ?", [item.cash_schedule_id]); }
    await conn.commit();
    const esc = (v) => `"${String(v ?? '').replaceAll('"','""')}"`;
    const csv = ['予定日,相手先,件名,金額,予定ID', ...items.map((i) => [String(i.scheduled_date).slice(0,10),i.counterparty_name,i.title,i.amount,i.cash_schedule_id].map(esc).join(','))].join('\r\n');
    res.setHeader('Content-Type', 'text/csv; charset=utf-8'); res.setHeader('Content-Disposition', `attachment; filename=${fileName}`); return res.send(`\uFEFF${csv}`);
  } catch (err) { await conn.rollback(); return res.status(400).json({ ok: false, message: err.message }); } finally { conn.release(); }
});
router.get('/exports', async (req, res) => {
  try {
    const ym = String(req.query.target_year_month || ''); await ensureCycles(ym);
    const batches = await query(
      `SELECT b.*, c.target_year_month, c.cycle_code, COUNT(i.cash_schedule_id) AS item_count
       FROM cash_export_batches b JOIN cash_cycles c ON c.cash_cycle_id=b.cash_cycle_id
       LEFT JOIN cash_export_batch_items i ON i.cash_export_batch_id=b.cash_export_batch_id
       WHERE c.target_year_month=? GROUP BY b.cash_export_batch_id ORDER BY b.cash_export_batch_id DESC`, [ym]
    );
    return res.json({ ok:true, batches });
  } catch(err) { return res.status(400).json({ok:false,message:err.message}); }
});
router.post('/exports/:id/cancel', async (req, res) => {
  const pool=getPool(); const conn=await pool.getConnection();
  try {
    const id=Number(req.params.id); await conn.beginTransaction();
    const [batches]=await conn.query('SELECT * FROM cash_export_batches WHERE cash_export_batch_id=? FOR UPDATE',[id]);
    if(!batches.length || batches[0].status !== 'active') throw new Error('取消できるCSV出力が見つかりません');
    const [executed]=await conn.query(`SELECT COUNT(*) AS cnt FROM cash_export_batch_items i JOIN cash_schedules s ON s.cash_schedule_id=i.cash_schedule_id WHERE i.cash_export_batch_id=? AND s.status='executed'`,[id]);
    if(Number(executed[0].cnt)) throw new Error('実行済みの予定を含むCSV出力は取消できません');
    await conn.query("UPDATE cash_export_batches SET status='cancelled' WHERE cash_export_batch_id=?",[id]);
    await conn.query(`UPDATE cash_schedules s JOIN cash_export_batch_items i ON i.cash_schedule_id=s.cash_schedule_id SET s.status='planned', s.version=s.version+1 WHERE i.cash_export_batch_id=? AND s.status='exported'`,[id]);
    await conn.commit(); return res.json({ok:true});
  } catch(err) { await conn.rollback(); return res.status(400).json({ok:false,message:err.message}); } finally {conn.release();}
});
module.exports = { router, ensureCycles };
