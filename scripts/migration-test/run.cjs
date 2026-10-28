/**
 * Verifies the v1 -> v2 migration against a real SQLite database.
 *
 *   node scripts/migration-test/run.cjs      (or: npm run test:migration)
 *
 * The one irreversible step in the cloud migration is the UUID rebuild: it
 * drops and recreates users / employees / attendance on a device that already
 * holds somebody's real register. A bug there destroys data that has no backup
 * yet, and "it typechecked" proves nothing about it.
 *
 * So this seeds a v1 database with the awkward cases (two households, a Saathi
 * with no creator, attendance with a null entered_by) and drives the *real*
 * compiled upV1/upV2 through an adapter over node:sqlite - the same code that
 * runs on the phone, not a reimplementation. src/db/migrations/v2.ts is
 * compiled on the fly; expo-crypto is swapped for node:crypto, which provides
 * the same randomUUID.
 *
 * See also fk-control.cjs, which shows what happens without the runner's
 * `disableForeignKeys` toggle.
 */
const { execFileSync } = require('node:child_process');
const Module = require('node:module');
const { join } = require('node:path');

const ROOT = join(__dirname, '..', '..');
const OUT = join(__dirname, 'build');
const OUT_REL = 'scripts/migration-test/build';

/** expo-crypto is native; point it at the node:crypto stub instead. */
const resolveFilename = Module._resolveFilename;
Module._resolveFilename = function (request, ...rest) {
  if (request === 'expo-crypto') return require.resolve('./stub-expo-crypto.cjs');
  return resolveFilename.call(this, request, ...rest);
};

function compileMigrations() {
  // shell:true because npx is a .cmd shim on Windows, which execFile cannot
  // spawn directly - which in turn means no argument may contain a space, so
  // the output directory is passed relative to ROOT rather than absolute.
  // (This project's own path has a space in it.)
  execFileSync(
    'npx',
    [
      'tsc',
      '--ignoreConfig',
      'src/db/migrations/v1.ts',
      'src/db/migrations/v2.ts',
      '--outDir',
      OUT_REL,
      '--module',
      'commonjs',
      '--target',
      'es2020',
      '--esModuleInterop',
      '--skipLibCheck',
      '--rootDir',
      '.',
    ],
    { cwd: ROOT, stdio: 'inherit', shell: true },
  );
}

const { DatabaseSync } = require('node:sqlite');
const { rmSync, mkdtempSync } = require('node:fs');
const { tmpdir } = require('node:os');

compileMigrations();
const { upV1 } = require(join(OUT, 'src/db/migrations/v1.js'));
const { upV2 } = require(join(OUT, 'src/db/migrations/v2.js'));

const dir = mkdtempSync(join(tmpdir(), 'gharsaathi-mig-'));
const file = join(dir, 'gharsaathi.db');
const raw = new DatabaseSync(file);

const db = {
  execAsync: async (sql) => raw.exec(sql),
  runAsync: async (sql, ...args) => {
    const r = raw.prepare(sql).run(...args);
    return { changes: Number(r.changes), lastInsertRowId: Number(r.lastInsertRowid) };
  },
  getAllAsync: async (sql, ...args) => raw.prepare(sql).all(...args),
  getFirstAsync: async (sql, ...args) => raw.prepare(sql).get(...args) ?? null,
  withTransactionAsync: async (fn) => {
    raw.exec('BEGIN');
    try {
      await fn();
      raw.exec('COMMIT');
    } catch (e) {
      raw.exec('ROLLBACK');
      throw e;
    }
  },
};

