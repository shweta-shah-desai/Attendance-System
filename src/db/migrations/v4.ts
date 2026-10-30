import type { SQLiteDatabase } from 'expo-sqlite';

/**
 * v4 - `users.join_date`, and an index for the holidays screen.
 *
 * join_date records when a mobile number first ever created an account. It is
 * write-once and never displayed; see the note in ../schema.ts for why it
 * cannot just be `created_at`.
 *
 * Backfill: existing rows get their own `created_at`. That is the best value
 * available on a device that has been in use since before the column existed -
 * it is when this register was first opened here. The next sign-in replaces it
 * with the authoritative `auth.users.created_at` only if it is still NULL, so
 * this backfill is deliberately a floor rather than a guess that sticks.
 *
 * ALTER TABLE ADD COLUMN rewrites nothing in SQLite, so unlike v2 this needs
 * no table rebuild and no foreign-key dance.
 *
 * The DDL is copied rather than imported from ../schema, for the same reason
 * v2 and v3 copy theirs: a migration must keep running the SQL it shipped
 * with, even after schema.ts moves on.
 */
export async function upV4(db: SQLiteDatabase): Promise<void> {
  const columns = await db.getAllAsync<{ name: string }>('PRAGMA table_info(users)');
  if (!columns.some((c) => c.name === 'join_date')) {
    await db.execAsync('ALTER TABLE users ADD COLUMN join_date TEXT;');
    // The v3 touch trigger sees this as an ordinary edit and queues the row.
    // Harmless - join_date has no cloud column, so the next push just re-sends
    // the account's name and number - and not worth dropping a trigger for.
    await db.execAsync('UPDATE users SET join_date = created_at WHERE join_date IS NULL;');
  }

  // The holidays screen reads one year at a time and deletes the rest.
  await db.execAsync('CREATE INDEX IF NOT EXISTS idx_holidays_date ON holidays (date);');
}
