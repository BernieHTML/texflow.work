/* The stadium.
 *
 * Two cameras, one shootout. The taker sees the goal from behind his own
 * shoulder; the keeper sees the taker from the line, with the frame of his own
 * goal around the edge of the screen. Both are drawn into the same 360×640
 * portrait box, because the game is only ever held upright in one hand.
 *
 * Everything works in one number: `x`, across the goalmouth, where 0 is dead
 * centre and ±1 is the inside of a post. The server resolves in that number and
 * both phones draw from it, so the two people watch the same ball.
 */

import { kitColours } from './faces.js';

export const W = 360;
export const H = 640;

// --- shooter camera ------------------------------------------------------- //
// The goal sits entirely on grass, with the boards and the crowd above it. Put
// the boards across the goalmouth instead and the advertising reads as a wall
// halfway up the net.
const S = {
  postL: 40, postR: 320, bar: 262, line: 372,
  ballX: 180, ballY: 500,
  half: 140          // (postR - postL) / 2 — one unit of x
};

// --- keeper camera -------------------------------------------------------- //
// You are standing in the mouth, so your own posts frame the screen. They are
// held off the very edge on purpose: the scene is drawn to cover, and a phone
// narrower than 9:16 crops the sides away — posts on the edge get cropped out
// of the shot entirely, which leaves the keeper floating in a field.
const K = {
  postL: 46, postR: 314, bar: 80, line: 520,
  spotX: 180, spotY: 292,
  half: 110          // inside the posts
};

export const shooterX = (x) => S.ballX + x * S.half;
export const keeperX = (x) => 180 + x * K.half;

const lerp = (a, b, t) => a + (b - a) * t;
const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, n));

/** Height the ball ends at, in the goalmouth. Hit it harder, it flies higher. */
const shotHeight = (power) => 0.12 + 0.55 * clamp(power, 0, 1);

// ------------------------------------------------------------------ pieces ---

/**
 * A stand full of people. Real crowds are a texture, not a pattern, so the rows
 * are jittered and the colours come from a short list — mostly the school's, and
 * a few that belong to whoever came in whatever they had on.
 */
function crowd(x, y, w, h, rows, seed = 1) {
  const tints = ['#1d4f96', '#f2c14e', '#e8e6e0', '#8e2f3a', '#2b3a52', '#c9cdd6', '#3a6ea8', '#d9b24c'];
  let out = '';
  let n = seed * 9301;
  const rnd = () => ((n = (n * 9301 + 49297) % 233280) / 233280);
  for (let r = 0; r < rows; r++) {
    const ry = y + (r + 0.5) * (h / rows);
    const size = lerp(1.5, 3.1, r / rows);           // nearer rows read bigger
    const step = size * 3.1;
    for (let cx = x + rnd() * step; cx < x + w; cx += step) {
      const t = tints[Math.floor(rnd() * tints.length)];
      out += `<circle cx="${(cx + rnd() * 1.6).toFixed(1)}" cy="${(ry + rnd() * 2 - 1).toFixed(1)}" r="${(size * (0.8 + rnd() * 0.4)).toFixed(2)}" fill="${t}" opacity="${(0.55 + rnd() * 0.45).toFixed(2)}"/>`;
    }
  }
  return out;
}

function floodlight(x, y, flip = false) {
  const s = flip ? -1 : 1;
  return `<g transform="translate(${x} ${y})">
    <rect x="-2.5" y="0" width="5" height="70" fill="#0d1526"/>
    <rect x="-24" y="-18" width="48" height="20" rx="3" fill="#111c31"/>
    <g fill="#fff8dc">
      ${[0, 1, 2, 3].map((i) => `<circle cx="${-17 + i * 11.4}" cy="-8" r="4"/>`).join('')}
    </g>
    <path d="M${-28 * s} -12 L${160 * s} 240 L${-140 * s} 240 Z" fill="url(#bhs-beam)" opacity=".14"/>
  </g>`;
}

