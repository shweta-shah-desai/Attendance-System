import { randomUUID } from 'expo-crypto';
import { getDb } from '../client';
import { listDates } from '../../utils/date';
import type {
  Attendance,
  AttendanceStatus,
  AttendanceWithEmployee,
  NewAttendance,
} from '../../types/attendance';

/**
 * Both soft-delete clauses live in this constant rather than in each caller's
 * WHERE: since v2 a delete only stamps `deleted_at`, and a single read that
 * forgets the clause makes a deleted entry reappear. Callers append their own
 * conditions with AND, so there is no way to start a WHERE that omits it.
 */
const JOINED_SELECT = `
  SELECT a.*, e.name AS emp_name, e.wage_type, e.wage_amt, e.status AS emp_status
  FROM attendance a
  JOIN employees e ON e.id = a.emp_id AND e.deleted_at IS NULL
  WHERE a.deleted_at IS NULL`;

/** The owner every attendance row inherits, so no caller can mis-stamp one. */
async function ownerOfEmployee(empId: string): Promise<string> {
  const db = await getDb();
  const row = await db.getFirstAsync<{ owner_id: string }>(
    'SELECT owner_id FROM employees WHERE id = ? AND deleted_at IS NULL',
    empId,
  );
  if (!row) throw new Error('That Saathi is no longer in your register.');
  return row.owner_id;
}

/**
 * Inserts or updates the single row that exists per (Saathi, date).
 * The UNIQUE(emp_id, date) constraint makes this safe to call repeatedly, so
 * the manual-entry form never creates duplicates for the same day.
 *
 * `deleted_at = NULL` in the conflict branch is what lets a day be marked
 * again after it was deleted - otherwise the soft-deleted row would win the
 * conflict and the new mark would vanish. `pending_sync` is set explicitly
 * because this statement writes `updated_at` itself, which makes the touch
 * trigger's WHEN guard skip it.
 */
export async function upsertAttendance(entry: NewAttendance): Promise<string> {
  const db = await getDb();
  const ownerId = await ownerOfEmployee(entry.emp_id);
  const id = randomUUID();

  await db.runAsync(
    `INSERT INTO attendance
       (id, owner_id, emp_id, date, time_in, time_out, status, remarks, entry_type, entered_by)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(emp_id, date) DO UPDATE SET
       time_in      = excluded.time_in,
       time_out     = excluded.time_out,
       status       = excluded.status,
       remarks      = excluded.remarks,
       entry_type   = excluded.entry_type,
       entered_by   = excluded.entered_by,
       deleted_at   = NULL,
       pending_sync = 1,
       updated_at   = datetime('now','localtime')`,
    id,
    ownerId,
    entry.emp_id,
    entry.date,
    entry.time_in,
    entry.time_out,
    entry.status,
    entry.remarks,
    entry.entry_type ?? 'manual',
    entry.entered_by,
  );

  // On the conflict path the surviving row keeps its original id, so the id
  // that was minted above is not necessarily the row's.
  const row = await db.getFirstAsync<{ id: string }>(
    'SELECT id FROM attendance WHERE emp_id = ? AND date = ?',
    entry.emp_id,
    entry.date,
  );
  return row?.id ?? id;
}

/** Marks several Saathis on the same date in one transaction (bulk "Mark all"). */
export async function bulkMark(
  date: string,
  empIds: string[],
  status: AttendanceStatus,
  enteredBy: string | null,
): Promise<void> {
  if (empIds.length === 0) return;
  const db = await getDb();
  await db.withTransactionAsync(async () => {
    for (const empId of empIds) {
      await upsertAttendance({
        emp_id: empId,
        date,
        time_in: null,
        time_out: null,
        status,
        remarks: null,
        entered_by: enteredBy,
        entry_type: 'manual',
      });
    }
  });
}

export interface AutoMarkInput {
  emp_id: string;
  /** Inclusive window, both YYYY-MM-DD. */
  from: string;
  to: string;
  status: AttendanceStatus;
  entered_by: string | null;
  remarks?: string | null;
}

/** What Auto Hajari did: fresh rows written, and days it left alone. */
export interface AutoMarkResult {
  added: number;
  skipped: number;
}

/**
 * Stamps one status on every *unmarked* day of a window for a single Saathi -
 * the Auto Hajari save.
 *
 * Not the upsert the manual form uses: a bulk run must never overwrite an
 * entry someone made by hand, so a day that already has a row is left exactly
 * as it is and only counted as skipped. The conflict clause - not the
 * pre-count - is what guarantees that, so nothing can slip through between
 * reading and writing. The whole window is one transaction, so a failure
 * part-way leaves the register untouched.
 *
 * The conflict branch is guarded by `WHERE attendance.deleted_at IS NOT NULL`,
 * which makes it revive a deleted day and still do nothing to a live one. A
 * plain DO NOTHING would count a soft-deleted day as already marked and skip
 * it forever.
 */
