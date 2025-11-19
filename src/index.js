const express = require('express');
const cors = require('cors');
require('dotenv').config();

const bcrypt = require('bcryptjs');
const { pool } = require('./db');

const app = express();

// CORS
const allowedOrigin = process.env.FRONTEND_URL || '*';
app.use(cors({
  origin: allowedOrigin,
  credentials: true
}));
app.use(express.json());

// Root
app.get('/', (req, res) => {
  res.json({ ok: true, name: 'Opus API' });
});

// Health
app.get('/health', async (req, res) => {
  try {
    const result = await pool.query('SELECT NOW() AS now');
    res.json({ ok: true, db: 'connected', time: result.rows[0].now });
  } catch (err) {
    console.error('Health check DB error:', err);
    res.status(500).json({ ok: false, db: 'disconnected', error: err.message });
  }
});

// Get ensembles (optional directorId)
app.get('/ensembles', async (req, res) => {
  const { directorId } = req.query;
  try {
    const sql = `
      SELECT id, name, type, organization_name, created_at, director_id
      FROM ensembles
      ${directorId ? 'WHERE director_id = $1' : ''}
      ORDER BY id
    `;
    const params = directorId ? [directorId] : [];
    const result = await pool.query(sql, params);
    res.json(result.rows);
  } catch (err) {
    console.error('Error fetching ensembles:', err);
    res.status(500).json({ error: 'Failed to fetch ensembles' });
  }
});

// Create ensemble
app.post('/ensembles', async (req, res) => {
  const { name, type, organization_name, director_id } = req.body;
  if (!name || !type || !director_id) {
    return res.status(400).json({ error: 'name, type, and director_id are required' });
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
    console.error('Error creating ensemble:', err);
    res.status(500).json({ error: 'Failed to create ensemble' });
  }
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
    res.status(500).json({ error: err.message || 'Internal server error' });
  }
});

// Duplicate legacy endpoint kept for compatibility
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
    console.error('Error creating director:', err);
    if (err.code === '23505') return res.status(409).json({ error: 'Email already in use' });
    res.status(500).json({ error: 'Failed to create director' });
  }
});

// 404
app.use((req, res) => {
  res.status(404).json({ error: 'Endpoint not found' });
});

// Start
const PORT = process.env.PORT || 3000;
app.listen(PORT, '0.0.0.0', () => {
  console.log(`Opus API listening on port ${PORT}`);
});
