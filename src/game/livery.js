import * as THREE from 'three';
import qrcode from 'qrcode-generator';
import { P } from './palette.js';

/**
 * The Smile Bus livery, painted on canvases from the photos of the real bus:
 *   - sides: tinted window band with the big green fdc logo, "Dental Clinic Smile Bus",
 *     pink waves, green skirt, the waving tooth mascot, QR "Download aplikasi FDC", website
 *   - front: windscreen slogans, white nose with the pink smile, green bumper, plate B 7893 TDB
 *   - rear: "Smile Bus by FDC Dental Clinic", QR, logo, website
 *
 * Measurements are in bus metres (see bus.js): u runs along the bus (+ = front), y is height.
 */
export const BUS = {
  length: 8.7,
  width: 2.36,
  front: 4.35,
  rear: -4.35,
  bottom: 0.36,
  roof: 3.16,
  winBottom: 1.55,
  winTop: 2.9,
  door: [2.5, 3.82], // front door (left side), u range
  axleFront: 2.3,
  axleRear: -2.35,
  wheelR: 0.48,
};
export const WEBSITE = 'www.fdcdentalclinic.co.id';

const FONT = 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';

function canvas(w, h) {
  const cv = document.createElement('canvas');
  cv.width = w;
  cv.height = h;
  return cv;
}
function tex(cv) {
  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}
function txt(c, s, x, y, size, { weight = 800, color = '#000', align = 'left', font = FONT } = {}) {
  c.font = `${weight} ${Math.round(size)}px ${font}`;
  c.fillStyle = color;
  c.textAlign = align;
  c.textBaseline = 'alphabetic';
  c.fillText(s, x, y);
}

/** The FDC mark: a green tooth outline with a pink smile, then "fdc". Drawn with its top-left at (x, y). */
export function drawLogo(c, x, y, h, { green = P.logoGreen, pink = P.busPink, text = true, glow = false } = {}) {
  const s = h; // tooth height
  c.save();
  c.translate(x, y);
  c.lineCap = 'round';
  c.lineJoin = 'round';
  if (glow) { c.shadowColor = 'rgba(80,255,90,0.55)'; c.shadowBlur = s * 0.08; }
  // tooth outline: open curve, left lobe, notch, right lobe, down the right side to a root tip
  c.strokeStyle = green;
  c.lineWidth = s * 0.085;
  c.beginPath();
  c.moveTo(s * 0.06, s * 0.72);
  c.bezierCurveTo(-s * 0.06, s * 0.35, s * 0.02, s * 0.02, s * 0.3, s * 0.04);
  c.bezierCurveTo(s * 0.45, s * 0.05, s * 0.5, s * 0.16, s * 0.55, s * 0.17);
  c.bezierCurveTo(s * 0.62, s * 0.13, s * 0.72, s * 0.0, s * 0.92, s * 0.06);
  c.bezierCurveTo(s * 1.12, s * 0.14, s * 1.06, s * 0.5, s * 0.96, s * 0.66);
  c.bezierCurveTo(s * 0.9, s * 0.78, s * 0.86, s * 0.92, s * 0.84, s * 1.0);
  c.stroke();
  // inner swoosh from the notch down into the right lobe
  c.lineWidth = s * 0.07;
  c.beginPath();
  c.moveTo(s * 0.55, s * 0.17);
  c.bezierCurveTo(s * 0.62, s * 0.3, s * 0.78, s * 0.3, s * 0.9, s * 0.2);
  c.stroke();
  // pink smile
  c.shadowBlur = 0;
  c.fillStyle = pink;
  c.beginPath();
  c.moveTo(s * 0.08, s * 0.6);
  c.quadraticCurveTo(s * 0.45, s * 0.86, s * 0.82, s * 0.56);
  c.quadraticCurveTo(s * 0.45, s * 0.74, s * 0.08, s * 0.6);
  c.fill();
  if (text) {
    if (glow) { c.shadowColor = 'rgba(80,255,90,0.55)'; c.shadowBlur = s * 0.08; }
    txt(c, 'fdc', s * 1.12, s * 0.86, s * 0.82, { weight: 700, color: green });
  }
  c.restore();
  return s * 1.12 + (text ? s * 1.25 : 0); // width
}

