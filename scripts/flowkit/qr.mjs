// A QR encoder, because a QR code on a conference slide should not be fetched
// from somebody else's server at build time, and certainly not at page load.
//
// Byte mode only, error correction level M or better, versions 1-10 — which is
// everything a short https:// URL needs. Output is a module matrix; rendering
// it as SVG or PNG is someone else's job.
//
// The rasteriser next door antialiases, which is exactly wrong for a QR code:
// a scanner wants hard edges. So the PNG here is written straight out at an
// integer scale, one byte per pixel, with no resampling anywhere.

import { deflateSync } from 'zlib';

// --------------------------------------------------------------- GF(256) ---

const EXP = new Uint8Array(512);
const LOG = new Uint8Array(256);
(() => {
  let x = 1;
  for (let i = 0; i < 255; i++) {
    EXP[i] = x;
    LOG[x] = i;
    x <<= 1;
    if (x & 0x100) x ^= 0x11d;      // the QR primitive polynomial
  }
  for (let i = 255; i < 512; i++) EXP[i] = EXP[i - 255];
})();

const gmul = (a, b) => (a && b ? EXP[LOG[a] + LOG[b]] : 0);

function polyMul(a, b) {
  const r = new Array(a.length + b.length - 1).fill(0);
  for (let i = 0; i < a.length; i++)
    for (let j = 0; j < b.length; j++) r[i + j] ^= gmul(a[i], b[j]);
  return r;
}

function generator(n) {
  let p = [1];
  for (let i = 0; i < n; i++) p = polyMul(p, [1, EXP[i]]);
  return p;
}

/** Reed-Solomon check bytes for one block. */
function remainder(data, n) {
  const gen = generator(n);
  const res = data.concat(new Array(n).fill(0));
  for (let i = 0; i < data.length; i++) {
    const c = res[i];
    if (!c) continue;
    for (let j = 0; j < gen.length; j++) res[i + j] ^= gmul(gen[j], c);
  }
  return res.slice(data.length);
}

// ----------------------------------------------------------------- tables ---

// Per version: [ec codewords per block, [blocks, data codewords per block], ...]
const BLOCKS = {
  L: {
    1: [7, [1, 19]], 2: [10, [1, 34]], 3: [15, [1, 55]], 4: [20, [1, 80]], 5: [26, [1, 108]],
    6: [18, [2, 68]], 7: [20, [2, 78]], 8: [24, [2, 97]], 9: [30, [2, 116]], 10: [18, [2, 68], [2, 69]]
  },
  M: {
    1: [10, [1, 16]], 2: [16, [1, 28]], 3: [26, [1, 44]], 4: [18, [2, 32]], 5: [24, [2, 43]],
    6: [16, [4, 27]], 7: [18, [4, 31]], 8: [22, [2, 38], [2, 39]], 9: [22, [3, 36], [2, 37]],
    10: [26, [4, 43], [1, 44]]
  },
  Q: {
    1: [13, [1, 13]], 2: [22, [1, 22]], 3: [18, [2, 17]], 4: [26, [2, 24]], 5: [18, [2, 15], [2, 16]],
    6: [24, [4, 19]], 7: [18, [2, 14], [4, 15]], 8: [22, [4, 18], [2, 19]], 9: [20, [4, 16], [4, 17]],
    10: [24, [6, 19], [2, 20]]
  },
  H: {
    1: [17, [1, 9]], 2: [28, [1, 16]], 3: [22, [2, 13]], 4: [16, [4, 9]], 5: [22, [2, 11], [2, 12]],
    6: [28, [4, 15]], 7: [26, [4, 13], [1, 14]], 8: [26, [4, 14], [2, 15]], 9: [24, [4, 12], [4, 13]],
    10: [28, [6, 15], [2, 16]]
  }
};

// Centres of the alignment patterns, by version.
const ALIGN = {
  1: [], 2: [6, 18], 3: [6, 22], 4: [6, 26], 5: [6, 30],
  6: [6, 34], 7: [6, 22, 38], 8: [6, 24, 42], 9: [6, 26, 46], 10: [6, 28, 50]
};

const ECL_BITS = { L: 1, M: 0, Q: 3, H: 2 };

const dataCapacity = (version, ecl) => {
  const [, ...groups] = BLOCKS[ecl][version];
  return groups.reduce((sum, [blocks, words]) => sum + blocks * words, 0);
};

// --------------------------------------------------------------- encoding ---

