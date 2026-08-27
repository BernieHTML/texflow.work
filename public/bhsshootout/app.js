/* BHS Penalty Shootout — client.
 *
 * The whole app is one <div id="app"> and a handful of screens that replace it.
 * The one place that rule bends is the match: once a kick is on screen, nothing
 * rebuilds it. A poll that redrew the pitch mid-swipe would take the ball out
 * from under the finger already aiming it, so the match screen is built once per
 * kick and only its small live parts — the clock, the "ready" line — are patched.
 */

import { faceSvg } from './faces.js';
import {
  shooterScene, keeperScene, sceneRefs, drawAim, clearAim,
  resetGloves, playKick, readSwipe
} from './pitch.js';

const API = '/bhsshootout/api';
const TOKEN_KEY = 'bhs.token';

const state = {
  token: localStorage.getItem(TOKEN_KEY) || null,
  me: null,
  roster: null,
  squad: [null, null, null, null, null],
  keeper: 'foot',
  friends: { friends: [], requestsIn: [], requestsOut: [] },
  pendingAdd: null,
  match: null,
  poll: null
};

const app = document.getElementById('app');

/* ------------------------------------------------------------------ utils */

function h(tag, attrs = {}, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === null || v === undefined || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'text') el.textContent = v;
    else if (k === 'html') el.innerHTML = v;
    else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
    else if (v === true) el.setAttribute(k, '');
    else el.setAttribute(k, v);
  }
  for (const kid of kids.flat()) {
    if (kid === null || kid === undefined || kid === false) continue;
    el.append(typeof kid === 'string' ? document.createTextNode(kid) : kid);
  }
  return el;
}

function show(...nodes) {
  stopPoll();
  fill(app, ...nodes);
  window.scrollTo(0, 0);
}

/** replaceChildren turns a null child into the literal text "null". */
function fill(node, ...kids) {
  node.replaceChildren(...kids.flat().filter(Boolean));
}

function stopPoll() {
  if (state.poll) { clearInterval(state.poll); state.poll = null; }
}

async function api(path, { method = 'GET', body } = {}) {
  const res = await fetch(API + path, {
    method,
    headers: {
      ...(body ? { 'Content-Type': 'application/json' } : {}),
      ...(state.token ? { Authorization: `Bearer ${state.token}` } : {})
    },
    body: body ? JSON.stringify(body) : undefined
  });

  let data = {};
  try { data = await res.json(); } catch { /* an empty body is fine */ }

  if (res.status === 401) {
    signOutLocal();
    throw Object.assign(new Error('signed-out'), { code: 'signed-out' });
  }
  if (!res.ok) throw Object.assign(new Error(data.error || 'failed'), { code: data.error });
  return data;
}

const takerById = (id) => (state.roster?.takers || []).find((p) => p.id === id);
const keeperById = (id) => (state.roster?.keepers || []).find((p) => p.id === id);

function ratingClass(rating) {
  return rating >= 90 ? 'elite' : rating >= 78 ? 'good' : 'fair';
}

function crownRow(n) {
  return h('span', { class: 'crowns' }, h('span', { class: 'crown', text: '👑' }), h('b', { text: String(n) }));
}

/* --------------------------------------------------------------- chrome */

/** The stadium behind every menu. Same ground, seen from the tunnel. */
function backdrop() {
  return h('div', { class: 'backdrop', html: `
    <div class="bd-sky"></div>
    <div class="bd-lights"></div>
    <div class="bd-stand"></div>
    <div class="bd-pitch"></div>
  ` });
}

/** The reason we are all here. */
function birthdayBanner() {
  return h('div', { class: 'birthday' },
    h('span', { class: 'bd-text', text: 'Happy Birthday Zayne 🥳' })
  );
}

function topBar(title, { back, right } = {}) {
  return h('header', { class: 'topbar' },
    back ? h('button', { class: 'icon-btn', 'aria-label': 'Back', onclick: back, html: '&#8249;' }) : h('span', { class: 'spacer' }),
    h('h1', { text: title }),
    right || h('span', { class: 'spacer' })
  );
}

