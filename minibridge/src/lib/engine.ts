/* The on-device model.
 *
 * WebLLM downloads and caches its own weights (OPFS/IndexedDB) — we let it own
 * that entirely. After the one-time download, talking involves no network.
 *
 * Nothing in this file's user-facing strings names the technology. That copy
 * lives in the UI layer and is deliberately kept in MiniBridge's voice.
 */

// Type-only: the actual module is ~6MB minified and is pulled in lazily below,
// so opening MiniBridge never pays for it until there's something to load.
import type { MLCEngine, InitProgressReport } from '@mlc-ai/web-llm';
import {
  clearHeavy,
  clearModel,
  loadDevice,
  loadModel,
  markHeavy,
  requestPersistence,
  saveDevice,
  saveModel,
  type Tier,
} from './storage';

/** Three sizes of the same idea. All general-purpose instruct models — this is
 * a chat, so a code-tuned model would be the wrong tool however small.
 *
 * q4f16_1 is the smaller build of each and needs the shader-f16 WebGPU feature;
 * we fall back to the f32 build when that's missing.
 *
 * The binding constraint on a phone is the GPU buffer budget, NOT the ~5GB
 * per-tab memory ceiling. A model can load fine and then die on the first
 * prefill, which the browser reports as the page crashing rather than as an
 * error anything here can catch. Hence three tiers and an automatic way down. */
const MODELS: Record<Tier, { f16: string; f32: string; about: string }> = {
  full: {
    f16: 'Llama-3.2-3B-Instruct-q4f16_1-MLC',
    f32: 'Llama-3.2-3B-Instruct-q4f32_1-MLC',
    about: 'the roomiest one',
  },
  pocket: {
    f16: 'Llama-3.2-1B-Instruct-q4f16_1-MLC',
    f32: 'Llama-3.2-1B-Instruct-q4f32_1-MLC',
    about: 'the pocket one',
  },
  tiny: {
    f16: 'SmolLM2-360M-Instruct-q4f16_1-MLC',
    f32: 'SmolLM2-360M-Instruct-q4f32_1-MLC',
    about: 'the smallest one',
  },
};

/** Trim the KV cache well below the 4096 these ship with. It is allocated up
 * front and scales with this number, so it is the cheapest memory saving
 * available — and a pocket conversation does not need a long memory. */
const CONTEXT: Record<Tier, number> = { full: 4096, pocket: 1536, tiny: 1024 };

/** How much of the window a reply may take. */
const REPLY_TOKENS: Record<Tier, number> = { full: 640, pocket: 400, tiny: 300 };

/** Leave room for the system prompt and the turn being answered. */
const RESERVE = 256;

export function describeTier(tier: Tier): string {
  return MODELS[tier].about;
}

/** The order we step down in. */
const DOWNHILL: Tier[] = ['full', 'pocket', 'tiny'];

let engine: MLCEngine | null = null;
let loading: Promise<MLCEngine> | null = null;

/**
 *   'absent'  - never downloaded on this device; offer the one-time setup.
 *   'waking'  - downloaded before, currently coming back.
 *   'ready'   - good to go.
 */
export type EngineState = 'absent' | 'waking' | 'ready';

let downloaded = false;
let activeTier: Tier = 'pocket';

export function state(): EngineState {
  if (engine) return 'ready';
  if (loading || downloaded) return 'waking';
  return 'absent';
}

/** Does this device have WebGPU at all? Pre-iOS 26 Safari does not. */
export function deviceSupported(): boolean {
  return typeof navigator !== 'undefined' && 'gpu' in navigator;
}

/** Crude on purpose: a coarse pointer on a small screen is a phone, and this is
 * a pocket product. Guessing wrong on a tablet costs a simpler conversation;
 * guessing wrong the other way costs a crash. */
function looksLikeAPhone(): boolean {
  try {
    return (
      window.matchMedia('(pointer: coarse)').matches &&
      Math.min(window.screen.width, window.screen.height) < 820
    );
  } catch {
    return true; // when unsure, be gentle with the device
  }
}

/** The tier this device should use, honouring anything it has already told us
 * the hard way — or been told by hand. */
export function tierFor(): Tier {
  const profile = loadDevice();
  if (profile) return profile.tier;
  return looksLikeAPhone() ? 'pocket' : 'full';
}

export function currentTier(): Tier {
  return activeTier;
}

export function deviceProfile() {
  return loadDevice() ?? { tier: tierFor(), crashes: 0 };
}

/** Choose a tier by hand, from Settings. Stops the automatic guessing. */
export function chooseTier(tier: Tier): void {
  const profile = deviceProfile();
  saveDevice({ ...profile, tier, chosen: true });
}

async function pickModel(tier: Tier): Promise<string> {
  let f16 = false;
  try {
    const adapter = await navigator.gpu.requestAdapter();
    f16 = adapter?.features.has('shader-f16') ?? false;
  } catch {
    /* fall through to the safer build */
  }
  return f16 ? MODELS[tier].f16 : MODELS[tier].f32;
}

/**
 * Bring the model up. `onProgress` receives 0–1.
 *
 * We pass along only a fraction, never WebLLM's raw progress text — that text
 * is full of megabyte counts and cache internals, and none of it belongs in
 * front of a person.
 */
