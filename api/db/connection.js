const { Pool } = require('pg');
require('dotenv').config();

if (!process.env.DATABASE_URL) {
  console.error('[DB] ERROR: DATABASE_URL is not set.');
}

// Strip channel_binding param — not supported by pg v8 (Neon adds it in newer connection strings)
const dbUrl = (process.env.DATABASE_URL || '')
  .replace(/[&?]channel_binding=[^&]*/g, '')
  .replace(/\?&/, '?');

// SSL config: verify the server certificate by default (defends against
// MITM on the DB connection). Set DB_SSL_INSECURE=true in env as an
// emergency escape hatch if a certificate chain issue ever blocks
// connectivity — we'd rather have a knob than have the site go dark.
const sslConfig = process.env.DB_SSL_INSECURE === 'true'
  ? { rejectUnauthorized: false }
  : { rejectUnauthorized: true };

if (process.env.DB_SSL_INSECURE === 'true') {
  console.warn('[DB] WARNING: DB_SSL_INSECURE=true — server cert is NOT being verified.');
}

// Single pool instance — works for both local dev and Vercel serverless
const pool = new Pool({
  connectionString: dbUrl,
  ssl: sslConfig,
  max: 1,               // Serverless: keep connection count low
  idleTimeoutMillis: 10000,
  connectionTimeoutMillis: 10000,
});

pool.on('error', (err) => {
  console.error('[DB] Pool error:', err.message);
});

module.exports = pool;
