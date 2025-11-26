const { pool } = require('../db');

async function createSeatingConfigurationTables() {
    const client = await pool.connect();
    try {
        await client.query('BEGIN');

        // Create seating_configurations table
        await client.query(`
            CREATE TABLE IF NOT EXISTS seating_configurations (
                id SERIAL PRIMARY KEY,
                ensemble_id INTEGER REFERENCES ensembles(id) ON DELETE CASCADE,
                name TEXT NOT NULL,
                description TEXT,
                global_rows INTEGER NOT NULL,
                global_module_width NUMERIC NOT NULL,
                global_tread_depth NUMERIC NOT NULL,
                is_curved BOOLEAN DEFAULT true,
                created_by INTEGER REFERENCES users(id),
                created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
            );
        `);

        // Create seating_sections table
        await client.query(`
            CREATE TABLE IF NOT EXISTS seating_sections (
                id SERIAL PRIMARY KEY,
                configuration_id INTEGER REFERENCES seating_configurations(id) ON DELETE CASCADE,
                section_id INTEGER NOT NULL,
                section_name TEXT NOT NULL,
                ada_row INTEGER
            );
        `);

        // Create seating_placements table
        await client.query(`
            CREATE TABLE IF NOT EXISTS seating_placements (
                id SERIAL PRIMARY KEY,
                configuration_id INTEGER REFERENCES seating_configurations(id) ON DELETE CASCADE,
                student_id INTEGER REFERENCES students(id) ON DELETE CASCADE,
                section_id INTEGER NOT NULL,
                row INTEGER NOT NULL,
                position_index INTEGER NOT NULL,
                UNIQUE(configuration_id, student_id)
            );
        `);

        await client.query('COMMIT');
        console.log('✅ Seating configuration tables created successfully');
    } catch (err) {
        await client.query('ROLLBACK');
        console.error('❌ Error creating seating configuration tables:', err);
        throw err;
    } finally {
        client.release();
    }
}

createSeatingConfigurationTables()
    .then(() => {
        console.log('Migration completed');
        process.exit(0);
    })
    .catch((err) => {
        console.error('Migration failed:', err);
        process.exit(1);
    });
