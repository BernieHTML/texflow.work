/* A very small DOM helper. No framework here on purpose: the shell has to load
 * fast and leave headroom for a several-hundred-megabyte model download, and
 * this app's state is shallow enough that render functions are genuinely
 * simpler than a reactive layer. */

type Attrs = Record<string, unknown>;
type Child = Node | string | null | undefined | false;

export function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs: Attrs = {},
  ...children: Child[]
): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (value === null || value === undefined || value === false) continue;
    if (key === 'class') el.className = String(value);
    else if (key === 'text') el.textContent = String(value);
    else if (key.startsWith('on') && typeof value === 'function') {
      el.addEventListener(key.slice(2).toLowerCase(), value as EventListener);
    } else if (key === 'style' && typeof value === 'object') {
      Object.assign(el.style, value);
    } else if (value === true) el.setAttribute(key, '');
    else el.setAttribute(key, String(value));
  }
  for (const child of children.flat()) {
    if (child === null || child === undefined || child === false) continue;
    el.append(typeof child === 'string' ? document.createTextNode(child) : child);
  }
  return el;
}

export function mount(node: Node): void {
  const app = document.getElementById('app')!;
  app.replaceChildren(node);
}

export function prefersReducedMotion(): boolean {
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

/** A soft progress bar. `set(null)` switches it to the indeterminate drift. */
export function softProgress(): { el: HTMLElement; set: (fraction: number | null) => void } {
  const fill = h('div', { class: 'soft-progress__fill' });
  const el = h('div', { class: 'soft-progress' }, fill);
  return {
    el,
    set(fraction) {
      if (fraction === null) {
        el.classList.add('soft-progress--drift');
        return;
      }
      el.classList.remove('soft-progress--drift');
      fill.style.width = `${Math.max(0, Math.min(1, fraction)) * 100}%`;
    },
  };
}
