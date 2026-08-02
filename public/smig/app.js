// smig — the app itself. Wires the screens to the API, the face engine and the
// call layer, and keeps one SSE feed open for everything that arrives.

import {
  $, $$, el, icon, show, goBack, resetHistory, currentScreen,
  toast, openSheet, closeSheet, isSheetOpen,
  initial, clockTime, ago, mmss, tick
} from './ui.js';
import * as face from './face.js';
import { Call } from './call.js';
import { recordingMimeType, toMp3 } from './voice.js';
import { openCamera, fromFile, cameraOpen, cancelCamera } from './snap.js';

const BASE = '/smig';

const state = {
  me: null,
  unlocked: false,
  threads: [],
  thread: null,      // the open conversation, direct or group
  peers: new Map(),  // user id → peer view, for call UI and group name tags
  feed: null,
  typingTimer: 0
};

// --------------------------------------------------------------------- api ---

async function api(path, { method = 'GET', body } = {}) {
  const res = await fetch(BASE + path, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
    credentials: 'same-origin'
  });

  let data = {};
  try { data = await res.json(); } catch { /* not json — fall through */ }

  if (!res.ok) {
    const error = new Error(data.error || 'Something went wrong.');
    error.status = res.status;
    error.locked = data.locked;
    throw error;
  }
  return data;
}

/** Anything that hits a locked session sends the user back to the face gate. */
function handleAuthError(e) {
  if (e.status === 401) { state.me = null; resetHistory(); show('splash', { replace: true }); return true; }
  if (e.locked) { startFace('unlock'); return true; }
  return false;
}

// ------------------------------------------------------------------ splash ---

$$('[data-go]').forEach((btn) => btn.addEventListener('click', () => show(btn.dataset.go)));
$$('[data-back]').forEach((btn) => btn.addEventListener('click', () => {
  if (currentScreen() === 'thread') leaveThread();
  goBack(state.me ? 'home' : 'splash');
}));

// ------------------------------------------------------------------ signup ---

$('#su-go').addEventListener('click', signUp);
$('#su-email').addEventListener('keydown', (e) => { if (e.key === 'Enter') signUp(); });
$('#su-name').addEventListener('keydown', (e) => { if (e.key === 'Enter') $('#su-email').focus(); });

async function signUp() {
  const button = $('#su-go');
  const username = $('#su-name').value.trim();
  const email = $('#su-email').value.trim();
  if (!username || !email) return toast('Both, please.', 'bad');

  button.disabled = true;
  button.textContent = 'Making you…';
  try {
    const { user } = await api('/api/signup', { method: 'POST', body: { username, email } });
    state.me = user;
    paintCode(user.code);
    show('code', { replace: true });
    tick([8, 40, 12]);
  } catch (e) {
    toast(e.message, 'bad');
  } finally {
    button.disabled = false;
    button.textContent = 'Get my code';
  }
}

/** The code lands one character at a time — see .code-out in styles.css. */
function paintCode(code) {
  const out = $('#code-out');
  out.replaceChildren(...[...code].map((ch, i) =>
    el('span', { style: `--i:${i}`, class: ch === '-' ? 'dash' : '' }, ch)
  ));
}

$('#code-copy').addEventListener('click', async () => {
  try {
    await navigator.clipboard.writeText(state.me.code);
    toast('Copied.', 'good');
  } catch {
    toast('Copy it by hand — clipboard is blocked here.', 'bad');
  }
});

$('#code-next').addEventListener('click', () => show('fact', { replace: true }));

// ------------------------------------------------------------------ signin ---

// Six invisible characters behind six visible cells.
const codeField = $('#code-field');
const codeCells = $$('#code-in .cell');

function paintEntry() {
  const value = codeField.value.toUpperCase();
  codeCells.forEach((cell, i) => {
    cell.textContent = value[i] || '';
    cell.classList.toggle('filled', Boolean(value[i]));
    cell.classList.toggle('active', i === value.length && document.activeElement === codeField);
  });
  $('#si-go').disabled = value.length !== 6;
}

codeField.addEventListener('input', () => {
  codeField.value = codeField.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6);
  paintEntry();
  if (codeField.value.length === 6) signIn();
});
codeField.addEventListener('focus', paintEntry);
codeField.addEventListener('blur', paintEntry);
$('#code-in').addEventListener('click', () => codeField.focus());
document.addEventListener('screen', (e) => {
  if (e.detail === 'signin') setTimeout(() => codeField.focus(), 360);
});

$('#si-go').addEventListener('click', signIn);

async function signIn() {
  const button = $('#si-go');
  if (button.disabled) return;
  button.disabled = true;
  try {
    const { user } = await api('/api/signin', { method: 'POST', body: { code: codeField.value } });
    state.me = user;
    codeField.value = '';
    paintEntry();
    tick([8, 40, 12]);
    resetHistory();
    routeAfterAuth();
  } catch (e) {
    $('#code-in').classList.add('shake');
    setTimeout(() => $('#code-in').classList.remove('shake'), 460);
    toast(e.message, 'bad');
    button.disabled = false;
  }
}

/** Where a signed-in person belongs, depending on how far they've got. */
function routeAfterAuth() {
  if (!state.me.fact) return show('fact', { replace: true });
  if (!state.me.hasFace) return startFace('enrol');
  if (!state.unlocked) return startFace('unlock');
  return openHome();
}

// -------------------------------------------------------------------- fact ---

$('#fact-go').addEventListener('click', saveFact);
$('#fact-in').addEventListener('keydown', (e) => { if (e.key === 'Enter') saveFact(); });

async function saveFact() {
  const button = $('#fact-go');
  const fact = $('#fact-in').value.trim();
  if (fact.length < 6) return toast('A bit more than that.', 'bad');

  button.disabled = true;
  try {
    const { fact: saved } = await api('/api/fact', { method: 'POST', body: { fact } });
    state.me.fact = saved;
    // A picture is offered once, on the way in; after that it lives in the menu.
    if (state.me.hasFace) startFace('unlock');
    else show('avatar', { replace: true });
  } catch (e) {
    if (!handleAuthError(e)) toast(e.message, 'bad');
  } finally {
    button.disabled = false;
  }
}

// ------------------------------------------------------------------ picture ---

// Optional, and deliberately cheap: whichever way the picture arrives it is
// cover-cropped to a small square and re-encoded in the browser (see snap.js),
// so a 4 MB phone photo leaves here as a few tens of kilobytes.
let pendingAvatar = null;

$('#pic-pick').addEventListener('click', () => $('#pic-file').click());
$('#pic-wrap').addEventListener('click', () => $('#pic-file').click());

