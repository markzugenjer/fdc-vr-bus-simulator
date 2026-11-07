import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

/**
 * Cartoon townsfolk and passengers. Each person is ONE merged mesh (vertex colours), so a crowd
 * costs one draw call per person. They don't have moving limbs: they bob, hop, sway and turn,
 * which reads well from a bus and keeps everything cheap.
 */
const SKIN = ['#f1c7a3', '#e0ad84', '#c98f63', '#a8714a', '#f6d5b8'];
const SHIRT = ['#ec6db0', '#3cc44c', '#4a9be8', '#ffb13b', '#ffffff', '#b38cf0', '#ff7a6b', '#2fb5a6'];
const PANTS = ['#2d3a55', '#4b5563', '#7a5a3a', '#334155', '#1f2937'];
const HAIR = ['#2a1d16', '#3b2a1e', '#16110d', '#5a3b22'];
const HIJAB = ['#ec6db0', '#3cc44c', '#7c5cd6', '#f4a261', '#ffffff', '#2a9d8f'];

let material = null;
function mat() {
  if (!material) {
    material = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.7 });
    material.onBeforeCompile = (sh) => {
      sh.fragmentShader = sh.fragmentShader.replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
        totalEmissiveRadiance += vColor.rgb * 0.18;`);
    };
  }
  return material;
}

function part(list, geo, color, x = 0, y = 0, z = 0, { rx = 0, ry = 0, rz = 0, sx = 1, sy = 1, sz = 1 } = {}) {
  const g = geo.index ? geo.toNonIndexed() : geo.clone();
  for (const k of Object.keys(g.attributes)) if (k !== 'position' && k !== 'normal') g.deleteAttribute(k);
  g.applyMatrix4(new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(rx, ry, rz)), new THREE.Vector3(sx, sy, sz)));
  const c = new THREE.Color(color);
  const n = g.attributes.position.count;
  const arr = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) arr.set([c.r, c.g, c.b], i * 3);
  g.setAttribute('color', new THREE.BufferAttribute(arr, 3));
  list.push(g);
}

const G = {
  // low-poly on purpose: a crowd of these must stay cheap on the Quest
  body: new THREE.CapsuleGeometry(0.17, 0.32, 2, 8),
  leg: new THREE.CapsuleGeometry(0.065, 0.36, 1, 6),
  arm: new THREE.CapsuleGeometry(0.05, 0.3, 1, 6),
  head: new THREE.SphereGeometry(0.15, 12, 8),
  eye: new THREE.SphereGeometry(0.022, 6, 4),
  smile: new THREE.TorusGeometry(0.04, 0.01, 3, 8, Math.PI),
  hair: new THREE.SphereGeometry(0.155, 10, 6, 0, Math.PI * 2, 0, Math.PI * 0.55),
  hijab: new THREE.SphereGeometry(0.175, 10, 7, 0, Math.PI * 2, 0, Math.PI * 0.75),
  cap: new THREE.CylinderGeometry(0.16, 0.16, 0.06, 10),
  brim: new THREE.BoxGeometry(0.2, 0.02, 0.14),
  bag: new THREE.BoxGeometry(0.18, 0.22, 0.08),
};

/**
 * A random person. `seated` bends the legs forward (for bus seats).
 * Returns a Mesh whose origin is between the feet (standing) or under the hips (seated).
 */
export function makePerson(rand = Math.random, { seated = false, kid = null, wave = false } = {}) {
  const pick = (a) => a[Math.floor(rand() * a.length)];
  const isKid = kid ?? rand() < 0.3;
  const skin = pick(SKIN);
  const shirt = pick(SHIRT);
  const pants = pick(PANTS);
  const style = rand();
  const list = [];
  const legY = seated ? 0.12 : 0.25;
  // legs
  for (const s of [-1, 1]) {
    if (seated) part(list, G.leg, pants, s * 0.09, 0.08, -0.2, { rx: Math.PI / 2 });
    else part(list, G.leg, pants, s * 0.09, legY, 0);
    part(list, new THREE.BoxGeometry(0.11, 0.06, 0.18), '#2b2b30', s * 0.09, seated ? -0.18 : 0.03, seated ? -0.42 : 0.03);
  }
  const hip = seated ? 0.1 : 0.5;
  part(list, G.body, shirt, 0, hip + 0.3, 0);
  // arms (one raised when waving)
  part(list, G.arm, shirt, -0.22, hip + 0.32, 0, { rz: 0.15 });
  if (wave) part(list, G.arm, shirt, 0.25, hip + 0.62, 0, { rz: -2.6 });
  else part(list, G.arm, shirt, 0.22, hip + 0.32, seated ? -0.08 : 0, { rz: -0.15, rx: seated ? 0.5 : 0 });
  const hy = hip + 0.78;
  part(list, G.head, skin, 0, hy, 0);
  // face
  for (const s of [-1, 1]) part(list, G.eye, '#1d1d22', s * 0.05, hy + 0.02, 0.135, { sz: 0.5 });
  part(list, G.smile, '#d9436a', 0, hy - 0.035, 0.135, { rz: Math.PI });
  part(list, new THREE.SphereGeometry(0.025, 6, 4), '#ff9fb2', -0.09, hy - 0.02, 0.12, { sz: 0.3 });
  part(list, new THREE.SphereGeometry(0.025, 6, 4), '#ff9fb2', 0.09, hy - 0.02, 0.12, { sz: 0.3 });
  // hair / hijab / cap
  if (style < 0.3) {
    part(list, G.hijab, pick(HIJAB), 0, hy + 0.0, -0.015, { rx: -0.35, sz: 1.05 });
    part(list, new THREE.ConeGeometry(0.2, 0.25, 14), pick(HIJAB), 0, hy - 0.2, -0.02);
  } else if (style < 0.55) {
    part(list, G.hair, pick(HAIR), 0, hy + 0.01, -0.01, { rx: -0.25 });
    part(list, new THREE.SphereGeometry(0.07, 8, 6), pick(HAIR), 0, hy + 0.02, -0.16); // bun
  } else if (style < 0.75) {
    part(list, G.hair, pick(HAIR), 0, hy + 0.01, -0.01, { rx: -0.25 });
    part(list, G.cap, pick(SHIRT), 0, hy + 0.1, 0);
    part(list, G.brim, pick(SHIRT), 0, hy + 0.08, 0.12);
  } else {
    part(list, G.hair, pick(HAIR), 0, hy + 0.01, -0.01, { rx: -0.25 });
  }
  if (!seated && rand() < 0.4) part(list, G.bag, pick(SHIRT), 0, hip + 0.35, -0.2);
  const geo = mergeGeometries(list, false);
  for (const g of list) g.dispose();
  const mesh = new THREE.Mesh(geo, mat());
  if (isKid) mesh.scale.setScalar(0.72);
  mesh.userData.kid = isKid;
  return mesh;
}

/** Simple per-frame animation for a person: idle bob, walking bounce, happy hops. */
export function animatePerson(p, t, mode = 'idle', phase = 0) {
  const base = p.userData.baseY ?? 0;
  if (mode === 'walk') {
    p.position.y = base + Math.abs(Math.sin(t * 9 + phase)) * 0.06;
    p.rotation.z = Math.sin(t * 9 + phase) * 0.06;
  } else if (mode === 'hop') {
    p.position.y = base + Math.max(0, Math.sin(t * 7 + phase)) * 0.18;
    p.rotation.z = 0;
  } else {
    p.position.y = base + Math.sin(t * 2 + phase) * 0.01;
    p.rotation.z = Math.sin(t * 1.3 + phase) * 0.03;
  }
}
