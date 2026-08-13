/* Settings: manage Bridges, redo Smile In, reset the passcode, see how much
 * room things take, and clear the installed magic.
 */

import { h, mount, when } from '../lib/dom';
import {
  clearIdentity,
  deleteBridge,
  describeSize,
  listBridges,
  loadIdentity,
  storageUsage,
  type BridgeRecord,
} from '../lib/storage';
import { alreadyInstalled, uninstall } from '../lib/engine';

export async function showSettings(onBack: () => void): Promise<void> {
  const bridges = await listBridges();
  const usage = await storageUsage();
  const installed = await alreadyInstalled();
  const identity = await loadIdentity();

  const rows = h('div', { class: 'rows' });

  for (const bridge of bridges) {
    rows.append(bridgeRow(bridge, () => void showSettings(onBack)));
  }
  if (!bridges.length) {
    rows.append(h('p', { class: 'fine', text: 'No Bridges yet.' }));
  }

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
          onclick: onBack,
        }),
      ),

      h('p', { class: 'section-title', text: 'Your Bridges' }),
      rows,

      h('p', { class: 'section-title', text: 'Smile In' }),
      h(
        'div',
        { class: 'rows' },
        h(
          'div',
          { class: 'row' },
          h(
            'div',
            { class: 'row__label' },
            h('span', { class: 'row__name', text: 'Redo Smile In' }),
            h('span', {
              class: 'fine',
              text: identity?.signature.length
                ? 'Take a fresh look at you.'
                : 'Not set up — you’re using the passcode.',
            }),
          ),
          h('button', {
            class: 'btn btn--well',
            type: 'button',
            text: 'Redo',
            onclick: async () => {
              await clearIdentity();
              location.reload();
            },
          }),
        ),
        h(
          'div',
          { class: 'row' },
          h(
            'div',
            { class: 'row__label' },
            h('span', { class: 'row__name', text: 'Passcode' }),
            h('span', { class: 'fine', text: 'Set a new four-number passcode.' }),
          ),
          h('button', {
            class: 'btn btn--well',
            type: 'button',
            text: 'Change',
            onclick: async () => {
              // Redoing setup covers both, and keeps one path rather than two.
              await clearIdentity();
              location.reload();
            },
          }),
        ),
      ),
      // Honest about what Smile In is, in the product's own voice. It is a
      // personal gesture, not a security boundary — see face.ts.
      h('p', {
        class: 'fine',
        style: { marginTop: 'var(--sp-2)' },
        text: 'Smile In is a friendly way to open MiniBridge, not a lock. Someone holding a photo of you could get past it, so keep anything genuinely private somewhere else.',
      }),

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
        installed &&
          h(
            'div',
            { class: 'row' },
            h(
              'div',
              { class: 'row__label' },
              h('span', { class: 'row__name', text: 'The magic' }),
              h('span', { class: 'fine', text: 'Clearing it frees the most room. You can bring it back later.' }),
            ),
            h('button', {
              class: 'btn btn--well',
              type: 'button',
              text: 'Clear',
              onclick: async (event: Event) => {
                const button = event.currentTarget as HTMLButtonElement;
                button.disabled = true;
                button.textContent = 'Clearing…';
                await uninstall();
                location.reload();
              },
            }),
          ),
      ),

      h('div', { class: 'spacer' }),
      h('p', {
        class: 'fine',
        text: 'Everything here stays on this phone. Nothing you build or say is ever sent anywhere.',
      }),
    ),
  );
}

function bridgeRow(bridge: BridgeRecord, refresh: () => void): HTMLElement {
  return h(
    'div',
    { class: 'row' },
    h(
      'div',
      { class: 'row__label' },
      h('span', { class: 'row__name', text: bridge.name }),
      h('span', { class: 'fine', text: when(bridge.createdAt) }),
    ),
    h('button', {
      class: 'btn btn--well',
      type: 'button',
      text: 'Delete',
      onclick: async (event: Event) => {
        const button = event.currentTarget as HTMLButtonElement;
        if (button.dataset.sure !== 'yes') {
          button.dataset.sure = 'yes';
          button.textContent = 'Sure?';
          return;
        }
        await deleteBridge(bridge.id);
        refresh();
      },
    }),
  );
}
