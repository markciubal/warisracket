// The Businessman: Mammon on his podium of gold at the bottom of the world, getting fatter on the
// war. fat (0..1) swells his belly and chins and, at MAMMON.stages, adds a watch chain, a hat,
// monocle, gold chains, cigar, money bags and at the very end a suit of solid gold. Coins pile up
// around the podium with his profit, shown on a sign over his head.
// He dresses for the times (setLook): the war profiteer through the ages, from a leopard-pelt suit
// with a stone ledger to a glowing tech suit, and he gears up for whatever disaster is coming
// (hard hat, gas mask, swim ring, earmuffs), not that it helps. His skin is whatever the person
// watching has picked for their own caveman, so everyone sees him as one of their own.
// The end of the world gets him too (die()): he keels over onto his back, legs in the air, his hat
// flies off and his money bursts out of him all over the podium.
import * as THREE from 'three';
import { MAMMON, R, SKINS } from '/shared/constants.js';
import { mat, shadows } from './util.js';
import { peltTexture } from './textures.js';

const box = (w, h, d) => new THREE.BoxGeometry(w, h, d);
const ball = (r, seg = 10) => new THREE.SphereGeometry(r, seg, Math.max(6, seg - 3));
const cyl = (top, bottom, h, seg = 10) => new THREE.CylinderGeometry(top, bottom, h, seg);
const ring = (r, tube, arc = Math.PI * 2) => new THREE.TorusGeometry(r, tube, 6, 20, arc);

const SUIT = '#2b2f3a', SUIT_DARK = '#1d2028', GOLD = '#e8b931', SHIRT = '#f4f1ea', TIE = '#b3202a';

// What he wears in each age (ERAS ids). suit: jacket and sleeves ('pelt' = leopard pelt). legs:
// trousers ('skin' = bare legs under a toga). shirt, tie: the front of him (null = none; 'cravat'
// and 'glow' are their own kinds of tie). hat: what he puts on once he reaches the hat stage.
// carry: what he holds until the money bags take over. sash, wig: extras for that age.
const OUTFITS = {
  stone:  { suit: 'pelt',    legs: '#5a4030', shirt: null,      tie: TIE,      hat: 'fur',     carry: 'tablet' },
  bow:    { suit: '#3f5a2a', legs: '#4a3626', shirt: '#d9c9a0', tie: TIE,      hat: 'feather', carry: 'pouch' },
  sword:  { suit: '#efe9dc', legs: 'skin',    shirt: null,      tie: null,     hat: 'laurel',  carry: 'scroll', sash: '#6b2d8f' },
  musket: { suit: '#7a1a22', legs: '#efe6d0', shirt: null,      tie: 'cravat', hat: 'tricorn', carry: 'chest', wig: true },
  gun:    { suit: SUIT,      legs: SUIT_DARK, shirt: SHIRT,     tie: TIE,      hat: 'tophat',  carry: 'briefcase' },
  laser:  { suit: '#e6e9ee', legs: '#c3c9d2', shirt: '#1b1e24', tie: 'glow',   hat: 'visor',   carry: 'pad' },
};
const GLOW = '#3ff0ff';
const TWIRL = 0.7;   // seconds of spinning round when he changes clothes

// his death: SHOCK s of jolting with his arms flung up, FALL s going over, then lying there
const SHOCK = 0.4, FALL = 0.6;
const SPILL_MAX = 240;   // coins that burst out of him
const GRAVITY = 16;
// The podium under him, as heights relative to his feet (he stands on the gold dais at local
// y 0) by distance from its middle: the dais, two marble steps, then the ground curving away.
function floorAt(x, z) {
  const r = Math.hypot(x, z);
  if (r < 1.47) return 0;
  if (r < 1.98) return -0.46;
  if (r < 2.46) return -0.88;
  return -1.3 - (r * r) / (2 * R);
}
const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _e = new THREE.Euler(), _v = new THREE.Vector3(), _axis = new THREE.Vector3();
const ONE = new THREE.Vector3(1, 1, 1);

function part(parent, geo, material, x = 0, y = 0, z = 0) {
  const m = new THREE.Mesh(geo, material);
  m.position.set(x, y, z);
  parent.add(m);
  return m;
}
const flat = c => mat(c, { flatShading: true });
const shiny = c => mat(c, { metalness: 0.8, roughness: 0.3 });

export class Businessman {
  constructor() {
    this.root = new THREE.Group();     // stands on the podium top, turns to face you
    this.fig = new THREE.Group();      // bobs and laughs
    this.root.add(this.fig);
    // everything he changes between ages has its own material (the suit also turns to gold at
    // the end), so recoloring him never touches the shared, cached ones
    const own = c => new THREE.MeshLambertMaterial({ color: c, flatShading: true });
    this.suit = own(SUIT);
    this.pants = own(SUIT_DARK);
    this.shirt = own(SHIRT);
    this.tieMat = own(TIE);
    this.sashMat = own('#6b2d8f');
    this.skin = own(SKINS[0]);
    this.nose = own(SKINS[0]);
    this.glow = new THREE.MeshBasicMaterial({ color: GLOW });
    this.eyeMat = flat('#151515');
    this.redEye = new THREE.MeshBasicMaterial({ color: '#ff2a1a' });
    this.fat = 0;
    this.shown = -1;
    this.laughT = -1;
    this.twirlT = -1;
    this.t = 0;
    this.dead = false;
    this.era = null;        // OUTFITS key he's dressed for
    this.disaster = null;   // the disaster he's geared up for, while the world is ending
    this.party = false;     // the tribe got wiped (co-op): champagne
    this.onLand = null;     // called when he hits the dais and the coins burst out
    this.build();
    shadows(this.root, true, false);
    this.setFat(0);
    this.setLook({ era: 'stone' });
  }

