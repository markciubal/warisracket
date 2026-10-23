// Peace mode: the town that opens up as the planet grows. Doctors, target ranges, a duel ring, a
// tailor, the dark forest, fishing ponds, hot springs and bonfires (SHOPS). Shops keep their size as the planet
// grows under them: each part knows where it goes (shared/layout.js for the range, so the server
// agrees), and relayout() puts everything back after every change of size.
import * as THREE from 'three';
import { R, SHOPS, FOREST_TIERS, weaponOfType } from '/shared/constants.js';
import * as M from '/shared/math.js';
import { shopLayout } from '/shared/layout.js';
import * as F from '/shared/forest.js';
import { mat, lambert, shadows, placeOnSphere, mergeChildren } from './util.js';
import { buildWeapon } from './weapons.js';
import { softDotTexture } from './textures.js';

const clock = () => performance.now() / 1000;
const WOOD = '#7a4b25', DARK = '#1a100a', STRAW = '#d9b45a';
export const SHOP_LOOK = {
  doctor: { color: '#ff5a4d', icon: '🩺', sign: 'DOCTOR', sub: '1 🐚 · ALL BETTER' },
  range:  { color: '#ffd34d', icon: '🎯', sign: 'TARGETS', sub: '1 🐚 A HIT' },
  duel:   { color: '#ff9a3d', icon: '⚔️', sign: 'DUEL RING', sub: 'NOBODY GOES BELOW 1 HP' },
  tailor: { color: '#c58cff', icon: '🎩', sign: 'TAILOR', sub: 'HATS · CAPES' },
  haunt:  { color: '#a07cff', icon: '🌲', sign: 'DARK FOREST', sub: 'THE DEEPER, THE WORSE' },
  pond:   { color: '#4fb3ff', icon: '🎣', sign: 'FISHING', sub: 'FISH FOR 🐚 AND FOOD' },
  spring: { color: '#7fe3d0', icon: '♨️', sign: 'HOT SPRING', sub: 'SOAK TO HEAL' },
  bonfire: { color: '#ff7a2f', icon: '🔥', sign: 'BONFIRE', sub: 'DANCE FOR 🐚' },
};

// A shop's circle: the dark forest's grows as it spreads (the server says how far).
export const zoneOf = s => s.zone ?? SHOPS[s.kind].zone;

// Where a bonfire's drums stand, on the planet (the server works it out the same way).
export function drumsOf(s) {
  const def = SHOPS.bonfire, side = M.cross(s.u, s.f);
  return def.drums.map(a => {
    const dir = M.add(M.scale(s.f, Math.cos(a)), M.scale(side, Math.sin(a)));
    return M.moveOnSphere(s.u, dir, dir, def.zone - def.drumAt)[0];
  });
}

// The same "random" every time for the same seed: a forest's trees stay where they are when it's
// built again bigger.
const seeded = seed => () => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646;

function part(g, geo, material, x = 0, y = 0, z = 0) {
  const m = new THREE.Mesh(geo, material);
  m.position.set(x, y, z);
  g.add(m);
  return m;
}

// ---------------------------------------------------------------- painted bits
function canvasTex(w, h, draw) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  const paint = () => { draw(c.getContext('2d'), w, h); tex.needsUpdate = true; };
  paint();
  document.fonts?.ready.then(paint);   // the cave font may still be on its way
  return tex;
}

// A plank with the shop's name burnt into it.
function signBoard(kind) {
  const look = SHOP_LOOK[kind];
  const tex = canvasTex(256, 128, (g, w, h) => {
    g.fillStyle = '#8b5a2b';
    g.fillRect(0, 0, w, h);
    g.fillStyle = 'rgba(0,0,0,0.12)';
    for (let y = 10; y < h; y += 22) g.fillRect(0, y, w, 3);
    g.strokeStyle = '#4e301a';
    g.lineWidth = 8;
    g.strokeRect(4, 4, w - 8, h - 8);
    g.textAlign = 'center';
    g.fillStyle = '#fff3d6';
    g.font = '46px "Luckiest Guy", Impact, sans-serif';
    g.fillText(look.sign, w / 2, 62, w - 24);
    g.fillStyle = look.color;
    g.font = '24px "Luckiest Guy", Impact, sans-serif';
    g.fillText(look.sub, w / 2, 104, w - 24);
  });
  const board = new THREE.Group();
  const face = new THREE.MeshLambertMaterial({ map: tex });
  part(board, new THREE.BoxGeometry(1.9, 0.95, 0.08), [mat('#6b4423'), mat('#6b4423'), mat('#6b4423'), mat('#6b4423'), face, face]);
  for (const x of [-0.8, 0.8]) part(board, new THREE.CylinderGeometry(0.06, 0.07, 2.2, 5), mat(WOOD), x, -0.65, -0.06);
  return board;
}

// The shop's icon, high up, so you can find it from across the planet.
function iconSprite(kind) {
  const look = SHOP_LOOK[kind];
  const tex = canvasTex(128, 128, (g, w) => {
    g.fillStyle = 'rgba(20,12,6,0.7)';
    g.beginPath();
    g.arc(w / 2, w / 2, 58, 0, Math.PI * 2);
    g.fill();
    g.strokeStyle = look.color;
    g.lineWidth = 7;
    g.stroke();
    g.font = '66px sans-serif';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText(look.icon, w / 2, w / 2 + 4);
  });
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthWrite: false, transparent: true }));
  s.scale.setScalar(1.5);
  s.renderOrder = 9;
  return s;
}