/** The waving tooth mascot with a crown and a green bandana. Centre-bottom at (x, y), height h. */
export function drawMascot(c, x, y, h) {
  const s = h;
  c.save();
  c.translate(x, y);
  // body (tooth)
  c.fillStyle = '#ffffff';
  c.strokeStyle = '#d9dde3';
  c.lineWidth = s * 0.015;
  c.beginPath();
  c.moveTo(-s * 0.32, -s * 0.62);
  c.bezierCurveTo(-s * 0.42, -s * 1.02, -s * 0.05, -s * 1.02, 0, -s * 0.86);
  c.bezierCurveTo(s * 0.05, -s * 1.02, s * 0.42, -s * 1.02, s * 0.32, -s * 0.62);
  c.bezierCurveTo(s * 0.3, -s * 0.35, s * 0.2, -s * 0.2, s * 0.18, 0);
  c.lineTo(s * 0.04, 0);
  c.lineTo(0, -s * 0.18);
  c.lineTo(-s * 0.04, 0);
  c.lineTo(-s * 0.18, 0);
  c.bezierCurveTo(-s * 0.2, -s * 0.2, -s * 0.3, -s * 0.35, -s * 0.32, -s * 0.62);
  c.fill();
  c.stroke();
  // waving arm
  c.strokeStyle = '#ffffff';
  c.lineWidth = s * 0.08;
  c.lineCap = 'round';
  c.beginPath(); c.moveTo(s * 0.26, -s * 0.5); c.lineTo(s * 0.46, -s * 0.78); c.stroke();
  c.fillStyle = '#f4a3b9';
  c.beginPath(); c.arc(s * 0.48, -s * 0.82, s * 0.06, 0, Math.PI * 2); c.fill();
  // eyes, cheeks, mouth
  for (const sx of [-1, 1]) {
    c.fillStyle = '#2b2b33';
    c.beginPath(); c.ellipse(sx * s * 0.11, -s * 0.66, s * 0.055, s * 0.07, 0, 0, Math.PI * 2); c.fill();
    c.fillStyle = '#ffffff';
    c.beginPath(); c.arc(sx * s * 0.11 + s * 0.02, -s * 0.69, s * 0.02, 0, Math.PI * 2); c.fill();
    c.fillStyle = 'rgba(255,140,170,0.6)';
    c.beginPath(); c.ellipse(sx * s * 0.2, -s * 0.57, s * 0.05, s * 0.03, 0, 0, Math.PI * 2); c.fill();
  }
  c.fillStyle = '#e8546e';
  c.beginPath(); c.moveTo(-s * 0.1, -s * 0.56); c.quadraticCurveTo(0, -s * 0.4, s * 0.1, -s * 0.56); c.closePath(); c.fill();
  // green bandana
  c.fillStyle = P.busGreen;
  c.beginPath();
  c.moveTo(-s * 0.3, -s * 0.42); c.quadraticCurveTo(0, -s * 0.34, s * 0.3, -s * 0.42);
  c.lineTo(0, -s * 0.18); c.closePath(); c.fill();
  // crown
  c.fillStyle = '#5cc95a';
  c.beginPath();
  c.moveTo(-s * 0.16, -s * 0.93); c.lineTo(-s * 0.2, -s * 1.08); c.lineTo(-s * 0.08, -s * 1.0); c.lineTo(0, -s * 1.12);
  c.lineTo(s * 0.08, -s * 1.0); c.lineTo(s * 0.2, -s * 1.08); c.lineTo(s * 0.16, -s * 0.93); c.closePath(); c.fill();
  c.fillStyle = '#ffd84a';
  for (const k of [-0.2, 0, 0.2]) { c.beginPath(); c.arc(k * s, -s * (k ? 1.08 : 1.12), s * 0.022, 0, Math.PI * 2); c.fill(); }
  c.restore();
}

export function drawQR(c, url, x, y, size, { dark = '#111', light = '#fff' } = {}) {
  const qr = qrcode(0, 'M');
  qr.addData(url);
  qr.make();
  const n = qr.getModuleCount();
  const cell = size / (n + 4);
  c.fillStyle = light;
  c.fillRect(x, y, size, size);
  c.fillStyle = dark;
  for (let r = 0; r < n; r++) for (let k = 0; k < n; k++) if (qr.isDark(r, k)) c.fillRect(Math.floor(x + (k + 2) * cell), Math.floor(y + (r + 2) * cell), Math.ceil(cell), Math.ceil(cell));
}

