import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { mat, lambert, mergeChildren, shadows } from './util.js';
import { peltTexture } from './textures.js';

// All weapon meshes: handle at the origin, business end toward +Y.
const BONE = '#efe5cc';
const WOOD = '#7a4b25';
const DARK_WOOD = '#553219';
const FLINT = '#8d8a83';
const LEATHER = '#4e301a';
const BRONZE = '#d39a45';
const metal = (color = BRONZE) => mat(color, { metalness: 0.45, roughness: 0.38 });

function cyl(rTop, rBot, h, color, y = h / 2, seg = 8) {
  const m = new THREE.Mesh(new THREE.CylinderGeometry(rTop, rBot, h, seg), mat(color));
  m.position.y = y;
  return m;
}

function ball(r, color, x = 0, y = 0, z = 0, opts = {}) {
  const m = new THREE.Mesh(new THREE.SphereGeometry(r, 10, 8), mat(color, opts));
  m.position.set(x, y, z);
  return m;
}

// Cartoon bone: shaft with double knobs at each end.
export function bone(g, length, r, knob, color = BONE, y0 = 0) {
  g.add(cyl(r, r * 1.1, length, color, y0 + length / 2));
  for (const y of [y0, y0 + length]) {
    g.add(ball(knob, color, -knob * 0.65, y, 0));
    g.add(ball(knob, color, knob * 0.65, y, 0));
  }
}

// Chain of cylinders through points, tapering from r0 to r1 (tusks, antlers).
export function taperedTube(g, points, r0, r1, color) {
  for (let i = 0; i < points.length - 1; i++) {
    const a = points[i], b = points[i + 1];
    const t0 = i / (points.length - 1), t1 = (i + 1) / (points.length - 1);
    const ra = r0 + (r1 - r0) * t0, rb = r0 + (r1 - r0) * t1;
    const d = new THREE.Vector3().subVectors(b, a);
    const m = new THREE.Mesh(new THREE.CylinderGeometry(rb, ra, d.length() * 1.04, 8), mat(color));
    m.position.copy(a).addScaledVector(d, 0.5);
    m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), d.normalize());
    g.add(m);
  }
}

const curvePoints = (curve, n) => curve.getPoints(n);

// Diamond-section straight blade from y0 up, with a pointed tip.
function blade(g, len, width, y0, material = metal()) {
  const body = new THREE.CylinderGeometry(width * 0.8, width, len, 4).rotateY(Math.PI / 4).scale(1, 1, 0.22);
  const tip = new THREE.ConeGeometry(width * 0.8, width * 2.2, 4).rotateY(Math.PI / 4).scale(1, 1, 0.22);
  const b = new THREE.Mesh(body, material);
  b.position.y = y0 + len / 2;
  const t = new THREE.Mesh(tip, material);
  t.position.y = y0 + len + width * 1.1;
  g.add(b, t);
}

// Flat blade segments following a curve (khopesh hook).
function curvedBlade(g, points, width, material = metal()) {
  for (let i = 0; i < points.length - 1; i++) {
    const a = points[i], b = points[i + 1];
    const d = new THREE.Vector3().subVectors(b, a);
    const w = width * (1 - (i / points.length) * 0.5);
    const seg = new THREE.Mesh(new THREE.BoxGeometry(w, d.length() * 1.08, 0.025), material);
    seg.position.copy(a).addScaledVector(d, 0.5);
    seg.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), d.normalize());
    g.add(seg);
  }
}

// Grip + pommel + crossguard shared by the swords; returns where the blade starts.
function hilt(g, grip, guard) {
  g.add(cyl(0.035, 0.038, grip, LEATHER, grip / 2, 6));
  g.add(ball(0.055, BRONZE, 0, 0, 0));
  const cross = new THREE.Mesh(new THREE.BoxGeometry(guard, 0.05, 0.07), metal());
  cross.position.y = grip + 0.02;
  g.add(cross);
  return grip + 0.045;
}

