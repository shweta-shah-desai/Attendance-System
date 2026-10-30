import { randomUUID } from 'expo-crypto';
import { getDb } from '../client';
import type { Status, User } from '../../types/user';
import { nowIso } from '../../utils/date';

export async function findUserByPhone(phone: string): Promise<User | null> {
  const db = await getDb();
  return db.getFirstAsync<User>(
    'SELECT * FROM users WHERE phone = ? AND deleted_at IS NULL',
    phone,
  );
}

export async function getUserById(id: string): Promise<User | null> {
  const db = await getDb();
  return db.getFirstAsync<User>(
    'SELECT * FROM users WHERE id = ? AND deleted_at IS NULL',
    id,
  );
}

/**
 * The id is minted here rather than read back from the insert, since v2 keys
 * are UUIDs. Phase 3 replaces this with the Supabase `auth.uid()`; until then
 * a local account carries a locally-generated id.
 */
export async function createUser(name: string, phone: string): Promise<User> {
  const db = await getDb();
  const id = randomUUID();
  await db.runAsync(
    'INSERT INTO users (id, name, phone, status) VALUES (?, ?, ?, ?)',
    id,
    name,
    phone,
    'active',
  );
  const created = await getUserById(id);
  if (!created) throw new Error('Could not create the user record');
  return created;
}

/**
 * Mirrors the cloud `profiles` row into the local `users` table after a sign-in
 * or signup. The id IS the Supabase `auth.uid()`, so this is the row every
 * other table's `owner_id` points at.
 *
 * `pending_sync = 0` because the row just came FROM the server - marking it
 * dirty would push the server's own data straight back at it. The touch
 * trigger is sidestepped by writing `updated_at` explicitly.
 *
 * The phone collision handled first is the upgrade path, and without it the
 * app could not be upgraded at all: a device that already holds a register has
 * a pre-cloud `users` row carrying a locally-minted id and the same mobile
 * number, `phone` is UNIQUE, so this INSERT would fail and the sign-in would
 * die on "Could not save your profile on this device". The old row is dropped
 * rather than updated because its id is the thing that has to change, and
 * nothing references it with a foreign key (see the owner_id note in
 * src/db/schema.ts). Phase 6's adoption then re-points its data at the new id.
 */
export async function upsertUserFromProfile(profile: {
  id: string;
  name: string;
  phone: string;
  email_id?: string | null;
  resi_address?: string | null;
  status?: Status;
  /** auth.users.created_at, local stamp format. Used only if none is stored. */
  join_date?: string | null;
  created_at?: string;
  updated_at?: string;
}): Promise<User> {
  const db = await getDb();
  const now = nowIso();

  // join_date belongs to the phone number, not to the row, so the pre-cloud
  // row's value is carried over before that row is dropped below - otherwise
  // upgrading would reset the join date of a register years old.
  const legacy = await db.getFirstAsync<{ join_date: string | null; created_at: string }>(
    'SELECT join_date, created_at FROM users WHERE phone = ? AND id <> ?',
    profile.phone,
    profile.id,
  );
  // The EARLIEST of the candidates wins, not the incoming one. For a user
  // upgrading an existing register, auth.users.created_at is today - they only
  // just created the cloud account - while the pre-cloud row has been on the
  // phone for years. The first use of this mobile number is the older of the
  // two, so picking the incoming value would reset a years-old join date.
  const candidates = [profile.join_date, legacy?.join_date, legacy?.created_at].filter(
    (v): v is string => typeof v === 'string' && v.length > 0,
  );
  const joinDate = candidates.length > 0 ? [...candidates].sort()[0] : now;

  await db.runAsync('DELETE FROM users WHERE phone = ? AND id <> ?', profile.phone, profile.id);
  await db.runAsync(
    `INSERT INTO users (id, name, email_id, phone, resi_address, status, join_date,
                        pending_sync, deleted_at, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, 0, NULL, ?, ?)
     ON CONFLICT(id) DO UPDATE SET
       name         = excluded.name,
       email_id     = excluded.email_id,
       phone        = excluded.phone,
       resi_address = excluded.resi_address,
       status       = excluded.status,
       -- Write-once: an existing join_date always wins over the incoming one.
       join_date    = COALESCE(users.join_date, excluded.join_date),
       pending_sync = 0,
       deleted_at   = NULL,
       updated_at   = excluded.updated_at`,
    profile.id,
    profile.name,
    profile.email_id ?? null,
    profile.phone,
    profile.resi_address ?? null,
    profile.status ?? 'active',
    joinDate,
    profile.created_at ?? now,
    profile.updated_at ?? now,
  );
  const saved = await getUserById(profile.id);
  if (!saved) throw new Error('Could not save your profile on this device');
  return saved;
}

export async function updateUser(
  id: string,
  patch: Partial<Pick<User, 'name' | 'email_id' | 'resi_address' | 'status'>>,
): Promise<void> {
  const entries = Object.entries(patch).filter(([, v]) => v !== undefined);
  if (entries.length === 0) return;
  const db = await getDb();
  const sets = entries.map(([k]) => `${k} = ?`).join(', ');
  await db.runAsync(
    `UPDATE users SET ${sets} WHERE id = ?`,
    ...entries.map(([, v]) => v as string),
    id,
  );
}
