// Taking a picture — the camera overlay, and the shrinking that happens before
// anything is sent.
//
// The shape of it is borrowed from the camera apps everyone already knows: the
// viewfinder fills the screen, one big shutter, the library and the flip either
// side of it. What is deliberately *not* borrowed is the disappearing. A photo
// sent on smig is a message like any other — it sits in the conversation, it
// can be scrolled back to, and nobody is timing you.
//
// Everything is resized and re-encoded here rather than on the server: there is
// no image library on the box, and a 12 MP phone photo has no business crossing
// the network when 1600px is more than the app will ever show.

import { $, el, icon, toast } from './ui.js';

const MAX_EDGE = 1600;        // longest side of a photo message
const AVATAR_EDGE = 256;      // profile pictures are only ever shown small
// Comfortably under the server's ceiling, with room for the base64 third.
const TARGET_BYTES = 900 * 1024;
const QUALITIES = [0.85, 0.75, 0.66, 0.56, 0.45];

/** Bytes behind a data URL, without building a Blob to find out. */
function weigh(dataUrl) {
  const comma = dataUrl.indexOf(',') + 1;
  const padding = dataUrl.endsWith('==') ? 2 : dataUrl.endsWith('=') ? 1 : 0;
  return Math.floor(((dataUrl.length - comma) * 3) / 4) - padding;
}

/**
 * Draw whatever we were given into a canvas of the right size and squeeze the
 * quality down until it fits. Two passes at most: if the softest quality is
 * still too heavy the picture is simply too detailed, so halve it and retry.
 */
function encode(source, sw, sh, sx, sy, width, height) {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;

  const ctx = canvas.getContext('2d');
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(source, sx, sy, sw, sh, 0, 0, width, height);

  for (const quality of QUALITIES) {
    const image = canvas.toDataURL('image/jpeg', quality);
    if (weigh(image) <= TARGET_BYTES) return { image, width, height };
  }
  if (width > 640) return encode(source, sw, sh, sx, sy, Math.round(width / 2), Math.round(height / 2));
  return { image: canvas.toDataURL('image/jpeg', 0.4), width, height };
}

/** Centre-crop to a square — how a round avatar wants to be fed. */
function squareFrom(source, naturalWidth, naturalHeight) {
  const side = Math.min(naturalWidth, naturalHeight);
  return encode(
    source, side, side,
    (naturalWidth - side) / 2, (naturalHeight - side) / 2,
    AVATAR_EDGE, AVATAR_EDGE
  );
}

/** Fit inside MAX_EDGE, keeping the shape it came in with. */
function fitFrom(source, naturalWidth, naturalHeight) {
  const scale = Math.min(1, MAX_EDGE / Math.max(naturalWidth, naturalHeight));
  return encode(
    source, naturalWidth, naturalHeight, 0, 0,
    Math.max(1, Math.round(naturalWidth * scale)),
    Math.max(1, Math.round(naturalHeight * scale))
  );
}

function decodeFile(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => { URL.revokeObjectURL(url); resolve(img); };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('That picture could not be read.')); };
    img.src = url;
  });
}

/** A file off the picker, ready to send. */
export async function fromFile(file, { square = false } = {}) {
  if (!file.type.startsWith('image/')) throw new Error('That needs to be a picture.');
  const img = await decodeFile(file);
  return square
    ? squareFrom(img, img.naturalWidth, img.naturalHeight)
    : fitFrom(img, img.naturalWidth, img.naturalHeight);
}

// ------------------------------------------------------------------ camera ---

let stream = null;
let facing = 'environment';
let settle = null;      // resolve of the promise handed back by openCamera
let picker = null;      // the hidden file input belonging to the open session

function stopCamera() {
  stream?.getTracks().forEach((track) => track.stop());
  stream = null;
  const video = $('#snap-cam');
  if (video) video.srcObject = null;
}

async function startCamera() {
  stopCamera();
  stream = await navigator.mediaDevices.getUserMedia({
    video: { facingMode: facing, width: { ideal: 1920 } },
    audio: false
  });
  const video = $('#snap-cam');
  video.srcObject = stream;
  // The front camera is a mirror, because that is how people read their own
  // face. What gets saved is the unmirrored frame — the way everyone else
  // sees them, and the way the rear camera and the picker both behave.
  video.classList.toggle('mirror', facing === 'user');
  await video.play().catch(() => {});
}

