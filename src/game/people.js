import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

/**
 * Cartoon townsfolk and passengers with real moving arms and legs.
 *
 * Each person is still ONE merged mesh (one draw call), but every vertex knows which body part it
 * belongs to (thigh, shin, arm, upper body). A tiny vertex shader bends those parts around the
 * hip, knee and shoulder joints from a handful of angles per person, so people walk with swinging
 * arms, wave, cheer, sit down on a bus seat and stand up again, with no skeleton or extra cost.
 *
 * Origin: between the feet of the standing pose. Facing: +z.
 */
const SKIN = ['#f1c7a3', '#e0ad84', '#c98f63', '#a8714a', '#f6d5b8', '#d9a27a'];
const SHIRT = ['#ec6db0', '#3cc44c', '#4a9be8', '#ffb13b', '#ffffff', '#b38cf0', '#ff7a6b', '#2fb5a6', '#f7c95e', '#e8545c'];
const PANTS = ['#2d3a55', '#4b5563', '#7a5a3a', '#334155', '#1f2937', '#6b7280', '#3b4a6b'];
const HAIR = ['#2a1d16', '#3b2a1e', '#16110d', '#5a3b22', '#1b1512'];
const HIJAB = ['#ec6db0', '#3cc44c', '#7c5cd6', '#f4a261', '#ffffff', '#2a9d8f', '#e9c46a', '#264653'];
const SHOES = ['#2b2b30', '#f4f4f4', '#7a4f2e', '#e8545c', '#2d3a55'];

// joints (adult, standing)
export const RIG = { hip: 0.74, knee: 0.4, shoulder: 1.2, shoulderX: 0.215 };

const VERT_HEAD = `
attribute float aPart;
uniform vec4 uLeg;   // hip L, hip R, knee L, knee R (radians, about x)
uniform vec4 uArm;   // shoulder swing L, R (about x), raise L, R (about z)
uniform float uLean; // upper body lean (about x, at the hip)
vec3 rotXp(vec3 p, vec3 o, float a) { p -= o; float c = cos(a); float s = sin(a); return vec3(p.x, p.y * c - p.z * s, p.y * s + p.z * c) + o; }
vec3 rotZp(vec3 p, vec3 o, float a) { p -= o; float c = cos(a); float s = sin(a); return vec3(p.x * c - p.y * s, p.x * s + p.y * c, p.z) + o; }
vec3 rigPose(vec3 p, float k) {
  int part = int(aPart + 0.5);
  if (part == 3) p = rotXp(p, k * vec3(0.0, ${RIG.knee.toFixed(3)}, 0.0), uLeg.z);
  if (part == 4) p = rotXp(p, k * vec3(0.0, ${RIG.knee.toFixed(3)}, 0.0), uLeg.w);
  if (part == 1 || part == 3) p = rotXp(p, k * vec3(0.0, ${RIG.hip.toFixed(3)}, 0.0), uLeg.x);
  if (part == 2 || part == 4) p = rotXp(p, k * vec3(0.0, ${RIG.hip.toFixed(3)}, 0.0), uLeg.y);
  if (part == 5) { vec3 o = k * vec3(-${RIG.shoulderX.toFixed(3)}, ${RIG.shoulder.toFixed(3)}, 0.0); p = rotZp(p, o, uArm.z); p = rotXp(p, o, uArm.x); }
  if (part == 6) { vec3 o = k * vec3(${RIG.shoulderX.toFixed(3)}, ${RIG.shoulder.toFixed(3)}, 0.0); p = rotZp(p, o, uArm.w); p = rotXp(p, o, uArm.y); }
  if (part >= 5) p = rotXp(p, k * vec3(0.0, ${RIG.hip.toFixed(3)}, 0.0), uLean);
  return p;
}
`;

