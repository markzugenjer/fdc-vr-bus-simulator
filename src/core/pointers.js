import * as THREE from 'three';

const _rot = new THREE.Matrix4();

/**
 * One pointer system for both worlds:
 * - in VR: a laser from each Quest controller, trigger = select
 * - on desktop: the mouse; press on a target = select/hold, drag on empty space = look around
 */
export class Pointers {
  constructor(app) {
    this.app = app;
    this.hovered = new Set();
    this.mouse = this.makePointer('mouse');
    this.mouse.ndc = new THREE.Vector2();
    this.mouse.inside = false;

    this.controllers = [];
    for (let i = 0; i < 2; i++) {
      const ctrl = app.renderer.xr.getController(i);
      app.rig.add(ctrl);
      const p = this.makePointer('controller' + i);
      p.object = ctrl;
      p.gamepad = null;
      p.handedness = '';

      const geo = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, 0, -1)]);
      p.line = new THREE.Line(geo, new THREE.LineBasicMaterial({ color: 0xb9d77a, transparent: true, opacity: 0.85 }));
      p.line.scale.z = 4;
      p.line.visible = false;
      ctrl.add(p.line);

      p.dot = new THREE.Mesh(new THREE.SphereGeometry(0.012, 12, 8), new THREE.MeshBasicMaterial({ color: 0xffffff, fog: false }));
      p.dot.visible = false;
      app.scene.add(p.dot);

      ctrl.addEventListener('connected', (e) => {
        p.connected = true;
        p.gamepad = e.data.gamepad || null;
        p.handedness = e.data.handedness || '';
      });
      ctrl.addEventListener('disconnected', () => {
        p.connected = false;
        p.gamepad = null;
        p.pressed = false;
      });
      ctrl.addEventListener('selectstart', () => {
        p.pressed = true;
        p.justPressed = true;
        app.sfx.unlock();
      });
      ctrl.addEventListener('selectend', () => { p.pressed = false; });
      this.controllers.push(p);
    }

    this.bindMouse(app.renderer.domElement);
  }

  makePointer(id) {
    return { id, raycaster: new THREE.Raycaster(), pressed: false, justPressed: false, hit: null, connected: false };
  }

  bindMouse(el) {
    const m = this.mouse;
    let drag = null;
    const setNdc = (e) => {
      const rc = el.getBoundingClientRect();
      m.ndc.set(((e.clientX - rc.left) / rc.width) * 2 - 1, -((e.clientY - rc.top) / rc.height) * 2 + 1);
      m.inside = true;
    };
    el.addEventListener('pointermove', (e) => {
      setNdc(e);
      if (drag) {
        this.app.loco.look(e.clientX - drag.x, e.clientY - drag.y);
        drag.x = e.clientX;
        drag.y = e.clientY;
      }
    });
    el.addEventListener('pointerdown', (e) => {
      this.app.sfx.unlock();
      setNdc(e);
      el.setPointerCapture?.(e.pointerId);
      if (e.button === 0 && this.cast(m)) {
        m.pressed = true;
        m.justPressed = true;
      } else {
        drag = { x: e.clientX, y: e.clientY };
      }
    });
    const up = () => { m.pressed = false; drag = null; };
    el.addEventListener('pointerup', up);
    el.addEventListener('pointercancel', up);
    el.addEventListener('pointerleave', () => { if (!m.pressed) m.inside = false; });
    el.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  cast(p) {
    if (p === this.mouse) {
      p.raycaster.setFromCamera(p.ndc, this.app.camera);
    } else {
      _rot.identity().extractRotation(p.object.matrixWorld);
      p.raycaster.ray.origin.setFromMatrixPosition(p.object.matrixWorld);
      p.raycaster.ray.direction.set(0, 0, -1).applyMatrix4(_rot);
    }
    p.raycaster.far = 40;
    const hits = p.raycaster.intersectObjects(this.app.activeTargets(), false);
    p.hit = hits[0] || null;
    return p.hit;
  }

  update(dt) {
    const xr = this.app.renderer.xr.isPresenting;
    const active = xr ? this.controllers.filter((c) => c.connected) : (this.mouse.inside ? [this.mouse] : []);
    for (const c of this.controllers) {
      // a game can hide the lasers while you play (false), or show them only over buttons ('auto')
      c.line.visible = xr && c.connected && this.lasers !== false && this.lasers !== 'auto';
      c.dot.visible = false;
    }

    const hovered = new Set();
    for (const p of active) {
      const hit = this.cast(p);
      const obj = hit ? hit.object : null;
      if (obj) hovered.add(obj);
      if (p.justPressed && obj) obj.userData.onSelect?.(hit, p);
      if (p.pressed && obj) obj.userData.onHold?.(hit, p, dt);
      if (p.line) {
        if (this.lasers === 'auto') p.line.visible = !!hit;
        p.line.scale.z = hit ? hit.distance : 4;
        if (hit) { p.dot.position.copy(hit.point); p.dot.visible = true; }
      }
    }
    for (const p of [this.mouse, ...this.controllers]) p.justPressed = false;

    for (const o of this.hovered) if (!hovered.has(o)) o.userData.onHover?.(false);
    for (const o of hovered) if (!this.hovered.has(o)) o.userData.onHover?.(true);
    this.hovered = hovered;

    if (!xr) this.app.renderer.domElement.style.cursor = hovered.size ? 'pointer' : 'grab';
  }

  /** Where a laser effect should start for this pointer (controller tip, or just below the eye on desktop). */
  originOf(p, target = new THREE.Vector3()) {
    if (p.object) return target.setFromMatrixPosition(p.object.matrixWorld);
    return this.app.camera.localToWorld(target.set(0.12, -0.14, -0.25));
  }
}
