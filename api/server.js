require('dotenv').config();

const express     = require('express');
const cors        = require('cors');
const helmet      = require('helmet');
const morgan      = require('morgan');
const rateLimit   = require('express-rate-limit');
const path        = require('path');

const authRoutes      = require('./routes/auth');
const quoteRoutes     = require('./routes/quotes');
const courierRoutes   = require('./routes/courier');
const portfolioRoutes = require('./routes/portfolio');
const adminRoutes     = require('./routes/admin');

const app  = express();
const PORT = process.env.PORT || 4000;

// ── Trust Vercel/proxy X-Forwarded-For (required for rate-limit on serverless) ──
app.set('trust proxy', 1);

// ── Security headers ──────────────────────────────────
app.use(helmet({
  crossOriginResourcePolicy: { policy: 'cross-origin' },
}));

// ── CORS ──────────────────────────────────────────────
const allowedOrigins = (process.env.CORS_ORIGINS || '')
  .split(',')
  .map(o => o.trim())
  .filter(Boolean);

app.use(cors({
  origin: (origin, cb) => {
    // Allow requests with no origin (e.g. mobile apps, curl, same-origin server calls)
    if (!origin || allowedOrigins.includes(origin)) return cb(null, true);
    cb(new Error(`CORS: origin ${origin} not allowed`));
  },
  credentials: true,
}));

// ── Body parsing ──────────────────────────────────────
app.use(express.json({ limit: '2mb' }));
app.use(express.urlencoded({ extended: true }));

// ── Logging ───────────────────────────────────────────
if (process.env.NODE_ENV !== 'test') {
  app.use(morgan(process.env.NODE_ENV === 'production' ? 'combined' : 'dev'));
}

// ── Rate limiting ─────────────────────────────────────
const generalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests. Please try again shortly.' },
});

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  message: { error: 'Too many auth attempts. Please wait 15 minutes.' },
});

const quoteLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 10,
  message: { error: 'Too many quote submissions from this IP.' },
});

app.use('/api/', generalLimiter);
app.use('/api/auth/', authLimiter);
app.use('/api/quotes', quoteLimiter);

// ── API Routes ────────────────────────────────────────
app.use('/api/auth',      authRoutes);
app.use('/api/quotes',    quoteRoutes);
app.use('/api/courier',   courierRoutes);
app.use('/api/portfolio', portfolioRoutes);
app.use('/api/admin',     adminRoutes);

// ── Health check ──────────────────────────────────────
app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    service: 'VTOS API',
    version: '1.0.0',
    timestamp: new Date().toISOString(),
  });
});

// ── DB diagnostic (temp) ──────────────────────────────
app.get('/api/dbtest', async (req, res) => {
  const pool = require('./db/connection');
  const bcrypt = require('bcryptjs');
  try {
    // Replicate exact login query
    const result = await pool.query(
      'SELECT * FROM users WHERE email = $1 AND is_active = true',
      ['admin@vtos.local']
    );
    if (result.rowCount === 0) return res.json({ ok: false, reason: 'user not found' });
    const user = result.rows[0];
    const valid = await bcrypt.compare('fingers007', user.password_hash);
    const jwt = require('jsonwebtoken');
    const secret = process.env.JWT_SECRET;
    let tokenOk = false, tokenErr = null;
    try {
      jwt.sign({ id: user.id }, secret, { expiresIn: '7d' });
      tokenOk = true;
    } catch(e) { tokenErr = e.message; }
    res.json({ ok: true, found: true, valid, role: user.role, hash_len: user.password_hash.length, secret_len: (secret||'').length, tokenOk, tokenErr });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message, code: err.code, stack: err.stack?.slice(0,500) });
  }
});

// ── 404 handler ───────────────────────────────────────
app.use('/api/*', (req, res) => {
  res.status(404).json({ error: `Route not found: ${req.method} ${req.originalUrl}` });
});

// ── Global error handler ──────────────────────────────
app.use((err, req, res, _next) => {
  console.error('[Server] Unhandled error:', err.message);
  res.status(500).json({ error: 'An unexpected error occurred.' });
});

// ── Start (local dev only — Vercel uses module.exports) ──
if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`
╔══════════════════════════════════════════════╗
║        VTOS API — Vector Online Solutions    ║
╠══════════════════════════════════════════════╣
║  Status  : Running                           ║
║  Port    : ${String(PORT).padEnd(34)}║
║  Env     : ${String(process.env.NODE_ENV || 'development').padEnd(34)}║
╚══════════════════════════════════════════════╝
    `);
  });
}

module.exports = app;
