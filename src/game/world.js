import * as THREE from 'three';
import { P } from './palette.js';
import { StaticKit, makeBunting, makeBalloons } from './festive.js';
import { makePerson, animatePerson } from './people.js';
import { drawLogo, roundRect } from './livery.js';
import { makePanel, text } from '../core/ui.js';

/**
 * The festive little town the Smile Bus drives through.
 *
 *   - one closed road loop (~1 km) built from a smooth spline, two lanes, driving on the LEFT
 *   - pastel houses, shophouses and warungs, palm and shade trees, street lamps
 *   - umbul-umbul (tall Indonesian festival banners), bunting across the road, balloons
 *   - 3 bus stops with people waiting, 3 traffic lights, oncoming cars
 *   - FDC Dental Clinic: where the route starts and ends
 *
 * Static scenery is merged into a few meshes and everything repeated is instanced, so the whole
 * town is only a few dozen draw calls.
 */
export const ROAD_HALF = 3.8; // asphalt half width
export const WALK = 6.4; // outer edge of the sidewalk
export const LANE = 1.85; // centre of a lane from the middle line (+ = left)

const CONTROL = [
  [0, 40], [0, -60], [15, -130], [70, -175], [150, -185], [215, -150], [240, -80], [225, 0],
  [250, 70], [240, 150], [180, 195], [100, 190], [50, 150], [20, 100],
];

/** The yaw that turns an object's front (+z) towards the road from a point on `side` (+1 left, -1 right). */
const faceRoad = (p, side = 1) => Math.atan2(-side * p.nx, -side * p.nz);

// ------------------------------------------------------------------ the route
export class Route {
  constructor() {
    const curve = new THREE.CatmullRomCurve3(CONTROL.map(([x, z]) => new THREE.Vector3(x, 0, z)), true, 'centripetal');
    const approx = curve.getLength();
    const n = Math.round(approx); // one sample per metre
    this.n = n;
    this.x = new Float32Array(n);
    this.z = new Float32Array(n);
    this.tx = new Float32Array(n);
    this.tz = new Float32Array(n);
    const pts = curve.getSpacedPoints(n);
    for (let i = 0; i < n; i++) {
      this.x[i] = pts[i].x;
      this.z[i] = pts[i].z;
    }
    for (let i = 0; i < n; i++) {
      const a = (i - 1 + n) % n;
      const b = (i + 1) % n;
      const dx = this.x[b] - this.x[a];
      const dz = this.z[b] - this.z[a];
      const l = Math.hypot(dx, dz) || 1;
      this.tx[i] = dx / l;
      this.tz[i] = dz / l;
    }
    let len = 0;
    for (let i = 0; i < n; i++) len += Math.hypot(this.x[(i + 1) % n] - this.x[i], this.z[(i + 1) % n] - this.z[i]);
    this.length = len;
    this.step = len / n;
    // a coarse grid for nearest-point lookups
    this.grid = new Map();
    for (let i = 0; i < n; i++) {
      const key = `${Math.floor(this.x[i] / 12)},${Math.floor(this.z[i] / 12)}`;
      if (!this.grid.has(key)) this.grid.set(key, []);
      this.grid.get(key).push(i);
    }
  }

  wrap(s) { return ((s % this.length) + this.length) % this.length; }

  /** Point, tangent and left normal at distance s (with lateral offset `lat`, + = left). */
  at(s, lat = 0, out = {}) {
    const f = this.wrap(s) / this.step;
    const i = Math.floor(f) % this.n;
    const j = (i + 1) % this.n;
    const k = f - Math.floor(f);
    const tx = this.tx[i] + (this.tx[j] - this.tx[i]) * k;
    const tz = this.tz[i] + (this.tz[j] - this.tz[i]) * k;
    const tl = Math.hypot(tx, tz) || 1;
    out.tx = tx / tl;
    out.tz = tz / tl;
    // left of travel direction: forward (0,-1) → left (-1,0)
    out.nx = out.tz;
    out.nz = -out.tx;
    out.x = this.x[i] + (this.x[j] - this.x[i]) * k + out.nx * lat;
    out.z = this.z[i] + (this.z[j] - this.z[i]) * k + out.nz * lat;
    out.yaw = Math.atan2(-out.tx, -out.tz); // three.js yaw that makes -z point along the road
    return out;
  }

  /** Nearest route point to (x, z): { s, lat, dist }. */
  nearest(x, z, hint = -1) {
    let best = -1;
    let bd = Infinity;
    const scan = (i) => { const d = (this.x[i] - x) ** 2 + (this.z[i] - z) ** 2; if (d < bd) { bd = d; best = i; } };
    if (hint >= 0) {
      const h = Math.floor(this.wrap(hint) / this.step);
      for (let o = -25; o <= 25; o++) scan((h + o + this.n) % this.n);
      if (bd > 30 * 30) best = -1;
    }
    if (best < 0) {
      const cx = Math.floor(x / 12);
      const cz = Math.floor(z / 12);
      for (let a = -2; a <= 2; a++) for (let b = -2; b <= 2; b++) for (const i of this.grid.get(`${cx + a},${cz + b}`) || []) scan(i);
      if (best < 0) for (let i = 0; i < this.n; i += 2) scan(i);
    }
    // refine with the segment to the neighbours
    const i = best;
    const j = (i + 1) % this.n;
    const h = (i - 1 + this.n) % this.n;
    const proj = (a, b) => {
      const ax = this.x[a]; const az = this.z[a];
      const dx = this.x[b] - ax; const dz = this.z[b] - az;
      const l2 = dx * dx + dz * dz || 1;
      const t = THREE.MathUtils.clamp(((x - ax) * dx + (z - az) * dz) / l2, 0, 1);
      const px = ax + dx * t; const pz = az + dz * t;
      return { t, d: (x - px) ** 2 + (z - pz) ** 2 };
    };
    const p1 = proj(i, j);
    const p0 = proj(h, i);
    const s = p1.d <= p0.d ? (i + p1.t) * this.step : (h + p0.t) * this.step;
    const o = this.at(s);
    const lat = (x - o.x) * o.nx + (z - o.z) * o.nz;
    return { s: this.wrap(s), lat, dist: Math.sqrt(Math.min(p1.d, p0.d)) };
  }

  /** Distance from (x, z) to the road centre line anywhere (for keeping scenery off the road). */
  clearance(x, z) {
    return this.nearest(x, z).dist;
  }
}

