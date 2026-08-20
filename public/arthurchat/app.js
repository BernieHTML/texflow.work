/* ArthurChat client.
 *
 * One rule shapes this file: NEVER rebuild a screen that contains something the
 * person is typing into.
 *
 * The first version re-rendered the whole screen on every poll. Replacing a
 * focused <textarea> removes it from the document, and a removed element loses
 * focus — which on a phone dismisses the keyboard mid-sentence. So screens are
 * built once, their live parts are kept as references, and updates patch only
 * the bits that actually changed. `show()` is for moving between screens, never
 * for refreshing one.
 */

const API = '/arthurchat/api';
const TOKEN_KEY = 'arthurchat.token';

const state = {
  token: localStorage.getItem(TOKEN_KEY) || null,
  me: null,
  tints: [],
  threads: [],
  open: null,   // { id, who, messages, nodes }
  poll: null
};

const app = document.getElementById('app');
const standalone = () =>
  window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true;

/* ------------------------------------------------------------------ utils */

function h(tag, attrs = {}, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === null || v === undefined || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'text') el.textContent = v;
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
  app.replaceChildren(...nodes.flat().filter(Boolean));
}

function svg(paths, size = 18, width = 2) {
  return `<svg viewBox="0 0 24 24" width="${size}" height="${size}" fill="none"
    stroke="currentColor" stroke-width="${width}" stroke-linecap="round"
    stroke-linejoin="round" aria-hidden="true">${paths}</svg>`;
}

function icon(paths, label, cls = 'icon-btn') {
  const el = h('button', { class: cls, 'aria-label': label });
  el.innerHTML = svg(paths);
  return el;
}

const I_BACK = '<path d="M15 5l-7 7 7 7"/>';
const I_SEND = '<path d="M12 19V5"/><path d="M5 12l7-7 7 7"/>';
const I_GEAR = '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.6 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.6a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9v0a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/>';
const I_SHARE = '<path d="M12 16V4"/><path d="M8 8l4-4 4 4"/><path d="M4 14v4a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-4"/>';
const I_PLUS = '<path d="M12 5v14"/><path d="M5 12h14"/>';

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
  try { data = await res.json(); } catch { /* empty body is fine */ }

  if (res.status === 401) {
    signOutLocal();
    throw Object.assign(new Error('signed-out'), { code: 'signed-out' });
  }
  if (!res.ok) throw Object.assign(new Error(data.error || 'failed'), { code: data.error });
  return data;
}

function initials(name) {
  const parts = String(name || '?').trim().split(/\s+/).slice(0, 2);
  return parts.map((p) => p[0]).join('').toUpperCase() || '?';
}

function firstName(name) {
  return String(name || '').trim().split(/\s+/)[0] || 'you';
}

/** Time-aware, and it uses your name — the app should know who it's talking to. */
function greeting() {
  const hour = new Date().getHours();
  if (hour < 5) return 'Still up';
  if (hour < 12) return 'Morning';
  if (hour < 18) return 'Afternoon';
  return 'Evening';
}

function when(ts) {
  const d = new Date(ts);
  const mins = (Date.now() - ts) / 60000;
  if (mins < 1) return 'now';
  if (mins < 60) return `${Math.round(mins)}m`;
  if (new Date().toDateString() === d.toDateString()) {
    return d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  }
  if (mins / 1440 < 7) return d.toLocaleDateString([], { weekday: 'short' });
  return d.toLocaleDateString([], { month: 'short', day: 'numeric' });
}

const clockTime = (ts) => new Date(ts).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });

function stopPolling() {
  if (state.poll) clearInterval(state.poll);
  state.poll = null;
}

function signOutLocal() {
  stopPolling();
  localStorage.removeItem(TOKEN_KEY);
  Object.assign(state, { token: null, me: null, threads: [], open: null });
}

function avatar(who, cls = '') {
  return h('div', {
    class: `avatar ${cls}`,
    style: `background:${who.tint || '#5847e8'}`,
    text: initials(who.name)
  });
}

/* ---------------------------------------------------------------- welcome */