$('#pic-shoot').addEventListener('click', async () => {
  const shot = await openCamera({ square: true, sendLabel: 'Use this one' });
  if (shot) showPendingAvatar(shot.image);
});
// The picture screen serves both onboarding and later edits; this says which.
let picReturnsHome = false;

function changePicture() {
  picReturnsHome = true;
  pendingAvatar = null;
  const img = $('#pic-preview');
  if (state.me.avatar) {
    img.src = `${BASE}/api/avatar/${state.me.avatar}`;
    img.hidden = false;
    $('#pic-empty').hidden = true;
    $('#pic-wrap').classList.add('filled');
  } else {
    img.hidden = true;
    $('#pic-empty').hidden = false;
    $('#pic-wrap').classList.remove('filled');
  }
  $('#pic-skip').textContent = 'Never mind';
  show('avatar');
}

function leavePicture() {
  if (picReturnsHome) { picReturnsHome = false; return openHome(); }
  return startFace('enrol');
}

$('#pic-skip').addEventListener('click', leavePicture);

$('#pic-file').addEventListener('change', async (e) => {
  const file = e.target.files?.[0];
  e.target.value = '';               // let them pick the same file twice
  if (!file) return;
  if (!file.type.startsWith('image/')) return toast('That needs to be a picture.', 'bad');

  try {
    showPendingAvatar((await fromFile(file, { square: true })).image);
  } catch (e) {
    toast(e.message || 'That picture could not be read.', 'bad');
  }
});

/** Show a picture that hasn't been saved yet, whichever way it was got. */
function showPendingAvatar(image) {
  pendingAvatar = image;
  const img = $('#pic-preview');
  img.src = image;
  img.hidden = false;
  $('#pic-empty').hidden = true;
  $('#pic-wrap').classList.add('filled');
  $('#pic-pick').textContent = 'Choose a different one';
  tick(10);
}


$('#pic-go').addEventListener('click', async () => {
  if (!pendingAvatar) return toast('Pick a picture, or skip.', 'bad');
  const button = $('#pic-go');
  button.disabled = true;
  button.textContent = 'Saving…';
  try {
    const { avatar } = await api('/api/avatar', { method: 'POST', body: { image: pendingAvatar } });
    state.me.avatar = avatar;
    pendingAvatar = null;
    if (picReturnsHome) toast('That is you now.', 'good');
    leavePicture();
  } catch (e) {
    if (!handleAuthError(e)) toast(e.message, 'bad');
  } finally {
    button.disabled = false;
    button.textContent = 'Use this one';
  }
});

/** A disc showing someone's picture if they have one, their initial if not. */
function discFor(person, extra = '') {
  const disc = el('div', {
    class: `disc ${extra}`.trim(),
    style: `--hue:${person?.hue ?? 30}`
  }, initial(person?.username));

  if (person?.avatar) {
    disc.append(el('img', {
      src: `${BASE}/api/avatar/${person.avatar}`,
      alt: '',
      loading: 'lazy',
      onerror: (e) => e.target.remove()   // fall back to the initial
    }));
  }
  return disc;
}

/**
 * The disc for a whole conversation. A group is drawn as its first two members
 * side by side, which reads as "more than one person" faster than any badge.
 */
function discForThread(t, extra = '') {
  if (t.kind !== 'group') return discFor(t.peer, extra);

  const disc = el('div', { class: `disc group ${extra}`.trim(), style: `--hue:${t.hue ?? 30}` });
  const shown = (t.members || []).slice(0, 2);
  // A group you are alone in still needs two halves to look like one.
  while (shown.length < 2) shown.push(null);

  for (const person of shown) {
    const half = el('div', { class: 'half', style: `--half-hue:${person?.hue ?? t.hue ?? 30}` },
      person ? initial(person.username) : '');
    if (person?.avatar) {
      half.append(el('img', {
        src: `${BASE}/api/avatar/${person.avatar}`,
        alt: '', loading: 'lazy',
        onerror: (e) => e.target.remove()
      }));
    }
    disc.append(half);
  }
  return disc;
}

/** What a conversation is called: a group's name, or the other person's. */
const titleOf = (t) => (t.kind === 'group' ? t.title : t.peer?.username) || 'someone';

/** The line under the title — who is here, or how many of them. */
function stateOf(t) {
  if (t.kind !== 'group') return t.online ? 'here now' : 'away';
  const people = (t.members?.length || 0) + 1;
  return t.online_count ? `${t.online_count} of ${people} here now` : `${people} people`;
}

// -------------------------------------------------------------------- face ---

const RING = 304.7; // circumference of the progress ring in styles.css
let faceMode = 'enrol';
let faceAbort = null;

function setRing(progress, done = false) {
  const fill = $('#cam-fill');
  fill.setAttribute('stroke-dashoffset', String(RING * (1 - progress)));
  fill.classList.toggle('done', done);
}

function setCue(cue, hint) {
  const node = $('#face-cue');
  if (node.textContent !== cue) {
    node.textContent = cue;
    node.style.animation = 'none';
    void node.offsetWidth;
    node.style.animation = '';
  }
  if (hint !== undefined) $('#face-hint').textContent = hint;
}

function startFace(mode) {
  faceMode = mode;
  const enrolling = mode === 'enrol';
  $('#face-eyebrow').textContent = enrolling ? 'Step three' : 'Welcome back';
  $('#face-title').textContent = enrolling ? 'Show smig your face.' : 'Smile to come in.';
  $('#face-start').classList.remove('hidden');
  $('#face-start').disabled = false;
  $('#face-start').textContent = 'Turn on the camera';
  $('#face-signout').classList.toggle('hidden', enrolling);
  setRing(0);
  setCue(
    enrolling ? 'Two quick frames.' : 'Blank, then smile.',
    enrolling
      ? 'One with a blank face, one smiling. That pair is how you get back in.'
      : 'Your camera never leaves your phone. Only a number describing your face is sent.'
  );
  show('face', { replace: true });
}

$('#face-signout').addEventListener('click', signOut);

$('#face-start').addEventListener('click', async () => {
  const button = $('#face-start');
  button.disabled = true;
  button.textContent = 'Waking the snowman…';

  const bar = $('#face-load');
  bar.classList.remove('hidden');

  try {
    await face.loadModels((p) => { bar.querySelector('i').style.width = `${Math.round(p * 100)}%`; });
    bar.classList.add('hidden');
    await face.startCamera($('#cam'));
    button.classList.add('hidden');
    await runFaceCeremony();
  } catch (e) {
    bar.classList.add('hidden');
    button.classList.remove('hidden');
    button.disabled = false;
    button.textContent = 'Try the camera again';
    setCue('No camera.', e.name === 'NotAllowedError'
      ? 'smig needs the camera to let you in. Allow it in your browser settings.'
      : e.message);
  }
});

