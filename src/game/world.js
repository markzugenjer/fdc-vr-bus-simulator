import * as THREE from 'three';
import { P } from './palette.js';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { makeBunting, makeBalloons } from './festive.js';
import { makePerson, animatePerson, blobTexture } from './people.js';
import { TexKit, townAtlas, SIGNS, BANNERS } from './atlas.js';
import { drawLogo, roundRect } from './livery.js';
import { makePanel, text } from '../core/ui.js';

/**
 * The festive little town the Smile Bus drives through.
 *
 *   - one closed road loop (~1 km) built from a smooth spline, two lanes, driving on the LEFT
 *   - pastel houses with tiled hip / gable roofs, terraces and fences; 2-3 storey ruko with
 *     shop signs, awnings and balconies; warungs with banners; electricity poles and wires
 *   - shade trees, coconut palms, banana plants and flowering bushes; hills and a volcano far away
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
  const atlas = townAtlas();

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
  // the sky (with its clouds and the far hills) follows the camera, so it's never clipped
  const sky = skyDome();
  group.add(sky);
  sky.add(farHills(rand));
  group.add(new THREE.HemisphereLight(0xdff1ff, 0x8aa86a, 1.35));
  const sun = new THREE.DirectionalLight(0xfff0d2, 2.4);
  sun.position.set(60, 100, 40);
  group.add(sun);
  group.add(groundPlane());

  // ------------------------------------------------ road + sidewalks + markings
  group.add(roadRibbon(route, -ROAD_HALF, ROAD_HALF, 0.02, new THREE.MeshStandardMaterial({ map: roadTexture(), roughness: 0.9 }), 10));
  const walkMat = new THREE.MeshStandardMaterial({ map: walkTexture(), roughness: 0.9 });
  group.add(roadRibbon(route, ROAD_HALF + 0.2, WALK, 0.16, walkMat, 4));
  group.add(roadRibbon(route, -WALK, -ROAD_HALF - 0.2, 0.16, walkMat, 4, 0, null, true));
  const kerbMat = new THREE.MeshStandardMaterial({ map: kerbTexture(), roughness: 0.8 });
  const kerbFaceMat = new THREE.MeshStandardMaterial({ map: kerbMat.map, roughness: 0.8, side: THREE.DoubleSide });
  for (const s of [-1, 1]) {
    group.add(roadRibbon(route, s > 0 ? ROAD_HALF : -ROAD_HALF - 0.2, s > 0 ? ROAD_HALF + 0.2 : -ROAD_HALF, 0.17, kerbMat, 2));
    group.add(kerbFace(route, s * ROAD_HALF, s, 0.17, kerbFaceMat));
  }
  // the gutter / drain cover strip behind the sidewalks
  const drainMat = new THREE.MeshStandardMaterial({ color: '#9a978f', roughness: 0.95 });
  group.add(roadRibbon(route, WALK, WALK + 0.45, 0.1, drainMat, 1));
  group.add(roadRibbon(route, -WALK - 0.45, -WALK, 0.1, drainMat, 1));

  const kit = new TexKit(); // ALL static scenery, merged into one mesh at the end
  const tmp = {};
  const people = []; // every townsperson (for their shadows)

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
    // zebra stripes across the main road, before and after the junction
    for (const zs of [l.s + 2.2, l.s + 13.8]) {
      for (let k = -3; k <= 3; k++) {
        const z = route.at(zs, k * 1.1, tmp);
        kit.add(new THREE.BoxGeometry(0.6, 0.02, 2.2), '#f7f7f2', { x: z.x, y: 0.035, z: z.z, ry: z.yaw + Math.PI / 2 });
      }
    }
    // our stop line, and the oncoming lane's
    const sl = route.at(l.s, LANE, tmp);
    kit.add(new THREE.BoxGeometry(3.4, 0.02, 0.35), '#ffffff', { x: sl.x, y: 0.036, z: sl.z, ry: sl.yaw });
    const so = route.at(l.s + 16, -LANE, tmp);
    kit.add(new THREE.BoxGeometry(3.4, 0.02, 0.35), '#ffffff', { x: so.x, y: 0.036, z: so.z, ry: so.yaw });
    // a painted "go straight" arrow before the line
    const ar = route.at(l.s - 9, LANE, tmp);
    kit.add(new THREE.BoxGeometry(0.22, 0.02, 2.6), '#f4f4f0', { x: ar.x, y: 0.034, z: ar.z, ry: ar.yaw });
    const tip = route.at(l.s - 7.4, LANE, tmp);
    kit.add(new THREE.CylinderGeometry(0.55, 0.55, 0.02, 3), '#f4f4f0', { x: tip.x, y: 0.034, z: tip.z, ry: tip.yaw + Math.PI, sz: 1.3 });
  }

  // ------------------------------------------------ traffic lights (with visors, glow and countdown)
  const tl = trafficLights(route, lights, kit);
  group.add(tl.group);
  const CYCLE = { green: 11, yellow: 2.6, red: 8 };
  const T_ALL = CYCLE.green + CYCLE.yellow + CYCLE.red;
  for (const l of lights) { l.t = l.phase % T_ALL; }
  const lightState = (t) => {
    const k = ((t % T_ALL) + T_ALL) % T_ALL;
    return k < CYCLE.green ? 'green' : k < CYCLE.green + CYCLE.yellow ? 'yellow' : 'red';
  };
  const leftOf = (t) => {
    const k = ((t % T_ALL) + T_ALL) % T_ALL;
    return k < CYCLE.green ? CYCLE.green - k : k < CYCLE.green + CYCLE.yellow ? CYCLE.green + CYCLE.yellow - k : T_ALL - k;
  };
  updaters.push((dt, t) => {
    lights.forEach((l, i) => {
      l.t += dt;
      const st = lightState(l.t);
      if (st !== l.state || !l.drawn) {
        l.state = st;
        l.drawn = true;
        tl.setState(i, st);
      }
      tl.setCount(i, Math.ceil(leftOf(l.t)), st);
    });
    tl.update(t);
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
    const sp = new THREE.Vector3(2.6, 3.15, 1.0).applyMatrix4(M);
    sign.mesh.position.copy(sp);
    sign.mesh.rotation.y = faceRoad(c);
    sign.mesh.material.side = THREE.DoubleSide;
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
      people.push(p);
    }
    st.balloons = route.at(st.s + 3.2, WALK + 0.6);
  }

  // ------------------------------------------------ the FDC clinic (start and finish)
  buildClinic(group, kit, route, CLINIC_S, rand, updaters, people);
  const clinicZone = roadRibbon(route, LANE - 1.6, LANE + 1.6, 0.03, stopMat, 14, CLINIC_S - 7, CLINIC_S + 7);
  group.add(clinicZone);

  // ------------------------------------------------ houses, shophouses, warungs
  const palette = ['#ffd9e6', '#d8f3dc', '#fff1c1', '#d6ecff', '#fde2cf', '#e9dcff', '#ffffff', '#c9f0e4', '#ffe7a8', '#f6efe4'];
  const roofs = ['#c75b3f', '#b54e37', '#d06a45', '#8f4a3a', '#5c6a7a', '#3f7f6a', '#b8603f'];
  const treeSpots = [];
  const palmSpots = [];
  const bananaSpots = [];
  const bushSpots = [];
  for (const side of [1, -1]) {
    let s = rand() * 8;
    while (s < L) {
      if (busy(s, side > 0 ? 13 : 9)) { s += 10; continue; }
      const kind = rand();
      const w = kind < 0.35 ? 9 + rand() * 4 : 6.5 + rand() * 3;
      const d = 6 + rand() * 3;
      const yard = 2.2 + rand() * 2;
      const lat = side * (WALK + 0.45 + yard + d / 2);
      const c = route.at(s + w / 2, lat);
      if (route.clearance(c.x, c.z) < WALK + 1.5 + Math.max(w, d) / 2) { s += 6; continue; }
      const facing = faceRoad(c, side); // front (+z) towards the road
      const M = new THREE.Matrix4().compose(new THREE.Vector3(c.x, 0, c.z), new THREE.Quaternion().setFromEuler(new THREE.Euler(0, facing, 0)), new THREE.Vector3(1, 1, 1));
      const col = palette[Math.floor(rand() * palette.length)];
      const roof = roofs[Math.floor(rand() * roofs.length)];
      const local = (x, z) => new THREE.Vector3(x, 0, z).applyMatrix4(M);
      if (kind < 0.35) addShophouse(kit, M, w, d, yard, rand);
      else if (kind < 0.5) addWarung(kit, M, rand);
      else {
        addHouse(kit, M, w, d, yard, col, roof, rand);
        // a garden tree or banana plant in some yards, bushes along the fence
        const g = local((rand() < 0.5 ? -1 : 1) * (w / 2 - 0.6), d / 2 + yard * 0.45);
        if (rand() < 0.45) (rand() < 0.5 ? bananaSpots : treeSpots).push([g.x, g.z, 0.55 + rand() * 0.25]);
        for (const x of [-w / 2 + 0.5, w / 2 - 0.5]) { const b = local(x, d / 2 + yard - 0.7); bushSpots.push([b.x, b.z, 0.5 + rand() * 0.3]); }
      }
      s += w + 2 + rand() * 5;
    }
  }

  // ------------------------------------------------ trees: shade trees, coconut palms, bananas, bushes
  for (let k = 0; k < 760; k++) {
    const s = rand() * L;
    const side = rand() < 0.5 ? 1 : -1;
    const lat = side * (WALK + 4 + rand() * 45);
    const c = route.at(s, lat);
    if (route.clearance(c.x, c.z) < WALK + 2.5) continue;
    if (Math.abs(lat) < 20 && rand() < 0.75) continue; // keep house rows mostly clear
    const r = rand();
    (r < 0.14 ? palmSpots : r < 0.24 ? bananaSpots : treeSpots).push([c.x, c.z, 0.8 + rand() * 0.7, Math.abs(lat) > 17]);
  }
  // a row of palms on the right sidewalk
  for (let s = 5; s < L; s += 23) {
    if (busy(s, 10)) continue;
    const c = route.at(s, -(WALK - 0.7));
    palmSpots.push([c.x, c.z, 0.8 + rand() * 0.25]);
  }
  const trees = shadeTrees(treeSpots, rand);
  group.add(...trees);
  group.add(...palms(palmSpots, rand));
  group.add(bananas(bananaSpots, rand));
  group.add(bushes(bushSpots, rand));
  group.add(treeShadows([...treeSpots.map(([x, z, k]) => [x, z, k * 3.2]), ...palmSpots.map(([x, z, k]) => [x + 0.6 * k, z, k * 2.2]), ...bananaSpots.map(([x, z, k]) => [x, z, k * 1.8])]));

  // ------------------------------------------------ street lamps (left sidewalk)
  const lampSpots = [];
  for (let s = 10; s < L; s += 34) {
    if (busy(s, 6)) continue;
    lampSpots.push(route.at(s, WALK - 0.45, {}));
  }
  group.add(...streetLamps(lampSpots));

  // ------------------------------------------------ electricity poles and wires (right side)
  utilityPoles(kit, route, busy);

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
    // the bamboo poles holding them
    for (const p of [a, b]) {
      kit.add(new THREE.CylinderGeometry(0.06, 0.07, 6.1, 7), '#c9a86a', { x: p.x, y: 3.05, z: p.z });
      for (let k = 1; k < 6; k += 2) kit.add(new THREE.CylinderGeometry(0.075, 0.075, 0.04, 6, 1, true), '#a8874f', { x: p.x, y: k * 1.05, z: p.z });
    }
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

  // ------------------------------------------------ street furniture: parked scooters, carts, bins
  for (let s = 20; s < L; s += 41 + rand() * 30) {
    if (busy(s, 9)) continue;
    const side = rand() < 0.6 ? 1 : -1;
    const c = route.at(s, side * (WALK - 1.0), {});
    const M = new THREE.Matrix4().compose(new THREE.Vector3(c.x, 0.16, c.z), new THREE.Quaternion().setFromEuler(new THREE.Euler(0, c.yaw + Math.PI / 2 * side, 0)), new THREE.Vector3(1, 1, 1));
    const r = rand();
    if (r < 0.45) addGerobak(kit, M, rand);
    else if (r < 0.75) addBin(kit, M, rand);
    else addBench(kit, M);
  }

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
    people.push(p);
  }
  // people strolling up and down the sidewalks
  const walkers = [];
  for (let k = 0; k < 12; k++) {
    const s0 = rand() * L;
    const side = rand() < 0.55 ? 1 : -1;
    const p = makePerson(rand);
    p.userData.baseY = 0.16;
    p.userData.phase = rand() * 6;
    const wk = { p, s: s0, a: s0 - 15 - rand() * 25, b: s0 + 15 + rand() * 25, dir: rand() < 0.5 ? 1 : -1, lat: side * (WALK - 1.2 - rand() * 0.9), v: 0.9 + rand() * 0.45, pause: 0 };
    walkers.push(wk);
    group.add(p);
    people.push(p);
  }
  const wp = {};
  let clock = 0;
  updaters.push((dt, t) => {
    clock = t;
    for (const p of folks) animatePerson(p, t, p.userData.hopUntil > t ? 'hop' : 'idle', p.userData.phase);
    for (const st of stops) for (const p of st.waiting) if (!p.userData.busy) animatePerson(p, t, p.userData.hopUntil > t ? 'hop' : 'idle', p.userData.phase);
    for (const w of walkers) {
      const p = w.p;
      if (p.userData.hopUntil > t) { animatePerson(p, t, 'hop', p.userData.phase); continue; }
      if (w.pause > 0) { w.pause -= dt; animatePerson(p, t, 'idle', p.userData.phase); if (w.pause <= 0) w.dir *= -1; continue; }
      w.s += w.dir * w.v * dt;
      if ((w.dir > 0 && w.s > w.b) || (w.dir < 0 && w.s < w.a)) w.pause = 1.5 + Math.random() * 3;
      route.at(w.s, w.lat, wp);
      p.position.x = wp.x;
      p.position.z = wp.z;
      p.rotation.y = wp.yaw + (w.dir > 0 ? Math.PI : 0);
      animatePerson(p, t * (w.v / 1.1), 'walk', p.userData.phase);
    }
  });
  /** The horn: everyone close by hops and waves for a moment. */
  const honk = (x, z) => {
    for (const p of [...folks, ...walkers.map((w) => w.p), ...stops.flatMap((st) => st.waiting), ...(group.userData.crowd || [])]) {
      if (p.userData.busy) continue;
      if ((p.position.x - x) ** 2 + (p.position.z - z) ** 2 < 30 * 30) p.userData.hopUntil = clock + 1.6;
    }
  };

  // ------------------------------------------------ clouds
  sky.add(clouds(rand));

  group.add(kit.buildChunks(90, { roughness: 0.85, glow: 0.07 }));

  Object.assign(o, {
    group, route, stops, lights, CLINIC_S, lightState, honk, sky, people,
    get crowd() { return group.userData.crowd; },
    get clinicDoor() { return group.userData.clinicDoor; },
    update(dt, t) { for (const f of updaters) f(dt, t); },
  });
  return o;
}