function welcome(mode = 'new') {
  const err = h('p', { class: 'error' });
  const name = h('input', { class: 'field', placeholder: 'What should people call you?', maxlength: '24', autocomplete: 'nickname' });
  const code = h('input', { class: 'field', placeholder: 'Your code, e.g. ARTH-K42P', autocapitalize: 'characters', autocomplete: 'username' });
  const pin = h('input', {
    class: 'field', type: 'password', inputmode: 'numeric',
    placeholder: mode === 'new' ? 'Pick a PIN (4–8 numbers)' : 'Your PIN',
    autocomplete: mode === 'new' ? 'new-password' : 'current-password'
  });
  const go = h('button', { class: 'btn btn--big', text: mode === 'new' ? 'Create my code' : 'Sign in' });

  const submit = async () => {
    err.textContent = '';
    go.disabled = true;
    try {
      const payload = mode === 'new'
        ? { name: name.value, pin: pin.value }
        : { code: code.value, pin: pin.value };
      const data = await api(mode === 'new' ? '/signup' : '/signin', { method: 'POST', body: payload });
      state.token = data.token;
      state.me = data.me;
      localStorage.setItem(TOKEN_KEY, data.token);
      await openChats();
    } catch (e) {
      err.textContent = {
        name: 'Give yourself a name first.',
        pin: 'A PIN is 4 to 8 numbers.',
        'bad-details': 'Check the code and PIN.',
        'no-match': "That code and PIN don't go together.",
        'too-many': 'Too many tries. Give it ten minutes.',
        busy: 'Everything is busy — try once more.'
      }[e.code] || 'That did not work. Try again.';
      go.disabled = false;
    }
  };

  go.addEventListener('click', submit);
  for (const f of [name, code, pin]) {
    f.addEventListener('keydown', (ev) => { if (ev.key === 'Enter') submit(); });
  }

  const tab = (label, m) => {
    const b = h('button', { class: `tab ${mode === m ? 'tab--on' : ''}`, text: label });
    b.addEventListener('click', () => show(welcome(m)));
    return b;
  };

  return h('section', { class: 'welcome' },
    h('img', { class: 'welcome__mark', src: '/arthurchat/icon.svg', alt: '' }),
    h('h1', { text: 'ArthurChat' }),
    h('p', { class: 'muted', text: 'Swap codes with someone, then talk. That is the whole thing.' }),
    h('div', { class: 'tabs' }, tab("I'm new", 'new'), tab('I have a code', 'back')),
    h('div', { class: 'stack' },
      mode === 'new' ? name : code,
      pin,
      err,
      go,
      h('p', { class: 'fine', text: mode === 'new'
        ? 'You will get a code to share. Your PIN is how you sign in on another phone — there is no way to reset it.'
        : 'Use the code you were given and the PIN you picked.' })
    )
  );
}

/* ------------------------------------------------------------ chats list */

async function openChats() {
  stopPolling();
  state.open = null;
  // Signup and signin hand back `me` but not the palette, so the tints have to
  // be fetched too — without this the colour picker renders empty.
  if (!state.me || !state.tints.length) {
    const data = await api('/me');
    state.me = data.me;
    state.tints = data.tints || [];
  }
  state.threads = (await api('/threads')).threads;
  buildChats();

  // Patches the list only. The code field and anything focused are untouched.
  state.poll = setInterval(async () => {
    if (state.open) return;
    try {
      state.threads = (await api('/threads')).threads;
      paintThreadList();
    } catch { /* transient; next tick tries again */ }
  }, 5000);
}

let listNode = null;

function paintThreadList() {
  if (!listNode) return;
  const rows = [];
  if (!state.threads.length) {
    rows.push(h('div', { class: 'empty' },
      h('p', { text: 'Nobody here yet.' }),
      h('p', { class: 'fine', text: 'Send someone your code, or tap + to add theirs.' })
    ));
  }
  for (const t of state.threads) {
    const row = h('button', { class: 'chat' },
      avatar(t.who),
      h('div', { class: 'chat__body' },
        h('div', { class: 'chat__top' },
          h('span', { class: 'chat__name', text: t.who.name }),
          h('span', { class: 'chat__when', text: t.last ? when(t.last.at) : '' })
        ),
        h('div', { class: 'chat__last', text: t.last ? `${t.last.mine ? 'You: ' : ''}${t.last.text}` : t.who.code })
      ),
      t.unread > 0 ? h('span', { class: 'chat__unread', text: String(t.unread) }) : null
    );
    row.addEventListener('click', () => openThread(t.id, t.who));
    rows.push(row);
  }
  listNode.replaceChildren(...rows);
}