async function runFaceCeremony() {
  faceAbort?.abort();
  faceAbort = new AbortController();
  const { signal } = faceAbort;

  try {
    // ---- phase one: a blank face
    setCue('Blank face.', 'No smiling yet — just look at the circle.');
    const blank = await face.capturePhase($('#cam'), 'blank', ({ progress, trouble }) => {
      setRing(progress);
      if (trouble) setCue(face.troubleText(trouble, 'blank'));
      else if (progress > 0) setCue('Hold it…');
    }, signal);

    flash();
    tick(14);
    setRing(0);

    // ---- phase two: the smile
    setCue('Now smile.', 'A real one. The change is what proves you are here.');
    const smile = await face.capturePhase($('#cam'), 'smile', ({ progress, trouble }) => {
      setRing(progress);
      if (trouble) setCue(face.troubleText(trouble, 'smile'));
      else if (progress > 0) setCue('Hold that smile…');
    }, signal);

    flash();
    setRing(1, true);
    tick([10, 50, 18]);
    setCue('Got it.', 'One moment…');

    if (faceMode === 'enrol') {
      await api('/api/face/enrol', { method: 'POST', body: { neutral: blank, smile } });
      state.me.hasFace = true;
      face.stopCamera($('#cam'));
      // Enrolling proves you're here, but the gate is a separate act — send
      // them straight through it so the first unlock is the one they remember.
      setCue('Your face is set.', 'Now do it once more to come in.');
      setTimeout(() => { startFace('unlock'); autoStartFace(); }, 900);
    } else {
      await api('/api/face/unlock', { method: 'POST', body: { blank, smile } });
      state.unlocked = true;
      face.stopCamera($('#cam'));
      setCue('Come in.', '');
      setTimeout(openHome, 480);
    }
  } catch (e) {
    if (e.message === 'cancelled') return;
    setRing(0);
    if (handleAuthError(e)) return;
    setCue('Not quite.', e.message || 'Try that again.');
    toast(e.message || 'Try that again.', 'bad');
    setTimeout(() => { if (face.cameraOn()) runFaceCeremony(); }, 1400);
  }
}

/** Skip the button when we already have camera permission and the models. */
async function autoStartFace() {
  try {
    await face.loadModels(() => {});
    await face.startCamera($('#cam'));
    $('#face-start').classList.add('hidden');
    runFaceCeremony();
  } catch {
    $('#face-start').classList.remove('hidden');
    $('#face-start').disabled = false;
  }
}

function flash() {
  const wrap = $('#cam-wrap');
  wrap.classList.remove('flash');
  void wrap.offsetWidth;
  wrap.classList.add('flash');
  setTimeout(() => wrap.classList.remove('flash'), 500);
}

// -------------------------------------------------------------------- home ---

async function openHome() {
  faceAbort?.abort();
  face.stopCamera($('#cam'));
  resetHistory();
  show('home', { replace: true });
  openFeed();
  await loadThreads();
}

async function loadThreads() {
  try {
    const { threads } = await api('/api/threads');
    state.threads = threads;
    for (const t of threads) rememberPeople(t);
    paintThreads();
  } catch (e) {
    if (!handleAuthError(e)) toast(e.message, 'bad');
  }
}

function paintThreads() {
  const list = $('#thread-list');

  if (!state.threads.length) {
    list.replaceChildren(el('div', { class: 'empty' },
      icon('snowman', { class: 'mark', style: 'width:64px;height:64px;margin:0 auto;opacity:.5' }),
      el('p', { style: 'margin-top:18px;font-size:1.05rem;color:var(--ink-soft)' }, 'Nobody here yet.'),
      el('p', { class: 'tiny', style: 'margin-top:6px' }, "Tap + and type someone's fact.")
    ));
    return;
  }

  list.replaceChildren(...state.threads.map((t, i) => el('button', {
    class: 'thread-row',
    style: `--i:${i}`,
    onclick: () => openThread(t.id)
  },
    discForThread(t, t.online ? 'on' : ''),
    el('div', { class: 'body' },
      el('div', { class: 'name' }, titleOf(t)),
      el('div', { class: `prev ${t.unread ? 'unseen' : ''}` }, previewOf(t))
    ),
    t.unread ? el('div', { class: 'pip' }, String(t.unread)) : el('div', { class: 'tiny' }, ago(t.last_at))
  )));
}

/** The one line of a conversation that shows in the list. */
function previewOf(t) {
  if (!t.last) return t.kind === 'group' ? 'Say something' : (t.peer.fact || 'Say something');
  if (t.last.kind === 'note') return t.last.text;

  const body = { voice: 'Voice note', photo: t.last.text || 'Photo' }[t.last.kind] ?? (t.last.text || '');
  if (t.last.from === state.me.id) return `You: ${body}`;
  // In a group it matters who said it; in a two-person thread it never does.
  if (t.kind !== 'group') return body;
  const who = state.peers.get(t.last.from)?.username;
  return who ? `${who}: ${body}` : body;
}

/** Keep every face we have been told about, whichever thread carried it. */
function rememberPeople(t) {
  if (!t) return;
  if (t.peer?.id) state.peers.set(t.peer.id, t.peer);
  for (const person of t.members || []) state.peers.set(person.id, person);
}

// ------------------------------------------------------------ add + share ---

$('#home-add').addEventListener('click', () => {
  openSheet(
    el('h2', {}, 'Someone new'),
    el('p', { class: 'lede' }, 'One person, or a few of them at once.'),
    el('button', {
      class: 'btn', style: 'margin-top:18px',
      onclick: () => { closeSheet(); setTimeout(addSomeone, 240); }
    }, 'Add one person'),
    el('button', {
      class: 'btn ghost', style: 'margin-top:10px',
      onclick: () => { closeSheet(); setTimeout(startGroup, 240); }
    }, 'Start a group')
  );
});

function addSomeone() {
  const input = el('input', { type: 'text', placeholder: 'i like icecream', maxlength: '80', enterkeyhint: 'go' });
  const go = el('button', { class: 'btn', style: 'margin-top:14px' }, 'Find them');

  const submit = async () => {
    const fact = input.value.trim();
    if (fact.length < 6) return toast('Type their whole fact.', 'bad');
    go.disabled = true;
    go.textContent = 'Looking…';
    try {
      const { peer, already } = await api('/api/add', { method: 'POST', body: { fact } });
      closeSheet();
      toast(already ? `You already have ${peer.username}.` : `${peer.username} is on your list.`, 'good');
      tick([8, 30, 8]);
      await loadThreads();
    } catch (e) {
      if (!handleAuthError(e)) toast(e.message, 'bad');
      go.disabled = false;
      go.textContent = 'Find them';
    }
  };

  go.addEventListener('click', submit);
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter') submit(); });

  openSheet(
    el('h2', {}, 'Add someone'),
    el('p', { class: 'lede' }, "You need the one true thing they told smig. Ask them for it."),
    el('label', { class: 'field' }, input),
    go
  );
  setTimeout(() => input.focus(), 420);
}

