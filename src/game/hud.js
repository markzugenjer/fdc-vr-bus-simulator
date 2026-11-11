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
  const state = { speed: 0, max: 40, gear: 'D', door: false, smile: 1, score: 0, mode: 'normal', time: 0, light: null };
  const cluster = makePanel(0.46, 0.2, (c, W, H) => {
    roundRect(c, 4, 4, W - 8, H - 8, H * 0.18);
    c.fillStyle = '#111619'; c.fill();
    c.lineWidth = 4; c.strokeStyle = '#2c353b'; c.stroke();
    // speedometer arc
    const cx = W * 0.27;
    const cy = H * 0.66;
    const r = H * 0.46;
    const a0 = Math.PI * 0.8;
    const a1 = Math.PI * 2.2;
    c.lineWidth = H * 0.06;
    c.strokeStyle = '#2b3439';
    c.beginPath(); c.arc(cx, cy, r, a0, a1); c.stroke();
    const k = Math.min(1, state.speed / 60);
    c.strokeStyle = state.speed > state.max + 1 ? P.red : P.busGreen;
    c.beginPath(); c.arc(cx, cy, r, a0, a0 + (a1 - a0) * k); c.stroke();
    // limit tick
    const al = a0 + (a1 - a0) * (state.max / 60);
    c.strokeStyle = P.busPink;
    c.lineWidth = 5;
    c.beginPath(); c.moveTo(cx + Math.cos(al) * (r - 12), cy + Math.sin(al) * (r - 12)); c.lineTo(cx + Math.cos(al) * (r + 12), cy + Math.sin(al) * (r + 12)); c.stroke();
    text(c, `${Math.round(state.speed)}`, cx, cy + H * 0.04, { size: H * 0.34, weight: 900, color: '#ffffff', align: 'center' });
    text(c, 'km/j', cx, cy + H * 0.2, { size: H * 0.09, weight: 700, color: '#9fb0b8', align: 'center' });
    // gear + door
    const x2 = W * 0.56;
    text(c, state.gear, x2, H * 0.42, { size: H * 0.3, weight: 900, color: state.gear === 'R' ? P.amber : P.busGreen, align: 'center' });
    text(c, state.mode === 'santai' ? 'AUTO' : 'GIGI', x2, H * 0.58, { size: H * 0.08, weight: 800, color: '#9fb0b8', align: 'center' });
    roundRect(c, x2 - W * 0.07, H * 0.68, W * 0.14, H * 0.18, H * 0.05);
    c.fillStyle = state.door ? P.amber : '#24302a'; c.fill();
    text(c, state.door ? 'PINTU' : 'pintu', x2, H * 0.81, { size: H * 0.08, weight: 800, color: state.door ? '#2b1a00' : '#6f8a7a', align: 'center' });
    // smile meter
    const x3 = W * 0.82;
    const sm = state.smile;
    c.fillStyle = sm > 0.66 ? P.busGreen : sm > 0.33 ? P.gold : P.red;
    c.beginPath(); c.arc(x3, H * 0.4, H * 0.17, 0, Math.PI * 2); c.fill();
    c.fillStyle = '#111619';
    for (const s of [-1, 1]) { c.beginPath(); c.arc(x3 + s * H * 0.06, H * 0.35, H * 0.022, 0, Math.PI * 2); c.fill(); }
    c.strokeStyle = '#111619'; c.lineWidth = 5; c.lineCap = 'round';
    c.beginPath();
    const curve = (sm - 0.5) * H * 0.16;
    c.moveTo(x3 - H * 0.08, H * 0.45); c.quadraticCurveTo(x3, H * 0.45 + curve, x3 + H * 0.08, H * 0.45); c.stroke();
    text(c, `${Math.round(sm * 100)}%`, x3, H * 0.72, { size: H * 0.11, weight: 900, color: '#ffffff', align: 'center' });
    text(c, 'senyum', x3, H * 0.86, { size: H * 0.075, weight: 700, color: '#9fb0b8', align: 'center' });
  }, { ppm: 1000 });
  cluster.mesh.position.set(eye.x, 1.56, -3.74);
  cluster.mesh.rotation.x = -0.45;
  g.add(cluster.mesh);

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
      const ck = `${Math.round(state.speed)}|${state.gear}|${state.door}|${Math.round(state.smile * 100)}|${state.max}|${state.mode}`;
      if (ck !== clusterKey) { clusterKey = ck; cluster.redraw(); }
      const nk = `${Math.round(nav.busX)}|${Math.round(nav.busZ)}|${Math.round(nav.yaw * 10)}|${nav.nextName}|${Math.round(nav.dist)}|${nav.light}|${nav.done}`;
      if (nk !== navKey) { navKey = nk; navPanel.redraw(); }
    },
  };
}