function buildChats() {
  listNode = h('div', { class: 'list' });
  paintThreadList();

  const gear = icon(I_GEAR, 'You');
  gear.addEventListener('click', openProfile);

  const plus = icon(I_PLUS, 'Add someone', 'fab');
  plus.addEventListener('click', openAdd);

  show(
    h('header', { class: 'bar' },
      h('div', { class: 'bar__stack' },
        h('div', { class: 'bar__hello', text: `${greeting()}, ${firstName(state.me.name)}` }),
        h('div', { class: 'bar__title', text: 'Chats' })
      ),
      gear
    ),
    listNode,
    // Order matters: the hint must come first so `.hint ~ .fab` can lift the
    // button clear of it. Otherwise the hint covers the fab and eats the tap.
    installHint(),
    plus
  );
}

/* ------------------------------------------------------------ add someone */

function openAdd() {
  const err = h('p', { class: 'error' });
  const field = h('input', {
    class: 'field field--code', placeholder: 'ARTH-0000',
    autocapitalize: 'characters', autocomplete: 'off', spellcheck: 'false'
  });
  const go = h('button', { class: 'btn btn--big', text: 'Add them' });

  const add = async () => {
    err.textContent = '';
    if (!field.value.trim()) return;
    go.disabled = true;
    try {
      const { thread } = await api('/add', { method: 'POST', body: { code: field.value } });
      state.threads = (await api('/threads')).threads;
      openThread(thread.id, thread.who);
    } catch (e) {
      err.textContent = {
        'bad-code': "That doesn't look like a code.",
        'thats-you': 'That one is yours.',
        'no-one': 'Nobody is using that code.'
      }[e.code] || 'Could not add that code.';
      go.disabled = false;
    }
  };

  go.addEventListener('click', add);
  field.addEventListener('keydown', (ev) => { if (ev.key === 'Enter') add(); });

  const back = icon(I_BACK, 'Back');
  back.addEventListener('click', () => buildChats());

  const share = h('button', { class: 'btn btn--ghost' });
  share.innerHTML = `${svg(I_SHARE, 16)}<span>Share my code</span>`;
  share.addEventListener('click', async () => {
    const text = `Add me on ArthurChat — my code is ${state.me.code}`;
    try {
      if (navigator.share) await navigator.share({ text });
      else { await navigator.clipboard.writeText(state.me.code); share.querySelector('span').textContent = 'Copied'; }
    } catch { /* they closed the sheet */ }
  });

  show(
    h('header', { class: 'bar' }, back, h('div', { class: 'bar__title', text: 'Add someone' })),
    h('section', { class: 'sheet' },
      h('p', { class: 'lead', text: 'Type the code they gave you.' }),
      field,
      err,
      go,
      h('div', { class: 'divider', text: 'or' }),
      h('div', { class: 'codecard codecard--flat' },
        h('div', { class: 'codecard__label', text: 'Your code' }),
        h('div', { class: 'codecard__code', text: state.me.code })
      ),
      share
    )
  );
  setTimeout(() => field.focus(), 250);
}

/* ---------------------------------------------------------------- profile */

