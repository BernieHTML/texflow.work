// Renders public/ourmoon/og.png — the 1200x630 social card for OurMoon.
//
// There is no image toolchain in this repo (no sharp, no ImageMagick, no
// cairosvg) and social platforms will not render an SVG og:image, so the card
// is rasterised here from primitives and encoded as a PNG by hand. Everything
// is drawn at 2x and box-filtered down, which is enough antialiasing for flat
// shapes and stroked text.
//
//   node scripts/ourmoon-og.js

import { deflateSync } from 'zlib';
import { writeFile } from 'fs/promises';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const OUT = join(ROOT, 'public', 'ourmoon', 'og.png');

const W = 1200;
const H = 630;
const SS = 2;                 // supersample factor
const CW = W * SS;
const CH = H * SS;

const px = new Uint8Array(CW * CH * 3);

// ------------------------------------------------------------- primitives ---

const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);

function hex(color) {
  const n = parseInt(color.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function blend(x, y, rgb, alpha = 1) {
  if (x < 0 || y < 0 || x >= CW || y >= CH || alpha <= 0) return;
  const i = (y * CW + x) * 3;
  const a = clamp01(alpha);
  px[i] = px[i] + (rgb[0] - px[i]) * a;
  px[i + 1] = px[i + 1] + (rgb[1] - px[i + 1]) * a;
  px[i + 2] = px[i + 2] + (rgb[2] - px[i + 2]) * a;
}

function fillAll(color) {
  const rgb = hex(color);
  for (let i = 0; i < px.length; i += 3) {
    px[i] = rgb[0];
    px[i + 1] = rgb[1];
    px[i + 2] = rgb[2];
  }
}

/** Soft radial wash, used for the background glow behind the pole disc. */
function glow(cx, cy, radius, color, peak = 0.5) {
  const rgb = hex(color);
  const r = radius * SS;
  const x0 = Math.max(0, Math.floor(cx * SS - r));
  const x1 = Math.min(CW - 1, Math.ceil(cx * SS + r));
  const y0 = Math.max(0, Math.floor(cy * SS - r));
  const y1 = Math.min(CH - 1, Math.ceil(cy * SS + r));
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      const d = Math.hypot(x - cx * SS, y - cy * SS) / r;
      if (d >= 1) continue;
      blend(x, y, rgb, peak * (1 - d) * (1 - d));
    }
  }
}

function disc(cx, cy, radius, color, alpha = 1) {
  const rgb = hex(color);
  const r = radius * SS;
  const px0 = cx * SS;
  const py0 = cy * SS;
  for (let y = Math.floor(py0 - r - 1); y <= Math.ceil(py0 + r + 1); y++) {
    for (let x = Math.floor(px0 - r - 1); x <= Math.ceil(px0 + r + 1); x++) {
      const d = Math.hypot(x - px0, y - py0);
      if (d > r + 0.7) continue;
      blend(x, y, rgb, alpha * clamp01(r + 0.5 - d));
    }
  }
}

function ring(cx, cy, radius, width, color, alpha = 1) {
  const rgb = hex(color);
  const r = radius * SS;
  const half = (width * SS) / 2;
  const px0 = cx * SS;
  const py0 = cy * SS;
  for (let y = Math.floor(py0 - r - half - 1); y <= Math.ceil(py0 + r + half + 1); y++) {
    for (let x = Math.floor(px0 - r - half - 1); x <= Math.ceil(px0 + r + half + 1); x++) {
      const d = Math.abs(Math.hypot(x - px0, y - py0) - r);
      if (d > half + 0.7) continue;
      blend(x, y, rgb, alpha * clamp01(half + 0.5 - d));
    }
  }
}

function segment(x1, y1, x2, y2, width, color, alpha = 1) {
  const rgb = hex(color);
  const ax = x1 * SS;
  const ay = y1 * SS;
  const bx = x2 * SS;
  const by = y2 * SS;
  const half = (width * SS) / 2;
  const minX = Math.floor(Math.min(ax, bx) - half - 1);
  const maxX = Math.ceil(Math.max(ax, bx) + half + 1);
  const minY = Math.floor(Math.min(ay, by) - half - 1);
  const maxY = Math.ceil(Math.max(ay, by) + half + 1);
  const dx = bx - ax;
  const dy = by - ay;
  const len2 = dx * dx + dy * dy || 1;
  for (let y = minY; y <= maxY; y++) {
    for (let x = minX; x <= maxX; x++) {
      const t = clamp01(((x - ax) * dx + (y - ay) * dy) / len2);
      const d = Math.hypot(x - (ax + t * dx), y - (ay + t * dy));
      if (d > half + 0.7) continue;
      blend(x, y, rgb, alpha * clamp01(half + 0.5 - d));
    }
  }
}