function encodeData(bytes, version, ecl) {
  const bits = [];
  const push = (value, length) => {
    for (let i = length - 1; i >= 0; i--) bits.push((value >> i) & 1);
  };

  push(0b0100, 4);                                   // byte mode
  push(bytes.length, version <= 9 ? 8 : 16);         // character count
  for (const b of bytes) push(b, 8);

  const capacityBits = dataCapacity(version, ecl) * 8;
  if (bits.length > capacityBits) throw new Error('data does not fit the chosen version');

  push(0, Math.min(4, capacityBits - bits.length));  // terminator
  while (bits.length % 8) bits.push(0);

  const words = [];
  for (let i = 0; i < bits.length; i += 8) {
    words.push(bits.slice(i, i + 8).reduce((v, b) => (v << 1) | b, 0));
  }
  // Alternating pad bytes, as the spec requires, until the version is full.
  const PAD = [0xec, 0x11];
  for (let i = 0; words.length < dataCapacity(version, ecl); i++) words.push(PAD[i % 2]);

  return words;
}

/** Split into blocks, append check bytes, then interleave as the spec orders. */
function interleave(words, version, ecl) {
  const [ecCount, ...groups] = BLOCKS[ecl][version];
  const dataBlocks = [];
  const ecBlocks = [];

  let at = 0;
  for (const [blocks, size] of groups) {
    for (let i = 0; i < blocks; i++) {
      const block = words.slice(at, at + size);
      at += size;
      dataBlocks.push(block);
      ecBlocks.push(remainder(block, ecCount));
    }
  }

  const out = [];
  const maxData = Math.max(...dataBlocks.map((b) => b.length));
  for (let i = 0; i < maxData; i++)
    for (const b of dataBlocks) if (i < b.length) out.push(b[i]);
  for (let i = 0; i < ecCount; i++)
    for (const b of ecBlocks) out.push(b[i]);

  return out;
}

// ----------------------------------------------------------------- matrix ---

function blankMatrix(size) {
  return {
    size,
    cells: Array.from({ length: size }, () => new Int8Array(size).fill(-1)),  // -1 = free
    fixed: Array.from({ length: size }, () => new Uint8Array(size))
  };
}

function setFunction(m, x, y, v) {
  if (x < 0 || y < 0 || x >= m.size || y >= m.size) return;
  m.cells[y][x] = v;
  m.fixed[y][x] = 1;
}

function placeFinder(m, cx, cy) {
  for (let dy = -4; dy <= 4; dy++) {
    for (let dx = -4; dx <= 4; dx++) {
      const d = Math.max(Math.abs(dx), Math.abs(dy));
      // 3x3 dark core, a light ring, a dark ring, then the light separator.
      const dark = d <= 1 || d === 3;
      setFunction(m, cx + dx, cy + dy, d === 4 ? 0 : dark ? 1 : 0);
    }
  }
}

function placeAlignment(m, cx, cy) {
  for (let dy = -2; dy <= 2; dy++)
    for (let dx = -2; dx <= 2; dx++) {
      const d = Math.max(Math.abs(dx), Math.abs(dy));
      setFunction(m, cx + dx, cy + dy, d === 1 ? 0 : 1);
    }
}

function buildFunctionPatterns(m, version) {
  const n = m.size;

  placeFinder(m, 3, 3);
  placeFinder(m, n - 4, 3);
  placeFinder(m, 3, n - 4);

  // Timing patterns.
  for (let i = 8; i < n - 8; i++) {
    const v = i % 2 === 0 ? 1 : 0;
    setFunction(m, i, 6, v);
    setFunction(m, 6, i, v);
  }

  // Alignment patterns, skipping the three that would sit on a finder.
  const centres = ALIGN[version];
  for (const cy of centres)
    for (const cx of centres) {
      const onFinder =
        (cx <= 8 && cy <= 8) || (cx >= n - 9 && cy <= 8) || (cx <= 8 && cy >= n - 9);
      if (!onFinder) placeAlignment(m, cx, cy);
    }

  setFunction(m, 8, n - 8, 1);   // the always-dark module

  // Reserve the format areas; the real bits go in once a mask is chosen.
  for (let i = 0; i <= 8; i++) {
    if (i !== 6) { setFunction(m, i, 8, 0); setFunction(m, 8, i, 0); }
  }
  for (let i = 0; i < 8; i++) {
    setFunction(m, n - 1 - i, 8, 0);
    if (i < 7) setFunction(m, 8, n - 1 - i, 0);
  }

  // Version information, version 7 and up.
  if (version >= 7) {
    let rem = version;
    for (let i = 0; i < 12; i++) rem = (rem << 1) ^ ((rem >>> 11) * 0x1f25);
    const bits = ((version << 12) | rem) >>> 0;
    for (let i = 0; i < 18; i++) {
      const bit = (bits >> i) & 1;
      const a = Math.floor(i / 3);
      const b = (i % 3) + n - 11;
      setFunction(m, a, b, bit);
      setFunction(m, b, a, bit);
    }
  }
}

