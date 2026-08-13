/* A very small DOM helper. No framework here on purpose: the shell has to load
 * fast and leave headroom for a several-hundred-megabyte model download, and
 * this app's state is shallow enough that a router plus render functions is
 * genuinely simpler than a reactive layer. */

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

export function svg(tag: string, attrs: Attrs = {}, ...children: Node[]): SVGElement {
  const el = document.createElementNS('http://www.w3.org/2000/svg', tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (value === null || value === undefined || value === false) continue;
    el.setAttribute(key, String(value));
  }
  children.forEach((c) => el.append(c));
  return el;
}

export function mount(node: Node): void {
  const app = document.getElementById('app')!;
  app.replaceChildren(node);
}

/** Relative time, in plain words. Never "2026-08-13T09:00:00Z". */
export function when(timestamp: number): string {
  const seconds = Math.max(0, (Date.now() - timestamp) / 1000);
  if (seconds < 90) return 'just now';
  const minutes = seconds / 60;
  if (minutes < 60) return `${Math.round(minutes)} min ago`;
  const hours = minutes / 60;
  if (hours < 24) return hours < 2 ? 'an hour ago' : `${Math.round(hours)} hours ago`;
  const days = hours / 24;
  if (days < 2) return 'yesterday';
  if (days < 7) return `${Math.round(days)} days ago`;
  return new Date(timestamp).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

export function prefersReducedMotion(): boolean {
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

/** A progress ring for the camera ceremony. Returns the element plus a setter
 * taking 0–1. */
export function ring(): { el: SVGElement; set: (fraction: number) => void } {
  const R = 48;
  const circumference = 2 * Math.PI * R;
  const fill = svg('circle', {
    class: 'ring__fill',
    cx: 50,
    cy: 50,
    r: R,
    'stroke-dasharray': circumference,
    'stroke-dashoffset': circumference,
  });
  const el = svg(
    'svg',
    { class: 'ring', viewBox: '0 0 100 100' },
    svg('circle', { class: 'ring__track', cx: 50, cy: 50, r: R }),
    fill,
  );
  return {
    el,
    set(fraction: number) {
      const clamped = Math.max(0, Math.min(1, fraction));
      fill.setAttribute('stroke-dashoffset', String(circumference * (1 - clamped)));
    },
  };
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
