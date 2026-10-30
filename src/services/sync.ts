/**
 * The sync engine: mirrors local SQLite to Supabase and back.
 *
 * It sits entirely beneath the repository boundary. Every screen and hook
 * keeps reading `src/db/queries/*`, so nothing above this file knows the cloud
 * exists - which is what makes the app work the same offline.
 *
 * Shape of a cycle, per table, parents before children so foreign keys
 * resolve: push the dirty rows up, then pull everything changed since the
 * stored cursor down. Conflicts are settled last-write-wins on `updated_at`.
 * That is honest about its cost: if two devices mark the same Saathi on the
 * same day, one mark loses. For one household with rarely two devices at once,
 * and a UNIQUE(emp_id, date) that already means one mark per day, that is a
 * better trade than a merge UI nobody asked for.
 *
 * Nothing here ever throws at a caller. A sync failure must not surface as a
 * broken screen, because the local write it was carrying already succeeded.
 */
import {
  adoptLocalData,
  clearPending,
  countPending,
  listPending,
  upsertPulled,
  type Row,
  type SyncTable,
} from '../db/queries/sync';
import { getSetting, setSetting } from '../db/queries/settings';
import { useSyncStore } from '../store/syncStore';
import { fromDbStamp, nowStamp, toDbStamp } from '../utils/date';
import { isCloudConfigured, isOfflineError, supabase } from './supabase';

interface TableSpec {
  local: SyncTable;
  /** Supabase owns identity, so local `users` is cloud `profiles`. */
  remote: 'profiles' | 'employees' | 'attendance';
  /**
   * Columns both sides share. Deliberately excluded:
   * - `pending_sync` is this device's queue, meaningless to anyone else
   * - `attendance.entered_by` has no cloud column; with one account per
   *   household it is always the owner, so nothing is lost by keeping it local
   * - `profiles` has no `deleted_at` - an account is deleted through auth
   */
  columns: string[];
}

/** Push order is parents first; pull reuses it so a child never lands early. */
const SPECS: TableSpec[] = [
  {
    local: 'users',
    remote: 'profiles',
    columns: ['id', 'name', 'phone', 'email_id', 'resi_address', 'status'],
  },
  {
    local: 'employees',
    remote: 'employees',
    columns: [
      'id',
      'owner_id',
      'name',
      'phone',
      'resi_address',
      'status',
      'remarks',
      'start_date',
      'end_date',
      'wage_type',
      'wage_amt',
      'deleted_at',
    ],
  },
  {
    local: 'attendance',
    remote: 'attendance',
    columns: [
      'id',
      'owner_id',
      'emp_id',
      'date',
      'time_in',
      'time_out',
      'status',
      'remarks',
      'entry_type',
      'deleted_at',
    ],
  },
];

/** Rows per network round trip, both directions. */
const PAGE = 400;
/** Postgres duplicate-key SQLSTATE - the (emp_id, date) clash. */
const UNIQUE_VIOLATION = '23505';
const cursorKey = (spec: TableSpec) => `sync.cursor.${spec.local}`;
const EPOCH = '1970-01-01T00:00:00.000Z';
/**
 * One-shot flag for Phase 6. Set only after the cycle that carried the adopted
 * rows has fully succeeded, so an interrupted first sync retries instead of
 * silently marking the device migrated with its register still unsent.
 */
const MIGRATED_KEY = 'sync.migrated';

export type SyncOutcome =
  | { ok: true; pushed: number; pulled: number }
  | {
      ok: false;
      reason: 'not-configured' | 'signed-out' | 'offline' | 'failed' | 'throttled';
      message?: string;
    };

/** Only one cycle at a time; overlapping triggers join the one in flight. */
let inFlight: Promise<SyncOutcome> | null = null;
let debounce: ReturnType<typeof setTimeout> | null = null;
let lastRunAt = 0;
/**
 * Startup fires from two places on purpose - the session restore and the
 * splash, since only one of them runs on an offline start - and this stops
 * that from costing two round trips.
 */
