// BHS Penalty Shootout — a Blaxland High School penalty shootout for two phones.
//
// Three ideas hold the server together:
//
//   1. A shootout is a strict alternation of kicks, and both people act at the
//      same time. So a kick is not "shooter acts, then keeper reacts" — it is
//      one object that collects two blind inputs and is resolved once, here.
//      Neither client is ever told the other's aim before it has committed.
//   2. Nothing runs on a timer. A kick carries a deadline, and the next person
//      to poll the match is the one who resolves it. That keeps a stalled or
//      backgrounded phone from wedging a match, with no background work.
//   3. Ratings are the only thing that separates the players, and they act on
//      *spread*, not on a dice roll after the fact. A 99 puts the ball within a
//      few centimetres of where it was aimed; a 65 sprays it. So the rating is
//      felt through the aim the person actually chose.
//
// State is flat JSON under data/, written through a serialised queue so two
// concurrent requests can't read-modify-write over each other. Same shape as
// routes/arthurchat, which this borrows its session handling from.

import { existsSync } from 'fs';
import { mkdir, readFile, writeFile } from 'fs/promises';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { randomBytes, randomUUID, scrypt, timingSafeEqual } from 'crypto';
import { promisify } from 'util';
import express from 'express';

const scryptAsync = promisify(scrypt);

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..', '..');
const DATA_DIR = join(ROOT, 'data');
const PUBLIC_DIR = join(ROOT, 'public', 'bhsshootout');

const USERS_PATH = join(DATA_DIR, 'bhs-users.json');
const SESSIONS_PATH = join(DATA_DIR, 'bhs-sessions.json');
const MATCHES_PATH = join(DATA_DIR, 'bhs-matches.json');

const SESSION_DAYS = 120;
const MAX_USERNAME = 16;
const MIN_PASSWORD = 6;

// ------------------------------------------------------------------- squad ---

// The school team. `name` is the surname because that is what goes on a shirt
// and what fits in a squad slot; `full` is only for the player card.
export const TAKERS = [
  { id: 'isky',    name: 'Isky',    full: 'Zayne Isky',      rating: 99 },
  { id: 'maclean', name: 'Maclean', full: 'Arthur Maclean',  rating: 99 },
  { id: 'badel',   name: 'Badel',   full: 'Jackson Badel',   rating: 99 },
  { id: 'blaikie', name: 'Blaikie', full: 'Caleb Blaikie',   rating: 99 },
  { id: 'dyke',    name: 'Dyke',    full: 'Bernie Dyke',     rating: 99 },
  { id: 'faucet',  name: 'Faucet',  full: 'Jack Faucet',     rating: 65 }
];

export const KEEPERS = [
  { id: 'foot', name: 'Foot', full: 'Sam Foot', rating: 85 }
];

const TAKER_BY_ID = new Map(TAKERS.map((p) => [p.id, p]));
const KEEPER_BY_ID = new Map(KEEPERS.map((p) => [p.id, p]));

const SQUAD_SIZE = 5;
const REGULATION_KICKS = SQUAD_SIZE * 2;
const KICK_SECONDS = 6;        // how long both people have to swipe
const RESULT_MS = 3200;        // how long the ball flight and reaction play for
const MATCH_IDLE_MS = 10 * 60 * 1000;
const QUEUE_STALE_MS = 12000;  // a phone that stops polling has left the queue
const BOT_AFTER_MS = 13000;    // nobody else waiting? play the school's ghost XI

const CROWNS_FOR_WIN = 3;

// ----------------------------------------------------------------- storage ---

async function readJson(path, fallback) {
  try {
    return JSON.parse(await readFile(path, 'utf8'));
  } catch {
    return fallback;
  }
}

async function writeJson(path, value) {
  await writeFile(path, JSON.stringify(value, null, 2));
}

let writeChain = Promise.resolve();
function serialise(fn) {
  const run = writeChain.then(fn, fn);
  writeChain = run.then(() => undefined, () => undefined);
  return run;
}

async function ensureStore() {
  await mkdir(DATA_DIR, { recursive: true });
  for (const [path, seed] of [
    [USERS_PATH, { users: [] }],
    [SESSIONS_PATH, { sessions: [] }],
    [MATCHES_PATH, { matches: [] }]
  ]) {
    if (!existsSync(path)) await writeJson(path, seed);
  }
}

