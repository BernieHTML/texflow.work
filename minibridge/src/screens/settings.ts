/* Settings.
 *
 * Two of these switches are unlike anything else in MiniBridge: they are the
 * only things that let something leave the phone. So this screen is written to
 * be read, not skimmed — each says plainly what changes, before it is turned on
 * rather than after.
 */

import { h, mount } from '../lib/dom';
import {
  alreadyDownloaded,
  chooseTier,
  describeTier,
  deviceProfile,
  deviceSupported,
  tierFor,
  uninstall,
} from '../lib/engine';
import type { Capabilities } from '../lib/cloud';
import {
  disablePush,
  enablePush,
  isStandalone,
  pushStatus,
  pushSupported,
  testPush,
  type PushStatus,
} from '../lib/notify';
import {
  clearChat,
  describeSize,
  loadChat,
  storageUsage,
  type Prefs,
  type Tier,
} from '../lib/storage';

export interface SettingsOptions {
  prefs: Prefs;
  caps: Capabilities;
  onChange: (prefs: Prefs) => void;
  onBack: () => void;
}

/** Save a change AND update the copy this screen re-renders from.
 *
 * Both halves matter. `options` is the same object across the re-render below,
 * so without the first line a toggle saves correctly and then redraws itself in
 * the state it was just moved out of — the switch appears to do nothing. */
function change(options: SettingsOptions, next: Prefs): void {
  options.prefs = next;
  options.onChange(next);
}

export async function showSettings(options: SettingsOptions): Promise<void> {
  const status = await pushStatus();
  const usage = await storageUsage();
  const messages = loadChat();
  const downloaded = alreadyDownloaded();
  const profile = deviceProfile();

  mount(
    h(
      'section',
      { class: 'screen' },
      h(
        'header',
        { class: 'home__head' },
        h('h1', { text: 'Settings' }),
        h('button', {
          class: 'icon-btn',
          type: 'button',
          text: '×',
          'aria-label': 'Back',
          onclick: options.onBack,
        }),
      ),

      h('p', { class: 'section-title', text: 'Notifications' }),
      notifyRows(options, status),

      h('p', { class: 'section-title', text: 'The cloud backup' }),
      cloudRows(options),

      h('p', { class: 'section-title', text: 'How it talks' }),
      modelRows(downloaded, profile),

      h('p', { class: 'section-title', text: 'Room' }),
      h(
        'div',
        { class: 'rows' },
        h(
          'div',
          { class: 'row' },
          h(
            'div',
            { class: 'row__label' },
            h('span', { class: 'row__name', text: 'Space used' }),
            h('span', {
              class: 'fine',
              text: usage
                ? `${describeSize(usage.usedBytes)} on this phone`
                : 'Not something this phone will say.',
            }),
          ),
        ),
        h(
          'div',
          { class: 'row' },
          h(
            'div',
            { class: 'row__label' },
            h('span', { class: 'row__name', text: 'This conversation' }),
            h('span', {
              class: 'fine',
              text: messages.length
                ? `${messages.length} message${messages.length === 1 ? '' : 's'}, kept here.`
                : 'Nothing said yet.',
            }),
          ),
          messages.length > 0 &&
            confirmButton('Clear', () => {
              clearChat();
              options.onBack();
            }),
        ),
      ),

      h('div', { class: 'spacer' }),
      h('p', {
        class: 'fine',
        text: options.prefs.cloud
          ? 'With the backup on, a message MiniBridge can’t answer here is sent to a server to be answered there. Nothing is kept: the reply comes back and it’s gone.'
          : 'As things stand, nothing you say here ever leaves this phone.',
      }),
    ),
  );
}

/* ---- Notifications ------------------------------------------------------
 *
 * On iOS this needs the app on the Home Screen, and permission has to come from
 * a real tap. Both are things this screen says out loud, because from the
 * outside a switch that quietly does nothing looks like a bug in MiniBridge
 * rather than a rule of the platform.
 */

function notifyRows(options: SettingsOptions, status: PushStatus): HTMLElement {
  const refresh = () => void showSettings(options);

  if (!options.caps.push || !options.caps.vapidPublicKey) {
    return note('This MiniBridge isn’t set up to send notifications.');
  }
  if (/iphone|ipad/i.test(navigator.userAgent) && !isStandalone()) {
    return note(
      'Add MiniBridge to your Home Screen first — tap Share, then Add to Home Screen. iPhones only allow notifications for apps kept there, not for pages in the browser.',
    );
  }
  if (!pushSupported()) {
    return note('This phone’s browser can’t send notifications. Everything else still works.');
  }
  if (status === 'denied') {
    return note(
      'Notifications are switched off for MiniBridge. Only the phone’s own Settings can turn them back on — MiniBridge isn’t allowed to ask twice.',
    );
  }

  const on = status === 'on' && options.prefs.notify;

  return h(
    'div',
    { class: 'rows' },
    h(
      'div',
      { class: 'row' },
      h(
        'div',
        { class: 'row__label' },
        h('span', { class: 'row__name', text: 'Tell me when a reply lands' }),
        h('span', {
          class: 'fine',
          text: on
            ? 'On. You’ll get a nudge when you’re somewhere else.'
            : 'Off. Replies wait quietly for you to come back.',
        }),
      ),
      h('button', {
        class: 'btn btn--well',
        type: 'button',
        text: on ? 'Turn off' : 'Turn on',
        onclick: async (event: Event) => {
          const button = event.currentTarget as HTMLButtonElement;
          button.disabled = true;
          button.textContent = on ? 'Turning off…' : 'Asking…';

          if (on) {
            await disablePush(options.prefs.deviceId);
            change(options, { ...options.prefs, notify: false });
          } else {
            // Must happen inside this tap. Asking on load gets a permanent no.
            const result = await enablePush(
              options.prefs.deviceId,
              options.caps.vapidPublicKey as string,
            );
            change(options, { ...options.prefs, notify: result === 'on' });
          }
          refresh();
        },
      }),
    ),
    on &&
      h(
        'div',
        { class: 'row' },
        h(
          'div',
          { class: 'row__label' },
          h('span', { class: 'row__name', text: 'Send a test' }),
          h('span', { class: 'fine', text: 'Make sure one actually reaches you.' }),
        ),
        h('button', {
          class: 'btn btn--well',
          type: 'button',
          text: 'Send',
          onclick: async (event: Event) => {
            const button = event.currentTarget as HTMLButtonElement;
            button.disabled = true;
            button.textContent = 'Sending…';
            const sent = await testPush(options.prefs.deviceId);
            button.textContent = sent ? 'On its way' : 'Didn’t send';
          },
        }),
      ),
    on &&
      note(
        'A reply that arrives while MiniBridge is closed comes from the cloud backup — the model on this phone pauses when you leave and picks up when you return.',
      ),
  );
}

