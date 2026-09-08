const express = require('express');
const cors = require('cors');
const path = require('path');
const db = require('./database');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());

// Health check routes for cloud platforms, Docker, and uptime monitors
app.get(['/health', '/api/health'], (req, res) => {
  res.status(200).json({
    status: 'ok',
    uptime: Math.floor(process.uptime()),
    database: 'SQLite WAL (Relational)',
    timestamp: new Date().toISOString()
  });
});

// Security Middleware: Protect internal server files and database from direct static exposure
app.use((req, res, next) => {
  const blockedPaths = [
    '/server.js',
    '/database.js',
    '/package.json',
    '/package-lock.json',
    '/dockerfile',
    '/.dockerignore',
    '/docker-compose.yml',
    '/db.json',
    '/library.db',
    '/library.db-wal',
    '/library.db-shm',
    '/library-portal.tar'
  ];
  const reqPath = req.path.toLowerCase();
  if (
    blockedPaths.includes(reqPath) ||
    reqPath.startsWith('/.env') ||
    reqPath.startsWith('/.git') ||
    reqPath.endsWith('.db') ||
    reqPath.endsWith('.tar') ||
    reqPath.endsWith('.tar.gz')
  ) {
    return res.status(403).json({ error: 'Access forbidden' });
  }
  next();
});

// Serve static HTML/JS files from the root directory
app.use(express.static(__dirname));

// REST APIs

// 1. GET /api/state: Get complete system snapshot
app.get('/api/state', (req, res) => {
  try {
    db.checkTimeouts();
  } catch (_) {}
  res.json(db.readState());
});

// 2. POST /api/reserve: Pre-reserve a seat (3-minute lock)
app.post('/api/reserve', (req, res) => {
  const { studentId, studentName, zoneKey, duration, seatId } = req.body;
  if (!studentId || !studentName || !zoneKey || !duration) {
    return res.status(400).json({ error: "Missing parameters" });
  }

  const result = db.reserveSeat({
    studentId,
    studentName,
    zoneKey,
    duration,
    seatId,
    demoSpeed: db.getDemoSpeed()
  });

  if (result.error) {
    return res.status(400).json({ error: result.error });
  }

  res.json(result);
});

// 3. POST /api/check-in: Legacy check-in (kept for compatibility)
app.post('/api/check-in', (req, res) => {
  const { bookingId, seatId, isReturning } = req.body;
  if (!bookingId || !seatId) {
    return res.status(400).json({ error: "Missing parameters" });
  }

  const result = db.checkIn({ bookingId, seatId, isReturning });
  if (result.error) {
    return res.status(result.statusCode || 400).json({ error: result.error });
  }

  res.json(result);
});

// 4. POST /api/checkout: Check-out occupied seat
app.post('/api/checkout', (req, res) => {
  const { bookingId, statusType } = req.body;
  if (!bookingId) {
    return res.status(400).json({ error: "Missing booking ID" });
  }

  const result = db.checkout({ bookingId, statusType });
  if (result.error) {
    return res.status(result.statusCode || 400).json({ error: result.error });
  }

  res.json(result);
});

// 5. POST /api/request-break: Student goes on break
app.post('/api/request-break', (req, res) => {
  const { bookingId, duration } = req.body;
  if (!bookingId || !duration) {
    return res.status(400).json({ error: "Missing parameters" });
  }

  const result = db.requestBreak({ bookingId, duration, demoSpeed: db.getDemoSpeed() });
  if (result.error) {
    return res.status(result.statusCode || 400).json({ error: result.error });
  }

  res.json(result);
});

// 6. POST /api/override/entry: Librarian guest entry override
app.post('/api/override/entry', (req, res) => {
  const { zoneKey } = req.body;
  if (!zoneKey) {
    return res.status(400).json({ error: "Missing zone location" });
  }

  const result = db.overrideEntry({ zoneKey });
  if (result.error) {
    return res.status(result.statusCode || 400).json({ error: result.error });
  }

  res.json(result);
});

// 7. POST /api/override/exit: Librarian manual clearance
app.post('/api/override/exit', (req, res) => {
  const { zoneKey } = req.body;
  if (!zoneKey) {
    return res.status(400).json({ error: "Missing zone location" });
  }

  const result = db.overrideExit({ zoneKey });
  if (result.error) {
    return res.status(result.statusCode || 400).json({ error: result.error });
  }

  res.json(result);
});

// 8. POST /api/reconcile-exit: Gate turnstile card exit sync simulator
app.post('/api/reconcile-exit', (req, res) => {
  res.json(db.reconcileExit());
});

// 9. POST /api/demo-speed: Sync demo speed setting
app.post('/api/demo-speed', (req, res) => {
  const { demoSpeed } = req.body;
  db.setDemoSpeed(!!demoSpeed);
  res.json({ success: true, demoSpeed: db.getDemoSpeed() });
});

// 10. POST /api/logs/clear: Wipe log entries
app.post('/api/logs/clear', (req, res) => {
  db.clearLogs();
  res.json({ success: true });
});

// 11. POST /api/override/clear-seat: Librarian detailed seat popup override
app.post('/api/override/clear-seat', (req, res) => {
  const { zoneKey, seatId, bookingId } = req.body;
  res.json(db.clearSeat({ zoneKey, seatId, bookingId }));
});

// 12. POST /api/gate/tap: Process ID card swipe at entry/re-entry/exit gate
app.post('/api/gate/tap', (req, res) => {
  const { studentId } = req.body;
  if (!studentId) {
    return res.status(400).json({ error: "Missing student ID/roll number" });
  }

  const result = db.gateTap({ studentId });
  if (result.error) {
    return res.status(result.statusCode || 400).json({ error: result.error });
  }

  res.json(result);
});

// 13. POST /api/reports/create: Students flag booking mismatch (ghost report)
app.post('/api/reports/create', (req, res) => {
  const { seatId, zoneKey, reporterRoll } = req.body;
  if (!seatId || !zoneKey || !reporterRoll) {
    return res.status(400).json({ error: "Missing parameters" });
  }

  const result = db.createReport({ seatId, zoneKey, reporterRoll });
  if (result.error) {
    return res.status(result.statusCode || 400).json({ error: result.error });
  }

  res.json(result);
});

// 14. POST /api/reports/resolve: Librarian resolves reported ghost seat
app.post('/api/reports/resolve', (req, res) => {
  const { reportId, action } = req.body;
  if (!reportId || !action) {
    return res.status(400).json({ error: "Missing parameters" });
  }

  const result = db.resolveReport({ reportId, action });
  if (result.error) {
    return res.status(result.statusCode || 400).json({ error: result.error });
  }

  res.json(result);
});

// Background Worker: Checks timeouts and releases expired seats every 1000ms
setInterval(() => {
  try {
    db.checkTimeouts();
  } catch (err) {
    console.error("Timeout check worker error:", err);
  }
}, 1000);

if (!process.env.VERCEL) {
  const server = app.listen(PORT, '0.0.0.0', () => {
    console.log(`Smart Library Portal running at http://0.0.0.0:${PORT} (SQL Engine: SQLite WAL)`);
  });

  // Graceful shutdown
  function handleShutdown(signal) {
    console.log(`${signal} received: closing HTTP server...`);
    server.close(() => {
      console.log('HTTP server closed cleanly.');
      process.exit(0);
    });
  }
  process.on('SIGTERM', () => handleShutdown('SIGTERM'));
  process.on('SIGINT', () => handleShutdown('SIGINT'));
}

module.exports = app;