function close(result) {
  stopCamera();
  $('#snap-layer').classList.remove('is-live');
  $('#snap-layer').hidden = true;
  picker?.remove();
  picker = null;
  const done = settle;
  settle = null;
  done?.(result);
}

/**
 * Open the viewfinder. Resolves with `{ image, width, height, caption }` once
 * they send, or `null` if they back out. `square` crops for an avatar and drops
 * the caption; `caption` offers the line of text that rides along with a photo.
 */
export function openCamera({ square = false, caption = false, sendLabel = 'Send' } = {}) {
  // Only ever one viewfinder; a second request backs the first one out rather
  // than leaving its promise hanging forever.
  if (settle) close(null);

  const layer = $('#snap-layer');
  const stage = $('#snap-stage');
  const video = $('#snap-cam');
  const still = $('#snap-still');
  const controls = $('#snap-controls');
  const captionRow = $('#snap-caption-row');
  const captionInput = $('#snap-caption');

  let shot = null;

  const input = el('input', { type: 'file', accept: 'image/*', class: 'hidden' });
  picker = input;
  input.addEventListener('change', async () => {
    const file = input.files?.[0];
    input.value = '';
    if (!file) return;
    try {
      review(await fromFile(file, { square }));
    } catch (e) {
      toast(e.message || 'That picture could not be read.', 'bad');
    }
  });

  // ---- the two faces of the overlay: viewfinder, then what you just took

  function viewfinder() {
    shot = null;
    still.hidden = true;
    still.removeAttribute('src');
    video.hidden = false;
    stage.classList.remove('reviewing');
    captionRow.classList.add('hidden');

    controls.replaceChildren(
      el('button', { class: 'snap-side', 'aria-label': 'Choose a picture', onclick: () => input.click() },
        icon('i-image')),
      el('button', { class: 'shutter', 'aria-label': 'Take the picture', onclick: capture }),
      el('button', {
        class: 'snap-side', 'aria-label': 'Flip the camera',
        onclick: async () => {
          facing = facing === 'user' ? 'environment' : 'user';
          try { await startCamera(); } catch { toast('That camera would not open.', 'bad'); }
        }
      }, icon('i-flip'))
    );
  }

  function review(result) {
    shot = result;
    still.src = result.image;
    still.hidden = false;
    video.hidden = true;
    stage.classList.add('reviewing');
    stopCamera();

    if (caption && !square) {
      captionRow.classList.remove('hidden');
      captionInput.value = '';
    }

    controls.replaceChildren(
      el('button', { class: 'snap-text', onclick: () => { viewfinder(); startCamera().catch(() => {}); } }, 'Retake'),
      el('button', { class: 'snap-send', onclick: send }, sendLabel)
    );
  }

  function capture() {
    if (!video.videoWidth) return toast('The camera is still waking up.', 'bad');
    const w = video.videoWidth;
    const h = video.videoHeight;
    review(square ? squareFrom(video, w, h) : fitFrom(video, w, h));
  }

  function send() {
    if (!shot) return;
    close({ ...shot, caption: caption && !square ? captionInput.value.trim() : '' });
  }

  layer.append(input);
  viewfinder();
  layer.hidden = false;
  layer.classList.add('is-live');

  startCamera().catch((e) => {
    // No camera, or no permission for it. The picker still works, so go
    // straight there rather than leaving them looking at a black rectangle.
    toast(e.name === 'NotAllowedError'
      ? 'smig needs the camera. You can choose a picture instead.'
      : 'No camera here — choose a picture instead.', 'bad');
    input.click();
  });

  return new Promise((resolve) => {
    settle = resolve;
    $('#snap-close').onclick = () => close(null);
  });
}

/** Whether the overlay is up — the back button needs to know. */
export const cameraOpen = () => Boolean(settle);

/** Back out of the camera without sending. */
export const cancelCamera = () => close(null);
