const express = require('express');
const { body, query, validationResult } = require('express-validator');
const pool    = require('../db/connection');
const { requireAuth, requireAdmin } = require('../middleware/auth');

const router = express.Router();

const CATEGORIES = ['web', 'led', 'it'];
const KINDS      = ['package', 'addon'];
const UNITS      = ['project', 'hour', 'module', 'sqm', 'month', 'callout', 'item'];

// ── GET /api/services — public catalogue ──────────────
// Feeds the public quote form and the admin builder templates. Returns
// only active rows unless an admin explicitly asks for everything.
router.get('/', [
  query('category').optional().isIn(CATEGORIES),
  query('kind').optional().isIn(KINDS),
], async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

  const { category, kind } = req.query;

  try {
    const conds = ['is_active = true'];
    const vals  = [];
    if (category) { conds.push(`category = $${vals.length + 1}`); vals.push(category); }
    if (kind)     { conds.push(`kind = $${vals.length + 1}`);     vals.push(kind); }

    const result = await pool.query(
      `SELECT id, category, kind, key, name, description, base_price, unit,
              template_items, note, sort_order
         FROM service_catalog
        WHERE ${conds.join(' AND ')}
        ORDER BY category, kind DESC, sort_order, name`,
      vals
    );

    // Group by category so the frontend can render division tabs directly
    const grouped = {};
    for (const row of result.rows) {
      grouped[row.category] ??= { packages: [], addons: [] };
      grouped[row.category][row.kind === 'addon' ? 'addons' : 'packages'].push(row);
    }

    res.json({ services: result.rows, grouped });
  } catch (err) {
    console.error('[Services] List error:', err.message);
    res.status(500).json({ error: 'Server error.' });
  }
});

// ── GET /api/services/all — admin: including inactive ─
router.get('/all', requireAuth, requireAdmin, async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT * FROM service_catalog ORDER BY category, kind DESC, sort_order, name`
    );
    res.json({ services: result.rows, total: result.rowCount });
  } catch (err) {
    console.error('[Services] Admin list error:', err.message);
    res.status(500).json({ error: 'Server error.' });
  }
});

// ── POST /api/services — admin: create ────────────────
router.post('/', requireAuth, requireAdmin, [
  body('category').isIn(CATEGORIES),
  body('kind').isIn(KINDS),
  body('key').trim().notEmpty().matches(/^[a-z0-9-]+$/)
    .withMessage('Key must be lowercase letters, numbers and hyphens'),
  body('name').trim().notEmpty(),
  body('base_price').optional().isFloat({ min: 0 }),
  body('unit').optional().isIn(UNITS),
  body('description').optional({ nullable: true }).trim(),
  body('note').optional({ nullable: true }).trim(),
  body('sort_order').optional().isInt(),
  body('template_items').optional({ nullable: true }).isArray(),
], async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

  const b = req.body;

  try {
    const result = await pool.query(
      `INSERT INTO service_catalog
         (category, kind, key, name, description, base_price, unit,
          template_items, note, sort_order, is_active)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
       RETURNING *`,
      [
        b.category, b.kind, b.key, b.name,
        b.description || null,
        b.base_price ?? 0,
        b.unit || 'project',
        b.template_items ? JSON.stringify(b.template_items) : null,
        b.note || null,
        b.sort_order ?? 0,
        b.is_active ?? true,
      ]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    if (err.code === '23505') {
      return res.status(409).json({ error: 'A service with that key already exists.' });
    }
    console.error('[Services] Create error:', err.message);
    res.status(500).json({ error: 'Server error.' });
  }
});

// ── PATCH /api/services/:id — admin: update ───────────
router.patch('/:id', requireAuth, requireAdmin, [
  body('category').optional().isIn(CATEGORIES),
  body('kind').optional().isIn(KINDS),
  body('name').optional().trim().notEmpty(),
  body('base_price').optional().isFloat({ min: 0 }),
  body('unit').optional().isIn(UNITS),
  body('description').optional({ nullable: true }).trim(),
  body('note').optional({ nullable: true }).trim(),
  body('sort_order').optional().isInt(),
  body('is_active').optional().isBoolean(),
  body('template_items').optional({ nullable: true }).isArray(),
], async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

  const b = req.body;
  const sets = [];
  const vals = [];
  let idx = 1;
  const set = (col, value) => { sets.push(`${col} = $${idx++}`); vals.push(value); };

  if ('category'    in b) set('category',    b.category);
  if ('kind'        in b) set('kind',        b.kind);
  if ('name'        in b) set('name',        b.name);
  if ('description' in b) set('description', b.description || null);
  if ('base_price'  in b) set('base_price',  b.base_price);
  if ('unit'        in b) set('unit',        b.unit);
  if ('note'        in b) set('note',        b.note || null);
  if ('sort_order'  in b) set('sort_order',  b.sort_order);
  if ('is_active'   in b) set('is_active',   b.is_active);
  if ('template_items' in b) {
    set('template_items', b.template_items ? JSON.stringify(b.template_items) : null);
  }

  if (!sets.length) return res.status(400).json({ error: 'No fields to update.' });

  vals.push(req.params.id);
  try {
    const result = await pool.query(
      `UPDATE service_catalog SET ${sets.join(', ')} WHERE id = $${idx} RETURNING *`,
      vals
    );
    if (result.rowCount === 0) return res.status(404).json({ error: 'Service not found.' });
    res.json(result.rows[0]);
  } catch (err) {
    console.error('[Services] Update error:', err.message);
    res.status(500).json({ error: 'Update failed.' });
  }
});

// ── DELETE /api/services/:id — admin ──────────────────
router.delete('/:id', requireAuth, requireAdmin, async (req, res) => {
  try {
    const result = await pool.query(
      'DELETE FROM service_catalog WHERE id = $1 RETURNING id', [req.params.id]
    );
    if (result.rowCount === 0) return res.status(404).json({ error: 'Service not found.' });
    res.json({ message: 'Service deleted.' });
  } catch (err) {
    console.error('[Services] Delete error:', err.message);
    res.status(500).json({ error: 'Delete failed.' });
  }
});

module.exports = router;
module.exports.CATEGORIES = CATEGORIES;
