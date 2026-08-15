/* Home: your Bridges, with the magic box at the centre.
 *
 * Naming note for anyone reading the code: "the magic box" is the product name
 * for the input, and it is the only name used in the UI. It is deliberately not
 * a chat — one description in, one thing built, no conversation history.
 */

import { h, mount, prefersReducedMotion, softProgress, when } from '../lib/dom';
import { build, deviceSupported, install, state as engineState } from '../lib/engine';
import {
  clearPendingBuild,
  listBridges,
  markBuildStarted,
  saveBridge,
  type BridgeRecord,
} from '../lib/storage';
import { openBridge } from './bridge';
import { showSettings } from './settings';

const PLACEHOLDERS = [
  'a timer for the pasta…',
  'something to split the bill…',
  'a list I can tick off…',
  'a dice roller for game night…',
  'somewhere to jot the shopping…',
];

export interface HomeState {
  bridges: BridgeRecord[];
  /** Id of a Bridge that just arrived, so it can play its moment once. */
  arriving?: string;
  /** Something happened last time worth explaining, in plain words. */
  notice?: string;
}

export async function showHome(state: HomeState = { bridges: [] }): Promise<void> {
  const bridges = state.bridges.length ? state.bridges : await listBridges();
  render({ ...state, bridges });
}

function render(state: HomeState): void {
  const grid = h('ul', { class: 'grid' });

  if (state.bridges.length === 0) {
    grid.append(
      h(
        'li',
        { class: 'empty' },
        h('p', { text: 'Nothing here yet. Ask for something above and it’ll appear.' }),
      ),
    );
  }

  for (const bridge of state.bridges) {
    const arriving = bridge.id === state.arriving;
    grid.append(
      h(
        'li',
        {},
        h(
          'button',
          {
            class: `tile${arriving && !prefersReducedMotion() ? ' tile--arriving' : ''}`,
            type: 'button',
            onclick: () => openBridge(bridge, () => void showHome()),
          },
          h('span', { class: 'tile__name', text: bridge.name }),
          h('span', { class: 'tile__when', text: when(bridge.createdAt) }),
        ),
      ),
    );
  }

  mount(
    h(
      'section',
      { class: 'screen home' },
      h(
        'header',
        { class: 'home__head' },
        h('h1', { text: 'Your Bridges' }),
        h('button', {
          class: 'icon-btn',
          type: 'button',
          text: '⋯',
          'aria-label': 'Settings',
          onclick: () => void showSettings(() => void showHome()),
        }),
      ),
      state.notice && h('p', { class: 'notice', text: state.notice }),
      magicBox(state),
      grid,
    ),
  );
}

