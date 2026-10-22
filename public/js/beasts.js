// Killstreak beasts: an attack dog, a mammoth and a T-Rex, built from boxes, cones and squashed
// spheres like everything else. Each has a walk cycle, its attack moves, a death, and a name tag
// with a health bar ("GRONK'S MAMMOTH"). The monsters of a haunted hollow (Ploughshares) are beasts
// too: a ghost and a skeleton.
import * as THREE from 'three';
import { BEASTS } from '/shared/constants.js';
import { mat, mergeChildren, shadows, placeOnSphere } from './util.js';

const box = (w, h, d) => new THREE.BoxGeometry(w, h, d);
const ball = (r, sx = 1, sy = 1, sz = 1, seg = 8) => new THREE.SphereGeometry(r, seg, Math.max(5, seg - 2)).scale(sx, sy, sz);
const cyl = (top, bottom, h, seg = 6) => new THREE.CylinderGeometry(top, bottom, h, seg);
const cone = (r, h, seg = 5) => new THREE.ConeGeometry(r, h, seg);

function part(parent, geo, color, x = 0, y = 0, z = 0) {
  const m = new THREE.Mesh(geo, mat(color, { flatShading: true }));
  m.position.set(x, y, z);
  parent.add(m);
  return m;
}

function pivot(parent, x = 0, y = 0, z = 0) {
  const g = new THREE.Group();
  g.position.set(x, y, z);
  parent.add(g);
  return g;
}

// Facing +Z, standing on y = 0.
// The attack dog. look 'pit': a stocky blue-grey pitbull with a white blaze, a blue
// nose, folded ears and a spiked collar. look 'dingo': a lean ginger dog with upright ears,
// white socks and a bushy white-tipped tail.
function buildDog(look) {
  const pit = look !== 'dingo';   // anything but an explicit dingo (even a missing look) is the pit
  const coat = pit ? '#8a97a6' : '#c98a4b';   // the pit's 'blue' is a soft slate grey
  const light = pit ? '#eeeae2' : '#f1e0bf';
  const white = pit ? '#eeeae2' : '#f6f1e6';
  const nose = pit ? '#5f6b78' : '#2a1a10';
  const legLen = pit ? 0.56 : 0.66;            // pits are low and stocky
  const torsoY = pit ? 0.74 : 0.85;
  const root = new THREE.Group();
  const body = pivot(root);
  const torso = pivot(body, 0, torsoY, 0);
  part(torso, box(pit ? 0.68 : 0.5, pit ? 0.6 : 0.48, pit ? 1.1 : 1.2), coat);
  part(torso, box(pit ? 0.5 : 0.4, 0.15, 0.9), light, 0, -0.22, 0.02);
  part(torso, box(pit ? 0.58 : 0.46, pit ? 0.5 : 0.44, 0.42), coat, 0, -0.02, 0.45);   // chest
  if (pit) part(torso, box(0.36, 0.38, 0.1), white, 0, -0.08, 0.68);                    // white blaze
  part(torso, box(pit ? 0.48 : 0.38, pit ? 0.42 : 0.4, 0.3), coat, 0, 0.2, 0.62);       // neck
  if (pit) {
    // spiked leather collar
    part(torso, new THREE.TorusGeometry(0.27, 0.045, 4, 12), '#7a2a1a', 0, 0.2, 0.66);
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2 + Math.PI / 6;
      part(torso, cone(0.035, 0.1, 4), '#d8d8d8', Math.cos(a) * 0.32, 0.2 + Math.sin(a) * 0.3, 0.66).rotation.z = a - Math.PI / 2;
    }
  }
  const head = pivot(torso, 0, pit ? 0.32 : 0.36, 0.82);
  part(head, box(pit ? 0.56 : 0.42, pit ? 0.46 : 0.38, pit ? 0.46 : 0.42), coat);
  part(head, box(pit ? 0.38 : 0.24, pit ? 0.28 : 0.2, pit ? 0.3 : 0.38), pit ? coat : light, 0, -0.08, pit ? 0.33 : 0.36);
  if (pit) part(head, box(0.12, 0.3, 0.05), white, 0, 0.06, 0.235);                     // blaze up the face
  part(head, box(pit ? 0.16 : 0.11, pit ? 0.1 : 0.08, 0.08), nose, 0, pit ? 0.01 : 0, pit ? 0.49 : 0.56);
  for (const s of [-1, 1]) {
    part(head, box(0.07, 0.06, 0.04), pit ? '#c9a14a' : '#8a5a1a', s * (pit ? 0.17 : 0.12), 0.08, pit ? 0.235 : 0.215);
    if (pit) {
      // rose ears, folded over sideways
      const ear = part(head, box(0.14, 0.05, 0.13), coat, s * 0.22, 0.25, 0.02);
      ear.rotation.set(0.5, 0, -s * 0.45);
    } else {
      // tall pointed dingo ears
      part(head, cone(0.1, 0.3, 4), coat, s * 0.13, 0.33, -0.03);
      part(head, cone(0.05, 0.18, 4), light, s * 0.13, 0.31, 0.0);
    }
  }
  const jaw = pivot(head, 0, -0.2, 0.12);
  part(jaw, box(pit ? 0.32 : 0.2, 0.1, pit ? 0.3 : 0.36), light, 0, -0.03, pit ? 0.18 : 0.22);
  const legs = [[-1, 0.5], [1, 0.5], [-1, -0.45], [1, -0.45]].map(([s, z]) => {
    const leg = pivot(torso, s * (pit ? 0.24 : 0.19), -0.2, z);
    part(leg, cyl(pit ? 0.11 : 0.08, pit ? 0.095 : 0.065, legLen), coat, 0, -legLen / 2, 0);
    if (!pit) part(leg, cyl(0.07, 0.065, 0.22), white, 0, -0.55, 0);                    // white socks
    part(leg, box(pit ? 0.17 : 0.13, 0.08, 0.22), white, 0, -legLen, 0.04);
    return leg;
  });
  const tail = pivot(torso, 0, 0.12, -0.6);
  if (pit) {
    part(tail, cyl(0.03, 0.06, 0.55, 5), coat, 0, -0.09, -0.26).rotation.x = -1.9;
  } else {
    part(tail, cone(0.12, 0.65, 6), coat, 0, -0.14, -0.3).rotation.x = -2.0;
    part(tail, cone(0.075, 0.16, 6), white, 0, -0.27, -0.56).rotation.x = -2.0;        // white tip
  }
  return { root, body, torso, head, jaw, legs, tail, torsoY, tagY: 1.9 };
}