  build() {
    const f = this.fig;
    // legs and shoes
    this.legMeshes = [];
    this.legs = [-1, 1].map(s => {
      const leg = new THREE.Group();
      leg.position.set(s * 0.17, 0, 0);
      this.legMeshes.push(part(leg, cyl(0.12, 0.11, 0.95), this.pants, 0, 0.5, 0));
      part(leg, box(0.2, 0.1, 0.34), flat('#0e0e10'), 0, 0.05, 0.06);
      f.add(leg);
      return leg;
    });
    // the belly: one squashed ball that swells with profit, with shirt, tie and straining buttons
    this.body = new THREE.Group();
    this.body.position.y = 1.35;
    f.add(this.body);
    this.suitMeshes = [part(this.body, ball(0.42, 12), this.suit)];
    this.shirtMesh = part(this.body, box(0.2, 0.62, 0.05), this.shirt, 0, 0.08, 0.4);
    this.tie = part(this.body, box(0.08, 0.48, 0.04), this.tieMat, 0, 0.08, 0.43);
    for (const y of [-0.12, -0.26]) part(this.body, ball(0.03, 6), shiny(GOLD), 0.13, y, 0.41);
    // a toga's purple stripe, slung diagonally round the belly (Shiny Rock Age)
    this.sash = part(this.body, ring(0.425, 0.04), this.sashMat);
    this.sash.rotation.set(Math.PI / 2, 0.75, 0);
    // pocket-watch chain swinging across the belly
    this.watch = new THREE.Group();
    part(this.watch, new THREE.TorusGeometry(0.22, 0.012, 4, 16, Math.PI), shiny(GOLD), 0, -0.12, 0.4).rotation.z = Math.PI;
    part(this.watch, cyl(0.05, 0.05, 0.02, 12), shiny(GOLD), 0.22, -0.13, 0.42).rotation.x = Math.PI / 2;
    this.body.add(this.watch);
    // arms hang from the shoulders, which move out as he grows
    this.arms = [-1, 1].map(s => {
      const arm = new THREE.Group();
      this.suitMeshes.push(part(arm, cyl(0.09, 0.08, 0.7), this.suit, 0, -0.33, 0));
      part(arm, ball(0.08, 8), this.skin, 0, -0.72, 0.03);
      f.add(arm);
      return arm;
    });
    // what he carries in each age (OUTFITS carry), until the money bags take over
    const hand = this.arms[1];
    const carry = this.carry = {};
    const kit = (name, ...parts) => {
      const g = new THREE.Group();
      for (const [geo, material, x, y, z, rx = 0, rz = 0] of parts) Object.assign(part(g, geo, material, x, y, z).rotation, { x: rx, z: rz });
      hand.add(g);
      carry[name] = g;
    };
    // a ledger carved in stone, with its tally marks
    kit('tablet', [box(0.3, 0.42, 0.07), flat('#8a8580'), 0, -0.9, 0.05],
      ...[-0.06, 0, 0.06].map(x => [box(0.02, 0.2, 0.01), flat('#4a4642'), x, -0.9, 0.09]));
    kit('pouch', [ball(0.15, 8), flat('#7a5230'), 0, -0.92, 0.05], [cyl(0.04, 0.07, 0.07, 8), flat('#5a3a22'), 0, -0.77, 0.05]);
    kit('scroll', [cyl(0.06, 0.06, 0.42, 8), flat('#efe2bd'), 0, -0.86, 0.06, 0, Math.PI / 2],
      ...[-1, 1].map(s => [cyl(0.03, 0.03, 0.06, 6), flat('#6b4423'), s * 0.24, -0.86, 0.06, 0, Math.PI / 2]));
    kit('chest', [box(0.36, 0.24, 0.2), flat('#6b4423'), 0, -0.92, 0.06], [box(0.38, 0.04, 0.22), shiny(GOLD), 0, -0.86, 0.06]);
    kit('briefcase', [box(0.36, 0.26, 0.1), flat('#5a3a22'), 0, -0.88, 0.05]);
    kit('pad', [box(0.3, 0.22, 0.03), flat('#1b1e24'), 0, -0.86, 0.06], [box(0.26, 0.18, 0.01), this.glow, 0, -0.86, 0.078]);
    // champagne, raised in the other hand when he's celebrating
    this.flute = new THREE.Group();
    part(this.flute, cyl(0.01, 0.01, 0.12, 5), shiny('#e8e8e8'), 0, 0.06, 0);
    part(this.flute, cyl(0.05, 0.012, 0.14, 8), shiny('#f2d36b'), 0, 0.19, 0);
    this.flute.position.set(0, -0.78, 0.06);
    this.flute.rotation.x = 2.4;   // upright once the arm is raised for the toast
    this.arms[0].add(this.flute);
    this.bags = new THREE.Group();
    for (const [x, z, s] of [[-0.75, 0.35, 1], [0.8, 0.25, 0.85], [0.55, -0.55, 0.7]]) {
      const bag = part(this.bags, ball(0.3 * s, 10), flat('#c9a46a'), x, 0.28 * s, z);
      bag.scale.y = 1.15;
      part(this.bags, cyl(0.07 * s, 0.12 * s, 0.14 * s, 8), flat('#a57f45'), x, 0.62 * s, z);
      part(this.bags, box(0.16 * s, 0.2 * s, 0.02), flat('#2f5a2a'), x, 0.3 * s, z + 0.29 * s);   // a green label
    }
    f.add(this.bags);
    // head: jowls, chins, mustache, grey fringe
    this.head = new THREE.Group();
    f.add(this.head);
    part(this.head, ball(0.27, 12), this.skin);
    this.chin = part(this.head, ball(0.2, 10), this.skin, 0, -0.2, 0.05);
    part(this.head, box(0.07, 0.07, 0.07), this.nose, 0, 0, 0.27);
    part(this.head, box(0.22, 0.05, 0.05), flat('#6a6a6a'), 0, -0.07, 0.25);
    this.fringe = new THREE.Group();
    this.head.add(this.fringe);
    for (const s of [-1, 1]) {
      this[s < 0 ? 'eyeL' : 'eyeR'] = part(this.head, box(0.05, 0.04, 0.02), this.eyeMat, s * 0.1, 0.07, 0.25);
      part(this.fringe, box(0.07, 0.12, 0.18), flat('#9a9a9a'), s * 0.25, 0.04, -0.02);
    }
    // a powdered wig instead of the fringe (Boom Stick Age): a white cap with rolled curls
    this.wig = new THREE.Group();
    const powder = flat('#f2efe8');
    part(this.wig, ball(0.29, 12), powder, 0, 0.04, -0.09);
    for (const s of [-1, 1]) for (const y of [0.02, -0.1]) part(this.wig, cyl(0.06, 0.06, 0.16, 8), powder, s * 0.26, y, -0.04).rotation.x = Math.PI / 2;
    part(this.wig, box(0.05, 0.12, 0.05), flat('#151515'), 0, -0.14, -0.36);   // the ribbon on his queue
    this.head.add(this.wig);
    // crosses for eyes, once he's dead
    this.xEyes = new THREE.Group();
    for (const s of [-1, 1]) for (const a of [-0.8, 0.8]) part(this.xEyes, box(0.1, 0.022, 0.02), flat('#151515'), s * 0.1, 0.07, 0.262).rotation.z = a;
    this.xEyes.visible = false;
    this.head.add(this.xEyes);
    // the hat slot: one hat per age (OUTFITS hat) plus the hard hat for when the sky falls. The
    // slot is what flies off when he dies, so whichever hat he has on goes with it.
    this.hat = new THREE.Group();
    this.hat.position.y = 0.22;
    this.head.add(this.hat);
    const hats = this.hats = {};
    const hat = (name, ...parts) => {
      const g = new THREE.Group();
      for (const [geo, material, x, y, z, rx = 0] of parts) part(g, geo, material, x, y, z).rotation.x = rx;
      this.hat.add(g);
      hats[name] = g;
      return g;
    };
    const furMat = new THREE.MeshLambertMaterial({ map: peltTexture(0), flatShading: true });
    hat('fur', [cyl(0.29, 0.31, 0.26, 14), furMat, 0, 0.06, 0]);
    hat('feather', [cyl(0.05, 0.3, 0.26, 10), flat('#2f4a22'), 0, 0.08, 0, -0.15], [box(0.03, 0.03, 0.42), flat('#c8323c'), 0.16, 0.2, -0.12, -0.6]);
    const laurel = hat('laurel', [ring(0.285, 0.025), shiny(GOLD), 0, -0.1, 0, Math.PI / 2]);
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * Math.PI * 2;
      const leaf = part(laurel, box(0.1, 0.025, 0.05), shiny(GOLD), Math.sin(a) * 0.29, -0.08, Math.cos(a) * 0.29);
      leaf.rotation.set(0.5, a, 0.4);
    }
    hat('tricorn', [cyl(0.44, 0.44, 0.04, 3), shiny(GOLD), 0, -0.02, 0], [cyl(0.42, 0.42, 0.1, 3), flat('#101012'), 0, 0.03, 0], [cyl(0.22, 0.26, 0.2, 12), flat('#101012'), 0, 0.14, 0]);
    hat('tophat', [cyl(0.42, 0.42, 0.04, 16), flat('#101012'), 0, 0, 0], [cyl(0.25, 0.27, 0.5, 16), flat('#101012'), 0, 0.27, 0], [cyl(0.272, 0.272, 0.08, 16), flat('#7a1018'), 0, 0.07, 0]);
    hat('visor', [new THREE.CylinderGeometry(0.29, 0.29, 0.08, 20, 1, true), this.glow, 0, -0.15, 0], [ball(0.04, 6), this.glow, 0, 0.1, 0]);
    hat('hardhat', [new THREE.SphereGeometry(0.31, 14, 8, 0, Math.PI * 2, 0, Math.PI / 2), flat('#ffc21a'), 0, -0.05, 0],
      [cyl(0.38, 0.38, 0.03, 16), flat('#ffc21a'), 0, -0.05, 0], [box(0.06, 0.06, 0.6), flat('#e0a810'), 0, 0.24, 0]);
    // gear for the end of the world: [DISASTERS key, piece]. He's ready for anything; it never helps.
    const gear = this.gear = [];
    const mask = new THREE.Group();
    gear.push(['volcano', mask]);
    const rubber = flat('#3a3f3a');
    part(mask, cyl(0.07, 0.1, 0.16, 10), rubber, 0, -0.09, 0.31).rotation.x = Math.PI / 2;
    for (const s of [-1, 1]) {
      part(mask, cyl(0.05, 0.05, 0.08, 8), flat('#6b6f60'), s * 0.13, -0.14, 0.27).rotation.set(Math.PI / 2, 0, s * 0.6);
      part(mask, cyl(0.065, 0.065, 0.03, 12), flat('#20262e'), s * 0.1, 0.07, 0.27).rotation.x = Math.PI / 2;
    }
    part(mask, ring(0.275, 0.018), rubber, 0, 0.06, 0).rotation.x = Math.PI / 2;
    this.head.add(mask);
    const muffs = new THREE.Group();
    for (const s of [-1, 1]) part(muffs, ball(0.09, 8), flat('#f2f2f2'), s * 0.28, 0.04, 0);
    part(muffs, ring(0.28, 0.02, Math.PI), flat('#c8323c'), 0, 0.04, 0);
    this.head.add(muffs);
    // the scarf wraps the top of the belly (his collar), with its end hanging down the front
    const scarf = new THREE.Group();
    part(scarf, ring(0.24, 0.075), flat('#c8323c'), 0, 0.34, 0).rotation.x = Math.PI / 2;
    part(scarf, box(0.11, 0.34, 0.05), flat('#c8323c'), 0.16, 0.16, 0.37).rotation.z = 0.15;
    this.body.add(scarf);
    gear.push(['freeze', muffs], ['freeze', scarf]);
    // a swim ring round the belly, red and white
    const floatie = new THREE.Group();
    gear.push(['flood', floatie]);
    for (let i = 0; i < 8; i++) {
      part(floatie, new THREE.TorusGeometry(0.44, 0.1, 8, 6, Math.PI / 4), flat(i % 2 ? '#f4f1ea' : '#ff5a3c'), 0, 0, 0).rotation.z = (i * Math.PI) / 4;
    }
    floatie.rotation.x = Math.PI / 2;
    floatie.position.y = -0.08;
    this.body.add(floatie);
    // monocle on its little chain
    this.monocle = new THREE.Group();
    part(this.monocle, new THREE.TorusGeometry(0.075, 0.012, 6, 16), shiny(GOLD), 0.1, 0.07, 0.27);
    part(this.monocle, cyl(0.005, 0.005, 0.32, 4), shiny(GOLD), 0.17, -0.1, 0.24).rotation.z = 0.35;
    this.head.add(this.monocle);
    // cigar with a glowing tip
    this.cigar = new THREE.Group();
    part(this.cigar, cyl(0.025, 0.025, 0.26, 6), flat('#6b4423'), 0.06, -0.12, 0.36).rotation.x = Math.PI / 2 - 0.2;
    this.cigarTip = part(this.cigar, ball(0.03, 6), new THREE.MeshBasicMaterial({ color: '#ff6a1f' }), 0.06, -0.09, 0.49);
    this.head.add(this.cigar);
    // heavy gold chains and a medallion
    this.chains = new THREE.Group();
    for (const [r, y] of [[0.3, 0.32], [0.36, 0.22]]) part(this.chains, new THREE.TorusGeometry(r, 0.035, 6, 20), shiny(GOLD), 0, y, 0.08).rotation.x = Math.PI / 2 - 0.5;
    part(this.chains, cyl(0.09, 0.09, 0.03, 14), shiny(GOLD), 0, 0.02, 0.43).rotation.x = Math.PI / 2;
    this.body.add(this.chains);

