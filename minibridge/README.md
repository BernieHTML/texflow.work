# MiniBridge

A pocket-sized tool that builds the small things you want, on your device.

You describe something; MiniBridge builds it and keeps it. Everything — the
personal check, the building, the running — happens on the phone. There is no
backend at runtime.

## Deployment

MiniBridge is served at **`texflow.work/minibridge`** (subpath, not a subdomain).

- Source lives in `/minibridge`. `npm run build` emits to `../public/minibridge`.
- `server.js` already mounts `express.static` on `public/`, so **a build is the
  whole deploy** — no new route, no new PM2 process, no `pm2 restart`, and
  therefore no site-wide outage.
- HTTPS is already in place for `texflow.work` (wildcard cert covering
  `*.texflow.work`), which is what WebGPU, camera access, service workers and
  OPFS all require.

### Why subpath rather than a subdomain

A subdomain (`minibridge.texflow.work`) would give cleaner origin isolation, and
the wildcard cert already covers it. It was not chosen because it needs an nginx
server block and a DNS record, and because `/smig/` already demonstrates that an
installed PWA with camera access and a scoped manifest works correctly on this
exact origin.

**The trade-off is real and worth knowing:** OPFS quota is per *origin*, so
MiniBridge's model weights (several hundred MB) share a storage budget with the
rest of `texflow.work`, including smig's data. If the browser ever evicts this
origin under pressure, it takes both. Moving to a subdomain later is the fix if
that becomes a problem; only `base` in `vite.config.ts`, the paths in
`manifest.webmanifest`, and the two absolute `/minibridge/vision/...` paths in
`src/lib/face.ts` would need to change.

## Building it

```bash
cd minibridge && npm install && npm run build
```

Icons are generated separately, only when the mark changes:

```bash
node scripts/icons.mjs
```

## Privacy & security

- **Camera frames** are processed in memory for the landmark and smile check
  only. No frame is written to disk, drawn into anything persistent, or
  uploaded. The camera is stopped as soon as the check finishes.
- **The face signature** is a derived geometry vector — normalised distances
  between facial landmarks. The raw image never leaves the frame buffer. The
  vector is stored in OPFS on the device and never leaves it.
- **Generated Bridges** are stored locally in OPFS and rendered in an iframe
  with `sandbox="allow-scripts"` and no `allow-same-origin`. That combination is
  deliberate: granting both would give a Bridge a same-origin document and hence
  access to this app's OPFS — the signature and every other Bridge. A Bridge has
  network access only if its own generated code makes a call, and the system
  prompt tells the generator not to.
- **Model weights** are downloaded once from a CDN by web-llm, cached locally,
  and never fetched again. Generation itself makes no network calls.
- **The MediaPipe wasm and face model** are served from this origin
  (`public/vision/`), not a CDN, so the personal check works offline.

### Smile In is not a security boundary

Read this before building anything on top of it.

Smile In is a **personal gesture-lock**, not biometric authentication:

- No liveness detection beyond asking for a smile. A photo or video of the
  enrolled person would plausibly pass.
- No secure hardware backing. The signature is plain JSON in OPFS; any script
  running on this origin can read it.
- The match is geometric similarity against a hand-tuned tolerance, so it will
  both admit lookalikes and reject the real person in poor light. That is
  precisely why the passcode fallback is mandatory rather than optional.

Do not gate anything genuinely sensitive behind it. It exists to make opening
MiniBridge feel personal. It is deliberately **not** called "Face ID" — that is
Apple's trademark and would overstate this considerably.

## Architecture

Vanilla TypeScript + Vite. No framework: the shell must load fast and leave
memory headroom for a several-hundred-megabyte model, and this app's state is
shallow enough (six screens, no shared reactive graph) that render functions are
genuinely simpler than a reactive layer. The initial shell is ~23KB of JS;
web-llm's 6MB is dynamically imported so it is only paid for when the magic is
actually installed.

