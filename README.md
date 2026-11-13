# Mirror (AR face paint studio)

- `npm run dev` starts the Vite dev server (camera needs `localhost` or https).
- `npm run build` is the verification step; there are no tests or linter.
- `npm run setup` (runs automatically before dev/build) copies the MediaPipe wasm into `public/mediapipe/wasm` and downloads the face model into `public/models`. Both are gitignored.
- `src/faceMeshData.js` is generated from MediaPipe's `canonical_face_model.obj` (per-vertex UVs + triangles). Don't hand-edit it.
