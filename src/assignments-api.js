module.exports = function (app, pool) {
    // ==================== ASSIGNMENTS ====================

    // Create new assignment
    app.post('/api/assignments', async (req, res) => {
        const {
            ensemble_id,
            title,
            description,
            type,
            due_at,
            status,
            piece_id,
            measures_text,
            submission_required,
            grading_type,
            max_score,
            visible_at,
            created_by,
            targets,
            attachments,
            event_id,
            visibility
        } = req.body;

        const client = await pool.connect();
        try {
            await client.query('BEGIN');

            // Insert assignment
            const assignmentResult = await client.query(
                `INSERT INTO assignments
    (ensemble_id, title, description, type, due_at, status, piece_id, measures_text,
        submission_required, grading_type, max_score, visible_at, created_by, event_id, visibility)
VALUES($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)
RETURNING * `,
                [ensemble_id, title, description, type, due_at, status || 'draft', piece_id, measures_text,
                    submission_required !== false, grading_type || 'completion', max_score, visible_at, created_by, event_id, visibility || 'ensemble']
            );

            const assignmentId = assignmentResult.rows[0].id;

            // Insert targets
            if (targets && targets.length > 0) {
                for (const target of targets) {
                    await client.query(
                        `INSERT INTO assignment_targets(assignment_id, target_type, target_value, student_id)
VALUES($1, $2, $3, $4)`,
                        [assignmentId, target.target_type, target.target_value, target.student_id]
                    );
                }
            }

            // Insert attachments
            if (attachments && attachments.length > 0) {
                for (const attachment of attachments) {
                    await client.query(
                        `INSERT INTO assignment_attachments(assignment_id, file_name, file_url, file_type)
VALUES($1, $2, $3, $4)`,
                        [assignmentId, attachment.file_name, attachment.file_url, attachment.file_type]
                    );
                }
            }

            // Create submission records for targeted students
            if (targets && targets.length > 0) {
                for (const target of targets) {
                    if (target.student_id) {
                        // Individual student
                        await client.query(
                            `INSERT INTO assignment_submissions(assignment_id, student_id, status)
VALUES($1, $2, 'not_started')
                 ON CONFLICT(assignment_id, student_id) DO NOTHING`,
                            [assignmentId, target.student_id]
                        );
                    } else if (target.target_type === 'all') {
                        // All students in ensemble
                        const studentsResult = await client.query(
                            'SELECT id FROM roster WHERE ensemble_id = $1 AND status = $2',
                            [ensemble_id, 'active']
                        );
                        for (const student of studentsResult.rows) {
                            await client.query(
                                `INSERT INTO assignment_submissions(assignment_id, student_id, status)
VALUES($1, $2, 'not_started')
                   ON CONFLICT(assignment_id, student_id) DO NOTHING`,
                                [assignmentId, student.id]
                            );
                        }
                    } else if (target.target_type === 'section' || target.target_type === 'part') {
                        // Students in specific section/part
                        const studentsResult = await client.query(
                            `SELECT id FROM roster WHERE ensemble_id = $1 AND ${target.target_type} = $2 AND status = $3`,
                            [ensemble_id, target.target_value, 'active']
                        );
                        for (const student of studentsResult.rows) {
                            await client.query(
                                `INSERT INTO assignment_submissions(assignment_id, student_id, status)
VALUES($1, $2, 'not_started')
                   ON CONFLICT(assignment_id, student_id) DO NOTHING`,
                                [assignmentId, student.id]
                            );
                        }
                    }
                }
            }

            await client.query('COMMIT');
            res.json({ success: true, assignment: assignmentResult.rows[0] });
        } catch (err) {
            await client.query('ROLLBACK');
            console.error('Error creating assignment:', err);
            console.error('Request body:', req.body); // Added for debugging
            res.status(500).json({ error: 'Failed to create assignment', details: err.message });
        } finally {
            client.release();
        }
    });

    // Get assignments with filters
    app.get('/api/assignments', async (req, res) => {
        const { ensemble_id, status, type } = req.query;

        try {
            let query = `
          SELECT a.*, u.first_name, u.last_name, e.name as event_name,
    (SELECT COUNT(*) FROM assignment_submissions WHERE assignment_id = a.id) as total_submissions,
        (SELECT COUNT(*) FROM assignment_submissions WHERE assignment_id = a.id AND status = 'submitted') as completed_submissions
          FROM assignments a
          LEFT JOIN users u ON a.created_by = u.id
          LEFT JOIN events e ON a.event_id = e.id
          WHERE a.ensemble_id = $1
    `;
            const params = [ensemble_id];
            let paramCount = 1;

            if (status) {
                paramCount++;
                query += ` AND a.status = $${paramCount} `;
                params.push(status);
            }

            if (type) {
                paramCount++;
                query += ` AND a.type = $${paramCount} `;
                params.push(type);
            }

            query += ' ORDER BY a.due_at DESC';

            const result = await pool.query(query, params);
            res.json(result.rows);
        } catch (err) {
            console.error('Error fetching assignments:', err);
            res.status(500).json({ error: 'Failed to fetch assignments' });
        }
    });

    // Get specific assignment with details
    app.get('/api/assignments/:id', async (req, res) => {
        const { id } = req.params;

        try {
            // Get assignment
            const assignmentResult = await pool.query(
                `SELECT a.*, e.name as event_name, e.start_time as event_date 
                 FROM assignments a
                 LEFT JOIN events e ON a.event_id = e.id
                 WHERE a.id = $1`,
                [id]
            );

            if (assignmentResult.rows.length === 0) {
                return res.status(404).json({ error: 'Assignment not found' });
            }

            const assignment = assignmentResult.rows[0];

            // Get targets
            const targetsResult = await pool.query(
                'SELECT * FROM assignment_targets WHERE assignment_id = $1',
                [id]
            );

            // Get attachments
            const attachmentsResult = await pool.query(
                'SELECT * FROM assignment_attachments WHERE assignment_id = $1',
                [id]
            );

            // Get submissions with student info
            const submissionsResult = await pool.query(
                `SELECT s.*, r.first_name, r.last_name, r.section, r.part
           FROM assignment_submissions s
           JOIN roster r ON s.student_id = r.id
           WHERE s.assignment_id = $1
           ORDER BY r.last_name, r.first_name`,
                [id]
            );

            res.json({
                ...assignment,
                targets: targetsResult.rows,
                attachments: attachmentsResult.rows,
                submissions: submissionsResult.rows
            });
        } catch (err) {
            console.error('Error fetching assignment:', err);
            res.status(500).json({ error: 'Failed to fetch assignment' });
        }
    });

    // Update assignment
    app.put('/api/assignments/:id', async (req, res) => {
        const { id } = req.params;
        const {
            title,
            description,
            type,
            due_at,
            status,
            piece_id,
            measures_text,
            submission_required,
            grading_type,
            max_score,
            visible_at,
            event_id,
            visibility
        } = req.body;

        try {
            const result = await pool.query(
                `UPDATE assignments 
           SET title = $1, description = $2, type = $3, due_at = $4, status = $5,
    piece_id = $6, measures_text = $7, submission_required = $8,
    grading_type = $9, max_score = $10, visible_at = $11,
    event_id = $12, visibility = $13,
    updated_at = CURRENT_TIMESTAMP
           WHERE id = $14
RETURNING * `,
                [title, description, type, due_at, status, piece_id, measures_text,
                    submission_required, grading_type, max_score, visible_at, event_id, visibility, id]
            );

            if (result.rows.length === 0) {
                return res.status(404).json({ error: 'Assignment not found' });
            }

            res.json({ success: true, assignment: result.rows[0] });
        } catch (err) {
            console.error('Error updating assignment:', err);
            res.status(500).json({ error: 'Failed to update assignment' });
        }
    });

    // Delete assignment
    app.delete('/api/assignments/:id', async (req, res) => {
        const { id } = req.params;

        try {
            await pool.query('DELETE FROM assignments WHERE id = $1', [id]);
            res.json({ success: true });
        } catch (err) {
            console.error('Error deleting assignment:', err);
            res.status(500).json({ error: 'Failed to delete assignment' });
        }
    });

    // Update submission (for grading)
    app.put('/api/assignment-submissions/:id', async (req, res) => {
        const { id } = req.params;
        const { status, score, feedback } = req.body;

        try {
            const result = await pool.query(
                `UPDATE assignment_submissions
           SET status = COALESCE($1, status),
    score = COALESCE($2, score),
    feedback = COALESCE($3, feedback),
    updated_at = CURRENT_TIMESTAMP
           WHERE id = $4
RETURNING * `,
                [status, score, feedback, id]
            );

            if (result.rows.length === 0) {
                return res.status(404).json({ error: 'Submission not found' });
            }

            res.json({ success: true, submission: result.rows[0] });
        } catch (err) {
            console.error('Error updating submission:', err);
            res.status(500).json({ error: 'Failed to update submission' });
        }
    });
    // ==================== STUDENT ENDPOINTS ====================

    // Get assignments for logged-in student
    app.get('/api/students/assignments', async (req, res) => {
        // Assuming auth middleware populates req.user or we use a query param for now if auth isn't fully set up in this file context
        // But typically: const studentId = req.user.id;
        // For now, let's assume the caller passes student_id in query or header if not using standard auth middleware here
        // Wait, the prompt says "Auth: student". I should check how other student endpoints work.
        // Usually it's req.user.id from the token.

        // Let's assume req.user is populated by auth middleware.
        // If not, I might need to check how /api/students/me works.

        // Get student ID from custom header (sent by student app)
        const studentId = req.headers['x-user-id'];
        if (!studentId) {
            return res.status(401).json({ error: 'Unauthorized' });
        }

        try {
            // Get assignments targeted to this student
            // 1. Direct targets
            // 2. All students in their ensemble
            // 3. Section/Part targets

            // Actually, assignment_submissions are created for all targets upon assignment creation!
            // So we just need to query assignment_submissions for this student_id.

            const result = await pool.query(`
                SELECT 
                    a.id, a.title, a.description, a.type, a.due_at, a.status as assignment_status,
                    a.piece_id, a.event_id, a.measures_text, a.ensemble_id,
                    COALESCE(s.status, 'not_started') as submission_status, 
                    s.score, s.feedback, s.submitted_at,
                    p.title as piece_title,
                    e.name as event_name, e.start_time as event_date
                FROM assignments a
                LEFT JOIN assignment_submissions s ON s.assignment_id = a.id AND s.student_id = $1
                LEFT JOIN ensemble_files p ON a.piece_id = p.id
                LEFT JOIN events e ON a.event_id = e.id
                JOIN roster r ON r.ensemble_id = a.ensemble_id AND r.id = $1
                WHERE a.status = 'active' -- Show active assignments
                AND (a.visibility = 'ensemble' OR a.visibility = 'public')
                ORDER BY a.due_at ASC
            `, [studentId]);

            res.json(result.rows);
        } catch (err) {
            console.error('Error fetching student assignments:', err);
            res.status(500).json({ error: 'Failed to fetch assignments' });
        }
    });

    // Update assignment status (student)
    app.patch('/api/students/assignments/:id', async (req, res) => {
        // Get student ID from custom header (sent by student app)
        const studentId = req.headers['x-user-id'];
        if (!studentId) {
            return res.status(401).json({ error: 'Unauthorized' });
        }

        const { id } = req.params;
        const { status, note } = req.body; // 'in_progress', 'completed'

        try {
            const result = await pool.query(`
                UPDATE assignment_submissions
                SET status = $1, 
                    text_response = COALESCE($2, text_response),
                    updated_at = CURRENT_TIMESTAMP,
                    submitted_at = CASE WHEN $1 = 'completed' THEN CURRENT_TIMESTAMP ELSE submitted_at END
                WHERE assignment_id = $3 AND student_id = $4
                RETURNING *
            `, [status, note, id, studentId]);

            if (result.rows.length === 0) {
                return res.status(404).json({ error: 'Assignment not found or not assigned to you' });
            }

            res.json(result.rows[0]);
        } catch (err) {
            console.error('Error updating assignment status:', err);
            res.status(500).json({ error: 'Failed to update assignment' });
        }
    });
};