function buildMammoth() {
  const fur = '#5b3a22', dark = '#3f2716', ivory = '#efe6cc';
  const root = new THREE.Group();
  const body = pivot(root);
  const torso = pivot(body, 0, 2.55, 0);
  part(torso, ball(1.6, 1.1, 0.95, 1.35, 9), fur);
  part(torso, ball(0.95), fur, 0, 1.15, 0.55);   // the hump
  for (let i = 0; i < 10; i++) {                  // shaggy fringe
    const a = (i / 10) * Math.PI * 2;
    part(torso, cone(0.28, 0.9, 4), dark, Math.cos(a) * 1.45, -1.0, Math.sin(a) * 1.75).rotation.x = Math.PI;
  }
  const head = pivot(torso, 0, 0.55, 2.0);
  part(head, ball(0.95, 1, 1.1, 0.95), fur);
  for (const s of [-1, 1]) {
    part(head, ball(0.45, 0.35, 1, 0.8, 6), dark, s * 0.9, 0.05, -0.15);
    part(head, box(0.1, 0.1, 0.06), '#1a120c', s * 0.42, 0.18, 0.8);
    // a tusk: a slice of ring from the mouth, down, forward and curling up at the tip
    const tusk = new THREE.TorusGeometry(1.0, 0.11, 5, 10, Math.PI * 0.83).rotateZ(Math.PI).rotateY(-Math.PI / 2);
    const m = part(head, tusk, ivory, s * 0.35, -0.5, 1.6);
    m.rotation.z = s * 0.25;
  }
  // trunk: thick at the face, thin at the tip; each piece starts as wide as the last one ended
  const trunkR = [0.34, 0.27, 0.2, 0.13];
  const trunk = [];
  let at = pivot(head, 0, -0.35, 0.85);
  for (let i = 0; i < 3; i++) {
    const seg = i === 0 ? at : pivot(at, 0, -0.7, 0);
    part(seg, cyl(trunkR[i], trunkR[i + 1], 0.75), fur, 0, -0.35, 0);
    trunk.push(seg);
    at = seg;
  }
  const legs = [[-0.85, 1.0], [0.85, 1.0], [-0.85, -1.0], [0.85, -1.0]].map(([x, z]) => {
    const leg = pivot(torso, x, -0.6, z);
    part(leg, cyl(0.42, 0.38, 2.0, 7), fur, 0, -0.95, 0);
    part(leg, cyl(0.44, 0.44, 0.15, 7), '#2e1d10', 0, -1.95, 0);
    return leg;
  });
  const tail = pivot(torso, 0, 0.3, -2.1);
  part(tail, cyl(0.1, 0.05, 0.8, 5), dark, 0, -0.4, 0);
  part(tail, ball(0.11, 1, 1.4, 1, 5), dark, 0, -0.85, 0);   // the tuft
  return { root, body, torso, head, trunk, legs, tail, tagY: 5.6 };
}