function toast(message, tone = '') {
  const el = h('div', { class: `toast ${tone}`, text: message });
  document.body.append(el);
  requestAnimationFrame(() => el.classList.add('in'));
  setTimeout(() => { el.classList.remove('in'); setTimeout(() => el.remove(), 260); }, 2400);
}

/* ------------------------------------------------------------- sign in */

function gateScreen(mode = 'in') {
  const email = h('input', { type: 'email', placeholder: 'you@school.email', autocomplete: 'email', inputmode: 'email' });
  const username = h('input', { type: 'text', placeholder: 'username', autocomplete: 'nickname', maxlength: '16' });
  const password = h('input', { type: 'password', placeholder: 'password', autocomplete: mode === 'up' ? 'new-password' : 'current-password' });
  const error = h('p', { class: 'error' });
  const submit = h('button', { class: 'btn primary', text: mode === 'up' ? 'Create account' : 'Sign in' });

  async function go() {
    error.textContent = '';
    submit.disabled = true;
    try {
      const body = mode === 'up'
        ? { email: email.value, username: username.value, password: password.value }
        : { email: email.value, password: password.value };
      const data = await api(mode === 'up' ? '/signup' : '/signin', { method: 'POST', body });
      state.token = data.token;
      localStorage.setItem(TOKEN_KEY, data.token);
      await boot();
    } catch (e) {
      error.textContent = {
        email: 'That email does not look right.',
        username: 'Usernames are 3–16 letters, numbers or underscores.',
        password: 'Passwords need at least 6 characters.',
        'email-taken': 'There is already an account on that email.',
        'username-taken': 'That username is taken. Try another.',
        credentials: 'Email or password is wrong.'
      }[e.code] || 'Something went wrong. Try again.';
      submit.disabled = false;
    }
  }

  submit.addEventListener('click', go);
  for (const input of [email, username, password]) {
    input.addEventListener('keydown', (ev) => { if (ev.key === 'Enter') go(); });
  }

  return [
    backdrop(),
    h('div', { class: 'gate' },
      h('div', { class: 'crest', html: crestSvg() }),
      h('h1', { class: 'wordmark', html: 'BHS<span>Penalty Shootout</span>' }),
      birthdayBanner(),
      h('div', { class: 'card' },
        h('div', { class: 'tabs' },
          h('button', { class: `tab ${mode === 'in' ? 'on' : ''}`, text: 'Sign in', onclick: () => show(gateScreen('in')) }),
          h('button', { class: `tab ${mode === 'up' ? 'on' : ''}`, text: 'New account', onclick: () => show(gateScreen('up')) })
        ),
        h('label', { class: 'field' }, h('span', { text: 'Email' }), email),
        mode === 'up' ? h('label', { class: 'field' }, h('span', { text: 'Username' }), username) : null,
        mode === 'up' ? h('p', { class: 'hint', text: 'This is the name friends add you with, and the name your crowns hang on.' }) : null,
        h('label', { class: 'field' }, h('span', { text: 'Password' }), password),
        error,
        submit,
        h('p', { class: 'legal' },
          'By playing you agree to the ',
          h('a', { href: '/bhsshootout/terms.html', text: 'Terms' }),
          ' and the ',
          h('a', { href: '/bhsshootout/privacy.html', text: 'Privacy Policy' }),
          '.'
        )
      )
    )
  ];
}

function crestSvg() {
  return `<svg viewBox="0 0 64 72" width="58" height="66" aria-hidden="true">
    <path d="M32 2 60 12v28c0 16-12 26-28 30C16 66 4 56 4 40V12z" fill="#15427a" stroke="#f2c14e" stroke-width="3"/>
    <path d="M32 14a12 12 0 1 0 0 24 12 12 0 0 0 0-24z" fill="#f4f6fa"/>
    <path d="M32 18l3.6 2.6-1.4 4.2h-4.4L28.4 20.6z" fill="#15427a"/>
    <path d="M22 30l3.4 2.5-1.3 4h-4.2M42 30l-3.4 2.5 1.3 4h4.2" fill="none" stroke="#15427a" stroke-width="2"/>
    <text x="32" y="56" text-anchor="middle" fill="#f2c14e" font-size="13" font-weight="800" font-family="system-ui">BHS</text>
  </svg>`;
}

