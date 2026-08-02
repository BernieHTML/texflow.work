// Small shared UI pieces: screens, toasts, the bottom sheet, and the couple of
// formatting helpers everything else needs.

export const $  = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

export function el(tag, props = {}, ...kids) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (k === 'class') node.className = v;
    else if (k === 'html') node.innerHTML = v;
    else if (k === 'style') node.setAttribute('style', v);
    else if (k.startsWith('on')) node.addEventListener(k.slice(2).toLowerCase(), v);
    else if (v !== null && v !== undefined) node.setAttribute(k, v);
  }
  for (const kid of kids.flat()) {
    if (kid === null || kid === undefined || kid === false) continue;
    node.append(kid.nodeType ? kid : document.createTextNode(String(kid)));
  }
  return node;
}

/**
 * An <svg> pointing at one of the sprites defined in index.html.
 * SVG needs createElementNS — el() above would give back an unknown HTML
 * element that renders nothing.
 */
export function icon(id, attrs = {}) {
  const NS = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(NS, 'svg');
  const use = document.createElementNS(NS, 'use');
  use.setAttribute('href', `#${id}`);
  svg.append(use);
  for (const [k, v] of Object.entries(attrs)) svg.setAttribute(k, v);
  return svg;
}

// ------------------------------------------------------------------ screens ---

const history = [];
let current = null;

/**
 * Show a screen. Screens cross-fade rather than cut, and the outgoing one is
 * kept visible for the length of the transition so nothing blinks.
 */
export function show(name, { back = false, replace = false } = {}) {
  if (current === name) return;
  const next = document.querySelector(`[data-screen="${name}"]`);
  if (!next) return;

  const prev = current ? document.querySelector(`[data-screen="${current}"]`) : null;
  if (prev) {
    prev.classList.remove('is-live');
    prev.classList.toggle('is-leaving-back', back);
    setTimeout(() => prev.classList.remove('is-leaving-back'), 400);
  }

  // Re-running the stagger needs the animation to be re-applied from zero.
  next.classList.remove('is-live');
  void next.offsetWidth;
  next.classList.add('is-live');

  if (current && !replace && !back) history.push(current);
  if (back) history.pop();
  current = name;
  document.dispatchEvent(new CustomEvent('screen', { detail: name }));
}

export const currentScreen = () => current;

export function goBack(fallback = 'home') {
  const to = history.length ? history[history.length - 1] : fallback;
  show(to, { back: true });
}

/** Clears the stack — used after signing in or out. */
export function resetHistory() {
  history.length = 0;
}

// ------------------------------------------------------------------- toasts ---

export function toast(message, kind = '') {
  const node = el('div', { class: `toast ${kind}`.trim() }, message);
  $('#toasts').append(node);
  setTimeout(() => {
    node.classList.add('out');
    setTimeout(() => node.remove(), 320);
  }, kind === 'bad' ? 3600 : 2400);
  return node;
}

// -------------------------------------------------------------------- sheet ---

let sheetOpen = false;

export function openSheet(...content) {
  const back = $('#sheet-back');
  const sheet = $('#sheet');
  // Callers build sheets conditionally, so a skipped row arrives as null —
  // replaceChildren would happily render that as the word "null".
  sheet.replaceChildren(el('div', { class: 'grabber' }), ...content.filter(Boolean));
  back.classList.add('is-live');
  sheetOpen = true;
  return closeSheet;
}

export function closeSheet() {
  $('#sheet-back').classList.remove('is-live');
  sheetOpen = false;
}

export const isSheetOpen = () => sheetOpen;

$('#sheet-back')?.addEventListener('click', (e) => {
  if (e.target.id === 'sheet-back') closeSheet();
});

// --------------------------------------------------------------- formatting ---

export function initial(name) {
  return (String(name || '?').trim()[0] || '?').toUpperCase();
}

export function clockTime(iso) {
  const d = new Date(iso);
  return d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}

/** "now", "4m", "yesterday" — short enough for a list row. */
export function ago(iso) {
  const then = new Date(iso).getTime();
  const mins = Math.floor((Date.now() - then) / 60000);
  if (mins < 1) return 'now';
  if (mins < 60) return `${mins}m`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  if (days === 1) return 'yesterday';
  if (days < 7) return `${days}d`;
  return new Date(iso).toLocaleDateString([], { day: 'numeric', month: 'short' });
}

export function mmss(seconds) {
  const s = Math.max(0, Math.round(seconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

// ------------------------------------------------------------------ haptics ---

/** A very short tick where the platform supports it. Purely decorative. */
export function tick(pattern = 8) {
  try { navigator.vibrate?.(pattern); } catch { /* not supported */ }
}
