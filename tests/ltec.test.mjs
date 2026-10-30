// The acceptance numbers for the LTEC model, straight from the brief.
//
//   node --test tests/ltec.test.mjs
//
// Everything here runs against public/ltec-system/calc.js, the same module the
// page imports, so these assertions describe what the audience will actually
// see on their phones.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { calc, DEFAULTS, SIGMA } from '../public/ltec-system/calc.js';

// Compare at 3 significant figures, which is the precision the page displays.
const sig3 = (x) => Number(Number(x).toPrecision(3));
const near = (actual, expected, tol, what) =>
  assert.ok(Math.abs(actual - expected) <= tol,
    `${what}: expected ~${expected}, got ${actual} (tolerance ${tol})`);

test('paper defaults reproduce the published figures', () => {
  const r = calc(DEFAULTS);
  assert.equal(sig3(r.etaC * 100), 76.3, 'Carnot efficiency %');
  near(r.etaC * 100, 76.27, 0.005, 'Carnot efficiency %');
  assert.equal(sig3(r.QH), 136, 'heat input kW');
  near(r.QH, 136.1, 1e-9, 'heat input kW');
  assert.equal(sig3(r.WMax), 104, 'theoretical max kW');
  near(r.WMax, 103.8, 0.01, 'theoretical max kW');
  near(r.WPrac, 45.67, 0.005, 'practical kW');
});

test('area needed for 40 kW and 1000 kW', () => {
  const r = calc(DEFAULTS);
  near(r.areaFor40, 87.6, 0.05, 'area for 40 kW');
  near(r.areaFor1000, 2189, 0.5, 'area for 1000 kW');
});

test('the area figures round-trip back to their targets', () => {
  const r = calc(DEFAULTS);
  near(calc({ ...DEFAULTS, A: r.areaFor40 }).WPrac, 40, 1e-9, '40 kW round trip');
  near(calc({ ...DEFAULTS, A: r.areaFor1000 }).WPrac, 1000, 1e-9, '1000 kW round trip');
});

test('ISS-sized array: 2,595 kW, not the paper\'s rounded 2,575 kW', () => {
  const r = calc({ ...DEFAULTS, A: 2500 });
  near(r.WMax, 2595, 0.5, 'theoretical max at 2500 m2');
  // The paper prints 2,575 kW because it rounds eta_C to 0.76 and the per-10 m2
  // output to 10.3 kW before multiplying. Reproduce that to prove the gap is
  // rounding and not a different model.
  const rounded = 0.76 * 2500 * 1.361;
  near(rounded, 2586, 1, "paper's rounded eta_C path");
  near(10.3 * 250, 2575, 1e-9, "paper's rounded per-10 m2 path");
});

test('absorptivity scales every power output linearly', () => {
  const full = calc(DEFAULTS);
  const half = calc({ ...DEFAULTS, alpha: 0.5 });
  near(half.QH, full.QH / 2, 1e-12, 'heat input halves');
  near(half.WMax, full.WMax / 2, 1e-12, 'theoretical max halves');
  near(half.WPrac, full.WPrac / 2, 1e-12, 'practical halves');
  assert.equal(half.etaC, full.etaC, 'efficiency is unaffected by absorptivity');
});

test('a hot side no warmer than the cold side yields zero, never NaN', () => {
  for (const Th of [28, 27, 20, 0]) {
    const r = calc({ ...DEFAULTS, Th });
    assert.equal(r.tempsValid, false, `Th=${Th} is not a valid heat engine`);
    assert.equal(r.etaC, 0);
    assert.equal(r.WMax, 0);
    assert.equal(r.WPrac, 0);
    assert.equal(r.areaFor40, null, 'no area reaches 40 kW');
    assert.equal(r.areaFor1000, null);
  }
});

test('no result is ever NaN or Infinity, across the whole input space', () => {
  const grid = {
    S: [0, 0.001, 1.361, 1.5],
    Tc: [20, 28, 120],
    Th: [100, 118, 400],
    A: [1, 100, 5000],
    alpha: [0, 0.5, 1]
  };
  for (const S of grid.S) for (const Tc of grid.Tc) for (const Th of grid.Th)
  for (const A of grid.A) for (const alpha of grid.alpha)
  for (const realityCheck of [false, true]) {
    const r = calc({ S, Tc, Th, A, alpha }, { realityCheck });
    for (const [k, v] of Object.entries(r)) {
      if (typeof v !== 'number') continue;
      assert.ok(Number.isFinite(v),
        `${k} was ${v} at S=${S} Tc=${Tc} Th=${Th} A=${A} alpha=${alpha} rc=${realityCheck}`);
    }
    for (const k of ['areaFor40', 'areaFor1000']) {
      assert.ok(r[k] === null || Number.isFinite(r[k]), `${k} was ${r[k]}`);
    }
  }
});

test('garbage inputs fall back to the paper values instead of producing NaN', () => {
  const baseline = calc(DEFAULTS);
  for (const junk of [undefined, null, NaN, 'abc', {}, []]) {
    const r = calc({ S: junk, Tc: junk, Th: junk, A: junk, alpha: junk });
    assert.ok(Number.isFinite(r.WPrac), `WPrac finite for ${String(junk)}`);
  }
  near(calc({}).WPrac, baseline.WPrac, 1e-12, 'empty input equals paper baseline');
});

