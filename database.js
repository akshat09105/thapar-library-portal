const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

// Configurable DB location: defaults to /tmp on Vercel (due to read-only filesystem) or local library.db
const isVercel = Boolean(process.env.VERCEL);
const defaultDbPath = isVercel
  ? path.join('/tmp', 'library.db')
  : path.join(__dirname, 'library.db');

const DB_FILE = process.env.DB_PATH 
  ? path.resolve(process.env.DB_PATH) 
  : defaultDbPath;

// Ensure storage directory exists
const dbDir = path.dirname(DB_FILE);
if (!fs.existsSync(dbDir)) {
  fs.mkdirSync(dbDir, { recursive: true });
}

// On Vercel, copy initial bundled database to writable /tmp if it doesn't exist yet
if (isVercel && !fs.existsSync(DB_FILE)) {
  const bundled = path.join(__dirname, 'library.db');
  if (fs.existsSync(bundled)) {
    try {
      fs.copyFileSync(bundled, DB_FILE);
    } catch (_) {}
  }
}

// Initialize SQLite database instance
const db = new Database(DB_FILE);

// Production SQLite Pragmas for High Concurrency & Speed
db.pragma('journal_mode = WAL');       // Write-Ahead Logging for non-blocking concurrent reads & writes
db.pragma('foreign_keys = ON');         // Enforce relational integrity
db.pragma('synchronous = NORMAL');      // Faster durable writes

const FLOORS = [
  { id: "ground", label: "Ground Floor", zones: [
    { name: "Main / Central Lobby", capacity: 60 },
    { name: "Digispace (PC Labs)", capacity: 80 },
  ]},
  { id: "first", label: "1st Floor", zones: [
    { name: "First Floor Reading Deck", capacity: 80 },
    { name: "Collaborative Study Lab", capacity: 40 },
  ]},
  { id: "second", label: "2nd Floor", zones: [
    { name: "Graduate Study Area", capacity: 50 },
    { name: "Group Discussion Rooms", capacity: 20 },
  ]},
  { id: "third", label: "3rd Floor", zones: [
    { name: "Central Books Collection", capacity: 60 },
    { name: "Quiet Alcove", capacity: 30 },
  ]}
];

const MOCK_NAMES = [
  "Rohan Sharma", "Sneha Gupta", "Harpreet Singh", "Karan Malhotra", 
  "Divya Joshi", "Aditya Verma", "Ishaan Roy", "Pooja Malhotra", 
  "Riya Sen", "Amit Patel", "Shreya Iyer", "Nikhil Kapoor"
];

function getSeatCode(sId) {
  const rowIdx = Math.floor((sId - 1) / 20);
  const rowLetter = String.fromCharCode(65 + rowIdx);
  const seatNum = ((sId - 1) % 20) + 1;
  return `${rowLetter}${String(seatNum).padStart(2, '0')}`;
}

