// LEOSpy orbital + classification helpers (server-side, no secrets)
// Categorises satellites using Space-Track GP fields (name, country, type)
// so the frontend can colour/filter without extra data sources.

const EARTH_RADIUS_KM = 6378.137;

const CATEGORY_RULES = [
  { id: 'iss', test: (n) => /ISS \(ZARYA\)|ISS \(NAUKA\)|\bZARYA\b/.test(n) },
  { id: 'station', test: (n) => /CSS \(|TIANHE|TIANGONG/.test(n) },
  { id: 'starlink', test: (n) => n.includes('STARLINK') },
  {
    id: 'comms',
    test: (n) => /ONEWEB|IRIDIUM|GLOBALSTAR|ORBCOMM|O3B|SES-|INTELSAT|ASTROCAST|SWARM|LEMUR|KEPLER|GONETS|YAHSAT|VIASAT|TELESAT|HAWK|SPACEBEE/.test(n)
  },
  {
    id: 'weather',
    test: (n) => /NOAA|METOP|METEOR|FENGYUN|FY-|DMSP|JPSS|SUOMI|NPP|HIMAWARI|GCOM|ELEKTRO|INSAT/.test(n)
  },
  {
    id: 'imaging',
    test: (n) => /PLANET|FLOCK|SKYSAT|WORLDVIEW|SENTINEL|LANDSAT|ICEYE|CAPELLA|DOVE|GAOFEN|KOMPSAT|SPOT|PLEIADES|JILIN|SUPERVIEW|TERRA|AQUA|EROS|TUBSAT|BLACKSKY|UMBRA/.test(n)
  },
  {
    id: 'scientific',
    test: (n) => /HST|HUBBLE|GRACE|CALIPSO|AURA|CHEOPS|XMM|SWARM|CLUSTER|THEMIS|CUBESAT|GRACE-FO|ICESAT|CALIOP|AEOLUS|PROBA|CSS-T/.test(n)
  },
  {
    id: 'military',
    test: (n, country) => /USA-|NROL|COSMOS|YAOGAN|OFEQ|SHIYAN|KOSMOS|TJS|SJ-|NAVAL|GEO-IK/.test(n) || /^USA \d/.test(n)
  },
  { id: 'navigation', test: (n) => /NAVSTAR|GPS|GLONASS|GALILEO|BEIDOU|QZS|IRNSS/.test(n) }
];

const FEATURED_NORAD = new Set([
  25544, // ISS (ZARYA)
  20580, // Hubble Space Telescope
  48274, // CSS Tianhe
  49044, // Landsat 9
]);

export function classifySatellite(name = '', country = '', objectType = '') {
  const n = String(name).toUpperCase();
  const c = String(country).toUpperCase();
  for (const rule of CATEGORY_RULES) {
    try {
      if (rule.test(n, c)) return rule.id;
    } catch (_) {
      /* defensive: ignore malformed rule input */
    }
  }
  return 'other';
}

export function isFeatured(noradId) {
  return FEATURED_NORAD.has(Number(noradId));
}

// Compute orbital period (minutes) from mean motion (revs/day) when missing.
export function periodFromMeanMotion(meanMotion) {
  const mm = Number(meanMotion);
  if (!mm || mm <= 0) return null;
  return 1440 / mm;
}

// Approximate altitude band (km) from apoapsis/periapsis GP fields.
export function altitudeBand(apoapsisKm, periapsisKm) {
  const apo = Number(apoapsisKm);
  const peri = Number(periapsisKm);
  if (!Number.isFinite(apo) || !Number.isFinite(peri)) return null;
  return Math.round((apo + peri) / 2);
}

// Shape a raw Space-Track GP record into a compact LEOSpy record.
export function shapeGpRecord(gp) {
  const noradId = Number(gp.NORAD_CAT_ID);
  if (!noradId || !gp.TLE_LINE1 || !gp.TLE_LINE2) return null;

  const name = gp.OBJECT_NAME || `NORAD ${noradId}`;
  const category = classifySatellite(name, gp.COUNTRY_CODE, gp.OBJECT_TYPE);
  const period = gp.PERIOD ? Number(gp.PERIOD) : periodFromMeanMotion(gp.MEAN_MOTION);

  return {
    n: noradId,
    name,
    t1: gp.TLE_LINE1,
    t2: gp.TLE_LINE2,
    c: category,
    co: gp.COUNTRY_CODE || '',
    ot: gp.OBJECT_TYPE || 'PAYLOAD',
    ld: gp.LAUNCH_DATE || '',
    ep: gp.EPOCH || '',
    inc: gp.INCLINATION != null ? Number(gp.INCLINATION) : null,
    ap: gp.APOAPSIS != null ? Number(gp.APOAPSIS) : null,
    pe: gp.PERIAPSIS != null ? Number(gp.PERIAPSIS) : null,
    mm: gp.MEAN_MOTION != null ? Number(gp.MEAN_MOTION) : null,
    ecc: gp.ECCENTRICITY != null ? Number(gp.ECCENTRICITY) : null,
    rcs: gp.RCS_SIZE || '',
    period: period ? Number(period.toFixed(2)) : null,
    alt: altitudeBand(gp.APOAPSIS, gp.PERIAPSIS),
    featured: isFeatured(noradId)
  };
}

export const CATEGORY_IDS = [
  'iss',
  'station',
  'starlink',
  'comms',
  'weather',
  'imaging',
  'scientific',
  'military',
  'navigation',
  'other'
];

export { EARTH_RADIUS_KM };
