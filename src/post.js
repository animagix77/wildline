import * as THREE from 'three';
import { vw, vh } from './utils.js';

/* =========================================================================
   HDR + bloom.

   This is the piece that makes explosions feel like explosions. Previously the
   renderer tone-mapped straight to the screen, so a fireball could never be
   brighter than white — there was no headroom for anything to *glow*.

   Now the scene renders LINEAR into a half-float target with tone mapping off,
   so emissives are free to sit at 3-4x white. A bright pass with a soft knee
   extracts the over-bright pixels, three ping-pong blurs at descending
   resolution smear them, and the composite adds the result back, then applies
   ACES and the sRGB encode that the renderer used to do on its own.

   Written by hand rather than pulled from examples/jsm so the single-file
   build keeps working — EffectComposer lives outside the three core bundle.
   ========================================================================= */

const QUAD = new THREE.PlaneGeometry(2, 2);
const ORTHO = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);

let sceneRT = null;
let chain = [];              // [{ a, b, scale }] descending resolution
let brightMat, blurMat, compMat;
let quadScene, quad;
let enabled = true;
let dpr = 1;

const VS = `
  varying vec2 vUv;
  void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }`;

export function initPost(renderer) {
  disposePost();
  dpr = renderer.getPixelRatio();
  const w = Math.max(2, Math.floor(vw() * dpr));
  const h = Math.max(2, Math.floor(vh() * dpr));

  const opts = {
    minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter,
    type: THREE.HalfFloatType, depthBuffer: true, stencilBuffer: false,
  };
  sceneRT = new THREE.WebGLRenderTarget(w, h, opts);

  /* three descending levels: wide, soft falloff without a huge kernel */
  chain = [2, 4, 8].map(scale => ({
    scale,
    a: new THREE.WebGLRenderTarget(Math.max(2, w / scale | 0), Math.max(2, h / scale | 0),
      { ...opts, depthBuffer: false }),
    b: new THREE.WebGLRenderTarget(Math.max(2, w / scale | 0), Math.max(2, h / scale | 0),
      { ...opts, depthBuffer: false }),
  }));

  brightMat = new THREE.ShaderMaterial({
    uniforms: { tSrc: { value: null }, uThreshold: { value: 1.0 }, uKnee: { value: 0.6 } },
    vertexShader: VS,
    fragmentShader: `
      uniform sampler2D tSrc; uniform float uThreshold, uKnee;
      varying vec2 vUv;
      void main() {
        vec3 c = texture2D(tSrc, vUv).rgb;
        float b = max(c.r, max(c.g, c.b));
        /* soft knee: fades in over uKnee rather than clipping at the threshold,
           so a fireball's edge glows instead of showing a hard bloom boundary */
        float k = clamp((b - uThreshold + uKnee) / (2.0 * uKnee), 0.0, 1.0);
        float w = max(b - uThreshold, k * k * uKnee) / max(b, 1e-4);
        gl_FragColor = vec4(c * w, 1.0);
      }`,
  });

  blurMat = new THREE.ShaderMaterial({
    uniforms: { tSrc: { value: null }, uDir: { value: new THREE.Vector2(1, 0) },
                uTexel: { value: new THREE.Vector2() } },
    vertexShader: VS,
    fragmentShader: `
      uniform sampler2D tSrc; uniform vec2 uDir, uTexel;
      varying vec2 vUv;
      void main() {
        /* 9-tap gaussian, linear-sampled */
        vec2 o = uDir * uTexel;
        vec3 c = texture2D(tSrc, vUv).rgb * 0.227027;
        c += (texture2D(tSrc, vUv + o * 1.3846).rgb + texture2D(tSrc, vUv - o * 1.3846).rgb) * 0.316216;
        c += (texture2D(tSrc, vUv + o * 3.2308).rgb + texture2D(tSrc, vUv - o * 3.2308).rgb) * 0.070270;
        gl_FragColor = vec4(c, 1.0);
      }`,
  });

  compMat = new THREE.ShaderMaterial({
    uniforms: {
      tScene: { value: null }, tB0: { value: null }, tB1: { value: null }, tB2: { value: null },
      uStrength: { value: 0.85 }, uExposure: { value: 1.08 },
      uVignette: { value: 0.32 }, uShake: { value: 0 }, uAberration: { value: 0.0 },
    },
    vertexShader: VS,
    fragmentShader: `
      uniform sampler2D tScene, tB0, tB1, tB2;
      uniform float uStrength, uExposure, uVignette, uAberration;
      varying vec2 vUv;
      vec3 aces(vec3 x){
        float a=2.51,b=0.03,c=2.43,d=0.59,e=0.14;
        return clamp((x*(a*x+b))/(x*(c*x+d)+e), 0.0, 1.0);
      }
      vec3 toSRGB(vec3 c){
        return mix(c*12.92, 1.055*pow(max(c,vec3(0.0)),vec3(1.0/2.4))-0.055, step(vec3(0.0031308), c));
      }
      void main() {
        vec2 uv = vUv;
        vec3 col;
        if (uAberration > 0.001) {
          /* radial chromatic split — only ever driven by a big detonation */
          vec2 d = (uv - 0.5) * uAberration;
          col = vec3(
            texture2D(tScene, uv - d).r,
            texture2D(tScene, uv).g,
            texture2D(tScene, uv + d).b);
        } else {
          col = texture2D(tScene, uv).rgb;
        }
        vec3 bloom = texture2D(tB0, uv).rgb * 0.55
                   + texture2D(tB1, uv).rgb * 0.30
                   + texture2D(tB2, uv).rgb * 0.15;
        col += bloom * uStrength;
        col *= uExposure;
        col = aces(col);
        float v = distance(uv, vec2(0.5));
        col *= 1.0 - uVignette * smoothstep(0.35, 0.95, v);
        gl_FragColor = vec4(toSRGB(col), 1.0);
      }`,
  });

  quadScene = new THREE.Scene();
  quad = new THREE.Mesh(QUAD, brightMat);
  quad.frustumCulled = false;
  quadScene.add(quad);
  return true;
}

