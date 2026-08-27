/* Getting a reply onto the phone's lock screen.
 *
 * There are two ways, and MiniBridge uses both because neither covers the whole
 * story on iOS:
 *
 *   LOCAL  - the page is still alive but nobody's looking (you flicked to
 *            another app, or the screen is on but the chat is behind
 *            something). The service worker can post a notification directly,
 *            no server involved. Covers the common case for the on-device
 *            model, which by definition finishes its work on the phone.
 *
 *   PUSH   - the reply is coming from the cloud and the phone might be locked
 *            or the app closed altogether. Only a server holding a VAPID key
 *            can reach a sleeping phone, so that path goes through
 *            routes/minibridge.
 *
 * The hard iOS constraints, because they shape everything here:
 *
 *   - Web Push requires iOS 16.4+ AND the app added to the Home Screen. In
 *     Safari's own tab there is no PushManager at all. So the UI has to be able
 *     to say "add MiniBridge to your Home Screen first" rather than failing.
 *   - Notification.requestPermission() must be called from a real tap. Asking
 *     on load gets you denied permanently with nothing shown.
 *   - The on-device model cannot finish while the app is suspended. iOS freezes
 *     the page within seconds of leaving it, and generation freezes with it,
 *     resuming when you come back. That's why the cloud path exists for the
 *     "ask it and put the phone in your pocket" case, and why the local
 *     notification fires on return rather than during.
 */

const API = '/minibridge/api';

export type PushStatus =
  /** No PushManager: Safari tab on iOS, or an old browser. */
  | 'unsupported'
  /** Supported, but the person hasn't been asked yet. */
  | 'askable'
  /** Asked and refused. Only Settings.app can undo this, not us. */
  | 'denied'
  /** Allowed and subscribed on the server. */
  | 'on';

/** Standalone means launched from the Home Screen. On iOS this is the gate for
 * Web Push existing at all, so it's worth checking separately from support —
 * the advice differs ("add it to your Home Screen" vs "this phone can't"). */
export function isStandalone(): boolean {
  return (
    window.matchMedia('(display-mode: standalone)').matches ||
    // Safari's own, still the only reliable signal for an iOS home-screen app.
    (navigator as { standalone?: boolean }).standalone === true
  );
}

export function pushSupported(): boolean {
  return 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
}

/**
 * `navigator.serviceWorker.ready` never rejects — if registration fails or
 * never happens, it simply never settles. Awaiting it bare means one failed
 * registration hangs whatever asked, and both callers here are on a render
 * path: the boot sequence, and Settings, which would then never mount at all.
 *
 * So it gets a deadline. Missing it means there is no worker to ask, which is
 * the same answer as not being able to.
 */
function readyWithin(ms: number): Promise<ServiceWorkerRegistration | null> {
  return Promise.race([
    navigator.serviceWorker.ready,
    new Promise<null>((resolve) => setTimeout(() => resolve(null), ms)),
  ]);
}

export async function pushStatus(): Promise<PushStatus> {
  if (!pushSupported()) return 'unsupported';
  if (Notification.permission === 'denied') return 'denied';
  if (Notification.permission !== 'granted') return 'askable';

  const registration = await readyWithin(4000);
  if (!registration) return 'unsupported';
  const existing = await registration.pushManager.getSubscription();
  return existing ? 'on' : 'askable';
}

/** VAPID public keys travel as base64url; PushManager wants the raw bytes.
 *
 * Backed by an explicitly constructed ArrayBuffer rather than Uint8Array.from,
 * because applicationServerKey's type excludes the SharedArrayBuffer-backed
 * view that the shorthand infers. */
function decodeKey(base64url: string) {
  const padded = (base64url + '='.repeat((4 - (base64url.length % 4)) % 4))
    .replace(/-/g, '+')
    .replace(/_/g, '/');
  const raw = atob(padded);
  const bytes = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
  return bytes;
}

/**
 * Ask for permission and register this phone with the server.
 *
 * MUST be called from a tap handler. Resolves to the resulting status rather
 * than throwing, because every failure here is something the UI has to explain
 * in words instead of treating as an error.
 */
export async function enablePush(deviceId: string, vapidPublicKey: string): Promise<PushStatus> {
  if (!pushSupported()) return 'unsupported';

  const permission =
    Notification.permission === 'granted' ? 'granted' : await Notification.requestPermission();
  if (permission !== 'granted') return permission === 'denied' ? 'denied' : 'askable';

  try {
    const registration = await readyWithin(4000);
    // No worker means nothing to receive a push. Better to say so than to leave
    // the button sitting on "Asking…" for the rest of the session.
    if (!registration) return 'askable';
    const subscription =
      (await registration.pushManager.getSubscription()) ??
      (await registration.pushManager.subscribe({
        // Non-negotiable on every browser that ships Web Push: no silent pushes.
        userVisibleOnly: true,
        applicationServerKey: decodeKey(vapidPublicKey),
      }));

    const response = await fetch(`${API}/push/subscribe`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ deviceId, subscription: subscription.toJSON() }),
    });
    return response.ok ? 'on' : 'askable';
  } catch {
    return 'askable';
  }
}

export async function disablePush(deviceId: string): Promise<void> {
  try {
    const registration = await readyWithin(4000);
    const subscription = await registration?.pushManager.getSubscription();
    await subscription?.unsubscribe();
  } catch {
    /* the server side below is what actually stops the notifications */
  }
  await fetch(`${API}/push/unsubscribe`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ deviceId }),
  }).catch(() => {});
}

/** Fire one notification back at this phone, so the person can see for
 * themselves that it arrives. Worth having: whether push works depends on
 * things the page genuinely cannot check. */
export async function testPush(deviceId: string): Promise<boolean> {
  const response = await fetch(`${API}/push/test`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ deviceId }),
  }).catch(() => null);
  return Boolean(response?.ok);
}

/** Post a notification from the page's own service worker — no server, no
 * subscription, works the moment permission is granted.
 *
 * Only called when the reply landed while nobody was looking. Notifying someone
 * about something already on the screen in front of them is noise. */
export async function notifyLocally(body: string): Promise<void> {
  if (!('serviceWorker' in navigator) || Notification.permission !== 'granted') return;
  try {
    const registration = await readyWithin(4000);
    if (!registration) return;
    await registration.showNotification('MiniBridge', {
      body: body.slice(0, 240),
      icon: '/minibridge/icon-192.png',
      badge: '/minibridge/icon-192.png',
      // Replaces rather than stacks: one pending reply, one notification.
      tag: 'minibridge-reply',
      data: { url: '/minibridge/' },
    });
  } catch {
    /* notifications are a courtesy, never a requirement */
  }
}
