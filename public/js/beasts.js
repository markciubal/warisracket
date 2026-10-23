// Killstreak beasts: an attack dog, a mammoth and a T-Rex, built from boxes, cones and squashed
// spheres like everything else. Each has a walk cycle, its attack moves, a death, and a name tag
// with a health bar ("GRONK'S MAMMOTH"). The monsters of the dark forest (peace mode) are beasts
// too: skeletons and zombies at its edge, ghosts and bats deeper in, vampires and sleep demons,
// and werewolves.
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

// A zombie: a caveman gone grey-green, in a torn pelt, shambling with its arms out in front.
function buildZombie() {
  const root = new THREE.Group();
  const body = pivot(root);
  const skin = '#7f9e6c', pelt = '#5b4632', dark = '#1a1410';
  const hips = pivot(body, 0, 0.95, 0);
  part(hips, box(0.46, 0.3, 0.3), pelt, 0, 0.02, 0);
  const legs = [-1, 1].map(s => {
    const leg = pivot(hips, s * 0.13, -0.05, 0);
    part(leg, box(0.16, 0.9, 0.18), skin, 0, -0.45, 0);
    part(leg, box(0.18, 0.08, 0.26), dark, 0, -0.9, 0.04);
    return leg;
  });
  const torso = pivot(hips, 0, 0.15, 0);
  part(torso, box(0.5, 0.62, 0.3), skin, 0, 0.3, 0);
  part(torso, box(0.52, 0.34, 0.32), pelt, 0, 0.12, 0);   // what's left of the pelt
  const head = pivot(torso, 0, 0.72, 0.02);
  part(head, box(0.34, 0.36, 0.34), skin, 0, 0.1, 0);
  for (const s of [-1, 1]) part(head, box(0.08, 0.06, 0.04), dark, s * 0.08, 0.14, 0.17);
  part(head, box(0.18, 0.05, 0.04), '#5a1f1a', 0, 0.0, 0.17);   // a slack mouth
  part(head, box(0.36, 0.08, 0.36), '#3a3024', 0, 0.3, 0);       // lank hair
  const arms = [-1, 1].map(s => {
    const arm = pivot(torso, s * 0.33, 0.5, 0);
    part(arm, box(0.13, 0.13, 0.62), skin, 0, 0, 0.3);   // straight out in front
    return arm;
  });
  return { root, body, torso, head, arms, legs, tagY: 2.5 };
}

// A bat: a small dark body with big ears and red eyes, on wings that never stop flapping. It
// flies at head height.
function buildBat() {
  const root = new THREE.Group();
  const body = pivot(root);
  const fly = pivot(body, 0, 1.6, 0);
  const fur = '#2b2233', wing = '#3d2f48';
  part(fly, ball(0.2, 1, 1.1, 1.2), fur);
  part(fly, ball(0.14), fur, 0, 0.16, 0.12);
  for (const s of [-1, 1]) {
    part(fly, cone(0.06, 0.18, 4), fur, s * 0.08, 0.32, 0.12);
    part(fly, ball(0.035), '#ff3b2f', s * 0.06, 0.18, 0.25);
  }
  const wings = [-1, 1].map(s => {
    const w = pivot(fly, s * 0.16, 0.04, 0);
    const m = part(w, box(0.7, 0.03, 0.42), wing, s * 0.38, 0, -0.04);
    m.rotation.y = s * 0.15;
    part(w, cone(0.1, 0.24, 3), wing, s * 0.75, 0, -0.22).rotation.x = Math.PI / 2;   // a ragged tip
    return w;
  });
  return { root, body, fly, wings, tagY: 2.8 };
}

