# MiniBridge

A chat with a model on your own phone, and a nudge when it answers.

One screen. You type, a model running on the device answers, and if you've
wandered off it taps you on the shoulder. **Nothing you say leaves the phone**
unless you switch on the cloud backup, and every reply that came that way says
so in the transcript.

> **v0.2 removed a lot.** MiniBridge used to build small self-contained web
> pages and open with a face check called Smile In. Both are gone, along with
> the ~36MB of MediaPipe wasm and the face landmarker they needed. See
> [What was removed](#what-was-removed-and-why) if you're looking for them.

## Deployment

Served at **`texflow.work/minibridge`** (subpath, not a subdomain).

- Source lives in `/minibridge`. `npm run build` emits to `../public/minibridge`.
- `server.js` already mounts `express.static` on `public/`, so **a build is the
  whole deploy** — no new process, no `pm2 restart`, no site-wide outage.
- The one exception is the server side, in `routes/minibridge/index.js` (mounted
  at `/minibridge/api`) and the `/minibridge/chat` redirect in `server.js`.
  Changing **those** does need `pm2 restart texflow-main`.
- `/minibridge/chat` 301s to `/minibridge/`. It is on people's Home Screens and
  inside notification payloads already sent, and neither can be reached to be
  updated, so the old address has to keep working.

### Why subpath rather than a subdomain

A subdomain would give cleaner origin isolation and the wildcard cert already
covers it. It was not chosen because it needs an nginx server block and a DNS
record. The trade-off: storage quota is per *origin*, so the model weights share
a budget with the rest of `texflow.work`. Moving later means changing `base` in
`vite.config.ts` and the paths in `manifest.webmanifest`.

## Building it

```bash
cd minibridge && npm install && npm run build
```

Icons are generated separately, only when the mark changes:

```bash
node scripts/icons.mjs
```

## What actually loads

Weight is the whole point of this app, so it is worth stating plainly:

| | |
| --- | --- |
| Opening MiniBridge | **~48KB** — the HTML, one JS chunk, one CSS file, the worker |
| Bringing the model over | ~6MB of engine, once, plus the weights below |
| Sitting on the device afterwards | the weights, and a transcript measured in kilobytes |

web-llm is dynamically imported in `lib/engine.ts`, so its 6MB chunk is only
fetched when there is actually a model to run. That split is the difference
between the app drawing instantly and it parsing six megabytes first.

## Architecture

Vanilla TypeScript + Vite, one page, no framework. State is shallow enough that
render functions beat a reactive layer, and the shell has to stay small.

| Concern | Where |
| --- | --- |
| Boot, and reading the crash breadcrumb | `src/main.ts` |
| localStorage records, breadcrumb, prefs | `src/lib/storage.ts` |
| Model load, tiers, generation | `src/lib/engine.ts` |
| Cloud backup client | `src/lib/cloud.ts` |
| Notifications and Web Push | `src/lib/notify.ts` |
| The conversation, and Settings | `src/screens/` |
| Shell caching, push, notification taps | `public/sw.js` |
| Server side | `../routes/minibridge/index.js` |

### Storage is localStorage, not OPFS

Two reasons, and the first is the important one:

1. **The crash breadcrumb has to be written synchronously.** When a phone runs
   out of memory the browser kills the page outright — no exception, no unload
   event, no chance to await anything. An async write loses that race, and the
   breadcrumb is the only evidence a crash ever happened.
2. A capped transcript is tens of kilobytes. OPFS earned its complexity for
   hundreds of megabytes of generated documents, which this no longer has, and
   it brought a "this browser can't" screen with it.

Model weights are not in either — web-llm keeps its own cache.

## The crash loop, and why the guard exists

This is the most important thing in the codebase.

**The symptom:** Safari showing *"A problem repeatedly occurred"* and refusing
to load the page at all.

**The mechanism:** the phone runs out of GPU memory bringing the model up. The
browser kills the page. Safari reloads it. MiniBridge, on load, brings the model
up again. Round it goes, and after a few rounds Safari gives up. The page never
survives long enough to be fixed from inside, so no amount of in-app error
handling helps — by the time anything could run, the process is already dead.

**The guard**, in four parts:

1. `markHeavy()` writes a breadcrumb to localStorage *synchronously* before the
   model loads and before each reply, and tears it up after.
2. `forgiveOnLeaving()` also tears it up on `pagehide`.
3. `main.ts` reads it before anything else. A breadcrumb still present means the
   last attempt killed us.
4. On finding one: step down a size, drop the too-heavy weights — **and do not
   bring anything up on this load.** The person taps when they're ready. A
   crash cannot repeat if nothing happens on its own.

Step 2 is not an optimisation, it is what stops the guard punishing normal use.
Replies take a while on a phone and the notification feature exists precisely to
encourage asking something and pocketing the phone — which fires `pagehide`.
Without it, walking away mid-reply looks identical to a crash at the next
launch, and the model steps down a size for no reason at all.

The distinction is exactly right, because **a browser killing the page for
memory does not fire `pagehide`.** Anything that leaves cleanly — closing the
tab, backgrounding on iOS, the OS reclaiming an already-suspended app — is not
the failure this is looking for.

The same guard keeps an ordinary return instant: no breadcrumb means the last
run was fine, so the model resumes by itself.

`scripts/check-crash.mjs` covers both sides, and the crashes in it are **real**:
`chrome://crash` kills the renderer, which has the same shape as an
out-of-memory kill — no exception, no unload, no `pagehide`. Seeding a
breadcrumb and reloading would test the opposite of the thing that matters,
since an ordinary reload *does* fire `pagehide`.

### The three sizes

All general-purpose instruct models — this is a chat, so a code-tuned model
would be the wrong tool however small. `q4f16_1` where WebGPU reports
`shader-f16`, `q4f32_1` otherwise.

| Tier | Model | Context | Default on |
| --- | --- | --- | --- |
| `full` | Llama-3.2-3B-Instruct | 4096 | desktop |
| `pocket` | Llama-3.2-1B-Instruct | 1536 | phones |
| `tiny` | SmolLM2-360M-Instruct | 1024 | a phone that has already died once |

The binding constraint on a phone is the **GPU buffer budget**, not the ~5GB
per-tab memory ceiling. A model can load fine and then die on the first prefill,
which the browser reports as the page crashing rather than as an error anything
can catch. Hence three tiers, an automatic way down, and a manual picker in
Settings — the automatic guess cannot be right for every phone, and the failure
mode is severe enough that people need a way to pre-empt it.

`context_window_size` is trimmed well below the 4096 these ship with. The KV
cache is allocated up front and scales with it, so it is the cheapest memory
saving available, and a pocket conversation does not need a long memory.

## The two things that leave the phone

Both **off** until switched on, both in Settings, both the only exceptions to
everything above.

### The cloud backup

`POST /minibridge/api/chat`. Provider is picked from whichever key the server
has: `GROQ_API_KEY` first, then `GOOGLE_AI_API_KEY`. Nothing is stored server
side.

**Deliberately not streamed.** A stream dies the moment iOS suspends the page,
which is exactly the case the notification exists for. So the reply is finished
server-side regardless of whether the client is still connected, then delivered
by whichever route is still open — the response if the app is watching, a push
if it isn't.

Used only when the device can't answer: no WebGPU, or the local attempt threw.
Every reply records `via: 'device' | 'cloud'` and the transcript prints
*"answered in the cloud"* under any that took the second route. That disclosure
is not decoration — it is what keeps the rest of the privacy claim honest.

### Notifications, and what iOS actually allows

Two mechanisms, because neither covers the whole story:

| | Reaches | Needs |
| --- | --- | --- |
| `registration.showNotification()` from the page | a live-but-backgrounded app | permission only |
| Web Push from the server | a locked phone, app closed | VAPID keys + a subscription |

Platform rules that shape `lib/notify.ts`, none of them choices:

- **Web Push needs iOS 16.4+ and the app on the Home Screen.** In a Safari tab
  there is no `PushManager` at all, so the UI says *"add it to your Home Screen
  first"* rather than offering a switch that silently does nothing.
- **Permission must be requested from a real tap.** Asking on load gets a
  permanent denial with nothing shown, which is why the offer appears only once
  there's a conversation worth being told about.
- **The on-device model cannot finish while the app is suspended.** iOS freezes
  the page within seconds of leaving and generation freezes with it, resuming on
  return. That is the honest limit of the local path, and it is why the cloud
  backup exists for the "ask it and pocket the phone" case. Settings says so in
  as many words.

Server: `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT` in `.env`
(`npx web-push generate-vapid-keys`). Subscriptions live in
`data/minibridge-push.json`, keyed by a client-generated device id tied to
nothing else, gitignored, dropped on 404/410, pruned after 90 days idle.
`GET /minibridge/api/capabilities` reports what the server can actually do, so
the UI never offers a switch that can't work.

## Checking it

Dev-only, all needing `npm i --no-save puppeteer` and the local library prefix
described at the top of `scripts/shots.mjs`. They drive the **built** app on the
already-running server, so build first.

| Script | Covers |
| --- | --- |
| `scripts/check-crash.mjs` | the crash-loop guard: step-down, hold-back, no double-count, healthy resume, failed wake, first open |
| `scripts/check-notify.mjs` | worker registration and scope, `showNotification()`, and the deployed `push` handler driven with real, url-less and malformed payloads |
| `scripts/check-live.mjs` | the real send path end to end — boot, Settings, the cloud toggle, an actual reply — failing on any console error. `APP=https://texflow.work/minibridge/` to run it against production |
| `scripts/shots.mjs` | visual states, to `.shots/` |

`check-live.mjs` is the one that earns its keep. The other two are close enough
to the code to assert whatever the code currently does — both were happily
passing while two screens were dead ends. Driving the app like a person is what
caught it.

### Dead ends, and why they get their own tests

Two states could strand someone with no way forward, and neither threw an error:

- **A failed wake.** `install()` throwing leaves `state()` reporting `'waking'`
  with nothing in flight — so the composer showed an indeterminate spinner, for
  ever. `session.wakeFailed` now distinguishes the two, and the screen offers to
  fetch the weights again. Usually that is all it needs: the browser reclaimed
  them under storage pressure.
- **`navigator.serviceWorker.ready` never settling.** It does not reject — if
  registration fails it simply never resolves. Both callers are on a render
  path, so one failed registration meant Settings never mounted at all. Every
  await of it now goes through `readyWithin()`.

The general shape is worth remembering: on this app the dangerous failures are
the ones that produce *no* error. A crash the browser handles by killing the
page, and a promise that never settles, look identical from inside — nothing to
catch, nothing logged, just a screen that never changes.

## Design

The palette and the type inversion are unchanged from v0.1 — see `tokens.css`
for the full note. In short: a cool offwhite ground, plum accent, and **the app
speaks in a rounded sans while the person speaks in a serif**.

That inversion carries the whole conversation. Your messages are serif and sit
*on* the paper in plum; its replies are sans and are *recessed into* it as
wells, like everything else here. No avatars, no timestamps, no alignment
tricks needed.

### Copy rules

The words "AI", "LLM", "model", "chatbot", "prompt", "machine learning" and
similar **never** appear in any user-facing string — not in labels, loading
states, errors, or tooltips. Code comments and this README are exempt.

The one-time download is "Bring it over". The sizes are "the smallest one", "the
pocket one", "the roomiest one" — never parameter counts.

## What was removed, and why

v0.1 also built small self-contained web pages from a description, and opened
with a face check.

- **The builder** wanted a code-tuned model, which converses badly, so running
  both meant two models and only one could be resident at a time. Dropping it
  removed that whole dance.
- **Smile In** was a face check, not authentication, and said so at length in
  its own docs. It cost ~36MB of MediaPipe wasm plus a 3.7MB landmark model,
  loaded the camera on every open, and guarded a chat that is already behind the
  phone's lock screen. It was also loading *on the chat page*, before you could
  type a word.

Both are in git history if they are ever wanted back. The service worker's
`activate` sweeps the old caches, so their weight comes off existing phones on
the next visit.

## Known gaps

- **Web Push has not been confirmed against a real iPhone.** Everything up to
  that last hop is verified: VAPID signing and `aes128gcm` encryption are
  correct, Apple's push service accepts the signed request, and
  `scripts/check-notify.mjs` drives a real payload into the deployed `sw.js`
  handler. What remains untested is delivery to a physical device with
  MiniBridge on its Home Screen. The "Send a test" row in Settings exists for
  that check.
- **On-device *generation* is unverified.** Headless Chrome with
  `--enable-unsafe-webgpu` does give a working adapter, and the `tiny` model
  loads through it — the whole download-and-initialise path runs for real. But
  generation on that software renderer produced no tokens in five minutes, so
  the streaming reply path has never actually run here. The `pocket` tier does
  not finish loading at all under software rendering.
- **The tier defaults are reasoned from GPU budget, not measured** on a range of
  real phones — which is precisely why the crash guard and the manual size
  picker exist.
- History is trimmed to fit the context window, oldest turns dropped first.
  Summarising would be better, but a model this small, asked to summarise its
  own history, mostly invents one.
