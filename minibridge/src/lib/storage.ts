/* On-device storage. Everything here lives in OPFS (Origin Private File
 * System) and never leaves the phone. There is no server side to any of this.
 *
 * Layout:
 *   /identity.json          -> Identity  (Smile In signature + passcode)
 *   /bridges/<id>.json      -> BridgeRecord
 *
 * Note on origin: MiniBridge is served from texflow.work/minibridge, so this
 * OPFS store shares its quota with the rest of texflow.work. That is a known
 * trade-off of the subpath deployment — see README.
 */

/** A Bridge: one thing the person asked for, and the thing that got built.
 *
 * Schema decision: we DO keep `request`, the person's original words. The spec
 * left this open. Storing it costs a few hundred bytes, lets Home show what a
 * Bridge was asked to be, and is the precondition for ever rebuilding or
 * tweaking one. It is the person's own text on their own device. */
export interface BridgeRecord {
  /** crypto.randomUUID() */
  id: string;
  /** Short display name, derived from the request. */
  name: string;
  /** The person's original words, verbatim. */
  request: string;
  /** Epoch milliseconds. */
  createdAt: number;
  /** The complete self-contained HTML document. */
  html: string;
}

/** Identity is the Smile In signature plus the passcode fallback.
 *
 * ENGINEERING HONESTY: `signature` is a geometric descriptor derived from face
 * landmarks. It is NOT a biometric credential and this is NOT authentication.
 * See face.ts for the full note. */
export interface Identity {
  /** Normalised inter-landmark distance vector. No image is ever stored. */
  signature: number[];
  /** PBKDF2-SHA256 of the passcode, hex. */
  passcodeHash: string;
  /** Random per-install salt, hex. */
  passcodeSalt: string;
  enrolledAt: number;
}

let rootPromise: Promise<FileSystemDirectoryHandle> | null = null;

function root(): Promise<FileSystemDirectoryHandle> {
  if (!rootPromise) rootPromise = navigator.storage.getDirectory();
  return rootPromise;
}

export function storageAvailable(): boolean {
  return typeof navigator !== 'undefined' && !!navigator.storage?.getDirectory;
}

async function readJSON<T>(dir: FileSystemDirectoryHandle, name: string): Promise<T | null> {
  try {
    const handle = await dir.getFileHandle(name);
    const file = await handle.getFile();
    const text = await file.text();
    return text ? (JSON.parse(text) as T) : null;
  } catch {
    // Missing file is the normal "not set up yet" case, not an error.
    return null;
  }
}

async function writeJSON(dir: FileSystemDirectoryHandle, name: string, value: unknown): Promise<void> {
  const handle = await dir.getFileHandle(name, { create: true });
  const writable = await handle.createWritable();
  await writable.write(JSON.stringify(value));
  await writable.close();
}

/* ---- Identity --------------------------------------------------------- */

export async function loadIdentity(): Promise<Identity | null> {
  return readJSON<Identity>(await root(), 'identity.json');
}

export async function saveIdentity(identity: Identity): Promise<void> {
  await writeJSON(await root(), 'identity.json', identity);
}

export async function clearIdentity(): Promise<void> {
  try {
    await (await root()).removeEntry('identity.json');
  } catch {
    /* already gone */
  }
}

/* ---- Passcode --------------------------------------------------------- */

const PBKDF2_ITERATIONS = 150_000;

function toHex(buffer: ArrayBuffer): string {
  return [...new Uint8Array(buffer)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export function newSalt(): string {
  return toHex(crypto.getRandomValues(new Uint8Array(16)).buffer);
}

/** Hash a passcode. Cheap to do properly, so we do it properly — even though
 * the passcode guards nothing more sensitive than a grid of small toys. */
export async function hashPasscode(passcode: string, saltHex: string): Promise<string> {
  const encoder = new TextEncoder();
  const salt = Uint8Array.from(saltHex.match(/.{2}/g)!.map((h) => parseInt(h, 16)));
  const key = await crypto.subtle.importKey('raw', encoder.encode(passcode), 'PBKDF2', false, [
    'deriveBits',
  ]);
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt, iterations: PBKDF2_ITERATIONS, hash: 'SHA-256' },
    key,
    256,
  );
  return toHex(bits);
}

export async function verifyPasscode(passcode: string, identity: Identity): Promise<boolean> {
  const candidate = await hashPasscode(passcode, identity.passcodeSalt);
  // Constant-time-ish compare. Lengths are fixed here so this is honest enough.
  if (candidate.length !== identity.passcodeHash.length) return false;
  let diff = 0;
  for (let i = 0; i < candidate.length; i++) {
    diff |= candidate.charCodeAt(i) ^ identity.passcodeHash.charCodeAt(i);
  }
  return diff === 0;
}

/* ---- The magic ---------------------------------------------------------
 *
 * We record for ourselves that the one-time setup completed, rather than trying
 * to detect it by peering into web-llm's cache. web-llm can cache into any of
 * four backends (Cache API, IndexedDB, OPFS, cross-origin), so any check based
 * on one of them reports "not installed" on the others — which stranded people
 * on the install screen forever.
 *
 * If the browser has since evicted the weights, install() simply downloads them
 * again with the normal progress UI. A stale flag costs nothing; a wrong
 * detection cost the whole feature.
 */

export interface MagicState {
  modelId: string;
  installedAt: number;
}

export async function loadMagicState(): Promise<MagicState | null> {
  return readJSON<MagicState>(await root(), 'magic.json');
}

export async function saveMagicState(state: MagicState): Promise<void> {
  await writeJSON(await root(), 'magic.json', state);
}

export async function clearMagicState(): Promise<void> {
  try {
    await (await root()).removeEntry('magic.json');
  } catch {
    /* already gone */
  }
}

/* ---- Bridges ---------------------------------------------------------- */

async function bridgesDir(): Promise<FileSystemDirectoryHandle> {
  return (await root()).getDirectoryHandle('bridges', { create: true });
}

export async function listBridges(): Promise<BridgeRecord[]> {
  const dir = await bridgesDir();
  const out: BridgeRecord[] = [];
  // @ts-expect-error - values() is present in browsers but missing from the DOM lib types.
  for await (const entry of dir.values()) {
    if (entry.kind !== 'file' || !entry.name.endsWith('.json')) continue;
    const record = await readJSON<BridgeRecord>(dir, entry.name);
    if (record) out.push(record);
  }
  return out.sort((a, b) => b.createdAt - a.createdAt);
}

export async function saveBridge(record: BridgeRecord): Promise<void> {
  await writeJSON(await bridgesDir(), `${record.id}.json`, record);
}

export async function deleteBridge(id: string): Promise<void> {
  try {
    await (await bridgesDir()).removeEntry(`${id}.json`);
  } catch {
    /* already gone */
  }
}

/* ---- Storage usage ---------------------------------------------------- */

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
