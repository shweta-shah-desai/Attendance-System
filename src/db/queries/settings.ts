import { getDb } from '../client';

export async function getSetting(key: string): Promise<string | null> {
  const db = await getDb();
  const row = await db.getFirstAsync<{ value: string | null }>(
    'SELECT value FROM settings WHERE key = ?',
    key,
  );
  return row?.value ?? null;
}

export async function setSetting(key: string, value: string): Promise<void> {
  const db = await getDb();
  await db.runAsync(
    'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
    key,
    value,
  );
}

export async function getAllSettings(): Promise<Record<string, string>> {
  const db = await getDb();
  const rows = await db.getAllAsync<{ key: string; value: string | null }>(
    'SELECT key, value FROM settings',
  );
  return rows.reduce<Record<string, string>>((acc, r) => {
    acc[r.key] = r.value ?? '';
    return acc;
  }, {});
}

/** Weekly off days as day indexes (0 = Sunday). */
export async function getWeekOffDays(): Promise<number[]> {
  const raw = await getSetting('week_off_days');
  if (!raw) return [0];
  return raw
    .split(',')
    .map((s) => Number(s.trim()))
    .filter((n) => Number.isInteger(n) && n >= 0 && n <= 6);
}
