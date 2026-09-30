import { getDb } from '../client';
import type { Employee, NewEmployee } from '../../types/attendance';

export interface EmployeeFilter {
  createdBy?: number | null;
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

export async function listEmployees(filter: EmployeeFilter = {}): Promise<Employee[]> {
  const db = await getDb();
  const { createdBy, status = 'all', search, sort = 'name_asc' } = filter;

  const where: string[] = [];
  const args: (string | number)[] = [];

  if (createdBy != null) {
    where.push('created_by = ?');
    args.push(createdBy);
  }
  if (status !== 'all') {
    where.push('status = ?');
    args.push(status);
  }
  if (search && search.trim()) {
    where.push('name LIKE ? COLLATE NOCASE');
    args.push(`%${search.trim()}%`);
  }

  const sql = `SELECT * FROM employees${
    where.length ? ` WHERE ${where.join(' AND ')}` : ''
  } ORDER BY ${ORDER_BY[sort]}`;

  return db.getAllAsync<Employee>(sql, ...args);
}

/** Saathis that can be marked on a given date (active, and within their tenure). */
export async function listWorkingEmployees(
  createdBy?: number | null,
  onDate?: string,
): Promise<Employee[]> {
  const db = await getDb();
  const args: (string | number)[] = [];
  const where = ["status = 'active'"];

  if (createdBy != null) {
    where.push('created_by = ?');
    args.push(createdBy);
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

export async function getEmployee(id: number): Promise<Employee | null> {
  const db = await getDb();
  return db.getFirstAsync<Employee>('SELECT * FROM employees WHERE id = ?', id);
}

/**
 * Duplicate guard for the New Saathi form: the same household should not end
 * up with two rows for one phone number (typed twice by mistake).
 */
export async function findEmployeeByPhone(
  phone: string,
  createdBy?: number | null,
): Promise<Employee | null> {
  if (!phone) return null;
  const db = await getDb();
  const args: (string | number)[] = [phone];
  let clause = 'phone = ?';
  if (createdBy != null) {
    clause += ' AND created_by = ?';
    args.push(createdBy);
  }
  return db.getFirstAsync<Employee>(
    `SELECT * FROM employees WHERE ${clause} LIMIT 1`,
    ...args,
  );
}

export async function createEmployee(emp: NewEmployee): Promise<number> {
  const db = await getDb();
  const res = await db.runAsync(
    `INSERT INTO employees
      (name, phone, resi_address, status, remarks, start_date, end_date, wage_type, wage_amt, created_by)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    emp.name,
    emp.phone ?? '',
    emp.resi_address,
    emp.status,
    emp.remarks,
    emp.start_date,
    emp.end_date,
    emp.wage_type,
    emp.wage_amt,
    emp.created_by,
  );
  return res.lastInsertRowId;
}

export async function updateEmployee(id: number, emp: Partial<NewEmployee>): Promise<void> {
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
  id: number,
  status: 'active' | 'inactive',
): Promise<void> {
  const db = await getDb();
  await db.runAsync('UPDATE employees SET status = ? WHERE id = ?', status, id);
}

/** Removes the Saathi and, via ON DELETE CASCADE, all of their attendance. */
export async function deleteEmployee(id: number): Promise<void> {
  const db = await getDb();
  await db.runAsync('DELETE FROM employees WHERE id = ?', id);
}

export async function countEmployees(
  createdBy?: number | null,
): Promise<{ active: number; inactive: number; total: number }> {
  const db = await getDb();
  const clause = createdBy != null ? 'WHERE created_by = ?' : '';
  const args = createdBy != null ? [createdBy] : [];
  const row = await db.getFirstAsync<{ active: number; inactive: number; total: number }>(
    `SELECT
       COALESCE(SUM(status = 'active'), 0)   AS active,
       COALESCE(SUM(status = 'inactive'), 0) AS inactive,
       COUNT(*)                              AS total
     FROM employees ${clause}`,
    ...args,
  );
  return row ?? { active: 0, inactive: 0, total: 0 };
}
