import http from 'node:http';
import os from 'node:os';
import pg from 'pg';

const pool = new pg.Pool({
  host: process.env.DB_HOST || 'postgres',
  port: Number(process.env.DB_PORT || 5432),
  database: process.env.DB_NAME || 'app',
  user: process.env.DB_USER || 'app',
  password: process.env.DB_PASSWORD,
  max: 5,
  connectionTimeoutMillis: 3000,
});
pool.on('error', (err) => console.error('idle db client error:', err.message));

let dbReady = false;

async function initDb() {
  try {
    await pool.query('CREATE TABLE IF NOT EXISTS hits (id INT PRIMARY KEY, count BIGINT NOT NULL)');
    await pool.query('INSERT INTO hits (id, count) VALUES (1, 0) ON CONFLICT (id) DO NOTHING');
    dbReady = true;
    console.log('database ready');
  } catch (err) {
    console.error('database not ready yet:', err.message);
    setTimeout(initDb, 2000);
  }
}
initDb();

async function dbOk() {
  try {
    await pool.query('SELECT 1');
    return true;
  } catch {
    return false;
  }
}

// Demo endpoint for the HPA test: burns CPU in short slices so health probes still answer.
async function burn(seconds) {
  const end = Date.now() + seconds * 1000;
  while (Date.now() < end) {
    const slice = Date.now() + 50;
    while (Date.now() < slice) Math.sqrt(Math.random());
    await new Promise((resolve) => setImmediate(resolve));
  }
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  const send = (code, body) => {
    res.writeHead(code, { 'content-type': 'application/json' });
    res.end(JSON.stringify(body));
  };
  try {
    if (url.pathname === '/healthz') return send(200, { status: 'ok' });
    if (url.pathname === '/readyz') {
      return (dbReady && (await dbOk())) ? send(200, { status: 'ready' }) : send(503, { status: 'database unavailable' });
    }
    if (url.pathname === '/api/hits') {
      const r = await pool.query('UPDATE hits SET count = count + 1 WHERE id = 1 RETURNING count');
      return send(200, { hits: Number(r.rows[0].count), pod: os.hostname() });
    }
    if (url.pathname === '/api/burn') {
      const seconds = Math.min(Number(url.searchParams.get('seconds') || 10), 30);
      burn(seconds);
      return send(200, { burning_seconds: seconds, pod: os.hostname() });
    }
    return send(404, { error: 'not found' });
  } catch (err) {
    console.error('request failed:', err.message);
    return send(500, { error: 'internal error' });
  }
});

server.listen(8080, () => console.log('api listening on 8080'));

process.on('SIGTERM', () => {
  console.log('SIGTERM received, shutting down');
  server.close(() => pool.end().then(() => process.exit(0)));
});