const BUILDERS = {
  // Ploughshares: the hoe everyone holds once peace breaks out
  hoe(g) {
    g.add(cyl(0.035, 0.04, 1.5, WOOD, 0.75, 6));
    const head = new THREE.Mesh(new THREE.BoxGeometry(0.32, 0.05, 0.16), metal('#9aa0a6'));
    head.position.set(0.12, 1.47, 0.02);
    head.rotation.z = -0.35;
    g.add(head);
    g.add(ball(0.05, DARK_WOOD, 0, 1.47, 0));
  },
  // fire on a stick (a haunted hollow's): a pitch-wrapped head, and flames that light themselves
  torch(g) {
    g.add(cyl(0.04, 0.05, 1.1, WOOD, 0.55, 6));
    g.add(cyl(0.085, 0.07, 0.22, '#3a2a1a', 1.15, 7));
    for (const [color, r, h] of [['#ff5a14', 0.16, 0.5], ['#ff9a1f', 0.12, 0.42], ['#ffe066', 0.07, 0.3]]) {
      const flame = new THREE.Mesh(new THREE.ConeGeometry(r, h, 7), new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.9 }));
      flame.position.y = 1.26 + h / 2;
      g.add(flame);
    }
  },
  bigbone(g) { bone(g, 1.2, 0.07, 0.13); },
  femur(g) { bone(g, 1.55, 0.11, 0.2, '#e8dcbc'); },
  club(g) {
    g.add(cyl(0.16, 0.05, 1.2, WOOD, 0.6));
    for (let i = 0; i < 5; i++) {
      const a = i * 1.3, y = 0.7 + (i % 3) * 0.18;
      g.add(ball(0.06, DARK_WOOD, Math.cos(a) * 0.13, y, Math.sin(a) * 0.13));
    }
    g.add(cyl(0.065, 0.065, 0.22, LEATHER, 0.12));
  },
  stick(g) {
    g.add(cyl(0.03, 0.04, 1.55, '#8b5a2b', 0.77, 6));
    const twig = cyl(0.015, 0.02, 0.35, '#8b5a2b', 0.15, 5);
    twig.position.set(0.08, 1.05, 0);
    twig.rotation.z = -0.8;
    g.add(twig);
    const leaf = ball(0.08, '#5fae3d', 0.22, 1.22, 0);
    leaf.scale.set(1.3, 0.5, 0.25);
    g.add(leaf);
  },
  tusk(g) {
    const pts = curvePoints(new THREE.QuadraticBezierCurve3(
      new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, 0.9, 0.45), new THREE.Vector3(0, 1.6, -0.05)), 7);
    taperedTube(g, pts, 0.1, 0.02, '#f4ecd6');
    g.add(cyl(0.11, 0.11, 0.2, LEATHER, 0.08));
  },
  stoneaxe(g) {
    g.add(cyl(0.04, 0.045, 1.05, WOOD, 0.52, 6));
    const head = new THREE.Mesh(new THREE.DodecahedronGeometry(0.2, 0), mat(FLINT, { flatShading: true }));
    head.scale.set(1.5, 0.85, 0.7);
    head.position.set(0.1, 0.96, 0);
    g.add(head);
    const wrap = new THREE.Mesh(new THREE.TorusGeometry(0.06, 0.025, 5, 10), mat(LEATHER));
    wrap.position.y = 0.9;
    wrap.rotation.x = Math.PI / 2;
    g.add(wrap);
  },
  fish(g) {
    const body = ball(0.16, '#7d9db0', 0, 0.6, 0);
    body.scale.set(1, 2.9, 0.5);
    g.add(body);
    const belly = ball(0.13, '#c9d6c8', 0.05, 0.6, 0);
    belly.scale.set(0.8, 2.5, 0.45);
    g.add(belly);
    const tail = new THREE.Mesh(new THREE.ConeGeometry(0.17, 0.3, 4), mat('#5f7f93'));
    tail.position.y = 0.06;
    tail.scale.z = 0.3;
    g.add(tail);
    g.add(ball(0.035, '#ffffff', 0.08, 0.98, 0.07), ball(0.02, '#111111', 0.095, 0.99, 0.09));
    const fin = new THREE.Mesh(new THREE.ConeGeometry(0.08, 0.2, 3), mat('#5f7f93'));
    fin.position.set(-0.15, 0.62, 0);
    fin.rotation.z = Math.PI / 2;
    fin.scale.z = 0.3;
    g.add(fin);
  },
  jawbone(g) {
    g.add(cyl(0.05, 0.06, 0.5, BONE, 0.25));
    const jaw = new THREE.Mesh(new THREE.TorusGeometry(0.28, 0.06, 6, 14, Math.PI), mat(BONE));
    jaw.position.set(0, 0.78, 0);
    jaw.rotation.z = Math.PI / 2;
    g.add(jaw);
    for (let i = 0; i < 7; i++) {
      const a = -Math.PI / 2 + (i + 0.5) * (Math.PI / 7);
      const tooth = new THREE.Mesh(new THREE.ConeGeometry(0.03, 0.11, 4), mat('#fffaf0'));
      tooth.position.set(-Math.cos(a) * 0.22, 0.78 + Math.sin(a) * 0.22, 0);
      tooth.rotation.z = a + Math.PI / 2;
      g.add(tooth);
    }
  },
  antler(g) {
    const main = curvePoints(new THREE.QuadraticBezierCurve3(
      new THREE.Vector3(0, 0, 0), new THREE.Vector3(0.1, 0.8, 0.2), new THREE.Vector3(0.35, 1.45, 0)), 6);
    taperedTube(g, main, 0.07, 0.025, '#d9c9a3');
    const tines = [[0.35, 0.05, 0.05], [0.65, -0.2, 0.0], [0.95, 0.2, -0.05]];
    for (const [y, dx, dz] of tines) {
      const base = new THREE.Vector3(0.05 + y * 0.12, y, 0.1);
      taperedTube(g, [base, base.clone().add(new THREE.Vector3(dx - 0.25, 0.32, dz + 0.2))], 0.04, 0.012, '#d9c9a3');
    }
  },
  meatbone(g) {
    bone(g, 0.95, 0.06, 0.1);
    const meat = ball(0.22, '#8f3b26', 0, 0.62, 0);
    meat.scale.set(1, 1.45, 1);
    g.add(meat);
    const fat = new THREE.Mesh(new THREE.TorusGeometry(0.2, 0.04, 6, 14), mat('#f0d9b5'));
    fat.position.y = 0.4;
    fat.rotation.x = Math.PI / 2;
    g.add(fat);
  },

  // ----- Shiny Rock Age
  dagger(g) { blade(g, 0.45, 0.07, hilt(g, 0.18, 0.22)); },
  shortsword(g) { blade(g, 0.8, 0.085, hilt(g, 0.22, 0.3)); },
  longsword(g) { blade(g, 1.25, 0.08, hilt(g, 0.32, 0.38)); },
  greatsword(g) {
    const y = hilt(g, 0.42, 0.55);
    blade(g, 1.6, 0.13, y);
    const ricasso = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.18, 0.04), metal('#a87532'));
    ricasso.position.y = y + 0.09;
    g.add(ricasso);
  },
  khopesh(g) {
    const y = hilt(g, 0.24, 0.16);
    const pts = curvePoints(new THREE.CubicBezierCurve3(
      new THREE.Vector3(0, y, 0), new THREE.Vector3(0, y + 0.5, 0),
      new THREE.Vector3(0, y + 1.05, -0.05), new THREE.Vector3(0, y + 0.85, 0.4)), 9);
    curvedBlade(g, pts, 0.12);
  },
  // ----- Zap Age
  glowstick(g) {
    g.add(cyl(0.045, 0.05, 0.3, '#3a3f46', 0.15, 8));
    const ring = new THREE.Mesh(new THREE.TorusGeometry(0.06, 0.02, 6, 12), metal('#c7ccd2'));
    ring.rotation.x = Math.PI / 2;
    ring.position.y = 0.31;
    g.add(ring);
    const glow = new THREE.MeshBasicMaterial({ color: '#7fe8ff' });
    const blade = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.045, 1.25, 10), glow);
    blade.position.y = 0.95;
    const tip = new THREE.Mesh(new THREE.SphereGeometry(0.04, 8, 6), glow);
    tip.position.y = 1.58;
    const haze = new THREE.Mesh(new THREE.CylinderGeometry(0.085, 0.09, 1.3, 10),
      new THREE.MeshBasicMaterial({ color: '#7fe8ff', transparent: true, opacity: 0.25, blending: THREE.AdditiveBlending, depthWrite: false }));
    haze.position.y = 0.95;
    g.add(blade, tip, haze);
  },
  zapclub(g) {
    g.add(cyl(0.05, 0.045, 0.95, '#22252a', 0.47, 8));
    g.add(cyl(0.06, 0.06, 0.18, '#4e301a', 0.1, 8));
    const zap = new THREE.MeshBasicMaterial({ color: '#9fd7ff' });
    for (const y of [0.78, 0.88, 0.98]) {
      const coil = new THREE.Mesh(new THREE.TorusGeometry(0.065, 0.014, 5, 12), zap);
      coil.rotation.x = Math.PI / 2;
      coil.position.y = y;
      g.add(coil);
    }
    g.add(ball(0.07, '#ffffff', 0, 1.0, 0, { emissive: '#7fc8ff', emissiveIntensity: 1.5 }));
  },
  obsidian(g) {
    g.add(cyl(0.04, 0.045, 0.5, WOOD, 0.25, 6));
    const paddle = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.95, 0.05), mat(WOOD));
    paddle.position.y = 0.95;
    g.add(paddle);
    for (const side of [-1, 1]) {
      for (let i = 0; i < 6; i++) {
        const shard = new THREE.Mesh(new THREE.ConeGeometry(0.035, 0.12, 3), mat('#15121a', { roughness: 0.15, metalness: 0.3 }));
        shard.position.set(side * 0.1, 0.56 + i * 0.15, 0);
        shard.rotation.z = -side * Math.PI / 2;
        g.add(shard);
      }
    }
  },
};