// ------------------------------------------------------------------ groups ---

/**
 * A group is built out of people you already talk to. That keeps the fact as
 * the only door onto somebody's screen — nobody gets pulled into a room by a
 * stranger who happened to hear their name.
 */
async function pickPeople({ title, lede, exclude = [], action, needsName = false, onGo }) {
  let contacts = [];
  try {
    ({ contacts } = await api('/api/contacts'));
  } catch (e) {
    return handleAuthError(e) || toast(e.message, 'bad');
  }

  const pool = contacts.filter((c) => !exclude.includes(c.id));
  if (!pool.length) {
    return openSheet(
      el('h2', {}, title),
      el('p', { class: 'lede' }, exclude.length
        ? 'Everyone you talk to is already in here.'
        : "You need someone to talk to first. Add a person by their fact, then make a group.")
    );
  }

  const chosen = new Set();
  const go = el('button', { class: 'btn', style: 'margin-top:16px', disabled: '' }, action);

  const nameField = needsName
    ? el('input', { type: 'text', placeholder: 'saturday people', maxlength: '40' })
    : null;

  const refresh = () => {
    const ready = chosen.size > 0 && (!nameField || nameField.value.trim().length >= 2);
    go.disabled = !ready;
    go.textContent = chosen.size ? `${action} · ${chosen.size}` : action;
  };
  nameField?.addEventListener('input', refresh);

  const rows = pool.map((person) => {
    const row = el('button', { class: 'pick-row' },
      discFor(person, person.online ? 'on' : ''),
      el('div', { class: 'body' },
        el('div', { class: 'name' }, person.username),
        el('div', { class: 'tiny' }, person.fact || '')),
      el('div', { class: 'tick' })
    );
    row.addEventListener('click', () => {
      if (chosen.has(person.id)) chosen.delete(person.id);
      else chosen.add(person.id);
      row.classList.toggle('on', chosen.has(person.id));
      tick(6);
      refresh();
    });
    return row;
  });

  go.addEventListener('click', async () => {
    go.disabled = true;
    go.textContent = 'One moment…';
    try {
      await onGo([...chosen], nameField?.value.trim());
    } catch (e) {
      if (!handleAuthError(e)) toast(e.message, 'bad');
      refresh();
    }
  });

  openSheet(
    el('h2', {}, title),
    el('p', { class: 'lede' }, lede),
    nameField ? el('label', { class: 'field' }, el('span', { class: 'tiny' }, 'Name'), nameField) : null,
    el('div', { class: 'picker' }, ...rows),
    go
  );
}

function startGroup() {
  pickPeople({
    title: 'Start a group',
    lede: 'Name it, then pick who is in it.',
    action: 'Make the group',
    needsName: true,
    onGo: async (members, title) => {
      const { thread } = await api('/api/groups', { method: 'POST', body: { title, members } });
      closeSheet();
      tick([8, 30, 8]);
      await loadThreads();
      openThread(thread.id);
    }
  });
}

function addToGroup(t) {
  pickPeople({
    title: 'Add to the group',
    lede: 'People you already talk to.',
    exclude: [...(t.members || []).map((m) => m.id), state.me.id],
    action: 'Add them',
    onGo: async (members) => {
      await api(`/api/threads/${encodeURIComponent(t.id)}/members`, { method: 'POST', body: { members } });
      closeSheet();
      tick([8, 30, 8]);
      openThread(t.id);
    }
  });
}

$('#home-share').addEventListener('click', async () => {
  const text = `Come chat with me on smig! ${state.me.fact}`;
  const url = `${location.origin}${BASE}/`;

  if (navigator.share) {
    try {
      await navigator.share({ title: 'smig', text, url });
      return;
    } catch { /* dismissed — fall through to the sheet */ }
  }

  const full = `${text}\n${url}`;
  openSheet(
    el('h2', {}, 'Bring someone in'),
    el('p', { class: 'lede' }, 'Send them this. The fact is how they add you.'),
    el('div', { class: 'fact-quote' }, full),
    el('button', {
      class: 'btn', style: 'margin-top:14px',
      onclick: async () => {
        try { await navigator.clipboard.writeText(full); toast('Copied.', 'good'); closeSheet(); }
        catch { toast('Copy it by hand — clipboard is blocked here.', 'bad'); }
      }
    }, 'Copy the invite')
  );
});

$('#home-menu').addEventListener('click', () => {
  openSheet(
    el('h2', {}, state.me.username),
    el('p', { class: 'lede' }, 'Your code and your fact. Nobody sees your email.'),
    el('div', { class: 'code-plate', style: 'margin-top:18px' },
      el('span', { class: 'eyebrow' }, 'Your code'),
      el('div', { class: 'code-out' }, ...[...state.me.code].map((ch, i) =>
        el('span', { style: `--i:${i}`, class: ch === '-' ? 'dash' : '' }, ch)))
    ),
    el('div', { class: 'fact-quote' }, state.me.fact || '—'),
    el('button', {
      class: 'btn ghost', style: 'margin-top:14px',
      onclick: () => { closeSheet(); setTimeout(() => changePicture(), 260); }
    }, state.me.avatar ? 'Change my picture' : 'Add a picture'),
    el('button', {
      class: 'btn ghost',
      onclick: () => { closeSheet(); setTimeout(() => { closeFeed(); startFace('unlock'); }, 260); }
    }, 'Lock smig now'),
    el('button', { class: 'btn quiet', onclick: signOut }, 'Sign out')
  );
});

async function signOut() {
  closeSheet();
  closeFeed();
  faceAbort?.abort();
  face.stopCamera($('#cam'));
  try { await api('/api/signout', { method: 'POST' }); } catch { /* going anyway */ }
  state.me = null;
  state.unlocked = false;
  state.threads = [];
  resetHistory();
  show('splash', { replace: true });
}

// ------------------------------------------------------------------ thread ---

async function openThread(id) {
  show('thread');
  $('#msg-list').replaceChildren();
  $('#th-name').textContent = '…';
  $('#th-state').textContent = '';

  try {
    const data = await api(`/api/threads/${encodeURIComponent(id)}`);
    if (!data.thread) throw new Error('smig was updated — reload the page.');
    state.thread = { ...data.thread, messages: data.messages };
    rememberPeople(data.thread);
    paintThreadHeader();
    paintMessages(true);
    // The badge is gone server-side now; reflect that in the list behind us.
    const row = state.threads.find((t) => t.id === id);
    if (row) row.unread = 0;
  } catch (e) {
    if (!handleAuthError(e)) { toast(e.message, 'bad'); goBack('home'); }
  }
}

