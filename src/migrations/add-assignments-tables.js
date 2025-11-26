const { pool } = require('../db');

async function createAssignmentsTables() {
    const client = await pool.connect();
    try {
        await client.query('BEGIN');

        // Create assignments table
        await client.query(`
            CREATE TABLE IF NOT EXISTS assignments (
                id SERIAL PRIMARY KEY,
                ensemble_id INTEGER REFERENCES ensembles(id) ON DELETE CASCADE,
                title TEXT NOT NULL,
                description TEXT,
                type TEXT NOT NULL,
                due_at TIMESTAMP WITH TIME ZONE NOT NULL,
                status TEXT DEFAULT 'draft',
                piece_id INTEGER,
                measures_text TEXT,
                submission_required BOOLEAN DEFAULT true,
                grading_type TEXT DEFAULT 'completion',
                max_score INTEGER,
                visible_at TIMESTAMP WITH TIME ZONE,
                created_by INTEGER REFERENCES users(id),
                created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
            );
        `);

        // Create assignment_targets table
        await client.query(`
            CREATE TABLE IF NOT EXISTS assignment_targets (
                id SERIAL PRIMARY KEY,
                assignment_id INTEGER REFERENCES assignments(id) ON DELETE CASCADE,
                target_type TEXT NOT NULL,
                target_value TEXT,
                student_id INTEGER REFERENCES roster(id) ON DELETE CASCADE,
                created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
            );
        `);

        // Create assignment_submissions table
        await client.query(`
            CREATE TABLE IF NOT EXISTS assignment_submissions (
                id SERIAL PRIMARY KEY,
                assignment_id INTEGER REFERENCES assignments(id) ON DELETE CASCADE,
                student_id INTEGER REFERENCES roster(id) ON DELETE CASCADE,
                submitted_at TIMESTAMP WITH TIME ZONE,
                status TEXT DEFAULT 'not_started',
                score NUMERIC,
                feedback TEXT,
                text_response TEXT,
                file_url TEXT,
                audio_url TEXT,
                created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
                UNIQUE(assignment_id, student_id)
            );
        `);

        // Create assignment_attachments table
        await client.query(`
            CREATE TABLE IF NOT EXISTS assignment_attachments (
                id SERIAL PRIMARY KEY,
                assignment_id INTEGER REFERENCES assignments(id) ON DELETE CASCADE,
                file_name TEXT NOT NULL,
                file_url TEXT NOT NULL,
                file_type TEXT,
                created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
            );
        `);

        await client.query('COMMIT');
        console.log('✅ Assignments tables created successfully');
    } catch (err) {
        await client.query('ROLLBACK');
        console.error('❌ Error creating assignments tables:', err);
        throw err;
    } finally {
        client.release();
    }
}

createAssignmentsTables()
    .then(() => {
        console.log('Migration completed');
        process.exit(0);
    })
    .catch((err) => {
        console.error('Migration failed:', err);
        process.exit(1);
    });
