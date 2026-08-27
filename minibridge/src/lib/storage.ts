/* On-device storage. Everything here stays on the phone.
 *
 * localStorage, not OPFS. Two reasons, and the first is the important one:
 *
 *   1. The crash breadcrumb has to be written SYNCHRONOUSLY. When a phone runs
 *      out of memory the browser kills the page outright — no exception, no
 *      unload event, no chance to await anything. An async write loses the race
 *      and the breadcrumb is the only evidence a crash ever happened.
 *   2. A capped chat transcript is tens of kilobytes. OPFS earns its complexity
 *      for hundreds of megabytes of generated documents, which this no longer
 *      has, and it brought a "this browser can't" screen with it.
 *
 * Model weights are NOT here. web-llm keeps its own cache and doing it twice
 * would double several hundred megabytes on the device.
 */

const KEY = {
  chat: 'mb.chat',
  prefs: 'mb.prefs',
  device: 'mb.device',
  model: 'mb.model',
  /** Written before the heavy part, torn up after. See takeBreadcrumb(). */
  loading: 'mb.loading',
} as const;

function read<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    // Corrupt or unavailable. Behaving as if empty is always safer here than
    // throwing on boot.
    return fallback;
  }
}

function write(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Quota, or Safari private mode. Losing a preference is survivable; taking
    // the app down over it is not.
  }
}

function drop(key: string): void {
  try {
    localStorage.removeItem(key);
  } catch {
    /* nothing to do */
  }
}

/* ---- The conversation --------------------------------------------------- */

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  at: number;
  /** Where an assistant message came from. Shown in the UI, because "this one
   * left your phone" is not something to leave someone guessing about. */
  via?: 'device' | 'cloud';
}

/** Old turns fall off the end. The model only ever sees the last handful
 * anyway, and an unbounded transcript in localStorage eventually throws. */
const KEEP = 60;

export function loadChat(): ChatMessage[] {
  return read<ChatMessage[]>(KEY.chat, []);
}

export function saveChat(messages: ChatMessage[]): void {
  write(KEY.chat, messages.slice(-KEEP));
}

export function clearChat(): void {
  drop(KEY.chat);
}

/* ---- Preferences --------------------------------------------------------
 *
 * Both switches are OFF until turned on, and they are the only things in
 * MiniBridge that can cause anything to leave the device.
 */

export interface Prefs {
  /** Fall back to the cloud when the device can't answer. */
  cloud: boolean;
  /** Notify this phone when a reply lands and you're not looking. */
  notify: boolean;
  /** Ours, not the browser's — the key the server files this phone's push
   * subscription under. A random id tied to nothing else. */
  deviceId: string;
}

export function loadPrefs(): Prefs {
  const stored = read<Partial<Prefs>>(KEY.prefs, {});
  const prefs: Prefs = {
    cloud: stored.cloud === true,
    notify: stored.notify === true,
    deviceId: stored.deviceId || crypto.randomUUID(),
  };
  // Settle the id on first read. Minted fresh each launch, the server would
  // file a new subscription every time and keep notifying the old ones.
  if (!stored.deviceId) savePrefs(prefs);
  return prefs;
}

export function savePrefs(prefs: Prefs): void {
  write(KEY.prefs, prefs);
}

/* ---- What this phone can take -------------------------------------------
 *
 * 'full'   - the roomiest model. Desktops.
 * 'pocket' - the phone default. Holds a real conversation.
 * 'tiny'   - where a phone lands after it has died once. Simple, but it runs.
 */

export type Tier = 'full' | 'pocket' | 'tiny';

export interface DeviceProfile {
  tier: Tier;
  /** Times a load or a reply took the whole page down. */
  crashes: number;
  /** Set when the person picked a tier themselves, so we stop guessing. */
  chosen?: boolean;
}

export function loadDevice(): DeviceProfile | null {
  return read<DeviceProfile | null>(KEY.device, null);
}

export function saveDevice(profile: DeviceProfile): void {
  write(KEY.device, profile);
}

/* ---- The installed model ------------------------------------------------
 *
 * We record for ourselves that the download completed, rather than peering into
 * web-llm's cache — it can cache into any of four backends, so a check based on
 * one reports "not installed" on the others.
 */

export interface InstalledModel {
  modelId: string;
  installedAt: number;
}

export function loadModel(): InstalledModel | null {
  return read<InstalledModel | null>(KEY.model, null);
}

export function saveModel(model: InstalledModel): void {
  write(KEY.model, model);
}

export function clearModel(): void {
  drop(KEY.model);
}

/* ---- Crash detection ----------------------------------------------------
 *
 * Loading a model onto the GPU and generating from it are the only things this
 * app does that can exhaust a phone. When that happens the browser kills the
 * page — from inside, indistinguishable from the app simply restarting. Safari
 * then reloads, we do the same heavy thing again, and after a few rounds it
 * gives up with "A problem repeatedly occurred".
 *
 * So: drop a breadcrumb before the heavy part, tear it up after. One still
 * there at boot means the last attempt killed us, and the app can step down
 * and — crucially — NOT immediately try the same thing again.
 */

export type HeavyStep = 'loading' | 'replying';

export function markHeavy(step: HeavyStep): void {
  write(KEY.loading, { step, at: Date.now() });
}

export function clearHeavy(): void {
  drop(KEY.loading);
}

/** Read and clear in one go. Returns what we were doing when the page died. */
export function takeBreadcrumb(): HeavyStep | null {
  const note = read<{ step: HeavyStep } | null>(KEY.loading, null);
  clearHeavy();
  return note?.step ?? null;
}

/**
 * Tear up the breadcrumb when the page goes away in the ordinary way.
 *
 * Without this the guard punishes normal use. Replies take a while on a phone,
 * and the whole notification feature exists to encourage asking something and
 * putting the phone in your pocket — which fires `pagehide`, leaves the
 * breadcrumb sitting there, and gets diagnosed at the next launch as a crash
 * that never happened. The model would step down a size for no reason.
 *
 * The distinction is exactly right: a browser killing the page for memory does
 * NOT fire `pagehide`, so a genuine crash still leaves its breadcrumb. Anything
 * that leaves cleanly — closing the tab, backgrounding on iOS, the OS reclaiming
 * an already-suspended app — is not the failure this guard is looking for.
 */
export function forgiveOnLeaving(): void {
  window.addEventListener('pagehide', clearHeavy);
}

/* ---- Room --------------------------------------------------------------- */

/** Ask the browser to keep our data around. Best-effort; Safari may decline. */
export async function requestPersistence(): Promise<boolean> {
  if (!navigator.storage?.persist) return false;
  try {
    if (await navigator.storage.persisted()) return true;
    return await navigator.storage.persist();
  } catch {
    return false;
  }
}

export interface Usage {
  usedBytes: number;
  quotaBytes: number;
}

export async function storageUsage(): Promise<Usage | null> {
  if (!navigator.storage?.estimate) return null;
  const { usage = 0, quota = 0 } = await navigator.storage.estimate();
  return { usedBytes: usage, quotaBytes: quota };
}

/** Human-friendly size. Deliberately coarse — Settings shows roughly how much
 * room things take, not a byte-accurate audit. */
export function describeSize(bytes: number): string {
  if (bytes < 1024 * 1024) return 'less than a megabyte';
  const mb = bytes / (1024 * 1024);
  if (mb < 1024) return `about ${Math.round(mb)} MB`;
  return `about ${(mb / 1024).toFixed(1)} GB`;
}
