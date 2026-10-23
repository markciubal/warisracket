// The penumbra's gear screen (peace mode): before going into the dark forest, pick a melee weapon
// and a ranged one. This is the look at them: your own caveman holding both, going at a straw
// dummy at their real pace (a swing every cd seconds; a shot once it's charged, then every
// cooldown), with the damage each would do floating up off the dummy, and their numbers alongside.
// It's its own little three.js scene, drawn only while the screen is open.
import * as THREE from 'three';
import { duelWeapon, RANGED } from '/shared/constants.js';
import { Caveman } from './caveman.js';
import { mat } from './util.js';

const HAND = new THREE.Vector3(0.3, 1.6, 0.35);   // where a shot leaves from (the throwing hand)
const DUMMY_AT = 2.2;                             // the dummy stands this far in front (+Z)

export class GearView {
  // canvas: what it draws on. floats: a box over it for the damage numbers. doing: a line saying
  // what's going on (a swing every so often, a shot...).
  constructor(canvas, floats, doing) {
    Object.assign(this, { canvas, floats, doing, renderer: null, running: false, man: null });
  }

  setup() {
    this.renderer = new THREE.WebGLRenderer({ canvas: this.canvas, antialias: true, alpha: true });
    this.renderer.setPixelRatio(Math.min(2, devicePixelRatio));
    this.scene = new THREE.Scene();
    this.scene.add(new THREE.HemisphereLight('#fff3e0', '#3a2a1c', 1.7));
    const sun = new THREE.DirectionalLight('#ffffff', 1.5);
    sun.position.set(3, 6, 4);
    this.scene.add(sun);
    const ground = new THREE.Mesh(new THREE.CircleGeometry(3.4, 32), mat('#3d5a2a'));
    ground.rotation.x = -Math.PI / 2;
    this.scene.add(ground);
    // the dummy: a straw sack on a post, arms out, and a sack for a head
    const straw = mat('#d9b45a', { flatShading: true }), wood = mat('#7a4b25');
    this.dummy = new THREE.Group();
    const add = (geo, m, x, y, z) => { const o = new THREE.Mesh(geo, m); o.position.set(x, y, z); this.dummy.add(o); return o; };
    add(new THREE.CylinderGeometry(0.06, 0.07, 1.0, 6), wood, 0, 0.5, 0);
    add(new THREE.CylinderGeometry(0.3, 0.34, 0.85, 10), straw, 0, 1.25, 0);
    add(new THREE.SphereGeometry(0.22, 10, 8), straw, 0, 1.85, 0);
    add(new THREE.CylinderGeometry(0.05, 0.05, 1.3, 6), wood, 0, 1.5, 0).rotation.z = Math.PI / 2;
    this.dummy.position.set(0, 0, DUMMY_AT);
    this.dummy.rotation.y = Math.PI;
    this.scene.add(this.dummy);
    this.shot = new THREE.Mesh(new THREE.SphereGeometry(0.08, 8, 6), new THREE.MeshBasicMaterial({ color: '#ffe08a' }));
    this.shot.visible = false;
    this.scene.add(this.shot);
    this.camera = new THREE.PerspectiveCamera(38, 1.5, 0.1, 50);
    this.camera.position.set(4.4, 2.5, 0.9);
    this.camera.lookAt(0, 1.15, 1.15);
  }

  // look: my caveman's. melee: a DUEL_WEAPONS key, ranged: a RANGED key. mult: what my hits are
  // multiplied by (gold might). Starts the routine again from the top.
  show(look, melee, ranged, mult = 1) {
    if (!this.renderer) this.setup();
    const key = JSON.stringify(look);
    if (!this.man || this.lookKey !== key) {
      if (this.man) this.scene.remove(this.man.root);
      this.man = new Caveman({ name: '', look, isLocal: true });
      if (this.man.tag) this.man.tag.visible = false;
      this.scene.add(this.man.root);
      this.lookKey = key;
    }
    Object.assign(this, { melee: duelWeapon(melee), ranged, mult, t: 0, step: 0, events: [], charging: false });
    this.man.setWeapon(this.melee);
    this.man.ammo = RANGED[ranged].ammo;
    this.man.setRanged(ranged);
    this.plan(0.4);
  }

  // The routine, from time `at`: three swings, a swing every cd; then three shots (charged, then
  // let fly, every cooldown); a breath; and round again.
  plan(at) {
    const w = this.melee, r = RANGED[this.ranged];
    const ev = this.events = [];
    let t = at;
    for (let i = 0; i < 3; i++) {
      ev.push({ at: t, fn: () => { this.man.playSwing(w.windup); this.say(`${w.name.toUpperCase()}: A SWING EVERY ${w.cd.toFixed(2)} S`); } });
      ev.push({ at: t + w.windup, fn: () => this.hit(this.meleeDmg(), w.crit) });
      t += w.cd;
    }
    t += 0.5;
    const charge = r.auto || r.hitscan ? 0 : r.chargeTime;
    for (let i = 0; i < 3; i++) {
      if (charge) ev.push({ at: t, fn: () => { this.charging = true; this.say(`${r.name.toUpperCase()}: CHARGE ${charge.toFixed(2)} S, THEN LET FLY`); } });
      t += charge;
      ev.push({ at: t, fn: () => this.fire() });
      t += Math.max(r.cooldown, 0.12);
    }
    ev.push({ at: t + 0.6, fn: () => this.plan(this.t) });
  }

