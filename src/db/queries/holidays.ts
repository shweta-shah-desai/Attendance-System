import { getDb } from '../client';
import type { Holiday } from '../../types/attendance';

/**
 * Holidays are deliberately device-local: they are a public calendar, not the
 * user's data, so there is nothing to back up and nothing to isolate per
 * household. `holidays` is absent from SYNC_TABLES for that reason, and a
 * device that loses them simply fetches them again.
 *
 * Only the current year is kept. Everything else is deleted on every refresh,
 * which is also what clears last year's list the first time the app is opened
 * in January.
 */

/** Rows for one year, earliest first. */
export async function listHolidays(year: number): Promise<Holiday[]> {
  const db = await getDb();
  return db.getAllAsync<Holiday>(
    "SELECT * FROM holidays WHERE date LIKE ? || '-%' ORDER BY date",
    String(year),
  );
}

export async function countHolidays(year: number): Promise<number> {
  const db = await getDb();
  const row = await db.getFirstAsync<{ n: number }>(
    "SELECT COUNT(*) AS n FROM holidays WHERE date LIKE ? || '-%'",
    String(year),
  );
  return row?.n ?? 0;
}

/**
 * Replaces the stored list with one year's holidays, in a single transaction.
 *
 * Any row outside `year` goes, so the table never holds two years at once.
 * The whole thing is one transaction so a failure part-way cannot leave the
 * screen showing half of last year and half of this one; the old list stays
 * until the new one is complete.
 */
export async function replaceYear(
  year: number,
  rows: Array<{ date: string; name: string; region?: string | null }>,
): Promise<number> {
  const db = await getDb();
  let written = 0;

  await db.withTransactionAsync(async () => {
    await db.runAsync("DELETE FROM holidays WHERE date NOT LIKE ? || '-%'", String(year));
    await db.runAsync("DELETE FROM holidays WHERE date LIKE ? || '-%'", String(year));

    for (const row of rows) {
      // Two holidays can share a date (the calendar lists observances
      // alongside the holiday itself); `date` is UNIQUE, so the first name
      // wins and the duplicate is ignored rather than failing the import.
      const res = await db.runAsync(
        `INSERT INTO holidays (date, name, region) VALUES (?, ?, ?)
         ON CONFLICT(date) DO NOTHING`,
        row.date,
        row.name,
        row.region ?? null,
      );
      written += res.changes;
    }
  });

  return written;
}
