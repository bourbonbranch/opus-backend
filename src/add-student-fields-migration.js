const { Pool } = require('pg');

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
});

async function addStudentFields() {
    const client = await pool.connect();
    try {
        console.log('Adding part and pronouns columns to roster table...');

        // Add part column
        await client.query(`
      ALTER TABLE roster 
      ADD COLUMN IF NOT EXISTS part TEXT;
    `);
        console.log('✓ Added part column');

        // Add pronouns column
        await client.query(`
      ALTER TABLE roster 
      ADD COLUMN IF NOT EXISTS pronouns TEXT;
    `);
        console.log('✓ Added pronouns column');

        console.log('Migration completed successfully!');
    } catch (err) {
        console.error('Migration failed:', err);
        throw err;
    } finally {
        client.release();
        await pool.end();
    }
}

addStudentFields();
