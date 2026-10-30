/**
 * Verifies the local half of the sync engine against a real SQLite database.
 *
 *   node scripts/sync-test/run.cjs      (or: npm run test:sync)
 *
 * src/db/queries/sync.ts holds the only SQL in the app that nothing else can
 * check: the outbound queue, and the upsert whose `ON CONFLICT ... WHERE
 * excluded.updated_at > table.updated_at` clause *is* the conflict-resolution
 * policy. Getting that wrong does not throw - it silently drops a Hajari mark
 * or resurrects a deleted Saathi, which is exactly the class of bug a
 * typecheck cannot see.
 *
 * So this drives the real compiled query module through an adapter over
 * node:sqlite, on a database migrated by the real v1 -> v3 migrations.
 * Everything above it (what the cloud columns are called, when a cycle runs)
 * is src/services/sync.ts and is not exercised here - that needs a Supabase
 * project, which is step 5 of the plan's manual verification list.
 */
const { execFileSync } = require('node:child_process');
const Module = require('node:module');
const { join } = require('node:path');
const { rmSync, mkdtempSync } = require('node:fs');
const { tmpdir } = require('node:os');

const ROOT = join(__dirname, '..', '..');
const OUT = join(__dirname, 'build');
const OUT_REL = 'scripts/sync-test/build';

const dir = mkdtempSync(join(tmpdir(), 'gharsaathi-sync-'));
process.env.GHARSAATHI_TEST_DB = join(dir, 'gharsaathi.db');

/** Both native modules are swapped for node equivalents. */
const resolveFilename = Module._resolveFilename;
Module._resolveFilename = function (request, ...rest) {
  if (request === 'expo-crypto') return require.resolve('../migration-test/stub-expo-crypto.cjs');
  if (request === 'expo-sqlite') return require.resolve('./stub-expo-sqlite.cjs');
  return resolveFilename.call(this, request, ...rest);
};

