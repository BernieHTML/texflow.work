/* The chat. This is the whole of MiniBridge now.
 *
 * Two ways to get a reply, in this order:
 *
 *   on the device  - the resident model. Nothing leaves the phone. Streams, so
 *                    the bubble fills in as it thinks.
 *   the cloud      - only if switched on. Doesn't stream (see lib/cloud.ts),
 *                    but survives the phone locking, and is the only path that
 *                    can reach you once it has.
 *
 * The rule that shapes this file: NEVER do something heavy without being asked,
 * and never twice in a row after it went wrong. A phone that dies loading a
 * model, reloads, and loads it again is what produces Safari's "A problem
 * repeatedly occurred" — the page never gets far enough to be fixed from
 * inside. So the model is brought up on a tap, or on a return where the last
 * attempt is known to have gone fine, and never otherwise.
 */

import { h, mount, prefersReducedMotion, softProgress } from '../lib/dom';
import {
  alreadyDownloaded,
  chat,
  describeTier,
  deviceSupported,
  install,
  state as engineState,
  tierFor,
  type Turn,
} from '../lib/engine';
import { askCloud, capabilities, type Capabilities } from '../lib/cloud';
import { isStandalone, notifyLocally, pushStatus, pushSupported, type PushStatus } from '../lib/notify';
import { loadChat, loadPrefs, saveChat, savePrefs, type ChatMessage, type Prefs } from '../lib/storage';
import { showSettings } from './settings';

const OPENERS = [
  'what’s on your mind…',
  'ask me something…',
  'say anything…',
  'what are you wondering…',
];

interface Session {
  messages: ChatMessage[];
  prefs: Prefs;
  caps: Capabilities;
  push: PushStatus;
  /** Something worth explaining from last time, in plain words. */
  notice?: string;
  /** The last attempt took the page down, so the model is NOT brought up until
   * the person asks for it. This is the crash-loop guard. */
  holdBack: boolean;
  /** Bringing it back from the cache threw. Distinct from 'waking' — nothing is
   * in flight — and the UI has to offer a way forward rather than a spinner. */
  wakeFailed: boolean;
  nudgeDismissed: boolean;
}

let session: Session;
let inFlight: AbortController | null = null;

export interface ChatOptions {
  notice?: string;
  holdBack?: boolean;
}

export async function showChat(options: ChatOptions = {}): Promise<void> {
  session = {
    messages: loadChat(),
    prefs: loadPrefs(),
    caps: { cloud: false, push: false, vapidPublicKey: null },
    push: 'unsupported',
    notice: options.notice,
    holdBack: options.holdBack ?? false,
    wakeFailed: false,
    nudgeDismissed: false,
  };

  // Paint immediately. Everything below is either a network call or a
  // permission check, and none of it should stand between opening the app and
  // seeing the conversation.
  alreadyDownloaded();
  render();

  session.caps = await capabilities();
  session.push = await pushStatus();
  render();

  void wake();
}

/** Bring the model back from the device's cache. No download on a return visit,
 * but loading onto the GPU is not instant — and is the single most likely
 * moment for a phone to die, which is why holdBack exists. */
async function wake(): Promise<void> {
  if (session.holdBack) return;
  if (engineState() !== 'waking') return;
  try {
    await install(() => {});
    session.wakeFailed = false;
  } catch {
    // Couldn't wake it — most often the browser evicted the weights under
    // storage pressure. The download is deliberately NOT forgotten: that would
    // send someone back to several hundred megabytes over one bad load.
    //
    // But this MUST be recorded, because engineState() still reports 'waking'
    // — nothing is loading and nothing ever will on this page — and without it
    // the composer sits on "Just a moment…" for ever with no way out.
    session.wakeFailed = true;
  }
  render();
}

/* ---- Rendering ---------------------------------------------------------- */

let transcriptEl: HTMLElement | null = null;

function render(): void {
  const transcript = h('div', { class: 'talk' });
  transcriptEl = transcript;

  if (session.messages.length === 0) {
    transcript.append(
      h(
        'div',
        { class: 'talk__empty' },
        h('p', { text: 'Nothing said yet. Whatever you say stays on this phone.' }),
      ),
    );
  }
  for (const message of session.messages) transcript.append(bubble(message));

  mount(
    h(
      'section',
      { class: 'screen chat' },
      h(
        'header',
        { class: 'chat__head' },
        h('h1', { class: 'chat__title', text: 'MiniBridge' }),
        h('button', {
          class: 'icon-btn',
          type: 'button',
          text: '⋯',
          'aria-label': 'Settings',
          onclick: openSettings,
        }),
      ),
      session.notice && h('p', { class: 'notice', text: session.notice }),
      transcript,
      nudge(),
      composer(),
    ),
  );

  toBottom('auto');
}

