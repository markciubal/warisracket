// Ploughshares, in a long peace: the town that opens up as the planet grows. Doctors, target
// ranges, a duel ring, a tailor and haunted hollows (SHOPS). Shops keep their size as the planet
// grows under them: each part knows where it goes (shared/layout.js for the range, so the server
// agrees), and relayout() puts everything back after every change of size.
import * as THREE from 'three';
import { R, SHOPS, weaponOfType } from '/shared/constants.js';
import * as M from '/shared/math.js';
import { shopLayout } from '/shared/layout.js';
import { mat, lambert, shadows, placeOnSphere } from './util.js';
import { buildWeapon } from './weapons.js';

const clock = () => performance.now() / 1000;
const WOOD = '#7a4b25', DARK = '#1a100a', STRAW = '#d9b45a';
export const SHOP_LOOK = {
  doctor: { color: '#ff5a4d', icon: '🩺', sign: 'DOCTOR', sub: '1 🐚 · ALL BETTER' },
  range:  { color: '#ffd34d', icon: '🎯', sign: 'TARGETS', sub: '1 🐚 A HIT' },
  duel:   { color: '#ff9a3d', icon: '⚔️', sign: 'DUEL RING', sub: 'NOBODY GOES BELOW 1 HP' },
  tailor: { color: '#c58cff', icon: '🎩', sign: 'TAILOR', sub: 'HATS · CAPES' },
  haunt:  { color: '#a07cff', icon: '👻', sign: 'HAUNTED', sub: 'MONSTERS · 2 🐚 EACH' },
};

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
  // a haunted hollow: dark mist on the ground, dead trees round the edge, crooked gravestones, and
  // wisps of green light drifting about (s.wisps)
  haunt(g, s) {
    const zone = SHOPS.haunt.zone;
    const mist = g.add(groundDisk(zone, 0, groundMat('#231a33', 0.75))).children.at(-1);
    mist.position.y = 0.02;
    const edge = g.add(groundDisk(zone, zone - 0.3, groundMat('#7c5cc4', 0.45))).children.at(-1);
    edge.position.y = 0.03;
    const bark = mat('#2b2420', { flatShading: true });
    for (let i = 0; i < 6; i++) {
      const tree = new THREE.Group();
      const trunk = part(tree, new THREE.CylinderGeometry(0.1, 0.24, 3.4, 6), bark, 0, 1.7, 0);
      trunk.rotation.z = 0.1 * (i % 2 ? 1 : -1);
      for (let k = 0; k < 4; k++) {
        const br = part(tree, new THREE.CylinderGeometry(0.025, 0.07, 1.3, 4), bark, 0, 2.1 + k * 0.38, 0);
        const a = k * 2.2 + i;
        br.position.x = Math.cos(a) * 0.35;
        br.position.z = Math.sin(a) * 0.35;
        br.rotation.set(Math.sin(a) * 0.9, 0, -Math.cos(a) * 0.9);
      }
      g.add(standAt(tree, zone - 0.9 - (i % 2) * 1.1, i * 1.05 + 0.5, i));
    }
    const stone = mat('#7d7a86', { flatShading: true }), moss = mat('#4f6b3a', { flatShading: true });
    for (let i = 0; i < 7; i++) {
      const grave = new THREE.Group();
      part(grave, new THREE.BoxGeometry(0.5, 0.62, 0.14), stone, 0, 0.31, 0);
      part(grave, new THREE.CylinderGeometry(0.25, 0.25, 0.14, 12), stone, 0, 0.62, 0).rotation.x = Math.PI / 2;
      part(grave, new THREE.BoxGeometry(0.56, 0.06, 0.18), moss, 0, 0.03, 0);
      standAt(grave, 1.6 + ((i * 1.9) % (zone - 3)), i * 0.9 + 0.3, Math.PI + (i % 3 - 1) * 0.3);
      grave.rotateZ((i % 3 - 1) * 0.14);   // crooked
      g.add(grave);
    }
    s.wisps = [];
    for (let i = 0; i < 4; i++) {
      const wisp = new THREE.Group();
      wisp.add(new THREE.Mesh(new THREE.SphereGeometry(0.11, 8, 6), new THREE.MeshBasicMaterial({ color: '#b8ff9a' })));
      wisp.add(new THREE.Mesh(new THREE.SphereGeometry(0.3, 8, 6), new THREE.MeshBasicMaterial({ color: '#7dff6a', transparent: true, opacity: 0.22, depthWrite: false })));
      g.add(wisp);
      s.wisps.push({ obj: wisp, a: i * 1.6, d: 1.5 + i * 1.2, ph: i * 1.7 });
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
    const s = { id: m.id, kind: m.kind, u: M.norm(m.u), f: M.tangent(M.norm(m.u), m.f), parts: [], targets: [], born: clock(), builtR: R };
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
    const signAt = big ? () => M.moveOnSphere(s.u, s.f, s.f, def.zone + 0.6)[0]
      : m.kind === 'range' ? beside(-2.4, 0.2) : m.kind === 'tailor' ? beside(-2.0, 2.3) : beside(-2.3, 1.4);
    this.put(s, shadows(signBoard(m.kind), true, false), on(signAt, 1.6));
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
    for (const s of this.shops.values()) if (M.arcDist(p, s.at) < SHOPS[s.kind].zone) return s;
    return null;
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
      // the wisps drift round the hollow, bobbing
      for (const w of s.wisps || []) {
        const { pos, up } = groundAt(w.d + Math.sin(t * 0.3 + w.ph) * 0.9, w.a + t * 0.12);
        w.obj.position.copy(pos).addScaledVector(up, 1.3 + Math.sin(t * 1.7 + w.ph) * 0.35);
      }
    }
  }
}

function dispose(obj) {
  obj.removeFromParent();
  obj.traverse(o => { if (o.isMesh && !o.userData.shared) o.geometry.dispose(); });   // (not a spear stuck in a target)
}
