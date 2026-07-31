// OurMoon — claim a plot at the lunar south pole, name a base, and site the
// Lunar Thermal Energy Conversion (LTEC) plant that powers it.
//
// The siting rules are the whole game, and they are enforced here (the client
// mirrors them only for instant feedback):
//
//   1. An LTEC must sit inside a peak of eternal light (PEL)  — the hot side.
//   2. An LTEC must be within 10 km of a PSR                  — the cold sink.
//   3. An LTEC must be within 10 km of its own base           — power transmission.
//   4. A base and its LTEC must both be at least 10 km clear of every *other*
//      claim's base and LTEC                                  — no overlapping claims.
//
// State lives in flat JSON under data/ (same pattern as BMFlight). All writes
// go through a serialised queue so two simultaneous claims can't both pass the
// 10 km check and then clobber each other.

import { existsSync } from 'fs';
import { mkdir, readFile, writeFile } from 'fs/promises';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { createHash, randomBytes, scryptSync, timingSafeEqual } from 'crypto';
import express from 'express';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..', '..');
const DATA_DIR = join(ROOT, 'data');
const PUBLIC_DIR = join(ROOT, 'public', 'ourmoon');

const USERS_PATH = join(DATA_DIR, 'ourmoon-users.json');
const SESSIONS_PATH = join(DATA_DIR, 'ourmoon-sessions.json');
const BASES_PATH = join(DATA_DIR, 'ourmoon-bases.json');

const ORIGIN = (process.env.BASE_URL || 'https://texflow.work').replace(/\/$/, '');
const MOON_R = 1737.4;                 // km, mean lunar radius
const CLAIM_CLEARANCE_KM = 10;         // min separation between different claims
const LTEC_PSR_MAX_KM = 10;            // max LTEC → cold sink distance
const LTEC_BASE_MAX_KM = 10;           // max LTEC → own base distance
const SESSION_DAYS = 60;
const MAX_MEMBERS = 24;

// ---------------------------------------------------------------- geometry ---

const toRad = (d) => (d * Math.PI) / 180;