function bubble(message: ChatMessage): HTMLElement {
  const mine = message.role === 'user';
  const said = h('div', { class: `said said--${mine ? 'mine' : 'theirs'}` });

  // Paragraphs rather than one block: a small model's answers run together
  // otherwise. textContent throughout — nothing a model writes is ever parsed
  // as markup here.
  for (const para of message.content.split(/\n{2,}/)) {
    if (para.trim()) said.append(h('p', { class: 'said__p', text: para.trim() }));
  }
  if (!said.childNodes.length) said.append(h('p', { class: 'said__p', text: message.content }));

  if (message.via === 'cloud') {
    said.append(h('span', { class: 'said__via', text: 'answered in the cloud' }));
  }
  return said;
}

function liveBubble(): { el: HTMLElement; set: (text: string) => void } {
  const body = h('p', { class: 'said__p' });
  const el = h('div', { class: 'said said--theirs said--live' }, body);
  return {
    el,
    set(text) {
      body.textContent = text;
      toBottom('smooth');
    },
  };
}

function toBottom(behavior: ScrollBehavior): void {
  if (!transcriptEl) return;
  transcriptEl.scrollTo({
    top: transcriptEl.scrollHeight,
    behavior: prefersReducedMotion() ? 'auto' : behavior,
  });
}

/* ---- The composer ------------------------------------------------------- */

type Route = 'device' | 'cloud' | 'stalled' | 'setup' | 'resume' | 'nothing';

function canAnswer(): Route {
  if (engineState() === 'ready') return 'device';
  if (session.prefs.cloud && session.caps.cloud) return 'cloud';
  // Checked before 'waking' below: a failed wake leaves engineState() reporting
  // 'waking' with nothing actually in flight, and a spinner for that is a lie.
  if (session.wakeFailed) return 'stalled';
  // Held back after a crash, or waiting on a load we haven't started.
  if (session.holdBack && alreadyDownloaded()) return 'resume';
  if (engineState() === 'waking') return 'setup';
  if (deviceSupported()) return 'setup';
  return 'nothing';
}

function composer(): HTMLElement {
  const route = canAnswer();
  if (route !== 'device' && route !== 'cloud') return standIn(route);

  const field = h('textarea', {
    class: 'magic__field',
    rows: 1,
    placeholder: OPENERS[Math.floor(Math.random() * OPENERS.length)],
    'aria-label': 'Say something',
    enterkeyhint: 'send',
  });

  // One at a time. A second while the first is still coming would share the
  // model's single context and interleave two answers into one bubble.
  if (inFlight) {
    return h(
      'div',
      { class: 'magic magic--composer magic--busy' },
      h('p', { class: 'magic__hint', text: 'Thinking…' }),
      h(
        'div',
        { class: 'magic__foot' },
        h('span', {}),
        h('button', {
          class: 'magic__go',
          type: 'button',
          text: 'Stop',
          onclick: () => inFlight?.abort(),
        }),
      ),
    );
  }

  const go = h('button', { class: 'magic__go', type: 'button', text: 'Send', disabled: true });

  const hint =
    route === 'cloud'
      ? 'Answering in the cloud.'
      : session.prefs.cloud && session.caps.cloud
        ? 'On this phone, cloud if it stumbles.'
        : 'On this phone.';

  const box = h(
    'div',
    { class: 'magic magic--composer' },
    field,
    h('div', { class: 'magic__foot' }, h('span', { class: 'magic__hint', text: hint }), go),
  );

  const submit = () => {
    const text = field.value.trim();
    if (!text || inFlight) return;
    field.value = '';
    field.style.height = 'auto';
    go.disabled = true;
    box.classList.remove('magic--typing');
    void send(text);
  };

  field.addEventListener('input', () => {
    go.disabled = field.value.trim().length === 0;
    box.classList.toggle('magic--typing', field.value.length > 0);
    field.style.height = 'auto';
    field.style.height = `${field.scrollHeight}px`;
  });

  field.addEventListener('keydown', (event) => {
    const e = event as KeyboardEvent;
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      submit();
    }
  });

  go.addEventListener('click', submit);
  return box;
}

