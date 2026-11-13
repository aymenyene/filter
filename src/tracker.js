import { FaceLandmarker, FilesetResolver } from '@mediapipe/tasks-vision';

const BASE = import.meta.env.BASE_URL;
const WASM_PATH = `${BASE}mediapipe/wasm`;
const MODEL_URLS = [
  `${BASE}models/face_landmarker.task`,
  'https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task',
];

export class AppError extends Error {
  constructor(title, message, cause) {
    super(message);
    this.title = title;
    this.detail = cause ? `${cause.name || 'Error'}: ${cause.message || cause}` : '';
  }
}

export function withTimeout(promise, ms, makeError) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(makeError()), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

const CAMERA_ERRORS = {
  NotAllowedError: [
    'Camera permission denied',
    'Allow camera access for this site in your browser (and in your OS privacy settings), then try again.',
  ],
  SecurityError: ['Camera blocked', 'The browser blocked camera access for this page. Check site permissions and try again.'],
  NotFoundError: ['No camera found', 'Connect a webcam and try again.'],
  NotReadableError: [
    'Camera is unavailable',
    'The camera could not be started. It may be in use by another app or tab. Close it and try again.',
  ],
  OverconstrainedError: ['Camera not supported', 'No camera matches the requested video settings.'],
  AbortError: ['Camera failed to start', 'The camera start was interrupted. Try again.'],
};

export async function startCamera(video) {
  if (!navigator.mediaDevices?.getUserMedia) {
    throw new AppError(
      'Camera API unavailable',
      window.isSecureContext
        ? 'This browser does not support webcam access.'
        : 'Webcam access requires a secure context. Open the app over https:// or http://localhost.',
    );
  }

  let stream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      audio: false,
      video: { facingMode: 'user', width: { ideal: 1280 }, height: { ideal: 720 }, frameRate: { ideal: 60 } },
    });
  } catch (err) {
    const [title, message] = CAMERA_ERRORS[err.name] || ['Camera error', 'The camera could not be started.'];
    throw new AppError(title, message, err);
  }

  try {
    video.srcObject = stream;
    await withTimeout(
      new Promise((resolve, reject) => {
        if (video.readyState >= 1) return resolve();
        video.addEventListener('loadedmetadata', resolve, { once: true });
        video.addEventListener('error', () => reject(video.error || new Error('Video element error')), { once: true });
      }),
      10000,
      () => new Error('Timed out waiting for the first video frame'),
    );
    await video.play();
    if (!video.videoWidth || !video.videoHeight) throw new Error('Camera reported a 0x0 video size');
  } catch (err) {
    stopCamera(video);
    throw new AppError('Camera stream failed', 'The camera was opened but did not deliver video.', err);
  }
  return stream;
}

export function stopCamera(video) {
  video.srcObject?.getTracks().forEach((track) => track.stop());
  video.srcObject = null;
}

async function fetchModel() {
  const failures = [];
  for (const url of MODEL_URLS) {
    try {
      const res = await fetch(url);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      if ((res.headers.get('content-type') || '').includes('text/html')) throw new Error('file not found');
      return new Uint8Array(await res.arrayBuffer());
    } catch (err) {
      failures.push(`${url} (${err.message})`);
    }
  }
  throw new AppError(
    'Face model download failed',
    'The face tracking model could not be downloaded. Check your network connection, or run "npm run setup" to fetch it locally.',
    new Error(failures.join('\n')),
  );
}

async function createFaceLandmarker(onStatus) {
  onStatus('Downloading model');
  const modelAssetBuffer = await fetchModel();

  onStatus('Loading runtime');
  let fileset;
  try {
    fileset = await FilesetResolver.forVisionTasks(WASM_PATH);
  } catch (err) {
    throw new AppError('Face tracking runtime failed', 'The MediaPipe WebAssembly runtime could not be loaded.', err);
  }

  onStatus('Initializing');
  let lastError;
  for (const delegate of ['GPU', 'CPU']) {
    try {
      return await FaceLandmarker.createFromOptions(fileset, {
        baseOptions: { modelAssetBuffer: modelAssetBuffer.slice(), delegate },
        runningMode: 'VIDEO',
        numFaces: 1,
        minFaceDetectionConfidence: 0.3,
        minFacePresenceConfidence: 0.3,
        minTrackingConfidence: 0.3,
      });
    } catch (err) {
      lastError = err;
      console.warn(`FaceLandmarker failed to initialize with ${delegate} delegate`, err);
    }
  }
  throw new AppError(
    'Face model failed to initialize',
    'The face tracking model was downloaded but could not be started on this device (GPU and CPU were both tried).',
    lastError,
  );
}

export function loadFaceLandmarker(onStatus) {
  return withTimeout(
    createFaceLandmarker(onStatus),
    60000,
    () =>
      new AppError(
        'Face model timed out',
        'Loading the face tracking model took longer than 60 seconds. Check your network connection and try again.',
      ),
  );
}
