import * as THREE from 'three';
import { Pointers } from './pointers.js';
import { Locomotion } from './locomotion.js';
import { Sfx } from '../game/sfx.js';
import { disposeTree } from './util.js';

/**
 * The app owns the renderer, the player rig and the scene switcher.
 *
 * A "scene" is a function `(app) => ({ group, update?, dispose?, spawn?, bounds?, fog? })`.
 * - group:   THREE.Group with everything the scene shows (lights included)
 * - update:  called every frame with (dt, time)
 * - dispose: called when leaving the scene (remove anything added outside `group`)
 * - spawn:   { x, z, yaw } where the player starts
 * - bounds:  how far (in metres) the player may walk from the centre
 */
export class App {
  constructor(container, scenes) {
    this.scenes = scenes;

    const r = (this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' }));
    r.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    r.setSize(window.innerWidth, window.innerHeight);
    r.outputColorSpace = THREE.SRGBColorSpace;
    r.toneMapping = THREE.ACESFilmicToneMapping;
    r.xr.enabled = true;
    r.xr.setReferenceSpaceType('local-floor');
    r.xr.setFoveation(1); // fixed foveated rendering: big performance win on Quest
    container.appendChild(r.domElement);

    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(70, window.innerWidth / window.innerHeight, 0.05, 400);
    this.camera.rotation.order = 'YXZ';
    this.camera.position.set(0, 1.6, 0); // desktop eye height; the headset overrides this in VR

    // The rig is the player's "body": moving or turning it moves the camera and controllers.
    this.rig = new THREE.Group();
    this.rig.add(this.camera);
    this.scene.add(this.rig);

    this.targets = new Set();
    this.listeners = [];
    this.sfx = new Sfx();
    this.loco = new Locomotion(this);
    this.pointers = new Pointers(this);

    // Fade-to-black sphere around the head, used between scenes.
    this.fadeMat = new THREE.MeshBasicMaterial({
      color: 0x0d120a, transparent: true, opacity: 1, side: THREE.BackSide,
      depthTest: false, depthWrite: false, fog: false,
    });
    const fadeMesh = new THREE.Mesh(new THREE.SphereGeometry(0.25, 16, 12), this.fadeMat);
    fadeMesh.renderOrder = 9999;
    this.camera.add(fadeMesh);
    this.fade = { mesh: fadeMesh, from: 1, to: 1, t: 1, dur: 0.25, resolve: null };

    this.current = null;
    this.currentName = null;
    this.busy = false;

    window.addEventListener('resize', () => {
      this.camera.aspect = window.innerWidth / window.innerHeight;
      this.camera.updateProjectionMatrix();
      r.setSize(window.innerWidth, window.innerHeight);
    });
    r.xr.addEventListener('sessionstart', () => this.emit('xr', true));
    r.xr.addEventListener('sessionend', () => {
      this.camera.position.set(0, 1.6, 0);
      this.loco.reset();
      this.emit('xr', false);
    });

    this.clock = new THREE.Clock();
    r.setAnimationLoop(() => this.tick());
  }

  on(fn) { this.listeners.push(fn); }
  emit(type, value) { for (const fn of this.listeners) fn(type, value); }

  /** Make a mesh interactive. Handlers: onSelect(hit, pointer), onHold(hit, pointer, dt), onHover(isOver). */
  addTarget(mesh, handlers = {}) {
    Object.assign(mesh.userData, handlers);
    this.targets.add(mesh);
    return mesh;
  }
  removeTarget(mesh) { this.targets.delete(mesh); }

  activeTargets() {
    const out = [];
    for (const o of this.targets) {
      if (o.userData.enabled === false) continue;
      let visible = true;
      for (let p = o; p; p = p.parent) if (!p.visible) { visible = false; break; }
      if (visible) out.push(o);
    }
    return out;
  }

  fadeTo(to, dur = 0.25) {
    return new Promise((resolve) => {
      Object.assign(this.fade, { from: this.fadeMat.opacity, to, t: 0, dur, resolve });
    });
  }

  async goTo(name) {
    if (!this.scenes[name]) return;
    if (this.busy) { this.pending = name; return; } // switch as soon as the current fade ends
    this.busy = true;
    await this.fadeTo(1);

    if (this.current) {
      this.scene.remove(this.current.group);
      this.current.dispose?.();
      disposeTree(this.current.group);
    }
    this.targets.clear();
    this.pointers.hovered = new Set();

    const s = this.scenes[name](this);
    this.current = s;
    this.currentName = name;
    this.scene.add(s.group);
    this.scene.fog = s.fog || null;

    const spawn = s.spawn || {};
    this.rig.position.set(spawn.x || 0, spawn.y || 0, spawn.z || 0);
    this.rig.rotation.set(0, spawn.yaw || 0, 0);
    this.loco.reset();
    this.emit('scene', name);

    await this.fadeTo(0, 0.35);
    this.busy = false;
    if (this.pending) {
      const next = this.pending;
      this.pending = null;
      if (next !== this.currentName) this.goTo(next);
    }
  }

  /**
   * Leave this app for another page on the same site (for example the FDC clinic simulation).
   * Fades to black first; in the Quest app the next page starts VR again by itself.
   */
  async openPage(url) {
    if (this.busy) return;
    this.busy = true;
    await this.fadeTo(1, 0.3);
    this.emit('leaving', url);
    window.location.href = url;
  }

  tick() {
    const dt = Math.min(this.clock.getDelta(), 0.05);
    const t = this.clock.elapsedTime;

    const f = this.fade;
    if (f.t < 1) {
      f.t = Math.min(1, f.t + dt / f.dur);
      this.fadeMat.opacity = f.from + (f.to - f.from) * f.t;
      if (f.t >= 1 && f.resolve) { const done = f.resolve; f.resolve = null; done(); }
    }
    f.mesh.visible = this.fadeMat.opacity > 0.001;

    this.loco.update(dt);
    this.current?.update?.(dt, t);
    this.pointers.update(dt);
    this.renderer.render(this.scene, this.camera);
  }
}