/** What sits where the composer would, when nothing can answer yet. */
function standIn(route: Route): HTMLElement {
  if (route === 'nothing') {
    return h(
      'div',
      { class: 'magic' },
      h('p', { class: 'lead', text: 'This phone can’t talk on its own.' }),
      h('p', {
        class: 'fine',
        text: 'It needs a newer version of its browser to run a model here. Switch on the cloud backup and MiniBridge will answer that way instead.',
      }),
      h(
        'div',
        { style: { marginTop: 'var(--sp-3)' } },
        h('button', { class: 'btn', type: 'button', text: 'Settings', onclick: openSettings }),
      ),
    );
  }

  // It was here, and it wouldn't start. Usually the browser reclaimed the
  // weights under storage pressure, in which case tapping fetches them again.
  if (route === 'stalled') {
    const box = actionBox({
      lead: 'That didn’t start.',
      fine: 'What MiniBridge needs to talk seems to have gone missing from this phone — that happens when it runs short of room. Bringing it over again usually sorts it.',
      label: 'Try again',
    });
    box.append(
      h('p', {
        class: 'fine',
        style: { marginTop: 'var(--sp-2)' },
        text: 'If it keeps happening, Settings has a smaller size and the cloud backup.',
      }),
    );
    return box;
  }

  // Already downloaded, deliberately not started. The person taps to begin,
  // which is the whole point: a crash can't repeat if nothing happens on its own.
  if (route === 'resume') {
    return actionBox({
      lead: 'Ready when you are.',
      fine: `Everything’s already here — MiniBridge just won’t start it by itself after last time. Now using ${describeTier(
        tierFor(),
      )}.`,
      label: 'Start talking',
    });
  }

  if (engineState() === 'waking' && !session.holdBack) {
    const progress = softProgress();
    progress.set(null);
    return h(
      'div',
      { class: 'magic' },
      h('p', { class: 'lead', text: 'Just a moment…' }),
      h('div', { style: { marginTop: 'var(--sp-3)' } }, progress.el),
    );
  }

  return actionBox({
    lead: 'First, a one-time setup.',
    fine: 'MiniBridge needs to bring one thing over so it can talk without ever going online again. It only happens once. Best done on wi-fi.',
    label: 'Bring it over',
  });
}

function actionBox(copy: { lead: string; fine: string; label: string }): HTMLElement {
  const button = h('button', { class: 'btn', type: 'button', text: copy.label });
  const box = h(
    'div',
    { class: 'magic' },
    h('p', { class: 'lead', text: copy.lead }),
    h('p', { class: 'fine', text: copy.fine }),
    h('div', { style: { marginTop: 'var(--sp-3)' } }, button),
  );

  button.addEventListener('click', () => {
    const progress = softProgress();
    progress.set(0);
    box.replaceChildren(
      h('p', { class: 'lead', text: 'Getting ready, just for you…' }),
      h('div', { style: { marginTop: 'var(--sp-3)' } }, progress.el),
      h('p', { class: 'fine', text: 'You can leave this open and come back.' }),
    );

    // The tap is the consent. From here on a crash is caught at the next boot.
    session.holdBack = false;
    session.wakeFailed = false;
    session.notice = undefined;

    void install((fraction) => progress.set(fraction))
      .then(() => render())
      .catch(() => {
        box.replaceChildren(
          h('p', { class: 'lead', text: 'That didn’t finish.' }),
          h('p', {
            class: 'fine',
            text: 'Something interrupted it. Check you’re on wi-fi and give it another go.',
          }),
          h('div', { style: { marginTop: 'var(--sp-3)' } }, standIn('setup')),
        );
      });
  });

  return box;
}

/* ---- The notifications offer -------------------------------------------- */

