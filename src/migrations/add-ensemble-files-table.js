const { Pool } = require('pg');
require('dotenv').config();

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.DB_SSL === 'true' ? { rejectUnauthorized: false } : false,
});

async function migrate() {
    const client = await pool.connect();
    try {
        console.log('Creating ensemble_files table...');

        await client.query(`
      CREATE TABLE IF NOT EXISTS ensemble_files (
        id SERIAL PRIMARY KEY,
        ensemble_id INTEGER REFERENCES ensembles(id) ON DELETE CASCADE,
        title TEXT NOT NULL,
        file_type TEXT,
        storage_url TEXT NOT NULL,
        file_size INTEGER,
        uploaded_by INTEGER REFERENCES users(id),
        created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
      );
    `);

        console.log('✅ ensemble_files table created successfully');
    } catch (error) {
        console.error('❌ Migration failed:', error);
        throw error;
    } finally {
        client.release();
        await pool.end();
    }
}

migrate().catch(console.error);