function buildTrex() {
  const green = '#5f7d3a', belly = '#b9b37a', dark = '#3d5226', tooth = '#f4efe0';
  const root = new THREE.Group();
  const body = pivot(root);
  const hips = pivot(body, 0, 3.0, 0);
  const torso = pivot(hips);
  part(torso, ball(1.25, 1.0, 1.05, 1.9, 9), green, 0, 0.3, 0.4);
  part(torso, ball(1.0, 0.9, 0.9, 1.5), belly, 0, -0.1, 0.6);
  for (let i = 0; i < 6; i++) part(torso, cone(0.14, 0.4, 4), dark, 0, 1.45 - i * 0.08, 1.6 - i * 0.7);
  const neck = pivot(torso, 0, 0.9, 2.1);
  part(neck, cyl(0.55, 0.75, 1.2, 7), green, 0, 0.3, 0.1).rotation.x = 0.6;
  const head = pivot(neck, 0, 0.9, 0.5);
  part(head, box(1.0, 0.85, 1.9), green, 0, 0.1, 0.6);
  part(head, box(1.04, 0.2, 0.5), dark, 0, 0.55, 0.2);
  for (const s of [-1, 1]) {
    part(head, box(0.12, 0.12, 0.08), '#ffd34d', s * 0.45, 0.35, 0.5);
    part(head, box(0.1, 0.08, 0.08), '#1a120c', s * 0.2, 0.35, 1.52);
    for (let i = 0; i < 5; i++) part(head, cone(0.06, 0.25, 4), tooth, s * 0.42, -0.42, 0.2 + i * 0.32).rotation.x = Math.PI;
  }
  const jaw = pivot(head, 0, -0.35, -0.2);
  part(jaw, box(0.9, 0.3, 1.75), belly, 0, -0.1, 0.8);
  for (const s of [-1, 1]) for (let i = 0; i < 4; i++) part(jaw, cone(0.05, 0.2, 4), tooth, s * 0.36, 0.12, 0.35 + i * 0.32);
  for (const s of [-1, 1]) {           // the famous little arms
    const arm = pivot(torso, s * 0.7, -0.2, 1.7);
    part(arm, cyl(0.1, 0.08, 0.7, 5), green, 0, -0.3, 0.1).rotation.x = -0.8;
  }
  const legs = [-1, 1].map(s => {
    const thigh = pivot(hips, s * 0.8, -0.1, -0.1);
    part(thigh, cyl(0.5, 0.4, 1.6, 7), green, 0, -0.75, 0);
    const shin = pivot(thigh, 0, -1.5, 0);
    part(shin, cyl(0.32, 0.26, 1.4), green, 0, -0.65, -0.15);
    part(shin, box(0.6, 0.25, 0.9), dark, 0, -1.4, 0.25);
    return { thigh, shin };
  });
  // the tail starts inside the body and tapers back to a point in three swinging pieces.
  // A cylinder's first radius is its +Y end, which rotateX(PI/2) turns toward the body.
  const tailR = [0.8, 0.58, 0.36, 0.12];
  const tail = [];
  let at = pivot(torso, 0, 0.3, -1.6);
  for (let i = 0; i < 3; i++) {
    const seg = i === 0 ? at : pivot(at, 0, 0, -1.2);
    part(seg, cyl(tailR[i], tailR[i + 1], 1.45, 7).rotateX(Math.PI / 2), green, 0, 0, -0.62);
    tail.push(seg);
    at = seg;
  }
  return { root, body, torso, neck, head, jaw, legs, tail, tagY: 6.6 };
}