function nudge(): HTMLElement | false {
  if (session.nudgeDismissed) return false;
  if (!session.messages.some((m) => m.role === 'assistant')) return false;
  if (!session.caps.push) return false;
  if (session.push === 'on' || session.push === 'denied') return false;

  // iOS only has Web Push for an app on the Home Screen. In a Safari tab there
  // is no PushManager at all, so offering the switch would be a lie.
  if (!pushSupported() || !isStandalone()) {
    if (!isStandalone() && /iphone|ipad/i.test(navigator.userAgent)) {
      return h('p', {
        class: 'notice',
        text: 'Want MiniBridge to tell you when a reply lands? Add it to your Home Screen first — Share, then Add to Home Screen — and the option appears here.',
      });
    }
    return false;
  }

  return h(
    'div',
    { class: 'notice notice--offer' },
    h('span', { text: 'Want a nudge on your phone when a reply lands while you’re elsewhere?' }),
    h(
      'span',
      { class: 'notice__actions' },
      h('button', {
        class: 'btn btn--well',
        type: 'button',
        text: 'Yes, notify me',
        onclick: openSettings,
      }),
      h('button', {
        class: 'link',
        type: 'button',
        text: 'Not now',
        onclick: () => {
          session.nudgeDismissed = true;
          render();
        },
      }),
    ),
  );
}

/* ---- Sending ------------------------------------------------------------ */

function turns(): Turn[] {
  return session.messages.map((m) => ({ role: m.role, content: m.content }));
}

function remember(message: ChatMessage): void {
  session.messages.push(message);
  saveChat(session.messages);
}

async function send(text: string): Promise<void> {
  const controller = new AbortController();
  inFlight = controller;

  remember({ id: crypto.randomUUID(), role: 'user', content: text, at: Date.now() });
  session.notice = undefined;
  render();

  const live = liveBubble();
  transcriptEl?.append(live.el);
  live.set('…');
  toBottom('smooth');

  // Whether the person is watching decides whether the server should push the
  // cloud's answer at us.
  const awayAtSend = document.hidden;

  try {
    const route = canAnswer();
    const reply =
      route === 'cloud'
        ? await viaCloud(controller, awayAtSend)
        : await viaDevice(live.set, controller, awayAtSend);

    remember(reply);
    inFlight = null;
    render();

    // Only when they've actually gone. Notifying someone about something
    // already on the screen in front of them is noise.
    if (document.hidden) await notifyLocally(reply.content);
  } catch (err) {
    inFlight = null;
    render();
    if ((err as Error).name !== 'AbortError') failed((err as Error).message);
  }
}

async function viaDevice(
  onToken: (text: string) => void,
  controller: AbortController,
  awayAtSend: boolean,
): Promise<ChatMessage> {
  try {
    const content = await chat(turns(), onToken, controller.signal);
    return { id: crypto.randomUUID(), role: 'assistant', content, at: Date.now(), via: 'device' };
  } catch (err) {
    if ((err as Error).name === 'AbortError') throw err;
    // The device tried and couldn't. That is what the backup is for — but only
    // if the person said it could be used.
    if (!session.prefs.cloud || !session.caps.cloud) throw err;
    onToken('…');
    return viaCloud(controller, awayAtSend);
  }
}

async function viaCloud(controller: AbortController, awayAtSend: boolean): Promise<ChatMessage> {
  const content = await askCloud({
    turns: turns(),
    deviceId: session.prefs.deviceId,
    // Only ask for a push when we already know nobody's looking. Otherwise the
    // server pushes on its own if this connection dies — which is what a phone
    // going into a pocket looks like from its end.
    notify: session.prefs.notify && session.push === 'on' && awayAtSend,
    signal: controller.signal,
  });
  return { id: crypto.randomUUID(), role: 'assistant', content, at: Date.now(), via: 'cloud' };
}

function failed(reason: string): void {
  const message =
    reason === 'no-cloud'
      ? 'The cloud backup isn’t switched on for this MiniBridge, so there was nowhere else to ask.'
      : reason === 'cloud-failed'
        ? 'The cloud didn’t answer that one. Give it another go.'
        : reason === 'not-ready'
          ? 'MiniBridge isn’t ready to talk yet.'
          : 'That one didn’t come out. Try asking again.';

  transcriptEl?.append(h('p', { class: 'talk__trouble', text: message }));
  toBottom('smooth');
}

/* Note on leaving mid-reply: nothing here aborts when the tab hides, and that
 * is deliberate. Walking away is the whole reason the notification exists. The
 * on-device model freezes with the page and picks up where it left off; the
 * cloud finishes regardless and notifies. */

function openSettings(): void {
  void showSettings({
    prefs: session.prefs,
    caps: session.caps,
    onChange: (prefs) => {
      session.prefs = prefs;
      savePrefs(prefs);
    },
    onBack: () => void showChat(),
  });
}