function leaveThread() {
  state.thread = null;
  loadThreads();
}

function paintThreadHeader() {
  const t = state.thread;
  if (!t) return;

  $('#th-name').textContent = titleOf(t);
  const disc = discForThread(t, '');
  disc.id = 'th-disc';
  disc.setAttribute('style',
    `--hue:${(t.kind === 'group' ? t.hue : t.peer?.hue) ?? 30};flex:0 0 38px;width:38px;height:38px;font-size:.9rem`);
  $('#th-disc').replaceWith(disc);

  const node = $('#th-state');
  node.textContent = stateOf(t);
  node.classList.toggle('live', Boolean(t.online));

  // A group call needs a mesh smig doesn't have, so the buttons go away rather
  // than sit there failing.
  const group = t.kind === 'group';
  $('#th-voice').classList.toggle('hidden', group);
  $('#th-video').classList.toggle('hidden', group);
}

$('#th-who').addEventListener('click', () => {
  const t = state.thread;
  if (!t) return;
  return t.kind === 'group' ? openGroupSheet(t) : openPeerSheet(t);
});

function openPeerSheet(t) {
  openSheet(
    el('h2', {}, t.peer?.username || 'someone'),
    t.peer?.fact ? el('div', { class: 'fact-quote' }, t.peer.fact) : null,
    el('button', {
      class: 'btn danger', style: 'margin-top:16px',
      onclick: () => endThread(t, {
        question: 'Everything in it goes, for both of you. Voice notes and photos too.',
        confirmLabel: 'End this conversation'
      })
    }, 'End this conversation')
  );
}

function openGroupSheet(t) {
  const everyone = [{ ...state.me, username: `${state.me.username} (you)` }, ...(t.members || [])];

  openSheet(
    el('h2', {}, t.title),
    el('p', { class: 'lede' }, `${everyone.length} people. Anyone here can add someone they talk to.`),

    el('div', { class: 'picker' }, ...everyone.map((person) => el('div', { class: 'member-row' },
      discFor(person),
      el('div', { class: 'body' },
        el('div', { class: 'name' }, person.username),
        el('div', { class: 'tiny' }, person.id === t.owner ? 'started the group' : (person.fact || ''))
      )
    ))),

    el('button', {
      class: 'btn', style: 'margin-top:16px',
      onclick: () => { closeSheet(); setTimeout(() => addToGroup(t), 240); }
    }, 'Add someone'),
    el('button', {
      class: 'btn ghost',
      onclick: () => { closeSheet(); setTimeout(() => renameGroup(t), 240); }
    }, 'Rename the group'),
    el('button', {
      class: 'btn danger', style: 'margin-top:10px',
      onclick: () => endThread(t, {
        question: `The others carry on in ${t.title} without you, and you stop seeing it.`,
        confirmLabel: 'Leave the group'
      })
    }, 'Leave the group')
  );
}

function renameGroup(t) {
  const input = el('input', { type: 'text', maxlength: '40', enterkeyhint: 'go', value: t.title });
  const go = el('button', { class: 'btn', style: 'margin-top:14px' }, 'Rename it');

  const submit = async () => {
    const title = input.value.trim();
    if (title.length < 2) return toast('Give it a name.', 'bad');
    go.disabled = true;
    try {
      await api(`/api/threads/${encodeURIComponent(t.id)}`, { method: 'PATCH', body: { title } });
      closeSheet();
      openThread(t.id);
    } catch (e) {
      if (!handleAuthError(e)) toast(e.message, 'bad');
      go.disabled = false;
    }
  };

  go.addEventListener('click', submit);
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter') submit(); });

  openSheet(el('h2', {}, 'Rename the group'), el('label', { class: 'field' }, input), go);
  setTimeout(() => input.select(), 420);
}

/**
 * Both ways out of a conversation are one-way, so both ask first. The question
 * replaces the sheet that opened it rather than stacking a browser dialog on
 * top of the app.
 */
function endThread(t, { question, confirmLabel }) {
  const go = el('button', { class: 'btn danger', style: 'margin-top:16px' }, confirmLabel);

  go.addEventListener('click', async () => {
    go.disabled = true;
    try {
      await api(`/api/threads/${encodeURIComponent(t.id)}`, { method: 'DELETE' });
      closeSheet();
      state.thread = null;
      goBack('home');
      await loadThreads();
    } catch (e) {
      if (!handleAuthError(e)) toast(e.message, 'bad');
      go.disabled = false;
    }
  });

  openSheet(
    el('h2', {}, confirmLabel + '?'),
    el('p', { class: 'lede' }, question),
    go,
    el('button', { class: 'btn quiet', onclick: closeSheet }, 'Keep it')
  );
}

function paintMessages(all = false) {
  const list = $('#msg-list');
  const messages = state.thread?.messages || [];

  if (all) {
    list.replaceChildren(...messages.map((m, i) => messageNode(m, i, messages.length)));
  } else {
    const last = messages[messages.length - 1];
    if (last) list.append(messageNode(last, 0, 1));
  }
  requestAnimationFrame(() => { list.scrollTop = list.scrollHeight; });
}

function messageNode(m, index, total) {
  // On first paint only the last handful animate — a wall of moving text on
  // open is noise, not delight.
  const animate = total <= 1 || index >= total - 6;
  const delay = animate ? `animation-delay:${Math.max(0, index - (total - 6)) * 55}ms` : 'animation:none';

  // What the thread says about itself sits apart from what people say in it.
  if (m.kind === 'note') return el('div', { class: 'note', style: delay }, m.text);

  const group = state.thread?.kind === 'group';
  const mine = m.from === state.me.id;
  const speaker = mine ? null : state.peers.get(m.from);
  const who = mine ? 'you' : (speaker?.username || (group ? 'someone' : state.thread?.peer?.username) || 'them');

  const node = el('div', {
    // In a group each voice is tinted from its own hue; one to one, the two
    // colours already say everything.
    class: `msg ${mine ? 'mine' : group ? 'theirs' : ''}`.trim(),
    style: `${delay}${!mine && group ? `;--hue:${speaker?.hue ?? 210}` : ''}`
  }, el('div', { class: 'from' }, who));

  if (m.kind === 'voice') node.append(voiceNode(m));
  else if (m.kind === 'photo') node.append(photoNode(m));
  else node.append(el('div', { class: 'text' }, m.text));

  if (m.kind === 'photo' && m.caption) node.append(el('div', { class: 'caption' }, m.caption));

  node.append(el('div', { class: 'at' }, clockTime(m.at), seenTag(m, mine, group)));
  return node;
}