/** Mown stripes, converging on the goal. It is what makes the ground read as depth. */
function stripes(horizon, topL, topR, botL, botR, count = 9) {
  let out = '';
  for (let i = 0; i < count; i++) {
    if (i % 2) continue;
    const tA = lerp(topL, topR, i / count);
    const tB = lerp(topL, topR, (i + 1) / count);
    const bA = lerp(botL, botR, i / count);
    const bB = lerp(botL, botR, (i + 1) / count);
    out += `<path d="M${tA} ${horizon} L${tB} ${horizon} L${bB} ${H} L${bA} ${H} Z" fill="#3f8f43" opacity=".38"/>`;
  }
  return out;
}

/**
 * The net, seen from the penalty spot. A straight mesh across the mouth plus a
 * shallow box receding behind it: enough depth to sit the keeper inside
 * something, without pretending to be a real perspective projection.
 */
function net(l, r, top, bottom) {
  const depth = 26;
  const il = l + depth, ir = r - depth, it = top + depth * 0.62, ib = bottom - depth * 0.28;
  let mesh = '';
  for (let x = l + 13; x < r - 4; x += 13) mesh += `<line x1="${x}" y1="${top}" x2="${x}" y2="${bottom}"/>`;
  for (let y = top + 13; y < bottom - 3; y += 13) mesh += `<line x1="${l}" y1="${y}" x2="${r}" y2="${y}"/>`;
  return `<g class="net">
    <path d="M${l} ${top} L${il} ${it} L${ir} ${it} L${r} ${top} Z" fill="rgba(4,14,8,.62)"/>
    <path d="M${l} ${top} L${il} ${it} L${il} ${ib} L${l} ${bottom} Z" fill="rgba(4,14,8,.48)"/>
    <path d="M${r} ${top} L${ir} ${it} L${ir} ${ib} L${r} ${bottom} Z" fill="rgba(4,14,8,.48)"/>
    <rect x="${il}" y="${it}" width="${ir - il}" height="${ib - it}" fill="rgba(6,20,11,.42)"/>
    <g stroke="rgba(255,255,255,.32)" stroke-width=".9">${mesh}</g>
  </g>`;
}

/** A player, seen from far enough away to be a silhouette in a kit. */
function figure(id, { x, y, scale = 1 } = {}) {
  const c = kitColours(id);
  return `<g transform="translate(${x} ${y}) scale(${scale})">
    <ellipse cx="0" cy="2" rx="13" ry="3.5" fill="rgba(0,0,0,.28)"/>
    <path d="M-6 0 L-5 -18 L5 -18 L6 0" fill="#12203a"/>
    <path d="M-10 -18 L10 -18 L9 -38 L-9 -38 Z" fill="${c.kit.body}"/>
    <path d="M-9 -38 L9 -38 L9 -34 L-9 -34 Z" fill="${c.kit.trim}"/>
    <path d="M-8 -18 L-12 -4 M8 -18 L12 -4" stroke="${c.skin}" stroke-width="5" stroke-linecap="round"/>
    <circle cx="0" cy="-44" r="6.5" fill="${c.skin}"/>
    <path d="M-6.5 -46q6.5 -6 13 0q-2 -4 -6.5 -4t-6.5 4z" fill="${c.hair}"/>
  </g>`;
}

/**
 * The man whose shoulder you are looking over. Drawn from behind — so the head
 * is nearly all hair, and there is a number on his back instead of a face.
 */
function takerBack(id, { x, y, scale = 1, number = 10 } = {}) {
  const c = kitColours(id);
  return `<g transform="translate(${x} ${y}) scale(${scale})">
    <ellipse cx="0" cy="4" rx="30" ry="7" fill="rgba(0,0,0,.32)"/>
    <path d="M-11 0 L-9 -26 L9 -26 L11 0" fill="#0f1c33"/>
    <path d="M-21 -24 q-5 -32 5 -42 h32 q10 10 5 42 z" fill="${c.kit.body}"/>
    <path d="M-17 -62 h34 l1 6 h-36 z" fill="${c.kit.trim}"/>
    <text x="0" y="-36" text-anchor="middle" fill="${c.kit.trim}" font-size="17" font-weight="800"
          font-family="system-ui, sans-serif" opacity=".92">${number}</text>
    <path d="M-19 -60 l-8 26 M19 -60 l8 26" stroke="${c.skin}" stroke-width="7" stroke-linecap="round"/>
    <circle cx="0" cy="-74" r="13" fill="${c.skin}"/>
    <path d="M-13 -74 a13 13 0 1 1 26 0 v3 q-13 4 -26 0 z" fill="${c.hair}"/>
    <circle cx="-12.5" cy="-72" r="2.6" fill="${c.skin}"/>
    <circle cx="12.5" cy="-72" r="2.6" fill="${c.skin}"/>
  </g>`;
}

