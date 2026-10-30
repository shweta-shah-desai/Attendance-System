import { getDb } from '../client';

/**
 * The local side of the sync engine: reading the outbound queue, clearing it,
 * and writing rows that came down from the cloud.
 *
 * It lives in the db layer with the other queries so every SQL string in the
 * app stays in one place (scripts/check-sql.mjs scans these files, and the web
 * wa-sqlite build is SQLITE_DQS=0). The network half - what the cloud columns
 * are called, when to run - is src/services/sync.ts.
 */

/** The three syncable tables. `settings` and `holidays` stay device-local. */
export const SYNC_TABLES = ['users', 'employees', 'attendance'] as const;
export type SyncTable = (typeof SYNC_TABLES)[number];

export type Row = Record<string, unknown>;

/**
 * Table names are interpolated into SQL, so they are checked against the
 * frozen list above rather than trusted - even though every caller passes a
 * literal from the union type today.
 */
function table(name: SyncTable): string {
  if (!SYNC_TABLES.includes(name)) throw new Error(`Not a syncable table: ${name}`);
  return name;
}

/**
 * `users` is scoped by `id` because the local register holds exactly one
 * account row, the signed-in one; the other two are scoped by `owner_id`.
 */
const ownerColumn = (name: SyncTable) => (name === 'users' ? 'id' : 'owner_id');

/** Rows waiting to be pushed, oldest edit first. */
export async function listPending(name: SyncTable, ownerId: string): Promise<Row[]> {
  const db = await getDb();
  const t = table(name);
  return db.getAllAsync<Row>(
    `SELECT * FROM ${t} WHERE pending_sync = 1 AND ${ownerColumn(name)} = ? ORDER BY updated_at`,
    ownerId,
  );
}

/**
 * Marks exactly the listed ids as pushed.
 *
 * The id list matters: a blanket `WHERE pending_sync = 1` would also clear a
 * row the user edited while the upload was in flight, and that edit would
 * never reach the cloud. Since v3 the touch trigger ignores a flag-only
 * write, so this no longer re-dirties what it just cleaned.
 */
export async function clearPending(name: SyncTable, ids: string[]): Promise<void> {
  if (ids.length === 0) return;
  const db = await getDb();
  const t = table(name);
  // SQLite caps bound parameters per statement (999 by default), and a first
  // sync after a long offline stretch can carry more ids than that.
  for (let i = 0; i < ids.length; i += 200) {
    const chunk = ids.slice(i, i + 200);
    const holes = chunk.map(() => '?').join(', ');
    await db.runAsync(`UPDATE ${t} SET pending_sync = 0 WHERE id IN (${holes})`, ...chunk);
  }
}

/** How many local rows are still waiting - the number the header shows. */
export async function countPending(ownerId: string): Promise<number> {
  const db = await getDb();
  let total = 0;
  for (const name of SYNC_TABLES) {
    const row = await db.getFirstAsync<{ n: number }>(
      `SELECT COUNT(*) AS n FROM ${table(name)} WHERE pending_sync = 1 AND ${ownerColumn(name)} = ?`,
      ownerId,
    );
    total += row?.n ?? 0;
  }
  return total;
}

/**
 * Writes rows pulled from the cloud into SQLite, newest write winning.
 *
 * The `WHERE excluded.updated_at > <table>.updated_at` on the conflict clause
 * is the whole conflict-resolution policy: an incoming row that is older than
 * what this device already holds is ignored, so a pull cannot undo an edit the
 * user has just made and not yet pushed. It also keeps the touch trigger out
 * of the way, since a row whose timestamp is unchanged is never written.
 *
 * `pending_sync = 0`: these rows came *from* the server, so marking them dirty
 * would push the server's own data straight back at it.
 */
export async function upsertPulled(
  name: SyncTable,
  columns: string[],
  rows: Row[],
): Promise<number> {
  if (rows.length === 0) return 0;
  const db = await getDb();
  const t = table(name);

  const cols = [...columns, 'pending_sync'];
  const holes = cols.map(() => '?').join(', ');
  const updates = [
    ...columns.filter((c) => c !== 'id').map((c) => `${c} = excluded.${c}`),
    'pending_sync = 0',
  ].join(', ');

  const sql =
    `INSERT INTO ${t} (${cols.join(', ')}) VALUES (${holes}) ` +
    `ON CONFLICT(id) DO UPDATE SET ${updates} WHERE excluded.updated_at > ${t}.updated_at`;

  let written = 0;
  for (const row of rows) {
    // One mark per Saathi per day is a UNIQUE on (emp_id, date), which a row
    // from another device can collide with under a different uuid. Settle that
    // the same last-write-wins way before the insert, or the whole pull fails
    // on a constraint the conflict clause above cannot see.
    if (name === 'attendance' && !(await resolveDateClash(row))) continue;

    const res = await db.runAsync(sql, ...columns.map((c) => (row[c] ?? null) as never), 0);
    written += res.changes;
  }
  return written;
}

/**
 * Returns false if the incoming attendance row should be dropped because this
 * device holds a newer mark for the same Saathi and date; otherwise clears the
 * losing local row out of the way and returns true.
 */
async function resolveDateClash(row: Row): Promise<boolean> {
  const db = await getDb();
  const clash = await db.getFirstAsync<{ id: string; updated_at: string }>(
    'SELECT id, updated_at FROM attendance WHERE emp_id = ? AND date = ? AND id <> ?',
    row.emp_id as string,
    row.date as string,
    row.id as string,
  );
  if (!clash) return true;
  if (clash.updated_at >= (row.updated_at as string)) return false;

  // A hard delete, not a soft one: this row is not a record the user deleted,
  // it is a duplicate of the incoming one that lost the timestamp comparison.
  // Soft-deleting it would push a tombstone for the day that is still marked.
  await db.runAsync('DELETE FROM attendance WHERE id = ?', clash.id);
  return true;
}

/**
 * Hands every row on this device to the signed-in account - the one-shot
 * Phase 6 step for a register that existed before the cloud did.
 *
 * Those rows carry the locally-minted owner id the app used before signup, so
 * `listPending` scopes them out and they would never be backed up. Re-stamping
 * them with the real `auth.uid()` is what starts their upload; `pending_sync`
 * goes to 1 so the ordinary push carries them, with no bespoke upload path.
 *
 * It is written to be safely repeatable: a second run matches nothing, which
 * is what lets the caller retry a failed first sync.
 *
 * It adopts rows belonging to *any* other local id, not just one. A device
 * whose database holds two pre-cloud households lumps them into this account -
 * deliberate, since this is the only data on the phone and the person holding
 * it is its owner, but it is also why the count is surfaced to the user rather
 * than applied silently.
 */
export async function adoptLocalData(ownerId: string): Promise<number> {
  const db = await getDb();

  // entered_by first: the owner_id updates below set pending_sync themselves,
  // and this one wants the touch trigger to queue the row for it.
  await db.runAsync(
    'UPDATE attendance SET entered_by = ? WHERE entered_by IS NOT NULL AND entered_by <> ?',
    ownerId,
    ownerId,
  );

  let adopted = 0;
  for (const name of ['employees', 'attendance'] as const) {
    const res = await db.runAsync(
      `UPDATE ${table(name)} SET owner_id = ?, pending_sync = 1 WHERE owner_id <> ?`,
      ownerId,
      ownerId,
    );
    adopted += res.changes;
  }

  // The pre-cloud account row itself. Supabase owns identity now, so a second
  // local users row would just be a stale copy of a person's name.
  await db.runAsync('DELETE FROM users WHERE id <> ?', ownerId);
  return adopted;
}