// ------------------------------------------------------------------ the world
export function buildWorld({ rand }) {
  const group = new THREE.Group();
  const route = new Route();
  const L = route.length;
  const updaters = [];
  const o = {};

  // stops, lights and the clinic along the route (distances in metres)
  const CLINIC_S = 14;
  const stops = [
    { s: L * 0.22, name: 'Halte Melati' },
    { s: L * 0.47, name: 'Halte Pasar Senyum' },
    { s: L * 0.72, name: 'Halte Taman Ceria' },
  ];
  const lights = [L * 0.34, L * 0.6, L * 0.86].map((s, i) => ({ s, phase: i * 6.5, state: 'green', t: 0 }));
  const busy = (s, r) => [...stops.map((x) => x.s), ...lights.map((x) => x.s), CLINIC_S, L + CLINIC_S].some((v) => Math.abs(route.wrap(s - v + L / 2) - L / 2) < r);

  // ------------------------------------------------ sky, light, ground
  // the sky (and its clouds) follows the camera, so it's never clipped by the far plane
  const sky = skyDome();
  group.add(sky);
  group.add(new THREE.HemisphereLight(0xdff1ff, 0x8aa86a, 1.45));
  const sun = new THREE.DirectionalLight(0xfff0d2, 2.2);
  sun.position.set(60, 100, 40);
  group.add(sun);
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(1400, 1400), new THREE.MeshStandardMaterial({ map: grassTexture(), roughness: 1 }));
  ground.material.map.repeat.set(140, 140);
  ground.rotation.x = -Math.PI / 2;
  ground.position.set(125, 0, 0);
  group.add(ground);

  // ------------------------------------------------ road + sidewalks + markings
  group.add(roadRibbon(route, -ROAD_HALF, ROAD_HALF, 0.02, new THREE.MeshStandardMaterial({ map: roadTexture(), roughness: 0.92 }), 10));
  const walkMat = new THREE.MeshStandardMaterial({ map: walkTexture(), roughness: 0.9 });
  group.add(roadRibbon(route, ROAD_HALF + 0.2, WALK, 0.16, walkMat, 4));
  group.add(roadRibbon(route, -WALK, -ROAD_HALF - 0.2, 0.16, walkMat, 4));
  const kerbMat = new THREE.MeshStandardMaterial({ color: '#e6e2da', roughness: 0.8 });
  for (const s of [-1, 1]) {
    group.add(roadRibbon(route, s > 0 ? ROAD_HALF : -ROAD_HALF - 0.2, s > 0 ? ROAD_HALF + 0.2 : -ROAD_HALF, 0.17, kerbMat, 1));
    group.add(kerbFace(route, s * ROAD_HALF, s, 0.17, kerbMat));
  }

  const kit = new StaticKit(); // all static scenery, merged at the end
  const tmp = {};

  // ------------------------------------------------ cross streets with zebra crossings at the lights
  const crossMat = new THREE.MeshStandardMaterial({ map: roadTexture(true), roughness: 0.92 });
  for (const l of lights) {
    const c = route.at(l.s + 8);
    const m = new THREE.Mesh(new THREE.PlaneGeometry(8, 64), crossMat);
    m.rotation.x = -Math.PI / 2;
    const holder = new THREE.Group();
    holder.position.set(c.x, 0.012, c.z);
    holder.rotation.y = c.yaw + Math.PI / 2;
    holder.add(m);
    group.add(holder);
    // zebra stripes across the main road, before the junction
    for (let k = -3; k <= 3; k++) {
      const z = route.at(l.s + 2.2, k * 1.1, tmp);
      kit.add(new THREE.BoxGeometry(0.6, 0.02, 2.2), '#f7f7f2', { x: z.x, y: 0.035, z: z.z, ry: z.yaw + Math.PI / 2 });
    }
    // our stop line
    const sl = route.at(l.s, LANE, tmp);
    kit.add(new THREE.BoxGeometry(3.4, 0.02, 0.35), '#ffffff', { x: sl.x, y: 0.036, z: sl.z, ry: sl.yaw });
  }

  // ------------------------------------------------ traffic lights
  const lightHeads = [];
  const bulbGeo = new THREE.CircleGeometry(0.15, 18);
  for (const l of lights) {
    const base = route.at(l.s + 0.5, WALK - 0.6);
    const yaw = base.yaw; // the heads face oncoming bus traffic (back along the road)
    kit.add(new THREE.CylinderGeometry(0.1, 0.13, 5.6, 10), '#3c4248', { x: base.x, y: 2.8, z: base.z });
    const armEnd = route.at(l.s + 0.5, LANE - 0.3);
    const mx = (base.x + armEnd.x) / 2;
    const mz = (base.z + armEnd.z) / 2;
    const len = Math.hypot(armEnd.x - base.x, armEnd.z - base.z);
    kit.add(new THREE.BoxGeometry(0.12, 0.12, len), '#3c4248', { x: mx, y: 5.45, z: mz, ry: Math.atan2(armEnd.x - base.x, armEnd.z - base.z) });
    const heads = [];
    for (const [hx, hz, hy] of [[armEnd.x, armEnd.z, 5.0], [base.x, base.z, 3.0]]) {
      const head = new THREE.Group();
      head.position.set(hx, hy, hz);
      head.rotation.y = yaw + Math.PI; // the lamps face back towards the approaching bus
      const box = new THREE.Mesh(new THREE.BoxGeometry(0.46, 1.25, 0.3), new THREE.MeshStandardMaterial({ color: '#23282c', roughness: 0.6 }));
      head.add(box);
      const lamps = {};
      ['red', 'yellow', 'green'].forEach((c, i) => {
        const lamp = new THREE.Mesh(bulbGeo, new THREE.MeshBasicMaterial({ color: '#333', toneMapped: false }));
        lamp.position.set(0, 0.38 - i * 0.38, 0.16);
        head.add(lamp);
        lamps[c] = lamp;
      });
      group.add(head);
      heads.push(lamps);
    }
    lightHeads.push(heads);
  }
  const LIGHT_COL = { red: '#ff3b3b', yellow: '#ffc93b', green: '#3bff7a' };
  const CYCLE = { green: 11, yellow: 2.6, red: 8 };
  for (const l of lights) { l.t = l.phase % (CYCLE.green + CYCLE.yellow + CYCLE.red); }
  const lightState = (t) => {
    const T = CYCLE.green + CYCLE.yellow + CYCLE.red;
    const k = ((t % T) + T) % T;
    return k < CYCLE.green ? 'green' : k < CYCLE.green + CYCLE.yellow ? 'yellow' : 'red';
  };
  updaters.push((dt) => {
    lights.forEach((l, i) => {
      l.t += dt;
      const st = lightState(l.t);
      if (st !== l.state || !l.drawn) {
        l.state = st;
        l.drawn = true;
        for (const lamps of lightHeads[i]) for (const c of Object.keys(lamps)) lamps[c].material.color.set(c === st ? LIGHT_COL[c] : '#2b2f33');
      }
    });
  });

  // ------------------------------------------------ bus stops
  const stopMat = new THREE.MeshBasicMaterial({ map: stopZoneTexture(), transparent: true, depthWrite: false });
  for (const st of stops) {
    // painted zone on the left lane
    const zone = roadRibbon(route, LANE - 1.6, LANE + 1.6, 0.03, stopMat, 14, st.s - 7, st.s + 7);
    group.add(zone);
    st.zone = zone;
    // the shelter on the left sidewalk
    const c = route.at(st.s + 1, WALK + 1.6);
    const M = new THREE.Matrix4().compose(new THREE.Vector3(c.x, 0.16, c.z), new THREE.Quaternion().setFromEuler(new THREE.Euler(0, faceRoad(c), 0)), new THREE.Vector3(1, 1, 1));
    addShelter(kit, M);
    const sign = makePanel(1.9, 0.42, (cx, W, H) => {
      roundRect(cx, 4, 4, W - 8, H - 8, H * 0.25);
      cx.fillStyle = P.busGreen; cx.fill();
      text(cx, 'HALTE', W * 0.06, H * 0.42, { size: H * 0.24, weight: 900, color: '#ffffff' });
      text(cx, st.name.replace('Halte ', ''), W * 0.06, H * 0.8, { size: H * 0.3, weight: 800, color: '#ffffff', maxWidth: W * 0.88 });
    }, { ppm: 300 });
    const sp = new THREE.Vector3(0, 2.85, 0.45).applyMatrix4(M);
    sign.mesh.position.copy(sp);
    sign.mesh.rotation.y = faceRoad(c);
    group.add(sign.mesh);
    // people waiting
    st.waiting = [];
    const n = 3 + Math.floor(rand() * 2);
    for (let k = 0; k < n; k++) {
      const p = makePerson(rand, { wave: k === 0 });
      const at = route.at(st.s - 2 + k * 1.1, WALK - 0.9 + (k % 2) * 0.4);
      p.position.set(at.x, 0.16, at.z);
      p.userData.baseY = 0.16;
      p.rotation.y = faceRoad(at); // face the road
      p.userData.phase = rand() * 6;
      group.add(p);
      st.waiting.push(p);
    }
    st.balloons = route.at(st.s + 3.2, WALK + 0.6);
  }

  // ------------------------------------------------ the FDC clinic (start and finish)
  buildClinic(group, kit, route, CLINIC_S, rand, updaters);
  const clinicZone = roadRibbon(route, LANE - 1.6, LANE + 1.6, 0.03, stopMat, 14, CLINIC_S - 7, CLINIC_S + 7);
  group.add(clinicZone);

  // ------------------------------------------------ houses, shophouses, warungs
  const palette = ['#ffd9e6', '#d8f3dc', '#fff1c1', '#d6ecff', '#fde2cf', '#e9dcff', '#ffffff', '#c9f0e4', '#ffe7a8'];
  const roofs = ['#d9634a', '#c4553f', '#e98aa4', '#3cb371', '#6d8bd6', '#b5523b'];
  for (const side of [1, -1]) {
    let s = rand() * 8;
    while (s < L) {
      if (busy(s, side > 0 ? 13 : 9)) { s += 10; continue; }
      const kind = rand();
      const w = kind < 0.35 ? 9 + rand() * 4 : 6 + rand() * 3;
      const d = 6 + rand() * 3;
      const lat = side * (WALK + 2.5 + d / 2 + rand() * 2);
      const c = route.at(s + w / 2, lat);
      if (route.clearance(c.x, c.z) < WALK + 1.5 + Math.max(w, d) / 2) { s += 6; continue; }
      const facing = faceRoad(c, side); // front (+z) towards the road
      const M = new THREE.Matrix4().compose(new THREE.Vector3(c.x, 0, c.z), new THREE.Quaternion().setFromEuler(new THREE.Euler(0, facing, 0)), new THREE.Vector3(1, 1, 1));
      const col = palette[Math.floor(rand() * palette.length)];
      const roof = roofs[Math.floor(rand() * roofs.length)];
      if (kind < 0.35) addShophouse(kit, M, w, d, rand);
      else if (kind < 0.5) addWarung(kit, M, rand);
      else addHouse(kit, M, w, d, col, roof, rand);
      s += w + 2 + rand() * 5;
    }
  }

  // ------------------------------------------------ trees: shade trees and coconut palms
  const treeSpots = [];
  const palmSpots = [];
  for (let k = 0; k < 900; k++) {
    const s = rand() * L;
    const side = rand() < 0.5 ? 1 : -1;
    const lat = side * (WALK + 4 + rand() * 45);
    const c = route.at(s, lat);
    if (route.clearance(c.x, c.z) < WALK + 2.5) continue;
    if (Math.abs(lat) < 20 && rand() < 0.75) continue; // keep house rows mostly clear
    (rand() < 0.14 ? palmSpots : treeSpots).push([c.x, c.z, 0.8 + rand() * 0.7]);
  }
  // a row of palms on the sidewalks
  for (let s = 5; s < L; s += 23) {
    if (busy(s, 10)) continue;
    const c = route.at(s, -(WALK - 0.7));
    palmSpots.push([c.x, c.z, 0.8 + rand() * 0.25]);
  }
  group.add(...shadeTrees(treeSpots, rand));
  group.add(...palms(palmSpots, rand));

  // ------------------------------------------------ street lamps (left sidewalk)
  const lampSpots = [];
  for (let s = 10; s < L; s += 34) {
    if (busy(s, 6)) continue;
    lampSpots.push(route.at(s, WALK - 0.45, {}));
  }
  group.add(...streetLamps(lampSpots));

  // ------------------------------------------------ umbul-umbul (festival banners)
  const umbul = [];
  for (let s = 3; s < L; s += 17) {
    if (busy(s, 7)) continue;
    for (const side of [1, -1]) umbul.push({ ...route.at(s + (side > 0 ? 0 : 8), side * (WALK - 0.25), {}), side });
  }
  const ub = umbulUmbul(umbul, rand);
  group.add(ub.group);
  updaters.push(ub.update);

  // ------------------------------------------------ bunting and fairy lights across the road
  const strands = [];
  for (let s = 30; s < L; s += 55) {
    if (busy(s, 10)) continue;
    const a = route.at(s, WALK - 0.3, {});
    const b = route.at(s, -(WALK - 0.3), {});
    strands.push({ a: new THREE.Vector3(a.x, 6.0, a.z), b: new THREE.Vector3(b.x, 6.0, b.z), sag: 0.9 });
    // the poles holding them
    kit.add(new THREE.CylinderGeometry(0.06, 0.06, 6.1, 6), '#6b4f3a', { x: a.x, y: 3.05, z: a.z });
    kit.add(new THREE.CylinderGeometry(0.06, 0.06, 6.1, 6), '#6b4f3a', { x: b.x, y: 3.05, z: b.z });
  }
  const bunting = makeBunting(strands, { colors: [P.busPink, P.busGreen, '#ffffff', P.gold, '#4a9be8', '#ff7a6b'], flagW: 0.4, flagH: 0.5, gap: 0.6, bulbGap: 0.9 });
  group.add(bunting.group);
  updaters.push(bunting.update);

  // ------------------------------------------------ balloons at the stops and the clinic
  const anchors = [];
  for (const st of stops) anchors.push({ x: st.balloons.x, y: 1.4, z: st.balloons.z, n: 6, len: 0.9, size: 0.22 });
  const cl = route.at(CLINIC_S, WALK + 1.2);
  const cl2 = route.at(CLINIC_S + 9, WALK + 1.2);
  anchors.push({ x: cl.x, y: 2.2, z: cl.z, n: 8, len: 0.6, size: 0.26 }, { x: cl2.x, y: 2.2, z: cl2.z, n: 8, len: 0.6, size: 0.26 });
  const balloons = makeBalloons(anchors, { rand });
  group.add(balloons.group);
  updaters.push(balloons.update);

  // ------------------------------------------------ townsfolk waving along the way
  const folks = [];
  for (let k = 0; k < 14; k++) {
    const s = rand() * L;
    if (busy(s, 8)) continue;
    const side = rand() < 0.6 ? 1 : -1;
    const c = route.at(s, side * (WALK - 1.2 - rand() * 1.5));
    const p = makePerson(rand, { wave: rand() < 0.7 });
    p.position.set(c.x, 0.16, c.z);
    p.userData.baseY = 0.16;
    p.rotation.y = faceRoad(c, side);
    p.userData.phase = rand() * 6;
    group.add(p);
    folks.push(p);
  }
  let clock = 0;
  updaters.push((dt, t) => {
    clock = t;
    for (const p of folks) animatePerson(p, t, p.userData.hopUntil > t ? 'hop' : 'idle', p.userData.phase);
    for (const st of stops) for (const p of st.waiting) if (!p.userData.busy) animatePerson(p, t, p.userData.hopUntil > t ? 'hop' : 'idle', p.userData.phase);
  });
  /** The horn: everyone close by hops and waves for a moment. */
  const honk = (x, z) => {
    for (const p of [...folks, ...stops.flatMap((st) => st.waiting), ...(group.userData.crowd || [])]) {
      if (p.userData.busy) continue;
      if ((p.position.x - x) ** 2 + (p.position.z - z) ** 2 < 30 * 30) p.userData.hopUntil = clock + 1.6;
    }
  };

  // ------------------------------------------------ clouds
  sky.add(clouds(rand));

  group.add(kit.build({ roughness: 0.85, glow: 0.08 }));

  Object.assign(o, {
    group, route, stops, lights, CLINIC_S, lightState, honk, sky,
    get crowd() { return group.userData.crowd; },
    get clinicDoor() { return group.userData.clinicDoor; },
    update(dt, t) { for (const f of updaters) f(dt, t); },
  });
  return o;
}