// 1. Initialize Relational Schema with Indexes
function initSchema() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT
    );

    CREATE TABLE IF NOT EXISTS seats (
      id TEXT NOT NULL,
      zone_key TEXT NOT NULL,
      floor_id TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'free', -- 'free', 'pending', 'occupied', 'grace'
      booking_id TEXT,
      PRIMARY KEY (zone_key, id)
    );

    CREATE INDEX IF NOT EXISTS idx_seats_zone ON seats(zone_key);
    CREATE INDEX IF NOT EXISTS idx_seats_status ON seats(status);

    CREATE TABLE IF NOT EXISTS bookings (
      id TEXT PRIMARY KEY,
      student_id TEXT NOT NULL,
      student_name TEXT NOT NULL,
      zone_key TEXT NOT NULL,
      seat_id TEXT NOT NULL,
      duration INTEGER NOT NULL,
      status TEXT NOT NULL, -- 'pending_claim', 'occupied', 'grace', 'released', 'cancelled'
      created_at INTEGER NOT NULL,
      expire_at INTEGER,
      time_left INTEGER,
      grace_start INTEGER,
      grace_duration INTEGER
    );

    CREATE INDEX IF NOT EXISTS idx_bookings_student ON bookings(student_id, status);
    CREATE INDEX IF NOT EXISTS idx_bookings_status ON bookings(status);
    CREATE INDEX IF NOT EXISTS idx_bookings_seat ON bookings(zone_key, seat_id);

    CREATE TABLE IF NOT EXISTS reports (
      id TEXT PRIMARY KEY,
      seat_id TEXT NOT NULL,
      zone_key TEXT NOT NULL,
      reporter_roll TEXT NOT NULL,
      booking_id TEXT NOT NULL,
      booker_name TEXT NOT NULL,
      booker_roll TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending' -- 'pending', 'dismissed', 'force_released'
    );

    CREATE INDEX IF NOT EXISTS idx_reports_status ON reports(status);

    CREATE TABLE IF NOT EXISTS audit_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      time TEXT NOT NULL,
      msg TEXT NOT NULL,
      type TEXT NOT NULL DEFAULT 'event',
      created_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS emails (
      id TEXT PRIMARY KEY,
      to_addr TEXT NOT NULL,
      subject TEXT NOT NULL,
      body TEXT NOT NULL,
      time TEXT NOT NULL,
      timestamp INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS otps (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      email TEXT NOT NULL,
      roll TEXT NOT NULL,
      otp TEXT NOT NULL,
      expires_at INTEGER NOT NULL,
      created_at INTEGER NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_otps_lookup ON otps(email, otp);
  `);

  // Seed default demo_speed if not set
  const speedRow = db.prepare('SELECT value FROM settings WHERE key = ?').get('demo_speed');
  if (!speedRow) {
    db.prepare('INSERT INTO settings (key, value) VALUES (?, ?)').run('demo_speed', '0');
  }

  // Seed seats if table is empty
  const seatCount = db.prepare('SELECT COUNT(*) as count FROM seats').get().count;
  if (seatCount === 0) {
    seedDatabase();
  }
}

// 2. Database Seeder
function seedDatabase() {
  const seedTx = db.transaction(() => {
    const insertSeat = db.prepare(`
      INSERT INTO seats (id, zone_key, floor_id, status, booking_id)
      VALUES (?, ?, ?, ?, ?)
    `);

    const insertBooking = db.prepare(`
      INSERT INTO bookings (id, student_id, student_name, zone_key, seat_id, duration, status, created_at, expire_at, time_left, grace_start, grace_duration)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    FLOORS.forEach(floor => {
      floor.zones.forEach(zone => {
        const zoneKey = `${floor.id}::${zone.name}`;
        for (let sId = 1; sId <= zone.capacity; sId++) {
          const seatCode = getSeatCode(sId);
          const isInitiallyOccupied = Math.random() < 0.65;
          let bId = null;

          if (isInitiallyOccupied) {
            const randIndex = Math.floor(Math.random() * MOCK_NAMES.length);
            const randRoll = String(Math.floor(102103000 + Math.random() * 9000));
            bId = `bk-seed-${Math.floor(10000 + Math.random() * 90000)}`;

            insertBooking.run(
              bId,
              randRoll,
              MOCK_NAMES[randIndex],
              zoneKey,
              seatCode,
              2,
              'occupied',
              Date.now(),
              null,
              null,
              null,
              null
            );
          }

          insertSeat.run(
            seatCode,
            zoneKey,
            floor.id,
            isInitiallyOccupied ? 'occupied' : 'free',
            bId
          );
        }
      });
    });

    const now = Date.now();
    const time = new Date(now).toLocaleTimeString();
    db.prepare('INSERT INTO audit_logs (time, msg, type, created_at) VALUES (?, ?, ?, ?)').run(
      time,
      'Relational SQL Database seeded successfully with seat layout and student profiles.',
      'system',
      now
    );
  });

  seedTx();
}

// Helper: Append audit log entry
function appendLog(msg, type = "event") {
  const now = Date.now();
  const time = new Date(now).toLocaleTimeString();
  db.prepare('INSERT INTO audit_logs (time, msg, type, created_at) VALUES (?, ?, ?, ?)').run(time, msg, type, now);
  
  // Prune logs if exceeding 500 rows to maintain optimal memory and query speed
  db.prepare(`
    DELETE FROM audit_logs 
    WHERE id NOT IN (SELECT id FROM audit_logs ORDER BY id DESC LIMIT 500)
  `).run();
}

