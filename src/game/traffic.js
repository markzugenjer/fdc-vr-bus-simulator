import * as THREE from 'three';
import { LANE } from './world.js';
import { TexKit, atlasMaterial } from './atlas.js';

/**
 * Oncoming traffic in the other lane: sedans, hatchbacks, angkot minivans and scooters. They stop
 * at red lights, keep their distance, and brake (and honk) if the bus drifts into their lane.
 *
 * Each vehicle type is two instanced meshes (its paint, tinted per vehicle, and its fixed parts:
 * glass, lights, tyres, the rider), so all the traffic costs 8 draw calls.
 */
const PAINT = {
  sedan: ['#e8545c', '#f4f4f4', '#5c6670', '#9aa3a8', '#4a9be8', '#b3202c', '#f7c95e'],
  hatch: ['#f7c95e', '#ffffff', '#3cc44c', '#ff9f43', '#b38cf0', '#c6ccd0'],
  angkot: ['#1f9ad6', '#2fb36a', '#e84b4b', '#ffcc33'],
  scooter: ['#e8545c', '#1d2a33', '#ffffff', '#4a9be8', '#ec6db0'],
};
const MIX = ['sedan', 'scooter', 'angkot', 'hatch', 'sedan', 'scooter', 'angkot', 'sedan', 'hatch', 'scooter', 'sedan', 'angkot'];
const SIZE = { sedan: [0.9, 2.2], hatch: [0.86, 1.95], angkot: [0.85, 2.05], scooter: [0.4, 0.95] };