function personMaterial() {
  const uniforms = { uLeg: { value: new THREE.Vector4() }, uArm: { value: new THREE.Vector4(0, 0, -0.08, 0.08) }, uLean: { value: 0 } };
  const m = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.7 });
  m.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, uniforms);
    sh.vertexShader = VERT_HEAD + sh.vertexShader
      .replace('#include <beginnormal_vertex>', '#include <beginnormal_vertex>\n  objectNormal = rigPose(objectNormal, 0.0);')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\n  transformed = rigPose(transformed, 1.0);');
    sh.fragmentShader = sh.fragmentShader.replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
      totalEmissiveRadiance += vColor.rgb * 0.16;`);
  };
  m.customProgramCacheKey = () => 'fdc-person-rig';
  m.userData.rig = uniforms;
  return m;
}

const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _e = new THREE.Euler();
function part(list, geo, color, k, x = 0, y = 0, z = 0, { rx = 0, ry = 0, rz = 0, sx = 1, sy = 1, sz = 1 } = {}) {
  const g = geo.index ? geo.toNonIndexed() : geo.clone();
  for (const a of Object.keys(g.attributes)) if (a !== 'position' && a !== 'normal') g.deleteAttribute(a);
  g.applyMatrix4(_m.compose(new THREE.Vector3(x, y, z), _q.setFromEuler(_e.set(rx, ry, rz)), new THREE.Vector3(sx, sy, sz)));
  const c = new THREE.Color(color);
  const n = g.attributes.position.count;
  const arr = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) arr.set([c.r, c.g, c.b], i * 3);
  g.setAttribute('color', new THREE.BufferAttribute(arr, 3));
  g.setAttribute('aPart', new THREE.BufferAttribute(new Float32Array(n).fill(k), 1));
  list.push(g);
}

const G = {
  // low-poly on purpose: a crowd of these must stay cheap on the Quest
  body: new THREE.CapsuleGeometry(0.165, 0.27, 2, 9),
  pelvis: new THREE.SphereGeometry(0.16, 8, 4),
  thigh: new THREE.CapsuleGeometry(0.074, 0.2, 1, 6),
  shin: new THREE.CapsuleGeometry(0.062, 0.22, 1, 6),
  shoe: new THREE.BoxGeometry(0.12, 0.08, 0.22),
  arm: new THREE.CapsuleGeometry(0.05, 0.33, 1, 6),
  sleeve: new THREE.CylinderGeometry(0.065, 0.06, 0.17, 7, 1, true),
  hand: new THREE.SphereGeometry(0.052, 6, 4),
  neck: new THREE.CylinderGeometry(0.06, 0.065, 0.1, 6, 1, true),
  head: new THREE.SphereGeometry(0.158, 12, 8),
  ear: new THREE.SphereGeometry(0.035, 5, 3),
  eye: new THREE.SphereGeometry(0.024, 6, 4),
  shine: new THREE.SphereGeometry(0.008, 3, 2),
  brow: new THREE.BoxGeometry(0.05, 0.012, 0.01),
  nose: new THREE.SphereGeometry(0.022, 5, 3),
  smile: new THREE.TorusGeometry(0.045, 0.011, 3, 8, Math.PI),
  cheek: new THREE.SphereGeometry(0.028, 5, 3),
  hair: new THREE.SphereGeometry(0.168, 10, 5, 0, Math.PI * 2, 0, Math.PI * 0.55),
  hairBack: new THREE.SphereGeometry(0.168, 8, 4, Math.PI * 0.15, Math.PI * 0.7, Math.PI * 0.35, Math.PI * 0.45),
  hijab: new THREE.SphereGeometry(0.182, 10, 6, 0, Math.PI * 2, 0, Math.PI * 0.72),
  hijabDrape: new THREE.ConeGeometry(0.24, 0.32, 10, 1, true),
  cap: new THREE.CylinderGeometry(0.165, 0.168, 0.07, 10),
  brim: new THREE.CylinderGeometry(0.12, 0.12, 0.018, 6, 1, false, -Math.PI / 2, Math.PI),
  peci: new THREE.CylinderGeometry(0.15, 0.16, 0.11, 10),
  bun: new THREE.SphereGeometry(0.075, 6, 4),
  collar: new THREE.TorusGeometry(0.075, 0.018, 3, 8),
  bag: new THREE.BoxGeometry(0.2, 0.26, 0.1),
  strap: new THREE.BoxGeometry(0.03, 0.4, 0.02),
  skirt: new THREE.CylinderGeometry(0.17, 0.27, 0.42, 10, 1, true),
  belt: new THREE.CylinderGeometry(0.168, 0.168, 0.04, 9, 1, true),
  glasses: new THREE.TorusGeometry(0.032, 0.006, 3, 8),
};

/**
 * A random person. Pass `seed` to rebuild the same person (a passenger keeps their look when
 * they get up). `seated` starts them in the sitting pose.
 */
export function makePerson(rand = Math.random, { seated = false, kid = null, wave = false, seed = null } = {}) {
  const sd = seed ?? Math.floor(rand() * 1e9);
  let a = sd >>> 0;
  const r = () => { a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  const pick = (arr) => arr[Math.floor(r() * arr.length)];
  const isKid = kid ?? r() < 0.3;
  const skin = pick(SKIN);
  const shirt = pick(SHIRT);
  const pants = pick(PANTS);
  const shoes = pick(SHOES);
  const hairC = pick(HAIR);
  const style = r();
  const female = style < 0.55;
  const school = isKid && r() < 0.5; // SD uniform: white shirt, red shorts / skirt
  const top = school ? '#ffffff' : shirt;
  const bottom = school ? '#c81e2c' : pants;
  const longSleeve = !isKid && r() < 0.3;
  const skirt = female && (school || r() < 0.45);
  const list = [];
  const H = RIG.hip;
  // legs: thighs (1 L, 2 R), shins + shoes (3 L, 4 R)
  for (const [s, kt, ks] of [[-1, 1, 3], [1, 2, 4]]) {
    part(list, G.thigh, skirt ? skin : bottom, kt, s * 0.09, (H + RIG.knee) / 2, 0);
    part(list, G.shin, skirt || isKid ? skin : bottom, ks, s * 0.09, 0.25, 0);
    part(list, G.shoe, shoes, ks, s * 0.09, 0.04, 0.035);
    if (isKid) part(list, new THREE.CylinderGeometry(0.066, 0.066, 0.08, 6, 1, true), '#ffffff', ks, s * 0.09, 0.12, 0); // socks
  }
  part(list, G.pelvis, bottom, 0, 0, H + 0.02, 0, { sy: 0.7, sz: 0.85 });
  if (skirt) part(list, G.skirt, bottom, 0, 0, H - 0.08, 0);
  // upper body (7) leans as one
  part(list, G.body, top, 7, 0, 1.02, 0, { sz: 0.82 });
  if (!skirt && !female) part(list, G.belt, '#2b2b30', 7, 0, H + 0.08, 0, { sz: 0.82 });
  if (!female || school) part(list, G.collar, school ? '#ffffff' : pick(SHIRT), 7, 0, 1.3, 0.0, { rx: Math.PI / 2, sz: 0.8 });
  if (school) part(list, new THREE.BoxGeometry(0.04, 0.16, 0.02), '#c81e2c', 7, 0, 1.2, 0.14); // red tie
  // arms (5 L, 6 R): sleeve + bare arm + hand
  for (const [s, k] of [[-1, 5], [1, 6]]) {
    const x = s * RIG.shoulderX;
    part(list, G.arm, longSleeve ? top : skin, k, x, 0.98, 0);
    part(list, G.sleeve, top, k, x, 1.13, 0);
    part(list, G.hand, skin, k, x, 0.74, 0.01);
  }
  // head
  const hy = 1.5;
  part(list, G.neck, skin, 7, 0, 1.34, 0);
  part(list, G.head, skin, 7, 0, hy, 0, { sy: 1.02 });
  for (const s of [-1, 1]) {
    part(list, G.ear, skin, 7, s * 0.155, hy, 0, { sx: 0.5 });
    part(list, G.eye, '#1d1d22', 7, s * 0.058, hy + 0.02, 0.138, { sy: 1.25, sz: 0.55 });
    part(list, G.shine, '#ffffff', 7, s * 0.058 + 0.008, hy + 0.035, 0.152);
    part(list, G.brow, hairC, 7, s * 0.06, hy + 0.075, 0.143, { rz: s * -0.12 });
    part(list, G.cheek, '#ff9fb2', 7, s * 0.095, hy - 0.03, 0.118, { sz: 0.35 });
  }
  part(list, G.nose, skin, 7, 0, hy - 0.01, 0.155, { sz: 0.7 });
  part(list, G.smile, '#c4385e', 7, 0, hy - 0.045, 0.142, { rz: Math.PI, sz: 0.6 });
  if (!isKid && r() < 0.18) for (const s of [-1, 1]) part(list, G.glasses, '#1d1d22', 7, s * 0.058, hy + 0.02, 0.16);
  // hair / hijab / cap / peci
  const hs = r();
  if (female && !isKid && hs < 0.45) {
    const hj = pick(HIJAB);
    part(list, G.hijab, hj, 7, 0, hy + 0.005, -0.012, { rx: -0.38, sz: 1.05 });
    part(list, G.hijabDrape, hj, 7, 0, hy - 0.19, -0.015, { sz: 0.85 });
  } else if (female) {
    part(list, G.hair, hairC, 7, 0, hy + 0.012, -0.008, { rx: -0.28 });
    if (hs < 0.75) part(list, G.hairBack, hairC, 7, 0, hy - 0.06, -0.012, { sy: 1.5, rx: 0.1 }); // long hair down the back
    else part(list, G.bun, hairC, 7, 0, hy + 0.05, -0.16);
    if (isKid) for (const s of [-1, 1]) part(list, G.bun, hairC, 7, s * 0.15, hy + 0.05, -0.04, { sx: 0.7, sy: 0.7, sz: 0.7 }); // pigtails
  } else if (hs < 0.25 && !isKid) {
    part(list, G.hair, hairC, 7, 0, hy + 0.0, -0.01, { rx: -0.25, sy: 0.85 });
    part(list, G.peci, '#1b1b1f', 7, 0, hy + 0.12, -0.01, { sz: 0.92 });
  } else if (hs < 0.55) {
    const cc = pick(SHIRT);
    part(list, G.hair, hairC, 7, 0, hy + 0.0, -0.01, { rx: -0.25 });
    part(list, G.cap, cc, 7, 0, hy + 0.11, 0);
    part(list, G.brim, cc, 7, 0, hy + 0.085, 0.07, { sx: 1.1 });
  } else {
    part(list, G.hair, hairC, 7, 0, hy + 0.012, -0.01, { rx: -0.22 });
  }
  // a bag or a school backpack
  if (isKid && school) part(list, G.bag, pick(['#4a9be8', '#ec6db0', '#3cc44c', '#ffb13b']), 7, 0, 1.05, -0.2, { sx: 1.3, sy: 1.15, sz: 1.2 });
  else if (r() < 0.35) {
    const bc = pick(['#7a4f2e', '#2b2b30', '#ec6db0', '#e9c46a']);
    part(list, G.bag, bc, 6, 0.27, 0.86, 0, { sx: 0.5, sy: 0.9, sz: 1.4 });
    part(list, G.strap, bc, 6, 0.25, 1.06, 0, { rz: 0.05 });
  }
  const geo = mergeGeometries(list, false);
  for (const g of list) g.dispose();
  geo.computeBoundingSphere();
  geo.boundingSphere.radius = Math.max(geo.boundingSphere.radius, 1.1); // poses reach further than the rest pose
  const mesh = new THREE.Mesh(geo, personMaterial());
  if (isKid) mesh.scale.setScalar(0.68);
  mesh.userData.kid = isKid;
  mesh.userData.seed = sd;
  mesh.userData.wave = wave;
  mesh.userData.sit = seated ? 1 : 0;
  mesh.userData.scale = isKid ? 0.68 : 1;
  setPose(mesh, seated ? SIT : STAND);
  return mesh;
}

const STAND = { hipL: 0, hipR: 0, kneeL: 0, kneeR: 0, armLx: 0, armRx: 0, armLz: -0.08, armRz: 0.08, lean: 0 };
const SIT = { hipL: -1.5, hipR: -1.5, kneeL: 1.45, kneeR: 1.45, armLx: -0.55, armRx: -0.55, armLz: -0.05, armRz: 0.05, lean: 0.05 };

function setPose(p, o) {
  const u = p.material.userData.rig;
  u.uLeg.value.set(o.hipL, o.hipR, o.kneeL, o.kneeR);
  u.uArm.value.set(o.armLx, o.armRx, o.armLz, o.armRz);
  u.uLean.value = o.lean;
}

const pose = { ...STAND };
/**
 * Per-frame animation.
 *   mode: 'idle' | 'walk' | 'hop' (cheering) | 'wave'
 *   p.userData.sit (0..1) blends towards sitting; p.userData.wave makes idle people wave.
 */
export function animatePerson(p, t, mode = 'idle', phase = 0) {
  const base = p.userData.baseY ?? 0;
  const sit = p.userData.sit ?? 0;
  Object.assign(pose, STAND);
  let y = 0;
  let rz = 0;
  if (mode === 'walk') {
    const ph = t * 8.5 + phase;
    const s = Math.sin(ph);
    pose.hipL = -0.5 * s;
    pose.hipR = 0.5 * s;
    pose.kneeL = 0.12 + 0.7 * Math.max(0, Math.sin(ph - 1.3));
    pose.kneeR = 0.12 + 0.7 * Math.max(0, Math.sin(ph + Math.PI - 1.3));
    pose.armLx = 0.45 * s;
    pose.armRx = -0.45 * s;
    pose.lean = 0.06;
    y = Math.abs(Math.cos(ph)) * 0.035;
    rz = Math.sin(ph) * 0.025;
  } else if (mode === 'hop') {
    const ph = t * 7 + phase;
    y = Math.max(0, Math.sin(ph)) * 0.18;
    const k = 0.5 + 0.5 * Math.sin(ph * 2);
    pose.armLz = -2.5 - 0.3 * k;
    pose.armRz = 2.5 + 0.3 * k;
    pose.kneeL = pose.kneeR = y > 0.02 ? 0.3 : 0.1;
    pose.hipL = pose.hipR = y > 0.02 ? -0.2 : 0;
  } else {
    y = Math.sin(t * 2 + phase) * 0.006;
    rz = Math.sin(t * 1.3 + phase) * 0.02;
    pose.armLx = Math.sin(t * 1.1 + phase) * 0.04;
    pose.armRx = -pose.armLx;
    if (mode === 'wave' || p.userData.wave) {
      pose.armRz = 2.55 + Math.sin(t * 9 + phase) * 0.35;
      pose.armRx = -0.2;
    }
  }
  if (sit > 0) {
    for (const k of Object.keys(pose)) pose[k] += (SIT[k] - pose[k]) * sit;
    if (sit >= 1) { y = Math.sin(t * 2 + phase) * 0.003; rz = 0; }
    if (sit >= 1 && p.userData.wave) { pose.armRz = 2.4 + Math.sin(t * 9 + phase) * 0.3; pose.armRx = -0.4; }
  }
  setPose(p, pose);
  p.position.y = base + y;
  p.rotation.z = rz;
}

/** Height of the standing hip above the feet (for placing someone on a seat). */
export const hipHeight = (p) => RIG.hip * (p.userData.scale || 1);

// ------------------------------------------------------------------ soft blob shadows
let blobTex = null;
export function blobTexture() {
  if (blobTex) return blobTex;
  const cv = document.createElement('canvas');
  cv.width = cv.height = 64;
  const c = cv.getContext('2d');
  const g = c.createRadialGradient(32, 32, 2, 32, 32, 31);
  g.addColorStop(0, 'rgba(0,0,0,0.55)');
  g.addColorStop(0.55, 'rgba(0,0,0,0.3)');
  g.addColorStop(1, 'rgba(0,0,0,0)');
  c.fillStyle = g;
  c.fillRect(0, 0, 64, 64);
  blobTex = new THREE.CanvasTexture(cv);
  return blobTex;
}

/** One instanced mesh of soft shadows under everyone walking or standing around (1 draw call). */
export class ShadowPool {
  constructor(max = 96) {
    const geo = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2);
    this.mesh = new THREE.InstancedMesh(geo, new THREE.MeshBasicMaterial({ map: blobTexture(), transparent: true, depthWrite: false, opacity: 0.7, polygonOffset: true, polygonOffsetFactor: -4 }), max);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 1;
    this.max = max;
    this.m = new THREE.Matrix4();
    this.v = new THREE.Vector3();
    this.q = new THREE.Quaternion();
    this.s = new THREE.Vector3();
  }

  update(people) {
    let n = 0;
    for (const p of people) {
      if (n >= this.max) break;
      if (!p.visible || !p.parent || p.userData.noShadow) continue;
      p.getWorldPosition(this.v);
      const k = (p.userData.scale || 1) * 0.62;
      this.v.y = (p.userData.groundY ?? this.v.y - (p.position.y - (p.userData.baseY ?? 0))) + 0.012;
      this.m.compose(this.v, this.q, this.s.set(k, 1, k * 0.9));
      this.mesh.setMatrixAt(n++, this.m);
    }
    this.mesh.count = n;
    this.mesh.instanceMatrix.needsUpdate = true;
  }
}
