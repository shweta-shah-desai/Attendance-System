import { getDb } from '../client';
import type { AttendanceStatus, Employee } from '../../types/attendance';
import type { EmployeeMonthSummary, StatusTally, TrendPoint } from '../../types/report';
import { emptyTally } from '../../types/report';
import dayjs, { daysInMonth, monthEnd, monthStart } from '../../utils/date';

interface RawTallyRow {
  emp_id: number;
  name: string;
  wage_type: Employee['wage_type'];
  wage_amt: number;
  start_date: string | null;
  end_date: string | null;
  status: AttendanceStatus | null;
  count: number | null;
}

/**
 * One row per (Saathi, status) for the month, including Saathis with no
 * attendance at all so they still appear in the wage sheet.
 */
export async function monthSummaries(
  month: string,
  createdBy?: number | null,
  onlyActive = true,
): Promise<EmployeeMonthSummary[]> {
  const db = await getDb();
  const from = monthStart(month);
  const to = monthEnd(month);

  const where: string[] = [];
  const args: (string | number)[] = [from, to];
  if (createdBy != null) {
    where.push('e.created_by = ?');
    args.push(createdBy);
  }
  if (onlyActive) where.push("e.status = 'active'");

  const rows = await db.getAllAsync<RawTallyRow>(
    `SELECT e.id AS emp_id, e.name, e.wage_type, e.wage_amt, e.start_date, e.end_date,
            a.status, COUNT(a.id) AS count
     FROM employees e
     LEFT JOIN attendance a
            ON a.emp_id = e.id AND a.date BETWEEN ? AND ?
     ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
     GROUP BY e.id, a.status
     ORDER BY e.name COLLATE NOCASE`,
    ...args,
  );

  const byEmp = new Map<number, EmployeeMonthSummary>();

  for (const row of rows) {
    let summary = byEmp.get(row.emp_id);
    if (!summary) {
      summary = {
        empId: row.emp_id,
        empName: row.name,
        wageType: row.wage_type,
        wageAmt: row.wage_amt,
        tally: emptyTally(),
        payableDays: 0,
        unmarkedDays: 0,
        totalDays: tenureDaysInMonth(month, row.start_date, row.end_date),
      };
      byEmp.set(row.emp_id, summary);
    }
    if (row.status && row.count) {
      summary.tally[row.status] = row.count;
    }
  }

  return [...byEmp.values()].map((s) => {
    const marked = totalMarked(s.tally);
    s.payableDays = s.tally.Present + s.tally.WFH + s.tally['Half-day'] / 2;
    s.unmarkedDays = Math.max(0, s.totalDays - marked);
    return s;
  });
}

const totalMarked = (t: StatusTally): number =>
  (Object.values(t) as number[]).reduce((a, b) => a + b, 0);

/** How many days of the month the Saathi was actually on the books. */
function tenureDaysInMonth(
  month: string,
  startDate: string | null,
  endDate: string | null,
): number {
  const monthFirst = dayjs(monthStart(month));
  const monthLast = dayjs(monthEnd(month));
  const from = startDate ? dayjs(startDate) : monthFirst;
  const to = endDate ? dayjs(endDate) : monthLast;

  const effFrom = from.isAfter(monthFirst) ? from : monthFirst;
  const effTo = to.isBefore(monthLast) ? to : monthLast;

  if (effTo.isBefore(effFrom)) return 0;
  return effTo.diff(effFrom, 'day') + 1;
}

/** Day-by-day count of present-equivalent days - the Reports bar chart. */
export async function dailyTrend(
  from: string,
  to: string,
  empId?: number | null,
): Promise<TrendPoint[]> {
  const db = await getDb();
  const args: (string | number)[] = [from, to];
  let clause = '';
  if (empId) {
    clause = ' AND emp_id = ?';
    args.push(empId);
  }
  const rows = await db.getAllAsync<{ date: string; present: number }>(
    `SELECT date,
            COALESCE(SUM(CASE WHEN status IN ('Present','WFH') THEN 1
                              WHEN status = 'Half-day' THEN 0.5 ELSE 0 END), 0) AS present
     FROM attendance
     WHERE date BETWEEN ? AND ?${clause}
     GROUP BY date
     ORDER BY date`,
    ...args,
  );
  return rows.map((r) => ({ label: dayjs(r.date).format('DD'), value: r.present }));
}

/** Month-over-month attendance percentage for the last N months. */
export async function monthlyTrend(
  months: string[],
  empId?: number | null,
): Promise<TrendPoint[]> {
  const out: TrendPoint[] = [];
  for (const m of months) {
    const summaries = await monthSummaries(m, null, false);
    const scoped = empId ? summaries.filter((s) => s.empId === empId) : summaries;
    const worked = scoped.reduce((sum, s) => sum + s.payableDays, 0);
    const possible = scoped.reduce((sum, s) => sum + s.totalDays, 0) || 1;
    out.push({
      label: dayjs(`${m}-01`).format('MMM'),
      value: Math.round((worked / possible) * 100),
    });
  }
  return out;
}

export interface OverviewStats {
  totalSaathi: number;
  markedToday: number;
  presentToday: number;
  absentToday: number;
  pendingToday: number;
  monthPresentPct: number;
}

export async function overviewStats(
  date: string,
  month: string,
  createdBy?: number | null,
): Promise<OverviewStats> {
  const db = await getDb();
  const creator = createdBy != null ? 'AND e.created_by = ?' : '';
  const creatorArgs = createdBy != null ? [createdBy] : [];

  const today = await db.getFirstAsync<{
    total: number;
    marked: number;
    present: number;
    absent: number;
  }>(
    `SELECT
       COUNT(DISTINCT e.id)                                               AS total,
       COUNT(DISTINCT a.emp_id)                                           AS marked,
       COUNT(DISTINCT CASE WHEN a.status IN ('Present','WFH','Half-day')
                           THEN a.emp_id END)                             AS present,
       COUNT(DISTINCT CASE WHEN a.status = 'Absent' THEN a.emp_id END)    AS absent
     FROM employees e
     LEFT JOIN attendance a ON a.emp_id = e.id AND a.date = ?
     WHERE e.status = 'active' ${creator}`,
    date,
    ...creatorArgs,
  );

  const summaries = await monthSummaries(month, createdBy ?? null, true);
  const worked = summaries.reduce((s, r) => s + r.payableDays, 0);
  const possible = summaries.reduce((s, r) => s + r.totalDays, 0);

  const total = today?.total ?? 0;
  const marked = today?.marked ?? 0;

  return {
    totalSaathi: total,
    markedToday: marked,
    presentToday: today?.present ?? 0,
    absentToday: today?.absent ?? 0,
    pendingToday: Math.max(0, total - marked),
    monthPresentPct: possible > 0 ? Math.round((worked / possible) * 100) : 0,
  };
}

export const basisDaysFor = (month: string): number => daysInMonth(month);