const readUsers = () => readJson(USERS_PATH, { users: [] });
const readSessions = () => readJson(SESSIONS_PATH, { sessions: [] });
const readMatches = () => readJson(MATCHES_PATH, { matches: [] });

// ------------------------------------------------------------------- utils ---

function cleanEmail(raw) {
  const s = String(raw || '').trim().toLowerCase();
  return /^[^@\s]+@[^@\s.]+\.[^@\s]+$/.test(s) ? s : null;
}

/** Usernames are what friends type at each other, so keep them plain. */
function cleanUsername(raw) {
  const s = String(raw || '').trim().replace(/^@/, '');
  if (!/^[A-Za-z0-9_]{3,16}$/.test(s)) return null;
  return s.slice(0, MAX_USERNAME);
}

const usernameKey = (s) => String(s || '').toLowerCase();

async function hashPassword(password, saltHex) {
  const derived = await scryptAsync(password, saltHex, 32);
  return derived.toString('hex');
}

function constantTimeEqual(a, b) {
  const ba = Buffer.from(String(a));
  const bb = Buffer.from(String(b));
  if (ba.length !== bb.length) return false;
  return timingSafeEqual(ba, bb);
}

/** Box–Muller. The shot spread is normal, so a miss is rare and a near-miss common. */
function gauss(sigma) {
  let u = 0;
  while (u === 0) u = Math.random();
  const v = Math.random();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v) * sigma;
}

const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, n));

function num(raw, fallback = 0) {
  const n = Number(raw);
  return Number.isFinite(n) ? n : fallback;
}

// -------------------------------------------------------------- kick maths ---

// Everything below works in one coordinate: x across the goalmouth, where 0 is
// dead centre and ±1 is the inside of a post. Height is not modelled — the
// keeper only ever swipes left or right, so a second axis would be a decision
// the game never asks anyone to make.

/**
 * How far a taker's ball strays from where it was aimed.
 * A 99 is within a hand's width of his aim; a 65 is a coin flip on the corners.
 * Hitting it harder always costs accuracy, which is what makes power a choice.
 */
function shotSigma(rating, power) {
  return (0.45 * (1 - rating / 100) + 0.04) * (0.78 + 0.5 * power);
}

/** A keeper's dive strays too — guessing right is not the same as getting there. */
function keeperSigma(rating) {
  return 0.5 * (1 - rating / 100) + 0.055;
}

/**
 * How much goal a keeper covers once he has committed.
 *
 * Three things shrink it, and between them they are the whole game.
 *
 *   - A harder shot gives him less time, so the same dive covers less ground.
 *   - A ball in the corner is further away and higher, so a keeper who guessed
 *     the right side still has to reach it. That is why the corner is worth
 *     aiming at — and why a taker who cannot find it should not try.
 *   - A better taker strikes it cleaner. This is the term that makes the number
 *     on the card mean what it says: for the same aim and the same swipe, a 99
 *     goes in more often than a 65 does, before spread is even considered.
 */
function keeperReach(keeperRating, takerRating, power, ball) {
  return (0.16 + 0.26 * (keeperRating / 100))
    * (1.2 - 0.45 * power)
    * (1 - 0.55 * Math.min(1, Math.abs(ball)))
    * (1.75 - 0.75 * (takerRating / 100));
}

const POST = 0.985;   // inside of the post
const OFF = 1.09;     // beyond this and it is not even close

/**
 * Resolve one kick from two blind inputs. Returns everything the animation
 * needs, so both phones replay exactly the same ball.
 */
export function resolveKick(taker, keeper, shot, dive) {
  const aim = clamp(num(shot.aim), -0.88, 0.88);
  const power = clamp(num(shot.power, 0.5), 0, 1);
  const ball = aim + gauss(shotSigma(taker.rating, power));

  const dived = clamp(num(dive.aim), -1, 1) + gauss(keeperSigma(keeper.rating));

  let outcome;
  if (Math.abs(ball) >= OFF) outcome = 'wide';
  else if (Math.abs(ball) >= POST) outcome = 'post';
  else if (Math.abs(ball - dived) <= keeperReach(keeper.rating, taker.rating, power, ball)) outcome = 'saved';
  else outcome = 'goal';

  return {
    aim, power,
    ball: Number(ball.toFixed(4)),
    dive: Number(dived.toFixed(4)),
    outcome,
    scored: outcome === 'goal'
  };
}

