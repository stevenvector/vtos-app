/* =====================================================
   VTOS — LED Division
   Screen register + job pipeline (installations, callouts,
   module repairs, maintenance).

   Jobs are usually logged by an admin from a phone call, so
   client_id is optional and contact details are free text.
   ===================================================== */
const express = require('express');
const { body, query, validationResult } = require('express-validator');
const pool    = require('../db/connection');
const { requireAuth, requireAdmin } = require('../middleware/auth');

const router = express.Router();

const JOB_TYPES   = ['installation', 'callout', 'repair', 'maintenance'];
const PRIORITIES  = ['standard', 'urgent', 'emergency'];
const JOB_STATUSES = [
  'logged', 'scheduled', 'evaluating', 'reported', 'awaiting_parts',
  'in_progress', 'dispatched', 'completed', 'invoiced', 'cancelled',
];
const ENVIRONMENTS = ['indoor', 'outdoor', 'semi_outdoor'];

// Fallback rate card — used only if app_settings has no 'led_rates' row.
const DEFAULT_RATES = {
  callout_fee: 2000,
  module_repair_price: 400,
  service_area: 'Greater Cape Town — or within a 30km radius',
  service_radius_km: 30,
  hourly_rate: null,
  travel_per_km: null,
  after_hours_multiplier: null,
};

const RATE_FIELDS = [
  'callout_fee', 'module_repair_price', 'service_area',
  'service_radius_km', 'hourly_rate', 'travel_per_km', 'after_hours_multiplier',
];

/* ══════════════════════════════════════════════════════
   RATE CARD
   ══════════════════════════════════════════════════════ */

// ── GET /api/led/rates — admin ────────────────────────
router.get('/rates', requireAuth, requireAdmin, async (req, res) => {
  try {
    const result = await pool.query("SELECT value FROM app_settings WHERE key = 'led_rates'");
    res.json(result.rows[0]?.value || DEFAULT_RATES);
  } catch (err) {
    console.error('[LED] Get rates error:', err.message);
    res.status(500).json({ error: 'Server error.' });
  }
});

// ── PUT /api/led/rates — admin ────────────────────────
router.put('/rates', requireAuth, requireAdmin, async (req, res) => {
  const rates = {};
  for (const f of RATE_FIELDS) {
    if (f in req.body) {
      const v = req.body[f];
      rates[f] = (v === '' || v === null) ? null
        : (f === 'service_area' ? String(v).trim().slice(0, 200) : Number(v));
    }
  }
  if (!Object.keys(rates).length) {
    return res.status(400).json({ error: 'No valid rate fields provided.' });
  }
  if (Object.entries(rates).some(([k, v]) => k !== 'service_area' && v !== null && Number.isNaN(v))) {
    return res.status(400).json({ error: 'Rates must be numeric.' });
  }

  try {
    // Merge over whatever is stored so a partial update keeps other fields.
    const existing = await pool.query("SELECT value FROM app_settings WHERE key = 'led_rates'");
    const merged   = { ...DEFAULT_RATES, ...(existing.rows[0]?.value || {}), ...rates };

    await pool.query(
      `INSERT INTO app_settings (key, value) VALUES ('led_rates', $1)
       ON CONFLICT (key) DO UPDATE SET value = $1, updated_at = NOW()`,
      [JSON.stringify(merged)]
    );
    res.json(merged);
  } catch (err) {
    console.error('[LED] Save rates error:', err.message);
    res.status(500).json({ error: 'Server error.' });
  }
});

/* ══════════════════════════════════════════════════════
   SCREEN REGISTER
   ══════════════════════════════════════════════════════ */