test('reality check: losses, equilibrium temperature and radiator area', () => {
  const r = calc(DEFAULTS, { realityCheck: true });
  near(r.Teq, 295.6, 0.1, 'equilibrium pipe temperature K');
  near(r.QLoss, 3.45, 0.01, 're-radiation loss kW');
  near(r.QH, 132.6, 0.05, 'net heat input kW');
  near(r.WPrac, 44.5, 0.05, 'practical kW with losses');
  near(r.ARad / 1e6, 2.8, 0.05, 'radiator area, millions of m2');
  assert.equal(r.ThAboveTeq, false, '118 K is comfortably below equilibrium');
});

test('reality check flags a hot side hotter than sunlight can sustain', () => {
  const r = calc({ ...DEFAULTS, Th: 350 }, { realityCheck: true });
  assert.equal(r.ThAboveTeq, true, '350 K is above the ~296 K equilibrium');
  assert.ok(r.QLoss > r.QHGross, 'such a pipe loses more than it collects');
  assert.equal(r.QH, 0, 'net heat input clamps at zero');
  assert.equal(r.WPrac, 0);
  assert.equal(r.areaFor40, null, 'no area can reach 40 kW while net heat is negative');
});

test('reality check leaves the paper mode untouched', () => {
  const paper = calc(DEFAULTS);
  assert.equal(paper.QLoss, 0, 'no loss term in paper mode');
  assert.equal(paper.ARad, 0, 'no radiator figure in paper mode');
  near(paper.QH, paper.QHGross, 1e-12, 'net equals gross in paper mode');
});

test('the 28 K radiator flux is the ~0.03 W/m2 the page quotes', () => {
  const r = calc(DEFAULTS, { realityCheck: true });
  near(r.radFlux, 0.0314, 0.0005, 'W/m2 radiated at 28 K');
  assert.equal(sig3(SIGMA * 1e8), 5.67, 'Stefan-Boltzmann constant');
});

test('crew equivalent uses the ISS proxy of 75-90 kW for 7', () => {
  const r = calc(DEFAULTS);
  near(r.crewLow, 45.674 / (90 / 7), 0.01, 'low crew estimate');
  near(r.crewHigh, 45.674 / (75 / 7), 0.01, 'high crew estimate');
  assert.ok(r.crewLow < r.crewHigh, 'the low estimate is the lower one');
  // 45.67 kW lands at "about 3-4 people", the sentence the page writes.
  assert.equal(Math.round(r.crewLow), 4);
  assert.equal(Math.floor(r.crewHigh), 4);
});

test('the advanced knobs do what they say', () => {
  const base = calc(DEFAULTS);
  near(calc(DEFAULTS, { etaORC: 0.22 }).WPrac, base.WPrac / 2, 1e-12, 'halving the ORC fraction');
  near(calc(DEFAULTS, { f: 0.94 }).WPrac, base.WPrac * 0.94, 1e-12, 'the 94% illuminated rim');
  near(calc(DEFAULTS, { etaORC: 1 }).WPrac, base.WMax, 1e-12, 'an ideal ORC reaches the Carnot limit');
});

test('the presets the page offers all produce sane numbers', () => {
  const presets = {
    'Paper baseline': [DEFAULTS, {}],
    'Warmer rim':     [{ ...DEFAULTS, Th: 200 }, {}],
    'Dusty pipes':    [{ ...DEFAULTS, alpha: 0.6 }, {}],
    'ISS-sized':      [{ ...DEFAULTS, A: 2500 }, {}]
  };
  for (const [name, [inputs, opts]] of Object.entries(presets)) {
    const r = calc(inputs, opts);
    assert.ok(r.WPrac > 0 && Number.isFinite(r.WPrac), `${name} produces power`);
  }
  assert.ok(calc({ ...DEFAULTS, Th: 200 }).WPrac > calc(DEFAULTS).WPrac, 'a warmer rim helps');
  near(calc({ ...DEFAULTS, alpha: 0.6 }).WPrac, calc(DEFAULTS).WPrac * 0.6, 1e-12, 'dusty pipes');
});

test('an explicitly null option falls back rather than becoming zero', () => {
  // The page passes emissivity: null to mean "track absorptivity". Number(null)
  // is 0, so this needs catching before coercion.
  const tracked = calc(DEFAULTS, { realityCheck: true, emissivity: null });
  const implied = calc(DEFAULTS, { realityCheck: true });
  near(tracked.QLoss, implied.QLoss, 1e-12, 'null emissivity tracks absorptivity');
  near(tracked.emissivity, DEFAULTS.alpha, 1e-12, 'and reports it as alpha');
  near(tracked.WPrac, 44.5, 0.05, 'and still gives the expected power');

  // The same trap for every other option the page may leave unset.
  for (const key of ['etaORC', 'f', 'radEmissivity']) {
    const withNull = calc(DEFAULTS, { realityCheck: true, [key]: null });
    const without = calc(DEFAULTS, { realityCheck: true });
    near(withNull.WPrac, without.WPrac, 1e-12, `${key}: null falls back`);
    near(withNull.ARad, without.ARad, 1e-6, `${key}: null falls back for radiator area`);
  }

  // And an emissivity that really is zero must still be honoured.
  const mirror = calc(DEFAULTS, { realityCheck: true, emissivity: 0 });
  assert.equal(mirror.QLoss, 0, 'a zero emissivity radiates nothing');
});
