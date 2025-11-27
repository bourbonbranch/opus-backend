module.exports = function (app, pool) {
    console.log('✅ Planner API routes registered');

    // ==================== SECTIONS ====================

    // GET /api/pieces/:pieceId/sections
    app.get('/api/pieces/:pieceId/sections', async (req, res) => {
        try {
            const { pieceId } = req.params;
            const result = await pool.query(`
                SELECT * FROM piece_sections 
                WHERE piece_id = $1 
                ORDER BY measure_start ASC
            `, [pieceId]);
            res.json(result.rows);
        } catch (err) {
            console.error('Error fetching sections:', err);
            res.status(500).json({ error: err.message });
        }
    });

    // POST /api/pieces/:pieceId/sections
    app.post('/api/pieces/:pieceId/sections', async (req, res) => {
        try {
            const { pieceId } = req.params;
            const { name, measure_start, measure_end } = req.body;
            const result = await pool.query(`
                INSERT INTO piece_sections (piece_id, name, measure_start, measure_end)
                VALUES ($1, $2, $3, $4)
                RETURNING *
            `, [pieceId, name, measure_start, measure_end]);
            res.status(201).json(result.rows[0]);
        } catch (err) {
            console.error('Error creating section:', err);
            res.status(500).json({ error: err.message });
        }
    });

    // PATCH /api/piece-sections/:id
    app.patch('/api/piece-sections/:id', async (req, res) => {
        try {
            const { id } = req.params;
            const { name, measure_start, measure_end } = req.body;
            const result = await pool.query(`
                UPDATE piece_sections 
                SET name = COALESCE($1, name), 
                    measure_start = COALESCE($2, measure_start), 
                    measure_end = COALESCE($3, measure_end),
                    updated_at = CURRENT_TIMESTAMP
                WHERE id = $4
                RETURNING *
            `, [name, measure_start, measure_end, id]);
            res.json(result.rows[0]);
        } catch (err) {
            console.error('Error updating section:', err);
            res.status(500).json({ error: err.message });
        }
    });

    // DELETE /api/piece-sections/:id
    app.delete('/api/piece-sections/:id', async (req, res) => {
        try {
            const { id } = req.params;
            await pool.query('DELETE FROM piece_sections WHERE id = $1', [id]);
            res.json({ success: true });
        } catch (err) {
            console.error('Error deleting section:', err);
            res.status(500).json({ error: err.message });
        }
    });

    // ==================== ANNOTATIONS ====================

    // GET /api/pieces/:pieceId/annotations
    app.get('/api/pieces/:pieceId/annotations', async (req, res) => {
        try {
            const { pieceId } = req.params;
            const result = await pool.query(`
                SELECT a.*, u.first_name, u.last_name 
                FROM score_annotations a
                LEFT JOIN users u ON a.created_by = u.id
                WHERE piece_id = $1
            `, [pieceId]);
            res.json(result.rows);
        } catch (err) {
            console.error('Error fetching annotations:', err);
            res.status(500).json({ error: err.message });
        }
    });

    // POST /api/pieces/:pieceId/annotations
    app.post('/api/pieces/:pieceId/annotations', async (req, res) => {
        try {
            const { pieceId } = req.params;
            const { page_number, x, y, category, note_text, section_id, measure_start, measure_end, created_by } = req.body;
            const result = await pool.query(`
                INSERT INTO score_annotations (piece_id, page_number, x, y, category, note_text, section_id, measure_start, measure_end, created_by)
                VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
                RETURNING *
            `, [pieceId, page_number, x, y, category, note_text, section_id, measure_start, measure_end, created_by]);
            res.status(201).json(result.rows[0]);
        } catch (err) {
            console.error('Error creating annotation:', err);
            res.status(500).json({ error: err.message });
        }
    });

    // PATCH /api/annotations/:id
    app.patch('/api/annotations/:id', async (req, res) => {
        try {
            const { id } = req.params;
            const { x, y, category, note_text } = req.body;
            const result = await pool.query(`
                UPDATE score_annotations 
                SET x = COALESCE($1, x),
                    y = COALESCE($2, y),
                    category = COALESCE($3, category),
                    note_text = COALESCE($4, note_text),
                    updated_at = CURRENT_TIMESTAMP
                WHERE id = $5
                RETURNING *
            `, [x, y, category, note_text, id]);
            res.json(result.rows[0]);
        } catch (err) {
            console.error('Error updating annotation:', err);
            res.status(500).json({ error: err.message });
        }
    });

    // DELETE /api/annotations/:id
    app.delete('/api/annotations/:id', async (req, res) => {
        try {
            const { id } = req.params;
            await pool.query('DELETE FROM score_annotations WHERE id = $1', [id]);
            res.json({ success: true });
        } catch (err) {
            console.error('Error deleting annotation:', err);
            res.status(500).json({ error: err.message });
        }
    });

    // ==================== REHEARSAL PLANS ====================

    // GET /api/pieces/:pieceId/rehearsal-plans
    app.get('/api/pieces/:pieceId/rehearsal-plans', async (req, res) => {
        try {
            const { pieceId } = req.params;
            const { ensembleId } = req.query;

            let query = `SELECT * FROM rehearsal_plans WHERE piece_id = $1`;
            const params = [pieceId];

            if (ensembleId) {
                query += ` AND (ensemble_id = $2 OR ensemble_id IS NULL)`;
                params.push(ensembleId);
            }

            query += ` ORDER BY target_date DESC, created_at DESC`;

            const result = await pool.query(query, params);
            res.json(result.rows);
        } catch (err) {
            console.error('Error fetching plans:', err);
            res.status(500).json({ error: err.message });
        }
    });

    // POST /api/pieces/:pieceId/rehearsal-plans
    app.post('/api/pieces/:pieceId/rehearsal-plans', async (req, res) => {
        try {
            const { pieceId } = req.params;
            const { title, target_date, ensemble_id, created_by } = req.body;
            const result = await pool.query(`
                INSERT INTO rehearsal_plans (piece_id, title, target_date, ensemble_id, created_by)
                VALUES ($1, $2, $3, $4, $5)
                RETURNING *
            `, [pieceId, title, target_date, ensemble_id, created_by]);
            res.status(201).json(result.rows[0]);
        } catch (err) {
            console.error('Error creating plan:', err);
            res.status(500).json({ error: err.message });
        }
    });

    // ==================== REHEARSAL TASKS ====================

    // GET /api/rehearsal-plans/:id/tasks
    app.get('/api/rehearsal-plans/:id/tasks', async (req, res) => {
        try {
            const { id } = req.params;
            const result = await pool.query(`
                SELECT t.*, s.name as section_name 
                FROM rehearsal_tasks t
                LEFT JOIN piece_sections s ON t.piece_section_id = s.id
                WHERE t.rehearsal_plan_id = $1
                ORDER BY t.created_at ASC
            `, [id]);
            res.json(result.rows);
        } catch (err) {
            console.error('Error fetching tasks:', err);
            res.status(500).json({ error: err.message });
        }
    });

    // POST /api/rehearsal-plans/:id/tasks
    app.post('/api/rehearsal-plans/:id/tasks', async (req, res) => {
        try {
            const { id } = req.params;
            const { description, piece_section_id, measure_start, measure_end, priority } = req.body;
            const result = await pool.query(`
                INSERT INTO rehearsal_tasks (rehearsal_plan_id, description, piece_section_id, measure_start, measure_end, priority)
                VALUES ($1, $2, $3, $4, $5, $6)
                RETURNING *
            `, [id, description, piece_section_id, measure_start, measure_end, priority]);
            res.status(201).json(result.rows[0]);
        } catch (err) {
            console.error('Error creating task:', err);
            res.status(500).json({ error: err.message });
        }
    });

    // PATCH /api/rehearsal-tasks/:id
    app.patch('/api/rehearsal-tasks/:id', async (req, res) => {
        try {
            const { id } = req.params;
            const { description, priority, status } = req.body;
            const result = await pool.query(`
                UPDATE rehearsal_tasks 
                SET description = COALESCE($1, description),
                    priority = COALESCE($2, priority),
                    status = COALESCE($3, status),
                    updated_at = CURRENT_TIMESTAMP
                WHERE id = $4
                RETURNING *
            `, [description, priority, status, id]);
            res.json(result.rows[0]);
        } catch (err) {
            console.error('Error updating task:', err);
            res.status(500).json({ error: err.message });
        }
    });

    // DELETE /api/rehearsal-tasks/:id
    app.delete('/api/rehearsal-tasks/:id', async (req, res) => {
        try {
            const { id } = req.params;
            await pool.query('DELETE FROM rehearsal_tasks WHERE id = $1', [id]);
            res.json({ success: true });
        } catch (err) {
            console.error('Error deleting task:', err);
            res.status(500).json({ error: err.message });
        }
    });

    // ==================== AI CHAT ====================

    // POST /api/ai/planner-chat
    app.post('/api/ai/planner-chat', async (req, res) => {
        try {
            const { piece, sections, annotations, ensemble, user_message } = req.body;

            // Placeholder response
            const response = `I see you're working on "${piece.title}". That's a great piece! Based on your sections (like ${sections[0]?.name || 'the beginning'}), I'd suggest focusing on intonation and balance. (This is a placeholder AI response).`;

            res.json({ response });
        } catch (err) {
            console.error('Error in AI chat:', err);
            res.status(500).json({ error: err.message });
        }
    });
};