const bullseye = () => canvasTex(128, 128, (g, w) => {
  const rings = ['#e8e0cc', '#c8312a', '#e8e0cc', '#c8312a', '#ffd34d'];
  rings.forEach((c, i) => {
    g.fillStyle = c;
    g.beginPath();
    g.arc(w / 2, w / 2, 62 - i * 12, 0, Math.PI * 2);
    g.fill();
  });
});

const stripes = (a, b, n) => {
  const tex = canvasTex(256, 32, (g, w, h) => {
    for (let i = 0; i < n; i++) { g.fillStyle = i % 2 ? b : a; g.fillRect((i * w) / n, 0, w / n + 1, h); }
  });
  tex.wrapS = THREE.RepeatWrapping;
  return tex;
};

// A flat disk (or ring) bent to lie on the planet: a flat one floats off the curve at its edge.
function groundDisk(radius, inner, material) {
  // (rings of points all the way out, so it bends with the ground; a plain fan from the middle to
  // the edge would be a shallow cone and dip under the ground halfway out)
  const geo = new THREE.RingGeometry(inner > 0 ? inner : 0.001, radius, 48, Math.max(2, Math.ceil((radius - inner) / 0.6)));
  geo.rotateX(-Math.PI / 2);
  const p = geo.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), z = p.getZ(i);
    p.setY(i, Math.sqrt(Math.max(0, R * R - x * x - z * z)) - R);
  }
  geo.computeVertexNormals();
  const m = new THREE.Mesh(geo, material);
  m.renderOrder = 1;
  return m;
}
const groundMat = (color, opacity) => new THREE.MeshBasicMaterial({
  color, transparent: true, opacity, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4, side: THREE.DoubleSide,
});

// ---------------------------------------------------------------- the shops (local +Z = s.f)
const MODELS = {
  // a round clay hut with a big red cross on a pole, and pots of healing herbs
  doctor(g) {
    const r = SHOPS.doctor.r;
    part(g, new THREE.CylinderGeometry(r + 0.08, r + 0.12, 0.3, 16), mat('#9b8f80', { flatShading: true }), 0, 0.15, 0);
    part(g, new THREE.SphereGeometry(r, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2), mat('#eadfca', { flatShading: true }), 0, 0.25, 0).scale.y = 1.1;
    const door = part(g, new THREE.CircleGeometry(0.55, 12, 0, Math.PI), new THREE.MeshBasicMaterial({ color: DARK, side: THREE.DoubleSide }), 0, 0.28, r + 0.02);
    door.scale.y = 1.7;
    part(g, new THREE.CylinderGeometry(0.06, 0.07, 1.6, 5), mat(WOOD), 0, 2.4, 0);
    part(g, new THREE.CylinderGeometry(0.55, 0.55, 0.08, 18), mat('#ffffff'), 0, 3.3, 0).rotation.x = Math.PI / 2;
    const red = mat('#e03a2f');
    part(g, new THREE.BoxGeometry(0.75, 0.24, 0.14), red, 0, 3.3, 0.02);
    part(g, new THREE.BoxGeometry(0.24, 0.75, 0.14), red, 0, 3.3, 0.02);
    for (const [x, z] of [[-1.3, 1.6], [1.25, 1.5]]) {
      part(g, new THREE.CylinderGeometry(0.22, 0.16, 0.36, 8), mat('#a0522d'), x, 0.18, z);
      for (let i = 0; i < 3; i++) part(g, new THREE.IcosahedronGeometry(0.13, 0), mat('#5fae3a', { flatShading: true }), x + Math.cos(i * 2.1) * 0.09, 0.42 + i * 0.04, z + Math.sin(i * 2.1) * 0.09);
    }
  },
  // a wooden booth with a striped awning; the targets stand downrange (+Z) on their own
  range(g) {
    const wood = mat(WOOD), plank = mat('#8b5a2b');
    part(g, new THREE.BoxGeometry(2.4, 1.0, 0.5), plank, 0, 0.5, 0.55);
    part(g, new THREE.BoxGeometry(2.6, 0.08, 0.7), wood, 0, 1.02, 0.55);
    part(g, new THREE.BoxGeometry(2.4, 2.3, 0.14), plank, 0, 1.15, -0.45);
    for (const x of [-1.2, 1.2]) for (const z of [-0.45, 0.8]) part(g, new THREE.CylinderGeometry(0.07, 0.08, 2.5, 5), wood, x, 1.25, z);
    const awning = new THREE.MeshLambertMaterial({ map: stripes('#e8e0cc', '#c8312a', 8), side: THREE.DoubleSide });
    part(g, new THREE.BoxGeometry(2.8, 0.06, 1.7), awning, 0, 2.55, 0.25).rotation.x = 0.18;
    // spears for hire, leaning on the counter
    for (let i = 0; i < 3; i++) {
      const sp = part(g, new THREE.CylinderGeometry(0.025, 0.03, 1.8, 5), mat('#c9a06a'), -0.7 + i * 0.25, 0.9, 0.86);
      sp.rotation.x = -0.25;
      part(g, new THREE.ConeGeometry(0.06, 0.2, 5), mat('#6f6a62'), -0.7 + i * 0.25, 1.82, 1.08).rotation.x = -0.25;
    }
  },
  // a striped tent with a pennant, a dummy in a top hat and a rack of capes
  tailor(g) {
    const r = SHOPS.tailor.r;
    const cloth = new THREE.MeshLambertMaterial({ map: stripes('#8a4fd1', '#f2c94c', 14), side: THREE.DoubleSide });
    part(g, new THREE.ConeGeometry(r + 0.05, 2.9, 14, 1, true), cloth, 0, 1.45, 0);
    const door = part(g, new THREE.CircleGeometry(0.5, 10, 0, Math.PI), new THREE.MeshBasicMaterial({ color: DARK, side: THREE.DoubleSide }), 0, 0.02, r * 1.02);
    door.rotation.x = -Math.atan(r / 2.9);
    door.scale.y = 1.6;
    part(g, new THREE.CylinderGeometry(0.03, 0.03, 0.9, 4), mat(WOOD), 0, 3.3, 0);
    part(g, new THREE.ConeGeometry(0.16, 0.55, 3), mat('#ff5a8a'), 0.27, 3.6, 0).rotation.z = -Math.PI / 2;
    // the dummy
    part(g, new THREE.CylinderGeometry(0.05, 0.06, 1.2, 5), mat(WOOD), 1.9, 0.6, 1.0);
    part(g, new THREE.CapsuleGeometry(0.22, 0.4, 3, 8), mat('#e8dcc0'), 1.9, 1.2, 1.0);
    part(g, new THREE.SphereGeometry(0.17, 8, 6), mat('#e8dcc0'), 1.9, 1.7, 1.0);
    part(g, new THREE.CylinderGeometry(0.2, 0.2, 0.03, 12), mat('#1d1b22'), 1.9, 1.83, 1.0);
    part(g, new THREE.CylinderGeometry(0.13, 0.13, 0.3, 12), mat('#1d1b22'), 1.9, 1.99, 1.0);
    // the rack
    for (const x of [-2.6, -1.4]) part(g, new THREE.CylinderGeometry(0.04, 0.05, 1.5, 5), mat(WOOD), x, 0.75, 0.9);
    part(g, new THREE.CylinderGeometry(0.03, 0.03, 1.3, 5), mat(WOOD), -2.0, 1.45, 0.9).rotation.z = Math.PI / 2;
    ['#c8312a', '#2f6fd1', '#e8b931'].forEach((c, i) => {
      const cape = part(g, new THREE.PlaneGeometry(0.34, 0.8), mat(c, { side: THREE.DoubleSide }), -2.4 + i * 0.4, 1.02, 0.9);
      cape.rotation.y = Math.PI / 2;
    });
  },
};