// Helper: Send simulated email notification
function sendMockEmail(to, subject, body) {
  const now = Date.now();
  const newEmail = {
    id: `em-${Math.floor(10000 + Math.random() * 90000)}`,
    to_addr: to,
    subject,
    body,
    time: new Date(now).toLocaleTimeString(),
    timestamp: now
  };
  db.prepare(`
    INSERT INTO emails (id, to_addr, subject, body, time, timestamp)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(newEmail.id, newEmail.to_addr, newEmail.subject, newEmail.body, newEmail.time, newEmail.timestamp);

  console.log(`[MOCK EMAIL SENT] To: ${to} | Subject: ${subject}`);
  return newEmail;
}

// 3. Get Complete State Snapshot (Formatted for Terminals)
function readState() {
  try {
    checkTimeouts();
  } catch (e) {
    console.error("Timeout evaluation error in readState:", e);
  }

  const seatsRows = db.prepare('SELECT id, zone_key, floor_id, status, booking_id FROM seats ORDER BY zone_key, id').all();
  const seats = {};
  for (const row of seatsRows) {
    if (!seats[row.zone_key]) {
      seats[row.zone_key] = [];
    }
    seats[row.zone_key].push({
      id: row.id,
      status: row.status,
      bookingId: row.booking_id
    });
  }

  const bookings = db.prepare(`
    SELECT 
      id, student_name as studentName, student_id as studentId, 
      zone_key as zoneKey, seat_id as seatId, duration, status, 
      created_at as createdAt, expire_at as expireAt, time_left as timeLeft, 
      grace_start as graceStart, grace_duration as graceDuration 
    FROM bookings 
    ORDER BY created_at DESC
  `).all();

  const logs = db.prepare('SELECT time, msg, type FROM audit_logs ORDER BY id DESC LIMIT 150').all();

  const reports = db.prepare(`
    SELECT 
      id, seat_id as seatId, zone_key as zoneKey, reporter_roll as reporterRoll, 
      booking_id as bookingId, booker_name as bookerName, booker_roll as bookerRoll, 
      created_at as createdAt, status 
    FROM reports 
    ORDER BY created_at DESC
  `).all();

  const emails = db.prepare(`
    SELECT 
      id, to_addr as "to", subject, body, time, timestamp 
    FROM emails 
    ORDER BY timestamp DESC LIMIT 50
  `).all();

  const demoSpeedRow = db.prepare('SELECT value FROM settings WHERE key = ?').get('demo_speed');
  const demoSpeed = demoSpeedRow ? demoSpeedRow.value === '1' : false;

  return {
    seats,
    bookings,
    logs,
    reports,
    emails,
    demoSpeed,
    serverTime: Date.now()
  };
}

// 4. ATOMIC TRANSACTION: Reserve Seat (3-minute lock)
const reserveSeatTx = db.transaction(({ studentId, studentName, zoneKey, duration, seatId, demoSpeed }) => {
  // Check active booking limit: max 1 per roll number
  const active = db.prepare(`
    SELECT id FROM bookings 
    WHERE student_id = ? AND status IN ('pending_claim', 'occupied', 'grace')
    LIMIT 1
  `).get(studentId);

  if (active) {
    return { error: "You already hold an active seat reservation or desk check-in." };
  }

  let targetSeat = null;
  if (seatId) {
    targetSeat = db.prepare(`
      SELECT id, status FROM seats 
      WHERE zone_key = ? AND id = ?
    `).get(zoneKey, String(seatId));

    if (!targetSeat || targetSeat.status !== 'free') {
      return { error: "Selected seat is no longer available. Please select another seat." };
    }
  } else {
    targetSeat = db.prepare(`
      SELECT id, status FROM seats 
      WHERE zone_key = ? AND status = 'free' 
      ORDER BY id ASC LIMIT 1
    `).get(zoneKey);

    if (!targetSeat) {
      return { error: "There are no free seats left in this sector." };
    }
  }

  const now = Date.now();
  const countdownSecs = demoSpeed ? 18 : 180;
  const newBookingId = `bk-${Math.floor(10000 + Math.random() * 90000)}`;

  const newBooking = {
    id: newBookingId,
    studentName,
    studentId,
    zoneKey,
    duration: parseInt(duration),
    status: "pending_claim",
    createdAt: now,
    expireAt: now + (countdownSecs * 1000),
    timeLeft: countdownSecs,
    seatId: targetSeat.id,
    graceStart: null
  };

  db.prepare(`
    INSERT INTO bookings (id, student_id, student_name, zone_key, seat_id, duration, status, created_at, expire_at, time_left, grace_start, grace_duration)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    newBooking.id,
    newBooking.studentId,
    newBooking.studentName,
    newBooking.zoneKey,
    newBooking.seatId,
    newBooking.duration,
    newBooking.status,
    newBooking.createdAt,
    newBooking.expireAt,
    newBooking.timeLeft,
    null,
    null
  );

  db.prepare(`
    UPDATE seats 
    SET status = 'pending', booking_id = ? 
    WHERE zone_key = ? AND id = ?
  `).run(newBooking.id, zoneKey, targetSeat.id);

  appendLog(`Reservation ${newBooking.id} created for ${studentName} on Seat #${targetSeat.id} in zone ${zoneKey}. Pending entry gate scan...`);

  return { success: true, booking: newBooking };
});

