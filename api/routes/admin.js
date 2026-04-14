const express = require('express');
const { body, validationResult } = require('express-validator');
const bcrypt  = require('bcryptjs');
const pool    = require('../db/connection');
const { requireAuth, requireAdmin } = require('../middleware/auth');

const router = express.Router();

// All admin routes require auth + admin role
router.use(requireAuth, requireAdmin);

// ── GET /api/admin/stats ──────────────────────────────
router.get('/stats', async (req, res) => {
  try {
    const [quotes, courier, portfolio, users] = await Promise.all([
      pool.query(`
        SELECT
          COUNT(*) FILTER (WHERE status = 'new')         AS new_leads,
          COUNT(*) FILTER (WHERE status = 'contacted')   AS contacted,
          COUNT(*) FILTER (WHERE status = 'in_progress') AS in_progress,
          COUNT(*) FILTER (WHERE status = 'converted')   AS converted,
          COUNT(*)                                        AS total
        FROM quotes
      `),
      pool.query(`
        SELECT
          COUNT(*) FILTER (WHERE status = 'pending')          AS pending,
          COUNT(*) FILTER (WHERE status NOT IN ('returned','closed')) AS active,
          COUNT(*) FILTER (WHERE status = 'returned')         AS returned,
          COUNT(*)                                             AS total
        FROM courier_bookings
      `),
      pool.query(`
        SELECT COUNT(*) AS total,
               COUNT(*) FILTER (WHERE is_visible = true) AS visible
        FROM portfolio_items
      `),
      pool.query(`
        SELECT COUNT(*) AS total,
               COUNT(*) FILTER (WHERE role = 'client') AS clients
        FROM users
        WHERE role != 'admin'
      `),
    ]);

    res.json({
      quotes:    quotes.rows[0],
      courier:   courier.rows[0],
      portfolio: portfolio.rows[0],
      users:     users.rows[0],
    });
  } catch (err) {
    console.error('[Admin] Stats error:', err.message);
    res.status(500).json({ error: 'Server error.' });
  }
});

// ── GET /api/admin/users ──────────────────────────────
router.get('/users', async (req, res) => {
  const { limit = 50, offset = 0 } = req.query;
  try {
    const result = await pool.query(
      `SELECT id, first_name, last_name, email, phone, role, is_active, created_at
       FROM users ORDER BY created_at DESC LIMIT $1 OFFSET $2`,
      [Number(limit), Number(offset)]
    );
    const count = await pool.query('SELECT COUNT(*) FROM users');
    res.json({ users: result.rows, total: parseInt(count.rows[0].count) });
  } catch (err) {
    res.status(500).json({ error: 'Server error.' });
  }
});

// ── POST /api/admin/users — create user ──────────────
router.post('/users', [
  body('first_name').trim().notEmpty().withMessage('First name is required'),
  body('last_name').trim().notEmpty().withMessage('Last name is required'),
  body('email').isEmail().normalizeEmail().withMessage('Valid email required'),
  body('password').isLength({ min: 8 }).withMessage('Password must be at least 8 characters'),
  body('phone').optional().trim(),
  body('role').optional().isIn(['client', 'admin']).withMessage('Invalid role'),
], async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

  const { first_name, last_name, email, password, phone, role = 'client' } = req.body;
  try {
    const exists = await pool.query('SELECT id FROM users WHERE email = $1', [email]);
    if (exists.rowCount > 0) return res.status(409).json({ error: 'Email already in use.' });

    const password_hash = await bcrypt.hash(password, 12);
    const result = await pool.query(
      `INSERT INTO users (first_name, last_name, email, phone, password_hash, role)
       VALUES ($1,$2,$3,$4,$5,$6)
       RETURNING id, first_name, last_name, email, phone, role, is_active, created_at`,
      [first_name, last_name, email, phone || null, password_hash, role]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error('[Admin] Create user error:', err.message);
    res.status(500).json({ error: 'Server error.' });
  }
});