function placeData(m, words) {
  const n = m.size;
  let bit = 0;
  const next = () => {
    if (bit >= words.length * 8) return 0;   // remainder bits are zero
    const v = (words[bit >> 3] >> (7 - (bit & 7))) & 1;
    bit++;
    return v;
  };

  let upward = true;
  for (let right = n - 1; right >= 1; right -= 2) {
    if (right === 6) right = 5;              // column 6 is the timing pattern
    for (let step = 0; step < n; step++) {
      const y = upward ? n - 1 - step : step;
      for (const x of [right, right - 1]) {
        if (m.fixed[y][x]) continue;
        m.cells[y][x] = next();
      }
    }
    upward = !upward;
  }
}

const MASKS = [
  (i, j) => (i + j) % 2 === 0,
  (i) => i % 2 === 0,
  (i, j) => j % 3 === 0,
  (i, j) => (i + j) % 3 === 0,
  (i, j) => (Math.floor(i / 2) + Math.floor(j / 3)) % 2 === 0,
  (i, j) => ((i * j) % 2) + ((i * j) % 3) === 0,
  (i, j) => (((i * j) % 2) + ((i * j) % 3)) % 2 === 0,
  (i, j) => (((i + j) % 2) + ((i * j) % 3)) % 2 === 0
];

function applyMask(m, maskIndex) {
  const fn = MASKS[maskIndex];
  const out = blankMatrix(m.size);
  for (let y = 0; y < m.size; y++)
    for (let x = 0; x < m.size; x++) {
      out.fixed[y][x] = m.fixed[y][x];
      out.cells[y][x] = m.fixed[y][x] ? m.cells[y][x] : m.cells[y][x] ^ (fn(y, x) ? 1 : 0);
    }
  return out;
}

function placeFormat(m, ecl, maskIndex) {
  const n = m.size;
  const data = (ECL_BITS[ecl] << 3) | maskIndex;
  let rem = data;
  for (let i = 0; i < 10; i++) rem = (rem << 1) ^ ((rem >>> 9) * 0x537);
  const bits = ((data << 10) | rem) ^ 0x5412;

  for (let i = 0; i <= 5; i++) setFunction(m, 8, i, (bits >> i) & 1);
  setFunction(m, 8, 7, (bits >> 6) & 1);
  setFunction(m, 8, 8, (bits >> 7) & 1);
  setFunction(m, 7, 8, (bits >> 8) & 1);
  for (let i = 9; i < 15; i++) setFunction(m, 14 - i, 8, (bits >> i) & 1);

  for (let i = 0; i < 8; i++) setFunction(m, n - 1 - i, 8, (bits >> i) & 1);
  for (let i = 8; i < 15; i++) setFunction(m, 8, n - 15 + i, (bits >> i) & 1);
}

function penalty(m) {
  const n = m.size;
  const at = (x, y) => m.cells[y][x];
  let score = 0;

  // Rule 1: runs of five or more of one colour.
  for (let i = 0; i < n; i++) {
    for (const line of [(k) => at(k, i), (k) => at(i, k)]) {
      let run = 1;
      for (let k = 1; k < n; k++) {
        if (line(k) === line(k - 1)) run++;
        else { if (run >= 5) score += 3 + (run - 5); run = 1; }
      }
      if (run >= 5) score += 3 + (run - 5);
    }
  }

  // Rule 2: solid 2x2 blocks.
  for (let y = 0; y < n - 1; y++)
    for (let x = 0; x < n - 1; x++) {
      const v = at(x, y);
      if (v === at(x + 1, y) && v === at(x, y + 1) && v === at(x + 1, y + 1)) score += 3;
    }

  // Rule 3: the finder-lookalike sequence, either way round.
  const A = [1, 0, 1, 1, 1, 0, 1, 0, 0, 0, 0];
  const B = [0, 0, 0, 0, 1, 0, 1, 1, 1, 0, 1];
  for (let i = 0; i < n; i++)
    for (let k = 0; k + 11 <= n; k++)
      for (const line of [(j) => at(j, i), (j) => at(i, j)]) {
        let hitA = true, hitB = true;
        for (let j = 0; j < 11; j++) {
          if (line(k + j) !== A[j]) hitA = false;
          if (line(k + j) !== B[j]) hitB = false;
        }
        if (hitA) score += 40;
        if (hitB) score += 40;
      }

  // Rule 4: drift away from an even balance of dark and light. k is the
  // smallest integer for which the dark share sits inside 50% +/- (5k+5).
  let dark = 0;
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) dark += at(x, y);
  const total = n * n;
  score += (Math.ceil(Math.abs(dark * 20 - total * 10) / total) - 1) * 10;

  return score;
}