// =================================================================== road geometry
/** A strip along the route between lateral offsets a..b, at height y, with UV v = s / repeat. */
function roadRibbon(route, a, b, y, material, repeat, s0 = 0, s1 = null, flipU = false) {
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
    uv.set(flipU ? [1, v, 0, v] : [0, v, 1, v], i * 4);
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

/** The kerb's vertical face, painted in the same black / white blocks as its top. */
function kerbFace(route, lat, side, h, material) {
  const n = Math.ceil(route.length / 2) + 1;
  const pos = new Float32Array(n * 2 * 3);
  const uv = new Float32Array(n * 2 * 2);
  const idx = [];
  const p = {};
  for (let i = 0; i < n; i++) {
    const s = Math.min(route.length, i * 2);
    route.at(s, lat, p);
    pos.set([p.x, 0.0, p.z, p.x, h, p.z], i * 6);
    uv.set([0, s / 2, 1, s / 2], i * 4);
    if (i < n - 1) { const k = i * 2; if (side > 0) idx.push(k, k + 1, k + 2, k + 1, k + 3, k + 2); else idx.push(k, k + 2, k + 1, k + 1, k + 2, k + 3); }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  return new THREE.Mesh(g, material);
}

function groundPlane() {
  const geo = new THREE.PlaneGeometry(1400, 1400, 70, 70);
  geo.rotateX(-Math.PI / 2);
  const pos = geo.attributes.position;
  const col = new Float32Array(pos.count * 3);
  const a = new THREE.Color('#9cc96a');
  const b = new THREE.Color('#6f9e47');
  const d = new THREE.Color('#b7b06a');
  const c = new THREE.Color();
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const z = pos.getZ(i);
    const n = Math.sin(x * 0.021 + Math.sin(z * 0.013) * 2) * 0.5 + Math.sin(z * 0.027 + x * 0.006) * 0.35 + Math.sin((x + z) * 0.061) * 0.15;
    c.copy(a).lerp(b, THREE.MathUtils.clamp(0.5 + n * 0.6, 0, 1));
    if (n > 0.62) c.lerp(d, (n - 0.62) * 1.6);
    col.set([c.r, c.g, c.b], i * 3);
  }
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  const mat = new THREE.MeshStandardMaterial({ map: grassTexture(), roughness: 1, vertexColors: true });
  const uv = geo.attributes.uv;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * 140, uv.getY(i) * 140);
  const ground = new THREE.Mesh(geo, mat);
  ground.position.set(125, 0, 0);
  return ground;
}

// =================================================================== traffic lights
/**
 * Indonesian traffic lights: a pole on the kerb with an arm over the lane, black heads with visors
 * over each lamp, a white-edged back plate, and the red countdown display next to the lamps.
 * Each junction has a pair for us and a pair for the oncoming lane. The lit lamp glows.
 */
function trafficLights(route, lights, kit) {
  const group = new THREE.Group();
  const atlas = townAtlas();
  const heads = []; // per light: [{ M (matrix of the head), facing }]
  const pole = '#2f3a3f';
  const addPole = (base, armEnd, s) => {
    kit.add(new THREE.CylinderGeometry(0.11, 0.15, 6.2, 12), pole, { x: base.x, y: 3.1, z: base.z });
    kit.add(new THREE.CylinderGeometry(0.2, 0.24, 0.35, 12), '#9aa3a8', { x: base.x, y: 0.17, z: base.z });
    // yellow-black safety sleeve
    for (let k = 0; k < 4; k++) kit.add(new THREE.CylinderGeometry(0.155, 0.155, 0.22, 12), k % 2 ? '#1d1f22' : '#ffd23b', { x: base.x, y: 0.45 + k * 0.22, z: base.z });
    const mx = (base.x + armEnd.x) / 2;
    const mz = (base.z + armEnd.z) / 2;
    const len = Math.hypot(armEnd.x - base.x, armEnd.z - base.z);
    const ry = Math.atan2(armEnd.x - base.x, armEnd.z - base.z);
    kit.add(new THREE.CylinderGeometry(0.07, 0.09, len, 10), pole, { x: mx, y: 5.95, z: mz, rx: Math.PI / 2, ry });
    // diagonal brace
    const bx = base.x + (armEnd.x - base.x) * 0.22;
    const bz = base.z + (armEnd.z - base.z) * 0.22;
    kit.add(new THREE.CylinderGeometry(0.035, 0.035, Math.hypot(len * 0.44, 1.0), 6), pole, { x: bx, y: 5.5, z: bz, ry, rx: Math.PI / 2 - Math.atan2(1.0, len * 0.44) });
    void s;
  };
  const addHead = (pos, yaw, list, countdown) => {
    const M = new THREE.Matrix4().compose(pos, new THREE.Quaternion().setFromEuler(new THREE.Euler(0, yaw, 0)), new THREE.Vector3(1, 1, 1));
    // back plate with a white border, the housing, three visors
    kit.add(new THREE.BoxGeometry(0.66, 1.42, 0.03), '#f4f4f0', { z: -0.16, parent: M });
    kit.add(new THREE.BoxGeometry(0.6, 1.36, 0.04), '#141618', { z: -0.145, parent: M });
    kit.add(new THREE.BoxGeometry(0.4, 1.2, 0.26), '#1d2124', { parent: M });
    for (let i = 0; i < 3; i++) {
      // an open half-pipe hood over the lamp (both faces, it's thin)
      for (const k of [0, 1]) kit.add(new THREE.CylinderGeometry(0.175 - k * 0.008, 0.175 - k * 0.008, 0.26, 14, 1, true, -Math.PI / 2, Math.PI), '#1a1d20', { y: 0.38 - i * 0.38, z: 0.25, rx: -Math.PI / 2, sx: k ? -1 : 1, parent: M });
    }
    // the bracket to the pole / arm
    kit.add(new THREE.BoxGeometry(0.08, 0.08, 0.3), '#2f3a3f', { y: 0.45, z: -0.3, parent: M });
    kit.add(new THREE.BoxGeometry(0.08, 0.08, 0.3), '#2f3a3f', { y: -0.45, z: -0.3, parent: M });
    if (countdown) {
      kit.add(new THREE.BoxGeometry(0.46, 0.34, 0.2), '#1d2124', { x: 0.48, y: -0.36, parent: M });
      kit.add(new THREE.BoxGeometry(0.12, 0.08, 0.16), '#2f3a3f', { x: 0.25, y: -0.36, parent: M });
    }
    list.push({ M, countdown });
  };
  lights.forEach((l) => {
    const list = [];
    // ours: on the left kerb, before the junction, facing the bus coming up from behind
    const base = route.at(l.s + 0.5, WALK - 0.6);
    const yaw = base.yaw; // +z of a head points back down the road, at the approaching bus
    const armEnd = route.at(l.s + 0.5, LANE - 0.6);
    addPole(base, armEnd, 1);
    addHead(new THREE.Vector3(armEnd.x, 5.25, armEnd.z), yaw, list, true);
    addHead(new THREE.Vector3(base.x, 3.0, base.z).add(new THREE.Vector3(-base.tx * 0.32, 0, -base.tz * 0.32)), yaw, list, true);
    // the oncoming lane's pair, on the far side of the junction
    const base2 = route.at(l.s + 15.5, -(WALK - 0.6));
    const arm2 = route.at(l.s + 15.5, -(LANE - 0.6));
    addPole(base2, arm2, -1);
    addHead(new THREE.Vector3(arm2.x, 5.25, arm2.z), yaw + Math.PI, list, false);
    addHead(new THREE.Vector3(base2.x, 3.0, base2.z).add(new THREE.Vector3(base2.tx * 0.32, 0, base2.tz * 0.32)), yaw + Math.PI, list, false);
    heads.push(list);
  });

  // lamp lenses: one instanced mesh for all of them (colour = state)
  const t = atlas.tiles.lens;
  const lensGeo = new THREE.CircleGeometry(0.145, 20);
  const uv = lensGeo.attributes.uv;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, t[0] + (t[2] - t[0]) * uv.getX(i), t[1] + (t[3] - t[1]) * uv.getY(i));
  const nHeads = heads.reduce((a, h) => a + h.length, 0);
  const lens = new THREE.InstancedMesh(lensGeo, new THREE.MeshBasicMaterial({ map: atlas.tex, toneMapped: false }), nHeads * 3);
  const glowTex = glowTexture();
  const glow = new THREE.InstancedMesh(new THREE.PlaneGeometry(1.25, 1.25), new THREE.MeshBasicMaterial({ map: glowTex, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false }), nHeads);
  glow.renderOrder = 2;
  const m = new THREE.Matrix4();
  const off = new THREE.Matrix4();
  let k = 0;
  heads.forEach((list) => list.forEach((h) => {
    h.lens = k;
    for (let i = 0; i < 3; i++) {
      m.multiplyMatrices(h.M, off.makeTranslation(0, 0.38 - i * 0.38, 0.135));
      lens.setMatrixAt(k * 3 + i, m);
    }
    k++;
  }));
  lens.instanceMatrix.needsUpdate = true;
  for (const mm of [lens, glow]) { mm.frustumCulled = false; group.add(mm); }

  // countdown displays: one small canvas per junction, shared by its two heads
  const counters = heads.map((list) => {
    const cv = document.createElement('canvas');
    cv.width = 96; cv.height = 64;
    const tex = new THREE.CanvasTexture(cv);
    tex.colorSpace = THREE.SRGBColorSpace;
    const mat = new THREE.MeshBasicMaterial({ map: tex, toneMapped: false });
    const geos = [];
    for (const h of list) {
      if (!h.countdown) continue;
      const g = new THREE.PlaneGeometry(0.38, 0.26);
      g.applyMatrix4(new THREE.Matrix4().multiplyMatrices(h.M, off.makeTranslation(0.48, -0.36, 0.101)));
      geos.push(g);
    }
    const mesh = new THREE.Mesh(mergeGeometries(geos), mat);
    group.add(mesh);
    return { cv, tex, last: '' };
  });

  const COL = { red: '#ff2a2a', yellow: '#ffc21f', green: '#1fff6a' };
  const OFF = { red: '#3a1416', yellow: '#3a3014', green: '#123a20' };
  const c = new THREE.Color();
  const state = [];
  const api = {
    group,
    setState(i, st) {
      state[i] = st;
      heads[i].forEach((h) => {
        ['red', 'yellow', 'green'].forEach((col, j) => lens.setColorAt(h.lens * 3 + j, c.set(col === st ? COL[col] : OFF[col])));
        const j = ['red', 'yellow', 'green'].indexOf(st);
        m.multiplyMatrices(h.M, off.makeTranslation(0, 0.38 - j * 0.38, 0.16));
        glow.setMatrixAt(h.lens, m);
        glow.setColorAt(h.lens, c.set(COL[st]));
      });
      lens.instanceColor.needsUpdate = true;
      glow.instanceMatrix.needsUpdate = true;
      glow.instanceColor.needsUpdate = true;
    },
    setCount(i, n, st) {
      const ct = counters[i];
      const key = `${n}${st}`;
      if (ct.last === key) return;
      ct.last = key;
      const g = ct.cv.getContext('2d');
      g.fillStyle = '#050607'; g.fillRect(0, 0, 96, 64);
      g.font = '900 52px ui-monospace, Menlo, monospace';
      g.textAlign = 'center'; g.textBaseline = 'middle';
      g.fillStyle = 'rgba(255,255,255,0.06)'; g.fillText('88', 48, 35);
      g.fillStyle = st === 'green' ? '#2bff76' : st === 'yellow' ? '#ffcc2a' : '#ff3434';
      g.fillText(String(Math.min(99, n)).padStart(2, '0'), 48, 35);
      ct.tex.needsUpdate = true;
    },
    update(t) {
      // the lit lamp's glow breathes a little
      glow.material.opacity = 0.85 + Math.sin(t * 6) * 0.1;
    },
  };
  return api;
}