// A vampire: tall and thin in black, a high collar and a cape lined red, pale with slicked hair,
// red eyes and two fangs.
function buildVampire() {
  const root = new THREE.Group();
  const body = pivot(root);
  const black = '#16121c', pale = '#e6e0d6', red = '#9a1020';
  const hips = pivot(body, 0, 1.0, 0);
  const legs = [-1, 1].map(s => {
    const leg = pivot(hips, s * 0.12, 0, 0);
    part(leg, box(0.15, 1.0, 0.17), black, 0, -0.5, 0);
    part(leg, box(0.16, 0.07, 0.28), '#0a080c', 0, -0.98, 0.05);
    return leg;
  });
  const torso = pivot(hips, 0, 0.05, 0);
  part(torso, box(0.44, 0.72, 0.26), black, 0, 0.36, 0);
  part(torso, box(0.12, 0.5, 0.02), '#f2eee6', 0, 0.42, 0.135);   // shirt front
  part(torso, box(0.56, 0.32, 0.06), red, 0, 0.82, -0.12);          // the high collar
  const cape = pivot(torso, 0, 0.74, -0.16);
  part(cape, box(0.74, 1.6, 0.05), black, 0, -0.8, 0);
  part(cape, box(0.7, 1.55, 0.02), red, 0, -0.78, 0.035);
  const head = pivot(torso, 0, 0.86, 0);
  part(head, box(0.3, 0.36, 0.3), pale, 0, 0.16, 0);
  part(head, box(0.32, 0.12, 0.32), '#0d0b10', 0, 0.36, -0.02);   // slicked hair
  part(head, cone(0.06, 0.12, 4), '#0d0b10', 0, 0.28, 0.15).rotation.x = Math.PI;   // the widow's peak
  for (const s of [-1, 1]) {
    part(head, box(0.06, 0.04, 0.03), '#ff2a2a', s * 0.07, 0.2, 0.15);
    part(head, cone(0.018, 0.06, 4), '#ffffff', s * 0.04, 0.03, 0.15).rotation.x = Math.PI;   // fangs
  }
  const arms = [-1, 1].map(s => {
    const arm = pivot(torso, s * 0.28, 0.64, 0);
    part(arm, box(0.12, 0.66, 0.13), black, 0, -0.33, 0);
    part(arm, box(0.1, 0.12, 0.1), pale, 0, -0.7, 0);
    return arm;
  });
  return { root, body, torso, head, cape, arms, legs, tagY: 2.8 };
}

// A sleep demon: the tall black figure at the foot of the bed. Too tall and too thin, stooped,
// arms down to its knees and long fingers, a thin grin, and a pair of googly eyes (one bigger than
// the other) whose pupils rattle about loose as it moves (googly(), below).
const EYE_WHITE = new THREE.MeshLambertMaterial({ color: '#ffffff', emissive: '#8c8c8c' });   // (they show in the dark)
function buildDemon() {
  const root = new THREE.Group();
  const body = pivot(root);
  const black = '#0b0a0f', dark = '#18141f';
  const hips = pivot(body, 0, 1.7, 0);
  part(hips, box(0.34, 0.16, 0.2), black);
  const legs = [-1, 1].map(s => {
    const leg = pivot(hips, s * 0.11, 0, 0);
    part(leg, box(0.11, 1.7, 0.13), black, 0, -0.85, 0);
    part(leg, box(0.12, 0.05, 0.32), black, 0, -1.68, 0.08);   // long flat feet
    return leg;
  });
  const torso = pivot(hips, 0, 0.06, 0);
  part(torso, box(0.36, 1.0, 0.2), black, 0, 0.5, 0);
  part(torso, box(0.66, 0.12, 0.22), black, 0, 0.98, 0);   // bony shoulders
  part(torso, cyl(0.05, 0.06, 0.26), dark, 0, 1.12, 0.02);   // a thin neck
  const head = pivot(torso, 0, 1.3, 0.04);
  part(head, ball(0.22, 0.85, 1.3, 0.9, 10), black, 0, 0.08, 0);
  part(head, new THREE.TorusGeometry(0.085, 0.011, 4, 10, Math.PI), '#cfc8bb', 0, -0.03, 0.185).rotation.z = Math.PI;   // the grin
  const eyes = [[-1, 0.105], [1, 0.085]].map(([s, r]) => {
    const socket = pivot(head, s * 0.1, 0.17, 0.18);
    socket.rotation.y = s * 0.15;
    socket.add(new THREE.Mesh(cyl(r, r, 0.04, 16).rotateX(Math.PI / 2), EYE_WHITE));
    const pupil = pivot(socket, 0, -r * 0.5, 0.022);
    part(pupil, cyl(r * 0.48, r * 0.48, 0.012, 12).rotateX(Math.PI / 2), '#050407');
    // room: how far the pupil can roll from the middle; x, y and vx, vy: where it is and how it's going
    return { socket, pupil, room: r * 0.52, x: 0, y: -r * 0.5, vx: 0, vy: 0, last: null, v: new THREE.Vector3() };
  });
  const arms = [-1, 1].map(s => {
    const arm = pivot(torso, s * 0.34, 0.95, 0);
    part(arm, box(0.08, 1.5, 0.09), black, 0, -0.75, 0);
    for (let k = 0; k < 3; k++) part(arm, cone(0.02, 0.3, 4), black, (k - 1) * 0.035, -1.62, 0.02).rotation.x = Math.PI;   // long fingers
    return arm;
  });
  return { root, body, torso, head, arms, legs, eyes, tagY: 4.1 };
}

