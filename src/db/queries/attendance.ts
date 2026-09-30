import { getDb } from '../client';
import { listDates } from '../../utils/date';
import type {
  Attendance,
  AttendanceStatus,
  AttendanceWithEmployee,
  NewAttendance,
} from '../../types/attendance';

const JOINED_SELECT = `
  SELECT a.*, e.name AS emp_name, e.wage_type, e.wage_amt, e.status AS emp_status
  FROM attendance a
  JOIN employees e ON e.id = a.emp_id`;

/**
 * Inserts or updates the single row that exists per (Saathi, date).
 * The UNIQUE(emp_id, date) constraint makes this safe to call repeatedly, so
 * the manual-entry form never creates duplicates for the same day.
 */
export async function upsertAttendance(entry: NewAttendance): Promise<number> {
  const db = await getDb();
  const res = await db.runAsync(
    `INSERT INTO attendance
       (emp_id, date, time_in, time_out, status, remarks, entry_type, entered_by)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(emp_id, date) DO UPDATE SET
       time_in    = excluded.time_in,
       time_out   = excluded.time_out,
       status     = excluded.status,
       remarks    = excluded.remarks,
       entry_type = excluded.entry_type,
       entered_by = excluded.entered_by,
       updated_at = datetime('now','localtime')`,
    entry.emp_id,
    entry.date,
    entry.time_in,
    entry.time_out,
    entry.status,
    entry.remarks,
    entry.entry_type ?? 'manual',
    entry.entered_by,
  );
  return res.lastInsertRowId;
}

/** Marks several Saathis on the same date in one transaction (bulk "Mark all"). */
export async function bulkMark(
  date: string,
  empIds: number[],
  status: AttendanceStatus,
  enteredBy: number | null,
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
  emp_id: number;
  /** Inclusive window, both YYYY-MM-DD. */
  from: string;
  to: string;
  status: AttendanceStatus;
  entered_by: number | null;
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
 * DO NOTHING rather than the upsert the manual form uses: a bulk run must never
 * overwrite an entry someone made by hand, so a day that already has a row is
 * left exactly as it is and only counted as skipped. The conflict clause - not
 * the pre-count - is what guarantees that, so nothing can slip through between
 * reading and writing. The whole window is one transaction, so a failure
 * part-way leaves the register untouched.
 */
export async function autoMarkRange(input: AutoMarkInput): Promise<AutoMarkResult> {
  const dates = listDates(input.from, input.to);
  if (dates.length === 0) return { added: 0, skipped: 0 };

  const db = await getDb();
  let added = 0;

  await db.withTransactionAsync(async () => {
    for (const date of dates) {
      const res = await db.runAsync(
        `INSERT INTO attendance
           (emp_id, date, time_in, time_out, status, remarks, entry_type, entered_by)
         VALUES (?, ?, NULL, NULL, ?, ?, 'manual', ?)
         ON CONFLICT(emp_id, date) DO NOTHING`,
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
  empId: number,
  date: string,
): Promise<Attendance | null> {
  const db = await getDb();
  return db.getFirstAsync<Attendance>(
    'SELECT * FROM attendance WHERE emp_id = ? AND date = ?',
    empId,
    date,
  );
}

export async function listByDate(date: string): Promise<AttendanceWithEmployee[]> {
  const db = await getDb();
  return db.getAllAsync<AttendanceWithEmployee>(
    `${JOINED_SELECT} WHERE a.date = ? ORDER BY e.name COLLATE NOCASE`,
    date,
  );
}

export async function listByRange(
  from: string,
  to: string,
  empId?: number | null,
): Promise<AttendanceWithEmployee[]> {
  const db = await getDb();
  if (empId) {
    return db.getAllAsync<AttendanceWithEmployee>(
      `${JOINED_SELECT} WHERE a.date BETWEEN ? AND ? AND a.emp_id = ? ORDER BY a.date DESC, e.name`,
      from,
      to,
      empId,
    );
  }
  return db.getAllAsync<AttendanceWithEmployee>(
    `${JOINED_SELECT} WHERE a.date BETWEEN ? AND ? ORDER BY a.date DESC, e.name`,
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

export async function deleteAttendance(id: number): Promise<void> {
  const db = await getDb();
  await db.runAsync('DELETE FROM attendance WHERE id = ?', id);
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
     WHERE date BETWEEN ? AND ?
     GROUP BY date`,
    from,
    to,
  );
}

export interface StatusCount {
  status: AttendanceStatus;
  count: number;
}

export async function countByStatus(from: string, to: string, empId?: number | null) {
  const db = await getDb();
  if (empId) {
    return db.getAllAsync<StatusCount>(
      'SELECT status, COUNT(*) AS count FROM attendance WHERE date BETWEEN ? AND ? AND emp_id = ? GROUP BY status',
      from,
      to,
      empId,
    );
  }
  return db.getAllAsync<StatusCount>(
    'SELECT status, COUNT(*) AS count FROM attendance WHERE date BETWEEN ? AND ? GROUP BY status',
    from,
    to,
  );
}

/** Saathis with no row for the given date - drives the "pending today" nudge. */
export async function listUnmarkedOn(
  date: string,
  createdBy?: number | null,
): Promise<{ id: number; name: string }[]> {
  const db = await getDb();
  const args: (string | number)[] = [date];
  let creatorClause = '';
  if (createdBy != null) {
    creatorClause = ' AND e.created_by = ?';
    args.push(createdBy);
  }
  args.push(date, date);
  return db.getAllAsync<{ id: number; name: string }>(
    `SELECT e.id, e.name
     FROM employees e
     WHERE e.status = 'active'
       AND NOT EXISTS (SELECT 1 FROM attendance a WHERE a.emp_id = e.id AND a.date = ?)
       ${creatorClause}
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
  createdBy?: number | null;
  empId?: number | null;
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
  const { from, to, createdBy, empId } = filter;

  const where = ['a.date BETWEEN ? AND ?'];
  const args: (string | number)[] = [from, to];

  if (createdBy != null) {
    where.push('e.created_by = ?');
    args.push(createdBy);
  }
  if (empId != null) {
    where.push('a.emp_id = ?');
    args.push(empId);
  }

  return db.getAllAsync<AttendanceWithEmployee>(
    `${JOINED_SELECT} WHERE ${where.join(' AND ')}
     ORDER BY a.date DESC, e.name COLLATE NOCASE`,
    ...args,
  );
}

/** One joined row by its own id - what the Attendance Detail screen shows. */
export async function getAttendanceById(
  id: number,
): Promise<AttendanceWithEmployee | null> {
  const db = await getDb();
  return db.getFirstAsync<AttendanceWithEmployee>(
    `${JOINED_SELECT} WHERE a.id = ?`,
    id,
  );
}

export interface AttendanceEdit {
  emp_id: number;
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
 */
export async function updateAttendance(id: number, edit: AttendanceEdit): Promise<void> {
  const db = await getDb();

  const clash = await db.getFirstAsync<{ id: number }>(
    'SELECT id FROM attendance WHERE emp_id = ? AND date = ? AND id <> ?',
    edit.emp_id,
    edit.date,
    id,
  );
  if (clash) {
    throw new Error('That Saathi is already marked on that date.');
  }

  await db.runAsync(
    'UPDATE attendance SET emp_id = ?, date = ?, status = ? WHERE id = ?',
    edit.emp_id,
    edit.date,
    edit.status,
    id,
  );
}
