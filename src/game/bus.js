import * as THREE from 'three';
import { P } from './palette.js';
import { BUS, sideTexture, frontTexture, windshieldTexture, rearTexture, drawLogo, roundRect } from './livery.js';
import { StaticKit, makeBunting } from './festive.js';
import { makePanel, text } from '../core/ui.js';

/**
 * The FDC Smile Bus, outside and in.
 *
 * Bus space: x = right, y = up, -z = forward (the front is at z = -4.35). Indonesia drives on
 * the left, so the steering wheel is on the right and the door on the left (kerb) side.
 *
 * The outer shell only faces outwards: from the driver's seat its walls are back faces and the
 * GPU skips them, so you look straight out through the windows. What you see inside (dashboard,
 * pillars, roof, seats) is a separate cockpit built around you, which also gives your eyes a
 * steady frame while the world moves: a big help against motion sickness.
 */
export const DRIVER_EYE = new THREE.Vector3(0.55, 1.97, -3.22);
export const WHEEL_POS = new THREE.Vector3(0.55, 1.4, -3.68);
export const WHEEL_TILT = 0.95; // radians back from vertical (bus wheels lie quite flat)
export const WHEEL_R = 0.22;
const FLOOR = 0.8;
const HALF = BUS.width / 2;

export function buildBus(app) {
  const group = new THREE.Group();
  const outside = new THREE.Group();
  const inside = new THREE.Group();
  group.add(outside, inside);

  // ------------------------------------------------------------------ shell
  const shape = profileShape();
  const depth = BUS.width - 0.1;
  const shellGeo = new THREE.ExtrudeGeometry(shape, { depth, bevelEnabled: true, bevelThickness: 0.05, bevelSize: 0.05, bevelSegments: 3, curveSegments: 10 });
  shellGeo.rotateY(Math.PI / 2);
  shellGeo.translate(-depth / 2, 0, 0);
  const shell = new THREE.Mesh(shellGeo, new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 0.32, metalness: 0.05 }));
  outside.add(shell);

  // side decals (the same outline as the shell)
  for (const left of [true, false]) {
    const g = new THREE.ShapeGeometry(shape, 10);
    const pos = g.attributes.position;
    const uv = g.attributes.uv;
    for (let i = 0; i < pos.count; i++) {
      const u = pos.getX(i);
      const y = pos.getY(i);
      uv.setXY(i, left ? (BUS.front - u) / BUS.length : (u - BUS.rear) / BUS.length, (y - BUS.bottom) / (BUS.roof - BUS.bottom));
    }
    g.rotateY(Math.PI / 2); // faces +x
    if (left) { g.scale(-1, 1, 1); flipWinding(g); }
    g.translate(left ? -(HALF + 0.004) : HALF + 0.004, 0, 0);
    g.computeVertexNormals();
    const m = new THREE.Mesh(g, new THREE.MeshStandardMaterial({ map: sideTexture(left), roughness: 0.35, metalness: 0.05, polygonOffset: true, polygonOffsetFactor: -2 }));
    outside.add(m);
  }

  // front: lower nose + windscreen; rear
  const front = ribbon([[4.42, BUS.bottom + 0.02], [4.5, 0.56], [4.53, 1.2], [4.44, 1.6]], BUS.width - 0.04, -1);
  outside.add(new THREE.Mesh(front, new THREE.MeshStandardMaterial({ map: frontTexture(), roughness: 0.35 })));
  const ws = ribbon([[4.47, 1.6], [4.33, 2.3], [4.17, 2.97]], BUS.width - 0.12, -1);
  outside.add(new THREE.Mesh(ws, new THREE.MeshStandardMaterial({ map: windshieldTexture(), roughness: 0.1, metalness: 0.3, transparent: true })));
  const rear = ribbon([[-4.48, BUS.bottom + 0.02], [-4.48, 2.92]], BUS.width - 0.04, 1);
  outside.add(new THREE.Mesh(rear, new THREE.MeshStandardMaterial({ map: rearTexture(), roughness: 0.35 })));

  // ------------------------------------------------------------------ outer details
  const kit = new StaticKit();
  // wheels: tyres, chrome hubs
  const wheels = [];
  const tyreGeo = new THREE.CylinderGeometry(BUS.wheelR, BUS.wheelR, 0.3, 28);
  tyreGeo.rotateZ(Math.PI / 2);
  const hubGeo = new THREE.CylinderGeometry(0.27, 0.27, 0.32, 20);
  hubGeo.rotateZ(Math.PI / 2);
  const tyreMat = new THREE.MeshStandardMaterial({ color: '#1d1f22', roughness: 0.9 });
  const hubMat = new THREE.MeshStandardMaterial({ color: '#d8dde0', roughness: 0.2, metalness: 0.8 });
  const nutGeo = new THREE.BoxGeometry(0.34, 0.05, 0.05);
  for (const u of [BUS.axleFront, BUS.axleRear]) {
    for (const s of [-1, 1]) {
      const w = new THREE.Group();
      w.position.set(s * (HALF - 0.17), BUS.wheelR, -u);
      const tyre = new THREE.Mesh(tyreGeo, tyreMat);
      const hub = new THREE.Mesh(hubGeo, hubMat);
      const nut = new THREE.Mesh(nutGeo, tyreMat); // a dark spoke so you can see it turn
      w.add(tyre, hub, nut);
      outside.add(w);
      wheels.push({ group: w, front: u > 0, spin: [hub, nut] });
    }
  }
  // dark wheel wells
  for (const u of [BUS.axleFront, BUS.axleRear]) kit.add(new THREE.CylinderGeometry(0.6, 0.6, BUS.width - 0.08, 20, 1, true, -Math.PI / 2, Math.PI), '#16191c', { y: BUS.wheelR, z: -u, rz: Math.PI / 2 });
  // ear mirrors
  for (const s of [-1, 1]) {
    kit.add(new THREE.CylinderGeometry(0.025, 0.025, 0.75, 8), '#22272b', { x: s * (HALF + 0.12), y: 2.82, z: -4.2, rz: s * 0.9, rx: 0.55 });
    kit.add(new THREE.CylinderGeometry(0.025, 0.025, 0.5, 8), '#22272b', { x: s * (HALF + 0.3), y: 2.5, z: -4.55, rx: 0.15 });
    kit.add(new THREE.BoxGeometry(0.1, 0.42, 0.22), '#22272b', { x: s * (HALF + 0.3), y: 2.15, z: -4.62, ry: s * 0.25 });
  }
  // wipers
  for (const x of [-0.45, 0.5]) kit.add(new THREE.BoxGeometry(0.75, 0.02, 0.02), '#1b1e21', { x, y: 1.66, z: -4.4, rz: x < 0 ? 0.35 : -0.35 });
  // roof: AC unit, rails
  kit.add(new THREE.BoxGeometry(1.5, 0.22, 2.2), '#f2f4f5', { y: BUS.roof + 0.1, z: 0.4 });
  kit.add(new THREE.BoxGeometry(1.2, 0.04, 1.8), '#d7dde1', { y: BUS.roof + 0.23, z: 0.4 });
  kit.add(new THREE.BoxGeometry(BUS.width - 0.5, 0.14, 0.3), '#f2f4f5', { y: BUS.roof + 0.04, z: 3.95 }); // rear spoiler
  // awning roll on the door side (green, with the scalloped valance)
  kit.add(new THREE.CylinderGeometry(0.09, 0.09, 4.4, 14), P.busGreen, { x: -HALF - 0.08, y: 3.0, z: -0.85, rx: Math.PI / 2 });
  kit.add(new THREE.BoxGeometry(0.03, 0.14, 4.4), P.busGreenDark, { x: -HALF - 0.17, y: 2.92, z: -0.85 });
  // bumpers' chrome strip and a step under the door
  kit.add(new THREE.BoxGeometry(BUS.width - 0.2, 0.05, 0.06), P.chrome, { y: 0.98, z: -4.47 });
  kit.add(new THREE.BoxGeometry(0.45, 0.05, 1.2), '#8e979c', { x: -HALF + 0.05, y: 0.33, z: -(BUS.door[0] + BUS.door[1]) / 2 });
  outside.add(kit.build({ roughness: 0.5 }));

  // headlights and tail lights that can glow
  const lightMat = new THREE.MeshBasicMaterial({ color: '#fff7dd', toneMapped: false });
  const tailMat = new THREE.MeshBasicMaterial({ color: '#7a1018', toneMapped: false });
  for (const s of [-1, 1]) {
    const hl = new THREE.Mesh(new THREE.CircleGeometry(0.06, 16), lightMat);
    hl.position.set(s * 0.97 - s * 0.07, 0.92, -4.455);
    hl.rotation.y = Math.PI;
    outside.add(hl);
    const tl = new THREE.Mesh(new THREE.PlaneGeometry(0.11, 0.9), tailMat);
    tl.position.set(s * (HALF - 0.06), 1.45, 4.44);
    outside.add(tl);
  }

  // ------------------------------------------------------------------ the door (two leaves that swing out)
  const doorTex = doorLeafTexture();
  const leafW = (BUS.door[1] - BUS.door[0]) / 2;
  const leafH = BUS.winTop - 0.42;
  const doorLeaves = [];
  for (const k of [0, 1]) {
    const hinge = new THREE.Group();
    const hingeU = k ? BUS.door[0] : BUS.door[1];
    hinge.position.set(-HALF - 0.03, 0.42, -hingeU);
    const leaf = new THREE.Mesh(new THREE.BoxGeometry(0.035, leafH, leafW), new THREE.MeshStandardMaterial({ map: doorTex, roughness: 0.3 }));
    leaf.position.set(0, leafH / 2, (k ? -1 : 1) * leafW / 2);
    hinge.add(leaf);
    group.add(hinge);
    doorLeaves.push({ hinge, dir: k ? 1 : -1 });
  }

  // ------------------------------------------------------------------ cockpit and cabin (inside)
  const cab = new StaticKit();
  const IN = HALF - 0.07; // inner wall x
  // floor and steps
  cab.add(new THREE.BoxGeometry(BUS.width - 0.14, 0.06, 8.2), '#7d868c', { y: FLOOR - 0.03, z: 0.05 });
  cab.add(new THREE.BoxGeometry(0.5, 0.06, 1.1), '#5d666b', { x: -IN + 0.25, y: 0.6, z: -(BUS.door[0] + BUS.door[1]) / 2 });
  // aisle strip
  cab.add(new THREE.BoxGeometry(0.4, 0.005, 6.2), '#9aa3a8', { x: -0.05, y: FLOOR + 0.003, z: 1.0 });
  // lower walls (below the windows), with the door gap on the left
  const wall = '#eef1f3';
  cab.add(new THREE.BoxGeometry(0.06, BUS.winBottom - FLOOR, 7.6), wall, { x: IN, y: (FLOOR + BUS.winBottom) / 2, z: 0.25 });
  cab.add(new THREE.BoxGeometry(0.06, BUS.winBottom - FLOOR, 6.0), wall, { x: -IN, y: (FLOOR + BUS.winBottom) / 2, z: 1.05 });
  cab.add(new THREE.BoxGeometry(0.06, BUS.winBottom - FLOOR, 0.45), wall, { x: -IN, y: (FLOOR + BUS.winBottom) / 2, z: -4.02 });
  // window sills (green) and the upper wall + roof liner
  for (const s of [-1, 1]) {
    cab.add(new THREE.BoxGeometry(0.14, 0.04, 8.0), P.busGreen, { x: s * (IN - 0.04), y: BUS.winBottom, z: 0.1 });
    cab.add(new THREE.BoxGeometry(0.08, 0.25, 8.2), '#f7f8f9', { x: s * IN, y: BUS.winTop + 0.1, z: 0.05 });
    // luggage racks / AC ducts along the roof
    cab.add(new THREE.BoxGeometry(0.42, 0.14, 7.0), '#e4e8eb', { x: s * (IN - 0.22), y: 2.95, z: 0.7 });
    cab.add(new THREE.BoxGeometry(0.42, 0.02, 7.0), P.busPink, { x: s * (IN - 0.22), y: 2.87, z: 0.7 });
  }
  cab.add(new THREE.BoxGeometry(BUS.width - 0.1, 0.05, 8.3), '#fbfcfc', { y: 3.06, z: 0.05 });
  // window pillars, as on the outside
  for (const u of [BUS.door[0] - 0.05, 0.85, -0.25, -1.6, -2.9]) cab.add(new THREE.BoxGeometry(0.1, BUS.winTop - BUS.winBottom, 0.08), '#2a3035', { x: -IN, y: (BUS.winBottom + BUS.winTop) / 2, z: -u });
  for (const u of [3.1, 1.75, 0.4, -0.95, -2.3, -3.6]) cab.add(new THREE.BoxGeometry(0.1, BUS.winTop - BUS.winBottom, 0.08), '#2a3035', { x: IN, y: (BUS.winBottom + BUS.winTop) / 2, z: -u });
  // door frame posts
  for (const u of BUS.door) cab.add(new THREE.BoxGeometry(0.1, BUS.winTop - 0.42, 0.08), '#2a3035', { x: -IN, y: (BUS.winTop + 0.42) / 2, z: -u });
  // rear wall with its window opening
  cab.add(new THREE.BoxGeometry(BUS.width - 0.1, 1.15, 0.06), wall, { y: FLOOR + 0.57, z: 4.25 });
  cab.add(new THREE.BoxGeometry(BUS.width - 0.1, 0.12, 0.06), wall, { y: 3.0, z: 4.25 });
  // A-pillars, the header above the windscreen, the dashboard
  for (const s of [-1, 1]) {
    const a = new THREE.Vector3(s * (IN - 0.02), 1.56, -4.3);
    const b = new THREE.Vector3(s * (IN - 0.04), 2.95, -4.05);
    const len = a.distanceTo(b);
    const mid = a.clone().add(b).multiplyScalar(0.5);
    cab.add(new THREE.BoxGeometry(0.1, len, 0.1), '#22272b', { x: mid.x, y: mid.y, z: mid.z, rx: -Math.atan2(b.z - a.z, b.y - a.y) });
  }
  cab.add(new THREE.BoxGeometry(BUS.width - 0.12, 0.2, 0.32), '#2b3136', { y: 3.0, z: -4.0 }); // header (destination sign box)
  // dashboard: a broad shelf with a hood over the instruments
  cab.add(new THREE.BoxGeometry(BUS.width - 0.14, 0.7, 0.55), '#454e55', { y: FLOOR + 0.35 + 0.05, z: -4.02 });
  cab.add(new THREE.BoxGeometry(BUS.width - 0.14, 0.06, 0.62), '#58626a', { y: 1.49, z: -4.0, rx: 0.12 });
  cab.add(new THREE.BoxGeometry(0.5, 0.04, 0.4), P.busGreen, { x: -0.6, y: 1.53, z: -3.96, rx: 0.12 }); // green trim on the passenger side
  // steering column
  const colA = new THREE.Vector3(WHEEL_POS.x, 1.0, -3.95);
  const colLen = colA.distanceTo(WHEEL_POS);
  const colMid = colA.clone().add(WHEEL_POS).multiplyScalar(0.5);
  cab.add(new THREE.CylinderGeometry(0.045, 0.06, colLen, 10), '#22272b', { x: colMid.x, y: colMid.y, z: colMid.z, rx: -Math.atan2(WHEEL_POS.z - colA.z, WHEEL_POS.y - colA.y) });
  // driver's seat
  const seatX = DRIVER_EYE.x;
  cab.add(new THREE.BoxGeometry(0.52, 0.12, 0.5), '#2a2f33', { x: seatX, y: FLOOR + 0.45, z: -2.95 });
  cab.add(new THREE.BoxGeometry(0.52, 0.7, 0.12), '#2a2f33', { x: seatX, y: FLOOR + 0.85, z: -2.68, rx: -0.15 });
  cab.add(new THREE.CylinderGeometry(0.06, 0.08, 0.4, 10), '#555c61', { x: seatX, y: FLOOR + 0.2, z: -2.95 });
  // partition behind the driver and a guard rail by the door
  cab.add(new THREE.BoxGeometry(0.9, 1.0, 0.04), '#dfe4e7', { x: IN - 0.48, y: FLOOR + 0.5, z: -2.45 });
  cab.add(new THREE.CylinderGeometry(0.02, 0.02, 2.1, 8), P.chrome, { x: -0.35, y: FLOOR + 1.05, z: -2.45 });
  // grab rails along the ceiling
  for (const s of [-1, 1]) cab.add(new THREE.CylinderGeometry(0.018, 0.018, 6.4, 8), P.chrome, { x: s * 0.42, y: 2.72, z: 0.9, rx: Math.PI / 2 });
  // pedals
  for (const [x, w] of [[seatX + 0.12, 0.09], [seatX - 0.1, 0.16]]) cab.add(new THREE.BoxGeometry(w, 0.2, 0.03), '#1d2124', { x, y: FLOOR + 0.12, z: -3.75, rx: 0.5 });
  inside.add(cab.build({ roughness: 0.6, glow: 0.35 }));

  // ceiling light strips (glowing)
  for (const s of [-1, 1]) {
    const strip = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.012, 6.6), new THREE.MeshBasicMaterial({ color: s < 0 ? '#ffd6ea' : '#d6ffe0', toneMapped: false }));
    strip.position.set(s * 0.25, 3.03, 0.8);
    inside.add(strip);
  }

  // passenger seats: 2 + 2 rows, pink and green covers (instanced)
  const seatSpots = [];
  for (let r = 0; r < 7; r++) {
    const z = -1.75 + r * 0.82;
    for (const x of [-0.92, -0.47, 0.47, 0.92]) seatSpots.push(new THREE.Vector3(x, FLOOR, z));
  }
  seatSpots.push(new THREE.Vector3(-0.92, FLOOR, 3.85), new THREE.Vector3(-0.47, FLOOR, 3.85), new THREE.Vector3(0, FLOOR, 3.85), new THREE.Vector3(0.47, FLOOR, 3.85), new THREE.Vector3(0.92, FLOOR, 3.85));
  const cushion = new THREE.InstancedMesh(new THREE.BoxGeometry(0.42, 0.12, 0.42), new THREE.MeshStandardMaterial({ roughness: 0.8 }), seatSpots.length);
  const back = new THREE.InstancedMesh(new THREE.BoxGeometry(0.42, 0.62, 0.1), new THREE.MeshStandardMaterial({ roughness: 0.8 }), seatSpots.length);
  const legs = new THREE.InstancedMesh(new THREE.BoxGeometry(0.06, 0.4, 0.3), new THREE.MeshStandardMaterial({ color: '#8b9399', roughness: 0.5 }), seatSpots.length);
  const m4 = new THREE.Matrix4();
  const col = new THREE.Color();
  const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(-0.12, 0, 0));
  seatSpots.forEach((p, i) => {
    m4.makeTranslation(p.x, p.y + 0.42, p.z);
    cushion.setMatrixAt(i, m4);
    m4.compose(new THREE.Vector3(p.x, p.y + 0.78, p.z + 0.22), q, new THREE.Vector3(1, 1, 1));
    back.setMatrixAt(i, m4);
    m4.makeTranslation(p.x, p.y + 0.2, p.z);
    legs.setMatrixAt(i, m4);
    const c = (Math.floor(i / 2) + Math.floor(i / 28)) % 2 ? P.busPink : P.busGreen;
    cushion.setColorAt(i, col.set(c));
    back.setColorAt(i, col.set(c).offsetHSL(0, 0, -0.06));
  });
  inside.add(cushion, back, legs);

  // festive touches: a garland under the roof, FDC tips above the windows, a swinging tooth charm
  const garland = makeBunting([
    { a: new THREE.Vector3(-0.42, 2.66, -2.4), b: new THREE.Vector3(-0.42, 2.66, 4.0), sag: 0.12 },
    { a: new THREE.Vector3(0.42, 2.66, -2.4), b: new THREE.Vector3(0.42, 2.66, 4.0), sag: 0.12 },
  ], { colors: [P.busPink, P.busGreen, P.gold, '#ffffff'], flagW: 0.12, flagH: 0.15, gap: 0.26, bulbs: true, bulbGap: 0.4 });
  inside.add(garland.group);
  const tips = ['Sikat gigi 2x sehari', 'Kurangi makanan manis', 'Periksa gigi tiap 6 bulan', 'Ganti sikat tiap 3 bulan', 'Senyum sehat bersama FDC', 'Download aplikasi FDC'];
  tips.forEach((t, i) => {
    const s = i % 2 ? 1 : -1;
    const p = makePanel(0.9, 0.16, (c, W, H) => {
      roundRect(c, 4, 4, W - 8, H - 8, H * 0.35);
      c.fillStyle = i % 2 ? P.busPink : P.busGreen; c.fill();
      text(c, t, W / 2, H * 0.66, { size: H * 0.42, weight: 800, color: '#ffffff', align: 'center', maxWidth: W * 0.92 });
    }, { ppm: 420 });
    // on the wall above the windows, facing into the bus
    p.mesh.position.set(s * (IN - 0.43), 2.8, -0.6 + Math.floor(i / 2) * 2.0);
    p.mesh.rotation.y = s < 0 ? Math.PI / 2 : -Math.PI / 2;
    inside.add(p.mesh);
  });
  // destination sign inside the header (facing the driver it shows the route)
  const dest = makePanel(1.1, 0.16, (c, W, H) => {
    c.fillStyle = '#101418'; c.fillRect(0, 0, W, H);
    text(c, 'SMILE BUS · FDC DENTAL CLINIC', W / 2, H * 0.68, { size: H * 0.48, weight: 800, color: '#ffb13b', align: 'center', maxWidth: W * 0.94 });
  }, { ppm: 500 });
  dest.mesh.position.set(-0.3, 2.95, -3.83);
  inside.add(dest.mesh);
  // the swinging tooth charm under the header
  const charm = new THREE.Group();
  charm.position.set(-0.05, 2.88, -3.9);
  const cord = new THREE.Mesh(new THREE.CylinderGeometry(0.003, 0.003, 0.22, 4), new THREE.MeshBasicMaterial({ color: '#e8619f' }));
  cord.position.y = -0.11;
  const toothMat = new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 0.25, emissive: '#ffeef6', emissiveIntensity: 0.2 });
  const tooth = new THREE.Mesh(new THREE.SphereGeometry(0.05, 16, 12), toothMat);
  tooth.scale.set(1.1, 0.9, 0.9);
  tooth.position.y = -0.26;
  for (const s of [-1, 1]) {
    const root = new THREE.Mesh(new THREE.CapsuleGeometry(0.016, 0.03, 4, 8), toothMat);
    root.position.set(s * 0.022, -0.31, 0);
    charm.add(root);
  }
  const smile = new THREE.Mesh(new THREE.TorusGeometry(0.014, 0.003, 4, 10, Math.PI), new THREE.MeshBasicMaterial({ color: '#e8619f' }));
  smile.rotation.z = Math.PI;
  smile.position.set(0, -0.265, 0.045);
  charm.add(cord, tooth, smile);
  inside.add(charm);

  // the steering wheel (spins with your steering)
  const wheelPivot = new THREE.Group();
  wheelPivot.position.copy(WHEEL_POS);
  wheelPivot.rotation.x = -(Math.PI / 2 - WHEEL_TILT);
  const wheel = new THREE.Group();
  wheelPivot.add(wheel);
  const wheelMat = new THREE.MeshStandardMaterial({ color: '#1f2326', roughness: 0.55 });
  const rim = new THREE.Mesh(new THREE.TorusGeometry(WHEEL_R, 0.022, 10, 40), wheelMat);
  wheel.add(rim);
  for (let i = 0; i < 3; i++) {
    const a = -Math.PI / 2 + (i - 1) * (Math.PI * 0.6) + (i === 1 ? 0 : 0);
    const spoke = new THREE.Mesh(new THREE.BoxGeometry(0.03, WHEEL_R, 0.02), wheelMat);
    spoke.position.set(Math.cos(a) * WHEEL_R / 2, Math.sin(a) * WHEEL_R / 2, 0);
    spoke.rotation.z = a + Math.PI / 2;
    wheel.add(spoke);
  }
  const hubCap = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 0.04, 20), new THREE.MeshStandardMaterial({ color: P.busGreen, roughness: 0.4 }));
  hubCap.rotation.x = Math.PI / 2;
  wheel.add(hubCap);
  // a pink grip marker at the top so you can see how far it's turned
  const mark = new THREE.Mesh(new THREE.TorusGeometry(WHEEL_R, 0.026, 8, 8, 0.35), new THREE.MeshStandardMaterial({ color: P.busPink, roughness: 0.4 }));
  mark.rotation.z = Math.PI / 2 - 0.175;
  wheel.add(mark);
  inside.add(wheelPivot);

  // ------------------------------------------------------------------ behaviour
  let doorNow = 0;
  let doorWant = 0;
  let charmSwing = 0;
  let charmVel = 0;
  const api = {
    group, outside, inside, wheel, wheelPivot, seats: seatSpots, charm,
    get doorOpen() { return doorNow > 0.95; },
    get doorClosed() { return doorNow < 0.02; },
    setDoor(open) { doorWant = open ? 1 : 0; },
    /** Per frame: wheel spin (rad/s rolling), steer angle, steering-wheel angle, longitudinal accel. */
    update(dt, { roll = 0, steer = 0, wheelAngle = 0, accel = 0, lights = 0, t = 0 } = {}) {
      for (const w of wheels) {
        for (const o of w.spin) o.rotation.x -= roll * dt;
        w.group.rotation.y = w.front ? steer : 0;
      }
      wheel.rotation.z = -wheelAngle;
      // door: ease in/out
      doorNow += Math.sign(doorWant - doorNow) * Math.min(Math.abs(doorWant - doorNow), dt * 1.4);
      const e = doorNow * doorNow * (3 - 2 * doorNow);
      for (const l of doorLeaves) l.hinge.rotation.y = l.dir * e * 1.45;
      // charm: a pendulum pushed by the bus's acceleration
      charmVel += (-charmSwing * 22 - charmVel * 1.6 + accel * 0.9) * dt;
      charmSwing += charmVel * dt;
      charm.rotation.x = THREE.MathUtils.clamp(charmSwing, -0.6, 0.6);
      garland.update(dt, t);
      tailMat.color.set(lights ? '#ff3344' : '#7a1018');
    },
  };
  return api;
}