function roundRect(x, y, w, h, r, color, alpha = 1) {
  const rgb = hex(color);
  for (let py0 = Math.floor(y * SS); py0 < Math.ceil((y + h) * SS); py0++) {
    for (let px0 = Math.floor(x * SS); px0 < Math.ceil((x + w) * SS); px0++) {
      const lx = px0 / SS - x;
      const ly = py0 / SS - y;
      const cx = Math.min(Math.max(lx, r), w - r);
      const cy = Math.min(Math.max(ly, r), h - r);
      const d = Math.hypot(lx - cx, ly - cy);
      if (d > r + 0.5) continue;
      blend(px0, py0, rgb, alpha * clamp01((r + 0.5 - d) * SS));
    }
  }
}

// ------------------------------------------------------------ stroke font ---
// Each glyph is a set of polylines on a 6 x 10 box. Good enough for a wordmark
// and a couple of lines of caps, which is all this card needs.

const FONT = {
  A: [[[0, 10], [3, 0], [6, 10]], [[1, 7], [5, 7]]],
  B: [[[0, 0], [0, 10]], [[0, 0], [4, 0], [5.5, 1.5], [5.5, 3.5], [4, 5], [0, 5]], [[0, 5], [4.5, 5], [6, 6.5], [6, 8.5], [4.5, 10], [0, 10]]],
  C: [[[6, 2], [4, 0], [2, 0], [0, 2], [0, 8], [2, 10], [4, 10], [6, 8]]],
  D: [[[0, 0], [0, 10]], [[0, 0], [3.5, 0], [6, 2.5], [6, 7.5], [3.5, 10], [0, 10]]],
  E: [[[6, 0], [0, 0], [0, 10], [6, 10]], [[0, 5], [4.5, 5]]],
  F: [[[6, 0], [0, 0], [0, 10]], [[0, 5], [4.5, 5]]],
  G: [[[6, 2], [4, 0], [2, 0], [0, 2], [0, 8], [2, 10], [4, 10], [6, 8], [6, 5.5], [3.5, 5.5]]],
  H: [[[0, 0], [0, 10]], [[6, 0], [6, 10]], [[0, 5], [6, 5]]],
  I: [[[1, 0], [5, 0]], [[3, 0], [3, 10]], [[1, 10], [5, 10]]],
  J: [[[6, 0], [6, 7.5], [4, 10], [2, 10], [0, 8]]],
  K: [[[0, 0], [0, 10]], [[6, 0], [0.2, 5.5]], [[2.2, 4], [6, 10]]],
  L: [[[0, 0], [0, 10], [6, 10]]],
  M: [[[0, 10], [0, 0], [3, 5], [6, 0], [6, 10]]],
  N: [[[0, 10], [0, 0], [6, 10], [6, 0]]],
  O: [[[2, 0], [4, 0], [6, 2], [6, 8], [4, 10], [2, 10], [0, 8], [0, 2], [2, 0]]],
  P: [[[0, 10], [0, 0], [4.5, 0], [6, 1.5], [6, 4], [4.5, 5.5], [0, 5.5]]],
  Q: [[[2, 0], [4, 0], [6, 2], [6, 8], [4, 10], [2, 10], [0, 8], [0, 2], [2, 0]], [[3.5, 7], [6, 10]]],
  R: [[[0, 10], [0, 0], [4.5, 0], [6, 1.5], [6, 4], [4.5, 5.5], [0, 5.5]], [[3, 5.5], [6, 10]]],
  S: [[[6, 2], [4, 0], [2, 0], [0, 2], [0, 3.5], [2, 5], [4, 5], [6, 6.5], [6, 8], [4, 10], [2, 10], [0, 8]]],
  T: [[[0, 0], [6, 0]], [[3, 0], [3, 10]]],
  U: [[[0, 0], [0, 8], [2, 10], [4, 10], [6, 8], [6, 0]]],
  V: [[[0, 0], [3, 10], [6, 0]]],
  W: [[[0, 0], [1.5, 10], [3, 4], [4.5, 10], [6, 0]]],
  X: [[[0, 0], [6, 10]], [[6, 0], [0, 10]]],
  Y: [[[0, 0], [3, 5], [6, 0]], [[3, 5], [3, 10]]],
  Z: [[[0, 0], [6, 0], [0, 10], [6, 10]]],
  '0': [[[2, 0], [4, 0], [6, 2], [6, 8], [4, 10], [2, 10], [0, 8], [0, 2], [2, 0]]],
  '1': [[[1, 2], [3, 0], [3, 10]], [[1, 10], [5, 10]]],
  '/': [[[5, 0], [1, 10]]],
  '.': [[[2.9, 10], [3.1, 10]]],
  '·': [[[2.9, 5], [3.1, 5]]],
  ' ': []
};

