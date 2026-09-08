-- =====================================================================
-- THAPAR SMART LIBRARY DESK SYSTEM - RELATIONAL DATABASE SCHEMA
-- Engine: SQLite / PostgreSQL ANSI SQL Compatible
-- =====================================================================

-- 1. System Settings & Configuration
CREATE TABLE IF NOT EXISTS settings (
    key VARCHAR(50) PRIMARY KEY,
    value TEXT NOT NULL
);

-- 2. Physical Desks / Seats
CREATE TABLE IF NOT EXISTS seats (
    id VARCHAR(10) NOT NULL,                    -- Seat Code (e.g. 'A01', 'B12')
    zone_key VARCHAR(100) NOT NULL,             -- Sector Key (e.g. 'ground::Main / Central Lobby')
    floor_id VARCHAR(50) NOT NULL,              -- Floor Identifier ('ground', 'first', 'second', 'third')
    status VARCHAR(20) NOT NULL DEFAULT 'free', -- 'free' | 'pending' | 'occupied' | 'grace'
    booking_id VARCHAR(50),                     -- Foreign Key referencing active booking
    PRIMARY KEY (zone_key, id)
);

CREATE INDEX IF NOT EXISTS idx_seats_zone ON seats(zone_key);
CREATE INDEX IF NOT EXISTS idx_seats_status ON seats(status);

-- 3. Student Bookings & Allocations
CREATE TABLE IF NOT EXISTS bookings (
    id VARCHAR(50) PRIMARY KEY,                         -- Unique Booking ID (e.g. 'bk-84210')
    student_id VARCHAR(50) NOT NULL,                    -- Student Roll Number (e.g. '102103444')
    student_name VARCHAR(100) NOT NULL,                 -- Student Full Name
    zone_key VARCHAR(100) NOT NULL,                     -- Floor Sector
    seat_id VARCHAR(10) NOT NULL,                       -- Assigned Seat Code
    duration INTEGER NOT NULL,                          -- Duration in Hours (e.g. 2, 4)
    status VARCHAR(30) NOT NULL,                        -- 'pending_claim' | 'occupied' | 'grace' | 'released' | 'cancelled'
    created_at BIGINT NOT NULL,                         -- Timestamp (Epoch ms)
    expire_at BIGINT,                                   -- Expiration timestamp for 3-minute hold
    time_left INTEGER,                                  -- Remaining seconds
    grace_start BIGINT,                                 -- Break start timestamp
    grace_duration INTEGER                              -- Break duration in minutes (10, 20, 30)
);

CREATE INDEX IF NOT EXISTS idx_bookings_student ON bookings(student_id, status);
CREATE INDEX IF NOT EXISTS idx_bookings_status ON bookings(status);
CREATE INDEX IF NOT EXISTS idx_bookings_seat ON bookings(zone_key, seat_id);

-- 4. Ghost Seat Reports (Occupancy Discrepancies)
CREATE TABLE IF NOT EXISTS reports (
    id VARCHAR(50) PRIMARY KEY,                         -- Report ID (e.g. 'rep-58210')
    seat_id VARCHAR(10) NOT NULL,                       -- Reported Desk Code
    zone_key VARCHAR(100) NOT NULL,                     -- Sector Location
    reporter_roll VARCHAR(50) NOT NULL,                 -- Roll number of student who reported
    booking_id VARCHAR(50) NOT NULL,                    -- Active booking on that seat
    booker_name VARCHAR(100) NOT NULL,                  -- Student name who booked
    booker_roll VARCHAR(50) NOT NULL,                   -- Student roll who booked
    created_at BIGINT NOT NULL,                         -- Report timestamp
    status VARCHAR(30) NOT NULL DEFAULT 'pending'       -- 'pending' | 'dismissed' | 'force_released'
);

CREATE INDEX IF NOT EXISTS idx_reports_status ON reports(status);

-- 5. Audit Trail & System Security Logs
CREATE TABLE IF NOT EXISTS audit_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    time VARCHAR(30) NOT NULL,                          -- Human-readable time string
    msg TEXT NOT NULL,                                  -- Log message
    type VARCHAR(30) NOT NULL DEFAULT 'event',          -- 'event' | 'warning' | 'system'
    created_at BIGINT NOT NULL                          -- Timestamp (Epoch ms)
);

-- 6. Notification & Mock Email Queue
CREATE TABLE IF NOT EXISTS emails (
    id VARCHAR(50) PRIMARY KEY,                         -- Email ID (e.g. 'em-49102')
    to_addr VARCHAR(100) NOT NULL,                      -- Recipient email address
    subject VARCHAR(200) NOT NULL,                      -- Email Subject
    body TEXT NOT NULL,                                 -- Email Content
    time VARCHAR(30) NOT NULL,                          -- Formatted time
    timestamp BIGINT NOT NULL                           -- Timestamp (Epoch ms)
);