// A point on the ground d from a shop's middle, in direction a (radians round from its front), in
// the shop's own frame, and which way is up there. Big things (a ring, a hollow) are built in one
// piece and still sit on the curve. (Built for today's R; rebuilt when the planet grows.)
const Y = new THREE.Vector3(0, 1, 0);
function groundAt(d, a) {
  const th = d / R;
  const up = new THREE.Vector3(Math.sin(a) * Math.sin(th), Math.cos(th), Math.cos(a) * Math.sin(th));
  return { pos: new THREE.Vector3(up.x * R, R * Math.cos(th) - R, up.z * R), up };
}
// Stand obj on that curve, d from the middle in direction a, turned yaw about its own up.
function standAt(obj, d, a, yaw = 0) {
  const { pos, up } = groundAt(d, a);
  obj.position.copy(pos);
  obj.quaternion.setFromUnitVectors(Y, up);
  obj.rotateY(yaw);
  return obj;
}

// The big pieces, each one group in the shop's frame (local +Z = s.f).
const CURVED = {
  // sand inside a ring of posts and rope, and the weapon rack just inside the ropes, facing the
  // middle (E anywhere in the ring picks from it)
  duel(g) {
    const zone = SHOPS.duel.zone;
    const sand = g.add(groundDisk(zone, 0, groundMat('#d8c08a', 0.7))).children.at(-1);
    sand.position.y = 0.02;
    const wood = mat(WOOD), n = 12, tops = [];
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2;
      const post = new THREE.Group();
      part(post, new THREE.CylinderGeometry(0.08, 0.1, 1.2, 6), wood, 0, 0.6, 0);
      g.add(standAt(post, zone, a));
      const { pos, up } = groundAt(zone, a);
      tops.push(pos.addScaledVector(up, 0.95));
    }
    const rope = mat('#c9a06a');
    for (let i = 0; i < n; i++) {
      const a = tops[i], b = tops[(i + 1) % n];
      const seg = part(g, new THREE.CylinderGeometry(0.035, 0.035, a.distanceTo(b), 5), rope);
      seg.position.copy(a).add(b).multiplyScalar(0.5);
      seg.quaternion.setFromUnitVectors(Y, b.clone().sub(a).normalize());
    }
    const rack = new THREE.Group();
    for (const x of [-1.1, 1.1]) part(rack, new THREE.CylinderGeometry(0.06, 0.07, 1.5, 5), wood, x, 0.75, 0);
    part(rack, new THREE.BoxGeometry(2.4, 0.1, 0.1), wood, 0, 1.3, -0.12);
    part(rack, new THREE.BoxGeometry(2.4, 0.1, 0.36), mat('#8b5a2b'), 0, 0.08, 0);
    ['club', 'tusk', 'longsword', 'antler', 'glowstick'].forEach((type, i) => {
      const w = buildWeapon(weaponOfType(type));
      w.position.set(-0.84 + i * 0.42, 0.14, 0.04);
      w.rotation.x = -0.13;   // leaning back on the bar
      rack.add(w);
    });
    g.add(standAt(rack, zone - 1.1, 0, Math.PI));
  },
  // The dark forest: its own shape (shared/forest.js), half the planet when it's fully grown.
  // Dark ground out to its wandering edge, darker ring by ring toward the heart (the rings follow
  // the edge's shape), each ring's edge faintly lit, and the gloom of the penumbra round it all; a
  // wood of dead trees and black pines, thick in places and thin in others (clearings), with
  // gravestones out near the edge and bones further in; a ring of standing stones round a glowing
  // altar at the heart; and wisps of green light drifting about (s.wisps). Built again each time it
  // grows: everything in it has its place in the whole forest (seeded), and shows once the forest
  // has grown over it, so what was there stays where it was.
  haunt(g, s) {
    const rings = s.rings || 1, pen = SHOPS.haunt.penumbra;
    // which way from the middle (azimuth a, as groundAt has it), and how far out depth f is that way
    const dirOf = a => M.add(M.scale(s.f, Math.cos(a)), M.scale(M.cross(s.u, s.f), Math.sin(a)));
    const N = 144, edges = Array.from({ length: N + 1 }, (_, i) => F.edgeAngle(s, dirOf((i / N) * Math.PI * 2)) * R);
    const grownTo = rings / FOREST_TIERS.length;
    const distAt = (i, f, beyond = 0) => (1 - f) * grownTo * edges[i] + beyond;
    // a band of ground following the shape, from depth f1 out to f2 (plus beyond: past the edge)
    const band = (f1, f2, b1, b2, color, opacity, lift) => {
      const steps = Math.max(1, Math.ceil(Math.max(...edges) * grownTo * Math.abs(f1 - f2) / 0.9 + Math.abs(b2 - b1) / 0.9));
      const pos = [], idx = [];
      for (let i = 0; i <= N; i++) {
        const a = (i / N) * Math.PI * 2;
        for (let j = 0; j <= steps; j++) {
          const k = j / steps;
          const { pos: q, up } = groundAt(M.lerp(distAt(i, f1, b1), distAt(i, f2, b2), k), a);
          q.addScaledVector(up, lift);
          pos.push(q.x, q.y, q.z);
          if (i < N && j < steps) {
            const v = i * (steps + 1) + j, w = v + steps + 1;
            idx.push(v, w, v + 1, v + 1, w, w + 1);
          }
        }
      }
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
      geo.setIndex(idx);
      const m = new THREE.Mesh(geo, groundMat(color, opacity));
      m.renderOrder = 1;
      g.add(m);
    };
    // the penumbra round it: gloom, not quite forest yet (E there: the gear screen)
    band(0, 0, 0, pen, '#2d2638', 0.34, 0.015);
    band(0, 0, pen - 0.12, pen, '#a08cc8', 0.35, 0.04);
    band(1, 0, 0, 0, '#231a33', 0.72, 0.02);
    for (let k = 1; k < rings; k++) band(1, k / rings, 0, 0, '#0e0816', 0.28, 0.02 + k * 0.004);
    for (let k = 0; k < rings; k++) band(k / rings, k / rings, 0, 0.22, '#7c5cc4', 0.42, 0.05);
    // the wood: merged into a few meshes, one per material
    const wood = new THREE.Group();
    const bark = mat('#2b2420', { flatShading: true }), pine = mat('#18241d', { flatShading: true });
    const stone = mat('#7d7a86', { flatShading: true }), moss = mat('#4f6b3a', { flatShading: true }), bone = mat('#d9d0b8', { flatShading: true });
    const bake = (obj, d, a, yaw) => {   // stand obj on the curve, and move its pieces into the wood
      standAt(obj, d, a, yaw);
      obj.updateMatrix();
      for (const c of [...obj.children]) {
        c.updateMatrix();
        c.matrix.premultiply(obj.matrix);
        c.matrix.decompose(c.position, c.quaternion, c.scale);
        wood.add(c);
      }
    };
    // every spot in the whole forest, fully grown, worked out from its seed (the same every time
    // it's built), at so much ground apiece; each one only shows once the forest has grown over it
    const rnd = seeded(s.seed || s.id);
    const full = 4 * Math.PI * R * R * 0.5;   // (about the ground it covers, fully grown)
    for (let n = Math.round(full / 15), i = 0; i < n * 2; i++) {
      const a = rnd() * Math.PI * 2, cosTh = 1 - rnd() * 2;   // (evenly over the planet...)
      const th = Math.acos(cosTh), d = th * R;
      const roll = rnd(), yaw = rnd() * 6, h = 2.4 + rnd() * 1.8, kindRoll = rnd();
      const dir = dirOf(a), edge = F.edgeAngle(s, dir) * R;
      if (d > edge) continue;                                       // (...in the forest, fully grown)
      const f = 1 - d / (grownTo * edge);                           // how deep, as it is now
      if (f < 0.01 || d < 3.2) continue;                            // (not grown here yet; the heart's stones)
      // thick in places, thin in others: clearings where the noise says so
      const thick = F.wobbleAt((s.seed || 1) + 17, M.moveOnSphere(s.u, dir, dir, d)[0]);
      if (roll > 0.55 + 0.45 * thick) continue;
      const tier = Math.min(rings - 1, Math.floor(f * rings));
      const thing = new THREE.Group();
      if (kindRoll < 0.07 && tier === 0) {
        // a crooked gravestone, out near the edge
        part(thing, new THREE.BoxGeometry(0.5, 0.62, 0.14), stone, 0, 0.31, 0).rotation.z = (roll - 0.5) * 0.6;
        part(thing, new THREE.CylinderGeometry(0.25, 0.25, 0.14, 12), stone, 0, 0.62, 0).rotation.x = Math.PI / 2;
        part(thing, new THREE.BoxGeometry(0.56, 0.06, 0.18), moss, 0, 0.03, 0);
      } else if (kindRoll < 0.12 && tier > 0) {
        // bones lying about, further in
        part(thing, new THREE.CylinderGeometry(0.04, 0.04, 0.6, 5), bone, 0, 0.05, 0).rotation.z = Math.PI / 2;
        part(thing, new THREE.SphereGeometry(0.13, 7, 5), bone, 0.12, 0.1, 0.25);
      } else if (kindRoll < 0.12 + 0.5 * (1 - f)) {
        // dead (more of them out toward the edge): a crooked trunk and bare branches
        part(thing, new THREE.CylinderGeometry(0.08, 0.22, h, 6), bark, 0, h / 2, 0).rotation.z = (kindRoll - 0.3) * 0.5;
        for (let k = 0; k < 4; k++) {
          const br = part(thing, new THREE.CylinderGeometry(0.025, 0.07, 1.1, 4), bark, 0, h * 0.55 + k * 0.32, 0);
          const ba = k * 2.2 + yaw;
          br.position.x = Math.cos(ba) * 0.32;
          br.position.z = Math.sin(ba) * 0.32;
          br.rotation.set(Math.sin(ba) * 0.95, 0, -Math.cos(ba) * 0.95);
        }
      } else {
        // a black pine (more of them deeper in)
        part(thing, new THREE.CylinderGeometry(0.08, 0.12, 0.8, 5), bark, 0, 0.4, 0);
        for (let k = 0; k < 3; k++) part(thing, new THREE.ConeGeometry(0.95 - k * 0.24, h * 0.42, 7), pine, 0, 0.75 + k * h * 0.22, 0);
      }
      bake(thing, d, a, yaw);
    }
    // the heart: standing stones round a glowing altar
    for (let i = 0; i < 6; i++) {
      const st = new THREE.Group();
      part(st, new THREE.BoxGeometry(0.42, 1.6, 0.3), stone, 0, 0.8, 0).rotation.z = (i % 2 ? 1 : -1) * 0.06;
      bake(st, 2.1, (i / 6) * Math.PI * 2, (i / 6) * Math.PI * 2);
    }
    const altar = new THREE.Group();
    part(altar, new THREE.BoxGeometry(1.1, 0.5, 0.7), stone, 0, 0.25, 0);
    bake(altar, 0.01, 0, 0);
    mergeChildren(wood);
    g.add(wood);
    const glow = g.add(groundDisk(1.4, 0, groundMat('#7dff6a', 0.18))).children.at(-1);
    glow.position.y = 0.06;
    // wisps all through it, each drifting round a spot of its own
    s.wisps = [];
    const wr = seeded((s.seed || s.id) + 5);
    for (let i = 0; i < 12 + rings * 6; i++) {
      const a = wr() * Math.PI * 2, f = 0.08 + wr() * 0.9;
      const d = (1 - f) * grownTo * F.edgeAngle(s, dirOf(a)) * R;
      const wisp = new THREE.Group();
      wisp.add(new THREE.Mesh(new THREE.SphereGeometry(0.11, 8, 6), new THREE.MeshBasicMaterial({ color: '#b8ff9a' })));
      wisp.add(new THREE.Mesh(new THREE.SphereGeometry(0.3, 8, 6), new THREE.MeshBasicMaterial({ color: '#7dff6a', transparent: true, opacity: 0.22, depthWrite: false })));
      g.add(wisp);
      s.wisps.push({ obj: wisp, a, d: Math.max(2.5, d), ph: i * 1.7 });
    }
  },
  // a fishing pond: deep water you can't walk into (r), a sandy bank all round to stand on and
  // cast from (zone), reeds, stones and lily pads
  pond(g, s) {
    const { r, zone } = SHOPS.pond;
    const bank = g.add(groundDisk(zone, r - 0.1, groundMat('#c9b27a', 0.6))).children.at(-1);
    bank.position.y = 0.02;
    const water = g.add(groundDisk(r, 0, groundMat('#2f78c0', 0.92))).children.at(-1);
    water.position.y = 0.04;
    s.shine = g.add(groundDisk(r * 0.5, 0, groundMat('#bfe6ff', 0.22))).children.at(-1);
    s.shine.position.y = 0.06;
    const reed = mat('#5d8f3a', { flatShading: true }), tail = mat('#6b4423');
    for (let i = 0; i < 9; i++) {
      const tuft = new THREE.Group();
      for (let k = 0; k < 3; k++) {
        const h = 0.8 + ((i + k) % 3) * 0.2;
        const stalk = part(tuft, new THREE.CylinderGeometry(0.02, 0.03, h, 4), reed, (k - 1) * 0.12, h / 2, (k % 2) * 0.1);
        stalk.rotation.z = (k - 1) * 0.15;
        if (k !== 1) part(tuft, new THREE.CapsuleGeometry(0.045, 0.16, 2, 5), tail, (k - 1) * 0.12 + (k - 1) * h * 0.15, h, (k % 2) * 0.1);
      }
      g.add(standAt(tuft, r + 0.05, i * 0.7 + (i % 3) * 0.25, i));
    }
    const stone = mat('#8a857c', { flatShading: true });
    for (let i = 0; i < 6; i++) {
      const holder = new THREE.Group();
      part(holder, new THREE.DodecahedronGeometry(0.22 + (i % 3) * 0.06, 0), stone, 0, 0.08, 0);
      g.add(standAt(holder, r + 0.35, i * 1.05 + 0.4, i));
    }
    s.pads = [];
    const pad = mat('#4f9a3a', { side: THREE.DoubleSide });
    for (let i = 0; i < 4; i++) {
      const lily = new THREE.Group();
      const leaf = part(lily, new THREE.CircleGeometry(0.3, 12, 0.35, Math.PI * 2 - 0.7), pad, 0, 0.08, 0);
      leaf.rotation.x = -Math.PI / 2;
      if (i % 2 === 0) part(lily, new THREE.SphereGeometry(0.08, 6, 5), mat('#ffb6d9'), 0.05, 0.13, 0.05);
      g.add(standAt(lily, 0.7 + i * 0.35, i * 1.7 + 0.8, i));
      s.pads.push(lily);
    }
  },
  // a hot spring: a steaming pool in a ring of stones, to stand in (no wall: you walk in)
  spring(g, s) {
    const { zone } = SHOPS.spring;
    const water = g.add(groundDisk(zone - 0.2, 0, groundMat('#5fd6c8', 0.85))).children.at(-1);
    water.position.y = 0.04;
    const glow = g.add(groundDisk(zone * 0.45, 0, groundMat('#d9fff6', 0.25))).children.at(-1);
    glow.position.y = 0.06;
    const stones = [mat('#8a857c', { flatShading: true }), mat('#6f6a62', { flatShading: true }), mat('#a39b8b', { flatShading: true })];
    for (let i = 0; i < 16; i++) {
      const holder = new THREE.Group();
      part(holder, new THREE.DodecahedronGeometry(0.26 + (i % 3) * 0.05, 0), stones[i % 3], 0, 0.1, 0).rotation.set(i, i * 2, 0);
      g.add(standAt(holder, zone + 0.05, (i / 16) * Math.PI * 2, i));
    }
    // steam, curling up off the water (update moves it)
    s.steam = [];
    for (let i = 0; i < 8; i++) {
      const puff = new THREE.Sprite(new THREE.SpriteMaterial({ map: softDotTexture(), color: '#ffffff', transparent: true, opacity: 0, depthWrite: false }));
      g.add(puff);
      s.steam.push({ obj: puff, d: 0.4 + (i % 4) * 0.55, a: i * 2.4, ph: i / 8 });
    }
  },
  // a bonfire: a big fire in a ring of stones (r: you can't walk into it), trampled dirt to dance
  // on (zone), log seats and a couple of drums round the edge
  bonfire(g, s) {
    const { r, zone } = SHOPS.bonfire;
    const dirt = g.add(groundDisk(zone, 0, groundMat('#7a5a3a', 0.45))).children.at(-1);
    dirt.position.y = 0.02;
    const edge = g.add(groundDisk(zone, zone - 0.25, groundMat('#ff7a2f', 0.4))).children.at(-1);
    edge.position.y = 0.03;
    const stone = mat('#6f6a62', { flatShading: true });
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * Math.PI * 2;
      part(g, new THREE.DodecahedronGeometry(0.24, 0), stone, Math.cos(a) * r, 0.1, Math.sin(a) * r).rotation.set(i, i * 2, 0);
    }
    const wood = mat('#5a3519');
    for (let i = 0; i < 4; i++) {
      const a = (i / 4) * Math.PI * 2;
      const log = part(g, new THREE.CylinderGeometry(0.1, 0.12, 1.5, 6), wood, Math.cos(a) * 0.25, 0.45, Math.sin(a) * 0.25);
      log.rotation.set(Math.sin(a) * 0.8, 0, -Math.cos(a) * 0.8);
    }
    s.flames = ['#ff5a14', '#ff9a1f', '#ffe066'].map((color, i) =>
      part(g, new THREE.ConeGeometry(0.7 - i * 0.18, 1.8 - i * 0.3, 8), new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.85, depthWrite: false }), 0, 0.8 + i * 0.08, 0));
    // log seats, and drums
    for (let i = 0; i < 4; i++) {
      const seat = new THREE.Group();
      part(seat, new THREE.CylinderGeometry(0.2, 0.22, 1.5, 8), wood, 0, 0.2, 0).rotation.z = Math.PI / 2;
      g.add(standAt(seat, zone - 0.45, i * (Math.PI / 2) + 0.4, Math.PI / 2));
    }
    // the drums (a big one and a small one: town.drumHit makes them jump)
    s.drums = SHOPS.bonfire.drums.map((a, i) => {
      const drum = new THREE.Group(), skin = new THREE.Group();
      const big = i === 0 ? 1 : 0.75;
      part(drum, new THREE.CylinderGeometry(0.3 * big, 0.26 * big, 0.7 * big, 12), mat('#8b5a2b'), 0, 0.35 * big, 0);
      part(skin, new THREE.CylinderGeometry(0.31 * big, 0.31 * big, 0.04, 12), mat('#e8dcc0'), 0, 0, 0);
      skin.position.y = 0.72 * big;
      drum.add(skin);
      g.add(standAt(drum, zone - SHOPS.bonfire.drumAt, a));
      return { skin, hitAt: -9 };
    });
    // sparks, drifting up (update)
    s.sparks = [];
    for (let i = 0; i < 6; i++) {
      const spark = new THREE.Sprite(new THREE.SpriteMaterial({ map: softDotTexture(), color: '#ffb03a', transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending }));
      spark.scale.setScalar(0.18);
      g.add(spark);
      s.sparks.push({ obj: spark, a: i * 1.1, ph: i / 6 });
    }
  },
};

