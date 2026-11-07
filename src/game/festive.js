import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

/**
 * Festive props for horizons, built for the Quest: static pieces are merged into ONE mesh
 * (vertex colours), and everything that repeats (flags, bulbs, balloons, petals, butterflies)
 * is instanced. A whole decorated plaza costs only a few dozen draw calls.
 */

// ------------------------------------------------------------------ static batch
/**
 * Collects simple coloured shapes and merges them into a single mesh.
 *   const kit = new StaticKit();
 *   kit.add(new THREE.BoxGeometry(1, 1, 1), '#ff8899', { x, y, z, ry });
 *   group.add(kit.build());
 */
export class StaticKit {
  constructor() { this.parts = []; }

  add(geo, color, { x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0, sx = 1, sy = 1, sz = 1, parent = null } = {}) {
    const g = (geo.index ? geo.toNonIndexed() : geo.clone());
    for (const k of Object.keys(g.attributes)) if (k !== 'position' && k !== 'normal') g.deleteAttribute(k);
    const m = new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(rx, ry, rz)), new THREE.Vector3(sx, sy, sz));
    if (parent) m.premultiply(parent);
    g.applyMatrix4(m);
    const col = new THREE.Color(color);
    const n = g.attributes.position.count;
    const arr = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) { arr[i * 3] = col.r; arr[i * 3 + 1] = col.g; arr[i * 3 + 2] = col.b; }
    g.setAttribute('color', new THREE.BufferAttribute(arr, 3));
    this.parts.push(g);
    return this;
  }

  /** `glow` adds some of each part's own colour as light (for interiors the sun can't reach). */
  build({ roughness = 0.75, metalness = 0, flat = false, glow = 0 } = {}) {
    const geo = mergeGeometries(this.parts, false);
    for (const p of this.parts) p.dispose();
    this.parts = [];
    const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness, metalness, flatShading: flat });
    if (glow) {
      mat.onBeforeCompile = (sh) => {
        sh.fragmentShader = sh.fragmentShader.replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
          totalEmissiveRadiance += vColor.rgb * ${glow.toFixed(3)};`);
      };
    }
    const mesh = new THREE.Mesh(geo, mat);
    mesh.matrixAutoUpdate = false;
    return mesh;
  }
}

/** A matrix helper for placing a group of parts (a stall, a bench) as one. */
export const place = (x, z, ry = 0, y = 0) => new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(0, ry, 0)), new THREE.Vector3(1, 1, 1));

// ------------------------------------------------------------------ textures
export function stripeTexture(a, b, stripes = 8, { scallop = false } = {}) {
  const cv = document.createElement('canvas');
  cv.width = 256;
  cv.height = scallop ? 64 : 256;
  const c = cv.getContext('2d');
  const w = cv.width / stripes;
  for (let i = 0; i < stripes; i++) {
    c.fillStyle = i % 2 ? b : a;
    if (scallop) {
      c.beginPath();
      c.moveTo(i * w, 0);
      c.lineTo((i + 1) * w, 0);
      c.lineTo((i + 1) * w, cv.height * 0.45);
      c.arc((i + 0.5) * w, cv.height * 0.45, w / 2, 0, Math.PI);
      c.closePath();
      c.fill();
    } else c.fillRect(i * w, 0, w, cv.height);
  }
  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

// ------------------------------------------------------------------ bunting + string lights
/**
 * Triangle flags and little bulbs hanging on sagging ropes between pairs of points.
 * Flags flutter in the wind (in the vertex shader, so it costs nothing per frame).
 */
export function makeBunting(strands, { colors, flagW = 0.22, flagH = 0.28, gap = 0.48, bulbs = true, bulbGap = 0.5 } = {}) {
  const group = new THREE.Group();
  const curve = (a, b, sag, t, out) => out.lerpVectors(a, b, t).setY(THREE.MathUtils.lerp(a.y, b.y, t) - sag * 4 * t * (1 - t));
  // count
  let flags = 0;
  let lights = 0;
  for (const s of strands) {
    const len = s.a.distanceTo(s.b);
    flags += Math.max(2, Math.floor(len / gap));
    if (bulbs) lights += Math.max(2, Math.floor(len / bulbGap));
  }
  const tri = new THREE.BufferGeometry();
  tri.setAttribute('position', new THREE.Float32BufferAttribute([-flagW / 2, 0, 0, flagW / 2, 0, 0, 0, -flagH, 0], 3));
  tri.setAttribute('normal', new THREE.Float32BufferAttribute([0, 0, 1, 0, 0, 1, 0, 0, 1], 3));
  // a touch of emissive keeps the flags bright from underneath (both sides face the sun badly)
  const flagMat = new THREE.MeshStandardMaterial({ side: THREE.DoubleSide, roughness: 0.7, emissive: '#3a3a3a' });
  const uniforms = { uTime: { value: 0 } };
  flagMat.onBeforeCompile = (sh) => {
    sh.uniforms.uTime = uniforms.uTime;
    sh.vertexShader = 'uniform float uTime;\n' + sh.vertexShader.replace('#include <begin_vertex>', `#include <begin_vertex>
      #ifdef USE_INSTANCING
        float ph = instanceMatrix[3].x * 1.3 + instanceMatrix[3].z * 0.9;
        transformed.z += sin(uTime * 3.2 + ph) * 0.09 * (-position.y / ${flagH.toFixed(3)});
      #endif`);
  };
  const flagMesh = new THREE.InstancedMesh(tri, flagMat, flags);
  const bulbMesh = bulbs ? new THREE.InstancedMesh(new THREE.SphereGeometry(0.045, 6, 4), new THREE.MeshBasicMaterial({ toneMapped: false }), lights) : null;
  const ropePts = [];
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const p = new THREE.Vector3();
  const p2 = new THREE.Vector3();
  const col = new THREE.Color();
  const one = new THREE.Vector3(1, 1, 1);
  let fi = 0;
  let li = 0;
  for (const s of strands) {
    const len = s.a.distanceTo(s.b);
    const sag = s.sag ?? len * 0.08;
    const seg = 16;
    for (let k = 0; k < seg; k++) {
      ropePts.push(curve(s.a, s.b, sag, k / seg, new THREE.Vector3()), curve(s.a, s.b, sag, (k + 1) / seg, new THREE.Vector3()));
    }
    const n = Math.max(2, Math.floor(len / gap));
    const yaw = -Math.atan2(s.b.z - s.a.z, s.b.x - s.a.x);
    for (let k = 0; k < n; k++) {
      const t = (k + 0.5) / n;
      curve(s.a, s.b, sag, t, p);
      curve(s.a, s.b, sag, Math.min(1, t + 0.01), p2);
      const tilt = Math.atan2(p2.y - p.y, Math.hypot(p2.x - p.x, p2.z - p.z));
      q.setFromEuler(new THREE.Euler(0, yaw, tilt, 'YXZ'));
      m.compose(p, q, one);
      flagMesh.setMatrixAt(fi, m);
      flagMesh.setColorAt(fi, col.set(colors[fi % colors.length]));
      fi++;
    }
    if (bulbMesh) {
      const nb = Math.max(2, Math.floor(len / bulbGap));
      for (let k = 0; k < nb; k++) {
        curve(s.a, s.b, sag, (k + 0.25) / nb, p);
        p.y -= 0.05;
        m.makeTranslation(p.x, p.y, p.z);
        bulbMesh.setMatrixAt(li, m);
        bulbMesh.setColorAt(li, col.set('#fff3c0'));
        li++;
      }
    }
  }
  flagMesh.instanceColor.needsUpdate = true;
  flagMesh.frustumCulled = false;
  group.add(flagMesh);
  const rope = new THREE.LineSegments(new THREE.BufferGeometry().setFromPoints(ropePts), new THREE.LineBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0.8 }));
  rope.frustumCulled = false;
  group.add(rope);
  if (bulbMesh) { bulbMesh.frustumCulled = false; group.add(bulbMesh); }

  const warm = new THREE.Color('#fff1b8');
  const dim = new THREE.Color('#d9c48a');
  const tint = [new THREE.Color('#ffd1dc'), new THREE.Color('#c9f2e2'), new THREE.Color('#fff1b8')];
  let acc = 0;
  return {
    group,
    update(dt, t) {
      uniforms.uTime.value = t;
      if (!bulbMesh) return;
      acc += dt;
      if (acc < 0.15) return; // twinkle a few times a second, not every frame
      acc = 0;
      for (let i = 0; i < li; i++) {
        const on = Math.sin(t * 2.2 + i * 0.9) > -0.6;
        bulbMesh.setColorAt(i, on ? (i % 3 === 0 ? tint[(i / 3) % 3 | 0] : warm) : dim);
      }
      bulbMesh.instanceColor.needsUpdate = true;
    },
  };
}

