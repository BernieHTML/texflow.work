/* MiniBridge entry point.
 *
 * Flow: enrolled? -> Smile In -> Home. Everything after that is on-device.
 */

import './styles/tokens.css';
import './styles/app.css';

import { h, mount } from './lib/dom';
import { loadIdentity, storageAvailable } from './lib/storage';
import { alreadyInstalled, install } from './lib/engine';
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
  await showHome();

  // If the magic was installed in an earlier session it's already cached, so
  // bring it back quietly in the background — the person shouldn't have to ask
  // twice. Home re-renders itself once it's ready.
  if (await alreadyInstalled()) {
    install(() => {})
      .then(() => void showHome())
      .catch(() => {
        // Nothing to say here: Home still works, and the magic box will offer
        // the install again on the next visit.
      });
  }
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