// ------------------------------------------------------------------ geometry helpers
/** The bus seen from the side: (u along the bus, + = front; y up). */
function profileShape() {
  const s = new THREE.Shape();
  const b = BUS.bottom;
  const notch = 0.62;
  s.moveTo(BUS.rear + 0.05, b);
  for (const u of [BUS.axleRear, BUS.axleFront]) {
    s.lineTo(u - notch, b);
    s.lineTo(u - notch, BUS.wheelR);
    s.absarc(u, BUS.wheelR, notch, Math.PI, 0, true);
    s.lineTo(u + notch, b);
  }
  s.lineTo(BUS.front - 0.05, b);
  s.quadraticCurveTo(BUS.front + 0.05, b, BUS.front + 0.05, 0.55);
  s.lineTo(BUS.front + 0.08, 1.2);
  s.quadraticCurveTo(BUS.front + 0.06, 1.5, BUS.front, 1.58);
  s.lineTo(BUS.front - 0.28, 2.95);
  s.quadraticCurveTo(BUS.front - 0.36, BUS.roof, BUS.front - 0.6, BUS.roof);
  s.lineTo(BUS.rear + 0.3, BUS.roof);
  s.quadraticCurveTo(BUS.rear - 0.02, BUS.roof, BUS.rear - 0.02, BUS.roof - 0.3);
  s.lineTo(BUS.rear - 0.05, 0.5);
  s.quadraticCurveTo(BUS.rear - 0.05, b, BUS.rear + 0.05, b);
  return s;
}