function signOutLocal() {
  state.token = null;
  state.me = null;
  localStorage.removeItem(TOKEN_KEY);
  stopPoll();
  show(gateScreen('in'));
}

/* ------------------------------------------------------------------ menu */

function menuScreen() {
  const slots = h('div', { class: 'slots' });

  function paintSlots() {
    fill(slots,
      ...state.squad.map((id, i) => slotCard(i, id)),
      keeperCard()
    );
  }

  function slotCard(i, id) {
    const player = takerById(id);
    const el = h('button', { class: `slot ${player ? 'filled' : ''}`, onclick: () => openPicker(i, paintSlots) });
    el.append(h('span', { class: 'slot-no', text: `${i + 1}${['st', 'nd', 'rd', 'th', 'th'][i]}` }));
    if (player) {
      el.append(
        h('span', { class: 'slot-face', html: faceSvg(player.id, 54) }),
        h('span', { class: 'slot-name', text: player.name }),
        h('span', { class: `rating ${ratingClass(player.rating)}`, text: String(player.rating) })
      );
    } else {
      el.append(h('span', { class: 'plus', text: '+' }), h('span', { class: 'slot-name dim', text: 'Add taker' }));
    }
    return el;
  }

  function keeperCard() {
    const k = keeperById(state.keeper) || (state.roster?.keepers || [])[0];
    const el = h('button', { class: 'slot keeper filled', onclick: () => openPicker('keeper', paintSlots) });
    el.append(
      h('span', { class: 'slot-no', text: 'GK' }),
      h('span', { class: 'slot-face', html: faceSvg(k.id, 54) }),
      h('span', { class: 'slot-name', text: k.name }),
      h('span', { class: `rating ${ratingClass(k.rating)}`, text: String(k.rating) })
    );
    return el;
  }

  paintSlots();

  const play = h('button', { class: 'btn play', onclick: startQueue },
    h('span', { text: 'Play a shootout' }),
    h('small', { text: 'Matched against anyone else on the server' })
  );

  return [
    backdrop(),
    birthdayBanner(),
    h('div', { class: 'menu' },
      h('header', { class: 'me' },
        h('div', { class: 'crest sm', html: crestSvg() }),
        h('div', { class: 'me-name' },
          h('strong', { text: state.me.username }),
          h('span', { text: `${state.me.won} won · ${state.me.played} played` })
        ),
        crownRow(state.me.crowns)
      ),
      h('h2', { class: 'section', text: 'Your five' }),
      h('p', { class: 'section-note', text: 'Order matters — first slot takes the first kick. A higher rating puts the ball closer to where you aimed.' }),
      slots,
      play,
      h('div', { class: 'menu-row' },
        h('button', { class: 'btn ghost', text: `Friends${state.friends.requestsIn.length ? ` (${state.friends.requestsIn.length})` : ''}`, onclick: () => show(friendsScreen()) }),
        h('button', { class: 'btn ghost', text: 'Sign out', onclick: signOut })
      ),
      h('p', { class: 'legal center' },
        h('a', { href: '/bhsshootout/privacy.html', text: 'Privacy' }), ' · ',
        h('a', { href: '/bhsshootout/terms.html', text: 'Terms' })
      )
    )
  ];
}

async function signOut() {
  try { await api('/signout', { method: 'POST' }); } catch { /* going anyway */ }
  signOutLocal();
}

/* ------------------------------------------------------------- the picker */

