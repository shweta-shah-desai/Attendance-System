import * as SQLite from 'expo-sqlite';
import type { SQLiteDatabase } from 'expo-sqlite';
import { DB_NAME } from './schema';
import { runMigrations } from './migrations';

let dbPromise: Promise<SQLiteDatabase> | null = null;

async function open(): Promise<SQLiteDatabase> {
  const db = await SQLite.openDatabaseAsync(DB_NAME);
  // WAL keeps reads fast while a write is in flight; foreign keys are off by
  // default in SQLite and we rely on ON DELETE CASCADE for attendance rows.
  await db.execAsync('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;');
  await runMigrations(db);
  return db;
}

/** Single shared connection for the whole app. */
export function getDb(): Promise<SQLiteDatabase> {
  if (!dbPromise) dbPromise = open();
  return dbPromise;
}

/** Called once from the splash screen before anything reads data. */
export async function initDatabase(): Promise<void> {
  await getDb();
}

/** Test/maintenance helper - drops every row but keeps the schema. */
export async function wipeAllData(): Promise<void> {
  const db = await getDb();
  await db.execAsync(
    'DELETE FROM attendance; DELETE FROM employees; DELETE FROM holidays; DELETE FROM users;',
  );
}