export class Town {
  constructor(scene) {
    this.group = new THREE.Group();
    scene.add(this.group);
    this.shops = new Map();   // id -> { id, kind, u, f, at, lane, spots, parts, targets, born, builtR }
    this.solidList = [];
  }

  // A part of shop s. place(obj) stands it where it goes, now and again whenever the planet grows;
  // remake() (for the curved pieces) builds it afresh for a new curve.
  put(s, obj, place, remake = null) {
    this.group.add(obj);
    s.parts.push({ obj, place, remake });
    place(obj);
    return obj;
  }

  // where a shop's parts go, in the world, at today's size (the server works it out the same way)
  layout(s) {
    const l = shopLayout(s.kind, s.u, s.f);
    Object.assign(s, { at: l.at, lane: l.lane, spots: l.targets });
    s.targets.forEach((tg, i) => { tg.u = s.spots[i]; });
  }

  // m: { id, kind, u, f }
  add(m) {
    if (this.shops.has(m.id) || !SHOPS[m.kind]) return;
    const s = { id: m.id, kind: m.kind, u: M.norm(m.u), f: M.tangent(M.norm(m.u), m.f), parts: [], targets: [], born: clock(), builtR: R, rings: m.rings, seed: m.seed };
    this.layout(s);
    const def = SHOPS[m.kind], look = SHOP_LOOK[m.kind];
    // (where things go, as functions: worked out again on every relayout)
    const on = (p, h = 0) => obj => placeOnSphere(obj, p(), M.tangent(p(), s.f), h);
    const beside = (d, back = 0) => () => M.moveOnSphere(M.moveOnSphere(s.u, s.f, M.norm(M.cross(s.u, s.f)), d)[0], s.f, s.f, back)[0];
    const middle = () => s.u;
    if (MODELS[m.kind]) {
      const g = new THREE.Group();
      MODELS[m.kind](g);
      this.put(s, shadows(g, true, true), on(middle));
    }
    if (CURVED[m.kind]) {
      const make = () => {
        const g = new THREE.Group();
        CURVED[m.kind](g, s);
        shadows(g, true, true);
        // (see-through things on the ground, like the sand and the mist, mustn't cast shadows: a
        // shadow map can't see through them, and they'd darken themselves in blotches)
        g.traverse(o => { if (o.isMesh && o.material.transparent) o.castShadow = false; });
        return g;
      };
      this.put(s, make(), on(middle), make);
    }
    if (m.kind === 'range') this.buildRange(s);
    // the sign out front, and the icon up high
    const big = !!CURVED[m.kind];
    const signAt = m.kind === 'haunt' ? () => F.pointAt(s, s.f, 0, 0.6)
      : big ? () => M.moveOnSphere(s.u, s.f, s.f, zoneOf(s) + 0.6)[0]
      : m.kind === 'range' ? beside(-2.4, 0.2) : m.kind === 'tailor' ? beside(-2.0, 2.3) : beside(-2.3, 1.4);
    this.put(s, shadows(signBoard(m.kind), true, false), on(signAt, 1.6));
    if (m.kind === 'haunt') {
      for (const k of [1, 2, 3]) {
        const dir = M.rotateAxis(s.f, s.u, (k * Math.PI) / 2);
        this.put(s, shadows(signBoard(m.kind), true, false), obj => { const p = F.pointAt(s, dir, 0, 0.6); placeOnSphere(obj, p, M.awayDir(p, s.u), 1.6); });
      }
    }
    const icon = this.put(s, iconSprite(m.kind), on(middle, big ? 4 : 5));
    icon.userData.bob = true;
    // where to stand to use it (the ring and the hollow show their own edges)
    if (!big) {
      const disk = () => groundDisk(def.zone, def.zone - 0.12, groundMat(look.color, 0.45));
      this.put(s, disk(), on(() => s.at, 0.03), disk);
    }
    this.shops.set(m.id, s);
    this.updateSolids();
  }