function glowTexture() {
  const cv = document.createElement('canvas');
  cv.width = cv.height = 64;
  const c = cv.getContext('2d');
  const g = c.createRadialGradient(32, 32, 0, 32, 32, 32);
  g.addColorStop(0, 'rgba(255,255,255,0.9)');
  g.addColorStop(0.18, 'rgba(255,255,255,0.55)');
  g.addColorStop(0.45, 'rgba(255,255,255,0.12)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  c.fillStyle = g;
  c.fillRect(0, 0, 64, 64);
  return new THREE.CanvasTexture(cv);
}

// =================================================================== buildings
const v3 = (x, y, z) => [x, y, z];
const BAR = new THREE.PlaneGeometry(0.03, 1); // a railing bar seen from the road (2 triangles)

/**
 * A pitched roof over a w x d footprint with its eaves at height h: hipped (limasan, the most
 * common Indonesian roof) or gabled (pelana). Clay tiles on top, white soffit underneath.
 */
function addRoof(kit, M, w, d, h, color, { hip = true, overhang = 0.6, pitch = 0.62, gableWall = '#ffffff' } = {}) {
  const W = w / 2 + overhang;
  const D = d / 2 + overhang;
  const rh = D * pitch;
  const top = h + rh;
  const soffit = '#f4f1ea';
  const faces = [];
  if (hip) {
    const rx = Math.max(0, W - D);
    faces.push([v3(-W, h, D), v3(W, h, D), v3(rx, top, 0), v3(-rx, top, 0), [[0, 0], [1, 0], [0.5 + rx / (2 * W), 1], [0.5 - rx / (2 * W), 1]]]);
    faces.push([v3(W, h, -D), v3(-W, h, -D), v3(-rx, top, 0), v3(rx, top, 0), [[0, 0], [1, 0], [0.5 + rx / (2 * W), 1], [0.5 - rx / (2 * W), 1]]]);
    faces.push([v3(W, h, D), v3(W, h, -D), v3(rx, top, 0), null]);
    faces.push([v3(-W, h, -D), v3(-W, h, D), v3(-rx, top, 0), null]);
    // ridge cap
    if (rx > 0.05) kit.add(new THREE.BoxGeometry(rx * 2 + 0.2, 0.12, 0.22), color, { y: top + 0.02, parent: M, sy: 1 }, 'roof');
  } else {
    faces.push([v3(-W, h, D), v3(W, h, D), v3(W, top, 0), v3(-W, top, 0)]);
    faces.push([v3(W, h, -D), v3(-W, h, -D), v3(-W, top, 0), v3(W, top, 0)]);
    kit.add(new THREE.BoxGeometry(W * 2 + 0.1, 0.12, 0.22), color, { y: top + 0.02, parent: M }, 'roof');
    // gable ends: wall up to the roof line
    const yW = h + rh * (overhang / D);
    for (const s of [-1, 1]) {
      const x = s * (w / 2);
      const a = v3(x, h, s * d / 2); const b = v3(x, h, -s * d / 2); const c = v3(x, yW, -s * d / 2); const e = v3(x, yW, s * d / 2);
      kit.quad(a, b, c, e, gableWall, 'plaster', M);
      kit.tri(e, c, v3(x, top - 0.02, 0), gableWall, 'plaster', M);
      // barge boards along the gable edge
      for (const z of [-1, 1]) {
        const len = Math.hypot(D, rh);
        kit.add(new THREE.BoxGeometry(0.06, 0.2, len), '#ffffff', { x: s * (W - 0.02), y: h + rh / 2, z: z * D / 2, rx: z * Math.atan2(rh, D), parent: M });
      }
    }
  }
  for (const [a, b, c, e, uvs] of faces) {
    if (e) {
      kit.quad(a, b, c, e, color, 'roof', M, uvs);
      kit.quad(b, a, e, c, soffit, null, M); // underside
    } else {
      kit.tri(a, b, c, color, 'roof', M);
      kit.tri(b, a, c, soffit, null, M);
    }
  }
  // fascia boards along the eaves
  kit.add(new THREE.BoxGeometry(W * 2, 0.18, 0.05), '#ffffff', { y: h - 0.04, z: D, parent: M });
  kit.add(new THREE.BoxGeometry(W * 2, 0.18, 0.05), '#ffffff', { y: h - 0.04, z: -D, parent: M });
  if (hip) for (const s of [-1, 1]) kit.add(new THREE.BoxGeometry(0.05, 0.18, D * 2), '#ffffff', { x: s * W, y: h - 0.04, parent: M });
  return top;
}

function addWindow(kit, M, x, y, z, w, h, tileName, { sill = '#ffffff', roster = true, side = 0 } = {}) {
  const ry = side ? side * Math.PI / 2 : 0;
  const P0 = side ? new THREE.Matrix4().multiplyMatrices(M, new THREE.Matrix4().makeRotationY(ry)) : M;
  kit.add(new THREE.PlaneGeometry(w, h), '#ffffff', { x, y, z: z + 0.02, parent: P0 }, tileName);
  kit.add(new THREE.BoxGeometry(w + 0.16, 0.07, 0.16), sill, { x, y: y - h / 2 - 0.03, z: z + 0.06, parent: P0 });
  kit.add(new THREE.PlaneGeometry(w + 0.12, 0.08), sill, { x, y: y + h / 2 + 0.04, z: z + 0.03, parent: P0 });
  if (roster) kit.add(new THREE.PlaneGeometry(w, 0.24), '#ffffff', { x, y: y + h / 2 + 0.25, z: z + 0.02, parent: P0 }, 'roster');
}

function addScooter(kit, M, x, z, ry, color) {
  const P0 = new THREE.Matrix4().multiplyMatrices(M, new THREE.Matrix4().compose(new THREE.Vector3(x, 0, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(0, ry, 0)), new THREE.Vector3(1, 1, 1)));
  for (const zz of [-0.62, 0.62]) {
    kit.add(new THREE.CylinderGeometry(0.24, 0.24, 0.1, 8), '#1d1f22', { y: 0.24, z: zz, rz: Math.PI / 2, parent: P0 });
    kit.add(new THREE.CylinderGeometry(0.12, 0.12, 0.11, 6), '#bfc6cb', { y: 0.24, z: zz, rz: Math.PI / 2, parent: P0 });
  }
  kit.add(new THREE.BoxGeometry(0.3, 0.35, 0.9), color, { y: 0.52, z: -0.25, parent: P0 }); // rear body
  kit.add(new THREE.BoxGeometry(0.3, 0.1, 0.65), '#2b2b30', { y: 0.74, z: -0.25, parent: P0 }); // seat
  kit.add(new THREE.BoxGeometry(0.32, 0.12, 0.5), '#3a3f44', { y: 0.32, z: 0.2, parent: P0 }); // footboard
  kit.add(new THREE.BoxGeometry(0.3, 0.7, 0.12), color, { y: 0.66, z: 0.5, rx: -0.25, parent: P0 }); // front shield
  kit.add(new THREE.CylinderGeometry(0.025, 0.025, 0.6, 6), '#2b2b30', { y: 1.02, z: 0.62, rz: Math.PI / 2, parent: P0 }); // handlebar
  kit.add(new THREE.BoxGeometry(0.14, 0.08, 0.06), '#fff6d0', { y: 0.92, z: 0.66, parent: P0 }); // headlight
  kit.add(new THREE.BoxGeometry(0.1, 0.05, 0.04), '#d61f2c', { y: 0.6, z: -0.71, parent: P0 }); // tail light
}

function addFence(kit, M, x0, x1, z, color, gap = null) {
  const len = x1 - x0;
  const posts = Math.max(2, Math.round(len / 2.2) + 1);
  for (let i = 0; i < posts; i++) {
    const x = x0 + (len * i) / (posts - 1);
    kit.add(new THREE.BoxGeometry(0.3, 1.45, 0.3), color, { x, y: 0.72, z, parent: M }, 'plaster');
    kit.add(new THREE.BoxGeometry(0.38, 0.08, 0.38), '#ffffff', { x, y: 1.48, z, parent: M });
  }
  const segs = gap ? [[x0, gap[0]], [gap[1], x1]] : [[x0, x1]];
  for (const [a, b] of segs) {
    const l = b - a;
    if (l < 0.2) continue;
    kit.add(new THREE.BoxGeometry(l, 0.6, 0.2), color, { x: (a + b) / 2, y: 0.3, z, parent: M }, 'brick');
    kit.add(new THREE.BoxGeometry(l, 0.05, 0.05), '#2f3a3f', { x: (a + b) / 2, y: 1.32, z, parent: M });
    const bars = Math.floor(l / 0.2);
    for (let i = 1; i < bars; i++) kit.add(BAR, '#2f3a3f', { x: a + i * (l / bars), y: 0.96, z: z + 0.012, sy: 0.72, parent: M });
  }
  if (gap) {
    // the sliding gate, half open
    const gw = gap[1] - gap[0];
    kit.add(new THREE.BoxGeometry(gw * 0.6, 0.05, 0.05), '#2f3a3f', { x: gap[0] + gw * 0.3, y: 1.3, z: z - 0.15, parent: M });
    kit.add(new THREE.BoxGeometry(gw * 0.6, 0.05, 0.05), '#2f3a3f', { x: gap[0] + gw * 0.3, y: 0.08, z: z - 0.15, parent: M });
    const n = Math.floor(gw * 0.6 / 0.13);
    for (let i = 0; i <= n; i++) kit.add(BAR, '#2f3a3f', { x: gap[0] + i * 0.13, y: 0.69, z: z - 0.15, sy: 1.22, parent: M });
  }
}

function addHouse(kit, M, w, d, yard, wall, roof, rand) {
  const h = 3.1 + rand() * 0.5;
  // plinth and walls
  kit.add(new THREE.BoxGeometry(w + 0.16, 0.32, d + 0.16), '#c9c1b2', { y: 0.16, parent: M });
  kit.add(new THREE.BoxGeometry(w, h - 0.3, d), wall, { y: 0.3 + (h - 0.3) / 2, parent: M }, 'plaster');
  // a darker skirting band
  kit.add(new THREE.BoxGeometry(w + 0.04, 0.45, d + 0.04), '#9aa0a3', { y: 0.55, parent: M }, 'plaster');
  const hip = rand() < 0.62;
  addRoof(kit, M, w, d, h, roof, { hip, gableWall: wall, overhang: 0.7, pitch: hip ? 0.6 : 0.55 });
  // terrace: tiled floor, two columns, the front door
  const tw = Math.min(w * 0.55, 4.2);
  const tx = -w / 2 + tw / 2 + 0.3;
  kit.add(new THREE.BoxGeometry(tw, 0.36, 1.9), '#ffffff', { x: tx, y: 0.18, z: d / 2 + 0.95, parent: M }, 'terrace');
  for (const k of [0.3, 1]) kit.add(new THREE.BoxGeometry(0.4, 0.17, 0.32), '#c9c1b2', { x: tx, y: 0.085, z: d / 2 + 1.9 + k * 0.32, parent: M }); // steps
  for (const x of [tx - tw / 2 + 0.18, tx + tw / 2 - 0.18]) {
    kit.add(new THREE.BoxGeometry(0.24, h - 0.36, 0.24), '#ffffff', { x, y: 0.36 + (h - 0.36) / 2, z: d / 2 + 1.72, parent: M });
    kit.add(new THREE.BoxGeometry(0.34, 0.14, 0.34), '#e7e1d6', { x, y: 0.43, z: d / 2 + 1.72, parent: M });
  }
  // the roof overhang reaches the terrace: a small flat canopy fills the gap
  kit.add(new THREE.BoxGeometry(tw + 0.2, 0.12, 1.4), '#ffffff', { x: tx, y: h - 0.06, z: d / 2 + 1.5, parent: M });
  kit.add(new THREE.BoxGeometry(tw + 0.2, 0.06, 1.4), roof, { x: tx, y: h + 0.02, z: d / 2 + 1.5, rx: -0.05, parent: M }, 'roof');
  const doorX = tx + (rand() < 0.5 ? -0.6 : 0.6);
  kit.add(new THREE.BoxGeometry(1.12, 2.24, 0.06), '#ffffff', { x: doorX, y: 0.36 + 1.1, z: d / 2 + 0.01, parent: M });
  kit.add(new THREE.PlaneGeometry(0.95, 2.1), '#ffffff', { x: doorX, y: 0.36 + 1.05, z: d / 2 + 0.05, parent: M }, 'door');
  // windows: on the terrace and on the rest of the front, plus one on each side
  const wt = ['window', 'window2', 'windowWood'][Math.floor(rand() * 3)];
  const sill = wt === 'windowWood' ? '#7a4f2e' : '#ffffff';
  const fx = doorX < tx ? tx + 0.85 : tx - 0.85;
  addWindow(kit, M, fx, 1.75, d / 2, 0.95, 1.2, wt, { sill });
  for (let x = tx + tw / 2 + 0.9; x < w / 2 - 0.6; x += 1.7) addWindow(kit, M, x, 1.75, d / 2, 1.0, 1.25, wt, { sill });
  for (const s of [-1, 1]) addWindow(kit, M, 0, 1.75, w / 2, 1.0, 1.2, wt, { sill, side: s, roster: false });
  // plants on the terrace, an AC unit, sometimes a water tank tower or a scooter
  for (const x of [tx - tw / 2 + 0.5, tx + tw / 2 - 0.5]) {
    kit.add(new THREE.CylinderGeometry(0.2, 0.15, 0.36, 7), ['#c4704d', '#ffffff', '#3cc44c'][Math.floor(rand() * 3)], { x, y: 0.54, z: d / 2 + 1.35, parent: M });
    kit.add(new THREE.IcosahedronGeometry(0.32, 0), ['#4f9a3e', '#5fa84c', '#2f7a3a'][Math.floor(rand() * 3)], { x, y: 0.95, z: d / 2 + 1.35, sy: 0.9, parent: M }, 'leaves');
  }
  kit.add(new THREE.BoxGeometry(0.75, 0.5, 0.25), '#f4f4f4', { x: w / 2 - 1.0, y: 2.5, z: d / 2 + 0.13, parent: M });
  kit.add(new THREE.CylinderGeometry(0.17, 0.17, 0.02, 9), '#b8bfc4', { x: w / 2 - 1.0, y: 2.5, z: d / 2 + 0.26, rx: Math.PI / 2, parent: M });
  if (rand() < 0.35) {
    // water tank on a steel tower behind the house
    const tx2 = (rand() < 0.5 ? -1 : 1) * (w / 2 - 1);
    for (const [a, b] of [[-0.45, -0.45], [0.45, -0.45], [-0.45, 0.45], [0.45, 0.45]]) kit.add(new THREE.BoxGeometry(0.07, 4.6, 0.07), '#6b7378', { x: tx2 + a, y: 2.3, z: -d / 2 - 0.8 + b, parent: M });
    kit.add(new THREE.BoxGeometry(1.1, 0.08, 1.1), '#6b7378', { x: tx2, y: 4.6, z: -d / 2 - 0.8, parent: M });
    const tc = rand() < 0.5 ? '#2f6fd6' : '#ff8a1f';
    kit.add(new THREE.CylinderGeometry(0.5, 0.5, 1.0, 9), tc, { x: tx2, y: 5.15, z: -d / 2 - 0.8, parent: M });
    kit.add(new THREE.SphereGeometry(0.5, 9, 3, 0, Math.PI * 2, 0, Math.PI / 2), tc, { x: tx2, y: 5.65, z: -d / 2 - 0.8, sy: 0.35, parent: M });
  }
  if (rand() < 0.3) addScooter(kit, M, tx + tw / 2 + 0.6, d / 2 + 1.2, Math.PI / 2 + (rand() - 0.5) * 0.4, ['#e8545c', '#ffffff', '#1d2a33', '#4a9be8', '#ec6db0'][Math.floor(rand() * 5)]);
  // front yard: lawn, path, fence with a sliding gate
  kit.add(new THREE.BoxGeometry(w + 1.4, 0.04, yard - 0.1), '#7fb85a', { y: 0.02, z: d / 2 + yard / 2, parent: M });
  kit.add(new THREE.BoxGeometry(1.4, 0.06, yard - 1.9), '#d9d2c4', { x: tx, y: 0.03, z: d / 2 + 1.9 + (yard - 1.9) / 2, parent: M }, 'terrace');
  const fz = d / 2 + yard - 0.2;
  const fenceCol = ['#ffffff', '#f6efe4', '#e8eef2', wall][Math.floor(rand() * 4)];
  addFence(kit, M, -w / 2 - 0.7, w / 2 + 0.7, fz, fenceCol, [tx - 1.2, tx + 1.2]);
}

function addShophouse(kit, M, w, d, yard, rand) {
  // ruko: a row of 2-3 storey shop units, rolling doors or open shops below, signs, awnings,
  // balconies and AC units above, a parapet and water tanks on the flat roof
  const units = Math.max(2, Math.round(w / 3.8));
  const uw = w / units;
  const floors = rand() < 0.35 ? 3 : 2;
  const fh = 3.4;
  const h = floors * fh + 0.6;
  const cols = ['#fff1c1', '#d6ecff', '#ffd9e6', '#d8f3dc', '#ffffff', '#fde2cf', '#e9dcff', '#f2e8da'];
  const z0 = d / 2;
  for (let i = 0; i < units; i++) {
    const x = -w / 2 + uw * (i + 0.5);
    const col = cols[Math.floor(rand() * cols.length)];
    kit.add(new THREE.BoxGeometry(uw - 0.02, h, d), col, { x, y: h / 2, parent: M }, 'plaster');
    // pilasters between units
    kit.add(new THREE.BoxGeometry(0.3, h, 0.2), '#ffffff', { x: x - uw / 2 + 0.15, y: h / 2, z: z0 + 0.1, parent: M });
    // ground floor: open shop or rolling door
    const open = rand() < 0.6;
    kit.add(new THREE.PlaneGeometry(uw - 0.5, 2.7), '#ffffff', { x, y: 1.5, z: z0 + 0.02, parent: M }, open ? 'shop' : 'shutter');
    kit.add(new THREE.BoxGeometry(uw - 0.3, 0.15, 0.25), '#d9d2c4', { x, y: 0.075, z: z0 + 0.3, parent: M });
    // the sign board above the shop
    const si = Math.floor(rand() * SIGNS.length);
    kit.add(new THREE.BoxGeometry(uw - 0.3, 0.85, 0.12), '#2b2f33', { x, y: 3.35, z: z0 + 0.12, parent: M });
    kit.add(new THREE.PlaneGeometry(uw - 0.4, 0.75), '#ffffff', { x, y: 3.35, z: z0 + 0.19, parent: M }, `sign${si}`);
    // awning over the shop front
    kit.add(new THREE.BoxGeometry(uw - 0.2, 0.04, 1.5), '#ffffff', { x, y: 2.85, z: z0 + 0.75, rx: 0.32, parent: M }, `awning${Math.floor(rand() * 5)}`);
    // upper floors: windows (glass or framed), a little balcony on the first floor, AC units
    for (let f = 1; f < floors; f++) {
      const y = f * fh + 1.6;
      const glass = rand() < 0.5;
      if (glass) kit.add(new THREE.PlaneGeometry(uw - 0.9, 1.5), '#ffffff', { x, y, z: z0 + 0.02, parent: M }, 'glass');
      else for (const k of [-1, 1]) addWindow(kit, M, x + k * uw * 0.22, y, z0, uw * 0.32, 1.35, 'window2', { roster: k > 0 });
      if (f === 1) {
        kit.add(new THREE.BoxGeometry(uw - 0.4, 0.12, 0.8), '#ffffff', { x, y: f * fh + 0.4, z: z0 + 0.4, parent: M });
        kit.add(new THREE.BoxGeometry(uw - 0.4, 0.06, 0.06), '#2f3a3f', { x, y: f * fh + 1.35, z: z0 + 0.78, parent: M });
        for (let k = 0; k <= 10; k++) kit.add(BAR, '#2f3a3f', { x: x - (uw - 0.4) / 2 + k * (uw - 0.4) / 10, y: f * fh + 0.9, z: z0 + 0.79, sy: 0.9, parent: M });
      }
      if (rand() < 0.6) {
        const ax = x + (rand() < 0.5 ? -1 : 1) * (uw / 2 - 0.65);
        kit.add(new THREE.BoxGeometry(0.75, 0.5, 0.28), '#f4f4f4', { x: ax, y: f * fh + 2.65, z: z0 + 0.15, parent: M });
        kit.add(new THREE.CylinderGeometry(0.17, 0.17, 0.02, 9), '#b8bfc4', { x: ax, y: f * fh + 2.65, z: z0 + 0.3, rx: Math.PI / 2, parent: M });
      }
    }
    // parapet with a decorative cornice, a water tank on some roofs
    kit.add(new THREE.BoxGeometry(uw, 0.8, 0.2), col, { x, y: h + 0.4, z: z0 - 0.1, parent: M }, 'plaster');
    kit.add(new THREE.BoxGeometry(uw + 0.02, 0.12, 0.3), '#ffffff', { x, y: h + 0.82, z: z0 - 0.1, parent: M });
    kit.add(new THREE.BoxGeometry(uw + 0.02, 0.1, 0.32), '#ffffff', { x, y: h - 0.3, z: z0 + 0.02, parent: M });
    if (rand() < 0.4) {
      const tc = rand() < 0.5 ? '#2f6fd6' : '#ff8a1f';
      kit.add(new THREE.CylinderGeometry(0.55, 0.55, 1.1, 9), tc, { x: x + 0.3, y: h + 0.6, z: -d / 4, parent: M });
      kit.add(new THREE.SphereGeometry(0.55, 9, 3, 0, Math.PI * 2, 0, Math.PI / 2), tc, { x: x + 0.3, y: h + 1.15, z: -d / 4, sy: 0.35, parent: M });
    }
  }
  kit.add(new THREE.BoxGeometry(w, 0.1, d), '#bfbab0', { y: h + 0.02, parent: M });
  // a concrete forecourt with parked scooters
  kit.add(new THREE.BoxGeometry(w + 0.4, 0.1, yard), '#cfc8ba', { y: 0.05, z: z0 + yard / 2, parent: M });
  const n = Math.floor(rand() * 3);
  for (let k = 0; k < n; k++) addScooter(kit, M, -w / 2 + 1 + rand() * (w - 2), z0 + yard * 0.55, Math.PI + (rand() - 0.5) * 0.3, ['#e8545c', '#ffffff', '#1d2a33', '#4a9be8', '#ec6db0', '#3cc44c'][Math.floor(rand() * 6)]);
}

function addWarung(kit, M, rand) {
  // a little food stall: wooden hut, zinc roof, a big banner, the counter with jars of snacks,
  // hanging snack strips, a long bench and plastic stools
  const bi = Math.floor(rand() * BANNERS.length);
  kit.add(new THREE.BoxGeometry(3.8, 2.7, 2.6), '#ffffff', { y: 1.35, z: -1.4, parent: M }, 'wood');
  kit.add(new THREE.PlaneGeometry(1.5, 1.0), '#ffffff', { x: -0.9, y: 1.6, z: -0.09, parent: M }, 'shop');
  kit.add(new THREE.BoxGeometry(3.4, 1.0, 0.9), '#ffffff', { y: 0.5, z: 0.5, parent: M }, 'wood');
  kit.add(new THREE.BoxGeometry(3.5, 0.06, 1.0), '#e9e3d6', { y: 1.03, z: 0.5, parent: M });
  for (const x of [-1.85, 1.85]) for (const z of [1.45, -2.7]) kit.add(new THREE.CylinderGeometry(0.06, 0.06, 3.0, 7), '#7a5a3a', { x, y: 1.5, z, parent: M });
  // sloped zinc roof over the front
  kit.add(new THREE.BoxGeometry(4.3, 0.05, 4.6), '#ffffff', { y: 2.98, z: -0.6, rx: -0.12, parent: M }, 'zinc');
  // banner hanging from the roof edge
  kit.add(new THREE.PlaneGeometry(3.6, 0.9), '#ffffff', { y: 2.45, z: 1.5, parent: M }, `banner${bi}`);
  kit.add(new THREE.PlaneGeometry(3.6, 0.9), '#ffffff', { y: 2.45, z: 1.49, ry: Math.PI, parent: M }, `banner${bi}`);
  // jars and snack strips
  for (let k = 0; k < 5; k++) {
    kit.add(new THREE.CylinderGeometry(0.12, 0.12, 0.3, 6), '#dff3ff', { x: -1.2 + k * 0.6, y: 1.21, z: 0.45, parent: M });
    kit.add(new THREE.CylinderGeometry(0.125, 0.125, 0.06, 6), ['#e8545c', '#3cc44c', '#ffd23b', '#4a9be8'][k % 4], { x: -1.2 + k * 0.6, y: 1.38, z: 0.45, parent: M });
  }
  for (let k = 0; k < 9; k++) kit.add(new THREE.BoxGeometry(0.12, 0.9, 0.02), ['#ffd23b', '#e8545c', '#4a9be8', '#ec6db0', '#3cc44c'][k % 5], { x: -1.6 + k * 0.4, y: 1.95, z: 1.2, parent: M });
  kit.add(new THREE.BoxGeometry(3.6, 0.04, 0.04), '#5c4a3a', { y: 2.42, z: 1.2, parent: M });
  // bench and stools
  kit.add(new THREE.BoxGeometry(3.0, 0.07, 0.35), '#ffffff', { y: 0.45, z: 1.6, parent: M }, 'wood');
  for (const x of [-1.3, 1.3]) kit.add(new THREE.BoxGeometry(0.07, 0.45, 0.3), '#7a5a3a', { x, y: 0.22, z: 1.6, parent: M });
  for (let k = 0; k < 3; k++) {
    const x = -1.6 + k * 1.4 + rand() * 0.3;
    kit.add(new THREE.CylinderGeometry(0.17, 0.14, 0.42, 7), ['#e8545c', '#4a9be8', '#3cc44c', '#ffd23b'][Math.floor(rand() * 4)], { x, y: 0.21, z: 2.4 + rand() * 0.3, parent: M });
  }
}

function addGerobak(kit, M, rand) {
  // a push cart (bakso / es) with a glass case and two bicycle wheels
  const col = ['#e8545c', '#3cc44c', '#4a9be8', '#ffd23b'][Math.floor(rand() * 4)];
  kit.add(new THREE.BoxGeometry(1.4, 0.75, 0.65), col, { y: 0.8, parent: M });
  kit.add(new THREE.BoxGeometry(1.3, 0.5, 0.6), '#dff3ff', { y: 1.42, parent: M }, 'glass');
  kit.add(new THREE.BoxGeometry(1.5, 0.05, 0.75), '#ffffff', { y: 1.7, parent: M });
  for (const x of [-0.72, 0.72]) kit.add(new THREE.CylinderGeometry(0.03, 0.03, 1.3, 6), '#cfd6db', { x, y: 2.3, parent: M });
  kit.add(new THREE.BoxGeometry(1.6, 0.04, 0.9), col, { y: 2.95, parent: M }, 'awning2');
  for (const z of [-0.36, 0.36]) {
    kit.add(new THREE.CylinderGeometry(0.33, 0.33, 0.05, 10), '#1d1f22', { x: 0.2, y: 0.33, z, rx: Math.PI / 2, parent: M });
    kit.add(new THREE.CylinderGeometry(0.1, 0.1, 0.06, 8), '#cfd6db', { x: 0.2, y: 0.33, z, rx: Math.PI / 2, parent: M });
  }
  kit.add(new THREE.BoxGeometry(0.06, 0.6, 0.06), '#5c4a3a', { x: -0.68, y: 0.3, parent: M });
  kit.add(new THREE.CylinderGeometry(0.03, 0.03, 0.8, 6), '#5c4a3a', { x: -0.95, y: 1.0, rx: Math.PI / 2, parent: M });
}

function addBin(kit, M, rand) {
  // a pair of recycling bins (organik / anorganik)
  for (const [x, c] of [[-0.3, '#3cc44c'], [0.3, '#ffd23b']]) {
    kit.add(new THREE.CylinderGeometry(0.24, 0.21, 0.75, 9), c, { x, y: 0.55, parent: M });
    kit.add(new THREE.CylinderGeometry(0.26, 0.26, 0.06, 9), '#ffffff', { x, y: 0.95, parent: M });
  }
  kit.add(new THREE.CylinderGeometry(0.04, 0.04, 1.0, 6), '#5c6670', { y: 0.5, parent: M });
  void rand;
}

function addBench(kit, M) {
  kit.add(new THREE.BoxGeometry(1.8, 0.06, 0.45), '#ffffff', { y: 0.46, parent: M }, 'wood');
  kit.add(new THREE.BoxGeometry(1.8, 0.4, 0.05), '#ffffff', { y: 0.75, z: -0.22, rx: -0.12, parent: M }, 'wood');
  for (const x of [-0.75, 0.75]) kit.add(new THREE.BoxGeometry(0.06, 0.46, 0.45), '#2f3a3f', { x, y: 0.23, parent: M });
}

function addShelter(kit, M) {
  // a modern halte: raised tiled platform, steel frame, curved green roof, glass back wall
  // with the route map, a bench and bins
  kit.add(new THREE.BoxGeometry(5.2, 0.14, 2.6), '#ffffff', { y: 0.07, parent: M }, 'terrace');
  kit.add(new THREE.BoxGeometry(5.2, 0.02, 0.25), '#ffd23b', { y: 0.15, z: 1.15, parent: M }); // tactile edge
  for (const x of [-2.3, 0, 2.3]) {
    kit.add(new THREE.BoxGeometry(0.1, 2.75, 0.1), '#3c4a52', { x, y: 1.44, z: -1.05, parent: M });
    kit.add(new THREE.BoxGeometry(0.08, 2.6, 0.08), '#3c4a52', { x, y: 1.36, z: 1.0, parent: M });
  }
  // curved roof: 6 slats following an arc, plus fascia in FDC colours
  for (let k = 0; k < 6; k++) {
    const a = -0.5 + (k / 5) * 1.0;
    kit.add(new THREE.BoxGeometry(5.6, 0.06, 0.62), P.busGreen, { y: 2.78 + Math.cos(a) * 0.35 - 0.2, z: Math.sin(a) * 1.55, rx: a * 0.75, parent: M });
  }
  kit.add(new THREE.BoxGeometry(5.65, 0.18, 0.08), P.busPink, { y: 2.67, z: 1.4, parent: M });
  kit.add(new THREE.BoxGeometry(5.65, 0.18, 0.08), '#ffffff', { y: 2.67, z: -1.4, parent: M });
  // glass back wall and side panel
  kit.add(new THREE.BoxGeometry(4.5, 1.9, 0.04), '#cfe9f5', { y: 1.25, z: -1.05, parent: M }, 'glass');
  kit.add(new THREE.BoxGeometry(0.04, 1.9, 1.6), '#cfe9f5', { x: -2.3, y: 1.25, z: -0.2, parent: M }, 'glass');
  kit.add(new THREE.PlaneGeometry(0.75, 0.95), '#ffffff', { x: 1.6, y: 1.45, z: -1.02, parent: M }, 'routemap');
  kit.add(new THREE.PlaneGeometry(0.75, 0.95), '#ffffff', { x: -2.27, y: 1.45, z: -0.2, ry: Math.PI / 2, parent: M }, 'poster');
  // bench
  kit.add(new THREE.BoxGeometry(2.8, 0.07, 0.42), '#ffffff', { x: -0.4, y: 0.6, z: -0.65, parent: M }, 'wood');
  for (const x of [-1.6, 0.8]) kit.add(new THREE.BoxGeometry(0.06, 0.45, 0.38), '#3c4a52', { x, y: 0.36, z: -0.65, parent: M });
  addBin(kit, new THREE.Matrix4().multiplyMatrices(M, new THREE.Matrix4().makeTranslation(2.7, 0, -0.6)));
  // the sign post
  kit.add(new THREE.CylinderGeometry(0.05, 0.05, 3.0, 8), '#3c4a52', { x: 2.6, y: 1.5, z: 1.0, parent: M });
}

function buildClinic(group, kit, route, s, rand, updaters, people) {
  const c = route.at(s + 4, WALK + 13);
  const yaw = faceRoad(c); // front faces the road
  const M = new THREE.Matrix4().compose(new THREE.Vector3(c.x, 0, c.z), new THREE.Quaternion().setFromEuler(new THREE.Euler(0, yaw, 0)), new THREE.Vector3(1, 1, 1));
  // forecourt, parking bays, planters
  kit.add(new THREE.BoxGeometry(24, 0.1, 11.4), '#d9d3c7', { y: 0.05, z: 6.4, parent: M });
  for (let x = -11.5; x <= 11.5; x += 1.5) kit.add(new THREE.BoxGeometry(0.04, 0.01, 11.4), '#c4bdb0', { x, y: 0.105, z: 6.4, parent: M }); // paving joints
  for (let k = -3; k <= 3; k++) if (Math.abs(k) > 1) kit.add(new THREE.BoxGeometry(0.1, 0.02, 4), '#ffffff', { x: k * 2.8, y: 0.11, z: 10, parent: M });
  for (const x of [-10.5, 10.5]) {
    kit.add(new THREE.BoxGeometry(2.6, 0.55, 1.2), '#ffffff', { x, y: 0.28, z: 5.4, parent: M });
    kit.add(new THREE.BoxGeometry(2.4, 0.3, 1.0), '#5f9a49', { x, y: 0.7, z: 5.4, parent: M }, 'leaves');
  }
  // main building: white with glass storeys and pink / green accents
  kit.add(new THREE.BoxGeometry(18, 7.6, 9), '#ffffff', { y: 3.8, parent: M }, 'plaster');
  kit.add(new THREE.PlaneGeometry(14, 2.6), '#ffffff', { y: 1.55, z: 4.52, parent: M }, 'glass');
  kit.add(new THREE.PlaneGeometry(14, 2.2), '#ffffff', { y: 5.1, z: 4.52, parent: M }, 'glass');
  kit.add(new THREE.BoxGeometry(18.2, 0.35, 9.2), P.busGreen, { y: 3.15, parent: M });
  kit.add(new THREE.BoxGeometry(18.4, 0.4, 9.4), P.busPink, { y: 7.65, parent: M });
  kit.add(new THREE.BoxGeometry(18.6, 0.12, 9.6), '#ffffff', { y: 7.9, parent: M });
  // vertical fins on the facade
  for (let k = -4; k <= 4; k++) kit.add(new THREE.BoxGeometry(0.18, 7.2, 0.5), k % 2 ? '#ffffff' : P.busGreen, { x: k * 2.0, y: 3.8, z: 4.75, parent: M });
  // rooftop: AC units, a water tank
  for (const x of [-6, -4.5, 4.5]) kit.add(new THREE.BoxGeometry(1.1, 0.7, 0.8), '#e4e8eb', { x, y: 8.3, z: -2, parent: M });
  kit.add(new THREE.CylinderGeometry(0.8, 0.8, 1.4, 10), '#2f6fd6', { x: 6, y: 8.65, z: -2, parent: M });
  // entrance canopy with its own name board, columns, sliding glass doors
  kit.add(new THREE.BoxGeometry(6.2, 0.3, 3.4), '#ffffff', { y: 3.05, z: 6.2, parent: M });
  kit.add(new THREE.BoxGeometry(6.25, 0.08, 3.45), P.busGreen, { y: 2.87, z: 6.2, parent: M });
  kit.add(new THREE.PlaneGeometry(4.6, 0.7), '#ffffff', { y: 3.6, z: 7.85, parent: M }, 'clinicSign');
  kit.add(new THREE.BoxGeometry(4.8, 0.8, 0.12), '#ffffff', { y: 3.6, z: 7.78, parent: M });
  for (const x of [-2.7, 2.7]) kit.add(new THREE.CylinderGeometry(0.14, 0.14, 2.9, 12), '#ffffff', { x, y: 1.45, z: 7.6, parent: M });
  kit.add(new THREE.PlaneGeometry(2.6, 2.4), '#ffffff', { y: 1.3, z: 4.55, parent: M }, 'glass');
  kit.add(new THREE.PlaneGeometry(0.75, 0.95), '#ffffff', { x: 3.6, y: 1.5, z: 4.56, parent: M }, 'poster');
  // flag poles by the entrance
  for (const x of [-9.5, -8.6]) kit.add(new THREE.CylinderGeometry(0.04, 0.05, 6, 6), '#cfd6db', { x, y: 3, z: 8.5, parent: M });
  kit.add(new THREE.BoxGeometry(0.02, 0.6, 0.9), '#e8302c', { x: -9.5, y: 5.65, z: 8.95, parent: M });
  kit.add(new THREE.BoxGeometry(0.02, 0.6, 0.9), '#ffffff', { x: -9.5, y: 5.05, z: 8.95, parent: M });
  kit.add(new THREE.BoxGeometry(0.02, 0.9, 1.3), P.busGreen, { x: -8.6, y: 5.5, z: 9.15, parent: M });
  // benches for patients outside
  for (const x of [-5.5, 5.5]) addBench(kit, new THREE.Matrix4().multiplyMatrices(M, new THREE.Matrix4().makeTranslation(x, 0.1, 5.4)));
  // the big sign on the roof edge
  const sign = makePanel(9, 2.2, (cx, W, H) => {
    roundRect(cx, 6, 6, W - 12, H - 12, H * 0.2);
    cx.fillStyle = '#ffffff'; cx.fill();
    cx.lineWidth = H * 0.05; cx.strokeStyle = P.busGreen; cx.stroke();
    drawLogo(cx, W * 0.06, H * 0.12, H * 0.62, { green: P.busGreen });
    text(cx, 'Dental Clinic', W * 0.06, H * 0.92, { size: H * 0.2, weight: 800, color: P.mintDark });
    text(cx, 'Be The Reason Someone Smiles', W * 0.5, H * 0.92, { size: H * 0.13, weight: 700, color: P.busPink });
  }, { ppm: 120 });
  const sp = new THREE.Vector3(0, 9.3, 4.0).applyMatrix4(M);
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
    people.push(p);
  }
  updaters.push((dt, t) => { for (const p of crowd) animatePerson(p, t, p.userData.cheer || p.userData.hopUntil > t ? 'hop' : 'idle', p.userData.phase); });
  group.userData.crowd = crowd;
  group.userData.clinicDoor = new THREE.Vector3(0, 0.1, 7).applyMatrix4(M);
  group.userData.clinicM = M;
}