/** The keeper, front on. `.keeper-move` carries no transform of its own so the
 *  animation can own it outright: a CSS transform on a node that already has a
 *  transform="" attribute replaces it, which is a confusing way to lose a keeper
 *  off the side of the screen. */
function keeperFigure(id, scale = 1) {
  const c = kitColours(id);
  return `<g class="keeper-move"><g class="keeper-body" transform="scale(${scale})">
    <ellipse cx="0" cy="2" rx="16" ry="4" fill="rgba(0,0,0,.3)"/>
    <path d="M-7 0 L-6 -20 L6 -20 L7 0" fill="#1c2a14"/>
    <path d="M-12 -20 L12 -20 L11 -44 L-11 -44 Z" fill="${c.kit.body}"/>
    <g class="keeper-arms">
      <path d="M-10 -41 L-25 -53 M10 -41 L25 -53" stroke="${c.kit.body}" stroke-width="6" stroke-linecap="round" fill="none"/>
      <circle cx="-28" cy="-56" r="5.5" fill="#f4f6ef" stroke="${c.kit.trim}" stroke-width="1.5"/>
      <circle cx="28" cy="-56" r="5.5" fill="#f4f6ef" stroke="${c.kit.trim}" stroke-width="1.5"/>
    </g>
    <circle cx="0" cy="-51" r="7" fill="${c.skin}"/>
    <path d="M-7 -53q7 -6.5 14 0q-2 -4.5 -7 -4.5t-7 4.5z" fill="${c.hair}"/>
  </g></g>`;
}

const DEFS = `<defs>
  <linearGradient id="bhs-sky" x1="0" y1="0" x2="0" y2="1">
    <stop offset="0" stop-color="#070d1c"/><stop offset="1" stop-color="#1a3260"/>
  </linearGradient>
  <linearGradient id="bhs-grass" x1="0" y1="0" x2="0" y2="1">
    <stop offset="0" stop-color="#2f7a37"/><stop offset=".45" stop-color="#3d9243"/><stop offset="1" stop-color="#4aa64c"/>
  </linearGradient>
  <linearGradient id="bhs-beam" x1="0" y1="0" x2="0" y2="1">
    <stop offset="0" stop-color="#fff6d8" stop-opacity=".9"/><stop offset="1" stop-color="#fff6d8" stop-opacity="0"/>
  </linearGradient>
  <linearGradient id="bhs-stand" x1="0" y1="0" x2="0" y2="1">
    <stop offset="0" stop-color="#101a2e"/><stop offset="1" stop-color="#1b2740"/>
  </linearGradient>
  <linearGradient id="bhs-post" x1="0" y1="0" x2="1" y2="0">
    <stop offset="0" stop-color="#ffffff"/><stop offset=".55" stop-color="#e7ecf3"/><stop offset="1" stop-color="#b9c3d1"/>
  </linearGradient>
  <radialGradient id="bhs-glow" cx=".5" cy=".5" r=".5">
    <stop offset="0" stop-color="#fff8dc" stop-opacity=".5"/><stop offset="1" stop-color="#fff8dc" stop-opacity="0"/>
  </radialGradient>
  <radialGradient id="bhs-ball" cx=".35" cy=".3" r=".8">
    <stop offset="0" stop-color="#ffffff"/><stop offset="1" stop-color="#c9ccd2"/>
  </radialGradient>
</defs>`;

