// Plays a whole shootout against the router, on a spare port, with no browser.
//
//   node routes/bhsshootout/check-match.mjs
//
// It writes to the real data/bhs-*.json, so the accounts it makes are stamped
// with the run time and left behind rather than cleaned up — they cost nothing
// and being able to sign in as one afterwards is useful.

import express from 'express';
import { createBhsShootoutRouter } from './index.js';

const app = express();
app.use('/bhsshootout', createBhsShootoutRouter());
const server = app.listen(5207);
const BASE = 'http://127.0.0.1:5207/bhsshootout/api';

const call = async (path, { method = 'GET', body, token } = {}) => {
  const res = await fetch(BASE + path, {
    method,
    headers: { ...(body ? { 'Content-Type': 'application/json' } : {}), ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined
  });
  const data = await res.json().catch(() => ({}));
  return { status: res.status, data };
};

const stamp = Date.now();
const fail = (m) => { console.error('FAIL:', m); process.exitCode = 1; };
const ok = (m) => console.log('  ok  ', m);

// --- accounts ---
const a = await call('/signup', { method: 'POST', body: { email: `a${stamp}@t.io`, username: `alpha${stamp % 10000}`, password: 'hunter22' } });
const b = await call('/signup', { method: 'POST', body: { email: `b${stamp}@t.io`, username: `bravo${stamp % 10000}`, password: 'hunter22' } });
a.status === 200 ? ok('signup a') : fail(JSON.stringify(a));
b.status === 200 ? ok('signup b') : fail(JSON.stringify(b));
const TA = a.data.token, TB = b.data.token;

const dupe = await call('/signup', { method: 'POST', body: { email: `a${stamp}@t.io`, username: 'other', password: 'hunter22' } });
dupe.status === 409 ? ok('duplicate email refused') : fail('dupe email allowed');

const badpw = await call('/signin', { method: 'POST', body: { email: `a${stamp}@t.io`, password: 'wrongone' } });
badpw.status === 401 ? ok('wrong password refused') : fail('wrong password allowed');

const again = await call('/signin', { method: 'POST', body: { email: `a${stamp}@t.io`, password: 'hunter22' } });
again.status === 200 ? ok('sign in') : fail('sign in broken');

// --- friends ---
const req = await call('/friends/request', { method: 'POST', body: { username: b.data.me.username }, token: TA });
req.data.sent ? ok('friend request sent') : fail(JSON.stringify(req.data));
const acc = await call('/friends/accept', { method: 'POST', body: { username: a.data.me.username }, token: TB });
acc.data.friends?.length === 1 ? ok('friend accepted') : fail(JSON.stringify(acc.data));
const ghost = await call('/friends/request', { method: 'POST', body: { username: 'nobodyhere' }, token: TA });
ghost.data.error === 'no-such-user' ? ok('unknown username rejected') : fail('ghost friend allowed');

// --- squad + queue ---
const SQUAD = ['isky', 'maclean', 'badel', 'blaikie', 'faucet'];
await call('/squad', { method: 'POST', body: { squad: SQUAD, keeper: 'foot' }, token: TA });
const shortSquad = await call('/queue/join', { method: 'POST', body: { squad: ['isky'], keeper: 'foot' }, token: TA });
shortSquad.status === 400 ? ok('short squad refused') : fail('short squad allowed');

await call('/queue/join', { method: 'POST', body: { squad: SQUAD, keeper: 'foot' }, token: TA });
await call('/queue/join', { method: 'POST', body: { squad: ['dyke', 'isky', 'maclean', 'badel', 'blaikie'], keeper: 'foot' }, token: TB });
await call('/queue', { token: TA });
const qb = await call('/queue', { token: TB });
const matchId = qb.data.matchId;
matchId ? ok(`matched: ${matchId.slice(0, 8)}`) : fail(JSON.stringify(qb.data));

// --- play it out ---
let guard = 0;
let view = (await call(`/match/${matchId}`, { token: TA })).data;
while (!view.over && guard++ < 60) {
  const va = (await call(`/match/${matchId}`, { token: TA })).data;
  const vb = (await call(`/match/${matchId}`, { token: TB })).data;

  if (va.kick && vb.kick) {
    if (va.kick.role === vb.kick.role) fail('both seats given the same role');
    const aim = () => (Math.random() - 0.5) * 1.6;
    if (!va.kick.youReady) await call(`/match/${matchId}/input`, { method: 'POST', body: { kick: va.kick.index, aim: aim(), power: Math.random() }, token: TA });
    if (!vb.kick.youReady) await call(`/match/${matchId}/input`, { method: 'POST', body: { kick: vb.kick.index, aim: aim(), power: Math.random() }, token: TB });
  }
  await new Promise((r) => setTimeout(r, 120));
  view = (await call(`/match/${matchId}`, { token: TA })).data;
  if (view.phase === 'result') await new Promise((r) => setTimeout(r, 3300));
}

view.over ? ok(`shootout finished ${view.score.you}–${view.score.them} in ${view.kicks.length} kicks`) : fail('shootout never ended');
const scoreOk = view.score.you !== view.score.them;
scoreOk ? ok('a winner was decided') : fail('finished level');

const meA = (await call('/me', { token: TA })).data.me;
const meB = (await call('/me', { token: TB })).data.me;
const crowns = meA.crowns + meB.crowns;
crowns === 3 ? ok(`crowns awarded once (${meA.crowns}/${meB.crowns})`) : fail(`crowns wrong: ${crowns}`);
(meA.played === 1 && meB.played === 1) ? ok('played counted once each') : fail(`played ${meA.played}/${meB.played}`);

// A seat cannot peek at the other's live input, and a stranger cannot look at all.
const c = await call('/signup', { method: 'POST', body: { email: `c${stamp}@t.io`, username: `char${stamp % 10000}`, password: 'hunter22' } });
const peek = await call(`/match/${matchId}`, { token: c.data.token });
peek.status === 403 ? ok('outsider cannot read a match') : fail('match leaked to outsider');

// --- both phones polling at once ---
// The failure this guards against: two requests each loading the same
// unresolved kick, each rolling their own ball, and one silently overwriting
// the other. Fire a burst at both seats and check the shootout stays one story.
await call('/queue/join', { method: 'POST', body: { squad: SQUAD, keeper: 'foot' }, token: TA });
await call('/queue/join', { method: 'POST', body: { squad: SQUAD, keeper: 'foot' }, token: TB });
await call('/queue', { token: TA });
const race = (await call('/queue', { token: TB })).data.matchId;

for (let round = 0; round < 3; round++) {
  const before = (await call(`/match/${race}`, { token: TA })).data;
  if (!before.kick) break;
  await Promise.all([
    call(`/match/${race}/input`, { method: 'POST', body: { kick: before.kick.index, aim: 0.6, power: 0.7 }, token: TA }),
    call(`/match/${race}/input`, { method: 'POST', body: { kick: before.kick.index, aim: -0.6, power: 0.7 }, token: TB })
  ]);
  await Promise.all(Array.from({ length: 10 }, (_, i) =>
    call(`/match/${race}`, { token: i % 2 ? TA : TB })));
  await new Promise((r) => setTimeout(r, 3400));
}

const raced = (await call(`/match/${race}`, { token: TA })).data;
const goals = raced.kicks.filter((k) => k.mine && k.outcome === 'goal').length;
raced.kicks.length <= 6 ? ok(`concurrent polling resolved ${raced.kicks.length} kicks, not more`) : fail(`${raced.kicks.length} kicks from 3 rounds`);
goals === raced.score.you ? ok('score matches the kicks actually taken') : fail(`score ${raced.score.you} vs ${goals} goals`);
await call(`/match/${race}/forfeit`, { method: 'POST', token: TA });

// --- bot fallback ---
await call('/queue/join', { method: 'POST', body: { squad: SQUAD, keeper: 'foot' }, token: TA });
console.log('  ... waiting for the stand-in opponent');
// Poll the way the app does: a queue entry that stops being asked about is
// treated as someone who walked away, so a silent wait would be swept.
let solo;
for (let i = 0; i < 16; i++) {
  await new Promise((r) => setTimeout(r, 1200));
  solo = await call('/queue', { token: TA });
  if (solo.data.status !== 'waiting') break;
}
solo.data.status === 'matched' && solo.data.bot ? ok('stand-in opponent offered when alone') : fail(JSON.stringify(solo.data));

const botMatch = (await call(`/match/${solo.data.matchId}`, { token: TA })).data;
botMatch.kick ? ok(`bot match live, you ${botMatch.kick.role}`) : fail('bot match had no kick');

server.close();
console.log(process.exitCode ? '\nSOME CHECKS FAILED' : '\nALL CHECKS PASSED');
