const express = require('express');
const cors = require('cors');
require('dotenv').config();

const bcrypt = require('bcryptjs');
const { pool } = require('./db');

const app = express();

// CORS configuration for Vercel frontend
app.use(cors({
  origin: process.env.FRONTEND_URL || '*',
  credentials: true
}));

app.use(express.json());

/* -------------------------------------------
   ROOT ENDPOINT
-------------------------------------------- */
app.get('/', (req, res) => {
  res.json({
    message: 'Opus Backend API',
    status: 'running',
    endpoints: ['/health', '/ensembles', '/auth/signup-director']
  });
});

/* -------------------------------------------
   HEALTH CHECK
-------------------------------------------- */
app.get('/health', async (req, res) => {
  try {
    const result = await pool.query('SELECT NOW() AS now');
    res.json({
      ok: true,
      db: 'connected',
      time: result.rows[0].now,
    });
  } catch (err) {
    console.error('Health check DB error:', err.message);
    res.status(500).json({
      ok: false,
      db: 'disconnected',
      error: err.message,
    });
  }
});

/* -------------------------------------------
   GET ENSEMBLES (optionally by director)
-------------------------------------------- */
app.get('/ensembles', async (req, res) => {
  const { directorId } = req.query;

  try {
    let result;

    if (directorId) {
      result = await pool.query(
        `SELECT id, name, type, organization_name, created_at, director_id
         FROM ensembles
         WHERE director_id = $1
         ORDER BY id`,
        [directorId]
      );
    } else {
      result = await pool.query(
        `SELECT id, name, type, organization_name, created_at, director_id
         FROM ensembles
         ORDER BY id`
      );
    }

    res.json(result.rows);
  } catch (err) {
    console.error('Error fetching ensembles:', err.message);
    res.status(500).json({ error: 'Failed to fetch ensembles' });
  }
});

/* -------------------------------------------
   CREATE ENSEMBLE
-------------------------------------------- */
app.post('/ensembles', async (req, res) => {
  const { name, type, organization_name, director_id } = req.body;

  if (!name || !type || !director_id) {
    return res.status(400).json({
      error: 'name, type, and director_id are required',
    });
  }

  try {
    const result = await pool.query(
      `INSERT INTO ensembles (name, type, organization_name, director_id)
       VALUES ($1, $2, $3, $4)
       RETURNING id, name, type, organization_name, director_id, created_at`,
      [name, type, organization_name || null, director_id]
    );

    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error('Error creating ensemble:', err.message);
    res.status(500).json({ error: 'Failed to create ensemble' });
  }
});

/* -------------------------------------------
   DIRECTOR SIGNUP
-------------------------------------------- */
app.post('/auth/signup-director', async (req, res) => {
  try {
    const { firstName, lastName, email, password, role } = req.body;

    if (!firstName || !lastName || !email || !password) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    const finalRole = role || 'director';

    // Check if email already exists
    const existing = await pool.query(
      'SELECT id FROM users WHERE email = $1',
      [email]
    );

    if (existing.rows.length > 0) {
      return res.status(400).json({ error: 'Email already in use' });
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
    res.status(500).json({
      error: err.message || 'Internal server error',
    });
  }
});

/* -------------------------------------------
   CREATE A NEW DIRECTOR (SIGNUP) - DUPLICATE ENDPOINT
   NOTE: This is redundant with /auth/signup-director
-------------------------------------------- */
app.post('/directors/signup', async (req, res) => {
  const { firstName, lastName, email, password, role } = req.body;

  if (!firstName || !lastName || !email || !password) {
    return res.status(400).json({ error: 'Missing required fields' });
  }

  try {
    const hashed = await bcrypt.hash(password, 10);

    const result = await pool.query(
      `INSERT INTO users (first_name, last_name, email, password_hash, role)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id, first_name, last_name, email, role, created_at`,
      [firstName, lastName, email, hashed, role || 'director']
    );

    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error('Error creating director:', err.message);
    if (err.code === '23505') {
      return res.status(409).json({ error: 'Email already in use' });
    }
    res.status(500).json({ error: 'Failed to create director' });
  }
});

/* -------------------------------------------
   404 HANDLER
-------------------------------------------- */
app.use((req, res) => {
  res.status(404).json({ error: 'Endpoint not found' });
});

/* -------------------------------------------
   START SERVER
-------------------------------------------- */
const PORT = process.env.PORT || 3000;
app.listen(PORT, '0.0.0.0', () => {
  console.log(`🚀 Opus API listening on port ${PORT}`);
  console.log(`📍 Environment: ${process.env.NODE_ENV || 'development'}`);
});
