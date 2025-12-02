const { Pool } = require('pg');
require('dotenv').config();

const connectionString = process.env.DATABASE_URL || 'postgresql://postgres:fWqcmFWhdMovPTRUbQyqxcpxiIkvPDuY@crossover.proxy.rlwy.net:30557/railway';

const pool = new Pool({
    connectionString: connectionString,
    ssl: { rejectUnauthorized: false }
});

async function checkTables() {
    try {
        const res = await pool.query(`
            SELECT table_name 
            FROM information_schema.tables 
            WHERE table_schema = 'public'
            AND table_name IN (
                'assignments', 'assignment_targets', 'assignment_submissions',
                'seating_layouts', 'seating_assignments',
                'fees', 'student_fees', 'payments',
                'fundraising_campaigns', 'student_fundraising_profiles', 'student_fundraising_contributions',
                'ticketed_events', 'student_ticket_credits',
                'director_score_notes', 'piece_announcements'
            )
        `);
        console.log('Existing tables:', res.rows.map(r => r.table_name));
    } catch (err) {
        console.error(err);
    } finally {
        await pool.end();
    }
}

checkTables();
