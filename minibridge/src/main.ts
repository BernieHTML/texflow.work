/* MiniBridge entry point.
 *
 * Flow: enrolled? -> Smile In -> Home. Everything after that is on-device.
 */

import './styles/tokens.css';
import './styles/app.css';

import { h, mount } from './lib/dom';
import { loadIdentity, storageAvailable, takePendingBuild } from './lib/storage';
import { alreadyInstalled, forgetMagic, install, stepDownAfterCrash } from './lib/engine';
import { enroll } from './screens/enroll';
import { unlock } from './screens/unlock';
import { showHome } from './screens/home';

async function boot(): Promise<void> {
  if (!storageAvailable()) {
    mount(
      h(
        'section',
        { class: 'screen screen--centred' },
        h('h1', { text: 'This phone isn’t quite ready.' }),
        h('p', {
          class: 'lead',
          text: 'MiniBridge needs somewhere on the device to keep your things, and this browser won’t give it one. A newer browser should sort it.',
        }),
      ),
    );
    return;
  }

  const identity = await loadIdentity();

  if (!identity) {
    await enroll(() => void afterUnlock());
    return;
  }

  await unlock(identity, () => void afterUnlock());
}

async function afterUnlock(): Promise<void> {
  // A note left over from last time means the previous build took the page down
  // with it — the browser ran out of memory and killed us mid-build, which
  // looks from the outside like the app simply resetting to the start.
  const crashed = await takePendingBuild();
  let notice: string | undefined;

  if (crashed) {
    const steppedDown = await stepDownAfterCrash();
    notice = steppedDown
      ? 'Making that was too much for this phone, so MiniBridge has switched to a lighter way of building. It needs to bring that over once, then you’re back in business.'
      : 'That one was too much for this phone and MiniBridge had to start over. Try asking for something a little simpler.';
  }

  // Ask BEFORE the first render. alreadyInstalled() sets the engine's state to
  // 'waking', which is what stops Home from offering the one-time setup to
  // someone who already did it.
  const installed = await alreadyInstalled();

  await showHome({ bridges: [], notice });
  if (!installed) return;

  // Bring it back from the local cache. No download, but loading a model of
  // this size onto the GPU is not instant, so Home shows "Just a moment…" until
  // it lands rather than an install button.
  install(() => {})
    .then(() => void showHome())
    .catch(() => {
      // Couldn't wake it — most likely the browser evicted the weights under
      // storage pressure. Clear the marker so the magic box offers the setup
      // again properly, instead of sitting on "Just a moment…" forever.
      void forgetMagic().then(() => void showHome());
    });
}

void boot();

// The service worker caches the app shell so MiniBridge opens without a
// network. Model weights are cached separately by web-llm itself.
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/minibridge/sw.js', { scope: '/minibridge/' }).catch(() => {
      // Offline support is a bonus, not a requirement to run.
    });
  });
}
