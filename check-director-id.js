const { Pool } = require('pg');

const connectionString = 'postgresql://postgres:fWqcmFWhdMovPTRUbQyqxcpxiIkvPDuY@crossover.proxy.rlwy.net:30557/railway';

const pool = new Pool({
    connectionString: connectionString,
    ssl: { rejectUnauthorized: false },
});

async function checkDirectorIds() {
    try {
        console.log('Checking for valid director IDs...\n');

        const result = await pool.query(`
            SELECT id, email, role 
            FROM users 
            WHERE role = 'director' OR email LIKE '%jacob%'
            ORDER BY id
        `);

        console.log('Found users:');
        result.rows.forEach(user => {
            console.log(`  ID: ${user.id}, Email: ${user.email}, Role: ${user.role}`);
        });

    } catch (err) {
        console.error('Error:', err);
    } finally {
        await pool.end();
    }
}

checkDirectorIds();
