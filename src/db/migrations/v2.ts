/**
 * v2 — integer primary keys become client-minted UUIDs, plus the sync
 * bookkeeping columns (`owner_id`, `pending_sync`, `deleted_at`).
 *
 * SQLite cannot change a column's type in place, so this is the standard
 * table-rebuild: create the new shape alongside, copy every row across while
 * minting a UUID for each old integer id, then drop and rename. The old->new
 * id map is built in JS because rewriting `employees.created_by`,
 * `attendance.emp_id` and `attendance.entered_by` cannot be expressed in SQL
 * alone without a helper table.
 *
 * All DDL is frozen here rather than imported from ../schema, for the same
 * reason v1 is frozen: a later schema change must not retroactively alter what
 * this migration produced on devices that already ran it.
 *
 * Two hazards this file exists to handle:
 *
 * 1. `PRAGMA foreign_keys` is ON (src/db/client.ts) and this rebuild cannot
 *    survive that. Two ways it bites: the UUID emp_ids inserted into
 *    attendance_new point at employees rows that still have INTEGER ids, so
 *    the FK fails immediately; and DROP TABLE performs an implicit DELETE
 *    FROM, which would fire attendance's ON DELETE CASCADE. The pragma is a
 *    no-op inside a transaction, so it cannot be toggled here - the runner
 *    turns it off around this migration via `disableForeignKeys`. Verified
 *    both ways by scripts/migration-test: with the toggle every row survives,
 *    without it the migration aborts with FOREIGN KEY constraint failed and
 *    the database stays on v1 forever.
 * 2. `created_by` was nullable; `owner_id` is NOT NULL because Row Level
 *    Security needs an owner on every row. Rows with no creator are adopted by
 *    the first local user. Phase 6 restamps every owner_id with the real
 *    auth.uid() at first cloud login, so a locally-minted owner is a
 *    placeholder, never a permanent identity.
 *
 * Never edit this file.
 */
import type { SQLiteDatabase } from 'expo-sqlite';
import { randomUUID } from 'expo-crypto';