// =================================================================== road geometry
/** A strip along the route between lateral offsets a..b, at height y, with UV v = s / repeat. */
function roadRibbon(route, a, b, y, material, repeat, s0 = 0, s1 = null) {
  const L = route.length;
  const end = s1 ?? L;
  const step = 2;
  const n = Math.max(2, Math.ceil((end - s0) / step) + 1);
  const pos = new Float32Array(n * 2 * 3);
  const uv = new Float32Array(n * 2 * 2);
  const idx = [];
  const p = {};
  for (let i = 0; i < n; i++) {
    const s = Math.min(end, s0 + i * step);
    route.at(s, a, p);
    pos.set([p.x, y, p.z], i * 6);
    route.at(s, b, p);
    pos.set([p.x, y, p.z], i * 6 + 3);
    const v = s1 == null ? s / repeat : (s - s0) / (end - s0);
    uv.set([0, v, 1, v], i * 4);
    if (i < n - 1) { const k = i * 2; idx.push(k, k + 2, k + 1, k + 1, k + 2, k + 3); }
  }
  // close the loop
  if (s1 == null) { pos.set(pos.slice(0, 6), (n - 1) * 6); }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  // make sure the strip faces up
  if (g.attributes.normal.getY(0) < 0) {
    const ix = g.index.array;
    for (let i = 0; i < ix.length; i += 3) { const t = ix[i + 1]; ix[i + 1] = ix[i + 2]; ix[i + 2] = t; }
    g.computeVertexNormals();
  }
  const m = new THREE.Mesh(g, material);
  m.matrixAutoUpdate = false;
  return m;
}

