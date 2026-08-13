/* The passcode fallback.
 *
 * This is not optional and never can be: cameras get denied, lighting goes bad,
 * and Smile In is a fuzzy geometric match that will sometimes just not
 * cooperate. Nobody should ever be locked out of their own Bridges by a bad
 * frame.
 */

import { h, mount } from '../lib/dom';

const LENGTH = 4;

export interface PasscodeOptions {
  title: string;
  note?: string;
  /** Ask twice and require a match. Used when setting a new passcode. */
  confirm?: boolean;
  /** Return true to accept. Omitted when setting a new one. */
  check?: (passcode: string) => Promise<boolean>;
  /** Rendered as a quiet escape hatch, if given. */
  escape?: { label: string; onPick: () => void };
}

/** Runs the passcode UI to completion and resolves with the accepted code. */
export function askPasscode(opts: PasscodeOptions): Promise<string> {
  return new Promise((resolve) => {
    let entered = '';
    let first: string | null = null;
    let busy = false;

    const pins = h('div', { class: 'pins' });
    const heading = h('h1', { text: opts.title });
    const note = h('p', { class: 'fine', text: opts.note ?? '' });

    const paint = () => {
      pins.replaceChildren(
        ...Array.from({ length: LENGTH }, (_, i) =>
          h('div', { class: `pin${i < entered.length ? ' pin--set' : ''}` }),
        ),
      );
    };

    const reject = (message: string) => {
      entered = '';
      paint();
      note.textContent = message;
      pins.classList.remove('shake');
      // Reflow so the animation can restart.
      void pins.offsetWidth;
      pins.classList.add('shake');
    };

    const submit = async () => {
      const code = entered;
      busy = true;

      if (opts.confirm && first === null) {
        first = code;
        entered = '';
        busy = false;
        paint();
        heading.textContent = 'Once more, to be sure';
        note.textContent = '';
        return;
      }

      if (opts.confirm && first !== null) {
        if (code !== first) {
          first = null;
          heading.textContent = opts.title;
          busy = false;
          reject("Those didn't match. Try again.");
          return;
        }
        resolve(code);
        return;
      }

      const ok = opts.check ? await opts.check(code) : true;
      busy = false;
      if (ok) resolve(code);
      else reject("That's not it. Try again.");
    };

    const press = (digit: string) => {
      if (busy || entered.length >= LENGTH) return;
      entered += digit;
      paint();
      if (entered.length === LENGTH) void submit();
    };

    const back = () => {
      if (busy) return;
      entered = entered.slice(0, -1);
      paint();
    };

    const keys = ['1', '2', '3', '4', '5', '6', '7', '8', '9'].map((d) =>
      h('button', { class: 'key', type: 'button', onclick: () => press(d), text: d }),
    );

    const keypad = h(
      'div',
      { class: 'keypad' },
      ...keys,
      h('div', { class: 'key key--blank' }),
      h('button', { class: 'key', type: 'button', onclick: () => press('0'), text: '0' }),
      h('button', {
        class: 'key',
        type: 'button',
        onclick: back,
        text: '←',
        'aria-label': 'Delete',
      }),
    );

    paint();

    mount(
      h(
        'section',
        { class: 'screen screen--centred' },
        heading,
        note,
        pins,
        keypad,
        opts.escape &&
          h('button', {
            class: 'link',
            type: 'button',
            text: opts.escape.label,
            onclick: opts.escape.onPick,
          }),
      ),
    );
  });
}