// =================================================================== poles and wires
function utilityPoles(kit, route, busy) {
  const tops = [];
  for (let s = 8; s < route.length; s += 36) {
    if (busy(s, 5)) continue;
    const p = route.at(s, -(WALK + 0.2), {});
    kit.add(new THREE.CylinderGeometry(0.1, 0.16, 8.4, 8), '#a8a49c', { x: p.x, y: 4.2, z: p.z });
    // cross arm with insulators
    const ry = p.yaw + Math.PI / 2;
    kit.add(new THREE.BoxGeometry(1.6, 0.1, 0.1), '#6b6f73', { x: p.x, y: 7.9, z: p.z, ry });
    const pts = [];
    for (const k of [-0.65, 0, 0.65]) {
      const x = p.x + p.nx * k;
      const z = p.z + p.nz * k;
      kit.add(new THREE.CylinderGeometry(0.04, 0.05, 0.14, 6), '#e9eef1', { x, y: 8.02, z });
      pts.push(new THREE.Vector3(x, 8.08, z));
    }
    // a transformer on some poles
    if (Math.floor(s / 36) % 4 === 1) {
      kit.add(new THREE.CylinderGeometry(0.32, 0.32, 0.9, 12), '#8d969b', { x: p.x - p.nx * 0.42, y: 6.6, z: p.z - p.nz * 0.42 });
      kit.add(new THREE.BoxGeometry(0.1, 0.1, 0.5), '#6b6f73', { x: p.x - p.nx * 0.2, y: 6.8, z: p.z - p.nz * 0.2, ry: p.yaw });
    }
    tops.push(pts);
  }
  // sagging wires between neighbours
  const seg = new THREE.CylinderGeometry(0.014, 0.014, 1, 3, 1, true).rotateX(Math.PI / 2);
  for (let i = 0; i < tops.length; i++) {
    const A = tops[i];
    const B = tops[(i + 1) % tops.length];
    if (A[0].distanceTo(B[0]) > 80) continue;
    for (let w = 0; w < 3; w++) {
      const a = A[w];
      const b = B[w];
      const n = 6;
      let prev = a;
      for (let k = 1; k <= n; k++) {
        const t = k / n;
        const p = new THREE.Vector3().lerpVectors(a, b, t);
        p.y -= 0.9 * 4 * t * (1 - t);
        const mid = prev.clone().add(p).multiplyScalar(0.5);
        const len = prev.distanceTo(p);
        const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, 1), p.clone().sub(prev).normalize());
        const e = new THREE.Euler().setFromQuaternion(q);
        kit.add(seg, '#23272b', { x: mid.x, y: mid.y, z: mid.z, rx: e.x, ry: e.y, rz: e.z, sz: len });
        prev = p;
      }
    }
  }
}

