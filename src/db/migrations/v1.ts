/**
 * Frozen v1 schema — the shape that shipped before the cloud work.
 *
 * This is a verbatim snapshot of the original `src/db/schema.ts` DDL. It lives
 * here, not in schema.ts, because schema.ts describes the *current* shape and
 * v1 must keep creating exactly what it always created: v2 rebuilds these
 * tables, so if v1 drifted the rebuild would run against the wrong input.
 *
 * Never edit this file.
 */
import type { SQLiteDatabase } from 'expo-sqlite';
import { DEFAULT_SETTINGS } from '../schema';

const CREATE_USERS_V1 = `
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

const CREATE_EMPLOYEES_V1 = `
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

const CREATE_ATTENDANCE_V1 = `
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

const CREATE_HOLIDAYS_V1 = `
CREATE TABLE IF NOT EXISTS holidays (
  id      INTEGER PRIMARY KEY AUTOINCREMENT,
  date    TEXT NOT NULL UNIQUE,
  name    TEXT NOT NULL,
  region  TEXT
);`;

const CREATE_SETTINGS_V1 = `
CREATE TABLE IF NOT EXISTS settings (
  id     INTEGER PRIMARY KEY AUTOINCREMENT,
  key    TEXT NOT NULL UNIQUE,
  value  TEXT
);`;

const CREATE_INDEXES_V1 = `
CREATE INDEX IF NOT EXISTS idx_attendance_date     ON attendance (date);
CREATE INDEX IF NOT EXISTS idx_attendance_emp_date ON attendance (emp_id, date);
CREATE INDEX IF NOT EXISTS idx_employees_status    ON employees (status);
CREATE INDEX IF NOT EXISTS idx_employees_creator   ON employees (created_by);
`;

const touchTriggerV1 = (table: string) => `
CREATE TRIGGER IF NOT EXISTS trg_${table}_touch
AFTER UPDATE ON ${table}
FOR EACH ROW WHEN OLD.updated_at = NEW.updated_at
BEGIN
  UPDATE ${table} SET updated_at = datetime('now','localtime') WHERE id = OLD.id;
END;`;

export async function upV1(db: SQLiteDatabase): Promise<void> {
  for (const ddl of [
    CREATE_USERS_V1,
    CREATE_EMPLOYEES_V1,
    CREATE_ATTENDANCE_V1,
    CREATE_HOLIDAYS_V1,
    CREATE_SETTINGS_V1,
  ]) {
    await db.execAsync(ddl);
  }
  await db.execAsync(CREATE_INDEXES_V1);
  for (const table of ['users', 'employees', 'attendance']) {
    await db.execAsync(touchTriggerV1(table));
  }

  for (const [key, value] of DEFAULT_SETTINGS) {
    await db.runAsync(
      'INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)',
      key,
      value,
    );
  }
}