function addPrefixFlair(g, w) {
  const top = { femur: 1.5, stick: 1.4, tusk: 1.3, antler: 1.2, longsword: 1.4, greatsword: 1.8, dagger: 0.6 }[w.type] || 1.0;
  if (w.prefix === 'spiky') {
    for (let i = 0; i < 7; i++) {
      const a = (i / 7) * Math.PI * 2, y = top * (0.55 + (i % 3) * 0.15);
      const spike = new THREE.Mesh(new THREE.ConeGeometry(0.035, 0.18, 4), mat('#d8d4c8'));
      spike.position.set(Math.cos(a) * 0.12, y, Math.sin(a) * 0.12);
      spike.rotation.set(Math.sin(a) * Math.PI / 2, 0, -Math.cos(a) * Math.PI / 2);
      g.add(spike);
    }
  } else if (w.prefix === 'ancient') {
    for (let i = 0; i < 5; i++) {
      const moss = ball(0.07, '#4f7f2a', Math.cos(i * 2) * 0.09, top * (0.3 + i * 0.13), Math.sin(i * 2) * 0.09);
      moss.scale.set(1, 0.5, 1);
      g.add(moss);
    }
  } else if (w.prefix === 'feathered') {
    for (const [c, a] of [['#d23b2a', 0.5], ['#2f78c4', -0.5]]) {
      const feather = new THREE.Mesh(new THREE.ConeGeometry(0.05, 0.42, 4), mat(c));
      feather.position.set(Math.sin(a) * 0.12, 0.2, 0.05);
      feather.rotation.z = a + Math.PI;
      feather.scale.z = 0.3;
      g.add(feather);
    }
  } else if (w.prefix === 'lucky') {
    g.add(ball(0.05, '#e23b3b', 0.08, 0.2, 0.06, { emissive: '#661111' }));
  } else if (w.prefix === 'cracked') {
    g.rotation.z = 0.06;
  }
}