function kerbFace(route, lat, side, h, material) {
  const n = Math.ceil(route.length / 2) + 1;
  const pos = new Float32Array(n * 2 * 3);
  const idx = [];
  const p = {};
  for (let i = 0; i < n; i++) {
    route.at(Math.min(route.length, i * 2), lat, p);
    pos.set([p.x, 0.0, p.z, p.x, h, p.z], i * 6);
    if (i < n - 1) { const k = i * 2; if (side > 0) idx.push(k, k + 1, k + 2, k + 1, k + 3, k + 2); else idx.push(k, k + 2, k + 1, k + 1, k + 2, k + 3); }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  const m = new THREE.Mesh(g, new THREE.MeshStandardMaterial({ color: '#cfc9bd', roughness: 0.85, side: THREE.DoubleSide }));
  void material;
  return m;
}

// =================================================================== buildings
function addHouse(kit, M, w, d, wall, roof, rand) {
  const h = 3.2 + rand() * 0.8;
  kit.add(new THREE.BoxGeometry(w, h, d), wall, { y: h / 2, parent: M });
  // gable roof: a stretched triangular prism
  const prism = new THREE.CylinderGeometry(1, 1, 1, 3, 1);
  kit.add(prism, roof, { y: h + 0.75, rz: Math.PI / 2, ry: Math.PI / 2, sx: 1.6, sy: w + 0.6, sz: d * 0.62, parent: M });
  kit.add(new THREE.BoxGeometry(w + 0.5, 0.15, d + 0.5), roof, { y: h, parent: M });
  // door, windows, porch
  kit.add(new THREE.BoxGeometry(1.0, 2.1, 0.08), '#8a5a3c', { x: -w * 0.18, y: 1.05, z: d / 2 + 0.03, parent: M });
  for (const x of [w * 0.2, w * 0.38]) {
    if (x + 0.6 > w / 2) continue;
    kit.add(new THREE.BoxGeometry(0.95, 1.0, 0.08), '#ffffff', { x, y: 1.75, z: d / 2 + 0.02, parent: M });
    kit.add(new THREE.BoxGeometry(0.8, 0.85, 0.1), '#8fc5e8', { x, y: 1.75, z: d / 2 + 0.03, parent: M });
  }
  kit.add(new THREE.BoxGeometry(w * 0.6, 0.12, 1.6), '#d9d2c4', { x: -w * 0.05, y: 0.06, z: d / 2 + 0.8, parent: M });
  // a low front fence with a gate gap
  for (const x of [-w / 2 + 0.8, w / 2 - 0.8]) kit.add(new THREE.BoxGeometry(w * 0.35, 0.7, 0.08), '#ffffff', { x: x * 0.75, y: 0.35, z: d / 2 + 2.0, parent: M });
  // potted plants
  for (const x of [-w * 0.42, w * 0.42]) {
    kit.add(new THREE.CylinderGeometry(0.22, 0.18, 0.4, 8), '#c4704d', { x, y: 0.2, z: d / 2 + 0.6, parent: M });
    kit.add(new THREE.IcosahedronGeometry(0.35, 0), ['#5fa84c', '#ec6db0', '#ffb13b'][Math.floor(rand() * 3)], { x, y: 0.62, z: d / 2 + 0.6, parent: M });
  }
}

function addShophouse(kit, M, w, d, rand) {
  // ruko: a row of 2-storey shop units with shutters and striped awnings
  const units = Math.max(2, Math.round(w / 3.6));
  const uw = w / units;
  const h = 6.4;
  const cols = ['#fff1c1', '#d6ecff', '#ffd9e6', '#d8f3dc', '#ffffff', '#fde2cf'];
  const aw = [[P.busPink, '#ffffff'], [P.busGreen, '#ffffff'], ['#ffb13b', '#ffffff'], ['#4a9be8', '#ffffff']];
  for (let i = 0; i < units; i++) {
    const x = -w / 2 + uw * (i + 0.5);
    kit.add(new THREE.BoxGeometry(uw - 0.05, h, d), cols[Math.floor(rand() * cols.length)], { x, y: h / 2, parent: M });
    kit.add(new THREE.BoxGeometry(uw - 0.6, 2.3, 0.08), '#b8bfc4', { x, y: 1.15, z: d / 2 + 0.03, parent: M }); // shutter
    kit.add(new THREE.BoxGeometry(uw - 1.2, 1.1, 0.08), '#8fc5e8', { x, y: 4.4, z: d / 2 + 0.03, parent: M }); // upstairs window
    kit.add(new THREE.BoxGeometry(uw - 0.4, 0.55, 0.1), ['#ffffff', P.busGreen, P.busPink, '#ffb13b'][Math.floor(rand() * 4)], { x, y: 3.2, z: d / 2 + 0.06, parent: M }); // sign board
    const [a, b] = aw[Math.floor(rand() * aw.length)];
    const stripes = 6;
    for (let k = 0; k < stripes; k++) kit.add(new THREE.BoxGeometry((uw - 0.3) / stripes, 0.05, 1.3), k % 2 ? b : a, { x: x - (uw - 0.3) / 2 + ((uw - 0.3) / stripes) * (k + 0.5), y: 2.65, z: d / 2 + 0.6, rx: 0.3, parent: M });
  }
  kit.add(new THREE.BoxGeometry(w + 0.2, 0.3, d + 0.2), '#e7e1d6', { y: h + 0.15, parent: M });
}

function addWarung(kit, M, rand) {
  // a small food stall with a colourful tarp and a bench
  const col = [P.busPink, P.busGreen, '#ffb13b', '#4a9be8'][Math.floor(rand() * 4)];
  kit.add(new THREE.BoxGeometry(3.4, 1.0, 1.2), '#c99a6b', { y: 0.5, z: 0.6, parent: M });
  kit.add(new THREE.BoxGeometry(3.6, 2.6, 2.6), '#f3e6d0', { y: 1.3, z: -1.4, parent: M });
  for (const x of [-1.7, 1.7]) kit.add(new THREE.CylinderGeometry(0.05, 0.05, 2.6, 6), '#7a5a3a', { x, y: 1.3, z: 1.3, parent: M });
  kit.add(new THREE.BoxGeometry(4.0, 0.06, 2.6), col, { y: 2.65, z: 0.3, rx: -0.12, parent: M });
  kit.add(new THREE.BoxGeometry(3.0, 0.08, 0.35), '#8a6a4a', { y: 0.45, z: 2.0, parent: M });
  for (let k = 0; k < 5; k++) kit.add(new THREE.BoxGeometry(0.25, 0.3, 0.25), ['#ffb13b', '#ff7a6b', '#fff1c1', '#9be07a'][k % 4], { x: -1.2 + k * 0.6, y: 1.15, z: 0.6, parent: M });
}

function addShelter(kit, M) {
  kit.add(new THREE.BoxGeometry(4.6, 0.12, 2.2), '#d9d2c4', { y: 0.06, parent: M });
  for (const x of [-2.1, 2.1]) for (const z of [-0.9, 0.9]) kit.add(new THREE.CylinderGeometry(0.06, 0.06, 2.6, 8), '#ffffff', { x, y: 1.3, z, parent: M });
  kit.add(new THREE.BoxGeometry(4.9, 0.14, 2.5), P.busGreen, { y: 2.65, parent: M });
  kit.add(new THREE.BoxGeometry(4.95, 0.2, 0.1), P.busPink, { y: 2.6, z: 1.25, parent: M });
  kit.add(new THREE.BoxGeometry(4.3, 1.7, 0.05), '#cfe9f5', { y: 1.35, z: -0.92, parent: M });
  kit.add(new THREE.BoxGeometry(3.4, 0.08, 0.45), '#c99a6b', { y: 0.5, z: -0.55, parent: M });
  for (const x of [-1.5, 1.5]) kit.add(new THREE.BoxGeometry(0.08, 0.45, 0.4), '#8a9399', { x, y: 0.25, z: -0.55, parent: M });
  // the sign post
  kit.add(new THREE.CylinderGeometry(0.05, 0.05, 2.9, 8), '#ffffff', { x: 2.6, y: 1.45, z: 1.0, parent: M });
}

function buildClinic(group, kit, route, s, rand, updaters) {
  const c = route.at(s + 4, WALK + 13);
  const yaw = faceRoad(c); // front faces the road
  const M = new THREE.Matrix4().compose(new THREE.Vector3(c.x, 0, c.z), new THREE.Quaternion().setFromEuler(new THREE.Euler(0, yaw, 0)), new THREE.Vector3(1, 1, 1));
  // forecourt
  kit.add(new THREE.BoxGeometry(22, 0.1, 12), '#e9e3d6', { y: 0.05, z: 7, parent: M });
  // main building: white with a mint glass front and pink accents
  kit.add(new THREE.BoxGeometry(18, 7.5, 9), '#ffffff', { y: 3.75, parent: M });
  kit.add(new THREE.BoxGeometry(14, 2.6, 0.1), '#7fd1a8', { y: 1.5, z: 4.52, parent: M });
  kit.add(new THREE.BoxGeometry(14, 2.0, 0.1), '#7fd1a8', { y: 5.0, z: 4.52, parent: M });
  kit.add(new THREE.BoxGeometry(18.2, 0.35, 9.2), P.busGreen, { y: 3.1, parent: M });
  kit.add(new THREE.BoxGeometry(18.4, 0.4, 9.4), P.busPink, { y: 7.6, parent: M });
  for (let k = -3; k <= 3; k++) kit.add(new THREE.BoxGeometry(0.12, 2.6, 0.12), '#ffffff', { x: k * 2, y: 1.5, z: 4.58, parent: M });
  // entrance canopy
  kit.add(new THREE.BoxGeometry(5, 0.2, 3), P.busGreen, { y: 3.0, z: 6, parent: M });
  for (const x of [-2.3, 2.3]) kit.add(new THREE.CylinderGeometry(0.1, 0.1, 3, 10), '#ffffff', { x, y: 1.5, z: 7.3, parent: M });
  // the big sign on the roof edge
  const sign = makePanel(9, 2.2, (cx, W, H) => {
    roundRect(cx, 6, 6, W - 12, H - 12, H * 0.2);
    cx.fillStyle = '#ffffff'; cx.fill();
    cx.lineWidth = H * 0.05; cx.strokeStyle = P.busGreen; cx.stroke();
    drawLogo(cx, W * 0.06, H * 0.12, H * 0.62, { green: P.busGreen });
    text(cx, 'Dental Clinic', W * 0.06, H * 0.92, { size: H * 0.2, weight: 800, color: P.mintDark });
    text(cx, 'Be The Reason Someone Smiles', W * 0.5, H * 0.92, { size: H * 0.13, weight: 700, color: P.busPink });
  }, { ppm: 120 });
  const sp = new THREE.Vector3(0, 9.2, 4.0).applyMatrix4(M);
  sign.mesh.position.copy(sp);
  sign.mesh.rotation.y = yaw;
  group.add(sign.mesh);
  // a welcome banner between two poles at the kerb
  const a = route.at(s - 3, WALK + 6.5);
  const b = route.at(s + 11, WALK + 6.5);
  kit.add(new THREE.CylinderGeometry(0.08, 0.08, 4.4, 8), '#ffffff', { x: a.x, y: 2.2, z: a.z });
  kit.add(new THREE.CylinderGeometry(0.08, 0.08, 4.4, 8), '#ffffff', { x: b.x, y: 2.2, z: b.z });
  const banner = makePanel(13, 1.2, (cx, W, H) => {
    cx.fillStyle = P.busPink; cx.fillRect(0, 0, W, H);
    cx.fillStyle = '#ffffff'; cx.fillRect(0, H * 0.08, W, H * 0.84);
    text(cx, 'Selamat datang, Smile Bus!  ·  Membawa Senyum Lebih Dekat', W / 2, H * 0.66, { size: H * 0.42, weight: 900, color: P.mintDark, align: 'center', maxWidth: W * 0.95 });
  }, { ppm: 90 });
  banner.mesh.material.side = THREE.DoubleSide;
  const mid = route.at(s + 4, WALK + 6.5);
  banner.mesh.position.set(mid.x, 3.6, mid.z);
  banner.mesh.rotation.y = faceRoad(mid);
  group.add(banner.mesh);
  // a cheering crowd by the entrance
  const crowd = [];
  for (let k = 0; k < 7; k++) {
    const p = makePerson(rand, { wave: k % 2 === 0 });
    const at = new THREE.Vector3(-5 + k * 1.6, 0.1, 9.5 + (k % 2) * 0.8).applyMatrix4(M);
    p.position.copy(at);
    p.userData.baseY = 0.1;
    p.rotation.y = yaw;
    p.userData.phase = rand() * 6;
    group.add(p);
    crowd.push(p);
  }
  updaters.push((dt, t) => { for (const p of crowd) animatePerson(p, t, p.userData.cheer || p.userData.hopUntil > t ? 'hop' : 'idle', p.userData.phase); });
  group.userData.crowd = crowd;
  group.userData.clinicDoor = new THREE.Vector3(0, 0.1, 7).applyMatrix4(M);
}

// =================================================================== instanced nature + props
function shadeTrees(spots, rand) {
  const n = spots.length;
  const trunk = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.18, 0.28, 2.4, 6).translate(0, 1.2, 0), new THREE.MeshStandardMaterial({ color: '#7a5a3a', roughness: 1, flatShading: true }), n);
  const crownGeo = new THREE.IcosahedronGeometry(1.8, 0).translate(0, 3.6, 0);
  const crown = new THREE.InstancedMesh(crownGeo, new THREE.MeshStandardMaterial({ roughness: 0.9, flatShading: true }), n);
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const c = new THREE.Color();
  const greens = ['#5f9a49', '#6fae52', '#4f8a3e', '#7fbf5a', '#f4b6c8', '#ffc6d9', '#5fa84c'];
  spots.forEach(([x, z, k], i) => {
    q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), rand() * 6.28);
    m.compose(new THREE.Vector3(x, 0, z), q, new THREE.Vector3(k, k * (0.9 + rand() * 0.3), k));
    trunk.setMatrixAt(i, m);
    crown.setMatrixAt(i, m);
    crown.setColorAt(i, c.set(greens[Math.floor(rand() * greens.length)]));
  });
  crown.instanceColor.needsUpdate = true;
  return [trunk, crown];
}

