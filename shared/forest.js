// The dark forest's shape (peace mode), worked out the same way on the server and in the browser.
//
// It's a patch of the planet round its middle (s.u, on the equator), and fully grown it covers
// about half the planet: out to `reach` from the middle (a little over a quarter of the way
// round), give or take an edge that wanders in and out with Perlin noise (`wobble` of it, seeded by s.seed, so every
// round's forest is a different shape), and pulled well in toward the poles (`poles`), so the
// volcano on top and the Businessman underneath stay out of it. The edge only depends on which
// way you go from the middle, so the forest is all one piece: no islands, no holes.
//
// It grows a ring at a time (s.rings, out of FOREST_TIERS.length): each ring is a quarter of the
// way from the full edge in to the middle, so with 2 it reaches halfway out, with 4 all the way.
// Rings are counted from the edge in (tier 0, the edge, to rings - 1, the heart), and follow the
// edge's shape, wobbles and all.
import * as M from './math.js';
import { R, SHOPS, FOREST_TIERS } from './constants.js';

// ---- 3D Perlin noise (Ken Perlin's improved noise), its gradients shuffled by a seed
const noises = new Map();
function noiseFor(seed) {
  let n = noises.get(seed);
  if (n) return n;
  const perm = Array.from({ length: 256 }, (_, i) => i);
  let r = (seed >>> 0) || 1;
  const rnd = () => { r = (Math.imul(r, 1664525) + 1013904223) >>> 0; return r / 4294967296; };
  for (let i = 255; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [perm[i], perm[j]] = [perm[j], perm[i]]; }
  const p = new Uint8Array(512);
  for (let i = 0; i < 512; i++) p[i] = perm[i & 255];
  const fade = t => t * t * t * (t * (t * 6 - 15) + 10);
  const grad = (h, x, y, z) => {
    const u = h < 8 ? x : y, v = h < 4 ? y : h === 12 || h === 14 ? x : z;
    return (h & 1 ? -u : u) + (h & 2 ? -v : v);
  };
  n = (x, y, z) => {
    const X = Math.floor(x), Y = Math.floor(y), Z = Math.floor(z);
    x -= X; y -= Y; z -= Z;
    const xi = X & 255, yi = Y & 255, zi = Z & 255;
    const u = fade(x), v = fade(y), w = fade(z);
    const A = p[xi] + yi, AA = p[A] + zi, AB = p[A + 1] + zi, B = p[xi + 1] + yi, BA = p[B] + zi, BB = p[B + 1] + zi;
    return M.lerp(
      M.lerp(M.lerp(grad(p[AA] & 15, x, y, z), grad(p[BA] & 15, x - 1, y, z), u),
        M.lerp(grad(p[AB] & 15, x, y - 1, z), grad(p[BB] & 15, x - 1, y - 1, z), u), v),
      M.lerp(M.lerp(grad(p[AA + 1] & 15, x, y, z - 1), grad(p[BA + 1] & 15, x - 1, y, z - 1), u),
        M.lerp(grad(p[AB + 1] & 15, x, y - 1, z - 1), grad(p[BB + 1] & 15, x - 1, y - 1, z - 1), u), v),
      w);
  };
  noises.set(seed, n);
  return n;
}

// -1..1, smooth: two octaves of the noise at a point (a unit vector, for the edge a direction)
export function wobbleAt(seed, d) {
  const n = noiseFor(seed);
  const a = n(d[0] * 1.9 + 3.1, d[1] * 1.9 + 7.7, d[2] * 1.9 + 1.3);
  const b = n(d[0] * 4.3 + 9.2, d[1] * 4.3 + 2.4, d[2] * 4.3 + 5.8);
  return M.clamp((a + 0.45 * b) * 1.25, -1, 1);
}

// which way p is from the middle (a direction there), and how far round (an angle)
function bearing(s, p) {
  const ang = M.angleBetween(s.u, p);
  return { ang, dir: ang < 1e-6 ? s.f : M.towardDir(s.u, p) };
}

// how far out (an angle) the forest's edge is, fully grown, going way `dir` from the middle
export function edgeAngle(s, dir) {
  const def = SHOPS.haunt;
  const pole = M.clamp((Math.abs(dir[1]) - 0.55) / 0.4, 0, 1);
  return def.reach * (1 + def.wobble * wobbleAt(s.seed, dir)) * (1 - def.poles * pole * pole * (3 - 2 * pole));
}

const grownBy = (s, grown) => (grown ? 1 : (s.rings || 1) / FOREST_TIERS.length);

// How deep into the forest p is: 1 at the middle, 0 at its edge (as it is now, or fully grown),
// below 0 outside.
export function depth(s, p, grown = false) {
  const { ang, dir } = bearing(s, p);
  return 1 - ang / (grownBy(s, grown) * edgeAngle(s, dir));
}

// How far p is outside the forest's edge, along the ground (below 0: inside, that far in).
export function outside(s, p, grown = false) {
  const { ang, dir } = bearing(s, p);
  return (ang - grownBy(s, grown) * edgeAngle(s, dir)) * R;
}

// Which ring p is in, from the edge (0) in to the heart (rings - 1); -1 outside.
export function tierAt(s, p) {
  const f = depth(s, p);
  return f < 0 ? -1 : Math.min((s.rings || 1) - 1, Math.floor(f * (s.rings || 1)));
}

// The point way `dir` from the middle, at depth f (1 the middle, 0 the edge as it is now; below 0
// outside it, and `beyond` along the ground further out again).
export function pointAt(s, dir, f, beyond = 0) {
  const ang = (1 - f) * grownBy(s, false) * edgeAngle(s, dir);
  return M.moveOnSphere(s.u, dir, dir, ang * R + beyond)[0];
}

// which way p is from the middle (a direction there)
export const dirFrom = (s, p) => bearing(s, p).dir;

// how far it is along the ground from the middle out to the edge (as it is now), p's way: what one
// whole unit of depth is there
export const span = (s, p) => Math.max(0.5, grownBy(s, false) * edgeAngle(s, bearing(s, p).dir) * R);

// a ring's depths: from (its outer edge) to (its inner edge)
export const ringDepths = (s, tier) => [tier / (s.rings || 1), (tier + 1) / (s.rings || 1)];

// The way out from p, the shortest way (straight out from the middle), to `beyond` past the edge
// as it is now: where somebody knocked out in there wakes up.
export function wayOut(s, p, beyond) {
  return pointAt(s, bearing(s, p).dir, 0, beyond);
}
