const { Pool } = require('pg');
require('dotenv').config();

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
});

async function addFeesTables() {
    const client = await pool.connect();
    try {
        console.log('Creating fees tables...');

        // 1. fee_definitions
        await client.query(`
            CREATE TABLE IF NOT EXISTS fee_definitions (
                id SERIAL PRIMARY KEY,
                ensemble_id INTEGER REFERENCES ensembles(id),
                name TEXT NOT NULL,
                description TEXT,
                amount_cents INTEGER NOT NULL,
                currency TEXT DEFAULT 'USD',
                default_due_date DATE,
                active BOOLEAN DEFAULT true,
                created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
            );
        `);
        console.log('✓ Created fee_definitions table');

        // 2. fee_assignments
        await client.query(`
            CREATE TABLE IF NOT EXISTS fee_assignments (
                id SERIAL PRIMARY KEY,
                ensemble_id INTEGER REFERENCES ensembles(id),
                fee_definition_id INTEGER REFERENCES fee_definitions(id),
                student_id INTEGER REFERENCES roster(id),
                amount_cents INTEGER NOT NULL,
                discount_cents INTEGER DEFAULT 0,
                status TEXT CHECK (status IN ('not_invoiced', 'invoiced', 'partial', 'paid', 'waived', 'canceled')),
                due_date DATE,
                notes TEXT,
                created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
            );
        `);
        console.log('✓ Created fee_assignments table');

        // 3. fee_payments
        await client.query(`
            CREATE TABLE IF NOT EXISTS fee_payments (
                id SERIAL PRIMARY KEY,
                fee_assignment_id INTEGER REFERENCES fee_assignments(id),
                amount_cents INTEGER NOT NULL,
                currency TEXT DEFAULT 'USD',
                payment_provider TEXT,
                provider_charge_id TEXT,
                paid_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
                status TEXT CHECK (status IN ('succeeded', 'pending', 'failed', 'refunded')),
                created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
            );
        `);
        console.log('✓ Created fee_payments table');

        console.log('Migration completed successfully!');
    } catch (err) {
        console.error('Migration failed:', err);
        throw err;
    } finally {
        client.release();
        await pool.end();
    }
}

addFeesTables();
