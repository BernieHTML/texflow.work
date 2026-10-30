// Builds the static assets the LTEC page links to.
//
//   node scripts/build-ltec.mjs
//
// Nothing here runs at page load and nothing is fetched: the QR code is
// encoded by scripts/flowkit/qr.mjs and the icons are drawn by the same
// rasteriser the Flows use, so the page stays a folder of static files.

import { writeFile, mkdir } from 'fs/promises';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import * as g from './flowkit/raster.mjs';
import { encodeQr, qrSvg, qrPng } from './flowkit/qr.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT = join(__dirname, '..', 'public', 'ltec-system');

export const PAGE_URL = 'https://texflow.work/ltec-system';

// Two assets in public/ltec-system/ are NOT produced here, because neither
// should be refetched or re-encoded on every build. Their provenance, so they
// can be remade if the page ever needs a different crop or a different face:
//
//   moon-south-pole.jpg  LROC WAC global mosaic, NASA/GSFC/Arizona State
//     University, via the same Lunaserv WMS the /psrmap page proxies:
//       https://wms.im-ldi.com/?SERVICE=WMS&VERSION=1.1.1&REQUEST=GetMap
//         &LAYERS=luna_wac_global&SRS=IAU2000:30120
//         &BBOX=-200000,-200000,200000,200000&WIDTH=1500&HEIGHT=1500
//         &FORMAT=image/jpeg&STYLES=
//     then box-downsampled to 1280px, given a slight cool cast and a gamma
//     lift on the shadows, and re-encoded at quality 58 (470 KB -> 203 KB).
//     The 20px inline placeholder in the page is the same image at q70.
//
//   inter-var.woff2 / space-grotesk-var.woff2  the latin subsets Google Fonts
//     serves for Inter and Space Grotesk, both variable, both SIL Open Font
//     License. Saved locally so the page makes no third-party request.


// The mark: the working loop, with the generator sitting at the top of it.
// Drawn in a 0..100 box, in white, over a cold-to-hot gradient — the same
// construction every Flow icon on this site uses.
const glyph = () => g.union(
  g.ring(50, 56, 30, 9),
  g.circle(50, 20, 15),
  g.rect(46, 12, 8, 16)
);

const flow = {
  id: 'ltec',
  name: 'LTEC model',
  colors: ['#0b4a7d', '#e0912a'],
  glyph
};

async function main() {
  await mkdir(OUT, { recursive: true });

  // Error correction M, which the brief asks for as a floor. A short URL fits
  // version 3 at that level: 29 modules, chunky enough to scan from a slide
  // across a conference room.
  const qr = encodeQr(PAGE_URL, { ecl: 'M' });

  const written = [];
  const put = async (name, data) => {
    await writeFile(join(OUT, name), data);
    written.push([name, data.length]);
  };

  await put('qr.svg', qrSvg(qr, { quiet: 4, label: `QR code for ${PAGE_URL}` }));
  await put('qr.png', qrPng(qr, { target: 1024, quiet: 4 }));

  await put('icon-180.png', renderIcon(180, false));
  await put('icon-512.png', renderIcon(512, true));
  await put('og.png', renderCard(1200, 630));

  console.log(`LTEC assets for ${PAGE_URL}`);
  console.log(`  QR: version ${qr.version}, ${qr.size}x${qr.size} modules, EC level ${qr.ecl}`);
  for (const [name, bytes] of written) {
    console.log(`  ${name.padEnd(14)} ${(bytes / 1024).toFixed(1)} KB`);
  }
}

function placed(size, inset) {
  const box = size * inset;
  const origin = (size - box) / 2;
  return g.transform(glyph(), (x, y) => [origin + (x / 100) * box, origin + (y / 100) * box]);
}

function renderIcon(size, rounded) {
  const bmp = new g.Bitmap(size, size);
  bmp.fill(rounded ? g.squircle(0, 0, size) : g.rect(0, 0, size, size),
    g.linearGradient(flow.colors[0], flow.colors[1], size, size));
  bmp.fill(g.ellipse(size * 0.5, size * -0.1, size * 0.78, size * 0.46), [1, 1, 1], 0.1);
  const mark = placed(size, rounded ? 0.58 : 0.5);
  bmp.fill(g.transform(mark, (x, y) => [x, y + size * 0.012]), [0, 0, 0], 0.14);
  bmp.fill(mark, [1, 1, 1]);
  return bmp.toPng();
}

// The link preview. Shapes only, no type — same as the Flow cards, because
// there is no font rasteriser on this box and every unfurler draws the title
// underneath the image anyway.
function renderCard(width, height) {
  const bmp = new g.Bitmap(width, height);
  bmp.fill(g.rect(0, 0, width, height), g.linearGradient('#070a12', '#14233d', width, height));

  // A cold field on the left, a sunlit one on the right: the whole concept.
  bmp.fill(g.ellipse(width * 0.12, height * 0.78, width * 0.42, height * 0.5), g.hexRgb('#38bdf8'), 0.16);
  bmp.fill(g.ellipse(width * 0.92, height * 0.16, width * 0.30, height * 0.42), g.hexRgb('#fbbf24'), 0.20);
  bmp.fill(g.circle(width * 0.90, height * 0.20, height * 0.085), g.hexRgb('#fbbf24'), 0.95);

  // The lunar horizon, rising from the shadowed floor to the sunlit rim.
  bmp.fill(g.path([[0, height * 0.86], [width * 0.3, height * 0.83],
                   [width * 0.6, height * 0.72], [width, height * 0.62]], 4), g.hexRgb('#2a3c5e'));

  const box = height * 0.46;
  const mark = g.transform(glyph(), (x, y) =>
    [(width - box) / 2 + (x / 100) * box, (height - box) / 2 + (y / 100) * box]);
  bmp.fill(g.transform(mark, (x, y) => [x, y + 6]), [0, 0, 0], 0.22);
  bmp.fill(mark, [1, 1, 1]);

  return bmp.flatten(g.hexRgb('#070a12')).toPng();
}

// Only build when run directly, so the tests can import PAGE_URL without
// rewriting the assets as a side effect.
if (process.argv[1] && process.argv[1].endsWith('build-ltec.mjs')) {
  main().catch((err) => { console.error(err); process.exit(1); });
}