const MIN_GAP_MS = 5000;

/**
 * Runs one full sync cycle. Resolves - never rejects - so callers can fire it
 * and forget it. `force` is for the explicit gesture (pull-to-refresh), which
 * must always do something visible.
 */
export function syncNow(options: { force?: boolean } = {}): Promise<SyncOutcome> {
  if (inFlight) return inFlight;
  if (!options.force && Date.now() - lastRunAt < MIN_GAP_MS) {
    return Promise.resolve<SyncOutcome>({ ok: false, reason: 'throttled' });
  }
  inFlight = runCycle().finally(() => {
    inFlight = null;
    lastRunAt = Date.now();
  });
  return inFlight;
}

/**
 * Coalesces the bursts that follow a write - Auto Hajari can mark a month in
 * one go - into a single cycle a moment later.
 */
export function scheduleSync(delayMs = 1200): void {
  if (debounce) clearTimeout(debounce);
  debounce = setTimeout(() => {
    debounce = null;
    void syncNow();
  }, delayMs);
}

async function runCycle(): Promise<SyncOutcome> {
  if (!isCloudConfigured()) return { ok: false, reason: 'not-configured' };

  const { data } = await supabase.auth.getSession();
  const uid = data.session?.user.id;
  if (!uid) return { ok: false, reason: 'signed-out' };

  useSyncStore.getState().started();

  let pushed = 0;
  let pulled = 0;
  try {
    // Phase 6: a register written before this account existed is handed over
    // before the first push, so the ordinary push is what uploads it.
    const firstRun = (await getSetting(MIGRATED_KEY)) !== '1';
    const adopted = firstRun ? await adoptLocalData(uid) : 0;

    for (const spec of SPECS) pushed += await pushTable(spec, uid);
    for (const spec of SPECS) pulled += await pullTable(spec, uid);

    if (firstRun) {
      await setSetting(MIGRATED_KEY, '1');
      // Worth saying out loud: the user never asked for their old records to
      // join this account, so they are told that it happened.
      if (adopted > 0) useSyncStore.getState().noteAdopted(adopted);
    }

    useSyncStore.getState().succeeded(nowStamp(), await countPending(uid));
    return { ok: true, pushed, pulled };
  } catch (e) {
    const offline = isOfflineError(e);
    const message = offline
      ? 'No connection - your changes are saved on this phone.'
      : e instanceof Error
        ? e.message
        : 'Sync failed';
    // Pending rows stay dirty, so the next cycle retries them. Nothing is
    // lost by a failure here; it only delays the backup.
    useSyncStore.getState().failed(message, await countPending(uid).catch(() => 0));
    return { ok: false, reason: offline ? 'offline' : 'failed', message };
  }
}

/** Local -> cloud. Returns how many rows were accepted. */
async function pushTable(spec: TableSpec, uid: string): Promise<number> {
  const rows = await listPending(spec.local, uid);
  if (rows.length === 0) return 0;

  let accepted = 0;
  for (let i = 0; i < rows.length; i += PAGE) {
    const batch = rows.slice(i, i + PAGE);
    const payload = batch.map((r) => toRemote(spec, r));

    const { error } = await supabase.from(spec.remote).upsert(payload);
    if (!error) {
      await clearPending(
        spec.local,
        batch.map((r) => r.id as string),
      );
      accepted += batch.length;
      continue;
    }

    // One bad row must not strand the rest of the queue behind it, so a
    // duplicate-key rejection is retried row by row.
    if (error.code !== UNIQUE_VIOLATION) throw error;
    accepted += await pushRowByRow(spec, batch);
  }
  return accepted;
}

/**
 * Re-pushes a rejected batch one row at a time. A row the server refuses as a
 * duplicate is cleared anyway: the cloud already holds a mark for that Saathi
 * and date, and the pull that follows brings the winner back down. Leaving it
 * dirty would wedge every later sync behind a row that can never be accepted.
 */
