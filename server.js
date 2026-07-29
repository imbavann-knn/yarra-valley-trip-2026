// YOUR HEAD — Yarra Valley Trip
// Static site + shared expense API, backed by Railway Postgres.
const express = require('express');
const path = require('path');
const { Pool } = require('pg');

const app = express();
app.use(express.json({ limit: '1mb' }));

// Railway's internal DATABASE_URL (postgres.railway.internal) needs no SSL.
// Set PGSSL=require if ever connecting over the public proxy.
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.PGSSL === 'require' ? { rejectUnauthorized: false } : false,
});

async function initDb() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS expenses (
      id         TEXT PRIMARY KEY,
      data       JSONB NOT NULL,
      created_at TIMESTAMPTZ DEFAULT now()
    );
    CREATE TABLE IF NOT EXISTS settings (
      key   TEXT PRIMARY KEY,
      value TEXT
    );
  `);
}

// ── API ──────────────────────────────────────────────
// Full shared state: newest expense first (matches the UI's unshift order).
app.get('/api/state', async (_req, res) => {
  try {
    const exp = await pool.query('SELECT data FROM expenses ORDER BY created_at DESC');
    const r = await pool.query("SELECT value FROM settings WHERE key = 'rate'");
    res.json({
      expenses: exp.rows.map(row => row.data),
      rate: r.rows[0] ? parseFloat(r.rows[0].value) : 0.87,
    });
  } catch (e) {
    console.error('GET /api/state', e);
    res.status(500).json({ error: 'db_error' });
  }
});

// Upsert a single expense. created_at is preserved on edit so order is stable.
app.post('/api/expenses', async (req, res) => {
  const exp = req.body;
  if (!exp || !exp.id) return res.status(400).json({ error: 'missing_id' });
  try {
    await pool.query(
      `INSERT INTO expenses (id, data) VALUES ($1, $2)
       ON CONFLICT (id) DO UPDATE SET data = $2`,
      [exp.id, JSON.stringify(exp)]
    );
    res.json({ ok: true });
  } catch (e) {
    console.error('POST /api/expenses', e);
    res.status(500).json({ error: 'db_error' });
  }
});

app.delete('/api/expenses/:id', async (req, res) => {
  try {
    await pool.query('DELETE FROM expenses WHERE id = $1', [req.params.id]);
    res.json({ ok: true });
  } catch (e) {
    console.error('DELETE /api/expenses', e);
    res.status(500).json({ error: 'db_error' });
  }
});

app.put('/api/rate', async (req, res) => {
  const rate = parseFloat(req.body && req.body.rate);
  if (!isFinite(rate)) return res.status(400).json({ error: 'bad_rate' });
  try {
    await pool.query(
      `INSERT INTO settings (key, value) VALUES ('rate', $1)
       ON CONFLICT (key) DO UPDATE SET value = $1`,
      [String(rate)]
    );
    res.json({ ok: true });
  } catch (e) {
    console.error('PUT /api/rate', e);
    res.status(500).json({ error: 'db_error' });
  }
});

// ── Static site ──────────────────────────────────────
app.use(express.static(__dirname));

const PORT = process.env.PORT || 3000;
initDb()
  .then(() => app.listen(PORT, () => console.log(`Listening on ${PORT}`)))
  .catch(e => { console.error('DB init failed', e); process.exit(1); });
