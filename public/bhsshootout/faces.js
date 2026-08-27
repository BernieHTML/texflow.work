/* Player portraits.
 *
 * Nobody at Blaxland is having their actual face put in a game, so every player
 * gets a drawn one instead. They are built from the same handful of parts — head,
 * hair, brows, eyes, nose, mouth — and made distinct by a fixed table of choices
 * rather than by a random seed, so a player looks the same in every menu, on
 * every phone, forever.
 */

const KIT = { body: '#15427a', trim: '#f2c14e' };
const KEEPER_KIT = { body: '#b7e14b', trim: '#1d2a12' };

const LOOKS = {
  isky:    { skin: '#f0c8a0', hair: '#2b1a12', style: 'swoop',  brow: 'straight', mouth: 'grin',  band: '#f2c14e' },
  maclean: { skin: '#f5d2b0', hair: '#b4692f', style: 'curls',  brow: 'arched',   mouth: 'smile' },
  badel:   { skin: '#a9703f', hair: '#171012', style: 'buzz',   brow: 'thick',    mouth: 'flat'  },
  blaikie: { skin: '#f6d8bd', hair: '#dfb45c', style: 'mid',    brow: 'straight', mouth: 'smile' },
  dyke:    { skin: '#eec39a', hair: '#3d2a1c', style: 'spikes', brow: 'arched',   mouth: 'grin'  },
  faucet:  { skin: '#f7ddc4', hair: '#8a5a3a', style: 'mullet', brow: 'worried',  mouth: 'oh', ears: 'big' },
  foot:    { skin: '#d9a173', hair: '#241a14', style: 'buzz',   brow: 'thick',    mouth: 'flat', keeper: true }
};

const HAIR = {
  buzz: (c) => `<path d="M26 44c0-16 10-25 24-25s24 9 24 25c0-6-8-11-24-11s-24 5-24 11z" fill="${c}"/>`,
  mid: (c) => `<path d="M24 46c-1-19 10-29 26-29s27 10 26 29c-2-9-4-13-8-15-6 4-13 5-20 3-6-2-9-4-11-7-6 3-11 8-13 19z" fill="${c}"/>`,
  swoop: (c) => `<path d="M24 45c-2-20 10-30 26-30 12 0 21 6 25 15-8-3-14 1-22 4-9 3-17 1-22-1-4 3-6 7-7 12z" fill="${c}"/>
    <path d="M70 22c8 4 9 14 6 22-1-9-5-15-11-18z" fill="${c}"/>`,
  spikes: (c) => `<path d="M25 45c-1-14 6-24 15-27l2 7 5-9 5 8 5-8 4 9 5-6c8 4 12 14 11 26-3-10-9-14-26-14s-23 4-26 14z" fill="${c}"/>`,
  curls: (c) => `<g fill="${c}"><circle cx="34" cy="30" r="9"/><circle cx="48" cy="23" r="10"/><circle cx="63" cy="27" r="9.5"/><circle cx="72" cy="38" r="8"/><circle cx="27" cy="41" r="8"/></g>`,
  mullet: (c) => `<path d="M25 46c-1-18 10-28 25-28s26 10 25 28c-3-10-7-13-11-14-7 3-16 4-24 1-6 4-12 5-15 13z" fill="${c}"/>
    <path d="M23 44c-3 12-2 22 1 30 3-9 4-19 3-30zM77 44c3 12 2 22-1 30-3-9-4-19-3-30z" fill="${c}"/>`
};

const BROWS = {
  straight: (c) => `<rect x="33" y="47" width="13" height="3.2" rx="1.6" fill="${c}"/><rect x="54" y="47" width="13" height="3.2" rx="1.6" fill="${c}"/>`,
  arched: (c) => `<path d="M33 49q6-5 13-1" stroke="${c}" stroke-width="3.2" fill="none" stroke-linecap="round"/><path d="M54 48q7-4 13 1" stroke="${c}" stroke-width="3.2" fill="none" stroke-linecap="round"/>`,
  thick: (c) => `<rect x="32" y="46" width="15" height="4.5" rx="2.2" fill="${c}"/><rect x="53" y="46" width="15" height="4.5" rx="2.2" fill="${c}"/>`,
  worried: (c) => `<path d="M33 46q6 2 12 4" stroke="${c}" stroke-width="3" fill="none" stroke-linecap="round"/><path d="M67 46q-6 2-12 4" stroke="${c}" stroke-width="3" fill="none" stroke-linecap="round"/>`
};