let failures = 0;
const check = (label, ok, detail) => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? ` -- ${detail}` : ''}`);
  if (!ok) failures++;
};

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

(async () => {
  // ---------------------------------------------------------------- seed v1
  raw.exec('PRAGMA foreign_keys = ON');
  await upV1(db);

  await db.runAsync(
    "INSERT INTO users (name, phone, status) VALUES ('Shweta', '9876543210', 'active')",
  );
  await db.runAsync(
    "INSERT INTO users (name, phone, status) VALUES ('Second Household', '9000000001', 'active')",
  );

  // Three Saathi for user 1, one for user 2, and one orphan with no creator -
  // the nullable created_by case that owner_id NOT NULL has to survive.
  const emps = [
    ['Asha', 1, 'Monthly', 8000],
    ['Bhavna', 1, 'Rokadi', 300],
    ['Chetan', 1, 'Bi-weekly', 2500],
    ['Other-household Saathi', 2, 'Monthly', 6000],
    ['Orphan Saathi', null, 'Monthly', 5000],
  ];
  for (const [name, by, wageType, wageAmt] of emps) {
    await db.runAsync(
      'INSERT INTO employees (name, phone, status, wage_type, wage_amt, created_by) VALUES (?, ?, ?, ?, ?, ?)',
      name,
      '',
      'active',
      wageType,
      wageAmt,
      by,
    );
  }

  // Attendance across several Saathi and dates, including one row with a null
  // entered_by and one for the other household.
  const marks = [
    [1, '2026-10-01', 'Present', 1],
    [1, '2026-10-02', 'Absent', 1],
    [1, '2026-10-03', 'Half-day', null],
    [2, '2026-10-01', 'Present', 1],
    [2, '2026-10-02', 'Present', 1],
    [3, '2026-10-01', 'Leave', 1],
    [4, '2026-10-01', 'Present', 2],
    [5, '2026-10-01', 'Present', null],
  ];
  for (const [empId, date, status, by] of marks) {
    await db.runAsync(
      'INSERT INTO attendance (emp_id, date, status, entry_type, entered_by) VALUES (?, ?, ?, ?, ?)',
      empId,
      date,
      status,
      'manual',
      by,
    );
  }

  const before = {
    users: raw.prepare('SELECT COUNT(*) AS n FROM users').get().n,
    employees: raw.prepare('SELECT COUNT(*) AS n FROM employees').get().n,
    attendance: raw.prepare('SELECT COUNT(*) AS n FROM attendance').get().n,
  };
  const beforeLinks = raw
    .prepare(
      'SELECT e.name AS emp, a.date, a.status FROM attendance a JOIN employees e ON e.id = a.emp_id ORDER BY e.name, a.date',
    )
    .all();

  console.log(
    `seeded v1: ${before.users} users, ${before.employees} employees, ${before.attendance} attendance\n`,
  );

  // ------------------------------------------------------------- run v2
  // Exactly what src/db/migrations/index.ts does around a rebuild migration.
  raw.exec('PRAGMA foreign_keys = OFF');
  try {
    await db.withTransactionAsync(async () => {
      await upV2(db);
    });
    raw.exec('PRAGMA user_version = 2');
  } finally {
    raw.exec('PRAGMA foreign_keys = ON');
  }

  // ------------------------------------------------------------- assert
  const after = {
    users: raw.prepare('SELECT COUNT(*) AS n FROM users').get().n,
    employees: raw.prepare('SELECT COUNT(*) AS n FROM employees').get().n,
    attendance: raw.prepare('SELECT COUNT(*) AS n FROM attendance').get().n,
  };

  check(
    'no rows lost',
    after.users === before.users &&
      after.employees === before.employees &&
      after.attendance === before.attendance,
    `before ${JSON.stringify(before)} after ${JSON.stringify(after)}`,
  );

  check(
    'attendance survived the DROP TABLE cascade',
    after.attendance === 8,
    `${after.attendance} rows`,
  );

  const afterLinks = raw
    .prepare(
      'SELECT e.name AS emp, a.date, a.status FROM attendance a JOIN employees e ON e.id = a.emp_id ORDER BY e.name, a.date',
    )
    .all();
  check(
    'every (Saathi, date, status) link is intact',
    JSON.stringify(afterLinks) === JSON.stringify(beforeLinks),
    `${afterLinks.length} of ${beforeLinks.length} links matched`,
  );

  const ids = raw.prepare('SELECT id FROM employees').all().map((r) => r.id);
  check(
    'employee ids are UUIDs',
    ids.length === 5 && ids.every((i) => UUID_RE.test(i)),
    ids[0],
  );
  const aIds = raw.prepare('SELECT id FROM attendance').all().map((r) => r.id);
  check('attendance ids are UUIDs', aIds.every((i) => UUID_RE.test(i)));
  check(
    'attendance ids are unique',
    new Set(aIds).size === aIds.length,
    `${new Set(aIds).size} distinct of ${aIds.length}`,
  );

  const nullOwners = raw
    .prepare('SELECT COUNT(*) AS n FROM employees WHERE owner_id IS NULL').get().n;
  check('no employee lost its owner', nullOwners === 0);

  // The two households must still be separable, and the orphan must have been
  // adopted by the first user rather than dropped.
  const owners = raw
    .prepare('SELECT owner_id, COUNT(*) AS n FROM employees GROUP BY owner_id ORDER BY n DESC')
    .all();
  check(
    'households stayed separate (4 + 1, orphan adopted by the first user)',
    owners.length === 2 && owners[0].n === 4 && owners[1].n === 1,
    JSON.stringify(owners.map((o) => o.n)),
  );

  const user1 = raw.prepare("SELECT id FROM users WHERE phone = '9876543210'").get().id;
  const orphanOwner = raw
    .prepare("SELECT owner_id FROM employees WHERE name = 'Orphan Saathi'").get().owner_id;
  check('orphan Saathi adopted by the first local user', orphanOwner === user1);

  const mismatched = raw
    .prepare(
      'SELECT COUNT(*) AS n FROM attendance a JOIN employees e ON e.id = a.emp_id WHERE a.owner_id <> e.owner_id',
    )
    .get().n;
  check('attendance owner matches its Saathi owner', mismatched === 0);

  const enteredBy = raw
    .prepare("SELECT entered_by FROM attendance WHERE entered_by IS NOT NULL").all();
  check(
    'entered_by remapped to user UUIDs',
    enteredBy.length === 6 && enteredBy.every((r) => UUID_RE.test(r.entered_by)),
    `${enteredBy.length} non-null`,
  );

  const pending = raw
    .prepare('SELECT COUNT(*) AS n FROM attendance WHERE pending_sync = 1').get().n;
  check('every migrated row is queued for push', pending === after.attendance);

  const settings = raw.prepare('SELECT COUNT(*) AS n FROM settings').get().n;
  check('settings survived', settings === 6, `${settings} rows`);

  // The touch trigger must raise pending_sync on an ordinary update.
  raw.exec("UPDATE attendance SET pending_sync = 0");
  const target = raw.prepare('SELECT id FROM attendance LIMIT 1').get().id;
  raw.prepare("UPDATE attendance SET remarks = 'edited' WHERE id = ?").run(target);
  const dirty = raw.prepare('SELECT pending_sync FROM attendance WHERE id = ?').get(target);
  check('touch trigger re-dirties an edited row', dirty.pending_sync === 1);

  // Foreign keys must be live again, and still cascade.
  const fk = raw.prepare('PRAGMA foreign_keys').get();
  check('foreign keys restored after the migration', Object.values(fk)[0] === 1);

  const empUuid = raw.prepare("SELECT id FROM employees WHERE name = 'Asha'").get().id;
  let rejected = false;
  try {
    raw
      .prepare("INSERT INTO attendance (id, owner_id, emp_id, date, status) VALUES ('x','y','no-such-emp','2026-10-09','Present')")
      .run();
  } catch {
    rejected = true;
  }
  check('attendance still refuses an unknown Saathi', rejected);

  const dupe = (() => {
    try {
      raw
        .prepare('INSERT INTO attendance (id, owner_id, emp_id, date, status) VALUES (?, ?, ?, ?, ?)')
        .run('dupe-id', user1, empUuid, '2026-10-01', 'Present');
      return false;
    } catch {
      return true;
    }
  })();
  check('UNIQUE(emp_id, date) still holds', dupe);

  console.log(`\n${failures === 0 ? 'ALL CHECKS PASSED' : failures + ' CHECK(S) FAILED'}`);
  raw.close();
  rmSync(dir, { recursive: true, force: true });
  process.exit(failures === 0 ? 0 : 1);
})().catch((e) => {
  console.error('harness crashed:', e);
  process.exit(1);
});
