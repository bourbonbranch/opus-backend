const { Pool } = require('pg');
const fs = require('fs');
const path = require('path');
require('dotenv').config();

const connectionString = process.env.DATABASE_URL;

if (!connectionString) {
  console.error('Error: DATABASE_URL environment variable is not set.');
  console.error('Usage: DATABASE_URL=<your_connection_string> node src/init-db.js');
  process.exit(1);
}

const pool = new Pool({
  connectionString,
  ssl: { rejectUnauthorized: false }, // Usually needed for Railway/cloud DBs
});

async function initDb() {
  try {
    const schemaPath = path.join(__dirname, '..', 'schema.sql');
    const schemaSql = fs.readFileSync(schemaPath, 'utf8');

    console.log('Connecting to database...');
    const client = await pool.connect();
    
    console.log('Running schema.sql...');
    await client.query(schemaSql);
    
    console.log('✅ Database initialized successfully!');
    client.release();
  } catch (err) {
    console.error('❌ Error initializing database:', err);
  } finally {
    await pool.end();
  }
}

initDb();