export class Traffic {
  constructor(route, world, { count = 12, rand = Math.random } = {}) {
    this.route = route;
    this.world = world;
    this.group = new THREE.Group();
    this.cars = [];
    const L = route.length;
    const counter = {};
    for (let i = 0; i < count; i++) {
      const type = MIX[i % MIX.length];
      const k = (counter[type] = (counter[type] ?? -1) + 1);
      this.cars.push({
        type, idx: k, s: (i / count) * L + rand() * 20, v: 8,
        vmax: type === 'scooter' ? 8 + rand() * 3 : 7.5 + rand() * 2.5,
        lat: type === 'scooter' ? -(LANE + 0.8) : -LANE,
        color: PAINT[type][Math.floor(rand() * PAINT[type].length)], x: 0, z: 0, yaw: 0, honk: 0, roll: 0,
      });
    }
    // one pair of instanced meshes per type
    this.meshes = {};
    const mat = atlasMaterial({ roughness: 0.4, metalness: 0.15, glow: 0.05 });
    const col = new THREE.Color();
    for (const type of Object.keys(PAINT)) {
      const n = this.cars.filter((c) => c.type === type).length;
      if (!n) continue;
      const { paint, fixed } = buildVehicle(type);
      const a = new THREE.InstancedMesh(paint, mat, n);
      const b = new THREE.InstancedMesh(fixed, mat, n);
      this.cars.filter((c) => c.type === type).forEach((c) => a.setColorAt(c.idx, col.set(c.color)));
      a.instanceColor.needsUpdate = true;
      for (const m of [a, b]) { m.frustumCulled = false; this.group.add(m); }
      this.meshes[type] = [a, b];
    }
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
    const lights = this.world.lights;
    const sorted = [...this.cars].sort((a, b) => a.s - b.s);
    for (const c of this.cars) {
      let want = c.vmax;
      // the vehicle ahead in this lane (they drive towards lower s); scooters squeeze closer
      let gap = Infinity;
      for (const o of sorted) {
        if (o === c) continue;
        const d = this.route.wrap(c.s - o.s);
        if (d > 0 && d < gap) gap = d;
      }
      const keep = c.type === 'scooter' ? 5 : 9;
      if (gap < 30) want = Math.min(want, Math.max(0, (gap - keep) * 0.6));
      // red lights for the other direction: stop line just past the junction
      for (const l of lights) {
        const stop = l.s + 16.5;
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
      c.roll = c.type === 'scooter' ? Math.sin(c.s * 0.13) * 0.04 : 0;
    }
    this.place(dt);
  }

  place() {
    const { m, q, p } = this;
    const e = new THREE.Euler();
    for (const c of this.cars) {
      this.route.at(c.s, c.lat, p);
      c.x = p.x;
      c.z = p.z;
      c.yaw = p.yaw + Math.PI; // driving the other way
      q.setFromEuler(e.set(0, c.yaw, c.roll, 'YXZ'));
      m.compose(new THREE.Vector3(p.x, 0.02, p.z), q, new THREE.Vector3(1, 1, 1));
      for (const mesh of this.meshes[c.type]) mesh.setMatrixAt(c.idx, m);
    }
    for (const [a, b] of Object.values(this.meshes)) { a.instanceMatrix.needsUpdate = true; b.instanceMatrix.needsUpdate = true; }
  }

  /** Does any vehicle overlap the bus (an 8.9 × 2.4 m box)? Returns it. */
  hit(bx, bz, byaw) {
    if (!this.enabled) return null;
    for (const c of this.cars) {
      const dx = c.x - bx;
      const dz = c.z - bz;
      const lx = Math.cos(byaw) * dx - Math.sin(byaw) * dz;
      const lz = Math.sin(byaw) * dx + Math.cos(byaw) * dz;
      const [hw, hl] = SIZE[c.type];
      if (Math.abs(lx) < 1.2 + hw && Math.abs(lz) < 4.45 + hl) return c;
    }
    return null;
  }
}

// ------------------------------------------------------------------ vehicle models
// Built facing -z (the front), from side profiles extruded across the width, so they read as real
// car shapes. "paint" parts are white and get each vehicle's colour; "fixed" parts keep theirs.
function profileGeo(pts, width, bevel = 0.05) {
  const sh = new THREE.Shape();
  pts.forEach(([u, y], i) => (i ? sh.lineTo(u, y) : sh.moveTo(u, y)));
  const g = new THREE.ExtrudeGeometry(sh, { depth: width - bevel * 2, bevelEnabled: true, bevelThickness: bevel, bevelSize: bevel, bevelSegments: 2, curveSegments: 4 });
  // shape x = forward (u), extrude z = width → turn so u runs along -z and the width along x
  g.rotateY(Math.PI / 2);
  g.translate(-(width - bevel * 2) / 2, 0, 0);
  return g;
}

/** A flat polygon (u, y points) on the side of the car at x. */
function sidePoly(pts, x, faceRight) {
  const sh = new THREE.Shape();
  pts.forEach(([u, y], i) => (i ? sh.lineTo(u, y) : sh.moveTo(u, y)));
  const g = new THREE.ShapeGeometry(sh);
  // UVs: span the polygon's box
  const pos = g.attributes.position;
  const bb = new THREE.Box3().setFromBufferAttribute(pos);
  const uv = g.attributes.uv;
  for (let i = 0; i < pos.count; i++) uv.setXY(i, (pos.getX(i) - bb.min.x) / (bb.max.x - bb.min.x), (pos.getY(i) - bb.min.y) / (bb.max.y - bb.min.y));
  g.rotateY(faceRight ? Math.PI / 2 : -Math.PI / 2);
  g.translate(x, 0, 0);
  return g;
}

function addWheels(k, xs, zs, r, w) {
  for (const x of xs) for (const z of zs) {
    k.add(new THREE.CylinderGeometry(r, r, w, 16, 1, true), '#1d1f22', { x, y: r, z, rz: Math.PI / 2 });
    const cap = new THREE.CircleGeometry(r, 16);
    k.add(cap, '#ffffff', { x: x + Math.sign(x) * w / 2, y: r, z, ry: Math.sign(x) * Math.PI / 2 }, 'tyre');
  }
}

function buildVehicle(type) {
  const paint = new TexKit();
  const fixed = new TexKit();
  if (type === 'sedan' || type === 'hatch') {
    const W = type === 'sedan' ? 1.76 : 1.68;
    const pts = type === 'sedan'
      ? [[-2.15, 0.3], [-2.2, 0.75], [-2.08, 0.93], [-1.3, 0.98], [-0.85, 1.42], [0.5, 1.46], [1.12, 0.99], [2.05, 0.87], [2.2, 0.62], [2.16, 0.3]]
      : [[-1.9, 0.3], [-1.95, 0.8], [-1.82, 1.42], [0.35, 1.5], [0.98, 1.0], [1.85, 0.86], [1.96, 0.6], [1.9, 0.3]];
    // body: the profile's u is "forward" and ends up pointing to -z
    const body = profileGeo(pts.map(([u, y]) => [u, y]), W);
    paint.add(body, '#ffffff');
    // glass: side windows, windscreen, rear window
    const gl = type === 'sedan'
      ? { side: [[-0.82, 1.0], [-0.66, 1.37], [0.45, 1.4], [1.0, 1.0]], ws: [[1.12, 0.99], [0.5, 1.46]], rw: [[-1.3, 0.98], [-0.85, 1.42]] }
      : { side: [[-1.75, 1.0], [-1.66, 1.38], [0.3, 1.44], [0.88, 1.0]], ws: [[0.98, 1.0], [0.35, 1.5]], rw: [[-1.95, 0.85], [-1.82, 1.42]] };
    for (const s of [-1, 1]) {
      const g = sidePoly(gl.side.map(([u, y]) => [u * s, y]), s * (W / 2 + 0.006), s > 0);
      fixed.add(g, '#ffffff', {}, 'carGlass');
      // the B pillar
      fixed.add(new THREE.BoxGeometry(0.02, 0.4, 0.09), '#1d2124', { x: s * (W / 2 + 0.01), y: 1.2, z: type === 'sedan' ? 0.15 : -0.3 });
      // door lines and handles
      fixed.add(new THREE.BoxGeometry(0.01, 0.55, 0.012), '#5c6670', { x: s * (W / 2 + 0.008), y: 0.68, z: type === 'sedan' ? 0.15 : -0.3 });
      fixed.add(new THREE.BoxGeometry(0.02, 0.04, 0.16), '#cfd6db', { x: s * (W / 2 + 0.012), y: 0.88, z: (type === 'sedan' ? 0.15 : -0.3) - 0.3 });
      // mirrors
      paint.add(new THREE.BoxGeometry(0.2, 0.12, 0.1), '#ffffff', { x: s * (W / 2 + 0.08), y: 1.02, z: -0.95 * (type === 'sedan' ? 1 : 0.85) });
    }
    const quadAlong = ([[u0, y0], [u1, y1]], w, tile, inset = 0.03) => {
      // a sloped quad across the width between two profile points (u forward → -z)
      const a = [-w / 2 + inset, y0, -u0]; const b = [w / 2 - inset, y0, -u0]; const c = [w / 2 - inset, y1, -u1]; const d = [-w / 2 + inset, y1, -u1];
      return [a, b, c, d];
    };
    const [a, b, c, d] = quadAlong(gl.ws, W - 0.1, 'carGlass');
    fixed.quad(b, a, d, c, '#ffffff', 'carGlass');
    const [e, f, g2, h] = quadAlong(gl.rw, W - 0.1, 'carGlass');
    fixed.quad(e, f, g2, h, '#ffffff', 'carGlass');
    // nose and tail panels, bumpers
    const fu = pts[pts.length - 2][0];
    const ru = pts[1][0];
    fixed.add(new THREE.PlaneGeometry(W - 0.18, 0.42), '#ffffff', { y: 0.62, z: -(fu + 0.012), ry: Math.PI }, 'carFront');
    fixed.add(new THREE.PlaneGeometry(W - 0.18, 0.42), '#ffffff', { y: 0.68, z: -(ru - 0.012) }, 'carBack');
    fixed.add(new THREE.BoxGeometry(W + 0.02, 0.16, 0.14), '#2a2f33', { y: 0.36, z: -(fu - 0.02) });
    fixed.add(new THREE.BoxGeometry(W + 0.02, 0.16, 0.14), '#2a2f33', { y: 0.36, z: -(ru + 0.02) });
    addWheels(fixed, [-(W / 2 - 0.12), W / 2 - 0.12], type === 'sedan' ? [-1.38, 1.32] : [-1.2, 1.22], 0.32, 0.22);
  } else if (type === 'angkot') {
    const W = 1.66;
    const pts = [[-2.0, 0.32], [-2.02, 1.92], [1.15, 1.95], [1.85, 1.2], [2.0, 0.95], [2.02, 0.32]];
    const body = profileGeo(pts, W, 0.06);
    paint.add(body, '#ffffff');
    for (const s of [-1, 1]) {
      // the side band: windows above, the yellow stripe and route sign below
      fixed.add(new THREE.PlaneGeometry(2.95, 1.0), '#ffffff', { x: s * (W / 2 + 0.008), y: 1.38, z: 0.4, ry: s * Math.PI / 2 }, 'angkot');
      const g = sidePoly([[1.05, 1.25], [1.1, 1.85], [1.4, 1.85], [1.75, 1.25]].map(([u, y]) => [u * s, y]), s * (W / 2 + 0.008), s > 0);
      fixed.add(g, '#ffffff', {}, 'carGlass');
      paint.add(new THREE.BoxGeometry(0.2, 0.14, 0.1), '#ffffff', { x: s * (W / 2 + 0.08), y: 1.35, z: -1.4 });
    }
    fixed.quad([W / 2 - 0.06, 1.2, -1.85], [-W / 2 + 0.06, 1.2, -1.85], [-W / 2 + 0.06, 1.9, -1.17], [W / 2 - 0.06, 1.9, -1.17], '#ffffff', 'carGlass');
    fixed.add(new THREE.PlaneGeometry(W - 0.2, 0.5), '#ffffff', { y: 0.72, z: -2.04, ry: Math.PI }, 'carFront');
    fixed.add(new THREE.PlaneGeometry(W - 0.2, 0.5), '#ffffff', { y: 0.78, z: 2.04 }, 'carBack');
    fixed.add(new THREE.PlaneGeometry(W - 0.3, 0.7), '#ffffff', { y: 1.45, z: 2.04 }, 'carGlass');
    fixed.add(new THREE.BoxGeometry(W + 0.02, 0.16, 0.14), '#2a2f33', { y: 0.38, z: -2.04 });
    fixed.add(new THREE.BoxGeometry(W + 0.02, 0.16, 0.14), '#2a2f33', { y: 0.38, z: 2.04 });
    // roof rack with a sign
    fixed.add(new THREE.BoxGeometry(0.9, 0.22, 0.12), '#ffd23b', { y: 2.08, z: -0.9 });
    addWheels(fixed, [-(W / 2 - 0.12), W / 2 - 0.12], [-1.3, 1.3], 0.32, 0.22);
  } else {
    // scooter with a rider in a helmet
    for (const z of [-0.62, 0.62]) {
      fixed.add(new THREE.CylinderGeometry(0.25, 0.25, 0.1, 14), '#1d1f22', { y: 0.25, z, rz: Math.PI / 2 });
      fixed.add(new THREE.CylinderGeometry(0.12, 0.12, 0.11, 10), '#bfc6cb', { y: 0.25, z, rz: Math.PI / 2 });
    }
    paint.add(new THREE.BoxGeometry(0.32, 0.36, 0.85), '#ffffff', { y: 0.55, z: 0.25 });
    paint.add(new THREE.BoxGeometry(0.32, 0.72, 0.13), '#ffffff', { y: 0.68, z: -0.5, rx: 0.25 });
    paint.add(new THREE.SphereGeometry(0.15, 10, 8), '#ffffff', { y: 1.72, z: 0.02 }); // helmet
    fixed.add(new THREE.BoxGeometry(0.3, 0.1, 0.6), '#2b2b30', { y: 0.78, z: 0.25 });
    fixed.add(new THREE.BoxGeometry(0.34, 0.12, 0.5), '#3a3f44', { y: 0.33, z: -0.15 });
    fixed.add(new THREE.CylinderGeometry(0.025, 0.025, 0.62, 6), '#2b2b30', { y: 1.05, z: -0.62, rz: Math.PI / 2 });
    fixed.add(new THREE.BoxGeometry(0.14, 0.08, 0.05), '#fff6d0', { y: 0.95, z: -0.66 });
    fixed.add(new THREE.BoxGeometry(0.12, 0.05, 0.04), '#d61f2c', { y: 0.64, z: 0.69 });
    // the rider: jacket, jeans, arms to the handlebar, visor
    fixed.add(new THREE.CapsuleGeometry(0.17, 0.28, 2, 8), '#3b4a6b', { y: 1.25, z: 0.12, rx: -0.25 });
    for (const s of [-1, 1]) {
      fixed.add(new THREE.CapsuleGeometry(0.07, 0.36, 2, 6), '#2d3a55', { x: s * 0.12, y: 0.86, z: -0.05, rx: Math.PI / 2 - 0.2 });
      fixed.add(new THREE.CapsuleGeometry(0.06, 0.3, 2, 6), '#2d3a55', { x: s * 0.13, y: 0.55, z: -0.25, rx: 0.1 });
      fixed.add(new THREE.CapsuleGeometry(0.05, 0.42, 2, 6), '#3b4a6b', { x: s * 0.2, y: 1.2, z: -0.25, rx: 1.0 });
    }
    fixed.add(new THREE.SphereGeometry(0.12, 10, 8), '#e0ad84', { y: 1.66, z: 0.02 });
    fixed.add(new THREE.BoxGeometry(0.22, 0.09, 0.05), '#1d2a33', { y: 1.72, z: -0.13 });
  }
  return { paint: paint.geometry(), fixed: fixed.geometry() };
}
