// Phones and tablets: a floating thumbstick, big action buttons and drag-to-aim on the right half,
// like any phone game. Tilt aiming from the motion sensors (lean the phone like a steering wheel
// to turn, tip it toward or away from you to aim up and down) is there too, off unless turned on
// in settings.
import { EMOTES } from '/shared/constants.js';
import { BUTTON } from './input.js';

const $ = id => document.getElementById(id);
const DEG = Math.PI / 180;

// Touch-only screens get the touch controls. ?touch forces them on (for testing with a mouse).
export const isTouch = new URLSearchParams(location.search).has('touch')
  || (matchMedia('(pointer: coarse)').matches && !matchMedia('(pointer: fine)').matches);

// Short rumble on phones that support it (Android). iPhones ignore it.
let buzzOn = true;
export const setBuzz = on => { buzzOn = on; };
export function buzz(ms) {
  if (!isTouch || !buzzOn || !ms || !navigator.vibrate) return;
  try { navigator.vibrate(ms); } catch { /* not allowed before the first tap */ }
}

// ====================================================================== tilt aiming
// Reads which way gravity pulls on the phone. Only changes from a "neutral" pose matter, so it
// works however the player holds it; the neutral pose is taken when play starts, after each
// respawn, when the screen rotates, and whenever they tap the re-center button.
export const TILT_LEVELS = { off: 0, soft: 0.6, normal: 1, wild: 1.6 };
const STEER_DEAD = 4 * DEG;      // lean less than this and nothing happens
const STEER_FULL = 32 * DEG;     // lean this far for full turning speed
const TURN_SPEED = 2.6;          // rad/s at full lean
const PITCH_GAIN = 1.25;         // aim pitch per radian of tip

export class TiltAim {
  constructor() {
    this.level = 'off';
    this.flip = false;
    this.started = false;
    this.status = 'idle';        // idle | waiting | live | none | denied | insecure
    this.source = null;          // 'orient' (fused, smooth) or 'motion' (raw accelerometer)
    this.g = null;               // smoothed gravity direction in phone coordinates
    this.zero = null;            // { roll, tip } of the neutral pose
    this.samples = 0;
    this.turn = 0;               // rad/s, + = turn right
    this.pitch = 0;              // rad, + = aim lower
    this.roll = 0;               // lean from neutral, for the HUD gauge
    this.tip = 0;
    this.onStatus = null;
  }

  get on() { return TILT_LEVELS[this.level] > 0 && this.status === 'live' && !!this.zero; }

  // Call from inside a tap: iOS only shows its motion permission prompt for a user gesture.
  start() {
    if (this.started || !TILT_LEVELS[this.level]) return;
    this.started = true;
    if (!window.isSecureContext) { this.setStatus('insecure'); return; }
    const asks = [window.DeviceOrientationEvent, window.DeviceMotionEvent]
      .filter(E => typeof E?.requestPermission === 'function')
      .map(E => E.requestPermission().catch(() => 'denied'));
    this.setStatus('waiting');
    Promise.all(asks).then(answers => {
      if (answers.includes('denied')) { this.setStatus('denied'); return; }
      addEventListener('deviceorientation', e => this.onOrientation(e));
      addEventListener('devicemotion', e => this.onMotion(e));
      // the in-plane "down" moves by 90 degrees when the screen rotates
      const rezero = () => { this.zero = null; this.samples = 0; };
      screen.orientation?.addEventListener?.('change', rezero);
      addEventListener('orientationchange', rezero);
      setTimeout(() => { if (this.status === 'waiting') this.setStatus('none'); }, 2000);
    });
  }

  setStatus(s) {
    if (s === this.status) return;
    this.status = s;
    this.onStatus?.(s);
  }

