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

// Start server
const PORT = process.env.PORT || 8080;
app.listen(PORT, () => {
  console.log(`Opus API listening on port ${PORT}`);
});
