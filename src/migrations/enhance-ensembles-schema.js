const { Pool } = require('pg');

const connectionString = 'postgresql://postgres:fWqcmFWhdMovPTRUbQyqxcpxiIkvPDuY@crossover.proxy.rlwy.net:30557/railway';

const pool = new Pool({
    connectionString: connectionString,
    ssl: { rejectUnauthorized: false },
});

async function enhanceEnsemblesSchema() {
    try {
        console.log('Enhancing Ensembles schema...\n');

        // 1. Add columns to ensembles table
        await pool.query(`
            ALTER TABLE ensembles 
            ADD COLUMN IF NOT EXISTS description TEXT,
            ADD COLUMN IF NOT EXISTS short_code VARCHAR(10),
            ADD COLUMN IF NOT EXISTS color_hex VARCHAR(7),
            ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP;
        `);
        console.log('✅ Enhanced ensembles table');

        // 2. Create ensemble_files table
        await pool.query(`
            CREATE TABLE IF NOT EXISTS ensemble_files (
                id SERIAL PRIMARY KEY,
                ensemble_id INTEGER NOT NULL REFERENCES ensembles(id) ON DELETE CASCADE,
                title VARCHAR(255) NOT NULL,
                file_type VARCHAR(50),
                storage_url TEXT,
                file_size INTEGER,
                uploaded_by INTEGER REFERENCES users(id),
                created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
            );
        `);
        console.log('✅ Created ensemble_files table');

        // 3. Create ensemble_assignments table
        await pool.query(`
            CREATE TABLE IF NOT EXISTS ensemble_assignments (
                id SERIAL PRIMARY KEY,
                ensemble_id INTEGER NOT NULL REFERENCES ensembles(id) ON DELETE CASCADE,
                title VARCHAR(255) NOT NULL,
                description TEXT,
                type VARCHAR(50),
                due_at TIMESTAMP WITH TIME ZONE,
                status VARCHAR(50) DEFAULT 'active',
                created_by INTEGER REFERENCES users(id),
                created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
            );
        `);
        console.log('✅ Created ensemble_assignments table');

        // 4. Create indexes for performance
        await pool.query(`
            CREATE INDEX IF NOT EXISTS idx_ensemble_files_ensemble ON ensemble_files(ensemble_id);
            CREATE INDEX IF NOT EXISTS idx_ensemble_assignments_ensemble ON ensemble_assignments(ensemble_id);
        `);
        console.log('✅ Created indexes');

        console.log('\n🎉 Ensembles schema enhancement complete!');

    } catch (err) {
        console.error('❌ Error enhancing schema:', err);
        throw err;
    } finally {
        await pool.end();
    }
}

enhanceEnsemblesSchema();
