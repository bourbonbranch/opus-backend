const { Pool } = require('pg');

// Using the Public Proxy URL
const connectionString = 'postgresql://postgres:fWqcmFWhdMovPTRUbQyqxcpxiIkvPDuY@crossover.proxy.rlwy.net:30557/railway';

const pool = new Pool({
    connectionString: connectionString,
    ssl: { rejectUnauthorized: false },
});

async function createFundraisingTables() {
    try {
        console.log('Connecting to database...');
        console.log('Creating Fundraising Module tables...\n');

        // 1. Campaigns Table
        await pool.query(`
            CREATE TABLE IF NOT EXISTS campaigns (
                id SERIAL PRIMARY KEY,
                director_id INTEGER NOT NULL REFERENCES users(id),
                ensemble_id INTEGER REFERENCES ensembles(id),
                name VARCHAR(255) NOT NULL,
                slug VARCHAR(255) UNIQUE NOT NULL,
                description TEXT,
                goal_amount_cents INTEGER,
                per_student_goal_cents INTEGER,
                starts_at TIMESTAMP WITH TIME ZONE,
                ends_at TIMESTAMP WITH TIME ZONE,
                is_active BOOLEAN DEFAULT true,
                created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
            );
        `);
        console.log('✅ Campaigns table created');

        // 2. Campaign Participants Table
        await pool.query(`
            CREATE TABLE IF NOT EXISTS campaign_participants (
                id SERIAL PRIMARY KEY,
                campaign_id INTEGER NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
                student_id INTEGER NOT NULL REFERENCES roster(id) ON DELETE CASCADE,
                token VARCHAR(50) UNIQUE NOT NULL,
                personal_goal_cents INTEGER,
                total_raised_cents INTEGER DEFAULT 0,
                last_donation_at TIMESTAMP WITH TIME ZONE,
                created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
                
                UNIQUE(campaign_id, student_id)
            );
        `);
        console.log('✅ Campaign participants table created');

        // 3. Donations Table
        await pool.query(`
            CREATE TABLE IF NOT EXISTS donations (
                id SERIAL PRIMARY KEY,
                campaign_id INTEGER NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
                student_id INTEGER REFERENCES roster(id),
                participant_id INTEGER REFERENCES campaign_participants(id),
                stripe_payment_intent_id VARCHAR(255) UNIQUE NOT NULL,
                amount_cents INTEGER NOT NULL,
                currency VARCHAR(10) DEFAULT 'usd',
                donor_name VARCHAR(255),
                donor_email VARCHAR(255),
                is_anonymous BOOLEAN DEFAULT false,
                message TEXT,
                created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
            );
        `);
        console.log('✅ Donations table created');

        // Create Indexes
        await pool.query(`
            CREATE INDEX IF NOT EXISTS idx_donations_campaign ON donations(campaign_id);
            CREATE INDEX IF NOT EXISTS idx_donations_participant ON donations(participant_id);
        `);
        console.log('✅ Indexes created');

        console.log('\n🎉 All Fundraising Module tables created successfully!');

    } catch (err) {
        console.error('❌ Error creating fundraising tables:', err);
        throw err;
    } finally {
        await pool.end();
    }
}

createFundraisingTables();
