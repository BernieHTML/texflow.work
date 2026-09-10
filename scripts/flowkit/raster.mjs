// A very small 2D rasteriser and PNG writer, with no dependencies.
//
// It exists because every Flow needs a real PNG icon: iOS only accepts PNG for
// `apple-touch-icon`, so an SVG mark can't be handed to "Add to Home Screen".
// There is no canvas, no sharp and no browser on this box, so the icons are
// drawn here — scanline fills over a 4x4 supersample grid, deflated into a PNG
// by node's own zlib.
//
// A *shape* is an array of parts; a part is `{ subs, rule }` where `subs` is a
// list of closed polygons. Parts union by taking the maximum coverage, which
// keeps a stroke made of overlapping segments solid instead of XOR-ing itself
// into holes, while `rule: 'evenodd'` inside a single part is what punches the
// hole in a ring. Every builder below returns a shape, so they all compose.

import { deflateSync } from 'zlib';

const SS = 4;               // supersample factor per axis (16 samples/pixel)
const TAU = Math.PI * 2;

const solidPart = (...subs) => [{ subs, rule: 'union' }];
const holePart = (...subs) => [{ subs, rule: 'evenodd' }];

// ------------------------------------------------------------------ shapes ---

function arcPoints(cx, cy, r, a0, a1, steps) {
  const pts = [];
  for (let i = 0; i <= steps; i++) {
    const a = a0 + ((a1 - a0) * i) / steps;
    pts.push([cx + Math.cos(a) * r, cy + Math.sin(a) * r]);
  }
  return pts;
}

// The bare point list for an arc, so glyphs can stitch two arcs into one
// closed polygon — that is how the crescent and the leaf are drawn.
export function arcPath(cx, cy, r, a0, a1, steps = 48) {
  return arcPoints(cx, cy, r, a0, a1, steps);
}

export function rect(x, y, w, h) {
  return solidPart([[x, y], [x + w, y], [x + w, y + h], [x, y + h]]);
}

export function polygon(points) {
  return solidPart(points);
}

export function circle(cx, cy, r, steps = 96) {
  return solidPart(arcPoints(cx, cy, r, 0, TAU, steps).slice(0, -1));
}

export function ellipse(cx, cy, rx, ry, steps = 96) {
  const pts = [];
  for (let i = 0; i < steps; i++) {
    const a = (i / steps) * TAU;
    pts.push([cx + Math.cos(a) * rx, cy + Math.sin(a) * ry]);
  }
  return solidPart(pts);
}

export function ellipseRing(cx, cy, rx, ry, thickness, steps = 96) {
  const outline = (ax, ay) => {
    const pts = [];
    for (let i = 0; i < steps; i++) {
      const a = (i / steps) * TAU;
      pts.push([cx + Math.cos(a) * ax, cy + Math.sin(a) * ay]);
    }
    return pts;
  };
  return holePart(
    outline(rx + thickness / 2, ry + thickness / 2),
    outline(Math.max(0.01, rx - thickness / 2), Math.max(0.01, ry - thickness / 2))
  );
}

export function ring(cx, cy, r, thickness, steps = 96) {
  return holePart(
    arcPoints(cx, cy, r + thickness / 2, 0, TAU, steps).slice(0, -1),
    arcPoints(cx, cy, Math.max(0.01, r - thickness / 2), 0, TAU, steps).slice(0, -1)
  );
}

// A stroked arc: a closed band, plus round caps as their own parts so they
// union onto the ends rather than cancelling against the band.
export function arc(cx, cy, r, thickness, a0, a1, { cap = 'round' } = {}) {
  const steps = Math.max(8, Math.round((Math.abs(a1 - a0) / TAU) * 120));
  const shape = solidPart([
    ...arcPoints(cx, cy, r + thickness / 2, a0, a1, steps),
    ...arcPoints(cx, cy, r - thickness / 2, a1, a0, steps)
  ]);
  if (cap === 'round') {
    shape.push(
      ...circle(cx + Math.cos(a0) * r, cy + Math.sin(a0) * r, thickness / 2, 24),
      ...circle(cx + Math.cos(a1) * r, cy + Math.sin(a1) * r, thickness / 2, 24)
    );
  }
  return shape;
}

export function roundRect(x, y, w, h, r) {
  const rr = Math.max(0, Math.min(r, w / 2, h / 2));
  const s = 20;
  return solidPart([
    ...arcPoints(x + w - rr, y + rr, rr, -Math.PI / 2, 0, s),
    ...arcPoints(x + w - rr, y + h - rr, rr, 0, Math.PI / 2, s),
    ...arcPoints(x + rr, y + h - rr, rr, Math.PI / 2, Math.PI, s),
    ...arcPoints(x + rr, y + rr, rr, Math.PI, Math.PI * 1.5, s)
  ]);
}

