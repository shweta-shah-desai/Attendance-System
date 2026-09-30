/**
 * Checks that no SQL string uses a double-quoted literal.
 *
 * SQLite reads "x" as an identifier, not a string. Native builds default to
 * the permissive SQLITE_DQS=3 and silently fall back to treating it as text,
 * but the wa-sqlite WASM behind expo-sqlite on web is compiled SQLITE_DQS=0
 * and rejects the whole statement with `no such column: ""`. A query written
 * that way therefore works on a phone and fails in a browser, which is an
 * expensive thing to debug - `listWorkingEmployees` cost us the entire Hajari
 * screen once already.
 *
 *   node scripts/check-sql.mjs
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = 'src/db';
const SQL = /\b(SELECT|INSERT INTO|UPDATE|DELETE FROM|WHERE|VALUES|CREATE TABLE|ORDER BY|IS NULL|COALESCE)\b/i;

const walk = (dir, out = []) => {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (/\.(ts|tsx)$/.test(entry)) out.push(full);
  }
  return out;
};

/**
 * Single-quoted and template literals only. A double-quoted JS string cannot
 * contain a bare `"`, so it is always the safe way to write SQL that needs
 * single quotes of its own - exactly what this check is steering toward.
 */
const LITERALS = /'((?:[^'\\\n]|\\.)*)'|`((?:[^`\\]|\\.)*)`/g;

let scanned = 0;
let bad = 0;

for (const file of walk(ROOT)) {
  const src = readFileSync(file, 'utf8');
  for (const m of src.matchAll(LITERALS)) {
    const body = m[1] ?? m[2] ?? '';
    if (!SQL.test(body)) continue;
    scanned++;
    if (!body.includes('"')) continue;
    bad++;
    const line = src.slice(0, m.index).split('\n').length;
    console.log('DOUBLE-QUOTED  ' + file + ':' + line);
    console.log('               ' + body.trim().slice(0, 100));
  }
}

console.log('');
console.log('SQL strings checked: ' + scanned);
console.log(
  bad === 0
    ? 'No double-quoted literals in SQL.'
    : bad + ' SQL string(s) use double quotes - SQLite reads those as identifiers.',
);
process.exit(bad === 0 ? 0 : 1);