/** Great-circle distance in km between two lunar surface points. */
function gcDist(lat1, lon1, lat2, lon2) {
  const p1 = toRad(lat1);
  const p2 = toRad(lat2);
  const dp = toRad(lat2 - lat1);
  const dl = toRad(lon2 - lon1);
  const a = Math.sin(dp / 2) ** 2 + Math.cos(p1) * Math.cos(p2) * Math.sin(dl / 2) ** 2;
  return MOON_R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function normLon(lon) {
  return +((((lon % 360) + 360) % 360)).toFixed(5);
}

/** Latitudes are stored negative-south; display them as "89.700°S". */
function fmtLat(lat) {
  return `${Math.abs(lat).toFixed(3)}°S`;
}

function finiteCoord(value, min, max) {
  const n = Number(value);
  return Number.isFinite(n) && n >= min && n <= max ? n : null;
}

// -------------------------------------------------------------- static data ---

let terrain = null;
async function loadTerrain() {
  if (terrain) return terrain;
  const [psrRaw, pelRaw] = await Promise.all([
    readFile(join(PUBLIC_DIR, 'psr-south.json'), 'utf8'),
    readFile(join(PUBLIC_DIR, 'pel-south.json'), 'utf8')
  ]);
  terrain = {
    psrs: JSON.parse(psrRaw).psrs || [],
    pels: JSON.parse(pelRaw).pels || []
  };
  return terrain;
}

/** Nearest PSR by distance to its edge (negative = the point is inside it). */
function nearestPsr(lat, lon, psrs) {
  let best = null;
  for (const psr of psrs) {
    const edge = gcDist(lat, lon, psr.lat, psr.lon) - psr.radius_km;
    if (!best || edge < best.edge_km) {
      best = { id: psr.id, feature: psr.feature || psr.id, area_km2: psr.area_km2, edge_km: +edge.toFixed(2) };
    }
  }
  return best;
}

/** The PEL region containing a point, if any. */
function containingPel(lat, lon, pels) {
  let best = null;
  for (const pel of pels) {
    const d = gcDist(lat, lon, pel.lat, pel.lon);
    if (d <= pel.radius_km && (!best || d < best._d)) {
      best = { id: pel.id, name: pel.name, illum: pel.illum, _d: d };
    }
  }
  if (!best) return null;
  const { _d, ...pel } = best;
  return { ...pel, offset_km: +_d.toFixed(2) };
}

// ------------------------------------------------------------------ storage ---

async function readJson(path, fallback) {
  try {
    return JSON.parse(await readFile(path, 'utf8'));
  } catch {
    return fallback;
  }
}

async function writeJson(path, value) {
  if (!existsSync(DATA_DIR)) await mkdir(DATA_DIR, { recursive: true });
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

const readUsers = () => readJson(USERS_PATH, []);
const readSessions = () => readJson(SESSIONS_PATH, {});
const readBases = () => readJson(BASES_PATH, []);

// Serialise every read-modify-write of bases.json — the 10 km clearance check
// is only sound if no other claim can land between the check and the write.
let mutation = Promise.resolve();
function withBases(fn) {
  const next = mutation.then(async () => {
    const bases = await readBases();
    const result = await fn(bases);
    if (result && result.commit) await writeJson(BASES_PATH, result.bases ?? bases);
    return result;
  });
  mutation = next.then(() => undefined, () => undefined);
  return next;
}

// --------------------------------------------------------------------- auth ---

function hashPassword(password) {
  const salt = randomBytes(16).toString('hex');
  return `${salt}:${scryptSync(password, salt, 64).toString('hex')}`;
}

function verifyPassword(password, stored) {
  const [salt, hash] = String(stored || '').split(':');
  if (!salt || !hash) return false;
  const expected = Buffer.from(hash, 'hex');
  const actual = scryptSync(password, salt, 64);
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

function parseCookies(req) {
  return String(req.headers.cookie || '').split(';').reduce((acc, part) => {
    const i = part.indexOf('=');
    if (i > -1) acc[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
    return acc;
  }, {});
}

function sessionCookie(token, maxAge = 60 * 60 * 24 * SESSION_DAYS) {
  const secure = process.env.NODE_ENV === 'production' ? '; Secure' : '';
  return `ourmoon_session=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${secure}`;
}

const AVATAR_COLORS = ['#7ee0c8', '#ffc44d', '#4da3ff', '#ff8fa3', '#b98cff', '#5fd08a', '#ff9f5c', '#63d9ee'];
function avatarColor(seed) {
  const hash = createHash('sha1').update(String(seed)).digest();
  return AVATAR_COLORS[hash[0] % AVATAR_COLORS.length];
}

const validUsername = (u) => /^[A-Za-z0-9][A-Za-z0-9_.-]{1,23}$/.test(u);

function publicUser(user) {
  if (!user) return null;
  return { id: user.id, username: user.username, color: user.color, created_at: user.created_at };
}

async function userFromRequest(req) {
  const token = parseCookies(req).ourmoon_session || '';
  if (!token) return null;
  const sessions = await readSessions();
  const session = sessions[token];
  if (!session) return null;
  if (new Date(session.expires_at).getTime() < Date.now()) {
    delete sessions[token];
    await writeJson(SESSIONS_PATH, sessions);
    return null;
  }
  const users = await readUsers();
  return users.find((u) => u.id === session.user_id) || null;
}

async function startSession(res, user) {
  const sessions = await readSessions();
  const now = Date.now();
  // Drop anything already expired while we're here.
  for (const [token, session] of Object.entries(sessions)) {
    if (new Date(session.expires_at).getTime() < now) delete sessions[token];
  }
  const token = `om_${randomBytes(24).toString('hex')}`;
  sessions[token] = {
    user_id: user.id,
    created_at: new Date(now).toISOString(),
    expires_at: new Date(now + 1000 * 60 * 60 * 24 * SESSION_DAYS).toISOString()
  };
  await writeJson(SESSIONS_PATH, sessions);
  res.setHeader('Set-Cookie', sessionCookie(token));
}

async function requireUser(req, res) {
  const user = await userFromRequest(req);
  if (!user) {
    res.status(401).json({ error: 'Sign in to do that' });
    return null;
  }
  return user;
}

// ---------------------------------------------------------------- the rules ---

function slugify(name) {
  return String(name).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 48) || 'base';
}

function uniqueSlug(name, bases) {
  const root = slugify(name);
  if (!bases.some((b) => b.slug === root)) return root;
  for (let n = 2; n < 999; n += 1) {
    const candidate = `${root}-${n}`;
    if (!bases.some((b) => b.slug === candidate)) return candidate;
  }
  return `${root}-${randomBytes(3).toString('hex')}`;
}

/**
 * Check a proposed claim against the terrain and every existing claim.
 * Returns { ok, errors, checks } — `checks` is what the UI shows either way.
 */
function validateClaim({ base, ltec, bases, excludeId = null }) {
  const { psrs, pels } = terrain;
  const errors = [];

  const pel = containingPel(ltec.lat, ltec.lon, pels);
  const psr = nearestPsr(ltec.lat, ltec.lon, psrs);
  const basePsr = nearestPsr(base.lat, base.lon, psrs);
  const baseToLtecKm = +gcDist(base.lat, base.lon, ltec.lat, ltec.lon).toFixed(2);

  if (!pel) {
    errors.push('The LTEC hot side must sit inside a peak of eternal light. Move it onto a lit (gold) region.');
  }
  // Inside a PSR reads as 0 km to the cold sink, not a negative distance.
  const psrReachKm = psr ? Math.max(0, psr.edge_km) : Infinity;
  if (psrReachKm > LTEC_PSR_MAX_KM) {
    errors.push(`The LTEC needs a cold sink within ${LTEC_PSR_MAX_KM} km. Nearest permanently shadowed region is ${psrReachKm.toFixed(1)} km away.`);
  }
  if (baseToLtecKm > LTEC_BASE_MAX_KM) {
    errors.push(`The LTEC must be within ${LTEC_BASE_MAX_KM} km of your base. It is ${baseToLtecKm.toFixed(1)} km away.`);
  }

  // Clearance from every other claim: base and LTEC of both sides.
  let nearestClaim = null;
  for (const other of bases) {
    if (excludeId && other.id === excludeId) continue;
    const points = [
      { kind: 'base', label: other.name, lat: other.lat, lon: other.lon },
      { kind: 'ltec', label: other.ltec?.name || `${other.name} LTEC`, lat: other.ltec?.lat, lon: other.ltec?.lon }
    ].filter((p) => Number.isFinite(p.lat) && Number.isFinite(p.lon));

    for (const point of points) {
      for (const mine of [{ kind: 'base', lat: base.lat, lon: base.lon }, { kind: 'ltec', lat: ltec.lat, lon: ltec.lon }]) {
        const d = gcDist(mine.lat, mine.lon, point.lat, point.lon);
        if (!nearestClaim || d < nearestClaim.distance_km) {
          nearestClaim = {
            base_id: other.id,
            base_name: other.name,
            owner: other.owner_username,
            their: point.kind,
            yours: mine.kind,
            distance_km: +d.toFixed(2)
          };
        }
      }
    }
  }
  if (nearestClaim && nearestClaim.distance_km < CLAIM_CLEARANCE_KM) {
    errors.push(`Too close to ${nearestClaim.base_name} — claims must stay ${CLAIM_CLEARANCE_KM} km clear of another base or LTEC. This is ${nearestClaim.distance_km.toFixed(1)} km.`);
  }

  return {
    ok: errors.length === 0,
    errors,
    checks: {
      pel,
      ltec_psr: psr ? { ...psr, reach_km: +psrReachKm.toFixed(2) } : null,
      base_psr: basePsr,
      base_to_ltec_km: baseToLtecKm,
      nearest_claim: nearestClaim,
      clearance_km: CLAIM_CLEARANCE_KM
    }
  };
}

/** Shape a base for the public API — no private fields exist, but be explicit. */
function publicBase(base) {
  return {
    id: base.id,
    slug: base.slug,
    name: base.name,
    url: `${ORIGIN}/ourmoon/b/${base.slug}`,
    owner: base.owner_username,
    color: base.owner_color || '#7ee0c8',
    lat: base.lat,
    lon: base.lon,
    coordinates: { lat: base.lat, lon_east: normLon(base.lon), body: 'Moon', frame: 'IAU_MOON (mean Earth/polar axis)' },
    region: base.region || null,
    ltec: base.ltec
      ? {
          name: base.ltec.name,
          lat: base.ltec.lat,
          lon: base.ltec.lon,
          coordinates: { lat: base.ltec.lat, lon_east: normLon(base.ltec.lon) },
          peak_of_eternal_light: base.ltec.pel || null,
          cold_sink: base.ltec.psr || null,
          base_distance_km: base.ltec.base_distance_km
        }
      : null,
    members: (base.members || []).map((m) => ({ username: m.username, joined_at: m.joined_at })),
    member_count: (base.members || []).length,
    created_at: base.created_at
  };
}

// ---------------------------------------------------------------- share page ---

function esc(value) {
  return String(value == null ? '' : value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function sharePageHtml(base) {
  const title = `${base.name} — a lunar base on OurMoon`;
  const lonE = normLon(base.lon);
  const description = `${base.name} is claimed by ${base.owner_username} at ${fmtLat(base.lat)} ${lonE.toFixed(3)}°E on the Moon's south pole, powered by ${base.ltec?.name || 'an LTEC plant'} in ${base.ltec?.pel?.name || 'a peak of eternal light'}. Join this base or claim your own.`;
  const canonical = `${ORIGIN}/ourmoon/b/${base.slug}`;
  const jsonld = {
    '@context': 'https://schema.org',
    '@type': 'Place',
    name: base.name,
    description,
    url: canonical,
    additionalType: 'https://www.wikidata.org/wiki/Q1341042',
    geo: {
      '@type': 'GeoCoordinates',
      latitude: base.lat,
      longitude: lonE,
      addressCountry: 'Moon'
    },
    containedInPlace: { '@type': 'Place', name: 'Lunar south pole', sameAs: 'https://www.wikidata.org/wiki/Q1044603' },
    isPartOf: { '@type': 'WebSite', name: 'OurMoon', url: `${ORIGIN}/ourmoon` }
  };

  const members = (base.members || []).map((m) => `<li>${esc(m.username)}</li>`).join('');

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>${esc(title)}</title>
<meta name="description" content="${esc(description)}">
<meta name="robots" content="index, follow, max-image-preview:large">
<link rel="canonical" href="${esc(canonical)}">
<meta property="og:type" content="place">
<meta property="og:title" content="${esc(title)}">
<meta property="og:description" content="${esc(description)}">
<meta property="og:url" content="${esc(canonical)}">
<meta property="og:site_name" content="OurMoon">
<meta property="og:image" content="${esc(ORIGIN)}/ourmoon/og.png">
<meta property="place:location:latitude" content="${base.lat}">
<meta property="place:location:longitude" content="${lonE}">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="${esc(title)}">
<meta name="twitter:description" content="${esc(description)}">
<meta name="twitter:image" content="${esc(ORIGIN)}/ourmoon/og.png">
<link rel="alternate" type="application/json" href="${esc(ORIGIN)}/ourmoon/bases.json" title="OurMoon live base registry">
<script type="application/ld+json">${JSON.stringify(jsonld).replace(/</g, '\\u003c')}</script>
<link rel="stylesheet" href="/ourmoon/styles.css">
</head>
<body class="share-page">
<main class="share-card">
  <a class="share-brand" href="/ourmoon">◗ OurMoon</a>
  <p class="share-kicker">Lunar south pole · claimed territory</p>
  <h1>${esc(base.name)}</h1>
  <p class="share-owner">Founded by <strong>${esc(base.owner_username)}</strong></p>

  <dl class="share-facts">
    <div><dt>Base</dt><dd>${Math.abs(base.lat).toFixed(4)}°S · ${lonE.toFixed(4)}°E</dd></div>
    <div><dt>LTEC plant</dt><dd>${esc(base.ltec?.name || '—')}</dd></div>
    <div><dt>Hot side</dt><dd>${esc(base.ltec?.pel?.name || '—')}${base.ltec?.pel ? ` · ${base.ltec.pel.illum}% lit` : ''}</dd></div>
    <div><dt>Cold sink</dt><dd>${esc(base.ltec?.psr?.feature || '—')}${base.ltec?.psr ? ` · ${Math.max(0, base.ltec.psr.edge_km).toFixed(1)} km` : ''}</dd></div>
    <div><dt>Crew</dt><dd>${(base.members || []).length} ${(base.members || []).length === 1 ? 'person' : 'people'}</dd></div>
  </dl>

  ${members ? `<ul class="share-members">${members}</ul>` : ''}

  <div class="share-actions">
    <a class="btn primary" href="/ourmoon?join=${encodeURIComponent(base.slug)}">Join ${esc(base.name)}</a>
    <a class="btn" href="/ourmoon?claim=1">Claim your own base</a>
  </div>
  <p class="share-note">Any new base must sit at least ${CLAIM_CLEARANCE_KM} km clear of every existing base and LTEC plant.</p>
</main>
</body>
</html>
`;
}

// ------------------------------------------------------------------- routes ---

export function registerOurMoon(app) {
  const router = express.Router();
  router.use(express.json({ limit: '32kb' }));

  // Express 4 does not catch rejected promises from async handlers, so route
  // every handler through a wrapper that turns a rejection into next(err).
  const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
  for (const method of ['get', 'post', 'patch', 'delete']) {
    const original = router[method].bind(router);
    router[method] = (path, ...handlers) => original(path, ...handlers.map(wrap));
  }

  // Terrain has to be in memory before any rule can be checked.
  router.use(async (_req, _res, next) => {
    try {
      await loadTerrain();
      next();
    } catch (error) {
      next(error);
    }
  });

  // ---- app shell -----------------------------------------------------------
  router.get('/', (_req, res) => res.sendFile(join(PUBLIC_DIR, 'index.html')));

  // ---- public JSON registry (the machine-readable view of the world) -------
  router.get(['/bases.json', '/api/bases'], async (_req, res) => {
    const bases = await readBases();
    const body = {
      '@context': 'https://schema.org',
      '@type': 'ItemList',
      name: 'OurMoon live lunar base registry',
      description: 'Every base currently claimed on OurMoon, with its owner, crew, selenographic coordinates and LTEC power plant siting.',
      url: `${ORIGIN}/ourmoon/bases.json`,
      documentation: `${ORIGIN}/.well-known/ourmoon.json`,
      body_frame: { body: 'Moon', frame: 'IAU_MOON', longitude: 'east-positive, 0–360°', radius_km: MOON_R },
      rules: {
        claim_clearance_km: CLAIM_CLEARANCE_KM,
        ltec_max_psr_km: LTEC_PSR_MAX_KM,
        ltec_max_base_km: LTEC_BASE_MAX_KM,
        ltec_must_be_in_peak_of_eternal_light: true
      },
      count: bases.length,
      generated_at: new Date().toISOString(),
      bases: bases.map(publicBase)
    };
    res.set('Cache-Control', 'public, max-age=30');
    res.set('Access-Control-Allow-Origin', '*');
    res.json(body);
  });

  router.get('/bases/:slug', async (req, res) => {
    const slug = req.params.slug.replace(/\.json$/, '');
    const bases = await readBases();
    const base = bases.find((b) => b.slug === slug);
    if (!base) return res.status(404).json({ error: 'No base with that name' });
    res.set('Access-Control-Allow-Origin', '*');
    res.json(publicBase(base));
  });

  // ---- terrain -------------------------------------------------------------
  router.get('/terrain.json', async (_req, res) => {
    res.set('Cache-Control', 'public, max-age=3600');
    res.json({ psrs: terrain.psrs, pels: terrain.pels, moon_radius_km: MOON_R });
  });

  // ---- auth ----------------------------------------------------------------
  router.post('/api/auth/signup', async (req, res) => {
    const username = String(req.body?.username || '').trim();
    const password = String(req.body?.password || '');
    if (!validUsername(username)) {
      return res.status(400).json({ error: 'Pick 2–24 characters: letters, numbers, dot, dash or underscore.' });
    }
    if (password.length < 8) return res.status(400).json({ error: 'Password must be at least 8 characters.' });

    const users = await readUsers();
    if (users.some((u) => u.username.toLowerCase() === username.toLowerCase())) {
      return res.status(409).json({ error: 'That name is already on the Moon. Try another.' });
    }
    const now = new Date().toISOString();
    const user = {
      id: `omu_${randomBytes(9).toString('hex')}`,
      username,
      password_hash: hashPassword(password),
      color: avatarColor(`${username}:${now}`),
      created_at: now
    };
    users.push(user);
    await writeJson(USERS_PATH, users);
    await startSession(res, user);
    res.status(201).json({ user: publicUser(user) });
  });

  router.post('/api/auth/login', async (req, res) => {
    const username = String(req.body?.username || '').trim();
    const password = String(req.body?.password || '');
    const users = await readUsers();
    const user = users.find((u) => u.username.toLowerCase() === username.toLowerCase());
    if (!user || !verifyPassword(password, user.password_hash)) {
      return res.status(401).json({ error: 'That username and password do not match.' });
    }
    await startSession(res, user);
    res.json({ user: publicUser(user) });
  });

  router.post('/api/auth/logout', async (req, res) => {
    const token = parseCookies(req).ourmoon_session || '';
    if (token) {
      const sessions = await readSessions();
      delete sessions[token];
      await writeJson(SESSIONS_PATH, sessions);
    }
    res.setHeader('Set-Cookie', sessionCookie('', 0));
    res.json({ ok: true });
  });

  router.get('/api/auth/me', async (req, res) => {
    const user = await userFromRequest(req);
    if (!user) return res.json({ user: null, base: null, member_of: [] });
    const bases = await readBases();
    const owned = bases.find((b) => b.owner_id === user.id) || null;
    const memberOf = bases
      .filter((b) => b.owner_id !== user.id && (b.members || []).some((m) => m.user_id === user.id))
      .map(publicBase);
    res.json({ user: publicUser(user), base: owned ? publicBase(owned) : null, member_of: memberOf });
  });

  // ---- live rule check (used by the client while dragging markers) ---------
  router.post('/api/check', async (req, res) => {
    const user = await userFromRequest(req);
    const base = {
      lat: finiteCoord(req.body?.base?.lat, -90, -55),
      lon: finiteCoord(req.body?.base?.lon, -360, 360)
    };
    const ltec = {
      lat: finiteCoord(req.body?.ltec?.lat, -90, -55),
      lon: finiteCoord(req.body?.ltec?.lon, -360, 360)
    };
    if (base.lat === null || base.lon === null || ltec.lat === null || ltec.lon === null) {
      return res.status(400).json({ error: 'Both the base and the LTEC need valid south-pole coordinates.' });
    }
    const bases = await readBases();
    const mine = user ? bases.find((b) => b.owner_id === user.id) : null;
    res.json(validateClaim({ base, ltec, bases, excludeId: mine?.id || null }));
  });

  // ---- claim ---------------------------------------------------------------
  router.post('/api/bases', async (req, res) => {
    const user = await requireUser(req, res);
    if (!user) return;

    const name = String(req.body?.name || '').trim().replace(/\s+/g, ' ');
    const ltecName = String(req.body?.ltec_name || '').trim().replace(/\s+/g, ' ') || `${name} LTEC`;
    const base = {
      lat: finiteCoord(req.body?.lat, -90, -55),
      lon: finiteCoord(req.body?.lon, -360, 360)
    };
    const ltec = {
      lat: finiteCoord(req.body?.ltec_lat, -90, -55),
      lon: finiteCoord(req.body?.ltec_lon, -360, 360)
    };

    if (name.length < 2 || name.length > 48) return res.status(400).json({ error: 'Give the base a name of 2–48 characters.' });
    if (ltecName.length > 60) return res.status(400).json({ error: 'That LTEC name is too long.' });
    if (base.lat === null || base.lon === null) return res.status(400).json({ error: 'Place the base on the map first.' });
    if (ltec.lat === null || ltec.lon === null) return res.status(400).json({ error: 'Place the LTEC plant on the map first.' });

    const result = await withBases((bases) => {
      if (bases.some((b) => b.owner_id === user.id)) {
        return { status: 409, body: { error: 'You already command a base. Rename or abandon it before founding another.' } };
      }
      if (bases.some((b) => b.name.toLowerCase() === name.toLowerCase())) {
        return { status: 409, body: { error: 'A base already carries that name. Pick another.' } };
      }
      const check = validateClaim({ base, ltec, bases });
      if (!check.ok) return { status: 422, body: { error: check.errors[0], errors: check.errors, checks: check.checks } };

      const now = new Date().toISOString();
      const record = {
        id: `omb_${randomBytes(9).toString('hex')}`,
        slug: uniqueSlug(name, bases),
        name,
        owner_id: user.id,
        owner_username: user.username,
        owner_color: user.color,
        lat: +base.lat.toFixed(5),
        lon: +normLon(base.lon).toFixed(5),
        region: check.checks.base_psr
          ? { nearest_psr: check.checks.base_psr.feature, nearest_psr_km: check.checks.base_psr.edge_km }
          : null,
        ltec: {
          name: ltecName,
          lat: +ltec.lat.toFixed(5),
          lon: +normLon(ltec.lon).toFixed(5),
          pel: check.checks.pel,
          psr: check.checks.ltec_psr,
          base_distance_km: check.checks.base_to_ltec_km
        },
        members: [{ user_id: user.id, username: user.username, role: 'founder', joined_at: now }],
        created_at: now,
        updated_at: now
      };
      bases.push(record);
      return { commit: true, bases, status: 201, body: { base: publicBase(record) } };
    });

    res.status(result.status).json(result.body);
  });

  // ---- join / leave --------------------------------------------------------
  router.post('/api/bases/:slug/join', async (req, res) => {
    const user = await requireUser(req, res);
    if (!user) return;

    const result = await withBases((bases) => {
      const base = bases.find((b) => b.slug === req.params.slug);
      if (!base) return { status: 404, body: { error: 'No base with that name.' } };
      if (base.owner_id === user.id) return { status: 409, body: { error: 'You founded this base.' } };
      if ((base.members || []).some((m) => m.user_id === user.id)) {
        return { status: 200, body: { base: publicBase(base), already: true } };
      }
      if ((base.members || []).length >= MAX_MEMBERS) {
        return { status: 409, body: { error: `${base.name} is at capacity (${MAX_MEMBERS} crew).` } };
      }
      base.members = base.members || [];
      base.members.push({ user_id: user.id, username: user.username, role: 'crew', joined_at: new Date().toISOString() });
      base.updated_at = new Date().toISOString();
      return { commit: true, bases, status: 200, body: { base: publicBase(base) } };
    });

    res.status(result.status).json(result.body);
  });

  router.post('/api/bases/:slug/leave', async (req, res) => {
    const user = await requireUser(req, res);
    if (!user) return;

    const result = await withBases((bases) => {
      const base = bases.find((b) => b.slug === req.params.slug);
      if (!base) return { status: 404, body: { error: 'No base with that name.' } };
      if (base.owner_id === user.id) return { status: 409, body: { error: 'A founder cannot leave their own base.' } };
      const before = (base.members || []).length;
      base.members = (base.members || []).filter((m) => m.user_id !== user.id);
      if (base.members.length === before) return { status: 409, body: { error: 'You are not crew on that base.' } };
      base.updated_at = new Date().toISOString();
      return { commit: true, bases, status: 200, body: { base: publicBase(base) } };
    });

    res.status(result.status).json(result.body);
  });

  // ---- rename / abandon ----------------------------------------------------
  router.patch('/api/bases/:slug', async (req, res) => {
    const user = await requireUser(req, res);
    if (!user) return;
    const name = String(req.body?.name || '').trim().replace(/\s+/g, ' ');
    const ltecName = String(req.body?.ltec_name || '').trim().replace(/\s+/g, ' ');

    const result = await withBases((bases) => {
      const base = bases.find((b) => b.slug === req.params.slug);
      if (!base) return { status: 404, body: { error: 'No base with that name.' } };
      if (base.owner_id !== user.id) return { status: 403, body: { error: 'Only the founder can rename this base.' } };
      if (name) {
        if (name.length < 2 || name.length > 48) return { status: 400, body: { error: 'Base names are 2–48 characters.' } };
        if (bases.some((b) => b.id !== base.id && b.name.toLowerCase() === name.toLowerCase())) {
          return { status: 409, body: { error: 'A base already carries that name.' } };
        }
        base.name = name;
      }
      if (ltecName) {
        if (ltecName.length > 60) return { status: 400, body: { error: 'That LTEC name is too long.' } };
        base.ltec.name = ltecName;
      }
      base.updated_at = new Date().toISOString();
      return { commit: true, bases, status: 200, body: { base: publicBase(base) } };
    });

    res.status(result.status).json(result.body);
  });

  router.delete('/api/bases/:slug', async (req, res) => {
    const user = await requireUser(req, res);
    if (!user) return;

    const result = await withBases((bases) => {
      const index = bases.findIndex((b) => b.slug === req.params.slug);
      if (index === -1) return { status: 404, body: { error: 'No base with that name.' } };
      if (bases[index].owner_id !== user.id) return { status: 403, body: { error: 'Only the founder can abandon this base.' } };
      bases.splice(index, 1);
      return { commit: true, bases, status: 200, body: { ok: true } };
    });

    res.status(result.status).json(result.body);
  });

  // ---- share page ----------------------------------------------------------
  router.get('/b/:slug', async (req, res) => {
    const bases = await readBases();
    const base = bases.find((b) => b.slug === req.params.slug);
    // A base can be abandoned after its link was shared — send those visitors
    // to the map rather than a bare 404.
    if (!base) return res.redirect(302, `/ourmoon?missing=${encodeURIComponent(req.params.slug)}`);
    res.type('html').send(sharePageHtml(base));
  });

  // ---- WMS caching proxy (same approach as /psrmap) ------------------------
  const TILE_CACHE = join(DATA_DIR, 'ourmoon-tiles');
  const WMS_UPSTREAM = 'https://wms.im-ldi.com/';
  const ALLOWED_LAYERS = new Set(['luna_wac_global', 'luna_shaded_relief', 'luna_lola_albedo', 'luna_illumination']);
  let cacheReady = false;

  router.get('/wms', async (req, res) => {
    try {
      const q = req.query || {};
      const layers = String(q.layers || q.LAYERS || '');
      if (!ALLOWED_LAYERS.has(layers)) return res.status(400).send('layer not allowed');

      // Rebuild a clean WMS query from a fixed allow-list — never an open proxy.
      const params = new URLSearchParams();
      for (const key of ['SERVICE', 'VERSION', 'REQUEST', 'LAYERS', 'SRS', 'CRS', 'BBOX', 'WIDTH', 'HEIGHT', 'FORMAT', 'STYLES', 'TRANSPARENT']) {
        const value = q[key] ?? q[key.toLowerCase()];
        if (value !== undefined) params.set(key, String(value));
      }
      const upstream = `${WMS_UPSTREAM}?${params.toString()}`;
      const file = join(TILE_CACHE, `${createHash('sha1').update(upstream).digest('hex')}.png`);

      if (!cacheReady) {
        await mkdir(TILE_CACHE, { recursive: true });
        cacheReady = true;
      }
      if (existsSync(file)) {
        res.set('Content-Type', 'image/png');
        res.set('Cache-Control', 'public, max-age=31536000, immutable');
        res.set('X-OurMoon-Cache', 'HIT');
        return res.sendFile(file);
      }

      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 40000);
      let upstreamRes;
      try {
        upstreamRes = await fetch(upstream, { signal: controller.signal });
      } finally {
        clearTimeout(timer);
      }
      if (!upstreamRes.ok) return res.status(502).send('upstream error');

      const buf = Buffer.from(await upstreamRes.arrayBuffer());
      writeFile(file, buf).catch(() => {});
      res.set('Content-Type', upstreamRes.headers.get('content-type') || 'image/png');
      res.set('Cache-Control', 'public, max-age=31536000, immutable');
      res.set('X-OurMoon-Cache', 'MISS');
      return res.send(buf);
    } catch {
      return res.status(504).send('tile fetch failed');
    }
  });

  app.use('/ourmoon', router);

  // Machine-readable descriptor, alongside the site's other .well-known files.
  app.get('/.well-known/ourmoon.json', (_req, res) => {
    res.set('Access-Control-Allow-Origin', '*');
    res.sendFile(join(ROOT, '.well-known', 'ourmoon.json'));
  });
}

export default registerOurMoon;