function palms(spots, rand) {
  const n = spots.length;
  // a gently curved trunk
  const trunkGeo = new THREE.CylinderGeometry(0.12, 0.2, 6, 5, 3);
  const tp = trunkGeo.attributes.position;
  for (let i = 0; i < tp.count; i++) { const y = tp.getY(i) + 3; tp.setX(i, tp.getX(i) + (y / 6) ** 2 * 0.8); tp.setY(i, y); }
  trunkGeo.computeVertexNormals();
  const trunk = new THREE.InstancedMesh(trunkGeo, new THREE.MeshStandardMaterial({ color: '#9a7b56', roughness: 1, flatShading: true }), n);
  // fronds: 7 drooping leaves merged into one geometry
  const leaves = [];
  for (let k = 0; k < 7; k++) {
    const leaf = new THREE.ConeGeometry(0.45, 3.0, 4, 1);
    leaf.scale(1, 1, 0.25);
    leaf.translate(0, 1.5, 0);
    leaf.rotateZ(-1.9);
    leaf.rotateY((k / 7) * Math.PI * 2);
    leaf.translate(0.8, 6.0, 0);
    leaves.push(leaf.toNonIndexed());
  }
  const merged = mergeList(leaves);
  const crown = new THREE.InstancedMesh(merged, new THREE.MeshStandardMaterial({ color: '#4f9a3e', roughness: 0.9, flatShading: true, side: THREE.DoubleSide }), n);
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const c = new THREE.Color();
  spots.forEach(([x, z, k], i) => {
    q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), rand() * 6.28);
    m.compose(new THREE.Vector3(x, 0, z), q, new THREE.Vector3(k, k, k));
    trunk.setMatrixAt(i, m);
    crown.setMatrixAt(i, m);
    crown.setColorAt(i, c.set(['#4f9a3e', '#5aa848', '#468c37'][i % 3]));
  });
  crown.instanceColor.needsUpdate = true;
  return [trunk, crown];
}