// ------------------------------------------------------------ match shapes ---

const kickShooter = (index) => index % 2;              // seat taking this kick
const kickRound = (index) => Math.floor(index / 2);    // 0-based round

/** Rounds past the fifth reuse the squad from the top — same as a real shootout. */
function takerForKick(match, index) {
  const seat = kickShooter(index);
  return TAKER_BY_ID.get(match.seats[seat].squad[kickRound(index) % SQUAD_SIZE]);
}

function keeperForKick(match, index) {
  const seat = 1 - kickShooter(index);
  return KEEPER_BY_ID.get(match.seats[seat].keeper);
}

/**
 * Classic best-of-five: stop the moment the kicks left cannot change it.
 * After regulation it is sudden death, decided only at the end of a full pair.
 */
function decide(match) {
  const played = match.kicks.length;
  const [a, b] = match.score;

  if (played < REGULATION_KICKS) {
    // How many of the kicks still to come belong to each seat.
    let ra = 0, rb = 0;
    for (let i = played; i < REGULATION_KICKS; i++) (kickShooter(i) === 0 ? ra++ : rb++);
    if (a > b + rb) return 0;
    if (b > a + ra) return 1;
    return null;
  }

  // Sudden death: only judge on an even number of kicks, so both have gone.
  if (played % 2 !== 0) return null;
  if (a !== b) return a > b ? 0 : 1;
  return null;
}

function newKick(match) {
  const index = match.kicks.length;
  return {
    index,
    round: kickRound(index),
    shooter: kickShooter(index),
    taker: takerForKick(match, index).id,
    keeper: keeperForKick(match, index).id,
    deadline: Date.now() + KICK_SECONDS * 1000,
    inputs: {}
  };
}

/** A bot has to swipe too. It aims like a nervous human, not like a solver. */
function botInput(role) {
  const side = Math.random();
  const aim = side < 0.34 ? -0.55 - Math.random() * 0.3
    : side < 0.68 ? 0.55 + Math.random() * 0.3
    : (Math.random() - 0.5) * 0.5;
  return role === 'shot'
    ? { aim, power: 0.35 + Math.random() * 0.5, at: Date.now(), bot: true }
    : { aim, power: 0, at: Date.now(), bot: true };
}

