const MIN_CUTOFF = 2;
const BETA = 150;
const DERIVATIVE_CUTOFF = 1;
const HEAD_DERIVATIVE_CUTOFF = 8;

const alpha = (cutoff, dt) => 1 / (1 + 1 / (2 * Math.PI * cutoff * dt));

// One Euro filter over all landmarks: heavy smoothing when the face is still (removes jitter),
// almost none when it moves (no lag). Head motion as a whole opens the filter for every vertex,
// so the mesh never deforms or trails during fast movement.
export class LandmarkFilter {
  constructor(count) {
    this.count = count;
    this.velocity = new Float32Array(count * 3);
    this.headVelocity = new Float32Array(3);
    this.center = new Float32Array(3);
    this.reset();
  }

  reset() {
    this.time = null;
  }

  apply(landmarks, time, out) {
    const { count, velocity, headVelocity, center } = this;
    const dt = this.time === null ? 0 : time - this.time;
    this.time = time;

    let cx = 0;
    let cy = 0;
    let cz = 0;
    for (let i = 0; i < count; i++) {
      cx += landmarks[i].x;
      cy += landmarks[i].y;
      cz += landmarks[i].z;
    }
    const next = [cx / count, cy / count, cz / count];

    if (dt <= 0 || dt > 0.25) {
      for (let i = 0; i < count; i++) {
        out[i * 3] = landmarks[i].x;
        out[i * 3 + 1] = landmarks[i].y;
        out[i * 3 + 2] = landmarks[i].z;
      }
      velocity.fill(0);
      headVelocity.fill(0);
      center.set(next);
      return;
    }

    const aD = alpha(DERIVATIVE_CUTOFF, dt);
    const aH = alpha(HEAD_DERIVATIVE_CUTOFF, dt);
    for (let k = 0; k < 3; k++) {
      headVelocity[k] += aH * ((next[k] - center[k]) / dt - headVelocity[k]);
      center[k] = next[k];
    }
    const headSpeed = Math.hypot(headVelocity[0], headVelocity[1], headVelocity[2]);

    for (let i = 0; i < count; i++) {
      const j = i * 3;
      const p = landmarks[i];
      velocity[j] += aD * ((p.x - out[j]) / dt - velocity[j]);
      velocity[j + 1] += aD * ((p.y - out[j + 1]) / dt - velocity[j + 1]);
      velocity[j + 2] += aD * ((p.z - out[j + 2]) / dt - velocity[j + 2]);
      const speed = Math.max(headSpeed, Math.hypot(velocity[j], velocity[j + 1], velocity[j + 2]));
      const a = alpha(MIN_CUTOFF + BETA * speed, dt);
      out[j] += a * (p.x - out[j]);
      out[j + 1] += a * (p.y - out[j + 1]);
      out[j + 2] += a * (p.z - out[j + 2]);
    }
  }
}