// Swap every material in g for fn(material), calling fn once per distinct material so shapes
// that shared one still share its replacement (and still merge into one draw call).
function restyle(g, fn) {
  const swaps = new Map();
  g.traverse(o => {
    if (!o.isMesh) return;
    if (!swaps.has(o.material)) swaps.set(o.material, fn(o.material));
    o.material = swaps.get(o.material);
  });
}

export function buildWeapon(w) {
  const g = new THREE.Group();
  (BUILDERS[w.type] || BUILDERS.bigbone)(g);
  addPrefixFlair(g, w);
  if (w.tier === 'legend') {
    // Golden glow, on this weapon only. Unlit (basic) materials like glow-stick blades
    // already glow and have no emissive to set.
    restyle(g, m => {
      if (!m.emissive) return m;
      const c = m.clone();
      c.emissive.set('#ffaa22');
      c.emissiveIntensity = 0.45;
      return c;
    });
  } else if (w.prefix === 'soggy') {
    restyle(g, m => {
      const c = m.clone();
      c.color.multiplyScalar(0.7);
      return c;
    });
  }
  mergeChildren(g);
  g.scale.setScalar(w.scale || 1);
  return shadows(g, true, false);
}

// Projectiles are everywhere (flying, stuck in the dirt, on every back), so their parts are
// baked into one vertex-coloured geometry and each one costs a single draw call.
// parts: [geometry, color, (object3d) => position/rotate it]
function bake(parts) {
  return mergeGeometries(parts.map(([geo, color, setup]) => {
    const o = new THREE.Object3D();
    setup(o);
    o.updateMatrix();
    const g = geo.index ? geo.toNonIndexed() : geo;
    g.applyMatrix4(o.matrix);
    const c = new THREE.Color(color);
    const colors = new Float32Array(g.attributes.position.count * 3);
    for (let i = 0; i < colors.length; i += 3) colors.set([c.r, c.g, c.b], i);
    g.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    return g;
  }));
}

const alongZ = (z, sx = 1) => o => { o.rotation.x = Math.PI / 2; o.position.z = z; o.scale.x = sx; };
const backwardZ = (z, ry) => o => { o.rotation.x = -Math.PI / 2; o.rotation.y = ry; o.position.z = z; };
const forwardZ = (z, ry) => o => { o.rotation.x = Math.PI / 2; o.rotation.y = ry; o.position.z = z; };

let projMat;
const PROJ_GEOS = {};
const PROJ_PARTS = {
  spear: () => [
    [new THREE.CylinderGeometry(0.035, 0.04, 2.0, 6), '#8a5a2b', alongZ(-1.25)],
    [new THREE.ConeGeometry(0.075, 0.32, 4), '#9a968c', alongZ(-0.16, 0.55)],
    [new THREE.CylinderGeometry(0.048, 0.048, 0.14, 6), LEATHER, alongZ(-0.36)],
    [new THREE.ConeGeometry(0.05, 0.3, 3), '#c8402a', backwardZ(-2.12, 0.4)],
    [new THREE.ConeGeometry(0.05, 0.3, 3), '#f3e7c8', backwardZ(-2.12, -0.4)],
  ],
  arrow: () => [
    [new THREE.CylinderGeometry(0.017, 0.017, 1.0, 5), '#a8743c', alongZ(-0.6)],
    [new THREE.ConeGeometry(0.04, 0.14, 4), '#8d8a83', alongZ(-0.07, 0.5)],
    // flattened fins spun around the shaft (Ry spins about the fin's own axis before Rx lays it
    // along), widest at the back and tapering toward the head, like real fletching
    ...[0, 2.1, 4.2].map(a => [new THREE.ConeGeometry(0.045, 0.22, 3).scale(1, 1, 0.15), a ? '#f3e7c8' : '#c8402a', forwardZ(-0.99, a)]),
  ],
};

