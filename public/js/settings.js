// Player settings (sound, controls, screen), saved in this browser, plus the panel that edits
// them. The panel is built from SCHEMA, so adding a setting is one line here plus wherever it's used.
import { isTouch } from './touch.js';

const KEY = 'ss-settings';

export const DEFAULTS = {
  muted: false,
  volMaster: 100,      // percent
  volSfx: 100,
  music: true,
  volMusic: 100,
  volVoice: 100,
  sens: 1,             // look speed multiplier (mouse and touch drag)
  invertY: false,
  lefty: false,        // left-handed: mouse buttons swapped, throws with the left hand
  tilt: 'normal',      // touch: off | soft | normal | wild
  tiltFlip: false,
  vibrate: true,
  gfx: isTouch ? 'low' : 'auto',
  fov: 65,             // degrees, vertical
  shake: 100,          // percent
  flashes: 100,        // percent: hurt / age / disaster screen flashes
  dmgNumbers: true,
  fps: false,
  ping: !isTouch,      // latency readout under the radar (phones start without it: less clutter)
};

const pct = v => `${v}%`;
const onOff = [[true, 'ON'], [false, 'OFF']];

// type: range | seg. touch: only shown on touch screens. hot: its keyboard shortcut.
export const SCHEMA = [
  { section: 'SOUND' },
  { key: 'muted', label: 'MUTE ALL', type: 'seg', options: [[false, 'SOUND'], [true, 'QUIET']], hot: 'M' },
  { key: 'volMaster', label: 'ALL SOUND', type: 'range', min: 0, max: 100, step: 5, fmt: pct },
  { key: 'volSfx', label: 'BONKS & BOOMS', type: 'range', min: 0, max: 100, step: 5, fmt: pct },
  { key: 'music', label: 'DRUMS', type: 'seg', options: onOff, hot: 'N' },
  { key: 'volMusic', label: 'DRUM LOUDNESS', type: 'range', min: 0, max: 100, step: 5, fmt: pct },
  { key: 'volVoice', label: 'CAVEMAN VOICES', type: 'range', min: 0, max: 100, step: 5, fmt: v => (v ? pct(v) : 'OFF') },

  { section: 'CONTROLS' },
  { key: 'sens', label: isTouch ? 'DRAG SPEED' : 'MOUSE SPEED', type: 'range', min: 0.25, max: 3, step: 0.05, fmt: v => `${v.toFixed(2)}x` },
  { key: 'invertY', label: 'FLIP UP/DOWN LOOK', type: 'seg', options: onOff },
  { key: 'lefty', label: 'HANDED', type: 'seg', options: [[false, 'RIGHT'], [true, 'LEFT']],
    desc: isTouch ? 'WHICH HAND YOUR CAVEMAN THROWS WITH. THE OTHER ONE HOLDS THE CLUB.'
      : 'RIGHT: LEFT CLICK BONKS, HOLD RIGHT CLICK TO THROW. LEFT: THE OTHER WAY ROUND. YOUR CAVEMAN THROWS WITH THAT HAND TOO.' },
  { key: 'tilt', label: 'TILT AIM', type: 'seg', touch: true, options: [['off', 'OFF'], ['soft', 'SOFT'], ['normal', 'NORMAL'], ['wild', 'WILD']] },
  { key: 'tiltFlip', label: 'FLIP UP/DOWN TILT', type: 'seg', touch: true, options: onOff },
  { key: 'vibrate', label: 'BUZZ', type: 'seg', touch: true, options: onOff, desc: 'PHONE SHAKES WHEN YOU GET HIT (ANDROID).' },

  { section: 'SCREEN' },
  { key: 'gfx', label: 'GRAPHICS', type: 'seg', options: [['low', 'LOW'], ['auto', 'AUTO'], ['high', 'HIGH']], hot: 'G',
    desc: 'LOW: FASTEST, NO SHADOWS. AUTO: LOWERS SHARPNESS WHEN SLOW. HIGH: SHARPEST.' },
  { key: 'fov', label: 'VIEW WIDTH', type: 'range', min: 50, max: 95, step: 1, fmt: v => `${v}°` },
  { key: 'shake', label: 'SCREEN SHAKE', type: 'range', min: 0, max: 100, step: 10, fmt: v => (v ? pct(v) : 'OFF') },
  { key: 'flashes', label: 'SCREEN FLASHES', type: 'range', min: 0, max: 100, step: 10, fmt: v => (v ? pct(v) : 'OFF'),
    desc: 'RED HURT FLASH, AGE CHANGE GLOW, END-OF-WORLD WHITEOUT.' },
  { key: 'dmgNumbers', label: 'DAMAGE NUMBERS', type: 'seg', options: onOff },
  { key: 'fps', label: 'SHOW FPS', type: 'seg', options: onOff },
  { key: 'ping', label: 'SHOW PING', type: 'seg', options: onOff,
    desc: 'YOUR LATENCY TO THE CAVE SERVER, THERE AND BACK. GREEN GOOD, YELLOW OKAY, RED LAGGY.' },
];