// A werewolf: big and hunched, grey-brown fur, a wolf's head with a long snout, pricked ears and
// yellow eyes, clawed hands hanging low, and a bushy tail.
function buildWerewolf() {
  const root = new THREE.Group();
  const body = pivot(root);
  const fur = '#6b5a4a', light = '#a8977f', dark = '#2a2018';
  const hips = pivot(body, 0, 1.15, 0);
  part(hips, box(0.6, 0.4, 0.45), fur);
  const legs = [-1, 1].map(s => {
    const leg = pivot(hips, s * 0.2, -0.1, 0);
    part(leg, box(0.24, 0.6, 0.28), fur, 0, -0.3, 0.06);
    part(leg, box(0.18, 0.55, 0.2), fur, 0, -0.78, -0.1);   // the backward-bent shin
    part(leg, box(0.22, 0.08, 0.34), dark, 0, -1.08, 0.04);
    return leg;
  });
  const torso = pivot(hips, 0, 0.18, 0);
  torso.rotation.x = 0.45;   // hunched forward
  part(torso, box(0.84, 0.95, 0.6), fur, 0, 0.45, 0);
  part(torso, box(0.6, 0.6, 0.1), light, 0, 0.5, 0.3);   // chest
  const head = pivot(torso, 0, 1.0, 0.18);
  part(head, box(0.48, 0.42, 0.46), fur, 0, 0.05, 0);
  part(head, box(0.26, 0.22, 0.42), fur, 0, -0.04, 0.38);   // snout
  part(head, box(0.12, 0.08, 0.06), dark, 0, 0.04, 0.6);    // nose
  const jaw = pivot(head, 0, -0.14, 0.2);
  part(jaw, box(0.22, 0.08, 0.36), light, 0, 0, 0.16);
  for (const s of [-1, 1]) {
    part(head, cone(0.1, 0.32, 4), fur, s * 0.17, 0.36, -0.04);
    part(head, box(0.08, 0.05, 0.03), '#ffd23a', s * 0.12, 0.12, 0.24);
  }
  const arms = [-1, 1].map(s => {
    const arm = pivot(torso, s * 0.5, 0.78, 0);
    part(arm, box(0.24, 0.95, 0.26), fur, 0, -0.48, 0);
    for (let k = 0; k < 3; k++) part(arm, cone(0.035, 0.18, 4), '#e8e0cc', (k - 1) * 0.07, -1.02, 0.08).rotation.x = Math.PI;   // claws
    return arm;
  });
  const tail = pivot(hips, 0, 0.05, -0.25);
  part(tail, box(0.18, 0.18, 0.7), fur, 0, -0.1, -0.35).rotation.x = -0.5;
  return { root, body, torso, head, jaw, arms, legs, tail, tagY: 3.4 };
}

