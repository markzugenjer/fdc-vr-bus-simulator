import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { P } from './palette.js';

/**
 * The town's texture atlas: one 1024 x 1024 canvas with every painted detail the buildings use
 * (roof tiles, window frames with curtains, rolling doors, shop fronts, shop signs, roster vents,
 * wood, bricks...). TexKit merges all static scenery into ONE mesh that samples this atlas and is
 * tinted by vertex colour, so the whole town keeps costing a single draw call while looking like
 * proper Indonesian streets.
 *
 * Tiles are painted in light greys where they should take the part's colour (walls, roofs) and in
 * full colour where they shouldn't (signs, windows), then the part's colour multiplies them.
 */
const SIZE = 1024;
const FONT = 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';

export const SIGNS = [
  ['Toko Berkah', '#e8545c', '#ffffff'], ['Apotek Sehat', '#2a9d8f', '#ffffff'], ['Laundry Kilat', '#4a9be8', '#ffffff'],
  ['Fotokopi', '#ffd23b', '#1d2a33'], ['Bengkel Motor', '#1d2a33', '#ffd23b'], ['Bakso Pak Kumis', '#ff7a2f', '#ffffff'],
  ['Martabak 88', '#7c3aed', '#ffd23b'], ['Toko Kue Ani', '#ec6db0', '#ffffff'], ['Pulsa & Kuota', '#16a34a', '#ffffff'],
  ['Mie Ayam', '#c2410c', '#fff7d6'], ['Kopi Senja', '#3b2a1e', '#f7c95e'], ['Sembako', '#0e7490', '#ffffff'],
];
export const BANNERS = [
  ['WARUNG MAKAN', 'Bu Siti', '#e8545c'], ['ES KELAPA MUDA', 'Segar!', '#16a34a'], ['NASI GORENG', 'Pak Darto', '#ff7a2f'],
  ['SATE AYAM', 'Madura', '#7c3aed'], ['GORENGAN', 'Hangat', '#d97706'], ['ES TEH', 'Manis Jumbo', '#0e7490'],
];

let atlas = null;

