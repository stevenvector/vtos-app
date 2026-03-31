const express = require('express');
const { body, query, validationResult } = require('express-validator');
const pool    = require('../db/connection');
const { requireAuth, requireAdmin } = require('../middleware/auth');

const router = express.Router();

// ── POST /api/quotes — public submission ──────────────
router.post('/', [
  body('name').trim().notEmpty().withMessage('Name is required'),
  body('email').isEmail().normalizeEmail().withMessage('Valid email required'),
  body('service').trim().notEmpty().withMessage('Service is required'),
  body('description').trim().isLength({ min: 10 }).withMessage('Description too short'),
  body('company').optional().trim(),
  body('phone').optional().trim(),
  body('budget').optional().trim(),
  body('wants_consult').optional().isBoolean(),
], async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

  const { name, company, email, phone, service, budget, description, wants_consult } = req.body;
  const userId = req.user?.id || null; // attach if logged in

  try {
    const result = await pool.query(
      `INSERT INTO quotes (name, company, email, phone, service, budget, description, wants_consult, submitted_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
       RETURNING id, name, email, service, status, created_at`,
      [name, company || null, email, phone || null, service, budget || null, description, wants_consult ?? false, userId]
    );

    res.status(201).json({
      message: 'Quote request received. We will get back to you within 24 hours.',
      quote: result.rows[0],
    });
  } catch (err) {
    console.error('[Quotes] Submit error:', err.message);
    res.status(500).json({ error: 'Submission failed. Please try again.' });
  }
});

// ── GET /api/quotes/my — client: own quotes ───────────
router.get('/my', requireAuth, async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT id, name, service, budget, status, wants_consult, created_at, updated_at
       FROM quotes WHERE email = (SELECT email FROM users WHERE id = $1)
       ORDER BY created_at DESC`,
      [req.user.id]
    );
    res.json(result.rows);
  } catch (err) {
    console.error('[Quotes] My quotes error:', err.message);
    res.status(500).json({ error: 'Server error.' });
  }
});

// ── GET /api/quotes — admin: all quotes ──────────────
router.get('/', requireAuth, requireAdmin, [
  query('status').optional().isIn(['new','contacted','in_progress','converted','closed']),
  query('limit').optional().isInt({ min: 1, max: 100 }),
  query('offset').optional().isInt({ min: 0 }),
], async (req, res) => {
  const { status, limit = 50, offset = 0 } = req.query;

  try {
    let sql    = `SELECT * FROM quotes`;
    const vals = [];

    if (status) {
      sql += ` WHERE status = $${vals.length + 1}`;
      vals.push(status);
    }

    sql += ` ORDER BY created_at DESC LIMIT $${vals.length+1} OFFSET $${vals.length+2}`;
    vals.push(Number(limit), Number(offset));

    const [rows, count] = await Promise.all([
      pool.query(sql, vals),
      pool.query(`SELECT COUNT(*) FROM quotes${status ? ' WHERE status=$1' : ''}`, status ? [status] : []),
    ]);

    res.json({ quotes: rows.rows, total: parseInt(count.rows[0].count) });
  } catch (err) {
    console.error('[Quotes] List error:', err.message);
    res.status(500).json({ error: 'Server error.' });
  }
});

// ── GET /api/quotes/:id — admin: single quote ─────────
router.get('/:id', requireAuth, requireAdmin, async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM quotes WHERE id = $1', [req.params.id]);
    if (result.rowCount === 0) return res.status(404).json({ error: 'Quote not found.' });
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: 'Server error.' });
  }
});

// ── PATCH /api/quotes/:id — admin: update status/notes ─
router.patch('/:id', requireAuth, requireAdmin, [
  body('status').optional().isIn(['new','contacted','in_progress','converted','closed']),
  body('admin_notes').optional().trim(),
], async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

  const { status, admin_notes } = req.body;

  try {
    const result = await pool.query(
      `UPDATE quotes SET
        status      = COALESCE($1, status),
        admin_notes = COALESCE($2, admin_notes)
       WHERE id = $3
       RETURNING *`,
      [status || null, admin_notes !== undefined ? admin_notes : null, req.params.id]
    );
    if (result.rowCount === 0) return res.status(404).json({ error: 'Quote not found.' });
    res.json(result.rows[0]);
  } catch (err) {
    console.error('[Quotes] Update error:', err.message);
    res.status(500).json({ error: 'Update failed.' });
  }
});

// ── DELETE /api/quotes/:id — admin ────────────────────
router.delete('/:id', requireAuth, requireAdmin, async (req, res) => {
  try {
    await pool.query('DELETE FROM quotes WHERE id = $1', [req.params.id]);
    res.json({ message: 'Quote deleted.' });
  } catch (err) {
    res.status(500).json({ error: 'Delete failed.' });
  }
});

module.exports = router;