| Concern | Where |
| --- | --- |
| OPFS records, passcode hashing, storage usage | `src/lib/storage.ts` |
| Smile In: landmarks, blendshapes, signature maths | `src/lib/face.ts` |
| Shared camera ceremony | `src/lib/ceremony.ts` |
| Model install and generation | `src/lib/engine.ts` |
| Screens | `src/screens/` |
| Shell caching | `public/sw.js` |

### The model, and why phones get the smaller one

Two tiers, both Apache 2.0 and both tuned for structured/code output rather than
chat. `q4f16_1` is used where WebGPU reports `shader-f16`, falling back to
`q4f32_1`.

| Tier | Model | Graphics memory | Default on |
| --- | --- | --- | --- |
| `full` | Qwen2.5-Coder-1.5B-Instruct | ~1630 MB | desktop |
| `light` | Qwen2.5-Coder-0.5B-Instruct | ~944 MB | phones |

The 1.5B was originally the sole choice, on the reasoning that mobile Safari's
~5GB per-tab ceiling makes the 1–3B range safe. **That reasoning had the wrong
constraint.** The binding limit is the GPU buffer budget, not the tab ceiling,
and 1.6GB of it sits right at the edge on a real phone: the model loads fine,
then the first prefill tips the page over and the browser kills it outright.
From the user's side that looks like pressing Build and being thrown back to
the very first screen.

Pages from the 0.5B are simpler. Pages from a builder that crashes the phone do
not exist. `context_window_size` is also trimmed below each model's default
4096 (`CONTEXT` in `engine.ts`), since the KV cache is allocated up front and
scales with it.

Llama-3.2-3B as an optional richer tier remains a **fast-follow**. Given the
above it should be gated behind an explicit choice on desktop, not offered on
phones.

### Crash detection

A browser that runs out of memory kills the page — there is no exception to
catch and no error event. So `markBuildStarted()` leaves a note in OPFS before
the heavy part and clears it after. A note still present at boot means the last
build took the page down, and `stepDownAfterCrash()` moves the device to the
lighter tier, drops the too-heavy weights, and Home explains it plainly.

Covered by `scripts/check-crash.mjs`.

### Bridge record schema

```ts
{
  id: string;         // crypto.randomUUID()
  name: string;       // short, derived from the request
  request: string;    // the person's original words, verbatim
  createdAt: number;  // epoch ms
  html: string;       // complete self-contained document
}
```

`request` is kept deliberately. The spec left it open; storing it costs a few
hundred bytes and is the precondition for ever rebuilding or tweaking a Bridge.

## Copy rules

The words "AI", "LLM", "model", "chatbot", "prompt", "machine learning" and
similar **never** appear in any user-facing string — not in labels, loading
states, errors, or tooltips. Code comments and this README are exempt.

The input is "the magic box" in UI copy and nowhere is it a chat. The one-time
setup is "Install the magic". The personal check is "Smile In", including in its
error states.

## Storage eviction is the thing most likely to bite

The failure mode to recognise: you come back and MiniBridge asks you to enrol
*and* to install the magic again, as if it were a fresh device.

That is the browser having evicted this origin under storage pressure. Eviction
is all-or-nothing per origin, so it takes `identity.json` (→ back to first-run
setup) and `magic.json` and the Bridges with it. The model download is several
hundred megabytes and shares a quota with all of `texflow.work`, which is what
makes it likely — see the subpath trade-off above.

Mitigations in place: `requestPersistence()` is called at enrolment *and* again
immediately before the model download, which is the moment the pressure
actually arrives. Safari can still decline. If it keeps happening, moving to a
subdomain gives MiniBridge its own quota and is the real fix.

## Known gaps

- Thresholds in `face.ts` (`SMILE_THRESHOLD`, `MATCH_TOLERANCE`) are hand-tuned
  and want real-device testing in real lighting.
- Camera permission behaves differently in a Safari tab versus an installed
  standalone PWA on iOS. **This has not been tested in standalone mode**; do
  that before considering the unlock flow done.