function ballMarkup(cls, cx, cy, r) {
  return `<g class="${cls}" transform="translate(${cx} ${cy})">
    <ellipse cx="0" cy="${r * 1.5}" rx="${r}" ry="${r * 0.3}" fill="rgba(0,0,0,.3)"/>
    <circle r="${r}" fill="url(#bhs-ball)"/>
    <path d="M0 ${-r * 0.62} l${r * 0.36} ${r * 0.27} l${-r * 0.14} ${r * 0.44} h${-r * 0.44} l${-r * 0.14} ${-r * 0.44} Z" fill="#20242c"/>
    <circle r="${r}" fill="none" stroke="rgba(0,0,0,.18)"/>
  </g>`;
}

// ------------------------------------------------------------------ scenes ---

export function shooterScene(takerId, keeperId) {
  return `<svg class="scene" viewBox="0 0 ${W} ${H}" preserveAspectRatio="xMidYMid slice">
  ${DEFS}
  <rect width="${W}" height="${H}" fill="url(#bhs-sky)"/>
  <ellipse cx="180" cy="110" rx="230" ry="110" fill="url(#bhs-glow)" opacity=".5"/>
  ${floodlight(40, 16)}${floodlight(320, 16, true)}

  <rect x="-20" y="96" width="400" height="98" fill="url(#bhs-stand)"/>
  <rect x="-20" y="90" width="400" height="8" fill="#0a1120"/>
  ${crowd(-16, 100, 392, 90, 8, 3)}
  <rect x="-20" y="190" width="400" height="6" fill="#0a1120"/>
  <rect x="-20" y="196" width="400" height="26" fill="#0f2a52"/>
  <text x="180" y="214" class="board" text-anchor="middle">BLAXLAND HIGH</text>

  <rect x="-20" y="222" width="400" height="${H - 222}" fill="url(#bhs-grass)"/>
  ${stripes(222, -20, 380, -280, 640)}

  <g stroke="rgba(255,255,255,.72)" stroke-width="3" fill="none">
    <path d="M-20 ${S.line} H380"/>
    <path d="M-20 434 H380"/>
    <path d="M30 ${H} q150 -130 300 0"/>
  </g>
  <ellipse cx="${S.ballX}" cy="${S.ballY + 15}" rx="5" ry="2" fill="rgba(255,255,255,.85)"/>

  <g class="goal">
    ${net(S.postL, S.postR, S.bar, S.line)}
    <rect x="${S.postL - 7}" y="${S.bar}" width="7" height="${S.line - S.bar}" fill="url(#bhs-post)"/>
    <rect x="${S.postR}" y="${S.bar}" width="7" height="${S.line - S.bar}" fill="url(#bhs-post)"/>
    <rect x="${S.postL - 7}" y="${S.bar - 7}" width="${S.postR - S.postL + 14}" height="7" fill="#fbfcfe"/>
  </g>

  <g class="keeper" transform="translate(${S.ballX} ${S.line})">${keeperFigure(keeperId, 1.12)}</g>

  <g class="aim" opacity="0">
    <line class="aim-line" x1="${S.ballX}" y1="${S.ballY}" x2="${S.ballX}" y2="${S.bar + 40}" stroke="#f2c14e" stroke-width="2.5" stroke-dasharray="7 6" opacity=".85"/>
    <g class="aim-mark">
      <circle r="15" fill="rgba(242,193,78,.18)" stroke="#f2c14e" stroke-width="2.5"/>
      <path d="M-22 0h11M11 0h11M0 -22v11M0 11v11" stroke="#f2c14e" stroke-width="2.5" stroke-linecap="round"/>
    </g>
  </g>

  ${ballMarkup('ball', S.ballX, S.ballY, 12)}

  <g class="taker">${takerBack(takerId, { x: 92, y: 640, scale: 2.0, number: 9 })}</g>
</svg>`;
}

