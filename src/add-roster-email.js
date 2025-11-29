const { Pool } = require('pg');

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.DATABASE_URL?.includes('railway') ? { rejectUnauthorized: false } : false
});

async function addEmailToRoster() {
    const client = await pool.connect();
    try {
        console.log('Adding email column to roster table...');

        await client.query(`
      ALTER TABLE roster 
      ADD COLUMN IF NOT EXISTS email VARCHAR(255);
    `);

        console.log('Creating index on email column...');
        await client.query(`
      CREATE INDEX IF NOT EXISTS idx_roster_email ON roster(email);
    `);

        console.log('✅ Migration completed successfully!');
    } catch (err) {
        console.error('❌ Migration failed:', err);
        throw err;
    } finally {
        client.release();
        await pool.end();
    }
}

addEmailToRoster();
