import type { SQLiteDatabase } from 'expo-sqlite';
import { SCHEMA_VERSION } from '../schema';
import { upV1 } from './v1';
import { upV2 } from './v2';

export interface Migration {
  version: number;
  name: string;
  /**
   * Set for table-rebuild migrations. `PRAGMA foreign_keys` is a no-op inside
   * a transaction, so a migration that drops and renames tables cannot turn it
   * off itself - the runner has to do it before opening the transaction. With
   * foreign keys left on, DROP TABLE performs an implicit DELETE FROM and
   * attendance's ON DELETE CASCADE deletes the register.
   */
  disableForeignKeys?: boolean;
  up: (db: SQLiteDatabase) => Promise<void>;
}

const v1: Migration = {
  version: 1,
  name: 'initial-schema',
  up: upV1,
};

const v2: Migration = {
  version: 2,
  name: 'uuid-keys-and-sync-columns',
  disableForeignKeys: true,
  up: upV2,
};

/** Append new migrations here; never edit an already-shipped one. */
export const migrations: Migration[] = [v1, v2];

/**
 * Runs every migration newer than the database's current `user_version`.
 * Each migration is wrapped in its own transaction so a failure cannot leave
 * the schema half-applied.
 */
export async function runMigrations(db: SQLiteDatabase): Promise<number> {
  const row = await db.getFirstAsync<{ user_version: number }>('PRAGMA user_version');
  const current = row?.user_version ?? 0;

  if (current >= SCHEMA_VERSION) return current;

  for (const migration of migrations) {
    if (migration.version <= current) continue;

    if (migration.disableForeignKeys) {
      await db.execAsync('PRAGMA foreign_keys = OFF');
    }
    try {
      await db.withTransactionAsync(async () => {
        await migration.up(db);
      });
      await db.execAsync(`PRAGMA user_version = ${migration.version}`);
    } finally {
      // Restored even if the migration threw, so the app never carries on
      // with foreign keys silently disabled.
      if (migration.disableForeignKeys) {
        await db.execAsync('PRAGMA foreign_keys = ON');
      }
    }
  }

  return SCHEMA_VERSION;
}