/** The magic box. The product's signature moment. */
function magicBox(state: HomeState): HTMLElement {
  // Three states, not two. A device that already has the magic and is bringing
  // it back must NOT be shown the setup button — that reads as "install it
  // again" and is the bug that made returning visits feel broken.
  const phase = engineState();
  if (phase === 'waking') return waking();
  if (phase === 'absent') return installer(state);

  const field = h('textarea', {
    class: 'magic__field',
    rows: 2,
    placeholder: PLACEHOLDERS[Math.floor(Math.random() * PLACEHOLDERS.length)],
    'aria-label': 'Describe what you want',
    enterkeyhint: 'go',
  });

  const go = h('button', {
    class: 'magic__go',
    type: 'button',
    text: 'Build',
    disabled: true,
  });

  const box = h(
    'div',
    { class: 'magic' },
    field,
    h(
      'div',
      { class: 'magic__foot' },
      h('span', { class: 'magic__hint', text: 'One thing at a time.' }),
      go,
    ),
  );

  const submit = () => {
    const request = field.value.trim();
    if (!request) return;
    // iOS Safari has no Vibration API, so the "sent" feedback is motion only.
    box.classList.add('magic--sent');
    setTimeout(() => void buildBridge(request, state), 260);
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

/** Already installed, just coming back. Deliberately says nothing about
 * setting anything up — there is nothing for the person to do here. */
function waking(): HTMLElement {
  const progress = softProgress();
  progress.set(null);
  return h(
    'div',
    { class: 'magic' },
    h('p', { class: 'lead', text: 'Just a moment…' }),
    h('div', { style: { marginTop: 'var(--sp-3)' } }, progress.el),
  );
}

/** "Install the magic" — the one-time setup, in the magic box's place. */
function installer(state: HomeState): HTMLElement {
  if (!deviceSupported()) {
    return h(
      'div',
      { class: 'magic' },
      h('p', { class: 'lead', text: 'This phone isn’t quite ready for MiniBridge.' }),
      h('p', {
        class: 'fine',
        text: 'It needs a newer version of its browser to build things on its own. Everything you’ve already made is safe here.',
      }),
    );
  }

  const button = h('button', { class: 'btn', type: 'button', text: 'Install the magic' });
  const box = h(
    'div',
    { class: 'magic' },
    h('p', { class: 'lead', text: 'First, a one-time setup.' }),
    h('p', {
      class: 'fine',
      text: 'MiniBridge needs to bring a few things over so it can build without ever going online again. Best done on wi-fi.',
    }),
    h('div', { style: { marginTop: 'var(--sp-3)' } }, button),
  );

  button.addEventListener('click', () => {
    const progress = softProgress();
    progress.set(0);
    const note = h('p', { class: 'lead', text: 'Getting ready, just for you…' });
    box.replaceChildren(
      note,
      h('div', { style: { marginTop: 'var(--sp-3)' } }, progress.el),
      h('p', { class: 'fine', text: 'You can leave this open and come back.' }),
    );

    void install((fraction) => progress.set(fraction))
      .then(() => {
        note.textContent = 'All set.';
        void showHome(state);
      })
      .catch(() => {
        box.replaceChildren(
          h('p', { class: 'lead', text: 'That didn’t finish.' }),
          h('p', {
            class: 'fine',
            text: 'Something interrupted the setup. Check you’re on wi-fi and give it another go.',
          }),
          h('div', { style: { marginTop: 'var(--sp-3)' } }, installer(state)),
        );
      });
  });

  return box;
}

/* ---- Building --------------------------------------------------------- */

async function buildBridge(request: string, state: HomeState): Promise<void> {
  const progress = softProgress();
  progress.set(null);
  const status = h('p', { class: 'lead', text: 'Making it…' });
  const controller = new AbortController();

  mount(
    h(
      'section',
      { class: 'screen screen--centred' },
      h('p', { class: 'fine', text: 'You asked for' }),
      h(
        'p',
        {
          class: 'lead',
          style: { fontFamily: 'var(--font-voice)' },
          text: request,
        },
      ),
      progress.el,
      status,
      h('button', {
        class: 'link',
        type: 'button',
        text: 'Never mind',
        onclick: () => {
          controller.abort();
          void showHome(state);
        },
      }),
    ),
  );

  // The model streams, so we can move the bar honestly against the length of
  // what's arrived rather than inventing a fake percentage. 6k characters is a
  // rough ceiling for a small self-contained page.
  const onToken = (soFar: string) => {
    progress.set(Math.min(0.95, soFar.length / 6000));
  };

  // Leave a note before the heavy part. If the page dies here there is no
  // exception to catch — the note at next boot is the only evidence.
  await markBuildStarted(request);

  try {
    const result = await build(request, onToken, controller.signal);
    await clearPendingBuild();
    const record: BridgeRecord = {
      id: crypto.randomUUID(),
      name: result.name,
      request,
      createdAt: Date.now(),
      html: result.html,
    };
    await saveBridge(record);
    progress.set(1);

    // Let it land on Home first — the arrival is the moment — then open it, so
    // you actually get to use the thing you just asked for instead of hunting
    // for it among the tiles.
    const bridges = await listBridges();
    await showHome({ bridges, arriving: record.id });

    const settle = prefersReducedMotion() ? 0 : 900;
    setTimeout(() => openBridge(record, () => void showHome({ bridges })), settle);
  } catch (err) {
    // Survived the failure, so it wasn't a crash — tear the note up.
    await clearPendingBuild();
    if ((err as Error).name === 'AbortError') return;
    failed(request, state, (err as Error).message);
  }
}

function failed(request: string, state: HomeState, reason: string): void {
  // Errors explain what happened and what to do next. No stack traces, ever.
  const message =
    reason === 'unusable-output'
      ? 'It came out muddled this time. Trying again usually sorts it — or describe it a little differently.'
      : 'Something got in the way while making that. Give it another go.';

  mount(
    h(
      'section',
      { class: 'screen screen--centred' },
      h('h1', { text: 'That one didn’t come out.' }),
      h('p', { class: 'lead', text: message }),
      h('button', {
        class: 'btn',
        type: 'button',
        text: 'Try again',
        onclick: () => void buildBridge(request, state),
      }),
      h('button', {
        class: 'link',
        type: 'button',
        text: 'Back to your Bridges',
        onclick: () => void showHome(state),
      }),
    ),
  );
}
