const express = require('express');
const { body, query, validationResult } = require('express-validator');
const pool    = require('../db/connection');
const { requireAuth, requireAdmin } = require('../middleware/auth');
const { notifyAdminNewCourier, confirmClientCourier } = require('../services/email');

const router = express.Router();

const VALID_STATUSES = [
  'pending', 'awaiting_pickup', 'in_transit', 'received',
  'diagnosing', 'awaiting_approval', 'repairing',
  'ready_to_return', 'returned', 'closed'
];

const STATUS_LABELS = {
  pending:            'Booking Submitted',
  awaiting_pickup:    'Awaiting Pickup',
  in_transit:         'In Transit to VTOS',
  received:           'Received at Workshop',
  diagnosing:         'Under Diagnostics',
  awaiting_approval:  'Awaiting Your Approval',
  repairing:          'Repair in Progress',
  ready_to_return:    'Ready to Return',
  returned:           'Returned to You',
  closed:             'Closed',
};

// ── POST /api/courier — client: new booking ───────────
router.post('/', requireAuth, [
  body('item_description').trim().notEmpty().withMessage('Item description is required'),
  body('item_type').trim().notEmpty().withMessage('Item type is required'),
  body('issue_description').trim().isLength({ min: 10 }).withMessage('Issue description too short'),
  body('courier_company').optional().trim(),
  body('tracking_number').optional().trim(),
  body('estimated_arrival').optional().isDate().withMessage('Invalid date'),
], async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

  const {
    item_description, item_type, issue_description,
    courier_company, tracking_number, estimated_arrival,
  } = req.body;

  try {
    const result = await pool.query(
      `INSERT INTO courier_bookings
        (user_id, item_description, item_type, issue_description, courier_company, tracking_number, estimated_arrival)
       VALUES ($1,$2,$3,$4,$5,$6,$7)
       RETURNING *`,
      [
        req.user.id, item_description, item_type, issue_description,
        courier_company || null, tracking_number || null, estimated_arrival || null,
      ]
    );

    const booking = result.rows[0];
    booking.status_label = STATUS_LABELS[booking.status];

    // Fetch user and await emails before responding — required for Vercel serverless
    try {
      const userRes = await pool.query('SELECT first_name, last_name, email FROM users WHERE id = $1', [req.user.id]);
      const user = userRes.rows[0];
      await Promise.allSettled([
        notifyAdminNewCourier(booking, user),
        confirmClientCourier(booking, user),
      ]);
    } catch (emailErr) {
      console.error('[Courier] Email error:', emailErr.message);
    }

    res.status(201).json({ message: 'Courier booking submitted successfully.', booking });
  } catch (err) {
    console.error('[Courier] Submit error:', err.message);
    res.status(500).json({ error: 'Submission failed. Please try again.' });
  }
});

// ── GET /api/courier/my — client: own bookings ────────
router.get('/my', requireAuth, async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT id, item_description, item_type, status, courier_company,
              tracking_number, return_tracking, return_courier,
              created_at, updated_at
       FROM courier_bookings
       WHERE user_id = $1
       ORDER BY created_at DESC`,
      [req.user.id]
    );

    const bookings = result.rows.map(b => ({ ...b, status_label: STATUS_LABELS[b.status] }));
    res.json(bookings);
  } catch (err) {
    console.error('[Courier] My bookings error:', err.message);
    res.status(500).json({ error: 'Server error.' });
  }
});

// ── GET /api/courier/:id — client: single booking ─────
router.get('/:id', requireAuth, async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT cb.*, u.first_name, u.last_name, u.email, u.phone
       FROM courier_bookings cb
       JOIN users u ON u.id = cb.user_id
       WHERE cb.id = $1`,
      [req.params.id]
    );
    if (result.rowCount === 0) return res.status(404).json({ error: 'Booking not found.' });

    const booking = result.rows[0];
    // Clients can only see their own
    if (req.user.role !== 'admin' && booking.user_id !== req.user.id) {
      return res.status(403).json({ error: 'Access denied.' });
    }

    booking.status_label = STATUS_LABELS[booking.status];

    // Strip admin-only fields when the requester isn't an admin.
    // Clients should never see admin_notes — those can contain internal
    // diagnostics/pricing discussion that's not for the customer.
    if (req.user.role !== 'admin') {
      delete booking.admin_notes;
    }

    res.json(booking);
  } catch (err) {
    console.error('[Courier] Get booking error:', err.message);
    res.status(500).json({ error: 'Server error.' });
  }
});

// ── GET /api/courier — admin: all bookings ────────────
router.get('/', requireAuth, requireAdmin, [
  query('status').optional().isIn(VALID_STATUSES),
  query('limit').optional().isInt({ min: 1, max: 100 }),
  query('offset').optional().isInt({ min: 0 }),
], async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

  const { status, limit = 50, offset = 0 } = req.query;

  try {
    let sql  = `SELECT cb.*, u.first_name, u.last_name, u.email, u.phone
                FROM courier_bookings cb
                JOIN users u ON u.id = cb.user_id`;
    const vals = [];

    if (status) {
      sql += ` WHERE cb.status = $${vals.length + 1}`;
      vals.push(status);
    }

    sql += ` ORDER BY cb.created_at DESC LIMIT $${vals.length+1} OFFSET $${vals.length+2}`;
    vals.push(Number(limit), Number(offset));

    const [rows, count] = await Promise.all([
      pool.query(sql, vals),
      pool.query(
        `SELECT COUNT(*) FROM courier_bookings${status ? ' WHERE status=$1' : ''}`,
        status ? [status] : []
      ),
    ]);

    const bookings = rows.rows.map(b => ({ ...b, status_label: STATUS_LABELS[b.status] }));
    res.json({ bookings, total: parseInt(count.rows[0].count), status_labels: STATUS_LABELS });
  } catch (err) {
    console.error('[Courier] List error:', err.message);
    res.status(500).json({ error: 'Server error.' });
  }
});

// ── PATCH /api/courier/:id — admin: update status ─────
// Dynamic SET — only fields explicitly present in req.body get touched,
// so empty string / null can clear admin_notes / return_tracking /
// return_courier (the old COALESCE pattern silently kept the previous
// value when null was sent).
router.patch('/:id', requireAuth, requireAdmin, [
  body('status').optional().isIn(VALID_STATUSES),
  body('admin_notes').optional({ nullable: true }).trim(),
  body('return_tracking').optional({ nullable: true }).trim(),
  body('return_courier').optional({ nullable: true }).trim(),
], async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

  const b = req.body;
  const sets = [];
  const vals = [];
  let idx = 1;
  const set = (col, value) => { sets.push(`${col} = $${idx++}`); vals.push(value); };

  if ('status'          in b) set('status',          b.status);
  if ('admin_notes'     in b) set('admin_notes',     b.admin_notes     || null);
  if ('return_tracking' in b) set('return_tracking', b.return_tracking || null);
  if ('return_courier'  in b) set('return_courier',  b.return_courier  || null);

  if (sets.length === 0) {
    return res.status(400).json({ error: 'No fields to update.' });
  }

  vals.push(req.params.id);
  try {
    const result = await pool.query(
      `UPDATE courier_bookings SET ${sets.join(', ')} WHERE id = $${idx} RETURNING *`,
      vals
    );
    if (result.rowCount === 0) return res.status(404).json({ error: 'Booking not found.' });

    const booking = result.rows[0];
    booking.status_label = STATUS_LABELS[booking.status];
    res.json(booking);
  } catch (err) {
    console.error('[Courier] Update error:', err.message);
    res.status(500).json({ error: 'Update failed.' });
  }
});

module.exports = router;