/** Draw text; size = cap height in px. Returns the advance width used. */
function text(str, x, y, size, color, weight = 0.12, tracking = 0.34, alpha = 1) {
  const unit = size / 10;
  const stroke = Math.max(1.2, size * weight);
  let cursor = x;
  for (const ch of str.toUpperCase()) {
    const glyph = FONT[ch];
    if (glyph === undefined) {
      cursor += size * 0.5;
      continue;
    }
    for (const line of glyph) {
      for (let i = 1; i < line.length; i++) {
        segment(
          cursor + line[i - 1][0] * unit, y + line[i - 1][1] * unit,
          cursor + line[i][0] * unit, y + line[i][1] * unit,
          stroke, color, alpha
        );
      }
    }
    cursor += 6 * unit + size * tracking;
  }
  return cursor - x;
}

function textWidth(str, size, tracking = 0.34) {
  return str.length * (6 * (size / 10) + size * tracking);
}

// ----------------------------------------------------------------- scene ---

const INK = '#eaf0f7';
const MUTED = '#93a1b3';
const ACCENT = '#7ee0c8';
const PEL = '#ffc94d';
const PSR = '#39b6ff';
const LTEC = '#ff9f5c';

fillAll('#05070c');
glow(880, 250, 470, '#0d3b4d', 0.55);
glow(300, 560, 420, '#12352c', 0.35);

// --- right-hand pole disc -----------------------------------------------
const CX = 890;
const CY = 315;
const R = 232;

disc(CX, CY, R, '#161d26');
disc(CX, CY, R - 2, '#1d2731');
// A few lightness bands so the disc reads as terrain rather than a flat circle.
disc(CX - 60, CY - 70, 120, '#242f3b', 0.55);
disc(CX + 70, CY + 40, 150, '#202934', 0.6);
disc(CX - 20, CY + 110, 90, '#262f3a', 0.45);
ring(CX, CY, R, 2, '#2c3947');

// PSRs — the cold sinks.
const psrBlobs = [
  [-70, -60, 44], [30, -95, 30], [95, -20, 36], [60, 75, 40],
  [-40, 90, 34], [-120, 20, 26], [10, 20, 22], [140, -80, 20], [-95, -125, 18]
];
for (const [dx, dy, r] of psrBlobs) {
  disc(CX + dx, CY + dy, r, PSR, 0.3);
  ring(CX + dx, CY + dy, r, 1.6, PSR, 0.75);
}

// Peaks of eternal light — the hot sides.
const pelSpots = [[-18, -22, 15], [66, 22, 13], [-72, 42, 12], [46, -52, 11]];
for (const [dx, dy, r] of pelSpots) {
  disc(CX + dx, CY + dy, r, PEL, 0.34);
  ring(CX + dx, CY + dy, r, 1.6, PEL, 0.9);
}

// A claimed base with its 10 km ring, LTEC plant and power tether.
const BX = CX - 18;
const BY = CY + 4;
const LX = CX - 66;
const LY = CY + 40;
disc(BX, BY, 62, ACCENT, 0.08);
ring(BX, BY, 62, 1.8, ACCENT, 0.75);
segment(BX, BY, LX, LY, 2, LTEC, 0.85);

