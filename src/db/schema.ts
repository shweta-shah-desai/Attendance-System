/**
 * GharSaathi+ SQLite schema.
 *
 * Offline-first: this file is the authoritative definition of every table.
 * Any change here needs a matching migration in ./migrations.
 *
 * v2 made the database syncable to Supabase. Three things changed and the
 * reasons are worth keeping next to the DDL:
 *
 * - **TEXT (UUID) primary keys, minted on the client at insert time.** Two
 *   devices offline would both hand their next Saathi the integer id 7; on
 *   sync those are two different people with one primary key. A UUID created
 *   at insert time means a row written on a plane already carries its final,
 *   globally unique identity, so no local<->remote id map is ever needed.
 * - **`pending_sync`** is the outbound queue. Every local write sets it to 1
 *   and a successful push clears it, so no separate queue table exists.
 * - **`deleted_at`** soft deletes. A hard DELETE is invisible to a pull-based
 *   sync, so another device would happily resurrect the row.
 */

export const DB_NAME = 'gharsaathi.db';

/** Bump this whenever a new migration is appended. */
export const SCHEMA_VERSION = 2;

export const CREATE_USERS = `
CREATE TABLE IF NOT EXISTS users (
  id            TEXT    PRIMARY KEY,
  name          TEXT    NOT NULL,
  email_id      TEXT,
  phone         TEXT    NOT NULL UNIQUE,
  resi_address  TEXT,
  status        TEXT    NOT NULL DEFAULT 'active' CHECK (status IN ('active','inactive')),
  pending_sync  INTEGER NOT NULL DEFAULT 1,
  deleted_at    TEXT,
  created_at    TEXT    NOT NULL DEFAULT (datetime('now','localtime')),
  updated_at    TEXT    NOT NULL DEFAULT (datetime('now','localtime'))
);`;

/**
 * `owner_id` carries no REFERENCES clause on purpose. On the server it is a
 * foreign key to `profiles`, but locally it is a stamped identity that Phase 6
 * rewrites to the real `auth.uid()` at first cloud login - and a local FK with
 * a cascade would turn that restamp, or a users-row cleanup, into silent data
 * loss. It is NOT NULL because Row Level Security needs every row to have an
 * owner before it can be pushed.
 */
export const CREATE_EMPLOYEES = `
CREATE TABLE IF NOT EXISTS employees (
  id            TEXT    PRIMARY KEY,
  owner_id      TEXT    NOT NULL,
  name          TEXT    NOT NULL,
  phone         TEXT,
  resi_address  TEXT,
  status        TEXT    NOT NULL DEFAULT 'active' CHECK (status IN ('active','inactive')),
  remarks       TEXT,
  start_date    TEXT,
  end_date      TEXT,
  wage_type     TEXT    NOT NULL CHECK (wage_type IN ('Monthly','Rokadi','Bi-weekly')),
  wage_amt      INTEGER NOT NULL CHECK (wage_amt > 0),
  pending_sync  INTEGER NOT NULL DEFAULT 1,
  deleted_at    TEXT,
  created_at    TEXT    NOT NULL DEFAULT (datetime('now','localtime')),
  updated_at    TEXT    NOT NULL DEFAULT (datetime('now','localtime'))
);`;

export const CREATE_ATTENDANCE = `
CREATE TABLE IF NOT EXISTS attendance (
  id            TEXT    PRIMARY KEY,
  owner_id      TEXT    NOT NULL,
  emp_id        TEXT    NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  date          TEXT    NOT NULL,
  time_in       TEXT,
  time_out      TEXT,
  status        TEXT    NOT NULL CHECK (
                  status IN ('Present','Absent','Half-day','WFH','Leave','Holiday','Weekend')
                ),
  remarks       TEXT,
  entry_type    TEXT    NOT NULL DEFAULT 'manual' CHECK (entry_type IN ('manual','admin-entered')),
  entered_by    TEXT,
  pending_sync  INTEGER NOT NULL DEFAULT 1,
  deleted_at    TEXT,
  created_at    TEXT    NOT NULL DEFAULT (datetime('now','localtime')),
  updated_at    TEXT    NOT NULL DEFAULT (datetime('now','localtime')),
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
CREATE INDEX IF NOT EXISTS idx_attendance_pending  ON attendance (pending_sync);
CREATE INDEX IF NOT EXISTS idx_employees_status    ON employees (status);
CREATE INDEX IF NOT EXISTS idx_employees_owner     ON employees (owner_id);
CREATE INDEX IF NOT EXISTS idx_employees_pending   ON employees (pending_sync);
`;

/**
 * updated_at is maintained by the database, not by callers, so it is correct
 * no matter which query touched the row. The WHEN guard stops the trigger
 * firing on its own write.
 *
 * Since v2 the same trigger also raises `pending_sync`, so no query file has
 * to remember to mark a row dirty. The one statement that sets `updated_at`
 * itself - the attendance upsert - therefore sets `pending_sync` itself too,
 * because this trigger's WHEN guard skips it.
 */
const touchTrigger = (table: string) => `
CREATE TRIGGER IF NOT EXISTS trg_${table}_touch
AFTER UPDATE ON ${table}
FOR EACH ROW WHEN OLD.updated_at = NEW.updated_at
BEGIN
  UPDATE ${table}
     SET updated_at = datetime('now','localtime'), pending_sync = 1
   WHERE id = OLD.id;
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