  onOrientation(e) {
    if (e.beta == null || e.gamma == null) return;
    const b = e.beta * DEG, c = e.gamma * DEG;
    // gravity in phone coordinates (x right, y up the screen, z out of the screen), from the
    // tilt angles; this stays smooth even where beta/gamma themselves flip around
    this.feed(Math.cos(b) * Math.sin(c), -Math.sin(b), -Math.cos(b) * Math.cos(c), 'orient');
  }

  onMotion(e) {
    if (this.source === 'orient') return;     // fused orientation is smoother; this is the fallback
    const a = e.accelerationIncludingGravity;
    if (!a || a.x == null) return;
    const n = Math.hypot(a.x, a.y, a.z);
    if (n < 2) return;
    // the accelerometer reports the push against gravity, so flip it to point down
    this.feed(-a.x / n, -a.y / n, -a.z / n, 'motion');
  }

  feed(x, y, z, source) {
    if (source === 'orient') this.source = 'orient';
    else this.source ||= 'motion';
    if (!this.g) this.g = [x, y, z];
    else {
      const k = 0.35;   // light smoothing; sensors fire ~60 times a second
      this.g[0] += (x - this.g[0]) * k;
      this.g[1] += (y - this.g[1]) * k;
      this.g[2] += (z - this.g[2]) * k;
    }
    this.samples++;
    this.setStatus('live');
    if (!this.zero && this.samples > 8) this.recenter();
  }

  pose() {
    const [x, y, z] = this.g;
    const n = Math.hypot(x, y, z) || 1;
    return {
      roll: Math.atan2(x, -y),                         // lean like a steering wheel
      tip: Math.asin(Math.max(-1, Math.min(1, -z / n))),   // 0 = screen upright, 90 = flat
      grip: Math.hypot(x, y) / n,                      // ~0 when the phone lies flat: lean is meaningless
    };
  }

  recenter() {
    if (!this.g) return false;
    const { roll, tip } = this.pose();
    this.zero = { roll, tip };
    return true;
  }

  update() {
    this.turn = 0;
    this.pitch = 0;
    if (!this.on || !this.g) return;
    const k = TILT_LEVELS[this.level];
    const { roll, tip, grip } = this.pose();
    let lean = roll - this.zero.roll;
    lean = Math.atan2(Math.sin(lean), Math.cos(lean));
    this.roll = lean;
    this.tip = tip - this.zero.tip;
    const amt = Math.min(1, Math.max(0, (Math.abs(lean) - STEER_DEAD) / (STEER_FULL - STEER_DEAD)));
    const fade = Math.min(1, Math.max(0, (grip - 0.15) / 0.2));
    this.turn = Math.sign(lean) * amt ** 1.5 * TURN_SPEED * k * fade;
    this.pitch = Math.max(-0.9, Math.min(0.9, this.tip * PITCH_GAIN * k * (this.flip ? -1 : 1)));
  }
}

// ====================================================================== on-screen controls
const STICK_R = 52;          // px the knob can travel
const LOOK_GAIN = 2.1;       // drag-to-aim, in mouse pixels per touch pixel

// Keep getting a finger's moves and lift even after it slides off the element it started on.
function capture(el, pointerId) {
  try { el.setPointerCapture(pointerId); } catch { /* pointer already gone */ }
}

function swallowNextClick() {
  const stop = e => { e.stopPropagation(); e.preventDefault(); };
  addEventListener('click', stop, { capture: true, once: true });
  setTimeout(() => removeEventListener('click', stop, { capture: true }), 600);
}

