const { Pool } = require('pg');
require('dotenv').config();

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.DB_SSL === 'false' ? false : { rejectUnauthorized: false },
});

async function addCalendarItemsTable() {
    try {
        console.log('Adding calendar_items table to database...');

        await pool.query(`
      CREATE TABLE IF NOT EXISTS calendar_items (
        id SERIAL PRIMARY KEY,
        director_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
        ensemble_id INTEGER REFERENCES ensembles(id) ON DELETE CASCADE,
        title TEXT NOT NULL,
        type TEXT NOT NULL,
        date TIMESTAMP WITH TIME ZONE NOT NULL,
        description TEXT,
        color TEXT,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
      );
    `);

        console.log('✅ Calendar items table created successfully!');

        // Verify the table exists
        const result = await pool.query(`
      SELECT table_name 
      FROM information_schema.tables 
      WHERE table_schema = 'public' 
      AND table_name = 'calendar_items';
    `);

        if (result.rows.length > 0) {
            console.log('✅ Verified: calendar_items table exists');
        } else {
            console.log('❌ Error: calendar_items table was not created');
        }

    } catch (err) {
        console.error('Error adding calendar_items table:', err);
    } finally {
        await pool.end();
    }
}

addCalendarItemsTable();