// ------------------------------------------------------------------ sides
/** One side of the bus. `left` = the door side (Indonesia drives on the left, the door faces the kerb). */
export function sideTexture(left) {
  const W = 2048;
  const H = Math.round(W * ((BUS.roof - BUS.bottom) / BUS.length));
  const cv = canvas(W, H);
  const c = cv.getContext('2d');
  // u (bus metres along, + = front) → canvas x. Seen from the left, the front is on the left.
  const X = (u) => (left ? (BUS.front - u) : (u - BUS.rear)) / BUS.length * W;
  const Y = (y) => (BUS.roof - y) / (BUS.roof - BUS.bottom) * H;
  const box = (u0, u1, y0, y1) => { const a = X(u0); const b = X(u1); return [Math.min(a, b), Y(y1), Math.abs(b - a), Y(y0) - Y(y1)]; };
  const k = W / BUS.length; // px per metre

  c.fillStyle = '#ffffff';
  c.fillRect(0, 0, W, H);
  // a soft shade towards the roof
  const shade = c.createLinearGradient(0, 0, 0, Y(BUS.winTop));
  shade.addColorStop(0, '#e9edf0'); shade.addColorStop(1, '#ffffff');
  c.fillStyle = shade;
  c.fillRect(0, 0, W, Y(BUS.winTop));

  // window band (tinted glass with a sky reflection)
  const [wx, wy, ww, wh] = box(BUS.rear + 0.18, BUS.front - 0.32, BUS.winBottom, BUS.winTop);
  const glass = c.createLinearGradient(0, wy, 0, wy + wh);
  glass.addColorStop(0, '#30404c'); glass.addColorStop(0.45, '#151c22'); glass.addColorStop(1, '#0d1216');
  c.fillStyle = glass;
  roundRect(c, wx, wy, ww, wh, k * 0.12); c.fill();
  // reflections: a few soft diagonal streaks
  c.save();
  c.globalAlpha = 0.09;
  c.fillStyle = '#ffffff';
  for (let i = 0; i < 6; i++) {
    const sx = wx + (i / 6) * ww + k * 0.4;
    c.beginPath(); c.moveTo(sx, wy); c.lineTo(sx + k * 0.35, wy); c.lineTo(sx - k * 0.25, wy + wh); c.lineTo(sx - k * 0.6, wy + wh); c.fill();
  }
  c.restore();
  // window pillars
  c.fillStyle = '#0a0e11';
  const pillars = left ? [BUS.door[0] - 0.05, 0.85, -0.25, -1.6, -2.9] : [3.1, 1.75, 0.4, -0.95, -2.3, -3.6];
  for (const u of pillars) c.fillRect(X(u) - k * 0.035, wy, k * 0.07, wh);

  // green skirt (rises at the front corner like the real bus)
  c.fillStyle = P.busGreen;
  c.beginPath();
  c.moveTo(X(BUS.rear), Y(BUS.bottom));
  c.lineTo(X(BUS.rear), Y(0.66));
  c.lineTo(X(BUS.front - 0.55), Y(0.66));
  c.quadraticCurveTo(X(BUS.front - 0.2), Y(0.68), X(BUS.front), Y(1.05));
  c.lineTo(X(BUS.front), Y(BUS.bottom));
  c.closePath();
  c.fill();
  c.fillStyle = P.busGreenDark;
  c.fillRect(0, Y(0.66) - 3, W, 5);

  // pink waves
  c.fillStyle = P.busPink;
  const wave = (u0, u1, base, top) => {
    c.beginPath();
    c.moveTo(X(u0), Y(base));
    const n = 3;
    for (let i = 0; i < n; i++) {
      const a = u0 + ((u1 - u0) * i) / n;
      const b = u0 + ((u1 - u0) * (i + 1)) / n;
      c.bezierCurveTo(X(a + (b - a) * 0.3), Y(top + (i % 2 ? -0.08 : 0.06)), X(a + (b - a) * 0.7), Y(top + (i % 2 ? 0.08 : -0.04)), X(b), Y(top - 0.02 * i));
    }
    c.lineTo(X(u1), Y(base));
    c.closePath();
    c.fill();
  };
  wave(1.95, -0.4, 0.67, 0.97);
  wave(-1.25, -3.0, 0.67, 0.93);
  // big pink swoosh at the rear corner behind the mascot
  c.beginPath();
  c.moveTo(X(-3.0), Y(0.67));
  c.bezierCurveTo(X(-3.3), Y(1.4), X(-3.3), Y(1.6), X(-3.75), Y(2.2));
  c.bezierCurveTo(X(-4.0), Y(2.55), X(-4.1), Y(2.75), X(BUS.rear + 0.05), Y(2.95));
  c.lineTo(X(BUS.rear), Y(0.67));
  c.closePath();
  c.fill();

  // luggage hatches and panel lines
  c.strokeStyle = 'rgba(40,60,50,0.28)';
  c.lineWidth = 3;
  for (const [u0, u1] of [[1.75, 0.05], [-0.45, -2.0], [-2.6, -3.9]]) {
    const [x0, y0, w0, h0] = box(u0, u1, 0.7, 1.08);
    c.strokeRect(x0, y0, w0, h0);
    c.fillStyle = '#9aa3a8';
    c.fillRect(x0 + w0 / 2 - k * 0.06, y0 + h0 * 0.4, k * 0.12, h0 * 0.18);
  }
  // side marker lights
  c.fillStyle = '#ff9d2b';
  for (const u of [3.6, 0.9, -2.2]) c.fillRect(X(u) - k * 0.07, Y(1.2), k * 0.14, k * 0.06);

  // door (left side only) and the middle emergency door outline
  if (left) {
    // the doorway itself (dark, with steps); the real door leaves are separate meshes that swing open
    const [dx, dy, dw, dh] = box(BUS.door[0], BUS.door[1], BUS.bottom, BUS.winTop);
    c.fillStyle = '#1b2126';
    roundRect(c, dx, dy, dw, dh, k * 0.05); c.fill();
    c.fillStyle = '#9aa3a8';
    for (let i = 0; i < 3; i++) c.fillRect(dx + 6, Y(0.42 + i * 0.2), dw - 12, k * 0.04);
    const [ex, ey, ew, eh] = box(0.75, -0.2, 0.45, BUS.winTop);
    c.strokeStyle = 'rgba(30,40,40,0.55)';
    c.lineWidth = 4;
    c.strokeRect(ex, ey, ew, eh);
  } else {
    // driver's sliding window frame
    const [dx, dy, dw, dh] = box(3.95, 3.15, BUS.winBottom + 0.04, BUS.winTop - 0.04);
    c.strokeStyle = '#3a4248';
    c.lineWidth = 5;
    c.strokeRect(dx, dy, dw, dh);
  }

  // big glowing fdc logo on the windows
  const logoH = k * 1.02;
  const logoW = logoH * 2.37;
  const logoU = left ? 1.15 : 0.6; // centre of the logo along the bus
  const lx = X(logoU) - logoW / 2;
  drawLogo(c, lx, Y(2.8), logoH, { glow: true });

  // "Dental Clinic Smile Bus" with the green smile under "Smile Bus"
  const ty = Y(1.17);
  const tsize = k * 0.37;
  c.font = `700 ${tsize}px ${FONT}`;
  const a = 'Dental Clinic ';
  const b = 'Smile Bus';
  const wa = c.measureText(a).width;
  const wb = c.measureText(b).width;
  const tx = X(left ? 0.15 : 0.05) - (wa + wb) / 2;
  txt(c, a, tx, ty, tsize, { weight: 700, color: P.mintDark });
  txt(c, b, tx + wa, ty, tsize, { weight: 700, color: P.busPink });
  c.fillStyle = P.busGreen;
  c.beginPath();
  const sx0 = tx + wa + wb * 0.3;
  const sx1 = tx + wa + wb * 0.75;
  c.moveTo(sx0, ty + k * 0.08);
  c.quadraticCurveTo((sx0 + sx1) / 2, ty + k * 0.27, sx1, ty + k * 0.06);
  c.quadraticCurveTo((sx0 + sx1) / 2, ty + k * 0.17, sx0, ty + k * 0.08);
  c.fill();

  // QR "Download aplikasi FDC" on the rear window
  const qs = k * 0.5;
  const qx = X(-3.55) - qs / 2;
  const qy = Y(2.55);
  txt(c, 'DOWNLOAD', qx + qs / 2, qy - k * 0.2, k * 0.065, { color: '#ffffff', align: 'center' });
  txt(c, 'APLIKASI FDC SEKARANG!', qx + qs / 2, qy - k * 0.1, k * 0.065, { color: '#ffffff', align: 'center' });
  drawQR(c, `https://${WEBSITE}`, qx, qy, qs);

  // mascot and the foundation badge
  drawMascot(c, X(-3.45), Y(1.65), k * 0.85);
  drawLogo(c, X(-2.25) - k * 0.2, Y(1.08), k * 0.32, { green: P.mintDark, text: false });
  txt(c, 'fdc', X(-2.25), Y(0.7) - k * 0.02, k * 0.13, { weight: 800, color: '#b88a2a', align: 'center' });

  // website on the skirt
  txt(c, WEBSITE, X(-2.75), Y(0.44), k * 0.15, { weight: 800, color: '#ffffff', align: 'center' });
  return tex(cv);
}

