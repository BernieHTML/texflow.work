/* One-time icon generation from public/icon.svg.
 *
 * Run with `node scripts/icons.mjs` after changing the mark. Kept as a script
 * rather than a build step so `sharp` never has to run on a deploy.
 *
 * The maskable variant insets the mark to sit inside Android's safe circle,
 * which crops roughly 10% off each edge.
 */

import sharp from 'sharp';
import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const pub = join(here, '..', 'public');

const svg = await readFile(join(pub, 'icon.svg'));

const sizes = [
  ['icon-192.png', 192],
  ['icon-512.png', 512],
  // apple-touch-icon: 180 is the size iOS actually asks for.
  ['icon-180.png', 180],
];

for (const [name, size] of sizes) {
  const png = await sharp(svg, { density: 384 }).resize(size, size).png().toBuffer();
  await writeFile(join(pub, name), png);
  console.log(`${name}  ${size}x${size}`);
}

// Maskable: same mark, scaled to ~78% and centred on the chalk ground so the
// launcher can crop it to any shape without clipping the dot or the well.
const inner = await sharp(svg, { density: 384 }).resize(400, 400).png().toBuffer();
const maskable = await sharp({
  create: { width: 512, height: 512, channels: 4, background: '#F4F2F5' },
})
  .composite([{ input: inner, top: 56, left: 56 }])
  .png()
  .toBuffer();
await writeFile(join(pub, 'icon-maskable-512.png'), maskable);
console.log('icon-maskable-512.png  512x512');