const MOUTHS = {
  grin: '<path d="M40 70q10 9 20 0q-10 4-20 0z" fill="#8d3a3a"/><path d="M40 70q10 8 20 0" stroke="#7a2f2f" stroke-width="2" fill="none" stroke-linecap="round"/>',
  smile: '<path d="M41 70q9 6 18 0" stroke="#8d3a3a" stroke-width="3" fill="none" stroke-linecap="round"/>',
  flat: '<path d="M42 71h16" stroke="#8d3a3a" stroke-width="3" fill="none" stroke-linecap="round"/>',
  oh: '<ellipse cx="50" cy="71" rx="5" ry="6" fill="#8d3a3a"/>'
};

/**
 * One player's portrait as an SVG string. `size` is the rendered box; the art is
 * always drawn in a 100×100 space so every face lines up with every other.
 */
export function faceSvg(id, size = 64) {
  const look = LOOKS[id] || LOOKS.isky;
  const kit = look.keeper ? KEEPER_KIT : KIT;
  const ear = look.ears === 'big' ? 6.5 : 5;

  return `<svg class="face" viewBox="0 0 100 100" width="${size}" height="${size}" aria-hidden="true">
  <defs>
    <clipPath id="bhs-clip-${id}"><circle cx="50" cy="50" r="49"/></clipPath>
    <linearGradient id="bhs-bg-${id}" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="${look.keeper ? '#2c3a1c' : '#1d3d70'}"/>
      <stop offset="1" stop-color="${look.keeper ? '#141c0d' : '#0d1f3c'}"/>
    </linearGradient>
  </defs>
  <g clip-path="url(#bhs-clip-${id})">
    <rect width="100" height="100" fill="url(#bhs-bg-${id})"/>
    <!-- shoulders in the school kit, so the portrait reads as a team photo -->
    <path d="M50 78c-18 0-30 9-33 22h66c-3-13-15-22-33-22z" fill="${kit.body}"/>
    <path d="M50 78c-5 0-9 1-13 2l13 12 13-12c-4-1-8-2-13-2z" fill="${kit.trim}"/>
    <ellipse cx="26" cy="58" rx="${ear}" ry="6.5" fill="${look.skin}"/>
    <ellipse cx="74" cy="58" rx="${ear}" ry="6.5" fill="${look.skin}"/>
    <path d="M50 24c-15 0-24 11-24 27s11 32 24 32 24-16 24-32-9-27-24-27z" fill="${look.skin}"/>
    ${HAIR[look.style](look.hair)}
    ${look.band ? `<path d="M25 44q25 -9 50 0l0 5q-25 -9 -50 0z" fill="${look.band}"/>` : ''}
    ${BROWS[look.brow](look.hair)}
    <ellipse cx="39.5" cy="58" rx="4.6" ry="5" fill="#fff"/>
    <ellipse cx="60.5" cy="58" rx="4.6" ry="5" fill="#fff"/>
    <circle cx="40" cy="58.5" r="2.6" fill="#2a1d16"/>
    <circle cx="60" cy="58.5" r="2.6" fill="#2a1d16"/>
    <path d="M50 58v7l-3 2" stroke="#c99872" stroke-width="2.4" fill="none" stroke-linecap="round" stroke-linejoin="round"/>
    ${MOUTHS[look.mouth]}
  </g>
  <circle cx="50" cy="50" r="48" fill="none" stroke="rgba(255,255,255,.16)" stroke-width="2"/>
</svg>`;
}

/**
 * The same person seen from a hundred metres away, on the pitch. Just enough to
 * tell that the little figure lining up the ball is the one you picked.
 */
export function kitColours(id) {
  const look = LOOKS[id] || LOOKS.isky;
  return { skin: look.skin, hair: look.hair, kit: look.keeper ? KEEPER_KIT : KIT };
}