function openPicker(slot, done) {
  const isKeeper = slot === 'keeper';
  const pool = isKeeper ? state.roster.keepers : state.roster.takers;

  const sheet = h('div', { class: 'sheet' });
  const scrim = h('div', { class: 'scrim', onclick: close });

  function close() {
    sheet.classList.remove('in');
    scrim.classList.remove('in');
    setTimeout(() => { sheet.remove(); scrim.remove(); }, 220);
  }

  async function choose(id) {
    if (isKeeper) state.keeper = id;
    else {
      // One body per shootout: taking someone already in the list moves him.
      const at = state.squad.indexOf(id);
      if (at >= 0) state.squad[at] = state.squad[slot];
      state.squad[slot] = id;
    }
    done();
    close();
    saveSquad();
  }

  sheet.append(
    h('div', { class: 'sheet-grip' }),
    h('h2', { text: isKeeper ? 'Pick your keeper' : `Who takes the ${slot + 1}${['st', 'nd', 'rd', 'th', 'th'][slot]}?` }),
    h('div', { class: 'pool' }, ...pool.map((p) => {
      const picked = isKeeper ? state.keeper === p.id : state.squad.includes(p.id);
      const here = isKeeper ? state.keeper === p.id : state.squad[slot] === p.id;
      return h('button', { class: `card-player ${picked ? 'picked' : ''} ${here ? 'here' : ''}`, onclick: () => choose(p.id) },
        h('span', { class: 'pf', html: faceSvg(p.id, 62) }),
        h('span', { class: 'pn' },
          h('strong', { text: p.name }),
          h('small', { text: p.full })
        ),
        h('span', { class: `rating big ${ratingClass(p.rating)}`, text: String(p.rating) })
      );
    })),
    !isKeeper && state.squad[slot]
      ? h('button', { class: 'btn ghost wide', text: 'Empty this slot', onclick: () => { state.squad[slot] = null; done(); close(); saveSquad(); } })
      : null
  );

  app.append(scrim, sheet);
  requestAnimationFrame(() => { sheet.classList.add('in'); scrim.classList.add('in'); });
}

async function saveSquad() {
  try {
    const data = await api('/squad', { method: 'POST', body: { squad: state.squad, keeper: state.keeper } });
    state.me = data.me;
  } catch { /* the pick still stands locally; it saves again next time */ }
}

/* ------------------------------------------------------------------ queue */

async function startQueue() {
  const picked = state.squad.filter(Boolean);
  if (picked.length !== 5 || new Set(picked).size !== 5) {
    toast('Fill all five slots before you play.', 'warn');
    return;
  }

  show(backdrop(), h('div', { class: 'queue' },
    h('div', { class: 'radar' }, h('span'), h('span'), h('span')),
    h('h2', { text: 'Finding an opponent' }),
    h('p', { class: 'queue-note', text: 'Anyone else on the server can be matched with you.' }),
    h('div', { class: 'queue-squad' }, ...picked.map((id) => h('span', { class: 'qf', html: faceSvg(id, 40) }))),
    h('button', { class: 'btn ghost', text: 'Cancel', onclick: async () => { try { await api('/queue/leave', { method: 'POST' }); } catch {} ; show(menuScreen()); } })
  ));

  try {
    await api('/queue/join', { method: 'POST', body: { squad: picked, keeper: state.keeper } });
  } catch {
    toast('Could not join the queue.', 'warn');
    show(menuScreen());
    return;
  }

  state.poll = setInterval(async () => {
    try {
      const q = await api('/queue');
      if (q.status === 'matched') {
        stopPoll();
        openMatch(q.matchId);
      } else if (q.status === 'idle') {
        stopPoll();
        show(menuScreen());
      }
    } catch { /* keep waiting; the next tick tries again */ }
  }, 1200);
}

/* ------------------------------------------------------------------ match */

function openMatch(id) {
  const view = {
    id,
    renderedKick: -1,
    playedKick: -1,
    animating: false,
    committed: -1,
    refs: null,
    nodes: {}
  };
  state.match = view;

  const stage = h('div', { class: 'stage' });
  const hud = h('div', { class: 'hud' });
  const overlay = h('div', { class: 'overlay' });
  view.nodes = { stage, hud, overlay };

  show(h('div', { class: 'match' }, stage, hud, overlay));

  const step = async () => {
    if (view.animating) return;
    try {
      const data = await api(`/match/${id}`);
      renderMatch(view, data);
    } catch (e) {
      if (e.code === 'no-match') { stopPoll(); toast('That match is over.'); show(menuScreen()); }
    }
  };
  step();
  state.poll = setInterval(step, 650);
}

function renderMatch(view, m) {
  view.data = m;
  paintHud(view, m);

  if (m.over) return paintOver(view, m);

  if (m.phase === 'result' && m.last && m.last.index !== view.playedKick) {
    view.playedKick = m.last.index;
    // The scene for this kick is already on screen — animate it, do not rebuild.
    if (view.renderedKick !== m.last.index) buildScene(view, m, m.last);
    runKick(view, m.last);
    return;
  }

  if (m.phase === 'kick' && m.kick) {
    if (view.renderedKick !== m.kick.index) buildScene(view, m, m.kick);
    paintKickState(view, m);
  }
}