/** "seen" once it has been, and by how many when there are several of them. */
function seenTag(m, mine, group) {
  if (!mine) return null;
  const by = (m.seen_by || []).filter((id) => id !== state.me.id).length;
  if (!by) return null;
  const others = state.thread?.members?.length || 1;
  const label = group && by < others ? ` · seen by ${by}` : ' · seen';
  return el('span', { class: 'seen' }, label);
}

/**
 * A photo sits in the thread at its own shape and opens full size on a tap.
 * The box is sized from the dimensions stored with the message, so the
 * conversation doesn't lurch as pictures arrive.
 */
function photoNode(m) {
  const wide = m.width >= m.height;
  const shot = el('button', {
    class: 'shot',
    style: `aspect-ratio:${m.width} / ${m.height};${wide ? '' : 'max-width:220px;'}`,
    'aria-label': m.caption || 'Open the photo'
  }, el('img', {
    src: `${BASE}/api/photo/${m.file}`,
    alt: m.caption || 'A photo',
    loading: 'lazy'
  }));

  shot.addEventListener('click', () => openLightBox(m));
  return shot;
}

// ---------------------------------------------------------------- lightbox ---

function openLightBox(m) {
  $('#light-img').src = `${BASE}/api/photo/${m.file}`;
  $('#light-img').alt = m.caption || 'A photo';
  $('#light-cap').textContent = m.caption || '';
  $('#light-box').hidden = false;
  $('#light-box').classList.add('is-live');
}

function closeLightBox() {
  $('#light-box').classList.remove('is-live');
  $('#light-box').hidden = true;
  $('#light-img').removeAttribute('src');
}

const lightBoxOpen = () => $('#light-box').classList.contains('is-live');

$('#light-close').addEventListener('click', closeLightBox);
$('#light-box').addEventListener('click', (e) => { if (e.target.id === 'light-box') closeLightBox(); });

/** A play button and a fixed bar chart that lights up as it plays. */
function voiceNode(m) {
  const bars = Array.from({ length: 26 }, (_, i) => {
    // A deterministic shape per message, so it doesn't reshuffle on re-render.
    const seed = (m.id.charCodeAt(i % m.id.length) * (i + 3)) % 100;
    const height = 22 + (seed / 100) * 78;
    return el('i', { style: `height:${height}%` });
  });

  const audio = new Audio(`${BASE}/api/voice/${m.file}`);
  const button = el('button', { class: 'play', 'aria-label': 'Play voice note' }, icon('i-play'));
  const time = el('span', { class: 'dur' }, mmss(m.seconds));

  const setIcon = (id) => button.replaceChildren(icon(id));

  button.addEventListener('click', () => {
    if (audio.paused) { audio.play().catch(() => toast('That recording would not play.', 'bad')); }
    else audio.pause();
  });

  audio.addEventListener('play',  () => setIcon('i-pause'));
  audio.addEventListener('pause', () => setIcon('i-play'));
  audio.addEventListener('timeupdate', () => {
    const through = audio.duration ? audio.currentTime / audio.duration : 0;
    time.textContent = mmss(audio.duration ? audio.duration - audio.currentTime : m.seconds);
    bars.forEach((bar, i) => bar.classList.toggle('lit', i / bars.length <= through));
  });
  audio.addEventListener('ended', () => {
    setIcon('i-play');
    bars.forEach((bar) => bar.classList.remove('lit'));
    time.textContent = mmss(m.seconds);
  });

  return el('div', { class: 'voice' }, button, el('div', { class: 'wave' }, ...bars), time);
}

// --------------------------------------------------------------- composing ---

const say = $('#say');
const sendBtn = $('#send');

say.addEventListener('input', () => {
  say.style.height = 'auto';
  say.style.height = `${Math.min(132, say.scrollHeight)}px`;
  sendBtn.disabled = !say.value.trim();

  // Let the other side know, at most once every couple of seconds.
  if (state.thread && !state.typingTimer) {
    api(`/api/threads/${encodeURIComponent(state.thread.id)}/typing`, { method: 'POST' }).catch(() => {});
    state.typingTimer = setTimeout(() => { state.typingTimer = 0; }, 2200);
  }
});

say.addEventListener('keydown', (e) => {
  // Enter sends on a desktop keyboard; on touch it should make a new line.
  if (e.key === 'Enter' && !e.shiftKey && window.matchMedia('(min-width: 620px)').matches) {
    e.preventDefault();
    sendText();
  }
});

sendBtn.addEventListener('click', sendText);

async function sendText() {
  const text = say.value.trim();
  if (!text || !state.thread) return;

  say.value = '';
  say.style.height = 'auto';
  sendBtn.disabled = true;
  tick(8);

  try {
    await api(`/api/threads/${encodeURIComponent(state.thread.id)}/say`, { method: 'POST', body: { text } });
    // The message paints when it comes back down the feed, so both ends of the
    // conversation animate identically.
  } catch (e) {
    if (!handleAuthError(e)) { toast(e.message, 'bad'); say.value = text; sendBtn.disabled = false; }
  }
}

// ----------------------------------------------------------- photo message ---

$('#pic').addEventListener('click', async () => {
  const thread = state.thread;
  if (!thread) return;

  const shot = await openCamera({ caption: true, sendLabel: 'Send it' });
  if (!shot) return;

  tick(10);
  try {
    await api(`/api/threads/${encodeURIComponent(thread.id)}/photo`, {
      method: 'POST',
      body: { image: shot.image, width: shot.width, height: shot.height, caption: shot.caption }
    });
    // Like everything else, it paints when it comes back down the feed.
  } catch (e) {
    if (!handleAuthError(e)) toast(e.message, 'bad');
  }
});

// ----------------------------------------------------------- voice message ---

let recorder = null;
let recChunks = [];
let recStart = 0;
let recTimer = 0;
let recStream = null;

const mic = $('#mic');
mic.addEventListener('click', () => (recorder ? stopRecording(true) : startRecording()));

async function startRecording() {
  if (!state.thread) return;
  try {
    recStream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true }
    });
  } catch {
    return toast('smig needs the microphone for voice notes.', 'bad');
  }

  // Record in whatever this browser supports — Chrome gives WebM/Opus, iOS
  // Safari gives MP4/AAC. It gets re-encoded to MP3 before upload, because
  // that is the only format both of them can play back. See voice.js.
  const mime = recordingMimeType();
  recorder = new MediaRecorder(recStream, mime ? { mimeType: mime } : undefined);
  recChunks = [];
  recorder.ondataavailable = (e) => { if (e.data.size) recChunks.push(e.data); };
  recorder.onstop = finishRecording;
  recorder.start();
  recStart = Date.now();

  mic.classList.add('armed');
  tick(12);
  showRecStrip();
}

