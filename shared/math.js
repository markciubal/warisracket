// Sphere-surface math on plain [x, y, z] arrays. Shared by server and browser.
// Surface positions are unit vectors; world position = unit * (R + height).
import { R, GRAVITY } from './constants.js';

export const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
export const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
export const scale = (a, s) => [a[0] * s, a[1] * s, a[2] * s];
export const madd = (a, b, s) => [a[0] + b[0] * s, a[1] + b[1] * s, a[2] + b[2] * s];
export const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
export const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
export const len = a => Math.sqrt(a[0] * a[0] + a[1] * a[1] + a[2] * a[2]);
export const clamp = (x, a, b) => (x < a ? a : x > b ? b : x);
export const lerp = (a, b, t) => a + (b - a) * t;

export function norm(a) {
  const l = len(a) || 1;
  return [a[0] / l, a[1] / l, a[2] / l];
}

// Rodrigues rotation of v around unit axis k.
export function rotateAxis(v, k, ang) {
  const c = Math.cos(ang), s = Math.sin(ang);
  const kv = cross(k, v);
  const kd = dot(k, v) * (1 - c);
  return [
    v[0] * c + kv[0] * s + k[0] * kd,
    v[1] * c + kv[1] * s + k[1] * kd,
    v[2] * c + kv[2] * s + k[2] * kd,
  ];
}

export function anyTangent(p) {
  const a = Math.abs(p[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0];
  return norm(cross(a, p));
}

// Component of v tangent to the sphere at unit point p, normalized.
export function tangent(p, v) {
  const t = madd(v, p, -dot(v, p));
  const l = len(t);
  if (l < 1e-8) return anyTangent(p);
  return [t[0] / l, t[1] / l, t[2] / l];
}

export const angleBetween = (a, b) => Math.acos(clamp(dot(a, b), -1, 1));
export const arcDist = (a, b) => R * angleBetween(a, b);

// Surface direction at `from` heading toward `to`.
export const towardDir = (from, to) => tangent(from, to);
// Surface direction at `at` heading away from `from`.
export const awayDir = (at, from) => tangent(at, scale(from, -1));

// Walk `dist` along tangent `dir` from unit point p, parallel-transporting heading f.
export function moveOnSphere(p, f, dir, dist) {
  const ang = dist / R;
  if (Math.abs(ang) < 1e-9) return [p, f];
  const k = norm(cross(p, dir));
  const np = norm(rotateAxis(p, k, ang));
  return [np, tangent(np, rotateAxis(f, k, ang))];
}

// Push p out of a surface circle (center c, arc radius minArc). Null when not overlapping.
export function pushOut(p, f, c, minArc) {
  const ang = angleBetween(p, c);
  const minAng = minArc / R;
  if (ang >= minAng) return null;
  const n = ang < 1e-6 ? anyTangent(p) : awayDir(p, c);
  const [np, nf] = moveOnSphere(p, f, n, (minAng - ang) * R);
  return { p: np, f: nf, n };
}

export function collideObstacles(p, f, obstacles, radius) {
  for (const o of obstacles) {
    const hit = pushOut(p, f, o.u, o.r + radius);
    if (hit) { p = hit.p; f = hit.f; }
  }
  return [p, f];
}

export function randomUnit(rng = Math.random) {
  const z = rng() * 2 - 1, t = rng() * Math.PI * 2, s = Math.sqrt(1 - z * z);
  return [s * Math.cos(t), z, s * Math.sin(t)];
}

export const randomTangent = (p, rng = Math.random) => rotateAxis(anyTangent(p), p, rng() * Math.PI * 2);

// Semi-implicit Euler step under central gravity. Mutates pos & vel in place.
export function stepProjectile(pos, vel, dt) {
  const r = Math.sqrt(pos[0] * pos[0] + pos[1] * pos[1] + pos[2] * pos[2]);
  const g = (GRAVITY * dt) / r;
  vel[0] -= pos[0] * g; vel[1] -= pos[1] * g; vel[2] -= pos[2] * g;
  pos[0] += vel[0] * dt; pos[1] += vel[1] * dt; pos[2] += vel[2] * dt;
}

// Where the step from a to b goes in through the front of a disk (center c, facing unit normal n,
// radius r), from in front of it to behind it; null if it doesn't.
export function throughDisk(a, b, c, n, r) {
  const da = dot(sub(a, c), n), db = dot(sub(b, c), n);
  if (da < 0 || db > 0 || da === db) return null;
  const p = madd(a, sub(b, a), da / (da - db));
  return len(sub(p, c)) <= r ? p : null;
}

// The face of a target at a range: standing at u, turned to the firing line at `at`.
export function targetFace(u, at, height) {
  const n = towardDir(u, at);
  return { c: madd(scale(u, R + height), n, 0.07), n };
}

// The obstacle a projectile at world `pos` is inside, if any. Obstacles taper toward the top.
export function obstacleAt(pos, obstacles) {
  const r = len(pos);
  const hgt = r - R;
  if (hgt < 0) return null;
  const ux = pos[0] / r, uy = pos[1] / r, uz = pos[2] / r;
  for (const o of obstacles) {
    if (hgt > o.h) continue;
    // cheap reject before the acos: farther than the obstacle's full radius can't be inside it
    if (o.cosAt !== R) { o.cosR = Math.cos(o.r / R); o.cosAt = R; }   // R changes when the planet grows
    const d = ux * o.u[0] + uy * o.u[1] + uz * o.u[2];
    if (d < o.cosR) continue;
    const eff = o.r * (1 - (o.taper * hgt) / o.h);
    if (Math.acos(Math.min(1, d)) * R < eff) return o;
  }
  return null;
}

// 0 = miss, 1 = body, 2 = head. Player is a vertical cylinder standing at unit p, lifted by h.
export function hitPlayer(pos, p, h, radius) {
  const proj = dot(pos, p);
  const hgt = proj - (R + h);
  if (hgt < -0.2 || hgt > 2.15) return 0;
  const lx = pos[0] - p[0] * proj, ly = pos[1] - p[1] * proj, lz = pos[2] - p[2] * proj;
  if (lx * lx + ly * ly + lz * lz > radius * radius) return 0;
  return hgt > 1.5 ? 2 : 1;
}

// Fly a projectile until it lands. visit(pos, t) is called every step; returning true stops early.
export function traceArc(pos0, vel0, obstacles, maxT = 4, dt = 1 / 60, visit = null) {
  const pos = pos0.slice(), vel = vel0.slice();
  for (let t = 0; t < maxT; t += dt) {
    stepProjectile(pos, vel, dt);
    if (visit && visit(pos, t) === true) return null;
    if (len(pos) <= R) return { pos, t, ground: true };
    if (obstacles && obstacleAt(pos, obstacles)) return { pos, t, ground: false };
  }
  return null;
}