// The app tile itself: a superellipse, which is what iOS masks to and reads
// noticeably softer than a plain rounded rect at icon sizes.
export function squircle(x, y, size, n = 4.4) {
  const c = x + size / 2;
  const cy = y + size / 2;
  const a = size / 2;
  const pts = [];
  const steps = 320;
  for (let i = 0; i < steps; i++) {
    const t = (i / steps) * TAU;
    const ct = Math.cos(t);
    const st = Math.sin(t);
    pts.push([
      c + a * Math.sign(ct) * Math.abs(ct) ** (2 / n),
      cy + a * Math.sign(st) * Math.abs(st) ** (2 / n)
    ]);
  }
  return solidPart(pts);
}

export function line(x1, y1, x2, y2, w, { cap = 'round' } = {}) {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const len = Math.hypot(dx, dy) || 1;
  const nx = (-dy / len) * (w / 2);
  const ny = (dx / len) * (w / 2);
  const shape = solidPart([
    [x1 + nx, y1 + ny], [x2 + nx, y2 + ny],
    [x2 - nx, y2 - ny], [x1 - nx, y1 - ny]
  ]);
  if (cap === 'round') {
    shape.push(...circle(x1, y1, w / 2, 24), ...circle(x2, y2, w / 2, 24));
  }
  return shape;
}

// An open polyline. Each segment brings its own round caps, which is what
// joins the corners.
export function path(points, w, { cap = 'round', close = false } = {}) {
  const pts = close ? [...points, points[0]] : points;
  const shape = [];
  for (let i = 0; i < pts.length - 1; i++) {
    shape.push(...line(pts[i][0], pts[i][1], pts[i + 1][0], pts[i + 1][1], w, { cap }));
  }
  return shape;
}

export function union(...shapes) {
  return shapes.flat();
}

// Map every point of a shape — the glyphs are authored in a 0..100 box and
// scaled into whatever icon size is being rendered.
export function transform(shape, fn) {
  return shape.map((part) => ({
    rule: part.rule,
    subs: part.subs.map((sub) => sub.map(([x, y]) => fn(x, y)))
  }));
}

// ---------------------------------------------------------------- painting ---

export class Bitmap {
  constructor(width, height) {
    this.width = width;
    this.height = height;
    // Straight (non-premultiplied) RGBA in float, so repeated blends stay clean.
    this.data = new Float32Array(width * height * 4);
  }

  // `paint` is either [r,g,b] in 0..1 or a function (x, y) => [r,g,b] in device
  // pixels, which is how the gradients are done without a second buffer.
  fill(shape, paint, alpha = 1) {
    const cov = coverage(shape, this.width, this.height);
    const solid = typeof paint === 'function' ? null : paint;
    for (let i = 0; i < cov.length; i++) {
      const a = cov[i] * alpha;
      if (a <= 0) continue;
      const [r, g, b] = solid || paint(i % this.width, (i / this.width) | 0);
      const o = i * 4;
      const da = this.data[o + 3];
      const na = a + da * (1 - a);
      this.data[o] = (r * a + this.data[o] * da * (1 - a)) / na;
      this.data[o + 1] = (g * a + this.data[o + 1] * da * (1 - a)) / na;
      this.data[o + 2] = (b * a + this.data[o + 2] * da * (1 - a)) / na;
      this.data[o + 3] = na;
    }
    return this;
  }

  // Flatten onto an opaque colour. Home-screen icons must not be transparent.
  flatten(bg = [0, 0, 0]) {
    for (let i = 0; i < this.width * this.height; i++) {
      const o = i * 4;
      const a = this.data[o + 3];
      for (let c = 0; c < 3; c++) this.data[o + c] = this.data[o + c] * a + bg[c] * (1 - a);
      this.data[o + 3] = 1;
    }
    return this;
  }

  toPng() {
    const { width, height } = this;
    const stride = width * 4;
    const bytes = Buffer.alloc(height * stride);
    for (let i = 0; i < width * height * 4; i++) bytes[i] = clamp255(this.data[i] * 255);
    return encodePng(width, height, bytes, width, height);
  }
}

function clamp255(v) {
  return v < 0 ? 0 : v > 255 ? 255 : Math.round(v);
}

function coverage(shape, width, height) {
  const total = new Float32Array(width * height);
  for (const part of shape) {
    const cov = partCoverage(part, width, height);
    for (let i = 0; i < total.length; i++) if (cov[i] > total[i]) total[i] = cov[i];
  }
  return total;
}

