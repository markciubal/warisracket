import * as THREE from 'three';
import { SKINS, HAIRS, PLAYER, RANGED } from '/shared/constants.js';
import { mat, lambert, mergeChildren, shadows, damp, placeOnSphere } from './util.js';
import { peltTexture } from './textures.js';
import { buildWeapon, buildSpear, buildBow, buildQuiver, buildArmorParts, buildHeaddress, buildFirearm, buildSlingshot, buildProjectile } from './weapons.js';

const FIREARMS = ['musket', 'gun', 'laser', 'bazooka', 'crossbow'];
const THROWN = new Set(['spear', 'tomato']);   // overarm, from the hand; everything else is held out
const RECOIL = { musket: [0.45, 0.35], gun: [0.08, 0.1], laser: [0.06, 0.12], bazooka: [0.55, 0.5], crossbow: [0.12, 0.25] };   // [kick radians, seconds]

const capsule = (r, len, material) => new THREE.Mesh(new THREE.CapsuleGeometry(r, len, 4, 10), material);
const sphere = (r, material, w = 12, h = 10) => new THREE.Mesh(new THREE.SphereGeometry(r, w, h), material);
const ease = t => t * t * (3 - 2 * t);
const lerp = (a, b, t) => a + (b - a) * t;

// Loincloth with a ragged hem.
function jaggedSkirt(material) {
  const geo = new THREE.CylinderGeometry(0.37, 0.47, 0.34, 14, 1, true);
  const pos = geo.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    const row = Math.floor(i / 15), col = i % 15;
    if (row === 1 && col % 2 === 1) pos.setY(i, pos.getY(i) + 0.08);
  }
  geo.computeVertexNormals();
  return new THREE.Mesh(geo, material);
}

const tagCanvasFont = () => '28px "Luckiest Guy", Impact, sans-serif';

// Hats and capes from the tailor (CLOTHES). Hats sit on the head group: the skull's top is ~0.47.
function hatPart(g, geo, color, y, opts) {
  const m = new THREE.Mesh(geo, mat(color, opts));
  m.position.y = y;
  g.add(m);
  return m;
}
const HATS = {
  straw() {
    const g = new THREE.Group();
    hatPart(g, new THREE.CylinderGeometry(0.46, 0.48, 0.03, 16), '#e2c477', 0.43, { flatShading: true });
    hatPart(g, new THREE.CylinderGeometry(0.19, 0.23, 0.2, 12), '#d9b45a', 0.53, { flatShading: true });
    hatPart(g, new THREE.CylinderGeometry(0.235, 0.235, 0.05, 12), '#c8312a', 0.46);
    return g;
  },
  flowers() {
    const g = new THREE.Group();
    hatPart(g, new THREE.TorusGeometry(0.25, 0.035, 5, 16), '#4f8f2f', 0.43).rotation.x = Math.PI / 2;
    ['#ff5a8a', '#ffd23d', '#ffffff', '#c47cff', '#ff9a3d', '#ff5a5a', '#8fd3ff'].forEach((c, i) => {
      const a = (i / 7) * Math.PI * 2;
      hatPart(g, new THREE.IcosahedronGeometry(0.06, 0), c, 0.45, { flatShading: true }).position.set(Math.cos(a) * 0.25, 0.45, Math.sin(a) * 0.25);
    });
    return g;
  },
  tophat() {
    const g = new THREE.Group();
    hatPart(g, new THREE.CylinderGeometry(0.34, 0.34, 0.03, 16), '#1d1b22', 0.44);
    hatPart(g, new THREE.CylinderGeometry(0.2, 0.19, 0.42, 14), '#1d1b22', 0.66);
    hatPart(g, new THREE.CylinderGeometry(0.205, 0.2, 0.07, 14), '#a8201a', 0.49);
    return g;
  },
  crown() {
    const g = new THREE.Group();
    const gold = { metalness: 0.8, roughness: 0.3 };
    hatPart(g, new THREE.CylinderGeometry(0.25, 0.24, 0.13, 14, 1, true), '#e8b931', 0.48, { ...gold, side: THREE.DoubleSide });
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2;
      hatPart(g, new THREE.ConeGeometry(0.05, 0.14, 4), '#e8b931', 0.6, gold).position.set(Math.cos(a) * 0.24, 0.6, Math.sin(a) * 0.24);
      if (i % 2 === 0) hatPart(g, new THREE.OctahedronGeometry(0.035, 0), '#d6304a', 0.48).position.set(Math.cos(a) * 0.255, 0.48, Math.sin(a) * 0.255);
    }
    return g;
  },
};
// (not for sale: what the kind strangers of the peace wear, with a 'cloak')
HATS.hood = () => {
  const g = new THREE.Group();
  const hood = hatPart(g, new THREE.SphereGeometry(0.36, 14, 9, Math.PI / 2 + 0.95, Math.PI * 2 - 1.9, 0, Math.PI * 0.64), '#6b4a2e', 0.18, { side: THREE.DoubleSide, flatShading: true });
  hood.scale.set(1, 1.12, 1.05);
  return g;
};
const HAT_HEIGHT = { straw: 0.14, flowers: 0.02, tophat: 0.42, crown: 0.14, hood: 0.14 };
const CAPES = { redcape: '#c8312a', bluecape: '#2f6fd1', goldcape: '#e8b931', cloak: '#6b4a2e' };
const allTags = new Set();
export function redrawAllTags() { for (const c of allTags) c.drawTag(); }