// 5. ATOMIC TRANSACTION: Legacy Check-in (for backwards compatibility)
const checkInTx = db.transaction(({ bookingId, seatId, isReturning }) => {
  const booking = db.prepare('SELECT * FROM bookings WHERE id = ?').get(bookingId);
  if (!booking) {
    return { error: "Booking not found", statusCode: 404 };
  }

  const targetSeat = db.prepare('SELECT * FROM seats WHERE zone_key = ? AND id = ?').get(booking.zone_key, String(seatId));

  if (isReturning) {
    if (String(booking.seat_id) !== String(seatId)) {
      return { error: `You must scan your assigned Seat #${booking.seat_id} to resume.`, statusCode: 400 };
    }

    if (targetSeat) {
      db.prepare("UPDATE seats SET status = 'occupied' WHERE zone_key = ? AND id = ?").run(booking.zone_key, String(seatId));
    }
    db.prepare("UPDATE bookings SET status = 'occupied', grace_start = NULL WHERE id = ?").run(booking.id);

    appendLog(`Student ${booking.student_name} successfully scanned back into seat #${seatId} to end grace break.`);
    return { success: true };
  }

  if (booking.seat_id) {
    if (String(booking.seat_id) !== String(seatId)) {
      return { error: `Verification mismatch. You reserved Seat #${booking.seat_id}.`, statusCode: 400 };
    }
    if (targetSeat) {
      db.prepare("UPDATE seats SET status = 'occupied', booking_id = ? WHERE zone_key = ? AND id = ?").run(booking.id, booking.zone_key, String(seatId));
    }
  } else {
    if (!targetSeat || (targetSeat.status !== 'free' && targetSeat.booking_id !== booking.id)) {
      return { error: "That physical seat is not available.", statusCode: 400 };
    }
    db.prepare("UPDATE seats SET status = 'occupied', booking_id = ? WHERE zone_key = ? AND id = ?").run(booking.id, booking.zone_key, String(seatId));
    db.prepare('UPDATE bookings SET seat_id = ? WHERE id = ?').run(String(seatId), booking.id);
  }

  db.prepare("UPDATE bookings SET status = 'occupied', time_left = NULL, expire_at = NULL WHERE id = ?").run(booking.id);
  appendLog(`Checked in seat #${seatId} for student ${booking.student_name}.`);

  return { success: true };
});

// 6. ATOMIC TRANSACTION: Checkout Occupied Seat
const checkoutTx = db.transaction(({ bookingId, statusType }) => {
  const b = db.prepare('SELECT * FROM bookings WHERE id = ?').get(bookingId);
  if (!b) {
    return { error: "Booking not found", statusCode: 404 };
  }

  if (b.status === "pending_claim") {
    db.prepare(`
      UPDATE seats 
      SET status = 'free', booking_id = NULL 
      WHERE zone_key = ? AND status = 'pending' AND booking_id = ?
    `).run(b.zone_key, b.id);
  } else {
    db.prepare(`
      UPDATE seats 
      SET status = 'free', booking_id = NULL 
      WHERE zone_key = ? AND (id = ? OR booking_id = ?)
    `).run(b.zone_key, String(b.seat_id), b.id);
  }

  const finalStatus = statusType || "released";
  db.prepare('UPDATE bookings SET status = ? WHERE id = ?').run(finalStatus, b.id);

  if (finalStatus === "cancelled") {
    appendLog(`Reservation hold window expired/cancelled: ${b.id}`);
  } else {
    appendLog(`Student ${b.student_name} exited seat #${b.seat_id} in ${b.zone_key}.`);
  }

  return { success: true };
});