// ------------------------------------------------------------------ front
export function frontTexture() {
  const W = 1024;
  const H = Math.round(W * (1.2 / BUS.width));
  const cv = canvas(W, H);
  const c = cv.getContext('2d');
  const k = W / BUS.width;
  c.fillStyle = '#ffffff';
  c.fillRect(0, 0, W, H);
  // green lower front
  c.fillStyle = P.busGreen;
  c.beginPath();
  c.moveTo(0, H * 0.48);
  c.quadraticCurveTo(W / 2, H * 0.4, W, H * 0.48);
  c.lineTo(W, H);
  c.lineTo(0, H);
  c.closePath();
  c.fill();
  // pink smile on the nose
  c.fillStyle = P.busPink;
  c.beginPath();
  c.moveTo(W * 0.24, H * 0.13);
  c.quadraticCurveTo(W * 0.5, H * 0.42, W * 0.76, H * 0.13);
  c.quadraticCurveTo(W * 0.5, H * 0.3, W * 0.24, H * 0.13);
  c.fill();
  // headlights
  for (const s of [-1, 1]) {
    const cx = W / 2 + s * W * 0.39;
    c.fillStyle = '#20262c';
    c.beginPath();
    c.ellipse(cx, H * 0.47, W * 0.1, H * 0.06, s * -0.12, 0, Math.PI * 2);
    c.fill();
    c.fillStyle = '#eaf6ff';
    c.beginPath(); c.arc(cx - s * W * 0.03, H * 0.47, H * 0.035, 0, Math.PI * 2); c.fill();
    c.fillStyle = '#ffb13b';
    c.fillRect(cx + s * W * 0.03 - 10, H * 0.455, 20, 12);
    // fog lights with chrome slats
    c.fillStyle = '#c9d0d5';
    c.fillRect(cx - W * 0.07, H * 0.72, W * 0.14, H * 0.08);
    c.fillStyle = '#4a5157';
    for (let i = 0; i < 3; i++) c.fillRect(cx - W * 0.065, H * 0.73 + i * H * 0.022, W * 0.13, H * 0.01);
  }
  // grille
  c.fillStyle = '#c9d0d5';
  roundRect(c, W * 0.3, H * 0.6, W * 0.4, H * 0.26, 18); c.fill();
  c.fillStyle = '#181c20';
  roundRect(c, W * 0.315, H * 0.615, W * 0.37, H * 0.23, 14); c.fill();
  c.strokeStyle = '#2c3237';
  c.lineWidth = 3;
  for (let i = 1; i < 12; i++) { c.beginPath(); c.moveTo(W * 0.315 + i * W * 0.031, H * 0.615); c.lineTo(W * 0.315 + i * W * 0.031, H * 0.845); c.stroke(); }
  // plate
  plate(c, W / 2 - W * 0.15, H * 0.82, W * 0.3, H * 0.11);
  void k;
  return tex(cv);
}

