/**
 * Verifies the holiday list: the Google Calendar parsers, and the rule that
 * only the current year is ever stored.
 *
 *   node scripts/holidays-test/run.cjs      (or: npm run test:holidays)
 *
 * Two things here cannot be checked by a typecheck and are painful to check by
 * hand on a phone:
 *
 *  1. The .ics parser. iCalendar folds long lines onto the next line with a
 *     leading space, so a parser that reads the raw text truncates long
 *     holiday names - and the only way to see it is to notice a wrong name in
 *     the list months later.
 *  2. "Store current year data only". The screen is supposed to drop last
 *     year's rows, and the first time that matters is 1 January, which is a
 *     terrible moment to discover it did not work.
 *
 * The parsers are pure, so they are called directly. The storage rule is
 * driven through the real compiled query module over node:sqlite, using the
 * same expo stubs as the other harnesses.
 */
const { execFileSync } = require('node:child_process');
const Module = require('node:module');
const { join } = require('node:path');
const { rmSync, mkdtempSync } = require('node:fs');
const { tmpdir } = require('node:os');

const ROOT = join(__dirname, '..', '..');
const OUT = join(__dirname, 'build');
const OUT_REL = 'scripts/holidays-test/build';

const dir = mkdtempSync(join(tmpdir(), 'gharsaathi-hol-'));
process.env.GHARSAATHI_TEST_DB = join(dir, 'gharsaathi.db');

const resolveFilename = Module._resolveFilename;
Module._resolveFilename = function (request, ...rest) {
  if (request === 'expo-crypto') return require.resolve('../migration-test/stub-expo-crypto.cjs');
  if (request === 'expo-sqlite') return require.resolve('../sync-test/stub-expo-sqlite.cjs');
  return resolveFilename.call(this, request, ...rest);
};

