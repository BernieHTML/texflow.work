/* MiniBridge.
 *
 * A chat with a model on your own phone, and a nudge when it answers.
 *
 * No gate, no enrolment, no camera. It opens straight into the conversation —
 * this is a utility, and there is nothing here worth guarding that isn't
 * already behind the phone's own lock screen.
 *
 * The one job this file has beyond mounting the chat: read the breadcrumb.
 * Everything about recovering from a crash depends on it, and it has to happen
 * before anything heavy is allowed to start.
 */

import './styles/tokens.css';
import './styles/app.css';
import './styles/chat.css';

import { stepDown } from './lib/engine';
import { forgiveOnLeaving, takeBreadcrumb } from './lib/storage';
import { showChat } from './screens/chat';

async function boot(): Promise<void> {
  // A breadcrumb still here means the last attempt took the whole page down.
  // The browser killed us — there was no exception to catch and no unload
  // event, so this is the only evidence it happened.
  const died = takeBreadcrumb();

  // Read first, then start forgiving. From here on, leaving the page in the
  // ordinary way clears the breadcrumb rather than looking like a crash — see
  // forgiveOnLeaving() for why that distinction is the whole ballgame.
  forgiveOnLeaving();

  if (!died) {
    await showChat();
    return;
  }

  // Step down a size, and — the important part — do NOT bring the model up on
  // this load. Reloading into the same heavy thing is exactly what produces
  // Safari's "A problem repeatedly occurred": the page never survives long
  // enough to be fixed from inside. The person taps when they're ready.
  const smaller = await stepDown();

  const notice = smaller
    ? died === 'loading'
      ? 'Starting up was too much for this phone last time, so MiniBridge has switched to a smaller way of talking. It needs to bring that over once.'
      : 'That last reply was too much for this phone, so MiniBridge has switched to a smaller way of talking. It needs to bring that over once.'
    : 'That was too much for this phone, and MiniBridge is already as small as it goes. The cloud backup in Settings will answer without using the phone at all.';

  await showChat({ notice, holdBack: true });
}

void boot();

// The service worker caches the shell so MiniBridge opens without a network,
// and is what receives a push when a reply lands while you're away.
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/minibridge/sw.js', { scope: '/minibridge/' }).catch(() => {
      // Offline support is a bonus. Notifications are not: without a worker
      // there is nothing to receive a push, and Settings says so rather than
      // offering a switch that can't work.
    });
  });
}
