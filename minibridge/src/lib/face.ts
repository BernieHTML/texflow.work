/* "Smile In" — the personal check.
 *
 * ============================ ENGINEERING HONESTY ============================
 * This is a personal gesture-lock. It is NOT secure biometric authentication.
 *
 *   - There is no liveness detection beyond asking for a smile. A photo or a
 *     video of the enrolled person would plausibly pass it.
 *   - There is no secure hardware backing. The signature sits in OPFS as plain
 *     JSON; anything with script access to this origin can read it.
 *   - The comparison is geometric similarity with a hand-tuned tolerance, which
 *     means it both lets in lookalikes and locks out the real person in bad
 *     light. That is why the passcode fallback is mandatory, not optional.
 *
 * Do not gate anything genuinely sensitive behind this. It exists to make
 * opening MiniBridge feel personal, not to keep anyone out. Deliberately not
 * called "Face ID" — that is Apple's trademark and would overstate this by a
 * wide margin.
 * =============================================================================
 *
 * Camera frames are processed in memory for landmark extraction only. No frame
 * is ever written to disk or sent anywhere. What persists is the derived
 * geometry vector below and nothing else.
 */

import { FaceLandmarker, FilesetResolver } from '@mediapipe/tasks-vision';

/** Landmarks chosen for stability across expression: bony/structural points
 * (eye corners, nose bridge, jaw, temples) rather than soft tissue that moves
 * when you smile — since we're asking the person to smile while we measure. */
const ANCHORS = [
  33, // right eye outer corner
  133, // right eye inner corner
  362, // left eye inner corner
  263, // left eye outer corner
  168, // nose bridge, between the eyes
  1, // nose tip
  234, // right temple
  454, // left temple
  152, // chin point
  10, // forehead centre
  61, // mouth corner, right
  291, // mouth corner, left
];

/** Average of the two mouth-smile blendshapes must clear this to count as a
 * smile. MediaPipe's smile scores run low, so this is not as lax as it looks.
 * Tuned by hand — worth revisiting on real devices in real light. */
const SMILE_THRESHOLD = 0.34;

/** Max RMS distance between normalised signatures to count as the same person.
 * Deliberately generous: a false reject sends someone to the passcode, which is
 * a small annoyance, and this is not a security boundary to begin with. */
const MATCH_TOLERANCE = 0.19;

let landmarkerPromise: Promise<FaceLandmarker> | null = null;

/** Load the landmarker. WASM and the .task model are both served from this
 * origin (see public/vision/), so this works with no network once cached. */
export function loadLandmarker(): Promise<FaceLandmarker> {
  if (landmarkerPromise) return landmarkerPromise;
  landmarkerPromise = (async () => {
    const fileset = await FilesetResolver.forVisionTasks('/minibridge/vision/wasm');
    return FaceLandmarker.createFromOptions(fileset, {
      baseOptions: {
        modelAssetPath: '/minibridge/vision/face_landmarker.task',
        delegate: 'GPU',
      },
      runningMode: 'VIDEO',
      numFaces: 1,
      outputFaceBlendshapes: true,
      outputFacialTransformationMatrixes: false,
    });
  })().catch((err) => {
    landmarkerPromise = null;
    throw err;
  });
  return landmarkerPromise;
}

export interface Reading {
  /** 0–1, how much of a smile is happening. */
  smile: number;
  /** Normalised geometry vector, or null if no face was found. */
  signature: number[] | null;
}

/**
 * Turn one frame into a reading.
 *
 * The signature is a Procrustes-style normalisation: the anchor points are made
 * isotropic, centred on the eye midpoint, rotated so the eye line is level, and
 * scaled so the inter-ocular distance is 1. That makes it reasonably stable
 * against how far away you hold the phone and how much you tilt your head —
 * which is most of what varies between one unlock and the next.
 */
export function read(
  landmarker: FaceLandmarker,
  video: HTMLVideoElement,
  timestampMs: number,
): Reading {
  const result = landmarker.detectForVideo(video, timestampMs);
  const face = result.faceLandmarks?.[0];
  if (!face) return { smile: 0, signature: null };

  let smile = 0;
  const categories = result.faceBlendshapes?.[0]?.categories;
  if (categories) {
    const left = categories.find((c) => c.categoryName === 'mouthSmileLeft')?.score ?? 0;
    const right = categories.find((c) => c.categoryName === 'mouthSmileRight')?.score ?? 0;
    smile = (left + right) / 2;
  }

  return { smile, signature: normalise(face, video.videoWidth / video.videoHeight) };
}

type Point = { x: number; y: number };

function normalise(face: Array<{ x: number; y: number }>, aspect: number): number[] | null {
  const pts: Point[] = ANCHORS.map((i) => {
    const p = face[i];
    // Landmarks are normalised to [0,1] against differing pixel dimensions, so
    // x has to be rescaled by the aspect ratio before any distance is metric.
    return { x: p.x * aspect, y: p.y };
  });
  if (pts.some((p) => !Number.isFinite(p.x) || !Number.isFinite(p.y))) return null;

  const rightEye = pts[0];
  const leftEye = pts[3];
  const cx = (rightEye.x + leftEye.x) / 2;
  const cy = (rightEye.y + leftEye.y) / 2;

  const dx = leftEye.x - rightEye.x;
  const dy = leftEye.y - rightEye.y;
  const scale = Math.hypot(dx, dy);
  if (scale < 1e-6) return null;

  // Rotate by -theta so the eye line lands horizontal.
  const theta = Math.atan2(dy, dx);
  const cos = Math.cos(-theta);
  const sin = Math.sin(-theta);

  const out: number[] = [];
  for (const p of pts) {
    const ox = (p.x - cx) / scale;
    const oy = (p.y - cy) / scale;
    out.push(ox * cos - oy * sin, ox * sin + oy * cos);
  }
  return out;
}

export function isSmiling(smile: number): boolean {
  return smile >= SMILE_THRESHOLD;
}

/** RMS distance between two signatures. Lower is more similar. */
export function distance(a: number[], b: number[]): number {
  if (a.length !== b.length || a.length === 0) return Infinity;
  let sum = 0;
  for (let i = 0; i < a.length; i++) sum += (a[i] - b[i]) ** 2;
  return Math.sqrt(sum / a.length);
}

export function matches(candidate: number[], enrolled: number[]): boolean {
  return distance(candidate, enrolled) <= MATCH_TOLERANCE;
}

/** Average several readings into one signature, to take the edge off frame
 * noise during enrolment. */
export function averageSignatures(samples: number[][]): number[] | null {
  if (!samples.length) return null;
  const len = samples[0].length;
  const out = new Array<number>(len).fill(0);
  for (const s of samples) {
    if (s.length !== len) return null;
    for (let i = 0; i < len; i++) out[i] += s[i];
  }
  return out.map((v) => v / samples.length);
}

/** Open the front camera. Throws if the person declines — callers fall back to
 * the passcode rather than retrying forever. */
export async function openCamera(): Promise<MediaStream> {
  return navigator.mediaDevices.getUserMedia({
    video: { facingMode: 'user', width: { ideal: 640 }, height: { ideal: 480 } },
    audio: false,
  });
}

export function closeCamera(stream: MediaStream | null): void {
  stream?.getTracks().forEach((t) => t.stop());
}