// =================================================================== instanced nature + props
/** Darken the underside and the inside of a crown so the leaves read as volume. */
function shadeVertices(geo, base = 0.62, jitter = 0.2, rand = Math.random) {
  const pos = geo.attributes.position;
  const nor = geo.attributes.normal;
  const col = new Float32Array(pos.count * 3);
  geo.computeBoundingBox();
  const bb = geo.boundingBox;
  for (let i = 0; i < pos.count; i++) {
    const y = (pos.getY(i) - bb.min.y) / Math.max(0.01, bb.max.y - bb.min.y);
    const up = nor ? nor.getY(i) : 0;
    const v = THREE.MathUtils.clamp(base + y * 0.35 + up * 0.12 + (rand() - 0.5) * jitter, 0.35, 1.15);
    col.set([v, v, v], i * 3);
  }
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  return geo;
}

function crownGeo(blobs, rand, detail = 1) {
  const list = blobs.map(([x, y, z, r, sy = 1]) => {
    const g = new THREE.IcosahedronGeometry(r, detail);
    const p = g.attributes.position;
    for (let i = 0; i < p.count; i++) {
      const k = 1 + (rand() - 0.5) * 0.22;
      p.setXYZ(i, p.getX(i) * k, p.getY(i) * k * sy, p.getZ(i) * k);
    }
    g.translate(x, y, z);
    return g.index ? g.toNonIndexed() : g;
  });
  const g = mergeList(list);
  return shadeVertices(g, 0.6, 0.25, rand);
}