    // the gold pile: coins heaped round the podium, more of them as the profits come in
    const coinGeo = cyl(0.17, 0.17, 0.05, 10);
    this.coins = new THREE.InstancedMesh(coinGeo, shiny(GOLD), 160);
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler();
    for (let i = 0; i < 160; i++) {
      // a spiral heap on the dais around his feet: later coins further out, the middle piled higher
      const a = i * 2.39996, r = 0.55 + Math.sqrt(i / 160) * 0.8, y = 0.02 + (1 - (r - 0.55) / 0.8) * 0.3 + (i % 7) * 0.015;
      q.setFromEuler(e.set((Math.random() - 0.5) * 0.6, Math.random() * 3, (Math.random() - 0.5) * 0.6));
      m.compose(new THREE.Vector3(Math.cos(a) * r, y, Math.sin(a) * r), q, new THREE.Vector3(1, 1, 1));
      this.coins.setMatrixAt(i, m);
    }
    this.coins.count = 0;
    this.root.add(this.coins);
    // the ones that burst out of him when he dies (they move, so no culling by a stale bound)
    this.spill = new THREE.InstancedMesh(coinGeo, shiny(GOLD), SPILL_MAX);
    this.spill.count = 0;
    this.spill.frustumCulled = false;
    this.spilled = [];
    this.root.add(this.spill);

