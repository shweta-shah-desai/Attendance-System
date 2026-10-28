import { randomUUID } from 'expo-crypto';
import { getDb } from '../client';
import type { Employee, NewEmployee } from '../../types/attendance';

export interface EmployeeFilter {
  ownerId?: string | null;
  status?: 'active' | 'inactive' | 'all';
  search?: string;
  sort?: 'name_asc' | 'name_desc' | 'wage_desc' | 'wage_asc' | 'recent';
}

const ORDER_BY: Record<NonNullable<EmployeeFilter['sort']>, string> = {
  name_asc: 'name COLLATE NOCASE ASC',
  name_desc: 'name COLLATE NOCASE DESC',
  wage_desc: 'wage_amt DESC',
  wage_asc: 'wage_amt ASC',
  recent: 'datetime(created_at) DESC',
};

/**
 * Since v2 a delete only stamps `deleted_at`, so every read has to exclude
 * those rows or a removed Saathi reappears in a list, a dropdown or a wage
 * report. This constant is the single place that clause is spelled.
 */
const LIVE = 'deleted_at IS NULL';

export async function listEmployees(filter: EmployeeFilter = {}): Promise<Employee[]> {
  const db = await getDb();
  const { ownerId, status = 'all', search, sort = 'name_asc' } = filter;

  const where: string[] = [LIVE];
  const args: (string | number)[] = [];

  if (ownerId != null) {
    where.push('owner_id = ?');
    args.push(ownerId);
  }
  if (status !== 'all') {
    where.push('status = ?');
    args.push(status);
  }
  if (search && search.trim()) {
    where.push('name LIKE ? COLLATE NOCASE');
    args.push(`%${search.trim()}%`);
  }

  const sql = `SELECT * FROM employees WHERE ${where.join(' AND ')} ORDER BY ${ORDER_BY[sort]}`;

  return db.getAllAsync<Employee>(sql, ...args);
}

/** Saathis that can be marked on a given date (active, and within their tenure). */
export async function listWorkingEmployees(
  ownerId?: string | null,
  onDate?: string,
): Promise<Employee[]> {
  const db = await getDb();
  const args: (string | number)[] = [];
  const where = [LIVE, "status = 'active'"];

  if (ownerId != null) {
    where.push('owner_id = ?');
    args.push(ownerId);
  }
  if (onDate) {
    // Single quotes matter: the wa-sqlite build behind expo-sqlite on web is
    // compiled with SQLITE_DQS=0, so "" is parsed as an identifier and the
    // whole query fails with 'no such column: ""'. Native SQLite defaults to
    // the permissive DQS=3 and happens to accept it, which is why this only
    // ever broke on web.
    where.push("(start_date IS NULL OR start_date = '' OR start_date <= ?)");
    args.push(onDate);
    where.push("(end_date IS NULL OR end_date = '' OR end_date >= ?)");
    args.push(onDate);
  }

  return db.getAllAsync<Employee>(
    `SELECT * FROM employees WHERE ${where.join(' AND ')} ORDER BY name COLLATE NOCASE`,
    ...args,
  );
}

export async function getEmployee(id: string): Promise<Employee | null> {
  const db = await getDb();
  return db.getFirstAsync<Employee>(
    `SELECT * FROM employees WHERE id = ? AND ${LIVE}`,
    id,
  );
}

/**
 * Duplicate guard for the New Saathi form: the same household should not end
 * up with two rows for one phone number (typed twice by mistake).
 */
export async function findEmployeeByPhone(
  phone: string,
  ownerId?: string | null,
): Promise<Employee | null> {
  if (!phone) return null;
  const db = await getDb();
  const args: (string | number)[] = [phone];
  let clause = `phone = ? AND ${LIVE}`;
  if (ownerId != null) {
    clause += ' AND owner_id = ?';
    args.push(ownerId);
  }
  return db.getFirstAsync<Employee>(
    `SELECT * FROM employees WHERE ${clause} LIMIT 1`,
    ...args,
  );
}

/** Returns the UUID it minted, since there is no autoincrement id to read back. */
export async function createEmployee(emp: NewEmployee): Promise<string> {
  const db = await getDb();
  const id = randomUUID();
  await db.runAsync(
    `INSERT INTO employees
      (id, owner_id, name, phone, resi_address, status, remarks, start_date, end_date, wage_type, wage_amt)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    id,
    emp.owner_id,
    emp.name,
    emp.phone ?? '',
    emp.resi_address,
    emp.status,
    emp.remarks,
    emp.start_date,
    emp.end_date,
    emp.wage_type,
    emp.wage_amt,
  );
  return id;
}

export async function updateEmployee(id: string, emp: Partial<NewEmployee>): Promise<void> {
  const entries = Object.entries(emp).filter(([, v]) => v !== undefined);
  if (entries.length === 0) return;
  const db = await getDb();
  const sets = entries.map(([k]) => `${k} = ?`).join(', ');
  await db.runAsync(
    `UPDATE employees SET ${sets} WHERE id = ?`,
    ...entries.map(([, v]) => v as string | number | null),
    id,
  );
}

/** Soft toggle between Working / Not working. */
export async function setEmployeeStatus(
  id: string,
  status: 'active' | 'inactive',
): Promise<void> {
  const db = await getDb();
  await db.runAsync('UPDATE employees SET status = ? WHERE id = ?', status, id);
}

/**
 * Removes the Saathi and all of their attendance.
 *
 * Since v2 this stamps `deleted_at` instead of deleting: a hard DELETE is
 * invisible to a pull-based sync, so another device would resurrect the row.
 * The attendance rows have to be stamped explicitly - ON DELETE CASCADE no
 * longer fires, because nothing is actually being deleted.
 */
export async function deleteEmployee(id: string): Promise<void> {
  const db = await getDb();
  await db.withTransactionAsync(async () => {
    await db.runAsync(
      "UPDATE attendance SET deleted_at = datetime('now','localtime') WHERE emp_id = ? AND deleted_at IS NULL",
      id,
    );
    await db.runAsync(
      "UPDATE employees SET deleted_at = datetime('now','localtime') WHERE id = ? AND deleted_at IS NULL",
      id,
    );
  });
}

export async function countEmployees(
  ownerId?: string | null,
): Promise<{ active: number; inactive: number; total: number }> {
  const db = await getDb();
  const clause = ownerId != null ? ` AND owner_id = ?` : '';
  const args = ownerId != null ? [ownerId] : [];
  const row = await db.getFirstAsync<{ active: number; inactive: number; total: number }>(
    `SELECT
       COALESCE(SUM(status = 'active'), 0)   AS active,
       COALESCE(SUM(status = 'inactive'), 0) AS inactive,
       COUNT(*)                              AS total
     FROM employees WHERE ${LIVE}${clause}`,
    ...args,
  );
  return row ?? { active: 0, inactive: 0, total: 0 };
}