function shadeTrees(spots, rand) {
  // two kinds: a round mango-like tree and a layered ketapang; trees far from the road get
  // lower-poly crowns (they're small and hazy there). All instanced.
  const groups = {};
  spots.forEach((sp, i) => { const key = `${i % 3 === 0 ? 1 : 0}${sp[3] ? 'f' : 'n'}`; (groups[key] ??= []).push(sp); });
  const out = [];
  const trunkMat = new THREE.MeshStandardMaterial({ color: '#7a5a3a', roughness: 1, flatShading: true });
  const crownMat = new THREE.MeshStandardMaterial({ roughness: 0.9, flatShading: true, vertexColors: true });
  const greens = ['#5f9a49', '#6fae52', '#4f8a3e', '#7fbf5a', '#5fa84c', '#689f45', '#f4b6c8', '#ffc6d9', '#f7c95e'];
  const trunks = [
    mergeList([
      new THREE.CylinderGeometry(0.16, 0.28, 2.6, 6).translate(0, 1.3, 0).toNonIndexed(),
      new THREE.CylinderGeometry(0.07, 0.12, 1.5, 4).rotateZ(0.7).translate(0.45, 2.6, 0).toNonIndexed(),
      new THREE.CylinderGeometry(0.06, 0.11, 1.4, 4).rotateZ(-0.6).rotateY(1.3).translate(-0.2, 2.7, 0.35).toNonIndexed(),
    ]),
    new THREE.CylinderGeometry(0.14, 0.24, 4.4, 6).translate(0, 2.2, 0),
  ];
  const blobs = [
    [[0, 3.7, 0, 1.6, 0.85], [1.0, 3.4, 0.3, 1.15], [-0.9, 3.5, -0.4, 1.2], [0.1, 4.4, -0.2, 1.15]],
    [[0, 2.7, 0, 2.6, 0.24], [0.3, 3.5, 0.2, 2.1, 0.26], [-0.2, 4.25, -0.1, 1.5, 0.3], [0.1, 4.85, 0, 0.8, 0.45]],
  ];
  for (const [key, list] of Object.entries(groups)) {
    const ki = +key[0];
    const far = key[1] === 'f';
    const n = list.length;
    const trunk = new THREE.InstancedMesh(trunks[ki], trunkMat, n);
    const crown = new THREE.InstancedMesh(crownGeo(blobs[ki], rand, far ? 0 : 1), crownMat, n);
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const c = new THREE.Color();
    list.forEach(([x, z, k], i) => {
      q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), rand() * 6.28);
      m.compose(new THREE.Vector3(x, 0, z), q, new THREE.Vector3(k, k * (0.9 + rand() * 0.3), k));
      trunk.setMatrixAt(i, m);
      crown.setMatrixAt(i, m);
      crown.setColorAt(i, c.set(greens[Math.floor(rand() * (ki ? 6 : greens.length))]));
    });
    crown.instanceColor.needsUpdate = true;
    out.push(trunk, crown);
  }
  return out;
}

