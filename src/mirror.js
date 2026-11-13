import * as THREE from 'three';
import { BASE_COUNT, EDGE_WEIGHTS, extendMesh, TRIANGLES, UVS, VERTEX_COUNT } from './faceMesh.js';
import { LandmarkFilter } from './landmarkFilter.js';

const FADE_IN_MS = 80;
const FADE_OUT_MS = 160;

const BACKGROUND_VERT = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = vec4(position.xy, 0.0, 1.0);
  }
`;

const BACKGROUND_FRAG = /* glsl */ `
  uniform sampler2D uVideo;
  varying vec2 vUv;
  void main() {
    gl_FragColor = vec4(texture2D(uVideo, vUv).rgb, 1.0);
  }
`;

const FACE_VERT = /* glsl */ `
  attribute float fade;
  varying vec2 vUv;
  varying vec2 vScreen;
  varying float vFade;
  void main() {
    vUv = uv;
    vFade = fade;
    vScreen = vec2(position.x, 1.0 - position.y);
    gl_Position = vec4(position.x * 2.0 - 1.0, 1.0 - position.y * 2.0, clamp(position.z * 2.0, -1.0, 1.0), 1.0);
  }
`;

const FACE_FRAG = /* glsl */ `
  uniform sampler2D uVideo;
  uniform sampler2D uPaint;
  uniform int uMode;
  uniform float uOpacity;
  varying vec2 vUv;
  varying vec2 vScreen;
  varying float vFade;

  float luma(vec3 c) {
    return dot(c, vec3(0.299, 0.587, 0.114));
  }

  vec3 softLight(vec3 s, vec3 c) {
    vec3 d = mix(sqrt(s), ((16.0 * s - 12.0) * s + 4.0) * s, step(s, vec3(0.25)));
    return mix(s - (1.0 - 2.0 * c) * s * (1.0 - s), s + (2.0 * c - 1.0) * (d - s), step(0.5, c));
  }

  vec3 overlay(vec3 s, vec3 c) {
    return mix(2.0 * s * c, 1.0 - 2.0 * (1.0 - s) * (1.0 - c), step(0.5, s));
  }

  void main() {
    vec3 skin = texture2D(uVideo, vScreen).rgb;
    vec4 paint = texture2D(uPaint, vUv);
    vec3 color = paint.rgb / max(paint.a, 0.0001);

    vec3 pigment = min(color * clamp(luma(skin) / 0.6, 0.0, 1.5), 1.0);

    // Multiply can only darken, so whites and near-whites are laid on as pigment instead.
    float whiteness = smoothstep(0.5, 0.9, min(color.r, min(color.g, color.b)));

    vec3 blended;
    if (uMode == 0) blended = mix(skin * color, pigment, whiteness);
    else if (uMode == 1) blended = softLight(skin, color);
    else if (uMode == 2) blended = overlay(skin, color);
    else if (uMode == 3) blended = pigment;
    else blended = color;

    gl_FragColor = vec4(mix(skin, blended, paint.a * uOpacity * smoothstep(0.0, 1.0, vFade)), 1.0);
  }
`;

const WIRE_FRAG = /* glsl */ `
  void main() {
    gl_FragColor = vec4(0.2, 1.0, 0.7, 1.0);
  }
