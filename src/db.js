const { Pool } = require('pg');

const connectionString = process.env.DATABASE_URL;

if (!connectionString) {
  console.error('DATABASE_URL is not set. The backend cannot connect to Postgres.');
}

const sslEnabled = (() => {
  // Prefer explicit DB_SSL=true; fallback to true for typical Railway Postgres
  const v = process.env.DB_SSL;
  if (typeof v === 'string') return v.toLowerCase() === 'true';
  return true;
})();

const pool = new Pool({
  connectionString,
  ssl: sslEnabled ? { rejectUnauthorized: false } : false,
  max: 15,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 10000,
});

pool.on('connect', () => {
  console.log('✓ Connected to Postgres');
});

pool.on('error', (err) => {
  console.error('✗ Unexpected Postgres error:', err);
});

async function test() {
  try {
    const r = await pool.query('SELECT NOW() as now');
    console.log('DB time:', r.rows[0].now);
  } catch (e) {
    console.error('✗ Initial DB test query failed:', e.message);
  }
}
test();

module.exports = { pool };