/**
 * Encode text as a QR module matrix.
 * @returns {{size:number, modules:(0|1)[][], version:number, ecl:string}}
 */
export function encodeQr(text, { ecl = 'M', minVersion = 1 } = {}) {
  const bytes = Array.from(Buffer.from(text, 'utf8'));

  let version = 0;
  for (let v = Math.max(1, minVersion); v <= 10; v++) {
    const header = 4 + (v <= 9 ? 8 : 16);
    if (header + bytes.length * 8 <= dataCapacity(v, ecl) * 8) { version = v; break; }
  }
  if (!version) throw new Error(`"${text}" is too long for a version 10 ${ecl} code`);

  const words = interleave(encodeData(bytes, version, ecl), version, ecl);

  const size = version * 4 + 17;
  const base = blankMatrix(size);
  buildFunctionPatterns(base, version);
  placeData(base, words);

  // Try all eight masks and keep the one the spec's penalty rules like best.
  let best = null;
  for (let mask = 0; mask < 8; mask++) {
    const candidate = applyMask(base, mask);
    placeFormat(candidate, ecl, mask);
    const score = penalty(candidate);
    if (!best || score < best.score) best = { score, matrix: candidate };
  }

  return {
    size,
    version,
    ecl,
    modules: best.matrix.cells.map((row) => Array.from(row))
  };
}

// --------------------------------------------------------------- rendering ---

/** One path of black squares on a white ground, with the required quiet zone. */
export function qrSvg(qr, { quiet = 4, label = '' } = {}) {
  const n = qr.size + quiet * 2;
  const parts = [];
  for (let y = 0; y < qr.size; y++) {
    let run = 0;
    for (let x = 0; x <= qr.size; x++) {
      const on = x < qr.size && qr.modules[y][x];
      if (on) { run++; continue; }
      if (run) parts.push(`M${x - run + quiet} ${y + quiet}h${run}v1h-${run}z`);
      run = 0;
    }
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${n} ${n}" width="${n * 8}" height="${n * 8}"`
    + ` shape-rendering="crispEdges" role="img" aria-label="${label || 'QR code'}">`
    + `<rect width="${n}" height="${n}" fill="#ffffff"/>`
    + `<path d="${parts.join('')}" fill="#000000"/>`
    + `</svg>\n`;
}

/**
 * A greyscale PNG at an exact integer module scale, centred in a square of
 * `target` pixels. Scaling a QR by a fraction is what makes one unreadable,
 * so the code is drawn at whatever whole number of pixels per module fits and
 * the leftover is quiet zone, which it needs anyway.
 */
export function qrPng(qr, { target = 1024, quiet = 4 } = {}) {
  const span = qr.size + quiet * 2;
  const scale = Math.max(1, Math.floor(target / span));
  const drawn = span * scale;
  const pad = Math.floor((target - drawn) / 2);

  const px = Buffer.alloc(target * target, 0xff);
  for (let y = 0; y < qr.size; y++) {
    for (let x = 0; x < qr.size; x++) {
      if (!qr.modules[y][x]) continue;
      const px0 = pad + (x + quiet) * scale;
      const py0 = pad + (y + quiet) * scale;
      for (let dy = 0; dy < scale; dy++) {
        px.fill(0x00, (py0 + dy) * target + px0, (py0 + dy) * target + px0 + scale);
      }
    }
  }

  // Greyscale, 8-bit, filter 0 on every row: the image is two colours in big
  // blocks, so deflate does the compression that a filter would otherwise.
  const raw = Buffer.alloc(target * (target + 1));
  for (let y = 0; y < target; y++) {
    raw[y * (target + 1)] = 0;
    px.copy(raw, y * (target + 1) + 1, y * target, (y + 1) * target);
  }

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(target, 0);
  ihdr.writeUInt32BE(target, 4);
  ihdr[8] = 8;    // bit depth
  ihdr[9] = 0;    // colour type: greyscale
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', deflateSync(raw, { level: 9 })),
    pngChunk('IEND', Buffer.alloc(0))
  ]);
}

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[i] = c >>> 0;
  }
  return t;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function pngChunk(type, data) {
  const head = Buffer.alloc(8);
  head.writeUInt32BE(data.length, 0);
  head.write(type, 4, 'ascii');
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([head.subarray(4), data])), 0);
  return Buffer.concat([head, data, crc]);
}
