/**
 * GharSaathi+ SQLite schema.
 *
 * Offline-first: this file is the authoritative definition of every table.
 * Any change here needs a matching migration in ./migrations.
 */

export const DB_NAME = 'gharsaathi.db';

/** Bump this whenever a new migration is appended. */
export const SCHEMA_VERSION = 1;

export const CREATE_USERS = `
CREATE TABLE IF NOT EXISTS users (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  name          TEXT    NOT NULL,
  email_id      TEXT,
  phone         TEXT    NOT NULL UNIQUE,
  resi_address  TEXT,
  status        TEXT    NOT NULL DEFAULT 'active' CHECK (status IN ('active','inactive')),
  created_at    TEXT    NOT NULL DEFAULT (datetime('now','localtime')),
  updated_at    TEXT    NOT NULL DEFAULT (datetime('now','localtime'))
);`;

export const CREATE_EMPLOYEES = `
CREATE TABLE IF NOT EXISTS employees (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  name          TEXT    NOT NULL,
  phone         TEXT,
  resi_address  TEXT,
  status        TEXT    NOT NULL DEFAULT 'active' CHECK (status IN ('active','inactive')),
  remarks       TEXT,
  start_date    TEXT,
  end_date      TEXT,
  wage_type     TEXT    NOT NULL CHECK (wage_type IN ('Monthly','Rokadi','Bi-weekly')),
  wage_amt      INTEGER NOT NULL CHECK (wage_amt > 0),
  created_by    INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at    TEXT    NOT NULL DEFAULT (datetime('now','localtime')),
  updated_at    TEXT    NOT NULL DEFAULT (datetime('now','localtime'))
);`;

export const CREATE_ATTENDANCE = `
CREATE TABLE IF NOT EXISTS attendance (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  emp_id      INTEGER NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  date        TEXT    NOT NULL,
  time_in     TEXT,
  time_out    TEXT,
  status      TEXT    NOT NULL CHECK (
                status IN ('Present','Absent','Half-day','WFH','Leave','Holiday','Weekend')
              ),
  remarks     TEXT,
  entry_type  TEXT    NOT NULL DEFAULT 'manual' CHECK (entry_type IN ('manual','admin-entered')),
  entered_by  INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at  TEXT    NOT NULL DEFAULT (datetime('now','localtime')),
  updated_at  TEXT    NOT NULL DEFAULT (datetime('now','localtime')),
  UNIQUE (emp_id, date)
);`;

export const CREATE_HOLIDAYS = `
CREATE TABLE IF NOT EXISTS holidays (
  id      INTEGER PRIMARY KEY AUTOINCREMENT,
  date    TEXT NOT NULL UNIQUE,
  name    TEXT NOT NULL,
  region  TEXT
);`;

export const CREATE_SETTINGS = `
CREATE TABLE IF NOT EXISTS settings (
  id     INTEGER PRIMARY KEY AUTOINCREMENT,
  key    TEXT NOT NULL UNIQUE,
  value  TEXT
);`;

export const CREATE_INDEXES = `
CREATE INDEX IF NOT EXISTS idx_attendance_date     ON attendance (date);
CREATE INDEX IF NOT EXISTS idx_attendance_emp_date ON attendance (emp_id, date);
CREATE INDEX IF NOT EXISTS idx_employees_status    ON employees (status);
CREATE INDEX IF NOT EXISTS idx_employees_creator   ON employees (created_by);
`;

/**
 * updated_at is maintained by the database, not by callers, so it is correct
 * no matter which query touched the row. The WHEN guard stops the trigger
 * firing on its own write.
 */
const touchTrigger = (table: string) => `
CREATE TRIGGER IF NOT EXISTS trg_${table}_touch
AFTER UPDATE ON ${table}
FOR EACH ROW WHEN OLD.updated_at = NEW.updated_at
BEGIN
  UPDATE ${table} SET updated_at = datetime('now','localtime') WHERE id = OLD.id;
END;`;

export const CREATE_TRIGGERS = [
  touchTrigger('users'),
  touchTrigger('employees'),
  touchTrigger('attendance'),
];

/** Sensible defaults seeded once, on first launch. */
export const DEFAULT_SETTINGS: Array<[string, string]> = [
  ['work_start_time', '09:00'],
  ['work_end_time', '18:00'],
  ['week_off_days', '0'], // 0 = Sunday
  ['reminder_enabled', '1'],
  ['reminder_time', '20:00'],
  ['wage_basis', 'calendar'], // calendar | working
];

export const ALL_TABLES = [
  CREATE_USERS,
  CREATE_EMPLOYEES,
  CREATE_ATTENDANCE,
  CREATE_HOLIDAYS,
  CREATE_SETTINGS,
];
