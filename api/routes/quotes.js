const express   = require('express');
const rateLimit = require('express-rate-limit');
const { body, query, validationResult } = require('express-validator');
const pool      = require('../db/connection');
const { requireAuth, requireAdmin } = require('../middleware/auth');
const { notifyAdminNewQuote, confirmClientQuote } = require('../services/email');

const router = express.Router();

const CATEGORIES     = ['web', 'led', 'it'];
const QUOTE_STATUSES = ['new', 'contacted', 'in_progress', 'converted', 'closed'];

// Rate-limit ONLY public quote submissions (10/hr/IP). Admin GET/PATCH/DELETE
// stay uncapped so the dashboard remains usable.
const submitLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many quote submissions from this IP. Please try again later.' },
});

// ── POST /api/quotes — public submission ──────────────
router.post('/', submitLimiter, [
  body('name').trim().notEmpty().withMessage('Name is required'),
  body('email').isEmail().normalizeEmail().withMessage('Valid email required'),
  body('service').trim().notEmpty().withMessage('Service is required'),
  body('description').trim().isLength({ min: 5 }).withMessage('Description too short'),
  body('company').optional().trim(),
  body('phone').optional().trim(),
  body('budget').optional().trim(),
  body('wants_consult').optional().isBoolean(),
  body('package_tier').optional().trim(),
  body('addons').optional().isArray(),
  body('estimate').optional().isInt({ min: 0 }),
  body('category').optional().isIn(CATEGORIES).withMessage('Invalid service category'),
], async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

  const {
    name, company, email, phone, service, budget, description, wants_consult,
    package_tier, addons, estimate, category,
  } = req.body;
  const userId = req.user?.id || null;

  try {
    const result = await pool.query(
      `INSERT INTO quotes
         (name, company, email, phone, service, budget, description, wants_consult,
          submitted_by, package_tier, addons, estimate, category)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
       RETURNING id, name, email, service, package_tier, estimate, status, category, created_at`,
      [
        name, company || null, email, phone || null, service,
        budget || null, description, wants_consult ?? false, userId,
        package_tier || null,
        addons && addons.length ? JSON.stringify(addons) : null,
        estimate || null,
        category || 'web',
      ]
    );

    const quote = result.rows[0];
    const emailData = {
      ...quote, description,
      phone: phone || null,
      wants_consult: wants_consult ?? false,
      budget: budget || null,
      addons: addons || [],
    };

    // Await both emails before responding — required for Vercel serverless
    await Promise.allSettled([
      notifyAdminNewQuote(emailData),
      confirmClientQuote(emailData),
    ]);

    res.status(201).json({
      message: 'Quote request received. We will get back to you within 24 hours.',
      quote,
    });
  } catch (err) {
    console.error('[Quotes] Submit error:', err.message);
    res.status(500).json({ error: 'Submission failed. Please try again.' });
  }
});

// ── GET /api/quotes/my — client: own quotes ───────────
// Match by submitted_by (user id) primarily so a user changing email
// keeps seeing their history. Fall back to current email for any pre-
// auth quote rows submitted before the user registered (submitted_by
// would be NULL for those).
router.get('/my', requireAuth, async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT id, name, service, budget, status, wants_consult, created_at, updated_at
       FROM quotes
       WHERE submitted_by = $1
          OR (submitted_by IS NULL AND email = (SELECT email FROM users WHERE id = $1))
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
  query('status').optional().isIn(QUOTE_STATUSES),
  query('category').optional().isIn(CATEGORIES),
  query('limit').optional().isInt({ min: 1, max: 100 }),
  query('offset').optional().isInt({ min: 0 }),
], async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

  const { status, category, limit = 50, offset = 0 } = req.query;

  try {
    const conds = [];
    const vals  = [];
    if (status)   { conds.push(`status = $${vals.length + 1}`);   vals.push(status); }
    if (category) { conds.push(`category = $${vals.length + 1}`); vals.push(category); }
    const where = conds.length ? ` WHERE ${conds.join(' AND ')}` : '';

    const sql = `SELECT * FROM quotes${where}`
      + ` ORDER BY created_at DESC LIMIT $${vals.length + 1} OFFSET $${vals.length + 2}`;

    const [rows, count] = await Promise.all([
      pool.query(sql, [...vals, Number(limit), Number(offset)]),
      pool.query(`SELECT COUNT(*) FROM quotes${where}`, vals),
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
// Dynamic SET so a field is only touched when the client explicitly sends
// it. Fixes the old COALESCE behaviour that ignored explicit null and
// prevented clearing admin_notes once it was set.
router.patch('/:id', requireAuth, requireAdmin, [
  body('status').optional().isIn(QUOTE_STATUSES),
  body('category').optional().isIn(CATEGORIES),
  body('admin_notes').optional({ nullable: true }).trim(),
], async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

  const updates = [];
  const vals    = [];
  let idx = 1;

  if ('status' in req.body) {
    updates.push(`status = $${idx++}`);
    vals.push(req.body.status);
  }
  if ('category' in req.body) {
    updates.push(`category = $${idx++}`);
    vals.push(req.body.category);
  }
  if ('admin_notes' in req.body) {
    updates.push(`admin_notes = $${idx++}`);
    vals.push(req.body.admin_notes || null); // empty/null both clear
  }

  if (updates.length === 0) {
    return res.status(400).json({ error: 'No fields to update.' });
  }

  vals.push(req.params.id);
  try {
    const result = await pool.query(
      `UPDATE quotes SET ${updates.join(', ')} WHERE id = $${idx} RETURNING *`,
      vals
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
    const result = await pool.query('DELETE FROM quotes WHERE id = $1 RETURNING id', [req.params.id]);
    if (result.rowCount === 0) return res.status(404).json({ error: 'Quote not found.' });
    res.json({ message: 'Quote deleted.' });
  } catch (err) {
    console.error('[Quotes] Delete error:', err.message);
    res.status(500).json({ error: 'Delete failed.' });
  }
});

module.exports = router;
