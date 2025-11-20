const { Pool } = require('pg');
require('dotenv').config();

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.DB_SSL === 'false' ? false : { rejectUnauthorized: false },
});

async function addEventsTable() {
    try {
        console.log('Adding events table to database...');

        await pool.query(`
      CREATE TABLE IF NOT EXISTS events (
        id SERIAL PRIMARY KEY,
        ensemble_id INTEGER REFERENCES ensembles(id) ON DELETE CASCADE,
        room_id INTEGER REFERENCES rooms(id) ON DELETE SET NULL,
        name TEXT NOT NULL,
        type TEXT NOT NULL,
        start_time TIMESTAMP WITH TIME ZONE NOT NULL,
        end_time TIMESTAMP WITH TIME ZONE NOT NULL,
        description TEXT,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
      );
    `);

        console.log('✅ Events table created successfully!');

        // Verify the table exists
        const result = await pool.query(`
      SELECT table_name 
      FROM information_schema.tables 
      WHERE table_schema = 'public' 
      AND table_name = 'events';
    `);

        if (result.rows.length > 0) {
            console.log('✅ Verified: events table exists');
        } else {
            console.log('❌ Error: events table was not created');
        }

    } catch (err) {
        console.error('Error adding events table:', err);
    } finally {
        await pool.end();
    }
}

addEventsTable();