    // the sign over his head
    this.signCanvas = document.createElement('canvas');
    this.signCanvas.width = 360;
    this.signCanvas.height = 96;
    this.signTex = new THREE.CanvasTexture(this.signCanvas);
    this.signTex.colorSpace = THREE.SRGBColorSpace;
    this.sign = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.signTex, depthWrite: false }));
    this.sign.scale.set(3.6, 0.96, 1);
    this.sign.renderOrder = 10;
    this.root.add(this.sign);
    this.drawSign(0);
  }

  drawSign(profit, dead = false) {
    const g = this.signCanvas.getContext('2d');
    g.clearRect(0, 0, 360, 96);
    g.textAlign = 'center';
    g.lineJoin = 'round';
    g.lineWidth = 6;
    g.strokeStyle = 'rgba(20,12,6,0.9)';
    g.font = '30px "Luckiest Guy", Impact, sans-serif';
    g.fillStyle = '#ffd34d';
    const title = dead ? 'R.I.P. THE BUSINESSMAN' : 'THE BUSINESSMAN';
    g.strokeText(title, 180, 36, 350);
    g.fillText(title, 180, 36, 350);
    g.font = '24px "Luckiest Guy", Impact, sans-serif';
    g.fillStyle = '#f3e7c8';
    const line = `${dead ? 'BURIED WITH' : 'PROFIT:'} ${profit.toLocaleString('en-US')} SHINY ROCKS`;
    g.strokeText(line, 180, 76, 350);
    g.fillText(line, 180, 76, 350);
    this.signTex.needsUpdate = true;
  }

  // fat 0..1 from the ages and the bonks; profit for the sign and the coin heap
  setFat(fat, profit = 0) {
    if (this.dead) return;   // he's done growing
    this.fatTarget = Math.max(0, Math.min(1, fat));
    if (profit !== this.profit) {
      this.profit = profit;
      this.drawSign(profit);
      this.coins.count = Math.min(160, Math.round(profit / 15));
    }
  }

  // What he looks like right now. era: ERAS id (his clothes). disaster: DISASTERS key while the
  // world is ending (his gear). party: the tribe got wiped (co-op). skin: the watching player's
  // skin color. A dead man keeps what he died in; only the skin follows whoever is watching.
  setLook({ era = 'gun', disaster = null, party = false, skin = null }) {
    if (skin && skin !== this.skinHex) {
      this.skinHex = skin;
      this.skin.color.set(skin);
      this.nose.color.set(skin).multiplyScalar(0.88);
    }
    if (this.dead) return;
    if (!OUTFITS[era]) era = 'gun';
    if (era === this.era && disaster === this.disaster && party === this.party) return;
    if (this.era && era !== this.era) this.twirlT = 0;   // a quick change of clothes
    Object.assign(this, { era, disaster, party });
    this.shown = -1;   // dress him again next update
  }

  // Put on this age's clothes, the trimmings his profits have bought and any disaster gear.
  dress(stage) {
    const f = this.fat, st = MAMMON.stages, o = OUTFITS[this.era], doom = this.disaster;
    const gold = f >= st.gold;
    this.shown = stage;
    this.watch.visible = f >= st.watch;
    this.chains.visible = f >= st.chains;
    // the gas mask leaves no room for a monocle or a cigar
    this.monocle.visible = f >= st.monocle && doom !== 'volcano';
    this.cigar.visible = f >= st.cigar && doom !== 'volcano';
    this.bags.visible = f >= st.bags;
    for (const [k, g] of Object.entries(this.carry)) g.visible = f < st.bags && k === o.carry;
    // the age's hat once he can afford one; a hard hat when rocks fall from the sky
    const hat = doom === 'meteor' ? 'hardhat' : f >= st.hat ? o.hat : null;
    for (const [k, g] of Object.entries(this.hats)) g.visible = k === hat;
    this.hatOn = !!hat;
    for (const [k, g] of this.gear) g.visible = k === doom;
    this.flute.visible = this.party;
    // clothes: the suit turns to solid gold at the very end, whatever the age
    const pelt = !gold && o.suit === 'pelt' ? peltTexture(0) : null;
    if (this.suit.map !== pelt) { this.suit.map = pelt; this.suit.needsUpdate = true; }
    this.suit.color.set(gold ? GOLD : pelt ? '#ffffff' : o.suit);
    for (const m of this.legMeshes) m.material = o.legs === 'skin' ? this.skin : this.pants;
    if (o.legs !== 'skin') this.pants.color.set(o.legs);
    this.shirtMesh.visible = !!o.shirt;
    if (o.shirt) this.shirt.color.set(o.shirt);
    this.tie.visible = !!o.tie;
    this.tie.material = o.tie === 'glow' ? this.glow : this.tieMat;
    this.tieMat.color.set(o.tie === 'cravat' ? SHIRT : o.tie === 'glow' || !o.tie ? TIE : o.tie);
    // a cravat is a short frilly bunch at the throat, not a long tie
    this.tie.scale.set(o.tie === 'cravat' ? 2 : 1, o.tie === 'cravat' ? 0.35 : 1, 1);
    this.tie.position.y = o.tie === 'cravat' ? 0.28 : 0.08;
    this.sash.visible = !!o.sash;
    if (o.sash) this.sashMat.color.set(o.sash);
    this.wig.visible = !!o.wig;
    this.fringe.visible = !o.wig;
    for (const eye of [this.eyeL, this.eyeR]) eye.material = gold ? this.redEye : this.eyeMat;
  }

  laugh() { this.laughT = 0; }

  // where his head is, for speech bubbles (world space)
  headPosition(target = new THREE.Vector3()) {
    this.head.updateWorldMatrix(true, false);
    return this.head.getWorldPosition(target);
  }

  // The end of the world got him. instant: it happened a while ago (joined late), so he's just
  // lying there with his coins all over the place.
  die(instant = false) {
    if (this.dead) return;
    this.dead = true;
    this.deathT = 0;
    this.landed = false;
    this.laughT = -1;
    this.twirlT = -1;
    this.head.rotation.x = 0;
    this.fig.position.set(0, 0, 0);
    this.fig.rotation.y = 0;
    this.arms0 = this.arms.map(a => a.rotation.clone());   // where the arms were, to fling them up from
    this.slide = this.lyingSlide();
    this.eyeL.visible = this.eyeR.visible = false;
    this.xEyes.visible = true;
    this.drawSign(Math.max(0, this.profit || 0), true);
    // the top hat comes off and flies
    this.hatVel = null;
    if (this.hatOn) {
      this.hat.updateWorldMatrix(true, false);
      this.root.attach(this.hat);   // stays where it is, but loose now
      this.hatVel = new THREE.Vector3((Math.random() - 0.5) * 1.5, 5.5, -2.4);
      this.hatSpin = new THREE.Vector3(6, 1.5, 3);
    }
    if (instant) {
      this.quiet = true;
      for (let i = 0; i < 150; i++) this.update(1 / 30);
      this.quiet = false;
    }
  }

  // A new world: a new Businessman, thin again, with his hat on.
  revive() {
    if (!this.dead) return;
    this.dead = false;
    this.fig.rotation.set(0, 0, 0);
    this.fig.position.set(0, 0, 0);
    for (const leg of this.legs) { leg.rotation.set(0, 0, 0); leg.position.y = leg.position.z = 0; }
    this.head.add(this.hat);
    this.hat.position.set(0, 0.22, 0);
    this.hat.rotation.set(0, 0, 0);
    this.hat.scale.set(1, 1, 1);
    this.hatVel = null;
    this.eyeL.visible = this.eyeR.visible = true;
    this.xEyes.visible = false;
    this.spill.count = 0;
    this.spilled = [];
    this.spillMoving = false;
    this.fat = 0.05;
    this.shown = -1;     // trimmings and suit back as his size says
    this.profit = -1;    // and his sign
    // dressed for the new world on the next setLook, without a twirl
    Object.assign(this, { era: null, disaster: null, party: false });
  }

  // How low he reaches (relative to his feet's starting height) when tipped back by theta: the
  // bottom of his round belly or of his head, whichever is lower. Height of a point (y, z) of his
  // figure tipped by theta about x is y cos(theta) - z sin(theta).
  lowAt(theta) {
    const c = Math.cos(theta), s = Math.sin(theta);
    const by = 0.42 * this.body.scale.y, bz = 0.42 * this.body.scale.z;
    // straight down in his own frame is (0, -c, s); the belly's lowest point that way
    const uy = -c, uz = s;
    const k = Math.hypot(by * uy, bz * uz) || 1;
    const py = this.body.position.y + (by * by * uy) / k, pz = (bz * bz * uz) / k;
    const belly = c * py - s * pz;
    const head = c * this.head.position.y - s * this.head.position.z - 0.27 * this.head.scale.y;
    return Math.min(belly, head);
  }

  // Where he ends up lying: tipped back past flat until his head comes down to the dais too
  // (fat men don't lie flat), and slid so he lies across the middle of it rather than off the back.
  lyingSlide() {
    const by = 0.42 * this.body.scale.y, bz = 0.42 * this.body.scale.z;
    this.lieAt = -Math.PI / 2;
    for (let tilt = 0; tilt <= 1.2; tilt += 0.01) {
      const theta = -Math.PI / 2 - tilt;
      const c = Math.cos(theta), s = Math.sin(theta);
      const k = Math.hypot(by * -c, bz * s) || 1;
      const belly = c * (this.body.position.y + (by * by * -c) / k) - s * ((bz * bz * s) / k);
      const head = c * this.head.position.y - s * this.head.position.z - 0.27 * this.head.scale.y;
      this.lieAt = theta;
      if (head <= belly) break;
    }
    // how far he reaches along the ground (z = y sin + z cos), from the top of his head to his
    // belly or hips at the other end; slide that span onto the middle of the dais
    const s = Math.sin(this.lieAt), c = Math.cos(this.lieAt);
    const bellyZ = s * this.body.position.y, bellyHalf = Math.hypot(by * s, bz * c);
    const headZ = s * this.head.position.y + c * this.head.position.z - 0.27 * this.head.scale.y;
    const back = Math.min(bellyZ - bellyHalf, headZ), front = Math.max(bellyZ + bellyHalf, s * 0.95 + 0.2);
    return -(back + front) / 2;
  }

  updateDead(dt) {
    this.deathT += dt;
    const T = this.deathT;
    const k = Math.min(1, Math.max(0, (T - SHOCK) / FALL));
    const ease = k * k;   // goes over slowly, then fast
    let theta = this.lieAt * ease;
    if (T > SHOCK + FALL) {
      // the belly rocks a few times after he lands
      const w = T - SHOCK - FALL;
      theta += Math.sin(w * 13) * 0.1 * Math.exp(-w * 3.2);
      if (!this.landed) {
        this.landed = true;
        this.spillCoins();
        if (!this.quiet) this.onLand?.();
      }
    }
    this.fig.rotation.x = theta;
    // never through the dais: lifted as far as his belly needs as he rolls back onto it
    this.fig.position.set(0, Math.max(0, -this.lowAt(theta)), this.slide * ease);
    if (T < SHOCK) {
      // the jolt: a hop and a shiver
      this.fig.position.y += Math.sin((T / SHOCK) * Math.PI) * 0.22;
      this.fig.position.x = Math.sin(T * 70) * 0.03;
    }
    // arms flung up at the sky and kept there; legs swing up as he goes over (dead-bug style)
    const sky = Math.PI - theta;   // tipping an arm or leg by this points it straight up
    const fling = Math.min(1, T / 0.22);
    const twitch = T > SHOCK + FALL ? Math.sin(T * 9) * 0.06 * Math.exp(-(T - SHOCK - FALL)) : 0;
    this.arms.forEach((arm, i) => {
      const s = i ? 1 : -1, r0 = this.arms0[i];
      arm.rotation.set(r0.x + (sky + twitch - r0.x) * fling, 0, r0.z + (s * 0.65 - r0.z) * fling);
    });
    this.legs.forEach((leg, i) => {
      const s = i ? 1 : -1;
      leg.rotation.set(sky * ease + twitch, 0, s * 0.22 * ease);
      // turn about the hip, not the foot: put the foot where the hip stays at (x, 0.95, 0)
      _v.set(0, 0.95, 0).applyEuler(leg.rotation);
      leg.position.y = 0.95 - _v.y;
      leg.position.z = -_v.z;
      leg.position.x = s * (0.17 + this.fat * 0.32) - _v.x;
    });
    this.stepHat(dt);
    this.stepCoins(dt);
  }

  // The money comes out of him (and out of the bags, which burst): a fountain of gold.
  spillCoins() {
    this.root.updateWorldMatrix(true, true);
    const belly = this.root.worldToLocal(this.body.getWorldPosition(new THREE.Vector3()));
    const bags = [];
    if (this.bags.visible) {
      for (let i = 0; i < this.bags.children.length; i += 3) bags.push(this.root.worldToLocal(this.bags.children[i].getWorldPosition(new THREE.Vector3())));
      this.bags.visible = false;
    }
    const n = Math.min(SPILL_MAX, 60 + Math.round(Math.max(0, this.profit || 0) / 12));
    this.spilled = [];
    for (let i = 0; i < n; i++) {
      const fromBag = bags.length && i % 3 === 2;
      const p = (fromBag ? bags[i % bags.length] : belly).clone();
      p.x += (Math.random() - 0.5) * 0.5;
      p.y += Math.random() * 0.4;
      p.z += (Math.random() - 0.5) * 0.5;
      const a = Math.random() * Math.PI * 2, out = (fromBag ? 1 : 1.6) + Math.random() * 3.4;
      this.spilled.push({
        p, rest: false,
        v: new THREE.Vector3(Math.cos(a) * out, (fromBag ? 2 : 3.5) + Math.random() * 4.5, Math.sin(a) * out),
        q: new THREE.Quaternion().random(),
        spin: new THREE.Vector3().randomDirection().multiplyScalar(6 + Math.random() * 12),
      });
    }
    this.spill.count = n;
    this.spillMoving = true;
  }

  // Coins fly, bounce down the steps, and lie flat where they stop.
  stepCoins(dt) {
    if (!this.spillMoving) return;
    let moving = false;
    this.spilled.forEach((c, i) => {
      if (!c.rest) {
        moving = true;
        c.v.y -= GRAVITY * dt;
        c.p.addScaledVector(c.v, dt);
        c.q.premultiply(_q.setFromAxisAngle(_axis.copy(c.spin).normalize(), c.spin.length() * dt));
        const floor = floorAt(c.p.x, c.p.z) + 0.03;
        if (c.p.y < floor) {
          c.p.y = floor;
          if (c.v.y < -2.2) {
            c.v.y *= -0.32;
            c.v.x *= 0.55;
            c.v.z *= 0.55;
            c.spin.multiplyScalar(0.6);
          } else {
            c.rest = true;
            c.q.setFromEuler(_e.set((Math.random() - 0.5) * 0.25, Math.random() * Math.PI * 2, (Math.random() - 0.5) * 0.25));
          }
        }
      }
      this.spill.setMatrixAt(i, _m.compose(c.p, c.q, ONE));
    });
    this.spill.instanceMatrix.needsUpdate = true;
    this.spillMoving = moving;
  }

  // The hat tumbles off behind him and lands the right way up.
  stepHat(dt) {
    const v = this.hatVel;
    if (!v) return;
    const h = this.hat;
    v.y -= GRAVITY * dt;
    h.position.addScaledVector(v, dt);
    h.rotation.x += this.hatSpin.x * dt;
    h.rotation.y += this.hatSpin.y * dt;
    h.rotation.z += this.hatSpin.z * dt;
    const floor = floorAt(h.position.x, h.position.z) + 0.02;
    if (h.position.y < floor && v.y < 0) {
      h.position.y = floor;
      if (v.y < -3) {
        v.set(v.x * 0.5, -v.y * 0.3, v.z * 0.5);
        this.hatSpin.multiplyScalar(0.4);
      } else {
        h.rotation.set(0.12, h.rotation.y, -0.08);
        this.hatVel = null;
      }
    }
  }

  // look: world position to turn towards (the local caveman), or null
  update(dt, look) {
    this.t += dt;
    if (this.dead) { this.updateDead(dt); return; }
    // grow towards where the profits say he should be, slowly (he's eating)
    this.fat += (this.fatTarget - this.fat) * Math.min(1, dt * 0.8);
    const f = this.fat;
    const stage = Object.values(MAMMON.stages).filter(v => f >= v).length;
    if (stage !== this.shown && this.era) this.dress(stage);
    // the shape: belly out and down, shoulders apart, chins, legs braced under the weight
    const breathe = 1 + Math.sin(this.t * 1.6) * 0.02;
    this.body.scale.set((1 + f * 2.1) * breathe, 1 + f * 0.7, (1 + f * 2.3) * breathe);
    this.body.position.y = 1.35 + f * 0.25;
    // arms hang down the sides of the belly, tilted out round it, swinging a little as he rubs
    // his hands; they get longer as he swells so they still reach past it
    const belly = 0.42 * (1 + f * 2.1);
    const swing = Math.sin(this.t * 5) * 0.1;
    for (const [i, s] of [[0, -1], [1, 1]]) {
      const arm = this.arms[i];
      arm.position.set(s * (0.3 + belly * 0.7), this.body.position.y + 0.25 + f * 0.35, 0.05);
      arm.scale.set(1 + f * 0.7, 1 + f * 0.45, 1 + f * 0.7);
      // celebrating: the champagne hand goes up in a toast
      const toast = this.party && !i;
      arm.rotation.set(toast ? -2.4 + Math.sin(this.t * 3) * 0.08 : -0.15 + (i ? swing : -swing), 0, s * (0.25 + f * 0.35));
    }
    // legs braced wider and thicker under the weight
    this.legs.forEach((leg, i) => {
      leg.position.x = (i ? 1 : -1) * (0.17 + f * 0.32);
      leg.scale.set(1 + f * 1.3, 1, 1 + f * 1.3);
    });
    this.head.position.set(0, 2.05 + f * 0.85, f * 0.3);
    this.head.scale.setScalar(1 + f * 0.35);
    this.chin.scale.set(1 + f * 1.4, 0.6 + f * 1.6, 1 + f * 0.8);
    this.chin.position.y = -0.2 - f * 0.08;
    this.sign.position.y = 3.1 + f * 1.6;
    // a big belly laugh: bounce, head thrown back
    let bounce = 0;
    if (this.laughT >= 0) {
      this.laughT += dt;
      const k = Math.max(0, 1 - this.laughT / 1.6);
      bounce = Math.abs(Math.sin(this.laughT * 18)) * 0.08 * k;
      this.head.rotation.x = -0.35 * k;
      if (k <= 0) this.laughT = -1;
    } else this.head.rotation.x = 0;
    this.fig.position.y = bounce;
    // new clothes: one quick spin round to show them off
    if (this.twirlT >= 0) {
      this.twirlT += dt;
      const k = Math.min(1, this.twirlT / TWIRL);
      this.fig.rotation.y = Math.PI * 2 * (k * k * (3 - 2 * k));
      if (k >= 1) { this.twirlT = -1; this.fig.rotation.y = 0; }
    }
    this.cigarTip.material.color.setHSL(0.06, 1, 0.45 + Math.sin(this.t * 3) * 0.12);
    // turn to watch you
    if (look) {
      const local = this.root.parent.worldToLocal(look.clone());
      const want = Math.atan2(local.x - this.root.position.x, local.z - this.root.position.z);
      let d = want - this.root.rotation.y;
      d = Math.atan2(Math.sin(d), Math.cos(d));
      this.root.rotation.y += d * Math.min(1, dt * 1.5);
    }
  }
}
