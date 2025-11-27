const express = require('express');
const cors = require('cors');
require('dotenv').config();

const bcrypt = require('bcryptjs');
const { pool } = require('./db');

const app = express();

// ✅ BODY PARSER MUST COME FIRST (before CORS and routes)
app.use(express.json());

// CORS - Allow Vercel deployments and localhost
const allowedOrigins = [
  'http://localhost:5173',
  'http://localhost:3000',
  /^https:\/\/.*\.vercel\.app$/,  // All Vercel deployments
];

app.use(cors({
  origin: function (origin, callback) {
    // Allow requests with no origin (like mobile apps or curl requests)
    if (!origin) return callback(null, true);

    // Check if origin matches any allowed pattern
    const isAllowed = allowedOrigins.some(allowed => {
      if (allowed instanceof RegExp) {
        return allowed.test(origin);
      }
      return allowed === origin;
    });

    if (isAllowed) {
      callback(null, true);
    } else {
      callback(new Error('Not allowed by CORS'));
    }
  },
  credentials: true
}));

// Root
app.get('/', (req, res) => {
  res.json({ ok: true, name: 'Opus API' });
});

// Health check
app.get('/health', (req, res) => {
  res.json({ ok: true, timestamp: new Date().toISOString() });
});

// Director signup (camelCase response)
app.post('/auth/signup-director', async (req, res) => {
  try {
    const { firstName, lastName, email, password, role } = req.body;
    if (!firstName || !lastName || !email || !password) {
      return res.status(400).json({ error: 'Missing required fields' });
    }
    const finalRole = role || 'director';

    const existing = await pool.query('SELECT id FROM users WHERE email = $1', [email]);
    if (existing.rows.length > 0) {
      return res.status(409).json({ error: 'Email already in use' });
    }

    const passwordHash = await bcrypt.hash(password, 10);
    const result = await pool.query(
      `INSERT INTO users (first_name, last_name, email, password_hash, role)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id, first_name, last_name, email, role, created_at`,
      [firstName, lastName, email, passwordHash, finalRole]
    );
    const user = result.rows[0];
    res.status(201).json({
      id: user.id,
      firstName: user.first_name,
      lastName: user.last_name,
      email: user.email,
      role: user.role,
      createdAt: user.created_at,
    });
  } catch (err) {
    console.error('Error in /auth/signup-director:', err);
    if (err.code === '23505') {
      return res.status(409).json({ error: 'Email already in use' });
    }
    res.status(500).json({ error: err.message || 'Internal server error' });
  }
});

// Migrate legacy data (ensembles from ID 1 or 64 to current user)
app.post('/api/migrate-legacy-data', async (req, res) => {
  const { director_id } = req.body;
  if (!director_id) return res.status(400).json({ error: 'director_id is required' });

  try {
    // Update ensembles
    const result = await pool.query(`
      UPDATE ensembles 
      SET director_id = $1 
      WHERE director_id IN (1, 64) 
      AND id NOT IN (SELECT id FROM ensembles WHERE director_id = $1)
      RETURNING id, name
    `, [director_id]);

    // Also update rooms, etc? For now just ensembles is the critical part.
    // The cascade might handle others or they might be independent.
    // Rooms have director_id too.
    await pool.query(`
      UPDATE rooms 
      SET director_id = $1 
      WHERE director_id IN (1, 64)
    `, [director_id]);

    res.json({
      message: 'Migration successful',
      migrated_ensembles: result.rows.length,
      details: result.rows
    });
  } catch (err) {
    console.error('Error migrating legacy data:', err);
    res.status(500).json({ error: 'Failed to migrate data' });
  }
});

// Director login
app.post('/auth/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) {
      return res.status(400).json({ error: 'Missing email or password' });
    }

    const result = await pool.query('SELECT * FROM users WHERE email = $1', [email]);
    if (result.rows.length === 0) {
      return res.status(401).json({ error: 'Invalid email or password' });
    }

    const user = result.rows[0];
    const valid = await bcrypt.compare(password, user.password_hash);
    if (!valid) {
      return res.status(401).json({ error: 'Invalid email or password' });
    }

    res.json({
      id: user.id,
      firstName: user.first_name,
      lastName: user.last_name,
      email: user.email,
      role: user.role,
    });
  } catch (err) {
    console.error('Error in /auth/login:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Legacy endpoint kept for compatibility
app.post('/directors/signup', async (req, res) => {
  try {
    const { firstName, lastName, email, password, role } = req.body;
    if (!firstName || !lastName || !email || !password) {
      return res.status(400).json({ error: 'Missing required fields' });
    }
    const existing = await pool.query('SELECT id FROM users WHERE email = $1', [email]);
    if (existing.rows.length > 0) {
      return res.status(409).json({ error: 'Email already in use' });
    }

    const hashed = await bcrypt.hash(password, 10);
    const result = await pool.query(
      `INSERT INTO users (first_name, last_name, email, password_hash, role)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id, first_name, last_name, email, role, created_at`,
      [firstName, lastName, email, hashed, role || 'director']
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error('Error in /directors/signup:', err);
    if (err.code === '23505') {
      return res.status(409).json({ error: 'Email already in use' });
    }
    return res.status(500).json({ error: err.message || 'Failed to create director' });
  }
});

// Get all ensembles for a director
// Get all ensembles for a director
app.get('/ensembles', async (req, res) => {
  try {
    const directorId = req.query.director_id;
    if (!directorId) {
      return res.status(400).json({ error: 'director_id is required' });
    }

    let result = await pool.query(
      'SELECT * FROM ensembles WHERE director_id = $1 ORDER BY created_at DESC',
      [directorId]
    );

    // AUTO-MIGRATION: If user has no ensembles, check for legacy ones (ID 1 or 64) and claim them
    if (result.rows.length === 0) {
      console.log(`[Ensembles] No ensembles found for ${directorId}. Checking for legacy data...`);

      const claimResult = await pool.query(`
          UPDATE ensembles 
          SET director_id = $1 
          WHERE director_id IN (1, 64)
          RETURNING id
      `, [directorId]);

      if (claimResult.rows.length > 0) {
        console.log(`[Ensembles] Auto-claimed ${claimResult.rows.length} ensembles for director ${directorId}`);

        // Also update related rooms
        await pool.query(`
              UPDATE rooms 
              SET director_id = $1 
              WHERE director_id IN (1, 64)
          `, [directorId]);

        // Re-run the fetch query
        result = await pool.query(
          'SELECT * FROM ensembles WHERE director_id = $1 ORDER BY created_at DESC',
          [directorId]
        );
      }
    }

    res.json(result.rows);
  } catch (err) {
    console.error('Error fetching ensembles:', err);
    res.status(500).json({ error: 'Failed to fetch ensembles' });
  }
});

// Create a new ensemble
app.post('/ensembles', async (req, res) => {
  try {
    const { name, type, organization_name, level, size, director_id } = req.body;

    if (!name || !type || !director_id) {
      return res.status(400).json({ error: 'Missing required fields: name, type, director_id' });
    }

    const result = await pool.query(
      `INSERT INTO ensembles (name, type, organization_name, level, size, director_id)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING *`,
      [name, type, organization_name || null, level || null, size || null, director_id]
    );

    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error('Error creating ensemble:', err);
    res.status(500).json({ error: 'Failed to create ensemble' });
  }
});

// --- ENHANCED ENSEMBLE ROUTES ---

// Get single ensemble
app.get('/api/ensembles/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const result = await pool.query('SELECT * FROM ensembles WHERE id = $1', [id]);

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Ensemble not found' });
    }

    res.json(result.rows[0]);
  } catch (err) {
    console.error('Error fetching ensemble:', err);
    res.status(500).json({ error: 'Failed to fetch ensemble' });
  }
});

// Update ensemble
app.patch('/api/ensembles/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { name, description, short_code, type, color_hex, organization_name, level, size } = req.body;

    const result = await pool.query(`
      UPDATE ensembles 
      SET name = COALESCE($1, name),
          description = COALESCE($2, description),
          short_code = COALESCE($3, short_code),
          type = COALESCE($4, type),
          color_hex = COALESCE($5, color_hex),
          organization_name = COALESCE($6, organization_name),
          level = COALESCE($7, level),
          size = COALESCE($8, size),
          updated_at = CURRENT_TIMESTAMP
      WHERE id = $9
      RETURNING *
    `, [name, description, short_code, type, color_hex, organization_name, level, size, id]);

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Ensemble not found' });
    }

    res.json(result.rows[0]);
  } catch (err) {
    console.error('Error updating ensemble:', err);
    res.status(500).json({ error: 'Failed to update ensemble' });
  }
});

// Delete ensemble
app.delete('/api/ensembles/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const result = await pool.query('DELETE FROM ensembles WHERE id = $1 RETURNING id', [id]);

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Ensemble not found' });
    }

    res.json({ message: 'Ensemble deleted successfully' });
  } catch (err) {
    console.error('Error deleting ensemble:', err);
    res.status(500).json({ error: 'Failed to delete ensemble' });
  }
});

// Get ensemble overview (stats + recent activity)
app.get('/api/ensembles/:id/overview', async (req, res) => {
  try {
    const { id } = req.params;

    // Get ensemble details
    const ensembleResult = await pool.query('SELECT * FROM ensembles WHERE id = $1', [id]);
    if (ensembleResult.rows.length === 0) {
      return res.status(404).json({ error: 'Ensemble not found' });
    }
    const ensemble = ensembleResult.rows[0];

    // Get member count
    const memberCount = await pool.query(
      'SELECT COUNT(*) as count FROM roster WHERE ensemble_id = $1 AND status = $2',
      [id, 'active']
    );

    // Get upcoming events (next 3)
    const upcomingEvents = await pool.query(`
      SELECT id, title as name, type, date, description
      FROM calendar_items
      WHERE ensemble_id = $1 AND date >= CURRENT_DATE
      ORDER BY date ASC
      LIMIT 3
    `, [id]);

    // Get recent messages (if messages table exists)
    let recentMessages = [];
    try {
      const messagesResult = await pool.query(`
        SELECT id, subject, sent_at, audience
        FROM messages
        WHERE target_type = 'ensemble' AND target_id = $1
        ORDER BY sent_at DESC
        LIMIT 3
      `, [id]);
      recentMessages = messagesResult.rows;
    } catch (err) {
      // Messages table might not exist yet
      console.log('Messages table not available');
    }

    // Get upcoming assignments
    const upcomingAssignments = await pool.query(`
      SELECT id, title, type, due_at, status
      FROM ensemble_assignments
      WHERE ensemble_id = $1 AND status = 'active' AND due_at >= CURRENT_DATE
      ORDER BY due_at ASC
      LIMIT 3
    `, [id]);

    res.json({
      ensemble,
      stats: {
        member_count: parseInt(memberCount.rows[0].count),
        upcoming_event: upcomingEvents.rows[0] || null
      },
      upcoming_events: upcomingEvents.rows,
      recent_messages: recentMessages,
      upcoming_assignments: upcomingAssignments.rows
    });
  } catch (err) {
    console.error('Error fetching ensemble overview:', err);
    res.status(500).json({ error: 'Failed to fetch ensemble overview' });
  }
});

// Get ensemble members (roster)
app.get('/api/ensembles/:id/members', async (req, res) => {
  try {
    const { id } = req.params;
    const { section, part } = req.query;

    let query = 'SELECT * FROM roster WHERE ensemble_id = $1';
    const params = [id];

    if (section) {
      query += ' AND section = $2';
      params.push(section);
    }
    if (part) {
      const paramIndex = params.length + 1;
      query += ` AND part = $${paramIndex}`;
      params.push(part);
    }

    query += ' ORDER BY section, part, last_name, first_name';

    const result = await pool.query(query, params);
    res.json(result.rows);
  } catch (err) {
    console.error('Error fetching ensemble members:', err);
    res.status(500).json({ error: 'Failed to fetch members' });
  }
});

// Add member to ensemble
app.post('/api/ensembles/:id/members', async (req, res) => {
  try {
    const { id } = req.params;
    const { first_name, last_name, email, phone, section, part, pronouns } = req.body;

    if (!first_name || !last_name) {
      return res.status(400).json({ error: 'first_name and last_name are required' });
    }

    const result = await pool.query(`
      INSERT INTO roster (ensemble_id, first_name, last_name, email, phone, section, part, pronouns, status)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'active')
      RETURNING *
    `, [id, first_name, last_name, email, phone, section, part, pronouns]);

    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error('Error adding member:', err);
    res.status(500).json({ error: 'Failed to add member' });
  }
});

// Update ensemble member
app.patch('/api/ensembles/:id/members/:memberId', async (req, res) => {
  try {
    const { memberId } = req.params;
    const { section, part, status, pronouns, email, phone } = req.body;

    const result = await pool.query(`
      UPDATE roster
      SET section = COALESCE($1, section),
          part = COALESCE($2, part),
          status = COALESCE($3, status),
          pronouns = COALESCE($4, pronouns),
          email = COALESCE($5, email),
          phone = COALESCE($6, phone)
      WHERE id = $7
      RETURNING *
    `, [section, part, status, pronouns, email, phone, memberId]);

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Member not found' });
    }

    res.json(result.rows[0]);
  } catch (err) {
    console.error('Error updating member:', err);
    res.status(500).json({ error: 'Failed to update member' });
  }
});

