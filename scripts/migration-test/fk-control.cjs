/**
 * Negative control for run.cjs: the same migration with foreign keys left ON,
 * i.e. without the runner's `disableForeignKeys` toggle. Expected output is a
 * FOREIGN KEY constraint failure and a database still on v1 - which is why the
 * toggle in src/db/migrations/index.ts is load-bearing rather than defensive.
 */
const { DatabaseSync } = require('node:sqlite');
const { mkdtempSync, rmSync } = require('node:fs');
const { join } = require('node:path');
const Module = require('node:module');
const resolveFilename = Module._resolveFilename;
Module._resolveFilename = function (request, ...rest) {
  if (request === 'expo-crypto') return require.resolve('./stub-expo-crypto.cjs');
  return resolveFilename.call(this, request, ...rest);
};
const OUT = join(__dirname, 'build');
const { tmpdir } = require('node:os');
const { upV1 } = require(join(OUT, 'src/db/migrations/v1.js'));
const { upV2 } = require(join(OUT, 'src/db/migrations/v2.js'));

const dir = mkdtempSync(join(tmpdir(), 'fkctl-'));
const raw = new DatabaseSync(join(dir, 'd.db'));
const db = {
  execAsync: async (s) => raw.exec(s),
  runAsync: async (s, ...a) => { const r = raw.prepare(s).run(...a); return { changes: Number(r.changes), lastInsertRowId: Number(r.lastInsertRowid) }; },
  getAllAsync: async (s, ...a) => raw.prepare(s).all(...a),
  getFirstAsync: async (s, ...a) => raw.prepare(s).get(...a) ?? null,
  withTransactionAsync: async (f) => { raw.exec('BEGIN'); try { await f(); raw.exec('COMMIT'); } catch (e) { raw.exec('ROLLBACK'); throw e; } },
};

(async () => {
  raw.exec('PRAGMA foreign_keys = ON');
  await upV1(db);
  await db.runAsync("INSERT INTO users (name, phone) VALUES ('A', '1')");
  await db.runAsync("INSERT INTO employees (name, wage_type, wage_amt, created_by) VALUES ('Asha','Monthly',8000,1)");
  for (const d of ['2026-10-01', '2026-10-02', '2026-10-03']) {
    await db.runAsync('INSERT INTO attendance (emp_id, date, status) VALUES (1, ?, ?)', d, 'Present');
  }
  console.log('seeded attendance rows:', raw.prepare('SELECT COUNT(*) n FROM attendance').get().n);

  // Note: NO "PRAGMA foreign_keys = OFF" here - that is the whole point.
  try {
    await db.withTransactionAsync(async () => { await upV2(db); });
  } catch (e) {
    console.log('migration threw:', e.message);
  }
  let n = 'table gone';
  try { n = raw.prepare('SELECT COUNT(*) n FROM attendance').get().n; } catch {}
  console.log('attendance rows after migrating with foreign keys ON:', n);
  raw.close();
  rmSync(dir, { recursive: true, force: true });
})();
