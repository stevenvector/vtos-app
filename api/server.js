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
const proposalRoutes  = require('./routes/proposals');
const invoiceRoutes   = require('./routes/invoices');
const serviceRoutes   = require('./routes/services');
const ledRoutes       = require('./routes/led');

const app  = express();
const PORT = process.env.PORT || 4000;

// ── Trust Vercel/proxy X-Forwarded-For (required for rate-limit on serverless) ──
app.set('trust proxy', 1);

// ── Security headers ──────────────────────────────────
app.use(helmet({
  crossOriginResourcePolicy: { policy: 'cross-origin' },
}));

// ── CORS ──────────────────────────────────────────────
// Own domains are always allowed — prevents the app locking itself out
const VTOS_ORIGINS = [
  'https://www.vtos.co.za',
  'https://vtos.co.za',
  'https://vtos.vercel.app',
];

const envOrigins = (process.env.CORS_ORIGINS || '')
  .split(',')
  .map(o => o.trim())
  .filter(Boolean);

// Merge and deduplicate; preview deployment URLs are allowed via envOrigins
const allowedOrigins = [...new Set([...VTOS_ORIGINS, ...envOrigins])];

app.use(cors({
  origin: (origin, cb) => {
    // Allow requests with no origin (curl, mobile apps, server-to-server)
    if (!origin) return cb(null, true);
    // Allow any *.vercel.app preview URL for this project
    if (origin.endsWith('.vercel.app')) return cb(null, true);
    // Check against combined allowlist
    if (allowedOrigins.includes(origin)) return cb(null, true);
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

// Note: quote-submission rate limit is applied only to POST /api/quotes
// inside the quotes router (so admin GET/PATCH/DELETE aren't capped).

app.use('/api/', generalLimiter);
app.use('/api/auth/', authLimiter);

// ── API Routes ────────────────────────────────────────
app.use('/api/auth',      authRoutes);
app.use('/api/quotes',    quoteRoutes);
app.use('/api/courier',   courierRoutes);
app.use('/api/portfolio', portfolioRoutes);
app.use('/api/admin',     adminRoutes);
app.use('/api/proposals', proposalRoutes);
app.use('/api/invoices',  invoiceRoutes);
app.use('/api/services',  serviceRoutes);
app.use('/api/led',       ledRoutes);

// ── Health check ──────────────────────────────────────
app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    service: 'VTOS API',
    version: '1.0.0',
    timestamp: new Date().toISOString(),
  });
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
