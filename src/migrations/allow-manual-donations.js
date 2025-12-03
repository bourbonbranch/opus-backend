const { Pool } = require('pg');

// Using the Public Proxy URL
const connectionString = 'postgresql://postgres:fWqcmFWhdMovPTRUbQyqxcpxiIkvPDuY@crossover.proxy.rlwy.net:30557/railway';

const pool = new Pool({
    connectionString: connectionString,
    ssl: { rejectUnauthorized: false },
});

async function allowManualDonations() {
    try {
        console.log('Connecting to database...');
        console.log('Altering donations table to allow manual entries...\n');

        // 1. Make campaign_id nullable
        await pool.query(`
            ALTER TABLE donations 
            ALTER COLUMN campaign_id DROP NOT NULL;
        `);
        console.log('✅ Made campaign_id nullable');

        // 2. Make stripe_payment_intent_id nullable
        await pool.query(`
            ALTER TABLE donations 
            ALTER COLUMN stripe_payment_intent_id DROP NOT NULL;
        `);
        console.log('✅ Made stripe_payment_intent_id nullable');

        // 3. Add payment_method column
        await pool.query(`
            ALTER TABLE donations 
            ADD COLUMN IF NOT EXISTS payment_method VARCHAR(50) DEFAULT 'stripe';
        `);
        console.log('✅ Added payment_method column');

        // 4. Add donation_date column (if different from created_at)
        await pool.query(`
            ALTER TABLE donations 
            ADD COLUMN IF NOT EXISTS donation_date TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP;
        `);
        console.log('✅ Added donation_date column');

        // 5. Add ensemble_id column (useful for manual donations not linked to a campaign)
        await pool.query(`
            ALTER TABLE donations 
            ADD COLUMN IF NOT EXISTS ensemble_id INTEGER REFERENCES ensembles(id) ON DELETE CASCADE;
        `);
        console.log('✅ Added ensemble_id column');

        // 6. Create index on ensemble_id
        await pool.query(`
            CREATE INDEX IF NOT EXISTS idx_donations_ensemble ON donations(ensemble_id);
        `);
        console.log('✅ Created index on ensemble_id');

        console.log('\n🎉 Donations table successfully altered!');

    } catch (err) {
        console.error('❌ Error altering donations table:', err);
        throw err;
    } finally {
        await pool.end();
    }
}

allowManualDonations();