// A ghost: a sheet with holes for eyes, hovering and bobbing, little arms out. See-through.
function buildGhost() {
  const root = new THREE.Group();
  const body = pivot(root);
  const float = pivot(body, 0, 0.45, 0);
  const sheet = new THREE.MeshLambertMaterial({ color: '#f4f2ff', emissive: '#6c6890', emissiveIntensity: 0.4, transparent: true, opacity: 0.85, flatShading: true, side: THREE.DoubleSide });
  const skirt = new THREE.Mesh(new THREE.CylinderGeometry(0.44, 0.62, 1.1, 12, 1, true), sheet);
  skirt.position.y = 0.55;
  float.add(skirt);
  const dome = new THREE.Mesh(new THREE.SphereGeometry(0.45, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2), sheet);
  dome.position.y = 1.1;
  float.add(dome);
  // a ragged hem
  for (let i = 0; i < 10; i++) {
    const a = (i / 10) * Math.PI * 2;
    const tip = new THREE.Mesh(cone(0.13, 0.28, 4), sheet);
    tip.position.set(Math.cos(a) * 0.55, -0.1, Math.sin(a) * 0.55);
    tip.rotation.x = Math.PI;
    float.add(tip);
  }
  for (const s of [-1, 1]) part(float, ball(0.08, 0.8, 1.3, 0.5), '#120d1a', s * 0.15, 1.18, 0.41);
  part(float, ball(0.09, 1.2, 0.8, 0.5), '#120d1a', 0, 0.92, 0.44);   // "oooo"
  const arms = [-1, 1].map(s => {
    const arm = pivot(float, s * 0.46, 0.85, 0);
    const nub = new THREE.Mesh(cone(0.11, 0.42, 6), sheet);
    nub.position.x = s * 0.18;
    nub.rotation.z = s * -Math.PI / 2;
    arm.add(nub);
    return arm;
  });
  return { root, body, float, arms, tagY: 2.9 };
}

// A skeleton: bones, a grinning skull, and a bone club in its right hand.
function buildSkeleton() {
  const root = new THREE.Group();
  const body = pivot(root);
  const bone = '#ece4cc', dark = '#1a1410';
  const hips = pivot(body, 0, 0.95, 0);
  part(hips, box(0.4, 0.1, 0.18), bone);
  const legs = [-1, 1].map(s => {
    const leg = pivot(hips, s * 0.13, 0, 0);
    part(leg, cyl(0.035, 0.035, 0.9), bone, 0, -0.45, 0);
    part(leg, box(0.1, 0.05, 0.22), bone, 0, -0.92, 0.05);
    return leg;
  });
  const torso = pivot(hips, 0, 0.05, 0);
  part(torso, cyl(0.035, 0.035, 0.75), bone, 0, 0.37, -0.06);
  for (let i = 0; i < 4; i++) {
    const rib = part(torso, new THREE.TorusGeometry(0.2 - i * 0.015, 0.024, 4, 12, Math.PI * 1.4), bone, 0, 0.3 + i * 0.12, 0);
    rib.rotation.set(Math.PI / 2, 0, Math.PI * 0.8);
  }
  const head = pivot(torso, 0, 0.82, 0);
  part(head, ball(0.19, 1, 1.05, 1.05), bone, 0, 0.12, 0);
  part(head, box(0.2, 0.08, 0.16), bone, 0, -0.04, 0.05);
  for (const s of [-1, 1]) part(head, ball(0.05), dark, s * 0.075, 0.13, 0.165);
  for (let i = 0; i < 5; i++) part(head, box(0.02, 0.04, 0.02), dark, -0.06 + i * 0.03, -0.01, 0.13);   // teeth
  const arms = [-1, 1].map(s => {
    const arm = pivot(torso, s * 0.25, 0.6, 0);
    part(arm, cyl(0.03, 0.03, 0.62), bone, 0, -0.31, 0);
    return arm;
  });
  const club = part(arms[0], cyl(0.05, 0.09, 0.62), bone, 0, -0.66, 0.24);
  club.rotation.x = Math.PI / 2;
  return { root, body, torso, head, arms, legs, tagY: 2.6 };
}

const BUILD = { dog: buildDog, mammoth: buildMammoth, trex: buildTrex, ghost: buildGhost, skeleton: buildSkeleton };
// how long each move's animation runs (s)
const MOVE_TIME = { pounce: 0.6, bite: 0.3, tusk: 0.6, trample: 0.3, chomp: 0.6, roar: 1.2, swipe: 0.5 };
const TEAM_COLOR = { mine: '#ffd34d', ally: '#8dff9a', foe: '#ff8a7a' };

