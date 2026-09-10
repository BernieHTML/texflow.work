// The Flow catalogue: every tool TexFlow ships, and the mark that identifies it.
//
// One entry here is the single source of truth for a Flow. The build reads it
// to draw the icons, to write the manifest, to fill in the meta tags, and to
// list the tool on the site — so a new Flow is an entry plus a source file in
// `flows/<area>/<id>.html`, and nothing else.
//
// Glyphs are authored in a 0..100 box using the shape builders from
// `scripts/flowkit/raster.mjs`, and the icon renderer scales that box into the
// tile. Keep them to strokes of roughly 7 units: thinner than that disappears
// at the 60px a home-screen icon actually gets looked at.

import * as g from '../scripts/flowkit/raster.mjs';

const PI = Math.PI;

// Rotate a shape about a point, for the marks that want to sit on a tilt.
function rotate(shape, cx, cy, deg) {
  const a = (deg * PI) / 180;
  const cos = Math.cos(a);
  const sin = Math.sin(a);
  return g.transform(shape, (x, y) => [
    cx + (x - cx) * cos - (y - cy) * sin,
    cy + (x - cx) * sin + (y - cy) * cos
  ]);
}

// A leaf built from two arcs bulging off the same chord, used by Plant Care.
function leaf(tipY, baseY, bulge) {
  const cx = 50;
  const c = baseY - tipY;
  const R = bulge / 2 + (c * c) / (8 * bulge);
  const off = R - bulge;
  const midY = (tipY + baseY) / 2;
  const aTip = Math.atan2(tipY - midY, -off);
  const aBase = Math.atan2(baseY - midY, -off);
  const bTip = Math.atan2(tipY - midY, off);
  const bBase = Math.atan2(baseY - midY, off);
  return g.polygon([
    ...g.arcPath(cx + off, midY, R, aTip, aTip - (aTip - aBase + 2 * PI) % (2 * PI), 40),
    ...g.arcPath(cx - off, midY, R, bBase, bTip, 40)
  ]);
}

export const AREAS = [
  { id: 'everyday', name: 'Everyday', blurb: 'The small sums you do standing in an aisle.' },
  { id: 'writing', name: 'Writing', blurb: 'Catch the thought, then make it readable.' },
  { id: 'fitness', name: 'Sport & Exercise', blurb: 'Count the rounds. Know the pace.' },
  { id: 'trades', name: 'Trades', blurb: 'How much to buy, and where to cut it.' },
  { id: 'kitchen', name: 'Kitchen', blurb: 'Scale the recipe, watch the pans.' },
  { id: 'money', name: 'Money', blurb: 'What it really costs, and who owes what.' },
  { id: 'study', name: 'Study', blurb: 'Remember it, and sit still long enough to learn it.' },
  { id: 'health', name: 'Health', blurb: 'Quiet daily records that add up.' },
  { id: 'travel', name: 'Travel', blurb: 'Pack it, and get the hour right.' },
  { id: 'home', name: 'Home', blurb: 'Keep the plants alive and the boxes labelled.' }
];