/** { tex, tiles: name → [u0, v0, u1, v1] } (built once). */
export function townAtlas() {
  if (atlas) return atlas;
  const cv = document.createElement('canvas');
  cv.width = cv.height = SIZE;
  const c = cv.getContext('2d');
  const tiles = {};
  let rand = 7;
  const r = () => { rand = (rand * 16807) % 2147483647; return rand / 2147483647; };
  const tile = (name, x, y, w, h, draw) => {
    c.save();
    c.beginPath(); c.rect(x, y, w, h); c.clip();
    c.translate(x, y);
    draw(w, h);
    c.restore();
    const pad = 3;
    tiles[name] = [(x + pad) / SIZE, 1 - (y + h - pad) / SIZE, (x + w - pad) / SIZE, 1 - (y + pad) / SIZE];
  };
  const noise = (w, h, n, a, b, size = 2) => { for (let i = 0; i < n; i++) { c.fillStyle = r() < 0.5 ? a : b; c.fillRect(r() * w, r() * h, size, size); } };

  // ---- solid white (untextured parts)
  tile('white', 0, 0, 32, 32, (w, h) => { c.fillStyle = '#fff'; c.fillRect(0, 0, w, h); });

  // ---- plaster wall (tinted)
  tile('plaster', 32, 0, 96, 96, (w, h) => {
    c.fillStyle = '#f4f4f4'; c.fillRect(0, 0, w, h);
    noise(w, h, 900, 'rgba(0,0,0,0.035)', 'rgba(255,255,255,0.5)', 2);
    // a damp line along the bottom, like real tropical walls
    const g = c.createLinearGradient(0, h * 0.82, 0, h);
    g.addColorStop(0, 'rgba(0,0,0,0)'); g.addColorStop(1, 'rgba(60,50,30,0.16)');
    c.fillStyle = g; c.fillRect(0, 0, w, h);
  });

  // ---- clay roof tiles (genteng), painted light so the roof colour shows
  tile('roof', 128, 0, 256, 256, (w, h) => {
    c.fillStyle = '#d8d8d8'; c.fillRect(0, 0, w, h);
    const rows = 14;
    const rh = h / rows;
    for (let i = 0; i < rows; i++) {
      const y = i * rh;
      const g = c.createLinearGradient(0, y, 0, y + rh);
      g.addColorStop(0, '#f2f2f2'); g.addColorStop(0.75, '#cfcfcf'); g.addColorStop(1, '#8e8e8e');
      c.fillStyle = g; c.fillRect(0, y, w, rh);
      const cols = 10;
      const off = (i % 2) * (w / cols / 2);
      for (let k = -1; k <= cols; k++) {
        const x = k * (w / cols) + off;
        c.fillStyle = 'rgba(0,0,0,0.22)'; c.fillRect(x, y, 2, rh);
        c.fillStyle = `rgba(${r() < 0.5 ? '0,0,0' : '255,255,255'},${(r() * 0.12).toFixed(3)})`;
        c.fillRect(x + 2, y, w / cols - 2, rh);
      }
    }
    noise(w, h, 600, 'rgba(0,0,0,0.06)', 'rgba(255,255,255,0.08)', 2);
  });

  // ---- corrugated zinc (warung roofs)
  tile('zinc', 384, 0, 128, 128, (w, h) => {
    for (let x = 0; x < w; x += 8) {
      const g = c.createLinearGradient(x, 0, x + 8, 0);
      g.addColorStop(0, '#9aa1a6'); g.addColorStop(0.5, '#e9edef'); g.addColorStop(1, '#9aa1a6');
      c.fillStyle = g; c.fillRect(x, 0, 8, h);
    }
    noise(w, h, 260, 'rgba(120,70,30,0.12)', 'rgba(255,255,255,0.1)', 3);
  });

  // ---- house window: white frame, cross bars, glass with sky reflection, curtains
  const windowTile = (name, x, y, curtain, wood) => tile(name, x, y, 128, 160, (w, h) => {
    const frame = wood ? '#7a4f2e' : '#ffffff';
    c.fillStyle = frame; c.fillRect(0, 0, w, h);
    const gx = 12; const gy = 12; const gw = w - 24; const gh = h - 24;
    const g = c.createLinearGradient(0, gy, 0, gy + gh);
    g.addColorStop(0, '#bfe3f7'); g.addColorStop(0.45, '#6aa9cf'); g.addColorStop(1, '#2d4f66');
    c.fillStyle = g; c.fillRect(gx, gy, gw, gh);
    // curtains on both sides
    c.fillStyle = curtain;
    for (const side of [0, 1]) {
      c.beginPath();
      const x0 = side ? gx + gw : gx;
      const dir = side ? -1 : 1;
      c.moveTo(x0, gy);
      c.lineTo(x0 + dir * gw * 0.36, gy);
      c.quadraticCurveTo(x0 + dir * gw * 0.12, gy + gh * 0.55, x0 + dir * gw * 0.24, gy + gh);
      c.lineTo(x0, gy + gh);
      c.fill();
      c.strokeStyle = 'rgba(0,0,0,0.12)'; c.lineWidth = 2;
      for (let k = 1; k < 4; k++) { c.beginPath(); c.moveTo(x0 + dir * k * 8, gy); c.lineTo(x0 + dir * k * 6, gy + gh); c.stroke(); }
    }
    // reflection streak
    c.fillStyle = 'rgba(255,255,255,0.28)';
    c.beginPath(); c.moveTo(gx + gw * 0.55, gy); c.lineTo(gx + gw * 0.75, gy); c.lineTo(gx + gw * 0.35, gy + gh); c.lineTo(gx + gw * 0.15, gy + gh); c.fill();
    // bars
    c.fillStyle = frame;
    c.fillRect(w / 2 - 5, 0, 10, h);
    c.fillRect(0, h * 0.32, w, 8);
    c.strokeStyle = 'rgba(0,0,0,0.25)'; c.lineWidth = 3; c.strokeRect(gx, gy, gw, gh);
  });
  windowTile('window', 0, 256, '#f6d2e2', false);
  windowTile('window2', 128, 256, '#fff1c1', false);
  windowTile('windowWood', 256, 256, '#d6ecff', true);

  // ---- panelled wooden door
  tile('door', 384, 256, 80, 160, (w, h) => {
    c.fillStyle = '#8a5a3c'; c.fillRect(0, 0, w, h);
    for (let x = 0; x < w; x += 3) { c.fillStyle = `rgba(0,0,0,${(r() * 0.12).toFixed(3)})`; c.fillRect(x, 0, 2, h); }
    c.strokeStyle = '#5c3a24'; c.lineWidth = 4;
    for (const [px, py, pw, ph] of [[10, 10, w / 2 - 15, h * 0.4], [w / 2 + 5, 10, w / 2 - 15, h * 0.4], [10, h * 0.5, w / 2 - 15, h * 0.44], [w / 2 + 5, h * 0.5, w / 2 - 15, h * 0.44]]) c.strokeRect(px, py, pw, ph);
    c.fillStyle = '#e8c35a'; c.beginPath(); c.arc(w * 0.82, h * 0.52, 4, 0, 7); c.fill();
  });

  // ---- roster (ventilation blocks above windows)
  tile('roster', 464, 256, 48, 48, (w, h) => {
    c.fillStyle = '#f0f0f0'; c.fillRect(0, 0, w, h);
    c.fillStyle = '#3a3f44';
    for (let i = 0; i < 2; i++) for (let k = 0; k < 2; k++) {
      c.beginPath(); c.arc(12 + k * 24, 12 + i * 24, 8, 0, 7); c.fill();
    }
  });

  // ---- rolling door (rolling door / folding shutter)
  tile('shutter', 0, 416, 128, 128, (w, h) => {
    for (let y = 0; y < h; y += 6) {
      const g = c.createLinearGradient(0, y, 0, y + 6);
      g.addColorStop(0, '#e2e6e8'); g.addColorStop(0.7, '#b9c0c4'); g.addColorStop(1, '#7f878c');
      c.fillStyle = g; c.fillRect(0, y, w, 6);
    }
    c.fillStyle = '#6e767b'; c.fillRect(0, h - 10, w, 10);
    c.fillStyle = '#4a5156'; c.fillRect(w / 2 - 12, h - 18, 24, 6);
  });

  // ---- open shop front: shelves full of goods
  tile('shop', 128, 416, 192, 128, (w, h) => {
    c.fillStyle = '#5a4433'; c.fillRect(0, 0, w, h);
    const goods = ['#e8545c', '#ffd23b', '#3cc44c', '#4a9be8', '#ffffff', '#ff7a2f', '#ec6db0', '#7c3aed'];
    for (let row = 0; row < 4; row++) {
      const y = 8 + row * 30;
      c.fillStyle = '#c9a77c'; c.fillRect(0, y + 22, w, 4);
      for (let x = 4; x < w - 8;) {
        const bw = 6 + r() * 12;
        const bh = 8 + r() * 13;
        c.fillStyle = goods[Math.floor(r() * goods.length)];
        c.fillRect(x, y + 22 - bh, bw, bh);
        c.fillStyle = 'rgba(255,255,255,0.35)'; c.fillRect(x, y + 22 - bh, bw, 3);
        x += bw + 2;
      }
    }
    // the counter in front
    c.fillStyle = '#e9e3d6'; c.fillRect(0, h - 26, w, 26);
    c.fillStyle = 'rgba(160,210,240,0.6)'; c.fillRect(10, h - 22, w - 20, 16);
    const g = c.createLinearGradient(0, 0, 0, h);
    g.addColorStop(0, 'rgba(0,0,0,0.35)'); g.addColorStop(0.3, 'rgba(0,0,0,0)');
    c.fillStyle = g; c.fillRect(0, 0, w, h);
  });

  // ---- glass curtain wall (clinic, ruko upstairs)
  tile('glass', 320, 416, 192, 128, (w, h) => {
    const g = c.createLinearGradient(0, 0, w, h);
    g.addColorStop(0, '#d9f2ff'); g.addColorStop(0.5, '#7cc3e4'); g.addColorStop(1, '#3f7f9f');
    c.fillStyle = g; c.fillRect(0, 0, w, h);
    c.fillStyle = 'rgba(255,255,255,0.22)';
    for (const x of [30, 110]) { c.beginPath(); c.moveTo(x, 0); c.lineTo(x + 40, 0); c.lineTo(x - 10, h); c.lineTo(x - 50, h); c.fill(); }
    c.fillStyle = '#e9eef1';
    for (let x = 0; x <= w; x += w / 4) c.fillRect(x - 3, 0, 6, h);
    c.fillRect(0, h / 2 - 3, w, 6);
  });

  // ---- wood planks (warung walls, benches)
  tile('wood', 0, 544, 128, 96, (w, h) => {
    for (let y = 0; y < h; y += 16) {
      c.fillStyle = ['#c99a6b', '#b8895a', '#d4a676'][Math.floor(r() * 3)];
      c.fillRect(0, y, w, 15);
      c.fillStyle = 'rgba(0,0,0,0.25)'; c.fillRect(0, y + 15, w, 1);
      for (let k = 0; k < 6; k++) { c.fillStyle = 'rgba(90,60,30,0.18)'; c.fillRect(r() * w, y + r() * 14, 10 + r() * 30, 1); }
    }
  });

  // ---- brick fence (painted light: tinted)
  tile('brick', 128, 544, 128, 64, (w, h) => {
    c.fillStyle = '#9a9a9a'; c.fillRect(0, 0, w, h);
    for (let row = 0; row < 8; row++) for (let k = -1; k < 5; k++) {
      c.fillStyle = `rgb(${225 + r() * 30 | 0},${222 + r() * 30 | 0},${218 + r() * 30 | 0})`;
      c.fillRect(k * 32 + (row % 2) * 16 + 1, row * 8 + 1, 30, 6);
    }
  });

  // ---- awnings: striped canvas with a scalloped edge
  const awningCols = [[P.busPink, '#ffffff'], [P.busGreen, '#ffffff'], ['#ffb13b', '#ffffff'], ['#4a9be8', '#ffffff'], ['#e8545c', '#fff1c1']];
  awningCols.forEach(([a, b], i) => tile(`awning${i}`, 256 + (i % 2) * 128, 544 + Math.floor(i / 2) * 64, 128, 64, (w, h) => {
    for (let k = 0; k < 8; k++) { c.fillStyle = k % 2 ? b : a; c.fillRect(k * 16, 0, 16, h); }
    c.fillStyle = 'rgba(0,0,0,0.12)'; c.fillRect(0, 0, w, 4);
  }));

  // ---- shop signs (papan nama)
  SIGNS.forEach(([name, bg, fg], i) => tile(`sign${i}`, 512 + (i % 2) * 256, Math.floor(i / 2) * 64, 256, 64, (w, h) => {
    c.fillStyle = bg; c.fillRect(0, 0, w, h);
    c.fillStyle = 'rgba(255,255,255,0.18)'; c.fillRect(0, 0, w, h * 0.4);
    c.strokeStyle = fg; c.lineWidth = 3; c.strokeRect(5, 5, w - 10, h - 10);
    c.fillStyle = fg; c.font = `900 ${h * 0.5}px ${FONT}`; c.textAlign = 'center'; c.textBaseline = 'middle';
    c.fillText(name, w / 2, h * 0.54, w * 0.9);
  }));

  // ---- warung banners (spanduk)
  BANNERS.forEach(([a, b, bg], i) => tile(`banner${i}`, 512 + (i % 2) * 256, 384 + Math.floor(i / 2) * 64, 256, 64, (w, h) => {
    c.fillStyle = '#ffffff'; c.fillRect(0, 0, w, h);
    c.fillStyle = bg; c.fillRect(0, 0, w, h * 0.66);
    c.fillStyle = '#ffd23b'; c.fillRect(0, h * 0.66, w, 3);
    c.fillStyle = '#ffffff'; c.font = `900 ${h * 0.38}px ${FONT}`; c.textAlign = 'center'; c.textBaseline = 'middle';
    c.fillText(a, w / 2, h * 0.35, w * 0.92);
    c.fillStyle = bg; c.font = `800 ${h * 0.24}px ${FONT}`;
    c.fillText(b, w / 2, h * 0.84, w * 0.9);
  }));

  // ---- the halte's route map and the clinic's poster
  tile('routemap', 512, 576, 128, 160, (w, h) => {
    c.fillStyle = '#ffffff'; c.fillRect(0, 0, w, h);
    c.fillStyle = P.busGreen; c.fillRect(0, 0, w, 26);
    c.fillStyle = '#fff'; c.font = `900 15px ${FONT}`; c.textAlign = 'center'; c.fillText('SMILE BUS', w / 2, 19);
    c.strokeStyle = P.busPink; c.lineWidth = 6; c.lineJoin = 'round';
    c.beginPath(); c.moveTo(28, 140); c.lineTo(28, 60); c.quadraticCurveTo(28, 40, 50, 40); c.lineTo(100, 40); c.lineTo(100, 140); c.stroke();
    c.fillStyle = '#fff'; c.strokeStyle = P.busGreen; c.lineWidth = 3;
    for (const [x, y] of [[28, 120], [28, 75], [64, 40], [100, 80], [100, 130]]) { c.beginPath(); c.arc(x, y, 7, 0, 7); c.fill(); c.stroke(); }
    c.fillStyle = '#5f7466'; c.font = `700 9px ${FONT}`; c.fillText('Gratis · Ramah anak', w / 2, h - 6);
  });
  tile('poster', 640, 576, 128, 160, (w, h) => {
    const g = c.createLinearGradient(0, 0, 0, h);
    g.addColorStop(0, '#fde8f1'); g.addColorStop(1, '#e3f6e6');
    c.fillStyle = g; c.fillRect(0, 0, w, h);
    c.fillStyle = P.busPink; c.font = `900 20px ${FONT}`; c.textAlign = 'center'; c.fillText('Senyum', w / 2, 34); c.fillText('Sehat!', w / 2, 56);
    // a big tooth
    c.fillStyle = '#fff'; c.strokeStyle = P.busGreen; c.lineWidth = 4;
    c.beginPath(); c.moveTo(40, 72); c.bezierCurveTo(36, 62, 58, 60, 64, 68); c.bezierCurveTo(70, 60, 92, 62, 88, 72); c.bezierCurveTo(88, 100, 80, 130, 74, 130); c.bezierCurveTo(68, 130, 70, 104, 64, 104); c.bezierCurveTo(58, 104, 60, 130, 54, 130); c.bezierCurveTo(48, 130, 40, 100, 40, 72); c.fill(); c.stroke();
    c.fillStyle = P.mintDark; c.font = `800 11px ${FONT}`; c.fillText('Cek gigi 6 bulan sekali', w / 2, h - 12);
  });

  // ---- car parts (traffic): grille + headlights, tail lights, windows
  tile('carFront', 768, 576, 128, 64, (w, h) => {
    c.fillStyle = '#2a2f33'; c.fillRect(0, 0, w, h);
    c.fillStyle = '#16191c'; c.fillRect(36, 18, 56, 26);
    c.strokeStyle = '#8b949a'; c.lineWidth = 2; for (let y = 22; y < 44; y += 5) { c.beginPath(); c.moveTo(38, y); c.lineTo(90, y); c.stroke(); }
    for (const x of [6, 98]) { c.fillStyle = '#fff9e0'; c.fillRect(x, 14, 24, 16); c.fillStyle = '#ffb13b'; c.fillRect(x, 30, 24, 5); }
    c.fillStyle = '#ffffff'; c.fillRect(46, 48, 36, 12); c.fillStyle = '#111'; c.font = `800 9px ${FONT}`; c.textAlign = 'center'; c.fillText('B 2026 SM', 64, 57);
  });
  tile('carBack', 896, 576, 128, 64, (w, h) => {
    c.fillStyle = '#2a2f33'; c.fillRect(0, 0, w, h);
    for (const x of [4, 96]) { c.fillStyle = '#d61f2c'; c.fillRect(x, 12, 28, 18); c.fillStyle = '#ffb13b'; c.fillRect(x, 30, 28, 6); c.fillStyle = '#f3f3f3'; c.fillRect(x, 36, 28, 4); }
    c.fillStyle = '#ffffff'; c.fillRect(42, 40, 44, 14); c.fillStyle = '#111'; c.font = `800 10px ${FONT}`; c.textAlign = 'center'; c.fillText('D 1717 FDC', 64, 51);
  });
  tile('carGlass', 768, 640, 128, 64, (w, h) => {
    const g = c.createLinearGradient(0, 0, 0, h);
    g.addColorStop(0, '#a9c7d8'); g.addColorStop(1, '#1d2a33');
    c.fillStyle = g; c.fillRect(0, 0, w, h);
    c.fillStyle = 'rgba(255,255,255,0.25)'; c.beginPath(); c.moveTo(70, 0); c.lineTo(95, 0); c.lineTo(60, h); c.lineTo(35, h); c.fill();
  });
  tile('angkot', 896, 640, 128, 64, (w, h) => {
    // the angkot's side: windows above, route stripe and number below
    c.fillStyle = '#ffffff'; c.fillRect(0, 0, w, h);
    const g = c.createLinearGradient(0, 0, 0, h * 0.5);
    g.addColorStop(0, '#a9c7d8'); g.addColorStop(1, '#22313b');
    c.fillStyle = g; for (let k = 0; k < 4; k++) c.fillRect(4 + k * 31, 3, 27, h * 0.46);
    c.fillStyle = '#ffd23b'; c.fillRect(0, h * 0.58, w, 6);
    c.fillStyle = '#e8545c'; c.fillRect(0, h * 0.7, w, 4);
    c.fillStyle = '#ffffff'; c.font = `900 13px ${FONT}`; c.textAlign = 'center'; c.fillText('03 · PASAR', w / 2, h * 0.94);
  });

  // ---- tyre with rim (side)
  tile('tyre', 768, 704, 64, 64, (w, h) => {
    c.fillStyle = '#ffffff'; c.fillRect(0, 0, w, h);
    c.fillStyle = '#1d1f22'; c.beginPath(); c.arc(32, 32, 31, 0, 7); c.fill();
    c.fillStyle = '#bfc6cb'; c.beginPath(); c.arc(32, 32, 17, 0, 7); c.fill();
    c.fillStyle = '#7d868c'; for (let k = 0; k < 5; k++) { const a = k * 1.2566; c.beginPath(); c.arc(32 + Math.cos(a) * 9, 32 + Math.sin(a) * 9, 3, 0, 7); c.fill(); }
  });

  // ---- traffic light countdown digits are dynamic: see world.js. Lamp lens with a glassy look:
  tile('lens', 832, 704, 64, 64, (w, h) => {
    const g = c.createRadialGradient(26, 24, 2, 32, 32, 30);
    g.addColorStop(0, '#ffffff'); g.addColorStop(0.35, '#e6e6e6'); g.addColorStop(1, '#8a8a8a');
    c.fillStyle = g; c.fillRect(0, 0, w, h);
    c.strokeStyle = 'rgba(0,0,0,0.15)'; c.lineWidth = 2;
    for (let k = 8; k < 32; k += 6) { c.beginPath(); c.arc(32, 32, k, 0, 7); c.stroke(); }
  });

  // ---- leafy bush (texture for hedges)
  tile('leaves', 896, 704, 128, 64, (w, h) => {
    c.fillStyle = '#9a9a9a'; c.fillRect(0, 0, w, h);
    for (let i = 0; i < 260; i++) {
      const v = 150 + r() * 105 | 0;
      c.fillStyle = `rgb(${v},${v},${v})`;
      c.beginPath(); c.ellipse(r() * w, r() * h, 3 + r() * 4, 2 + r() * 2, r() * 3, 0, 7); c.fill();
    }
  });

  // ---- stone tiles (terrace floor) and painted kerb stripes
  tile('terrace', 0, 640, 128, 128, (w, h) => {
    for (let y = 0; y < h; y += 32) for (let x = 0; x < w; x += 32) {
      const v = 225 + r() * 25 | 0;
      c.fillStyle = `rgb(${v},${v - 4},${v - 10})`; c.fillRect(x + 1, y + 1, 30, 30);
    }
  });
  tile('clinicSign', 0, 768, 384, 96, (w, h) => {
    c.fillStyle = '#ffffff'; c.fillRect(0, 0, w, h);
    c.fillStyle = P.busGreen; c.fillRect(0, h - 10, w, 10);
    c.fillStyle = P.mintDark; c.font = `900 ${h * 0.42}px ${FONT}`; c.textAlign = 'left'; c.textBaseline = 'middle';
    c.fillText('FDC Dental Clinic', 20, h * 0.42, w * 0.9);
  });

  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  tex.generateMipmaps = true;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  atlas = { tex, tiles, canvas: cv };
  return atlas;
}

