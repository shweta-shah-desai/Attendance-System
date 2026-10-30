/**
 * expo-sqlite is native, so the sync tests run src/db/client.ts against
 * node:sqlite instead. The adapter below is the same shape the migration
 * harness builds by hand (execAsync / runAsync / getAllAsync / getFirstAsync /
 * withTransactionAsync), exposed as the module the real client imports - so
 * the code under test is the shipped code, not a reimplementation.
 */
const { DatabaseSync } = require('node:sqlite');

let raw = null;

function wrap(db) {
  return {
    execAsync: async (sql) => db.exec(sql),
    runAsync: async (sql, ...args) => {
      const r = db.prepare(sql).run(...args);
      return { changes: Number(r.changes), lastInsertRowId: Number(r.lastInsertRowid) };
    },
    getAllAsync: async (sql, ...args) => db.prepare(sql).all(...args),
    getFirstAsync: async (sql, ...args) => db.prepare(sql).get(...args) ?? null,
    withTransactionAsync: async (fn) => {
      db.exec('BEGIN');
      try {
        await fn();
        db.exec('COMMIT');
      } catch (e) {
        db.exec('ROLLBACK');
        throw e;
      }
    },
  };
}

exports.openDatabaseAsync = async () => {
  if (!raw) raw = new DatabaseSync(process.env.GHARSAATHI_TEST_DB);
  return wrap(raw);
};

/** Direct handle, for the assertions to read rows the engine has written. */
exports.__raw = () => raw;
