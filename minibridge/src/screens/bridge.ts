/* Running a Bridge.
 *
 * The generated HTML is dropped into an iframe with sandbox="allow-scripts" and
 * nothing else. Crucially we do NOT grant allow-same-origin: combined with
 * allow-scripts that pair would hand the Bridge a same-origin document, and it
 * could then reach straight into this app's OPFS — the face signature, every
 * other Bridge — and rewrite them. Without it the frame gets an opaque origin
 * and is walled off from everything of ours.
 *
 * srcdoc rather than a blob URL keeps the content out of the network layer and
 * out of any cache.
 */

import { h, mount, prefersReducedMotion } from '../lib/dom';
import type { BridgeRecord } from '../lib/storage';

export function openBridge(bridge: BridgeRecord, onClose: () => void): void {
  const frame = h('iframe', {
    class: 'stage__frame',
    // Deliberately minimal. Add nothing here without a specific reason.
    sandbox: 'allow-scripts',
    srcdoc: bridge.html,
    title: bridge.name,
    allow: '', // no camera, no microphone, no geolocation.
  });

  const stage = h(
    'div',
    { class: 'stage' },
    h(
      'div',
      { class: 'stage__bar' },
      h('button', {
        class: 'icon-btn',
        type: 'button',
        text: '←',
        'aria-label': 'Back to your Bridges',
        onclick: close,
      }),
      h('span', { class: 'stage__name', text: bridge.name }),
    ),
    frame,
  );

  function close(): void {
    if (prefersReducedMotion()) {
      stage.remove();
      onClose();
      return;
    }
    stage.classList.add('stage--closing');
    stage.addEventListener(
      'animationend',
      () => {
        stage.remove();
        onClose();
      },
      { once: true },
    );
  }

  mount(stage);
}