  // a chalk line to shoot from (beside the booth), and the targets downrange, each facing the line
  buildRange(s) {
    const def = SHOPS.range;
    const line = new THREE.Mesh(new THREE.BoxGeometry(def.zone * 1.6, 0.02, 0.12), new THREE.MeshBasicMaterial({ color: '#f4efe2' }));
    this.put(s, line, obj => placeOnSphere(obj, s.at, M.tangent(s.at, s.f), 0.03));
    const face = new THREE.MeshLambertMaterial({ map: bullseye() });
    s.spots.forEach((_, i) => {
      const g = new THREE.Group();
      part(g, new THREE.CylinderGeometry(0.08, 0.09, def.targetH - 0.6, 6), mat(WOOD), 0, (def.targetH - 0.6) / 2, 0);
      // the target rocks on a hinge at its foot when it's hit (spears stuck in it rock along)
      const hinge = new THREE.Group();
      hinge.position.y = def.targetH - def.targetR;
      part(hinge, new THREE.CylinderGeometry(def.targetR, def.targetR, 0.14, 20), mat(STRAW, { flatShading: true }), 0, def.targetR, 0).rotation.x = Math.PI / 2;
      part(hinge, new THREE.CircleGeometry(def.targetR * 0.96, 24), face, 0, def.targetR, 0.075);
      g.add(hinge);
      this.put(s, shadows(g, true, false), obj => placeOnSphere(obj, s.spots[i], M.towardDir(s.spots[i], s.at)));
      s.targets.push({ i, u: s.spots[i], hinge, shakeAt: -99 });
    });
  }

