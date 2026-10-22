import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { R } from '/shared/constants.js';

// mulberry32: small deterministic RNG so every client builds identical scenery from the world seed.
export function seededRandom(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function hash3(x, y, z) {
  let h = Math.imul(x, 374761393) ^ Math.imul(y, 668265263) ^ Math.imul(z, 1440662683);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967295;
}

const smooth = t => t * t * (3 - 2 * t);

// Trilinear value noise in [0, 1].
export function noise3(x, y, z) {
  const xi = Math.floor(x), yi = Math.floor(y), zi = Math.floor(z);
  const xf = smooth(x - xi), yf = smooth(y - yi), zf = smooth(z - zi);
  const l = (a, b, t) => a + (b - a) * t;
  const c = (dx, dy, dz) => hash3(xi + dx, yi + dy, zi + dz);
  return l(
    l(l(c(0, 0, 0), c(1, 0, 0), xf), l(c(0, 1, 0), c(1, 1, 0), xf), yf),
    l(l(c(0, 0, 1), c(1, 0, 1), xf), l(c(0, 1, 1), c(1, 1, 1), xf), yf),
    zf,
  );
}

export function fbm(x, y, z, octaves = 3) {
  let sum = 0, amp = 0.5, freq = 1, norm = 0;
  for (let i = 0; i < octaves; i++) {
    sum += noise3(x * freq, y * freq, z * freq) * amp;
    norm += amp;
    amp *= 0.5;
    freq *= 2.03;
  }
  return sum / norm;
}

export const v3 = a => new THREE.Vector3(a[0], a[1], a[2]);
export const damp = (cur, target, rate, dt) => cur + (target - cur) * (1 - Math.exp(-rate * dt));

const _m = new THREE.Matrix4();
const _x = new THREE.Vector3();
const _up = new THREE.Vector3();
const _fw = new THREE.Vector3();

// Orient obj so local +Y = surface normal and local +Z = heading, standing at height h.
export function placeOnSphere(obj, p, f, h = 0) {
  _up.set(p[0], p[1], p[2]);
  _fw.set(f[0], f[1], f[2]);
  _x.crossVectors(_up, _fw);
  _m.makeBasis(_x, _up, _fw);
  obj.quaternion.setFromRotationMatrix(_m);
  obj.position.copy(_up).multiplyScalar(R + h);
}

const _Y = new THREE.Vector3(0, 1, 0);
const _q = new THREE.Quaternion();

// Same as placeOnSphere but from a unit THREE.Vector3 and a yaw angle.
export function standOn(obj, u, yaw = 0, h = 0) {
  obj.quaternion.setFromUnitVectors(_Y, u);
  _q.setFromAxisAngle(_Y, yaw);
  obj.quaternion.multiply(_q);
  obj.position.copy(u).multiplyScalar(R + h);
}

// The planet grew (or shrank) by dR under obj: keep it on the ground, or as high above it.
// (Anything at the planet's center, like the planet itself, stays put.)
export function lift(obj, dR) {
  const r = obj.position.length();
  if (r > 1) obj.position.multiplyScalar((r + dR) / r);
}

// Matte surfaces (nearly everything here) use Lambert shading, which looks the same in this
// flat-shaded style and is far cheaper per pixel than the physically based material.
// Only things that should actually shine (metal, ice, glass, wet) get MeshStandardMaterial.
const isShiny = o => o.metalness > 0 || (o.roughness !== undefined && o.roughness < 0.5);

export function lambert(opts = {}) {
  const { roughness, metalness, ...rest } = opts;   // PBR-only knobs Lambert doesn't have
  return new THREE.MeshLambertMaterial(rest);
}

const matCache = new Map();
// Cached material by color + options (shared across meshes).
export function mat(color, opts = {}) {
  const key = color + JSON.stringify(opts);
  let m = matCache.get(key);
  if (!m) {
    m = isShiny(opts)
      ? new THREE.MeshStandardMaterial({ color, roughness: 0.85, metalness: 0, ...opts })
      : lambert({ color, ...opts });
    matCache.set(key, m);
  }
  return m;
}

// mergeGeometries needs every piece to carry the same attributes.
function mergeable(geo) {
  const g = geo.index ? geo.toNonIndexed() : geo.clone();
  for (const name of Object.keys(g.attributes)) if (!['position', 'normal', 'uv'].includes(name)) g.deleteAttribute(name);
  if (!g.attributes.normal) g.computeVertexNormals();
  if (!g.attributes.uv) g.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(g.attributes.position.count * 2), 2));
  g.morphAttributes = {};
  return g;
}