export class Beast {
  // look: which dog (BEASTS.dog.looks), for the dog
  constructor(kind, { label, team = 'foe', look = null }) {
    this.kind = kind;
    this.def = BEASTS[kind];
    Object.assign(this, BUILD[kind](look));
    // one draw call per material per moving part
    const groups = [];
    this.root.traverse(o => { if (o.isGroup) groups.push(o); });
    for (const g of groups) mergeChildren(g);
    shadows(this.root, true, false);
    this.walk = 0;
    this.move = null;
    this.moveT = 0;
    this.deadT = -1;
    this.spawnT = 0;
    this.label = label;
    this.team = team;
    this.hp = this.def.hp;

    this.tagCanvas = document.createElement('canvas');
    this.tagCanvas.width = 320;
    this.tagCanvas.height = 80;
    this.tagTex = new THREE.CanvasTexture(this.tagCanvas);
    this.tagTex.colorSpace = THREE.SRGBColorSpace;
    this.tag = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.tagTex, depthWrite: false }));
    this.tag.scale.set(3.2, 0.8, 1);
    this.tag.position.y = this.tagY;
    this.tag.renderOrder = 10;
    this.root.add(this.tag);
    this.drawTag();
  }

  drawTag() {
    const g = this.tagCanvas.getContext('2d');
    g.clearRect(0, 0, 320, 80);
    g.font = '28px "Luckiest Guy", Impact, sans-serif';
    g.textAlign = 'center';
    g.lineJoin = 'round';
    g.lineWidth = 6;
    g.strokeStyle = 'rgba(20,12,6,0.9)';
    g.fillStyle = TEAM_COLOR[this.team] || '#f3e7c8';
    const label = `${this.def.icon} ${this.label}`.toUpperCase();
    g.strokeText(label, 160, 32, 310);
    g.fillText(label, 160, 32, 310);
    const frac = Math.max(0, this.hp) / this.def.hp;
    g.fillStyle = 'rgba(20,12,6,0.85)';
    g.fillRect(30, 46, 260, 20);
    g.fillStyle = frac > 0.5 ? '#ffb52e' : frac > 0.25 ? '#ff7a2a' : '#ff3d1f';
    g.fillRect(33, 49, 254 * frac, 14);
    this.tagTex.needsUpdate = true;
  }

  setHp(hp) {
    if (hp === this.hp) return;
    this.hp = hp;
    this.drawTag();
  }

  place(p, f, h) { placeOnSphere(this.root, p, f, h); }

  // a move from the server: pounce, bite, tusk, trample, chomp, roar
  play(move) {
    this.move = move;
    this.moveT = 0;
  }

  die() {
    if (this.deadT < 0) this.deadT = 0;
    this.tag.visible = false;
  }

  // speed: how fast it's going over the ground (u/s)
  update(dt, speed) {
    // rises out of the ground when called
    this.spawnT += dt;
    const grow = Math.min(1, this.spawnT * 2.2);
    this.root.scale.setScalar(0.3 + 0.7 * (1 - (1 - grow) ** 3));
    if (this.deadT >= 0) {
      // keels over, lies there a moment, sinks into the ground
      this.deadT += dt;
      this.body.rotation.z = Math.min(1, this.deadT * 1.8) * 1.45;
      this.body.position.y = -Math.max(0, this.deadT - 1.5) * 1.5;
      return;
    }
    this.moveT += dt;
    const mt = this.move ? this.moveT / MOVE_TIME[this.move] : 1;
    if (mt >= 1) this.move = null;
    const env = this.move ? Math.sin(Math.PI * Math.min(1, mt)) : 0;   // 0 -> 1 -> 0 over the move
    const stride = { dog: 1.9, mammoth: 0.75, trex: 0.7, ghost: 1, skeleton: 1.7 }[this.kind];
    this.walk += dt * Math.min(speed, this.def.speed * 2) * stride;
    const w = this.walk;
    const going = Math.min(1, speed / 2);
    const t = this.spawnT;

    if (this.kind === 'dog') {
      const a = Math.sin(w) * 0.8 * going;
      [a, -a, -a, a].forEach((r, i) => { this.legs[i].rotation.x = r; });
      this.torso.position.y = this.torsoY + Math.abs(Math.sin(w)) * 0.06 * going;
      this.torso.rotation.x = this.move === 'pounce' ? -0.55 * env : 0;
      if (this.move === 'pounce') { this.legs[0].rotation.x = this.legs[1].rotation.x = -1.2 * env; }
      this.jaw.rotation.x = (this.move === 'bite' || this.move === 'pounce' ? 0.7 : 0) * env;
      // good boy: a quick wag, tail up when it goes for someone
      this.tail.rotation.y = Math.sin(t * 16) * (this.move ? 0.15 : 0.55);
      this.tail.rotation.x = 0.25 + (this.move ? 0.55 * env : 0);   // + lifts it toward level
    } else if (this.kind === 'mammoth') {
      const a = Math.sin(w) * 0.35 * going;
      [a, -a, -a, a].forEach((r, i) => { this.legs[i].rotation.x = r; });
      this.torso.position.y = 2.55 + Math.abs(Math.sin(w)) * 0.08 * going;
      this.torso.rotation.z = Math.sin(w) * 0.03 * going;
      // the trunk curls and sways; it goes up for a swing or a trumpet
      const lift = this.move === 'tusk' || this.move === 'trample' ? env : 0;
      this.trunk.forEach((seg, i) => { seg.rotation.x = 0.2 + Math.sin(t * 1.3 + i) * 0.15 - lift * (0.9 - i * 0.2); });
      this.head.rotation.x = -0.55 * (this.move === 'tusk' ? env : 0);
      this.head.rotation.z = 0.3 * (this.move === 'tusk' ? env : 0);
      this.tail.rotation.x = Math.sin(t * 2.5) * 0.4;
    } else if (this.kind === 'ghost') {
      // it hovers and bobs, leans into a glide, and lunges with both arms for a BOO
      const boo = this.move === 'swipe' ? env : 0;
      this.float.position.y = 0.45 + Math.sin(t * 2.2) * 0.14;
      this.body.rotation.x = 0.18 * going + 0.3 * boo;
      this.arms.forEach((arm, i) => {
        arm.rotation.z = (i ? -1 : 1) * (0.5 - 0.4 * boo) + Math.sin(t * 3 + i) * 0.12;
        arm.rotation.y = (i ? 1 : -1) * 0.9 * boo;
      });
    } else if (this.kind === 'skeleton') {
      // a stiff walk, a rattling skull, and the club coming over for a swipe
      const a = Math.sin(w) * 0.6 * going;
      this.legs[0].rotation.x = a;
      this.legs[1].rotation.x = -a;
      this.arms[1].rotation.x = -a * 0.6;
      this.arms[0].rotation.x = this.move === 'swipe' ? -2.4 * Math.sin(Math.PI * Math.min(1, mt * 0.8)) : a * 0.6;
      this.head.rotation.z = Math.sin(t * 9) * 0.06;
      this.head.rotation.x = 0.25 * (this.move === 'swipe' ? env : 0);
    } else {
      const a = Math.sin(w) * 0.55 * going;
      this.legs.forEach((leg, i) => {
        const s = i ? -a : a;
        leg.thigh.rotation.x = s;
        leg.shin.rotation.x = Math.max(0, -s) * 0.9;
      });
      this.body.position.y = -Math.abs(Math.cos(w)) * 0.15 * going;
      this.tail.forEach((seg, i) => {
        seg.rotation.y = Math.sin(t * 1.2 - i * 0.6 + w * 0.5) * 0.18;
        seg.rotation.x = 0.06 * i;
      });
      // chomp lunges down and snaps shut; roar throws the head up with the jaw wide
      const chomp = this.move === 'chomp' ? env : 0;
      const roar = this.move === 'roar' ? env : 0;
      this.neck.rotation.x = 0.5 * chomp - 0.55 * roar + Math.sin(w) * 0.04 * going;
      this.jaw.rotation.x = 0.75 * (this.move === 'chomp' ? Math.max(0, Math.sin(Math.PI * Math.min(1, mt * 1.4))) : 0) + 0.95 * roar;
      this.head.rotation.z = roar ? Math.sin(t * 40) * 0.05 * roar : 0;
    }
  }

  dispose() {
    this.root.removeFromParent();
    this.root.traverse(o => { if (o.isMesh) o.geometry.dispose(); });
    this.tagTex.dispose();
    this.tag.material.dispose();
  }
}