  updateSolids() {
    this.solidList = [];
    for (const sh of this.shops.values()) {
      if (SHOPS[sh.kind].r) this.solidList.push({ u: sh.u, r: SHOPS[sh.kind].r });
      for (const tg of sh.targets) this.solidList.push({ u: tg.u, r: 0.35 });
    }
  }

  target(shopId, i) { return this.shops.get(shopId)?.targets[i] || null; }

  // a hit at the range: it shakes
  shake(shopId, i) {
    const tg = this.target(shopId, i);
    if (tg) tg.shakeAt = clock();
    return tg;
  }

  // The same test as the server's: does the step from a to b go in through a target's face?
  // Returns the point on the face, or null.
  targetOnPath(a, b) {
    for (const s of this.shops.values()) {
      for (const tg of s.targets) {
        const { c, n } = M.targetFace(tg.u, s.at, SHOPS.range.targetH);
        const p = M.throughDisk(a, b, c, n, SHOPS.range.targetR);
        if (p) return p;
      }
    }
    return null;
  }

  // The shop whose zone p (unit vector) is in, if any. Same test as the server's.
  zoneAt(p) {
    for (const s of this.shops.values()) if (s.kind === 'haunt' ? F.depth(s, p) >= 0 : M.arcDist(p, s.at) < zoneOf(s)) return s;
    return null;
  }

