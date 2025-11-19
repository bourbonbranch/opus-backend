const { Pool } = require('pg');

const connectionString = process.env.DATABASE_URL;

if (!connectionString) {
  console.warn('⚠️  DATABASE_URL is not set. Database will not connect.');
}

const pool = new Pool({
  connectionString,
  ssl: connectionString && connectionString.includes('railway.app')
    ? { rejectUnauthorized: false }
    : false,
  // Add connection limits for Railway
  max: 20,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 10000,
});

// Test connection on startup
pool.on('connect', () => {
  console.log('✓ Database connected successfully');
});

pool.on('error', (err) => {
  console.error('❌ Unexpected database error:', err);
});

module.exports = { pool };
