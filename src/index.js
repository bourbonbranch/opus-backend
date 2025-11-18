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

const port = process.env.PORT || 3000;
app.listen(port, () => {
  console.log(`Opus API listening on port ${port}`);
});