function mergeList(list) {
  let count = 0;
  for (const g of list) count += g.attributes.position.count;
  const pos = new Float32Array(count * 3);
  let o = 0;
  for (const g of list) { pos.set(g.attributes.position.array, o); o += g.attributes.position.array.length; }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  out.computeVertexNormals();
  return out;
}

function streetLamps(spots) {
  const n = spots.length;
  const pole = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.07, 0.1, 6.5, 8).translate(0, 3.25, 0), new THREE.MeshStandardMaterial({ color: '#4a5258', roughness: 0.5 }), n);
  const armGeo = new THREE.BoxGeometry(0.08, 0.08, 1.6).translate(0, 6.4, 0.8);
  const arm = new THREE.InstancedMesh(armGeo, pole.material, n);
  const head = new THREE.InstancedMesh(new THREE.BoxGeometry(0.3, 0.12, 0.6).translate(0, 6.35, 1.55), new THREE.MeshBasicMaterial({ color: '#fff3c8', toneMapped: false }), n);
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  spots.forEach((p, i) => {
    // the arm reaches over the road (towards -left = right of the sidewalk)
    q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.atan2(-p.nx, -p.nz));
    m.compose(new THREE.Vector3(p.x, 0.16, p.z), q, new THREE.Vector3(1, 1, 1));
    pole.setMatrixAt(i, m);
    arm.setMatrixAt(i, m);
    head.setMatrixAt(i, m);
  });
  return [pole, arm, head];
}