export async function autoMarkRange(input: AutoMarkInput): Promise<AutoMarkResult> {
  const dates = listDates(input.from, input.to);
  if (dates.length === 0) return { added: 0, skipped: 0 };

  const db = await getDb();
  const ownerId = await ownerOfEmployee(input.emp_id);
  let added = 0;

  await db.withTransactionAsync(async () => {
    for (const date of dates) {
      const res = await db.runAsync(
        `INSERT INTO attendance
           (id, owner_id, emp_id, date, time_in, time_out, status, remarks, entry_type, entered_by)
         VALUES (?, ?, ?, ?, NULL, NULL, ?, ?, 'manual', ?)
         ON CONFLICT(emp_id, date) DO UPDATE SET
           status       = excluded.status,
           remarks      = excluded.remarks,
           entered_by   = excluded.entered_by,
           deleted_at   = NULL,
           pending_sync = 1,
           updated_at   = datetime('now','localtime')
         WHERE attendance.deleted_at IS NOT NULL`,
        randomUUID(),
        ownerId,
        input.emp_id,
        date,
        input.status,
        input.remarks ?? null,
        input.entered_by,
      );
      added += res.changes;
    }
  });

  return { added, skipped: dates.length - added };
}

export async function getAttendance(
  empId: string,
  date: string,
): Promise<Attendance | null> {
  const db = await getDb();
  return db.getFirstAsync<Attendance>(
    'SELECT * FROM attendance WHERE emp_id = ? AND date = ? AND deleted_at IS NULL',
    empId,
    date,
  );
}

export async function listByDate(date: string): Promise<AttendanceWithEmployee[]> {
  const db = await getDb();
  return db.getAllAsync<AttendanceWithEmployee>(
    `${JOINED_SELECT} AND a.date = ? ORDER BY e.name COLLATE NOCASE`,
    date,
  );
}

export async function listByRange(
  from: string,
  to: string,
  empId?: string | null,
): Promise<AttendanceWithEmployee[]> {
  const db = await getDb();
  if (empId) {
    return db.getAllAsync<AttendanceWithEmployee>(
      `${JOINED_SELECT} AND a.date BETWEEN ? AND ? AND a.emp_id = ? ORDER BY a.date DESC, e.name`,
      from,
      to,
      empId,
    );
  }
  return db.getAllAsync<AttendanceWithEmployee>(
    `${JOINED_SELECT} AND a.date BETWEEN ? AND ? ORDER BY a.date DESC, e.name`,
    from,
    to,
  );
}

export async function listRecent(limit = 20): Promise<AttendanceWithEmployee[]> {
  const db = await getDb();
  return db.getAllAsync<AttendanceWithEmployee>(
    `${JOINED_SELECT} ORDER BY datetime(a.updated_at) DESC LIMIT ?`,
    limit,
  );
}

/** Stamps `deleted_at` so the deletion can propagate to the other devices. */
export async function deleteAttendance(id: string): Promise<void> {
  const db = await getDb();
  await db.runAsync(
    "UPDATE attendance SET deleted_at = datetime('now','localtime') WHERE id = ? AND deleted_at IS NULL",
    id,
  );
}

/**
 * For the home calendar: how many Saathis are marked on each date of a month,
 * plus how many of those were absent, so a day can be dotted at a glance.
 */
export interface DayMark {
  date: string;
  marked: number;
  present: number;
  absent: number;
}

export async function monthDayMarks(from: string, to: string): Promise<DayMark[]> {
  const db = await getDb();
  return db.getAllAsync<DayMark>(
    `SELECT date,
            COUNT(*)                                            AS marked,
            COALESCE(SUM(status IN ('Present','WFH')), 0)        AS present,
            COALESCE(SUM(status = 'Absent'), 0)                  AS absent
     FROM attendance
     WHERE date BETWEEN ? AND ? AND deleted_at IS NULL
     GROUP BY date`,
    from,
    to,
  );
}

export interface StatusCount {
  status: AttendanceStatus;
  count: number;
}

export async function countByStatus(from: string, to: string, empId?: string | null) {
  const db = await getDb();
  if (empId) {
    return db.getAllAsync<StatusCount>(
      'SELECT status, COUNT(*) AS count FROM attendance WHERE date BETWEEN ? AND ? AND emp_id = ? AND deleted_at IS NULL GROUP BY status',
      from,
      to,
      empId,
    );
  }
  return db.getAllAsync<StatusCount>(
    'SELECT status, COUNT(*) AS count FROM attendance WHERE date BETWEEN ? AND ? AND deleted_at IS NULL GROUP BY status',
    from,
    to,
  );
}