// ── GET /api/led/screens — admin ──────────────────────
router.get('/screens', requireAuth, requireAdmin, [
  query('client_id').optional().isInt(),
  query('active').optional().isBoolean(),
], async (req, res) => {
  try {
    const conds = [];
    const vals  = [];
    if (req.query.client_id) { conds.push(`s.client_id = $${vals.length + 1}`); vals.push(req.query.client_id); }
    if (req.query.active !== undefined) {
      conds.push(`s.is_active = $${vals.length + 1}`);
      vals.push(req.query.active === 'true');
    }

    const result = await pool.query(
      `SELECT s.*,
              (SELECT COUNT(*) FROM led_jobs j WHERE j.screen_id = s.id) AS job_count,
              (SELECT MAX(j.created_at) FROM led_jobs j WHERE j.screen_id = s.id) AS last_service
         FROM led_screens s
        ${conds.length ? `WHERE ${conds.join(' AND ')}` : ''}
        ORDER BY s.client_name, s.screen_label`,
      vals
    );
    res.json({ screens: result.rows, total: result.rowCount });
  } catch (err) {
    console.error('[LED] Screens list error:', err.message);
    res.status(500).json({ error: 'Server error.' });
  }
});

// ── GET /api/led/screens/:id — admin, with service history ──
router.get('/screens/:id', requireAuth, requireAdmin, async (req, res) => {
  try {
    const screen = await pool.query('SELECT * FROM led_screens WHERE id = $1', [req.params.id]);
    if (screen.rowCount === 0) return res.status(404).json({ error: 'Screen not found.' });

    const history = await pool.query(
      `SELECT id, job_number, job_type, status, priority, scheduled_for,
              completed_at, fault_description, created_at
         FROM led_jobs
        WHERE screen_id = $1
        ORDER BY created_at DESC`,
      [req.params.id]
    );

    res.json({ ...screen.rows[0], history: history.rows });
  } catch (err) {
    console.error('[LED] Screen get error:', err.message);
    res.status(500).json({ error: 'Server error.' });
  }
});

const screenValidators = (optional = false) => {
  const maybe = v => (optional ? v.optional() : v);
  return [
    maybe(body('client_name').trim().notEmpty().withMessage('Client name is required')),
    maybe(body('screen_label').trim().notEmpty().withMessage('Screen label is required')),
    body('client_id').optional({ nullable: true }).isInt(),
    body('site_name').optional({ nullable: true }).trim(),
    body('site_address').optional({ nullable: true }).trim(),
    body('pixel_pitch').optional({ nullable: true }).isFloat({ min: 0 }),
    body('width_m').optional({ nullable: true }).isFloat({ min: 0 }),
    body('height_m').optional({ nullable: true }).isFloat({ min: 0 }),
    body('module_count').optional({ nullable: true }).isInt({ min: 0 }),
    body('cabinet_type').optional({ nullable: true }).trim(),
    body('module_type').optional({ nullable: true }).trim(),
    body('receiving_card').optional({ nullable: true }).trim(),
    body('processor').optional({ nullable: true }).trim(),
    body('environment').optional().isIn(ENVIRONMENTS),
    body('installed_on').optional({ nullable: true }).isDate(),
    body('warranty_until').optional({ nullable: true }).isDate(),
    body('notes').optional({ nullable: true }).trim(),
    body('is_active').optional().isBoolean(),
  ];
};

const SCREEN_COLS = [
  'client_id', 'client_name', 'site_name', 'site_address', 'screen_label',
  'pixel_pitch', 'width_m', 'height_m', 'module_count', 'cabinet_type',
  'module_type', 'receiving_card', 'processor', 'environment',
  'installed_on', 'warranty_until', 'notes', 'is_active',
];

// Empty strings arriving from HTML forms must become NULL, not ''.
const clean = v => (v === '' || v === undefined ? null : v);

// ── POST /api/led/screens — admin ─────────────────────
router.post('/screens', requireAuth, requireAdmin, screenValidators(false), async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

  const cols = SCREEN_COLS.filter(c => c in req.body || c === 'client_name' || c === 'screen_label');
  const vals = cols.map(c => clean(req.body[c]));

  try {
    const result = await pool.query(
      `INSERT INTO led_screens (${cols.join(', ')})
       VALUES (${cols.map((_, i) => `$${i + 1}`).join(', ')})
       RETURNING *`,
      vals
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error('[LED] Screen create error:', err.message);
    res.status(500).json({ error: 'Server error.' });
  }
});

