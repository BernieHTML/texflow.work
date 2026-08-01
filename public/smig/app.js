// smig — the app itself. Wires the screens to the API, the face engine and the
// call layer, and keeps one SSE feed open for everything that arrives.

import {
  $, $$, el, icon, show, goBack, resetHistory, currentScreen,
  toast, openSheet, closeSheet, isSheetOpen,
  initial, clockTime, ago, mmss, tick
} from './ui.js';
import * as face from './face.js';
import { Call } from './call.js';

const BASE = '/smig';

const state = {
  me: null,
  unlocked: false,
  threads: [],
  thread: null,      // the open conversation
  peers: new Map(),  // user id → peer view, for call UI
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
    startFace(state.me.hasFace ? 'unlock' : 'enrol');
  } catch (e) {
    if (!handleAuthError(e)) toast(e.message, 'bad');
  } finally {
    button.disabled = false;
  }
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
    threads.forEach((t) => state.peers.set(t.peer.id, t.peer));
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

  list.replaceChildren(...state.threads.map((t, i) => {
    const preview = t.last
      ? (t.last.kind === 'voice' ? 'Voice note' : t.last.text || '')
      : (t.peer.fact || 'Say something');

    return el('button', {
      class: 'thread-row',
      style: `--i:${i}`,
      onclick: () => openThread(t.id)
    },
      el('div', { class: `disc ${t.online ? 'on' : ''}`, style: `--hue:${t.peer.hue}` }, initial(t.peer.username)),
      el('div', { class: 'body' },
        el('div', { class: 'name' }, t.peer.username),
        el('div', { class: `prev ${t.unread ? 'unseen' : ''}` },
          `${t.last && t.last.from === state.me.id ? 'You: ' : ''}${preview}`)
      ),
      t.unread ? el('div', { class: 'pip' }, String(t.unread)) : el('div', { class: 'tiny' }, ago(t.last_at))
    );
  }));
}

// ------------------------------------------------------------ add + share ---

$('#home-add').addEventListener('click', () => {
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
});

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
    state.thread = { id, peer: data.peer, messages: data.messages, online: data.online };
    state.peers.set(data.peer.id, data.peer);
    $('#th-name').textContent = data.peer.username;
    setPeerState(data.online);
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

function setPeerState(online) {
  const node = $('#th-state');
  node.textContent = online ? 'here now' : 'away';
  node.classList.toggle('live', Boolean(online));
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
  const mine = m.from === state.me.id;
  const who = mine ? 'you' : (state.thread?.peer?.username || 'them');

  // On first paint only the last handful animate — a wall of moving text on
  // open is noise, not delight.
  const animate = total <= 1 || index >= total - 6;

  const node = el('div', {
    class: `msg ${mine ? 'mine' : ''}`,
    style: animate ? `animation-delay:${Math.max(0, index - (total - 6)) * 55}ms` : 'animation:none'
  }, el('div', { class: 'from' }, who));

  if (m.kind === 'voice') node.append(voiceNode(m));
  else node.append(el('div', { class: 'text' }, m.text));

  const seen = mine && (m.seen_by || []).some((id) => id !== state.me.id);
  node.append(el('div', { class: 'at' },
    clockTime(m.at),
    seen ? el('span', { class: 'seen' }, ' · seen') : null
  ));

  return node;
}

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

  // Opus at a low rate: a minute lands around 120 kB, well inside the upload cap.
  const mime = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4']
    .find((t) => MediaRecorder.isTypeSupported(t));
  recorder = new MediaRecorder(recStream, mime ? { mimeType: mime, audioBitsPerSecond: 24000 } : undefined);
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

function stopRecording(send) {
  if (!recorder) return;
  recorder._send = send;
  recorder.stop();
  recStream?.getTracks().forEach((t) => t.stop());
}

async function finishRecording() {
  const send = recorder?._send;
  const seconds = Math.round((Date.now() - recStart) / 1000);
  const blob = new Blob(recChunks, { type: recorder?.mimeType || 'audio/webm' });
  recorder = null;
  recStream = null;
  hideRecStrip();

  if (!send || seconds < 1 || !blob.size) return;

  try {
    const audio = await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result));
      reader.onerror = reject;
      reader.readAsDataURL(blob);
    });
    await api(`/api/threads/${encodeURIComponent(state.thread.id)}/voice`, {
      method: 'POST', body: { audio, seconds }
    });
    tick([8, 30, 8]);
  } catch (e) {
    if (!handleAuthError(e)) toast(e.message, 'bad');
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
  $('#call-disc').textContent = initial(peer?.username);
  $('#call-disc').style.setProperty('--hue', peer?.hue ?? 30);
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
      row.last = { kind: message.kind, text: message.text ?? null, from: message.from };
      row.last_at = message.at;
      if (message.from !== state.me.id) row.unread = (row.unread || 0) + 1;
      state.threads.sort((a, b) => b.last_at.localeCompare(a.last_at));
      if (currentScreen() === 'home') paintThreads();
    } else {
      loadThreads();
    }
  }
}

function onTyping({ thread_id, from }) {
  if (state.thread?.id !== thread_id || from === state.me.id) return;
  clearTyping();
  const node = el('div', { class: 'typing', id: 'typing' }, el('i'), el('i'), el('i'));
  $('#msg-list').append(node);
  $('#msg-list').scrollTop = $('#msg-list').scrollHeight;
  node._timer = setTimeout(clearTyping, 3200);
}

function clearTyping() {
  const node = $('#typing');
  if (node) { clearTimeout(node._timer); node.remove(); }
}

function onSeen({ thread_id }) {
  if (state.thread?.id !== thread_id) return;
  for (const m of state.thread.messages) {
    if (m.from === state.me.id && !(m.seen_by || []).includes('peer')) (m.seen_by ||= []).push('peer');
  }
  paintMessages(true);
}

function onPresence({ user_id, online }) {
  const row = state.threads.find((t) => t.peer.id === user_id);
  if (row) { row.online = online; if (currentScreen() === 'home') paintThreads(); }
  if (state.thread?.peer.id === user_id) { state.thread.online = online; setPeerState(online); }
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
