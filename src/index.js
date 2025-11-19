const express = require('express');
const cors = require('cors');
require('dotenv').config();

const bcrypt = require('bcryptjs');
const { pool } = require('./db');

const app = express();
app.use(cors());
app.use(express.json());

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
      `
      INSERT INTO users (first_name, last_name, email, password_hash, role)
      VALUES ($1, $2, $3, $4, $5)
      RETURNING id, first_name, last_name, email, role, created_at
      `,
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
   START SERVER
-------------------------------------------- */
const port = process.env.PORT || 3000;
app.listen(port, () => {
  console.log(`Opus API listening on port ${port}`);
});

