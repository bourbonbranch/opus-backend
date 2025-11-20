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
      `SELECT id, ensemble_id, first_name, last_name, email, phone, status, external_id, created_at
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

// Add a single roster member
app.post('/roster', async (req, res) => {
  const {
    ensemble_id,
    first_name,
    last_name,
    email,
    phone,
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
        (ensemble_id, first_name, last_name, email, phone, status, external_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING id, ensemble_id, first_name, last_name, email, phone, status, external_id, created_at`,
      [ensemble_id, first_name, last_name, email || null, phone || null, status, external_id]
    );

    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error('Error inserting roster member:', err);
    res.status(500).json({ error: 'Failed to add roster member' });
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

// Start server
const PORT = process.env.PORT || 8080;
app.listen(PORT, () => {
  console.log(`Opus API listening on port ${PORT}`);
});