  meleeDmg() { return Math.round(this.melee.dmg * this.mult); }

  fire() {
    const r = RANGED[this.ranged];
    this.charging = false;
    this.man.playThrow();
    if (!r.chargeTime || r.auto || r.hitscan) this.say(`${r.name.toUpperCase()}: A SHOT EVERY ${Math.max(r.cooldown, 0.12).toFixed(2)} S`);
    const to = new THREE.Vector3(0, 1.3, DUMMY_AT);
    const from = HAND.clone();
    const dmg = Math.round(r.maxDmg * this.mult) * (r.pellets || 1);
    if (r.hitscan) { this.hit(dmg); return; }
    // (a shot flies at its real speed: across this little yard, in a flash for the fast ones)
    const flight = Math.max(0.06, from.distanceTo(to) / r.maxSpeed);
    Object.assign(this, { shotFrom: from, shotTo: to, shotT: 0, shotLen: flight, shotDmg: dmg });
    this.shot.visible = true;
  }

  // the dummy takes it: it rocks, and the number floats up
  hit(dmg, crit = 0) {
    const big = crit && Math.random() < crit;
    this.wobble = 0.35;
    const p = new THREE.Vector3(0, 2.2, DUMMY_AT).project(this.camera);
    const el = document.createElement('div');
    el.className = `gear-float${big ? ' crit' : ''}`;
    el.textContent = big ? `${dmg * 2}!` : `${dmg}`;
    el.style.left = `${(p.x * 0.5 + 0.5) * 100}%`;
    el.style.top = `${(-p.y * 0.5 + 0.5) * 100}%`;
    this.floats.appendChild(el);
    setTimeout(() => el.remove(), 900);
  }

  say(text) { if (this.doing.textContent !== text) this.doing.textContent = text; }

  start() {
    if (this.running) return;
    this.running = true;
    let last = performance.now();
    const loop = now => {
      if (!this.running) return;
      requestAnimationFrame(loop);
      this.frame(Math.min(0.5, (now - last) / 1000));   // (real time, so the pace stays true on a slow phone)
      last = now;
    };
    requestAnimationFrame(loop);
  }

  stop() {
    this.running = false;
    this.floats.innerHTML = '';
  }

  frame(dt) {
    const w = this.canvas.clientWidth, h = this.canvas.clientHeight;
    if (w && h && (this.canvas.width !== Math.round(w * this.renderer.getPixelRatio()) || this.size !== `${w}x${h}`)) {
      this.size = `${w}x${h}`;
      this.renderer.setSize(w, h, false);
      this.camera.aspect = w / h;
      this.camera.updateProjectionMatrix();
    }
    this.t += dt;
    while (this.events.length && this.t >= this.events[0].at) this.events.shift().fn();
    if (this.shot.visible) {
      this.shotT += dt;
      const k = Math.min(1, this.shotT / this.shotLen);
      this.shot.position.lerpVectors(this.shotFrom, this.shotTo, k);
      if (k >= 1) { this.shot.visible = false; this.hit(this.shotDmg); }
    }
    this.wobble = Math.max(0, (this.wobble || 0) - dt);
    this.dummy.rotation.x = Math.sin(this.wobble * 30) * this.wobble * 0.5;
    this.man.update(Math.min(dt, 0.05), { speed: 0, air: false, charging: this.charging, stunned: false });
    this.renderer.render(this.scene, this.camera);
  }
}

// The numbers, for the screen next to the look: [label, value] rows, and what's special about it.
export function meleeRows(w, mult = 1) {
  return {
    rows: [
      ['DAMAGE', Math.round(w.dmg * mult)],
      ['A SWING EVERY', `${w.cd.toFixed(2)} S`],
      ['HITS A SECOND', (1 / w.cd).toFixed(2)],
      ['REACH', w.range.toFixed(1)],
      ['KNOCKBACK', w.kb],
      ['SWEEP', `${w.arc}°`],
      ['RUN SPEED', `${Math.round(w.speed * 100)}%`],
    ],
    special: [w.crit && `${Math.round(w.crit * 100)}% CRIT`, w.bleed && 'BLEEDS', w.stun && 'STUNS', w.slow && 'SLOWS'].filter(Boolean),
  };
}

export function rangedRows(r, mult = 1) {
  const auto = r.auto || r.hitscan || !r.chargeTime;
  return {
    rows: [
      ['DAMAGE', r.minDmg === r.maxDmg ? `${Math.round(r.maxDmg * mult)}` : `${Math.round(r.minDmg * mult)}–${Math.round(r.maxDmg * mult)}`],
      [auto ? 'A SHOT EVERY' : 'CHARGE', auto ? `${Math.max(r.cooldown, 0.12).toFixed(2)} S` : `${r.chargeTime.toFixed(2)} S`],
      ['SPEED', r.hitscan ? 'INSTANT' : `${r.maxSpeed}`],
      ['AMMO', `${r.ammo} (+1 EVERY ${r.regen} S)`],
    ],
    special: [r.hitscan && 'HITS AT ONCE', r.auto && 'HOLD TO FIRE', r.blast && 'BLAST', r.spread && 'SPRAYS', r.peace && 'PEACE ONLY'].filter(Boolean),
  };
}
