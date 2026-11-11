import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { P } from './palette.js';
import { makePanel, text, roundRect } from '../core/ui.js';
import { DRIVER_EYE } from './bus.js';

/**
 * The dashboard displays, all living inside the bus so they stay put while the world moves:
 *   - instrument cluster behind the wheel: speedometer, gear, door, smile meter
 *   - navigation screen in the middle of the dash: map of the route, the next stop, distance
 *   - a message strip along the top of the windscreen for instructions
 * Panels redraw a few times a second (not every frame) to keep the Quest fast.
 */
export function buildHud(bus, route) {
  const g = bus.inside;
  const eye = DRIVER_EYE;

  // ------------------------------------------------ cluster
  const state = { speed: 0, max: 40, gear: 'D', door: false, smile: 1, score: 0, mode: 'normal', time: 0, light: null, gas: 0, brake: 0, hold: false };
  let rpm = 700;
  // a professional bus cluster: speedometer and rev counter dials with needles, small gauges
  // (fuel, coolant, the two brake-air tanks), the centre display with gear, door and the
  // passengers' smile, and a row of warning lights
  const dial = (c, cx, cy, r, v0, v1, value, { major, minor, label, unit, red = null, fmt = (v) => v }) => {
    const a0 = Math.PI * 0.75;
    const a1 = Math.PI * 2.25;
    const ang = (v) => a0 + ((v - v0) / (v1 - v0)) * (a1 - a0);
    const g = c.createRadialGradient(cx, cy - r * 0.3, r * 0.1, cx, cy, r);
    g.addColorStop(0, '#20282d'); g.addColorStop(1, '#0b0f11');
    c.fillStyle = g; c.beginPath(); c.arc(cx, cy, r, 0, Math.PI * 2); c.fill();
    c.lineWidth = r * 0.05; c.strokeStyle = '#7d878d'; c.stroke();
    if (red != null) { c.strokeStyle = '#e8302c'; c.lineWidth = r * 0.07; c.beginPath(); c.arc(cx, cy, r * 0.86, ang(red), a1); c.stroke(); }
    for (let v = v0; v <= v1 + 1e-6; v += minor) {
      const isMaj = Math.abs((v - v0) / major - Math.round((v - v0) / major)) < 1e-6;
      const a = ang(v);
      c.strokeStyle = '#e9eef1'; c.lineWidth = isMaj ? r * 0.035 : r * 0.015;
      const r0 = r * (isMaj ? 0.74 : 0.8);
      c.beginPath(); c.moveTo(cx + Math.cos(a) * r0, cy + Math.sin(a) * r0); c.lineTo(cx + Math.cos(a) * r * 0.88, cy + Math.sin(a) * r * 0.88); c.stroke();
      if (isMaj) text(c, `${fmt(v)}`, cx + Math.cos(a) * r * 0.58, cy + Math.sin(a) * r * 0.58 + r * 0.07, { size: r * 0.17, weight: 700, color: '#e9eef1', align: 'center' });
    }
    text(c, label, cx, cy + r * 0.36, { size: r * 0.12, weight: 700, color: '#9fb0b8', align: 'center' });
    if (unit) text(c, unit, cx, cy - r * 0.28, { size: r * 0.11, weight: 700, color: '#9fb0b8', align: 'center' });
    // the needle
    const a = ang(Math.min(v1, Math.max(v0, value)));
    c.strokeStyle = '#ff5a1f'; c.lineWidth = r * 0.05; c.lineCap = 'round';
    c.beginPath(); c.moveTo(cx - Math.cos(a) * r * 0.12, cy - Math.sin(a) * r * 0.12); c.lineTo(cx + Math.cos(a) * r * 0.8, cy + Math.sin(a) * r * 0.8); c.stroke();
    c.fillStyle = '#2b3136'; c.beginPath(); c.arc(cx, cy, r * 0.1, 0, Math.PI * 2); c.fill();
  };
  const small = (c, cx, cy, r, k, label, lowWarn = false) => {
    c.fillStyle = '#0b0f11'; c.beginPath(); c.arc(cx, cy, r, 0, Math.PI * 2); c.fill();
    c.lineWidth = r * 0.08; c.strokeStyle = '#5d676d'; c.stroke();
    const a0 = Math.PI * 1.15; const a1 = Math.PI * 1.85;
    c.lineWidth = r * 0.12; c.strokeStyle = '#3a4448'; c.beginPath(); c.arc(cx, cy, r * 0.72, a0, a1); c.stroke();
    if (lowWarn) { c.strokeStyle = '#e8302c'; c.beginPath(); c.arc(cx, cy, r * 0.72, a0, a0 + 0.25); c.stroke(); }
    const a = a0 + (a1 - a0) * k;
    c.strokeStyle = '#ff5a1f'; c.lineWidth = r * 0.09;
    c.beginPath(); c.moveTo(cx, cy); c.lineTo(cx + Math.cos(a) * r * 0.78, cy + Math.sin(a) * r * 0.78); c.stroke();
    text(c, label, cx, cy + r * 0.55, { size: r * 0.34, weight: 800, color: '#9fb0b8', align: 'center' });
  };
  const lamp = (c, x, y, s, on, col, draw) => {
    c.fillStyle = on ? col : '#1a2023';
    c.strokeStyle = on ? col : '#2b3439';
    c.lineWidth = s * 0.12;
    draw(x, y, s);
    if (on) { c.shadowBlur = 0; }
  };
  const cluster = makePanel(0.5, 0.21, (c, W, H) => {
    // the black face with a subtle brushed bezel
    roundRect(c, 3, 3, W - 6, H - 6, H * 0.14);
    const bg = c.createLinearGradient(0, 0, 0, H);
    bg.addColorStop(0, '#161c20'); bg.addColorStop(1, '#0a0d0f');
    c.fillStyle = bg; c.fill();
    c.lineWidth = 6; c.strokeStyle = '#3c454b'; c.stroke();
    const r = H * 0.4;
    // speedometer (left), rev counter (right)
    dial(c, W * 0.2, H * 0.5, r, 0, 80, state.speed, { major: 10, minor: 5, label: 'km/h', unit: '', red: null });
    if (state.max < 80) {
      // the speed limit mark
      const a = Math.PI * 0.75 + (state.max / 80) * Math.PI * 1.5;
      c.strokeStyle = P.busPink; c.lineWidth = r * 0.07;
      c.beginPath(); c.arc(W * 0.2, H * 0.5, r * 0.94, a - 0.04, a + 0.04); c.stroke();
    }
    dial(c, W * 0.8, H * 0.5, r, 0, 30, rpm / 100, { major: 5, minor: 2.5, label: 'x100 rpm', unit: '', red: 24 });
    // small gauges around the centre display
    small(c, W * 0.355, H * 0.25, H * 0.11, 0.72, 'BBM', true);
    small(c, W * 0.355, H * 0.72, H * 0.11, 0.48, '°C');
    small(c, W * 0.645, H * 0.25, H * 0.11, 0.8, 'UDARA 1', true);
    small(c, W * 0.645, H * 0.72, H * 0.11, 0.78, 'UDARA 2', true);
    // centre display
    const dx = W * 0.42; const dy = H * 0.1; const dw = W * 0.16; const dh = H * 0.8;
    roundRect(c, dx, dy, dw, dh, H * 0.05);
    c.fillStyle = '#0c1a14'; c.fill();
    c.lineWidth = 3; c.strokeStyle = '#2b3439'; c.stroke();
    text(c, state.gear, dx + dw / 2, dy + dh * 0.3, { size: H * 0.22, weight: 900, color: state.gear === 'R' ? P.amber : '#5dff8a', align: 'center' });
    text(c, state.mode === 'santai' ? 'AUTO' : 'GIGI', dx + dw / 2, dy + dh * 0.4, { size: H * 0.05, weight: 800, color: '#7fa08c', align: 'center' });
    text(c, `${Math.round(state.speed)} km/h`, dx + dw / 2, dy + dh * 0.53, { size: H * 0.065, weight: 800, color: '#e9eef1', align: 'center' });
    // passengers' smile
    const sm = state.smile;
    const sc = sm > 0.66 ? '#5dff8a' : sm > 0.33 ? P.gold : '#ff5a5a';
    const fx = dx + dw * 0.3; const fy = dy + dh * 0.72; const fr = H * 0.06;
    c.strokeStyle = sc; c.lineWidth = 3; c.beginPath(); c.arc(fx, fy, fr, 0, Math.PI * 2); c.stroke();
    c.fillStyle = sc; for (const sx of [-1, 1]) { c.beginPath(); c.arc(fx + sx * fr * 0.35, fy - fr * 0.25, fr * 0.12, 0, Math.PI * 2); c.fill(); }
    c.beginPath(); const cv = (sm - 0.5) * fr * 0.9; c.moveTo(fx - fr * 0.45, fy + fr * 0.25); c.quadraticCurveTo(fx, fy + fr * 0.25 + cv, fx + fr * 0.45, fy + fr * 0.25); c.stroke();
    text(c, `${Math.round(sm * 100)}%`, dx + dw * 0.68, fy + H * 0.025, { size: H * 0.075, weight: 900, color: sc, align: 'center' });
    text(c, 'senyum', dx + dw / 2, dy + dh * 0.95, { size: H * 0.045, weight: 700, color: '#7fa08c', align: 'center' });
    // warning lights along the bottom
    const ly = H * 0.93; const ls = H * 0.045;
    lamp(c, W * 0.31, ly, ls, state.door, '#ffb13b', (x, y, s) => { c.fillRect(x - s, y - s * 0.8, s * 2, s * 1.6); }); // door
    text(c, 'PINTU', W * 0.31, ly - H * 0.07, { size: H * 0.04, weight: 900, color: state.door ? '#ffb13b' : '#2b3439', align: 'center' });
    lamp(c, W * 0.69, ly, ls, state.brake > 0.1, '#e8302c', (x, y, s) => { c.beginPath(); c.arc(x, y, s, 0, Math.PI * 2); c.fill(); });
    text(c, 'REM', W * 0.69, ly - H * 0.07, { size: H * 0.04, weight: 900, color: state.brake > 0.1 ? '#e8302c' : '#2b3439', align: 'center' });
    if (state.speed > state.max + 1) text(c, 'TERLALU CEPAT', W * 0.2, H * 0.8, { size: H * 0.05, weight: 900, color: '#ff5a5a', align: 'center' });
  }, { ppm: 1500 });
  cluster.mesh.position.set(eye.x, 1.7, -3.965);
  cluster.mesh.rotation.x = -0.39; // faces the driver's eyes, seen over the top of the wheel
  g.add(cluster.mesh);

  // the switch pod's rocker switches and the push-button gear selector (static labels)
  const pod = makePanel(0.15, 0.115, (c, W, H) => {
    c.fillStyle = '#15191c'; c.fillRect(0, 0, W, H);
    const labels = ['LAMPU', 'WIPER', 'HAZARD', 'AC', 'KABIN', 'KNEEL'];
    labels.forEach((l, i) => {
      const x = W * (0.18 + (i % 3) * 0.32); const y = H * (0.22 + Math.floor(i / 3) * 0.3);
      roundRect(c, x - W * 0.12, y - H * 0.1, W * 0.24, H * 0.2, 6);
      c.fillStyle = l === 'HAZARD' ? '#b3202c' : '#2b3136'; c.fill();
      c.fillStyle = '#e9eef1'; c.fillRect(x - W * 0.08, y - H * 0.06, W * 0.16, 3);
      text(c, l, x, y + H * 0.07, { size: H * 0.065, weight: 800, color: '#cfd6db', align: 'center' });
    });
    ['D', 'N', 'R'].forEach((l, i) => {
      const x = W * (0.25 + i * 0.25); const y = H * 0.84;
      c.fillStyle = '#2b3136'; c.beginPath(); c.arc(x, y, H * 0.1, 0, Math.PI * 2); c.fill();
      text(c, l, x, y + H * 0.04, { size: H * 0.11, weight: 900, color: l === 'D' ? '#5dff8a' : '#cfd6db', align: 'center' });
    });
  }, { ppm: 1200 });
  // on the face of the switch pod (bus.js), facing the driver
  {
    const m = new THREE.Matrix4().compose(new THREE.Vector3(0.99, 1.64, -3.83), new THREE.Quaternion().setFromEuler(new THREE.Euler(-0.75, -0.35, 0, 'YXZ')), new THREE.Vector3(1, 1, 1));
    pod.mesh.position.set(0, 0, 0.037).applyMatrix4(m);
    pod.mesh.rotation.set(-0.75, -0.35, 0, 'YXZ');
  }
  g.add(pod.mesh);

  // ------------------------------------------------ navigation screen
  const MAP = 512;
  const mapCv = document.createElement('canvas');
  mapCv.width = mapCv.height = MAP;
  let minX = Infinity; let maxX = -Infinity; let minZ = Infinity; let maxZ = -Infinity;
  for (let i = 0; i < route.n; i++) { minX = Math.min(minX, route.x[i]); maxX = Math.max(maxX, route.x[i]); minZ = Math.min(minZ, route.z[i]); maxZ = Math.max(maxZ, route.z[i]); }
  const span = Math.max(maxX - minX, maxZ - minZ) * 1.12;
  const mx = (x) => MAP / 2 + ((x - (minX + maxX) / 2) / span) * MAP;
  const mz = (z) => MAP / 2 + ((z - (minZ + maxZ) / 2) / span) * MAP;
  {
    const c = mapCv.getContext('2d');
    c.fillStyle = '#e8f3e4'; c.fillRect(0, 0, MAP, MAP);
    c.lineCap = 'round'; c.lineJoin = 'round';
    for (const [w, col] of [[22, '#ffffff'], [12, '#9aa5ad']]) {
      c.lineWidth = w; c.strokeStyle = col;
      c.beginPath();
      for (let i = 0; i <= route.n; i++) { const j = i % route.n; if (i === 0) c.moveTo(mx(route.x[j]), mz(route.z[j])); else c.lineTo(mx(route.x[j]), mz(route.z[j])); }
      c.stroke();
    }
  }
  const nav = { stops: [], next: null, nextName: '', dist: 0, busX: 0, busZ: 0, yaw: 0, done: 0, total: 0, light: null };
  const navPanel = makePanel(0.38, 0.26, (c, W, H) => {
    roundRect(c, 4, 4, W - 8, H - 8, H * 0.08);
    c.fillStyle = '#0f1417'; c.fill();
    const ms = H * 0.86;
    const ox = W * 0.03;
    const oy = H * 0.07;
    c.save();
    roundRect(c, ox, oy, ms, ms, 18); c.clip();
    c.drawImage(mapCv, ox, oy, ms, ms);
    const sx = (x) => ox + (mx(x) / MAP) * ms;
    const sz = (z) => oy + (mz(z) / MAP) * ms;
    for (const st of nav.stops) {
      c.fillStyle = st.done ? '#9aa5ad' : st === nav.next ? P.busPink : P.busGreen;
      c.beginPath(); c.arc(sx(st.x), sz(st.z), st === nav.next ? 16 : 11, 0, Math.PI * 2); c.fill();
      c.fillStyle = '#ffffff';
      text(c, st.icon, sx(st.x), sz(st.z) + 6, { size: 16, weight: 900, color: '#fff', align: 'center' });
    }
    // the bus arrow
    c.translate(sx(nav.busX), sz(nav.busZ));
    c.rotate(-nav.yaw);
    c.fillStyle = P.busGreenDark;
    c.strokeStyle = '#ffffff'; c.lineWidth = 4;
    c.beginPath(); c.moveTo(0, -20); c.lineTo(13, 14); c.lineTo(0, 7); c.lineTo(-13, 14); c.closePath(); c.fill(); c.stroke();
    c.restore();
    // next stop info
    const tx = ox + ms + W * 0.03;
    const tw = W - tx - W * 0.03;
    text(c, 'BERIKUTNYA', tx, H * 0.16, { size: H * 0.065, weight: 800, color: '#9fb0b8' });
    c.font = `900 ${Math.round(H * 0.085)}px system-ui`;
    const words = nav.nextName.split(' ');
    let line = ''; let y = H * 0.28; const lines = [];
    for (const w of words) { const t = line ? `${line} ${w}` : w; if (c.measureText(t).width > tw && line) { lines.push(line); line = w; } else line = t; }
    lines.push(line);
    lines.slice(0, 3).forEach((l) => { text(c, l, tx, y, { size: H * 0.085, weight: 900, color: '#ffffff' }); y += H * 0.1; });
    text(c, nav.dist > 999 ? `${(nav.dist / 1000).toFixed(1)} km` : `${Math.max(0, Math.round(nav.dist))} m`, tx, H * 0.66, { size: H * 0.14, weight: 900, color: P.busGreen });
    text(c, `Halte ${nav.done}/${nav.total}`, tx, H * 0.78, { size: H * 0.07, weight: 700, color: '#9fb0b8' });
    if (nav.light) {
      const col = nav.light === 'red' ? '#ff3b3b' : nav.light === 'yellow' ? '#ffc93b' : '#3bff7a';
      c.fillStyle = col;
      c.beginPath(); c.arc(tx + H * 0.05, H * 0.89, H * 0.045, 0, Math.PI * 2); c.fill();
      text(c, nav.light === 'red' ? 'Lampu merah' : nav.light === 'yellow' ? 'Lampu kuning' : 'Lampu hijau', tx + H * 0.12, H * 0.92, { size: H * 0.065, weight: 800, color: col });
    }
  }, { ppm: 1400 });
  // the route screen stands ON the dashboard in a little tablet holder (it used to dip into it)
  navPanel.mesh.position.set(-0.08, 1.7, -3.9);
  navPanel.mesh.rotation.set(-0.3, 0.18, 0);
  navPanel.mesh.renderOrder = 2;
  const holderMat = new THREE.MeshStandardMaterial({ color: '#1b1f22', roughness: 0.5 });
  const bezel = new THREE.Mesh(new RoundedBoxGeometry(0.405, 0.285, 0.03, 2, 0.012), holderMat);
  bezel.position.z = -0.018;
  navPanel.mesh.add(bezel);
  const arm = new THREE.Mesh(new THREE.CylinderGeometry(0.014, 0.014, 0.12, 8), holderMat);
  arm.position.set(0, -0.1, -0.06);
  arm.rotation.x = 0.3;
  navPanel.mesh.add(arm);
  const foot = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.05, 0.02, 14), holderMat);
  foot.position.set(-0.08, 1.535, -3.95);
  g.add(navPanel.mesh, foot);

  // ------------------------------------------------ message strip at the top of the windscreen
  let msg = { text: '', sub: '', tone: 'info' };
  const msgPanel = makePanel(1.3, 0.24, (c, W, H) => {
    if (!msg.text) return;
    const col = msg.tone === 'warn' ? P.red : msg.tone === 'good' ? P.busGreen : msg.tone === 'pink' ? P.busPink : '#1f2a24';
    roundRect(c, 6, 6, W - 12, H - 12, H * 0.4);
    c.fillStyle = 'rgba(255,255,255,0.94)'; c.fill();
    c.lineWidth = 8; c.strokeStyle = col; c.stroke();
    text(c, msg.text, W / 2, msg.sub ? H * 0.47 : H * 0.62, { size: H * 0.3, weight: 900, color: col === '#1f2a24' ? P.ink : col, align: 'center', maxWidth: W * 0.92 });
    if (msg.sub) text(c, msg.sub, W / 2, H * 0.78, { size: H * 0.19, weight: 700, color: P.muted, align: 'center', maxWidth: W * 0.92 });
  }, { ppm: 700 });
  // floats just beyond the windscreen, so it sits about 2 m away (easy on the eyes)
  msgPanel.mesh.position.set(0.3, 2.55, -5.6);
  msgPanel.mesh.rotation.x = 0.12;
  g.add(msgPanel.mesh);
  msgPanel.mesh.visible = false;

  let acc = 0;
  let clusterKey = '';
  let navKey = '';
  return {
    state, nav, cluster, navPanel, msgPanel,
    say(textStr, sub = '', tone = 'info') {
      if (msg.text === textStr && msg.sub === sub && msg.tone === tone) return;
      msg = { text: textStr, sub, tone };
      msgPanel.redraw();
      msgPanel.mesh.visible = !!textStr;
    },
    get message() { return msg; },
    update(dt) {
      acc += dt;
      if (acc < 0.1) return;
      acc = 0;
      // the engine revs with the gas and drops back when the automatic gearbox shifts up
      const band = state.speed < 12 ? state.speed / 12 : state.speed < 28 ? (state.speed - 12) / 16 : (state.speed - 28) / 30;
      const want = 650 + band * 1300 + state.gas * 500;
      rpm += (want - rpm) * 0.35;
      const ck = `${Math.round(state.speed)}|${state.gear}|${state.door}|${Math.round(state.smile * 100)}|${state.max}|${state.mode}|${Math.round(rpm / 50)}|${state.brake > 0.1}`;
      if (ck !== clusterKey) { clusterKey = ck; cluster.redraw(); }
      const nk = `${Math.round(nav.busX)}|${Math.round(nav.busZ)}|${Math.round(nav.yaw * 10)}|${nav.nextName}|${Math.round(nav.dist)}|${nav.light}|${nav.done}`;
      if (nk !== navKey) { navKey = nk; navPanel.redraw(); }
    },
  };
}