const BUILD = {
  dog: buildDog, mammoth: buildMammoth, trex: buildTrex,
  ghost: buildGhost, skeleton: buildSkeleton, zombie: buildZombie, bat: buildBat, vampire: buildVampire, demon: buildDemon, werewolf: buildWerewolf,
};
// googly eyes: how hard the planet pulls a pupil down (u/s²), and how much of its speed it keeps
// bouncing off the rim
const GOOGLY_G = 9.8, GOOGLY_BOUNCE = 0.55;
const _eyeP = new THREE.Vector3(), _eyeV = new THREE.Vector3(), _eyeA = new THREE.Vector3(), _eyeQ = new THREE.Quaternion();
// how long each move's animation runs (s)
const MOVE_TIME = { pounce: 0.6, bite: 0.3, tusk: 0.6, trample: 0.3, chomp: 0.6, roar: 1.2, swipe: 0.5, blink: 0.35 };
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

  // Googly eyes: each pupil rolls loose in its eye, flung by how the eye moves (its acceleration,
  // felt the other way, as in a cart that stops short) and pulled down by the planet, all as the
  // eye sees it, tilted with the head, and it bounces off the rim.
  googly(dt) {
    if (!(dt > 0)) return;
    dt = Math.min(dt, 1 / 20);
    for (const e of this.eyes) {
      e.socket.updateWorldMatrix(true, false);
      const p = e.socket.getWorldPosition(_eyeP);
      if (!e.last) { e.last = p.clone(); continue; }
      const v = _eyeV.copy(p).sub(e.last).divideScalar(dt);
      const acc = _eyeA.copy(v).sub(e.v).divideScalar(dt);
      e.v.copy(v);
      e.last.copy(p);
      if (acc.lengthSq() > 3600) acc.setLength(60);   // (a jump in the snapshots, not a real fling)
      const pull = acc.negate().addScaledVector(p.normalize(), -GOOGLY_G);
      pull.applyQuaternion(e.socket.getWorldQuaternion(_eyeQ).invert());
      const drag = Math.exp(-dt * 2.5);
      e.vx = (e.vx + pull.x * dt) * drag;
      e.vy = (e.vy + pull.y * dt) * drag;
      e.x += e.vx * dt;
      e.y += e.vy * dt;
      const d = Math.hypot(e.x, e.y);
      if (d > e.room) {
        const nx = e.x / d, ny = e.y / d, vn = e.vx * nx + e.vy * ny;
        e.x = nx * e.room;
        e.y = ny * e.room;
        if (vn > 0) { e.vx -= (1 + GOOGLY_BOUNCE) * vn * nx; e.vy -= (1 + GOOGLY_BOUNCE) * vn * ny; }
      }
      e.pupil.position.set(e.x, e.y, e.pupil.position.z);
    }
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
      if (this.eyes) this.googly(dt);   // (rattling all the way down)
      return;
    }
    this.moveT += dt;
    const mt = this.move ? this.moveT / MOVE_TIME[this.move] : 1;
    if (mt >= 1) this.move = null;
    const env = this.move ? Math.sin(Math.PI * Math.min(1, mt)) : 0;   // 0 -> 1 -> 0 over the move
    const stride = { dog: 1.9, mammoth: 0.75, trex: 0.7, ghost: 1, skeleton: 1.7, zombie: 1.8, bat: 1, vampire: 1.4, demon: 0.9, werewolf: 1.2 }[this.kind];
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
    } else if (this.kind === 'zombie') {
      // a dragging shamble, lolling head, and a lunge with both arms for a bite
      const a = Math.sin(w) * 0.35 * going;
      this.legs[0].rotation.x = a;
      this.legs[1].rotation.x = -a * 0.6;
      this.body.rotation.z = Math.sin(w) * 0.08 * going;
      const lunge = this.move === 'swipe' ? env : 0;
      this.torso.rotation.x = 0.15 + 0.45 * lunge;
      this.arms.forEach((arm, i) => { arm.rotation.x = Math.sin(t * 2 + i * 1.3) * 0.12 - 0.3 * lunge; });
      this.head.rotation.z = 0.25 + Math.sin(t * 1.3) * 0.1;
    } else if (this.kind === 'bat') {
      // wings flapping like mad, a jittery hover, and a dive at you
      const dive = this.move === 'swipe' ? env : 0;
      this.fly.position.y = 1.6 + Math.sin(t * 7) * 0.12 - 0.7 * dive;
      this.fly.rotation.x = 0.5 * dive;
      this.wings.forEach((wg, i) => { wg.rotation.z = (i ? 1 : -1) * Math.sin(t * 26) * 0.7; });
    } else if (this.kind === 'vampire') {
      // a smooth glide, the cape flaring behind; a lunge to bite; a swirl of the cape to vanish
      const a = Math.sin(w) * 0.4 * going;
      this.legs[0].rotation.x = a;
      this.legs[1].rotation.x = -a;
      const bite = this.move === 'swipe' ? env : 0, blink = this.move === 'blink' ? env : 0;
      this.cape.rotation.x = -0.15 - 0.5 * going - 0.9 * blink + Math.sin(t * 3) * 0.05;
      this.torso.rotation.x = 0.4 * bite;
      this.head.rotation.x = 0.3 * bite;
      this.arms.forEach((arm, i) => { arm.rotation.x = -1.3 * bite - 1.6 * blink; arm.rotation.z = (i ? -1 : 1) * 0.8 * blink; });
      this.body.rotation.y = blink * Math.PI * 2;
    } else if (this.kind === 'demon') {
      // a slow, too-long stride with the arms dangling; the head cocks one way, then the other,
      // and now and then twitches; for a grab it stoops in with both arms out. The eyes do as
      // they please (googly)
      const a = Math.sin(w) * 0.42 * going;
      this.legs[0].rotation.x = a;
      this.legs[1].rotation.x = -a;
      this.body.position.y = Math.abs(Math.sin(w)) * 0.1 * going;
      this.body.rotation.z = Math.sin(w) * 0.05 * going;
      const grab = this.move === 'swipe' ? env : 0;
      this.torso.rotation.x = 0.18 + 0.35 * grab;
      this.arms.forEach((arm, i) => {
        const s = i ? 1 : -1;
        arm.rotation.x = -s * a * 0.5 + Math.sin(t * 1.1 + i * 2) * 0.05 - 2.05 * grab;   // (out level, past the stoop)
        arm.rotation.z = s * (0.06 - 0.22 * grab);
      });
      const twitch = Math.sin(t * 0.9) > 0.92 ? Math.sin(t * 40) * 0.12 : 0;
      this.head.rotation.z = Math.sin(t * 0.45) * 0.28 + twitch;
      this.head.rotation.x = 0.15 - 0.1 * grab;   // looking down at you, from up there (and up at you as it reaches)
      this.googly(dt);
    } else if (this.kind === 'werewolf') {
      // a loping run with the arms swinging low, a leap with claws forward, and a two-handed rake
      const a = Math.sin(w) * 0.7 * going;
      this.legs[0].rotation.x = a;
      this.legs[1].rotation.x = -a;
      this.tail.rotation.x = Math.sin(t * 6) * 0.2;
      this.tail.rotation.y = Math.sin(t * 3) * 0.3;
      const rake = this.move === 'swipe' ? env : 0, leap = this.move === 'pounce' ? env : 0;
      this.arms.forEach((arm, i) => { arm.rotation.x = (i ? a : -a) * 0.8 - 1.9 * rake * (i ? 0.8 : 1) - 1.4 * leap; });
      this.torso.rotation.x = 0.45 + 0.35 * rake - 0.3 * leap;
      this.jaw.rotation.x = 0.5 * Math.max(rake, leap);
      this.head.rotation.x = -0.2 * leap;
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