export async function install(onProgress: (fraction: number) => void): Promise<MLCEngine> {
  if (engine) return engine;
  if (loading) return loading;

  loading = (async () => {
    // Ask for persistent storage BEFORE pulling down several hundred megabytes.
    // Without it the browser may evict this origin under pressure, and eviction
    // takes the weights with it. Safari can decline; asking at the moment of
    // pressure is still the best shot we get.
    await requestPersistence();

    const tier = tierFor();
    // Synchronous, and written before anything heavy starts. If the next line
    // takes the page down, this is the only trace left at the next boot.
    markHeavy('loading');

    const [{ CreateMLCEngine }, model] = await Promise.all([
      import('@mlc-ai/web-llm'),
      pickModel(tier),
    ]);
    const created = await CreateMLCEngine(
      model,
      {
        initProgressCallback: (report: InitProgressReport) => {
          const fraction = typeof report.progress === 'number' ? report.progress : 0;
          onProgress(Math.max(0, Math.min(1, fraction)));
        },
      },
      { context_window_size: CONTEXT[tier] },
    );

    clearHeavy();
    engine = created;
    activeTier = tier;
    downloaded = true;
    saveModel({ modelId: model, installedAt: Date.now() });
    return created;
  })();

  try {
    const ready = await loading;
    loading = null;
    return ready;
  } catch (err) {
    // Survived the failure, so it wasn't a crash — tear the breadcrumb up, or
    // the next boot would blame a step-down on an ordinary network error.
    clearHeavy();
    loading = null;
    throw err;
  }
}

/** Has the download completed on this device before? */
export function alreadyDownloaded(): boolean {
  downloaded = loadModel() !== null;
  return downloaded;
}

/**
 * The page died doing something heavy. Step this device down a size so the same
 * thing doesn't happen again.
 *
 * Returns the new tier, or null if there is nothing lighter left.
 */
export async function stepDown(): Promise<Tier | null> {
  const profile = deviceProfile();
  const crashes = profile.crashes + 1;
  const next = DOWNHILL[DOWNHILL.indexOf(profile.tier) + 1];

  if (!next) {
    // Already as small as we go. Record it; there is nothing left to drop.
    saveDevice({ ...profile, crashes });
    return null;
  }

  saveDevice({ tier: next, crashes });

  // The too-heavy weights are the largest thing on the device and are no longer
  // wanted, so let them go rather than leaving a gigabyte of dead cache.
  await dropWeights();
  clearModel();
  engine = null;
  loading = null;
  downloaded = false;
  return next;
}

async function dropWeights(): Promise<void> {
  try {
    const installed = loadModel();
    if (!installed) return;
    const { deleteModelAllInfoInCache } = await import('@mlc-ai/web-llm');
    await deleteModelAllInfoInCache(installed.modelId);
  } catch {
    /* best effort */
  }
}

/** Forget the download without touching the weights. Used when waking fails —
 * typically the browser evicted them under storage pressure. */
export function forget(): void {
  engine = null;
  loading = null;
  downloaded = false;
  clearModel();
}

/** Drop the cached weights. Used by Settings. */
export async function uninstall(): Promise<void> {
  try {
    await engine?.unload();
  } catch {
    /* may never have loaded */
  }
  await dropWeights();
  forget();
}

/* ---- Talking ------------------------------------------------------------ */

const SYSTEM_PROMPT = `You are MiniBridge, a small, warm assistant living in someone's pocket.

Answer in plain conversational language. Be brief — a couple of short paragraphs at most unless genuinely more is needed. Never open by restating the question. No markdown headings, and no bullet lists unless the answer really is a list. Say plainly when you don't know something rather than guessing.`;

export interface Turn {
  role: 'user' | 'assistant';
  content: string;
}

/** Roughly four characters to the token. Crude, but it only has to keep us off
 * the edge of the window, and counting properly would mean shipping a
 * tokeniser to do it. */
const CHARS_PER_TOKEN = 4;

/** Keep the most recent turns that fit, oldest dropped first.
 *
 * Trimming rather than summarising is the honest choice at this size: a model
 * this small, asked to summarise its own history, mostly invents one. */
function fitHistory(turns: Turn[], tier: Tier): Turn[] {
  const budget = (CONTEXT[tier] - REPLY_TOKENS[tier] - RESERVE) * CHARS_PER_TOKEN;
  const kept: Turn[] = [];
  let used = 0;
  for (let i = turns.length - 1; i >= 0; i--) {
    used += turns[i].content.length;
    if (used > budget && kept.length) break;
    kept.unshift(turns[i]);
  }
  return kept;
}

/**
 * Continue a conversation. `turns` ends with the person's new message.
 *
 * `onToken` receives the reply so far, so the bubble can fill in as it arrives
 * — on a phone that is the difference between "thinking" and "frozen".
 */
export async function chat(
  turns: Turn[],
  onToken: (soFar: string) => void,
  signal?: AbortSignal,
): Promise<string> {
  if (!engine) throw new Error('not-ready');

  // Generating is the other thing that can exhaust a phone. Same breadcrumb,
  // different step, so the next boot can say which it was.
  markHeavy('replying');

  try {
    const stream = await engine.chat.completions.create({
      stream: true,
      messages: [{ role: 'system', content: SYSTEM_PROMPT }, ...fitHistory(turns, activeTier)],
      temperature: 0.7,
      max_tokens: REPLY_TOKENS[activeTier],
    });

    let reply = '';
    for await (const chunk of stream) {
      if (signal?.aborted) {
        await engine.interruptGenerate();
        throw new DOMException('aborted', 'AbortError');
      }
      reply += chunk.choices[0]?.delta?.content ?? '';
      onToken(reply);
    }

    const trimmed = reply.trim();
    if (!trimmed) throw new Error('empty-reply');
    return trimmed;
  } finally {
    clearHeavy();
  }
}
