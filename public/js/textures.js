import * as THREE from 'three';
import { GARBS } from '/shared/constants.js';
import { seededRandom } from './util.js';

function canvasTexture(size, draw, seed = 7) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d');
  draw(g, size, seededRandom(seed));
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.anisotropy = 4;
  return tex;
}

// Draw at all wrapped offsets so textures tile without seams.
function wrapped(s, x, y, fn) {
  for (const dx of [-s, 0, s]) for (const dy of [-s, 0, s]) fn(x + dx, y + dy);
}

function fur(g, s, r, color, count, length = 10) {
  g.strokeStyle = color;
  g.lineWidth = 1.5;
  for (let i = 0; i < count; i++) {
    const x = r() * s, y = r() * s, a = Math.PI / 2 + (r() - 0.5) * 0.8;
    g.beginPath();
    g.moveTo(x, y);
    g.lineTo(x + Math.cos(a) * length * (0.5 + r()), y + Math.sin(a) * length * (0.5 + r()));
    g.stroke();
  }
}

function blob(g, x, y, rad, r) {
  g.beginPath();
  const n = 9;
  for (let i = 0; i <= n; i++) {
    const a = (i / n) * Math.PI * 2;
    const rr = rad * (0.7 + r() * 0.5);
    const px = x + Math.cos(a) * rr, py = y + Math.sin(a) * rr;
    if (i === 0) g.moveTo(px, py); else g.lineTo(px, py);
  }
  g.closePath();
  g.fill();
}

function stripes(g, s, r, color, count, width) {
  g.fillStyle = color;
  for (let i = 0; i < count; i++) {
    const x0 = (i / count) * s + r() * 10;
    const w = width * (0.6 + r() * 0.7);
    const sway = 8 + r() * 14, len = s * (0.35 + r() * 0.65), y0 = r() * s;
    wrapped(s, x0, y0, (x, y) => {
      g.beginPath();
      g.moveTo(x - w / 2, y);
      g.bezierCurveTo(x - w / 2 + sway, y + len * 0.33, x - w / 2 - sway, y + len * 0.66, x, y + len);
      g.bezierCurveTo(x + w / 2 - sway, y + len * 0.66, x + w / 2 + sway, y + len * 0.33, x + w / 2, y);
      g.fill();
    });
  }
}

const PELTS = {
  leopard(g, s, r) {
    g.fillStyle = '#d9a446';
    g.fillRect(0, 0, s, s);
    fur(g, s, r, 'rgba(120,70,20,0.2)', 500);
    for (let i = 0; i < 34; i++) {
      const x = r() * s, y = r() * s, rad = 8 + r() * 8;
      wrapped(s, x, y, (px, py) => {
        g.fillStyle = '#b9772a';
        blob(g, px, py, rad * 0.75, r);
        g.strokeStyle = '#38200e';
        g.lineWidth = 4;
        for (let k = 0; k < 4; k++) {
          const a0 = k * 1.57 + 0.3;
          g.beginPath();
          g.arc(px, py, rad, a0, a0 + 1.05);
          g.stroke();
        }
      });
    }
  },
  tiger(g, s, r) {
    g.fillStyle = '#e1832d';
    g.fillRect(0, 0, s, s);
    fur(g, s, r, 'rgba(255,220,160,0.25)', 400);
    stripes(g, s, r, '#1d120a', 9, 14);
  },
  zebra(g, s, r) {
    g.fillStyle = '#f1ede2';
    g.fillRect(0, 0, s, s);
    stripes(g, s, r, '#151313', 8, 22);
    fur(g, s, r, 'rgba(0,0,0,0.12)', 300);
  },
  mammoth(g, s, r) {
    g.fillStyle = '#6b4325';
    g.fillRect(0, 0, s, s);
    fur(g, s, r, 'rgba(40,20,8,0.55)', 900, 18);
    fur(g, s, r, 'rgba(160,110,60,0.35)', 500, 16);
  },
  wolf(g, s, r) {
    g.fillStyle = '#8a8680';
    g.fillRect(0, 0, s, s);
    fur(g, s, r, 'rgba(40,40,40,0.4)', 700, 14);
    fur(g, s, r, 'rgba(230,225,215,0.35)', 500, 12);
  },
  spotted(g, s, r) {
    g.fillStyle = '#efe9dc';
    g.fillRect(0, 0, s, s);
    g.fillStyle = '#1e1a17';
    for (let i = 0; i < 9; i++) {
      const x = r() * s, y = r() * s, rad = 14 + r() * 20;
      wrapped(s, x, y, (px, py) => blob(g, px, py, rad, r));
    }
    fur(g, s, r, 'rgba(0,0,0,0.1)', 300);
  },
};

const peltCache = new Map();
export function peltTexture(garbIndex) {
  const id = GARBS[garbIndex]?.id || 'leopard';
  if (!peltCache.has(id)) peltCache.set(id, canvasTexture(256, PELTS[id], garbIndex * 31 + 5));
  return peltCache.get(id);
}

export function peltSwatchURL(garbIndex) {
  return peltTexture(garbIndex).image.toDataURL();
}

let barkTex, hideTex;
export function barkTexture() {
  barkTex ||= canvasTexture(128, (g, s, r) => {
    g.fillStyle = '#6b4626';
    g.fillRect(0, 0, s, s);
    for (let i = 0; i < 40; i++) {
      g.strokeStyle = r() < 0.5 ? 'rgba(40,24,10,0.6)' : 'rgba(150,105,60,0.4)';
      g.lineWidth = 1 + r() * 3;
      const x = r() * s;
      g.beginPath();
      g.moveTo(x, 0);
      g.bezierCurveTo(x + r() * 8 - 4, s * 0.3, x + r() * 8 - 4, s * 0.6, x, s);
      g.stroke();
    }
  }, 99);
  return barkTex;
}

export function hideTexture() {
  hideTex ||= canvasTexture(256, (g, s, r) => {
    g.fillStyle = '#b48a5c';
    g.fillRect(0, 0, s, s);
    for (let i = 0; i < 26; i++) {
      g.fillStyle = `rgba(${90 + r() * 40},${60 + r() * 30},${30 + r() * 20},0.35)`;
      const x = r() * s, y = r() * s;
      wrapped(s, x, y, (px, py) => blob(g, px, py, 10 + r() * 26, r));
    }
    // stitched seams between hide patches
    g.strokeStyle = '#3d2614';
    g.lineWidth = 3;
    for (const x of [s * 0.25, s * 0.75]) {
      g.setLineDash([6, 6]);
      g.beginPath();
      g.moveTo(x, 0);
      g.lineTo(x, s);
      g.stroke();
    }
    g.setLineDash([]);
  }, 1234);
  return hideTex;
}

let softTex;
// Radial soft dot used for smoke, glow and flash sprites.
export function softDotTexture() {
  if (softTex) return softTex;
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d');
  const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grad.addColorStop(0, 'rgba(255,255,255,1)');
  grad.addColorStop(0.4, 'rgba(255,255,255,0.6)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 64, 64);
  softTex = new THREE.CanvasTexture(c);
  softTex.colorSpace = THREE.SRGBColorSpace;
  return softTex;
}