export function setPostEnabled(v) { enabled = !!v; }
export function postEnabled() { return enabled; }

/* Drives the one-frame screen punch a big detonation earns. */
let aberration = 0;
export function postPunch(amount) { aberration = Math.min(0.012, aberration + amount); }

export function resizePost(renderer) {
  if (!sceneRT) return;
  dpr = renderer.getPixelRatio();
  const w = Math.max(2, Math.floor(vw() * dpr));
  const h = Math.max(2, Math.floor(vh() * dpr));
  sceneRT.setSize(w, h);
  for (const lvl of chain) {
    const lw = Math.max(2, w / lvl.scale | 0), lh = Math.max(2, h / lvl.scale | 0);
    lvl.a.setSize(lw, lh); lvl.b.setSize(lw, lh);
  }
}

function blit(renderer, mat, target) {
  quad.material = mat;
  renderer.setRenderTarget(target);
  renderer.clear();
  renderer.render(quadScene, ORTHO);
}

/* Replaces renderer.render(scene, camera). */
export function renderPost(renderer, scene, camera, dt) {
  if (!enabled || !sceneRT) {
    renderer.setRenderTarget(null);
    renderer.render(scene, camera);
    return;
  }
  aberration = Math.max(0, aberration - (dt || 0.016) * 0.05);

  /* 1 · scene, linear and un-tonemapped, into HDR */
  const prevTone = renderer.toneMapping, prevOut = renderer.outputColorSpace;
  renderer.toneMapping = THREE.NoToneMapping;
  renderer.outputColorSpace = THREE.LinearSRGBColorSpace;
  renderer.setRenderTarget(sceneRT);
  renderer.clear();
  renderer.render(scene, camera);

  /* 2 · bright pass into the widest level */
  brightMat.uniforms.tSrc.value = sceneRT.texture;
  blit(renderer, brightMat, chain[0].a);

  /* 3 · separable blur per level, each seeded from the one above */
  for (let i = 0; i < chain.length; i++) {
    const lvl = chain[i];
    if (i > 0) { brightMat.uniforms.tSrc.value = chain[i - 1].a.texture; blit(renderer, brightMat, lvl.a); }
    const tx = 1 / lvl.a.width, ty = 1 / lvl.a.height;
    blurMat.uniforms.tSrc.value = lvl.a.texture;
    blurMat.uniforms.uTexel.value.set(tx, ty);
    blurMat.uniforms.uDir.value.set(1, 0);
    blit(renderer, blurMat, lvl.b);
    blurMat.uniforms.tSrc.value = lvl.b.texture;
    blurMat.uniforms.uDir.value.set(0, 1);
    blit(renderer, blurMat, lvl.a);
  }

  /* 4 · composite, tone map, encode */
  renderer.toneMapping = prevTone;
  renderer.outputColorSpace = prevOut;
  compMat.uniforms.tScene.value = sceneRT.texture;
  compMat.uniforms.tB0.value = chain[0].a.texture;
  compMat.uniforms.tB1.value = chain[1].a.texture;
  compMat.uniforms.tB2.value = chain[2].a.texture;
  compMat.uniforms.uAberration.value = aberration;
  quad.material = compMat;
  renderer.setRenderTarget(null);
  renderer.render(quadScene, ORTHO);
}

export function disposePost() {
  if (sceneRT) sceneRT.dispose();
  for (const lvl of chain) { lvl.a.dispose(); lvl.b.dispose(); }
  chain = []; sceneRT = null;
  for (const m of [brightMat, blurMat, compMat]) m && m.dispose();
  brightMat = blurMat = compMat = null;
}