PROJ_PARTS.ball = () => [[new THREE.SphereGeometry(0.07, 8, 6), '#2b2b2e', o => { o.position.z = -0.07; }]];
// the range shed's own: a slingshot stone, a tomato, a rocket
PROJ_PARTS.pebble = () => [[new THREE.DodecahedronGeometry(0.08, 0), '#8d8a83', o => { o.position.z = -0.08; }]];
PROJ_PARTS.tomato = () => [
  [new THREE.SphereGeometry(0.13, 10, 8), '#d8382c', o => { o.position.z = -0.13; o.scale.y = 0.85; }],
  [new THREE.ConeGeometry(0.06, 0.07, 5), '#3f8f2f', o => { o.position.set(0, 0.12, -0.13); }],
];
PROJ_PARTS.rocket = () => [
  [new THREE.ConeGeometry(0.075, 0.22, 8), '#c8402a', alongZ(-0.11)],
  [new THREE.CylinderGeometry(0.075, 0.075, 0.55, 8), '#5f7040', alongZ(-0.495)],
  [new THREE.BoxGeometry(0.32, 0.025, 0.16), '#3d4a2a', o => { o.position.z = -0.7; }],
  [new THREE.BoxGeometry(0.025, 0.32, 0.16), '#3d4a2a', o => { o.position.z = -0.7; }],
];

let tracerGeo, tracerMat;

// Projectile with its tip at the origin, pointing along +Z: 'spear' | 'arrow' | 'ball' | 'bullet',
// or (the range shed's) 'pebble' | 'tomato' | 'rocket'.
// Geometry is shared: never dispose it.
export function buildProjectile(kind = 'spear') {
  if (kind === 'bullet') {
    // glowing tracer streak
    tracerGeo ||= new THREE.CylinderGeometry(0.025, 0.025, 1.1, 4).rotateX(Math.PI / 2).translate(0, 0, -0.55);
    tracerMat ||= new THREE.MeshBasicMaterial({ color: '#ffe27a' });
    const t = new THREE.Mesh(tracerGeo, tracerMat);
    t.userData.shared = true;
    return t;
  }
  projMat ||= lambert({ vertexColors: true });
  PROJ_GEOS[kind] ||= bake((PROJ_PARTS[kind] || PROJ_PARTS.spear)());
  const m = new THREE.Mesh(PROJ_GEOS[kind], projMat);
  m.castShadow = false;   // a stick-thin shadow nobody notices; held spears turn it back on
  m.userData.shared = true;
  return m;
}

// Guns held at the grip (origin), barrel toward +Z. userData.muzzle marks the barrel tip.
export function buildFirearm(kind) {
  const g = new THREE.Group();
  const box = (w, h, d, material, x, y, z) => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), material);
    m.position.set(x, y, z);
    g.add(m);
    return m;
  };
  const tube = (r, len, material, z, y = 0.03) => {
    const m = new THREE.Mesh(new THREE.CylinderGeometry(r, r, len, 8).rotateX(Math.PI / 2), material);
    m.position.set(0, y, z);
    g.add(m);
    return m;
  };
  let muzzleZ;
  if (kind === 'musket') {
    const wood = mat('#6b3f1d'), iron = metal('#4a4a4f'), brass = metal('#c99a3a');
    box(0.09, 0.15, 0.5, wood, 0, -0.04, -0.28);
    box(0.07, 0.07, 0.75, wood, 0, 0.0, 0.3);
    tube(0.028, 1.15, iron, 0.42);
    for (const z of [0.15, 0.55, 0.85]) tube(0.04, 0.04, brass, z, 0.02);
    box(0.03, 0.06, 0.06, iron, 0, 0.08, -0.05);
    muzzleZ = 1.0;
  } else if (kind === 'bazooka') {
    // a fat green tube, a grip and a sight, and the next rocket's nose peeking out the front
    const olive = mat('#5f7040'), dark = mat('#3d4a2a');
    tube(0.12, 1.25, olive, 0.18);
    tube(0.135, 0.12, dark, 0.78);
    tube(0.135, 0.1, dark, -0.42);
    box(0.06, 0.2, 0.09, dark, 0, -0.17, 0.05);
    box(0.06, 0.16, 0.08, dark, 0, -0.15, 0.4);
    box(0.05, 0.1, 0.16, dark, -0.13, 0.12, 0.25);
    const nose = new THREE.Mesh(new THREE.ConeGeometry(0.075, 0.2, 8).rotateX(Math.PI / 2), mat('#c8402a'));
    nose.position.set(0, 0.03, 0.82);
    g.add(nose);
    muzzleZ = 0.85;
  } else if (kind === 'crossbow') {
    // a wooden stock with a bow across its nose, and a bolt sitting ready
    const wood = mat('#7a4b25'), dark = mat('#4e301a');
    box(0.08, 0.09, 0.85, wood, 0, 0, 0.12);
    box(0.06, 0.2, 0.1, dark, 0, -0.13, -0.1).rotation.x = 0.3;
    for (const s of [-1, 1]) {
      const limb = box(0.42, 0.04, 0.05, dark, s * 0.2, 0.03, 0.5);
      limb.rotation.y = s * 0.35;
    }
    const string = new THREE.Mesh(new THREE.CylinderGeometry(0.005, 0.005, 0.66, 3).rotateZ(Math.PI / 2), mat('#efe6d0'));
    string.position.set(0, 0.03, 0.34);
    g.add(string);
    const bolt = buildProjectile('arrow');
    bolt.scale.setScalar(0.6);
    bolt.position.set(0, 0.07, 0.6);
    g.add(bolt);
    muzzleZ = 0.6;
  } else if (kind === 'gun') {
    const black = mat('#24262a', { roughness: 0.5 }), dark = mat('#3b3f45');
    box(0.09, 0.15, 0.6, black, 0, 0.0, 0.1);
    box(0.08, 0.13, 0.32, dark, 0, -0.02, -0.34);
    box(0.06, 0.22, 0.1, black, 0, -0.17, 0.14).rotation.x = 0.25;
    box(0.04, 0.05, 0.12, dark, 0, 0.1, 0.05);
    tube(0.022, 0.42, black, 0.6);
    muzzleZ = 0.82;
  } else {
    const shell = mat('#e8eef2', { roughness: 0.4 }), dark = mat('#2c3036');
    const glow = new THREE.MeshBasicMaterial({ color: '#7fe8ff' });
    box(0.12, 0.15, 0.7, shell, 0, 0.0, 0.12);
    box(0.08, 0.12, 0.25, dark, 0, -0.02, -0.32);
    box(0.13, 0.03, 0.5, glow, 0, 0.03, 0.15);
    tube(0.045, 0.2, dark, 0.55);
    const ring = new THREE.Mesh(new THREE.TorusGeometry(0.05, 0.015, 6, 14), glow);
    ring.position.z = 0.66;
    g.add(ring);
    muzzleZ = 0.68;
  }
  mergeChildren(g);
  const muzzle = new THREE.Object3D();
  muzzle.position.set(0, 0.03, muzzleZ);
  g.add(muzzle);
  g.userData.muzzle = muzzle;
  return shadows(g, true, false);
}