// ── PUT /api/admin/users/:id — update user ────────────
router.put('/users/:id', [
  body('first_name').optional().trim().notEmpty().withMessage('First name cannot be empty'),
  body('last_name').optional().trim().notEmpty().withMessage('Last name cannot be empty'),
  body('email').optional().isEmail().normalizeEmail().withMessage('Valid email required'),
  body('phone').optional().trim(),
  body('role').optional().isIn(['client', 'admin']).withMessage('Invalid role'),
  body('is_active').optional().isBoolean(),
  body('password').optional().isLength({ min: 8 }).withMessage('Password must be at least 8 characters'),
], async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

  const { first_name, last_name, email, phone, role, is_active, password } = req.body;

  try {
    const updates = [];
    const vals    = [];
    let idx = 1;

    if (first_name !== undefined) { updates.push(`first_name = $${idx++}`); vals.push(first_name); }
    if (last_name  !== undefined) { updates.push(`last_name = $${idx++}`);  vals.push(last_name); }
    if (email      !== undefined) { updates.push(`email = $${idx++}`);      vals.push(email); }
    if (phone      !== undefined) { updates.push(`phone = $${idx++}`);      vals.push(phone || null); }
    if (role       !== undefined) { updates.push(`role = $${idx++}`);       vals.push(role); }
    if (is_active  !== undefined) { updates.push(`is_active = $${idx++}`);  vals.push(is_active); }
    if (password) {
      const hash = await bcrypt.hash(password, 12);
      updates.push(`password_hash = $${idx++}`);
      vals.push(hash);
    }

    if (updates.length === 0) return res.status(400).json({ error: 'No fields to update.' });

    vals.push(req.params.id);
    const result = await pool.query(
      `UPDATE users SET ${updates.join(', ')} WHERE id = $${idx}
       RETURNING id, first_name, last_name, email, phone, role, is_active, created_at`,
      vals
    );
    if (result.rowCount === 0) return res.status(404).json({ error: 'User not found.' });
    res.json(result.rows[0]);
  } catch (err) {
    console.error('[Admin] Update user error:', err.message);
    if (err.code === '23505') return res.status(409).json({ error: 'Email already in use.' });
    res.status(500).json({ error: 'Server error.' });
  }
});

// ── DELETE /api/admin/users/:id ───────────────────────
router.delete('/users/:id', async (req, res) => {
  try {
    const result = await pool.query(
      `DELETE FROM users WHERE id = $1 AND role != 'admin' RETURNING id`,
      [req.params.id]
    );
    if (result.rowCount === 0) return res.status(404).json({ error: 'User not found or protected.' });
    res.json({ message: 'User deleted.' });
  } catch (err) {
    console.error('[Admin] Delete user error:', err.message);
    res.status(500).json({ error: 'Delete failed.' });
  }
});

// ── PATCH /api/admin/users/:id/toggle ────────────────
router.patch('/users/:id/toggle', async (req, res) => {
  try {
    const result = await pool.query(
      `UPDATE users SET is_active = NOT is_active WHERE id = $1 AND role != 'admin' RETURNING id, email, is_active`,
      [req.params.id]
    );
    if (result.rowCount === 0) return res.status(404).json({ error: 'User not found or protected.' });
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: 'Update failed.' });
  }
});

// ── GET /api/admin/recent ────────────────────────────
router.get('/recent', async (req, res) => {
  try {
    const [quotes, courier] = await Promise.all([
      pool.query(`SELECT id, name, email, service, status, created_at FROM quotes ORDER BY created_at DESC LIMIT 5`),
      pool.query(`
        SELECT cb.id, cb.item_type, cb.status, cb.created_at, u.first_name, u.last_name, u.email
        FROM courier_bookings cb JOIN users u ON u.id = cb.user_id
        ORDER BY cb.created_at DESC LIMIT 5
      `),
    ]);
    res.json({ recent_quotes: quotes.rows, recent_courier: courier.rows });
  } catch (err) {
    res.status(500).json({ error: 'Server error.' });
  }
});

module.exports = router;