export function keeperScene(takerId, keeperId) {
  // Netting hanging off the bar, overhead. Short, because you are underneath it.
  const curtain = Array.from({ length: 15 }, (_, i) => {
    const x = K.postL + 4 + i * ((K.postR - K.postL - 8) / 14);
    return `<line x1="${x}" y1="${K.bar}" x2="${x}" y2="${K.bar + 26}"/>`;
  }).join('') + Array.from({ length: 3 }, (_, i) =>
    `<line x1="${K.postL + 4}" y1="${K.bar + 7 + i * 9}" x2="${K.postR - 4}" y2="${K.bar + 7 + i * 9}"/>`
  ).join('');

  return `<svg class="scene" viewBox="0 0 ${W} ${H}" preserveAspectRatio="xMidYMid slice">
  ${DEFS}
  <rect width="${W}" height="${H}" fill="url(#bhs-sky)"/>
  <ellipse cx="180" cy="90" rx="240" ry="100" fill="url(#bhs-glow)" opacity=".45"/>

  <rect x="-20" y="96" width="400" height="86" fill="url(#bhs-stand)"/>
  ${crowd(-16, 100, 392, 78, 8, 7)}
  <rect x="-20" y="178" width="400" height="6" fill="#0a1120"/>
  <rect x="-20" y="184" width="400" height="22" fill="#0f2a52"/>
  <text x="180" y="200" class="board" text-anchor="middle">BLAXLAND HIGH</text>

  <rect x="-20" y="206" width="400" height="${H - 206}" fill="url(#bhs-grass)"/>
  ${stripes(206, -20, 380, -320, 680)}

  <g stroke="rgba(255,255,255,.72)" stroke-width="3" fill="none">
    <path d="M-20 ${K.line} H380"/>
    <path d="M-60 396 H420"/>
    <path d="M60 250 q120 74 240 0" stroke-width="2.5" opacity=".85"/>
    <path d="M-60 396 L34 ${H} M420 396 L326 ${H}" opacity=".6"/>
  </g>
  <ellipse cx="${K.spotX}" cy="${K.spotY + 12}" rx="7" ry="2.6" fill="rgba(255,255,255,.9)"/>

  <g class="taker">${figure(takerId, { x: K.spotX - 32, y: K.spotY + 8, scale: 1.95 })}</g>
  ${ballMarkup('ball', K.spotX + 4, K.spotY, 7)}

  <!-- Your own goal, framing the screen. You are standing in it, so the netting
       is overhead and to the sides — never in front of the ball. -->
  <g class="goal-frame">
    <g stroke="rgba(255,255,255,.34)" stroke-width="1.1" fill="none">${curtain}</g>
    <rect x="${K.postL - 24}" y="${K.bar - 24}" width="${K.postR - K.postL + 48}" height="24" fill="#fbfcfe"/>
    <rect x="${K.postL - 24}" y="${K.bar}" width="24" height="${H - K.bar}" fill="url(#bhs-post)"/>
    <rect x="${K.postR}" y="${K.bar}" width="24" height="${H - K.bar}" fill="url(#bhs-post)"/>
    <rect x="${K.postL - 24}" y="${K.bar - 2}" width="${K.postR - K.postL + 48}" height="3" fill="rgba(0,0,0,.16)"/>
  </g>

  <!-- Your own arms, running off the bottom of the screen. Without them the
       gloves read as two objects lying on the grass rather than as your hands. -->
  <g class="glove-anchor" transform="translate(180 486)">
    <g class="gloves">
      <path d="M-136 168 L-92 -6 L-56 4 L-104 172 Z" fill="#b7e14b"/>
      <path d="M136 168 L92 -6 L56 4 L104 172 Z" fill="#b7e14b"/>
      <path d="M-99 22 L-63 32 L-66 44 L-102 34 Z" fill="#1d2a12" opacity=".35"/>
      <path d="M99 22 L63 32 L66 44 L102 34 Z" fill="#1d2a12" opacity=".35"/>
      <g class="glove-l"><circle cx="-74" cy="0" r="27" fill="#f4f6ef" stroke="#8bbd2f" stroke-width="4"/><path d="M-86 -10h24M-88 0h26" stroke="#1d2a12" stroke-width="3" stroke-linecap="round" opacity=".8"/></g>
      <g class="glove-r"><circle cx="74" cy="0" r="27" fill="#f4f6ef" stroke="#8bbd2f" stroke-width="4"/><path d="M62 -10h24M62 0h26" stroke="#1d2a12" stroke-width="3" stroke-linecap="round" opacity=".8"/></g>
    </g>
  </g>

  <g class="aim" opacity="0">
    <g class="aim-mark">
      <rect x="-44" y="-62" width="88" height="124" rx="18" fill="rgba(8,22,10,.42)" stroke="#b7e14b" stroke-width="3.5"/>
      <path d="M-18 0h36M0 -18v36" stroke="#b7e14b" stroke-width="3" stroke-linecap="round"/>
    </g>
  </g>
</svg>`;
}