function buildScene(view, m, kick) {
  const role = kick.role || (kick.mine ? 'shoot' : 'keep');
  const takerId = kick.taker;
  const keeperId = kick.keeper;

  view.renderedKick = kick.index;
  view.committed = -1;
  view.role = role;
  view.nodes.stage.innerHTML = role === 'shoot'
    ? shooterScene(takerId, keeperId)
    : keeperScene(takerId, keeperId);
  view.refs = sceneRefs(view.nodes.stage, role);
  view.nodes.overlay.replaceChildren();
  resetGloves(view.refs);
  attachSwipe(view);
}

/** Score, round, and the row of dots that is the shootout so far. */
function paintHud(view, m) {
  const dots = (seat) => {
    const mine = seat === 'you';
    const marks = [];
    for (let r = 0; r < Math.max(5, Math.ceil(m.kicks.length / 2)); r++) {
      const k = m.kicks.find((x) => x.round === r && x.mine === mine);
      marks.push(h('i', { class: `dot ${k ? (k.outcome === 'goal' ? 'scored' : 'missed') : ''}` }));
    }
    return h('div', { class: 'dots' }, ...marks);
  };

  fill(view.nodes.hud,
    h('div', { class: 'score' },
      h('div', { class: 'side' }, h('span', { class: 'who', text: 'You' }), dots('you')),
      h('div', { class: 'nums', text: `${m.score.you} – ${m.score.them}` }),
      h('div', { class: 'side right' }, h('span', { class: 'who', text: m.them.username }), dots('them'))
    ),
    h('div', { class: 'phase-line' },
      m.kick
        ? h('span', { class: `role-chip ${m.kick.role}`, text: m.kick.role === 'shoot' ? '⚽ You shoot' : '🧤 You save' })
        : h('span', { class: 'role-chip', text: m.over ? 'Full time' : 'Watching it back' }),
      h('span', { class: 'round', text: m.kicks.length >= m.regulation ? 'Sudden death' : `Round ${(m.kick?.round ?? m.last?.round ?? 0) + 1} of 5` })
    )
  );
}

/** The parts of a live kick that change every poll: the clock, and who is ready. */
function paintKickState(view, m) {
  const k = m.kick;
  const player = k.role === 'shoot' ? takerById(k.taker) : keeperById(k.keeper);
  const secs = Math.ceil(k.msLeft / 1000);

  let bar = view.nodes.overlay.querySelector('.timer i');
  if (!bar) {
    fill(view.nodes.overlay,
      h('div', { class: 'kick-card' },
        h('span', { class: 'kf', html: faceSvg(k.role === 'shoot' ? k.taker : k.keeper, 46) }),
        h('div', { class: 'kt' },
          h('strong', { text: player ? player.name : '' }),
          h('small', { class: 'instruct', text: k.role === 'shoot' ? 'Swipe left or right to place it. Swipe further up to hit it harder.' : 'Swipe left or right to dive.' })
        )
      ),
      h('div', { class: 'timer' }, h('i')),
      h('div', { class: 'ready-line' })
    );
    bar = view.nodes.overlay.querySelector('.timer i');
  }

  bar.style.width = `${Math.max(0, Math.min(100, (k.msLeft / 6000) * 100))}%`;
  bar.classList.toggle('urgent', secs <= 2);

  const ready = view.nodes.overlay.querySelector('.ready-line');
  ready.textContent = k.youReady
    ? (k.themReady ? 'Here it comes…' : `Locked in. Waiting for ${m.them.username}…`)
    : `${secs}s`;
  ready.classList.toggle('locked', k.youReady);

  view.nodes.stage.classList.toggle('locked', k.youReady);
}