function showRecStrip() {
  const clock = el('span', { class: 't' }, '0:00');
  const strip = el('div', { class: 'rec-strip', id: 'rec-strip' },
    el('span', { class: 'dot' }),
    clock,
    el('span', { class: 'tiny', style: 'margin-left:auto' }, 'Tap the mic to send')
  );
  say.classList.add('hidden');
  sendBtn.classList.add('hidden');
  $('#composer').insertBefore(strip, mic);

  recTimer = setInterval(() => {
    const seconds = (Date.now() - recStart) / 1000;
    clock.textContent = mmss(seconds);
    if (seconds >= 60) stopRecording(true);   // the server's ceiling
  }, 200);
}

function hideRecStrip() {
  clearInterval(recTimer);
  $('#rec-strip')?.remove();
  say.classList.remove('hidden');
  sendBtn.classList.remove('hidden');
  mic.classList.remove('armed');
}

/** Swap the strip for a note that the encode is happening — it isn't instant. */
function showEncoding() {
  const strip = $('#rec-strip');
  if (!strip) return;
  strip.replaceChildren(
    el('span', { class: 'dot' }),
    el('span', { class: 't' }, 'Packing it up…')
  );
}

function stopRecording(send) {
  if (!recorder) return;
  recorder._send = send;
  recorder.stop();
  recStream?.getTracks().forEach((t) => t.stop());
}

async function finishRecording() {
  const send = recorder?._send;
  const recorded = Math.round((Date.now() - recStart) / 1000);
  const blob = new Blob(recChunks, { type: recorder?.mimeType || 'audio/webm' });
  const thread = state.thread;
  recorder = null;
  recStream = null;

  if (!send || recorded < 1 || !blob.size || !thread) return hideRecStrip();

  showEncoding();
  try {
    const { blob: mp3, seconds } = await toMp3(blob);
    hideRecStrip();

    const audio = await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result));
      reader.onerror = reject;
      reader.readAsDataURL(mp3);
    });
    await api(`/api/threads/${encodeURIComponent(thread.id)}/voice`, {
      method: 'POST', body: { audio, seconds: Math.round(seconds) || recorded }
    });
    tick([8, 30, 8]);
  } catch (e) {
    hideRecStrip();
    if (!handleAuthError(e)) toast(e.message || 'That voice note would not send.', 'bad');
  }
}

// ------------------------------------------------------------------- calls ---

const call = new Call({
  api,
  onState: paintCall,
  onLocalStream: (stream) => {
    $('#near').srcObject = stream;
    $('#self-view').classList.toggle('hidden', !call.video);
  },
  onRemoteStream: (stream) => {
    $('#far').srcObject = stream;
    $('#call-placeholder').classList.add('hidden');
  }
});

$('#th-voice').addEventListener('click', () => place(false));
$('#th-video').addEventListener('click', () => place(true));

async function place(video) {
  if (!state.thread) return;
  // Two ends to a peer connection; a group would need a mesh smig hasn't got.
  if (state.thread.kind === 'group') return toast('Groups cannot be called yet.', 'bad');
  if (!state.thread.online) return toast(`${state.thread.peer.username} isn't on smig right now.`, 'bad');
  try {
    await call.place(state.thread.id, state.thread.peer.id, video);
  } catch (e) {
    toast(e.name === 'NotAllowedError'
      ? 'smig needs the microphone to call.'
      : (e.message || 'That call would not start.'), 'bad');
    call.hangUp(false);
  }
}

function paintCall(status, detail) {
  const layer = $('#call-layer');
  const peer = state.peers.get(call.peerId) || state.thread?.peer;

  if (status === 'idle') {
    layer.classList.remove('is-live');
    $('#far').srcObject = null;
    $('#near').srcObject = null;
    $('#call-placeholder').classList.remove('hidden');
    if (detail === 'declined') toast('Call declined.', '');
    return;
  }

  layer.classList.add('is-live');
  $('#call-name').textContent = peer?.username || 'smig';
  const disc = discFor(peer, '');
  disc.id = 'call-disc';
  disc.setAttribute('style', `--hue:${peer?.hue ?? 30};width:70px;height:70px;font-size:1.5rem`);
  $('#call-disc').replaceWith(disc);
  $('#self-view').classList.toggle('hidden', !call.video || status === 'incoming');

  const label = {
    ringing:    'Ringing…',
    incoming:   call.video ? 'Video call' : 'Voice call',
    connecting: 'Connecting…',
    live:       call.video ? 'Video call' : 'Voice call',
    failed:     'Could not connect',
    declined:   'Declined',
    ended:      'Call ended'
  }[status] || '';

  $('#call-state').textContent = label;
  $('#call-sub').textContent = status === 'incoming' ? 'is calling you' : label;

  if (status === 'failed' && detail) toast(detail, 'bad');

  paintCallControls(status);
}

function paintCallControls(status) {
  const row = $('#call-controls');

  if (status === 'incoming') {
    row.replaceChildren(
      el('button', { class: 'call-btn end', 'aria-label': 'Decline', onclick: () => call.decline() }, icon('i-hang')),
      el('button', { class: 'call-btn take', 'aria-label': 'Answer', onclick: () => answer() }, icon(call.video ? 'i-video' : 'i-phone'))
    );
    return;
  }

  const muteBtn = el('button', {
    class: `call-btn ${call.muted ? 'off' : ''}`, 'aria-label': 'Mute',
    onclick: () => { const off = call.toggleMute(); muteBtn.classList.toggle('off', off); muteBtn.replaceChildren(icon(off ? 'i-mic-off' : 'i-mic')); }
  }, icon(call.muted ? 'i-mic-off' : 'i-mic'));

  const children = [muteBtn];

  if (call.video) {
    const camBtn = el('button', {
      class: `call-btn ${call.cameraOff ? 'off' : ''}`, 'aria-label': 'Camera',
      onclick: () => { const off = call.toggleCamera(); camBtn.classList.toggle('off', off); camBtn.replaceChildren(icon(off ? 'i-cam-off' : 'i-video')); }
    }, icon(call.cameraOff ? 'i-cam-off' : 'i-video'));
    children.push(camBtn);
  }

  children.push(el('button', {
    class: 'call-btn end', 'aria-label': 'Hang up', onclick: () => call.hangUp(true)
  }, icon('i-hang')));

  row.replaceChildren(...children);
}

async function answer() {
  try {
    await call.accept();
  } catch (e) {
    toast(e.name === 'NotAllowedError' ? 'smig needs the microphone to answer.' : e.message, 'bad');
    call.hangUp(true);
  }
}

// --------------------------------------------------------------- live feed ---

