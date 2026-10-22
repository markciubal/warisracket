// Ploughshares, once peace breaks out: the crops the tribe plants and the things it builds.
// Crops start as sprouts and grow to full size as they ripen; ripe ones sway so you can tell.
// Builds rise out of the ground facing whoever built them, and are solid (solids()).
import * as THREE from 'three';
import { BUILDS, CROPS } from '/shared/constants.js';
import * as M from '/shared/math.js';
import { mat, lambert, shadows, placeOnSphere, lift } from './util.js';
import { hideTexture } from './textures.js';

const clock = () => performance.now() / 1000;
const STALK = '#8fae4a', LEAF = '#4f8f2f', GOLD = '#e8c45a', WOOD = '#7a4b25', STONE = '#8d8a83';
let hideMat;
const hide = () => (hideMat ||= lambert({ map: hideTexture(), side: THREE.DoubleSide }));

function part(g, geo, material, x = 0, y = 0, z = 0) {
  const m = new THREE.Mesh(geo, material);
  m.position.set(x, y, z);
  g.add(m);
  return m;
}

// One full-size model per kind of crop; every planted one is a clone (sharing its geometry).
const CROP_MODELS = {
  wheat(g) {
    for (let i = 0; i < 7; i++) {
      const a = i * 2.4, r = 0.06 + (i % 3) * 0.06;
      const stalk = part(g, new THREE.CylinderGeometry(0.012, 0.018, 0.7, 4), mat(STALK), Math.cos(a) * r, 0.35, Math.sin(a) * r);
      stalk.rotation.set(Math.sin(a) * 0.15, 0, Math.cos(a) * 0.15);
      part(g, new THREE.SphereGeometry(0.045, 5, 4), mat(GOLD), Math.cos(a) * r * 1.4, 0.76, Math.sin(a) * r * 1.4).scale.set(1, 2.4, 1);
    }
  },
  corn(g) {
    part(g, new THREE.CylinderGeometry(0.03, 0.045, 1.3, 5), mat(STALK), 0, 0.65, 0);
    for (const [y, a] of [[0.35, 0], [0.6, 2.1], [0.9, 4.2]]) {
      const leaf = part(g, new THREE.BoxGeometry(0.5, 0.02, 0.1), mat(LEAF), Math.cos(a) * 0.2, y, Math.sin(a) * 0.2);
      leaf.rotation.set(0, -a, 0.5);
    }
    part(g, new THREE.SphereGeometry(0.07, 6, 5), mat('#f2cf3c'), 0.07, 0.85, 0).scale.set(1, 2.4, 1);
  },
  pumpkin(g) {
    part(g, new THREE.SphereGeometry(0.3, 10, 7), mat('#e8862a', { flatShading: true }), 0, 0.22, 0).scale.set(1.25, 0.8, 1.25);
    part(g, new THREE.CylinderGeometry(0.03, 0.05, 0.16, 5), mat('#5a4022'), 0, 0.5, 0);
    for (const a of [0.6, 3.4]) {
      const leaf = part(g, new THREE.SphereGeometry(0.2, 6, 4), mat(LEAF), Math.cos(a) * 0.38, 0.04, Math.sin(a) * 0.38);
      leaf.scale.set(1.2, 0.15, 0.8);
    }
  },
};

const BUILD_MODELS = {
  // three posts and two rails across the builder's path
  fence(g) {
    for (const x of [-0.55, 0, 0.55]) part(g, new THREE.CylinderGeometry(0.06, 0.07, 1.2, 5), mat(WOOD), x, 0.6, 0);
    for (const y of [0.45, 0.9]) part(g, new THREE.BoxGeometry(1.25, 0.08, 0.06), mat('#8b5a2b'), 0, y, 0);
  },
  // a hide hut like the planet's own, its doorway towards the builder
  hut(g, def) {
    part(g, new THREE.ConeGeometry(def.r * 1.02, def.h, 11, 1, true), hide(), 0, def.h / 2, 0);
    for (let i = 0; i < 5; i++) {
      const a = (i / 5) * Math.PI * 2;
      const pole = part(g, new THREE.CylinderGeometry(0.05, 0.06, 1.4, 5), mat('#6b4423'), Math.cos(a) * 0.18, def.h + 0.3, Math.sin(a) * 0.18);
      pole.rotation.set(Math.sin(a) * 0.35, 0, -Math.cos(a) * 0.35);
    }
    const door = new THREE.Mesh(new THREE.CircleGeometry(0.45, 10, 0, Math.PI), new THREE.MeshBasicMaterial({ color: '#1a100a', side: THREE.DoubleSide }));
    // on the cone's skin at its foot, leaning back with its slope
    door.position.set(0, 0.02, def.r * 1.04);
    door.rotation.x = -Math.atan(def.r / def.h);
    door.scale.set(1, 1.5, 1);
    g.add(door);
  },
  // a big stone head on a low plinth, with a red stone topknot
  head(g, def) {
    part(g, new THREE.BoxGeometry(1.5, 0.35, 1.3), mat('#7a766e', { flatShading: true }), 0, 0.17, 0);
    part(g, new THREE.BoxGeometry(1.0, 2.6, 0.85), mat(STONE, { flatShading: true }), 0, 1.65, 0);
    part(g, new THREE.BoxGeometry(1.05, 0.22, 0.3), mat('#77736b', { flatShading: true }), 0, 2.45, 0.38);   // brow
    part(g, new THREE.BoxGeometry(0.26, 0.85, 0.35), mat('#7f7b73', { flatShading: true }), 0, 1.95, 0.5);   // nose
    part(g, new THREE.BoxGeometry(0.5, 0.12, 0.12), mat('#5d5a54'), 0, 1.35, 0.46);                          // mouth
    for (const s of [-1, 1]) part(g, new THREE.BoxGeometry(0.16, 0.9, 0.3), mat('#85817a'), s * 0.58, 1.9, 0);   // ears
    part(g, new THREE.CylinderGeometry(0.42, 0.45, 0.4, 8), mat('#a5432c', { flatShading: true }), 0, 3.15, 0);   // sits right on the head
  },
};