export const FLOWS = [
  // ------------------------------------------------------------- everyday ---
  {
    id: 'unit-price',
    area: 'everyday',
    name: 'Unit Price',
    tagline: 'Which one is actually cheaper',
    blurb: 'Put two or three sizes in and it tells you the price per litre, per kilo, per sheet — and which one wins.',
    keywords: ['shopping', 'price', 'compare', 'supermarket', 'value'],
    colors: ['#0369A1', '#38BDF8'],
    glyph: () => g.union(
      g.line(50, 26, 50, 78, 7),
      g.line(32, 80, 68, 80, 7),
      g.line(20, 32, 80, 32, 7),
      g.circle(50, 24, 6),
      g.line(24, 32, 24, 42, 5),
      g.line(76, 32, 76, 42, 5),
      g.arc(24, 44, 13, 6.5, 0, PI),
      g.arc(76, 44, 13, 6.5, 0, PI)
    )
  },
  {
    id: 'split',
    area: 'everyday',
    name: 'Split the Bill',
    tagline: 'Fair shares in ten seconds',
    blurb: 'A total, a number of people, an optional tip — and the awkward bit where someone had the lobster.',
    keywords: ['bill', 'split', 'tip', 'restaurant', 'share'],
    colors: ['#0891B2', '#22D3EE'],
    // One disc cut in two: the half you paid for solid, the half you are owed
    // still an outline.
    glyph: () => g.union(
      g.transform(g.polygon(g.arcPath(50, 50, 26, PI / 2, PI * 1.5, 56)), (x, y) => [x - 4, y]),
      g.transform(g.union(
        g.arc(50, 50, 22.5, 7, -PI / 2, PI / 2, { cap: 'butt' }),
        g.line(50, 27.5, 50, 72.5, 7, { cap: 'butt' })
      ), (x, y) => [x + 4, y])
    )
  },

  // -------------------------------------------------------------- writing ---
  {
    id: 'idea-board',
    area: 'writing',
    name: 'Idea Board',
    tagline: 'Catch it before it goes',
    blurb: 'Type the thought, tag it, let it sit. Sort by tag when you are ready to make something of them.',
    keywords: ['notes', 'ideas', 'capture', 'board', 'brainstorm'],
    colors: ['#CA8A04', '#FDE047'],
    glyph: () => g.union(
      g.ring(50, 42, 20, 7),
      g.roundRect(40, 63, 20, 8, 4),
      g.roundRect(43, 74, 14, 7, 3.5),
      g.line(50, 62, 50, 48, 5)
    )
  },
  {
    id: 'plain-english',
    area: 'writing',
    name: 'Plain English',
    tagline: 'Find the sentence nobody can follow',
    blurb: 'Paste anything. It marks the long sentences, the passive voice and the words with shorter cousins.',
    keywords: ['editing', 'readability', 'clarity', 'writing', 'grade'],
    colors: ['#0F766E', '#2DD4BF'],
    glyph: () => g.union(
      g.path([[20, 36], [30, 27], [40, 43], [50, 27], [60, 43], [70, 27], [80, 36]], 6.5),
      g.line(22, 66, 78, 66, 8)
    )
  },

  // -------------------------------------------------------------- fitness ---
  {
    id: 'intervals',
    area: 'fitness',
    name: 'Interval Timer',
    tagline: 'Work, rest, repeat',
    blurb: 'Set the rounds and the two clocks. It counts down loudly enough to hear from the floor.',
    keywords: ['hiit', 'timer', 'rounds', 'tabata', 'workout'],
    colors: ['#B91C1C', '#F87171'],
    glyph: () => g.union(
      g.ring(50, 55, 26, 7),
      g.roundRect(42, 18, 16, 10, 5),
      g.line(50, 28, 50, 30, 7),
      g.line(50, 55, 50, 39, 7),
      g.line(50, 55, 63, 62, 6),
      g.circle(50, 55, 4.5)
    )
  },
  {
    id: 'pace',
    area: 'fitness',
    name: 'Pace',
    tagline: 'Time, distance, pace — pick two',
    blurb: 'Fill any two and it solves the third, then lays out even splits for the whole distance.',
    keywords: ['running', 'pace', 'splits', 'marathon', 'cycling'],
    colors: ['#EA580C', '#FB923C'],
    glyph: () => g.union(
      g.path([[26, 30], [42, 50], [26, 70]], 8),
      g.path([[46, 30], [62, 50], [46, 70]], 8),
      g.path([[66, 30], [82, 50], [66, 70]], 8)
    )
  },

  // --------------------------------------------------------------- trades ---
  {
    id: 'materials',
    area: 'trades',
    name: 'Materials',
    tagline: 'How much to buy',
    blurb: 'Paint, tiles, concrete, decking, turf. Give it the dimensions and it gives you the order, waste included.',
    keywords: ['paint', 'tiles', 'concrete', 'quantity', 'estimate'],
    colors: ['#B45309', '#F59E0B'],
    glyph: () => g.union(
      g.roundRect(20, 26, 26, 16, 3), g.roundRect(52, 26, 26, 16, 3),
      g.roundRect(20, 46, 14, 16, 3), g.roundRect(40, 46, 20, 16, 3), g.roundRect(66, 46, 12, 16, 3),
      g.roundRect(20, 66, 26, 16, 3), g.roundRect(52, 66, 26, 16, 3)
    )
  },
  {
    id: 'cut-list',
    area: 'trades',
    name: 'Cut List',
    tagline: 'Fewest lengths, least offcut',
    blurb: 'Your stock lengths and the pieces you need. It packs them, counts the bars and shows the waste.',
    keywords: ['timber', 'cutting', 'optimiser', 'offcut', 'stock'],
    colors: ['#0F172A', '#475569'],
    // Three lengths cut off one bar: the pieces on the left, the stock they
    // came out of standing at the right.
    glyph: () => g.union(
      g.roundRect(18, 26, 42, 13, 6.5),
      g.roundRect(18, 44, 54, 13, 6.5),
      g.roundRect(18, 62, 28, 13, 6.5),
      g.line(82, 22, 82, 79, 7)
    )
  },

  // -------------------------------------------------------------- kitchen ---
  {
    id: 'scale-recipe',
    area: 'kitchen',
    name: 'Recipe Scaler',
    tagline: 'Six people, not four',
    blurb: 'Paste the ingredients, change the servings, and every quantity moves with it — cups to grams if you want.',
    keywords: ['recipe', 'scale', 'servings', 'convert', 'grams'],
    colors: ['#BE123C', '#FB7185'],
    glyph: () => g.union(
      g.path([[30, 28], [66, 28], [60, 80], [36, 80]], 7, { close: true }),
      g.path([[64, 40], [78, 45], [78, 60], [62, 64]], 6),
      g.line(39, 46, 55, 46, 5),
      g.line(41, 60, 52, 60, 5)
    )
  },
  {
    id: 'timers',
    area: 'kitchen',
    name: 'Kitchen Timers',
    tagline: 'Four pans, four clocks',
    blurb: 'Named timers running side by side, so the rice and the roast stop being the same problem.',
    keywords: ['timer', 'cooking', 'multiple', 'alarm', 'kitchen'],
    colors: ['#9A3412', '#FDBA74'],
    glyph: () => g.union(
      g.path([[30, 22], [70, 22], [50, 50], [70, 78], [30, 78], [50, 50]], 7, { close: true }),
      g.polygon([[38, 30], [62, 30], [50, 47]])
    )
  },

  // ---------------------------------------------------------------- money ---
  {
    id: 'repayments',
    area: 'money',
    name: 'Repayments',
    tagline: 'What it costs to borrow it',
    blurb: 'Amount, rate, term. See the repayment, the total interest, and what one extra payment a month does to it.',
    keywords: ['loan', 'mortgage', 'interest', 'repayment', 'amortise'],
    colors: ['#065F46', '#34D399'],
    glyph: () => g.union(
      g.roundRect(24, 30, 13, 50, 6.5),
      g.roundRect(44, 46, 13, 34, 6.5),
      g.roundRect(64, 60, 13, 20, 6.5)
    )
  },
  {
    id: 'owed',
    area: 'money',
    name: 'Who Owes What',
    tagline: 'Settle up without the spreadsheet',
    blurb: 'Log who paid for what on a trip or a share house, and it works out the fewest payments that square it.',
    keywords: ['shared', 'expenses', 'settle', 'housemates', 'trip'],
    colors: ['#047857', '#6EE7B7'],
    glyph: () => g.union(
      g.line(24, 38, 70, 38, 7),
      g.path([[60, 27], [72, 38], [60, 49]], 7),
      g.line(76, 64, 30, 64, 7),
      g.path([[40, 53], [28, 64], [40, 75]], 7)
    )
  },

  // ---------------------------------------------------------------- study ---
  {
    id: 'cards',
    area: 'study',
    name: 'Cards',
    tagline: 'The ones you keep missing come back',
    blurb: 'Flashcards with a memory. Get one right and it waits longer; get it wrong and it is back tomorrow.',
    keywords: ['flashcards', 'revision', 'spaced repetition', 'memory', 'exam'],
    colors: ['#1D4ED8', '#60A5FA'],
    glyph: () => g.union(
      g.path([[22, 34], [70, 34], [70, 80], [22, 80]], 7, { close: true }),
      g.line(32, 24, 78, 24, 7),
      g.line(78, 24, 78, 68, 7),
      g.line(34, 52, 58, 52, 6),
      g.line(34, 64, 48, 64, 6)
    )
  },
  {
    id: 'focus',
    area: 'study',
    name: 'Focus',
    tagline: 'Twenty-five minutes at a time',
    blurb: 'A working clock with breaks built in, and a quiet log of the sessions you actually finished.',
    keywords: ['pomodoro', 'focus', 'deep work', 'timer', 'concentration'],
    colors: ['#6D28D9', '#A78BFA'],
    glyph: () => g.union(
      g.ring(50, 50, 27, 7),
      g.ring(50, 50, 15, 7),
      g.circle(50, 50, 5.5)
    )
  },

  // --------------------------------------------------------------- health ---
  {
    id: 'streak',
    area: 'health',
    name: 'Streak',
    tagline: 'Do not break the chain',
    blurb: 'A handful of daily habits, one tap each, and a year of squares that makes the gaps obvious.',
    keywords: ['habit', 'streak', 'daily', 'routine', 'tracker'],
    colors: ['#E11D48', '#FB7185'],
    glyph: () => g.polygon([
      [50, 12], [58, 23], [65, 33], [70, 44], [71, 55], [67, 66], [59, 76],
      [50, 84], [39, 79], [31, 70], [28, 59], [31, 47], [38, 38], [43, 50],
      [43, 38], [45, 27], [47, 19]
    ])
  },
  {
    id: 'sleep',
    area: 'health',
    name: 'Sleep Log',
    tagline: 'Two taps a day, a month of evidence',
    blurb: 'Bed time, wake time. It keeps the hours, the average and the nights that broke the pattern.',
    keywords: ['sleep', 'log', 'hours', 'rest', 'tracker'],
    colors: ['#4338CA', '#818CF8'],
    glyph: () => g.union(
      g.polygon([
        ...g.arcPath(50, 50, 28, PI / 3, (PI * 5) / 3, 64),
        ...g.arcPath(72, 50, 25.5, -1.89, -4.39, 48)
      ]),
      g.circle(78, 24, 5),
      g.circle(87, 40, 3)
    )
  },

  // --------------------------------------------------------------- travel ---
  {
    id: 'packing',
    area: 'travel',
    name: 'Packing',
    tagline: 'Nothing left on the bed',
    blurb: 'Start from a trip template — beach, snow, work, camping — then tick your way out the door.',
    keywords: ['packing', 'checklist', 'trip', 'luggage', 'travel'],
    colors: ['#7C3AED', '#C4B5FD'],
    glyph: () => g.union(
      g.path([[22, 38], [78, 38], [78, 80], [22, 80]], 7, { close: true }),
      g.arc(50, 38, 13, 6.5, PI, PI * 2),
      g.line(22, 57, 78, 57, 6)
    )
  },
  {
    id: 'timezones',
    area: 'travel',
    name: 'Time Zones',
    tagline: 'The hour that suits everyone',
    blurb: 'Line up three or four places and drag a bar through the day to find the window nobody hates.',
    keywords: ['timezone', 'meeting', 'clock', 'utc', 'schedule'],
    colors: ['#1E40AF', '#60A5FA'],
    glyph: () => g.union(
      g.ring(50, 50, 28, 7),
      g.ellipseRing(50, 50, 12, 28, 7),
      g.line(23, 50, 77, 50, 6),
      g.line(28, 34, 72, 34, 5),
      g.line(28, 66, 72, 66, 5)
    )
  },

  // ----------------------------------------------------------------- home ---
  {
    id: 'plants',
    area: 'home',
    name: 'Plant Care',
    tagline: 'Which ones are thirsty today',
    blurb: 'Every plant with its own interval. It tells you what needs water now and remembers when you last did it.',
    keywords: ['plants', 'watering', 'garden', 'schedule', 'houseplant'],
    colors: ['#15803D', '#4ADE80'],
    glyph: () => g.union(
      g.path([[50, 86], [50, 62]], 8),
      rotate(g.union(leaf(20, 60, 13), g.line(50, 26, 50, 55, 4)), 50, 60, -32),
      rotate(g.union(leaf(34, 62, 10)), 50, 62, 38)
    )
  },
  {
    id: 'inventory',
    area: 'home',
    name: 'Home Inventory',
    tagline: 'What you own, and where it is',
    blurb: 'Room by room: what it was worth, when the warranty runs out, which box it went into.',
    keywords: ['inventory', 'insurance', 'contents', 'warranty', 'moving'],
    colors: ['#334155', '#94A3B8'],
    glyph: () => g.union(
      g.path([[24, 44], [76, 44], [76, 80], [24, 80]], 7, { close: true }),
      g.path([[18, 26], [82, 26], [82, 44], [18, 44]], 7, { close: true }),
      g.line(50, 44, 50, 62, 7)
    )
  }
];

export const flowById = (id) => FLOWS.find((f) => f.id === id) || null;
export const flowsByArea = (areaId) => FLOWS.filter((f) => f.area === areaId);
export const areaById = (id) => AREAS.find((a) => a.id === id) || null;
