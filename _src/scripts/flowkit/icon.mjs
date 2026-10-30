// Turns a catalogue entry into the images a Flow needs to look like an app.
//
// Four renders come out of the same drawing: a squircle tile with transparent
// corners for the web manifest, a full-bleed square for `apple-touch-icon`
// (iOS applies its own mask, so a pre-rounded PNG would get rounded twice) and
// for `purpose: maskable`, and a wide card for the link preview that shows up
// in iMessage.
//
// The same shapes are also emitted as SVG, which is what the site itself uses:
// a Flow's mark in the library is a 400-byte inline path rather than a request.

import * as g from './raster.mjs';

// The glyph is authored in a 0..100 box. These are the fraction of the tile
// that box occupies — tighter when something else is going to crop the edges.
const INSET = { tile: 0.58, bleed: 0.5, card: 0.42 };

function placed(flow, size, inset) {
  const box = size * inset;
  const origin = (size - box) / 2;
  return g.transform(flow.glyph(), (x, y) => [origin + (x / 100) * box, origin + (y / 100) * box]);
}

function paintBackground(bmp, flow, size, { squircle }) {
  const paint = g.linearGradient(flow.colors[0], flow.colors[1], size, size);
  bmp.fill(squircle ? g.squircle(0, 0, size) : g.rect(0, 0, size, size), paint);
  // A whisper of gloss across the top third. Without it the flat gradient reads
  // as a swatch; with it the tile reads as an object.
  bmp.fill(g.ellipse(size * 0.5, size * -0.1, size * 0.78, size * 0.46), [1, 1, 1], 0.1);
}

export function renderIcon(flow, size, { squircle = true, inset = squircle ? INSET.tile : INSET.bleed } = {}) {
  const bmp = new g.Bitmap(size, size);
  paintBackground(bmp, flow, size, { squircle });
  // The mark is drawn once in a soft shadow offset a hair down, then in white,
  // which keeps it legible on the lighter end of every gradient.
  bmp.fill(g.transform(placed(flow, size, inset), (x, y) => [x, y + size * 0.012]), [0, 0, 0], 0.14);
  bmp.fill(placed(flow, size, inset), [1, 1, 1]);
  return bmp.toPng();
}

// The 1200x630 card a share link unfurls into. The mark sits left of centre so
// the title text a messaging app draws underneath has somewhere to go.
export function renderCard(flow, width = 1200, height = 630) {
  const bmp = new g.Bitmap(width, height);
  bmp.fill(g.rect(0, 0, width, height), g.linearGradient(flow.colors[0], flow.colors[1], width, height));
  bmp.fill(g.ellipse(width * 0.5, height * -0.35, width * 0.7, height * 0.8), [1, 1, 1], 0.1);
  const box = height * INSET.card;
  const ox = (width - box) / 2;
  const oy = (height - box) / 2;
  const mark = g.transform(flow.glyph(), (x, y) => [ox + (x / 100) * box, oy + (y / 100) * box]);
  bmp.fill(g.transform(mark, (x, y) => [x, y + 6]), [0, 0, 0], 0.14);
  bmp.fill(mark, [1, 1, 1]);
  return bmp.toPng();
}

// ---------------------------------------------------------------------- svg ---

const n = (v) => Math.round(v * 10) / 10;

// The glyphs are flattened at a resolution that suits a 512px raster, which is
// a hundred points for one circle. At the 46px an SVG mark is actually drawn,
// anything closer together than a third of a unit is sub-pixel — so points are
// dropped until they are not, which takes a mark from about 4 KB to under one.
function decimate(points, minStep) {
  if (points.length < 8) return points;
  const out = [points[0]];
  for (let i = 1; i < points.length; i++) {
    const last = out[out.length - 1];
    const [x, y] = points[i];
    if (Math.abs(x - last[0]) + Math.abs(y - last[1]) >= minStep) out.push(points[i]);
  }
  // Never let a subpath collapse to a line; better a coarse shape than none.
  return out.length >= 3 ? out : points;
}

function shapeToPaths(shape, minStep = 0.7) {
  return shape.map((part) => {
    const d = part.subs
      .map((sub) => `M${decimate(sub, minStep).map(([x, y]) => `${n(x)} ${n(y)}`).join('L')}Z`)
      .join('');
    return `<path d="${d}"${part.rule === 'evenodd' ? ' fill-rule="evenodd"' : ''}/>`;
  }).join('');
}

// One mark, standalone and self-contained — gradient, tile and glyph in a
// single element. This is what goes inside a Flow's own file, where there is
// nothing else in the document to share with.
export function iconSvg(flow, { idSuffix = flow.id, rounded = true } = {}) {
  const gid = `fg-${idSuffix}`;
  return `<svg class="flow-mark" viewBox="0 0 100 100" role="img" aria-label="${flow.name}" xmlns="http://www.w3.org/2000/svg">`
    + `<defs>${gradient(flow, gid)}</defs>`
    + tileBody(flow, gid, rounded)
    + `</svg>`;
}

// The site draws sixty marks on one page, so there they are defined once in a
// hidden sprite and referenced. Same drawing, a twentieth of the bytes.
export function iconSprite(flows, { minStep = 0.9 } = {}) {
  const defs = flows.map((flow) => gradient(flow, `fg-${flow.id}`)).join('');
  const symbols = flows.map((flow) =>
    `<symbol id="m-${flow.id}" viewBox="0 0 100 100">${tileBody(flow, `fg-${flow.id}`, true, minStep)}</symbol>`
  ).join('');
  return `<svg aria-hidden="true" style="position:absolute;width:0;height:0;overflow:hidden">`
    + `<defs>${defs}</defs>${symbols}</svg>`;
}

export function iconUse(flow) {
  return `<svg class="flow-mark" viewBox="0 0 100 100" role="img" aria-label="${flow.name}"><use href="#m-${flow.id}"/></svg>`;
}

function gradient(flow, gid) {
  return `<linearGradient id="${gid}" x1="0" y1="0" x2="1" y2="1">`
    + `<stop offset="0" stop-color="${flow.colors[0]}"/><stop offset="1" stop-color="${flow.colors[1]}"/>`
    + `</linearGradient>`;
}

function tileBody(flow, gid, rounded, minStep) {
  const inset = 58;
  const mark = g.transform(flow.glyph(), (x, y) => [21 + (x / 100) * inset, 21 + (y / 100) * inset]);
  return `<rect width="100" height="100" rx="${rounded ? 23 : 0}" fill="url(#${gid})"/>`
    + `<g fill="#fff">${shapeToPaths(mark, minStep)}</g>`;
}