async function runKick(view, last) {
  view.animating = true;
  view.nodes.overlay.replaceChildren();
  view.nodes.stage.classList.remove('locked');
  try {
    await playKick(view.refs, last);
  } catch { /* the scene was torn down mid-flight; nothing to do */ }

  const verdict = {
    goal: last.mine ? ['GOAL', 'good'] : ['GOAL', 'bad'],
    saved: last.mine ? ['SAVED', 'bad'] : ['SAVED!', 'good'],
    post: ['OFF THE POST', last.mine ? 'bad' : 'good'],
    wide: ['OFF TARGET', last.mine ? 'bad' : 'good']
  }[last.outcome] || ['GOAL', 'good'];

  fill(view.nodes.overlay, h('div', { class: `verdict ${verdict[1]}`, text: verdict[0] }));
  view.animating = false;
}

function paintOver(view, m) {
  stopPoll();
  const won = m.won;
  show(
    backdrop(),
    h('div', { class: `fulltime ${won ? 'won' : 'lost'}` },
      h('div', { class: 'ft-crest', html: crestSvg() }),
      h('h1', { text: won ? 'You won the shootout' : 'You lost the shootout' }),
      h('div', { class: 'ft-score', text: `${m.score.you} – ${m.score.them}` }),
      h('p', { class: 'ft-them', text: `vs ${m.them.username}${m.them.bot ? ' (stand-in)' : ''}` }),
      won ? h('div', { class: 'ft-crowns' }, h('span', { text: '👑' }), h('strong', { text: `+${m.crownsForWin} crowns` })) : null,
      h('button', { class: 'btn primary', text: 'Back to the menu', onclick: async () => { await refreshMe(); show(menuScreen()); } })
    )
  );
}

/* ------------------------------------------------------------------ swipe */

/**
 * One finger, one commit. The aim is read from the drag as it happens so the
 * reticle can follow it, and sent the moment the finger lifts — there is no
 * confirm step, because the other person's clock is running too.
 */
function attachSwipe(view) {
  const el = view.nodes.stage;
  let start = null;

  const box = () => el.getBoundingClientRect();

  el.onpointerdown = (ev) => {
    if (view.committed === view.renderedKick || view.animating) return;
    if (view.data?.kick?.youReady) return;
    start = { x: ev.clientX, y: ev.clientY };
    el.setPointerCapture(ev.pointerId);
    drawAim(view.refs, 0, view.role === 'shoot' ? 0.35 : 0);
  };

  el.onpointermove = (ev) => {
    if (!start) return;
    const s = readSwipe(ev.clientX - start.x, ev.clientY - start.y, box(), view.role);
    drawAim(view.refs, s.aim, s.power);
  };

  el.onpointerup = async (ev) => {
    if (!start) return;
    const s = readSwipe(ev.clientX - start.x, ev.clientY - start.y, box(), view.role);
    start = null;
    clearAim(view.refs);
    if (view.role === 'keep') resetGloves(view.refs);

    const kick = view.renderedKick;
    view.committed = kick;
    try {
      const data = await api(`/match/${view.id}/input`, {
        method: 'POST',
        body: { kick, aim: s.aim, power: s.power }
      });
      renderMatch(view, data);
    } catch (e) {
      if (e.code !== 'already' && e.code !== 'stale' && e.code !== 'not-now') {
        view.committed = -1;
        toast('That did not send. Swipe again.', 'warn');
      }
    }
  };

  el.onpointercancel = () => { start = null; clearAim(view.refs); };
}

/* ---------------------------------------------------------------- friends */

