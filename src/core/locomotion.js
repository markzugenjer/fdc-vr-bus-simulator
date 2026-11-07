import * as THREE from 'three';
import { clamp } from './util.js';

const _fwd = new THREE.Vector3();
const _head = new THREE.Vector3();
const DEADZONE = 0.15;
const SPEED = 2.2; // metres per second
const SNAP = Math.PI / 6; // 30 degrees per snap turn (more comfortable than smooth turning)

/**
 * VR: left thumbstick walks, right thumbstick snap-turns, B / Y opens the menu.
 * Desktop: W A S D or arrows walk, Q / E or left/right arrows turn, drag to look, M or Esc opens the menu.
 */
export class Locomotion {
  constructor(app) {
    this.app = app;
    this.keys = new Set();
    this.pitch = 0;
    this.snapReady = true;
    this.enabled = true;

    window.addEventListener('keydown', (e) => {
      this.keys.add(e.code);
      if (e.code === 'KeyM' || e.code === 'Escape') app.emit('menu');
    });
    window.addEventListener('keyup', (e) => this.keys.delete(e.code));
    window.addEventListener('blur', () => this.keys.clear());
  }

  look(dx, dy) {
    if (this.app.renderer.xr.isPresenting) return;
    if (!this.enabled) { this.yaw = clamp((this.yaw || 0) - dx * 0.004, -2.2, 2.2); this.pitch = clamp(this.pitch - dy * 0.004, -1.0, 1.0); return; }
    this.app.rig.rotation.y -= dx * 0.004;
    this.pitch = clamp(this.pitch - dy * 0.004, -1.3, 1.3);
  }

  reset() {
    this.pitch = this.app.current?.pitch ?? 0; // a scene can start the desktop view looking down
    if (!this.app.renderer.xr.isPresenting) this.app.camera.rotation.set(this.pitch, 0, 0);
  }

  update(dt) {
    const app = this.app;
    const xr = app.renderer.xr.isPresenting;
    let mx = 0;
    let mz = 0;

    // While driving, the bus moves the rig: only the menu button and the desktop look stay active.
    if (!this.enabled) {
      if (!xr) app.camera.rotation.set(this.pitch, this.yaw || 0, 0);
      else for (const p of app.pointers.controllers) {
        const gp = p.gamepad;
        if (!p.connected || !gp) continue;
        const back = !!gp.buttons[5]?.pressed;
        if (back && !p.backHeld) app.emit('menu');
        p.backHeld = back;
      }
      return;
    }

    if (!xr) {
      const k = this.keys;
      if (k.has('KeyW') || k.has('ArrowUp')) mz -= 1;
      if (k.has('KeyS') || k.has('ArrowDown')) mz += 1;
      if (k.has('KeyA')) mx -= 1;
      if (k.has('KeyD')) mx += 1;
      let turn = 0;
      if (k.has('KeyQ') || k.has('ArrowLeft')) turn += 1;
      if (k.has('KeyE') || k.has('ArrowRight')) turn -= 1;
      app.rig.rotation.y += turn * 1.8 * dt;
      app.camera.rotation.set(this.pitch, 0, 0);
    } else {
      for (const p of app.pointers.controllers) {
        const gp = p.gamepad;
        if (!p.connected || !gp) continue;
        const ax = gp.axes[2] ?? 0;
        const ay = gp.axes[3] ?? 0;
        if (p.handedness === 'left') {
          if (Math.abs(ax) > DEADZONE) mx += ax;
          if (Math.abs(ay) > DEADZONE) mz += ay;
        } else if (p.handedness === 'right') {
          if (Math.abs(ax) > 0.7 && this.snapReady) { this.snapTurn(ax > 0 ? -1 : 1); this.snapReady = false; }
          if (Math.abs(ax) < 0.3) this.snapReady = true;
        }
        const back = !!gp.buttons[5]?.pressed; // B on the right controller, Y on the left
        if (back && !p.backHeld) app.emit('menu');
        p.backHeld = back;
      }
    }

    if (!this.enabled || (!mx && !mz)) return;

    app.camera.getWorldDirection(_fwd);
    _fwd.y = 0;
    if (_fwd.lengthSq() < 1e-6) return;
    _fwd.normalize();
    // right = forward x up
    const rx = -_fwd.z;
    const rz = _fwd.x;
    let dx = rx * mx - _fwd.x * mz;
    let dz = rz * mx - _fwd.z * mz;
    const len = Math.hypot(dx, dz);
    const strength = Math.min(1, Math.hypot(mx, mz));
    dx = (dx / len) * strength * SPEED * dt;
    dz = (dz / len) * strength * SPEED * dt;

    const pos = app.rig.position;
    pos.x += dx;
    pos.z += dz;

    // Keep the player inside the scene's walkable circle.
    const bounds = app.current?.bounds ?? 20;
    const cx = app.current?.center?.x ?? 0;
    const cz = app.current?.center?.z ?? 0;
    const r = Math.hypot(pos.x - cx, pos.z - cz);
    if (r > bounds) {
      pos.x = cx + ((pos.x - cx) / r) * bounds;
      pos.z = cz + ((pos.z - cz) / r) * bounds;
    }
  }

  /** Turn around the head (not the rig origin) so the view doesn't slide sideways. */
  snapTurn(dir) {
    const app = this.app;
    app.camera.getWorldPosition(_head);
    const a = dir * SNAP;
    app.rig.rotation.y += a;
    const p = app.rig.position;
    const ox = p.x - _head.x;
    const oz = p.z - _head.z;
    const c = Math.cos(a);
    const s = Math.sin(a);
    p.x = _head.x + ox * c + oz * s;
    p.z = _head.z - ox * s + oz * c;
  }
}