export function windshieldTexture() {
  const W = 1024;
  const H = 640;
  const cv = canvas(W, H);
  const c = cv.getContext('2d');
  const g = c.createLinearGradient(0, 0, 0, H);
  g.addColorStop(0, 'rgba(18,24,30,0.95)');
  g.addColorStop(0.3, 'rgba(40,56,70,0.85)');
  g.addColorStop(1, 'rgba(70,95,110,0.7)');
  c.fillStyle = g;
  c.fillRect(0, 0, W, H);
  c.fillStyle = 'rgba(255,255,255,0.08)';
  c.beginPath(); c.moveTo(W * 0.1, H); c.lineTo(W * 0.35, 0); c.lineTo(W * 0.45, 0); c.lineTo(W * 0.2, H); c.fill();
  txt(c, 'Membawa Senyum Lebih Dekat', W / 2, H * 0.11, H * 0.06, { weight: 700, color: '#ffffff', align: 'center' });
  txt(c, 'Be The Reason', W / 2, H * 0.2, H * 0.075, { weight: 700, color: '#ff8fc8', align: 'center' });
  txt(c, 'Someone Smiles', W / 2, H * 0.29, H * 0.075, { weight: 700, color: '#ff8fc8', align: 'center' });
  return tex(cv);
}

// ------------------------------------------------------------------ rear
export function rearTexture() {
  const W = 1024;
  const H = Math.round(W * ((BUS.roof - BUS.bottom) / BUS.width));
  const cv = canvas(W, H);
  const c = cv.getContext('2d');
  const k = W / BUS.width;
  const Y = (y) => (BUS.roof - y) / (BUS.roof - BUS.bottom) * H;
  c.fillStyle = '#ffffff';
  c.fillRect(0, 0, W, H);
  // rear window
  c.fillStyle = '#12181d';
  roundRect(c, W * 0.06, Y(2.95), W * 0.88, Y(1.95) - Y(2.95), 30); c.fill();
  txt(c, 'Smile Bus', W / 2, Y(2.62), k * 0.26, { weight: 800, color: '#ff8fc8', align: 'center' });
  txt(c, 'by FDC Dental Clinic', W / 2, Y(2.47), k * 0.08, { weight: 700, color: P.logoGreen, align: 'center' });
  txt(c, 'Be The Reason', W / 2, Y(2.29), k * 0.11, { weight: 700, color: '#ffffff', align: 'center' });
  txt(c, 'Someone Smiles', W / 2, Y(2.14), k * 0.11, { weight: 700, color: '#ffffff', align: 'center' });
  // chrome brow
  c.fillStyle = '#d4dade';
  roundRect(c, W * 0.2, Y(1.98), W * 0.6, k * 0.1, 20); c.fill();
  txt(c, 'Tourista', W / 2, Y(1.9), k * 0.06, { weight: 700, color: '#555', align: 'center' });
  // white panel: QR, logo, Dental Clinic, website
  c.strokeStyle = '#d5dade';
  c.lineWidth = 4;
  roundRect(c, W * 0.05, Y(1.82), W * 0.9, Y(0.82) - Y(1.82), 40); c.stroke();
  drawQR(c, `https://${WEBSITE}`, W * 0.09, Y(1.75), k * 0.42);
  txt(c, 'DOWNLOAD', W * 0.18, Y(1.17), k * 0.06, { color: P.mintDark, align: 'center' });
  txt(c, 'APLIKASI FDC', W * 0.18, Y(1.1), k * 0.06, { color: P.mintDark, align: 'center' });
  txt(c, 'SEKARANG!', W * 0.18, Y(1.03), k * 0.06, { color: P.mintDark, align: 'center' });
  drawLogo(c, W * 0.36, Y(1.78), k * 0.36, { green: P.busGreenDark });
  txt(c, 'Dental Clinic', W * 0.36, Y(1.18), k * 0.17, { weight: 700, color: P.mintDark });
  txt(c, WEBSITE, W * 0.36, Y(1.02), k * 0.085, { weight: 700, color: P.busPink });
  // green bumper, tail lights, plate
  c.fillStyle = P.busGreen;
  c.fillRect(0, Y(0.75), W, H - Y(0.75));
  c.fillStyle = '#c4222e';
  for (const x of [0, W - W * 0.05]) c.fillRect(x, Y(1.95), W * 0.05, Y(0.9) - Y(1.95));
  plate(c, W / 2 - W * 0.14, Y(0.66), W * 0.28, k * 0.13);
  return tex(cv);
}

function plate(c, x, y, w, h) {
  c.fillStyle = '#ffffff';
  roundRect(c, x, y, w, h, h * 0.12); c.fill();
  c.strokeStyle = '#111';
  c.lineWidth = Math.max(2, h * 0.05);
  roundRect(c, x + h * 0.06, y + h * 0.06, w - h * 0.12, h - h * 0.12, h * 0.1); c.stroke();
  txt(c, 'B 7893 TDB', x + w / 2, y + h * 0.66, h * 0.52, { weight: 800, color: '#111', align: 'center' });
  txt(c, '12·30', x + w / 2, y + h * 0.9, h * 0.16, { weight: 700, color: '#111', align: 'center' });
}

export function roundRect(c, x, y, w, h, r) {
  c.beginPath();
  c.moveTo(x + r, y);
  c.arcTo(x + w, y, x + w, y + h, r);
  c.arcTo(x + w, y + h, x, y + h, r);
  c.arcTo(x, y + h, x, y, r);
  c.arcTo(x, y, x + w, y, r);
  c.closePath();
}