function openProfile() {
  const back = icon(I_BACK, 'Back');
  back.addEventListener('click', () => buildChats());

  const face = avatar(state.me, 'avatar--xl');
  const nameField = h('input', { class: 'field', value: state.me.name, maxlength: '24' });

  const swatches = h('div', { class: 'swatches' });
  for (const tint of state.tints) {
    const dot = h('button', {
      class: `swatch ${tint === state.me.tint ? 'swatch--on' : ''}`,
      style: `background:${tint}`,
      'aria-label': 'Use this colour'
    });
    dot.addEventListener('click', async () => {
      try {
        const { me } = await api('/profile', { method: 'POST', body: { tint } });
        state.me = me;
        face.style.background = me.tint;
        for (const s of swatches.children) s.classList.remove('swatch--on');
        dot.classList.add('swatch--on');
      } catch { /* leave it as it was */ }
    });
    swatches.append(dot);
  }

  const saved = h('span', { class: 'fine' });
  let timer = null;
  nameField.addEventListener('input', () => {
    clearTimeout(timer);
    timer = setTimeout(async () => {
      const value = nameField.value.trim();
      if (!value) return;
      try {
        const { me } = await api('/profile', { method: 'POST', body: { name: value } });
        state.me = me;
        face.textContent = initials(me.name);
        saved.textContent = 'Saved';
        setTimeout(() => { saved.textContent = ''; }, 1500);
      } catch { /* keep typing */ }
    }, 700);
  });

  const out = h('button', { class: 'btn btn--ghost btn--danger', text: 'Sign out' });
  out.addEventListener('click', async () => {
    try { await api('/signout', { method: 'POST' }); } catch { /* leaving anyway */ }
    signOutLocal();
    show(welcome('back'));
  });

  show(
    h('header', { class: 'bar' }, back, h('div', { class: 'bar__title', text: 'You' })),
    h('section', { class: 'sheet sheet--centre' },
      face,
      h('div', { class: 'codepill', text: state.me.code }),
      h('label', { class: 'fine', text: 'Your name' }),
      nameField,
      saved,
      h('label', { class: 'fine', text: 'Your colour' }),
      swatches,
      h('div', { class: 'spacer' }),
      out
    )
  );
}

/* ----------------------------------------------------------- conversation */

async function openThread(id, who) {
  stopPolling();
  const data = await api(`/threads/${encodeURIComponent(id)}`);
  state.open = { id, who: who || data.who, messages: [], nodes: null };
  buildThread();
  appendMessages(data.messages);

  state.poll = setInterval(async () => {
    if (!state.open || state.open.id !== id) return;
    try {
      const msgs = state.open.messages;
      const since = msgs.length ? msgs[msgs.length - 1].at : 0;
      const fresh = await api(`/threads/${encodeURIComponent(id)}?since=${since}`);
      // Appends only. The composer is never touched, so the keyboard stays up
      // and a half-typed message survives.
      if (fresh.messages.length) appendMessages(fresh.messages);
    } catch { /* transient */ }
  }, 2500);
}

function buildThread() {
  const { who } = state.open;

  const scroller = h('div', { class: 'thread' });
  const box = h('textarea', { rows: '1', placeholder: 'Message', 'aria-label': 'Message' });
  const send = h('button', { class: 'send', 'aria-label': 'Send' });
  send.innerHTML = svg(I_SEND, 18, 2.5);
  send.disabled = true;

  const grow = () => {
    box.style.height = 'auto';
    box.style.height = `${Math.min(box.scrollHeight, window.innerHeight * 0.35)}px`;
    send.disabled = !box.value.trim();
  };
  box.addEventListener('input', grow);

  const submit = async () => {
    const text = box.value.trim();
    if (!text) return;
    box.value = '';
    grow();
    // Deliberately not refocusing: the field was never replaced, so on a phone
    // it still has focus and the keyboard never went anywhere.
    try {
      const { message } = await api(`/threads/${encodeURIComponent(state.open.id)}/say`, {
        method: 'POST', body: { text }
      });
      appendMessages([message]);
    } catch {
      box.value = text; // give them their words back
      grow();
    }
  };

  // Pressing a button normally moves focus to it, which blurs the composer and
  // closes the keyboard — so you'd have to tap the field again for every single
  // message. Swallowing the default on press keeps focus where it already is;
  // the click still fires. This is why submit() never needs to refocus.
  for (const ev of ['mousedown', 'touchstart', 'pointerdown']) {
    send.addEventListener(ev, (e) => e.preventDefault(), { passive: false });
  }

  send.addEventListener('click', submit);
  box.addEventListener('keydown', (ev) => {
    if (ev.key === 'Enter' && !ev.shiftKey && !matchMedia('(pointer: coarse)').matches) {
      ev.preventDefault();
      submit();
    }
  });

  const back = icon(I_BACK, 'Back');
  back.addEventListener('click', () => openChats());

  show(
    h('header', { class: 'bar' },
      back,
      avatar(who, 'avatar--sm'),
      h('div', { class: 'bar__title', text: who.name })
    ),
    scroller,
    h('div', { class: 'composer' }, box, send)
  );

  state.open.nodes = { scroller, box, send, empty: null };
  paintEmpty();
}