function umbulUmbul(spots, rand) {
  const n = spots.length;
  const group = new THREE.Group();
  // bamboo pole that bends over at the top
  const poleGeo = new THREE.CylinderGeometry(0.04, 0.06, 7, 4, 5);
  const pp = poleGeo.attributes.position;
  for (let i = 0; i < pp.count; i++) { const y = pp.getY(i) + 3.5; pp.setY(i, y); pp.setZ(i, pp.getZ(i) + Math.max(0, y - 5) ** 2 * 0.35); }
  poleGeo.computeVertexNormals();
  const pole = new THREE.InstancedMesh(poleGeo, new THREE.MeshStandardMaterial({ color: '#c9a86a', roughness: 0.8 }), n);
  // the long cloth hanging from the bent top, fluttering in the wind (vertex shader)
  const clothGeo = new THREE.PlaneGeometry(0.55, 3.6, 1, 10).translate(0, -1.8, 0);
  const cloth = new THREE.InstancedMesh(clothGeo, new THREE.MeshStandardMaterial({ side: THREE.DoubleSide, roughness: 0.7, emissive: '#333333' }), n);
  const uniforms = { uTime: { value: 0 } };
  cloth.material.onBeforeCompile = (sh) => {
    sh.uniforms.uTime = uniforms.uTime;
    sh.vertexShader = 'uniform float uTime;\n' + sh.vertexShader.replace('#include <begin_vertex>', `#include <begin_vertex>
      #ifdef USE_INSTANCING
        float ph = instanceMatrix[3].x * 0.7 + instanceMatrix[3].z * 0.5;
        float k = -position.y / 3.6;
        transformed.z += sin(uTime * 2.6 + ph + k * 3.0) * 0.25 * k;
        transformed.x += sin(uTime * 1.9 + ph) * 0.08 * k;
      #endif`);
  };
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const c = new THREE.Color();
  const cols = [P.busPink, P.busGreen, '#ffb13b', '#4a9be8', '#ff6b6b', '#b38cf0', '#ffffff'];
  spots.forEach((p, i) => {
    // bend the top over the road
    q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), faceRoad(p, p.side));
    m.compose(new THREE.Vector3(p.x, 0.16, p.z), q, new THREE.Vector3(1, 1, 1));
    pole.setMatrixAt(i, m);
    m.compose(new THREE.Vector3(p.x, 0.16, p.z), q, new THREE.Vector3(1, 1, 1));
    const top = new THREE.Matrix4().makeTranslation(0, 6.6, 0.55);
    cloth.setMatrixAt(i, m.clone().multiply(top));
    cloth.setColorAt(i, c.set(cols[Math.floor(rand() * cols.length)]));
  });
  cloth.instanceColor.needsUpdate = true;
  group.add(pole, cloth);
  return { group, update(dt, t) { uniforms.uTime.value = t; } };
}