export class TouchControls {
  constructor(input, tilt, actions) {
    this.input = input;
    this.tilt = tilt;
    this.actions = actions;            // { council(), settings(), recenter(), quit(button) }
    this.root = $('touch');
    this.stickEl = $('stick');
    this.knob = $('stick-knob');
    this.stickId = null;
    this.stickHome = null;
    this.lookId = null;
    this.lookLast = null;
    this.tribeOpen = false;
    this.last = {};

    this.root.addEventListener('pointerdown', e => this.down(e));
    this.root.addEventListener('pointermove', e => this.move(e));
    for (const ev of ['pointerup', 'pointercancel', 'lostpointercapture']) this.root.addEventListener(ev, e => this.up(e));
    this.root.addEventListener('contextmenu', e => e.preventDefault());
    addEventListener('blur', () => this.releaseAll());

    // buttons: [id, press, release]
    this.bind('t-throw', () => input.setButton(BUTTON.ranged, true), () => input.setButton(BUTTON.ranged, false), true);
    this.bind('t-bonk', () => input.tapKey('KeyF'));
    this.bind('t-jump', () => input.tapKey('Space'));
    this.bind('t-grab', () => input.tapKey('KeyE'));
    this.bind('t-beast', () => input.tapKey('KeyQ'));
    this.bind('t-tribe', () => this.setTribe(!this.tribeOpen));
    // these open a full-screen panel: eat the click the tap fires next, or it would land on the panel
    this.bind('t-council', () => { this.setTribe(false); swallowNextClick(); actions.council(); });
    this.bind('t-settings', () => { this.setTribe(false); swallowNextClick(); actions.settings(); });
    // asks once ("SURE?"), quits on the second tap; the menu stays open in between
    this.bind('t-quit', () => { swallowNextClick(); actions.quit($('t-quit')); });
    this.bind('t-tilt', () => actions.recenter());
    this.bind('t-grunt', () => $('grunts').classList.toggle('hidden'));
    $('grunts').innerHTML = EMOTES.map((e, i) => `<div class="tbtn grunt" data-i="${i}">${e}</div>`).join('');
    for (const b of $('grunts').children) {
      this.bind(b, () => { input.tapKey(`Digit${Number(b.dataset.i) + 1}`); $('grunts').classList.add('hidden'); });
    }
    $('rotate-hint').addEventListener('click', () => document.body.classList.add('tall-ok'));
  }

  // aimWhileHeld: dragging the finger on this button also aims (charge a spear and steer it).
  bind(idOrEl, press, release = null, aimWhileHeld = false) {
    const el = typeof idOrEl === 'string' ? $(idOrEl) : idOrEl;
    el.addEventListener('pointerdown', e => {
      e.preventDefault();
      e.stopPropagation();
      capture(el, e.pointerId);
      el.classList.add('held');
      press();
      if (aimWhileHeld && this.lookId === null) { this.lookId = e.pointerId; this.lookLast = [e.clientX, e.clientY]; }
    });
    const end = e => {
      if (!el.classList.contains('held')) return;
      el.classList.remove('held');
      release?.();
      if (this.lookId === e.pointerId) this.lookId = null;
    };
    // moves bubble up to the root, which aims while this.lookId is this finger
    for (const ev of ['pointerup', 'pointercancel', 'lostpointercapture']) el.addEventListener(ev, end);
  }

  show(on) {
    this.root.classList.toggle('hidden', !on);
    document.body.classList.toggle('playing', on);
    if (!on) { this.releaseAll(); this.setTribe(false); $('grunts').classList.add('hidden'); }
  }

  // the killstreak beast button: hidden without one, CALL when it's waiting, SEND when it's out
  setBeast(icon, label) {
    const key = icon ? `${icon}${label}` : '';
    if (key === this.last.beast) return;
    this.last.beast = key;
    $('t-beast').classList.toggle('hidden', !icon);
    if (!icon) return;
    $('t-beast-icon').textContent = icon;
    $('t-beast-label').textContent = label;
    $('t-beast').classList.toggle('ready', label === 'CALL');
  }

  // ☰: scores and your weapon card, plus the settings and rules buttons
  setTribe(open) {
    this.tribeOpen = open;
    this.input.setKey('Tab', open);
    document.body.classList.toggle('tribe-open', open);
    $('t-tribe').classList.toggle('on', open);
    $('t-menu').classList.toggle('hidden', !open);
  }

