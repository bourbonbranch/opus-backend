const { Pool } = require('pg');
require('dotenv').config();

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: {
        rejectUnauthorized: false
    }
});

async function migrate() {
    const client = await pool.connect();
    try {
        console.log('Starting migration: add_annotation_features...');
        await client.query('BEGIN');

        // Add new columns to score_annotations
        await client.query(`
            ALTER TABLE score_annotations 
            ADD COLUMN IF NOT EXISTS type VARCHAR(50) DEFAULT 'text',
            ADD COLUMN IF NOT EXISTS data TEXT,
            ADD COLUMN IF NOT EXISTS is_published BOOLEAN DEFAULT false;
        `);

        await client.query('COMMIT');
        console.log('Migration completed successfully');
    } catch (err) {
        await client.query('ROLLBACK');
        console.error('Migration failed:', err);
    } finally {
        client.release();
        await pool.end();
    }
}

migrate();