function palms(spots, rand) {
  const n = spots.length;
  // a gently curved trunk with growth rings
  const trunkGeo = new THREE.CylinderGeometry(0.12, 0.2, 6, 6, 7, true);
  const tp = trunkGeo.attributes.position;
  const tc = new Float32Array(tp.count * 3);
  for (let i = 0; i < tp.count; i++) {
    const y = tp.getY(i) + 3;
    tp.setX(i, tp.getX(i) + (y / 6) ** 2 * 0.8);
    tp.setY(i, y);
    const ring = (Math.round(y / 0.86) % 2) ? 0.82 : 1;
    tc.set([ring, ring, ring], i * 3);
  }
  trunkGeo.setAttribute('color', new THREE.BufferAttribute(tc, 3));
  trunkGeo.computeVertexNormals();
  const trunk = new THREE.InstancedMesh(trunkGeo, new THREE.MeshStandardMaterial({ color: '#a2825c', roughness: 1, vertexColors: true }), n);
  // fronds: a curved spine with leaflets on both sides (feathery), 9 per crown, plus coconuts
  const parts = [];
  const fronds = 9;
  for (let k = 0; k < fronds; k++) {
    const pos = [];
    const seg = 7;
    const len = 3.1 + (k % 3) * 0.25;
    const lift = 0.45 + (k % 2) * 0.25;
    const pt = (t) => new THREE.Vector3(t * len, Math.sin(t * Math.PI * 0.6) * lift * 1.3 - t * t * 1.6, 0);
    for (let i = 0; i < seg; i++) {
      const t0 = i / seg;
      const t1 = (i + 1) / seg;
      const a = pt(t0);
      const b = pt(t1);
      const w = Math.sin(Math.PI * (0.15 + t0 * 0.85)) * 0.55 + 0.05;
      for (const s of [-1, 1]) {
        // a leaflet: thin triangle angled down from the spine
        const tipP = a.clone().lerp(b, 0.5).add(new THREE.Vector3(0.12, -w * 0.45, s * w));
        pos.push(a.x, a.y, a.z, b.x, b.y, b.z, tipP.x, tipP.y, tipP.z);
        pos.push(b.x, b.y, b.z, a.x, a.y, a.z, tipP.x, tipP.y, tipP.z);
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.rotateY((k / fronds) * Math.PI * 2 + (k % 2) * 0.2);
    g.translate(0.8, 6.0, 0);
    parts.push(g);
  }
  const fr = mergeList(parts);
  shadeVertices(fr, 0.75, 0.25, rand);
  const nuts = [];
  for (let k = 0; k < 4; k++) nuts.push(new THREE.IcosahedronGeometry(0.16, 0).translate(0.8 + Math.cos(k * 1.6) * 0.2, 5.75, Math.sin(k * 1.6) * 0.2));
  const nutGeo = mergeList(nuts);
  const crown = new THREE.InstancedMesh(fr, new THREE.MeshStandardMaterial({ roughness: 0.85, side: THREE.DoubleSide, vertexColors: true }), n);
  const nutMesh = new THREE.InstancedMesh(nutGeo, new THREE.MeshStandardMaterial({ color: '#7a6a2e', roughness: 0.8, flatShading: true }), n);
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const c = new THREE.Color();
  spots.forEach(([x, z, k], i) => {
    q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), rand() * 6.28);
    m.compose(new THREE.Vector3(x, 0, z), q, new THREE.Vector3(k, k, k));
    trunk.setMatrixAt(i, m);
    crown.setMatrixAt(i, m);
    nutMesh.setMatrixAt(i, m);
    crown.setColorAt(i, c.set(['#4f9a3e', '#5aa848', '#468c37', '#6aa84a'][i % 4]));
  });
  crown.instanceColor.needsUpdate = true;
  return [trunk, crown, nutMesh];
}

function bananas(spots, rand) {
  // pisang: a fat green stem and big paddle leaves arching out
  const parts = [shadeVertices(new THREE.CylinderGeometry(0.12, 0.16, 2.0, 7).translate(0, 1.0, 0).toNonIndexed(), 0.7, 0.1, rand)];
  for (let k = 0; k < 6; k++) {
    const pos = [];
    const seg = 4;
    const len = 1.8 + (k % 3) * 0.3;
    const pt = (t) => new THREE.Vector3(t * len, Math.sin(t * Math.PI * 0.7) * 0.8 - t * t * 0.9, 0);
    for (let i = 0; i < seg; i++) {
      const a = pt(i / seg);
      const b = pt((i + 1) / seg);
      const wa = Math.sin(Math.PI * Math.min(1, 0.12 + (i / seg))) * 0.38 + 0.04;
      const wb = Math.sin(Math.PI * Math.min(1, 0.12 + ((i + 1) / seg))) * 0.38 + 0.04;
      const q = [a.x, a.y - 0.05, -wa, b.x, b.y - 0.05, -wb, b.x, b.y, 0, a.x, a.y, 0];
      const r = [a.x, a.y, 0, b.x, b.y, 0, b.x, b.y - 0.05, wb, a.x, a.y - 0.05, wa];
      for (const s of [q, r]) pos.push(s[0], s[1], s[2], s[3], s[4], s[5], s[6], s[7], s[8], s[0], s[1], s[2], s[6], s[7], s[8], s[9], s[10], s[11]);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.rotateZ(0.2);
    g.rotateY((k / 6) * Math.PI * 2);
    g.translate(0, 1.85, 0);
    g.computeVertexNormals();
    parts.push(shadeVertices(g, 0.72, 0.18, rand));
  }
  const geo = mergeList(parts, true);
  const mesh = new THREE.InstancedMesh(geo, new THREE.MeshStandardMaterial({ color: '#7cc04e', roughness: 0.8, side: THREE.DoubleSide, vertexColors: true }), Math.max(1, spots.length));
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  spots.forEach(([x, z, k], i) => {
    q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), rand() * 6.28);
    m.compose(new THREE.Vector3(x, 0, z), q, new THREE.Vector3(k, k, k));
    mesh.setMatrixAt(i, m);
  });
  mesh.count = spots.length;
  return mesh;
}

function bushes(spots, rand) {
  const geo = crownGeo([[0, 0.45, 0, 0.55, 0.8], [0.45, 0.35, 0.1, 0.4], [-0.4, 0.38, -0.1, 0.42]], rand, 0);
  const mesh = new THREE.InstancedMesh(geo, new THREE.MeshStandardMaterial({ roughness: 0.9, flatShading: true, vertexColors: true }), Math.max(1, spots.length));
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const c = new THREE.Color();
  const cols = ['#4f8a3e', '#5f9a49', '#ec6db0', '#e8545c', '#5fa84c', '#ff9fc6', '#f7a531'];
  spots.forEach(([x, z, k], i) => {
    q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), rand() * 6.28);
    m.compose(new THREE.Vector3(x, 0, z), q, new THREE.Vector3(k * 1.6, k * 1.4, k * 1.6));
    mesh.setMatrixAt(i, m);
    mesh.setColorAt(i, c.set(cols[Math.floor(rand() * cols.length)]));
  });
  mesh.count = spots.length;
  if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  return mesh;
}

function treeShadows(spots) {
  const geo = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2);
  const mesh = new THREE.InstancedMesh(geo, new THREE.MeshBasicMaterial({ map: blobTexture(), transparent: true, depthWrite: false, opacity: 0.55, polygonOffset: true, polygonOffsetFactor: -2 }), spots.length);
  const m = new THREE.Matrix4();
  spots.forEach(([x, z, r], i) => { m.compose(new THREE.Vector3(x + r * 0.15, 0.05, z + r * 0.1), new THREE.Quaternion(), new THREE.Vector3(r, 1, r)); mesh.setMatrixAt(i, m); });
  mesh.renderOrder = 1;
  return mesh;
}

function mergeList(list, keepColor = false) {
  let count = 0;
  for (const g of list) count += g.attributes.position.count;
  const pos = new Float32Array(count * 3);
  const hasCol = list.every((g) => g.attributes.color);
  const col = hasCol ? new Float32Array(count * 3) : null;
  let o = 0;
  for (const g of list) {
    pos.set(g.attributes.position.array, o);
    if (col) col.set(g.attributes.color.array, o);
    o += g.attributes.position.array.length;
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  if (col) out.setAttribute('color', new THREE.BufferAttribute(col, 3));
  out.computeVertexNormals();
  void keepColor;
  return out;
}

function streetLamps(spots) {
  const n = spots.length;
  // a tapered pole that curves over the road at the top, and an LED head (merged, instanced)
  const parts = [new THREE.CylinderGeometry(0.06, 0.11, 6.2, 10).translate(0, 3.1, 0).toNonIndexed()];
  const arc = new THREE.TorusGeometry(0.6, 0.045, 6, 10, Math.PI / 2);
  arc.rotateY(-Math.PI / 2); // arc in the y-z plane
  arc.translate(0, 6.2, 0.6);
  parts.push(arc.toNonIndexed());
  parts.push(new THREE.CylinderGeometry(0.045, 0.045, 0.8, 6).rotateX(Math.PI / 2).translate(0, 6.8, 1.0).toNonIndexed());
  parts.push(new THREE.BoxGeometry(0.34, 0.1, 0.75).translate(0, 6.8, 1.6).toNonIndexed());
  parts.push(new THREE.CylinderGeometry(0.2, 0.24, 0.6, 10).translate(0, 0.3, 0).toNonIndexed());
  const geo = mergeList(parts);
  const pole = new THREE.InstancedMesh(geo, new THREE.MeshStandardMaterial({ color: '#56616a', roughness: 0.45, metalness: 0.3 }), n);
  const head = new THREE.InstancedMesh(new THREE.BoxGeometry(0.26, 0.02, 0.6).translate(0, 6.745, 1.6), new THREE.MeshBasicMaterial({ color: '#fff6d8', toneMapped: false }), n);
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  spots.forEach((p, i) => {
    // the arm reaches over the road (towards -left = right of the sidewalk)
    q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.atan2(-p.nx, -p.nz));
    m.compose(new THREE.Vector3(p.x, 0.16, p.z), q, new THREE.Vector3(1, 1, 1));
    pole.setMatrixAt(i, m);
    head.setMatrixAt(i, m);
  });
  return [pole, head];
}

