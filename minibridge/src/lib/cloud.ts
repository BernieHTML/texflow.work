/* The cloud backup.
 *
 * The ONLY code path in MiniBridge that sends anything off the device, and it
 * runs exactly when the person has said it may. Everything about it is written
 * to keep that fact visible rather than convenient: it is off by default, it is
 * named 'cloud' in the transcript, and it is never reached silently.
 *
 * See routes/minibridge/index.js for what happens on the other end. In short:
 * nothing is stored, and the reply is generated in full even if the phone locks
 * mid-request — which is precisely when the notification earns its keep.
 */

import type { Turn } from './engine';

const API = '/minibridge/api';

export interface Capabilities {
  /** The server has a model key, so the backup can actually answer. */
  cloud: boolean;
  /** The server has VAPID keys, so it can notify this phone. */
  push: boolean;
  vapidPublicKey: string | null;
}

let cached: Promise<Capabilities> | null = null;

/** What this server can do for us. Asked once per launch; a MiniBridge served
 * without keys should say so plainly rather than offering switches that do
 * nothing. */
export function capabilities(): Promise<Capabilities> {
  if (!cached) {
    cached = fetch(`${API}/capabilities`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error('unavailable'))))
      .catch(() => ({ cloud: false, push: false, vapidPublicKey: null }));
  }
  return cached;
}

export interface CloudAsk {
  turns: Turn[];
  deviceId: string;
  /** Ask the server to notify this phone when the reply is ready, whether or
   * not we're still here to receive it. */
  notify: boolean;
  signal?: AbortSignal;
}

/**
 * Ask the cloud. Resolves with the whole reply.
 *
 * Not streamed. A stream dies the moment iOS suspends the page, which is
 * exactly the case the notification exists for — so the reply is finished
 * server-side and arrives here whole, or as a notification if we're gone.
 */
export async function askCloud({ turns, deviceId, notify, signal }: CloudAsk): Promise<string> {
  const response = await fetch(`${API}/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ messages: turns, deviceId, notify }),
    signal,
  });

  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error === 'no-cloud' ? 'no-cloud' : 'cloud-failed');
  const reply = String(data.reply || '').trim();
  if (!reply) throw new Error('cloud-failed');
  return reply;
}
