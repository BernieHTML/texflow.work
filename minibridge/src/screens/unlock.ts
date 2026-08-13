/* Smile In — every open after the first.
 *
 * This happens on every single launch, so it has to feel like a greeting rather
 * than a gate. One try, one retry, then the passcode. Never a loop.
 */

import { h, mount, ring } from '../lib/dom';
import { holdSmile, startCeremony, type CeremonyHandle } from '../lib/ceremony';
import { averageSignatures, matches } from '../lib/face';
import { verifyPasscode, type Identity } from '../lib/storage';
import { askPasscode } from './passcode';

const HOLD_MS = 900; // shorter than enrolment — this is a greeting, not a form.
const MAX_TRIES = 2;

export async function unlock(identity: Identity, onDone: () => void): Promise<void> {
  // Enrolled with the passcode only, so don't pretend to look at them.
  if (identity.signature.length === 0) {
    await passcode(identity);
    onDone();
    return;
  }

  for (let attempt = 1; attempt <= MAX_TRIES; attempt++) {
    const outcome = await attemptSmile(identity, attempt);
    if (outcome === 'ok') {
      onDone();
      return;
    }
    if (outcome === 'no-camera') break;
  }

  await passcode(identity);
  onDone();
}

type Outcome = 'ok' | 'no-match' | 'no-camera';

function attemptSmile(identity: Identity, attempt: number): Promise<Outcome> {
  return new Promise((resolve) => {
    void (async () => {
      let ceremony: CeremonyHandle | null = null;
      const progress = ring();
      const lens = h('div', { class: 'lens' });
      const status = h('p', {
        text: attempt === 1 ? 'Welcome back.' : 'Once more — chin up, a bit more light.',
      });

      mount(
        h(
          'section',
          { class: 'screen screen--centred' },
          h('div', { class: 'stack' }, h('div', { style: { position: 'relative' } }, lens, progress.el)),
          status,
        ),
      );

      const { handle, done } = holdSmile({
        holdMs: HOLD_MS,
        onProgress: (f) => progress.set(f),
        onFace: (present) => {
          if (present) return;
          status.textContent = 'Bring your face into the circle.';
        },
      });

      try {
        ceremony = await startCeremony(handle);
        lens.append(ceremony.video);
      } catch {
        ceremony?.stop();
        resolve('no-camera');
        return;
      }

      const samples = await done;
      ceremony.stop();

      const candidate = averageSignatures(samples);
      if (candidate && matches(candidate, identity.signature)) {
        status.textContent = 'There you are.';
        resolve('ok');
      } else {
        resolve('no-match');
      }
    })();
  });
}

async function passcode(identity: Identity): Promise<void> {
  await askPasscode({
    title: 'Your passcode',
    note: 'Smile In couldn’t be sure it was you.',
    check: (code) => verifyPasscode(code, identity),
  });
}