function model(table, kind, def) {
  const g = new THREE.Group();
  table[kind](g, def);
  return shadows(g, true, true);
}

export class Farm {
  constructor(scene) {
    this.group = new THREE.Group();
    scene.add(this.group);
    this.crops = new Map();    // id -> { obj, ripeAt, grow, sway }
    this.builds = new Map();   // id -> { obj, u, r, born }
    this.templates = {};
    this.solidList = [];
  }

  // m: { id, u, kind, left } (seconds until ripe)
  addCrop(m) {
    if (this.crops.has(m.id) || !CROPS[m.kind]) return;
    const obj = (this.templates[m.kind] ||= model(CROP_MODELS, m.kind)).clone();
    placeOnSphere(obj, M.norm(m.u), M.randomTangent(M.norm(m.u)));
    this.group.add(obj);
    this.crops.set(m.id, { obj, ripeAt: clock() + (m.left || 0), grow: CROPS[m.kind].grow, sway: Math.random() * 6 });
    this.updateCrop(this.crops.get(m.id), clock());
  }

  // Gone (picked or trampled); returns where it stood, for a little effect.
  removeCrop(id) {
    const c = this.crops.get(id);
    if (!c) return null;
    this.crops.delete(id);
    c.obj.removeFromParent();
    return c.obj.position.clone();
  }

  // m: { id, u, f, kind } (f: facing, towards whoever built it)
  addBuild(m) {
    const def = BUILDS[m.kind];
    if (this.builds.has(m.id) || !def) return;
    const obj = model(BUILD_MODELS, m.kind, def);
    placeOnSphere(obj, M.norm(m.u), M.tangent(M.norm(m.u), m.f));
    this.group.add(obj);
    this.builds.set(m.id, { obj, u: M.norm(m.u), r: def.r, born: clock() });
    this.solidList = [...this.builds.values()].map(b => ({ u: b.u, r: b.r }));
  }

  // What to bump into, in the shape collideObstacles() wants.
  solids() { return this.solidList; }

  // The planet grew (or shrank) by dR under the fields.
  lift(dR) {
    for (const obj of this.group.children) lift(obj, dR);
  }

  clear() {
    for (const c of this.crops.values()) c.obj.removeFromParent();
    for (const b of this.builds.values()) {
      b.obj.removeFromParent();
      b.obj.traverse(o => { if (o.isMesh) o.geometry.dispose(); });
    }
    this.crops.clear();
    this.builds.clear();
    this.solidList = [];
  }

  updateCrop(c, t) {
    const k = Math.min(1, Math.max(0, 1 - (c.ripeAt - t) / c.grow));
    const s = 0.15 + 0.85 * k;
    // ripe: a gentle sway, so it's clear it's ready to pick
    const ripe = k >= 1 ? Math.sin(t * 3 + c.sway) * 0.06 : 0;
    c.obj.scale.set(s * (1 - ripe * 0.5), s * (1 + ripe), s * (1 - ripe * 0.5));
  }

  update() {
    const t = clock();
    for (const c of this.crops.values()) this.updateCrop(c, t);
    // new builds rise out of the ground over half a second
    for (const b of this.builds.values()) {
      const k = Math.min(1, (t - b.born) / 0.5);
      if (k < 1 || b.obj.scale.y !== 1) b.obj.scale.set(1, k * (2 - k), 1);
    }
  }
}