function friendsScreen() {
  const input = h('input', { type: 'text', placeholder: 'their username', maxlength: '16', autocapitalize: 'none', autocorrect: 'off' });
  if (state.pendingAdd) input.value = state.pendingAdd;

  const list = h('div', { class: 'friend-list' });

  function paint() {
    const { friends, requestsIn, requestsOut } = state.friends;
    fill(list,
      requestsIn.length ? h('h3', { class: 'section', text: 'Wants to be your friend' }) : null,
      ...requestsIn.map((u) => h('div', { class: 'friend req' },
        h('span', { class: 'fu', text: u.username }),
        h('button', { class: 'btn tiny', text: 'Accept', onclick: () => accept(u.username) })
      )),
      h('h3', { class: 'section', text: `Friends${friends.length ? ` (${friends.length})` : ''}` }),
      friends.length ? null : h('p', { class: 'section-note', text: 'Nobody yet. Send someone your link and they can add you back.' }),
      ...friends.map((u) => h('div', { class: 'friend' },
        h('span', { class: 'fu', text: u.username }),
        crownRow(u.crowns)
      )),
      requestsOut.length ? h('h3', { class: 'section', text: 'Waiting on' }) : null,
      ...requestsOut.map((u) => h('div', { class: 'friend pending' }, h('span', { class: 'fu', text: u.username }), h('small', { text: 'sent' })))
    );
  }

  async function add(username) {
    if (!username) return;
    try {
      const data = await api('/friends/request', { method: 'POST', body: { username } });
      state.friends = { friends: data.friends, requestsIn: data.requestsIn, requestsOut: data.requestsOut };
      state.pendingAdd = null;
      input.value = '';
      toast(data.added ? `You and ${data.added.username} are friends.` : 'Request sent.');
      paint();
    } catch (e) {
      toast({
        'no-such-user': 'No player with that username.',
        yourself: 'That is you.',
        'already-friends': 'You are already friends.'
      }[e.code] || 'Could not send that.', 'warn');
    }
  }

  async function accept(username) {
    try {
      state.friends = await api('/friends/accept', { method: 'POST', body: { username } });
      paint();
    } catch { toast('Could not accept that.', 'warn'); }
  }

  paint();
  refreshFriends().then(paint);

  return [
    backdrop(),
    birthdayBanner(),
    h('div', { class: 'menu' },
      topBar('Friends', { back: () => show(menuScreen()) }),
      h('div', { class: 'card flat' },
        h('h3', { class: 'section', text: 'Add by username' }),
        h('div', { class: 'add-row' },
          input,
          h('button', { class: 'btn primary tiny', text: 'Add', onclick: () => add(input.value.trim()) })
        ),
        h('button', { class: 'btn share', onclick: shareInvite },
          h('span', { text: 'Send Friend Request' }),
          h('small', { text: 'Copies your link, then opens sharing' })
        ),
        h('p', { class: 'hint', text: `Your username is ${state.me.username}. Anyone who opens your link can add you with one tap.` })
      ),
      list
    )
  ];
}

/**
 * The friend request is a link, not a record: it goes on the clipboard and into
 * the share sheet at the same time, so it works whether they paste it or tap it.
 */
async function shareInvite() {
  const url = `${location.origin}/bhsshootout/?add=${encodeURIComponent(state.me.username)}`;
  const text = `Add me on BHS Penalty Shootout — I'm ${state.me.username}. ${url}`;

  let copied = false;
  try {
    await navigator.clipboard.writeText(url);
    copied = true;
  } catch {
    // Clipboard is blocked outside a secure context or without permission —
    // a hidden textarea plus execCommand still works on older iOS.
    const ta = h('textarea', { class: 'offscreen' });
    ta.value = url;
    document.body.append(ta);
    ta.select();
    try { copied = document.execCommand('copy'); } catch { copied = false; }
    ta.remove();
  }

  if (navigator.share) {
    try {
      await navigator.share({ title: 'BHS Penalty Shootout', text, url });
      return;
    } catch { /* they backed out of the sheet; the copy still happened */ }
  }
  toast(copied ? 'Link copied. Send it to them.' : url, copied ? '' : 'warn');
}

async function refreshFriends() {
  try { state.friends = await api('/friends'); } catch { /* leave what we have */ }
}

/* ------------------------------------------------------------------- boot */

async function refreshMe() {
  const data = await api('/me');
  state.me = data.me;
  state.roster = data.roster;
  const squad = Array.isArray(data.me.squad) ? data.me.squad : [];
  state.squad = Array.from({ length: 5 }, (_, i) => squad[i] || null);
  state.keeper = data.me.keeper || 'foot';
}

async function boot() {
  const add = new URLSearchParams(location.search).get('add');
  if (add) {
    state.pendingAdd = add;
    history.replaceState(null, '', '/bhsshootout/');
  }

  if (!state.token) {
    show(gateScreen(state.pendingAdd ? 'up' : 'in'));
    return;
  }

  try {
    await refreshMe();
    await refreshFriends();
  } catch {
    show(gateScreen('in'));
    return;
  }

  if (state.pendingAdd) show(friendsScreen());
  else show(menuScreen());
}

boot();

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/bhsshootout/sw.js').catch(() => { /* offline is a bonus, not a requirement */ });
  });
}
