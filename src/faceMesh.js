import { FACE_TRIANGLES, FACE_UVS } from './faceMeshData.js';

export const BASE_COUNT = FACE_UVS.length / 2;

const HOLES = [
  [33, 7, 163, 144, 145, 153, 154, 155, 133, 173, 157, 158, 159, 160, 161, 246],
  [263, 249, 390, 373, 374, 380, 381, 382, 362, 398, 384, 385, 386, 387, 388, 466],
  [78, 95, 88, 178, 87, 14, 317, 402, 318, 324, 308, 415, 310, 311, 312, 13, 82, 81, 80, 191],
].map((ring) => new Set(ring));

const triangles = [];
for (let i = 0; i < FACE_TRIANGLES.length; i += 3) {
  const [a, b, c] = FACE_TRIANGLES.subarray(i, i + 3);
  if (!HOLES.some((hole) => hole.has(a) && hole.has(b) && hole.has(c))) triangles.push(a, b, c);
}

// The tracked mesh stops short of the hairline and has a hard rim. Two extra rings of vertices are
// extrapolated outward from the face oval (starting at the top of the forehead, going around):
// the first carries paint up over the forehead, the second fades it out to nothing. Below the temples
// the first ring sits on the oval itself, so paint ends at the jawline with only a hairline feather.
const OVAL = [
  10, 338, 297, 332, 284, 251, 389, 356, 454, 323, 361, 288, 397, 365, 379, 378, 400, 377, 152, 148, 176, 149, 150, 136,
  172, 58, 132, 93, 234, 127, 162, 21, 54, 103, 67, 109,
];
const CENTER = 6;
const N = OVAL.length;

// 1 at the top of the forehead, falling to 0 by the temples; the cheeks, jaw and chin are not extended.
const forehead = (k) => Math.max(0, Math.cos((Math.min(k, N - k) / 8) * (Math.PI / 2)));
const reach = (k) => 0.27 * forehead(k);
const feather = (k) => 0.012 + 0.048 * forehead(k);

const EXTENSION = [
  ...OVAL.map((from, k) => ({ from, reach: reach(k) })),
  ...OVAL.map((from, k) => ({ from, reach: reach(k) + feather(k) })),
];

export const VERTEX_COUNT = BASE_COUNT + EXTENSION.length;
export const OUTLINE = OVAL.map((_, k) => BASE_COUNT + k);

for (let k = 0; k < N; k++) {
  const next = (k + 1) % N;
  const [o0, o1] = [OVAL[k], OVAL[next]];
  const [a0, a1] = [BASE_COUNT + k, BASE_COUNT + next];
  const [b0, b1] = [a0 + N, a1 + N];
  triangles.push(o0, o1, a1, o0, a1, a0, a0, a1, b1, a0, b1, b0);
}

export const TRIANGLES = new Uint16Array(triangles);

export const EDGE_WEIGHTS = new Float32Array(VERTEX_COUNT).fill(1);
EDGE_WEIGHTS.fill(0, BASE_COUNT + N);

// Fills in the extrapolated vertices of an interleaved array (`size` components per vertex).
export function extendMesh(array, size) {
  EXTENSION.forEach(({ from, reach: f }, k) => {
    for (let c = 0; c < size; c++) {
      const p = array[from * size + c];
      array[(BASE_COUNT + k) * size + c] = p + (p - array[CENTER * size + c]) * f;
    }
  });
}

export const UVS = new Float32Array(VERTEX_COUNT * 2);
for (let i = 0; i < FACE_UVS.length; i += 2) {
  UVS[i] = 1 - FACE_UVS[i];
  UVS[i + 1] = FACE_UVS[i + 1];
}
extendMesh(UVS, 2);