/* ---- The cloud backup --------------------------------------------------- */

function cloudRows(options: SettingsOptions): HTMLElement {
  if (!options.caps.cloud) {
    return note('This MiniBridge has no cloud backup configured, so everything happens here.');
  }

  return h(
    'div',
    { class: 'rows' },
    h(
      'div',
      { class: 'row' },
      h(
        'div',
        { class: 'row__label' },
        h('span', { class: 'row__name', text: 'Answer in the cloud when needed' }),
        h('span', {
          class: 'fine',
          text: options.prefs.cloud
            ? 'On. Used when this phone can’t answer, and marked on every reply that came that way.'
            : 'Off. Everything is answered here, or not at all.',
        }),
      ),
      h('button', {
        class: 'btn btn--well',
        type: 'button',
        text: options.prefs.cloud ? 'Turn off' : 'Turn on',
        onclick: () => {
          change(options, { ...options.prefs, cloud: !options.prefs.cloud });
          void showSettings(options);
        },
      }),
    ),
    !options.prefs.cloud &&
      note(
        'Turning this on means the messages it handles are sent to texflow.work and passed to a model there. They aren’t stored, but they do leave the phone — which is the one thing MiniBridge otherwise never does.',
      ),
  );
}

/* ---- The model ----------------------------------------------------------
 *
 * A size picker, because the automatic guess cannot be right for every phone
 * and the failure mode is the page dying. Someone who has been stepped down
 * automatically can climb back up here; someone whose phone is struggling can
 * go down before it crashes rather than after.
 */

function modelRows(
  downloaded: boolean,
  profile: { tier: Tier; crashes: number },
): HTMLElement {
  if (!deviceSupported()) {
    return note(
      'This phone can’t run a model itself — it needs a newer browser. The cloud backup above is the way to use MiniBridge here.',
    );
  }

  const current = tierFor();
  const sizes: Tier[] = ['tiny', 'pocket', 'full'];

  return h(
    'div',
    { class: 'rows' },
    ...sizes.map((tier) =>
      h(
        'div',
        { class: `row${tier === current ? ' row--on' : ''}` },
        h(
          'div',
          { class: 'row__label' },
          h('span', { class: 'row__name', text: sentence(describeTier(tier)) }),
          h('span', { class: 'fine', text: sizeNote(tier) }),
        ),
        tier === current
          ? h('span', { class: 'fine', text: 'In use' })
          : confirmButton('Use', async () => {
              // Changing size means the old weights are dead cache — and on a
              // phone that is the largest thing on it.
              if (downloaded) await uninstall();
              chooseTier(tier);
              location.reload();
            }),
      ),
    ),
    profile.crashes > 0 &&
      note(
        `MiniBridge has had to step down ${profile.crashes === 1 ? 'once' : `${profile.crashes} times`} on this phone after a reply took the page down. Going back up may do it again.`,
      ),
    downloaded &&
      h(
        'div',
        { class: 'rows' },
        h(
          'div',
          { class: 'row' },
          h(
            'div',
            { class: 'row__label' },
            h('span', { class: 'row__name', text: 'Clear what’s downloaded' }),
            h('span', {
              class: 'fine',
              text: 'Frees the most room by far. You can bring it back later.',
            }),
          ),
          confirmButton('Clear', async () => {
            await uninstall();
            location.reload();
          }),
        ),
      ),
  );
}

function sizeNote(tier: Tier): string {
  if (tier === 'tiny') return 'Smallest and quickest. Simple answers, runs on nearly anything.';
  if (tier === 'pocket') return 'The default on phones. Holds a proper conversation.';
  return 'Best answers, and the heaviest. Really meant for a computer.';
}

function sentence(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/* ---- Bits --------------------------------------------------------------- */

function note(text: string): HTMLElement {
  return h('p', { class: 'fine', style: { marginTop: 'var(--sp-2)' }, text });
}

/** Tap once to arm, once to mean it. A modal would be heavier than the thing
 * it's guarding. */
function confirmButton(label: string, run: () => void | Promise<void>): HTMLElement {
  return h('button', {
    class: 'btn btn--well',
    type: 'button',
    text: label,
    onclick: async (event: Event) => {
      const button = event.currentTarget as HTMLButtonElement;
      if (button.dataset.sure !== 'yes') {
        button.dataset.sure = 'yes';
        button.textContent = 'Sure?';
        return;
      }
      button.disabled = true;
      button.textContent = 'Working…';
      await run();
    },
  });
}
