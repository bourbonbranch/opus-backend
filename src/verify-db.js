const { Pool } = require('pg');
require('dotenv').config();

const connectionString = process.env.DATABASE_URL;

const pool = new Pool({
    connectionString,
    ssl: { rejectUnauthorized: false },
});

async function verify() {
    try {
        console.log('Verifying database...');
        // Check if tables exist
        const res = await pool.query(`
      SELECT table_name 
      FROM information_schema.tables 
      WHERE table_schema = 'public'
    `);
        console.log('Tables found:', res.rows.map(r => r.table_name));

        if (res.rows.length === 0) {
            throw new Error('No tables found!');
        }

        console.log('✅ Verification successful: Tables exist.');
    } catch (err) {
        console.error('❌ Verification failed:', err);
    } finally {
        await pool.end();
    }
}

verify();