// 7. ATOMIC TRANSACTION: Request Break (Grace period)
const requestBreakTx = db.transaction(({ bookingId, duration, demoSpeed }) => {
  const b = db.prepare('SELECT * FROM bookings WHERE id = ?').get(bookingId);
  if (!b) {
    return { error: "Booking not found", statusCode: 404 };
  }

  const now = Date.now();
  db.prepare(`
    UPDATE bookings 
    SET status = 'grace', grace_duration = ?, grace_start = ? 
    WHERE id = ?
  `).run(parseInt(duration), now, b.id);

  db.prepare(`
    UPDATE seats 
    SET status = 'grace' 
    WHERE zone_key = ? AND id = ?
  `).run(b.zone_key, String(b.seat_id));

  const limitText = demoSpeed ? `${duration} seconds` : `${duration} minutes`;
  appendLog(`Break grace timer (${limitText}) initiated for seat #${b.seat_id} in ${b.zone_key} (User: ${b.student_name}).`);

  return { success: true };
});

// 8. ATOMIC TRANSACTION: Librarian Guest Override Entry
const overrideEntryTx = db.transaction(({ zoneKey }) => {
  const freeSeat = db.prepare(`
    SELECT id FROM seats 
    WHERE zone_key = ? AND status = 'free' 
    ORDER BY id ASC LIMIT 1
  `).get(zoneKey);

  if (!freeSeat) {
    return { error: "Sector is currently 100% occupied.", statusCode: 400 };
  }

  const walkinId = `walkin-${Math.floor(100 + Math.random() * 900)}`;
  const bookingId = `bk-${walkinId}`;
  const now = Date.now();

  db.prepare(`
    INSERT INTO bookings (id, student_id, student_name, zone_key, seat_id, duration, status, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    bookingId,
    walkinId,
    `Walk-in Guest (${walkinId})`,
    zoneKey,
    freeSeat.id,
    2,
    'occupied',
    now
  );

  db.prepare(`
    UPDATE seats 
    SET status = 'occupied', booking_id = ? 
    WHERE zone_key = ? AND id = ?
  `).run(bookingId, zoneKey, freeSeat.id);

  appendLog(`[OVERRIDE WALK-IN ENTRY] Assigned seat #${freeSeat.id} to guest: ${walkinId} in ${zoneKey}.`);

  return { success: true };
});

// 9. ATOMIC TRANSACTION: Librarian Manual Clearance
const overrideExitTx = db.transaction(({ zoneKey }) => {
  const occupiedSeat = db.prepare(`
    SELECT id, booking_id FROM seats 
    WHERE zone_key = ? AND status = 'occupied' 
    ORDER BY id ASC LIMIT 1
  `).get(zoneKey);

  if (!occupiedSeat) {
    return { error: "No check-ins found in this sector to release.", statusCode: 400 };
  }

  db.prepare(`
    UPDATE seats 
    SET status = 'free', booking_id = NULL 
    WHERE zone_key = ? AND id = ?
  `).run(zoneKey, occupiedSeat.id);

  if (occupiedSeat.booking_id) {
    db.prepare("UPDATE bookings SET status = 'released' WHERE id = ?").run(occupiedSeat.booking_id);
  }

  appendLog(`[OVERRIDE EXIT] Manually cleared seat #${occupiedSeat.id} in ${zoneKey}.`);

  return { success: true };
});

// 10. ATOMIC TRANSACTION: Turnstile Card Exit Sync Simulator
const reconcileExitTx = db.transaction(() => {
  const targetBooking = db.prepare(`
    SELECT id, student_id, student_name, zone_key, seat_id 
    FROM bookings 
    WHERE status = 'occupied' 
    ORDER BY RANDOM() LIMIT 1
  `).get();

  if (!targetBooking) {
    return { success: false, message: "No active occupied seats found." };
  }

  db.prepare(`
    UPDATE seats 
    SET status = 'free', booking_id = NULL 
    WHERE zone_key = ? AND id = ?
  `).run(targetBooking.zone_key, String(targetBooking.seat_id));

  db.prepare("UPDATE bookings SET status = 'released' WHERE id = ?").run(targetBooking.id);

  appendLog(`[GATE EXIT SYNCHRONIZER] Released seat #${targetBooking.seat_id} in ${targetBooking.zone_key} (Student ${targetBooking.student_name} exited turnstile gate).`, "warning");

  return { success: true, target: targetBooking };
});

// 11. ATOMIC TRANSACTION: Clear Detailed Seat Override
const clearSeatTx = db.transaction(({ zoneKey, seatId, bookingId }) => {
  if (bookingId) {
    const b = db.prepare('SELECT * FROM bookings WHERE id = ?').get(bookingId);
    if (b) {
      db.prepare("UPDATE bookings SET status = 'released' WHERE id = ?").run(b.id);
      appendLog(`[LIBRARIAN OVERRIDE] Terminated booking ${b.id} for roll: ${b.student_id}. Seat released.`, "warning");
    }
  } else {
    appendLog(`[LIBRARIAN OVERRIDE] Manually cleared check-in for seat #${seatId} in ${zoneKey}.`);
  }

  db.prepare(`
    UPDATE seats 
    SET status = 'free', booking_id = NULL 
    WHERE zone_key = ? AND id = ?
  `).run(zoneKey, String(seatId));

  return { success: true };
});

// 12. ATOMIC TRANSACTION: Gate Card Tap (Entry / Re-entry / Exit)
const gateTapTx = db.transaction(({ studentId }) => {
  const booking = db.prepare(`
    SELECT * FROM bookings 
    WHERE student_id = ? AND status IN ('pending_claim', 'grace', 'occupied') 
    LIMIT 1
  `).get(studentId);

  if (!booking) {
    return { error: "Access Denied: No active library seat bookings found for this ID card.", statusCode: 400 };
  }

  let actionType = "";
  let logMsg = "";

  if (booking.status === "pending_claim") {
    // 1. Entry Tap: verifies entrance within 3 mins
    db.prepare(`
      UPDATE bookings 
      SET status = 'occupied', time_left = NULL, expire_at = NULL 
      WHERE id = ?
    `).run(booking.id);

    db.prepare(`
      UPDATE seats 
      SET status = 'occupied' 
      WHERE zone_key = ? AND id = ?
    `).run(booking.zone_key, String(booking.seat_id));

    actionType = "entry";
    logMsg = `[GATE ENTRY] Student ${booking.student_name} (${studentId}) swiped card at gate. Seat #${booking.seat_id} check-in verified.`;
    appendLog(logMsg, "event");
  } else if (booking.status === "grace") {
    // 2. Re-entry Tap: resumes session from grace break
    db.prepare(`
      UPDATE bookings 
      SET status = 'occupied', grace_start = NULL, grace_duration = NULL 
      WHERE id = ?
    `).run(booking.id);

    db.prepare(`
      UPDATE seats 
      SET status = 'occupied' 
      WHERE zone_key = ? AND id = ?
    `).run(booking.zone_key, String(booking.seat_id));

    actionType = "re-entry";
    logMsg = `[GATE RE-ENTRY] Student ${booking.student_name} (${studentId}) returned from break and swiped gate card. Seat #${booking.seat_id} session restored.`;
    appendLog(logMsg, "event");
  } else if (booking.status === "occupied") {
    // 3. Exit Tap: auto checkout
    db.prepare("UPDATE bookings SET status = 'released' WHERE id = ?").run(booking.id);

    db.prepare(`
      UPDATE seats 
      SET status = 'free', booking_id = NULL 
      WHERE zone_key = ? AND id = ?
    `).run(booking.zone_key, String(booking.seat_id));

    actionType = "exit";
    logMsg = `[GATE EXIT] Student ${booking.student_name} (${studentId}) swiped card at checkout. Seat #${booking.seat_id} released immediately.`;
    appendLog(logMsg, "warning");
  }

  const updatedBooking = db.prepare('SELECT * FROM bookings WHERE id = ?').get(booking.id);
  return { success: true, action: actionType, message: logMsg, booking: updatedBooking };
});

// 13. ATOMIC TRANSACTION: Create Ghost Seat Report
const createReportTx = db.transaction(({ seatId, zoneKey, reporterRoll }) => {
  const seat = db.prepare('SELECT * FROM seats WHERE zone_key = ? AND id = ?').get(zoneKey, String(seatId));
  if (!seat || (seat.status !== 'occupied' && seat.status !== 'grace')) {
    return { error: "Only occupied or away-on-break seats can be reported.", statusCode: 400 };
  }

  const booking = db.prepare('SELECT * FROM bookings WHERE id = ?').get(seat.booking_id);
  if (!booking) {
    return { error: "No active booking record matches this seat.", statusCode: 400 };
  }

  // Prevent duplicate reports
  const exists = db.prepare(`
    SELECT id FROM reports 
    WHERE zone_key = ? AND seat_id = ? AND status = 'pending'
    LIMIT 1
  `).get(zoneKey, String(seatId));

  if (exists) {
    return { success: true, message: "This seat has already been reported. Librarian is investigating." };
  }

  const newReport = {
    id: `rep-${Math.floor(10000 + Math.random() * 90000)}`,
    seatId: String(seatId),
    zoneKey,
    reporterRoll,
    bookingId: booking.id,
    bookerName: booking.student_name,
    bookerRoll: booking.student_id,
    createdAt: Date.now(),
    status: "pending"
  };

  db.prepare(`
    INSERT INTO reports (id, seat_id, zone_key, reporter_roll, booking_id, booker_name, booker_roll, created_at, status)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    newReport.id,
    newReport.seatId,
    newReport.zoneKey,
    newReport.reporterRoll,
    newReport.bookingId,
    newReport.bookerName,
    newReport.bookerRoll,
    newReport.createdAt,
    newReport.status
  );

  appendLog(`[GHOST SEAT REPORTED] Seat #${seatId} in ${zoneKey} reported empty by roll ${reporterRoll}.`, "warning");

  return { success: true, report: newReport };
});

// 14. ATOMIC TRANSACTION: Resolve Ghost Seat Report
const resolveReportTx = db.transaction(({ reportId, action }) => {
  const report = db.prepare('SELECT * FROM reports WHERE id = ?').get(reportId);
  if (!report) {
    return { error: "Report not found.", statusCode: 404 };
  }

  if (action === "dismiss") {
    db.prepare("UPDATE reports SET status = 'dismissed' WHERE id = ?").run(reportId);
    appendLog(`[REPORT DISMISSED] Ghost report for seat #${report.seat_id} in ${report.zone_key} dismissed by librarian.`, "event");
    return { success: true };
  }

  if (action === "force_release") {
    db.prepare("UPDATE reports SET status = 'force_released' WHERE id = ?").run(reportId);

    db.prepare(`
      UPDATE seats 
      SET status = 'free', booking_id = NULL 
      WHERE zone_key = ? AND id = ?
    `).run(report.zone_key, String(report.seat_id));

    db.prepare("UPDATE bookings SET status = 'released' WHERE id = ?").run(report.booking_id);

    // Send notification email
    sendMockEmail(
      report.booker_roll + "@thapar.edu",
      "Library Desk Released (Ghost Desk Action)",
      `Dear ${report.booker_name},\n\nYour library desk reservation on Seat #${report.seat_id} in ${report.zone_key} was released by the librarian following a desk occupancy inspection report.\n\nRegards,\nThapar Library Management`
    );

    appendLog(`[REPORT RESOLVED - RELEASED] Seat #${report.seat_id} in ${report.zone_key} cleared by librarian. Notification sent to roll ${report.booker_roll}.`, "warning");

    return { success: true };
  }

  return { error: "Invalid resolution action.", statusCode: 400 };
});

// 15. Periodic Expiration Worker (Checks 3-min claim timeout & grace break interval)
const checkTimeoutsTx = db.transaction((now, demoSpeed) => {
  let changed = false;

  // 1. Pending claim timeouts
  const pendingBookings = db.prepare("SELECT * FROM bookings WHERE status = 'pending_claim'").all();
  for (const b of pendingBookings) {
    const remainingSecs = Math.max(0, Math.round((b.expire_at - now) / 1000));
    db.prepare('UPDATE bookings SET time_left = ? WHERE id = ?').run(remainingSecs, b.id);

    if (remainingSecs <= 0) {
      db.prepare("UPDATE bookings SET status = 'cancelled' WHERE id = ?").run(b.id);
      db.prepare(`
        UPDATE seats 
        SET status = 'free', booking_id = NULL 
        WHERE zone_key = ? AND status = 'pending' AND booking_id = ?
      `).run(b.zone_key, b.id);

      sendMockEmail(
        b.student_id + "@thapar.edu",
        "Library Booking Expired (Missed Gate Tap)",
        `Dear ${b.student_name},\n\nYour seat reservation for Seat #${b.seat_id} in ${b.zone_key} was automatically cancelled because you did not tap your ID card at the entrance gate within the 3-minute booking window.\n\nRegards,\nThapar Library Management`
      );

      appendLog(`[TIMEOUT EXPIRED] Reservation hold cancelled for ${b.student_name}. Seat released in ${b.zone_key}.`, "warning");
      changed = true;
    }
  }

  // 2. Grace break timeouts
  const graceBookings = db.prepare("SELECT * FROM bookings WHERE status = 'grace'").all();
  for (const b of graceBookings) {
    const duration = b.grace_duration || 30;
    const limit = demoSpeed ? duration * 1000 : duration * 60000;
    const timeSpent = now - b.grace_start;

    if (timeSpent >= limit) {
      db.prepare("UPDATE bookings SET status = 'cancelled' WHERE id = ?").run(b.id);
      db.prepare(`
        UPDATE seats 
        SET status = 'free', booking_id = NULL 
        WHERE zone_key = ? AND id = ?
      `).run(b.zone_key, String(b.seat_id));

      sendMockEmail(
        b.student_id + "@thapar.edu",
        "Library Break Expired",
        `Dear ${b.student_name},\n\nYour session for Seat #${b.seat_id} in ${b.zone_key} has been cancelled and released because you failed to scan back in at the entrance gate before your grace break timer expired.\n\nRegards,\nThapar Library Management`
      );

      appendLog(`[BREAK EXPIRED] Seat #${b.seat_id} in ${b.zone_key} released. Student ${b.student_name} exceeded grace break interval.`, "warning");
      changed = true;
    }
  }

  return changed;
});

function checkTimeouts() {
  const demoSpeedRow = db.prepare('SELECT value FROM settings WHERE key = ?').get('demo_speed');
  const demoSpeed = demoSpeedRow ? demoSpeedRow.value === '1' : false;
  return checkTimeoutsTx(Date.now(), demoSpeed);
}

function setDemoSpeed(speed) {
  const val = speed ? '1' : '0';
  db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)').run('demo_speed', val);
  appendLog(`Global speed changed to: ${speed ? "Fast Demo" : "Standard"}`, "system");
}

function getDemoSpeed() {
  const demoSpeedRow = db.prepare('SELECT value FROM settings WHERE key = ?').get('demo_speed');
  return demoSpeedRow ? demoSpeedRow.value === '1' : false;
}

function clearLogs() {
  db.prepare('DELETE FROM audit_logs').run();
  appendLog("System logs wiped.", "system");
}

function saveOtp({ email, roll, otp, expiresAt }) {
  db.prepare('DELETE FROM otps WHERE LOWER(email) = LOWER(?) OR roll = ?').run(email, roll);
  db.prepare(`
    INSERT INTO otps (email, roll, otp, expires_at, created_at)
    VALUES (?, ?, ?, ?, ?)
  `).run(email, roll, otp, expiresAt, Date.now());
  return { success: true };
}

function verifyOtp({ email, roll, otp }) {
  const now = Date.now();
  const row = db.prepare(`
    SELECT * FROM otps 
    WHERE (LOWER(email) = LOWER(?) OR roll = ?) AND otp = ?
    ORDER BY id DESC LIMIT 1
  `).get(email, roll, otp);

  if (!row) {
    return { valid: false, error: "Incorrect OTP verification code." };
  }

  if (row.expires_at < now) {
    db.prepare('DELETE FROM otps WHERE id = ?').run(row.id);
    return { valid: false, error: "Verification code has expired. Please request a new OTP." };
  }

  db.prepare('DELETE FROM otps WHERE id = ?').run(row.id);
  return { valid: true };
}

// Initialize database schema upon module load
initSchema();

module.exports = {
  FLOORS,
  readState,
  appendLog,
  sendMockEmail,
  saveOtp,
  verifyOtp,
  reserveSeat: (data) => reserveSeatTx(data),
  checkIn: (data) => checkInTx(data),
  checkout: (data) => checkoutTx(data),
  requestBreak: (data) => requestBreakTx(data),
  overrideEntry: (data) => overrideEntryTx(data),
  overrideExit: (data) => overrideExitTx(data),
  reconcileExit: () => reconcileExitTx(),
  clearSeat: (data) => clearSeatTx(data),
  gateTap: (data) => gateTapTx(data),
  createReport: (data) => createReportTx(data),
  resolveReport: (data) => resolveReportTx(data),
  checkTimeouts,
  setDemoSpeed,
  getDemoSpeed,
  clearLogs
};
