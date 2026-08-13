/* The on-device builder.
 *
 * WebLLM downloads and caches its own weights (OPFS/IndexedDB) — we let it own
 * that entirely rather than reimplementing caching. After the one-time install,
 * building a Bridge involves no network at all.
 *
 * Nothing in this file's user-facing strings names the technology. That copy
 * lives in the UI layer and is deliberately kept in MiniBridge's voice.
 */

// Type-only: the actual module is ~6MB minified and is pulled in lazily below,
// so opening MiniBridge to look at your Bridges never pays for it.
import type { MLCEngine, InitProgressReport } from '@mlc-ai/web-llm';

/** Primary. Apache 2.0, tuned for structured/code output rather than chat, and
 * small enough that the one-time download is defensible on a phone — which
 * matters because mobile Safari's per-tab memory ceiling (~5GB) makes the 1–3B
 * range the safe zone.
 *
 * q4f16_1 is the smaller build and needs the shader-f16 WebGPU feature; we fall
 * back to the f32 build when that's missing. */
const PRIMARY_F16 = 'Qwen2.5-Coder-1.5B-Instruct-q4f16_1-MLC';
const PRIMARY_F32 = 'Qwen2.5-Coder-1.5B-Instruct-q4f32_1-MLC';

/* Fast-follow, not shipped in this pass: 'Llama-3.2-3B-Instruct-q4f16_1-MLC' as
 * an optional richer tier in Settings for newer, higher-memory devices. Kept as
 * a constant so adding the tier later is a config change, not a refactor. */

let engine: MLCEngine | null = null;
let loading: Promise<MLCEngine> | null = null;

export function isReady(): boolean {
  return engine !== null;
}

/** Does this device have WebGPU at all? Pre-iOS 26 Safari does not. */
export function deviceSupported(): boolean {
  return typeof navigator !== 'undefined' && 'gpu' in navigator;
}

async function pickModel(): Promise<string> {
  try {
    const adapter = await navigator.gpu.requestAdapter();
    if (adapter?.features.has('shader-f16')) return PRIMARY_F16;
  } catch {
    /* fall through to the safer build */
  }
  return PRIMARY_F32;
}

/**
 * Set up the builder. `onProgress` receives 0–1.
 *
 * We deliberately pass along only a fraction, never WebLLM's raw progress text
 * — that text is full of megabyte counts and cache internals, and none of it
 * belongs in front of a person.
 */
export async function install(onProgress: (fraction: number) => void): Promise<MLCEngine> {
  if (engine) return engine;
  if (loading) return loading;

  loading = (async () => {
    const [{ CreateMLCEngine }, model] = await Promise.all([
      import('@mlc-ai/web-llm'),
      pickModel(),
    ]);
    const created = await CreateMLCEngine(model, {
      initProgressCallback: (report: InitProgressReport) => {
        const fraction = typeof report.progress === 'number' ? report.progress : 0;
        onProgress(Math.max(0, Math.min(1, fraction)));
      },
    });
    engine = created;
    return created;
  })();

  try {
    return await loading;
  } catch (err) {
    loading = null;
    throw err;
  }
}

/** Has the model already been installed in a previous session? WebLLM keeps its
 * own cache, so we check for it rather than tracking a flag ourselves. */
export async function alreadyInstalled(): Promise<boolean> {
  try {
    if (!('caches' in window)) return false;
    const keys = await caches.keys();
    return keys.some((k) => k.startsWith('webllm/'));
  } catch {
    return false;
  }
}

/** Drop the cached weights. Used by Settings. */
export async function uninstall(): Promise<void> {
  try {
    await engine?.unload();
  } catch {
    /* engine may never have loaded */
  }
  engine = null;
  loading = null;
  if ('caches' in window) {
    const keys = await caches.keys();
    await Promise.all(keys.filter((k) => k.startsWith('webllm/')).map((k) => caches.delete(k)));
  }
}

const SYSTEM_PROMPT = `You write tiny, self-contained web pages.

Given a description, output ONE complete HTML document and nothing else.

Rules:
- Start with <!DOCTYPE html>. Include <html>, <head> and <body>.
- Put ALL CSS in a single <style> tag and ALL JavaScript in a single <script> tag, inline in the document.
- No external files, no CDN links, no <link> to stylesheets, no imports, no fonts from the network.
- Do not use fetch, XMLHttpRequest, WebSocket, or any network call unless the description genuinely requires live data.
- Include <meta name="viewport" content="width=device-width, initial-scale=1"> and make it work well on a phone screen.
- Make it work immediately with no setup, no API keys and no sign-in.
- Keep it focused: build exactly what was described, nothing more.
- Output raw HTML only. No markdown code fences, no commentary before or after.`;

/** Ask for a short name for a Bridge. Falls back to trimming the request. */
function deriveName(request: string): string {
  const cleaned = request.replace(/\s+/g, ' ').trim();
  const stripped = cleaned.replace(
    /^(please\s+)?(build|make|create|give me|i want|i'd like|can you (make|build)|a|an)\s+/i,
    '',
  );
  const words = (stripped || cleaned).split(' ').slice(0, 4).join(' ');
  const name = words.charAt(0).toUpperCase() + words.slice(1);
  return name.replace(/[.,;:!?]+$/, '').slice(0, 32) || 'A small thing';
}

/** Strip markdown fences and any chatter around the document — small models
 * wrap their output more often than the prompt would suggest. */
function extractHTML(raw: string): string {
  let text = raw.trim();

  const fence = text.match(/```(?:html)?\s*([\s\S]*?)```/i);
  if (fence) text = fence[1].trim();

  const start = text.search(/<!DOCTYPE html|<html[\s>]/i);
  if (start > 0) text = text.slice(start);

  const end = text.toLowerCase().lastIndexOf('</html>');
  if (end !== -1) text = text.slice(0, end + '</html>'.length);

  return text.trim();
}

export interface BuildResult {
  name: string;
  html: string;
}

/**
 * Build one thing from one description.
 *
 * `onToken` fires as text arrives so the Building screen can show that
 * something is genuinely happening without resorting to a fake spinner.
 */
export async function build(
  request: string,
  onToken: (soFar: string) => void,
  signal?: AbortSignal,
): Promise<BuildResult> {
  if (!engine) throw new Error('not-installed');

  const stream = await engine.chat.completions.create({
    stream: true,
    messages: [
      { role: 'system', content: SYSTEM_PROMPT },
      { role: 'user', content: request },
    ],
    temperature: 0.6,
    max_tokens: 4096,
  });

  let raw = '';
  for await (const chunk of stream) {
    if (signal?.aborted) {
      await engine.interruptGenerate();
      throw new DOMException('aborted', 'AbortError');
    }
    raw += chunk.choices[0]?.delta?.content ?? '';
    onToken(raw);
  }

  const html = extractHTML(raw);
  if (!html || !/<html[\s>]/i.test(html)) throw new Error('unusable-output');

  return { name: deriveName(request), html };
}
