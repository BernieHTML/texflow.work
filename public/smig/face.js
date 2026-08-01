// The face engine.
//
// Everything in here runs on the device. face-api.js and its weights are served
// from this origin (public/smig/models), so there is no third-party API, no key,
// and no cost — and no photograph is ever uploaded. What leaves the browser is a
// 128-float descriptor plus a happiness score, which the server checks.
//
// The two ceremonies — enrolling and unlocking — are the same shape: hold a
// blank face until the ring fills, then smile until it fills again.

import * as faceapi from './vendor/face-api.esm.js';

const MODEL_URL = '/smig/models';

// Rough byte sizes, used only to weight the loading bar so it moves smoothly.
const WEIGHTS = [
  ['tiny_face_detector_model.bin', 193321],
  ['face_landmark_68_model.bin',   356840],
  ['face_expression_model.bin',    329468],
  ['face_recognition_model.bin',  6444032]
];

const HOLD_MS = 1100;        // how long a reading must stay good
const SAMPLE_MS = 130;       // gap between model passes
const SMILE_AT = 0.66;       // client-side cue thresholds, a little stricter
const BLANK_AT = 0.22;       // than the server's so the server rarely says no

let ready = null;

/** Load the four nets once, reporting 0→1 progress as bytes arrive. */
export function loadModels(onProgress = () => {}) {
  if (ready) return ready;

  ready = (async () => {
    const total = WEIGHTS.reduce((sum, [, bytes]) => sum + bytes, 0);
    let done = 0;

    // Fetch the weights ourselves so the progress bar reflects reality; the
    // loaders below then read straight from the HTTP cache.
    await Promise.all(WEIGHTS.map(async ([file, size]) => {
      try {
        const res = await fetch(`${MODEL_URL}/${file}`);
        const reader = res.body?.getReader();
        if (!reader) { done += size; onProgress(done / total); return; }
        for (;;) {
          const { done: end, value } = await reader.read();
          if (end) break;
          done += value.length;
          onProgress(Math.min(0.99, done / total));
        }
      } catch {
        done += size;
        onProgress(Math.min(0.99, done / total));
      }
    }));

    await Promise.all([
      faceapi.nets.tinyFaceDetector.loadFromUri(MODEL_URL),
      faceapi.nets.faceLandmark68Net.loadFromUri(MODEL_URL),
      faceapi.nets.faceExpressionNet.loadFromUri(MODEL_URL),
      faceapi.nets.faceRecognitionNet.loadFromUri(MODEL_URL)
    ]);
    onProgress(1);
  })();

  return ready;
}

// -------------------------------------------------------------------- camera ---

let stream = null;

export async function startCamera(video) {
  if (!navigator.mediaDevices?.getUserMedia) {
    throw new Error('This browser has no camera access.');
  }
  stream = await navigator.mediaDevices.getUserMedia({
    video: { facingMode: 'user', width: { ideal: 480 }, height: { ideal: 480 } },
    audio: false
  });
  video.srcObject = stream;
  await video.play().catch(() => {});
  // Wait for real pixels — reading a 0×0 video gives nothing back.
  if (!video.videoWidth) {
    await new Promise((resolve) => video.addEventListener('loadeddata', resolve, { once: true }));
  }
  return stream;
}

export function stopCamera(video) {
  stream?.getTracks().forEach((t) => t.stop());
  stream = null;
  if (video) video.srcObject = null;
}

export const cameraOn = () => Boolean(stream);

// --------------------------------------------------------------- one reading ---

const detectorOptions = new faceapi.TinyFaceDetectorOptions({ inputSize: 288, scoreThreshold: 0.45 });

/** A single pass: who is this, and how happy do they look? Null if no face. */
async function readOnce(video) {
  const result = await faceapi
    .detectSingleFace(video, detectorOptions)
    .withFaceLandmarks()
    .withFaceExpressions()
    .withFaceDescriptor();

  if (!result) return null;
  return {
    descriptor: Array.from(result.descriptor),
    happy: result.expressions.happy,
    neutral: result.expressions.neutral,
    size: result.detection.box.width / (video.videoWidth || 1)
  };
}

/** Averaging a few descriptors is noticeably steadier than trusting one. */
function meanDescriptor(list) {
  const out = new Array(128).fill(0);
  for (const d of list) for (let i = 0; i < 128; i++) out[i] += d[i];
  return out.map((v) => v / list.length);
}

// ------------------------------------------------------------- the ceremony ---

/**
 * Run one phase — 'blank' or 'smile' — until the reading has been good for
 * HOLD_MS, then hand back an averaged descriptor.
 *
 * onState is called every pass with { progress, trouble } so the caller can
 * drive the ring and say something useful when it isn't working.
 */
export function capturePhase(video, phase, onState, signal) {
  return new Promise((resolve, reject) => {
    const samples = [];
    let heldSince = 0;
    let happyAtCapture = 0;
    let stopped = false;

    const finish = (fn, arg) => {
      if (stopped) return;
      stopped = true;
      clearTimeout(timer);
      fn(arg);
    };

    signal?.addEventListener('abort', () => finish(reject, new Error('cancelled')), { once: true });

    let timer = 0;
    const step = async () => {
      if (stopped) return;
      let reading = null;
      try {
        reading = await readOnce(video);
      } catch {
        // A dropped frame is not worth failing over; try again next tick.
      }
      if (stopped) return;

      let trouble = null;
      let good = false;

      if (!reading) {
        trouble = 'no-face';
      } else if (reading.size < 0.22) {
        trouble = 'far';
      } else if (phase === 'blank') {
        good = reading.happy <= BLANK_AT;
        if (!good) trouble = 'smiling';
      } else {
        good = reading.happy >= SMILE_AT;
        if (!good) trouble = 'not-smiling';
      }

      if (good) {
        if (!heldSince) heldSince = performance.now();
        samples.push(reading.descriptor);
        if (samples.length > 6) samples.shift();
        happyAtCapture = phase === 'blank'
          ? Math.max(happyAtCapture, reading.happy)   // the worst blank we saw
          : Math.min(happyAtCapture || 1, reading.happy); // the weakest smile
      } else {
        heldSince = 0;
        samples.length = 0;
      }

      const held = heldSince ? performance.now() - heldSince : 0;
      const progress = Math.min(1, held / HOLD_MS);
      onState({ progress, trouble, happy: reading?.happy ?? 0 });

      if (progress >= 1 && samples.length >= 3) {
        return finish(resolve, {
          descriptor: meanDescriptor(samples),
          happy: happyAtCapture
        });
      }
      timer = setTimeout(step, SAMPLE_MS);
    };

    step();
  });
}

/** Human wording for whatever is currently going wrong. */
export function troubleText(trouble, phase) {
  switch (trouble) {
    case 'no-face':     return 'Bring your face into the circle.';
    case 'far':         return 'A little closer.';
    case 'smiling':     return 'Blank face — no smiling yet.';
    case 'not-smiling': return 'Bigger smile than that.';
    default:            return phase === 'blank' ? 'Hold it…' : 'Hold that smile…';
  }
}
