import type { SQLiteDatabase } from 'expo-sqlite';
import {
  ALL_TABLES,
  CREATE_INDEXES,
  CREATE_TRIGGERS,
  DEFAULT_SETTINGS,
  SCHEMA_VERSION,
} from '../schema';

export interface Migration {
  version: number;
  name: string;
  up: (db: SQLiteDatabase) => Promise<void>;
}

const v1: Migration = {
  version: 1,
  name: 'initial-schema',
  up: async (db) => {
    for (const ddl of ALL_TABLES) await db.execAsync(ddl);
    await db.execAsync(CREATE_INDEXES);
    for (const trg of CREATE_TRIGGERS) await db.execAsync(trg);

    for (const [key, value] of DEFAULT_SETTINGS) {
      await db.runAsync(
        'INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)',
        key,
        value,
      );
    }
  },
};

/** Append new migrations here; never edit an already-shipped one. */
export const migrations: Migration[] = [v1];

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
    await db.withTransactionAsync(async () => {
      await migration.up(db);
    });
    await db.execAsync(`PRAGMA user_version = ${migration.version}`);
  }

  return SCHEMA_VERSION;
}
