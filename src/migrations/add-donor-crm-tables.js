const { Pool } = require('pg');

// Using the Public Proxy URL
const connectionString = 'postgresql://postgres:fWqcmFWhdMovPTRUbQyqxcpxiIkvPDuY@crossover.proxy.rlwy.net:30557/railway';

const pool = new Pool({
    connectionString: connectionString,
    ssl: { rejectUnauthorized: false },
});

async function createDonorCRMTables() {
    try {
        console.log('Connecting to database...');
        console.log('Creating Donor CRM tables...\\n');

        // 1. Donors Table
        await pool.query(`
            CREATE TABLE IF NOT EXISTS donors (
                id SERIAL PRIMARY KEY,
                ensemble_id INTEGER NOT NULL REFERENCES ensembles(id) ON DELETE CASCADE,
                
                -- Contact Information
                first_name VARCHAR(255),
                last_name VARCHAR(255),
                organization_name VARCHAR(255),
                email VARCHAR(255),
                phone VARCHAR(50),
                
                -- Address
                address_line1 TEXT,
                address_line2 TEXT,
                city VARCHAR(100),
                state VARCHAR(50),
                postal_code VARCHAR(20),
                country VARCHAR(50) DEFAULT 'US',
                
                -- Additional Info
                employer VARCHAR(255),
                preferred_contact_method VARCHAR(50) DEFAULT 'email',
                tags TEXT[], -- Array of tags like 'parent', 'alumni', 'sponsor'
                notes TEXT,
                
                -- Denormalized Aggregates (for performance)
                lifetime_donation_cents INTEGER DEFAULT 0,
                ytd_donation_cents INTEGER DEFAULT 0,
                first_donation_at TIMESTAMP WITH TIME ZONE,
                last_donation_at TIMESTAMP WITH TIME ZONE,
                
                created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
                
                -- Constraints
                CONSTRAINT donor_has_name_or_org CHECK (
                    first_name IS NOT NULL OR 
                    last_name IS NOT NULL OR 
                    organization_name IS NOT NULL
                )
            );
        `);
        console.log('✅ Donors table created');

        // 2. Add donor_id to existing donations table
        await pool.query(`
            ALTER TABLE donations 
            ADD COLUMN IF NOT EXISTS donor_id INTEGER REFERENCES donors(id) ON DELETE SET NULL;
        `);
        console.log('✅ Added donor_id column to donations table');

        // 3. Donor Activities Table
        await pool.query(`
            CREATE TABLE IF NOT EXISTS donor_activities (
                id SERIAL PRIMARY KEY,
                ensemble_id INTEGER NOT NULL REFERENCES ensembles(id) ON DELETE CASCADE,
                donor_id INTEGER NOT NULL REFERENCES donors(id) ON DELETE CASCADE,
                
                type VARCHAR(50) NOT NULL, -- 'donation', 'ticket_purchase', 'note', 'email_sent', 'manual_log'
                summary TEXT NOT NULL, -- Short description
                details JSONB, -- Structured data (campaign_id, amount, etc.)
                related_id INTEGER, -- donation_id, order_id, etc.
                
                created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
            );
        `);
        console.log('✅ Donor activities table created');

        // 4. Create Indexes
        await pool.query(`
            CREATE INDEX IF NOT EXISTS idx_donors_ensemble ON donors(ensemble_id);
            CREATE INDEX IF NOT EXISTS idx_donors_email ON donors(email);
            CREATE INDEX IF NOT EXISTS idx_donors_last_donation ON donors(last_donation_at DESC);
            CREATE INDEX IF NOT EXISTS idx_donors_lifetime ON donors(lifetime_donation_cents DESC);
            
            CREATE INDEX IF NOT EXISTS idx_donations_donor ON donations(donor_id);
            
            CREATE INDEX IF NOT EXISTS idx_donor_activities_donor ON donor_activities(donor_id);
            CREATE INDEX IF NOT EXISTS idx_donor_activities_ensemble ON donor_activities(ensemble_id);
            CREATE INDEX IF NOT EXISTS idx_donor_activities_type ON donor_activities(type);
            CREATE INDEX IF NOT EXISTS idx_donor_activities_created ON donor_activities(created_at DESC);
        `);
        console.log('✅ Indexes created');

        // 5. Create function to update donor aggregates
        await pool.query(`
            CREATE OR REPLACE FUNCTION update_donor_aggregates(donor_id_param INTEGER)
            RETURNS VOID AS $$
            DECLARE
                total_lifetime INTEGER;
                total_ytd INTEGER;
                first_date TIMESTAMP WITH TIME ZONE;
                last_date TIMESTAMP WITH TIME ZONE;
            BEGIN
                -- Calculate lifetime total
                SELECT COALESCE(SUM(amount_cents), 0)
                INTO total_lifetime
                FROM donations
                WHERE donor_id = donor_id_param;
                
                -- Calculate YTD total
                SELECT COALESCE(SUM(amount_cents), 0)
                INTO total_ytd
                FROM donations
                WHERE donor_id = donor_id_param
                AND EXTRACT(YEAR FROM created_at) = EXTRACT(YEAR FROM CURRENT_DATE);
                
                -- Get first and last donation dates
                SELECT MIN(created_at), MAX(created_at)
                INTO first_date, last_date
                FROM donations
                WHERE donor_id = donor_id_param;
                
                -- Update donor record
                UPDATE donors
                SET 
                    lifetime_donation_cents = total_lifetime,
                    ytd_donation_cents = total_ytd,
                    first_donation_at = first_date,
                    last_donation_at = last_date,
                    updated_at = CURRENT_TIMESTAMP
                WHERE id = donor_id_param;
            END;
            $$ LANGUAGE plpgsql;
        `);
        console.log('✅ Created update_donor_aggregates function');

        // 6. Create trigger to auto-update aggregates when donations change
        await pool.query(`
            CREATE OR REPLACE FUNCTION trigger_update_donor_aggregates()
            RETURNS TRIGGER AS $$
            BEGIN
                IF TG_OP = 'INSERT' OR TG_OP = 'UPDATE' THEN
                    IF NEW.donor_id IS NOT NULL THEN
                        PERFORM update_donor_aggregates(NEW.donor_id);
                    END IF;
                END IF;
                
                IF TG_OP = 'DELETE' THEN
                    IF OLD.donor_id IS NOT NULL THEN
                        PERFORM update_donor_aggregates(OLD.donor_id);
                    END IF;
                END IF;
                
                RETURN NULL;
            END;
            $$ LANGUAGE plpgsql;
            
            DROP TRIGGER IF EXISTS donations_update_donor_aggregates ON donations;
            
            CREATE TRIGGER donations_update_donor_aggregates
            AFTER INSERT OR UPDATE OR DELETE ON donations
            FOR EACH ROW
            EXECUTE FUNCTION trigger_update_donor_aggregates();
        `);
        console.log('✅ Created trigger for automatic aggregate updates');

        console.log('\\n🎉 All Donor CRM tables created successfully!');
        console.log('\\n📊 Summary:');
        console.log('   - donors table (with aggregates)');
        console.log('   - donor_activities table (timeline)');
        console.log('   - Extended donations table with donor_id');
        console.log('   - Automatic aggregate calculation via triggers');

    } catch (err) {
        console.error('❌ Error creating Donor CRM tables:', err);
        throw err;
    } finally {
        await pool.end();
    }
}

createDonorCRMTables();