// ── PATCH /api/led/screens/:id — admin ────────────────
router.patch('/screens/:id', requireAuth, requireAdmin, screenValidators(true), async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

  const sets = [];
  const vals = [];
  let idx = 1;
  for (const col of SCREEN_COLS) {
    if (col in req.body) { sets.push(`${col} = $${idx++}`); vals.push(clean(req.body[col])); }
  }
  if (!sets.length) return res.status(400).json({ error: 'No fields to update.' });

  vals.push(req.params.id);
  try {
    const result = await pool.query(
      `UPDATE led_screens SET ${sets.join(', ')} WHERE id = $${idx} RETURNING *`,
      vals
    );
    if (result.rowCount === 0) return res.status(404).json({ error: 'Screen not found.' });
    res.json(result.rows[0]);
  } catch (err) {
    console.error('[LED] Screen update error:', err.message);
    res.status(500).json({ error: 'Update failed.' });
  }
});

// ── DELETE /api/led/screens/:id — admin ───────────────
router.delete('/screens/:id', requireAuth, requireAdmin, async (req, res) => {
  try {
    const result = await pool.query(
      'DELETE FROM led_screens WHERE id = $1 RETURNING id', [req.params.id]
    );
    if (result.rowCount === 0) return res.status(404).json({ error: 'Screen not found.' });
    res.json({ message: 'Screen deleted. Linked jobs were kept and unlinked.' });
  } catch (err) {
    console.error('[LED] Screen delete error:', err.message);
    res.status(500).json({ error: 'Delete failed.' });
  }
});

/* ══════════════════════════════════════════════════════
   JOBS
   ══════════════════════════════════════════════════════ */

// ── GET /api/led/jobs/client/my — client: own jobs ────
router.get('/jobs/client/my', requireAuth, async (req, res) => {
  try {
    const userRes = await pool.query('SELECT email FROM users WHERE id = $1', [req.user.id]);
    const email   = userRes.rows[0]?.email;

    const result = await pool.query(
      `SELECT j.id, j.job_number, j.job_type, j.status, j.priority, j.scheduled_for,
              j.completed_at, j.fault_description, j.created_at,
              s.screen_label, s.site_name
         FROM led_jobs j
         LEFT JOIN led_screens s ON s.id = j.screen_id
        WHERE j.client_id = $1 OR (j.client_id IS NULL AND j.contact_email = $2)
        ORDER BY j.created_at DESC`,
      [req.user.id, email || null]
    );
    res.json(result.rows);
  } catch (err) {
    console.error('[LED] Client jobs error:', err.message);
    res.status(500).json({ error: 'Server error.' });
  }
});

// ── GET /api/led/jobs — admin ─────────────────────────
router.get('/jobs', requireAuth, requireAdmin, [
  query('status').optional().isIn(JOB_STATUSES),
  query('job_type').optional().isIn(JOB_TYPES),
  query('limit').optional().isInt({ min: 1, max: 100 }),
  query('offset').optional().isInt({ min: 0 }),
], async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

  const { status, job_type, limit = 50, offset = 0 } = req.query;

  try {
    const conds = [];
    const vals  = [];
    if (status)   { conds.push(`j.status = $${vals.length + 1}`);   vals.push(status); }
    if (job_type) { conds.push(`j.job_type = $${vals.length + 1}`); vals.push(job_type); }
    const where = conds.length ? `WHERE ${conds.join(' AND ')}` : '';

    const [rows, count] = await Promise.all([
      pool.query(
        `SELECT j.*, s.screen_label, s.site_name AS screen_site,
                i.invoice_number, p.quote_number
           FROM led_jobs j
           LEFT JOIN led_screens s ON s.id = j.screen_id
           LEFT JOIN invoices    i ON i.id = j.invoice_id
           LEFT JOIN proposals   p ON p.id = j.quote_id
          ${where}
          ORDER BY j.created_at DESC
          LIMIT $${vals.length + 1} OFFSET $${vals.length + 2}`,
        [...vals, Number(limit), Number(offset)]
      ),
      pool.query(`SELECT COUNT(*) FROM led_jobs j ${where}`, vals),
    ]);

    res.json({ jobs: rows.rows, total: parseInt(count.rows[0].count) });
  } catch (err) {
    console.error('[LED] Jobs list error:', err.message);
    res.status(500).json({ error: 'Server error.' });
  }
});

