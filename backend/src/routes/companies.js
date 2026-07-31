const express = require('express');
const { pool } = require('../db');
const { requireAuth, requireAdmin } = require('../auth');

const router = express.Router();

// 企業マスタ一覧（認証済みなら参照可）。
router.get('/', requireAuth, async (req, res) => {
  const [rows] = await pool.query(
    `SELECT id, name, closing_day, invoice_delivery_method, payment_due, version, updated_at
     FROM companies WHERE is_deleted = 0 ORDER BY id DESC`
  );
  res.json(rows);
});

// 企業マスタ作成（管理者のみ）。
router.post('/', requireAuth, requireAdmin, async (req, res) => {
  const { name, closing_day, invoice_delivery_method, payment_due } = req.body || {};
  if (!name || String(name).trim() === '') {
    return res.status(400).json({ error: '企業名は必須です' });
  }
  const [result] = await pool.query(
    `INSERT INTO companies (name, closing_day, invoice_delivery_method, payment_due)
     VALUES (?, ?, ?, ?)`,
    [name, closing_day || '末日', invoice_delivery_method || null, payment_due || null]
  );
  const [rows] = await pool.query('SELECT * FROM companies WHERE id = ?', [result.insertId]);
  res.status(201).json(rows[0]);
});

// 企業マスタ更新（管理者のみ・楽観的ロック）。
router.put('/:id', requireAuth, requireAdmin, async (req, res) => {
  const { id } = req.params;
  const { name, closing_day, invoice_delivery_method, payment_due, version } = req.body || {};
  if (version === undefined || version === null) {
    return res.status(400).json({ error: 'version（版）が必要です' });
  }
  // 取得時の版と一致する場合のみ更新（他ユーザーの上書きを防ぐ）。
  const [result] = await pool.query(
    `UPDATE companies
     SET name = ?, closing_day = ?, invoice_delivery_method = ?, payment_due = ?, version = version + 1
     WHERE id = ? AND version = ? AND is_deleted = 0`,
    [name, closing_day, invoice_delivery_method, payment_due, id, version]
  );
  if (result.affectedRows === 0) {
    return res.status(409).json({
      error: '他のユーザーが先に更新しました。再読み込みしてください。',
    });
  }
  const [rows] = await pool.query('SELECT * FROM companies WHERE id = ?', [id]);
  res.json(rows[0]);
});

module.exports = router;
