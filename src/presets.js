import { OUTLINE, UVS } from './faceMesh.js';

const S = 1024;
const OFFSCREEN = 4096;
const BLEND = { multiply: 0 };

// ---------- Geometry ----------

const pt = (i) => [UVS[i * 2] * S, (1 - UVS[i * 2 + 1]) * S];
const pts = (indices) => indices.map(pt);
const add = (a, b) => [a[0] + b[0], a[1] + b[1]];
const sub = (a, b) => [a[0] - b[0], a[1] - b[1]];
const scale = (a, k) => [a[0] * k, a[1] * k];
const lerp = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
const unit = (a) => scale(a, 1 / (Math.hypot(a[0], a[1]) || 1));
const centroid = (points) => scale(points.reduce(add, [0, 0]), 1 / points.length);

function rng(seed) {
  let s = seed;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

// ---------- Landmarks (MediaPipe face mesh indices) ----------

// The outer rim from one ear, down around the chin, up to the other ear.
const JAWLINE = OUTLINE.slice(8, 29);
const LIPS_OUTER = [61, 185, 40, 39, 37, 0, 267, 269, 270, 409, 291, 375, 321, 405, 314, 17, 84, 181, 91, 146];
const LIPS_INNER = [78, 191, 80, 81, 82, 13, 312, 311, 310, 415, 308, 324, 318, 402, 317, 14, 87, 178, 88, 95];

// Every list runs from the outer corner of the eye towards the nose.
const SIDES = [
  {
    outer: 33,
    inner: 133,
    upper: [33, 246, 161, 160, 159, 158, 157, 173, 133],
    lower: [33, 7, 163, 144, 145, 153, 154, 155, 133],
    lid: [247, 30, 29, 27, 28, 56, 190],
    crease: [113, 225, 224, 223, 222, 221, 189],
    under: [226, 31, 228, 229, 230, 231, 232, 233, 244],
    socket: [143, 111, 117, 118, 119, 120, 121, 128, 245],
    browTop: [70, 63, 105, 66, 107],
    browBottom: [46, 53, 52, 65, 55],
    cheek: 50,
    ear: 234,
    mouth: 61,
    nostril: 48,
    jaw: 172,
    temple: 54,
  },
  {
    outer: 263,
    inner: 362,
    upper: [263, 466, 388, 387, 386, 385, 384, 398, 362],
    lower: [263, 249, 390, 373, 374, 380, 381, 382, 362],
    lid: [467, 260, 259, 257, 258, 286, 414],
    crease: [342, 445, 444, 443, 442, 441, 413],
    under: [446, 261, 448, 449, 450, 451, 452, 453, 464],
    socket: [372, 340, 346, 347, 348, 349, 350, 357, 465],
    browTop: [300, 293, 334, 296, 336],
    browBottom: [276, 283, 282, 295, 285],
    cheek: 280,
    ear: 454,
    mouth: 291,
    nostril: 278,
    jaw: 397,
    temple: 284,
  },
];

const NOSE_TIP = pt(4);
const NOSE_BRIDGE = pt(6);
const BROW_CENTER = pt(9);
const FOREHEAD = pt(151);
const CHIN = pt(152);
const LIP_TOP = pt(0);
const LIP_BOTTOM = pt(17);
const FACE_CENTER_X = NOSE_TIP[0];

// ---------- Drawing ----------

function trace(ctx, points, closed = false) {
  const n = points.length;
  if (closed) {
    ctx.moveTo(...lerp(points[n - 1], points[0], 0.5));
    for (let i = 0; i < n; i++) ctx.quadraticCurveTo(...points[i], ...lerp(points[i], points[(i + 1) % n], 0.5));
    ctx.closePath();
    return;
  }
  ctx.moveTo(...points[0]);
  for (let i = 1; i < n - 1; i++) ctx.quadraticCurveTo(...points[i], ...lerp(points[i], points[i + 1], 0.5));
  ctx.lineTo(...points[n - 1]);
}

// Runs `draw` (which must fill or stroke) in `color`, feathered by `blur` pixels.
// Feathering renders only the shape's blurred shadow, which works in every browser.
function paint(ctx, color, blur, draw) {
  ctx.save();
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  if (blur > 0) {
    ctx.shadowColor = color;
    ctx.shadowBlur = blur * 2;
    ctx.shadowOffsetX = OFFSCREEN;
    ctx.translate(-OFFSCREEN, 0);
    ctx.fillStyle = ctx.strokeStyle = '#000';
  } else {
    ctx.fillStyle = ctx.strokeStyle = color;
  }
  ctx.beginPath();
  draw();
  ctx.restore();
}

const fillShape = (ctx, color, blur, points) =>
  paint(ctx, color, blur, () => {
    trace(ctx, points, true);
    ctx.fill();
  });

const strokeLine = (ctx, color, blur, width, points) =>
  paint(ctx, color, blur, () => {
    ctx.lineWidth = width;
    trace(ctx, points);
    ctx.stroke();
  });

const blob = (ctx, color, blur, center, rx, ry = rx, rotation = 0) =>
  paint(ctx, color, blur, () => {
    ctx.ellipse(center[0], center[1], rx, ry, rotation, 0, Math.PI * 2);
    ctx.fill();
  });

// A stroke that tapers to a point at both ends (0..1 along the quadratic a -> control -> b).
function taper(ctx, color, blur, a, control, b, width) {
  const left = [];
  const right = [];
  const STEPS = 16;
  for (let i = 0; i <= STEPS; i++) {
    const t = i / STEPS;
    const p = lerp(lerp(a, control, t), lerp(control, b, t), t);
    const tangent = unit(sub(lerp(control, b, t), lerp(a, control, t)));
    const half = (width / 2) * Math.sin(Math.PI * t) ** 0.7;
    left.push(add(p, [-tangent[1] * half, tangent[0] * half]));
    right.unshift(add(p, [tangent[1] * half, -tangent[0] * half]));
  }
  paint(ctx, color, blur, () => {
    const outline = [...left, ...right];
    ctx.moveTo(...outline[0]);
    for (const p of outline) ctx.lineTo(...p);
    ctx.closePath();
    ctx.fill();
  });
}

// Fills the whole face slightly past its rim. Drawn opaque on its own layer first so that a
// translucent base has even coverage where the fill and the rim stroke overlap.
function faceBase(ctx, color, blur = 0, opacity = 1) {
  const layer = document.createElement('canvas');
  layer.width = layer.height = S;
  const l = layer.getContext('2d');
  paint(l, color, blur, () => {
    trace(l, pts(OUTLINE), true);
    l.lineWidth = 28;
    l.fill();
    l.stroke();
  });
  ctx.save();
  ctx.globalAlpha = opacity;
  ctx.drawImage(layer, 0, 0);
  ctx.restore();
}

function clipToFace(ctx) {
  ctx.beginPath();
  trace(ctx, pts(OUTLINE), true);
  ctx.lineWidth = 28;
  ctx.clip();
}

function lips(ctx, color, blur = 2, grow = 0) {
  paint(ctx, color, blur, () => {
    trace(ctx, pts(LIPS_OUTER), true);
    trace(ctx, pts(LIPS_INNER), true);
    ctx.fill('evenodd');
    if (grow) {
      ctx.beginPath();
      trace(ctx, pts(LIPS_OUTER), true);
      ctx.lineWidth = grow;
      ctx.stroke();
    }
  });
}

// ---------- Realism ----------

function noise(size, random, strength) {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d');
  const image = ctx.createImageData(size, size);
  for (let i = 3; i < image.data.length; i += 4) image.data[i] = random() * 255 * strength;
  ctx.putImageData(image, 0, 0);
  return canvas;
}

// Wears away what has been drawn so far, the way real product sits unevenly on skin:
// `grain` is powdery speckle, `mottle` is pore-sized unevenness, `patch` is broad uneven coverage.
function wear(ctx, seed, { grain = 0, mottle = 0, patch = 0 }) {
  const random = rng(seed);
  ctx.save();
  ctx.globalCompositeOperation = 'destination-out';
  ctx.imageSmoothingQuality = 'high';
  for (const [size, strength] of [[S, grain], [150, mottle], [18, patch]]) {
    if (strength) ctx.drawImage(noise(size, random, strength), 0, 0, S, S);
  }
  ctx.restore();
}

// ---------- Makeup building blocks ----------

const outward = (side) => unit(sub(pt(side.outer), pt(side.inner)));

// Hands are never symmetric: the second side gets slightly different placement and size.
const hand = (side) => (side === SIDES[0] ? { shift: [0, 0], size: 1, lift: 0 } : { shift: [7, -5], size: 0.93, lift: 0.05 });

function eyeshadow(ctx, side, color, blur, reach = 'crease') {
  const top = pts(side[reach]);
  const tail = add(pt(side.outer), add(scale(outward(side), 26), [0, -14]));
  fillShape(ctx, color, blur, [tail, ...top, ...pts(side.upper).reverse()]);
}

function outerV(ctx, side, color) {
  const corner = add(pt(side.outer), add(scale(outward(side), 6), [0, -12]));
  blob(ctx, color, 9, corner, 24, 13, Math.sign(outward(side)[0]) * -0.5);
}

function browBone(ctx, side, color) {
  fillShape(ctx, color, 16, [...pts(side.browBottom), ...pts(side.crease).reverse()]);
}

function liner(ctx, side, color, { width = 5, wing = 34, lift = 0.6 } = {}) {
  const h = hand(side);
  wing *= h.size;
  lift += h.lift;
  const line = pts(side.upper).reverse();
  const corner = pt(side.outer);
  const tip = add(corner, add(scale(outward(side), wing), [0, -wing * lift]));
  strokeLine(ctx, color, 1.3, width * 0.8, line);
  strokeLine(ctx, color, 1, width, line.slice(3));
  if (!wing) return;
  paint(ctx, color, 1.1, () => {
    ctx.moveTo(...lerp(line[line.length - 3], corner, 0.2));
    ctx.quadraticCurveTo(...add(corner, [0, -width]), ...tip);
    ctx.quadraticCurveTo(...add(corner, scale(outward(side), wing * 0.35)), ...add(corner, [0, width * 0.6]));
    ctx.closePath();
    ctx.fill();
  });
}

function lowerLiner(ctx, side, color, blur, width) {
  strokeLine(ctx, color, blur, width, pts(side.lower).slice(0, 6));
}

function lashes(ctx, side, color, length = 20, count = 11) {
  const random = rng(side.outer);
  const line = pts(side.upper);
  const center = centroid([...line, ...pts(side.lower)]);
  const out = outward(side);
  for (let i = 0; i < count; i++) {
    const f = Math.min(line.length - 2.2, Math.max(0, (i / (count - 1)) * (line.length - 2.2) + (random() - 0.5) * 0.5));
    const base = lerp(line[Math.floor(f)], line[Math.floor(f) + 1], f % 1);
    const outerness = 1 - i / (count - 1);
    const lean = add(scale(out, 0.25 + outerness * 0.9 + (random() - 0.5) * 0.35), [0, -0.6]);
    const direction = unit(add(unit(sub(base, center)), lean));
    const reach = length * (0.55 + 0.45 * outerness) * (0.75 + random() * 0.45);
    const tip = add(base, scale(direction, reach));
    const bend = add(lerp(base, tip, 0.5), scale(out, -reach * 0.16));
    taper(ctx, color, 0.7, add(base, scale(direction, -3)), bend, tip, 2.6 + random() * 1.6);
  }
}

function along(points, t) {
  const f = Math.min(points.length - 1.001, Math.max(0, t * (points.length - 1)));
  return lerp(points[Math.floor(f)], points[Math.floor(f) + 1], f % 1);
}

// Brows are a soft powder base plus individual hair strokes, not a solid block.
function brows(ctx, side, color, density = 1) {
  const random = rng(side.inner);
  const top = pts(side.browTop);
  const bottom = pts(side.browBottom);
  fillShape(ctx, color, 5, [...top, ...bottom.reverse()]);
  bottom.reverse();
  const out = outward(side);
  for (let i = 0; i < 46 * density; i++) {
    const t = random();
    const root = lerp(along(bottom, t), along(top, t), random() * 0.55);
    const crown = along(top, Math.max(0, t - 0.08 - random() * 0.1));
    const reach = (0.7 + random() * 0.6) * (0.55 + t * 0.6);
    const tip = add(lerp(root, crown, reach), scale(out, (1 - t) * 9));
    const bend = add(lerp(root, tip, 0.5), [0, -2 - random() * 3]);
    ctx.globalAlpha = 0.35 + random() * 0.5;
    taper(ctx, color, 0.6, root, bend, tip, 2 + random() * 1.4);
  }
  ctx.globalAlpha = 1;
}

function blush(ctx, side, color, { size = 78, lift = 0.3 } = {}) {
  const h = hand(side);
  const center = add(lerp(pt(side.cheek), pt(side.ear), lift), h.shift);
  const toEar = unit(sub(pt(side.ear), pt(side.cheek)));
  const angle = Math.atan2(toEar[1], toEar[0]) * 0.6;
  size *= h.size;
  blob(ctx, color, 46, add(center, [0, 8]), size, size * 0.5, angle);
  blob(ctx, color, 30, add(center, add(scale(toEar, size * 0.35), [0, -6])), size * 0.5, size * 0.3, angle);
}

function contour(ctx, side, color) {
  const start = lerp(pt(side.ear), pt(side.cheek), 0.12);
  const end = lerp(pt(side.ear), pt(side.mouth), 0.62);
  strokeLine(ctx, color, 24, 26, [add(start, [0, 30]), add(lerp(start, end, 0.5), [0, 34]), add(end, [0, 6])]);
  strokeLine(ctx, color, 24, 22, [pt(side.jaw), lerp(pt(side.jaw), CHIN, 0.55)]);
  const dx = Math.sign(pt(side.outer)[0] - FACE_CENTER_X) * 30;
  strokeLine(ctx, color, 11, 9, [add(NOSE_BRIDGE, [dx, -16]), add(NOSE_TIP, [dx * 1.15, -52])]);
  blob(ctx, color, 32, lerp(pt(side.temple), FOREHEAD, 0.12), 46, 34);
}

function freckles(ctx, color) {
  const random = rng(7);
  const left = pt(SIDES[0].cheek);
  const right = pt(SIDES[1].cheek);
  for (let i = 0; i < 110; i++) {
    const t = random();
    const x = left[0] + (right[0] - left[0]) * (t * 1.3 - 0.15);
    const arc = Math.sin(Math.PI * t) * -34;
    const y = left[1] + arc + (random() - 0.5) * 80;
    paint(ctx, color, 1.2, () => {
      ctx.globalAlpha = 0.15 + random() ** 2 * 0.6;
      ctx.ellipse(x, y, 1.2 + random() * 2.6, 1 + random() * 2, random() * 3, 0, Math.PI * 2);
      ctx.fill();
    });
  }
}

// Lipstick: a feathered base, more pigment where the lips meet, and fine vertical creases showing through.
function lipstick(ctx, color, deep, { blur = 4, creases = 0.22 } = {}) {
  const random = rng(23);
  lips(ctx, color, blur);
  blob(ctx, deep, 12, lerp(LIP_TOP, LIP_BOTTOM, 0.5), 78, 16);
  ctx.save();
  ctx.globalCompositeOperation = 'destination-out';
  const left = pt(61)[0];
  const right = pt(291)[0];
  for (let i = 0; i < 44; i++) {
    const x = left + (right - left) * (0.08 + random() * 0.84);
    const y = LIP_TOP[1] + (LIP_BOTTOM[1] - LIP_TOP[1]) * random();
    const reach = 8 + random() * 16;
    strokeLine(ctx, `rgba(0, 0, 0, ${creases * (0.4 + random())})`, 1, 1.4, [
      [x, y - reach / 2],
      [x + (x - FACE_CENTER_X) * 0.04 + (random() - 0.5) * 3, y + reach / 2],
    ]);
  }
  ctx.restore();
}

// ---------- Looks ----------

function softGlam(ctx) {
  for (const side of SIDES) {
    blush(ctx, side, 'rgba(226, 92, 116, 0.5)', { size: 88, lift: 0.22 });
    browBone(ctx, side, 'rgba(226, 150, 150, 0.22)');
    eyeshadow(ctx, side, 'rgba(208, 116, 134, 0.5)', 13, 'crease');
    eyeshadow(ctx, side, 'rgba(150, 76, 92, 0.42)', 7, 'lid');
    outerV(ctx, side, 'rgba(120, 58, 70, 0.4)');
    lowerLiner(ctx, side, 'rgba(190, 100, 120, 0.36)', 6, 9);
  }
  blob(ctx, 'rgba(226, 92, 116, 0.28)', 28, add(NOSE_TIP, [4, -70]), 48, 22);
  wear(ctx, 101, { grain: 0.22, mottle: 0.2, patch: 0.3 });

  freckles(ctx, 'rgba(132, 80, 54, 0.8)');
  lipstick(ctx, 'rgba(206, 74, 100, 0.56)', 'rgba(176, 36, 72, 0.3)');
  wear(ctx, 102, { grain: 0.1, mottle: 0.12, patch: 0.1 });

  for (const side of SIDES) {
    liner(ctx, side, 'rgba(52, 30, 26, 0.85)', { width: 4, wing: 24, lift: 0.55 });
    lashes(ctx, side, 'rgba(40, 24, 22, 0.8)', 16, 10);
    brows(ctx, side, 'rgba(104, 68, 50, 0.3)', 0.8);
  }
}

function abg(ctx) {
  for (const side of SIDES) {
    contour(ctx, side, 'rgba(120, 70, 42, 0.4)');
    blush(ctx, side, 'rgba(210, 92, 92, 0.4)', { size: 82, lift: 0.34 });
    browBone(ctx, side, 'rgba(150, 96, 70, 0.25)');
    eyeshadow(ctx, side, 'rgba(120, 72, 52, 0.56)', 14, 'crease');
    eyeshadow(ctx, side, 'rgba(62, 36, 30, 0.55)', 7, 'lid');
    outerV(ctx, side, 'rgba(40, 22, 20, 0.55)');
    lowerLiner(ctx, side, 'rgba(60, 34, 28, 0.5)', 5, 9);
  }
  wear(ctx, 201, { grain: 0.2, mottle: 0.18, patch: 0.26 });

  lipstick(ctx, 'rgba(192, 118, 104, 0.66)', 'rgba(170, 96, 90, 0.25)', { creases: 0.16 });
  paint(ctx, 'rgba(104, 52, 40, 0.62)', 5, () => {
    trace(ctx, pts(LIPS_OUTER), true);
    ctx.lineWidth = 8;
    ctx.stroke();
  });
  wear(ctx, 202, { grain: 0.1, mottle: 0.1, patch: 0.1 });

  for (const side of SIDES) {
    liner(ctx, side, 'rgba(12, 9, 9, 0.94)', { width: 8, wing: 52, lift: 0.5 });
    lashes(ctx, side, 'rgba(12, 9, 9, 0.92)', 30, 14);
    brows(ctx, side, 'rgba(46, 30, 24, 0.5)', 1.3);
  }
}

function redCarpet(ctx) {
  for (const side of SIDES) {
    contour(ctx, side, 'rgba(120, 76, 52, 0.28)');
    blush(ctx, side, 'rgba(198, 94, 102, 0.34)', { size: 78, lift: 0.4 });
    browBone(ctx, side, 'rgba(96, 76, 72, 0.3)');
    eyeshadow(ctx, side, 'rgba(70, 52, 50, 0.58)', 17, 'crease');
    eyeshadow(ctx, side, 'rgba(28, 22, 24, 0.66)', 8, 'lid');
    outerV(ctx, side, 'rgba(14, 10, 12, 0.6)');
    lowerLiner(ctx, side, 'rgba(26, 20, 22, 0.55)', 7, 12);
  }
  wear(ctx, 301, { grain: 0.2, mottle: 0.18, patch: 0.26 });

  lipstick(ctx, 'rgba(156, 14, 36, 0.86)', 'rgba(110, 4, 24, 0.4)', { blur: 2.5, creases: 0.12 });
  wear(ctx, 302, { grain: 0.08, mottle: 0.1, patch: 0.08 });

  for (const side of SIDES) {
    liner(ctx, side, 'rgba(10, 8, 8, 0.94)', { width: 6, wing: 34, lift: 0.55 });
    lashes(ctx, side, 'rgba(10, 8, 8, 0.92)', 22, 12);
    brows(ctx, side, 'rgba(60, 40, 30, 0.42)', 1);
  }
}

// ---------- Colour and graphic building blocks ----------

// A point on the eyelid. t: 0 outer corner -> 1 inner corner. rise: 0 lash line, 1 crease, 2 brow.
function lidPoint(side, t, rise) {
  const crease = along(pts(side.crease), t);
  return rise <= 1
    ? lerp(along(pts(side.upper), t), crease, rise)
    : lerp(crease, along(pts(side.browBottom), t), rise - 1);
}

// Eyeshadow that shifts through `colors` from the inner corner to a winged-out outer corner.
function shadowGradient(ctx, side, colors, { rise = 0.7, size = 20, blur = 9, tail = 24 } = {}) {
  const steps = colors.length * 3;
  for (let i = 0; i < steps; i++) {
    const f = i / (steps - 1);
    let p = lidPoint(side, 1 - f, rise * (0.7 + 0.3 * f));
    if (i === steps - 1) p = add(p, add(scale(outward(side), tail), [0, -tail * 0.45]));
    blob(ctx, colors[Math.floor(i / 3)], blur, p, size * (0.75 + 0.35 * f), size * 0.62);
  }
}

function gem(ctx, p, r) {
  blob(ctx, 'rgba(255, 255, 255, 0.55)', r * 1.3, p, r * 1.5);
  blob(ctx, '#ffffff', 0.7, p, r);
}

function sparkle(ctx, color, p, r) {
  paint(ctx, color, 0.6, () => {
    for (let i = 0; i < 4; i++) {
      const a = (i * Math.PI) / 2;
      const b = a + Math.PI / 4;
      const tip = add(p, [Math.cos(a) * r, Math.sin(a) * r]);
      const waist = add(p, [Math.cos(b) * r * 0.2, Math.sin(b) * r * 0.2]);
      if (i === 0) ctx.moveTo(...tip);
      else ctx.lineTo(...tip);
      ctx.lineTo(...waist);
    }
    ctx.closePath();
    ctx.fill();
  });
}

function heart(ctx, color, p, s, rotation = 0) {
  paint(ctx, color, 0.7, () => {
    ctx.translate(...p);
    ctx.rotate(rotation);
    ctx.moveTo(0, s * 0.75);
    ctx.bezierCurveTo(-s * 1.5, -s * 0.2, -s * 0.6, -s * 1.15, 0, -s * 0.35);
    ctx.bezierCurveTo(s * 0.6, -s * 1.15, s * 1.5, -s * 0.2, 0, s * 0.75);
    ctx.fill();
  });
}

const wingTip = (side, reach, lift = 0.5) => add(pt(side.outer), add(scale(outward(side), reach), [0, -reach * lift]));
const dirOf = (side) => Math.sign(outward(side)[0]);

function finishEyes(ctx, { wing = 30, lash = 20, brow = 'rgba(70, 46, 36, 0.4)', line = 'rgba(10, 8, 8, 0.93)', width = 5 } = {}) {
  for (const side of SIDES) {
    if (width) liner(ctx, side, line, { width, wing, lift: 0.55 });
    if (lash) lashes(ctx, side, 'rgba(10, 8, 8, 0.9)', lash, 12);
    if (brow) brows(ctx, side, brow, 1);
  }
}

// ---------- Colour looks ----------

function sunset(ctx) {
  for (const side of SIDES) {
    blush(ctx, side, 'rgba(240, 110, 70, 0.42)', { size: 84, lift: 0.36 });
    shadowGradient(
      ctx,
      side,
      ['rgba(255, 216, 30, 0.9)', 'rgba(255, 140, 16, 0.9)', 'rgba(236, 50, 80, 0.88)', 'rgba(140, 30, 150, 0.85)'],
      { rise: 1.05, size: 23 },
    );
    lowerLiner(ctx, side, 'rgba(236, 50, 80, 0.6)', 5, 10);
  }
  wear(ctx, 701, { grain: 0.16, mottle: 0.14, patch: 0.18 });
  lipstick(ctx, 'rgba(232, 86, 60, 0.7)', 'rgba(200, 40, 50, 0.3)');
  finishEyes(ctx, { wing: 34 });
}

function euphoria(ctx) {
  const random = rng(31);
  for (const side of SIDES) {
    blush(ctx, side, 'rgba(206, 110, 200, 0.4)', { size: 88, lift: 0.4 });
    shadowGradient(ctx, side, ['rgba(170, 120, 255, 0.85)', 'rgba(110, 60, 230, 0.88)', 'rgba(40, 60, 210, 0.9)'], {
      rise: 1.5,
      size: 27,
      blur: 11,
      tail: 34,
    });
    lowerLiner(ctx, side, 'rgba(110, 60, 230, 0.7)', 6, 13);
  }
  wear(ctx, 801, { grain: 0.18, mottle: 0.14, patch: 0.18 });
  lipstick(ctx, 'rgba(170, 70, 130, 0.62)', 'rgba(120, 30, 100, 0.3)');
  finishEyes(ctx, { wing: 26, width: 4 });
  for (const side of SIDES) {
    const row = pts(side.under).slice(0, 7);
    row.forEach((p, i) => gem(ctx, add(p, [0, 13]), 5.2 - i * 0.45));
    gem(ctx, add(pt(side.inner), [-dirOf(side) * 7, 3]), 3.4);
    gem(ctx, wingTip(side, 50, 0.6), 4.2);
    for (let i = 0; i < 16; i++) {
      const p = add(lerp(pt(side.cheek), pt(side.ear), 0.15 + random() * 0.5), [(random() - 0.5) * 60, -40 + (random() - 0.5) * 70]);
      sparkle(ctx, 'rgba(255, 255, 255, 0.95)', p, 3 + random() * 6);
    }
  }
}

function aurora(ctx) {
  const random = rng(47);
  for (const side of SIDES) {
    blush(ctx, side, 'rgba(120, 90, 220, 0.34)', { size: 90, lift: 0.5 });
    shadowGradient(ctx, side, ['rgba(60, 230, 190, 0.9)', 'rgba(20, 170, 150, 0.9)', 'rgba(40, 90, 200, 0.88)', 'rgba(130, 50, 190, 0.88)'], {
      rise: 1.2,
      size: 24,
      tail: 32,
    });
    lowerLiner(ctx, side, 'rgba(20, 170, 150, 0.75)', 5, 12);
    blob(ctx, 'rgba(60, 200, 200, 0.4)', 24, add(wingTip(side, 70, 0.1), [0, 20]), 46, 26, dirOf(side) * -0.5);
  }
  wear(ctx, 901, { grain: 0.16, mottle: 0.14, patch: 0.18 });
  lipstick(ctx, 'rgba(150, 40, 120, 0.72)', 'rgba(90, 20, 110, 0.35)');
  finishEyes(ctx, { wing: 38, line: 'rgba(16, 28, 80, 0.95)' });
  for (const side of SIDES) {
    gem(ctx, add(pt(side.inner), [-dirOf(side) * 8, 2]), 4);
    for (let i = 0; i < 12; i++) {
      const p = add(wingTip(side, 30 + random() * 80, 0), [0, -10 + random() * 90]);
      if (i % 3 === 0) sparkle(ctx, '#ffffff', p, 5 + random() * 6);
      else gem(ctx, p, 1.6 + random() * 2);
    }
  }
}

function graphicLiner(ctx) {
  const cobalt = 'rgba(24, 70, 235, 0.95)';
  const orange = 'rgba(255, 110, 20, 0.95)';
  for (const side of SIDES) blush(ctx, side, 'rgba(226, 110, 110, 0.3)', { size: 76, lift: 0.4 });
  wear(ctx, 1001, { grain: 0.16, mottle: 0.14, patch: 0.2 });
  lipstick(ctx, 'rgba(190, 110, 100, 0.55)', 'rgba(160, 80, 80, 0.25)');
  for (const side of SIDES) {
    const tip = wingTip(side, 62, 0.62);
    const floating = Array.from({ length: 7 }, (_, i) => lidPoint(side, 0.92 - i * 0.14, 1.25));
    strokeLine(ctx, cobalt, 0.8, 6.5, [...floating, lerp(floating[6], tip, 0.6), tip]);
    strokeLine(ctx, cobalt, 0.8, 6.5, [tip, lerp(tip, pt(side.outer), 0.6), add(pt(side.outer), [0, 3])]);
    const lowerTip = add(pt(side.outer), add(scale(outward(side), 44), [0, 12]));
    strokeLine(ctx, orange, 0.8, 5.5, [...pts(side.lower).slice(0, 7).reverse().map((p) => add(p, [0, 7])), lowerTip]);
    gem(ctx, add(pt(side.inner), [-dirOf(side) * 8, 2]), 4);
    gem(ctx, add(lidPoint(side, 0.5, 1.25), [0, -14]), 3);
  }
  finishEyes(ctx, { wing: 0, width: 3.5, lash: 16 });
}

function eGirl(ctx) {
  for (const side of SIDES) {
    blush(ctx, side, 'rgba(240, 80, 120, 0.6)', { size: 96, lift: 0.12 });
    eyeshadow(ctx, side, 'rgba(230, 90, 130, 0.5)', 12, 'crease');
    lowerLiner(ctx, side, 'rgba(230, 90, 130, 0.5)', 7, 14);
  }
  blob(ctx, 'rgba(240, 80, 120, 0.55)', 30, add(NOSE_TIP, [0, -62]), 96, 30);
  wear(ctx, 1101, { grain: 0.2, mottle: 0.18, patch: 0.24 });
  freckles(ctx, 'rgba(120, 66, 50, 0.8)');
  lipstick(ctx, 'rgba(150, 20, 50, 0.8)', 'rgba(90, 6, 30, 0.45)');
  finishEyes(ctx, { wing: 50, width: 7, lash: 24 });
  SIDES.forEach((side, i) => {
    const under = add(lerp(pt(side.cheek), pt(side.outer), 0.42), [dirOf(side) * 16, 0]);
    heart(ctx, 'rgba(14, 10, 12, 0.95)', under, 12, i ? 0.25 : -0.25);
    heart(ctx, 'rgba(14, 10, 12, 0.95)', add(under, [dirOf(side) * 26, 14]), 7, i ? 0.4 : -0.4);
  });
  gem(ctx, add(NOSE_TIP, [0, -16]), 5);
}

function goth(ctx) {
  faceBase(ctx, 'rgb(246, 244, 242)', 6, 0.42);
  for (const side of SIDES) {
    contour(ctx, side, 'rgba(60, 56, 66, 0.42)');
    shadowGradient(ctx, side, ['rgba(60, 20, 60, 0.85)', 'rgba(16, 12, 18, 0.92)', 'rgba(8, 6, 10, 0.95)'], {
      rise: 1.55,
      size: 28,
      blur: 12,
      tail: 40,
    });
    lowerLiner(ctx, side, 'rgba(10, 8, 12, 0.85)', 8, 18);
  }
  wear(ctx, 1201, { grain: 0.16, mottle: 0.16, patch: 0.22 });
  lipstick(ctx, 'rgba(14, 8, 14, 0.94)', 'rgba(60, 0, 30, 0.5)', { blur: 2, creases: 0.1 });
  finishEyes(ctx, { wing: 56, width: 8, lash: 26, brow: 'rgba(14, 10, 12, 0.6)' });
  for (const side of SIDES) {
    const drop = add(pt(side.under[4]), [0, 30]);
    strokeLine(ctx, 'rgba(10, 8, 12, 0.92)', 0.7, 3.5, [drop, add(drop, [0, 34])]);
    strokeLine(ctx, 'rgba(10, 8, 12, 0.92)', 0.7, 3.5, [add(drop, [-9, 10]), add(drop, [9, 10])]);
  }
}

function rainbow(ctx) {
  const colors = [
    'rgba(240, 30, 50, 0.9)',
    'rgba(255, 130, 10, 0.9)',
    'rgba(255, 220, 20, 0.9)',
    'rgba(40, 190, 80, 0.9)',
    'rgba(30, 100, 240, 0.9)',
    'rgba(140, 50, 210, 0.9)',
  ];
  for (const side of SIDES) {
    blush(ctx, side, 'rgba(240, 100, 140, 0.4)', { size: 84, lift: 0.3 });
    shadowGradient(ctx, side, colors, { rise: 1.35, size: 22, blur: 7, tail: 34 });
    lowerLiner(ctx, side, 'rgba(30, 100, 240, 0.7)', 5, 10);
  }
  wear(ctx, 1301, { grain: 0.14, mottle: 0.12, patch: 0.16 });
  lipstick(ctx, 'rgba(236, 70, 130, 0.7)', 'rgba(200, 30, 100, 0.3)');
  finishEyes(ctx, { wing: 30 });
  for (const side of SIDES) {
    pts(side.under)
      .slice(1, 7)
      .forEach((p, i) => blob(ctx, colors[i], 0.8, add(p, [0, 15]), 4.2));
  }
}

// The "before blending" map: every product placed, nothing buffed in.
function unblended(ctx) {
  const concealer = 'rgba(248, 228, 204, 0.96)';
  const bronze = 'rgba(98, 56, 34, 0.88)';
  const pink = 'rgba(228, 80, 110, 0.9)';
  const glow = 'rgba(255, 252, 244, 0.96)';

  strokeLine(ctx, concealer, 1.2, 40, [add(BROW_CENTER, [0, -34]), add(FOREHEAD, [0, -70])]);
  strokeLine(ctx, concealer, 1.2, 15, [add(NOSE_BRIDGE, [0, -8]), add(NOSE_TIP, [0, -34])]);
  blob(ctx, concealer, 1.2, lerp(LIP_BOTTOM, CHIN, 0.48), 30, 24);
  strokeLine(ctx, glow, 1, 7, [add(LIP_TOP, [-9, -13]), add(LIP_TOP, [0, -8]), add(LIP_TOP, [9, -13])]);

  for (const side of SIDES) {
    const dir = dirOf(side);
    const under = pts(side.under).map((p) => add(p, [0, 10]));
    const point = add(lerp(pt(side.cheek), pt(side.nostril), 0.25), [0, 34]);
    paint(ctx, concealer, 1.2, () => {
      ctx.moveTo(...under[under.length - 1]);
      for (const p of [...under].reverse()) ctx.lineTo(...p);
      ctx.lineTo(...add(pt(side.outer), [dir * 34, 2]));
      ctx.lineTo(...point);
      ctx.closePath();
      ctx.lineWidth = 8;
      ctx.fill();
      ctx.stroke();
    });

    const start = lerp(pt(side.ear), pt(side.cheek), 0.1);
    const end = lerp(pt(side.ear), pt(side.mouth), 0.6);
    strokeLine(ctx, bronze, 1.2, 22, [add(start, [0, 40]), add(lerp(start, end, 0.5), [0, 44]), add(end, [0, 16])]);
    strokeLine(ctx, bronze, 1.2, 20, [add(pt(side.jaw), [-dir * 14, 6]), add(lerp(pt(side.jaw), CHIN, 0.6), [0, -14])]);
    strokeLine(ctx, bronze, 1.2, 9, [add(NOSE_BRIDGE, [dir * 28, -18]), add(NOSE_TIP, [dir * 34, -50])]);
    strokeLine(ctx, bronze, 1.2, 24, [
      add(pt(side.temple), [-dir * 26, 44]),
      add(pt(side.temple), [-dir * 40, -20]),
      add(lerp(pt(side.temple), pt(10), 0.55), [0, 44]),
    ]);

    const cheek = add(lerp(pt(side.cheek), pt(side.ear), 0.2), [0, -6]);
    for (let i = 0; i < 3; i++) blob(ctx, pink, 1, add(cheek, [dir * (i - 1) * 40, -(i - 1) * 16]), 14);
    strokeLine(ctx, glow, 1, 9, [add(cheek, [-dir * 30, -44]), add(cheek, [dir * 62, -80])]);
    strokeLine(ctx, glow, 1, 8, [add(pt(side.browBottom[1]), [0, 12]), add(pt(side.browBottom[3]), [0, 12])]);
  }
  blob(ctx, glow, 1, add(NOSE_TIP, [0, -10]), 9);
  wear(ctx, 1401, { grain: 0.06, mottle: 0.08, patch: 0.08 });

  lipstick(ctx, 'rgba(196, 110, 100, 0.5)', 'rgba(160, 80, 80, 0.2)');
  paint(ctx, 'rgba(120, 60, 46, 0.85)', 1, () => {
    trace(ctx, pts(LIPS_OUTER), true);
    ctx.lineWidth = 5;
    ctx.stroke();
  });
  finishEyes(ctx, { wing: 22, width: 4, lash: 16, brow: 'rgba(70, 46, 36, 0.45)' });
}

// ---------- Masculine looks ----------

// Short dark hairs over the beard area with a soft shadow underneath, faded out at the edges.
function stubble(ctx, { density = 1, length = 3.2, shadow = 0.14, cheekLine = 0.45, opacity = 1, tone = '26, 21, 20' } = {}) {
  const random = rng(61);
  const layer = document.createElement('canvas');
  layer.width = layer.height = S;
  const l = layer.getContext('2d');
  const top = S * 0.42;

  l.fillStyle = `rgba(${tone}, ${shadow})`;
  l.fillRect(0, top, S, S - top);
  l.lineCap = 'round';
  for (let i = 0; i < 15000 * density; i++) {
    const x = random() * S;
    const y = top + random() * (S - top);
    const angle = Math.PI / 2 + ((x - FACE_CENTER_X) / S) * 0.9 + (random() - 0.5) * 0.9;
    const reach = length * (0.5 + random());
    l.strokeStyle = `rgba(${tone}, ${0.22 + random() * 0.5})`;
    l.lineWidth = 0.9 + random() * 0.9;
    l.beginPath();
    l.moveTo(x, y);
    l.lineTo(x + Math.cos(angle) * reach, y + Math.sin(angle) * reach);
    l.stroke();
  }

  const inner = SIDES.map((side) => [
    add(lerp(pt(side.ear), pt(side.mouth), cheekLine), [0, -20]),
    add(pt(side.mouth), [dirOf(side) * 40, -38]),
    add(pt(side.nostril), [dirOf(side) * 4, 30]),
  ]);
  const mask = document.createElement('canvas');
  mask.width = mask.height = S;
  const m = mask.getContext('2d');
  paint(m, '#000', 16, () => {
    const outline = [...pts(JAWLINE), ...inner[0], add(pt(2), [0, 12]), ...inner[1].reverse()];
    m.moveTo(...outline[0]);
    for (const p of outline) m.lineTo(...p);
    m.closePath();
    m.fill();
  });
  m.globalCompositeOperation = 'destination-out';
  paint(m, '#000', 3, () => {
    trace(m, pts(LIPS_OUTER), true);
    m.fill();
  });
  l.globalCompositeOperation = 'destination-in';
  l.drawImage(mask, 0, 0);
  ctx.save();
  ctx.globalAlpha = opacity;
  ctx.drawImage(layer, 0, 0);
  ctx.restore();
}

function jawDefinition(ctx, side, color) {
  strokeLine(ctx, color, 15, 18, [add(pt(side.jaw), [0, -6]), lerp(pt(side.jaw), CHIN, 0.5), add(CHIN, [dirOf(side) * 60, -8])]);
}

function chiseled(ctx) {
  for (const side of SIDES) {
    contour(ctx, side, 'rgba(84, 56, 40, 0.34)');
    jawDefinition(ctx, side, 'rgba(70, 46, 34, 0.3)');
    browBone(ctx, side, 'rgba(70, 50, 40, 0.2)');
  }
  wear(ctx, 1501, { grain: 0.18, mottle: 0.16, patch: 0.22 });
  for (const side of SIDES) brows(ctx, side, 'rgba(36, 26, 22, 0.45)', 1.3);
}

function fiveOClock(ctx) {
  for (const side of SIDES) {
    contour(ctx, side, 'rgba(84, 56, 40, 0.2)');
    browBone(ctx, side, 'rgba(70, 50, 40, 0.14)');
  }
  wear(ctx, 1601, { grain: 0.18, mottle: 0.16, patch: 0.22 });
  stubble(ctx, { density: 0.85, opacity: 0.7 });
  for (const side of SIDES) brows(ctx, side, 'rgba(36, 26, 22, 0.35)', 1.1);
}

function rugged(ctx) {
  blob(ctx, 'rgba(170, 90, 50, 0.3)', 40, add(NOSE_TIP, [0, -60]), 250, 60);
  for (const side of SIDES) {
    contour(ctx, side, 'rgba(84, 56, 40, 0.3)');
    browBone(ctx, side, 'rgba(60, 40, 36, 0.22)');
    lowerLiner(ctx, side, 'rgba(70, 40, 50, 0.22)', 9, 16);
  }
  wear(ctx, 1701, { grain: 0.2, mottle: 0.18, patch: 0.24 });
  stubble(ctx, { density: 1.5, length: 4.4, shadow: 0.18, cheekLine: 0.36, opacity: 0.9 });
  for (const side of SIDES) brows(ctx, side, 'rgba(30, 22, 20, 0.5)', 1.6);

  const brow = SIDES[0];
  ctx.save();
  ctx.globalCompositeOperation = 'destination-out';
  strokeLine(ctx, '#000', 1, 6, [add(along(pts(brow.browTop), 0.3), [0, -8]), add(along(pts(brow.browBottom), 0.24), [0, 8])]);
  ctx.restore();

  const cheek = pt(SIDES[1].cheek);
  const from = add(cheek, [-6, -34]);
  const to = add(cheek, [40, 62]);
  const bend = add(lerp(from, to, 0.5), [-10, 4]);
  taper(ctx, 'rgba(120, 50, 44, 0.62)', 1.4, from, bend, to, 8);
  taper(ctx, 'rgba(252, 234, 224, 0.75)', 0.8, lerp(from, to, 0.08), bend, lerp(from, to, 0.92), 2.6);
}

function idol(ctx) {
  for (const side of SIDES) {
    contour(ctx, side, 'rgba(96, 64, 48, 0.2)');
    eyeshadow(ctx, side, 'rgba(120, 80, 64, 0.4)', 10, 'lid');
    outerV(ctx, side, 'rgba(70, 44, 38, 0.4)');
    lowerLiner(ctx, side, 'rgba(60, 40, 34, 0.42)', 5, 9);
  }
  wear(ctx, 1801, { grain: 0.18, mottle: 0.16, patch: 0.22 });
  lipstick(ctx, 'rgba(190, 96, 96, 0.28)', 'rgba(190, 50, 70, 0.4)', { blur: 5, creases: 0.1 });
  for (const side of SIDES) {
    strokeLine(ctx, 'rgba(30, 22, 20, 0.72)', 3, 6, pts(side.upper).slice(0, 7));
    brows(ctx, side, 'rgba(40, 30, 26, 0.4)', 1.1);
  }
}

function spiderEye(ctx, side) {
  const center = centroid([...pts(side.upper), ...pts(side.lower)]);
  const s = Math.hypot(...sub(pt(side.outer), pt(side.inner)));
  const dir = Math.sign(outward(side)[0]);
  const at = (x, y) => add(center, [x * s * dir, y * s]);
  const shape = () => {
    ctx.moveTo(...at(-0.82, 0.5));
    ctx.bezierCurveTo(...at(-0.7, -0.25), ...at(0.1, -0.95), ...at(1.12, -1.05));
    ctx.bezierCurveTo(...at(1.3, -0.3), ...at(0.95, 0.55), ...at(0.2, 0.8));
    ctx.bezierCurveTo(...at(-0.2, 0.86), ...at(-0.6, 0.72), ...at(-0.82, 0.5));
    ctx.closePath();
  };
  paint(ctx, '#0a0a0c', 0, () => {
    shape();
    ctx.lineWidth = 34;
    ctx.fill();
    ctx.stroke();
  });
  paint(ctx, '#f7f8fa', 0, () => {
    shape();
    ctx.fill();
  });
}

function spiderMan(ctx) {
  faceBase(ctx, '#c8101e');
  ctx.save();
  clipToFace(ctx);
  blob(ctx, 'rgba(90, 0, 10, 0.35)', 60, add(CHIN, [0, -40]), 260, 90);

  const center = add(NOSE_BRIDGE, [0, 26]);
  const SPOKES = 18;
  const angles = Array.from({ length: SPOKES }, (_, i) => ((i + 0.5) / SPOKES) * Math.PI * 2);
  const polar = (angle, r) => add(center, [Math.cos(angle) * r, Math.sin(angle) * r]);
  const web = 'rgba(8, 8, 12, 0.95)';
  for (const angle of angles) strokeLine(ctx, web, 0, 5, [center, polar(angle, 1100)]);
  for (let r = 58, step = 62; r < 1000; r += step, step *= 1.16) {
    paint(ctx, web, 0, () => {
      ctx.lineWidth = 4.5;
      for (let i = 0; i < SPOKES; i++) {
        const a = angles[i];
        const b = angles[(i + 1) % SPOKES] + (i === SPOKES - 1 ? Math.PI * 2 : 0);
        ctx.moveTo(...polar(a, r));
        ctx.quadraticCurveTo(...polar((a + b) / 2, r * 0.83), ...polar(b, r));
      }
      ctx.stroke();
    });
  }
  ctx.restore();
  for (const side of SIDES) spiderEye(ctx, side);
}

function glowDot(ctx, p, r) {
  blob(ctx, 'rgba(170, 245, 255, 0.9)', r * 1.6, p, r * 1.2);
  blob(ctx, '#ffffff', 0.8, p, r);
}

function avatar(ctx) {
  faceBase(ctx, '#4f9fd8');
  ctx.save();
  clipToFace(ctx);
  blob(ctx, 'rgba(150, 215, 245, 0.55)', 40, lerp(FOREHEAD, BROW_CENTER, 0.5), 120, 70);
  strokeLine(ctx, 'rgba(160, 222, 248, 0.6)', 12, 26, [BROW_CENTER, NOSE_BRIDGE, add(NOSE_TIP, [0, -40])]);

  const stripe = 'rgba(26, 72, 142, 0.85)';
  for (const side of SIDES) {
    const dir = Math.sign(outward(side)[0]);
    const temple = pt(side.temple);
    const ear = pt(side.ear);
    const jaw = pt(side.jaw);
    const at = (p, x, y) => add(p, [x * dir, y]);
    // forehead
    taper(ctx, stripe, 1.5, at(temple, 20, -60), at(FOREHEAD, 130, -90), at(FOREHEAD, 26, -40), 30);
    taper(ctx, stripe, 1.5, at(temple, 34, 0), at(FOREHEAD, 150, -20), at(FOREHEAD, 44, 22), 28);
    taper(ctx, stripe, 1.5, at(temple, 30, 62), at(FOREHEAD, 170, 40), at(BROW_CENTER, 74, -2), 22);
    // cheeks
    taper(ctx, stripe, 1.5, at(ear, 20, -30), at(ear, -90, 10), at(pt(side.cheek), 10, 34), 28);
    taper(ctx, stripe, 1.5, at(ear, 12, 60), at(ear, -90, 96), at(pt(side.mouth), 44, -30), 30);
    taper(ctx, stripe, 1.5, at(jaw, 20, 0), at(jaw, -70, 40), at(pt(side.mouth), 40, 50), 26);
    taper(ctx, stripe, 1.5, at(jaw, -50, 96), at(CHIN, 110, 10), at(CHIN, 40, -52), 20);

    eyeshadow(ctx, side, 'rgba(22, 52, 112, 0.7)', 7, 'lid');
    lowerLiner(ctx, side, 'rgba(22, 52, 112, 0.7)', 4, 10);
    liner(ctx, side, 'rgba(10, 22, 60, 0.95)', { width: 7, wing: 40, lift: 0.5 });

    const browArc = pts(side.browTop).map((p) => add(p, [0, -24]));
    browArc.forEach((p, i) => glowDot(ctx, p, 5.5 - i * 0.5));
    pts(side.socket)
      .slice(1, 7)
      .forEach((p, i) => glowDot(ctx, add(p, [0, 16]), 3.2 + (i % 2) * 1.6));
    glowDot(ctx, at(pt(side.nostril), 30, -6), 3.4);
    glowDot(ctx, at(pt(side.nostril), 58, 6), 2.6);
  }
  for (let i = 0; i < 5; i++) glowDot(ctx, lerp(add(BROW_CENTER, [0, -70]), add(NOSE_BRIDGE, [0, 10]), i / 4), 3 + (i % 2));

  blob(ctx, 'rgba(92, 70, 150, 0.6)', 12, add(NOSE_TIP, [0, 4]), 52, 30);
  ctx.restore();
  lips(ctx, 'rgba(78, 70, 150, 0.8)', 2);
}

function clown(ctx) {
  faceBase(ctx, '#ffffff');
  const red = '#e0101c';

  const [left, right] = SIDES.map((side) => add(lerp(pt(side.mouth), pt(side.cheek), 0.72), [0, 10]));
  const topY = LIP_TOP[1] - 26;
  const bottomY = LIP_BOTTOM[1] + 58;
  paint(ctx, red, 0.8, () => {
    ctx.moveTo(...left);
    ctx.quadraticCurveTo(FACE_CENTER_X, 2 * topY - left[1], ...right);
    ctx.quadraticCurveTo(FACE_CENTER_X, 2 * bottomY - right[1], ...left);
    ctx.closePath();
    ctx.lineWidth = 16;
    ctx.fill();
    ctx.stroke();
  });
  strokeLine(ctx, 'rgba(120, 0, 10, 0.75)', 1, 5, [pt(61), pt(78), pt(13), pt(308), pt(291)]);

  blob(ctx, red, 0.8, add(NOSE_TIP, [0, -6]), 50);
  blob(ctx, 'rgba(255, 255, 255, 0.75)', 6, add(NOSE_TIP, [-16, -24]), 11, 8);

  for (const side of SIDES) {
    const arch = pts(side.browTop).map((p, i, all) => add(p, [0, -62 - Math.sin((Math.PI * i) / (all.length - 1)) * 34]));
    const a = arch[0];
    const b = arch[arch.length - 1];
    taper(ctx, '#111111', 0.6, add(a, [0, 40]), add(lerp(a, b, 0.5), [0, -76]), add(b, [0, 34]), 17);
    blob(ctx, 'rgba(240, 60, 70, 0.35)', 26, add(pt(side.cheek), [0, 6]), 44);
  }
}

function joker(ctx) {
  const random = rng(11);
  faceBase(ctx, 'rgb(244, 242, 236)', 0, 0.95);

  // worn, patchy greasepaint
  ctx.save();
  ctx.globalCompositeOperation = 'destination-out';
  for (let i = 0; i < 46; i++) {
    const p = [120 + random() * 784, 90 + random() * 860];
    blob(ctx, `rgba(0, 0, 0, ${0.12 + random() * 0.3})`, 14 + random() * 16, p, 14 + random() * 44, 8 + random() * 26, random() * 3);
  }
  for (let i = 0; i < 9; i++) {
    const x = 250 + random() * 524;
    const y = 120 + random() * 90;
    strokeLine(ctx, `rgba(0, 0, 0, ${0.25 + random() * 0.3})`, 5, 5 + random() * 8, [
      [x, y],
      [x + (random() - 0.5) * 30, y + 60 + random() * 90],
    ]);
  }
  ctx.restore();

  for (const side of SIDES) {
    const socket = [...pts(side.browBottom).map((p) => add(p, [0, 4])), ...pts(side.socket).reverse()];
    fillShape(ctx, 'rgba(12, 10, 12, 0.94)', 13, socket);
    const eye = centroid(socket);
    for (let i = 0; i < 7; i++) {
      const p = add(eye, [(random() - 0.5) * 150, (random() - 0.3) * 120]);
      blob(ctx, `rgba(12, 10, 12, ${0.35 + random() * 0.4})`, 14, p, 20 + random() * 30, 12 + random() * 22, random() * 3);
    }
    const drip = add(pt(side.socket[4]), [(random() - 0.5) * 30, 0]);
    strokeLine(ctx, 'rgba(12, 10, 12, 0.5)', 6, 9, [drip, add(drip, [(random() - 0.5) * 16, 60 + random() * 50])]);
  }

  const red = (alpha) => `rgba(150, 14, 22, ${alpha})`;
  lips(ctx, red(0.95), 3, 26);
  paint(ctx, red(0.95), 3, () => {
    trace(ctx, pts(LIPS_INNER), true);
    ctx.fill();
  });
  for (const side of SIDES) {
    const corner = pt(side.mouth);
    const end = add(lerp(corner, pt(side.cheek), 0.8), [Math.sign(outward(side)[0]) * 40, 0]);
    const control = add(lerp(corner, end, 0.55), [0, 60]);
    taper(ctx, red(0.92), 3, lerp(corner, pt(13), 0.3), control, end, 58);
    for (let i = 0; i < 6; i++) {
      const jitter = () => [(random() - 0.5) * 22, (random() - 0.5) * 22];
      taper(ctx, red(0.4 + random() * 0.4), 4, add(corner, jitter()), add(control, jitter()), add(end, jitter()), 14 + random() * 20);
    }
  }
  for (let i = 0; i < 10; i++) {
    const p = add(lerp(LIP_TOP, LIP_BOTTOM, random()), [(random() - 0.5) * 240, (random() - 0.5) * 50]);
    blob(ctx, red(0.25 + random() * 0.3), 9, p, 10 + random() * 22, 6 + random() * 12, random() * 3);
  }
}

// Real face paint never goes on perfectly even either.
const worn = (draw, seed, amount) => (ctx) => {
  draw(ctx);
  wear(ctx, seed, amount);
};

export const PRESETS = [
  {
    group: 'Makeup',
    looks: [
      { id: 'soft-glam', name: 'Soft glam', blend: BLEND.multiply, draw: softGlam },
      { id: 'abg', name: 'ABG', blend: BLEND.multiply, draw: abg },
      { id: 'red-carpet', name: 'Red carpet', blend: BLEND.multiply, draw: redCarpet },
      { id: 'unblended', name: 'Unblended', blend: BLEND.multiply, draw: unblended },
    ],
  },
  {
    group: 'Masculine',
    looks: [
      { id: 'chiseled', name: 'Chiseled', blend: BLEND.multiply, draw: chiseled },
      { id: 'five-o-clock', name: 'Stubble', blend: BLEND.multiply, draw: fiveOClock },
      { id: 'rugged', name: 'Rugged', blend: BLEND.multiply, draw: rugged },
      { id: 'idol', name: 'Idol', blend: BLEND.multiply, draw: idol },
    ],
  },
  {
    group: 'Colour',
    looks: [
      { id: 'sunset', name: 'Sunset', blend: BLEND.multiply, draw: sunset },
      { id: 'euphoria', name: 'Euphoria', blend: BLEND.multiply, draw: euphoria },
      { id: 'aurora', name: 'Aurora', blend: BLEND.multiply, draw: aurora },
      { id: 'graphic-liner', name: 'Graphic liner', blend: BLEND.multiply, draw: graphicLiner },
      { id: 'rainbow', name: 'Rainbow', blend: BLEND.multiply, draw: rainbow },
      { id: 'e-girl', name: 'E-girl', blend: BLEND.multiply, draw: eGirl },
      { id: 'goth', name: 'Goth', blend: BLEND.multiply, draw: goth },
    ],
  },
  {
    group: 'Characters',
    looks: [
      { id: 'spider-man', name: 'Spider-Man', blend: BLEND.multiply, draw: worn(spiderMan, 401, { grain: 0.1, mottle: 0.12, patch: 0.14 }) },
      { id: 'avatar', name: 'Avatar', blend: BLEND.multiply, draw: worn(avatar, 501, { grain: 0.12, mottle: 0.14, patch: 0.16 }) },
      { id: 'clown', name: 'McD clown', blend: BLEND.multiply, draw: worn(clown, 601, { grain: 0.1, mottle: 0.14, patch: 0.2 }) },
      { id: 'joker', name: 'Joker', blend: BLEND.multiply, draw: joker },
    ],
  },
];
