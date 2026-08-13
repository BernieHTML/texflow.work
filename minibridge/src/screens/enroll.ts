/* First open. One-time setup: the camera check, then the passcode fallback.
 *
 * Copy note: the permission ask is plainly honest about what the camera is for
 * and where the data goes. Avoiding jargon is a brand rule; being vague about a
 * camera is not, so this says exactly what happens.
 */

import { h, mount, ring } from '../lib/dom';
import { holdSmile, startCeremony, type CeremonyHandle } from '../lib/ceremony';
import { averageSignatures } from '../lib/face';
import { hashPasscode, newSalt, saveIdentity, requestPersistence } from '../lib/storage';
import { askPasscode } from './passcode';

const HOLD_MS = 1200;

export async function enroll(onDone: () => void): Promise<void> {
  const signature = await captureSignature();
  const salt = newSalt();
  const passcode = await askPasscode({
    title: 'Now pick a passcode',
    note: 'Four numbers, for when the light is bad or the camera says no.',
    confirm: true,
  });

  await saveIdentity({
    signature,
    passcodeSalt: salt,
    passcodeHash: await hashPasscode(passcode, salt),
    enrolledAt: Date.now(),
  });

  // Best-effort: ask the browser not to evict us. Safari may decline.
  await requestPersistence();

  await welcome();
  onDone();
}

/** Welcome → camera → hold a smile → averaged signature. If the camera is
 * refused we still enroll, with the passcode alone. */
function captureSignature(): Promise<number[]> {
  return new Promise((resolve) => {
    const begin = h('button', {
      class: 'btn',
      type: 'button',
      text: 'Set up Smile In',
      onclick: () => void run(),
    });

    mount(
      h(
        'section',
        { class: 'screen screen--centred' },
        h('h1', { text: 'Hello.' }),
        h('p', {
          class: 'lead',
          text: 'MiniBridge builds small things, just for you, and keeps them here in your pocket.',
        }),
        h('p', {
          text: 'To open it, you smile at it. MiniBridge checks it’s you, on this phone — the camera never records anything, and nothing ever leaves the device.',
        }),
        begin,
        h('button', {
          class: 'link',
          type: 'button',
          text: 'Use a passcode instead',
          onclick: () => resolve([]),
        }),
      ),
    );

    async function run() {
      let ceremony: CeremonyHandle | null = null;
      const progress = ring();
      const status = h('p', { text: 'Look up, and give it a smile.' });
      const lens = h('div', { class: 'lens' });

      mount(
        h(
          'section',
          { class: 'screen screen--centred' },
          h('h1', { text: 'Smile In' }),
          h('div', { class: 'stack' }, h('div', { style: { position: 'relative' } }, lens, progress.el)),
          status,
        ),
      );

      const { handle, done } = holdSmile({
        holdMs: HOLD_MS,
        onProgress: (f) => progress.set(f),
        onFace: (present) => {
          status.textContent = present
            ? 'Look up, and give it a smile.'
            : 'Bring your face into the circle.';
        },
      });

      try {
        ceremony = await startCeremony(handle);
        lens.append(ceremony.video);
      } catch {
        ceremony?.stop();
        // Denied or unavailable. Not a dead end — the passcode covers it.
        return offerPasscodeOnly();
      }

      const samples = await done;
      ceremony.stop();
      status.textContent = 'Got it.';
      resolve(averageSignatures(samples) ?? []);
    }

    function offerPasscodeOnly() {
      mount(
        h(
          'section',
          { class: 'screen screen--centred' },
          h('h1', { text: 'No camera, no problem' }),
          h('p', {
            class: 'lead',
            text: 'MiniBridge will use a passcode to let you in instead. You can switch Smile In on later.',
          }),
          h('button', {
            class: 'btn',
            type: 'button',
            text: 'Carry on',
            onclick: () => resolve([]),
          }),
        ),
      );
    }
  });
}

function welcome(): Promise<void> {
  return new Promise((resolve) => {
    mount(
      h(
        'section',
        { class: 'screen screen--centred' },
        h('h1', { text: "You're set." }),
        h('p', {
          class: 'lead',
          text: 'Tell MiniBridge what you want, and it builds it for you right here.',
        }),
        h('button', { class: 'btn', type: 'button', text: 'Come in', onclick: () => resolve() }),
      ),
    );
  });
}
