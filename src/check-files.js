const { Pool } = require('pg');
require('dotenv').config();

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: {
        rejectUnauthorized: false
    }
});

async function checkFiles() {
    const client = await pool.connect();
    try {
        console.log('Checking ensemble_files table...');
        const res = await client.query('SELECT id, file_name, ensemble_id FROM ensemble_files LIMIT 10');
        console.log('Files found:', res.rows);

        if (res.rows.length === 0) {
            console.log('No files found in the database.');
        }
    } catch (err) {
        console.error('Error querying database:', err);
    } finally {
        client.release();
        await pool.end();
    }
}

checkFiles();
