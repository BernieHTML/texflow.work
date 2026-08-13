/* The shared camera moment, used by both enrolling and Smile In.
 *
 * Frames go straight from the camera into the landmarker and are dropped. None
 * is written to disk, drawn to a canvas we keep, or sent anywhere.
 */

import { closeCamera, isSmiling, loadLandmarker, openCamera, read, type Reading } from './face';

export interface CeremonyHandle {
  video: HTMLVideoElement;
  stop: () => void;
}

export type FrameHandler = (reading: Reading) => void;

/**
 * Open the camera and start reading frames.
 *
 * Throws if the camera is unavailable or declined — callers handle that by
 * offering the passcode, never by retrying in a loop.
 */
export async function startCeremony(onFrame: FrameHandler): Promise<CeremonyHandle> {
  const [landmarker, stream] = await Promise.all([loadLandmarker(), openCamera()]);

  const video = document.createElement('video');
  video.playsInline = true;
  video.muted = true;
  video.autoplay = true;
  video.srcObject = stream;

  await new Promise<void>((resolve, reject) => {
    video.onloadedmetadata = () => resolve();
    video.onerror = () => reject(new Error('camera-failed'));
  });
  await video.play();

  let running = true;
  let lastTimestamp = -1;

  const tick = () => {
    if (!running) return;
    // detectForVideo insists on a strictly increasing timestamp.
    const timestamp = Math.max(performance.now(), lastTimestamp + 1);
    lastTimestamp = timestamp;
    if (video.readyState >= 2) {
      try {
        onFrame(read(landmarker, video, timestamp));
      } catch {
        // A single dropped frame is not worth interrupting the moment for.
      }
    }
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);

  return {
    video,
    stop() {
      running = false;
      video.pause();
      video.srcObject = null;
      closeCamera(stream);
    },
  };
}

/**
 * Watch readings until the person has held a smile steadily, then resolve with
 * the samples gathered during the hold.
 *
 * `onProgress` receives 0–1 so the ring can fill.
 */
export function holdSmile(opts: {
  holdMs: number;
  onProgress: (fraction: number) => void;
  onFace: (present: boolean) => void;
}): { handle: FrameHandler; done: Promise<number[][]> } {
  let heldSince = 0;
  let settled = false;
  const samples: number[][] = [];
  let resolveDone!: (samples: number[][]) => void;

  const done = new Promise<number[][]>((resolve) => {
    resolveDone = resolve;
  });

  const handle: FrameHandler = (reading) => {
    if (settled) return;
    opts.onFace(reading.signature !== null);

    const smiling = reading.signature !== null && isSmiling(reading.smile);

    if (!smiling) {
      heldSince = 0;
      samples.length = 0;
      opts.onProgress(0);
      return;
    }

    if (!heldSince) heldSince = performance.now();
    if (reading.signature) samples.push(reading.signature);

    const elapsed = performance.now() - heldSince;
    opts.onProgress(Math.min(1, elapsed / opts.holdMs));

    if (elapsed >= opts.holdMs) {
      settled = true;
      resolveDone(samples.slice());
    }
  };

  return { handle, done };
}
