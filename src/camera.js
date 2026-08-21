import * as THREE from 'three';
import { G } from './state.js';
import { HALF } from './config.js';
import { terrainHeight, clamp, lerp, vw, vh } from './utils.js';

export class RTSCamera {
  constructor(camera) {
    this.cam = camera;
    this.target = new THREE.Vector3();
    this.yaw = -0.55;
    this.dist = 95;
    this.minD = 42; this.maxD = 200;
    this.panSpeed = 62;
    this.edgePan = true;
    // start at screen centre so edge-pan never fires before the first real move
    this.mouse = { x: vw() / 2, y: vh() / 2, inside: false };
    this.dragPan = null;
    this.shake = 0;
    this.wantDist = this.dist;
    this.wantYaw = this.yaw;
    this.panVel = new THREE.Vector3();   // carries a little momentum after you let go
    this._tmp = new THREE.Vector3();
    this._tmp2 = new THREE.Vector3();
  }

  /* Slow orbit used as a live 3D backdrop behind the title screen. */
  updateCinematic(dt) {
    this.yaw += dt * 0.055;
    this.wantYaw = this.yaw;
    this.dist = this.wantDist = 150;
    const c = this.cinematic;
    this.target.set(c.x, terrainHeight(c.x, c.z), c.z);
    const p = this.pitch, cp = Math.cos(p), sp = Math.sin(p);
    this.cam.position.set(
      this.target.x + Math.sin(this.yaw) * cp * this.dist,
      this.target.y + sp * this.dist,
      this.target.z + Math.cos(this.yaw) * cp * this.dist
    );
    this.cam.lookAt(this.target);
    if (G.sun) {
      G.sun.position.set(this.target.x - 70, 110, this.target.z + 60);
      G.sun.target.position.copy(this.target);
      G.sun.target.updateMatrixWorld();
    }
  }

  get pitch() {
    const t = (this.dist - this.minD) / (this.maxD - this.minD);
    return lerp(0.62, 1.15, t * t);
  }

  focus(p, snap = false, dist) {
    this.panVel.set(0, 0, 0);
    if (dist !== undefined) this.setDistance(dist);
    if (snap) this.target.set(p.x, 0, p.z);
    else this.goal = new THREE.Vector3(p.x, 0, p.z);
  }

  /* Assigning `.dist` directly is silently undone by the easing on the next frame.
     Anything outside the rig should go through this. */
  setDistance(d) {
    this.dist = this.wantDist = clamp(d, this.minD, this.maxD);
  }

  zoom(delta) {
    this.wantDist = clamp((this.wantDist || this.dist) * Math.exp(delta * 0.0011), this.minD, this.maxD);
  }

  rotate(d) { this.wantYaw += d; }

  forward(out) { return out.set(-Math.sin(this.yaw), 0, -Math.cos(this.yaw)); }
  right(out) { return out.set(Math.cos(this.yaw), 0, -Math.sin(this.yaw)); }

  update(dt) {
    if (this.cinematic) return this.updateCinematic(dt);
    const k = G.keys;
    let fx = 0, rx = 0;
    // Letters are unit commands (classic RTS layout), so panning is arrows /
    // screen edge / middle-drag / minimap only.
    if (k.has('ArrowUp')) fx += 1;
    if (k.has('ArrowDown')) fx -= 1;
    if (k.has('ArrowRight')) rx += 1;
    if (k.has('ArrowLeft')) rx -= 1;

    // screen-edge pan
    if (this.edgePan && this.mouse.inside && !this.dragPan) {
      const m = 14;
      if (this.mouse.x < m) rx -= 1;
      else if (this.mouse.x > vw() - m) rx += 1;
      if (this.mouse.y < m) fx += 1;
      else if (this.mouse.y > vh() - m) fx -= 1;
    }

    if (k.has('KeyQ')) this.wantYaw -= dt * 1.4;
    if (k.has('KeyE')) this.wantYaw += dt * 1.4;
    // ease rotation and zoom rather than snapping — this is most of the "feel"
    this.yaw += (this.wantYaw - this.yaw) * Math.min(1, dt * 9);
    this.dist += (this.wantDist - this.dist) * Math.min(1, dt * 9);

    if (fx || rx) {
      this.goal = null;
      const f = this.forward(this._tmp).multiplyScalar(fx);
      this.right(this._tmp2).multiplyScalar(rx);
      f.add(this._tmp2);
      if (f.lengthSq() > 0) f.normalize();
      const sp = this.panSpeed * (this.dist / 95) * ((k.has('ShiftLeft') || k.has('ShiftRight')) ? 2 : 1);
      this.panVel.lerp(f.multiplyScalar(sp), Math.min(1, dt * 12));
    } else {
      this.panVel.multiplyScalar(Math.max(0, 1 - dt * 16));  // brief glide, not a drift
    }
    if (this.panVel.lengthSq() > 1e-4) this.target.addScaledVector(this.panVel, dt);

    if (this.goal) {
      this.target.lerp(this.goal, Math.min(1, dt * 7));
      if (this.target.distanceTo(this.goal) < 0.6) this.goal = null;
    }

    this.target.x = clamp(this.target.x, -HALF + 10, HALF - 10);
    this.target.z = clamp(this.target.z, -HALF + 10, HALF - 10);
    this.target.y = terrainHeight(this.target.x, this.target.z);

    const p = this.pitch;
    const cp = Math.cos(p), sp2 = Math.sin(p);
    this.cam.position.set(
      this.target.x + Math.sin(this.yaw) * cp * this.dist,
      this.target.y + sp2 * this.dist,
      this.target.z + Math.cos(this.yaw) * cp * this.dist
    );
    if (this.shake > 0) {
      this.shake = Math.max(0, this.shake - dt * 2.2);
      const s = this.shake * this.shake * 2.4;
      this.cam.position.x += (Math.random() - 0.5) * s;
      this.cam.position.y += (Math.random() - 0.5) * s;
      this.cam.position.z += (Math.random() - 0.5) * s;
    }
    this.cam.lookAt(this.target);

    // keep the shadow frustum riding along with the view
    if (G.sun) {
      G.sun.position.set(this.target.x - 70, 110, this.target.z + 60);
      G.sun.target.position.copy(this.target);
      G.sun.target.updateMatrixWorld();
    }
  }
}