// ------------------------------------------------------------------ balloons
/**
 * Balloon bunches tied to anchors: [{ x, y, z, n }]. They bob and sway; the strings follow.
 */
export function makeBalloons(anchors, { colors = ['#f6a5c0', '#8fd8c0', '#ffd45c', '#ffffff', '#a8d8f0', '#c8b3f2', '#ff8f8f'], rand = Math.random } = {}) {
  const list = [];
  for (const a of anchors) {
    const n = a.n ?? 5;
    for (let i = 0; i < n; i++) {
      const ang = (i / n) * Math.PI * 2 + rand();
      const r = 0.12 + rand() * 0.18;
      list.push({
        ax: a.x, ay: a.y, az: a.z,
        ox: Math.cos(ang) * r, oz: Math.sin(ang) * r, oy: (a.len ?? 0.9) + rand() * 0.35,
        ph: rand() * 6.28, sp: 0.7 + rand() * 0.6, size: (a.size ?? 0.17) * (0.85 + rand() * 0.3),
        color: colors[Math.floor(rand() * colors.length)],
      });
    }
  }
  const geo = new THREE.SphereGeometry(1, 10, 8);
  // a little knot at the bottom
  const pos = geo.attributes.position;
  for (let i = 0; i < pos.count; i++) { const y = pos.getY(i); if (y < 0) pos.setY(i, y * (1 + -y * 0.25)); }
  geo.computeVertexNormals();
  const mesh = new THREE.InstancedMesh(geo, new THREE.MeshStandardMaterial({ roughness: 0.25, metalness: 0.05, emissive: '#ffffff', emissiveIntensity: 0.06 }), list.length);
  const col = new THREE.Color();
  list.forEach((b, i) => mesh.setColorAt(i, col.set(b.color)));
  mesh.instanceColor.needsUpdate = true;
  mesh.frustumCulled = false;
  const strPos = new Float32Array(list.length * 6);
  const strGeo = new THREE.BufferGeometry();
  strGeo.setAttribute('position', new THREE.BufferAttribute(strPos, 3));
  const strings = new THREE.LineSegments(strGeo, new THREE.LineBasicMaterial({ color: '#f4f4f4', transparent: true, opacity: 0.7 }));
  strings.frustumCulled = false;
  const group = new THREE.Group();
  group.add(mesh, strings);
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const s = new THREE.Vector3();
  const p = new THREE.Vector3();
  const e = new THREE.Euler();
  const update = (dt, t) => {
    list.forEach((b, i) => {
      const sx = Math.sin(t * b.sp + b.ph) * 0.06;
      const sz = Math.cos(t * b.sp * 0.8 + b.ph) * 0.05;
      p.set(b.ax + b.ox + sx, b.ay + b.oy + Math.sin(t * b.sp * 1.3 + b.ph) * 0.04, b.az + b.oz + sz);
      e.set(sz * 2, 0, -sx * 2);
      q.setFromEuler(e);
      m.compose(p, q, s.set(b.size, b.size * 1.18, b.size));
      mesh.setMatrixAt(i, m);
      strPos.set([b.ax, b.ay, b.az, p.x, p.y - b.size * 1.2, p.z], i * 6);
    });
    mesh.instanceMatrix.needsUpdate = true;
    strGeo.attributes.position.needsUpdate = true;
  };
  update(0, 0);
  return { group, update };
}