const storage = {
  get(k) { try { return localStorage.getItem(k); } catch { return null; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch { /* private mode */ } },
  del(k) { try { localStorage.removeItem(k); } catch { /* private mode */ } },
};
const parse = s => { try { return JSON.parse(s); } catch { return undefined; } };

// Settings saved before there was a settings panel lived in their own keys.
function oldKeys() {
  const out = {};
  const gfx = parse(storage.get('ss-gfx')), tilt = parse(storage.get('ss-tilt')), flip = parse(storage.get('ss-tilt-flip'));
  if (gfx) out.gfx = gfx;
  if (tilt) out.tilt = tilt;
  if (flip != null) out.tiltFlip = !!flip;
  if (storage.get('ss-muted') != null) out.muted = storage.get('ss-muted') === '1';
  if (storage.get('ss-music') != null) out.music = storage.get('ss-music') !== '0';
  return out;
}

// Keep only values that fit the schema, so a bad or old save can't break anything.
function clean(raw) {
  const out = {};
  for (const row of SCHEMA) {
    if (!row.key || raw[row.key] === undefined) continue;
    const v = raw[row.key];
    if (row.type === 'range' && typeof v === 'number' && Number.isFinite(v)) out[row.key] = Math.min(row.max, Math.max(row.min, v));
    if (row.type === 'seg' && row.options.some(([o]) => o === v)) out[row.key] = v;
  }
  return out;
}

export class Settings {
  constructor() {
    const saved = parse(storage.get(KEY));
    this.values = { ...DEFAULTS, ...clean(saved && typeof saved === 'object' ? saved : oldKeys()) };
    this.listeners = [];
    if (!saved) {
      this.save();
      for (const k of ['ss-gfx', 'ss-tilt', 'ss-tilt-flip', 'ss-muted', 'ss-music']) storage.del(k);
    }
  }

  get(k) { return this.values[k]; }

  set(k, v) {
    if (this.values[k] === v) return;
    this.values[k] = v;
    this.save();
    for (const fn of this.listeners) fn(k, v);
  }

  toggle(k) { this.set(k, !this.values[k]); return this.values[k]; }

  reset() { for (const [k, v] of Object.entries(DEFAULTS)) this.set(k, v); }

  // fn(key, value) after every change; called once per key right away so it can apply them all
  onChange(fn) {
    this.listeners.push(fn);
    for (const [k, v] of Object.entries(this.values)) fn(k, v);
  }

  save() { storage.set(KEY, JSON.stringify(this.values)); }
}

// The settings tablet: one row per SCHEMA entry, kept in sync with the values.
export function buildSettingsPanel(settings, root) {
  const rows = SCHEMA.filter(r => !r.touch || isTouch);
  root.innerHTML = rows.map(r => {
    if (r.section) return `<h2>${r.section}</h2>`;
    const label = `<span>${r.label}${r.hot && !isTouch ? ` <i class="hot">${r.hot}</i>` : ''}</span>`;
    const desc = r.desc ? `<div class="rule-desc">${r.desc}</div>` : '';
    if (r.type === 'range') {
      return `<div class="rule" data-key="${r.key}">${label}
        <div class="slider"><input type="range" min="${r.min}" max="${r.max}" step="${r.step}"><b></b></div>${desc}</div>`;
    }
    return `<div class="rule" data-key="${r.key}">${label}
      <div class="seg">${r.options.map(([v, name], i) => `<button data-i="${i}">${name}</button>`).join('')}</div>${desc}</div>`;
  }).join('');

  const byKey = Object.fromEntries(rows.filter(r => r.key).map(r => [r.key, r]));
  root.addEventListener('input', e => {
    const el = e.target.closest('[data-key]');
    if (el && e.target.type === 'range') settings.set(el.dataset.key, Number(e.target.value));
  });
  root.addEventListener('click', e => {
    const btn = e.target.closest('button[data-i]');
    const el = btn?.closest('[data-key]');
    if (el) settings.set(el.dataset.key, byKey[el.dataset.key].options[Number(btn.dataset.i)][0]);
  });
  settings.onChange((k, v) => {
    const r = byKey[k];
    const el = r && root.querySelector(`[data-key="${k}"]`);
    if (!el) return;
    if (r.type === 'range') {
      const input = el.querySelector('input');
      if (Number(input.value) !== v) input.value = v;
      el.querySelector('b').textContent = r.fmt(v);
      input.style.setProperty('--pos', `${((v - r.min) / (r.max - r.min)) * 100}%`);
    } else {
      el.querySelectorAll('button').forEach((b, i) => b.classList.toggle('on', r.options[i][0] === v));
    }
  });
}