// ------------------------------------------------------------------- refs ----

export function sceneRefs(root, role) {
  return {
    role,
    svg: root.querySelector('.scene'),
    ball: root.querySelector('.ball'),
    keeper: root.querySelector('.keeper'),
    keeperMove: root.querySelector('.keeper-move'),
    gloves: root.querySelector('.gloves'),
    taker: root.querySelector('.taker'),
    aim: root.querySelector('.aim'),
    aimMark: root.querySelector('.aim-mark'),
    aimLine: root.querySelector('.aim-line')
  };
}

/** Where the aim is pointing, live, while a finger is still down. */
export function drawAim(refs, aim, power) {
  if (!refs.aim) return;
  refs.aim.setAttribute('opacity', '1');
  if (refs.role === 'shoot') {
    const x = shooterX(clamp(aim, -0.95, 0.95));
    const y = S.line - shotHeight(power) * (S.line - S.bar);
    refs.aimMark.setAttribute('transform', `translate(${x} ${y})`);
    refs.aimLine.setAttribute('x2', x);
    refs.aimLine.setAttribute('y2', y + 16);
  } else {
    const x = keeperX(clamp(aim, -1, 1));
    refs.aimMark.setAttribute('transform', `translate(${x} 392)`);
    refs.gloves?.classList.remove('diving');
    if (refs.gloves) {
      refs.gloves.style.transition = 'none';
      refs.gloves.style.transform = `translate(${(x - 180) * 0.75}px, 0px)`;
    }
  }
}

export function clearAim(refs) {
  if (refs.aim) refs.aim.setAttribute('opacity', '0');
}

export function resetGloves(refs) {
  if (!refs.gloves) return;
  refs.gloves.style.transition = 'none';
  refs.gloves.style.transform = 'none';
  refs.gloves.classList.remove('diving');
}

// -------------------------------------------------------------- animation ---

function ease(t) { return t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2; }

function raf(ms, step) {
  return new Promise((done) => {
    const start = performance.now();
    const tick = (now) => {
      const t = Math.min(1, (now - start) / ms);
      step(t);
      if (t < 1) requestAnimationFrame(tick); else done();
    };
    requestAnimationFrame(tick);
  });
}

/**
 * Play one resolved kick. Both cameras run off the same numbers, so whatever
 * the taker watches go in is the same ball the keeper watches go past him.
 * Resolves once the ball has finished doing whatever it did.
 */