function clouds(rand) {
  const geo = new THREE.IcosahedronGeometry(1, 0);
  const puffs = [];
  for (let k = 0; k < 14; k++) {
    const a = rand() * Math.PI * 2;
    const r = 200 + rand() * 120;
    const cx = Math.cos(a) * r;
    const cz = Math.sin(a) * r;
    const cy = 55 + rand() * 30;
    const np = 3 + Math.floor(rand() * 3);
    for (let j = 0; j < np; j++) puffs.push([cx + (j - np / 2) * 14, cy + rand() * 5, cz + rand() * 8, 9 + rand() * 7]);
  }
  const mesh = new THREE.InstancedMesh(geo, new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 1, emissive: '#ffffff', emissiveIntensity: 0.45, flatShading: true, fog: false }), puffs.length);
  const m = new THREE.Matrix4();
  puffs.forEach(([x, y, z, s], i) => { m.compose(new THREE.Vector3(x, y, z), new THREE.Quaternion(), new THREE.Vector3(s * 1.5, s * 0.7, s)); mesh.setMatrixAt(i, m); });
  return mesh;
}

// =================================================================== textures
function canvasTex(cv, repeat = false) {
  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  if (repeat) { t.wrapS = t.wrapT = THREE.RepeatWrapping; }
  return t;
}

function roadTexture(cross = false) {
  const W = 256;
  const H = 512;
  const cv = document.createElement('canvas');
  cv.width = W; cv.height = H;
  const c = cv.getContext('2d');
  c.fillStyle = P.asphalt;
  c.fillRect(0, 0, W, H);
  for (let i = 0; i < 2500; i++) { c.fillStyle = Math.random() < 0.5 ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.08)'; c.fillRect(Math.random() * W, Math.random() * H, 2, 2); }
  if (!cross) {
    // edge lines and the dashed centre line
    c.fillStyle = P.line;
    c.fillRect(W * 0.03, 0, W * 0.025, H);
    c.fillRect(W * 0.945, 0, W * 0.025, H);
    for (let y = 0; y < H; y += 128) c.fillRect(W / 2 - 4, y, 8, 72);
  }
  const t = canvasTex(cv, true);
  return t;
}

function walkTexture() {
  const cv = document.createElement('canvas');
  cv.width = 128; cv.height = 128;
  const c = cv.getContext('2d');
  c.fillStyle = '#d9d2c4';
  c.fillRect(0, 0, 128, 128);
  const cols = ['#e3dccd', '#cfc7b6', '#e8c9cf', '#cfe3d4'];
  for (let y = 0; y < 4; y++) for (let x = 0; x < 4; x++) {
    c.fillStyle = cols[(x * 3 + y * 5) % cols.length];
    c.fillRect(x * 32 + 2, y * 32 + 2, 28, 28);
  }
  return canvasTex(cv, true);
}

function grassTexture() {
  const cv = document.createElement('canvas');
  cv.width = 128; cv.height = 128;
  const c = cv.getContext('2d');
  c.fillStyle = P.grass;
  c.fillRect(0, 0, 128, 128);
  for (let i = 0; i < 900; i++) {
    c.fillStyle = Math.random() < 0.5 ? 'rgba(60,110,40,0.25)' : 'rgba(180,220,120,0.25)';
    c.fillRect(Math.random() * 128, Math.random() * 128, 2, 3);
  }
  return canvasTex(cv, true);
}

function stopZoneTexture() {
  const cv = document.createElement('canvas');
  cv.width = 256; cv.height = 1024;
  const c = cv.getContext('2d');
  c.fillStyle = 'rgba(60,196,76,0.35)';
  c.fillRect(0, 0, 256, 1024);
  c.strokeStyle = '#ffd23b';
  c.lineWidth = 16;
  c.strokeRect(10, 10, 236, 1004);
  // zig-zag
  c.beginPath();
  for (let y = 40; y < 1000; y += 60) { c.moveTo(30, y); c.lineTo(226, y + 30); }
  c.globalAlpha = 0.35;
  c.stroke();
  c.globalAlpha = 1;
  c.save();
  c.translate(128, 512);
  c.rotate(Math.PI / 2);
  c.fillStyle = '#ffffff';
  c.font = '900 120px system-ui';
  c.textAlign = 'center';
  c.textBaseline = 'middle';
  c.fillText('BUS STOP', 0, 0);
  c.restore();
  const t = canvasTex(cv);
  return t;
}

function skyDome() {
  const mat = new THREE.ShaderMaterial({
    uniforms: { top: { value: new THREE.Color('#4f9fe0') }, horizon: { value: new THREE.Color('#dff1f8') }, bottom: { value: new THREE.Color('#cfe3c8') } },
    vertexShader: 'varying vec3 vDir; void main(){ vDir = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
    fragmentShader: `uniform vec3 top; uniform vec3 horizon; uniform vec3 bottom; varying vec3 vDir;
      void main(){ float h = vDir.y; vec3 c = h > 0.0 ? mix(horizon, top, pow(min(h * 1.5, 1.0), 0.7)) : mix(horizon, bottom, min(-h * 4.0, 1.0));
      // sun glow
      vec3 sd = normalize(vec3(0.5, 0.75, 0.35)); float g = max(dot(normalize(vDir), sd), 0.0);
      c += vec3(1.0, 0.95, 0.8) * (pow(g, 400.0) * 1.5 + pow(g, 12.0) * 0.18);
      gl_FragColor = vec4(c, 1.0);
      #include <colorspace_fragment>
      }`,
    side: THREE.BackSide, depthWrite: false, fog: false,
  });
  const m = new THREE.Mesh(new THREE.SphereGeometry(370, 32, 16), mat);
  m.renderOrder = -1;
  m.frustumCulled = false;
  return m;
}
