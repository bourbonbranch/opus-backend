const { Pool } = require('pg');

const pool = new Pool({
    connectionString: 'postgresql://postgres:fWqcmFWhdMovPTRUbQyqxcpxiIkvPDuY@crossover.proxy.rlwy.net:30557/railway',
    ssl: { rejectUnauthorized: false }
});

async function cleanupDuplicates() {
    try {
        console.log('Starting pipeline cleanup...');

        // Get all default stages
        const res = await pool.query(`
            SELECT id, name 
            FROM pipeline_stages 
            WHERE director_id IS NULL 
            ORDER BY id
        `);

        const stages = res.rows;
        const uniqueNames = [...new Set(stages.map(s => s.name))];

        console.log(`Found ${stages.length} total default stages.`);
        console.log(`Found ${uniqueNames.length} unique stage names.`);

        for (const name of uniqueNames) {
            const stageIds = stages.filter(s => s.name === name).map(s => s.id);

            if (stageIds.length > 1) {
                const keepId = stageIds[0];
                const removeIds = stageIds.slice(1);

                console.log(`\nProcessing '${name}':`);
                console.log(`  Keep ID: ${keepId}`);
                console.log(`  Remove IDs: ${removeIds.join(', ')}`);

                // 1. Update prospects to point to the kept stage
                const updateRes = await pool.query(`
                    UPDATE prospects 
                    SET pipeline_stage_id = $1 
                    WHERE pipeline_stage_id = ANY($2::int[])
                `, [keepId, removeIds]);

                console.log(`  Updated ${updateRes.rowCount} prospects.`);

                // 2. Delete the duplicate stages
                const deleteRes = await pool.query(`
                    DELETE FROM pipeline_stages 
                    WHERE id = ANY($1::int[])
                `, [removeIds]);

                console.log(`  Deleted ${deleteRes.rowCount} duplicate stages.`);
            }
        }

        console.log('\n✅ Cleanup complete!');

    } catch (err) {
        console.error('❌ Error during cleanup:', err);
    } finally {
        await pool.end();
    }
}

cleanupDuplicates();
