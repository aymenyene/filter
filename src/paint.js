import { TRIANGLES, UVS } from './faceMesh.js';

const MAX_UNDO = 20;

function makeCanvas(width, height) {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  return canvas;
}

function hexToRgb(hex) {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

export class TextureStudio {
  constructor({ canvas, guide, cursor, onChange, onHistory }) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.cursor = cursor;
    this.onChange = onChange;
    this.onHistory = onHistory;

    const { width, height } = canvas;
    this.base = makeCanvas(width, height);
    this.baseCtx = this.base.getContext('2d');
    this.stroke = makeCanvas(width, height);
    this.strokeCtx = this.stroke.getContext('2d');
    this.stamp = makeCanvas(1, 1);

    this.brush = { size: 28, strength: 0.6, softness: 0.7, color: '#c2185b', eraser: false, symmetry: false };
    this.undoStack = [];
    this.redoStack = [];
    this.drawing = false;
    this.last = null;
    this.carry = 0;

    this.drawGuide(guide);
    this.updateStamp();

    canvas.addEventListener('pointerdown', (e) => this.onDown(e));
    canvas.addEventListener('pointermove', (e) => this.onMove(e));
    canvas.addEventListener('pointerup', (e) => this.onUp(e));
    canvas.addEventListener('pointercancel', (e) => this.onUp(e));
    canvas.addEventListener('pointerleave', () => (this.cursor.hidden = true));
    canvas.addEventListener('pointerenter', (e) => this.moveCursor(e));
  }

  drawGuide(guide) {
    const ctx = guide.getContext('2d');
    const { width: w, height: h } = guide;
    ctx.beginPath();
    for (let i = 0; i < TRIANGLES.length; i += 3) {
      for (let k = 0; k < 3; k++) {
        const v = TRIANGLES[i + k] * 2;
        const x = UVS[v] * w;
        const y = (1 - UVS[v + 1]) * h;
        if (k === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.closePath();
    }
    ctx.fillStyle = '#d8ab8f';
    ctx.strokeStyle = '#d8ab8f';
    ctx.lineWidth = 1.5;
    ctx.fill();
    ctx.stroke();
    ctx.strokeStyle = 'rgba(60, 30, 20, 0.13)';
    ctx.lineWidth = 1;
    ctx.stroke();
  }

  setBrush(patch) {
    Object.assign(this.brush, patch);
    this.updateStamp();
    this.sizeCursor();
  }

  updateStamp() {
    const { size, softness, color, eraser } = this.brush;
    const dim = Math.ceil(size) * 2 + 2;
    this.stamp.width = this.stamp.height = dim;
    const ctx = this.stamp.getContext('2d');
    const [r, g, b] = eraser ? [0, 0, 0] : hexToRgb(color);
    const c = dim / 2;
    const inner = Math.min(1 - softness, 1 - 1.5 / size);
    const gradient = ctx.createRadialGradient(c, c, 0, c, c, size);
    const STOPS = 10;
    for (let i = 0; i <= STOPS; i++) {
      const t = i / STOPS;
      const alpha = 0.5 + 0.5 * Math.cos(Math.PI * t);
      gradient.addColorStop(Math.max(0, inner) + (1 - Math.max(0, inner)) * t, `rgba(${r},${g},${b},${alpha})`);
    }
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, dim, dim);
    this.flow = 1 - 0.8 * softness;
    this.spacing = Math.max(1, size * 0.1);
  }

  toCanvas(e) {
    const rect = this.canvas.getBoundingClientRect();
    return {
      x: ((e.clientX - rect.left) / rect.width) * this.canvas.width,
      y: ((e.clientY - rect.top) / rect.height) * this.canvas.height,
    };
  }

  sizeCursor() {
    const scale = this.canvas.getBoundingClientRect().width / this.canvas.width;
    const d = Math.max(4, this.brush.size * 2 * scale);
    this.cursor.style.width = this.cursor.style.height = `${d}px`;
  }

  moveCursor(e) {
    const rect = this.canvas.getBoundingClientRect();
    this.sizeCursor();
    const d = parseFloat(this.cursor.style.width);
    this.cursor.style.transform = `translate(${e.clientX - rect.left - d / 2}px, ${e.clientY - rect.top - d / 2}px)`;
    this.cursor.hidden = false;
  }

  dab(x, y, repeat = 1) {
    const ctx = this.strokeCtx;
    const half = this.stamp.width / 2;
    ctx.globalAlpha = this.flow;
    for (let i = 0; i < repeat; i++) {
      ctx.drawImage(this.stamp, x - half, y - half);
      if (this.brush.symmetry) ctx.drawImage(this.stamp, this.canvas.width - x - half, y - half);
    }
  }

  onDown(e) {
    if (e.button !== 0 || this.drawing) return;
    e.preventDefault();
    this.canvas.setPointerCapture(e.pointerId);
    this.pushUndo();
    this.drawing = true;
    this.last = this.toCanvas(e);
    this.carry = 0;
    this.dab(this.last.x, this.last.y, Math.round(1 / this.flow));
    this.composite();
  }

  onMove(e) {
    this.moveCursor(e);
    if (!this.drawing) return;
    const events = e.getCoalescedEvents?.() ?? [];
    for (const ev of events.length ? events : [e]) this.strokeTo(this.toCanvas(ev));
    this.composite();
  }

  strokeTo(point) {
    const dx = point.x - this.last.x;
    const dy = point.y - this.last.y;
    const dist = Math.hypot(dx, dy);
    let travelled = this.spacing - this.carry;
    for (; travelled <= dist; travelled += this.spacing) {
      const t = travelled / dist;
      this.dab(this.last.x + dx * t, this.last.y + dy * t);
    }
    this.carry = dist - (travelled - this.spacing);
    this.last = point;
  }

  onUp() {
    if (!this.drawing) return;
    this.drawing = false;
    this.applyStroke(this.baseCtx);
    this.strokeCtx.clearRect(0, 0, this.stroke.width, this.stroke.height);
    this.composite();
  }

  applyStroke(ctx) {
    ctx.save();
    ctx.globalAlpha = this.brush.strength;
    ctx.globalCompositeOperation = this.brush.eraser ? 'destination-out' : 'source-over';
    ctx.drawImage(this.stroke, 0, 0);
    ctx.restore();
  }

  composite() {
    const { ctx, canvas } = this;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(this.base, 0, 0);
    if (this.drawing) this.applyStroke(ctx);
    this.onChange?.();
  }

  snapshot() {
    const snapshot = makeCanvas(this.base.width, this.base.height);
    snapshot.getContext('2d').drawImage(this.base, 0, 0);
    return snapshot;
  }

  pushUndo() {
    this.undoStack.push(this.snapshot());
    if (this.undoStack.length > MAX_UNDO) this.undoStack.shift();
    this.redoStack.length = 0;
    this.onHistory?.();
  }

  restore(from, to) {
    if (this.drawing || !from.length) return;
    to.push(this.snapshot());
    this.baseCtx.clearRect(0, 0, this.base.width, this.base.height);
    this.baseCtx.drawImage(from.pop(), 0, 0);
    this.composite();
    this.onHistory?.();
  }

  undo() {
    this.restore(this.undoStack, this.redoStack);
  }

  redo() {
    this.restore(this.redoStack, this.undoStack);
  }

  applyPreset(draw) {
    if (this.drawing) return;
    this.pushUndo();
    this.baseCtx.clearRect(0, 0, this.base.width, this.base.height);
    this.baseCtx.save();
    draw(this.baseCtx);
    this.baseCtx.restore();
    this.composite();
  }

  clear() {
    if (this.drawing) return;
    this.pushUndo();
    this.baseCtx.clearRect(0, 0, this.base.width, this.base.height);
    this.composite();
  }
}
