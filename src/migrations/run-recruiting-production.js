// This script runs the recruiting tables migration on the production database
// It uses the same connection string as the migration file

const { Pool } = require('pg');

// Using the Public Proxy URL from the migration file
const connectionString = 'postgresql://postgres:fWqcmFWhdMovPTRUbQyqxcpxiIkvPDuY@crossover.proxy.rlwy.net:30557/railway';

const pool = new Pool({
    connectionString: connectionString,
    ssl: { rejectUnauthorized: false },
});

async function runProductionMigration() {
    try {
        console.log('🚀 Running Recruiting Module migration on PRODUCTION database...\n');

        // Import and run the migration
        const { Pool: MigrationPool } = require('pg');
        const migrationPool = new MigrationPool({
            connectionString: connectionString,
            ssl: { rejectUnauthorized: false },
        });

        console.log('Connecting to production database...');

        // Run the exact same migration as add-recruiting-tables.js
        await runRecruitingMigration(migrationPool);

        await migrationPool.end();
        console.log('\n✅ Production migration completed successfully!');

    } catch (err) {
        console.error('❌ Production migration failed:', err);
        throw err;
    }
}

async function runRecruitingMigration(pool) {
    console.log('Creating Recruiting Module tables...\n');

    // 1. Pipeline Stages Table
    await pool.query(`
      CREATE TABLE IF NOT EXISTS pipeline_stages (
        id SERIAL PRIMARY KEY,
        director_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
        name VARCHAR(100) NOT NULL,
        description TEXT,
        order_index INTEGER NOT NULL,
        color VARCHAR(20),
        is_default BOOLEAN DEFAULT false,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(director_id, name)
      );
    `);
    console.log('✅ Pipeline stages table created');

    // Create default pipeline stages
    await pool.query(`
      INSERT INTO pipeline_stages (director_id, name, order_index, color, is_default)
      VALUES 
        (NULL, 'New Lead', 1, '#6B7280', true),
        (NULL, 'Contacted', 2, '#3B82F6', true),
        (NULL, 'Audition Scheduled', 3, '#F59E0B', true),
        (NULL, 'Audition Completed', 4, '#8B5CF6', true),
        (NULL, 'Accepted', 5, '#10B981', true),
        (NULL, 'Enrolled', 6, '#059669', true),
        (NULL, 'In Ensemble', 7, '#6366F1', true)
      ON CONFLICT DO NOTHING;
    `);
    console.log('✅ Default pipeline stages inserted');

    // 2. Prospects Table
    await pool.query(`
      CREATE TABLE IF NOT EXISTS prospects (
        id SERIAL PRIMARY KEY,
        director_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        
        -- Personal Info
        first_name VARCHAR(100) NOT NULL,
        last_name VARCHAR(100) NOT NULL,
        email VARCHAR(255) NOT NULL,
        phone VARCHAR(20),
        
        -- Academic Info
        high_school VARCHAR(255),
        graduation_year INTEGER,
        gpa DECIMAL(3,2),
        
        -- Musical Info
        voice_part VARCHAR(50),
        instrument VARCHAR(100),
        years_experience INTEGER,
        
        -- Recruiting Info
        interest_level VARCHAR(20) DEFAULT 'warm',
        pipeline_stage_id INTEGER REFERENCES pipeline_stages(id),
        audition_scheduled BOOLEAN DEFAULT false,
        audition_date TIMESTAMP,
        
        -- Assignment
        assigned_recruiter_id INTEGER REFERENCES users(id),
        
        -- Tracking
        source VARCHAR(100),
        source_detail TEXT,
        notes TEXT,
        follow_up_date DATE,
        
        -- Ensemble Preferences (JSON)
        ensemble_preferences JSONB,
        recommended_placement VARCHAR(255),
        
        -- Status
        status VARCHAR(20) DEFAULT 'active',
        converted_to_student_id INTEGER REFERENCES roster(id),
        converted_at TIMESTAMP,
        
        -- Timestamps
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        created_by INTEGER REFERENCES users(id),
        
        UNIQUE(director_id, email)
      );
    `);
    console.log('✅ Prospects table created');

    // Create indexes for prospects
    await pool.query(`
      CREATE INDEX IF NOT EXISTS idx_prospects_director ON prospects(director_id);
      CREATE INDEX IF NOT EXISTS idx_prospects_email ON prospects(email);
      CREATE INDEX IF NOT EXISTS idx_prospects_stage ON prospects(pipeline_stage_id);
      CREATE INDEX IF NOT EXISTS idx_prospects_status ON prospects(status);
      CREATE INDEX IF NOT EXISTS idx_prospects_grad_year ON prospects(graduation_year);
      CREATE INDEX IF NOT EXISTS idx_prospects_voice_part ON prospects(voice_part);
    `);
    console.log('✅ Prospect indexes created');

    // 3. Prospect Communications Table
    await pool.query(`
      CREATE TABLE IF NOT EXISTS prospect_communications (
        id SERIAL PRIMARY KEY,
        prospect_id INTEGER NOT NULL REFERENCES prospects(id) ON DELETE CASCADE,
        
        type VARCHAR(50) NOT NULL,
        subject VARCHAR(255),
        message TEXT,
        template_id INTEGER,
        
        sent_by INTEGER REFERENCES users(id),
        sent_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        
        -- Email tracking
        opened BOOLEAN DEFAULT false,
        opened_at TIMESTAMP,
        clicked BOOLEAN DEFAULT false,
        clicked_at TIMESTAMP
      );
    `);
    console.log('✅ Prospect communications table created');

    await pool.query(`
      CREATE INDEX IF NOT EXISTS idx_comm_prospect ON prospect_communications(prospect_id);
      CREATE INDEX IF NOT EXISTS idx_comm_type ON prospect_communications(type);
    `);
    console.log('✅ Communication indexes created');

    // 4. Prospect Assignments Table
    await pool.query(`
      CREATE TABLE IF NOT EXISTS prospect_assignments (
        id SERIAL PRIMARY KEY,
        prospect_id INTEGER NOT NULL REFERENCES prospects(id) ON DELETE CASCADE,
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        role VARCHAR(50),
        assigned_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        assigned_by INTEGER REFERENCES users(id),
        
        UNIQUE(prospect_id, user_id)
      );
    `);
    console.log('✅ Prospect assignments table created');

    await pool.query(`
      CREATE INDEX IF NOT EXISTS idx_assignments_prospect ON prospect_assignments(prospect_id);
      CREATE INDEX IF NOT EXISTS idx_assignments_user ON prospect_assignments(user_id);
    `);
    console.log('✅ Assignment indexes created');

    // 5. Email Templates Table
    await pool.query(`
      CREATE TABLE IF NOT EXISTS email_templates (
        id SERIAL PRIMARY KEY,
        director_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
        
        name VARCHAR(100) NOT NULL,
        subject VARCHAR(255) NOT NULL,
        body TEXT NOT NULL,
        
        category VARCHAR(50),
        is_active BOOLEAN DEFAULT true,
        
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        created_by INTEGER REFERENCES users(id)
      );
    `);
    console.log('✅ Email templates table created');

    await pool.query(`
      CREATE INDEX IF NOT EXISTS idx_templates_director ON email_templates(director_id);
      CREATE INDEX IF NOT EXISTS idx_templates_category ON email_templates(category);
    `);
    console.log('✅ Template indexes created');

    // 6. Recruiting QR Codes Table
    await pool.query(`
      CREATE TABLE IF NOT EXISTS recruiting_qr_codes (
        id SERIAL PRIMARY KEY,
        director_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        
        code VARCHAR(50) UNIQUE NOT NULL,
        name VARCHAR(100) NOT NULL,
        description TEXT,
        
        form_config JSONB,
        
        scan_count INTEGER DEFAULT 0,
        submission_count INTEGER DEFAULT 0,
        is_active BOOLEAN DEFAULT true,
        
        expires_at TIMESTAMP,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        created_by INTEGER REFERENCES users(id)
      );
    `);
    console.log('✅ Recruiting QR codes table created');

    await pool.query(`
      CREATE INDEX IF NOT EXISTS idx_qr_director ON recruiting_qr_codes(director_id);
      CREATE INDEX IF NOT EXISTS idx_qr_code ON recruiting_qr_codes(code);
    `);
    console.log('✅ QR code indexes created');

    // 7. Recruiting Analytics Table
    await pool.query(`
      CREATE TABLE IF NOT EXISTS recruiting_analytics (
        id SERIAL PRIMARY KEY,
        director_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        
        period_start DATE NOT NULL,
        period_end DATE NOT NULL,
        
        metrics JSONB,
        
        generated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);
    console.log('✅ Recruiting analytics table created');

    await pool.query(`
      CREATE INDEX IF NOT EXISTS idx_analytics_director ON recruiting_analytics(director_id);
      CREATE INDEX IF NOT EXISTS idx_analytics_period ON recruiting_analytics(period_start, period_end);
    `);
    console.log('✅ Analytics indexes created');

    console.log('\n🎉 All Recruiting Module tables created on PRODUCTION!');
    console.log('\nTables created:');
    console.log('  1. pipeline_stages (with 7 default stages)');
    console.log('  2. prospects');
    console.log('  3. prospect_communications');
    console.log('  4. prospect_assignments');
    console.log('  5. email_templates');
    console.log('  6. recruiting_qr_codes');
    console.log('  7. recruiting_analytics');
    console.log('\nTotal indexes created: 14');
}

runProductionMigration();