  // a drum at a bonfire was hit (i: which)
  drumHit(shopId, i) {
    const d = this.shops.get(shopId)?.drums?.[i];
    if (d) d.hitAt = clock();
  }

  // The dark forest grew a ring: built again for its new size (the trees it had stay where they were).
  regrow(id, rings) {
    const s = this.shops.get(id);
    if (!s) return;
    s.rings = rings;
    for (const p of s.parts) {
      if (p.remake) {
        dispose(p.obj);
        p.obj = p.remake();
        this.group.add(p.obj);
      }
      p.place(p.obj);
    }
  }

  solids() { return this.solidList; }

  // The planet grew (or shrank): everything goes back where it belongs (a shop keeps its size),
  // and the big curved pieces are rebuilt for the new curve once it's changed enough to show.
  relayout() {
    for (const s of this.shops.values()) {
      this.layout(s);
      const rebuild = Math.abs(R - s.builtR) > 0.5;
      if (rebuild) s.builtR = R;
      for (const p of s.parts) {
        if (rebuild && p.remake) {
          dispose(p.obj);
          p.obj = p.remake();
          this.group.add(p.obj);
        }
        p.place(p.obj);
      }
    }
    this.updateSolids();
  }

  clear() {
    for (const s of this.shops.values()) for (const p of s.parts) dispose(p.obj);
    this.shops.clear();
    this.solidList = [];
  }