// ------------------------------------------------------------------ the textured static batch
const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _e = new THREE.Euler();
const _v = new THREE.Vector3();
const _s = new THREE.Vector3();

/**
 * Like StaticKit (one merged mesh, vertex colours) but each part can show a tile of the town atlas.
 *   kit.add(geo, color, { x, y, z, rx, ry, rz, sx, sy, sz, parent }, 'window')
 * Parts without a tile use the plain white tile, so colour alone shows.
 */
export class TexKit {
  constructor() { this.parts = []; this.atlas = townAtlas(); }

  add(geo, color, { x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0, sx = 1, sy = 1, sz = 1, parent = null } = {}, tileName = null, { flipU = false } = {}) {
    const g = geo.index ? geo.toNonIndexed() : geo.clone();
    for (const k of Object.keys(g.attributes)) if (k !== 'position' && k !== 'normal' && k !== 'uv') g.deleteAttribute(k);
    _m.compose(_v.set(x, y, z), _q.setFromEuler(_e.set(rx, ry, rz)), _s.set(sx, sy, sz));
    if (parent) _m.premultiply(parent);
    g.applyMatrix4(_m);
    this._finish(g, color, tileName, flipU);
    return this;
  }

  /** A flat quad through 4 points (counter-clockwise seen from the front), full tile. */
  quad(a, b, c, d, color, tileName = null, parent = null, uvs = null) {
    const pos = new Float32Array([...a, ...b, ...c, ...a, ...c, ...d]);
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    const u = uvs || [[0, 0], [1, 0], [1, 1], [0, 1]];
    g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array([...u[0], ...u[1], ...u[2], ...u[0], ...u[2], ...u[3]]), 2));
    if (parent) g.applyMatrix4(parent);
    g.computeVertexNormals();
    this._finish(g, color, tileName, false);
    return this;
  }

  /** A triangle (counter-clockwise from the front). */
  tri(a, b, c, color, tileName = null, parent = null) {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array([...a, ...b, ...c]), 3));
    g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array([0, 0, 1, 0, 0.5, 1]), 2));
    if (parent) g.applyMatrix4(parent);
    g.computeVertexNormals();
    this._finish(g, color, tileName, false);
    return this;
  }

  _finish(g, color, tileName, flipU) {
    const n = g.attributes.position.count;
    if (!g.attributes.normal) g.computeVertexNormals();
    const t = this.atlas.tiles[tileName || 'white'];
    const uv = new Float32Array(n * 2);
    const src = g.attributes.uv;
    for (let i = 0; i < n; i++) {
      let u = src && tileName ? src.getX(i) : 0.5;
      const v = src && tileName ? src.getY(i) : 0.5;
      if (flipU) u = 1 - u;
      uv[i * 2] = t[0] + (t[2] - t[0]) * THREE.MathUtils.clamp(u, 0, 1);
      uv[i * 2 + 1] = t[1] + (t[3] - t[1]) * THREE.MathUtils.clamp(v, 0, 1);
    }
    g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    const col = new THREE.Color(color);
    const arr = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) { arr[i * 3] = col.r; arr[i * 3 + 1] = col.g; arr[i * 3 + 2] = col.b; }
    g.setAttribute('color', new THREE.BufferAttribute(arr, 3));
    this.parts.push(g);
  }

  get count() { return this.parts.length; }

  /** Just the merged geometry (for instancing). */
  geometry() {
    const geo = mergeGeometries(this.parts, false);
    for (const p of this.parts) p.dispose();
    this.parts = [];
    return geo;
  }

  /** The atlas material (shared look for everything built with a TexKit). */
  material({ roughness = 0.8, metalness = 0, glow = 0.08 } = {}) {
    return atlasMaterial({ roughness, metalness, glow });
  }

  /**
   * Merge into one mesh per `size` x `size` metre cell, so the parts of town behind you (or
   * outside a mirror's narrow view) are skipped by frustum culling. Same material for all.
   */
  buildChunks(size = 90, opts = {}) {
    const group = new THREE.Group();
    const cells = new Map();
    const box = new THREE.Box3();
    const c = new THREE.Vector3();
    for (const g of this.parts) {
      box.setFromBufferAttribute(g.attributes.position).getCenter(c);
      const key = `${Math.floor(c.x / size)},${Math.floor(c.z / size)}`;
      if (!cells.has(key)) cells.set(key, []);
      cells.get(key).push(g);
    }
    const mat = atlasMaterial(opts);
    for (const list of cells.values()) {
      const geo = mergeGeometries(list, false);
      geo.computeBoundingSphere();
      const mesh = new THREE.Mesh(geo, mat);
      mesh.matrixAutoUpdate = false;
      group.add(mesh);
    }
    for (const p of this.parts) p.dispose();
    this.parts = [];
    return group;
  }

  build({ roughness = 0.8, metalness = 0, glow = 0.08 } = {}) {
    const geo = this.geometry();
    const mat = atlasMaterial({ roughness, metalness, glow });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.matrixAutoUpdate = false;
    return mesh;
  }
}

export function atlasMaterial({ roughness = 0.8, metalness = 0, glow = 0.08 } = {}) {
  {
    const mat = new THREE.MeshStandardMaterial({ map: townAtlas().tex, vertexColors: true, roughness, metalness });
    if (glow) {
      mat.onBeforeCompile = (sh) => {
        sh.fragmentShader = sh.fragmentShader.replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
          totalEmissiveRadiance += diffuseColor.rgb * ${glow.toFixed(3)};`);
      };
      mat.customProgramCacheKey = () => `atlas-glow${glow.toFixed(3)}`;
    }
    return mat;
  }
}
