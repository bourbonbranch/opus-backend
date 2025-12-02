const { Pool } = require('pg');
require('dotenv').config();

const connectionString = process.env.DATABASE_URL || 'postgresql://postgres:fWqcmFWhdMovPTRUbQyqxcpxiIkvPDuY@crossover.proxy.rlwy.net:30557/railway';

const pool = new Pool({
    connectionString: connectionString,
    ssl: { rejectUnauthorized: false }
});

async function findReferencedTable() {
    try {
        const res = await pool.query(`
            SELECT
                ccu.table_name AS foreign_table_name
            FROM
                information_schema.table_constraints AS tc
                JOIN information_schema.key_column_usage AS kcu
                  ON tc.constraint_name = kcu.constraint_name
                  AND tc.table_schema = kcu.table_schema
                JOIN information_schema.constraint_column_usage AS ccu
                  ON ccu.constraint_name = tc.constraint_name
                  AND ccu.table_schema = tc.table_schema
            WHERE tc.constraint_type = 'FOREIGN KEY'
            AND tc.table_name = 'piece_sections'
            AND kcu.column_name = 'piece_id';
        `);

        console.log('Referenced table:', res.rows[0]?.foreign_table_name);
    } catch (err) {
        console.error(err);
    } finally {
        await pool.end();
    }
}

findReferencedTable();