// Scanline fill of one part. Even-odd is used for both rules; the difference
// between them is handled by unioning parts with a max above, so a stroke
// never XORs against itself.
function partCoverage(part, width, height) {
  const cov = new Float32Array(width * height);
  const edges = [];
  let minY = Infinity;
  let maxY = -Infinity;
  for (const sub of part.subs) {
    for (let i = 0; i < sub.length; i++) {
      const [x1, y1] = sub[i];
      const [x2, y2] = sub[(i + 1) % sub.length];
      if (y1 === y2) continue;
      edges.push([x1, y1, x2, y2]);
      if (y1 < minY) minY = y1;
      if (y2 < minY) minY = y2;
      if (y1 > maxY) maxY = y1;
      if (y2 > maxY) maxY = y2;
    }
  }
  if (!edges.length) return cov;

  const yStart = Math.max(0, Math.floor(minY * SS));
  const yEnd = Math.min(height * SS, Math.ceil(maxY * SS));
  const step = 1 / SS;
  const share = 1 / (SS * SS);
  const xs = [];

  for (let sy = yStart; sy < yEnd; sy++) {
    const y = (sy + 0.5) * step;
    xs.length = 0;
    for (const [x1, y1, x2, y2] of edges) {
      if ((y >= y1 && y < y2) || (y >= y2 && y < y1)) {
        xs.push(x1 + ((y - y1) / (y2 - y1)) * (x2 - x1));
      }
    }
    if (xs.length < 2) continue;
    xs.sort((a, b) => a - b);
    const row = ((sy / SS) | 0) * width;
    for (let i = 0; i + 1 < xs.length; i += 2) {
      let sxa = Math.round(xs[i] * SS);
      const sxb = Math.min(Math.round(xs[i + 1] * SS), width * SS);
      if (sxa < 0) sxa = 0;
      for (let sx = sxa; sx < sxb; sx++) cov[row + ((sx / SS) | 0)] += share;
    }
  }
  for (let i = 0; i < cov.length; i++) if (cov[i] > 1) cov[i] = 1;
  return cov;
}

// ------------------------------------------------------------------- paints ---

export function hexRgb(hex) {
  const h = hex.replace('#', '');
  const n = parseInt(h.length === 3 ? h.split('').map((c) => c + c).join('') : h, 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}

// A diagonal two-stop gradient, in the same direction as the CSS the Flows use
// so the icon and the app it opens read as one object.
export function linearGradient(from, to, w, h) {
  const a = hexRgb(from);
  const b = hexRgb(to);
  return (x, y) => {
    const t = Math.min(1, Math.max(0, (x / w) * 0.42 + (y / h) * 0.58));
    return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
  };
}

// ---------------------------------------------------------------------- png ---

const CRC_TABLE = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  return t;
})();

function crc32(buf) {
  let c = -1;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

// PNG filtering. The usual per-scanline heuristic (pick the filter with the
// smallest sum of absolute differences) actually *loses* on these images: they
// are smooth gradients, and deflate is already matching each row against the
// one above it, which filtering destroys. So all six strategies are deflated
// and the smallest wins — three of them, which is where the curve flattens.
// One of these ends up base64'd inside every Flow that ships, so it is worth
// the build-time seconds.
function filterScanlines(bytes, width, height, fixed) {
  const stride = width * 4;
  const out = Buffer.alloc(height * (stride + 1));
  const candidates = [Buffer.alloc(stride), Buffer.alloc(stride), Buffer.alloc(stride), Buffer.alloc(stride), Buffer.alloc(stride)];
  for (let y = 0; y < height; y++) {
    const row = y * stride;
    const prev = row - stride;
    let bestType = 0;
    let bestSum = Infinity;
    for (let type = fixed === undefined ? 0 : fixed; type < (fixed === undefined ? 5 : fixed + 1); type++) {
      const buf = candidates[type];
      let sum = 0;
      for (let i = 0; i < stride; i++) {
        const raw = bytes[row + i];
        const a = i >= 4 ? bytes[row + i - 4] : 0;
        const b = y > 0 ? bytes[prev + i] : 0;
        const c = y > 0 && i >= 4 ? bytes[prev + i - 4] : 0;
        let v;
        if (type === 0) v = raw;
        else if (type === 1) v = raw - a;
        else if (type === 2) v = raw - b;
        else if (type === 3) v = raw - ((a + b) >> 1);
        else v = raw - paeth(a, b, c);
        v &= 0xff;
        buf[i] = v;
        sum += v < 128 ? v : 256 - v;
      }
      if (sum < bestSum) { bestSum = sum; bestType = type; }
    }
    out[y * (stride + 1)] = bestType;
    candidates[bestType].copy(out, y * (stride + 1) + 1);
  }
  return out;
}

function paeth(a, b, c) {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  return pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
}

function encodePng(width, height, bytes) {
  let best = null;
  for (const strategy of [undefined, 0, 2]) {
    const idat = deflateSync(filterScanlines(bytes, width, height, strategy), { level: 9 });
    if (!best || idat.length < best.length) best = idat;
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;   // bit depth
  ihdr[9] = 6;   // colour type: RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', best),
    chunk('IEND', Buffer.alloc(0))
  ]);
}
