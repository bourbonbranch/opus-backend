const { Pool } = require('pg');
require('dotenv').config();

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.DB_SSL === 'true' ? { rejectUnauthorized: false } : false
});

async function migrate() {
    const client = await pool.connect();
    try {
        console.log('Starting migration...');
        await client.query('BEGIN');

        // 1. Piece Sections
        await client.query(`
      CREATE TABLE IF NOT EXISTS piece_sections (
        id SERIAL PRIMARY KEY,
        piece_id INTEGER REFERENCES ensemble_files(id) ON DELETE CASCADE,
        name TEXT NOT NULL,
        measure_start INTEGER,
        measure_end INTEGER,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
      );
    `);
        console.log('Created piece_sections table');

        // 2. Score Annotations
        await client.query(`
      CREATE TABLE IF NOT EXISTS score_annotations (
        id SERIAL PRIMARY KEY,
        piece_id INTEGER REFERENCES ensemble_files(id) ON DELETE CASCADE,
        section_id INTEGER REFERENCES piece_sections(id) ON DELETE SET NULL,
        page_number INTEGER NOT NULL,
        x FLOAT NOT NULL,
        y FLOAT NOT NULL,
        measure_start INTEGER,
        measure_end INTEGER,
        category TEXT NOT NULL,
        note_text TEXT,
        created_by INTEGER REFERENCES users(id),
        created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
      );
    `);
        console.log('Created score_annotations table');

        // 3. Rehearsal Plans
        await client.query(`
      CREATE TABLE IF NOT EXISTS rehearsal_plans (
        id SERIAL PRIMARY KEY,
        piece_id INTEGER REFERENCES ensemble_files(id) ON DELETE CASCADE,
        ensemble_id INTEGER REFERENCES ensembles(id) ON DELETE CASCADE,
        title TEXT NOT NULL,
        target_date DATE,
        created_by INTEGER REFERENCES users(id),
        created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
      );
    `);
        console.log('Created rehearsal_plans table');

        // 4. Rehearsal Tasks
        await client.query(`
      CREATE TABLE IF NOT EXISTS rehearsal_tasks (
        id SERIAL PRIMARY KEY,
        rehearsal_plan_id INTEGER REFERENCES rehearsal_plans(id) ON DELETE CASCADE,
        piece_section_id INTEGER REFERENCES piece_sections(id) ON DELETE SET NULL,
        description TEXT NOT NULL,
        measure_start INTEGER,
        measure_end INTEGER,
        priority TEXT DEFAULT 'medium',
        status TEXT DEFAULT 'planned',
        created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
      );
    `);
        console.log('Created rehearsal_tasks table');

        await client.query('COMMIT');
        console.log('Migration completed successfully');
    } catch (err) {
        await client.query('ROLLBACK');
        console.error('Migration failed:', err);
    } finally {
        client.release();
        pool.end();
    }
}

migrate();