export async function playKick(refs, kick) {
  const { dive, power, outcome } = kick;
  const el = refs.ball;                                   // the circle on screen
  const place = kick.ball;                                // where it crossed the line
  const spread = Math.abs(place) * (outcome === 'wide' ? 1.35 : 1);

  if (refs.role === 'shoot') {
    const endX = shooterX(Math.sign(place) * Math.min(spread, 1.45));
    const endY = S.line - shotHeight(power) * (S.line - S.bar);
    const keeperTo = clamp(dive, -1.15, 1.15) * S.half * 0.86;

    // Run-up: the taker steps into frame and the ball is gone.
    await raf(340, (t) => {
      refs.taker.setAttribute('transform', `translate(${t * 46} ${-t * 10}) scale(${1 - t * 0.06})`);
    });

    const flightMs = lerp(760, 470, clamp(power, 0, 1));
    let committed = false;
    await raf(flightMs, (t) => {
      const e = ease(t);
      const x = lerp(S.ballX, endX, e);
      const lift = Math.sin(Math.PI * t) * lerp(30, 12, power);
      const y = lerp(S.ballY, endY, e) - lift;
      const r = lerp(13, 6.5, e);
      el.setAttribute('transform', `translate(${x} ${y}) scale(${r / 13})`);
      if (t > 0.12 && !committed) {
        committed = true;
        refs.keeperMove.style.transition = `transform ${Math.round(flightMs * 0.7)}ms cubic-bezier(.3,.8,.4,1)`;
        refs.keeperMove.style.transform = `translate(${keeperTo}px, ${-Math.min(26, Math.abs(keeperTo) * 0.34)}px) rotate(${keeperTo * 0.16}deg)`;
        refs.keeperMove.classList.add('diving');
      }
    });

    await settle(refs, el, endX, endY, outcome, 'shoot');
    return;
  }

  // Keeper camera: the ball comes at the screen and gets very big, very fast.
  const endX = keeperX(Math.sign(place) * Math.min(spread, 1.25));
  const gloveTo = clamp(dive, -1, 1) * 150;

  await raf(320, (t) => {
    refs.taker.setAttribute('transform', `translate(${t * 16} ${t * 6}) scale(${1 + t * 0.06})`);
  });

  const flightMs = lerp(720, 440, clamp(power, 0, 1));
  refs.gloves.style.transition = `transform ${Math.round(flightMs * 0.62)}ms cubic-bezier(.25,.9,.4,1)`;
  refs.gloves.style.transform = `translate(${gloveTo}px, ${-Math.abs(gloveTo) * 0.06}px) rotate(${gloveTo * 0.07}deg)`;
  refs.gloves.classList.add('diving');

  await raf(flightMs, (t) => {
    const e = ease(t);
    const x = lerp(K.spotX, endX, e);
    const y = lerp(K.spotY, 500, e * e);
    const r = lerp(7, 44, e * e);
    el.setAttribute('transform', `translate(${x} ${y}) scale(${r / 7})`);
  });

  await settle(refs, el, endX, 500, outcome, 'keep');
}

/** What the ball does after it arrives — bulge the net, get palmed, hit wood. */
async function settle(refs, el, x, y, outcome, role) {
  const scale = role === 'shoot' ? 0.5 : 6.3;

  if (outcome === 'goal') {
    refs.svg.classList.add('is-goal');
    await raf(520, (t) => {
      const drop = t * (role === 'shoot' ? 22 : 60);
      el.setAttribute('transform', `translate(${x} ${y + drop}) scale(${scale * (1 - t * 0.15)})`);
    });
    return;
  }

  if (outcome === 'saved') {
    refs.svg.classList.add('is-save');
    const away = Math.sign(x - 180 || 1) * (role === 'shoot' ? 62 : 210);
    await raf(480, (t) => {
      el.setAttribute('transform', `translate(${x + away * t} ${y + 40 * t}) scale(${scale * (1 - t * 0.3)})`);
    });
    return;
  }

  // Post or wide: it keeps going, and takes the crowd's breath with it.
  refs.svg.classList.add('is-miss');
  const away = Math.sign(x - 180 || 1) * (outcome === 'post' ? 90 : 150);
  await raf(500, (t) => {
    el.setAttribute('transform', `translate(${x + away * t} ${y - 30 * t}) scale(${scale * (1 - t * 0.35)})`);
  });
}

/**
 * Turn a drag into an aim. Horizontal distance is where the ball goes; how far
 * up the screen the swipe travels is how hard it is struck. The keeper only has
 * the horizontal half of that — he is diving, not shooting.
 */
export function readSwipe(dx, dy, box, role) {
  const aim = clamp(dx / (box.width * 0.30), -1, 1);
  if (role === 'keep') return { aim, power: 0 };
  const power = clamp(Math.max(0, -dy) / (box.height * 0.22), 0.08, 1);
  return { aim, power };
}
