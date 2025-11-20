const { Pool } = require('pg');

// Trying the internal URL provided by the user
const connectionString = 'postgresql://postgres:fWqcmFWhdMovPTRUbQyqxcpxiIkvPDuY@postgres.railway.internal:5432/railway';

const pool = new Pool({
  connectionString: connectionString,
  // ssl: { rejectUnauthorized: false }, // Internal might not need SSL, or might need it.
});

async function addMessagesTables() {
  try {
    console.log('Connecting to database (internal URL)...');

    // Messages table
    await pool.query(`
      CREATE TABLE IF NOT EXISTS messages (
        id SERIAL PRIMARY KEY,
        director_id INTEGER REFERENCES users(id),
        ensemble_id INTEGER REFERENCES ensembles(id),
        subject TEXT NOT NULL,
        content TEXT NOT NULL,
        recipients_summary TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);

    // Message recipients table
    await pool.query(`
      CREATE TABLE IF NOT EXISTS message_recipients (
        id SERIAL PRIMARY KEY,
        message_id INTEGER REFERENCES messages(id) ON DELETE CASCADE,
        roster_id INTEGER REFERENCES roster(id),
        read_at TIMESTAMP,
        UNIQUE(message_id, roster_id)
      );
    `);

    console.log('✅ Messages tables created successfully');
  } catch (err) {
    console.error('❌ Error creating messages tables:', err);
  } finally {
    await pool.end();
  }
}

addMessagesTables();
