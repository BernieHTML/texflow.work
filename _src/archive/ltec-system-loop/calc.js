// The LTEC model, as a pure function.
//
// This is deliberately the only copy of the physics: the page imports it and
// so do the tests, so a number shown on a phone at the conference is the same
// number `node --test` checked. Nothing in here touches the DOM, reads the
// URL or rounds anything — rounding is a presentation decision and belongs in
// the page, because rounding early is exactly what makes the paper's printed
// 2,575 kW disagree with the 2,595 kW this returns.
//
// Units: S is kW/m^2, temperatures K, areas m^2, every power kW.

export const SIGMA = 5.670374e-8;      // Stefan-Boltzmann, W/m^2K^4

// The paper's modelled case. Shackleton rim: PSR at 28 K, the sunlit rim at
// 118 K (Zhong et al.), one bare pipe of 0.1 m x 100 m = 10 m^2 projected.
export const DEFAULTS = Object.freeze({
  S: 1.361,     // solar flux at the pole, kW/m^2
  Tc: 28,       // cold reservoir (PSR), K
  Th: 118,      // hot reservoir (high-illumination region), K
  A: 100,       // total projected pipe area, m^2
  alpha: 1      // pipe absorptivity, idealised at 1
});

export const OPT_DEFAULTS = Object.freeze({
  etaORC: 0.44,       // an ORC reaches about 44% of Carnot
  f: 1,               // illumination fraction; the rim is lit ~94% of the year
  realityCheck: false,
  emissivity: null,   // null means "track absorptivity", which is the grey-body case
  radEmissivity: 0.9  // emissivity assumed for a purpose-built cold radiator
});

// Number(null) is 0 and Number('') is 0, so an explicitly absent value has to
// be caught before coercion or it silently becomes a real zero — which is how
// "emissivity not set, track absorptivity" would turn into a mirror-finish
// pipe that radiates nothing.
const num = (v, fallback) => {
  if (v === null || v === undefined || v === '') return fallback;
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : fallback;
};

/**
 * Run the model.
 *
 * @param {object} inputs  S, Tc, Th, A, alpha (any missing field falls back to the paper value)
 * @param {object} opts    etaORC, f, realityCheck, emissivity, radEmissivity
 * @returns {object}       every intermediate, unrounded
 */
export function calc(inputs = {}, opts = {}) {
  const S     = Math.max(0, num(inputs.S, DEFAULTS.S));
  const Tc    = Math.max(0, num(inputs.Tc, DEFAULTS.Tc));
  const Th    = Math.max(0, num(inputs.Th, DEFAULTS.Th));
  const A     = Math.max(0, num(inputs.A, DEFAULTS.A));
  const alpha = Math.min(1, Math.max(0, num(inputs.alpha, DEFAULTS.alpha)));

  const etaORC = Math.max(0, num(opts.etaORC, OPT_DEFAULTS.etaORC));
  const f      = Math.min(1, Math.max(0, num(opts.f, OPT_DEFAULTS.f)));
  const realityCheck = Boolean(opts.realityCheck);
  const eps    = Math.min(1, Math.max(0, num(opts.emissivity, alpha)));
  const epsRad = Math.min(1, Math.max(0, num(opts.radEmissivity, OPT_DEFAULTS.radEmissivity)));

  // A hot side no warmer than the cold side is not a heat engine. Clamping at
  // zero here is what keeps every downstream number finite instead of letting
  // a negative efficiency turn into negative power and a negative area.
  const tempsValid = Th > Tc;
  const etaC = tempsValid ? 1 - Tc / Th : 0;

  // Gross collection. The paper stops here: area x flux x absorptivity.
  const QHGross = A * S * alpha * f;

  // Beyond the paper: a pipe at Th radiates from its whole surface, pi*D*L,
  // which is pi times the projected area the paper collects over.
  const QLoss = realityCheck ? (eps * SIGMA * Math.pow(Th, 4) * Math.PI * A) / 1000 : 0;
  const QH = Math.max(0, QHGross - QLoss);

  const WMax  = etaC * QH;
  const WPrac = etaORC * WMax;
  const QC    = Math.max(0, QH - WPrac);   // heat the cold end must reject

  // Equilibrium temperature of a sunlit pipe: absorbed over the projected
  // area, re-radiated over the full circumference. Independent of area, which
  // is why it is a ceiling on Th rather than something a bigger array fixes.
  const Teq = eps > 0 && S > 0
    ? Math.pow((alpha * S * 1000) / (Math.PI * eps * SIGMA), 0.25)
    : 0;
  const ThAboveTeq = realityCheck && tempsValid && Th > Teq;

  // Both collection and loss scale with A, so practical power stays linear in
  // area and the area needed for a target is a straight division. When the
  // per-m^2 figure is zero or negative the pipe loses at least what it gains
  // and no amount of area reaches the target: null, never Infinity.
  const perAreaHeat = S * alpha * f - (realityCheck ? (eps * SIGMA * Math.pow(Th, 4) * Math.PI) / 1000 : 0);
  const perAreaPower = etaORC * etaC * perAreaHeat;
  const areaFor = (targetKW) => {
    const t = num(targetKW, 0);
    if (!(perAreaPower > 0) || !(t > 0)) return null;
    return t / perAreaPower;
  };

  // Best case only: a flat plate seeing nothing but deep space. At 28 K a
  // black surface radiates about 0.031 W/m^2, hence the absurd answer.
  const radFlux = epsRad * SIGMA * Math.pow(Tc, 4);   // W/m^2
  const ARad = realityCheck && radFlux > 0 && QC > 0 ? (QC * 1000) / radFlux : 0;

  // The paper's own crew proxy: the ISS runs 7 crew on 75-90 kW.
  const crewLow  = WPrac / (90 / 7);
  const crewHigh = WPrac / (75 / 7);

  return {
    S, Tc, Th, A, alpha, etaORC, f, realityCheck, emissivity: eps, radEmissivity: epsRad,
    tempsValid, etaC,
    QHGross, QLoss, QH,
    WMax, WPrac, QC,
    Teq, ThAboveTeq,
    perAreaHeat, perAreaPower, areaFor,
    areaFor40: areaFor(40), areaFor1000: areaFor(1000),
    radFlux, ARad,
    crewLow, crewHigh
  };
}