function paintEmpty() {
  const { nodes, who, messages } = state.open;
  if (messages.length) {
    nodes.empty?.remove();
    nodes.empty = null;
    return;
  }
  if (nodes.empty) return;
  nodes.empty = h('p', { class: 'empty', text: `Say something to ${firstName(who.name)}.` });
  nodes.scroller.append(nodes.empty);
}

/** The only way messages ever reach the screen. Adds nodes; removes nothing. */
function appendMessages(list) {
  if (!list.length || !state.open?.nodes) return;
  const { scroller } = state.open.nodes;
  const stuckToBottom =
    scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight < 90;

  for (const m of list) {
    const prev = state.open.messages[state.open.messages.length - 1];
    const day = new Date(m.at).toDateString();

    if (!prev || new Date(prev.at).toDateString() !== day) {
      const label = day === new Date().toDateString()
        ? 'Today'
        : new Date(m.at).toLocaleDateString([], { month: 'long', day: 'numeric' });
      scroller.append(h('div', { class: 'daybreak', text: label }));
    }

    const run = prev && prev.mine === m.mine && m.at - prev.at < 4 * 60000
      && new Date(prev.at).toDateString() === day;

    scroller.append(h('div', { class: `bubble ${m.mine ? 'bubble--mine' : ''} ${run ? 'bubble--run' : ''}` },
      m.text,
      h('span', { class: 'bubble__when', text: clockTime(m.at) })
    ));
    state.open.messages.push(m);
  }

  paintEmpty();
  // Only chase the bottom if they were already there — yanking the view while
  // someone is reading back is worse than a missed message.
  if (stuckToBottom) {
    scroller.scrollTop = scroller.scrollHeight;
    requestAnimationFrame(() => { scroller.scrollTop = scroller.scrollHeight; });
  }
}

/* ------------------------------------------------------------ install hint */

let installEvent = null;
window.addEventListener('beforeinstallprompt', (ev) => {
  ev.preventDefault();
  installEvent = ev;
});

/** iOS has no install prompt API, so the only honest thing is to describe the
 *  two taps. Shown once, dismissible, and never in an installed window. */
function installHint() {
  if (standalone() || localStorage.getItem('arthurchat.hint') === 'no') return null;

  const isIOS = /iphone|ipad|ipod/i.test(navigator.userAgent);
  if (!isIOS && !installEvent) return null;

  const bar = h('div', { class: 'hint' });
  const close = h('button', { class: 'hint__x', text: '✕', 'aria-label': 'Not now' });
  close.addEventListener('click', () => {
    localStorage.setItem('arthurchat.hint', 'no');
    bar.remove();
  });

  if (isIOS) {
    const line = h('div', { class: 'hint__text' });
    line.innerHTML = `Keep ArthurChat on your Home Screen — tap ${svg(I_SHARE, 14)} then <b>Add to Home Screen</b>.`;
    bar.append(line, close);
  } else {
    const go = h('button', { class: 'hint__go', text: 'Install' });
    go.addEventListener('click', async () => {
      installEvent.prompt();
      await installEvent.userChoice;
      installEvent = null;
      bar.remove();
    });
    bar.append(h('div', { class: 'hint__text', text: 'Keep ArthurChat on your Home Screen.' }), go, close);
  }
  return bar;
}

/* -------------------------------------------------------------------- boot */

async function boot() {
  if (standalone()) document.body.classList.add('is-app');
  if (!state.token) return show(welcome('new'));
  try {
    await openChats();
  } catch {
    signOutLocal();
    show(welcome('back'));
  }
}

// Coming back to an installed app should feel current, not stale.
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState !== 'visible' || !state.token) return;
  if (state.open) return; // its own poll covers it
  api('/threads').then((d) => { state.threads = d.threads; paintThreadList(); }).catch(() => {});
});

boot();

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/arthurchat/sw.js', { scope: '/arthurchat/' }).catch(() => {});
  });
}
