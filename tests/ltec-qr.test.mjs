// The QR code is the only part of this that cannot be fixed from the floor of
// a conference hall, so it gets its own tests.
//
//   node --test tests/ltec-qr.test.mjs
//
// These run without any dependency. The encoder was additionally checked
// against a real decoder (jsQR) across versions 1-10 at EC levels M, Q and H
// while it was written; what is locked in here is that its output has not
// moved since.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { inflateSync } from 'node:zlib';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { encodeQr, qrSvg, qrPng } from '../scripts/flowkit/qr.mjs';
import { PAGE_URL } from '../scripts/build-ltec.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const asset = (name) => join(ROOT, 'public', 'ltec-system', name);

test('the production URL encodes to a version 3 level M code', () => {
  const qr = encodeQr(PAGE_URL, { ecl: 'M' });
  assert.equal(qr.version, 3, 'version');
  assert.equal(qr.ecl, 'M');
  assert.equal(qr.size, 29, '29 modules square');
  assert.equal(qr.modules.length, 29);
  for (const row of qr.modules) {
    assert.equal(row.length, 29);
    for (const v of row) assert.ok(v === 0 || v === 1, `module was ${v}`);
  }
});

test('the three finder patterns are where the spec puts them', () => {
  const qr = encodeQr(PAGE_URL, { ecl: 'M' });
  const n = qr.size;
  // A finder is a 3x3 dark core, a light ring, then a dark ring.
  const finderAt = (cx, cy) => {
    for (let dy = -3; dy <= 3; dy++)
      for (let dx = -3; dx <= 3; dx++) {
        const d = Math.max(Math.abs(dx), Math.abs(dy));
        const want = d <= 1 || d === 3 ? 1 : 0;
        assert.equal(qr.modules[cy + dy][cx + dx], want,
          `finder at ${cx},${cy} wrong at offset ${dx},${dy}`);
      }
  };
  finderAt(3, 3);
  finderAt(n - 4, 3);
  finderAt(3, n - 4);
});

test('the timing patterns alternate', () => {
  const qr = encodeQr(PAGE_URL, { ecl: 'M' });
  for (let i = 8; i < qr.size - 8; i++) {
    const want = i % 2 === 0 ? 1 : 0;
    assert.equal(qr.modules[6][i], want, `horizontal timing at ${i}`);
    assert.equal(qr.modules[i][6], want, `vertical timing at ${i}`);
  }
});

test('the always-dark module is dark', () => {
  const qr = encodeQr(PAGE_URL, { ecl: 'M' });
  assert.equal(qr.modules[qr.size - 8][8], 1);
});

test('the encoder output has not changed', () => {
  // A golden hash. If this fails, the matrix moved: re-verify with a real
  // decoder before accepting the new value.
  const qr = encodeQr(PAGE_URL, { ecl: 'M' });
  const hash = createHash('sha256')
    .update(qr.modules.map((r) => r.join('')).join('\n'))
    .digest('hex');
  assert.equal(hash, '674fa0e1308ab843bd37c7eadc602c069eed1c0a18507c665b1c232fba93536f', 'module matrix hash');
});

test('capacity is enforced rather than silently truncated', () => {
  assert.throws(() => encodeQr('x'.repeat(400), { ecl: 'M' }), /too long/);
  // A URL with a full slider configuration still fits comfortably.
  const long = `${PAGE_URL}?S=1.361&Tc=28&Th=118&A=2500&a=1&orc=0.44&f=0.94&rc=1`;
  const qr = encodeQr(long, { ecl: 'M' });
  assert.ok(qr.version <= 10, `version ${qr.version}`);
});

test('the shipped qr.svg matches a fresh encode', () => {
  const qr = encodeQr(PAGE_URL, { ecl: 'M' });
  const fresh = qrSvg(qr, { quiet: 4, label: `QR code for ${PAGE_URL}` });
  const shipped = readFileSync(asset('qr.svg'), 'utf8');
  assert.equal(shipped, fresh, 'public/ltec-system/qr.svg is stale — run npm run ltec:build');
  assert.match(shipped, /viewBox="0 0 37 37"/, '29 modules plus a 4-module quiet zone');
});

test('the shipped qr.png is 1024px, greyscale, and strictly two-tone', () => {
  const buf = readFileSync(asset('qr.png'));
  assert.deepEqual([...buf.subarray(0, 8)], [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 'PNG signature');

  let at = 8, width = 0, height = 0, depth = 0, colour = -1;
  const idat = [];
  while (at < buf.length) {
    const len = buf.readUInt32BE(at);
    const type = buf.toString('ascii', at + 4, at + 8);
    const data = buf.subarray(at + 8, at + 8 + len);
    if (type === 'IHDR') {
      width = data.readUInt32BE(0); height = data.readUInt32BE(4);
      depth = data[8]; colour = data[9];
    } else if (type === 'IDAT') idat.push(data);
    at += 12 + len;
  }
  assert.equal(width, 1024);
  assert.equal(height, 1024);
  assert.equal(depth, 8, 'bit depth');
  assert.equal(colour, 0, 'greyscale');

  const raw = inflateSync(Buffer.concat(idat));
  const shades = new Set();
  for (let y = 0; y < height; y++) {
    assert.equal(raw[y * (width + 1)], 0, `row ${y} should use filter 0`);
    for (let x = 0; x < width; x++) shades.add(raw[y * (width + 1) + 1 + x]);
  }
  // Anything between 0 and 255 means the code was resampled, which is how a
  // QR stops scanning at an angle.
  assert.deepEqual([...shades].sort((a, b) => a - b), [0, 255], 'only pure black and white');

  assert.equal(Buffer.compare(buf, qrPng(encodeQr(PAGE_URL, { ecl: 'M' }), { target: 1024, quiet: 4 })), 0,
    'public/ltec-system/qr.png is stale — run npm run ltec:build');
});

test('the QR points at the URL the page claims to live at', () => {
  const html = readFileSync(asset('index.html'), 'utf8');
  const canonical = html.match(/<link rel="canonical" href="([^"]+)"/)?.[1];
  assert.equal(canonical, PAGE_URL, 'canonical link and QR target must agree');
  assert.ok(html.includes(`<meta property="og:url" content="${PAGE_URL}">`), 'og:url agrees too');

  const slide = readFileSync(asset('qr.html'), 'utf8');
  const bare = PAGE_URL.replace(/^https:\/\//, '');
  assert.ok(slide.includes(bare), `the slide view should print ${bare} in plain text`);
});