export const buildSpear = () => buildProjectile('spear');

// Bow held at the grip (origin), limbs along ±Y, shooting toward +Z. Includes a nocked arrow
// (group.userData.arrow) the caveman shows while drawing.
export function buildBow(kind = 'bow') {
  const g = new THREE.Group();
  const long = kind === 'longbow';
  const L = long ? 0.85 : 0.6, bend = long ? 0.22 : 0.3;
  const wood = long ? '#5a3519' : '#8a5a2b';
  for (const s of [1, -1]) {
    const pts = [];
    for (let i = 0; i <= 5; i++) {
      const y = (i / 5) * L;
      pts.push(new THREE.Vector3(0, s * y, -bend * (y / L) ** 2));
    }
    taperedTube(g, pts, 0.035, 0.018, wood);
  }
  g.add(cyl(0.042, 0.042, 0.16, LEATHER, 0, 6));
  const string = new THREE.Mesh(new THREE.CylinderGeometry(0.005, 0.005, L * 2, 3), mat('#efe6d0'));
  string.position.z = -bend;
  g.add(string);
  mergeChildren(g);
  const arrow = buildProjectile('arrow');
  arrow.position.z = 0.4;
  arrow.visible = false;
  g.add(arrow);
  g.userData.arrow = arrow;
  return shadows(g, true, false);
}

// A slingshot held at the handle (origin): a forked stick up ±Y, the band pulled back toward -Z,
// a stone in it (group.userData.arrow) while it's drawn. Held like a bow.
export function buildSlingshot() {
  const g = new THREE.Group();
  const wood = '#8a5a2b';
  taperedTube(g, [new THREE.Vector3(0, -0.22, 0), new THREE.Vector3(0, 0.06, 0)], 0.035, 0.03, wood);
  for (const s of [1, -1]) {
    taperedTube(g, [new THREE.Vector3(0, 0.05, 0), new THREE.Vector3(0, 0.16, s * 0.06), new THREE.Vector3(0, 0.26, s * 0.1)], 0.03, 0.022, wood);
  }
  g.add(cyl(0.04, 0.04, 0.1, LEATHER, -0.1, 6));
  for (const s of [1, -1]) {
    const band = new THREE.Mesh(new THREE.CylinderGeometry(0.008, 0.008, 0.2, 3), mat('#b0412e'));
    band.position.set(0, 0.25, s * 0.06 - 0.06);
    band.rotation.x = Math.PI / 2 - s * 0.5;
    g.add(band);
  }
  mergeChildren(g);
  const stone = buildProjectile('pebble');
  stone.position.set(0, 0.25, -0.14);
  stone.visible = false;
  g.add(stone);
  g.userData.arrow = stone;
  g.rotation.x = -0.25;
  return shadows(g, true, false);
}