`;

export class ARMirror {
  constructor({ canvas, video, paintCanvas }) {
    this.video = video;
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false });
    this.renderer.setPixelRatio(1);
    this.scene = new THREE.Scene();
    this.camera = new THREE.Camera();

    this.frame = document.createElement('canvas');
    this.frameCtx = this.frame.getContext('2d', { alpha: false });
    this.videoTexture = new THREE.CanvasTexture(this.frame);
    this.videoTexture.generateMipmaps = false;
    this.videoTexture.minFilter = THREE.LinearFilter;
    this.paintTexture = new THREE.CanvasTexture(paintCanvas);
    this.paintTexture.premultiplyAlpha = true;
    this.paintTexture.anisotropy = this.renderer.capabilities.getMaxAnisotropy();

    const background = new THREE.Mesh(
      new THREE.PlaneGeometry(2, 2),
      new THREE.ShaderMaterial({
        uniforms: { uVideo: { value: this.videoTexture } },
        vertexShader: BACKGROUND_VERT,
        fragmentShader: BACKGROUND_FRAG,
        depthTest: false,
        depthWrite: false,
      }),
    );
    background.frustumCulled = false;
    background.renderOrder = 0;

    this.positions = new THREE.BufferAttribute(new Float32Array(VERTEX_COUNT * 3), 3);
    this.positions.setUsage(THREE.DynamicDrawUsage);
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', this.positions);
    geometry.setAttribute('uv', new THREE.BufferAttribute(UVS, 2));
    this.fade = new THREE.BufferAttribute(new Float32Array(VERTEX_COUNT), 1);
    this.fade.setUsage(THREE.DynamicDrawUsage);
    geometry.setAttribute('fade', this.fade);
    this.normalZ = new Float32Array(VERTEX_COUNT);
    this.normalLength = new Float32Array(VERTEX_COUNT);
    this.filter = new LandmarkFilter(BASE_COUNT);
    this.opacity = 0;
    this.tracked = false;
    this.lastRender = 0;
    geometry.setIndex(new THREE.BufferAttribute(TRIANGLES, 1));

    this.faceMaterial = new THREE.ShaderMaterial({
      uniforms: {
        uVideo: { value: this.videoTexture },
        uPaint: { value: this.paintTexture },
        uMode: { value: 0 },
        uOpacity: { value: 0 },
      },
      vertexShader: FACE_VERT,
      fragmentShader: FACE_FRAG,
      side: THREE.DoubleSide,
    });
    this.face = new THREE.Mesh(geometry, this.faceMaterial);
    this.face.frustumCulled = false;
    this.face.renderOrder = 1;
    this.face.visible = false;

    this.wire = new THREE.Mesh(
      geometry,
      new THREE.ShaderMaterial({
        vertexShader: FACE_VERT,
        fragmentShader: WIRE_FRAG,
        wireframe: true,
        depthTest: false,
        depthWrite: false,
      }),
    );
    this.wire.frustumCulled = false;
    this.wire.renderOrder = 2;
    this.wire.visible = false;
    this.showWire = false;

    this.scene.add(background, this.face, this.wire);
  }

  captureFrame() {
    const { videoWidth: w, videoHeight: h } = this.video;
    if (!w || !h) return null;
    if (this.frame.width !== w || this.frame.height !== h) {
      this.frame.width = w;
      this.frame.height = h;
      this.videoTexture.dispose();
      this.renderer.setSize(w, h, false);
    }
    this.frameCtx.drawImage(this.video, 0, 0, w, h);
    this.videoTexture.needsUpdate = true;
    return this.frame;
  }

  setBlendMode(mode) {
    this.faceMaterial.uniforms.uMode.value = mode;
  }

  setShowMesh(show) {
    this.showWire = show;
  }

  paintChanged() {
    this.paintTexture.needsUpdate = true;
  }

  setLandmarks(landmarks, time) {
    this.tracked = !!landmarks;
    if (!landmarks) return;
    if (this.opacity === 0) this.filter.reset();
    this.filter.apply(landmarks, time, this.positions.array);
    extendMesh(this.positions.array, 3);
    this.positions.needsUpdate = true;
    this.updateFade();
  }

  // Fades paint out at the feathered rim and on triangles that are almost edge-on to the camera.
  updateFade() {
    const p = this.positions.array;
    const { normalZ, normalLength } = this;
    const sx = this.frame.width;
    const sy = this.frame.height;
    normalZ.fill(0);
    normalLength.fill(0);
    for (let t = 0; t < TRIANGLES.length; t += 3) {
      const a = TRIANGLES[t] * 3;
      const b = TRIANGLES[t + 1] * 3;
      const c = TRIANGLES[t + 2] * 3;
      const ux = (p[b] - p[a]) * sx;
      const uy = (p[b + 1] - p[a + 1]) * sy;
      const uz = (p[b + 2] - p[a + 2]) * sx;
      const vx = (p[c] - p[a]) * sx;
      const vy = (p[c + 1] - p[a + 1]) * sy;
      const vz = (p[c + 2] - p[a + 2]) * sx;
      const nx = uy * vz - uz * vy;
      const ny = uz * vx - ux * vz;
      const nz = ux * vy - uy * vx;
      const length = Math.hypot(nx, ny, nz);
      for (const i of [a / 3, b / 3, c / 3]) {
        normalZ[i] += nz;
        normalLength[i] += length;
      }
    }
    const fade = this.fade.array;
    for (let i = 0; i < VERTEX_COUNT; i++) {
      const facing = normalLength[i] ? Math.abs(normalZ[i]) / normalLength[i] : 0;
      fade[i] = EDGE_WEIGHTS[i] * Math.min(1, Math.max(0, (facing - 0.02) / 0.08));
    }
    this.fade.needsUpdate = true;
  }

  render() {
    const now = performance.now();
    const dt = Math.min(100, now - this.lastRender);
    this.lastRender = now;
    this.opacity = this.tracked
      ? Math.min(1, this.opacity + dt / FADE_IN_MS)
      : Math.max(0, this.opacity - dt / FADE_OUT_MS);
    this.faceMaterial.uniforms.uOpacity.value = this.opacity;
    this.face.visible = this.opacity > 0;
    this.wire.visible = this.showWire && this.face.visible;
    this.renderer.render(this.scene, this.camera);
  }
}
