const { Pool } = require('pg');
require('dotenv').config();

const connectionString = process.env.DATABASE_URL || 'postgresql://postgres:fWqcmFWhdMovPTRUbQyqxcpxiIkvPDuY@crossover.proxy.rlwy.net:30557/railway';

const pool = new Pool({
    connectionString: connectionString,
    ssl: { rejectUnauthorized: false }
});

async function runMigration() {
    const client = await pool.connect();
    try {
        console.log('🚀 Starting V3 Schema Migration...');
        await client.query('BEGIN');

        // 1. Update assignments table
        console.log('Updating assignments table...');
        await client.query(`
            ALTER TABLE assignments 
            ADD COLUMN IF NOT EXISTS event_id INTEGER REFERENCES events(id) ON DELETE SET NULL,
            ADD COLUMN IF NOT EXISTS visibility TEXT DEFAULT 'ensemble';
        `);

        // 2. Seating Chart Tables
        console.log('Creating seating tables...');
        await client.query(`
            CREATE TABLE IF NOT EXISTS seating_layouts (
                id SERIAL PRIMARY KEY,
                ensemble_id INTEGER REFERENCES ensembles(id) ON DELETE CASCADE,
                name TEXT NOT NULL,
                layout_json JSONB NOT NULL,
                created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
            );

            CREATE TABLE IF NOT EXISTS seating_assignments (
                id SERIAL PRIMARY KEY,
                seating_layout_id INTEGER REFERENCES seating_layouts(id) ON DELETE CASCADE,
                student_id INTEGER REFERENCES roster(id) ON DELETE CASCADE,
                event_id INTEGER REFERENCES events(id) ON DELETE SET NULL,
                position_id TEXT NOT NULL,
                created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
                UNIQUE(seating_layout_id, student_id, event_id)
            );
        `);

        // 3. Fees & Payments Tables
        console.log('Creating fees and payments tables...');
        await client.query(`
            CREATE TABLE IF NOT EXISTS fees (
                id SERIAL PRIMARY KEY,
                ensemble_id INTEGER REFERENCES ensembles(id) ON DELETE CASCADE,
                name TEXT NOT NULL,
                description TEXT,
                amount NUMERIC(10, 2) NOT NULL,
                due_at TIMESTAMP WITH TIME ZONE,
                created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
            );

            CREATE TABLE IF NOT EXISTS student_fees (
                id SERIAL PRIMARY KEY,
                fee_id INTEGER REFERENCES fees(id) ON DELETE CASCADE,
                student_id INTEGER REFERENCES roster(id) ON DELETE CASCADE,
                assigned_amount NUMERIC(10, 2) NOT NULL,
                created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
                UNIQUE(fee_id, student_id)
            );

            CREATE TABLE IF NOT EXISTS payments (
                id SERIAL PRIMARY KEY,
                student_id INTEGER REFERENCES roster(id) ON DELETE CASCADE,
                fee_id INTEGER REFERENCES fees(id) ON DELETE SET NULL,
                amount NUMERIC(10, 2) NOT NULL,
                method TEXT NOT NULL,
                note TEXT,
                created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
            );
        `);

        // 4. Fundraising Tables
        console.log('Creating fundraising tables...');
        await client.query(`
            CREATE TABLE IF NOT EXISTS fundraising_campaigns (
                id SERIAL PRIMARY KEY,
                ensemble_id INTEGER REFERENCES ensembles(id) ON DELETE CASCADE,
                name TEXT NOT NULL,
                description TEXT,
                goal_amount NUMERIC(10, 2),
                start_at TIMESTAMP WITH TIME ZONE,
                end_at TIMESTAMP WITH TIME ZONE,
                created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
            );

            CREATE TABLE IF NOT EXISTS student_fundraising_profiles (
                id SERIAL PRIMARY KEY,
                campaign_id INTEGER REFERENCES fundraising_campaigns(id) ON DELETE CASCADE,
                student_id INTEGER REFERENCES roster(id) ON DELETE CASCADE,
                personal_goal_amount NUMERIC(10, 2),
                share_code TEXT UNIQUE NOT NULL,
                created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
                UNIQUE(campaign_id, student_id)
            );

            CREATE TABLE IF NOT EXISTS student_fundraising_contributions (
                id SERIAL PRIMARY KEY,
                campaign_id INTEGER REFERENCES fundraising_campaigns(id) ON DELETE CASCADE,
                student_id INTEGER REFERENCES roster(id) ON DELETE CASCADE,
                amount NUMERIC(10, 2) NOT NULL,
                source TEXT NOT NULL,
                donor_name TEXT,
                created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
            );
        `);

        // 5. Ticket Sales Tables
        console.log('Creating ticket sales tables...');
        await client.query(`
            CREATE TABLE IF NOT EXISTS ticketed_events (
                id SERIAL PRIMARY KEY,
                event_id INTEGER REFERENCES events(id) ON DELETE CASCADE,
                ticketing_url TEXT,
                enable_student_credit BOOLEAN DEFAULT false,
                created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
                UNIQUE(event_id)
            );

            CREATE TABLE IF NOT EXISTS student_ticket_credits (
                id SERIAL PRIMARY KEY,
                ticketed_event_id INTEGER REFERENCES ticketed_events(id) ON DELETE CASCADE,
                student_id INTEGER REFERENCES roster(id) ON DELETE CASCADE,
                tickets_sold_count INTEGER DEFAULT 0,
                revenue_amount NUMERIC(10, 2) DEFAULT 0,
                created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
                UNIQUE(ticketed_event_id, student_id)
            );
        `);

        // 6. Music Viewer Notes Tables
        console.log('Creating music notes tables...');
        await client.query(`
            CREATE TABLE IF NOT EXISTS director_score_notes (
                id SERIAL PRIMARY KEY,
                director_id INTEGER REFERENCES users(id),
                piece_id INTEGER REFERENCES ensemble_files(id) ON DELETE CASCADE,
                page_number INTEGER NOT NULL,
                x NUMERIC NOT NULL,
                y NUMERIC NOT NULL,
                text TEXT,
                created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
            );

            CREATE TABLE IF NOT EXISTS piece_announcements (
                id SERIAL PRIMARY KEY,
                director_id INTEGER REFERENCES users(id),
                piece_id INTEGER REFERENCES ensemble_files(id) ON DELETE CASCADE,
                title TEXT NOT NULL,
                body TEXT,
                created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
            );
        `);

        await client.query('COMMIT');
        console.log('✅ V3 Schema Migration completed successfully!');
    } catch (err) {
        await client.query('ROLLBACK');
        console.error('❌ Migration failed:', err);
        throw err;
    } finally {
        client.release();
        await pool.end();
    }
}

runMigration();
