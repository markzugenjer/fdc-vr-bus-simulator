import * as THREE from 'three';
import { P } from '../game/palette.js';

export const FONT = 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';

export function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

export function text(ctx, str, x, y, { size = 40, weight = 500, color = P.ink, align = 'left', maxWidth } = {}) {
  ctx.font = `${weight} ${Math.round(size)}px ${FONT}`;
  ctx.fillStyle = color;
  ctx.textAlign = align;
  ctx.textBaseline = 'alphabetic';
  if (maxWidth) ctx.fillText(str, x, y, maxWidth);
  else ctx.fillText(str, x, y);
}

/** Split text into lines that fit `maxWidth` (uses the current ctx.font). */
export function wrap(ctx, str, maxWidth) {
  const words = String(str).split(/\s+/);
  const lines = [];
  let line = '';
  for (const w of words) {
    const test = line ? `${line} ${w}` : w;
    if (ctx.measureText(test).width > maxWidth && line) { lines.push(line); line = w; } else line = test;
  }
  if (line) lines.push(line);
  return lines;
}

/** Rounded card filling the whole canvas. */
export function card(ctx, W, H, { fill = 'rgba(255,255,255,0.96)', stroke = null, r = 0.12, lw = 8 } = {}) {
  roundRect(ctx, lw / 2 + 2, lw / 2 + 2, W - lw - 4, H - lw - 4, Math.min(W, H) * r);
  ctx.fillStyle = fill;
  ctx.fill();
  if (stroke) {
    ctx.lineWidth = lw;
    ctx.strokeStyle = stroke;
    ctx.stroke();
  }
}

/**
 * A flat panel in the 3D world drawn with a 2D canvas.
 * `draw(ctx, W, H, ...args)` runs again whenever you call `panel.redraw(...args)`.
 */
export function makePanel(w, h, draw, { ppm = 720 } = {}) {
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(w * ppm);
  canvas.height = Math.round(h * ppm);
  const ctx = canvas.getContext('2d');
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  const mat = new THREE.MeshBasicMaterial({ map: tex, transparent: true, toneMapped: false });
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(w, h), mat);
  const panel = {
    mesh,
    canvas,
    redraw(...args) {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      draw(ctx, canvas.width, canvas.height, ...args);
      tex.needsUpdate = true;
    },
  };
  panel.redraw();
  return panel;
}

const TONES = {
  mint: { bg: P.mintDeep, hover: P.mintDark, fg: '#ffffff', sub: 'rgba(255,255,255,0.88)', border: null },
  pink: { bg: P.pinkDeep, hover: '#d9718e', fg: '#ffffff', sub: 'rgba(255,255,255,0.88)', border: null },
  light: { bg: '#ffffff', hover: P.mintSoft, fg: P.ink, sub: P.muted, border: '#cfe7dd' },
};

/** A clickable button: point at it and pull the trigger (or click on desktop). It pops a little on hover. */
export function makeButton(app, { label: initialLabel, sub = '', w = 1.0, h = 0.22, tone = 'mint', onSelect }) {
  let label = initialLabel;
  const t = TONES[tone] || TONES.mint;
  let hover = false;
  const panel = makePanel(w, h, (ctx, W, H) => {
    roundRect(ctx, 8, 8, W - 16, H - 16, H * 0.32);
    ctx.fillStyle = hover ? t.hover : t.bg;
    ctx.fill();
    if (t.border) { ctx.lineWidth = 6; ctx.strokeStyle = t.border; ctx.stroke(); }
    if (hover) { ctx.lineWidth = 10; ctx.strokeStyle = P.pink; ctx.stroke(); }
    const pad = H * 0.32;
    if (sub) {
      text(ctx, label, W / 2, H * 0.5, { size: H * 0.3, weight: 800, color: t.fg, align: 'center', maxWidth: W - pad * 2 });
      text(ctx, sub, W / 2, H * 0.78, { size: H * 0.16, color: t.sub, align: 'center', maxWidth: W - pad * 2 });
    } else {
      text(ctx, label, W / 2, H * 0.62, { size: H * 0.34, weight: 800, color: t.fg, align: 'center', maxWidth: W - pad * 2 });
    }
  });
  const mesh = panel.mesh;
  app.addTarget(mesh, {
    onHover(v) { hover = v; panel.redraw(); mesh.userData.pop = v ? 1 : 0; },
    onSelect() { app.sfx.play('click'); onSelect?.(); },
    setLabel(next) { if (next !== label) { label = next; panel.redraw(); } },
  });
  // Buttons grow a little when hovered (animated by the game loop through tickButtons).
  mesh.userData.button = true;
  mesh.userData.pop = 0;
  mesh.userData.popNow = 0;
  return mesh;
}

/** Smoothly scales every hovered button under `root`. Call once per frame. */
export function tickButtons(root, dt) {
  const k = 1 - Math.exp(-dt * 14);
  root.traverse((o) => {
    if (!o.userData.button) return;
    o.userData.popNow += (o.userData.pop - o.userData.popNow) * k;
    o.scale.setScalar(1 + o.userData.popNow * 0.06);
  });
}
