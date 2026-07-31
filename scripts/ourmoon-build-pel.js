// Builds public/ourmoon/pel-south.json — the peaks-of-eternal-light (PEL) dataset
// OurMoon uses as the LTEC hot-side constraint.
//
// Positions are approximate representative centres for high-illumination ridges,
// massifs and crater rims around the lunar south pole, compiled from the LOLA
// illumination literature (Mazarico et al. 2011; Speyerer & Robinson 2013;
// Gläser et al. 2018) and NASA's Artemis III candidate landing regions. They are
// good to a few km — fine for siting a claim, not for landing a spacecraft.
//
// For each region we compute the distance to the nearest PSR edge from the
// bundled LROC PSR Atlas extract, so the app can tell a player up front whether
// an LTEC sited there can reach a cold sink within the 10 km rule.
//
//   node scripts/ourmoon-build-pel.js

import { readFile, writeFile } from 'fs/promises';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const OUT = join(ROOT, 'public', 'ourmoon', 'pel-south.json');
const PSR_FILE = join(ROOT, 'public', 'ourmoon', 'psr-south.json');
const MOON_R = 1737.4;

// illum = mean annual illumination fraction (%) at ~2 m above the surface.
const PELS = [
  { id: 'PEL_CONNECTING_RIDGE', name: 'Connecting Ridge', lat: -89.45, lon: 222.7, radius_km: 3.4, illum: 86, note: 'Ridge between Shackleton and de Gerlache; among the most continuously lit ground on the Moon.' },
  { id: 'PEL_SHACKLETON_RIM', name: 'Shackleton Rim', lat: -89.68, lon: 166.0, radius_km: 3.0, illum: 82, note: 'Southern rim crest of Shackleton crater, directly above a major ice-bearing PSR.' },
  { id: 'PEL_PEAK_NEAR_SHACKLETON', name: 'Peak Near Shackleton', lat: -89.78, lon: 195.0, radius_km: 2.6, illum: 80, note: 'Isolated high point a few km from the Shackleton rim.' },
  { id: 'PEL_CONNECTING_RIDGE_EXT', name: 'Connecting Ridge Extension', lat: -89.20, lon: 208.0, radius_km: 3.6, illum: 79, note: 'North-western continuation of the Connecting Ridge.' },
  { id: 'PEL_DE_GERLACHE_RIM_2', name: 'de Gerlache Rim 2', lat: -88.70, lon: 291.5, radius_km: 3.2, illum: 78, note: 'Eastern rim of de Gerlache crater.' },
  { id: 'PEL_DE_GERLACHE_RIM_1', name: 'de Gerlache Rim 1', lat: -88.50, lon: 290.0, radius_km: 3.0, illum: 76, note: 'Northern rim segment of de Gerlache crater.' },
  { id: 'PEL_MONS_MOUTON', name: 'Mons Mouton', lat: -84.60, lon: 24.0, radius_km: 6.0, illum: 82, note: 'Broad flat-topped massif (formerly Leibnitz Beta Plateau); large usable plateau.' },
  { id: 'PEL_MALAPERT_MASSIF', name: 'Malapert Massif', lat: -86.00, lon: 2.7, radius_km: 5.0, illum: 74, note: 'High massif with a near-continuous line of sight to Earth.' },
  { id: 'PEL_HAWORTH_RIM', name: 'Haworth Rim', lat: -87.45, lon: 355.5, radius_km: 3.4, illum: 74, note: 'Illuminated rim above the Haworth PSR.' },
  { id: 'PEL_NOBILE_RIM_1', name: 'Nobile Rim 1', lat: -85.40, lon: 31.5, radius_km: 4.0, illum: 72, note: 'Rim of Nobile crater; an Artemis III candidate region.' },
  { id: 'PEL_DE_GERLACHE_KOCHER', name: 'de Gerlache–Kocher Massif', lat: -88.20, lon: 291.0, radius_km: 4.2, illum: 71, note: 'Massif between de Gerlache and Kocher craters.' },
  { id: 'PEL_FAUSTINI_RIM_A', name: 'Faustini Rim A', lat: -87.20, lon: 84.9, radius_km: 3.2, illum: 70, note: 'Illuminated rim segment above the Faustini PSR.' },
  { id: 'PEL_AMUNDSEN_RIM', name: 'Amundsen Rim', lat: -84.30, lon: 82.8, radius_km: 4.4, illum: 69, note: 'Northern rim of Amundsen crater.' },
  { id: 'PEL_NOBILE_RIM_2', name: 'Nobile Rim 2', lat: -84.90, lon: 46.6, radius_km: 4.0, illum: 68, note: 'Second illuminated segment of the Nobile rim complex.' },
  { id: 'PEL_SLATER_PLAIN', name: 'Slater Plain', lat: -88.10, lon: 6.0, radius_km: 4.6, illum: 66, note: 'Relatively flat, well-lit plain near the pole.' },
  { id: 'PEL_SVERDRUP_RIDGE', name: 'Sverdrup Ridge', lat: -88.05, lon: 208.0, radius_km: 3.0, illum: 70, note: 'Lit ridge on the approach to Sverdrup crater.' },
  { id: 'PEL_CABEUS_B_PEAK', name: 'Peak Near Cabeus B', lat: -82.30, lon: 322.0, radius_km: 3.6, illum: 64, note: 'Outlying illuminated peak north of the Cabeus complex.' },
  { id: 'PEL_WIECHERT_RIM', name: 'Wiechert Rim', lat: -84.30, lon: 165.0, radius_km: 3.8, illum: 67, note: 'Illuminated rim on the far-side approach to the pole.' }
];

