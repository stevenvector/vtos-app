const express = require('express');
const { body, validationResult } = require('express-validator');
const pool    = require('../db/connection');
const { requireAuth, requireAdmin } = require('../middleware/auth');

const router = express.Router();

// ── GET /api/portfolio — public: visible items only ───
router.get('/', async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT id, title, tag, description, screenshot_url, project_url, display_order, created_at
       FROM portfolio_items
       WHERE is_visible = true
       ORDER BY display_order ASC, created_at DESC`
    );
    res.json(result.rows);
  } catch (err) {
    console.error('[Portfolio] List error:', err.message);
    res.status(500).json({ error: 'Server error.' });
  }
});

// ── GET /api/portfolio/all — admin: all items ─────────
router.get('/all', requireAuth, requireAdmin, async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT * FROM portfolio_items ORDER BY display_order ASC, created_at DESC'
    );
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: 'Server error.' });
  }
});

// ── POST /api/portfolio — admin: add item ─────────────
router.post('/', requireAuth, requireAdmin, [
  body('title').trim().notEmpty().withMessage('Title is required'),
  body('tag').isIn(['website','webapp','ecommerce','other']).withMessage('Invalid tag'),
  body('description').trim().notEmpty().withMessage('Description is required'),
  body('screenshot_url').optional().isURL().withMessage('Must be a valid URL'),
  body('project_url').optional().isURL().withMessage('Must be a valid URL'),
  body('display_order').optional().isInt({ min: 0 }),
  body('is_visible').optional().isBoolean(),
], async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

  const { title, tag, description, screenshot_url, project_url, display_order, is_visible } = req.body;

  try {
    const result = await pool.query(
      `INSERT INTO portfolio_items (title, tag, description, screenshot_url, project_url, display_order, is_visible)
       VALUES ($1,$2,$3,$4,$5,$6,$7)
       RETURNING *`,
      [title, tag, description, screenshot_url || null, project_url || null, display_order ?? 0, is_visible ?? true]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error('[Portfolio] Create error:', err.message);
    res.status(500).json({ error: 'Create failed.' });
  }
});

// ── PUT /api/portfolio/:id — admin: update item ───────
router.put('/:id', requireAuth, requireAdmin, [
  body('title').optional().trim().notEmpty(),
  body('tag').optional().isIn(['website','webapp','ecommerce','other']),
  body('description').optional().trim().notEmpty(),
  body('screenshot_url').optional({ nullable: true }).isURL(),
  body('project_url').optional({ nullable: true }).isURL(),
  body('display_order').optional().isInt({ min: 0 }),
  body('is_visible').optional().isBoolean(),
], async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

  const { title, tag, description, screenshot_url, project_url, display_order, is_visible } = req.body;

  try {
    const result = await pool.query(
      `UPDATE portfolio_items SET
        title          = COALESCE($1, title),
        tag            = COALESCE($2, tag),
        description    = COALESCE($3, description),
        screenshot_url = COALESCE($4, screenshot_url),
        project_url    = COALESCE($5, project_url),
        display_order  = COALESCE($6, display_order),
        is_visible     = COALESCE($7, is_visible)
       WHERE id = $8
       RETURNING *`,
      [
        title || null, tag || null, description || null,
        screenshot_url !== undefined ? screenshot_url : null,
        project_url    !== undefined ? project_url    : null,
        display_order  !== undefined ? display_order  : null,
        is_visible     !== undefined ? is_visible     : null,
        req.params.id,
      ]
    );
    if (result.rowCount === 0) return res.status(404).json({ error: 'Item not found.' });
    res.json(result.rows[0]);
  } catch (err) {
    console.error('[Portfolio] Update error:', err.message);
    res.status(500).json({ error: 'Update failed.' });
  }
});

// ── PATCH /api/portfolio/:id/toggle — admin: visibility
router.patch('/:id/toggle', requireAuth, requireAdmin, async (req, res) => {
  try {
    const result = await pool.query(
      `UPDATE portfolio_items SET is_visible = NOT is_visible WHERE id = $1 RETURNING *`,
      [req.params.id]
    );
    if (result.rowCount === 0) return res.status(404).json({ error: 'Item not found.' });
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: 'Toggle failed.' });
  }
});

// ── DELETE /api/portfolio/:id — admin ─────────────────
router.delete('/:id', requireAuth, requireAdmin, async (req, res) => {
  try {
    await pool.query('DELETE FROM portfolio_items WHERE id = $1', [req.params.id]);
    res.json({ message: 'Portfolio item deleted.' });
  } catch (err) {
    res.status(500).json({ error: 'Delete failed.' });
  }
});

module.exports = router;