export class Caveman {
  // lifeBar: false for a name tag without the life bar (the strangers of the peace)
  constructor({ name, look, isLocal = false, bot = false, lifeBar = true }) {
    this.name = name;
    this.look = look;
    this.isLocal = isLocal;
    this.bot = bot;
    this.lifeBar = lifeBar;
    this.hp = PLAYER.maxHp;
    this.time = Math.random() * 10;
    this.phase = 0;
    this.walk = 0;
    this.swingT = -1;
    this.swingWind = 0.2;
    this.throwT = -1;
    this.emoteT = -1;
    this.hurtT = 0;
    this.dead = false;
    this.deadT = 0;
    this.ammo = RANGED.spear.ammo;
    this.ranged = 'spear';
    this.armor = null;
    this.armorParts = null;
    this.hatMesh = null;
    this.capeMesh = null;
    this.build();
    this.setOutfit(this.look);
  }

  build() {
    const look = this.look;
    const skin = SKINS[look.skin] || SKINS[0];
    const hairColor = HAIRS[look.hair] || HAIRS[0];
    this.skinMat = lambert({ color: skin });
    const browMat = this.browMat = lambert({ color: new THREE.Color(skin).multiplyScalar(0.82) });
    const pelt = this.peltMat = lambert({ map: peltTexture(look.garb), side: THREE.DoubleSide });
    const hair = mat(hairColor, { flatShading: true });
    const leather = mat('#4e301a');

    this.root = new THREE.Group();
    this.body = new THREE.Group();
    this.body.scale.setScalar(look.size || 1);
    this.setLefty(look.lefty);
    this.root.add(this.body);

    const hips = new THREE.Group();
    hips.position.y = 0.85;
    this.body.add(hips);

    // legs
    const makeLeg = side => {
      const leg = new THREE.Group();
      leg.position.x = side * 0.16;
      const thigh = capsule(0.11, 0.24, this.skinMat);
      thigh.position.y = -0.2;
      const knee = new THREE.Group();
      knee.position.y = -0.4;
      const shin = capsule(0.1, 0.22, this.skinMat);
      shin.position.y = -0.19;
      const wrap = new THREE.Mesh(new THREE.CylinderGeometry(0.13, 0.14, 0.2, 10), pelt);
      wrap.position.y = -0.24;
      const foot = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.1, 0.32), this.skinMat);
      foot.position.set(0, -0.35, 0.06);
      knee.add(shin, wrap, foot);
      leg.add(thigh, knee);
      hips.add(leg);
      return { leg, knee };
    };
    const L = makeLeg(1), Rt = makeLeg(-1);
    this.legL = L.leg; this.kneeL = L.knee;
    this.legR = Rt.leg; this.kneeR = Rt.knee;

    // torso
    this.torso = new THREE.Group();
    hips.add(this.torso);
    const chest = capsule(0.3, 0.38, this.skinMat);
    chest.position.y = 0.4;
    chest.scale.set(1.12, 1, 0.85);
    const tunic = new THREE.Mesh(new THREE.CylinderGeometry(0.31, 0.36, 0.44, 14, 1, true), pelt);
    tunic.position.y = 0.3;
    tunic.scale.z = 0.88;
    const skirt = jaggedSkirt(pelt);
    skirt.position.y = -0.05;
    skirt.scale.z = 0.9;
    const strap = new THREE.Mesh(new THREE.BoxGeometry(0.13, 0.62, 0.06), pelt);
    strap.position.set(0.06, 0.6, 0.24);
    strap.rotation.set(-0.15, 0, 0.62);
    const strapBack = strap.clone();
    strapBack.position.z = -0.24;
    strapBack.rotation.x = 0.15;
    const belt = new THREE.Mesh(new THREE.TorusGeometry(0.36, 0.035, 6, 18), leather);
    belt.position.y = 0.1;
    belt.rotation.x = Math.PI / 2;
    belt.scale.y = 0.9;
    const shoulderPad = sphere(0.17, pelt);
    shoulderPad.position.set(0.3, 0.68, 0);
    shoulderPad.scale.set(1, 0.7, 1);
    this.torso.add(chest, tunic, skirt, strap, strapBack, belt, shoulderPad);

    // tooth necklace
    for (let i = 0; i < 7; i++) {
      const a = Math.PI * (0.15 + (i / 6) * 0.7);
      const tooth = new THREE.Mesh(new THREE.ConeGeometry(0.025, 0.09, 4), mat('#fff8e6'));
      tooth.position.set(Math.cos(a) * 0.19, 0.74, Math.sin(a) * 0.17 + 0.05);
      tooth.rotation.x = Math.PI;
      this.torso.add(tooth);
    }

    // spears carried on the back (ammo beyond the one in hand)
    this.backSpears = [];
    for (let i = 0; i < RANGED.spear.ammo - 1; i++) {
      const s = buildSpear();
      s.scale.setScalar(0.85);
      s.position.set(0.1 - i * 0.16, 1.45, -0.32);
      s.rotation.set(-Math.PI / 2 + 0.15, 0, 0.35 - i * 0.6);
      this.torso.add(s);
      this.backSpears.push(s);
    }

    // head
    this.head = new THREE.Group();
    this.head.position.y = 0.82;
    this.torso.add(this.head);
    const skull = sphere(0.27, this.skinMat, 14, 12);
    skull.position.y = 0.2;
    skull.scale.set(1, 1.05, 0.98);
    const jaw = sphere(0.21, this.skinMat);
    jaw.position.set(0, 0.07, 0.06);
    jaw.scale.set(1.15, 0.72, 1);
    const brow = new THREE.Mesh(new THREE.BoxGeometry(0.46, 0.09, 0.15), browMat);
    brow.position.set(0, 0.3, 0.17);
    const unibrow = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.055, 0.05), hair);
    unibrow.position.set(0, 0.345, 0.235);
    unibrow.rotation.z = (Math.random() - 0.5) * 0.15;
    const nose = sphere(0.075, browMat);
    nose.position.set(0, 0.17, 0.27);
    nose.scale.set(1.15, 0.9, 1);
    this.head.add(skull, jaw, brow, unibrow, nose);
    for (const side of [-1, 1]) {
      const eye = sphere(0.055, mat('#fbf7ee'), 8, 6);
      eye.position.set(side * 0.095, 0.245, 0.215);
      const pupil = sphere(0.028, mat('#151010'), 6, 5);
      pupil.position.set(side * 0.095, 0.245, 0.265);
      const ear = sphere(0.06, this.skinMat, 8, 6);
      ear.position.set(side * 0.27, 0.2, 0);
      ear.scale.z = 0.6;
      this.head.add(eye, pupil, ear);
    }
    const tufts = [[0.12, 0.42, -0.05, 0.14], [-0.12, 0.42, -0.04, 0.14], [0, 0.46, 0.06, 0.13],
      [0, 0.38, -0.18, 0.16], [0.2, 0.3, -0.12, 0.12], [-0.2, 0.3, -0.12, 0.12], [0, 0.22, -0.24, 0.13]];
    for (const [x, y, z, r] of tufts) {
      const t = new THREE.Mesh(new THREE.IcosahedronGeometry(r, 0), hair);
      t.position.set(x, y, z);
      t.rotation.set(Math.random() * 3, Math.random() * 3, 0);
      t.userData.mergeKey = 'tufts';   // merged on their own so helmets can hide them
      this.head.add(t);
    }
    if (look.beard) {
      const beard = new THREE.Mesh(new THREE.IcosahedronGeometry(0.2, 1), hair);
      beard.position.set(0, -0.02, 0.14);
      beard.scale.set(1.15, 1.25, 0.72);
      this.head.add(beard);
    }
    if (look.bone) {
      const b = new THREE.Group();
      b.add(new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.025, 0.4, 6), mat('#efe5cc')));
      for (const y of [-0.2, 0.2]) for (const x of [-0.03, 0.03]) {
        const k = sphere(0.04, mat('#efe5cc'), 6, 5);
        k.position.set(x, y, 0);
        b.add(k);
      }
      b.position.set(0, 0.5, 0);
      b.rotation.z = Math.PI / 2 + 0.3;
      mergeChildren(b);
      this.head.add(b);
    }

    // stun stars
    this.stars = new THREE.Group();
    this.stars.position.y = 0.72;
    for (let i = 0; i < 3; i++) {
      const s = new THREE.Mesh(new THREE.OctahedronGeometry(0.08, 0), mat('#ffe14d', { emissive: '#aa8800' }));
      const a = (i / 3) * Math.PI * 2;
      s.position.set(Math.cos(a) * 0.32, 0, Math.sin(a) * 0.32);
      this.stars.add(s);
    }
    this.stars.visible = false;
    this.head.add(this.stars);

    // arms
    const makeArm = side => {
      const shoulder = new THREE.Group();
      shoulder.position.set(side * 0.38, 0.66, 0);
      const upper = capsule(0.095, 0.2, this.skinMat);
      upper.position.y = -0.17;
      const elbow = new THREE.Group();
      elbow.position.y = -0.36;
      const fore = capsule(0.085, 0.18, this.skinMat);
      fore.position.y = -0.15;
      const hand = sphere(0.1, this.skinMat, 8, 6);
      hand.position.y = -0.32;
      const holder = new THREE.Group();
      holder.position.y = -0.32;
      elbow.add(fore, hand, holder);
      shoulder.add(upper, elbow);
      this.torso.add(shoulder);
      return { shoulder, elbow, holder };
    };
    const right = makeArm(-1), left = makeArm(1);
    this.armR = right.shoulder; this.elbowR = right.elbow; this.spearHolder = right.holder;
    this.armL = left.shoulder; this.elbowL = left.elbow; this.weaponHolder = left.holder;

    this.handSpear = buildSpear();
    this.handSpear.position.z = 0.95;
    this.spearHolder.add(this.handSpear);
    // bows and guns share the right hand; only the current age's one is shown
    this.handTomato = buildProjectile('tomato');
    this.handTomato.position.z = 0.16;
    this.handTomato.visible = false;
    this.spearHolder.add(this.handTomato);
    this.bows = { bow: buildBow('bow'), longbow: buildBow('longbow'), slingshot: buildSlingshot() };
    for (const k of FIREARMS) this.bows[k] = buildFirearm(k);
    for (const b of Object.values(this.bows)) { b.visible = false; this.spearHolder.add(b); }

    this.quiver = buildQuiver();
    this.quiver.position.set(0.12, 0.5, -0.33);
    this.quiver.rotation.set(-0.15, 0, 0.35);
    this.quiver.visible = false;
    this.torso.add(this.quiver);

    this.headdress = buildHeaddress();
    this.headdress.visible = false;
    this.head.add(this.headdress);

    // Each rigid body part becomes one mesh per material (about 60 meshes down to about 25).
    // Groups nested inside (joints, holders, headdress) are left alone.
    for (const part of [this.kneeL, this.kneeR, this.torso, this.elbowR, this.elbowL, this.stars]) mergeChildren(part);
    this.hairMesh = mergeChildren(this.head).tufts;

    shadows(this.body, true, false);
    for (const a of this.quiver.userData.arrows) a.castShadow = false;   // 8 slivers, not worth 8 shadow draws

    // name tag
    if (!this.isLocal) {
      this.tagCanvas = document.createElement('canvas');
      this.tagCanvas.width = 256;
      this.tagCanvas.height = 80;
      this.tagTex = new THREE.CanvasTexture(this.tagCanvas);
      this.tagTex.colorSpace = THREE.SRGBColorSpace;
      this.tag = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.tagTex, depthWrite: false }));
      this.tag.scale.set(2.2, 0.69, 1);
      this.tag.position.y = 2.65;
      this.tag.renderOrder = 10;
      this.root.add(this.tag);
      allTags.add(this);
      this.drawTag();
    }
  }

  drawTag() {
    if (!this.tagCanvas) return;
    const g = this.tagCanvas.getContext('2d');
    g.clearRect(0, 0, 256, 80);
    g.font = tagCanvasFont();
    g.textAlign = 'center';
    g.lineJoin = 'round';
    g.lineWidth = 6;
    g.strokeStyle = 'rgba(20,12,6,0.9)';
    g.fillStyle = this.team === 'ally' ? '#8dff9a' : this.team === 'foe' ? '#ff8a7a' : '#f3e7c8';
    const label = this.name.toUpperCase();
    g.strokeText(label, 128, 34, 248);
    g.fillText(label, 128, 34, 248);
    if (this.lifeBar) {
      const frac = Math.max(0, this.hp) / PLAYER.maxHp;
      g.fillStyle = 'rgba(20,12,6,0.85)';
      g.fillRect(38, 48, 180, 18);
      g.fillStyle = frac > 0.5 ? '#7fd34f' : frac > 0.25 ? '#ffc23d' : '#ff4b2e';
      g.fillRect(41, 51, 174 * frac, 12);
    }
    if (this.armor) {
      g.fillStyle = 'rgba(20,12,6,0.85)';
      g.fillRect(38, 67, 180, 10);
      g.fillStyle = '#8fc3ff';
      g.fillRect(41, 69, 174 * Math.max(0, this.armor.dur / this.armor.maxDur), 6);
    }
    this.tagTex.needsUpdate = true;
  }

  setHp(hp) {
    if (hp === this.hp) return;
    this.hp = hp;
    this.drawTag();
  }

  setWeapon(wpn) {
    if (this.weaponMesh) this.weaponHolder.remove(this.weaponMesh);
    this.weapon = wpn;
    this.weaponMesh = buildWeapon(wpn);
    this.weaponMesh.rotation.x = 1.45;
    this.weaponHolder.add(this.weaponMesh);
  }

  // 'spear' carries spears in hand and on the back; bows carry a quiver. null: nothing at all
  // (Ploughshares, in peace).
  setRanged(kind) {
    this.ranged = kind === null ? null : RANGED[kind] ? kind : 'spear';
    for (const [k, b] of Object.entries(this.bows)) b.visible = k === this.ranged;
    this.quiver.visible = this.ranged === 'bow' || this.ranged === 'longbow';
    this.setAmmo(this.ammo);
  }

  // World position of the gun barrel (or the hand, for spears and bows), for muzzle flashes.
  muzzlePosition(target) {
    const gun = this.bows[this.ranged];
    const ref = gun?.userData.muzzle || this.spearHolder;
    this.root.updateMatrixWorld(true);
    return ref.getWorldPosition(target);
  }

  setAmmo(n) {
    this.ammo = n;
    const spear = this.ranged === 'spear';
    this.handSpear.visible = spear && n > 0 && this.throwT < 0;
    this.handTomato.visible = this.ranged === 'tomato' && n > 0 && this.throwT < 0;
    this.backSpears.forEach((s, i) => { s.visible = spear && n - 1 > i; });
    this.quiver.userData.arrows.forEach((a, i) => { a.visible = this.quiver.visible && i < n; });
  }

  setArmor(armor) {
    if (this.armorParts) {
      for (const part of [this.armorParts.torso, this.armorParts.head]) {
        part.removeFromParent();
        part.traverse(o => { if (o.isMesh) o.geometry.dispose(); });
      }
    }
    this.armor = armor ? { ...armor } : null;
    this.armorParts = armor ? buildArmorParts(armor.type) : null;
    if (this.armorParts) {
      this.torso.add(this.armorParts.torso);
      this.head.add(this.armorParts.head);
    }
    if (this.hairMesh) this.hairMesh.visible = !armor;
    if (this.hatMesh) this.hatMesh.visible = !armor;   // a helmet goes on instead
    this.placeHeaddress();
    this.drawTag();
  }

  // The chief's feathers sit on top of whatever's on the head.
  placeHeaddress() {
    this.headdress.position.y = this.armor ? 0.1 : this.hatMesh ? HAT_HEIGHT[this.look.hat] || 0 : 0;
  }

  // Clothes from the tailor (look.hat, look.cape: CLOTHES keys, or null).
  setOutfit(look) {
    for (const k of ['hatMesh', 'capeMesh']) {
      if (!this[k]) continue;
      this[k].removeFromParent();
      this[k].traverse(o => { if (o.isMesh) o.geometry.dispose(); });
      this[k] = null;
    }
    this.look.hat = look.hat || null;
    this.look.cape = look.cape || null;
    if (HATS[this.look.hat]) {
      this.hatMesh = HATS[this.look.hat]();
      this.hatMesh.visible = !this.armor;
      this.head.add(shadows(this.hatMesh, true, false));
    }
    if (CAPES[this.look.cape]) {
      // a half-cylinder of cloth hanging off the shoulders, flaring out at the bottom
      const g = new THREE.Group();
      const cloth = mat(CAPES[this.look.cape], { side: THREE.DoubleSide });
      const cape = new THREE.Mesh(new THREE.CylinderGeometry(0.34, 0.52, 1.0, 12, 1, true, Math.PI * 0.62, Math.PI * 0.76), cloth);
      cape.position.y = 0.22;
      const collar = new THREE.Mesh(new THREE.TorusGeometry(0.2, 0.05, 5, 14), cloth);
      collar.position.y = 0.74;
      collar.rotation.x = Math.PI / 2;
      g.add(cape, collar);
      this.capeMesh = shadows(g, true, false);
      this.torso.add(this.capeMesh);
    }
    this.placeHeaddress();
  }

  setArmorDur(dur) {
    if (!this.armor || this.armor.dur === dur) return;
    this.armor.dur = dur;
    this.drawTag();
  }

  setChief(on) { this.headdress.visible = on; }

  // co-op: 'ally' (green name) or 'foe' (red name); null in the free-for-all modes
  setTeam(team) {
    if (team === this.team) return;
    this.team = team;
    this.drawTag();
  }

  place(p, f, h) { placeOnSphere(this.root, p, f, h); }

  playSwing(windup) { this.swingT = 0; this.swingWind = windup; }
  playThrow() { this.throwT = 0; this.handSpear.visible = this.handTomato.visible = false; }

  // Right-handed cavemen throw with the right hand and club with the left; left-handed ones are
  // the mirror image (the whole body, so every pose and swing mirrors with it). The name tag is
  // outside the body, so it doesn't come out backwards.
  setLefty(on) {
    const s = Math.abs(this.body.scale.y);
    this.body.scale.x = on ? -s : s;
    this.look.lefty = on ? 1 : 0;
  }
  playEmote() { this.emoteT = 0; }
  // round a bonfire (peace): bounce, sway, twist, arms up in turn, until told to stop
  setDancing(on) { this.dancing = !!on; }
  hurt() { this.hurtT = 0.2; }

  die() {
    this.dead = true;
    this.deadT = 0;
    if (this.tag) this.tag.visible = false;
  }

  revive() {
    this.dead = false;
    this.body.rotation.set(0, 0, 0);
    this.body.position.set(0, 0, 0);
    this.stars.visible = false;
    if (this.tag) this.tag.visible = !this.isLocal;
    this.setHp(PLAYER.maxHp);
  }

  // s: { speed, air, charging, stunned }
  update(dt, s) {
    this.time += dt;
    const t = this.time;

    if (this.hurtT > 0) {
      this.hurtT -= dt;
      this.skinMat.emissive.setRGB(Math.max(0, this.hurtT) * 4, 0, 0);
    }

    if (this.dead) {
      this.deadT += dt;
      const k = ease(Math.min(1, this.deadT / 0.45));
      this.body.rotation.x = -Math.PI / 2 * k;
      this.body.position.y = 0.3 * k;
      this.armL.rotation.set(-2.6 * k, 0, 0.4 * k);
      this.armR.rotation.set(-2.6 * k, 0, -0.4 * k);
      this.stars.visible = true;
      this.stars.rotation.y += dt * 4;
      return;
    }

    const moving = s.speed > 0.6;
    this.walk = damp(this.walk, moving ? 1 : 0, 10, dt);
    if (moving) this.phase += dt * (5 + s.speed * 0.9);
    const sw = Math.sin(this.phase) * this.walk;

    // legs
    if (s.air) {
      this.legL.rotation.x = damp(this.legL.rotation.x, -0.7, 14, dt);
      this.legR.rotation.x = damp(this.legR.rotation.x, -0.3, 14, dt);
      this.kneeL.rotation.x = damp(this.kneeL.rotation.x, 1.2, 14, dt);
      this.kneeR.rotation.x = damp(this.kneeR.rotation.x, 0.8, 14, dt);
    } else {
      this.legL.rotation.x = sw * 0.75;
      this.legR.rotation.x = -sw * 0.75;
      this.kneeL.rotation.x = Math.max(0, Math.sin(this.phase + 1.4)) * 1.0 * this.walk;
      this.kneeR.rotation.x = Math.max(0, Math.sin(this.phase + 1.4 + Math.PI)) * 1.0 * this.walk;
    }

    this.body.position.y = Math.abs(Math.sin(this.phase)) * 0.06 * this.walk;
    this.torso.rotation.x = 0.14 * this.walk + Math.sin(t * 2) * 0.015;
    this.torso.rotation.y = damp(this.torso.rotation.y, s.charging ? -0.35 : 0, 10, dt);
    this.head.rotation.x = -this.torso.rotation.x * 0.6;

    // right arm: spear overhead, or bow / gun held out front
    const bow = !THROWN.has(this.ranged);
    const firearm = FIREARMS.includes(this.ranged);
    let rBeta = -0.45 - sw * 0.5;
    let spearPhi = bow ? 0 : -1.3;
    if (this.throwT >= 0) {
      this.throwT += dt;
      if (firearm) {
        const [kick, dur] = RECOIL[this.ranged];
        rBeta = -1.55 - Math.sin(Math.min(1, this.throwT / dur) * Math.PI) * kick;
        spearPhi = -0.1 - Math.sin(Math.min(1, this.throwT / dur) * Math.PI) * kick;
        if (this.throwT > dur) this.throwT = -1;
      } else if (bow) {
        rBeta = -1.55 + Math.sin(Math.min(1, this.throwT / 0.25) * Math.PI) * 0.18;
        spearPhi = -0.15;
        if (this.throwT > 0.3) this.throwT = -1;
      } else {
        const k = Math.min(1, this.throwT / 0.16);
        rBeta = lerp(-3.5, -1.0, ease(k));
        spearPhi = -0.2;
        if (this.throwT > 0.45) {
          this.throwT = -1;
          this.setAmmo(this.ammo);
        }
      }
    } else if (s.charging) {
      rBeta = bow ? -1.55 + Math.sin(t * 30) * 0.015 : -3.5 + Math.sin(t * 30) * 0.03;
      spearPhi = bow ? -0.18 : -0.22;
    }
    const held = this.bows[this.ranged];
    if (held?.userData.arrow) held.userData.arrow.visible = s.charging && this.ammo > 0;
    const rElbow = s.charging ? (bow ? -0.05 : -0.7) : -0.45;
    this.armR.rotation.x = damp(this.armR.rotation.x, rBeta - rElbow, s.charging || this.throwT >= 0 ? 30 : 12, dt);
    this.elbowR.rotation.x = rElbow;
    this.armR.rotation.z = -0.14;
    this.spearHolder.rotation.x = spearPhi - (this.armR.rotation.x + this.elbowR.rotation.x);

    // left arm: melee weapon (or pulling the bowstring back to the chin)
    let lBeta = -1.15 + sw * 0.45;
    let lz = 0.14;
    // bows: pull the string to the chin. guns: reach forward under the barrel.
    const drawing = bow && s.charging && this.swingT < 0;
    const lElbow = drawing ? (firearm ? -0.55 : -1.1) : -0.4;
    if (drawing) {
      lBeta = firearm ? -1.45 : -1.5;
      lz = firearm ? -0.4 : -0.65;
    }
    if (this.swingT >= 0) {
      this.swingT += dt;
      const w = this.swingWind, strike = 0.12, recover = 0.22;
      const u = this.swingT;
      if (u < w) { lBeta = lerp(-1.15, -3.3, ease(u / w)); lz = lerp(0.14, 0.5, u / w); }
      else if (u < w + strike) { const k = (u - w) / strike; lBeta = lerp(-3.3, -0.35, k); lz = lerp(0.5, -0.45, k); }
      else if (u < w + strike + recover) { const k = (u - w - strike) / recover; lBeta = lerp(-0.35, -1.15, ease(k)); lz = lerp(-0.45, 0.14, k); }
      else this.swingT = -1;
      this.torso.rotation.y = u >= w && u < w + strike + recover ? -0.5 * (1 - (u - w) / (strike + recover)) : 0.25 * Math.min(1, u / w);
      this.armL.rotation.x = lBeta - lElbow;
    } else {
      this.armL.rotation.x = damp(this.armL.rotation.x, lBeta - lElbow, 12, dt);
    }
    this.elbowL.rotation.x = damp(this.elbowL.rotation.x, lElbow, 14, dt);
    this.armL.rotation.z = drawing ? damp(this.armL.rotation.z, lz, 14, dt) : lz;

    // emote: both arms up, wiggle
    if (this.emoteT >= 0) {
      this.emoteT += dt;
      const k = Math.sin(Math.min(1, this.emoteT / 1.1) * Math.PI);
      this.armR.rotation.x = lerp(this.armR.rotation.x, -2.9 + Math.sin(t * 18) * 0.2, k);
      if (this.swingT < 0) this.armL.rotation.x = lerp(this.armL.rotation.x, -2.9 - Math.sin(t * 18) * 0.2, k);
      this.head.rotation.x -= 0.3 * k;
      if (this.emoteT > 1.1) this.emoteT = -1;
    }

    // dancing: eases in and out of it
    this.danceK = damp(this.danceK || 0, this.dancing ? 1 : 0, 6, dt);
    const dk = this.danceK > 0.01 ? this.danceK : 0;
    const beat = t * 7;
    this.torso.rotation.z = Math.sin(beat / 2) * 0.22 * dk;
    this.body.rotation.y = Math.sin(t * 1.6) * 0.7 * dk;
    if (dk) {
      this.body.position.y += Math.abs(Math.sin(beat)) * 0.14 * dk;
      this.armR.rotation.x = lerp(this.armR.rotation.x, -2.7 + Math.sin(beat) * 0.45, dk);
      if (this.swingT < 0) this.armL.rotation.x = lerp(this.armL.rotation.x, -2.7 - Math.sin(beat) * 0.45, dk);
      this.legL.rotation.x += Math.max(0, Math.sin(beat)) * 0.5 * dk;
      this.legR.rotation.x += Math.max(0, -Math.sin(beat)) * 0.5 * dk;
      this.head.rotation.z = Math.sin(beat) * 0.15 * dk;
    } else {
      this.head.rotation.z = 0;
    }

    this.stars.visible = s.stunned;
    if (s.stunned) this.stars.rotation.y += dt * 6;
  }

  dispose() {
    allTags.delete(this);
    this.root.removeFromParent();
    this.root.traverse(o => {
      if (o.isMesh && !o.userData.shared) o.geometry.dispose();
    });
    this.skinMat.dispose();
    this.browMat.dispose();
    this.peltMat.dispose();
    if (this.tagTex) this.tagTex.dispose();
  }
}