function openFeed() {
  closeFeed();
  const feed = new EventSource(`${BASE}/api/feed`, { withCredentials: true });
  state.feed = feed;

  feed.addEventListener('message', (e) => onMessageEvent(JSON.parse(e.data)));
  feed.addEventListener('typing', (e) => onTyping(JSON.parse(e.data)));
  feed.addEventListener('seen', (e) => onSeen(JSON.parse(e.data)));
  feed.addEventListener('presence', (e) => onPresence(JSON.parse(e.data)));
  feed.addEventListener('thread', () => loadThreads());
  feed.addEventListener('peer', (e) => onPeerChanged(JSON.parse(e.data)));
  feed.addEventListener('thread-gone', (e) => onThreadGone(JSON.parse(e.data)));
  feed.addEventListener('call', (e) => onCallEvent(JSON.parse(e.data)));

  feed.onerror = () => {
    // EventSource reconnects on its own; a closed one means the session went.
    if (feed.readyState === EventSource.CLOSED) setTimeout(() => { if (state.me) openFeed(); }, 3000);
  };
}

function closeFeed() {
  state.feed?.close();
  state.feed = null;
}

function onMessageEvent({ thread_id, message }) {
  if (state.thread?.id === thread_id) {
    state.thread.messages.push(message);
    clearTyping();
    paintMessages(false);
    if (message.from !== state.me.id) {
      tick(10);
      // Reading it here counts as seeing it.
      api(`/api/threads/${encodeURIComponent(thread_id)}`).catch(() => {});
    }
  } else {
    const row = state.threads.find((t) => t.id === thread_id);
    if (message.from !== state.me.id) tick([6, 26, 6]);
    if (row) {
      row.last = { kind: message.kind, text: message.text ?? message.caption ?? null, from: message.from };
      row.last_at = message.at;
      // A note is the thread narrating itself; it never earns a badge.
      if (message.from !== state.me.id && message.kind !== 'note') row.unread = (row.unread || 0) + 1;
      state.threads.sort((a, b) => b.last_at.localeCompare(a.last_at));
      if (currentScreen() === 'home') paintThreads();
    } else {
      loadThreads();
    }
  }
}

function onTyping({ thread_id, from, username }) {
  if (state.thread?.id !== thread_id || from === state.me.id) return;
  clearTyping();
  const node = el('div', { class: 'typing', id: 'typing' }, el('i'), el('i'), el('i'));
  // In a group, three anonymous dots aren't much use.
  if (state.thread.kind === 'group' && username) {
    node.append(el('span', { class: 'tiny', style: 'margin-left:6px' }, username));
  }
  $('#msg-list').append(node);
  $('#msg-list').scrollTop = $('#msg-list').scrollHeight;
  node._timer = setTimeout(clearTyping, 3200);
}

function clearTyping() {
  const node = $('#typing');
  if (node) { clearTimeout(node._timer); node.remove(); }
}

function onSeen({ thread_id, by }) {
  if (state.thread?.id !== thread_id) return;
  for (const m of state.thread.messages) {
    if (m.from === state.me.id && !(m.seen_by || []).includes(by)) (m.seen_by ||= []).push(by);
  }
  paintMessages(true);
}

/** Somebody changed their picture or their name — swap it in wherever it shows. */
function onPeerChanged({ peer }) {
  if (!peer) return;
  state.peers.set(peer.id, peer);

  let touched = false;
  for (const t of state.threads) {
    if (t.peer?.id === peer.id) { t.peer = { ...t.peer, ...peer }; touched = true; }
    if (t.members?.some((m) => m.id === peer.id)) {
      t.members = t.members.map((m) => (m.id === peer.id ? { ...m, ...peer } : m));
      touched = true;
    }
  }
  if (touched && currentScreen() === 'home') paintThreads();

  const open = state.thread;
  if (!open) return;
  if (open.peer?.id === peer.id) open.peer = { ...open.peer, ...peer };
  if (open.members?.some((m) => m.id === peer.id)) {
    open.members = open.members.map((m) => (m.id === peer.id ? { ...m, ...peer } : m));
  }
  paintThreadHeader();
  paintMessages(true);   // the name tag on their messages may have changed
}

function onPresence({ user_id, online }) {
  // Someone can be in several of your conversations at once, so this is not a
  // single row: every thread they are part of has to be told.
  let touched = false;
  for (const t of state.threads) {
    if (t.kind === 'group') {
      if (!t.members?.some((m) => m.id === user_id)) continue;
      t.online_count = Math.max(0, (t.online_count || 0) + (online ? 1 : -1));
      t.online = t.online_count > 0;
    } else {
      if (t.peer?.id !== user_id) continue;
      t.online = online;
      t.online_count = online ? 1 : 0;
    }
    touched = true;
  }
  if (touched && currentScreen() === 'home') paintThreads();

  const open = state.thread;
  if (open && (open.peer?.id === user_id || open.members?.some((m) => m.id === user_id))) {
    if (open.kind === 'group') {
      open.online_count = Math.max(0, (open.online_count || 0) + (online ? 1 : -1));
      open.online = open.online_count > 0;
    } else {
      open.online = online;
    }
    paintThreadHeader();
  }
}


function onThreadGone({ thread_id }) {
  state.threads = state.threads.filter((t) => t.id !== thread_id);
  if (state.thread?.id === thread_id) { state.thread = null; goBack('home'); toast('That conversation was ended.', ''); }
  paintThreads();
}

async function onCallEvent(msg) {
  if (msg.type === 'ring') {
    if (call.active) return;   // already busy; let it ring out on their end
    // Make sure we know who this is even if their thread isn't open.
    if (!state.peers.has(msg.from)) await loadThreads();
    call.arrive(msg.thread_id, msg.from, msg.video);
    tick([20, 80, 20, 80, 20]);
    return;
  }
  if (call.active) call.handle(msg).catch(() => {});
}

// --------------------------------------------------------------- lifecycle ---

// A tab left in the background can lose its feed; bring it back on return.
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && state.me && state.unlocked && !state.feed) {
    openFeed();
    loadThreads();
  }
});

// Android back / browser back closes whatever is on top before leaving.
addEventListener('popstate', () => {
  if (lightBoxOpen()) { closeLightBox(); historyGuard(); return; }
  if (cameraOpen()) { cancelCamera(); historyGuard(); return; }
  if (call.active) { call.hangUp(true); historyGuard(); return; }
  if (isSheetOpen()) { closeSheet(); historyGuard(); return; }
  if (currentScreen() === 'thread') { leaveThread(); goBack('home'); historyGuard(); }
});
function historyGuard() { history.pushState(null, '', location.href); }
historyGuard();

// ------------------------------------------------------------------- boot ---

(async function boot() {
  try {
    const { user, unlocked } = await api('/api/me');
    state.me = user;
    state.unlocked = unlocked;
    routeAfterAuth();
  } catch {
    show('splash', { replace: true });
  }
})();