// ------------------------------------------------------------------ petals + butterflies
/** Pink blossom petals drifting down over an area. */
export function makePetals({ count = 70, radius = 12, top = 6, color = '#ffc4d6', rand = Math.random } = {}) {
  const geo = new THREE.PlaneGeometry(0.06, 0.045);
  const mesh = new THREE.InstancedMesh(geo, new THREE.MeshBasicMaterial({ color, side: THREE.DoubleSide, transparent: true, opacity: 0.9 }), count);
  mesh.frustumCulled = false;
  const ps = Array.from({ length: count }, () => ({ x: (rand() - 0.5) * radius * 2, y: rand() * top, z: (rand() - 0.5) * radius * 2, ph: rand() * 6.28, sp: 0.25 + rand() * 0.3 }));
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const e = new THREE.Euler();
  const p = new THREE.Vector3();
  const one = new THREE.Vector3(1, 1, 1);
  return {
    group: mesh,
    update(dt, t) {
      ps.forEach((o, i) => {
        o.y -= dt * o.sp;
        o.x += Math.sin(t * 0.7 + o.ph) * dt * 0.25 + dt * 0.12;
        if (o.y < 0.02) { o.y = top; o.x = (rand() - 0.5) * radius * 2; o.z = (rand() - 0.5) * radius * 2; }
        e.set(t * 1.7 + o.ph, t * 1.1 + o.ph, 0);
        m.compose(p.set(o.x, o.y, o.z), q.setFromEuler(e), one);
        mesh.setMatrixAt(i, m);
      });
      mesh.instanceMatrix.needsUpdate = true;
    },
  };
}