/** Saathis with no row for the given date - drives the "pending today" nudge. */
export async function listUnmarkedOn(
  date: string,
  ownerId?: string | null,
): Promise<{ id: string; name: string }[]> {
  const db = await getDb();
  const args: (string | number)[] = [date];
  let ownerClause = '';
  if (ownerId != null) {
    ownerClause = ' AND e.owner_id = ?';
    args.push(ownerId);
  }
  args.push(date, date);
  return db.getAllAsync<{ id: string; name: string }>(
    `SELECT e.id, e.name
     FROM employees e
     WHERE e.status = 'active'
       AND e.deleted_at IS NULL
       AND NOT EXISTS (
         SELECT 1 FROM attendance a
          WHERE a.emp_id = e.id AND a.date = ? AND a.deleted_at IS NULL
       )
       ${ownerClause}
       AND (e.start_date IS NULL OR e.start_date = '' OR e.start_date <= ?)
       AND (e.end_date IS NULL OR e.end_date = '' OR e.end_date >= ?)
     ORDER BY e.name COLLATE NOCASE`,
    ...args,
  );
}

export interface AttendanceRangeFilter {
  /** Inclusive window, both in YYYY-MM-DD. */
  from: string;
  to: string;
  /** Scopes to the Saathi of one household, like every other list. */
  ownerId?: string | null;
  empId?: string | null;
}

/**
 * Rows for the Attendance List screen: one window of dates, newest date first.
 *
 * Ordering happens in SQL rather than in JS so the "late first" default holds
 * however long the window is, and the name tiebreak keeps a single day's rows
 * in a stable, readable order.
 */
export async function listAttendanceRange(
  filter: AttendanceRangeFilter,
): Promise<AttendanceWithEmployee[]> {
  const db = await getDb();
  const { from, to, ownerId, empId } = filter;

  const where = ['a.date BETWEEN ? AND ?'];
  const args: (string | number)[] = [from, to];

  if (ownerId != null) {
    where.push('e.owner_id = ?');
    args.push(ownerId);
  }
  if (empId != null) {
    where.push('a.emp_id = ?');
    args.push(empId);
  }

  return db.getAllAsync<AttendanceWithEmployee>(
    `${JOINED_SELECT} AND ${where.join(' AND ')}
     ORDER BY a.date DESC, e.name COLLATE NOCASE`,
    ...args,
  );
}

/** One joined row by its own id - what the Attendance Detail screen shows. */
export async function getAttendanceById(
  id: string,
): Promise<AttendanceWithEmployee | null> {
  const db = await getDb();
  return db.getFirstAsync<AttendanceWithEmployee>(
    `${JOINED_SELECT} AND a.id = ?`,
    id,
  );
}

export interface AttendanceEdit {
  emp_id: string;
  date: string;
  status: AttendanceStatus;
}

/**
 * Edits an existing row in place, from the Attendance Detail screen.
 *
 * This is deliberately not an upsert: moving a row onto a (Saathi, date) that
 * is already marked would either overwrite that other entry or leave two rows
 * for one day. The clash is looked up first so the user gets told about it
 * instead of silently losing an entry.
 *
 * A soft-deleted row at the target (Saathi, date) is not a clash the user can
 * see, but it still holds the UNIQUE slot - so it is cleared out of the way
 * rather than reported. Dropping that tombstone outright is safe: if it was
 * never pushed the server never knew the row, and if it was pushed the server
 * still holds the tombstone, which a pull applies as a local delete.
 */
export async function updateAttendance(id: string, edit: AttendanceEdit): Promise<void> {
  const db = await getDb();

  const clash = await db.getFirstAsync<{ id: string }>(
    'SELECT id FROM attendance WHERE emp_id = ? AND date = ? AND id <> ? AND deleted_at IS NULL',
    edit.emp_id,
    edit.date,
    id,
  );
  if (clash) {
    throw new Error('That Saathi is already marked on that date.');
  }

  await db.withTransactionAsync(async () => {
    await db.runAsync(
      'DELETE FROM attendance WHERE emp_id = ? AND date = ? AND id <> ? AND deleted_at IS NOT NULL',
      edit.emp_id,
      edit.date,
      id,
    );
    await db.runAsync(
      'UPDATE attendance SET emp_id = ?, date = ?, status = ? WHERE id = ?',
      edit.emp_id,
      edit.date,
      edit.status,
      id,
    );
  });
}
