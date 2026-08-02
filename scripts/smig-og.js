// Renders the smig snowman to the PNGs that link previews use.
//
// There is no rasteriser on this box (no sharp, no resvg, no cairo), and an
// SVG og:image is ignored by WhatsApp, iMessage and most other unfurlers — so
// this draws the same shapes as public/smig/logo.svg directly into a pixel
// buffer and writes the PNG with zlib, which node already has.
//
// Coverage is computed by supersampling: each pixel takes 4x4 subsamples, each
// subsample keeps the last shape that contains it (painter's order), and the
// results are averaged. That gives clean antialiasing without a graphics stack.
//
//   node scripts/smig-og.js
//
// Outputs public/smig/og.png (1200x630, what unfurlers crop) and
// public/smig/icon-512.png (square, for the web app manifest).

import { deflateSync } from 'zlib';
import { writeFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT_DIR = join(__dirname, '..', 'public', 'smig');

const PAPER = [0xF4, 0xF1, 0xEC];
const WHITE = [0xFF, 0xFF, 0xFF];
const INK = [0x17, 0x13, 0x0F];
const CARROT = [0xE8, 0x70, 0x3A];

// ------------------------------------------------------------------ geometry ---

const dist = (x, y, cx, cy) => Math.hypot(x - cx, y - cy);

const circle = (cx, cy, r, colour) => ({
  colour, hit: (x, y) => dist(x, y, cx, cy) <= r
});

/** A stroked circle: the ring between two radii. */
const ring = (cx, cy, r, width, colour) => ({
  colour,
  hit: (x, y) => {
    const d = dist(x, y, cx, cy);
    return d >= r - width / 2 && d <= r + width / 2;
  }
});

const triangle = (ax, ay, bx, by, cx, cy, colour) => {
  const sign = (px, py, qx, qy, rx, ry) => (px - rx) * (qy - ry) - (qx - rx) * (py - ry);
  return {
    colour,
    hit: (x, y) => {
      const d1 = sign(x, y, ax, ay, bx, by);
      const d2 = sign(x, y, bx, by, cx, cy);
      const d3 = sign(x, y, cx, cy, ax, ay);
      const neg = d1 < 0 || d2 < 0 || d3 < 0;
      const pos = d1 > 0 || d2 > 0 || d3 > 0;
      return !(neg && pos);
    }
  };
};

/**
 * A round-capped stroke along a quadratic bezier — the smile. The curve is
 * flattened to segments once, then a point is inside if it is within half the
 * stroke width of any segment.
 */
const quadStroke = (p0, p1, p2, width, colour, steps = 48) => {
  const pts = [];
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const u = 1 - t;
    pts.push([
      u * u * p0[0] + 2 * u * t * p1[0] + t * t * p2[0],
      u * u * p0[1] + 2 * u * t * p1[1] + t * t * p2[1]
    ]);
  }
  const half = width / 2;
  return {
    colour,
    hit: (x, y) => {
      for (let i = 1; i < pts.length; i++) {
        const [x1, y1] = pts[i - 1];
        const [x2, y2] = pts[i];
        const dx = x2 - x1;
        const dy = y2 - y1;
        const len2 = dx * dx + dy * dy;
        let t = len2 ? ((x - x1) * dx + (y - y1) * dy) / len2 : 0;
        t = t < 0 ? 0 : t > 1 ? 1 : t;
        if (Math.hypot(x - (x1 + t * dx), y - (y1 + t * dy)) <= half) return true;
      }
      return false;
    }
  };
};

/** The snowman in the 512x512 coordinate space of logo.svg, painter's order. */
function snowman() {
  return [
    ring(256, 345, 104, 14, INK),
    circle(256, 345, 104 - 7, WHITE),
    ring(256, 196, 72, 14, INK),
    circle(256, 196, 72 - 7, WHITE),
    circle(232, 184, 9, INK),
    circle(284, 184, 9, INK),
    triangle(256, 202, 300, 214, 256, 224, CARROT),
    quadStroke([228, 226], [256, 248], [284, 232], 11, INK),
    circle(256, 318, 9, INK),
    circle(256, 360, 9, INK)
  ];
}

// ------------------------------------------------------------------- raster ---

/**
 * @param scale  pixels per unit of the 512-space
 * @param ox,oy  where the 512-box's top-left lands on the canvas
 */
function render(width, height, scale, ox, oy) {
  const shapes = snowman();
  const rgb = Buffer.alloc(width * height * 3);
  const SS = 4;               // subsamples per axis
  const step = 1 / SS;
  const offset = step / 2;

  for (let py = 0; py < height; py++) {
    for (let px = 0; px < width; px++) {
      let r = 0, g = 0, b = 0;

      for (let sy = 0; sy < SS; sy++) {
        for (let sx = 0; sx < SS; sx++) {
          // Back to logo coordinates for the hit tests.
          const x = (px + offset + sx * step - ox) / scale;
          const y = (py + offset + sy * step - oy) / scale;

          let colour = PAPER;
          for (const shape of shapes) {
            if (shape.hit(x, y)) colour = shape.colour;
          }
          r += colour[0]; g += colour[1]; b += colour[2];
        }
      }

      const n = SS * SS;
      const i = (py * width + px) * 3;
      rgb[i] = Math.round(r / n);
      rgb[i + 1] = Math.round(g / n);
      rgb[i + 2] = Math.round(b / n);
    }
  }
  return rgb;
}

// ---------------------------------------------------------------------- png ---

function crc32(buf) {
  let c = ~0;
  for (let i = 0; i < buf.length; i++) {
    c ^= buf[i];
    for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xEDB88320 & -(c & 1));
  }
  return ~c >>> 0;
}

function chunk(type, data) {
  const head = Buffer.alloc(8);
  head.writeUInt32BE(data.length, 0);
  head.write(type, 4, 'ascii');
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([head.subarray(4), data])), 0);
  return Buffer.concat([head, data, crc]);
}

function png(width, height, rgb) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;    // bit depth
  ihdr[9] = 2;    // truecolour
  // Each scanline is prefixed with its filter byte; 0 is "none".
  const raw = Buffer.alloc(height * (width * 3 + 1));
  for (let y = 0; y < height; y++) {
    const from = y * width * 3;
    const to = y * (width * 3 + 1);
    raw[to] = 0;
    rgb.copy(raw, to + 1, from, from + width * 3);
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0))
  ]);
}

// --------------------------------------------------------------------- main ---

function write(name, width, height, coverage) {
  // Fit the 512-box to `coverage` of the shorter side, centred.
  const scale = (Math.min(width, height) * coverage) / 512;
  const ox = (width - 512 * scale) / 2;
  const oy = (height - 512 * scale) / 2;
  const file = join(OUT_DIR, name);
  writeFileSync(file, png(width, height, render(width, height, scale, ox, oy)));
  return file;
}

// 1200x630 is the size unfurlers expect; they centre-crop it to a square
// thumbnail in chat, so the snowman sits in the middle and survives the crop.
console.log('wrote', write('og.png', 1200, 630, 0.82));
console.log('wrote', write('icon-512.png', 512, 512, 0.86));
console.log('wrote', write('icon-192.png', 192, 192, 0.86));