// Remove member from ensemble
app.delete('/api/ensembles/:id/members/:memberId', async (req, res) => {
  try {
    const { memberId } = req.params;
    const result = await pool.query('DELETE FROM roster WHERE id = $1 RETURNING id', [memberId]);

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Member not found' });
    }

    res.json({ message: 'Member removed successfully' });
  } catch (err) {
    console.error('Error removing member:', err);
    res.status(500).json({ error: 'Failed to remove member' });
  }
});

// Get ensemble attendance for a specific date
app.get('/api/ensembles/:id/attendance', async (req, res) => {
  try {
    const { id } = req.params;
    const { date } = req.query;

    if (!date) {
      return res.status(400).json({ error: 'date parameter is required (YYYY-MM-DD)' });
    }

    // Get all members
    const members = await pool.query(
      'SELECT id, first_name, last_name, section, part FROM roster WHERE ensemble_id = $1 AND status = $2 ORDER BY section, part, last_name',
      [id, 'active']
    );

    // Get attendance records for this date
    const attendance = await pool.query(`
      SELECT roster_id, status
      FROM attendance
      WHERE roster_id = ANY($1) AND DATE(check_in_time) = $2
    `, [members.rows.map(m => m.id), date]);

    const attendanceMap = {};
    attendance.rows.forEach(a => {
      attendanceMap[a.roster_id] = a.status;
    });

    const records = members.rows.map(member => ({
      ...member,
      status: attendanceMap[member.id] || 'absent'
    }));

    res.json({ date, records });
  } catch (err) {
    console.error('Error fetching attendance:', err);
    res.status(500).json({ error: 'Failed to fetch attendance' });
  }
});

// Save ensemble attendance
app.post('/api/ensembles/:id/attendance', async (req, res) => {
  try {
    const { id } = req.params;
    const { date, records } = req.body;

    if (!date || !records || !Array.isArray(records)) {
      return res.status(400).json({ error: 'date and records array are required' });
    }

    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      // Delete existing attendance for this date
      await client.query(`
        DELETE FROM attendance
        WHERE roster_id IN (SELECT id FROM roster WHERE ensemble_id = $1)
        AND DATE(check_in_time) = $2
      `, [id, date]);

      // Insert new attendance records
      for (const record of records) {
        if (record.status && record.status !== 'absent') {
          await client.query(`
            INSERT INTO attendance (roster_id, status, check_in_time)
            VALUES ($1, $2, $3::date)
          `, [record.student_id, record.status, date]);
        }
      }

      await client.query('COMMIT');
      res.json({ message: 'Attendance saved successfully' });
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  } catch (err) {
    console.error('Error saving attendance:', err);
    res.status(500).json({ error: 'Failed to save attendance' });
  }
});

// Get ensemble assignments
app.get('/api/ensembles/:id/assignments', async (req, res) => {
  try {
    const { id } = req.params;
    const result = await pool.query(`
      SELECT * FROM ensemble_assignments
      WHERE ensemble_id = $1
      ORDER BY due_at DESC, created_at DESC
    `, [id]);

    res.json(result.rows);
  } catch (err) {
    console.error('Error fetching assignments:', err);
    res.status(500).json({ error: 'Failed to fetch assignments' });
  }
});

// Create ensemble assignment
app.post('/api/ensembles/:id/assignments', async (req, res) => {
  try {
    const { id } = req.params;
    const { title, description, type, due_at, created_by } = req.body;

    if (!title) {
      return res.status(400).json({ error: 'title is required' });
    }

    const result = await pool.query(`
      INSERT INTO ensemble_assignments (ensemble_id, title, description, type, due_at, created_by)
      VALUES ($1, $2, $3, $4, $5, $6)
      RETURNING *
    `, [id, title, description, type, due_at, created_by]);

    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error('Error creating assignment:', err);
    res.status(500).json({ error: 'Failed to create assignment' });
  }
});

// Get ensemble files
app.get('/api/ensembles/:id/files', async (req, res) => {
  try {
    const { id } = req.params;
    const result = await pool.query(`
      SELECT * FROM ensemble_files
      WHERE ensemble_id = $1
      ORDER BY created_at DESC
    `, [id]);

    res.json(result.rows);
  } catch (err) {
    console.error('Error fetching files:', err);
    res.status(500).json({ error: 'Failed to fetch files' });
  }
});

// Upload ensemble file (stub - actual file upload would need multer or similar)
app.post('/api/ensembles/:id/files', async (req, res) => {
  try {
    const { id } = req.params;
    const { title, file_type, storage_url, file_size, uploaded_by } = req.body;

    if (!title) {
      return res.status(400).json({ error: 'title is required' });
    }

    const result = await pool.query(`
      INSERT INTO ensemble_files (ensemble_id, title, file_type, storage_url, file_size, uploaded_by)
      VALUES ($1, $2, $3, $4, $5, $6)
      RETURNING *
    `, [id, title, file_type, storage_url, file_size, uploaded_by]);

    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error('Error uploading file:', err);
    res.status(500).json({ error: 'Failed to upload file: ' + err.message });
  }
});

// Get ensemble messages (filtered view)
app.get('/api/ensembles/:id/messages', async (req, res) => {
  try {
    const { id } = req.params;

    // Try to get messages, but handle if table doesn't exist
    try {
      const result = await pool.query(`
        SELECT * FROM messages
        WHERE target_type = 'ensemble' AND target_id = $1
        ORDER BY sent_at DESC
        LIMIT 50
      `, [id]);

      res.json(result.rows);
    } catch (err) {
      // Messages table might not exist yet
      res.json([]);
    }
  } catch (err) {
    console.error('Error fetching messages:', err);
    res.status(500).json({ error: 'Failed to fetch messages' });
  }
});

// Get ensemble events (filtered view)
app.get('/api/ensembles/:id/events', async (req, res) => {
  try {
    const { id } = req.params;
    const result = await pool.query(`
      SELECT * FROM calendar_items
      WHERE ensemble_id = $1
      ORDER BY date DESC
    `, [id]);

    res.json(result.rows);
  } catch (err) {
    console.error('Error fetching events:', err);
    res.status(500).json({ error: 'Failed to fetch events' });
  }
});

// --- ROSTER ROUTES ---

// Get roster for an ensemble
app.get('/roster', async (req, res) => {
  const { ensemble_id } = req.query;

  if (!ensemble_id) {
    return res.status(400).json({ error: 'ensemble_id is required' });
  }

  try {
    const result = await pool.query(
      `SELECT id, ensemble_id, first_name, last_name, email, phone, section, part, pronouns, status, external_id, created_at
       FROM roster
       WHERE ensemble_id = $1
       ORDER BY last_name, first_name`,
      [ensemble_id]
    );
    res.json(result.rows);
  } catch (err) {
    console.error('Error fetching roster:', err);
    res.status(500).json({ error: 'Failed to fetch roster' });
  }
});

// Update a roster member
app.put('/roster/:id', async (req, res) => {
  const { id } = req.params;
  const { first_name, last_name, email, phone, section, part, pronouns, status, external_id } = req.body;

  try {
    const result = await pool.query(
      `UPDATE roster
       SET first_name = COALESCE($1, first_name),
           last_name = COALESCE($2, last_name),
           email = COALESCE($3, email),
           phone = COALESCE($4, phone),
           section = COALESCE($5, section),
           part = COALESCE($6, part),
           pronouns = COALESCE($7, pronouns),
           status = COALESCE($8, status),
           external_id = COALESCE($9, external_id)
       WHERE id = $10
       RETURNING *`,
      [first_name, last_name, email, phone, section, part, pronouns, status, external_id, id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Roster member not found' });
    }

    res.json(result.rows[0]);
  } catch (err) {
    console.error('Error updating roster member:', err);
    res.status(500).json({ error: 'Failed to update roster member' });
  }
});

// Delete a roster member
app.delete('/roster/:id', async (req, res) => {
  const { id } = req.params;

  try {
    const result = await pool.query('DELETE FROM roster WHERE id = $1 RETURNING id', [id]);

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Roster member not found' });
    }

    res.json({ message: 'Roster member deleted successfully' });
  } catch (err) {
    console.error('Error deleting roster member:', err);
    res.status(500).json({ error: 'Failed to delete roster member' });
  }
});

// Delete an ensemble
app.delete('/ensembles/:id', async (req, res) => {
  const { id } = req.params;

  try {
    // Note: This relies on ON DELETE CASCADE constraints in the database schema.
    // If those are not set up, we would need to manually delete related records first.
    // Assuming standard foreign key constraints with cascading deletes for simplicity.
    const result = await pool.query('DELETE FROM ensembles WHERE id = $1 RETURNING id', [id]);

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Ensemble not found' });
    }

    res.json({ message: 'Ensemble deleted successfully' });
  } catch (err) {
    console.error('Error deleting ensemble:', err);
    res.status(500).json({ error: 'Failed to delete ensemble' });
  }
});

// Add a single roster member
app.post('/roster', async (req, res) => {
  const {
    ensemble_id,
    first_name,
    last_name,
    email,
    phone,
    section, // Added section
    part,
    pronouns,
    status = 'active',
    external_id = null,
  } = req.body || {};

  if (!ensemble_id || !first_name || !last_name) {
    return res.status(400).json({
      error: 'ensemble_id, first_name, and last_name are required',
    });
  }

  try {
    const result = await pool.query(
      `INSERT INTO roster
        (ensemble_id, first_name, last_name, email, phone, section, part, pronouns, status, external_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
       RETURNING id, ensemble_id, first_name, last_name, email, phone, section, part, pronouns, status, external_id, created_at`,
      [ensemble_id, first_name, last_name, email || null, phone || null, section || null, part || null, pronouns || null, status, external_id]
    );

    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error('Error inserting roster member:', err);
    res.status(500).json({ error: 'Failed to add roster member' });
  }
});

// Bulk add roster members
app.post('/roster/bulk', async (req, res) => {
  const { ensemble_id, students } = req.body;

  if (!ensemble_id || !students || !Array.isArray(students)) {
    return res.status(400).json({ error: 'ensemble_id and students array required' });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const results = [];
    for (const student of students) {
      const { first_name, last_name, email, phone, section, part, pronouns, external_id } = student;

      // Skip if missing required fields
      if (!first_name || !last_name) continue;

      const result = await client.query(
        `INSERT INTO roster
          (ensemble_id, first_name, last_name, email, phone, section, part, pronouns, status, external_id)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'active', $9)
         RETURNING *`,
        [ensemble_id, first_name, last_name, email || null, phone || null, section || null, part || null, pronouns || null, external_id || null]
      );
      results.push(result.rows[0]);
    }

    await client.query('COMMIT');
    res.status(201).json(results);
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Error bulk inserting roster:', err);
    res.status(500).json({ error: 'Failed to bulk import students: ' + err.message });
  } finally {
    client.release();
  }
});

// --- ROOMS & ATTENDANCE ---

// Get rooms for a director
app.get('/rooms', async (req, res) => {
  const { director_id } = req.query;
  if (!director_id) return res.status(400).json({ error: 'director_id required' });

  try {
    const result = await pool.query(
      'SELECT * FROM rooms WHERE director_id = $1 ORDER BY created_at DESC',
      [director_id]
    );
    res.json(result.rows);
  } catch (err) {
    console.error('Error fetching rooms:', err);
    res.status(500).json({ error: 'Failed to fetch rooms' });
  }
});

