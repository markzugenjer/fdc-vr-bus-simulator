import * as THREE from 'three';
import { LANE } from './world.js';

/**
 * Oncoming cars in the other lane. They stop at red lights, keep their distance, and brake
 * (and honk) if the bus drifts into their lane. Instanced: 3 draw calls for all of them.
 */
const COLORS = ['#e8545c', '#4a9be8', '#ffffff', '#f7c95e', '#3cc44c', '#b38cf0', '#ff9f43', '#5c6670'];

export class Traffic {
  constructor(route, world, { count = 9, rand = Math.random } = {}) {
    this.route = route;
    this.world = world;
    this.group = new THREE.Group();
    this.cars = [];
    const L = route.length;
    for (let i = 0; i < count; i++) {
      this.cars.push({ s: (i / count) * L + rand() * 20, v: 8, vmax: 7.5 + rand() * 2.5, color: COLORS[i % COLORS.length], x: 0, z: 0, yaw: 0, honk: 0 });
    }
    this.body = new THREE.InstancedMesh(new THREE.BoxGeometry(1.8, 0.62, 4.2).translate(0, 0.62, 0), new THREE.MeshStandardMaterial({ roughness: 0.35, metalness: 0.2 }), count);
    this.cabin = new THREE.InstancedMesh(new THREE.BoxGeometry(1.6, 0.6, 2.2).translate(0, 1.22, 0.25), new THREE.MeshStandardMaterial({ color: '#1c2630', roughness: 0.15, metalness: 0.4 }), count);
    const wheelGeo = new THREE.CylinderGeometry(0.32, 0.32, 0.22, 12).rotateZ(Math.PI / 2);
    this.wheels = new THREE.InstancedMesh(wheelGeo, new THREE.MeshStandardMaterial({ color: '#1d1f22', roughness: 0.9 }), count * 4);
    const col = new THREE.Color();
    this.cars.forEach((c, i) => this.body.setColorAt(i, col.set(c.color)));
    this.body.instanceColor.needsUpdate = true;
    for (const m of [this.body, this.cabin, this.wheels]) { m.frustumCulled = false; this.group.add(m); }
    this.m = new THREE.Matrix4();
    this.q = new THREE.Quaternion();
    this.p = {};
    this.enabled = true;
    this.place(0);
  }

  setEnabled(on) {
    this.enabled = on;
    this.group.visible = on;
  }

  /** bus: { x, z, yaw } */
  update(dt, bus) {
    if (!this.enabled) return;
    const L = this.route.length;
    const lights = this.world.lights;
    const sorted = [...this.cars].sort((a, b) => a.s - b.s);
    for (const c of this.cars) {
      let want = c.vmax;
      // the car ahead in this lane (they drive towards lower s)
      let gap = Infinity;
      for (const o of sorted) {
        if (o === c) continue;
        const d = this.route.wrap(c.s - o.s);
        if (d > 0 && d < gap) gap = d;
      }
      if (gap < 30) want = Math.min(want, Math.max(0, (gap - 9) * 0.6));
      // red lights for the other direction: stop line just past the junction
      for (const l of lights) {
        const stop = l.s + 14;
        const d = this.route.wrap(c.s - stop);
        if (d > 0 && d < 35 && l.state !== 'green') want = Math.min(want, Math.max(0, (d - 1) * 0.45));
      }
      // the bus in our lane ahead: slow down, stop, honk
      const dx = bus.x - c.x;
      const dz = bus.z - c.z;
      const fwd = -Math.sin(c.yaw) * dx + -Math.cos(c.yaw) * dz; // distance ahead
      const side = Math.cos(c.yaw) * dx - Math.sin(c.yaw) * dz;
      if (fwd > 0 && fwd < 22 && Math.abs(side) < 2.6) {
        want = Math.min(want, Math.max(0, (fwd - 7) * 0.5));
        if (fwd < 14 && c.honk <= 0) { c.honk = 3; this.onHonk?.(c); }
      }
      c.honk = Math.max(0, c.honk - dt);
      const acc = want > c.v ? 1.8 : -5;
      c.v += THREE.MathUtils.clamp(want - c.v, -Math.abs(acc) * dt, Math.abs(acc) * dt);
      c.s = this.route.wrap(c.s - c.v * dt);
    }
    this.place(dt);
    void L;
  }

  place() {
    const { m, q, p } = this;
    this.cars.forEach((c, i) => {
      this.route.at(c.s, -LANE, p);
      c.x = p.x;
      c.z = p.z;
      c.yaw = p.yaw + Math.PI; // driving the other way
      q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), c.yaw);
      m.compose(new THREE.Vector3(p.x, 0.02, p.z), q, new THREE.Vector3(1, 1, 1));
      this.body.setMatrixAt(i, m);
      this.cabin.setMatrixAt(i, m);
      let k = 0;
      for (const wx of [-0.85, 0.85]) for (const wz of [-1.35, 1.35]) {
        const w = new THREE.Matrix4().makeTranslation(wx, 0.32, wz);
        this.wheels.setMatrixAt(i * 4 + k++, m.clone().multiply(w));
      }
    });
    this.body.instanceMatrix.needsUpdate = true;
    this.cabin.instanceMatrix.needsUpdate = true;
    this.wheels.instanceMatrix.needsUpdate = true;
  }

  /** Does any car overlap the bus (an 8.9 × 2.4 m box)? Returns that car. */
  hit(bx, bz, byaw) {
    if (!this.enabled) return null;
    for (const c of this.cars) {
      const dx = c.x - bx;
      const dz = c.z - bz;
      const lx = Math.cos(byaw) * dx - Math.sin(byaw) * dz;
      const lz = Math.sin(byaw) * dx + Math.cos(byaw) * dz;
      if (Math.abs(lx) < 1.2 + 0.95 && Math.abs(lz) < 4.45 + 1.6) return c;
    }
    return null;
  }
}