execFileSync(
  'npx',
  [
    'tsc',
    '--ignoreConfig',
    'src/services/holidays.ts',
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

const { parseIcs, parseApiEvents } = require(join(OUT, 'src/services/holidays.js'));
const { listHolidays, countHolidays, replaceYear } = require(
  join(OUT, 'src/db/queries/holidays.js'),
);
const { getDb } = require(join(OUT, 'src/db/client.js'));
const { __raw } = require('../sync-test/stub-expo-sqlite.cjs');

let failures = 0;
const check = (label, ok, detail) => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? ` -- ${detail}` : ''}`);
  if (!ok) failures++;
};

/**
 * A realistic feed: CRLF line endings, an all-day event, a folded SUMMARY, an
 * escaped comma, a second event on a date that already has one, an event from
 * the wrong year, and a timed event rather than an all-day one.
 */
const ICS = [
  'BEGIN:VCALENDAR',
  'VERSION:2.0',
  'BEGIN:VEVENT',
  'DTSTART;VALUE=DATE:20260126',
  'DTEND;VALUE=DATE:20260127',
  'SUMMARY:Republic Day',
  'END:VEVENT',
  'BEGIN:VEVENT',
  'DTSTART;VALUE=DATE:20260315',
  'SUMMARY:A very long holiday name that the feed has folded onto',
  '  the next line',
  'END:VEVENT',
  'BEGIN:VEVENT',
  'DTSTART;VALUE=DATE:20260402',
  'SUMMARY:Eid\\, observed',
  'END:VEVENT',
  'BEGIN:VEVENT',
  'DTSTART;VALUE=DATE:20260126',
  'SUMMARY:Republic Day observance',
  'END:VEVENT',
  'BEGIN:VEVENT',
  'DTSTART;VALUE=DATE:20250815',
  'SUMMARY:Independence Day (last year)',
  'END:VEVENT',
  'BEGIN:VEVENT',
  'DTSTART:20261002T000000Z',
  'SUMMARY:Gandhi Jayanti',
  'END:VEVENT',
  'END:VCALENDAR',
].join('\r\n');

(async () => {
  // ------------------------------------------------------------ ics parser
  const rows = parseIcs(ICS, 2026);

  check(
    'only the asked-for year is returned',
    rows.every((r) => r.date.startsWith('2026-')),
    rows.map((r) => r.date).join(' '),
  );
  check('rows come back in date order', rows.map((r) => r.date).join() ===
    [...rows].map((r) => r.date).sort().join());
  check(
    'an all-day DTSTART becomes YYYY-MM-DD',
    rows.some((r) => r.date === '2026-01-26' && r.name === 'Republic Day'),
  );
  check(
    'a folded SUMMARY is unfolded, not truncated',
    rows.some(
      (r) =>
        r.date === '2026-03-15' &&
        r.name === 'A very long holiday name that the feed has folded onto the next line',
    ),
    rows.find((r) => r.date === '2026-03-15')?.name,
  );
  check(
    'an escaped comma is unescaped',
    rows.some((r) => r.date === '2026-04-02' && r.name === 'Eid, observed'),
    rows.find((r) => r.date === '2026-04-02')?.name,
  );
  check(
    'two events on one date collapse to one row',
    rows.filter((r) => r.date === '2026-01-26').length === 1,
  );
  check(
    'the first name for a date is the one kept',
    rows.find((r) => r.date === '2026-01-26')?.name === 'Republic Day',
  );
  check(
    'a timed DTSTART is handled too',
    rows.some((r) => r.date === '2026-10-02' && r.name === 'Gandhi Jayanti'),
  );
  // Six VEVENTs in, four rows out: one is last year's and one is a second
  // event on 26 January.
  check('nothing from the wrong year survived', rows.length === 4, `${rows.length} rows`);

  // ------------------------------------------------------------ api parser
  const api = parseApiEvents(
    {
      items: [
        { summary: 'Republic Day', start: { date: '2026-01-26' } },
        { summary: 'Diwali', start: { date: '2026-11-08' } },
        { summary: 'Last year', start: { date: '2025-01-26' } },
        { summary: 'No date at all' },
        { summary: '', start: { date: '2026-05-01' } },
        { summary: 'Timed', start: { dateTime: '2026-08-15T00:00:00Z' } },
      ],
    },
    2026,
  );
  check(
    'the API parser keeps only this year, named events',
    api.length === 3 &&
      api[0].date === '2026-01-26' &&
      api.some((r) => r.date === '2026-08-15' && r.name === 'Timed'),
    api.map((r) => r.date).join(' '),
  );
  check('an API response with no items is empty, not a crash', parseApiEvents({}, 2026).length === 0);

  // --------------------------------------------------- current year only
  await getDb(); // v1 -> v4
  const raw = __raw();

  // Seed a previous year, as a device that was used last year would have.
  await replaceYear(2025, [
    { date: '2025-01-26', name: 'Republic Day', region: 'IN' },
    { date: '2025-08-15', name: 'Independence Day', region: 'IN' },
  ]);
  check('last year was stored', (await countHolidays(2025)) === 2);

  // Now the app is opened in the new year.
  const written = await replaceYear(
    2026,
    rows.map((r) => ({ ...r, region: 'IN' })),
  );
  check('this year was written', written === 4, `${written} rows`);
  check('last year was deleted', (await countHolidays(2025)) === 0);
  check(
    'the table holds one year and nothing else',
    raw.prepare('SELECT COUNT(*) AS n FROM holidays').get().n === 4,
  );

  // A refresh of the same year replaces rather than duplicating.
  await replaceYear(
    2026,
    rows.map((r) => ({ ...r, region: 'IN' })),
  );
  check(
    'refreshing the same year does not duplicate rows',
    raw.prepare('SELECT COUNT(*) AS n FROM holidays').get().n === 4,
  );

  const stored = await listHolidays(2026);
  check(
    'listHolidays returns the year in date order',
    stored.length === 4 &&
      stored[0].date === '2026-01-26' &&
      stored[stored.length - 1].date === '2026-10-02',
    stored.map((r) => r.date).join(' '),
  );
  check('the region is stamped', stored.every((r) => r.region === 'IN'));

  // The screen's "re-fetch if not found" hinges on this being 0 after a wipe,
  // which is what a logout, a crash, a reinstall or a new phone all look like.
  raw.exec('DELETE FROM holidays');
  check('an empty table is what triggers a re-fetch', (await countHolidays(2026)) === 0);

  console.log(`\n${failures === 0 ? 'ALL CHECKS PASSED' : failures + ' CHECK(S) FAILED'}`);
  raw.close();
  rmSync(dir, { recursive: true, force: true });
  process.exit(failures === 0 ? 0 : 1);
})().catch((e) => {
  console.error('harness crashed:', e);
  process.exit(1);
});
