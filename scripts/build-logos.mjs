/**
 * Builds the two wordmark variants the UI needs, from the one clean source.
 *
 * assets/images/logo.png is a 5146x832 re-export that has a dark grey
 * checkerboard baked into every pixel (it is fully opaque - the checker is
 * image data, not transparency), so it renders as a grey block on the brand
 * band. logo_old.png is the same wordmark exported correctly: 600x97 with a
 * real alpha channel. 600px is ample - the wordmark is drawn at most 81pt
 * wide, which is 243px at @3x.
 *
 * The source is navy + orange, which only works on light surfaces. Screens on
 * the brand band need the light variant, so the navy is recoloured to white
 * and the orange accents are kept. Navy and orange are told apart by whether
 * the pixel leans red or blue; alpha is carried through untouched, so edges
 * stay anti-aliased.
 *
 * Run with: node scripts/build-logos.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PNG } from 'pngjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const SOURCE = path.join(root, 'assets/images/logo_old.png');
const ON_LIGHT = path.join(root, 'assets/images/logo-on-light.png');
const ON_DARK = path.join(root, 'assets/images/logo-on-dark.png');

const src = PNG.sync.read(fs.readFileSync(SOURCE));

/** Navy as-is: for white cards and panels. */
const onLight = new PNG({ width: src.width, height: src.height });
src.data.copy(onLight.data);
fs.writeFileSync(ON_LIGHT, PNG.sync.write(onLight));

/** Navy repainted white: for the brand-blue band. */
const onDark = new PNG({ width: src.width, height: src.height });
src.data.copy(onDark.data);

for (let i = 0; i < onDark.data.length; i += 4) {
  if (onDark.data[i + 3] === 0) continue;
  // Orange leans red, navy leans blue. Only the navy is repainted, so the
  // accent on "har" and the "+" dot survive.
  const leansRed = onDark.data[i] > onDark.data[i + 2];
  if (!leansRed) {
    onDark.data[i] = 255;
    onDark.data[i + 1] = 255;
    onDark.data[i + 2] = 255;
  }
}

fs.writeFileSync(ON_DARK, PNG.sync.write(onDark));

for (const f of [ON_LIGHT, ON_DARK]) {
  console.log(
    `wrote ${path.relative(root, f)} ${src.width}x${src.height} ` +
      `(${(fs.statSync(f).size / 1024).toFixed(0)} KB)`,
  );
}