// ── GET /api/led/jobs/stats — admin dashboard tiles ───
router.get('/jobs/stats', requireAuth, requireAdmin, async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT
        COUNT(*) FILTER (WHERE status = 'logged')                          AS logged,
        COUNT(*) FILTER (WHERE status = 'scheduled')                       AS scheduled,
        COUNT(*) FILTER (WHERE status IN ('evaluating','reported',
                                          'awaiting_parts','in_progress')) AS active,
        COUNT(*) FILTER (WHERE status IN ('completed','dispatched')
                           AND invoice_id IS NULL)                         AS awaiting_invoice,
        COUNT(*)                                                            AS total
      FROM led_jobs
    `);
    res.json(result.rows[0]);
  } catch (err) {
    console.error('[LED] Job stats error:', err.message);
    res.status(500).json({ error: 'Server error.' });
  }
});

// ── GET /api/led/jobs/:id — admin ─────────────────────
router.get('/jobs/:id', requireAuth, requireAdmin, async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT j.*, s.screen_label, s.site_name AS screen_site, s.pixel_pitch,
              s.module_type, s.site_address AS screen_address,
              i.invoice_number, p.quote_number
         FROM led_jobs j
         LEFT JOIN led_screens s ON s.id = j.screen_id
         LEFT JOIN invoices    i ON i.id = j.invoice_id
         LEFT JOIN proposals   p ON p.id = j.quote_id
        WHERE j.id = $1`,
      [req.params.id]
    );
    if (result.rowCount === 0) return res.status(404).json({ error: 'Job not found.' });
    res.json(result.rows[0]);
  } catch (err) {
    console.error('[LED] Job get error:', err.message);
    res.status(500).json({ error: 'Server error.' });
  }
});

const JOB_COLS = [
  'job_type', 'priority', 'status', 'client_id', 'contact_name', 'contact_phone',
  'contact_email', 'company', 'screen_id', 'site_address', 'site_notes',
  'within_service_area', 'scheduled_for', 'completed_at', 'technician',
  'fault_description', 'evaluation_notes', 'work_performed', 'parts_used',
  'modules_in', 'modules_repaired', 'modules_scrapped', 'labour_hours',
  'travel_km', 'quote_id', 'invoice_id', 'admin_notes',
];

const jobValidators = (optional = false) => {
  const maybe = v => (optional ? v.optional() : v);
  return [
    maybe(body('job_type').isIn(JOB_TYPES).withMessage('Invalid job type')),
    maybe(body('contact_name').trim().notEmpty().withMessage('Contact name is required')),
    body('priority').optional().isIn(PRIORITIES),
    body('status').optional().isIn(JOB_STATUSES),
    body('client_id').optional({ nullable: true }).isInt(),
    body('screen_id').optional({ nullable: true }).isInt(),
    body('contact_email').optional({ nullable: true }).trim(),
    body('contact_phone').optional({ nullable: true }).trim(),
    body('company').optional({ nullable: true }).trim(),
    body('site_address').optional({ nullable: true }).trim(),
    body('site_notes').optional({ nullable: true }).trim(),
    body('within_service_area').optional().isBoolean(),
    body('scheduled_for').optional({ nullable: true }).isISO8601(),
    body('completed_at').optional({ nullable: true }).isISO8601(),
    body('technician').optional({ nullable: true }).trim(),
    body('fault_description').optional({ nullable: true }).trim(),
    body('evaluation_notes').optional({ nullable: true }).trim(),
    body('work_performed').optional({ nullable: true }).trim(),
    body('parts_used').optional({ nullable: true }).isArray(),
    body('modules_in').optional({ nullable: true }).isInt({ min: 0 }),
    body('modules_repaired').optional({ nullable: true }).isInt({ min: 0 }),
    body('modules_scrapped').optional({ nullable: true }).isInt({ min: 0 }),
    body('labour_hours').optional({ nullable: true }).isFloat({ min: 0 }),
    body('travel_km').optional({ nullable: true }).isFloat({ min: 0 }),
    body('quote_id').optional({ nullable: true }).isInt(),
    body('invoice_id').optional({ nullable: true }).isInt(),
    body('admin_notes').optional({ nullable: true }).trim(),
  ];
};

