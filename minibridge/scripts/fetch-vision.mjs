/* Fetches the on-device vision assets into public/vision/.
 *
 * These are ~36MB of binaries, so they're reproduced rather than committed.
 * Run once after `npm install`, and again if @mediapipe/tasks-vision is
 * upgraded (the wasm must match the package version).
 *
 * They're served from our own origin rather than a CDN on purpose: the personal
 * check has to work with no network.
 */

import { cp, mkdir, stat, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');
const target = join(root, 'public', 'vision');

const MODEL_URL =
  'https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task';

await mkdir(join(target, 'wasm'), { recursive: true });

// The wasm ships inside the npm package, so it always matches the JS.
await cp(join(root, 'node_modules', '@mediapipe', 'tasks-vision', 'wasm'), join(target, 'wasm'), {
  recursive: true,
});
console.log('wasm  copied from node_modules');

const modelPath = join(target, 'face_landmarker.task');
const existing = await stat(modelPath).catch(() => null);
if (existing && existing.size > 1_000_000) {
  console.log('face_landmarker.task  already present');
} else {
  const response = await fetch(MODEL_URL);
  if (!response.ok) throw new Error(`face_landmarker.task: ${response.status}`);
  await writeFile(modelPath, Buffer.from(await response.arrayBuffer()));
  console.log('face_landmarker.task  downloaded');
}