// Leather quiver for the back, with one arrow per shot carried (up to 8 shown).
export function buildQuiver() {
  const g = new THREE.Group();
  const tube = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.1, 0.7, 8), mat('#6b4423'));
  g.add(tube);
  const band = new THREE.Mesh(new THREE.TorusGeometry(0.12, 0.02, 4, 10), mat(LEATHER));
  band.rotation.x = Math.PI / 2;
  band.position.y = 0.25;
  g.add(band);
  g.userData.arrows = [];
  for (let i = 0; i < 8; i++) {
    const a = buildProjectile('arrow');
    a.scale.setScalar(0.8);
    a.rotation.x = -Math.PI / 2 + (Math.random() - 0.5) * 0.25;
    a.rotation.z = (Math.random() - 0.5) * 0.3;
    a.position.set(((i % 3) - 1) * 0.05, 0.95, (Math.floor(i / 3) - 1) * 0.05);
    g.add(a);
    g.userData.arrows.push(a);
  }
  return shadows(g, true, false);
}

// ---------------------------------------------------------------- armor
// Each armor returns parts for the caveman's torso frame and head frame.
let hideMat;
const ARMOR_BUILDERS = {
  hide(torso, head) {
    hideMat ||= lambert({ map: peltTexture(3) });
    for (const s of [-1, 1]) {
      const mantle = new THREE.Mesh(new THREE.SphereGeometry(0.24, 10, 8), hideMat);
      mantle.position.set(s * 0.32, 0.66, 0);
      mantle.scale.set(1, 0.65, 1.1);
      torso.add(mantle);
    }
    const collar = new THREE.Mesh(new THREE.TorusGeometry(0.26, 0.09, 6, 14), hideMat);
    collar.rotation.x = Math.PI / 2;
    collar.position.y = 0.76;
    torso.add(collar);
    const cap = new THREE.Mesh(new THREE.SphereGeometry(0.3, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2), hideMat);
    cap.position.y = 0.27;
    head.add(cap);
    for (const s of [-1, 1]) {
      const flap = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.22, 0.14), hideMat);
      flap.position.set(s * 0.28, 0.17, -0.02);
      head.add(flap);
    }
  },
  bone(torso, head) {
    const b = mat(BONE);
    for (let i = 0; i < 4; i++) {
      const rib = new THREE.Mesh(new THREE.TorusGeometry(0.31 - i * 0.015, 0.03, 5, 14, Math.PI), b);
      rib.position.set(0, 0.62 - i * 0.12, 0.02);
      rib.rotation.x = Math.PI / 2;   // half-ring arcs across the chest (+Z)
      torso.add(rib);
    }
    const sternum = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 0.45, 6), b);
    sternum.position.set(0, 0.42, 0.31);
    torso.add(sternum);
    for (const s of [-1, 1]) {
      const pad = new THREE.Mesh(new THREE.SphereGeometry(0.16, 8, 6), b);
      pad.position.set(s * 0.36, 0.7, 0);
      pad.scale.set(1, 0.7, 1);
      torso.add(pad);
    }
    const skull = new THREE.Mesh(new THREE.SphereGeometry(0.31, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2), b);
    skull.position.y = 0.26;
    head.add(skull);
    for (const s of [-1, 1]) {
      const horn = new THREE.Mesh(new THREE.ConeGeometry(0.06, 0.38, 6), b);
      horn.position.set(s * 0.27, 0.45, 0);
      horn.rotation.z = -s * 0.7;
      head.add(horn);
    }
  },
  bronze(torso, head) {
    const m = metal();
    const plate = new THREE.Mesh(new THREE.CylinderGeometry(0.34, 0.37, 0.52, 14, 1, true), m);
    plate.position.y = 0.42;
    plate.scale.z = 0.9;
    torso.add(plate);
    for (const s of [-1, 1]) {
      const pauldron = new THREE.Mesh(new THREE.SphereGeometry(0.19, 10, 6, 0, Math.PI * 2, 0, Math.PI / 2), m);
      pauldron.position.set(s * 0.37, 0.66, 0);
      torso.add(pauldron);
    }
    const helm = new THREE.Mesh(new THREE.SphereGeometry(0.3, 12, 8, 0, Math.PI * 2, 0, Math.PI / 1.8), m);
    helm.position.y = 0.24;
    head.add(helm);
    const nose = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.16, 0.04), m);
    nose.position.set(0, 0.22, 0.29);
    head.add(nose);
    const crest = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.16, 0.5), mat('#c8322a'));
    crest.position.set(0, 0.6, -0.02);
    head.add(crest);
  },
  steel(torso, head) {
    const m = metal('#c9d0d8');
    const plate = new THREE.Mesh(new THREE.CylinderGeometry(0.34, 0.38, 0.55, 16, 1, true), m);
    plate.position.y = 0.42;
    plate.scale.z = 0.9;
    torso.add(plate);
    for (const s of [-1, 1]) {
      const pauldron = new THREE.Mesh(new THREE.SphereGeometry(0.2, 10, 6, 0, Math.PI * 2, 0, Math.PI / 2), m);
      pauldron.position.set(s * 0.38, 0.65, 0);
      pauldron.scale.y = 0.8;
      torso.add(pauldron);
    }
    // morion: rounded cap with a curled brim and a little comb
    const helm = new THREE.Mesh(new THREE.SphereGeometry(0.29, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2), m);
    helm.position.y = 0.27;
    helm.scale.y = 1.25;
    const brim = new THREE.Mesh(new THREE.TorusGeometry(0.33, 0.04, 6, 18), m);
    brim.rotation.x = Math.PI / 2;
    brim.position.y = 0.28;
    brim.scale.set(1.15, 1, 1);
    const comb = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.12, 0.42), m);
    comb.position.set(0, 0.62, 0);
    head.add(helm, brim, comb);
  },
  kevlar(torso, head) {
    const cloth = mat('#5d6b3e', { roughness: 0.95 }), dark = mat('#3f4a2a');
    const vest = new THREE.Mesh(new THREE.CylinderGeometry(0.35, 0.37, 0.5, 12, 1, true), cloth);
    vest.position.y = 0.42;
    vest.scale.z = 0.92;
    torso.add(vest);
    for (const x of [-0.12, 0.12]) {
      const pouch = new THREE.Mesh(new THREE.BoxGeometry(0.13, 0.12, 0.06), dark);
      pouch.position.set(x, 0.32, 0.33);
      torso.add(pouch);
    }
    const helm = new THREE.Mesh(new THREE.SphereGeometry(0.31, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2), cloth);
    helm.position.y = 0.24;
    helm.scale.y = 0.9;
    const strap = new THREE.Mesh(new THREE.TorusGeometry(0.24, 0.015, 4, 14, Math.PI), dark);
    strap.position.y = 0.2;
    strap.rotation.z = Math.PI;
    head.add(helm, strap);
  },
  power(torso, head) {
    const white = mat('#eef3f7', { roughness: 0.35 }), trim = mat('#3a4048');
    const glow = new THREE.MeshBasicMaterial({ color: '#7fe8ff' });
    const plate = new THREE.Mesh(new THREE.CylinderGeometry(0.36, 0.39, 0.56, 16, 1, true), white);
    plate.position.y = 0.42;
    plate.scale.z = 0.92;
    torso.add(plate);
    const core = new THREE.Mesh(new THREE.CircleGeometry(0.08, 16), glow);
    core.position.set(0, 0.5, 0.345);
    torso.add(core);
    for (const s of [-1, 1]) {
      const pad = new THREE.Mesh(new THREE.BoxGeometry(0.24, 0.12, 0.3), trim);
      pad.position.set(s * 0.38, 0.68, 0);
      torso.add(pad);
    }
    // glass fishbowl over the whole head
    const dome = new THREE.Mesh(new THREE.SphereGeometry(0.42, 16, 12),
      new THREE.MeshStandardMaterial({ color: '#cfefff', transparent: true, opacity: 0.25, roughness: 0.05, depthWrite: false }));
    dome.position.y = 0.2;
    const collar = new THREE.Mesh(new THREE.TorusGeometry(0.3, 0.05, 6, 18), trim);
    collar.rotation.x = Math.PI / 2;
    collar.position.y = -0.1;
    head.add(dome, collar);
  },
};

