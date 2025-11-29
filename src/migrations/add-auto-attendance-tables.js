const { Pool } = require('pg');

async function runMigration() {
    const pool = new Pool({
        connectionString: process.env.DATABASE_URL,
        ssl: process.env.DB_SSL === 'true' ? { rejectUnauthorized: false } : false
    });

    try {
        console.log('Starting auto-attendance tables migration...');

        // 1. Create beacons table
        await pool.query(`
            CREATE TABLE IF NOT EXISTS beacons (
                id SERIAL PRIMARY KEY,
                identifier TEXT UNIQUE NOT NULL,
                label TEXT NOT NULL,
                room_id INTEGER REFERENCES rooms(id) ON DELETE SET NULL,
                created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
            );
        `);
        console.log('✓ Created beacons table');

        // 2. Create auto_attendance_sessions table
        await pool.query(`
            CREATE TABLE IF NOT EXISTS auto_attendance_sessions (
                id SERIAL PRIMARY KEY,
                event_id INTEGER REFERENCES events(id) ON DELETE CASCADE,
                beacon_id INTEGER REFERENCES beacons(id) ON DELETE CASCADE,
                started_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
                ended_at TIMESTAMP WITH TIME ZONE,
                is_active BOOLEAN DEFAULT true,
                created_by INTEGER REFERENCES users(id),
                CONSTRAINT unique_active_event_session UNIQUE (event_id, is_active)
            );
        `);
        console.log('✓ Created auto_attendance_sessions table');

        // 3. Add source column to attendance table if it doesn't exist
        const sourceColumnExists = await pool.query(`
            SELECT column_name 
            FROM information_schema.columns 
            WHERE table_name = 'attendance' AND column_name = 'source';
        `);

        if (sourceColumnExists.rows.length === 0) {
            await pool.query(`
                ALTER TABLE attendance 
                ADD COLUMN source TEXT DEFAULT 'manual';
            `);
            console.log('✓ Added source column to attendance table');
        } else {
            console.log('✓ Source column already exists in attendance table');
        }

        // 4. Add index on attendance (event_id, student_id) for faster lookups
        await pool.query(`
            CREATE INDEX IF NOT EXISTS idx_attendance_event_student 
            ON attendance(event_id, student_id);
        `);
        console.log('✓ Created index on attendance table');

        // 5. Seed test beacon
        const existingBeacon = await pool.query(`
            SELECT id FROM beacons WHERE identifier = 'TEST_BEACON_UUID';
        `);

        if (existingBeacon.rows.length === 0) {
            await pool.query(`
                INSERT INTO beacons (identifier, label) 
                VALUES ('TEST_BEACON_UUID', 'Choir Room A (Test)');
            `);
            console.log('✓ Seeded test beacon');
        } else {
            console.log('✓ Test beacon already exists');
        }

        console.log('\n✅ Auto-attendance migration completed successfully!');
    } catch (err) {
        console.error('❌ Migration failed:', err);
        throw err;
    } finally {
        await pool.end();
    }
}

// Run if called directly
if (require.main === module) {
    runMigration()
        .then(() => process.exit(0))
        .catch(() => process.exit(1));
}

module.exports = runMigration;