const jobValue = (col, raw) => {
  if (raw === '' || raw === undefined) return null;
  if (col === 'parts_used') return raw ? JSON.stringify(raw) : null;
  return raw;
};

// ── POST /api/led/jobs — admin: log a job ─────────────
router.post('/jobs', requireAuth, requireAdmin, jobValidators(false), async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

  const cols = JOB_COLS.filter(c => c in req.body);
  if (!cols.includes('job_type'))     cols.push('job_type');
  if (!cols.includes('contact_name')) cols.push('contact_name');
  const vals = cols.map(c => jobValue(c, req.body[c]));

  try {
    // Job number generated inside the INSERT via sequence — same atomic
    // pattern as proposals/invoices. Format: VTOS-LED-YYYY-NNN.
    const result = await pool.query(
      `INSERT INTO led_jobs (job_number, created_by, ${cols.join(', ')})
       VALUES (
         'VTOS-LED-' || EXTRACT(YEAR FROM NOW())::int
                     || '-' || LPAD(nextval('led_job_number_seq')::text, 3, '0'),
         $1,
         ${cols.map((_, i) => `$${i + 2}`).join(', ')}
       )
       RETURNING *`,
      [req.user.id, ...vals]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error('[LED] Job create error:', err.message);
    res.status(500).json({ error: 'Server error.' });
  }
});

// ── PATCH /api/led/jobs/:id — admin ───────────────────
router.patch('/jobs/:id', requireAuth, requireAdmin, jobValidators(true), async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

  const sets = [];
  const vals = [];
  let idx = 1;
  for (const col of JOB_COLS) {
    if (col in req.body) { sets.push(`${col} = $${idx++}`); vals.push(jobValue(col, req.body[col])); }
  }

  // Stamp completion time automatically the first time a job is closed out.
  if (req.body.status === 'completed' && !('completed_at' in req.body)) {
    sets.push(`completed_at = COALESCE(completed_at, NOW())`);
  }

  if (!sets.length) return res.status(400).json({ error: 'No fields to update.' });

  vals.push(req.params.id);
  try {
    const result = await pool.query(
      `UPDATE led_jobs SET ${sets.join(', ')} WHERE id = $${idx} RETURNING *`,
      vals
    );
    if (result.rowCount === 0) return res.status(404).json({ error: 'Job not found.' });
    res.json(result.rows[0]);
  } catch (err) {
    console.error('[LED] Job update error:', err.message);
    res.status(500).json({ error: 'Update failed.' });
  }
});

// ── DELETE /api/led/jobs/:id — admin ──────────────────
router.delete('/jobs/:id', requireAuth, requireAdmin, async (req, res) => {
  try {
    const result = await pool.query('DELETE FROM led_jobs WHERE id = $1 RETURNING id', [req.params.id]);
    if (result.rowCount === 0) return res.status(404).json({ error: 'Job not found.' });
    res.json({ message: 'Job deleted.' });
  } catch (err) {
    console.error('[LED] Job delete error:', err.message);
    res.status(500).json({ error: 'Delete failed.' });
  }
});

module.exports = router;
module.exports.JOB_TYPES    = JOB_TYPES;
module.exports.JOB_STATUSES = JOB_STATUSES;