/** Butterflies fluttering around points (flower beds). */
export function makeButterflies(spots, { rand = Math.random } = {}) {
  const cv = document.createElement('canvas');
  cv.width = 128; cv.height = 64;
  const c = cv.getContext('2d');
  const wing = (x, y, rx, ry, col) => { c.fillStyle = col; c.beginPath(); c.ellipse(x, y, rx, ry, 0, 0, Math.PI * 2); c.fill(); };
  for (const s of [-1, 1]) {
    wing(64 + s * 30, 24, 30, 22, '#ffffff');
    wing(64 + s * 22, 46, 20, 15, '#ffffff');
    wing(64 + s * 36, 22, 9, 7, 'rgba(0,0,0,0.25)');
  }
  c.fillStyle = '#3a2d2d';
  c.fillRect(61, 12, 6, 44);
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  // one wing per instance pair: left and right planes hinged at the body
  const geo = new THREE.PlaneGeometry(0.16, 0.08);
  const mat = new THREE.MeshBasicMaterial({ map: tex, side: THREE.DoubleSide, alphaTest: 0.5 });
  const colors = ['#ffd45c', '#f6a5c0', '#8fd8f0', '#ffffff', '#ffb46b'];
  const bs = spots.map((sp) => ({ ...sp, ph: rand() * 6.28, sp: 0.5 + rand() * 0.5, r: 0.6 + rand() * 0.8, color: colors[Math.floor(rand() * colors.length)] }));
  const mesh = new THREE.InstancedMesh(geo, mat, bs.length);
  const col = new THREE.Color();
  bs.forEach((b, i) => mesh.setColorAt(i, col.set(b.color)));
  mesh.instanceColor.needsUpdate = true;
  mesh.frustumCulled = false;
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const e = new THREE.Euler();
  const p = new THREE.Vector3();
  const s = new THREE.Vector3();
  return {
    group: mesh,
    update(dt, t) {
      bs.forEach((b, i) => {
        const a = t * b.sp + b.ph;
        p.set(b.x + Math.cos(a) * b.r, (b.y ?? 0.6) + Math.sin(a * 2.3) * 0.25 + 0.2, b.z + Math.sin(a * 1.3) * b.r);
        const dx = -Math.sin(a) * b.r;
        const dz = Math.cos(a * 1.3) * b.r * 1.3;
        const flap = 0.25 + Math.abs(Math.sin(t * 16 + b.ph)) * 0.75; // wings close and open
        e.set(-1.2, Math.atan2(dx, dz), 0, 'YXZ');
        m.compose(p, q.setFromEuler(e), s.set(flap, 1, 1));
        mesh.setMatrixAt(i, m);
      });
      mesh.instanceMatrix.needsUpdate = true;
    },
  };
}

/** A soft round dot texture for Points (water drops, sparkles). */
export function dotTexture() {
  const cv = document.createElement('canvas');
  cv.width = cv.height = 32;
  const c = cv.getContext('2d');
  const g = c.createRadialGradient(16, 16, 0, 16, 16, 16);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.5, 'rgba(255,255,255,0.8)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  c.fillStyle = g;
  c.fillRect(0, 0, 32, 32);
  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
