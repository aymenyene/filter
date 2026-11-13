import { cp, mkdir, stat, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const wasmSrc = resolve(root, 'node_modules/@mediapipe/tasks-vision/wasm');
const wasmDst = resolve(root, 'public/mediapipe/wasm');
const modelDst = resolve(root, 'public/models/face_landmarker.task');
const MODEL_URL =
  'https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task';

await mkdir(wasmDst, { recursive: true });
await cp(wasmSrc, wasmDst, { recursive: true });

const hasModel = await stat(modelDst).then((s) => s.size > 1_000_000, () => false);
if (!hasModel) {
  console.log('Downloading face landmarker model...');
  try {
    const res = await fetch(MODEL_URL);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    await mkdir(dirname(modelDst), { recursive: true });
    await writeFile(modelDst, Buffer.from(await res.arrayBuffer()));
  } catch (err) {
    console.warn(`Could not download the model (${err.message}). The app will fall back to loading it from the CDN.`);
  }
}
