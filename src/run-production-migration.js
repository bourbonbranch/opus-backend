// Run this with: DATABASE_URL=<your_railway_postgres_url> node src/run-production-migration.js

const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

async function runMigration() {
  const client = await pool.connect();
  try {
    console.log('Connected to database');
    console.log('Creating ensemble_sections table...');

    await client.query(`
      CREATE TABLE IF NOT EXISTS ensemble_sections (
        id SERIAL PRIMARY KEY,
        ensemble_id INTEGER REFERENCES ensembles(id) ON DELETE CASCADE,
        name TEXT NOT NULL,
        display_order INTEGER DEFAULT 0,
        color TEXT,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(ensemble_id, name)
      );
    `);
    console.log('✓ Created ensemble_sections table');

    console.log('Creating ensemble_parts table...');

    await client.query(`
      CREATE TABLE IF NOT EXISTS ensemble_parts (
        id SERIAL PRIMARY KEY,
        section_id INTEGER REFERENCES ensemble_sections(id) ON DELETE CASCADE,
        name TEXT NOT NULL,
        display_order INTEGER DEFAULT 0,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(section_id, name)
      );
    `);
    console.log('✓ Created ensemble_parts table');

    // Also add the part and pronouns columns to roster if they don't exist
    console.log('Adding part and pronouns columns to roster table...');

    await client.query(`
      ALTER TABLE roster 
      ADD COLUMN IF NOT EXISTS section TEXT,
      ADD COLUMN IF NOT EXISTS part TEXT,
      ADD COLUMN IF NOT EXISTS pronouns TEXT;
    `);
    console.log('✓ Added part and pronouns columns to roster');

    console.log('\n✅ Migration completed successfully!');
  } catch (err) {
    console.error('❌ Migration failed:', err);
    throw err;
  } finally {
    client.release();
    await pool.end();
  }
}

runMigration();