function umbulUmbul(spots, rand) {
  const n = spots.length;
  const group = new THREE.Group();
  // bamboo pole that bends over at the top
  const poleGeo = new THREE.CylinderGeometry(0.04, 0.06, 7, 5, 8);
  const pp = poleGeo.attributes.position;
  for (let i = 0; i < pp.count; i++) { const y = pp.getY(i) + 3.5; pp.setY(i, y); pp.setZ(i, pp.getZ(i) + Math.max(0, y - 5) ** 2 * 0.35); }
  poleGeo.computeVertexNormals();
  const pole = new THREE.InstancedMesh(poleGeo, new THREE.MeshStandardMaterial({ color: '#c9a86a', roughness: 0.8 }), n);
  // the long cloth hanging from the bent top, fluttering in the wind (vertex shader), with a
  // white edge stripe and a pointed tail like real umbul-umbul
  const clothGeo = new THREE.PlaneGeometry(0.55, 3.6, 2, 12).translate(0, -1.8, 0);
  const cp = clothGeo.attributes.position;
  const cc = new Float32Array(cp.count * 3);
  for (let i = 0; i < cp.count; i++) {
    const x = cp.getX(i);
    const y = cp.getY(i);
    if (y < -3.3) cp.setY(i, y - (0.275 - Math.abs(x)) * 1.1); // pointed tail
    const edge = Math.abs(x) > 0.2 ? 1.6 : 1;
    cc.set([edge, edge, edge], i * 3);
  }
  clothGeo.setAttribute('color', new THREE.BufferAttribute(cc, 3));
  const cloth = new THREE.InstancedMesh(clothGeo, new THREE.MeshStandardMaterial({ side: THREE.DoubleSide, roughness: 0.7, emissive: '#333333', vertexColors: true }), n);
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
  const cols = [P.busPink, P.busGreen, '#ffb13b', '#4a9be8', '#ff6b6b', '#b38cf0', '#e8302c'];
  spots.forEach((p, i) => {
    // bend the top over the road
    q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), faceRoad(p, p.side));
    m.compose(new THREE.Vector3(p.x, 0.16, p.z), q, new THREE.Vector3(1, 1, 1));
    pole.setMatrixAt(i, m);
    const top = new THREE.Matrix4().makeTranslation(0, 6.6, 0.55);
    cloth.setMatrixAt(i, m.clone().multiply(top));
    cloth.setColorAt(i, c.set(cols[Math.floor(rand() * cols.length)]).multiplyScalar(0.62));
  });
  cloth.instanceColor.needsUpdate = true;
  group.add(pole, cloth);
  return { group, update(dt, t) { uniforms.uTime.value = t; } };
}

function clouds(rand) {
  // fluffy cumulus: clusters of round puffs, flat-ish bottoms, white tops and soft grey-blue bellies
  const puffs = [];
  for (let k = 0; k < 18; k++) {
    const a = rand() * Math.PI * 2;
    const r = 200 + rand() * 110;
    const cx = Math.cos(a) * r;
    const cz = Math.sin(a) * r;
    const cy = 60 + rand() * 35;
    const np = 4 + Math.floor(rand() * 4);
    const size = 7 + rand() * 6;
    for (let j = 0; j < np; j++) {
      const t = j / (np - 1) - 0.5;
      const s = size * (1 - Math.abs(t) * 0.8) * (0.8 + rand() * 0.4);
      puffs.push([cx + t * size * 4 * Math.cos(a + 1.57), cy + s * 0.35, cz + t * size * 4 * Math.sin(a + 1.57), s]);
    }
  }
  const geo = new THREE.IcosahedronGeometry(1, 1);
  const p = geo.attributes.position;
  const col = new Float32Array(p.count * 3);
  for (let i = 0; i < p.count; i++) {
    if (p.getY(i) < -0.3) p.setY(i, -0.3 - (p.getY(i) + 0.3) * 0.2); // flatten the belly
    const v = THREE.MathUtils.clamp(0.82 + p.getY(i) * 0.2, 0.74, 1);
    col.set([v * 0.97, v * 0.99, v], i * 3);
  }
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  const mesh = new THREE.InstancedMesh(geo, new THREE.MeshBasicMaterial({ vertexColors: true, fog: false }), puffs.length);
  const m = new THREE.Matrix4();
  puffs.forEach(([x, y, z, s], i) => { m.compose(new THREE.Vector3(x, y, z), new THREE.Quaternion(), new THREE.Vector3(s * 1.3, s * 0.85, s * 1.1)); mesh.setMatrixAt(i, m); });
  mesh.renderOrder = -0.5;
  return mesh;
}

/** Hazy blue-green hills and a volcano on the horizon (they follow the camera like the sky). */
function farHills(rand) {
  const seg = 160;
  const pos = [];
  const col = [];
  const near = new THREE.Color('#9fc3a8');
  const far = new THREE.Color('#b8d3dc');
  const volcano = new THREE.Color('#8fa6b8');
  const layers = [[300, 0.8, far, 0], [270, 1.0, near, 1]];
  for (const [R, amp, color, li] of layers) {
    const ph = rand() * 10;
    for (let i = 0; i < seg; i++) {
      const a0 = (i / seg) * Math.PI * 2;
      const a1 = ((i + 1) / seg) * Math.PI * 2;
      const h = (a) => {
        let y = 14 + Math.sin(a * 3 + ph) * 6 + Math.sin(a * 7 + ph * 2) * 4 + Math.sin(a * 17 + ph) * 1.5;
        if (li === 0) { const d = Math.atan2(Math.sin(a - 0.9), Math.cos(a - 0.9)); y += Math.max(0, 1 - Math.abs(d) / 0.22) * 52; } // the volcano
        return Math.max(4, y * amp);
      };
      const p = (a, y) => [Math.cos(a) * R, y, Math.sin(a) * R];
      const b0 = p(a0, -10); const b1 = p(a1, -10); const t0 = p(a0, h(a0)); const t1 = p(a1, h(a1));
      pos.push(...b0, ...t0, ...t1, ...b0, ...t1, ...b1);
      const top0 = h(a0) > 40 && li === 0 ? volcano : color;
      const top1 = h(a1) > 40 && li === 0 ? volcano : color;
      const bot = new THREE.Color('#dbeaf0');
      for (const cc of [bot, top0, top1, bot, top1, bot]) col.push(cc.r, cc.g, cc.b);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  const mesh = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ vertexColors: true, fog: false, side: THREE.DoubleSide, depthWrite: false }));
  mesh.renderOrder = -0.8;
  mesh.frustumCulled = false;
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
  const W = 512;
  const H = 1024;
  const cv = document.createElement('canvas');
  cv.width = W; cv.height = H;
  const c = cv.getContext('2d');
  c.fillStyle = '#4b5058';
  c.fillRect(0, 0, W, H);
  // aggregate: lots of tiny light and dark stones
  for (let i = 0; i < 26000; i++) {
    const v = Math.random();
    c.fillStyle = v < 0.45 ? 'rgba(255,255,255,0.07)' : v < 0.9 ? 'rgba(0,0,0,0.1)' : 'rgba(150,140,120,0.15)';
    c.fillRect(Math.random() * W, Math.random() * H, 1 + Math.random() * 2, 1 + Math.random() * 2);
  }
  // slightly darker wheel tracks in each lane, a few repair patches and cracks
  if (!cross) {
    for (const u of [0.257, 0.743]) for (const o of [-0.115, 0.115]) {
      const g = c.createLinearGradient(W * (u + o - 0.04), 0, W * (u + o + 0.04), 0);
      g.addColorStop(0, 'rgba(0,0,0,0)'); g.addColorStop(0.5, 'rgba(20,20,25,0.18)'); g.addColorStop(1, 'rgba(0,0,0,0)');
      c.fillStyle = g; c.fillRect(W * (u + o - 0.04), 0, W * 0.08, H);
    }
  }
  for (let k = 0; k < 3; k++) {
    c.fillStyle = `rgba(${Math.random() < 0.5 ? '25,25,30' : '90,92,98'},0.35)`;
    c.fillRect(Math.random() * W * 0.7, Math.random() * H, 40 + Math.random() * 90, 30 + Math.random() * 80);
  }
  c.strokeStyle = 'rgba(15,15,18,0.45)'; c.lineWidth = 1.5;
  for (let k = 0; k < 6; k++) {
    let x = Math.random() * W; let y = Math.random() * H;
    c.beginPath(); c.moveTo(x, y);
    for (let j = 0; j < 8; j++) { x += (Math.random() - 0.5) * 30; y += Math.random() * 18; c.lineTo(x, y); }
    c.stroke();
  }
  if (!cross) {
    // edge lines and the dashed centre line
    c.fillStyle = P.line;
    c.fillRect(W * 0.03, 0, W * 0.025, H);
    c.fillRect(W * 0.945, 0, W * 0.025, H);
    for (let y = 0; y < H; y += 256) c.fillRect(W / 2 - 7, y, 14, 150);
    // wear on the paint
    for (let i = 0; i < 1500; i++) { c.fillStyle = 'rgba(75,80,88,0.5)'; c.fillRect(Math.random() * W, Math.random() * H, 2, 2); }
  }
  const t = canvasTex(cv, true);
  return t;
}

function walkTexture() {
  // concrete paving blocks with a yellow tactile strip for blind walkers
  const W = 256;
  const H = 256;
  const cv = document.createElement('canvas');
  cv.width = W; cv.height = H;
  const c = cv.getContext('2d');
  c.fillStyle = '#b9b1a3';
  c.fillRect(0, 0, W, H);
  const cols = ['#d8d1c3', '#cfc7b6', '#ddd6c9', '#e2c9cc', '#c9d9cf', '#d3cbbb'];
  const bw = 32; const bh = 16;
  for (let y = 0; y < H; y += bh) for (let x = -bw; x < W; x += bw) {
    const ox = ((y / bh) % 2) * (bw / 2);
    c.fillStyle = cols[Math.floor(Math.random() * cols.length)];
    c.fillRect(x + ox + 1, y + 1, bw - 2, bh - 2);
  }
  for (let i = 0; i < 2500; i++) { c.fillStyle = Math.random() < 0.5 ? 'rgba(0,0,0,0.05)' : 'rgba(255,255,255,0.07)'; c.fillRect(Math.random() * W, Math.random() * H, 2, 2); }
  // tactile strip (u 0.55..0.68 of the sidewalk width)
  c.fillStyle = '#f2c230';
  c.fillRect(W * 0.55, 0, W * 0.13, H);
  c.fillStyle = '#d9a91c';
  for (let y = 4; y < H; y += 9) for (let x = W * 0.56; x < W * 0.67; x += 9) { c.beginPath(); c.arc(x + 3, y, 2.2, 0, 7); c.fill(); }
  return canvasTex(cv, true);
}

function kerbTexture() {
  const cv = document.createElement('canvas');
  cv.width = 16; cv.height = 64;
  const c = cv.getContext('2d');
  c.fillStyle = '#f0efe9'; c.fillRect(0, 0, 16, 32);
  c.fillStyle = '#2b2f33'; c.fillRect(0, 32, 16, 32);
  return canvasTex(cv, true);
}

function grassTexture() {
  const S = 256;
  const cv = document.createElement('canvas');
  cv.width = S; cv.height = S;
  const c = cv.getContext('2d');
  c.fillStyle = '#c4c4c4';
  c.fillRect(0, 0, S, S);
  for (let i = 0; i < 14; i++) {
    const g = c.createRadialGradient(Math.random() * S, Math.random() * S, 0, Math.random() * S, Math.random() * S, 60);
    g.addColorStop(0, `rgba(${Math.random() < 0.5 ? '255,255,255' : '0,0,0'},0.08)`); g.addColorStop(1, 'rgba(0,0,0,0)');
    c.fillStyle = g; c.fillRect(0, 0, S, S);
  }
  for (let i = 0; i < 5000; i++) {
    const v = 150 + Math.random() * 105 | 0;
    c.strokeStyle = `rgba(${v},${v},${v},0.55)`;
    c.lineWidth = 1;
    const x = Math.random() * S; const y = Math.random() * S;
    c.beginPath(); c.moveTo(x, y); c.lineTo(x + (Math.random() - 0.5) * 3, y - 3 - Math.random() * 4); c.stroke();
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
    uniforms: { top: { value: new THREE.Color('#3f8fdc') }, horizon: { value: new THREE.Color('#e4f3f8') }, bottom: { value: new THREE.Color('#dbeaf0') } },
    vertexShader: 'varying vec3 vDir; void main(){ vDir = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
    fragmentShader: `uniform vec3 top; uniform vec3 horizon; uniform vec3 bottom; varying vec3 vDir;
      void main(){ vec3 d = normalize(vDir); float h = d.y;
      vec3 c = h > 0.0 ? mix(horizon, top, pow(min(h * 1.6, 1.0), 0.6)) : mix(horizon, bottom, min(-h * 4.0, 1.0));
      // sun glow and a warm haze around it
      vec3 sd = normalize(vec3(0.5, 0.75, 0.35)); float g = max(dot(d, sd), 0.0);
      c += vec3(1.0, 0.95, 0.8) * (pow(g, 600.0) * 2.0 + pow(g, 40.0) * 0.25 + pow(g, 6.0) * 0.08);
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
