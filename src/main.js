import { ARMirror } from './mirror.js';
import { TextureStudio } from './paint.js';
import { PRESETS } from './presets.js';
import { AppError, loadFaceLandmarker, startCamera, stopCamera } from './tracker.js';

const $ = (id) => document.getElementById(id);

const video = $('video');
const state = { stream: null, landmarker: null, mirror: null, raf: 0 };

const studio = new TextureStudio({
  canvas: $('paint'),
  guide: $('guide'),
  cursor: $('cursor'),
  onChange: () => state.mirror?.paintChanged(),
  onHistory: syncHistoryButtons,
});

function syncHistoryButtons() {
  $('undo').disabled = !studio.undoStack.length;
  $('redo').disabled = !studio.redoStack.length;
}
syncHistoryButtons();

// ---------- Studio controls ----------

const sliders = {
  size: { format: (v) => `${v}px`, apply: (v) => ({ size: v }) },
  strength: { format: (v) => `${v}%`, apply: (v) => ({ strength: v / 100 }) },
  softness: { format: (v) => `${v}%`, apply: (v) => ({ softness: v / 100 }) },
};

for (const [id, { format, apply }] of Object.entries(sliders)) {
  const input = $(id);
  const sync = () => {
    $(`${id}-out`).textContent = format(input.value);
    studio.setBrush(apply(Number(input.value)));
  };
  input.addEventListener('input', sync);
  sync();
}

function setTool(eraser) {
  studio.setBrush({ eraser });
  $('tool-brush').classList.toggle('active', !eraser);
  $('tool-eraser').classList.toggle('active', eraser);
}

function setColor(color) {
  $('color').value = color;
  studio.setBrush({ color });
  setTool(false);
  for (const swatch of $('swatches').querySelectorAll('button')) {
    swatch.classList.toggle('active', swatch.dataset.color === color);
  }
}

$('tool-brush').addEventListener('click', () => setTool(false));
$('tool-eraser').addEventListener('click', () => setTool(true));
$('color').addEventListener('input', (e) => setColor(e.target.value));
$('symmetry').addEventListener('change', (e) => studio.setBrush({ symmetry: e.target.checked }));
$('undo').addEventListener('click', () => studio.undo());
$('redo').addEventListener('click', () => studio.redo());
$('clear').addEventListener('click', () => studio.clear());

for (const { group, looks } of PRESETS) {
  const optgroup = document.createElement('optgroup');
  optgroup.label = group;
  for (const look of looks) optgroup.append(new Option(look.name, look.id));
  $('preset').append(optgroup);
}

$('preset').addEventListener('change', (e) => {
  const look = PRESETS.flatMap((g) => g.looks).find((l) => l.id === e.target.value);
  e.target.value = '';
  if (!look) return;
  studio.applyPreset(look.draw);
  $('blend').value = look.blend;
  state.mirror?.setBlendMode(look.blend);
});

for (const color of ['#ffffff', '#c2185b', '#b3261e', '#e8743b', '#7b4a2d', '#1c1c1c']) {
  const swatch = document.createElement('button');
  swatch.type = 'button';
  swatch.style.background = color;
  swatch.dataset.color = color;
  swatch.title = color;
  swatch.addEventListener('click', () => setColor(color));
  $('color').before(swatch);
}
setColor($('color').value);

window.addEventListener('keydown', (e) => {
  if (!(e.metaKey || e.ctrlKey)) return;
  const key = e.key.toLowerCase();
  if (key !== 'z' && key !== 'y') return;
  e.preventDefault();
  if (key === 'y' || e.shiftKey) studio.redo();
  else studio.undo();
});

// ---------- Mirror controls ----------

$('blend').addEventListener('change', (e) => state.mirror?.setBlendMode(Number(e.target.value)));
$('show-mesh').addEventListener('change', (e) => state.mirror?.setShowMesh(e.target.checked));

// ---------- Loading screen ----------