async function pushRowByRow(spec: TableSpec, batch: Row[]): Promise<number> {
  let accepted = 0;
  const settled: string[] = [];
  for (const row of batch) {
    const { error } = await supabase.from(spec.remote).upsert(toRemote(spec, row));
    if (error && error.code !== UNIQUE_VIOLATION) throw error;
    settled.push(row.id as string);
    if (!error) accepted += 1;
  }
  await clearPending(spec.local, settled);
  return accepted;
}

/**
 * Maps a local row to the cloud column set.
 *
 * `owner_id` is forced to the signed-in account only in the sense that
 * `listPending` already filtered on it - pushing a row with someone else's
 * owner would be rejected by Row Level Security anyway, which is the backstop.
 *
 * `updated_at` is never sent: the server maintains it with its own trigger, so
 * it is the one clock both devices agree on, and the pull cursors depend on
 * that. `created_at` is sent, converted out of the local stamp format, so a
 * row written offline three days ago keeps its real birthday.
 */
function toRemote(spec: TableSpec, row: Row): Row {
  const out: Row = {};
  for (const c of spec.columns) out[c] = row[c] ?? null;
  if (typeof row.created_at === 'string') out.created_at = fromDbStamp(row.created_at);
  if (typeof row.deleted_at === 'string' && spec.columns.includes('deleted_at')) {
    out.deleted_at = fromDbStamp(row.deleted_at);
  }
  return out;
}

/** Cloud -> local, from the stored cursor forward. Returns rows written. */
async function pullTable(spec: TableSpec, uid: string): Promise<number> {
  let cursor = (await getSetting(cursorKey(spec))) ?? EPOCH;
  let written = 0;

  // Keep paging while the server fills a page; a short page means caught up.
  for (;;) {
    let query = supabase
      .from(spec.remote)
      .select('*')
      .gt('updated_at', cursor)
      .order('updated_at', { ascending: true })
      .limit(PAGE);

    // RLS already restricts rows to this account; the explicit filter keeps
    // the pull honest if a policy is ever loosened by mistake.
    query = spec.remote === 'profiles' ? query.eq('id', uid) : query.eq('owner_id', uid);

    const { data, error } = await query;
    if (error) throw error;
    const batch = data ?? [];
    if (batch.length === 0) break;

    written += await upsertPulled(spec.local, [...spec.columns, 'created_at', 'updated_at'],
      batch.map((r) => toLocal(spec, r as Row)));

    // The newest timestamp received becomes the next cursor. Rows are ordered,
    // so that is the last one in the page.
    const newest = (batch[batch.length - 1] as Row).updated_at as string;
    if (!newest || newest === cursor) break;
    cursor = newest;
    await setSetting(cursorKey(spec), cursor);

    if (batch.length < PAGE) break;
  }
  return written;
}

/**
 * Maps a cloud row to the local column set, converting the tz-aware
 * timestamps into the local stamp format SQLite stores. A soft-deleted row is
 * written like any other - `deleted_at` is just a column, and every read query
 * already filters on it.
 */
function toLocal(spec: TableSpec, row: Row): Row {
  const out: Row = {};
  for (const c of spec.columns) out[c] = row[c] ?? null;
  for (const c of ['created_at', 'updated_at', 'deleted_at']) {
    const v = row[c];
    out[c] = typeof v === 'string' ? toDbStamp(v) : null;
  }
  // The local account row is keyed by the auth uid and has no cloud column for
  // these, so they keep whatever the device already holds.
  if (spec.local === 'users') delete out.deleted_at;
  return out;
}

/** Refreshes just the "changes waiting" number, without touching the network. */
export async function refreshPendingCount(ownerId: string | null): Promise<void> {
  if (!ownerId) return;
  try {
    useSyncStore.getState().setPendingCount(await countPending(ownerId));
  } catch {
    // A failed count is cosmetic; never let it bubble into a screen.
  }
}
