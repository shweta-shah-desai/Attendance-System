/**
 * Placeholder sync client.
 *
 * GharSaathi+ is fully offline-first: every screen reads and writes SQLite and
 * nothing here is called at runtime. It exists so a future server sync can be
 * dropped in without touching the screens - point EXPO_PUBLIC_API_BASE_URL at
 * a backend and implement the two functions below.
 */
const BASE_URL = process.env.EXPO_PUBLIC_API_BASE_URL ?? '';

export const isSyncConfigured = (): boolean => BASE_URL.length > 0;

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  if (!isSyncConfigured()) throw new Error('Cloud sync is not configured');
  const res = await fetch(`${BASE_URL}${path}`, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...(init?.headers ?? {}) },
  });
  if (!res.ok) throw new Error(`Sync failed (${res.status})`);
  return (await res.json()) as T;
}

export const pushAttendance = (rows: unknown[]) =>
  request<{ accepted: number }>('/attendance/bulk', {
    method: 'POST',
    body: JSON.stringify({ rows }),
  });

export const pullSince = (isoTimestamp: string) =>
  request<{ rows: unknown[] }>(`/attendance?since=${encodeURIComponent(isoTimestamp)}`);
