// Turning root-absolute links into relative ones is what lets this site answer
// at two addresses at once: berniehtml.github.io/texflow.work/ while the domain
// still points at the old host, and texflow.work once it does not. A link that
// starts with "/" means the server root, which on Pages is the user site, not
// this project — so every one of them has to be rewritten against the page that
// holds it.

import { posix } from 'path';

// Paths that are not ours to rewrite: another origin, a data URI, an anchor,
// a protocol-relative URL, or a template expression we cannot resolve here.
const FOREIGN = /^(?:[a-z][a-z0-9+.-]*:|\/\/|#|\?)/i;

export function isRewritable(value) {
  return typeof value === 'string' && value.startsWith('/') && !FOREIGN.test(value);
}

// `from` is the directory of the page doing the linking, as a site-root-relative
// path ('' for the root, 'f/cards' for public/f/cards/index.html).
export function toRelative(target, from) {
  if (!isRewritable(target)) return target;

  const [bare, tail] = splitTail(target);
  const dir = from === '' ? '.' : from;
  let rel = posix.relative('/' + dir, bare) || '.';

  // A link to the directory the page already sits in reads better as './' than
  // as the bare '.' posix.relative hands back.
  if (rel === '.') rel = bare.endsWith('/') ? './' : './';
  else if (bare.endsWith('/') && !rel.endsWith('/')) rel += '/';

  return rel + tail;
}

// Keeps ?query and #fragment out of the path arithmetic.
function splitTail(value) {
  const cut = value.search(/[?#]/);
  return cut === -1 ? [value, ''] : [value.slice(0, cut), value.slice(cut)];
}

// The depth of a page's directory, for callers that want to build a prefix
// themselves rather than resolve one link at a time.
export function prefixFor(from) {
  if (!from) return './';
  return '../'.repeat(from.split('/').filter(Boolean).length);
}
