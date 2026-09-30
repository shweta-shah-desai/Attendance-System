/**
 * Resolves every relative import / require in app/ and src/ against the file
 * system. Catches broken paths without needing node_modules installed.
 *
 *   node scripts/check-imports.mjs
 */
import { readdirSync, readFileSync, statSync, existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

const ROOTS = ['app', 'src'];
const EXTS = ['.ts', '.tsx', '.js', '.jsx', '.json', '.png', '.jpg', '.svg', ''];

const walk = (dir, out = []) => {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (/\.(ts|tsx)$/.test(entry)) out.push(full);
  }
  return out;
};

const resolves = (from, spec) => {
  const base = resolve(dirname(from), spec);
  for (const ext of EXTS) {
    if (existsSync(base + ext) && statSync(base + ext).isFile()) return true;
  }
  for (const ext of EXTS) {
    const idx = join(base, 'index' + ext);
    if (existsSync(idx) && statSync(idx).isFile()) return true;
  }
  return false;
};

const files = ROOTS.flatMap((r) => (existsSync(r) ? walk(r) : []));
let broken = 0;
let checked = 0;

for (const file of files) {
  const src = readFileSync(file, 'utf8');
  const specs = [];

  // import ... from 'x'  /  export ... from 'x'  /  require('x')
  for (const m of src.matchAll(/from\s+['"]([^'"]+)['"]/g)) specs.push(m[1]);
  for (const m of src.matchAll(/require\(\s*['"]([^'"]+)['"]\s*\)/g)) specs.push(m[1]);

  for (const spec of specs) {
    if (!spec.startsWith('.')) continue; // package import - skipped
    checked++;
    if (!resolves(file, spec)) {
      broken++;
      console.log('BROKEN  ' + file + '  ->  ' + spec);
    }
  }
}

console.log('');
console.log('files scanned:    ' + files.length);
console.log('relative imports: ' + checked);
console.log(broken === 0 ? 'All relative imports resolve.' : broken + ' BROKEN import(s).');
process.exit(broken === 0 ? 0 : 1);