// Create a room
app.post('/rooms', async (req, res) => {
  const { name, director_id, beacon_uuid, beacon_major, beacon_minor } = req.body;
  if (!name || !director_id) return res.status(400).json({ error: 'name and director_id required' });

  try {
    const result = await pool.query(
      `INSERT INTO rooms (name, director_id, beacon_uuid, beacon_major, beacon_minor)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING *`,
      [name, director_id, beacon_uuid || null, beacon_major || null, beacon_minor || null]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error('Error creating room:', err);
    res.status(500).json({ error: 'Failed to create room' });
  }
});

// Update a room (for calibration)
app.put('/rooms/:id', async (req, res) => {
  const { id } = req.params;
  const { name, beacon_uuid, beacon_major, beacon_minor } = req.body;

  try {
    const result = await pool.query(
      `UPDATE rooms 
       SET name = COALESCE($1, name),
           beacon_uuid = COALESCE($2, beacon_uuid),
           beacon_major = COALESCE($3, beacon_major),
           beacon_minor = COALESCE($4, beacon_minor)
       WHERE id = $5
       RETURNING *`,
      [name, beacon_uuid, beacon_major, beacon_minor, id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Room not found' });
    }

    res.json(result.rows[0]);
  } catch (err) {
    console.error('Error updating room:', err);
    res.status(500).json({ error: 'Failed to update room' });
  }
});

// Get attendance for a room (defaults to today)
app.get('/attendance', async (req, res) => {
  const { room_id, date } = req.query;
  if (!room_id) return res.status(400).json({ error: 'room_id required' });

  try {
    // Default to today if no date provided
    const queryDate = date || new Date().toISOString().split('T')[0];

    const result = await pool.query(
      `SELECT a.*, r.first_name, r.last_name, r.section
       FROM attendance a
       JOIN roster r ON a.roster_id = r.id
       WHERE a.room_id = $1 
       AND a.created_at::date = $2::date
       ORDER BY a.created_at DESC`,
      [room_id, queryDate]
    );
    res.json(result.rows);
  } catch (err) {
    console.error('Error fetching attendance:', err);
    res.status(500).json({ error: 'Failed to fetch attendance' });
  }
});


// Log attendance
app.post('/attendance', async (req, res) => {
  const { roster_id, room_id, status } = req.body;
  if (!roster_id || !room_id) return res.status(400).json({ error: 'roster_id and room_id required' });

  try {
    const result = await pool.query(
      `INSERT INTO attendance (roster_id, room_id, status)
       VALUES ($1, $2, $3)
       RETURNING *`,
      [roster_id, room_id, status || 'present']
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error('Error logging attendance:', err);
    res.status(500).json({ error: 'Failed to log attendance' });
  }
});

// --- EVENTS ---

// Get events for an ensemble
app.get('/events', async (req, res) => {
  const { ensemble_id } = req.query;
  if (!ensemble_id) return res.status(400).json({ error: 'ensemble_id required' });

  try {
    const result = await pool.query(
      `SELECT id, title as name, type, date as start_time, date as end_time, description, ensemble_id, created_at
       FROM calendar_items
       WHERE ensemble_id = $1
       ORDER BY date ASC`,
      [ensemble_id]
    );
    res.json(result.rows);
  } catch (err) {
    console.error('Error fetching events:', err);
    res.status(500).json({ error: 'Failed to fetch events' });
  }
});

// Create a new event
app.post('/events', async (req, res) => {
  const { ensemble_id, room_id, name, type, start_time, end_time, description } = req.body;

  if (!ensemble_id || !name || !type || !start_time) {
    return res.status(400).json({ error: 'Missing required fields' });
  }

  // Get director_id from ensemble
  const directorResult = await pool.query('SELECT director_id FROM ensembles WHERE id = $1', [ensemble_id]);
  if (directorResult.rows.length === 0) {
    return res.status(404).json({ error: 'Ensemble not found' });
  }
  const director_id = directorResult.rows[0].director_id;

  try {
    const result = await pool.query(
      `INSERT INTO calendar_items (director_id, ensemble_id, title, type, date, description)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING *`,
      [director_id, ensemble_id, name, type, start_time, description || null]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error('Error creating event:', err);
    res.status(500).json({ error: 'Failed to create event: ' + err.message });
  }
});

// Update an event
app.put('/events/:id', async (req, res) => {
  const { id } = req.params;
  const { name, type, start_time, description } = req.body;

  try {
    const result = await pool.query(
      `UPDATE calendar_items
       SET title = $1, type = $2, date = $3, description = $4
       WHERE id = $5
       RETURNING *`,
      [name, type, start_time, description || null, id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Event not found' });
    }

    res.json(result.rows[0]);
  } catch (err) {
    console.error('Error updating event:', err);
    res.status(500).json({ error: 'Failed to update event' });
  }
});

// Delete an event
app.delete('/events/:id', async (req, res) => {
  const { id } = req.params;

  try {
    const result = await pool.query('DELETE FROM calendar_items WHERE id = $1 RETURNING id', [id]);

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Event not found' });
    }

    res.json({ message: 'Event deleted successfully' });
  } catch (err) {
    console.error('Error deleting event:', err);
    res.status(500).json({ error: 'Failed to delete event' });
  }
});


// --- CALENDAR ITEMS ---

// Get calendar items for a director or ensemble
app.get('/calendar-items', async (req, res) => {
  const { director_id, ensemble_id } = req.query;

  if (!director_id && !ensemble_id) {
    return res.status(400).json({ error: 'director_id or ensemble_id required' });
  }

  try {
    let query = 'SELECT * FROM calendar_items WHERE ';
    let params = [];

    if (ensemble_id) {
      query += 'ensemble_id = $1';
      params.push(ensemble_id);
    } else {
      query += 'director_id = $1';
      params.push(director_id);
    }

    query += ' ORDER BY date ASC';

    const result = await pool.query(query, params);
    res.json(result.rows);
  } catch (err) {
    console.error('Error fetching calendar items:', err);
    res.status(500).json({ error: 'Failed to fetch calendar items' });
  }
});

// Create a calendar item
app.post('/calendar-items', async (req, res) => {
  const { director_id, ensemble_id, title, type, date, description, color } = req.body;

  if (!title || !type || !date) {
    return res.status(400).json({ error: 'Missing required fields' });
  }

  try {
    const result = await pool.query(
      `INSERT INTO calendar_items (director_id, ensemble_id, title, type, date, description, color)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING *`,
      [director_id || null, ensemble_id || null, title, type, date, description || null, color || null]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error('Error creating calendar item:', err);
    res.status(500).json({ error: 'Failed to create calendar item' });
  }
});

// Delete a calendar item
app.delete('/calendar-items/:id', async (req, res) => {
  const { id } = req.params;

  try {
    const result = await pool.query('DELETE FROM calendar_items WHERE id = $1 RETURNING id', [id]);

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Calendar item not found' });
    }

    res.json({ message: 'Calendar item deleted successfully' });
  } catch (err) {
    console.error('Error deleting calendar item:', err);
    res.status(500).json({ error: 'Failed to delete calendar item' });
  }
});

// --- ENSEMBLE SECTIONS & PARTS ---

// Get sections for an ensemble
app.get('/ensemble-sections', async (req, res) => {
  const { ensemble_id } = req.query;
  if (!ensemble_id) return res.status(400).json({ error: 'ensemble_id required' });

  try {
    const result = await pool.query(
      `SELECT * FROM ensemble_sections 
       WHERE ensemble_id = $1 
       ORDER BY display_order, name`,
      [ensemble_id]
    );
    res.json(result.rows);
  } catch (err) {
    console.error('Error fetching sections:', err);
    res.status(500).json({ error: 'Failed to fetch sections' });
  }
});

// Create a section
app.post('/ensemble-sections', async (req, res) => {
  const { ensemble_id, name, display_order, color } = req.body;

  if (!ensemble_id || !name) {
    return res.status(400).json({ error: 'ensemble_id and name required' });
  }

  try {
    const result = await pool.query(
      `INSERT INTO ensemble_sections (ensemble_id, name, display_order, color)
       VALUES ($1, $2, $3, $4)
       RETURNING *`,
      [ensemble_id, name, display_order || 0, color || null]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error('Error creating section:', err);
    if (err.code === '23505') {
      return res.status(409).json({ error: 'Section name already exists for this ensemble' });
    }
    res.status(500).json({ error: 'Failed to create section' });
  }
});

// Update a section
app.put('/ensemble-sections/:id', async (req, res) => {
  const { id } = req.params;
  const { name, display_order, color } = req.body;

  try {
    const result = await pool.query(
      `UPDATE ensemble_sections
       SET name = COALESCE($1, name),
           display_order = COALESCE($2, display_order),
           color = COALESCE($3, color)
       WHERE id = $4
       RETURNING *`,
      [name, display_order, color, id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Section not found' });
    }

    res.json(result.rows[0]);
  } catch (err) {
    console.error('Error updating section:', err);
    res.status(500).json({ error: 'Failed to update section' });
  }
});

// Delete a section
app.delete('/ensemble-sections/:id', async (req, res) => {
  const { id } = req.params;

  try {
    const result = await pool.query('DELETE FROM ensemble_sections WHERE id = $1 RETURNING id', [id]);

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Section not found' });
    }

    res.json({ message: 'Section deleted successfully' });
  } catch (err) {
    console.error('Error deleting section:', err);
    res.status(500).json({ error: 'Failed to delete section' });
  }
});

// Get parts for a section
app.get('/ensemble-parts', async (req, res) => {
  const { section_id, ensemble_id } = req.query;

  try {
    let query, params;

    if (section_id) {
      // Get parts for a specific section
      query = `SELECT * FROM ensemble_parts 
               WHERE section_id = $1 
               ORDER BY display_order, name`;
      params = [section_id];
    } else if (ensemble_id) {
      // Get all parts for an ensemble (joined with sections)
      query = `SELECT p.*, s.name as section_name 
               FROM ensemble_parts p
               JOIN ensemble_sections s ON p.section_id = s.id
               WHERE s.ensemble_id = $1
               ORDER BY s.display_order, p.display_order, p.name`;
      params = [ensemble_id];
    } else {
      return res.status(400).json({ error: 'section_id or ensemble_id required' });
    }

    const result = await pool.query(query, params);
    res.json(result.rows);
  } catch (err) {
    console.error('Error fetching parts:', err);
    res.status(500).json({ error: 'Failed to fetch parts' });
  }
});

// Create a part
app.post('/ensemble-parts', async (req, res) => {
  const { section_id, name, display_order } = req.body;

  if (!section_id || !name) {
    return res.status(400).json({ error: 'section_id and name required' });
  }

  try {
    const result = await pool.query(
      `INSERT INTO ensemble_parts (section_id, name, display_order)
       VALUES ($1, $2, $3)
       RETURNING *`,
      [section_id, name, display_order || 0]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error('Error creating part:', err);
    if (err.code === '23505') {
      return res.status(409).json({ error: 'Part name already exists for this section' });
    }
    res.status(500).json({ error: 'Failed to create part' });
  }
});

// Update a part
app.put('/ensemble-parts/:id', async (req, res) => {
  const { id } = req.params;
  const { name, display_order } = req.body;

  try {
    const result = await pool.query(
      `UPDATE ensemble_parts
       SET name = COALESCE($1, name),
           display_order = COALESCE($2, display_order)
       WHERE id = $3
       RETURNING *`,
      [name, display_order, id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Part not found' });
    }

    res.json(result.rows[0]);
  } catch (err) {
    console.error('Error updating part:', err);
    res.status(500).json({ error: 'Failed to update part' });
  }
});

// Delete a part
app.delete('/ensemble-parts/:id', async (req, res) => {
  const { id } = req.params;

  try {
    const result = await pool.query('DELETE FROM ensemble_parts WHERE id = $1 RETURNING id', [id]);

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Part not found' });
    }

    res.json({ message: 'Part deleted successfully' });
  } catch (err) {
    console.error('Error deleting part:', err);
    res.status(500).json({ error: 'Failed to delete part' });
  }
});

// --- MESSAGES ---

// TEMP: Migration endpoint to create tables
app.get('/init-messages-db', async (req, res) => {
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS messages (
        id SERIAL PRIMARY KEY,
        director_id INTEGER REFERENCES users(id),
        ensemble_id INTEGER REFERENCES ensembles(id),
        subject TEXT NOT NULL,
        content TEXT NOT NULL,
        recipients_summary TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS message_recipients (
        id SERIAL PRIMARY KEY,
        message_id INTEGER REFERENCES messages(id) ON DELETE CASCADE,
        roster_id INTEGER REFERENCES roster(id),
        read_at TIMESTAMP,
        UNIQUE(message_id, roster_id)
      );
    `);
    res.json({ message: 'Messages tables created successfully' });
  } catch (err) {
    console.error('Migration error:', err);
    res.status(500).json({ error: err.message });
  }
});

// Get messages for a director
app.get('/messages', async (req, res) => {
  const { director_id } = req.query;
  if (!director_id) return res.status(400).json({ error: 'director_id required' });

  try {
    const result = await pool.query(
      `SELECT m.*, 
        (SELECT COUNT(*) FROM message_recipients mr WHERE mr.message_id = m.id AND mr.read_at IS NOT NULL) as read_count,
        (SELECT COUNT(*) FROM message_recipients mr WHERE mr.message_id = m.id) as total_count
       FROM messages m
       WHERE m.director_id = $1
       ORDER BY m.created_at DESC`,
      [director_id]
    );
    res.json(result.rows);
  } catch (err) {
    console.error('Error fetching messages:', err);
    res.status(500).json({ error: 'Failed to fetch messages' });
  }
});

// Send a message
app.post('/messages', async (req, res) => {
  const { director_id, ensemble_id, subject, content, recipients_summary, recipient_ids } = req.body;

  if (!director_id || !subject || !content || !recipient_ids) {
    return res.status(400).json({ error: 'Missing required fields' });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // 1. Create message
    const msgResult = await client.query(
      `INSERT INTO messages (director_id, ensemble_id, subject, content, recipients_summary)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING *`,
      [director_id, ensemble_id || null, subject, content, recipients_summary || 'Recipients']
    );
    const message = msgResult.rows[0];

    // 2. Add recipients
    if (recipient_ids.length > 0) {
      const values = recipient_ids.map((rid, idx) => `($1, $${idx + 2})`).join(',');
      const params = [message.id, ...recipient_ids];

      await client.query(
        `INSERT INTO message_recipients (message_id, roster_id) VALUES ${values}`,
        params
      );
    }

    await client.query('COMMIT');
    res.status(201).json(message);
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Error sending message:', err);
    res.status(500).json({ error: 'Failed to send message' });
  } finally {
    client.release();
  }
});

// --- TICKETS SYSTEM ---

// ========== TICKET EVENTS ==========

// Get all ticket events for a director
app.get('/ticket-events', async (req, res) => {
  const { director_id } = req.query;
  if (!director_id) return res.status(400).json({ error: 'director_id required' });

  try {
    const result = await pool.query(
      `SELECT e.*, 
        (SELECT json_agg(p.*) FROM performances p WHERE p.ticket_event_id = e.id) as performances,
        (SELECT COUNT(*) FROM performances p WHERE p.ticket_event_id = e.id) as performance_count,
        (SELECT COALESCE(SUM(o.total), 0) FROM orders o WHERE o.ticket_event_id = e.id AND o.status = 'completed') as total_revenue
       FROM ticket_events e
       WHERE e.director_id = $1
       ORDER BY e.created_at DESC`,
      [director_id]
    );
    res.json(result.rows);
  } catch (err) {
    console.error('Error fetching events:', err);
    res.status(500).json({ error: 'Failed to fetch events' });
  }
});

// Get single ticket event
app.get('/ticket-events/:id', async (req, res) => {
  const { id } = req.params;

  try {
    const result = await pool.query('SELECT * FROM ticket_events WHERE id = $1', [id]);
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Event not found' });
    }
    res.json(result.rows[0]);
  } catch (err) {
    console.error('Error fetching event:', err);
    res.status(500).json({ error: 'Failed to fetch event' });
  }
});

// Create ticket event
app.post('/ticket-events', async (req, res) => {
  const {
    director_id,
    ensemble_id,
    title,
    subtitle,
    description,
    program_notes,
    venue_name,
    venue_address,
    parking_instructions,
    dress_code,
    status = 'draft'
  } = req.body;

  if (!director_id || !title) {
    return res.status(400).json({ error: 'director_id and title required' });
  }

  try {
    const result = await pool.query(
      `INSERT INTO ticket_events (director_id, ensemble_id, title, subtitle, description, program_notes, venue_name, venue_address, parking_instructions, dress_code, status)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
       RETURNING *`,
      [director_id, ensemble_id, title, subtitle, description, program_notes, venue_name, venue_address, parking_instructions, dress_code, status]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error('Error creating event:', err);
    res.status(500).json({ error: 'Failed to create event' });
  }
});

// Update ticket event
app.put('/ticket-events/:id', async (req, res) => {
  const { id } = req.params;
  const {
    title,
    subtitle,
    description,
    program_notes,
    venue_name,
    venue_address,
    parking_instructions,
    dress_code,
    status
  } = req.body;

  try {
    const result = await pool.query(
      `UPDATE ticket_events
       SET title = COALESCE($1, title),
           subtitle = COALESCE($2, subtitle),
           description = COALESCE($3, description),
           program_notes = COALESCE($4, program_notes),
           venue_name = COALESCE($5, venue_name),
           venue_address = COALESCE($6, venue_address),
           parking_instructions = COALESCE($7, parking_instructions),
           dress_code = COALESCE($8, dress_code),
           status = COALESCE($9, status),
           updated_at = CURRENT_TIMESTAMP
       WHERE id = $10
       RETURNING *`,
      [title, subtitle, description, program_notes, venue_name, venue_address, parking_instructions, dress_code, status, id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Event not found' });
    }

    res.json(result.rows[0]);
  } catch (err) {
    console.error('Error updating event:', err);
    res.status(500).json({ error: 'Failed to update event' });
  }
});

// Delete ticket event
app.delete('/ticket-events/:id', async (req, res) => {
  const { id } = req.params;

  try {
    const result = await pool.query('DELETE FROM ticket_events WHERE id = $1 RETURNING id', [id]);
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Event not found' });
    }
    res.json({ message: 'Event deleted successfully' });
  } catch (err) {
    console.error('Error deleting event:', err);
    res.status(500).json({ error: 'Failed to delete event' });
  }
});

// ========== PERFORMANCES ==========

// Get performances for an event
app.get('/performances', async (req, res) => {
  const { ticket_event_id } = req.query;
  if (!ticket_event_id) return res.status(400).json({ error: 'ticket_event_id required' });

  try {
    const result = await pool.query(
      `SELECT p.*,
        (SELECT COUNT(*) FROM orders o WHERE o.performance_id = p.id AND o.status = 'completed') as tickets_sold
       FROM performances p
       WHERE p.ticket_event_id = $1
       ORDER BY p.performance_date, p.start_time`,
      [ticket_event_id]
    );
    res.json(result.rows);
  } catch (err) {
    console.error('Error fetching performances:', err);
    res.status(500).json({ error: 'Failed to fetch performances' });
  }
});

// Create performance
app.post('/performances', async (req, res) => {
  const { ticket_event_id, performance_date, doors_open_time, start_time, end_time, capacity } = req.body;

  if (!ticket_event_id || !performance_date || !start_time) {
    return res.status(400).json({ error: 'ticket_event_id, performance_date, and start_time required' });
  }

  try {
    const result = await pool.query(
      `INSERT INTO performances (ticket_event_id, performance_date, doors_open_time, start_time, end_time, capacity)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING *`,
      [ticket_event_id, performance_date, doors_open_time, start_time, end_time, capacity]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error('Error creating performance:', err);
    res.status(500).json({ error: 'Failed to create performance' });
  }
});

// Update performance
app.put('/performances/:id', async (req, res) => {
  const { id } = req.params;
  const { performance_date, doors_open_time, start_time, end_time, capacity } = req.body;

  try {
    const result = await pool.query(
      `UPDATE performances
       SET performance_date = COALESCE($1, performance_date),
           doors_open_time = COALESCE($2, doors_open_time),
           start_time = COALESCE($3, start_time),
           end_time = COALESCE($4, end_time),
           capacity = COALESCE($5, capacity)
       WHERE id = $6
       RETURNING *`,
      [performance_date, doors_open_time, start_time, end_time, capacity, id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Performance not found' });
    }

    res.json(result.rows[0]);
  } catch (err) {
    console.error('Error updating performance:', err);
    res.status(500).json({ error: 'Failed to update performance' });
  }
});

// Delete performance
app.delete('/performances/:id', async (req, res) => {
  const { id } = req.params;

  try {
    const result = await pool.query('DELETE FROM performances WHERE id = $1 RETURNING id', [id]);
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Performance not found' });
    }
    res.json({ message: 'Performance deleted successfully' });
  } catch (err) {
    console.error('Error deleting performance:', err);
    res.status(500).json({ error: 'Failed to delete performance' });
  }
});

// ========== TICKET TYPES ==========

// Get ticket types for an event
app.get('/ticket-types', async (req, res) => {
  const { ticket_event_id } = req.query;
  if (!ticket_event_id) return res.status(400).json({ error: 'ticket_event_id required' });

  try {
    const result = await pool.query(
      'SELECT * FROM ticket_types WHERE ticket_event_id = $1 ORDER BY sort_order, id',
      [ticket_event_id]
    );
    res.json(result.rows);
  } catch (err) {
    console.error('Error fetching ticket types:', err);
    res.status(500).json({ error: 'Failed to fetch ticket types' });
  }
});

// Create ticket type
app.post('/ticket-types', async (req, res) => {
  const { ticket_event_id, name, description, price, seating_type, quantity_available, is_public, sort_order } = req.body;

  if (!ticket_event_id || !name || price === undefined) {
    return res.status(400).json({ error: 'ticket_event_id, name, and price required' });
  }

  try {
    const result = await pool.query(
      `INSERT INTO ticket_types (ticket_event_id, name, description, price, seating_type, quantity_available, is_public, sort_order)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       RETURNING *`,
      [ticket_event_id, name, description, price, seating_type || 'general_admission', quantity_available, is_public !== false, sort_order || 0]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error('Error creating ticket type:', err);
    res.status(500).json({ error: 'Failed to create ticket type' });
  }
});

// Update ticket type
app.put('/ticket-types/:id', async (req, res) => {
  const { id } = req.params;
  const { name, description, price, seating_type, quantity_available, is_public, sort_order } = req.body;

  try {
    const result = await pool.query(
      `UPDATE ticket_types
       SET name = COALESCE($1, name),
           description = COALESCE($2, description),
           price = COALESCE($3, price),
           seating_type = COALESCE($4, seating_type),
           quantity_available = COALESCE($5, quantity_available),
           is_public = COALESCE($6, is_public),
           sort_order = COALESCE($7, sort_order)
       WHERE id = $8
       RETURNING *`,
      [name, description, price, seating_type, quantity_available, is_public, sort_order, id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Ticket type not found' });
    }

    res.json(result.rows[0]);
  } catch (err) {
    console.error('Error updating ticket type:', err);
    res.status(500).json({ error: 'Failed to update ticket type' });
  }
});

// Delete ticket type
app.delete('/ticket-types/:id', async (req, res) => {
  const { id } = req.params;

  try {
    const result = await pool.query('DELETE FROM ticket_types WHERE id = $1 RETURNING id', [id]);
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Ticket type not found' });
    }
    res.json({ message: 'Ticket type deleted successfully' });
  } catch (err) {
    console.error('Error deleting ticket type:', err);
    res.status(500).json({ error: 'Failed to delete ticket type' });
  }
});

// ========== STUDENT SALE LINKS ==========

// Generate student sale links for a ticket event
app.post('/ticket-events/:eventId/generate-student-links', async (req, res) => {
  const { eventId } = req.params;

  try {
    // Get event details
    const eventResult = await pool.query('SELECT * FROM ticket_events WHERE id = $1', [eventId]);
    if (eventResult.rows.length === 0) {
      return res.status(404).json({ error: 'Event not found' });
    }
    const event = eventResult.rows[0];

    // Get all students in the ensemble
    const studentsResult = await pool.query(
      'SELECT * FROM roster WHERE ensemble_id = $1 AND status = $2',
      [event.ensemble_id, 'active']
    );

    if (studentsResult.rows.length === 0) {
      return res.status(400).json({ error: 'No active students found in ensemble' });
    }

    const links = [];
    const eventSlug = event.title.toLowerCase().replace(/[^a-z0-9]+/g, '-').substring(0, 20);

    for (const student of studentsResult.rows) {
      // Generate unique code
      const randomCode = Math.random().toString(36).substring(2, 6).toUpperCase();
      const firstName = student.first_name.toLowerCase().replace(/[^a-z]+/g, '');
      const lastName = student.last_name.toLowerCase().replace(/[^a-z]+/g, '');
      const uniqueCode = `${eventSlug}-${firstName}-${lastName}-${randomCode}`;

      // Insert or update link
      const linkResult = await pool.query(
        `INSERT INTO student_sale_links (ticket_event_id, roster_id, unique_code)
         VALUES ($1, $2, $3)
         ON CONFLICT (unique_code) DO UPDATE SET unique_code = EXCLUDED.unique_code
         RETURNING *`,
        [eventId, student.id, uniqueCode]
      );

      links.push({
        ...linkResult.rows[0],
        student_name: `${student.first_name} ${student.last_name}`,
        url: `/tickets/${uniqueCode}`
      });
    }

    res.status(201).json(links);
  } catch (err) {
    console.error('Error generating student links:', err);
    res.status(500).json({ error: 'Failed to generate student links' });
  }
});

// Get student sale links for an event
app.get('/student-sale-links', async (req, res) => {
  const { ticket_event_id } = req.query;
  if (!ticket_event_id) return res.status(400).json({ error: 'ticket_event_id required' });

  try {
    const result = await pool.query(
      `SELECT ssl.*, r.first_name, r.last_name,
        (SELECT COUNT(*) FROM orders o WHERE o.student_sale_link_id = ssl.id AND o.status = 'completed') as sales_count,
        (SELECT COALESCE(SUM(o.total), 0) FROM orders o WHERE o.student_sale_link_id = ssl.id AND o.status = 'completed') as total_revenue
       FROM student_sale_links ssl
       JOIN roster r ON ssl.roster_id = r.id
       WHERE ssl.ticket_event_id = $1
       ORDER BY r.last_name, r.first_name`,
      [ticket_event_id]
    );
    res.json(result.rows);
  } catch (err) {
    console.error('Error fetching student sale links:', err);
    res.status(500).json({ error: 'Failed to fetch student sale links' });
  }
});

// Get event by student code (public)
app.get('/student-sale-links/:code', async (req, res) => {
  const { code } = req.params;

  try {
    const result = await pool.query(
      `SELECT ssl.*, e.*, r.first_name as student_first_name, r.last_name as student_last_name
       FROM student_sale_links ssl
       JOIN ticket_events e ON ssl.ticket_event_id = e.id
       JOIN roster r ON ssl.roster_id = r.id
       WHERE ssl.unique_code = $1`,
      [code]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Student sale link not found' });
    }

    res.json(result.rows[0]);
  } catch (err) {
    console.error('Error fetching student sale link:', err);
    res.status(500).json({ error: 'Failed to fetch student sale link' });
  }
});

// ========== ORDERS ==========

// Create order (public)
app.post('/orders', async (req, res) => {
  const {
    ticket_event_id,
    performance_id,
    student_sale_link_id,
    buyer_email,
    buyer_name,
    buyer_phone,
    items, // [{ ticket_type_id, quantity }]
    donation = 0,
    stripe_payment_intent_id
  } = req.body;

  if (!ticket_event_id || !performance_id || !buyer_email || !buyer_name || !items || items.length === 0) {
    return res.status(400).json({ error: 'Missing required fields' });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Calculate totals
    let subtotal = 0;
    const orderItems = [];

    for (const item of items) {
      const ticketTypeResult = await client.query(
        'SELECT * FROM ticket_types WHERE id = $1',
        [item.ticket_type_id]
      );

      if (ticketTypeResult.rows.length === 0) {
        throw new Error(`Ticket type ${item.ticket_type_id} not found`);
      }

      const ticketType = ticketTypeResult.rows[0];
      const itemSubtotal = ticketType.price * item.quantity;
      subtotal += itemSubtotal;

      orderItems.push({
        ticket_type_id: item.ticket_type_id,
        quantity: item.quantity,
        unit_price: ticketType.price,
        subtotal: itemSubtotal
      });
    }

    // Simple fee calculation (3% + $0.30 per order)
    const fees = (subtotal * 0.03) + 0.30;
    const total = subtotal + fees + parseFloat(donation);

    // Create order
    const orderResult = await client.query(
      `INSERT INTO orders (ticket_event_id, performance_id, student_sale_link_id, buyer_email, buyer_name, buyer_phone, subtotal, fees, donation, total, stripe_payment_intent_id, status)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
       RETURNING *`,
      [ticket_event_id, performance_id, student_sale_link_id, buyer_email, buyer_name, buyer_phone, subtotal, fees, donation, total, stripe_payment_intent_id, 'completed']
    );

    const order = orderResult.rows[0];

    // Create order items with QR codes
    for (const item of orderItems) {
      for (let i = 0; i < item.quantity; i++) {
        const qrCode = `ORDER-${order.id}-ITEM-${Date.now()}-${Math.random().toString(36).substring(7)}`;

        await client.query(
          `INSERT INTO order_items (order_id, ticket_type_id, quantity, unit_price, subtotal, qr_code)
           VALUES ($1, $2, 1, $3, $4, $5)`,
          [order.id, item.ticket_type_id, item.unit_price, item.unit_price, qrCode]
        );
      }
    }

    await client.query('COMMIT');
    res.status(201).json(order);
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Error creating order:', err);
    res.status(500).json({ error: 'Failed to create order: ' + err.message });
  } finally {
    client.release();
  }
});

// Get order by ID
app.get('/orders/:id', async (req, res) => {
  const { id } = req.params;

  try {
    const orderResult = await pool.query('SELECT * FROM orders WHERE id = $1', [id]);
    if (orderResult.rows.length === 0) {
      return res.status(404).json({ error: 'Order not found' });
    }

    const itemsResult = await pool.query(
      `SELECT oi.*, tt.name as ticket_type_name
       FROM order_items oi
       JOIN ticket_types tt ON oi.ticket_type_id = tt.id
       WHERE oi.order_id = $1`,
      [id]
    );

    res.json({
      ...orderResult.rows[0],
      items: itemsResult.rows
    });
  } catch (err) {
    console.error('Error fetching order:', err);
    res.status(500).json({ error: 'Failed to fetch order' });
  }
});

// Get orders for an event
app.get('/orders', async (req, res) => {
  const { ticket_event_id } = req.query;
  if (!ticket_event_id) return res.status(400).json({ error: 'ticket_event_id required' });

  try {
    const result = await pool.query(
      `SELECT o.*, p.performance_date, p.start_time
       FROM orders o
       JOIN performances p ON o.performance_id = p.id
       WHERE o.ticket_event_id = $1
       ORDER BY o.created_at DESC`,
      [ticket_event_id]
    );
    res.json(result.rows);
  } catch (err) {
    console.error('Error fetching orders:', err);
    res.status(500).json({ error: 'Failed to fetch orders' });
  }
});

// ========== REPORTING ==========

// Student sales report
app.get('/reports/student-sales', async (req, res) => {
  const { ticket_event_id } = req.query;
  if (!ticket_event_id) return res.status(400).json({ error: 'ticket_event_id required' });

  try {
    const result = await pool.query(
      `SELECT 
        r.id as roster_id,
        r.first_name,
        r.last_name,
        r.section,
        ssl.unique_code,
        COUNT(o.id) as order_count,
        COALESCE(SUM(o.total), 0) as total_revenue,
        COALESCE(SUM((SELECT SUM(oi.quantity) FROM order_items oi WHERE oi.order_id = o.id)), 0) as tickets_sold
       FROM student_sale_links ssl
       JOIN roster r ON ssl.roster_id = r.id
       LEFT JOIN orders o ON o.student_sale_link_id = ssl.id AND o.status = 'completed'
       WHERE ssl.ticket_event_id = $1
       GROUP BY r.id, r.first_name, r.last_name, r.section, ssl.unique_code
       ORDER BY total_revenue DESC, r.last_name, r.first_name`,
      [ticket_event_id]
    );
    res.json(result.rows);
  } catch (err) {
    console.error('Error fetching student sales report:', err);
    res.status(500).json({ error: 'Failed to fetch student sales report' });
  }
});

// Event summary report
app.get('/reports/event-summary', async (req, res) => {
  const { ticket_event_id } = req.query;
  if (!ticket_event_id) return res.status(400).json({ error: 'ticket_event_id required' });

  try {
    const result = await pool.query(
      `SELECT 
        e.*,
        COUNT(DISTINCT o.id) as total_orders,
        COALESCE(SUM(o.total), 0) as total_revenue,
        COALESCE(SUM(o.subtotal), 0) as ticket_revenue,
        COALESCE(SUM(o.donation), 0) as donation_revenue,
        COALESCE(SUM((SELECT SUM(oi.quantity) FROM order_items oi WHERE oi.order_id = o.id)), 0) as tickets_sold
       FROM events e
       LEFT JOIN orders o ON o.ticket_event_id = e.id AND o.status = 'completed'
       WHERE e.id = $1
       GROUP BY e.id`,
      [ticket_event_id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Event not found' });
    }

    res.json(result.rows[0]);
  } catch (err) {
    console.error('Error fetching event summary:', err);
    res.status(500).json({ error: 'Failed to fetch event summary' });
  }
});


// ========================================
// RECRUITING MODULE API ENDPOINTS
// ========================================

// --- PROSPECTS ---

// Get all prospects for a director with filters
app.get('/api/recruiting/prospects', async (req, res) => {
  const { director_id, stage, interest_level, voice_part, graduation_year, search, assigned_to, page = 1, limit = 50 } = req.query;

  if (!director_id) {
    return res.status(400).json({ error: 'director_id is required' });
  }

  try {
    let query = `
      SELECT p.*, 
             ps.name as stage_name, 
             ps.color as stage_color,
             u.first_name as recruiter_first_name,
             u.last_name as recruiter_last_name
      FROM prospects p
      LEFT JOIN pipeline_stages ps ON p.pipeline_stage_id = ps.id
      LEFT JOIN users u ON p.assigned_recruiter_id = u.id
      WHERE p.director_id = $1 AND p.status = 'active'
    `;
    const params = [director_id];
    let paramIndex = 2;

    // Add filters
    if (stage) {
      query += ` AND p.pipeline_stage_id = $${paramIndex}`;
      params.push(stage);
      paramIndex++;
    }

    if (interest_level) {
      query += ` AND p.interest_level = $${paramIndex}`;
      params.push(interest_level);
      paramIndex++;
    }

    if (voice_part) {
      query += ` AND p.voice_part = $${paramIndex}`;
      params.push(voice_part);
      paramIndex++;
    }

    if (graduation_year) {
      query += ` AND p.graduation_year = $${paramIndex}`;
      params.push(graduation_year);
      paramIndex++;
    }

    if (assigned_to) {
      query += ` AND p.assigned_recruiter_id = $${paramIndex}`;
      params.push(assigned_to);
      paramIndex++;
    }

    if (search) {
      query += ` AND (p.first_name ILIKE $${paramIndex} OR p.last_name ILIKE $${paramIndex} OR p.email ILIKE $${paramIndex} OR p.high_school ILIKE $${paramIndex})`;
      params.push(`%${search}%`);
      paramIndex++;
    }

    // Count total
    const countResult = await pool.query(`SELECT COUNT(*) ${query.substring(query.indexOf('FROM'))}`, params);
    const total = parseInt(countResult.rows[0].count);

    // Add pagination
    const offset = (page - 1) * limit;
    query += ` ORDER BY p.created_at DESC LIMIT $${paramIndex} OFFSET $${paramIndex + 1}`;
    params.push(limit, offset);

    const result = await pool.query(query, params);

    res.json({
      prospects: result.rows,
      total,
      page: parseInt(page),
      pages: Math.ceil(total / limit)
    });
  } catch (err) {
    console.error('Error fetching prospects:', err);
    res.status(500).json({ error: 'Failed to fetch prospects' });
  }
});

// Get single prospect with details
app.get('/api/recruiting/prospects/:id', async (req, res) => {
  const { id } = req.params;

  try {
    const prospectResult = await pool.query(`
      SELECT p.*, 
             ps.name as stage_name,
             u.first_name as recruiter_first_name,
             u.last_name as recruiter_last_name
      FROM prospects p
      LEFT JOIN pipeline_stages ps ON p.pipeline_stage_id = ps.id
      LEFT JOIN users u ON p.assigned_recruiter_id = u.id
      WHERE p.id = $1
    `, [id]);

    if (prospectResult.rows.length === 0) {
      return res.status(404).json({ error: 'Prospect not found' });
    }

    // Get communication history
    const commsResult = await pool.query(`
      SELECT pc.*, u.first_name, u.last_name
      FROM prospect_communications pc
      LEFT JOIN users u ON pc.sent_by = u.id
      WHERE pc.prospect_id = $1
      ORDER BY pc.sent_at DESC
    `, [id]);

    res.json({
      prospect: prospectResult.rows[0],
      communications: commsResult.rows
    });
  } catch (err) {
    console.error('Error fetching prospect:', err);
    res.status(500).json({ error: 'Failed to fetch prospect' });
  }
});

// Create new prospect
app.post('/api/recruiting/prospects', async (req, res) => {
  const {
    director_id,
    first_name,
    last_name,
    email,
    phone,
    high_school,
    graduation_year,
    gpa,
    voice_part,
    instrument,
    years_experience,
    interest_level = 'warm',
    source,
    source_detail,
    notes,
    follow_up_date,
    ensemble_preferences,
    created_by
  } = req.body;

  if (!director_id || !first_name || !last_name || !email) {
    return res.status(400).json({ error: 'director_id, first_name, last_name, and email are required' });
  }

  try {
    // Get default "New Lead" stage
    const stageResult = await pool.query(`
      SELECT id FROM pipeline_stages 
      WHERE (director_id = $1 OR director_id IS NULL) 
      AND name = 'New Lead' 
      ORDER BY director_id DESC NULLS LAST 
      LIMIT 1
    `, [director_id]);

    const stageId = stageResult.rows[0]?.id;

    const result = await pool.query(`
      INSERT INTO prospects (
        director_id, first_name, last_name, email, phone,
        high_school, graduation_year, gpa, voice_part, instrument,
        years_experience, interest_level, pipeline_stage_id,
        source, source_detail, notes, follow_up_date,
        ensemble_preferences, created_by
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19)
      RETURNING *
    `, [
      director_id, first_name, last_name, email, phone,
      high_school, graduation_year, gpa, voice_part, instrument,
      years_experience, interest_level, stageId,
      source, source_detail, notes, follow_up_date,
      JSON.stringify(ensemble_preferences), created_by
    ]);

    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error('Error creating prospect:', err);
    if (err.code === '23505') {
      return res.status(409).json({ error: 'Email already exists for this director' });
    }
    res.status(500).json({ error: 'Failed to create prospect' });
  }
});

// Update prospect
app.put('/api/recruiting/prospects/:id', async (req, res) => {
  const { id } = req.params;
  const updates = req.body;

  try {
    const fields = [];
    const values = [];
    let paramIndex = 1;

    // Build dynamic update query
    Object.keys(updates).forEach(key => {
      if (key !== 'id' && key !== 'director_id' && key !== 'created_at') {
        fields.push(`${key} = $${paramIndex}`);
        values.push(updates[key]);
        paramIndex++;
      }
    });

    if (fields.length === 0) {
      return res.status(400).json({ error: 'No fields to update' });
    }

    fields.push('updated_at = CURRENT_TIMESTAMP');
    values.push(id);

    const query = `UPDATE prospects SET ${fields.join(', ')} WHERE id = $${paramIndex} RETURNING *`;
    const result = await pool.query(query, values);

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Prospect not found' });
    }

    res.json(result.rows[0]);
  } catch (err) {
    console.error('Error updating prospect:', err);
    res.status(500).json({ error: 'Failed to update prospect' });
  }
});

// Delete (archive) prospect
app.delete('/api/recruiting/prospects/:id', async (req, res) => {
  const { id } = req.params;

  try {
    const result = await pool.query(`
      UPDATE prospects SET status = 'archived' WHERE id = $1 RETURNING id
    `, [id]);

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Prospect not found' });
    }

    res.json({ message: 'Prospect archived successfully' });
  } catch (err) {
    console.error('Error archiving prospect:', err);
    res.status(500).json({ error: 'Failed to archive prospect' });
  }
});

// Bulk import prospects from CSV
app.post('/api/recruiting/prospects/bulk-import', async (req, res) => {
  let { director_id, prospects } = req.body;

  console.log('=== BULK IMPORT REQUEST ===');
  console.log('Director ID:', director_id, 'Type:', typeof director_id);
  console.log('Prospects count:', prospects?.length);
  console.log('First prospect:', JSON.stringify(prospects?.[0], null, 2));
  console.log('========================');

  if (!director_id || !prospects || !Array.isArray(prospects)) {
    return res.status(400).json({ error: 'director_id and prospects array are required' });
  }

  // CRITICAL FIX: Convert director_id to integer
  director_id = parseInt(director_id);
  console.log('Converted director_id to:', director_id, 'Type:', typeof director_id);

  try {
    // VERIFY DIRECTOR EXISTS
    const userCheck = await pool.query('SELECT id, email FROM users WHERE id = $1', [director_id]);
    if (userCheck.rows.length === 0) {
      console.error(`❌ Director ID ${director_id} NOT FOUND in users table!`);
      return res.status(400).json({ error: `Director ID ${director_id} not found in database` });
    }
    console.log(`✅ Verified Director ID ${director_id} exists: ${userCheck.rows[0].email}`);

    // Get default "New Lead" stage
    const stageResult = await pool.query(`
      SELECT id FROM pipeline_stages 
      WHERE (director_id = $1 OR director_id IS NULL) 
      AND name = 'New Lead' 
      ORDER BY director_id DESC NULLS LAST 
      LIMIT 1
    `, [director_id]);

    const stageId = stageResult.rows[0]?.id;

    if (!stageId) {
      return res.status(500).json({ error: 'No pipeline stage found. Please run migrations.' });
    }

    const results = {
      imported: [],
      skipped: [],
      errors: []
    };

    // Process each prospect independently (no transaction)
    for (const prospect of prospects) {
      const { first_name, last_name, email, phone, high_school, graduation_year, gpa, voice_part, instrument, years_experience, interest_level, source, notes } = prospect;

      // Skip if missing required fields
      if (!first_name || !last_name || !email) {
        results.skipped.push({ prospect, reason: 'Missing required fields (first_name, last_name, email)' });
        continue;
      }

      try {
        const result = await pool.query(`
          INSERT INTO prospects (
            director_id, first_name, last_name, email, phone,
            high_school, graduation_year, gpa, voice_part, instrument,
            years_experience, interest_level, pipeline_stage_id,
            source, notes, created_by
          ) VALUES (
            $1::integer, $2::varchar(100), $3::varchar(100), $4::varchar(255), $5::varchar(20),
            $6::varchar(255), $7::integer, $8::numeric, $9::varchar(50), $10::varchar(100),
            $11::integer, $12::varchar(20), $13::integer,
            $14::varchar(100), $15::text, $16::integer
          )
          RETURNING *
        `, [
          director_id,
          first_name.substring(0, 100),
          last_name.substring(0, 100),
          email.substring(0, 255),
          phone ? phone.substring(0, 20) : null,
          high_school ? high_school.substring(0, 255) : null,
          graduation_year ? parseInt(graduation_year) : null,
          gpa ? parseFloat(gpa) : null,
          voice_part ? voice_part.substring(0, 50) : null,
          instrument ? instrument.substring(0, 100) : null,
          years_experience ? parseInt(years_experience) : null,
          interest_level || 'warm',
          stageId,
          source ? source.substring(0, 100) : 'csv_import',
          notes || null,
          director_id
        ]);
        results.imported.push(result.rows[0]);
        console.log(`✅ Imported: ${first_name} ${last_name}`);
      } catch (err) {
        console.error(`❌ Error importing prospect ${first_name} ${last_name}:`, err.message);
        if (err.code === '23505') {
          results.skipped.push({ prospect, reason: 'Email already exists' });
        } else {
          results.errors.push({ prospect, error: err.message });
        }
      }
    }

    res.status(201).json({
      message: `Imported ${results.imported.length} prospects`,
      imported: results.imported.length,
      skipped: results.skipped.length,
      errors: results.errors.length,
      details: results
    });
  } catch (err) {
    console.error('Error bulk importing prospects:', err);
    res.status(500).json({ error: 'Failed to import prospects: ' + err.message });
  }
});

// --- PIPELINE ---

// Get pipeline view
app.get('/api/recruiting/pipeline', async (req, res) => {
  const { director_id } = req.query;

  if (!director_id) {
    return res.status(400).json({ error: 'director_id is required' });
  }

  try {
    // Get stages
    const stagesResult = await pool.query(`
      SELECT * FROM pipeline_stages 
      WHERE director_id = $1 OR director_id IS NULL
      ORDER BY order_index
    `, [director_id]);

    // Get prospects grouped by stage
    const stages = await Promise.all(stagesResult.rows.map(async (stage) => {
      const prospectsResult = await pool.query(`
        SELECT id, first_name, last_name, email, voice_part, 
               high_school, graduation_year, interest_level
        FROM prospects
        WHERE director_id = $1 AND pipeline_stage_id = $2 AND status = 'active'
        ORDER BY created_at DESC
      `, [director_id, stage.id]);

      return {
        ...stage,
        prospects: prospectsResult.rows,
        count: prospectsResult.rows.length
      };
    }));

    res.json({ stages });
  } catch (err) {
    console.error('Error fetching pipeline:', err);
    res.status(500).json({ error: 'Failed to fetch pipeline' });
  }
});

// Move prospect to different stage
app.put('/api/recruiting/prospects/:id/stage', async (req, res) => {
  const { id } = req.params;
  const { stage_id, notes } = req.body;

  if (!stage_id) {
    return res.status(400).json({ error: 'stage_id is required' });
  }

  try {
    const result = await pool.query(`
      UPDATE prospects 
      SET pipeline_stage_id = $1, updated_at = CURRENT_TIMESTAMP
      WHERE id = $2
      RETURNING *
    `, [stage_id, id]);

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Prospect not found' });
    }

    // Log communication if notes provided
    if (notes) {
      await pool.query(`
        INSERT INTO prospect_communications (prospect_id, type, message)
        VALUES ($1, 'note', $2)
      `, [id, notes]);
    }

    res.json(result.rows[0]);
  } catch (err) {
    console.error('Error updating stage:', err);
    res.status(500).json({ error: 'Failed to update stage' });
  }
});

// --- QR CODES ---

// Create QR code
app.post('/api/recruiting/qr-codes', async (req, res) => {
  const { director_id, name, description, form_config, expires_at, created_by } = req.body;

  if (!director_id || !name) {
    return res.status(400).json({ error: 'director_id and name are required' });
  }

  try {
    // Generate unique code
    const code = `${name.toLowerCase().replace(/\s+/g, '-')}-${Date.now().toString(36)}`;

    const result = await pool.query(`
      INSERT INTO recruiting_qr_codes (
        director_id, code, name, description, form_config, expires_at, created_by
      ) VALUES ($1, $2, $3, $4, $5, $6, $7)
      RETURNING *
    `, [director_id, code, name, description, JSON.stringify(form_config), expires_at, created_by]);

    const qrCode = result.rows[0];

    res.status(201).json({
      ...qrCode,
      url: `${process.env.FRONTEND_URL || 'http://localhost:5173'}/recruit/${code}`,
      qr_image_url: `${process.env.API_URL || 'http://localhost:8080'}/api/qr/${code}.png`
    });
  } catch (err) {
    console.error('Error creating QR code:', err);
    res.status(500).json({ error: 'Failed to create QR code' });
  }
});

// Get QR code form (public)
app.get('/api/recruiting/form/:code', async (req, res) => {
  const { code } = req.params;

  try {
    const result = await pool.query(`
      SELECT qr.*, u.first_name as director_first_name, u.last_name as director_last_name
      FROM recruiting_qr_codes qr
      JOIN users u ON qr.director_id = u.id
      WHERE qr.code = $1 AND qr.is_active = true
      AND (qr.expires_at IS NULL OR qr.expires_at > CURRENT_TIMESTAMP)
    `, [code]);

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'QR code not found or expired' });
    }

    // Increment scan count
    await pool.query(`
      UPDATE recruiting_qr_codes SET scan_count = scan_count + 1 WHERE code = $1
    `, [code]);

    res.json(result.rows[0]);
  } catch (err) {
    console.error('Error fetching QR form:', err);
    res.status(500).json({ error: 'Failed to fetch form' });
  }
});

// Submit QR code form (public)
app.post('/api/recruiting/submit/:code', async (req, res) => {
  const { code } = req.params;
  const { first_name, last_name, email, phone, high_school, graduation_year, voice_part, custom_responses } = req.body;

  if (!first_name || !last_name || !email) {
    return res.status(400).json({ error: 'first_name, last_name, and email are required' });
  }

  try {
    // Get QR code details
    const qrResult = await pool.query(`
      SELECT * FROM recruiting_qr_codes WHERE code = $1 AND is_active = true
    `, [code]);

    if (qrResult.rows.length === 0) {
      return res.status(404).json({ error: 'QR code not found or inactive' });
    }

    const qrCode = qrResult.rows[0];

    // Get default stage
    const stageResult = await pool.query(`
      SELECT id FROM pipeline_stages 
      WHERE (director_id = $1 OR director_id IS NULL) 
      AND name = 'New Lead' 
      ORDER BY director_id DESC NULLS LAST 
      LIMIT 1
    `, [qrCode.director_id]);

    // Create prospect
    const prospectResult = await pool.query(`
      INSERT INTO prospects (
        director_id, first_name, last_name, email, phone,
        high_school, graduation_year, voice_part,
        source, source_detail, pipeline_stage_id, notes
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
      RETURNING *
    `, [
      qrCode.director_id, first_name, last_name, email, phone,
      high_school, graduation_year, voice_part,
      'qr_code', qrCode.name, stageResult.rows[0]?.id,
      custom_responses ? JSON.stringify(custom_responses) : null
    ]);

    // Increment submission count
    await pool.query(`
      UPDATE recruiting_qr_codes SET submission_count = submission_count + 1 WHERE code = $1
    `, [code]);

    res.status(201).json({
      message: 'Thank you for your interest!',
      prospect_id: prospectResult.rows[0].id
    });
  } catch (err) {
    console.error('Error submitting form:', err);
    if (err.code === '23505') {
      return res.status(409).json({ error: 'This email has already been submitted' });
    }
    res.status(500).json({ error: 'Failed to submit form' });
  }
});

// --- EMAIL TEMPLATES ---

// Get templates
app.get('/api/recruiting/templates', async (req, res) => {
  const { director_id, category } = req.query;

  if (!director_id) {
    return res.status(400).json({ error: 'director_id is required' });
  }

  try {
    let query = `SELECT * FROM email_templates WHERE director_id = $1 AND is_active = true`;
    const params = [director_id];

    if (category) {
      query += ` AND category = $2`;
      params.push(category);
    }

    query += ` ORDER BY category, name`;

    const result = await pool.query(query, params);
    res.json(result.rows);
  } catch (err) {
    console.error('Error fetching templates:', err);
    res.status(500).json({ error: 'Failed to fetch templates' });
  }
});

// Create template
app.post('/api/recruiting/templates', async (req, res) => {
  const { director_id, name, subject, body, category, created_by } = req.body;

  if (!director_id || !name || !subject || !body) {
    return res.status(400).json({ error: 'director_id, name, subject, and body are required' });
  }

  try {
    const result = await pool.query(`
      INSERT INTO email_templates (director_id, name, subject, body, category, created_by)
      VALUES ($1, $2, $3, $4, $5, $6)
      RETURNING *
    `, [director_id, name, subject, body, category, created_by]);

    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error('Error creating template:', err);
    res.status(500).json({ error: 'Failed to create template' });
  }
});

// Send email to prospects
app.post('/api/recruiting/send-email', async (req, res) => {
  const { prospect_ids, template_id, variables, sent_by } = req.body;

  if (!prospect_ids || !Array.isArray(prospect_ids) || prospect_ids.length === 0) {
    return res.status(400).json({ error: 'prospect_ids array is required' });
  }

  try {
    // Get template if provided
    let template = null;
    if (template_id) {
      const templateResult = await pool.query(`SELECT * FROM email_templates WHERE id = $1`, [template_id]);
      template = templateResult.rows[0];
    }

    // Log communications
    const communications = [];
    for (const prospectId of prospect_ids) {
      const result = await pool.query(`
        INSERT INTO prospect_communications (
          prospect_id, type, subject, message, template_id, sent_by
        ) VALUES ($1, $2, $3, $4, $5, $6)
        RETURNING *
      `, [
        prospectId,
        'email',
        template?.subject || 'Email sent',
        template?.body || '',
        template_id,
        sent_by
      ]);
      communications.push(result.rows[0]);
    }

    res.status(201).json({
      message: `Email sent to ${prospect_ids.length} prospect(s)`,
      communications
    });
  } catch (err) {
    console.error('Error sending email:', err);
    res.status(500).json({ error: 'Failed to send email' });
  }
});

// --- ANALYTICS ---

// Get recruiting analytics
app.get('/api/recruiting/analytics', async (req, res) => {
  const { director_id, start_date, end_date } = req.query;

  if (!director_id) {
    return res.status(400).json({ error: 'director_id is required' });
  }

  try {
    // Prospects by voice part
    const voicePartResult = await pool.query(`
      SELECT voice_part, COUNT(*) as count
      FROM prospects
      WHERE director_id = $1 AND status = 'active'
      GROUP BY voice_part
      ORDER BY count DESC
    `, [director_id]);

    // Top feeder schools
    const schoolsResult = await pool.query(`
      SELECT high_school, COUNT(*) as count
      FROM prospects
      WHERE director_id = $1 AND status = 'active' AND high_school IS NOT NULL
      GROUP BY high_school
      ORDER BY count DESC
      LIMIT 10
    `, [director_id]);

    // Conversion funnel
    const funnelResult = await pool.query(`
      SELECT ps.name, COUNT(p.id) as count
      FROM pipeline_stages ps
      LEFT JOIN prospects p ON ps.id = p.pipeline_stage_id AND p.director_id = $1 AND p.status = 'active'
      WHERE ps.director_id = $1 OR ps.director_id IS NULL
      GROUP BY ps.name, ps.order_index
      ORDER BY ps.order_index
    `, [director_id]);

    // Interest level breakdown
    const interestResult = await pool.query(`
      SELECT interest_level, COUNT(*) as count
      FROM prospects
      WHERE director_id = $1 AND status = 'active'
      GROUP BY interest_level
    `, [director_id]);

    res.json({
      prospects_by_voice_part: voicePartResult.rows.reduce((acc, row) => {
        acc[row.voice_part || 'Unknown'] = parseInt(row.count);
        return acc;
      }, {}),
      top_feeder_schools: schoolsResult.rows.map(row => ({
        school: row.high_school,
        count: parseInt(row.count)
      })),
      conversion_funnel: funnelResult.rows.reduce((acc, row) => {
        acc[row.name] = parseInt(row.count);
        return acc;
      }, {}),
      interest_level_breakdown: interestResult.rows.reduce((acc, row) => {
        acc[row.interest_level] = parseInt(row.count);
        return acc;
      }, {})
    });
  } catch (err) {
    console.error('Error fetching analytics:', err);
    res.status(500).json({ error: 'Failed to fetch analytics' });
  }
});

// --- CONVERSION ---

// Convert prospect to student
app.post('/api/recruiting/prospects/:id/convert', async (req, res) => {
  const { id } = req.params;
  const { ensemble_id, voice_part, section } = req.body;

  if (!ensemble_id) {
    return res.status(400).json({ error: 'ensemble_id is required' });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Get prospect
    const prospectResult = await client.query(`SELECT * FROM prospects WHERE id = $1`, [id]);
    if (prospectResult.rows.length === 0) {
      throw new Error('Prospect not found');
    }
    const prospect = prospectResult.rows[0];

    // Create roster entry
    const rosterResult = await client.query(`
      INSERT INTO roster (
        ensemble_id, first_name, last_name, email, phone, section, part, status
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, 'active')
      RETURNING *
    `, [
      ensemble_id,
      prospect.first_name,
      prospect.last_name,
      prospect.email,
      prospect.phone,
      section || voice_part,
      voice_part
    ]);

    const student = rosterResult.rows[0];

    // Update prospect
    await client.query(`
      UPDATE prospects 
      SET status = 'converted', 
          converted_to_student_id = $1, 
          converted_at = CURRENT_TIMESTAMP
      WHERE id = $2
    `, [student.id, id]);

    await client.query('COMMIT');

    res.status(201).json({
      message: 'Prospect converted to student successfully',
      student_id: student.id,
      roster_id: student.id
    });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Error converting prospect:', err);
    res.status(500).json({ error: 'Failed to convert prospect' });
  } finally {
    client.release();
  }
});



// --- FUNDRAISING MODULE ---

// Helper to generate unique token
function generateToken(name) {
  const cleanName = name.toLowerCase().replace(/[^a-z0-9]/g, '');
  const random = Math.random().toString(36).substring(2, 5);
  return `${cleanName}-${random}`;
}

// Create a campaign
app.post('/api/campaigns', async (req, res) => {
  const { director_id, ensemble_id, name, description, goal_amount_cents, per_student_goal_cents, starts_at, ends_at } = req.body;

  if (!director_id || !name) {
    return res.status(400).json({ error: 'director_id and name are required' });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // 1. Create Campaign
    // Generate slug from name
    let slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
    // Ensure uniqueness (simple check)
    const slugCheck = await client.query('SELECT id FROM campaigns WHERE slug = $1', [slug]);
    if (slugCheck.rows.length > 0) {
      slug = `${slug}-${Date.now()}`;
    }

    const campaignResult = await client.query(`
      INSERT INTO campaigns (
        director_id, ensemble_id, name, slug, description, 
        goal_amount_cents, per_student_goal_cents, starts_at, ends_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
      RETURNING *
    `, [
      director_id, ensemble_id || null, name, slug, description || null,
      goal_amount_cents || null, per_student_goal_cents || null, starts_at || null, ends_at || null
    ]);
    const campaign = campaignResult.rows[0];

    // 2. Add Participants from Roster
    let participantsCreated = 0;
    if (ensemble_id) {
      const rosterResult = await client.query(`
        SELECT id, first_name, last_name FROM roster WHERE ensemble_id = $1 AND status = 'active'
      `, [ensemble_id]);

      for (const student of rosterResult.rows) {
        const token = generateToken(student.first_name);

        await client.query(`
          INSERT INTO campaign_participants (
            campaign_id, student_id, token, personal_goal_cents
          ) VALUES ($1, $2, $3, $4)
          ON CONFLICT (campaign_id, student_id) DO NOTHING
        `, [
          campaign.id,
          student.id,
          token,
          per_student_goal_cents || 0
        ]);
        participantsCreated++;
      }
    }

    await client.query('COMMIT');

    res.status(201).json({
      ...campaign,
      participants_count: participantsCreated
    });

  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Error creating campaign:', err);
    console.error('Error details:', {
      message: err.message,
      code: err.code,
      detail: err.detail,
      constraint: err.constraint
    });

    // Provide more specific error messages
    let errorMessage = 'Failed to create campaign';
    if (err.code === '23503') {
      // Foreign key violation
      if (err.constraint && err.constraint.includes('director_id')) {
        errorMessage = 'Invalid director ID';
      } else if (err.constraint && err.constraint.includes('ensemble_id')) {
        errorMessage = 'Invalid ensemble ID';
      } else {
        errorMessage = 'Invalid reference: ' + (err.detail || 'foreign key constraint violation');
      }
    } else if (err.code === '23505') {
      // Unique violation
      errorMessage = 'A campaign with this name already exists';
    } else if (err.message) {
      errorMessage = err.message;
    }

    res.status(500).json({ error: errorMessage, details: err.detail });
  } finally {
    client.release();
  }
});

// Get campaigns for director
app.get('/api/campaigns', async (req, res) => {
  const { director_id } = req.query;
  if (!director_id) return res.status(400).json({ error: 'director_id required' });

  try {
    const result = await pool.query(`
      SELECT c.*, 
        (SELECT COUNT(*) FROM campaign_participants cp WHERE cp.campaign_id = c.id) as participant_count,
        (SELECT COALESCE(SUM(total_raised_cents), 0) FROM campaign_participants cp WHERE cp.campaign_id = c.id) as total_raised
      FROM campaigns c
      WHERE c.director_id = $1
      ORDER BY c.created_at DESC
    `, [director_id]);

    res.json(result.rows);
  } catch (err) {
    console.error('Error fetching campaigns:', err);
    res.status(500).json({ error: 'Failed to fetch campaigns' });
  }
});

// Get single campaign details
app.get('/api/campaigns/:id', async (req, res) => {
  const { id } = req.params;
  try {
    const campaignResult = await pool.query(`
      SELECT c.*, e.name as ensemble_name
      FROM campaigns c
      LEFT JOIN ensembles e ON c.ensemble_id = e.id
      WHERE c.id = $1
    `, [id]);

    if (campaignResult.rows.length === 0) {
      return res.status(404).json({ error: 'Campaign not found' });
    }

    const campaign = campaignResult.rows[0];

    // Get stats
    const statsResult = await pool.query(`
      SELECT 
        COUNT(*) as participant_count,
        COALESCE(SUM(total_raised_cents), 0) as total_raised,
        COUNT(DISTINCT d.id) as donor_count
      FROM campaign_participants cp
      LEFT JOIN donations d ON d.participant_id = cp.id
      WHERE cp.campaign_id = $1
    `, [id]);

    res.json({
      ...campaign,
      stats: statsResult.rows[0]
    });
  } catch (err) {
    console.error('Error fetching campaign details:', err);
    res.status(500).json({ error: 'Failed to fetch campaign details' });
  }
});

// Get campaign participants
app.get('/api/campaigns/:id/participants', async (req, res) => {
  const { id } = req.params;
  try {
    const result = await pool.query(`
      SELECT cp.*, r.first_name, r.last_name, r.section, r.part
      FROM campaign_participants cp
      JOIN roster r ON cp.student_id = r.id
      WHERE cp.campaign_id = $1
      ORDER BY cp.total_raised_cents DESC, r.last_name ASC
    `, [id]);

    res.json(result.rows);
  } catch (err) {
    console.error('Error fetching participants:', err);
    res.status(500).json({ error: 'Failed to fetch participants' });
  }
});

// Update campaign
app.patch('/api/campaigns/:id', async (req, res) => {
  const { id } = req.params;
  const { name, description, goal_amount_cents, per_student_goal_cents, starts_at, ends_at, is_active } = req.body;

  try {
    const result = await pool.query(`
      UPDATE campaigns
      SET name = COALESCE($1, name),
          description = COALESCE($2, description),
          goal_amount_cents = COALESCE($3, goal_amount_cents),
          per_student_goal_cents = COALESCE($4, per_student_goal_cents),
          starts_at = COALESCE($5, starts_at),
          ends_at = COALESCE($6, ends_at),
          is_active = COALESCE($7, is_active),
          updated_at = CURRENT_TIMESTAMP
      WHERE id = $8
      RETURNING *
    `, [name, description, goal_amount_cents, per_student_goal_cents, starts_at, ends_at, is_active, id]);

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Campaign not found' });
    }

    res.json(result.rows[0]);
  } catch (err) {
    console.error('Error updating campaign:', err);
    res.status(500).json({ error: 'Failed to update campaign' });
  }
});


// --- PUBLIC FUNDRAISING ROUTES ---

// Get public campaign data
app.get('/api/public/fundraising/:campaignSlug/:token', async (req, res) => {
  const { campaignSlug, token } = req.params;

  try {
    const result = await pool.query(`
      SELECT 
        c.name as campaign_name, c.description, c.goal_amount_cents as campaign_goal,
        c.starts_at, c.ends_at, c.is_active,
        cp.id as participant_id, cp.personal_goal_cents, cp.total_raised_cents,
        r.first_name, r.last_name, r.section,
        e.name as ensemble_name
      FROM campaign_participants cp
      JOIN campaigns c ON cp.campaign_id = c.id
      JOIN roster r ON cp.student_id = r.id
      LEFT JOIN ensembles e ON c.ensemble_id = e.id
      WHERE c.slug = $1 AND cp.token = $2
    `, [campaignSlug, token]);

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Campaign or participant not found' });
    }

    const data = result.rows[0];

    // Get overall campaign progress
    const campaignTotal = await pool.query(`
      SELECT COALESCE(SUM(total_raised_cents), 0) as total
      FROM campaign_participants 
      WHERE campaign_id = (SELECT id FROM campaigns WHERE slug = $1)
    `, [campaignSlug]);

    res.json({
      campaign: {
        name: data.campaign_name,
        description: data.description,
        goal_amount_cents: data.campaign_goal,
        total_raised_cents: parseInt(campaignTotal.rows[0].total),
        starts_at: data.starts_at,
        ends_at: data.ends_at,
        is_active: data.is_active,
        ensemble_name: data.ensemble_name
      },
      participant: {
        id: data.participant_id,
        first_name: data.first_name,
        last_name: data.last_name,
        section: data.section,
        personal_goal_cents: data.personal_goal_cents,
        total_raised_cents: data.total_raised_cents
      }
    });

  } catch (err) {
    console.error('Error fetching public fundraising data:', err);
    res.status(500).json({ error: 'Failed to fetch data' });
  }
});

// Create Stripe Payment Intent (Checkout)
app.post('/api/public/fundraising/:campaignSlug/:token/checkout', async (req, res) => {
  const { campaignSlug, token } = req.params;
  const { amount_cents, donor_name, donor_email, is_anonymous, message } = req.body;

  if (!amount_cents || amount_cents < 50) { // Minimum 50 cents
    return res.status(400).json({ error: 'Invalid amount' });
  }

  try {
    // 1. Validate Campaign & Participant
    const result = await pool.query(`
      SELECT c.id as campaign_id, c.director_id, cp.id as participant_id, cp.student_id
      FROM campaign_participants cp
      JOIN campaigns c ON cp.campaign_id = c.id
      WHERE c.slug = $1 AND cp.token = $2 AND c.is_active = true
    `, [campaignSlug, token]);

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Campaign not found or inactive' });
    }

    const { campaign_id, director_id, participant_id, student_id } = result.rows[0];

    // 2. Create Stripe Payment Intent
    // Note: In a real app, you'd initialize Stripe with the secret key
    // const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);

    // MOCK STRIPE FOR NOW (Since I don't have the key in env yet)
    // In production, uncomment the stripe logic and remove the mock

    /*
    const paymentIntent = await stripe.paymentIntents.create({
      amount: amount_cents,
      currency: 'usd',
      metadata: {
        campaign_id,
        participant_id,
        student_id,
        director_id,
        donor_name,
        donor_email,
        is_anonymous: is_anonymous ? 'true' : 'false',
        message,
        opus_type: 'fundraising_donation'
      }
    });
    
    res.json({ clientSecret: paymentIntent.client_secret });
    */

    // MOCK RESPONSE
    res.json({
      clientSecret: 'pi_mock_' + Math.random().toString(36).substring(7) + '_secret_' + Math.random().toString(36).substring(7),
      mock: true,
      message: "Stripe is mocked. In production, this returns a real clientSecret."
    });

  } catch (err) {
    console.error('Error creating payment intent:', err);
    res.status(500).json({ error: 'Failed to initiate payment' });
  }
});

// --- STUDENT ROUTES ---

// Get active campaigns for student
app.get('/api/student/campaigns', async (req, res) => {
  // Assuming student auth middleware populates req.user or similar
  // For now, passing student_email as query param for simplicity/testing
  const { student_email } = req.query;

  if (!student_email) return res.status(400).json({ error: 'student_email required' });

  try {
    const result = await pool.query(`
      SELECT c.*, cp.token, cp.personal_goal_cents, cp.total_raised_cents
      FROM campaign_participants cp
      JOIN campaigns c ON cp.campaign_id = c.id
      JOIN roster r ON cp.student_id = r.id
      WHERE r.email = $1 AND c.is_active = true
      ORDER BY c.ends_at ASC
    `, [student_email]);

    res.json(result.rows);
  } catch (err) {
    console.error('Error fetching student campaigns:', err);
    res.status(500).json({ error: 'Failed to fetch campaigns' });
  }
});


// --- STRIPE WEBHOOK ---

app.post('/api/stripe/webhook', express.raw({ type: 'application/json' }), async (req, res) => {
  const sig = req.headers['stripe-signature'];

  // const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
  let event;

  try {
    // event = stripe.webhooks.constructEvent(req.body, sig, process.env.STRIPE_WEBHOOK_SECRET);
    // MOCK EVENT for now
    event = req.body;
  } catch (err) {
    console.error('Webhook Error:', err.message);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  // Handle the event
  if (event.type === 'payment_intent.succeeded') {
    const paymentIntent = event.data.object;
    const { metadata, amount } = paymentIntent;

    if (metadata.opus_type === 'fundraising_donation') {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');

        // 1. Insert Donation
        await client.query(`
          INSERT INTO donations (
            campaign_id, student_id, participant_id, stripe_payment_intent_id,
            amount_cents, donor_name, donor_email, is_anonymous, message
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
          ON CONFLICT (stripe_payment_intent_id) DO NOTHING
        `, [
          metadata.campaign_id,
          metadata.student_id,
          metadata.participant_id,
          paymentIntent.id,
          amount,
          metadata.donor_name,
          metadata.donor_email,
          metadata.is_anonymous === 'true',
          metadata.message
        ]);

        // 2. Update Participant Total
        await client.query(`
          UPDATE campaign_participants
          SET total_raised_cents = total_raised_cents + $1,
              last_donation_at = CURRENT_TIMESTAMP
          WHERE id = $2
        `, [amount, metadata.participant_id]);

        await client.query('COMMIT');
        console.log(`✅ Donation processed for campaign ${metadata.campaign_id}`);
      } catch (err) {
        await client.query('ROLLBACK');
        console.error('Error processing donation webhook:', err);
        return res.status(500).send('Database error');
      } finally {
        client.release();
      }
    }
  }

  res.json({ received: true });
});

// ==================== DATABASE MIGRATION ====================
// One-time endpoint to create seating configuration tables
app.post('/api/migrate-seating-tables', async (req, res) => {
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
        student_id INTEGER REFERENCES roster(id) ON DELETE CASCADE,
        section_id INTEGER NOT NULL,
        row INTEGER NOT NULL,
        position_index INTEGER NOT NULL,
        UNIQUE(configuration_id, student_id)
      );
    `);

    await client.query('COMMIT');
    res.json({ success: true, message: 'Seating configuration tables created successfully' });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Error creating seating tables:', err);
    res.status(500).json({ error: err.message });
  } finally {
    client.release();
  }
});

// Migration endpoint for assignments tables
app.post('/api/migrate-assignments-tables', async (req, res) => {
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
    res.json({ success: true, message: 'Assignments tables created successfully' });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Error creating assignments tables:', err);
    res.status(500).json({ error: err.message });
  } finally {
    client.release();
  }
});

// Migration endpoint for ensemble_files table
app.post('/api/migrate-ensemble-files', async (req, res) => {
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS ensemble_files (
        id SERIAL PRIMARY KEY,
        ensemble_id INTEGER REFERENCES ensembles(id) ON DELETE CASCADE,
        title TEXT NOT NULL,
        file_type TEXT,
        storage_url TEXT NOT NULL,
        file_size INTEGER,
        uploaded_by INTEGER REFERENCES users(id),
        created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
      );
    `);

    res.json({ success: true, message: 'ensemble_files table created successfully' });
  } catch (err) {
    console.error('Migration error:', err);
    res.status(500).json({ error: err.message });
  }
});

// ==================== SEATING CONFIGURATIONS ====================

// Save new seating configuration
app.post('/api/seating-configurations', async (req, res) => {
  const {
    ensemble_id,
    name,
    description,
    global_rows,
    global_module_width,
    global_tread_depth,
    is_curved,
    created_by,
    sections,
    placements
  } = req.body;

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Validate created_by exists in users table if provided
    let validCreatedBy = null;
    if (created_by) {
      const userCheck = await client.query('SELECT id FROM users WHERE id = $1', [created_by]);
      if (userCheck.rows.length > 0) {
        validCreatedBy = created_by;
      } else {
        console.warn('Invalid created_by user ID:', created_by);
      }
    }

    // Insert configuration
    const configResult = await client.query(
      `INSERT INTO seating_configurations 
       (ensemble_id, name, description, global_rows, global_module_width, global_tread_depth, is_curved, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       RETURNING *`,
      [ensemble_id, name, description, global_rows, global_module_width, global_tread_depth, is_curved, validCreatedBy]
    );

    const configId = configResult.rows[0].id;

    // Insert sections
    if (sections && sections.length > 0) {
      for (const section of sections) {
        await client.query(
          `INSERT INTO seating_sections (configuration_id, section_id, section_name, ada_row)
           VALUES ($1, $2, $3, $4)`,
          [configId, section.section_id, section.section_name, section.ada_row]
        );
      }
    }

    // Insert placements
    if (placements && placements.length > 0) {
      for (const placement of placements) {
        await client.query(
          `INSERT INTO seating_placements (configuration_id, student_id, section_id, row, position_index)
           VALUES ($1, $2, $3, $4, $5)`,
          [configId, placement.student_id, placement.section_id, placement.row, placement.position_index]
        );
      }
    }

    await client.query('COMMIT');
    res.json({ success: true, configuration: configResult.rows[0] });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Error saving seating configuration:', err);
    console.error('Request body:', req.body);
    res.status(500).json({ error: 'Failed to save configuration', details: err.message });
  } finally {
    client.release();
  }
});

// Get all configurations for an ensemble
app.get('/api/seating-configurations', async (req, res) => {
  const { ensemble_id } = req.query;

  try {
    const result = await pool.query(
      `SELECT sc.*, u.first_name, u.last_name,
        (SELECT COUNT(*) FROM seating_placements WHERE configuration_id = sc.id) as student_count
       FROM seating_configurations sc
       LEFT JOIN users u ON sc.created_by = u.id
       WHERE sc.ensemble_id = $1
       ORDER BY sc.created_at DESC`,
      [ensemble_id]
    );

    res.json(result.rows);
  } catch (err) {
    console.error('Error fetching configurations:', err);
    res.status(500).json({ error: 'Failed to fetch configurations' });
  }
});

// Get specific configuration with all details
app.get('/api/seating-configurations/:id', async (req, res) => {
  const { id } = req.params;

  try {
    // Get configuration
    const configResult = await pool.query(
      'SELECT * FROM seating_configurations WHERE id = $1',
      [id]
    );

    if (configResult.rows.length === 0) {
      return res.status(404).json({ error: 'Configuration not found' });
    }

    const config = configResult.rows[0];

    // Get sections
    const sectionsResult = await pool.query(
      'SELECT * FROM seating_sections WHERE configuration_id = $1 ORDER BY section_id',
      [id]
    );

    // Get placements with student info
    const placementsResult = await pool.query(
      `SELECT sp.*, r.first_name, r.last_name, r.section, r.part
       FROM seating_placements sp
       JOIN roster r ON sp.student_id = r.id
       WHERE sp.configuration_id = $1
       ORDER BY sp.section_id, sp.row, sp.position_index`,
      [id]
    );

    res.json({
      ...config,
      sections: sectionsResult.rows,
      placements: placementsResult.rows
    });
  } catch (err) {
    console.error('Error fetching configuration:', err);
    res.status(500).json({ error: 'Failed to fetch configuration' });
  }
});

// Update configuration
app.put('/api/seating-configurations/:id', async (req, res) => {
  const { id } = req.params;
  const {
    name,
    description,
    global_rows,
    global_module_width,
    global_tread_depth,
    is_curved,
    sections,
    placements
  } = req.body;

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Update configuration
    await client.query(
      `UPDATE seating_configurations 
       SET name = $1, description = $2, global_rows = $3, global_module_width = $4,
           global_tread_depth = $5, is_curved = $6, updated_at = CURRENT_TIMESTAMP
       WHERE id = $7`,
      [name, description, global_rows, global_module_width, global_tread_depth, is_curved, id]
    );

    // Delete existing sections and placements
    await client.query('DELETE FROM seating_sections WHERE configuration_id = $1', [id]);
    await client.query('DELETE FROM seating_placements WHERE configuration_id = $1', [id]);

    // Insert new sections
    if (sections && sections.length > 0) {
      for (const section of sections) {
        await client.query(
          `INSERT INTO seating_sections (configuration_id, section_id, section_name, ada_row)
           VALUES ($1, $2, $3, $4)`,
          [id, section.section_id, section.section_name, section.ada_row]
        );
      }
    }

    // Insert new placements
    if (placements && placements.length > 0) {
      for (const placement of placements) {
        await client.query(
          `INSERT INTO seating_placements (configuration_id, student_id, section_id, row, position_index)
           VALUES ($1, $2, $3, $4, $5)`,
          [id, placement.student_id, placement.section_id, placement.row, placement.position_index]
        );
      }
    }

    await client.query('COMMIT');
    res.json({ success: true });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Error updating configuration:', err);
    res.status(500).json({ error: 'Failed to update configuration' });
  } finally {
    client.release();
  }
});

// Delete configuration
app.delete('/api/seating-configurations/:id', async (req, res) => {
  const { id } = req.params;

  try {
    await pool.query('DELETE FROM seating_configurations WHERE id = $1', [id]);
    res.json({ success: true });
  } catch (err) {
    console.error('Error deleting configuration:', err);
    res.status(500).json({ error: 'Failed to delete configuration' });
  }
});

// Register assignment routes
const registerAssignmentRoutes = require('./assignments-api');
registerAssignmentRoutes(app, pool);

// Register dashboard routes
const registerDashboardRoutes = require('./dashboard-api');
registerDashboardRoutes(app, pool);

// Start server
const PORT = process.env.PORT || 8080;
app.listen(PORT, () => {
  console.log(`Opus API listening on port ${PORT}`);
});