/**
 * A strip across the bus following a list of (u, y) points (bottom → top), facing the front
 * (`facing` = -1) or the rear (+1). UVs run 0..1 across and from the first to the last point.
 */
function ribbon(pts, width, facing) {
  const pos = [];
  const uv = [];
  const idx = [];
  let total = 0;
  const lens = [0];
  for (let i = 1; i < pts.length; i++) { total += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]); lens.push(total); }
  pts.forEach(([u, y], i) => {
    for (const s of [-1, 1]) {
      pos.push(s * width / 2, y, -u);
      uv.push(facing < 0 ? (1 - s) / 2 : (s + 1) / 2, lens[i] / total);
    }
  });
  for (let i = 0; i < pts.length - 1; i++) {
    const a = i * 2;
    if (facing < 0) idx.push(a, a + 2, a + 1, a + 1, a + 2, a + 3);
    else idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

function flipWinding(g) {
  const index = g.index;
  if (index) {
    const a = index.array;
    for (let i = 0; i < a.length; i += 3) { const t = a[i + 1]; a[i + 1] = a[i + 2]; a[i + 2] = t; }
    index.needsUpdate = true;
  }
}

function doorLeafTexture() {
  const cv = document.createElement('canvas');
  cv.width = 256;
  cv.height = 512;
  const c = cv.getContext('2d');
  c.fillStyle = '#ffffff';
  c.fillRect(0, 0, 256, 512);
  const g = c.createLinearGradient(0, 0, 0, 320);
  g.addColorStop(0, '#2c3a44'); g.addColorStop(1, '#10161b');
  c.fillStyle = g;
  roundRect(c, 14, 14, 228, 300, 18); c.fill();
  c.fillStyle = 'rgba(255,255,255,0.1)';
  c.beginPath(); c.moveTo(40, 314); c.lineTo(130, 14); c.lineTo(170, 14); c.lineTo(80, 314); c.fill();
  c.fillStyle = P.busPink;
  c.fillRect(0, 380, 256, 50);
  c.fillStyle = P.busGreen;
  c.fillRect(0, 430, 256, 82);
  c.strokeStyle = '#30363b';
  c.lineWidth = 10;
  c.strokeRect(5, 5, 246, 502);
  drawLogo(c, 70, 330, 40, { text: false, green: P.busGreen });
  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
