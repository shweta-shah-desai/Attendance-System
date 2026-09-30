/**
 * Extracts the GharSaathi+ illustration mark from the splash artwork and
 * writes it as a light disc with transparent corners, so it can sit directly
 * on the brand-blue splash background.
 *
 * The shipped splash art is a 1264x848 landscape marketing mockup: a phone
 * frame drawn on a wide backdrop, with the real brand block occupying only
 * 367x569px of it. This pulls out just the calendar/tick/fingerprint mark so
 * the splash screen can compose its own layout around it.
 *
 * Run with: node scripts/build-splash-mark.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PNG } from 'pngjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/** Source without the baked-in grey checkerboard. */
const SOURCE = path.join(root, 'assets/images/Splash_Image_old.png');
const OUT = path.join(root, 'assets/images/splash-mark.png');

/** Mark bounds inside the source, found by scanning for bands of ink. */
const MARK = { x: 517, y: 487, w: 292, h: 223 };
/** The near-white card the mark is drawn on in the source. */
const SOURCE_BG = [244, 248, 249];
/** colors.background - what we repaint the mark's backing to. */
const TARGET_BG = [247, 249, 252];

const SIZE = 400;
/** Feather width of the disc edge, in pixels. */
const EDGE = 1.5;

const src = PNG.sync.read(fs.readFileSync(SOURCE));
const out = new PNG({ width: SIZE, height: SIZE });

// Paint the backing disc. The mark's own navy is #204060, near-identical to
// the brand blue behind it, so it needs a light backing to stay visible.
const centre = (SIZE - 1) / 2;
const radius = SIZE / 2;

for (let y = 0; y < SIZE; y++) {
  for (let x = 0; x < SIZE; x++) {
    const dist = Math.hypot(x - centre, y - centre);
    const alpha = Math.max(0, Math.min(1, (radius - dist) / EDGE));
    const i = (y * SIZE + x) * 4;
    out.data[i] = TARGET_BG[0];
    out.data[i + 1] = TARGET_BG[1];
    out.data[i + 2] = TARGET_BG[2];
    out.data[i + 3] = Math.round(alpha * 255);
  }
}

const offX = Math.round((SIZE - MARK.w) / 2);
const offY = Math.round((SIZE - MARK.h) / 2);

for (let y = 0; y < MARK.h; y++) {
  for (let x = 0; x < MARK.w; x++) {
    const s = ((MARK.y + y) * src.width + (MARK.x + x)) * 4;
    const rgb = [src.data[s], src.data[s + 1], src.data[s + 2]];

    // How much ink covers this pixel, measured against the source card colour.
    // Fully inked pixels keep their exact colour; only the uncovered fraction
    // is re-tinted, so anti-aliased edges stay clean against the new backing.
    const coverage = 1 - Math.min(...rgb.map((c, i) => Math.min(1, c / SOURCE_BG[i])));
    const bare = 1 - coverage;

    const d = ((offY + y) * SIZE + (offX + x)) * 4;
    for (let c = 0; c < 3; c++) {
      const shifted = rgb[c] + (TARGET_BG[c] - SOURCE_BG[c]) * bare;
      out.data[d + c] = Math.max(0, Math.min(255, Math.round(shifted)));
    }
    // The mark sits well inside the disc, so it never clips the feathered rim.
  }
}

fs.writeFileSync(OUT, PNG.sync.write(out));
console.log(
  `wrote ${path.relative(root, OUT)} ${SIZE}x${SIZE} ` +
    `(${(fs.statSync(OUT).size / 1024).toFixed(0)} KB)`,
);