function marker(x, y, color, kind) {
  roundRect(x - 17, y - 17, 34, 34, 10, '#070b11', 0.94);
  // border
  ring(x, y, 0, 0, color, 0);
  for (let i = 0; i < 1; i++) {
    // rounded-rect outline drawn as four segments + corners
    segment(x - 7, y - 17, x + 7, y - 17, 2, color);
    segment(x - 7, y + 17, x + 7, y + 17, 2, color);
    segment(x - 17, y - 7, x - 17, y + 7, 2, color);
    segment(x + 17, y - 7, x + 17, y + 7, 2, color);
    segment(x - 16.4, y - 12.2, x - 12.2, y - 16.4, 2, color);
    segment(x + 16.4, y - 12.2, x + 12.2, y - 16.4, 2, color);
    segment(x - 16.4, y + 12.2, x - 12.2, y + 16.4, 2, color);
    segment(x + 16.4, y + 12.2, x + 12.2, y + 16.4, 2, color);
  }
  if (kind === 'base') {
    // habitat dome
    for (let a = 180; a <= 360; a += 6) {
      const a2 = a + 6;
      segment(
        x + 9 * Math.cos((a * Math.PI) / 180), y + 5 + 9 * Math.sin((a * Math.PI) / 180),
        x + 9 * Math.cos((a2 * Math.PI) / 180), y + 5 + 9 * Math.sin((a2 * Math.PI) / 180),
        2.2, color
      );
    }
    segment(x - 10, y + 5, x + 10, y + 5, 2.2, color);
    segment(x, y - 4, x, y + 5, 2.2, color);
  } else {
    // hot plate / bolt / cold plate
    segment(x - 9, y - 8, x + 9, y - 8, 2.2, color);
    segment(x - 9, y + 8, x + 9, y + 8, 2.2, color);
    segment(x + 3, y - 5, x - 3, y + 1, 2.2, color);
    segment(x - 3, y + 1, x + 3, y + 1, 2.2, color);
    segment(x + 3, y + 1, x - 2, y + 6, 2.2, color);
  }
}
marker(BX, BY, ACCENT, 'base');
marker(LX, LY, LTEC, 'ltec');

// --- left-hand type ------------------------------------------------------
segment(84, 118, 84 + 46, 118, 3, ACCENT);
text('LUNAR SOUTH POLE', 84, 146, 17, ACCENT, 0.14, 0.42);
text('OURMOON', 82, 196, 78, INK, 0.115, 0.2);
text('CLAIM YOUR', 84, 316, 34, INK, 0.12, 0.3);
text('LUNAR BASE', 84, 372, 34, INK, 0.12, 0.3);
text('POWER IT WITH AN LTEC PLANT', 84, 444, 17, MUTED, 0.13, 0.4);
text('BETWEEN ETERNAL LIGHT AND', 84, 476, 17, MUTED, 0.13, 0.4);
text('PERMANENT SHADOW', 84, 508, 17, MUTED, 0.13, 0.4);

const footer = 'TEXFLOW.WORK/OURMOON';
text(footer, 84, 560, 15, ACCENT, 0.14, 0.44);

// small colour key next to the footer
const keyX = 84 + textWidth(footer, 15, 0.44) + 26;
disc(keyX, 566, 5, PSR, 0.9);
disc(keyX + 22, 566, 5, PEL, 0.9);
disc(keyX + 44, 566, 5, ACCENT, 0.9);

// ------------------------------------------------------------ downsample ---

const out = Buffer.alloc(W * H * 3);
for (let y = 0; y < H; y++) {
  for (let x = 0; x < W; x++) {
    let r = 0;
    let g = 0;
    let b = 0;
    for (let sy = 0; sy < SS; sy++) {
      for (let sx = 0; sx < SS; sx++) {
        const i = ((y * SS + sy) * CW + (x * SS + sx)) * 3;
        r += px[i];
        g += px[i + 1];
        b += px[i + 2];
      }
    }
    const n = SS * SS;
    const o = (y * W + x) * 3;
    out[o] = Math.round(r / n);
    out[o + 1] = Math.round(g / n);
    out[o + 2] = Math.round(b / n);
  }
}

// --------------------------------------------------------------- encoder ---

const CRC_TABLE = (() => {
  const table = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c;
  }
  return table;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body), 0);
  return Buffer.concat([length, body, crc]);
}

const ihdr = Buffer.alloc(13);
ihdr.writeUInt32BE(W, 0);
ihdr.writeUInt32BE(H, 4);
ihdr[8] = 8;    // bit depth
ihdr[9] = 2;    // colour type: truecolour
ihdr[10] = 0;
ihdr[11] = 0;
ihdr[12] = 0;

// One filter byte (none) per scanline.
const raw = Buffer.alloc(H * (1 + W * 3));
for (let y = 0; y < H; y++) {
  raw[y * (1 + W * 3)] = 0;
  out.copy(raw, y * (1 + W * 3) + 1, y * W * 3, (y + 1) * W * 3);
}

const png = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  chunk('IHDR', ihdr),
  chunk('IDAT', deflateSync(raw, { level: 9 })),
  chunk('IEND', Buffer.alloc(0))
]);

await writeFile(OUT, png);
console.log(`Wrote ${OUT} — ${W}x${H}, ${(png.length / 1024).toFixed(1)} kB`);
