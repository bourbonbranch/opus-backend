const express = require('express');
const cors = require('cors');
require('dotenv').config();

const { pool } = require('./db');

const app = express();
app.use(cors());
app.use(express.json());

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
// Get all ensembles
app.get('/ensembles', async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT id, name, type, organization_name, created_at FROM ensembles ORDER BY id'
    );
    res.json(result.rows);
  } catch (err) {
    console.error('Error fetching ensembles:', err.message);
    res.status(500).json({ error: 'Failed to fetch ensembles' });
  }
});

// Create a new ensemble
app.post('/ensembles', async (req, res) => {
  const { name, type, organization_name } = req.body;

  if (!name || !type) {
    return res.status(400).json({ error: 'name and type are required' });
  }

  try {
    const result = await pool.query(
      `INSERT INTO ensembles (name, type, organization_name)
       VALUES ($1, $2, $3)
       RETURNING id, name, type, organization_name, created_at`,
      [name, type, organization_name || null]
    );

    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error('Error creating ensemble:', err.message);
    res.status(500).json({ error: 'Failed to create ensemble' });
  }
});

const port = process.env.PORT || 3000;
app.listen(port, () => {
  console.log(`Opus API listening on port ${port}`);
});