const toRad = (d) => (d * Math.PI) / 180;

function gcDist(lat1, lon1, lat2, lon2) {
  const p1 = toRad(lat1);
  const p2 = toRad(lat2);
  const dp = toRad(lat2 - lat1);
  const dl = toRad(lon2 - lon1);
  const a = Math.sin(dp / 2) ** 2 + Math.cos(p1) * Math.cos(p2) * Math.sin(dl / 2) ** 2;
  return MOON_R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

const psrData = JSON.parse(await readFile(PSR_FILE, 'utf8'));
const psrs = psrData.psrs || [];

const pels = PELS.map((pel) => {
  // Best case for a converter sited anywhere inside this region: PEL edge to PSR
  // edge. The app re-checks the exact placed point, so this is only a UI hint.
  let nearest = null;
  for (const psr of psrs) {
    const centres = gcDist(pel.lat, pel.lon, psr.lat, psr.lon);
    const edge = +(centres - psr.radius_km - pel.radius_km).toFixed(2);
    if (!nearest || edge < nearest.edge_km) {
      nearest = {
        id: psr.id,
        feature: psr.feature || psr.id,
        edge_km: edge,
        centre_km: +centres.toFixed(2),
        area_km2: psr.area_km2
      };
    }
  }
  return {
    ...pel,
    lon: ((pel.lon % 360) + 360) % 360,
    nearest_psr: nearest,
    // Can an LTEC sited somewhere in this region reach a cold sink inside the
    // 10 km rule? (Regions where it cannot are still drawn, greyed out.)
    ltec_viable: nearest ? nearest.edge_km <= 10 : false
  };
});

pels.sort((a, b) => b.illum - a.illum);

const out = {
  source: 'Approximate PEL centres compiled from LOLA illumination models (Mazarico et al. 2011; Speyerer & Robinson 2013; Gläser et al. 2018) and NASA Artemis III candidate landing regions.',
  precision: 'approximate — representative centres, good to a few km',
  hemisphere: 'south',
  moon_radius_km: MOON_R,
  illumination_note: 'illum = mean annual illumination fraction (%) at roughly 2 m above the surface',
  count: pels.length,
  generated_at: new Date().toISOString().slice(0, 10),
  pels
};

await writeFile(OUT, `${JSON.stringify(out, null, 2)}\n`, 'utf8');

const viable = pels.filter((p) => p.ltec_viable).length;
console.log(`Wrote ${pels.length} PEL regions to ${OUT} (${viable} LTEC-viable, ${pels.length - viable} out of cold-sink range)`);
for (const p of pels) {
  console.log(`  ${p.ltec_viable ? '✓' : '·'} ${p.name.padEnd(28)} illum ${String(p.illum).padStart(3)}%  nearest PSR ${p.nearest_psr.feature} @ ${p.nearest_psr.edge_km} km`);
}
