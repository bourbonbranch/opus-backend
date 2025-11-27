module.exports = function (app, pool) {
    // ==================== DASHBOARD ====================
    console.log('✅ Dashboard API routes registered');

    // GET /api/dashboard/today-summary
    app.get('/api/dashboard/today-summary', async (req, res) => {
        const { director_id } = req.query;
        if (!director_id) return res.status(400).json({ error: 'director_id is required' });

        try {
            // 1. Next Event (today)
            // Find the first event for today that hasn't ended yet, or just the first one today
            const todayStart = new Date();
            todayStart.setHours(0, 0, 0, 0);
            const todayEnd = new Date();
            todayEnd.setHours(23, 59, 59, 999);

            const nextEventResult = await pool.query(`
                SELECT ci.*
                FROM calendar_items ci
                WHERE ci.director_id = $1
                AND ci.date >= $2 AND ci.date <= $3
                ORDER BY ci.date ASC
                LIMIT 1
            `, [director_id, todayStart.toISOString(), todayEnd.toISOString()]);

            const nextEvent = nextEventResult.rows[0] || null;

            // 2. Attendance Summary
            // Calculate attendance for today across all ensembles
            // Note: Using roster_id as column name based on error feedback
            const attendanceResult = await pool.query(`
                SELECT 
                    COUNT(CASE WHEN a.status = 'present' THEN 1 END) as present_count,
                    COUNT(*) as total_count
                FROM attendance a
                JOIN roster r ON a.roster_id = r.id
                JOIN ensembles e ON r.ensemble_id = e.id
                WHERE e.director_id = $1
                AND a.timestamp >= $2 AND a.timestamp <= $3
            `, [director_id, todayStart.toISOString(), todayEnd.toISOString()]);

            const presentCount = parseInt(attendanceResult.rows[0].present_count || 0);
            const totalAttendance = parseInt(attendanceResult.rows[0].total_count || 0);

            const attendanceSummary = {
                taken: totalAttendance > 0,
                present: presentCount,
                total: totalAttendance
            };

            // 3. Assignments Summary (due in next 7 days)
            const nextWeek = new Date();
            nextWeek.setDate(nextWeek.getDate() + 7);

            const assignmentsResult = await pool.query(`
                SELECT COUNT(*) as count
                FROM assignments a
                JOIN ensembles ens ON a.ensemble_id = ens.id
                WHERE ens.director_id = $1
                AND a.due_at >= $2 AND a.due_at <= $3
            `, [director_id, new Date().toISOString(), nextWeek.toISOString()]);

            const assignmentsCount = parseInt(assignmentsResult.rows[0].count);

            // 4. Unread Messages (placeholder)
            const unreadMessagesCount = 0;

            res.json({
                next_event: nextEvent,
                attendance_summary: attendanceSummary,
                assignments_summary: { count: assignmentsCount },
                unread_messages_count: unreadMessagesCount
            });
        } catch (err) {
            console.error('Error fetching today summary:', err);
            res.status(500).json({ error: 'Failed to fetch today summary: ' + err.message });
        }
    });

    // GET /api/dashboard/ensembles-summary
    app.get('/api/dashboard/ensembles-summary', async (req, res) => {
        const { director_id } = req.query;
        if (!director_id) return res.status(400).json({ error: 'director_id is required' });

        console.log(`[Dashboard] Fetching ensembles for director_id: ${director_id}`);

        try {
            let result = await pool.query(`
                SELECT 
                    e.id, 
                    e.name, 
                    e.type, 
                    e.level,
                    (SELECT COUNT(*) FROM roster r WHERE r.ensemble_id = e.id AND r.status = 'active') as member_count,
                    (
                        SELECT date 
                        FROM calendar_items ci 
                        WHERE ci.ensemble_id = e.id AND ci.date >= NOW() 
                        ORDER BY ci.date ASC 
                        LIMIT 1
                    ) as next_event_date
                FROM ensembles e
                WHERE e.director_id = $1
                ORDER BY e.name ASC
            `, [director_id]);

            // AUTO-MIGRATION: If user has no ensembles, check for legacy ones (ID 1 or 64) and claim them
            if (result.rows.length === 0) {
                console.log(`[Dashboard] No ensembles found for ${director_id}. Checking for legacy data...`);

                const claimResult = await pool.query(`
                    UPDATE ensembles 
                    SET director_id = $1 
                    WHERE director_id IN (1, 64)
                    RETURNING id
                `, [director_id]);

                if (claimResult.rows.length > 0) {
                    console.log(`[Dashboard] Auto-claimed ${claimResult.rows.length} ensembles for director ${director_id}`);

                    // Also update related rooms
                    await pool.query(`
                        UPDATE rooms 
                        SET director_id = $1 
                        WHERE director_id IN (1, 64)
                    `, [director_id]);

                    // Re-run the fetch query to get the newly claimed data
                    result = await pool.query(`
                        SELECT 
                            e.id, 
                            e.name, 
                            e.type, 
                            e.level,
                            (SELECT COUNT(*) FROM roster r WHERE r.ensemble_id = e.id AND r.status = 'active') as member_count,
                            (
                                SELECT start_time 
                                FROM events ev 
                                WHERE ev.ensemble_id = e.id AND ev.start_time >= NOW() 
                                ORDER BY ev.start_time ASC 
                                LIMIT 1
                            ) as next_event_date
                        FROM ensembles e
                        WHERE e.director_id = $1
                        ORDER BY e.name ASC
                    `, [director_id]);
                }
            }

            console.log(`[Dashboard] Found ${result.rows.length} ensembles`);
            res.json(result.rows);
        } catch (err) {
            console.error('Error fetching ensembles summary:', err);
            res.status(500).json({ error: 'Failed to fetch ensembles summary: ' + err.message });
        }
    });

    // GET /api/dashboard/upcoming-events
    app.get('/api/dashboard/upcoming-events', async (req, res) => {
        const { director_id, days = 7 } = req.query;
        if (!director_id) return res.status(400).json({ error: 'director_id is required' });

        try {
            const endDate = new Date();
            endDate.setDate(endDate.getDate() + parseInt(days));

            const result = await pool.query(`
                SELECT 
                    ci.id, 
                    ci.title as name, 
                    ci.type, 
                    ci.date as start_time, 
                    ci.description,
                    ens.name as ensemble_name,
                    ens.color_hex as ensemble_color
                FROM calendar_items ci
                LEFT JOIN ensembles ens ON ci.ensemble_id = ens.id
                WHERE ci.director_id = $1
                AND ci.date >= NOW() AND ci.date <= $2
                ORDER BY ci.date ASC
            `, [director_id, endDate.toISOString()]);

            res.json(result.rows);
        } catch (err) {
            console.error('Error fetching upcoming events:', err);
            res.status(500).json({ error: 'Failed to fetch upcoming events' });
        }
    });

    // GET /api/dashboard/assignments-summary
    app.get('/api/dashboard/assignments-summary', async (req, res) => {
        const { director_id } = req.query;
        if (!director_id) return res.status(400).json({ error: 'director_id is required' });

        try {
            // Get assignments due soon (next 7 days)
            const nextWeek = new Date();
            nextWeek.setDate(nextWeek.getDate() + 7);

            const result = await pool.query(`
                SELECT 
                    a.id, 
                    a.title, 
                    a.due_at, 
                    a.status,
                    ens.name as ensemble_name,
                    (SELECT COUNT(*) FROM assignment_submissions s WHERE s.assignment_id = a.id AND s.status = 'submitted') as submitted_count,
                    (SELECT COUNT(*) FROM assignment_submissions s WHERE s.assignment_id = a.id) as total_count
                FROM assignments a
                JOIN ensembles ens ON a.ensemble_id = ens.id
                WHERE ens.director_id = $1
                AND a.due_at >= NOW() AND a.due_at <= $2
                ORDER BY a.due_at ASC
                LIMIT 5
            `, [director_id, nextWeek.toISOString()]);

            res.json(result.rows);
        } catch (err) {
            console.error('Error fetching assignments summary:', err);
            res.status(500).json({ error: 'Failed to fetch assignments summary' });
        }
    });
};
