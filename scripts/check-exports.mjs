/**
 * Checks that every named import from a LOCAL module is actually exported by
 * that module (following `export * from` barrels). Complements
 * check-imports.mjs, which only proves the file exists.
 *
 *   node scripts/check-exports.mjs
 */
import { readdirSync, readFileSync, statSync, existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

const ROOTS = ['app', 'src'];
const EXTS = ['.ts', '.tsx', '.js', '.jsx'];

const walk = (dir, out = []) => {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (/\.(ts|tsx)$/.test(entry)) out.push(full);
  }
  return out;
};

const resolveFile = (from, spec) => {
  const base = resolve(dirname(from), spec);
  for (const ext of EXTS) if (existsSync(base + ext)) return base + ext;
  for (const ext of EXTS) {
    const idx = join(base, 'index' + ext);
    if (existsSync(idx)) return idx;
  }
  return null;
};

const cache = new Map();

const exportsOf = (file, seen = new Set()) => {
  if (cache.has(file)) return cache.get(file);
  if (seen.has(file)) return new Set();
  seen.add(file);

  const src = readFileSync(file, 'utf8');
  const names = new Set();

  for (const m of src.matchAll(
    /export\s+(?:declare\s+)?(?:async\s+)?(?:const|let|var|function|class|interface|type|enum)\s+([A-Za-z0-9_$]+)/g,
  )) {
    names.add(m[1]);
  }
  // export { a, b as c }
  for (const m of src.matchAll(/export\s*\{([^}]*)\}(?!\s*from)/g)) {
    for (const part of m[1].split(',')) {
      const bits = part.trim().split(/\s+as\s+/);
      const name = (bits[1] ?? bits[0]).trim();
      if (name) names.add(name);
    }
  }
  // export { a } from './x'
  for (const m of src.matchAll(/export\s*\{([^}]*)\}\s*from\s*['"]([^'"]+)['"]/g)) {
    for (const part of m[1].split(',')) {
      const bits = part.trim().split(/\s+as\s+/);
      const name = (bits[1] ?? bits[0]).trim();
      if (name) names.add(name);
    }
  }
  if (/export\s+default/.test(src)) names.add('default');

  // export * from './x'  -> pull in everything that module exports
  for (const m of src.matchAll(/export\s*\*\s*from\s*['"]([^'"]+)['"]/g)) {
    const target = resolveFile(file, m[1]);
    if (target) for (const n of exportsOf(target, seen)) names.add(n);
  }

  cache.set(file, names);
  return names;
};

const files = ROOTS.flatMap((r) => (existsSync(r) ? walk(r) : []));
let missing = 0;
let checked = 0;

for (const file of files) {
  const src = readFileSync(file, 'utf8');

  for (const m of src.matchAll(/import\s+(?:type\s+)?\{([^}]*)\}\s*from\s*['"](\.[^'"]+)['"]/g)) {
    const target = resolveFile(file, m[2]);
    if (!target) continue; // check-imports.mjs reports this
    const available = exportsOf(target);

    for (const part of m[1].split(',')) {
      const raw = part.trim().replace(/^type\s+/, '');
      if (!raw) continue;
      const name = raw.split(/\s+as\s+/)[0].trim();
      checked++;
      if (!available.has(name)) {
        missing++;
        console.log('MISSING  ' + name + '  from ' + m[2] + '  (used in ' + file + ')');
      }
    }
  }
}

console.log('');
console.log('named local imports checked: ' + checked);
console.log(missing === 0 ? 'Every named import is exported.' : missing + ' MISSING export(s).');
process.exit(missing === 0 ? 0 : 1);