// shell:true because npx is a .cmd shim on Windows; that means no argument may
// contain a space, so the output dir is passed relative to ROOT.
execFileSync(
  'npx',
  [
    'tsc',
    '--ignoreConfig',
    'src/db/queries/sync.ts',
    'src/db/queries/users.ts',
    'src/db/client.ts',
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

const { listPending, clearPending, countPending, upsertPulled, adoptLocalData } = require(
  join(OUT, 'src/db/queries/sync.js'),
);
const { upsertUserFromProfile, getUserById } = require(join(OUT, 'src/db/queries/users.js'));
const { getDb } = require(join(OUT, 'src/db/client.js'));
const { __raw } = require('./stub-expo-sqlite.cjs');

let failures = 0;
const check = (label, ok, detail) => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? ` -- ${detail}` : ''}`);
  if (!ok) failures++;
};

const OWNER = '11111111-1111-4111-8111-111111111111';
const OTHER = '22222222-2222-4222-8222-222222222222';
const EMP = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

/** Columns the service layer hands upsertPulled for each table. */
const EMP_COLS = [
  'id', 'owner_id', 'name', 'phone', 'resi_address', 'status', 'remarks',
  'start_date', 'end_date', 'wage_type', 'wage_amt', 'deleted_at',
  'created_at', 'updated_at',
];
const ATT_COLS = [
  'id', 'owner_id', 'emp_id', 'date', 'time_in', 'time_out', 'status',
  'remarks', 'entry_type', 'deleted_at', 'created_at', 'updated_at',
];

const employee = (over = {}) => ({
  id: EMP, owner_id: OWNER, name: 'Asha', phone: '9876543210', resi_address: null,
  status: 'active', remarks: null, start_date: null, end_date: null,
  wage_type: 'Monthly', wage_amt: 8000, deleted_at: null,
  created_at: '2026-10-01 09:00:00', updated_at: '2026-10-01 09:00:00', ...over,
});

const mark = (over = {}) => ({
  id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', owner_id: OWNER, emp_id: EMP,
  date: '2026-10-05', time_in: null, time_out: null, status: 'Present',
  remarks: null, entry_type: 'manual', deleted_at: null,
  created_at: '2026-10-05 09:00:00', updated_at: '2026-10-05 09:00:00', ...over,
});

(async () => {
  await getDb(); // runs v1 -> v3
  const raw = __raw();

  const version = Object.values(raw.prepare('PRAGMA user_version').get())[0];
  check('migrated to the current schema', version === 4, String(version));

  // ------------------------------------------------------------ the queue
  raw
    .prepare('INSERT INTO users (id, name, phone, status) VALUES (?, ?, ?, ?)')
    .run(OWNER, 'Shweta', '9000000001', 'active');
  raw
    .prepare('INSERT INTO users (id, name, phone, status) VALUES (?, ?, ?, ?)')
    .run(OTHER, 'Someone else', '9000000002', 'active');
  raw
    .prepare(
      'INSERT INTO employees (id, owner_id, name, phone, status, wage_type, wage_amt) VALUES (?, ?, ?, ?, ?, ?, ?)',
    )
    .run(EMP, OWNER, 'Asha', '9876543210', 'active', 'Monthly', 8000);
  raw
    .prepare(
      'INSERT INTO employees (id, owner_id, name, phone, status, wage_type, wage_amt) VALUES (?, ?, ?, ?, ?, ?, ?)',
    )
    .run('cccccccc-cccc-4ccc-8ccc-cccccccccccc', OTHER, 'Not yours', '9', 'active', 'Monthly', 500);

  const pendingEmps = await listPending('employees', OWNER);
  check(
    'the queue is scoped to the signed-in owner',
    pendingEmps.length === 1 && pendingEmps[0].id === EMP,
    `${pendingEmps.length} rows`,
  );

  const pendingUsers = await listPending('users', OWNER);
  check(
    'users is queued by id, not owner_id',
    pendingUsers.length === 1 && pendingUsers[0].id === OWNER,
    `${pendingUsers.length} rows`,
  );

  check('countPending counts only this household', (await countPending(OWNER)) === 2);

  await clearPending('employees', [EMP]);
  const stillDirty = raw
    .prepare('SELECT pending_sync FROM employees WHERE id = ?').get(EMP).pending_sync;
  check('a pushed row comes clean and stays clean', stillDirty === 0);

  const otherDirty = raw
    .prepare("SELECT pending_sync FROM employees WHERE owner_id = ?").get(OTHER).pending_sync;
  check('clearing one id left the other rows queued', otherDirty === 1);

  // ------------------------------------------------- pull: insert and LWW
  const NEW_EMP = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
  await upsertPulled('employees', EMP_COLS, [employee({ id: NEW_EMP, name: 'Bhavna' })]);
  const inserted = raw.prepare('SELECT * FROM employees WHERE id = ?').get(NEW_EMP);
  check('a row pulled from the cloud lands locally', inserted && inserted.name === 'Bhavna');
  check('a pulled row is not queued straight back up', inserted && inserted.pending_sync === 0);

  // A local edit the user has made but not pushed must survive an older copy
  // of the same row arriving from the cloud.
  raw.prepare("UPDATE employees SET name = 'Asha (edited here)' WHERE id = ?").run(EMP);
  const localStamp = raw.prepare('SELECT updated_at FROM employees WHERE id = ?').get(EMP).updated_at;
  await upsertPulled('employees', EMP_COLS, [
    employee({ name: 'Asha (stale cloud copy)', updated_at: '2026-10-01 09:00:00' }),
  ]);
  const afterStale = raw.prepare('SELECT * FROM employees WHERE id = ?').get(EMP);
  check(
    'an older cloud row does not overwrite a newer local edit',
    afterStale.name === 'Asha (edited here)',
    afterStale.name,
  );
  check('the losing pull left the local row queued', afterStale.pending_sync === 1);

  // The same row arriving newer does win, and must not come back dirty.
  const newer = '2099-01-01 10:00:00';
  await upsertPulled('employees', EMP_COLS, [
    employee({ name: 'Asha (newer cloud copy)', updated_at: newer }),
  ]);
  const afterNewer = raw.prepare('SELECT * FROM employees WHERE id = ?').get(EMP);
  check(
    'a newer cloud row wins last-write-wins',
    afterNewer.name === 'Asha (newer cloud copy)',
    `${afterNewer.name} (local was ${localStamp})`,
  );
  check('the winning pull did not re-queue the row', afterNewer.pending_sync === 0);

  // ------------------------------------------------------- soft deletion
  await upsertPulled('employees', EMP_COLS, [
    employee({ id: NEW_EMP, name: 'Bhavna', deleted_at: '2099-01-02 08:00:00', updated_at: '2099-01-02 08:00:00' }),
  ]);
  const deleted = raw.prepare('SELECT deleted_at FROM employees WHERE id = ?').get(NEW_EMP);
  check('a deletion from another device lands as a soft delete', deleted.deleted_at !== null);

  // --------------------------------------- attendance (emp_id, date) clash
  // Two devices marked the same Saathi on the same day offline, so the rows
  // carry different uuids but collide on UNIQUE(emp_id, date). ON CONFLICT(id)
  // cannot see that, so the engine settles it before the insert.
  const LOCAL_MARK = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
  const CLOUD_MARK = 'ffffffff-ffff-4fff-8fff-ffffffffffff';
  raw
    .prepare(
      'INSERT INTO attendance (id, owner_id, emp_id, date, status, entry_type, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
    )
    .run(LOCAL_MARK, OWNER, EMP, '2026-10-07', 'Absent', 'manual', '2026-10-07 10:00:00');

  // Older incoming mark: the local one stands and the pull is a no-op.
  await upsertPulled('attendance', ATT_COLS, [
    mark({ id: CLOUD_MARK, date: '2026-10-07', status: 'Present', updated_at: '2026-10-06 10:00:00' }),
  ]);
  let day = raw.prepare('SELECT * FROM attendance WHERE emp_id = ? AND date = ?').all(EMP, '2026-10-07');
  check(
    'an older clashing mark is dropped, keeping the local one',
    day.length === 1 && day[0].id === LOCAL_MARK && day[0].status === 'Absent',
    JSON.stringify(day.map((d) => d.status)),
  );

  // Newer incoming mark: it replaces the local one, and only one row remains.
  await upsertPulled('attendance', ATT_COLS, [
    mark({ id: CLOUD_MARK, date: '2026-10-07', status: 'Present', updated_at: '2099-01-03 10:00:00' }),
  ]);
  day = raw.prepare('SELECT * FROM attendance WHERE emp_id = ? AND date = ?').all(EMP, '2026-10-07');
  check(
    'a newer clashing mark replaces the local one',
    day.length === 1 && day[0].id === CLOUD_MARK && day[0].status === 'Present',
    JSON.stringify(day.map((d) => `${d.id.slice(0, 4)}:${d.status}`)),
  );
  check(
    'UNIQUE(emp_id, date) is still intact after the swap',
    raw.prepare('SELECT COUNT(*) AS n FROM attendance').get().n === 1,
  );

  // A pulled mark for a day nobody marked yet is just an insert.
  await upsertPulled('attendance', ATT_COLS, [mark({ date: '2026-10-08' })]);
  check(
    'an unclashing mark inserts normally',
    raw.prepare('SELECT COUNT(*) AS n FROM attendance').get().n === 2,
  );

  const queued = await countPending(OWNER);
  check('nothing the pull wrote is waiting to go back up', queued === 1, `${queued} queued`);

  // ------------------------------------------------- phase 6: adoption
  // The upgrade case: this device already held a register before the cloud
  // existed, so its rows carry a locally-minted owner id and `listPending`
  // scopes them out. Nothing would ever be backed up until they are adopted.
  const LEGACY = '99999999-9999-4999-8999-999999999999';
  const AUTH_UID = '88888888-8888-4888-8888-888888888888';
  const LEGACY_EMP = '77777777-7777-4777-8777-777777777777';

  raw.exec('DELETE FROM attendance; DELETE FROM employees; DELETE FROM users;');
  raw
    .prepare('INSERT INTO users (id, name, phone, status) VALUES (?, ?, ?, ?)')
    .run(LEGACY, 'Shweta', '9876543210', 'active');
  raw
    .prepare(
      'INSERT INTO employees (id, owner_id, name, phone, status, wage_type, wage_amt) VALUES (?, ?, ?, ?, ?, ?, ?)',
    )
    .run(LEGACY_EMP, LEGACY, 'Asha', '9000000009', 'active', 'Monthly', 8000);
  raw
    .prepare(
      'INSERT INTO attendance (id, owner_id, emp_id, date, status, entry_type, entered_by) VALUES (?, ?, ?, ?, ?, ?, ?)',
    )
    .run('66666666-6666-4666-8666-666666666666', LEGACY, LEGACY_EMP, '2026-09-01', 'Present', 'manual', LEGACY);

  check(
    'before adoption the new account sees none of it',
    (await countPending(AUTH_UID)) === 0,
    (await listPending('employees', AUTH_UID)).length + ' employees visible',
  );

  // Signing in writes the profile row. The pre-cloud row holds the SAME mobile
  // number under a different id and `users.phone` is UNIQUE, so without the
  // collision handling in upsertUserFromProfile this throws and the upgrade
  // can never get past the login screen.
  let signInFailed = null;
  try {
    await upsertUserFromProfile({
      id: AUTH_UID,
      name: 'Shweta',
      phone: '9876543210',
      status: 'active',
    });
  } catch (e) {
    signInFailed = e.message;
  }
  check('signing in over a pre-cloud register does not hit UNIQUE(phone)', !signInFailed, signInFailed);
  check(
    'the account row is now keyed by the auth uid',
    (await getUserById(AUTH_UID)) !== null && (await getUserById(LEGACY)) === null,
  );

  const adopted = await adoptLocalData(AUTH_UID);
  check('adoption reports every record it moved', adopted === 2, adopted + ' rows');

  const stray = raw
    .prepare('SELECT COUNT(*) AS n FROM employees WHERE owner_id <> ?').get(AUTH_UID).n +
    raw.prepare('SELECT COUNT(*) AS n FROM attendance WHERE owner_id <> ?').get(AUTH_UID).n;
  check('no row is left behind under the old owner', stray === 0, stray + ' stray rows');

  // Two, not three: the Saathi and the mark are queued, the profile row is
  // not. It was written from the cloud's own `profiles` row, so pushing it
  // would send the server its own data back. Nothing is lost either way - no
  // screen in the app edits a user's email or address, so the pre-cloud row
  // held only a name and a number, and the name comes down with the profile.
  const queuedAfterAdoption = await countPending(AUTH_UID);
  check(
    'the adopted records are queued for the ordinary push',
    queuedAfterAdoption === 2,
    queuedAfterAdoption + ' queued',
  );
  check(
    'the profile row is not queued back at the server',
    raw.prepare('SELECT pending_sync FROM users WHERE id = ?').get(AUTH_UID).pending_sync === 0,
  );

  const enteredBy = raw
    .prepare('SELECT entered_by FROM attendance').get().entered_by;
  check('entered_by was re-pointed at the new account', enteredBy === AUTH_UID, enteredBy);

  check(
    'the pre-cloud account row is gone',
    raw.prepare('SELECT COUNT(*) AS n FROM users').get().n === 1,
  );

  // The flag is only set after a successful push, so a failed first sync
  // retries this - which means it has to be safe to run twice.
  const again = await adoptLocalData(AUTH_UID);
  check('a repeated adoption is a no-op', again === 0, again + ' rows');

  // ------------------------------------------- join_date (write-once, v4)
  // join_date answers "when did this phone number first sign up". It must
  // survive a reinstall, a device change and the pre-cloud row being dropped,
  // and it must never move once set.
  const JD_UID = '55555555-5555-4555-8555-555555555555';
  const FIRST = '2024-03-01 07:30:00';

  await upsertUserFromProfile({
    id: JD_UID,
    name: 'Join Date User',
    phone: '9811111111',
    status: 'active',
    join_date: FIRST,
  });
  check(
    'join_date is stored on first sign-in',
    raw.prepare('SELECT join_date FROM users WHERE id = ?').get(JD_UID).join_date === FIRST,
  );

  // A later sign-in offers a different value (e.g. a changed auth record);
  // the stored one has to win.
  await upsertUserFromProfile({
    id: JD_UID,
    name: 'Renamed User',
    phone: '9811111111',
    status: 'active',
    join_date: '2026-10-30 12:00:00',
  });
  const afterResign = raw.prepare('SELECT name, join_date FROM users WHERE id = ?').get(JD_UID);
  check('a later sign-in cannot move join_date', afterResign.join_date === FIRST, afterResign.join_date);
  check('but the name still updates', afterResign.name === 'Renamed User');

  // The upgrade case: the pre-cloud row holds the real join date under a
  // locally-minted id, and is deleted on sign-in. Its join_date must be
  // carried over, or a register years old would look brand new.
  const OLD_LOCAL = '44444444-4444-4444-8444-444444444444';
  const NEW_UID = '33333333-3333-4333-8333-333333333333';
  raw
    .prepare('INSERT INTO users (id, name, phone, status, join_date) VALUES (?, ?, ?, ?, ?)')
    .run(OLD_LOCAL, 'Old Local', '9822222222', 'active', '2023-01-15 06:00:00');

  await upsertUserFromProfile({
    id: NEW_UID,
    name: 'Old Local',
    phone: '9822222222',
    status: 'active',
    join_date: '2026-10-30 12:00:00',
  });
  const carried = raw.prepare('SELECT join_date FROM users WHERE id = ?').get(NEW_UID).join_date;
  check(
    'the pre-cloud join_date is carried onto the new account row',
    carried === '2023-01-15 06:00:00',
    carried,
  );
  check(
    'the pre-cloud row is gone',
    raw.prepare('SELECT COUNT(*) AS n FROM users WHERE id = ?').get(OLD_LOCAL).n === 0,
  );

  console.log(`\n${failures === 0 ? 'ALL CHECKS PASSED' : failures + ' CHECK(S) FAILED'}`);
  raw.close();
  rmSync(dir, { recursive: true, force: true });
  process.exit(failures === 0 ? 0 : 1);
})().catch((e) => {
  console.error('harness crashed:', e);
  process.exit(1);
});