  // cam: the camera position (the icons fade out up close, where they'd fill the screen)
  update(cam) {
    const t = clock();
    for (const s of this.shops.values()) {
      // a new shop rises out of the ground
      const k = Math.min(1, (t - s.born) / 0.6);
      if (k < 1 || !s.up) {
        s.up = k >= 1;
        for (const { obj } of s.parts) if (!obj.isSprite) obj.scale.y = Math.max(0.01, k * (2 - k));
      }
      for (const { obj } of s.parts) {
        if (!obj.userData.bob) continue;
        const near = cam ? Math.min(1, Math.max(0, (obj.position.distanceTo(cam) - 7) / 6)) : 1;
        obj.material.opacity = near * (0.8 + Math.sin(t * 2 + s.id) * 0.2);
        obj.visible = near > 0.01;
      }
      // a hit target rocks back and forth on its hinge, settling over a second or so
      for (const tg of s.targets) {
        const e = t - tg.shakeAt;
        const k = e < 1.4 ? Math.exp(-e * 3.5) : 0;
        tg.hinge.rotation.x = -0.3 * k * Math.sin(e * 26);
        tg.hinge.rotation.z = 0.1 * k * Math.sin(e * 19 + 1);
      }
      // the wisps drift about their spots in the forest, bobbing
      for (const w of s.wisps || []) {
        const { pos, up } = groundAt(w.d + Math.sin(t * 0.3 + w.ph) * 1.4, w.a + (Math.cos(t * 0.23 + w.ph) * 1.4) / w.d);
        w.obj.position.copy(pos).addScaledVector(up, 1.3 + Math.sin(t * 1.7 + w.ph) * 0.35);
      }
      // the pond: light on the water, lily pads turning slowly
      if (s.shine) s.shine.material.opacity = 0.16 + Math.sin(t * 0.9 + s.id) * 0.08;
      (s.pads || []).forEach((p, i) => { p.rotation.y = Math.sin(t * 0.25 + i) * 0.6; });
      // steam off a hot spring: each puff rises, grows and fades, then starts again somewhere new
      for (const p of s.steam || []) {
        const k = (t * 0.32 + p.ph) % 1;
        const { pos, up } = groundAt(p.d, p.a + Math.floor(t * 0.32 + p.ph));
        p.obj.position.copy(pos).addScaledVector(up, 0.2 + k * 2.4);
        p.obj.scale.setScalar(0.6 + k * 1.6);
        p.obj.material.opacity = 0.42 * Math.sin(k * Math.PI);
      }
      // a bonfire flickers and throws sparks
      (s.flames || []).forEach((fl, i) => {
        fl.scale.set(1 + Math.sin(t * 11 + i) * 0.08, 1 + Math.sin(t * 13 + i * 2) * 0.18 + Math.random() * 0.08, 1 + Math.cos(t * 9 + i) * 0.08);
        fl.rotation.y += 0.02 * (1 + i);
      });
      // a drum just hit: its skin jumps
      for (const d of s.drums || []) {
        const e = t - d.hitAt;
        d.skin.position.y = d.skin.userData.y ??= d.skin.position.y;
        if (e < 0.25) d.skin.position.y = d.skin.userData.y - 0.06 * Math.sin((e / 0.25) * Math.PI);
      }
      for (const sp of s.sparks || []) {
        const k = (t * 0.5 + sp.ph) % 1;
        sp.obj.position.set(Math.cos(sp.a + k * 3) * 0.4 * k, 1.2 + k * 3.2, Math.sin(sp.a + k * 3) * 0.4 * k);
        sp.obj.material.opacity = Math.sin(k * Math.PI);
      }
    }
  }
}

function dispose(obj) {
  obj.removeFromParent();
  obj.traverse(o => { if (o.isMesh && !o.userData.shared) o.geometry.dispose(); });   // (not a spear stuck in a target)
}