const CREATE_USERS_NEW_V2 = `
CREATE TABLE users_new (
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

const CREATE_EMPLOYEES_NEW_V2 = `
CREATE TABLE employees_new (
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

const CREATE_ATTENDANCE_NEW_V2 = `
CREATE TABLE attendance_new (
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

const CREATE_INDEXES_V2 = `
CREATE INDEX IF NOT EXISTS idx_attendance_date     ON attendance (date);
CREATE INDEX IF NOT EXISTS idx_attendance_emp_date ON attendance (emp_id, date);
CREATE INDEX IF NOT EXISTS idx_attendance_pending  ON attendance (pending_sync);
CREATE INDEX IF NOT EXISTS idx_employees_status    ON employees (status);
CREATE INDEX IF NOT EXISTS idx_employees_owner     ON employees (owner_id);
CREATE INDEX IF NOT EXISTS idx_employees_pending   ON employees (pending_sync);
`;

const touchTriggerV2 = (table: string) => `
CREATE TRIGGER IF NOT EXISTS trg_${table}_touch
AFTER UPDATE ON ${table}
FOR EACH ROW WHEN OLD.updated_at = NEW.updated_at
BEGIN
  UPDATE ${table}
     SET updated_at = datetime('now','localtime'), pending_sync = 1
   WHERE id = OLD.id;
END;`;

interface OldUser {
  id: number;
  name: string;
  email_id: string | null;
  phone: string;
  resi_address: string | null;
  status: string;
  created_at: string;
  updated_at: string;
}

interface OldEmployee {
  id: number;
  name: string;
  phone: string | null;
  resi_address: string | null;
  status: string;
  remarks: string | null;
  start_date: string | null;
  end_date: string | null;
  wage_type: string;
  wage_amt: number;
  created_by: number | null;
  created_at: string;
  updated_at: string;
}

interface OldAttendance {
  id: number;
  emp_id: number;
  date: string;
  time_in: string | null;
  time_out: string | null;
  status: string;
  remarks: string | null;
  entry_type: string;
  entered_by: number | null;
  created_at: string;
  updated_at: string;
}

export async function upV2(db: SQLiteDatabase): Promise<void> {
  const oldUsers = await db.getAllAsync<OldUser>('SELECT * FROM users ORDER BY id');
  const oldEmployees = await db.getAllAsync<OldEmployee>(
    'SELECT * FROM employees ORDER BY id',
  );
  const oldAttendance = await db.getAllAsync<OldAttendance>(
    'SELECT * FROM attendance ORDER BY id',
  );

  const userIds = new Map<number, string>();
  for (const u of oldUsers) userIds.set(u.id, randomUUID());

  // Every row needs an owner. A register with no users row at all has never
  // been signed into, so there is nobody to attribute it to - mint a
  // placeholder that Phase 6 replaces with the real auth.uid().
  const fallbackOwner = oldUsers.length
    ? (userIds.get(oldUsers[0].id) as string)
    : randomUUID();

  const employeeIds = new Map<number, string>();
  const employeeOwners = new Map<number, string>();
  for (const e of oldEmployees) {
    employeeIds.set(e.id, randomUUID());
    const mapped = e.created_by != null ? userIds.get(e.created_by) : undefined;
    employeeOwners.set(e.id, mapped ?? fallbackOwner);
  }

  await db.execAsync(CREATE_USERS_NEW_V2);
  await db.execAsync(CREATE_EMPLOYEES_NEW_V2);
  await db.execAsync(CREATE_ATTENDANCE_NEW_V2);

  for (const u of oldUsers) {
    await db.runAsync(
      `INSERT INTO users_new
         (id, name, email_id, phone, resi_address, status, pending_sync, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?)`,
      userIds.get(u.id) as string,
      u.name,
      u.email_id,
      u.phone,
      u.resi_address,
      u.status,
      u.created_at,
      u.updated_at,
    );
  }

  for (const e of oldEmployees) {
    await db.runAsync(
      `INSERT INTO employees_new
         (id, owner_id, name, phone, resi_address, status, remarks, start_date, end_date,
          wage_type, wage_amt, pending_sync, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)`,
      employeeIds.get(e.id) as string,
      employeeOwners.get(e.id) as string,
      e.name,
      e.phone,
      e.resi_address,
      e.status,
      e.remarks,
      e.start_date,
      e.end_date,
      e.wage_type,
      e.wage_amt,
      e.created_at,
      e.updated_at,
    );
  }

  for (const a of oldAttendance) {
    const empId = employeeIds.get(a.emp_id);
    // Unreachable while foreign keys are on, but a row pointing at a Saathi
    // that no longer exists cannot be given a valid emp_id - dropping it is
    // better than aborting the whole migration.
    if (!empId) continue;
    const enteredBy = a.entered_by != null ? (userIds.get(a.entered_by) ?? null) : null;
    await db.runAsync(
      `INSERT INTO attendance_new
         (id, owner_id, emp_id, date, time_in, time_out, status, remarks, entry_type,
          entered_by, pending_sync, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)`,
      randomUUID(),
      employeeOwners.get(a.emp_id) as string,
      empId,
      a.date,
      a.time_in,
      a.time_out,
      a.status,
      a.remarks,
      a.entry_type,
      enteredBy,
      a.created_at,
      a.updated_at,
    );
  }

  // Children before parents: dropping employees first would cascade into the
  // still-present old attendance table if foreign keys were somehow left on.
  await db.execAsync('DROP TABLE attendance;');
  await db.execAsync('DROP TABLE employees;');
  await db.execAsync('DROP TABLE users;');

  await db.execAsync('ALTER TABLE users_new RENAME TO users;');
  await db.execAsync('ALTER TABLE employees_new RENAME TO employees;');
  await db.execAsync('ALTER TABLE attendance_new RENAME TO attendance;');

  // The old indexes and triggers went with the dropped tables.
  await db.execAsync(CREATE_INDEXES_V2);
  for (const table of ['users', 'employees', 'attendance']) {
    await db.execAsync(touchTriggerV2(table));
  }
}
