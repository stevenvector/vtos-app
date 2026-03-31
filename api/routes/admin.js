const express = require('express');
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
