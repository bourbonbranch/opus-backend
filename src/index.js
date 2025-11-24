const express = require('express');
const cors = require('cors');
require('dotenv').config();

const bcrypt = require('bcryptjs');
const { pool } = require('./db');

const app = express();

// ✅ BODY PARSER MUST COME FIRST (before CORS and routes)
app.use(express.json());

// CORS - TEMP while validating multiple Vercel preview URLs
app.use(cors({ origin: true, credentials: true }));

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
app.get('/ensembles', async (req, res) => {
  try {
    const directorId = req.query.director_id;
    if (!directorId) {
      return res.status(400).json({ error: 'director_id is required' });
    }

    const result = await pool.query(
      'SELECT * FROM ensembles WHERE director_id = $1 ORDER BY created_at DESC',
      [directorId]
    );
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
      `SELECT e.*, r.name as room_name
       FROM events e
       LEFT JOIN rooms r ON e.room_id = r.id
       WHERE e.ensemble_id = $1
       ORDER BY e.start_time ASC`,
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

  if (!ensemble_id || !name || !type || !start_time || !end_time) {
    return res.status(400).json({ error: 'Missing required fields' });
  }

  try {
    const result = await pool.query(
      `INSERT INTO events (ensemble_id, room_id, name, type, start_time, end_time, description)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING *`,
      [ensemble_id, room_id || null, name, type, start_time, end_time, description || null]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error('Error creating event:', err);
    res.status(500).json({ error: 'Failed to create event' });
  }
});

// Update an event
app.put('/events/:id', async (req, res) => {
  const { id } = req.params;
  const { room_id, name, type, start_time, end_time, description } = req.body;

  try {
    const result = await pool.query(
      `UPDATE events
       SET room_id = $1, name = $2, type = $3, start_time = $4, end_time = $5, description = $6
       WHERE id = $7
       RETURNING *`,
      [room_id || null, name, type, start_time, end_time, description || null, id]
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
    const result = await pool.query('DELETE FROM events WHERE id = $1 RETURNING id', [id]);

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
    const countResult = await pool.query(query.replace('SELECT p.*,', 'SELECT COUNT(*)'), params);
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
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)
          RETURNING *
        `, [
          director_id,
          first_name.substring(0, 100), // Limit to 100 chars
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
      } catch (err) {
        console.error(`Error importing prospect ${first_name} ${last_name}:`, err.message);
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


// Start server
const PORT = process.env.PORT || 8080;
app.listen(PORT, () => {
  console.log(`Opus API listening on port ${PORT}`);
});
