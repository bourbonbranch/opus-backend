const { Pool } = require('pg');
require('dotenv').config();

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
});

async function inspectEnsembles() {
    const client = await pool.connect();
    try {
        const res = await client.query(`
            SELECT column_name, data_type 
            FROM information_schema.columns 
            WHERE table_name = 'ensembles';
        `);
        console.log('Ensembles columns:', res.rows);
    } catch (err) {
        console.error('Inspection failed:', err);
    } finally {
        client.release();
        await pool.end();
    }
}

inspectEnsembles();