export function createBhsShootoutRouter() {
  const router = express.Router();

  // Express 4 does not catch a promise rejected inside an async handler: it
  // surfaces as an unhandled rejection and node exits, taking the whole site
  // down rather than just this router.
  for (const method of ['get', 'post', 'patch', 'delete']) {
    const register = router[method].bind(router);
    router[method] = (path, ...handlers) => register(path, ...handlers.map((fn) =>
      function guarded(req, res, next) {
        return Promise.resolve(fn(req, res, next)).catch(next);
      }));
  }

  router.use(express.json({ limit: '64kb' }));

  ensureStore().catch((e) => console.error('[bhs] store init failed:', e.message));

  // The queue is deliberately in memory: a restart should drop everyone waiting
  // rather than pair two people who wandered off ten minutes ago.
  const queue = new Map(); // userId -> { userId, username, squad, keeper, since, seen, matchId }

  // ------------------------------------------------------------- session --- //

  function readToken(req) {
    const header = req.get('Authorization') || '';
    if (header.startsWith('Bearer ')) return header.slice(7).trim();
    const cookie = /(?:^|;\s*)bhs_token=([^;]+)/.exec(req.headers.cookie || '');
    return cookie ? decodeURIComponent(cookie[1]) : null;
  }

  async function newSession(userId) {
    const token = randomBytes(32).toString('hex');
    await serialise(async () => {
      const store = await readSessions();
      const cutoff = Date.now() - SESSION_DAYS * 864e5;
      store.sessions = store.sessions.filter((s) => s.at > cutoff);
      store.sessions.push({ token, userId, at: Date.now() });
      await writeJson(SESSIONS_PATH, store);
    });
    return token;
  }

  async function currentUser(req) {
    const token = readToken(req);
    if (!token) return null;
    const { sessions } = await readSessions();
    const session = sessions.find((s) => constantTimeEqual(s.token, token));
    if (!session) return null;
    if (session.at < Date.now() - SESSION_DAYS * 864e5) return null;
    const { users } = await readUsers();
    return users.find((u) => u.id === session.userId) || null;
  }

  async function requireAuth(req, res, next) {
    const user = await currentUser(req);
    if (!user) return res.status(401).json({ error: 'signed-out' });
    req.user = user;
    next();
  }

  function publicUser(user) {
    return {
      id: user.id,
      username: user.username,
      crowns: user.crowns || 0,
      played: user.played || 0,
      won: user.won || 0
    };
  }

  function me(user) {
    return {
      ...publicUser(user),
      email: user.email,
      squad: user.squad || [],
      keeper: user.keeper || KEEPERS[0].id
    };
  }

  // -------------------------------------------------------------- account --- //

  router.post('/api/signup', async (req, res) => {
    const email = cleanEmail(req.body?.email);
    const username = cleanUsername(req.body?.username);
    const password = String(req.body?.password || '');

    if (!email) return res.status(400).json({ error: 'email' });
    if (!username) return res.status(400).json({ error: 'username' });
    if (password.length < MIN_PASSWORD) return res.status(400).json({ error: 'password' });

    const salt = randomBytes(16).toString('hex');
    const passwordHash = await hashPassword(password, salt);

    const created = await serialise(async () => {
      const store = await readUsers();
      if (store.users.some((u) => u.email === email)) return { error: 'email-taken' };
      if (store.users.some((u) => usernameKey(u.username) === usernameKey(username))) {
        return { error: 'username-taken' };
      }
      const user = {
        id: randomUUID(),
        email,
        username,
        salt,
        passwordHash,
        crowns: 0,
        played: 0,
        won: 0,
        squad: [],
        keeper: KEEPERS[0].id,
        friends: [],
        requestsIn: [],
        requestsOut: [],
        at: Date.now()
      };
      store.users.push(user);
      await writeJson(USERS_PATH, store);
      return { user };
    });

    if (created.error) return res.status(409).json({ error: created.error });
    const token = await newSession(created.user.id);
    res.json({ token, me: me(created.user) });
  });

  router.post('/api/signin', async (req, res) => {
    const email = cleanEmail(req.body?.email);
    const password = String(req.body?.password || '');
    if (!email || !password) return res.status(400).json({ error: 'credentials' });

    const { users } = await readUsers();
    const user = users.find((u) => u.email === email);
    if (!user) return res.status(401).json({ error: 'credentials' });

    const hash = await hashPassword(password, user.salt);
    if (!constantTimeEqual(hash, user.passwordHash)) {
      return res.status(401).json({ error: 'credentials' });
    }

    const token = await newSession(user.id);
    res.json({ token, me: me(user) });
  });

  router.post('/api/signout', async (req, res) => {
    const token = readToken(req);
    if (token) {
      await serialise(async () => {
        const store = await readSessions();
        store.sessions = store.sessions.filter((s) => s.token !== token);
        await writeJson(SESSIONS_PATH, store);
      });
    }
    res.json({ ok: true });
  });

  router.get('/api/roster', (req, res) => {
    res.json({ takers: TAKERS, keepers: KEEPERS, squadSize: SQUAD_SIZE });
  });

  router.get('/api/me', requireAuth, async (req, res) => {
    res.json({ me: me(req.user), roster: { takers: TAKERS, keepers: KEEPERS, squadSize: SQUAD_SIZE } });
  });

  /** The squad is saved on the account so the menu comes back the way it was left. */
  router.post('/api/squad', requireAuth, async (req, res) => {
    const squad = Array.isArray(req.body?.squad) ? req.body.squad.slice(0, SQUAD_SIZE) : [];
    const keeper = KEEPER_BY_ID.has(req.body?.keeper) ? req.body.keeper : null;

    const cleaned = [];
    for (const id of squad) {
      if (TAKER_BY_ID.has(id) && !cleaned.includes(id)) cleaned.push(id);
      else cleaned.push(null);
    }

    const saved = await serialise(async () => {
      const store = await readUsers();
      const user = store.users.find((u) => u.id === req.user.id);
      if (!user) return null;
      user.squad = cleaned;
      if (keeper) user.keeper = keeper;
      await writeJson(USERS_PATH, store);
      return user;
    });

    if (!saved) return res.status(404).json({ error: 'missing' });
    res.json({ me: me(saved) });
  });

  // -------------------------------------------------------------- friends --- //

  async function friendView(user) {
    const { users } = await readUsers();
    const byId = new Map(users.map((u) => [u.id, u]));
    const list = (ids) => (ids || []).map((id) => byId.get(id)).filter(Boolean).map(publicUser);
    return {
      friends: list(user.friends).sort((a, b) => b.crowns - a.crowns),
      requestsIn: list(user.requestsIn),
      requestsOut: list(user.requestsOut)
    };
  }

  router.get('/api/friends', requireAuth, async (req, res) => {
    res.json(await friendView(req.user));
  });

  router.post('/api/friends/request', requireAuth, async (req, res) => {
    const username = cleanUsername(req.body?.username);
    if (!username) return res.status(400).json({ error: 'username' });

    const result = await serialise(async () => {
      const store = await readUsers();
      const meRow = store.users.find((u) => u.id === req.user.id);
      const them = store.users.find((u) => usernameKey(u.username) === usernameKey(username));
      if (!them) return { error: 'no-such-user' };
      if (them.id === meRow.id) return { error: 'yourself' };
      if ((meRow.friends || []).includes(them.id)) return { error: 'already-friends' };

      // They asked first — accept instead of stacking a second request.
      if ((meRow.requestsIn || []).includes(them.id)) {
        meRow.requestsIn = meRow.requestsIn.filter((id) => id !== them.id);
        them.requestsOut = (them.requestsOut || []).filter((id) => id !== meRow.id);
        meRow.friends = [...new Set([...(meRow.friends || []), them.id])];
        them.friends = [...new Set([...(them.friends || []), meRow.id])];
        await writeJson(USERS_PATH, store);
        return { added: publicUser(them) };
      }

      if (!(meRow.requestsOut || []).includes(them.id)) {
        meRow.requestsOut = [...(meRow.requestsOut || []), them.id];
        them.requestsIn = [...new Set([...(them.requestsIn || []), meRow.id])];
        await writeJson(USERS_PATH, store);
      }
      return { sent: publicUser(them) };
    });

    if (result.error) return res.status(400).json(result);
    const fresh = (await readUsers()).users.find((u) => u.id === req.user.id);
    res.json({ ...result, ...(await friendView(fresh)) });
  });

  router.post('/api/friends/accept', requireAuth, async (req, res) => {
    const username = cleanUsername(req.body?.username);
    if (!username) return res.status(400).json({ error: 'username' });

    const result = await serialise(async () => {
      const store = await readUsers();
      const meRow = store.users.find((u) => u.id === req.user.id);
      const them = store.users.find((u) => usernameKey(u.username) === usernameKey(username));
      if (!them) return { error: 'no-such-user' };
      if (!(meRow.requestsIn || []).includes(them.id)) return { error: 'no-request' };

      meRow.requestsIn = meRow.requestsIn.filter((id) => id !== them.id);
      them.requestsOut = (them.requestsOut || []).filter((id) => id !== meRow.id);
      meRow.friends = [...new Set([...(meRow.friends || []), them.id])];
      them.friends = [...new Set([...(them.friends || []), meRow.id])];
      await writeJson(USERS_PATH, store);
      return { ok: true };
    });

    if (result.error) return res.status(400).json(result);
    const fresh = (await readUsers()).users.find((u) => u.id === req.user.id);
    res.json(await friendView(fresh));
  });

  // ---------------------------------------------------------------- match --- //

  function seatOf(match, userId) {
    return match.seats.findIndex((s) => s.userId === userId);
  }

  /** Drop matches nobody has touched in a while, then store this one. */
  function stash(store, next) {
    const cutoff = Date.now() - MATCH_IDLE_MS;
    store.matches = store.matches.filter((m) => m.at > cutoff && m.id !== next.id);
    store.matches.push(next);
  }

  async function saveMatch(next) {
    await serialise(async () => {
      const store = await readMatches();
      stash(store, next);
      await writeJson(MATCHES_PATH, store);
    });
  }

  async function loadMatch(id) {
    const { matches } = await readMatches();
    return matches.find((m) => m.id === id) || null;
  }

  function makeMatch(a, b) {
    const match = {
      id: randomUUID(),
      at: Date.now(),
      seats: [a, b].map((p) => ({
        userId: p.userId,
        username: p.username,
        squad: p.squad,
        keeper: p.keeper,
        bot: !!p.bot
      })),
      score: [0, 0],
      kicks: [],
      phase: 'kick',
      over: false,
      winner: null,
      awarded: false
    };
    match.current = newKick(match);
    return match;
  }

  /** A stand-in opponent, so one person alone can still take a shootout. */
  function botSeat() {
    const shuffled = [...TAKERS].sort(() => Math.random() - 0.5).slice(0, SQUAD_SIZE);
    return {
      userId: `bot:${randomUUID()}`,
      username: 'Blaxland CPU',
      squad: shuffled.map((p) => p.id),
      keeper: KEEPERS[0].id,
      bot: true
    };
  }

  /**
   * Advance a match as far as the clock allows, in place. Deliberately
   * synchronous: it runs inside the write lock, so it must not await anything.
   * Returns whether it changed anything.
   */
  function advance(match) {
    let changed = false;

    for (let guard = 0; guard < 4; guard++) {
      if (match.over) break;

      if (match.phase === 'kick') {
        const kick = match.current;
        const bots = match.seats.map((s) => s.bot);
        if (bots[kick.shooter] && !kick.inputs.shot) kick.inputs.shot = botInput('shot');
        if (bots[1 - kick.shooter] && !kick.inputs.dive) kick.inputs.dive = botInput('dive');

        const expired = Date.now() > kick.deadline;
        if (!(kick.inputs.shot && kick.inputs.dive) && !expired) break;

        // Nobody swiped in time: a scuffed pass down the middle, keeper rooted.
        const shot = kick.inputs.shot || { aim: (Math.random() - 0.5) * 0.3, power: 0.2, timedOut: true };
        const dive = kick.inputs.dive || { aim: 0, timedOut: true };

        const taker = TAKER_BY_ID.get(kick.taker);
        const keeper = KEEPER_BY_ID.get(kick.keeper);
        const result = resolveKick(taker, keeper, shot, dive);

        const record = {
          ...kick,
          ...result,
          timedOut: { shot: !!shot.timedOut, dive: !!dive.timedOut },
          resolvedAt: Date.now()
        };
        delete record.inputs;
        delete record.deadline;

        match.kicks.push(record);
        if (result.scored) match.score[kick.shooter] += 1;
        match.phase = 'result';
        match.resultUntil = Date.now() + RESULT_MS;
        match.current = null;
        changed = true;
        continue;
      }

      if (match.phase === 'result') {
        if (Date.now() < match.resultUntil) break;
        const winner = decide(match);
        if (winner !== null) {
          match.over = true;
          match.winner = winner;
          match.phase = 'over';
        } else {
          match.phase = 'kick';
          match.current = newKick(match);
        }
        changed = true;
        continue;
      }

      break;
    }

    return changed;
  }

  /**
   * Move a match forward and hand back what the caller should show.
   *
   * The whole advance happens inside the write lock. Both phones poll this
   * several times a second, so without the lock two requests could each load the
   * same unresolved kick, each roll their own ball, and each write a different
   * outcome — one of which would silently win. `mutate` is an optional change to
   * apply in the same breath, for the same reason.
   */
  async function tick(id, mutate) {
    const outcome = await serialise(async () => {
      const store = await readMatches();
      const match = store.matches.find((m) => m.id === id);
      if (!match) return null;

      let changed = mutate ? !!mutate(match) : false;
      if (advance(match)) changed = true;

      // Claim the payout inside the lock, so a winner is only ever paid once.
      let award = false;
      if (match.over && !match.awarded) {
        match.awarded = true;
        award = true;
        changed = true;
      }

      if (changed) {
        match.at = Date.now();
        stash(store, match);
        await writeJson(MATCHES_PATH, store);
      }
      return { match, award };
    });

    if (!outcome) return null;
    if (outcome.award) await creditWinner(outcome.match);
    return outcome.match;
  }

  /** Crowns and the played/won tallies, once the shootout is settled. */
  async function creditWinner(match) {
    await serialise(async () => {
      const store = await readUsers();
      match.seats.forEach((seat, i) => {
        const user = store.users.find((u) => u.id === seat.userId);
        if (!user) return;                       // a bot has no account to credit
        user.played = (user.played || 0) + 1;
        if (i === match.winner) {
          user.won = (user.won || 0) + 1;
          user.crowns = (user.crowns || 0) + CROWNS_FOR_WIN;
        }
      });
      await writeJson(USERS_PATH, store);
    });
  }

  /**
   * What one seat is allowed to see. The live kick never leaks the other side's
   * input — only whether they have committed, so the UI can say "ready".
   */
  function viewFor(match, seat) {
    const them = 1 - seat;
    const view = {
      id: match.id,
      seat,
      you: { username: match.seats[seat].username, squad: match.seats[seat].squad, keeper: match.seats[seat].keeper },
      them: { username: match.seats[them].username, squad: match.seats[them].squad, keeper: match.seats[them].keeper, bot: !!match.seats[them].bot },
      score: { you: match.score[seat], them: match.score[them] },
      phase: match.phase,
      over: match.over,
      won: match.over ? match.winner === seat : null,
      crownsForWin: CROWNS_FOR_WIN,
      regulation: REGULATION_KICKS,
      kicks: match.kicks.map((k) => ({
        index: k.index,
        round: k.round,
        mine: k.shooter === seat,
        outcome: k.outcome,
        taker: k.taker
      }))
    };

    if (match.phase === 'kick' && match.current) {
      const k = match.current;
      view.kick = {
        index: k.index,
        round: k.round,
        role: k.shooter === seat ? 'shoot' : 'keep',
        taker: k.taker,
        keeper: k.keeper,
        msLeft: Math.max(0, k.deadline - Date.now()),
        youReady: !!(k.shooter === seat ? k.inputs.shot : k.inputs.dive),
        themReady: !!(k.shooter === seat ? k.inputs.dive : k.inputs.shot)
      };
    }

    if (match.phase === 'result' || (match.over && match.kicks.length)) {
      const k = match.kicks[match.kicks.length - 1];
      view.last = {
        index: k.index,
        round: k.round,
        mine: k.shooter === seat,
        taker: k.taker,
        keeper: k.keeper,
        ball: k.ball,
        dive: k.dive,
        power: k.power,
        outcome: k.outcome,
        msLeft: Math.max(0, (match.resultUntil || 0) - Date.now())
      };
    }

    return view;
  }

  // ---------------------------------------------------------------- queue --- //

  function sweepQueue() {
    const now = Date.now();
    for (const [id, entry] of queue) {
      if (!entry.matchId && now - entry.seen > QUEUE_STALE_MS) queue.delete(id);
      if (entry.matchId && now - entry.seen > QUEUE_STALE_MS * 4) queue.delete(id);
    }
  }

  router.post('/api/queue/join', requireAuth, async (req, res) => {
    const squad = Array.isArray(req.body?.squad) ? req.body.squad : [];
    const keeper = KEEPER_BY_ID.has(req.body?.keeper) ? req.body.keeper : KEEPERS[0].id;

    const picked = squad.filter((id) => TAKER_BY_ID.has(id));
    if (picked.length !== SQUAD_SIZE || new Set(picked).size !== SQUAD_SIZE) {
      return res.status(400).json({ error: 'squad' });
    }

    sweepQueue();
    queue.set(req.user.id, {
      userId: req.user.id,
      username: req.user.username,
      squad: picked,
      keeper,
      since: Date.now(),
      seen: Date.now(),
      matchId: null
    });
    res.json({ status: 'waiting' });
  });

  router.post('/api/queue/leave', requireAuth, async (req, res) => {
    const entry = queue.get(req.user.id);
    if (entry && !entry.matchId) queue.delete(req.user.id);
    res.json({ ok: true });
  });

  router.get('/api/queue', requireAuth, async (req, res) => {
    sweepQueue();
    const mine = queue.get(req.user.id);
    if (!mine) return res.json({ status: 'idle' });
    mine.seen = Date.now();

    if (mine.matchId) {
      const match = await loadMatch(mine.matchId);
      if (!match) {
        queue.delete(req.user.id);
        return res.json({ status: 'idle' });
      }
      return res.json({ status: 'matched', matchId: mine.matchId });
    }

    // Pair with whoever has waited longest. Both entries are updated together,
    // so neither can be paired twice.
    const other = [...queue.values()]
      .filter((e) => e.userId !== mine.userId && !e.matchId)
      .sort((a, b) => a.since - b.since)[0];

    if (other) {
      const match = makeMatch(mine, other);
      await saveMatch(match);
      mine.matchId = match.id;
      other.matchId = match.id;
      return res.json({ status: 'matched', matchId: match.id });
    }

    if (Date.now() - mine.since > BOT_AFTER_MS) {
      const match = makeMatch(mine, botSeat());
      await saveMatch(match);
      mine.matchId = match.id;
      return res.json({ status: 'matched', matchId: match.id, bot: true });
    }

    return res.json({ status: 'waiting', waitedMs: Date.now() - mine.since });
  });

  router.get('/api/match/:id', requireAuth, async (req, res) => {
    const seen = await loadMatch(req.params.id);
    if (!seen) return res.status(404).json({ error: 'no-match' });
    if (seatOf(seen, req.user.id) < 0) return res.status(403).json({ error: 'not-yours' });

    const entry = queue.get(req.user.id);
    if (entry) entry.seen = Date.now();

    const match = await tick(req.params.id);
    if (!match) return res.status(404).json({ error: 'no-match' });
    res.json(viewFor(match, seatOf(match, req.user.id)));
  });

  router.post('/api/match/:id/input', requireAuth, async (req, res) => {
    const aim = clamp(num(req.body?.aim), -1, 1);
    const power = clamp(num(req.body?.power, 0.5), 0, 1);
    const index = num(req.body?.kick, -1);

    // Recording the swipe and resolving the kick it completes happen under one
    // lock: the moment the second input lands, the ball is decided.
    let refused = null;
    const match = await tick(req.params.id, (m) => {
      const seat = seatOf(m, req.user.id);
      if (seat < 0) { refused = { status: 403, body: { error: 'not-yours' } }; return false; }
      if (m.phase !== 'kick' || !m.current) { refused = { status: 409, body: { error: 'not-now' } }; return false; }
      if (m.current.index !== index) { refused = { status: 409, body: { error: 'stale' } }; return false; }

      const slot = m.current.shooter === seat ? 'shot' : 'dive';
      if (m.current.inputs[slot]) { refused = { status: 409, body: { error: 'already' } }; return false; }
      m.current.inputs[slot] = { aim, power, at: Date.now() };
      return true;
    });

    if (!match) return res.status(404).json({ error: 'no-match' });
    if (refused) return res.status(refused.status).json(refused.body);
    res.json(viewFor(match, seatOf(match, req.user.id)));
  });

  /** Walking out hands the shootout to whoever stayed. */
  router.post('/api/match/:id/forfeit', requireAuth, async (req, res) => {
    let denied = false;
    const match = await tick(req.params.id, (m) => {
      const seat = seatOf(m, req.user.id);
      if (seat < 0) { denied = true; return false; }
      if (m.over) return false;
      m.over = true;
      m.phase = 'over';
      m.winner = 1 - seat;
      m.forfeit = seat;
      return true;
    });

    if (!match) return res.status(404).json({ error: 'no-match' });
    if (denied) return res.status(403).json({ error: 'not-yours' });
    queue.delete(req.user.id);
    res.json(viewFor(match, seatOf(match, req.user.id)));
  });

  router.use(express.static(PUBLIC_DIR));

  return router;
}
