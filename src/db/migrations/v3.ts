import type { SQLiteDatabase } from 'expo-sqlite';

/**
 * v3 - rebuild the touch triggers so clearing `pending_sync` sticks.
 *
 * The v2 trigger fired on any UPDATE that left `updated_at` alone, which is
 * exactly what the sync engine's "this row is now pushed" statement does:
 *
 *     UPDATE attendance SET pending_sync = 0 WHERE id IN (...)
 *
 * The trigger answered that by stamping `updated_at` and setting the flag back
 * to 1, so no row ever came clean and every sync re-pushed the whole register.
 * Adding `OLD.pending_sync = NEW.pending_sync` to the guard distinguishes the
 * two cases: an ordinary edit still re-dirties the row, a flag-only write does
 * not. Nothing else changes, so this is a trigger swap rather than a rebuild.
 *
 * The DDL is copied rather than imported from ../schema, for the same reason
 * v2 copies its own: a migration must keep running the SQL it shipped with,
 * even after schema.ts moves on.
 */
const TABLES = ['users', 'employees', 'attendance'] as const;

const touchTriggerV3 = (table: string) => `
CREATE TRIGGER IF NOT EXISTS trg_${table}_touch
AFTER UPDATE ON ${table}
FOR EACH ROW WHEN OLD.updated_at = NEW.updated_at
                  AND OLD.pending_sync = NEW.pending_sync
BEGIN
  UPDATE ${table}
     SET updated_at = datetime('now','localtime'), pending_sync = 1
   WHERE id = OLD.id;
END;`;

export async function upV3(db: SQLiteDatabase): Promise<void> {
  for (const table of TABLES) {
    await db.execAsync(`DROP TRIGGER IF EXISTS trg_${table}_touch;`);
    await db.execAsync(touchTriggerV3(table));
  }
}