export function buildArmorParts(type) {
  const torso = new THREE.Group(), head = new THREE.Group();
  (ARMOR_BUILDERS[type] || ARMOR_BUILDERS.hide)(torso, head);
  mergeChildren(torso);
  mergeChildren(head);
  shadows(torso, true, false);
  shadows(head, true, false);
  return { torso, head };
}

// Armor on a little wooden stand, for drops lying on the planet.
export function buildArmorDisplay(type) {
  const g = new THREE.Group();
  const post = cyl(0.05, 0.06, 1.5, WOOD, 0.75, 5);
  const bar = cyl(0.04, 0.04, 0.8, WOOD, 0, 5);
  bar.rotation.z = Math.PI / 2;
  bar.position.y = 1.3;
  g.add(post, bar);
  mergeChildren(g);
  const { torso, head } = buildArmorParts(type);
  torso.position.y = 0.6;
  head.position.y = 1.35;
  g.add(torso, head);
  return shadows(g, false, false);   // it floats and spins; a shadow isn't worth the extra pass
}

// The chief's feather headdress.
export function buildHeaddress() {
  const g = new THREE.Group();
  const band = new THREE.Mesh(new THREE.TorusGeometry(0.27, 0.035, 5, 16), mat('#c8322a'));
  band.rotation.x = Math.PI / 2;
  band.position.y = 0.3;
  g.add(band);
  const colors = ['#f3e7c8', '#c8322a', '#2f78c4', '#f3e7c8', '#ffb52e', '#f3e7c8', '#c8322a'];
  colors.forEach((c, i) => {
    const a = Math.PI * (0.15 + (i / (colors.length - 1)) * 0.7);
    const feather = new THREE.Mesh(new THREE.ConeGeometry(0.05, 0.5, 4).translate(0, 0.25, 0).scale(1, 1, 0.3), mat(c));
    feather.position.set(Math.cos(a) * 0.25, 0.32, -Math.sin(a) * 0.25);
    feather.rotation.set(-Math.sin(a) * 0.35, 0, -Math.cos(a) * 0.35);
    g.add(feather);
  });
  mergeChildren(g);
  return shadows(g, true, false);
}