// Bake a group's direct mesh children into one mesh per material, so a rigid part built from
// lots of little shapes costs one draw call per material instead of one per shape.
// Skipped: shared-geometry meshes and anything marked userData.keep (shown, hidden or moved on
// its own). Children with the same userData.mergeKey merge separately; the result for each
// key is returned so the caller can still toggle it.
export function mergeChildren(group) {
  const buckets = new Map();
  for (const child of [...group.children]) {
    if (!child.isMesh || child.isInstancedMesh || child.userData.keep || child.userData.shared || Array.isArray(child.material)) continue;
    const key = child.material.uuid + (child.userData.mergeKey || '');
    let b = buckets.get(key);
    if (!b) buckets.set(key, b = { material: child.material, mergeKey: child.userData.mergeKey, meshes: [] });
    b.meshes.push(child);
  }
  const byKey = {};
  for (const b of buckets.values()) {
    if (b.meshes.length < 2) { if (b.mergeKey) byKey[b.mergeKey] = b.meshes[0]; continue; }
    const geos = b.meshes.map(m => {
      m.updateMatrix();
      const g = mergeable(m.geometry);
      g.applyMatrix4(m.matrix);
      return g;
    });
    const merged = mergeGeometries(geos);
    if (!merged) continue;
    const mesh = new THREE.Mesh(merged, b.material);
    mesh.castShadow = b.meshes.some(m => m.castShadow);
    mesh.receiveShadow = b.meshes.some(m => m.receiveShadow);
    mesh.renderOrder = b.meshes[0].renderOrder;
    for (const m of b.meshes) m.removeFromParent();
    group.add(mesh);
    if (b.mergeKey) byKey[b.mergeKey] = mesh;
  }
  return byKey;
}

export function shadows(obj, cast = true, receive = true) {
  obj.traverse(o => {
    if (o.isMesh) { o.castShadow = cast; o.receiveShadow = receive; }
  });
  return obj;
}

// On a planet this small the camera only ever sees a cap of it; everything past the horizon
// is hidden by the planet itself, but the GPU would still be asked to draw it. Returns
// visible(ux, uy, uz, top, spread): could something standing at unit direction u, reaching up
// to radius `top` and `spread` radians wide, poke above the horizon from here?
export function horizonTest(cam) {
  const d = Math.max(cam.length(), R + 0.01);
  const cx = cam.x / d, cy = cam.y / d, cz = cam.z / d;
  const camSees = Math.acos(R / d);   // angle from the camera's ground point to its horizon
  return (ux, uy, uz, top, spread = 0) => {
    const reach = camSees + Math.acos(Math.min(1, R / top)) + spread + 0.05;
    return reach >= Math.PI || cx * ux + cy * uy + cz * uz > Math.cos(reach);
  };
}

// Ray from camera to point blocked by the planet?
export function behindPlanet(cam, point) {
  const dx = point.x - cam.x, dy = point.y - cam.y, dz = point.z - cam.z;
  const L = Math.sqrt(dx * dx + dy * dy + dz * dz);
  const ix = dx / L, iy = dy / L, iz = dz / L;
  const b = cam.x * ix + cam.y * iy + cam.z * iz;
  const c = cam.x * cam.x + cam.y * cam.y + cam.z * cam.z - (R - 0.3) * (R - 0.3);
  const disc = b * b - c;
  if (disc < 0) return false;
  const t1 = -b - Math.sqrt(disc);
  return t1 > 0 && t1 < L - 0.5;
}