const loading = {
  show() {
    $('loading').hidden = false;
  },
  hide() {
    $('loading').hidden = true;
  },
  begin() {
    $('errors').replaceChildren();
    $('errors').hidden = true;
    $('retry').hidden = true;
    $('spinner').hidden = false;
    $('loading-title').textContent = 'Mirror';
    $('loading-title').classList.remove('failed');
    this.show();
  },
  step(name, stepState, status) {
    const li = $(`step-${name}`);
    li.dataset.state = stepState;
    li.querySelector('.status').textContent = status;
  },
  fail(errors) {
    $('spinner').hidden = true;
    $('loading-title').textContent = 'Something went wrong';
    $('loading-title').classList.add('failed');
    $('errors').replaceChildren(
      ...errors.map((err) => {
        const box = document.createElement('div');
        box.className = 'error';
        const title = document.createElement('strong');
        title.textContent = err.title || 'Unexpected error';
        const message = document.createElement('p');
        message.textContent = err.message || String(err);
        box.append(title, message);
        const detail = err.detail ?? (err instanceof AppError ? '' : err.stack);
        if (detail) {
          const code = document.createElement('code');
          code.textContent = detail;
          box.append(code);
        }
        return box;
      }),
    );
    $('errors').hidden = false;
    $('retry').hidden = false;
    this.show();
  },
};

async function runStep(name, activeStatus, task) {
  loading.step(name, 'active', activeStatus);
  try {
    const result = await task();
    loading.step(name, 'ok', 'Ready');
    return result;
  } catch (err) {
    loading.step(name, 'error', 'Failed');
    throw err;
  }
}

function initCamera() {
  if (state.stream) return state.stream;
  return runStep('camera', 'Waiting for permission', async () => {
    const stream = await startCamera(video);
    stream.getVideoTracks()[0].addEventListener('ended', () => {
      fatal(
        'camera',
        new AppError('Camera disconnected', 'The camera stream ended. Reconnect the camera or re-enable access, then try again.'),
      );
    });
    $('mirror').parentElement.style.aspectRatio = `${video.videoWidth} / ${video.videoHeight}`;
    return stream;
  });
}

function initModel() {
  if (state.landmarker) return state.landmarker;
  return runStep('model', 'Loading', () => loadFaceLandmarker((status) => loading.step('model', 'active', status)));
}

function initRenderer() {
  if (state.mirror) return state.mirror;
  return runStep('renderer', 'Starting', async () => {
    const canvas = $('mirror');
    let mirror;
    try {
      mirror = new ARMirror({ canvas, video, paintCanvas: $('paint') });
    } catch (err) {
      throw new AppError('WebGL unavailable', 'The 3D renderer could not start. Enable WebGL / hardware acceleration in your browser.', err);
    }
    canvas.addEventListener('webglcontextlost', (e) => {
      e.preventDefault();
      state.mirror = null;
      fatal('renderer', new AppError('Graphics context lost', 'The browser lost the WebGL context. Reload the page to continue.'));
    });
    mirror.setBlendMode(Number($('blend').value));
    mirror.setShowMesh($('show-mesh').checked);
    return mirror;
  });
}

async function init() {
  loading.begin();
  const [camera, model, renderer] = await Promise.allSettled([initCamera(), initModel(), initRenderer()]);
  if (camera.status === 'fulfilled') state.stream = camera.value;
  if (model.status === 'fulfilled') state.landmarker = model.value;
  if (renderer.status === 'fulfilled') state.mirror = renderer.value;

  const errors = [camera, model, renderer].filter((r) => r.status === 'rejected').map((r) => r.reason);
  if (errors.length) {
    errors.forEach((err) => console.error(err));
    loading.fail(errors);
    return;
  }
  loading.hide();
  startLoop();
}

function fatal(step, err) {
  console.error(err);
  cancelAnimationFrame(state.raf);
  if (step === 'camera') {
    stopCamera(video);
    state.stream = null;
  }
  loading.step(step, 'error', 'Failed');
  loading.fail([err]);
}

// ---------- Tracking loop ----------

function startLoop() {
  let lastVideoTime = -1;
  let lastFaceAt = performance.now();
  let failures = 0;

  const frame = () => {
    state.raf = requestAnimationFrame(frame);
    const now = performance.now();
    try {
      if (video.readyState >= 2 && video.currentTime !== lastVideoTime) {
        lastVideoTime = video.currentTime;
        const snapshot = state.mirror.captureFrame();
        const landmarks = snapshot ? state.landmarker.detectForVideo(snapshot, now).faceLandmarks?.[0] ?? null : null;
        state.mirror.setLandmarks(landmarks, video.currentTime);
        if (landmarks) lastFaceAt = now;
        $('no-face').hidden = now - lastFaceAt < 600;
      }
      state.mirror.render();
      failures = 0;
    } catch (err) {
      if (++failures < 5) return console.warn('Frame failed', err);
      fatal('model', new AppError('Face tracking stopped', 'Face tracking failed repeatedly while processing the video.', err));
    }
  };
  cancelAnimationFrame(state.raf);
  state.raf = requestAnimationFrame(frame);
}

$('retry').addEventListener('click', init);
init();
