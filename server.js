const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const { Resend } = require('resend');
const db = require('./database');

// Attempt to load .env in local development if present
try {
  if (fs.existsSync(path.join(__dirname, '.env'))) {
    const envContent = fs.readFileSync(path.join(__dirname, '.env'), 'utf8');
    envContent.split('\n').forEach(line => {
      const parts = line.trim().split('=');
      if (parts[0] && parts[1] && !process.env[parts[0]]) {
        process.env[parts[0]] = parts.slice(1).join('=');
      }
    });
  }
} catch (_) {}

const app = express();
const PORT = process.env.PORT || 3000;
const resendApiKey = process.env.RESEND_API_KEY;
const resend = resendApiKey ? new Resend(resendApiKey) : null;

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

// Serve static HTML/JS files from public and root directory
app.use(express.static(path.join(__dirname, 'public')));
app.use(express.static(__dirname));

// REST APIs

// 0. Authentication: Send OTP via Resend
app.post('/api/auth/send-otp', async (req, res) => {
  const { email, roll, name } = req.body;
  if (!email || !roll) {
    return res.status(400).json({ error: "Please provide student roll number and @thapar.edu email." });
  }

  const cleanEmail = email.trim().toLowerCase();
  const cleanRoll = roll.trim();
  const cleanName = (name || 'Student').trim();

  // Generate secure 6-digit numeric OTP
  const otp = Math.floor(100000 + Math.random() * 900000).toString();
  const expiresAt = Date.now() + (5 * 60 * 1000); // 5-minute validity

  // Store OTP record in SQLite
  db.saveOtp({ email: cleanEmail, roll: cleanRoll, otp, expiresAt });

  // Styled Crimson-Branded Email Template
  const emailHtml = `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="utf-8">
      <style>
        body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; background-color: #f8fafc; margin: 0; padding: 20px; }
        .card { max-width: 500px; margin: 20px auto; background: #ffffff; border-radius: 20px; border: 1px solid #e2e8f0; overflow: hidden; box-shadow: 0 10px 25px -5px rgba(0,0,0,0.06); }
        .header { background: #C8102E; padding: 26px; text-align: center; color: white; }
        .header h1 { margin: 0; font-size: 20px; font-weight: 800; letter-spacing: 0.5px; }
        .header p { margin: 6px 0 0 0; font-size: 12px; opacity: 0.9; }
        .content { padding: 32px 24px; text-align: center; }
        .greeting { font-size: 15px; color: #1e293b; margin-bottom: 8px; }
        .code-box { background: #fdf2f4; border: 2px dashed #C8102E; border-radius: 16px; padding: 18px 28px; margin: 22px auto; display: inline-block; }
        .code { font-family: 'Space Grotesk', monospace, sans-serif; font-size: 34px; font-weight: 800; color: #C8102E; letter-spacing: 8px; }
        .validity { font-size: 12px; color: #64748b; margin-top: 14px; font-weight: 500; }
        .warning { font-size: 11px; color: #94a3b8; margin-top: 24px; border-top: 1px solid #f1f5f9; padding-top: 16px; }
      </style>
    </head>
    <body>
      <div class="card">
        <div class="header">
          <h1>THAPAR INSTITUTE</h1>
          <p>Smart Library Seat Allocation Portal</p>
        </div>
        <div class="content">
          <p class="greeting">Hello <strong>${cleanName}</strong> (Roll: ${cleanRoll}),</p>
          <p style="font-size: 13px; color: #64748b; margin: 0;">Use the verification code below to log in to the student library portal:</p>
          
          <div class="code-box">
            <span class="code">${otp}</span>
          </div>
          
          <p class="validity">⏱️ Valid for <strong>5 minutes</strong>. Do not share this code.</p>
          <p class="warning">If you did not request this OTP, please disregard this email.</p>
        </div>
      </div>
    </body>
    </html>
  `;

  let sentTo = cleanEmail;
  let deliveryStatus = "sent";

  const activeKey = process.env.RESEND_API_KEY || (typeof resendApiKey !== 'undefined' ? resendApiKey : null);
  const activeResend = activeKey ? new Resend(activeKey) : null;

  if (activeResend) {
    try {
      // In Resend free sandbox, onboarding@resend.dev delivers directly to account owner (akshat9105@gmail.com)
      const targetRecipient = 'akshat9105@gmail.com';
      const dispatch = await activeResend.emails.send({
        from: 'Thapar Library <onboarding@resend.dev>',
        to: [targetRecipient],
        subject: `Thapar Library Verification Code: ${otp}`,
        html: `<div style="background:#fef2f2;border:1px solid #fca5a5;padding:12px 18px;border-radius:12px;margin-bottom:16px;font-family:-apple-system,BlinkMacSystemFont,sans-serif;font-size:13px;color:#991b1b;">
          <strong>Student Authentication Request:</strong> Roll <strong>${cleanRoll}</strong> (${cleanEmail}) is logging in.
        </div>` + emailHtml
      });

      console.log("[Resend Email Sent]:", dispatch);
      sentTo = targetRecipient;
    } catch (err) {
      console.error("Resend API Exception:", err.message);
    }
  } else {
    console.warn("No RESEND_API_KEY detected on serverless instance.");
  }

  // Also log into database emails & audit log so it shows in the student notifications tab
  db.sendMockEmail(
    cleanEmail,
    `Thapar Library Login Code: ${otp}`,
    `Dear ${cleanName},\n\nYour 6-digit student login verification code is ${otp}.\n\nValid for 5 minutes.\n\nRegards,\nThapar Library Management`
  );
  db.appendLog(`[AUTH OTP DISPATCH] Verification code dispatched for ${cleanEmail} (Roll: ${cleanRoll}).`, "event");

  res.json({
    success: true,
    sentTo: sentTo,
    message: `Verification code sent to ${sentTo}. Please check your inbox or spam folder.`
  });
});

// 0. Authentication: Verify OTP
app.post('/api/auth/verify-otp', (req, res) => {
  const { email, roll, otp, name } = req.body;
  if (!email || !roll || !otp) {
    return res.status(400).json({ error: "Missing verification parameters." });
  }

  const result = db.verifyOtp({ email: email.trim().toLowerCase(), roll: roll.trim(), otp: otp.trim() });
  if (!result.valid) {
    return res.status(400).json({ error: result.error });
  }

  db.appendLog(`[AUTH SUCCESS] Student login verified for ${name || roll} (${email}).`, "event");

  res.json({
    success: true,
    user: {
      type: "student",
      name: name ? name.trim() : "Student",
      email: email.trim().toLowerCase(),
      id: roll.trim()
    }
  });
});

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

if (require.main === module && !process.env.VERCEL) {
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