  down(e) {
    if (e.target.closest('.tbtn')) return;
    e.preventDefault();
    $('grunts').classList.add('hidden');
    const left = e.clientX < innerWidth * 0.42;
    if (left && this.stickId === null) {
      this.stickId = e.pointerId;
      this.stickHome = [e.clientX, e.clientY];
      this.stickEl.classList.add('active');
      this.stickEl.style.left = `${e.clientX}px`;
      this.stickEl.style.top = `${e.clientY}px`;
      this.setKnob(0, 0);
    } else if (!left && this.lookId === null) {
      this.lookId = e.pointerId;
      this.lookLast = [e.clientX, e.clientY];
    } else return;
    capture(this.root, e.pointerId);
  }

  move(e) {
    if (e.pointerId === this.stickId) {
      let dx = e.clientX - this.stickHome[0], dy = e.clientY - this.stickHome[1];
      const d = Math.hypot(dx, dy);
      if (d > STICK_R) { dx *= STICK_R / d; dy *= STICK_R / d; }
      this.setKnob(dx, dy);
    } else if (e.pointerId === this.lookId) this.look(e);
  }

  look(e) {
    const [lx, ly] = this.lookLast;
    this.input.look((e.clientX - lx) * LOOK_GAIN, (e.clientY - ly) * LOOK_GAIN);
    this.lookLast = [e.clientX, e.clientY];
  }

  up(e) {
    if (e.pointerId === this.stickId) {
      this.stickId = null;
      this.stickEl.classList.remove('active');
      this.stickEl.style.left = this.stickEl.style.top = '';
      this.setKnob(0, 0);
    }
    if (e.pointerId === this.lookId) this.lookId = null;
  }

  setKnob(dx, dy) {
    this.knob.style.transform = `translate(${dx}px, ${dy}px)`;
    let x = dx / STICK_R, y = -dy / STICK_R;
    const m = Math.hypot(x, y);
    if (m < 0.15) x = y = 0;   // dead zone so a resting thumb doesn't creep
    this.input.stick[0] = x;
    this.input.stick[1] = y;
  }

  releaseAll() {
    this.stickId = this.lookId = null;
    this.stickEl.classList.remove('active');
    this.setKnob(0, 0);
    this.input.setButton(BUTTON.ranged, false);
    for (const el of this.root.querySelectorAll('.held')) el.classList.remove('held');
  }

  // Per-frame HUD bits that live on the buttons. Only touches the DOM when something changed.
  update(s) {
    const L = this.last;
    const set = (key, val, fn) => { if (L[key] !== val) { L[key] = val; fn(val); } };
    set('grab', s.grab, v => $('t-grab').classList.toggle('hidden', !v));
    set('chief', s.chief, v => $('t-council').classList.toggle('hidden', !v));
    set('throwLabel', s.throwLabel, v => { $('t-throw-label').textContent = v; });
    set('ammo', s.ammo, v => { $('t-ammo').textContent = v; $('t-throw').classList.toggle('empty', v === 0); });
    set('verb', s.verb, v => { $('t-bonk').firstElementChild.textContent = v; });
    set('charge', Math.round(s.charge * 20), v => $('t-throw').style.setProperty('--fill', `${v * 5}%`));
    set('cd', Math.round(Math.min(1, s.cooldown) * 20), v => $('t-bonk').style.setProperty('--fill', `${v * 5}%`));
    const t = this.tilt;
    // the re-center button only means something with tilt turned on
    set('tiltShown', TILT_LEVELS[t.level] > 0, v => $('t-tilt').classList.toggle('hidden', !v));
    set('tiltOn', t.on, v => $('t-tilt').classList.toggle('live', v));
    if (t.on) {
      set('gauge', `${Math.round(t.roll / DEG)}:${Math.round(t.tip / DEG)}`, () => {
        $('t-tilt-gauge').style.transform = `translateY(${Math.max(-9, Math.min(9, (t.flip ? -1 : 1) * t.tip / DEG / 3))}px) rotate(${-t.roll / DEG}deg)`;
      });
    }
  }
}
