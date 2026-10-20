import * as THREE from 'three';
import * as C from '/shared/constants.js';
import * as M from '/shared/math.js';
import { Sky, World } from './world.js';
import { Caveman, redrawAllTags } from './caveman.js';
import { Effects } from './fx.js';
import { Sound } from './audio.js';
import { Hud, esc } from './hud.js';
import { Input, BUTTON, setLefty, buttonName } from './input.js';
import { isTouch, TiltAim, TouchControls, TILT_LEVELS, buzz, setBuzz } from './touch.js';
import { Settings, buildSettingsPanel } from './settings.js';
import { Beast } from './beasts.js';
import { buildProjectile, buildArmorDisplay, buildWeapon } from './weapons.js';
import { peltSwatchURL, softDotTexture } from './textures.js';
import { v3, mat, noise3, standOn, horizonTest } from './util.js';

const { R, PLAYER, PROJECTILE, VOLCANO } = C;
const INTERP = 0.12;          // render remote things this far behind the server clock (s)
const PHYS = 1 / 60;          // projectile step, matches the server
const clock = () => performance.now() / 1000;
const r4 = v => v.map(x => Math.round(x * 1e4) / 1e4);
const pick = list => list[Math.floor(Math.random() * list.length)];
const $ = id => document.getElementById(id);
const Z = new THREE.Vector3(0, 0, 1);
const _Y = new THREE.Vector3(0, 1, 0);
const _v = new THREE.Vector3();
const _w = new THREE.Vector3();

const store = {
  get(k) { try { return JSON.parse(localStorage.getItem(k)); } catch { return null; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* private mode */ } },
};

// ====================================================================== renderer & scene
// Graphics presets. maxRatio caps the render resolution (screen pixels per CSS pixel), and LOW and
// AUTO lower it toward minRatio whenever the frame rate drops. shadow: shadow map size (0 = none).
// density: share of smoke puffs and debris that actually get spawned.
const GFX = {
  low:  { label: 'LOW',  maxRatio: 1,   minRatio: 0.6, shadow: 0,    density: 0.5 },
  auto: { label: 'AUTO', maxRatio: 1.5, minRatio: 0.7, shadow: 1024, density: 1 },
  high: { label: 'HIGH', maxRatio: 2,   minRatio: 1,   shadow: 2048, density: 1 },
};
const GFX_ORDER = ['low', 'auto', 'high'];
if (isTouch) document.body.classList.add('touch');
// sound, controls and screen options (settings.js); phones start on LOW graphics
const settings = new Settings();
let gfxKey = settings.get('gfx');

const canvas = $('game');
// MSAA costs a lot on high-DPI screens, where pixels are already tiny enough not to need it.
const renderer = new THREE.WebGLRenderer({
  canvas,
  antialias: gfxKey === 'high' || (gfxKey === 'auto' && devicePixelRatio < 1.5),
  powerPreference: 'high-performance',
});
renderer.setSize(innerWidth, innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.05;

const scene = new THREE.Scene();
scene.fog = new THREE.Fog('#e6c49c', 60, 1000);
const camera = new THREE.PerspectiveCamera(65, innerWidth / innerHeight, 0.1, 1200);

const hemi = new THREE.HemisphereLight('#d2e4ff', '#4d6b30', 1.15);
scene.add(hemi, new THREE.AmbientLight('#ffffff', 0.25));
const sun = new THREE.DirectionalLight('#fff1d6', 2.5);
sun.shadow.bias = -0.0004;
sun.shadow.normalBias = 0.05;
Object.assign(sun.shadow.camera, { left: -26, right: 26, top: 26, bottom: -26, near: 1, far: 140 });
scene.add(sun, sun.target);

const sky = new Sky(scene);
const fx = new Effects(scene, camera);
const sound = new Sound();
const hud = new Hud();
const input = new Input(canvas, isTouch);
const tilt = new TiltAim();
const touch = isTouch ? new TouchControls(input, tilt, { council: () => toggleCouncil(), settings: () => toggleSettings(true), recenter: recenterTilt }) : null;
const projTemplates = Object.fromEntries(['spear', 'arrow', 'ball', 'bullet'].map(k => [k, buildProjectile(k)]));

// Render resolution, adjusted on the fly (see adaptResolution).
const res = { scale: 1, min: 0.7, max: 1.5, frames: 0, time: 0 };

function applyGfx() {
  const g = GFX[gfxKey];
  res.max = Math.min(devicePixelRatio, g.maxRatio);
  res.min = Math.min(res.max, g.minRatio);
  res.scale = res.max;
  renderer.setPixelRatio(res.scale);
  sun.castShadow = g.shadow > 0;
  if (g.shadow && sun.shadow.mapSize.x !== g.shadow) {
    sun.shadow.mapSize.set(g.shadow, g.shadow);
    sun.shadow.map?.dispose();
    sun.shadow.map = null;
  }
  fx.density = g.density;
  state.world?.setLowDetail(gfxKey === 'low');
}

// Push one setting into whatever it controls. Look speed, flip up/down and screen shake are
// read where they're used instead.
function applySetting(k, v) {
  const s = settings.values;
  switch (k) {
    case 'muted': case 'music': case 'volMaster': case 'volSfx': case 'volMusic': case 'volVoice':
      sound.configure({ muted: s.muted, musicOn: s.music, master: s.volMaster / 100, sfx: s.volSfx / 100, music: s.volMusic / 100, voice: s.volVoice / 100 });
      break;
    case 'gfx': gfxKey = GFX[v] ? v : 'auto'; applyGfx(); break;
    case 'fov': camera.fov = v; camera.updateProjectionMatrix(); break;
    case 'flashes': hud.flashScale = v / 100; break;
    case 'dmgNumbers': fx.numbers = v; break;
    case 'fps': $('fps').classList.toggle('hidden', !v); break;
    case 'ping': $('ping').classList.toggle('hidden', !v); break;
    case 'tilt':
      tilt.level = v;
      // turned on mid-game: this runs inside the tap, so iOS may still ask for motion access
      if (state.joined && isTouch) tilt.start();
      break;
    case 'tiltFlip': tilt.flip = v; break;
    case 'vibrate': setBuzz(v); break;
    case 'lefty':
      // swap the mouse buttons and the caveman's hands; everyone else sees the hands swap too
      setLefty(v);
      input.buttons.clear();   // nothing stays held on the old button
      hud.setThrowButton(buttonName('ranged'));
      for (const el of document.querySelectorAll('.btn-melee')) el.textContent = buttonName('melee');
      for (const el of document.querySelectorAll('.btn-ranged')) el.textContent = buttonName('ranged');
      myPlayer()?.model.setLefty(v);
      if (state.joinMsg) state.joinMsg.look.lefty = v ? 1 : 0;   // and after a reconnect
      if (state.joined) send({ t: 'hand', lefty: v ? 1 : 0 });
      break;
  }
}

const mouseWord = which => (BUTTON[which] === 0 ? 'LEFT' : 'RIGHT');

// LOW/AUTO graphics: every 1.5 s, drop the render resolution if we're under ~45 fps and creep it
// back up once there's headroom. Changing it is cheap enough at that rate.
function adaptResolution(dt) {
  res.frames++;
  res.time += dt;
  if (res.time < 1.5) return;
  const fps = res.frames / res.time;
  res.frames = 0;
  res.time = 0;
  let next = res.scale;
  if (fps < 45) next = Math.max(res.min, res.scale * 0.85);
  else if (fps > 56) next = Math.min(res.max, res.scale * 1.1);
  if (Math.abs(next - res.scale) > 0.02) {
    res.scale = next;
    renderer.setPixelRatio(next);
  }
}

addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
});

// ====================================================================== state
const state = {
  ws: null,
  worldReady: false,
  joined: false,
  myId: 0,
  sq: 0,
  world: null,
  players: new Map(),
  spears: new Map(),
  pending: new Map(),
  boulders: new Map(),
  fireballs: new Map(),
  tid: 0,
  lastSend: 0,
  lobbyAngle: 0,
  miniScoreT: 0,
  radarT: 0,
  eruptUntil: 0,
  joinMsg: null,       // resent automatically after a reconnect
  retries: 0,
  restarting: false,
  clockOffset: null,   // server time minus client time, from snapshot timestamps
  ping: 0,
  pingT: 0,
  // planet rules + Do Time clock, as last told by the server
  game: { mode: 'dotime', era: 0, phase: 'play', eraLeft: 0, eraLen: 45, endLeft: 0, eraSeconds: 45, botLevel: C.BOT_LEVEL_DEFAULT, bots: 4, chief: 0, disaster: null, mmDead: 0,
    wave: 0, waveSize: 0, waveLevel: 0 },   // co-op
  gameAt: 0,
  armorDrops: new Map(),
  loot: new Map(),     // weapons and ammo pouches dropped by slain cavemen
  beasts: new Map(),   // killstreak beasts on the planet
  shrooms: new Map(),  // magic mushrooms on the ground
  mammonSaid: 0,       // when the Businessman last spoke (he doesn't get to talk all the time)
  dyingBeasts: [],     // slain ones keeling over before they're removed
  standings: null,
  doomRun: null,       // the running finale (see startDoom)
  doomLook: 'fire',    // LOOKS key: how the ruined planet looks, kept while it heals
  doom: 0,             // how ruined the planet looks right now (0..1)
  doomTarget: 0,
};

const me = {
  p: [0, -1, 0], f: [1, 0, 0], h: 0, vh: 0, kbv: [0, 0, 0],
  alive: false, hp: PLAYER.maxHp, ammo: C.RANGED.spear.ammo, regen: 0, wpn: null, armor: null,
  stunUntil: 0, slowUntil: 0, lastSwing: -99, lastThrow: -99, lastEmote: -99,
  charging: false, charge: 0, pitch: 0.32, deadAt: 0, deathText: '',
  aim: 0.32,   // pitch from mouse / drag; tilt adds its offset on top to make `pitch`
  reward: null,   // killstreak beast waiting to be called (BEASTS key)
  beastId: 0,     // my beast that's out, if any
  buffs: {},      // mushroom buffs: kind -> clock() time it wears off
  speed: 0, stepDist: 0, streak: 0, helped: false,
};

const myPlayer = () => state.players.get(state.myId);
// co-op: every human is on my tribe, every bot is against it
const teamOf = p => (state.game.mode !== 'coop' ? null : p.bot ? 'foe' : 'ally');
const isAlly = p => teamOf(p) === 'ally';
const playerName = pl => (pl ? pl.name : 'SOMEONE');
const rangedKey = () => C.ERAS[state.game.era].ranged;
const rangedDef = () => C.RANGED[rangedKey()];
const fightingNow = () => state.game.phase === 'play';
const humansOnPlanet = () => [...state.players.values()].filter(p => !p.bot);

// Seconds left on the era / disaster / victory clock, counted down locally between server updates.
function clockLeft() {
  const g = state.game;
  return Math.max(0, (g.phase === 'end' ? g.endLeft : g.eraLeft) - (clock() - state.gameAt));
}

// Apply a rules/clock update from the server and refresh everything that depends on it.
function setGame(info) {
  const prev = { ...state.game };
  for (const k of Object.keys(state.game)) if (info[k] !== undefined) state.game[k] = info[k];
  state.gameAt = clock();
  if (prev.era !== state.game.era) for (const pl of state.players.values()) pl.model.setRanged(rangedKey());
  if (prev.mode !== state.game.mode) for (const pl of state.players.values()) pl.model.setTeam(teamOf(pl));
  if (prev.chief !== state.game.chief) {
    for (const pl of state.players.values()) pl.model.setChief(pl.id === state.game.chief);
    if (state.game.chief && state.game.chief === state.myId) hud.feed(`<span class="me">YOU ARE CHIEF NOW.</span> ${isTouch ? 'TAP RULES' : 'PRESS C'} FOR TRIBE COUNCIL`);
  }
  refreshRules();
}

// ====================================================================== networking
// Same host and port as the page, so it works locally, on a LAN and behind Heroku's HTTPS router.
function connect() {
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  const ws = state.ws = new WebSocket(`${proto}://${location.host}`);
  ws.onmessage = e => {
    const m = JSON.parse(e.data);
    const fn = handlers[m.t];
    if (fn) fn(m);
  };
  ws.onclose = () => {
    if (state.ws !== ws) return;
    state.ws = null;
    state.retries++;
    netBanner(state.restarting ? 'CAVE SERVER MOVING. BACK SOON...' : 'LOST CAVE SIGNAL. RECONNECTING...');
    // keep retrying forever, but after about a minute also offer a manual reload
    if (state.retries >= 14) $('disconnected').classList.remove('hidden');
    setTimeout(connect, Math.min(5000, 400 * 2 ** state.retries));
  };
}

function send(msg) {
  if (state.ws && state.ws.readyState === 1) state.ws.send(JSON.stringify(msg));
}

function sendState() {
  state.lastSend = clock();
  send({ t: 'st', sq: state.sq, p: r4(me.p), f: r4(me.f), h: Math.round(me.h * 100) / 100, c: me.charging ? 1 : 0 });
}

// Server time of what's on screen right now (everyone else is drawn INTERP behind the server).
// Sent with every attack so the server can check it against where targets were when we saw them.
const viewTime = () => Math.round((clock() + (state.clockOffset ?? 0) - INTERP) * 1000) / 1000;

// An attack: first where we stand and face this instant, so the server doesn't judge it from
// a position up to one state update old.
function sendAttack(msg) {
  sendState();
  send({ ...msg, vt: viewTime() });
}

function netBanner(text) {
  $('net-banner').classList.toggle('hidden', !text);
  if (text) $('net-banner').textContent = text;
}

// Drop everything from the previous connection; a restarted server rolls a brand-new planet.
function clearWorld() {
  state.world.dispose();
  state.world = null;
  for (const pl of state.players.values()) pl.model.dispose();
  state.players.clear();
  for (const s of [...state.spears.values(), ...state.pending.values()]) s.mesh.removeFromParent();
  clearStuckPools();
  state.spears.clear();
  state.pending.clear();
  for (const b of state.boulders.values()) { b.mesh.removeFromParent(); b.mesh.geometry.dispose(); }
  state.boulders.clear();
  for (const fb of [...state.fireballs.values()]) removeFireball(fb);
  for (const id of [...state.armorDrops.keys()]) removeArmorDrop(id);
  clearLoot();
  clearBeasts();
  clearDoom();
  Object.assign(state, { myId: 0, worldReady: false, clockOffset: null, standings: null, doom: 0, doomTarget: 0 });
  Object.assign(me, { alive: false, charging: false, armor: null, reward: null, beastId: 0 });
  hud.death(false);
  hud.roundEnd(null);
}

const handlers = {
  world(m) {
    const rejoining = !!state.world && state.joined;
    if (state.world) clearWorld();
    setGame(m.game);
    state.world = new World(scene, m, fx);
    state.world.setLowDetail(gfxKey === 'low');
    stuckPool('spear');
    stuckPool('arrow');
    for (const p of m.players) addPlayer(p);
    for (const s of m.spears) addSpear(s.id, s.owner, s.pos, s.vel, s.stuck ? s : null, C.RANGED[s.w]?.proj);
    for (const b of m.boulders) addBoulder(b);
    for (const fb of m.fireballs) addFireball(fb);
    for (const a of m.armorDrops) addArmorDrop(a);
    for (const l of m.loot || []) addLoot(l);
    for (const b of m.beasts || []) addBeast(b, false);
    for (const f of m.fires || []) state.world.setMeat(f.id, f.left);
    for (const s of m.shrooms || []) addShroom(s);
    if (m.doom) startDoom(m.doom);
    // Build every shader the scene needs now (in the background where the GPU allows it)
    // instead of stalling a frame the first time each thing comes into view.
    if (renderer.extensions.has('KHR_parallel_shader_compile')) renderer.compileAsync(scene, camera).catch(() => {});
    else renderer.compile(scene, camera);
    refreshRules();
    state.worldReady = true;
    state.retries = 0;
    state.restarting = false;
    netBanner(null);
    $('disconnected').classList.add('hidden');
    $('play').disabled = false;
    $('play').textContent = 'OOGA BOOGA!';
    if (state.joined && state.joinMsg) {
      send(state.joinMsg);
      if (rejoining) hud.center('BACK ON ROCK!', 'NEW PLANET, SAME CAVEMAN', 2.2);
    }
  },

  full(m) {
    Object.assign(state, { joined: false, joinMsg: null });
    input.enabled = false;
    input.unlock();
    touch?.show(false);
    hud.show(false);
    $('lobby').classList.remove('hidden');
    $('play').textContent = `CAVE FULL (${m.max}). TRY AGAIN`;
  },

  restart() { state.restarting = true; },

  game(m) {
    setGame(m);
    if (m.changed?.length && state.joined) {
      const bits = [];
      if (m.changed.includes('mode')) bits.push(C.MODES[m.mode]);
      if (m.changed.includes('botLevel')) bits.push(`BOT BRAINS ${m.botLevel}/10 (${C.botLevelDef(m.botLevel).name})`);
      if (m.changed.includes('bots')) bits.push(m.bots ? `BOTS FILL TO ${m.bots}` : 'NO BOTS');
      hud.feed(`<span class="streak">${m.by ? `CHIEF ${esc(m.by.toUpperCase())}` : 'SPIRITS'}:</span> ${bits.join(' · ')}`);
    }
  },

  era(m) {
    setGame(m);
    const era = C.ERAS[m.era];
    const len = Math.round(m.eraLen);
    // co-op ages last a couple of waves, not a set time
    mammonSay(pick(C.MAMMON.newAge), { force: true, feed: true });
    const howLong = m.mode === 'coop' ? `${C.COOP.ageEvery} WAVES` : len >= 60 ? `${Math.round(len / 6) / 10} MIN` : `${len} SEC`;
    hud.center(`${era.name}!`, `${era.sub} · ${howLong}`, 3.5);
    hud.feed(`<span class="streak">${era.name}</span> BEGIN`);
    hud.flash(0.6, 'era');
    sound.play('era');
    const shout = { bow: 'bendy stick!', sword: 'shiny rock!', musket: 'boom stick!', gun: 'bang bang!', laser: 'zap zap!' }[era.id];
    if (shout) sound.speak(shout, { pitch: 0.3 });
    // a new age's weapon lands in front of you (the server drops it); yours is still yours
    if (era.regear && state.myId && me.alive) hud.feed(`SPIRITS DROP A NEW WEAPON IN FRONT OF YOU · <span class="me">${isTouch ? 'GRAB' : 'E'}</span> TO TAKE IT, OR KEEP YOURS`);
    if (state.myId && me.alive) {
      const up = v3(me.p);
      fx.burst(up.clone().multiplyScalar(R + 1.5), { count: 30, color: '#ffd34d', speed: 6, size: 0.1, life: 1.2, up, emissive: true });
    }
  },

  roundend(m) {
    setGame(m);
    state.standings = m.standings;
    me.charging = false;
    if (!state.game.mmDead) {
      state.roundProfit = mammonGrowth().profit;
      mammonSay(C.MAMMON.end, { force: true, feed: true });
    }
    const ending = m.mode === 'coop' ? 'wiped' : m.disaster ? 'doom' : 'time';
    state.roundQuote = C.BUTLER.quotes[pick(C.BUTLER_ENDINGS[ending])];
    if (m.mode === 'coop') {
      sound.play('die');
      sound.speak('tribe fall down', { pitch: 0.2 });
      hud.feed(`<span class="streak">TRIBE WIPED OUT</span> ON WAVE ${m.wave}`);
      return;
    }
    const doomed = !!m.disaster;
    if (!doomed) sound.play('era');
    const won = m.standings[0]?.id === state.myId;
    sound.speak(won ? 'me win! me best caveman!' : doomed ? 'everything gone' : 'time done', { pitch: 0.25 });
    hud.feed(`<span class="streak">${doomed ? 'EVERYTHING GONE!' : 'TIME DONE!'}</span> ${m.standings[0] ? `${esc(m.standings[0].name)} WIN` : ''}`);
  },

  // The end of the world: the server picked the disaster and when and where everything lands.
  doom(m) {
    setGame(m);
    mammonSay(C.MAMMON.doom, { force: true, feed: true });
    startDoom(m);
  },

  // ...and the bunker didn't help: last words, over he goes, money everywhere
  mammondie() {
    state.game.mmDead = 1;
    const mm = state.world?.mammon;
    if (!mm || mm.dead) return;
    state.roundProfit = mammonGrowth().profit;
    mammonSay(C.MAMMON.death, { force: true, feed: true });
    mm.onLand = () => {
      const d = M.arcDist(me.p, C.MAMMON.at);
      sound.play('stomp', d);
      sound.play('coins', d);
      fx.addShake(Math.max(0, 0.35 - d / 60));
      const up = v3(C.MAMMON.at);
      fx.burst(up.clone().multiplyScalar(R + 2), { count: 26, color: '#ffd34d', speed: 5, size: 0.12, life: 1.3, up, emissive: true });
    };
    mm.die();
  },

  // fresh Stone Age: scores, projectiles and armor reset (respawn events follow)
  round(m) {
    setGame(m);
    state.standings = null;
    clearDoom();
    state.doomTarget = 0;   // the ash melts or drains away and the grass grows back
    hud.roundEnd(null);
    for (const pl of state.players.values()) Object.assign(pl, { k: 0, d: 0, streak: 0 });
    for (const s of [...state.spears.values(), ...state.pending.values()]) s.mesh.removeFromParent();
    clearStuckPools();
    state.spears.clear();
    state.pending.clear();
    for (const id of [...state.armorDrops.keys()]) removeArmorDrop(id);
    clearLoot();
    clearBeasts();
    me.reward = null;   // streak rewards don't carry over into a new round
    for (const f of state.world?.fires || []) f.readyAt = 0;
    for (const pk of m.pickups) state.world?.setPickupWeapon(pk.id, pk.wpn);
    if (state.joined) {
      const intro = {
        dotime: ['NEW STONE AGE!', 'LIFE FIND WAY. DO TIME AGAIN.'],
        classic: ['FOREVER STONE!', 'SPEARS AND BONES. NO END.'],
        coop: ['TRIBE VS BOTS!', 'ALL HUMANS ONE TRIBE. BOTS COME IN WAVES. GET READY.'],
      }[m.mode];
      hud.center(intro[0], intro[1], 3);
      setTimeout(() => mammonSay(C.MAMMON.start, { force: true }), 3500);
      hud.feed(`<span class="streak">NEW ROUND</span> · ${C.MODES[m.mode]}`);
    }
  },

  // co-op: a wave starts (start) or the last bot of one falls (cleared)
  wave(m) {
    setGame(m);
    if (!state.joined) return;
    if (m.start) {
      const lvl = C.botLevelDef(m.waveLevel);
      hud.center(`WAVE ${m.wave}!`, `${m.waveSize} BOTS COMING · BRAINS ${m.waveLevel}/10 ${lvl.name}`, 3);
      hud.feed(`<span class="streak">WAVE ${m.wave}</span> · ${m.waveSize} BOTS`);
      sound.play('era');
      sound.speak(pick(['here they come!', 'bots! many bots!', 'tribe! bonk them!']), { pitch: 0.3 });
    } else if (m.cleared) {
      hud.center(`WAVE ${m.wave} DONE!`, 'FALLEN FRIENDS WAKE UP. EVERYBODY EAT. NEXT WAVE SOON.', 3.5);
      hud.feed(`<span class="streak">WAVE ${m.wave} CLEARED</span>`);
      hud.flash(0.5, 'era');
      sound.play('kill');
      sound.speak('tribe strong!', { pitch: 0.3 });
    }
  },

  // ---- food: campfire roasts and magic mushrooms
  meat(m) {
    state.world?.setMeat(m.id, m.left);
    const eater = state.players.get(m.by);
    const fire = state.world?.fires.find(f => f.id === m.id);
    const at = fire ? fire.group.position.clone().addScaledVector(fire.group.position.clone().normalize(), 1.6) : null;
    if (at) fx.burst(at, { count: 8, color: '#7c3a1c', speed: 2, size: 0.08, life: 0.6 });
    sound.play('munch', eater ? distTo(eater.rp) : 0);
    if (m.by === state.myId) {
      fx.float(v3(me.p).multiplyScalar(R + 2.2), `+${C.MEAT.heal} YUM!`, 'heal', { life: 1.2 });
      sound.speak(pick(['yum yum', 'meat good', 'mmm mammoth']), { pitch: 0.3 });
    }
  },

  shroom(m) { addShroom(m); },

  unshroom(m) {
    const s = state.shrooms.get(m.id);
    if (s) {
      const def = C.SHROOMS[s.kind];
      fx.burst(v3(s.u).multiplyScalar(R + 0.4), { count: 18, color: def.color, speed: 3, size: 0.09, life: 0.8, up: v3(s.u), emissive: true });
      sound.play('magic', distTo(s.u));
    }
    removeShroom(m.id);
  },

  buff(m) {
    const pl = state.players.get(m.id);
    const def = C.SHROOMS[m.kind];
    if (!def) return;
    const until = clock() + m.left;
    if (pl) (pl.buffs ||= {})[m.kind] = until;
    if (m.id === state.myId) {
      me.buffs[m.kind] = until;
      hud.center(`${def.buff}!`, `${def.name}: ${def.desc} FOR ${m.left} SEC`, 2.2);
      sound.speak(pick(['oooh', 'whoa', 'me feel funny', 'ooga!']), { pitch: 0.4 });
      hud.flash(0.4, 'era');
    }
  },

  // ---- killstreak beasts
  reward(m) {
    const pl = state.players.get(m.id);
    const def = C.BEASTS[m.kind];
    if (!def) return;
    if (state.joined) hud.feed(`<span class="streak">${esc(playerName(pl))} EARN ${def.icon} ${def.name.toUpperCase()}!</span>`);
    if (m.id !== state.myId) return;
    me.reward = m.kind;
    const how = isTouch ? 'TAP BEAST TO CALL IT. TAP AGAIN TO SEND IT.' : 'PRESS Q TO CALL IT. AIM + Q TO SEND IT.';
    hud.center(m.kind === 'trex' ? 'RARE T-REX!!' : `${def.name.toUpperCase()}!`, `${def.desc} ${how}`, 3.5);
    sound.play(BEAST_CALL[m.kind]);
    sound.speak(m.kind === 'trex' ? 'big lizard! big big lizard!' : `${def.name.toLowerCase()}!`, { pitch: 0.3 });
  },

  beast(m) { addBeast(m); },

  battack(m) {
    const b = state.beasts.get(m.id);
    if (!b) return;
    b.model.play(m.a);
    const d = distTo(b.rp);
    if (m.a === 'roar') {
      sound.play('roar', d);
      fx.addShake(Math.max(0, 0.8 - d / 25));
      fx.float(v3(b.rp).multiplyScalar(R + C.BEASTS[b.kind].height + 0.5), 'ROOOAAARR!', 'ooga', { life: 1.4 });
    } else if (m.a === 'tusk' || m.a === 'trample') sound.play(m.a === 'tusk' ? 'trumpet' : 'stomp', d);
    else if (m.a === 'chomp') sound.play('chomp', d);
    else sound.play(b.kind === 'dog' && m.a === 'pounce' ? 'bark' : 'snarl', d);
  },

  bdmg(m) {
    const b = state.beasts.get(m.id);
    if (!b) return;
    b.hp = m.hp;
    b.model.setHp(m.hp);
    const pos = m.pos ? v3(m.pos) : v3(b.rp).multiplyScalar(R + b.rh + C.BEASTS[b.kind].height * 0.6);
    fx.burst(pos, { count: 6, color: '#a8201a', speed: 3, size: 0.1, life: 0.6 });
    fx.float(pos, `${m.d}`, 'dmg', { offset: 0.4 });
    if (m.a === state.myId) {
      sound.play('thunk');
      $('crosshair').classList.remove('hit');
      void $('crosshair').offsetWidth;
      $('crosshair').classList.add('hit');
    }
  },

  beastgone(m) {
    const b = state.beasts.get(m.id);
    if (!b) return;
    const owner = state.players.get(b.owner);
    const name = `${esc(playerName(owner))}'S ${b.name.toUpperCase()}`;
    if (m.reason === 'slain') {
      const by = state.players.get(m.by);
      if (state.joined) hud.feed(by ? `<span class="${m.by === state.myId ? 'me' : ''}">${esc(by.name)}</span> SLAY ${name}!` : `${name} GO SLEEP`);
      sound.play('die', distTo(b.rp));
      if (m.by === state.myId) hud.center(`YOU SLAY ${b.name.toUpperCase()}!`, b.kind === 'dog' ? 'BAD DOG. BAD.' : 'BIG BONK. TRIBE TELL STORY FOREVER.', 2.4);
    } else if (state.joined) hud.feed(`${name} WANDER OFF`);
    removeBeast(m.id, m.reason === 'slain');
  },

  // my beast was sent somewhere: show where
  bcmd(m) {
    const b = state.beasts.get(m.id);
    if (!b || b.owner !== state.myId) return;
    const target = state.players.get(m.target);
    const at = target ? v3(target.rp) : m.u ? v3(m.u).normalize() : null;
    if (!at) return;
    fx.float(at.clone().multiplyScalar(R + (target ? target.rh + 2.4 : 1)), target ? `SIC 'EM!` : 'GO THERE!', 'ooga', { life: 1.2 });
    fx.burst(at.clone().multiplyScalar(R + 0.2), { count: 12, color: '#ff4b2e', speed: 3, size: 0.1, life: 0.7, up: at, emissive: true });
    sound.play(BEAST_CALL[b.kind], distTo(b.rp) * 0.5);
  },

  loot(m) { addLoot(m); },
  unloot(m) {
    const l = state.loot.get(m.id);
    if (l && m.by === state.myId && m.n) {
      const def = rangedDef();
      const word = { spear: 'SPEAR', arrow: 'ARROW', ball: 'BOOM BALL', bullet: 'BANG', laser: 'ZAP' }[def.proj] || 'SPEAR';
      fx.float(v3(me.p).multiplyScalar(R + 2), `+${m.n} ${word}${m.n > 1 && def.proj !== 'laser' ? 'S' : ''}`, 'heal', { life: 1 });
      sound.play('spearpick');
    }
    removeLoot(m.id);
  },

  armor(m) {
    const pl = state.players.get(m.id);
    if (!pl) return;
    pl.armor = m.armor;
    pl.model.setArmor(m.armor);
    const pos = v3(pl.rp).multiplyScalar(R + pl.rh + 1.4);
    if (m.broke) {
      fx.burst(pos, { count: 18, color: '#cfd8e0', speed: 6, size: 0.12, life: 0.9, up: v3(pl.rp) });
      fx.float(pos, 'ARMOR BROKE!', 'ooga', { offset: 0.8 });
      sound.play('armorbreak', distTo(pl.rp));
    }
    if (m.id === state.myId) {
      me.armor = m.armor ? { ...m.armor } : null;
      if (m.armor) {
        sound.play('armor');
        hud.center(`WEAR ${m.armor.name.toUpperCase()}!`, `BLOCK ${Math.round(m.armor.block * 100)}% OF BONK`, 1.8);
      }
    }
  },

  adrop(m) { addArmorDrop(m); },
  adel(m) { removeArmorDrop(m.id); },

  // someone switched hands in their settings
  hand(m) {
    const pl = state.players.get(m.id);
    if (!pl) return;
    pl.look.lefty = m.lefty;
    pl.model.setLefty(m.lefty);
  },

  // laser shot: our own beam was already drawn when we fired
  zap(m) {
    const owner = state.players.get(m.owner);
    if (m.owner !== state.myId) {
      fx.beam(v3(m.from), v3(m.to), { color: '#7fe8ff' });
      owner?.model.playThrow();
      sound.play('laser', distTo(owner?.rp));
    }
    zapImpact(v3(m.to), !!m.hit);
  },

  pong(m) {
    const rtt = (clock() - m.ts) * 1000;
    state.ping = state.ping ? state.ping * 0.7 + rtt * 0.3 : rtt;
  },

  you(m) {
    state.myId = m.id;
    state.sq = m.sq;
    const pl = myPlayer();
    if (!pl) return;
    pl.model.isLocal = true;
    if (pl.model.tag) pl.model.tag.visible = false;
    Object.assign(me, { p: pl.rp, f: pl.rf, h: 0, vh: 0, alive: true, hp: PLAYER.maxHp, ammo: m.ammo, wpn: pl.wpn, armor: null });
    hud.setWeapon(pl.wpn);
    hud.setHp(me.hp);
    if (!me.helped) {
      me.helped = true;
      const dotime = state.game.mode === 'dotime';
      hud.center(dotime ? 'DO TIME! BONK THROUGH THE AGES.' : 'THROW SPEAR. BONK CAVEMEN.',
        dotime ? `STONE → BOW → SWORD → BOOM → BANG → ZAP → ??? · ${state.game.eraSeconds} SEC EACH · GRAB ARMOR · E AT TOTEMS`
          : `${mouseWord('melee')} MOUSE / F TO BONK · HOLD ${mouseWord('ranged')} MOUSE TO THROW · E AT TOTEMS FOR NEW WEAPON`, 5);
    }
  },

  pjoin(m) {
    const pl = addPlayer(m.pl);
    // while our own join is in flight (no id yet), the next pjoin is us
    if (state.joined && state.myId && pl.id !== state.myId) hud.feed(`${esc(pl.name)} JOIN TRIBE${pl.bot ? ' (BOT)' : ''}`);
  },

  pleave(m) {
    const pl = state.players.get(m.id);
    if (!pl) return;
    pl.model.dispose();
    state.players.delete(m.id);
    if (state.joined) hud.feed(`${esc(pl.name)} WANDER OFF`);
    updateOnline();
  },

  s(m) {
    // Track the freshest-arriving snapshot's offset; late (jittery) ones only nudge it down slowly.
    const t = m.ts / 1000;
    const sample = t - clock();
    if (state.clockOffset === null || sample > state.clockOffset) state.clockOffset = sample;
    else state.clockOffset += (sample - state.clockOffset) * 0.01;
    // row: [id, px, py, pz, fx, fy, fz, h, hp, flags]
    for (const row of m.p) {
      const pl = state.players.get(row[0]);
      if (!pl) continue;
      const hp = row[8], flags = row[9];
      pl.flags = flags;
      pl.ammo = flags >> 5;
      if (pl.hp !== hp) { pl.hp = hp; pl.model.setHp(hp); }
      if (row[0] === state.myId) { me.hp = hp; continue; }
      pl.snaps.push({ t, p: [row[1], row[2], row[3]], f: [row[4], row[5], row[6]], h: row[7] });
      if (pl.snaps.length > 30) pl.snaps.shift();
    }
    for (const row of m.b) {
      const b = state.boulders.get(row[0]);
      if (!b) continue;
      b.snaps.push({ t, p: [row[1], row[2], row[3]], f: [row[4], row[5], row[6]] });
      if (b.snaps.length > 30) b.snaps.shift();
    }
    // beasts: [id, px, py, pz, fx, fy, fz, h, hp, moving]
    for (const row of m.bs || []) {
      const b = state.beasts.get(row[0]);
      if (!b) continue;
      b.snaps.push({ t, p: [row[1], row[2], row[3]], f: [row[4], row[5], row[6]], h: row[7] });
      if (b.snaps.length > 30) b.snaps.shift();
      if (b.hp !== row[8]) { b.hp = row[8]; b.model.setHp(row[8]); }
    }
  },

  me(m) {
    if (m.ammo > me.ammo) me.regen = 0;
    me.ammo = m.ammo;
  },

  spear(m) {
    if (m.owner === state.myId && m.tid != null && state.pending.has(m.tid)) {
      const s = state.pending.get(m.tid);
      state.pending.delete(m.tid);
      s.id = m.id;
      state.spears.set(m.id, s);
      return;
    }
    const kind = C.RANGED[m.w]?.proj || 'spear';
    addSpear(m.id, m.owner, m.pos, m.vel, null, kind);
    const owner = state.players.get(m.owner);
    if (owner) {
      owner.model.playThrow();
      shotEffects(kind, v3(m.pos), v3(m.vel).normalize(), distTo(owner.rp));
    }
  },

  stuck(m) {
    let s = state.spears.get(m.id);
    if (!s) s = addSpear(m.id, 0, m.pos, [0, 0, 0]);
    setStuck(s, m.pos, m.dir);
    const u = v3(m.pos).normalize();
    const d = distTo(u.toArray());
    sound.play('thunk', d);
    if (d < 40) fx.burst(v3(m.pos), { count: 6, color: '#a8875a', speed: 2.5, size: 0.09, life: 0.6, up: u });
    // somebody threw something at the Businessman
    if (M.arcDist(u.toArray(), C.MAMMON.at) < 3.5) mammonSay(pick(C.MAMMON.hit), { force: true });
  },

  sphit(m) { removeSpear(m.id); },

  spgone(m) {
    removeSpear(m.id);
    if (m.imp && m.pos) {
      const pos = v3(m.pos);
      const up = pos.clone().normalize();
      fx.burst(pos, { count: 5, color: '#a8875a', speed: 3, size: 0.07, life: 0.4, up });
      fx.puff(pos, { color: '#c9b48c', size: 0.5, grow: 1.6, life: 0.5, alpha: 0.5 });
      sound.play('impact', distTo(up.toArray()));
    }
    if (m.brk && m.pos) {
      const pos = v3(m.pos);
      fx.burst(pos, { count: 10, color: '#8a5a2b', speed: 5, size: 0.08, life: 0.8 });
      sound.play('break', distTo(pos.clone().normalize().toArray()));
    }
  },

  deflect(m) {
    const s = state.spears.get(m.id);
    if (!s) return;
    s.pos = m.pos.slice();
    s.vel = m.vel.slice();
    s.owner = m.owner;
    s.stuck = false;
    s.acc = 0;
    const pos = v3(m.pos);
    fx.burst(pos, { count: 14, color: '#fff3b0', speed: 7, size: 0.08, life: 0.4, emissive: true });
    fx.float(pos, m.owner === state.myId ? 'HOME RUN!' : 'BONK BACK!', 'ooga', { life: 1.3 });
    sound.play('deflect', distTo(pos.clone().normalize().toArray()));
    if (m.owner === state.myId) {
      fx.addShake(0.15);
      buzz(30);
      $('crosshair').classList.remove('hit');
      void $('crosshair').offsetWidth;
      $('crosshair').classList.add('hit');
    }
  },

  sppick(m) {
    removeSpear(m.id);
    if (m.by === state.myId) {
      sound.play('spearpick');
      fx.float(v3(me.p).multiplyScalar(R + 2), rangedDef().proj === 'arrow' ? '+1 ARROW' : '+1 SPEAR', 'heal', { life: 0.9 });
    }
  },

  swing(m) {
    if (m.id === state.myId) return;
    const pl = state.players.get(m.id);
    if (!pl) return;
    pl.model.playSwing(pl.wpn.windup);
    sound.play('whiff', distTo(pl.rp));
  },

  dmg(m) {
    const v = state.players.get(m.v);
    if (!v) return;
    v.hp = m.hp;
    v.model.setHp(m.hp);
    v.model.hurt();
    const up = v3(v.rp);
    const pos = m.pos ? v3(m.pos) : up.clone().multiplyScalar(R + v.rh + 1.3);
    const d = distTo(v.rp);
    if (m.k !== 'bleed') {
      const big = m.hs || m.cr || m.d >= 40;
      const label = m.hs ? `HEAD BONK! ${m.d}` : m.cr ? `BIG BONK! ${m.d}` : `${m.d}`;
      fx.float(pos, label, big ? 'dmg big' : 'dmg', { offset: 0.4 });
    }
    if (m.k === 'melee') {
      fx.burst(pos, { count: 12, color: '#ffe066', speed: 5, size: 0.09, life: 0.5, emissive: true });
      sound.play('bonk', d);
      if (Math.random() < 0.4) fx.float(pos, pick(['BONK!', 'WHACK!', 'THWOMP!', 'CRONCH!']), 'ooga', { offset: 1.2, life: 0.9 });
    } else if (['spear', 'arrow', 'ball', 'bullet', 'self'].includes(m.k)) {
      fx.burst(pos, { count: m.k === 'spear' || m.k === 'ball' ? 9 : 5, color: '#a8201a', speed: 4, size: 0.09, life: 0.7, up });
      sound.play('stab', d);
    } else if (m.k === 'laser') {
      fx.burst(pos, { count: 8, color: '#7fe8ff', speed: 4, size: 0.07, life: 0.4, emissive: true });
      fx.puff(pos, { color: '#5d5550', size: 0.4, grow: 2, life: 0.8, alpha: 0.4 });
    } else if (m.k === 'boulder') {
      fx.burst(pos, { count: 14, color: '#8a8578', speed: 6, size: 0.15, life: 0.9, up });
      sound.play('bonk', d);
      fx.float(pos, 'SQUISH!', 'ooga', { offset: 1.2 });
    } else if (m.k === 'bleed') {
      fx.burst(pos, { count: 3, color: '#a8201a', speed: 1.5, size: 0.07, life: 0.6 });
    }
    // armor took part of it
    if (m.ab > 0) {
      fx.burst(pos, { count: 8, color: '#dbe8ff', speed: 5, size: 0.07, life: 0.35, emissive: true });
      fx.float(pos, `BLOCK ${m.ab}`, 'block', { offset: 0.9, life: 0.9 });
      sound.play('clang', d);
    }
    if (m.ad != null) {
      v.model.setArmorDur(m.ad);
      if (v.armor) v.armor.dur = m.ad;
    }

    if (m.v === state.myId) {
      me.hp = m.hp;
      hud.setHp(m.hp);
      if (me.armor && m.ad != null) me.armor.dur = m.ad;
      if (m.k !== 'bleed') {
        sound.play('hurt');
        fx.addShake(0.2 + m.d / 90);
        hud.flash(0.35 + m.d / 80);
        buzz(Math.min(90, 25 + m.d));
      } else {
        hud.flash(0.12);
      }
      if (m.kb) me.kbv = M.add(me.kbv, m.kb);
      const t = clock();
      if (m.st) { me.stunUntil = Math.max(me.stunUntil, t + m.st); me.charging = false; }
      if (m.sl) { me.slowUntil = Math.max(me.slowUntil, t + m.sl); hud.flash(0.5, 'slow'); }
    }
    if (m.a === state.myId && m.v !== state.myId) {
      if (m.k === 'melee') buzz(18);
      $('crosshair').classList.remove('hit');
      void $('crosshair').offsetWidth;
      $('crosshair').classList.add('hit');
    }
  },

  heal(m) {
    const pl = state.players.get(m.id);
    if (!pl) return;
    pl.hp = m.hp;
    pl.model.setHp(m.hp);
    if (m.id === state.myId) { me.hp = m.hp; hud.setHp(m.hp); sound.play('heal'); }
    fx.float(v3(pl.rp).multiplyScalar(R + pl.rh + 2.2), `+${m.n}`, 'heal', { life: 0.9 });
  },

  die(m) {
    const v = state.players.get(m.v), k = state.players.get(m.a);
    const line = killText(m, v, k);
    // the end of the world takes everybody at once; one feed line is plenty
    if (m.k !== 'doom' || m.v === state.myId) hud.feed(line);
    if (v) {
      v.alive = false;
      v.hp = 0;
      if (m.k !== 'doom') v.d++;
      v.streak = 0;
      v.model.setHp(0);
      v.model.die();
      if (m.k === 'doom' && state.game.disaster === 'freeze') encaseInIce(v);
      sound.play('die', distTo(v.rp));
      fx.burst(v3(v.rp).multiplyScalar(R + 1), { count: 16, color: '#f3e7c8', speed: 5, size: 0.12, life: 1.1, up: v3(v.rp) });
    }
    if (k) {
      k.k++;
      if (!C.BEASTS[m.k]) k.streak++;
      if (m.k !== 'doom' && Math.random() < 0.35) mammonSay(pick(C.MAMMON.gloat));
      const title = C.STREAKS[k.streak];
      if (title) {
        hud.feed(`<span class="streak">${esc(k.name)} ${title}</span>`);
        if (k.id === state.myId) sound.speak(title.toLowerCase(), { pitch: 0.25 });
      }
    }
    if (m.v === state.myId) {
      me.alive = false;
      me.deadAt = clock();
      me.charging = false;
      me.deathText = line;
      hud.deathQuote(pick(C.BUTLER.quotes), C.BUTLER.by);   // something to think about while you nap
      sound.speak(pick(['ugh', 'oof', 'ow ow ow']), { pitch: 0.1 });
      buzz([60, 40, 120]);
    }
    if (m.a === state.myId && m.v !== state.myId) {
      const title = C.STREAKS[k?.streak];
      hud.center(`YOU BONK ${playerName(v).toUpperCase()}!`, title || pick(['BOOGA!', 'ME STRONGEST!', 'GO SLEEP, SMALL BRAIN!', 'TRIBE PROUD!', 'MORE MEAT FOR ME!']), 2.4);
      sound.play('kill');
      if (!title) sound.speak(pick(['booga!', 'ooga ooga!', 'me win!']), { pitch: 0.3 });
    }
    updateOnline();
  },

  respawn(m) {
    const pl = state.players.get(m.id);
    if (!pl) return;
    Object.assign(pl, { alive: true, hp: PLAYER.maxHp, wpn: m.wpn, armor: null, snaps: [], rp: m.p, rf: m.f, rh: 0, speed: 0, buffs: {} });
    pl.model.revive();
    pl.model.setWeapon(m.wpn);
    pl.model.setArmor(null);
    pl.model.place(m.p, m.f, 0);
    if (m.id === state.myId) {
      state.sq = m.sq;
      Object.assign(me, {
        p: m.p, f: m.f, h: 0, vh: 0, kbv: [0, 0, 0], alive: true, hp: PLAYER.maxHp, ammo: rangedDef().ammo,
        wpn: m.wpn, armor: null, stunUntil: 0, slowUntil: 0, charging: false, pitch: 0.32, aim: 0.32, buffs: {},
      });
      // however the phone is held now counts as "straight ahead"
      tilt.recenter();
      hud.death(false);
      hud.setHp(me.hp);
      hud.setWeapon(m.wpn);
      hud.center('WAKE UP!', `SPIRITS GIVE YOU ${m.wpn.name.toUpperCase()}`, 2.4);
    }
  },

  // a bot quoting Smedley Butler (in cave talk)
  say(m) {
    const pl = state.players.get(m.id);
    const text = C.BUTLER.shouts[m.q];
    if (!pl || !text) return;
    pl.model.playEmote();
    fx.float(v3(pl.rp).multiplyScalar(R + pl.rh), text, 'emote quote', { life: 3, rise: 0.4, follow: pl.model.root, offset: 3 });
    sound.speak(text.toLowerCase(), { pitch: 0.15, dist: distTo(pl.rp) });
    if (state.joined) hud.feed(`${esc(pl.name)}: <span class="quote">"${text}"</span> <span class="by">(SMEDLEY BUTLER)</span>`);
  },

  emote(m) {
    const pl = state.players.get(m.id);
    if (!pl) return;
    pl.model.playEmote();
    fx.float(v3(pl.rp).multiplyScalar(R + pl.rh), C.EMOTES[m.i], 'emote', { life: 1.8, rise: 0.5, follow: pl.model.root, offset: 2.9 });
    const pitch = 0.1 + (pl.id % 5) * 0.08;
    sound.speak(C.EMOTE_SPEECH[m.i], { pitch, dist: distTo(pl.rp) });
  },

  wpn(m) {
    const pl = state.players.get(m.id);
    if (!pl) return;
    pl.wpn = m.wpn;
    pl.model.setWeapon(m.wpn);
    if (m.id === state.myId) {
      me.wpn = m.wpn;
      hud.setWeapon(m.wpn);
      if (m.era) {
        hud.feed(`SPIRITS GIVE YOU <span class="me">${esc(m.wpn.name.toUpperCase())}</span>`);
      } else {
        sound.play('pickup');
        hud.center(`GOT ${m.wpn.name.toUpperCase()}!`, m.wpn.desc.toUpperCase(), 1.8);
      }
    }
  },

  pickup(m) { state.world?.setPickupWeapon(m.id, m.wpn); },

  erupt() {
    state.world?.erupt();
    state.eruptUntil = clock() + 4.5;
    sound.play('erupt');
    fx.addShake(0.5);
  },

  fb(m) { addFireball(m); },

  boom(m) {
    const fb = state.fireballs.get(m.id);
    if (fb) removeFireball(fb);
    const pos = v3(m.pos);
    const up = pos.clone().normalize();
    fx.explosion(pos, up);
    fx.decal(up, { radius: 2.3, color: '#1d1410', opacity: 0.55, life: 14 });
    const d = distTo(up.toArray());
    sound.play('boom', d);
    fx.addShake(Math.max(0, 0.9 - d / 25));
  },
};

function killText(m, v, k) {
  const vn = `<span class="${m.v === state.myId ? 'me' : ''}">${esc(playerName(v))}</span>`;
  const kn = `<span class="${m.a === state.myId ? 'me' : ''}">${esc(playerName(k))}</span>`;
  switch (m.k) {
    case 'spear': return m.hs ? `${kn} SPEAR ${vn} IN HEAD-ROCK` : `${kn} SPEAR ${vn}`;
    case 'arrow': return m.hs ? `${kn} SHOOT ${vn} RIGHT IN FACE` : `${kn} SHOOT ${vn} WITH BENDY STICK`;
    case 'ball': return m.hs ? `${kn} BOOM ${vn} IN HEAD-ROCK` : `${kn} BOOM ${vn} WITH BOOM STICK`;
    case 'bullet': return m.hs ? `${kn} BANG ${vn} RIGHT IN FACE` : `${kn} BANG BANG ${vn}`;
    case 'laser': return m.hs ? `${kn} ZAP ${vn} IN HEAD-ROCK` : `${kn} ZAP ${vn}`;
    case 'doom': return `${C.DISASTERS[state.game.disaster]?.kill ?? 'THE END GET'} ${vn}`;
    case 'melee': return `${kn} ${esc(m.vb || 'BONK')} ${vn} WITH ${esc(m.w.toUpperCase())}`;
    case 'self': return `${vn} HIT OWN SELF. OOGA SAD.`;
    case 'boulder': return k ? `${kn} PUSH ${vn} UNDER BIG ROCK` : `BIG ROCK FLATTEN ${vn}`;
    case 'fire': return k ? `${kn} FEED ${vn} TO MOUNTAIN` : `MOUNTAIN FIRE COOK ${vn}`;
    case 'bleed': return k ? `${vn} LEAK TOO MUCH (THANK ${kn})` : `${vn} LEAK TOO MUCH`;
    case 'dog': case 'mammoth': case 'trex':
      return `${kn}'S ${(m.w || C.BEASTS[m.k].name).toUpperCase()} ${C.BEASTS[m.k].verb} ${vn}`;
    default: return `${vn} GO SLEEP`;
  }
}

function distTo(p) {
  if (!state.joined || !state.myId || !p) return 0;
  return M.arcDist(me.p, p);
}

function updateOnline() {
  const all = [...state.players.values()];
  const bots = all.filter(p => p.bot).length;
  $('online').textContent = `${all.length} CAVEMEN ON ROCK${bots ? ` (${bots} BOT${bots > 1 ? 'S' : ''})` : ''}`;
  refreshRules();
}

// ====================================================================== entities
function addPlayer(p) {
  if (state.players.has(p.id)) return state.players.get(p.id);
  const model = new Caveman({ name: p.name, look: p.look, bot: p.bot });
  model.setWeapon(p.wpn);
  model.setRanged(rangedKey());
  model.setArmor(p.armor);
  model.setChief(p.id === state.game.chief);
  model.setTeam(teamOf(p));
  model.setHp(p.hp);
  model.place(p.p, p.f, p.h);
  scene.add(model.root);
  const ammo = rangedDef().ammo;
  const pl = {
    id: p.id, name: p.name, look: p.look, bot: p.bot, wpn: p.wpn, armor: p.armor, hp: p.hp, alive: p.alive, k: p.k, d: p.d,
    buffs: Object.fromEntries(Object.entries(p.buffs || {}).map(([k, left]) => [k, clock() + left])),
    model, snaps: [], rp: p.p, rf: p.f, rh: p.h, flags: 1 | (ammo << 5), ammo, speed: 0, streak: 0,
  };
  if (!p.alive) { model.die(); model.deadT = 10; }
  state.players.set(p.id, pl);
  updateOnline();
  return pl;
}

function orientSpear(s) {
  s.mesh.position.set(s.pos[0], s.pos[1], s.pos[2]);
  const dir = s.stuck ? s.dir : s.vel;
  if (M.len(dir) > 1e-6) s.mesh.quaternion.setFromUnitVectors(Z, _v.set(dir[0], dir[1], dir[2]).normalize());
}

// Spears and arrows stuck in the dirt pile up (each lasts 30 s), so the landed ones are drawn
// as one instanced mesh per kind instead of one mesh each.
const STUCK_CAP = 400;
const stuckPools = {};
const _sm = new THREE.Matrix4(), _sq = new THREE.Quaternion(), _one = new THREE.Vector3(1, 1, 1);

function stuckPool(kind) {
  if (!stuckPools[kind]) {
    const src = projTemplates[kind];
    const mesh = new THREE.InstancedMesh(src.geometry, src.material, STUCK_CAP);
    mesh.count = 0;
    mesh.frustumCulled = false;
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    scene.add(mesh);
    stuckPools[kind] = { mesh, owners: [] };
  }
  return stuckPools[kind];
}

function poolAdd(s) {
  const pool = stuckPool(s.kind);
  if (pool.mesh.count >= STUCK_CAP) return false;
  const i = pool.mesh.count++;
  _sq.setFromUnitVectors(Z, _v.set(s.dir[0], s.dir[1], s.dir[2]).normalize());
  _sm.compose(_w.set(s.pos[0], s.pos[1], s.pos[2]), _sq, _one);
  pool.mesh.setMatrixAt(i, _sm);
  pool.mesh.instanceMatrix.needsUpdate = true;
  pool.owners[i] = s;
  s.inst = i;
  return true;
}

// Swap the last instance into the freed slot so the live ones stay packed.
function poolRemove(s) {
  const pool = stuckPools[s.kind];
  const last = --pool.mesh.count;
  if (s.inst !== last) {
    pool.mesh.getMatrixAt(last, _sm);
    pool.mesh.setMatrixAt(s.inst, _sm);
    const moved = pool.owners[last];
    pool.owners[s.inst] = moved;
    moved.inst = s.inst;
  }
  pool.owners.length = last;
  pool.mesh.instanceMatrix.needsUpdate = true;
  s.inst = -1;
}

function clearStuckPools() {
  for (const p of Object.values(stuckPools)) { p.mesh.count = 0; p.owners.length = 0; }
}

// kind: 'spear' | 'arrow' (just the look; the server owns damage)
function addSpear(id, owner, pos, vel, stuck = null, kind = 'spear') {
  const mesh = (projTemplates[kind] || projTemplates.spear).clone();
  scene.add(mesh);
  const s = { id, owner, kind, mesh, pos: pos.slice(), vel: vel.slice(), stuck: false, dir: null, acc: 0, age: 0, trail: 0, tid: 0, inst: -1, hidden: false };
  if (stuck) setStuck(s, stuck.pos, stuck.dir);
  else orientSpear(s);
  if (id != null) state.spears.set(id, s);
  return s;
}

// The server says where it landed: hand it to the instanced pile (or keep a mesh if that's full).
function setStuck(s, pos, dir) {
  s.stuck = true;
  s.pos = pos.slice();
  s.dir = dir.slice();
  if (s.inst >= 0) poolRemove(s);
  if ((s.kind === 'spear' || s.kind === 'arrow') && poolAdd(s)) {
    s.mesh.removeFromParent();
    return;
  }
  orientSpear(s);
}

function dropSpear(s) {
  if (s.inst >= 0) poolRemove(s);
  s.mesh.removeFromParent();
}

function removeSpear(id) {
  const s = state.spears.get(id);
  if (!s) return;
  dropSpear(s);
  state.spears.delete(id);
}

function updateSpears(dt, t) {
  const obstacles = state.world ? state.world.obstacles : [];
  const step = s => {
    if (s.stuck) return;
    s.age += dt;
    s.acc += dt;
    while (s.acc >= PHYS) {
      s.acc -= PHYS;
      M.stepProjectile(s.pos, s.vel, PHYS);
      const ground = M.len(s.pos) <= R;
      if (ground || M.obstacleAt(s.pos, obstacles)) {
        // predicted landing; the server's 'stuck' event has the final say
        s.stuck = true;
        s.dir = M.norm(s.vel);
        if (ground) s.pos = M.scale(M.norm(s.pos), R - (s.kind === 'arrow' ? 0.18 : 0.3));
        // musket balls and bullets don't stick around; the server's impact event shows the dirt
        if (s.kind === 'ball' || s.kind === 'bullet') s.hidden = true;
        break;
      }
    }
    orientSpear(s);
    if (s.kind !== 'bullet' && (s.trail -= dt) <= 0) {
      s.trail = s.kind === 'spear' ? 0.035 : 0.025;
      const smoky = s.kind === 'ball';
      fx.puff(s.mesh.position, { color: smoky ? '#d8d2c8' : '#fff6e0', size: s.kind === 'spear' ? 0.25 : 0.14, grow: smoky ? 1.5 : 0.3, life: smoky ? 0.7 : 0.3, alpha: 0.35 });
    }
  };
  for (const s of state.spears.values()) step(s);
  for (const [tid, s] of state.pending) {
    step(s);
    if (s.age > 1.5) { s.mesh.removeFromParent(); state.pending.delete(tid); }
  }
}

// Armor lying on the planet: a little stand with a glow ring and beam in the armor's color.
function addArmorDrop(a) {
  if (state.armorDrops.has(a.id)) return;
  const color = C.ARMORS[a.armor.type]?.color || '#ffffff';
  const group = new THREE.Group();
  const stand = buildArmorDisplay(a.armor.type);
  group.add(stand);
  const ring = new THREE.Mesh(
    new THREE.RingGeometry(0.9, 1.15, 28).rotateX(-Math.PI / 2),
    new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.6, depthWrite: false, side: THREE.DoubleSide }),
  );
  ring.position.y = 0.05;
  const beam = new THREE.Mesh(
    new THREE.CylinderGeometry(0.25, 0.5, 6, 10, 1, true),
    new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.12, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide }),
  );
  beam.position.y = 3.2;
  group.add(ring, beam);
  standOn(group, v3(a.u), Math.random() * 6);
  scene.add(group);
  state.armorDrops.set(a.id, { ...a, group, stand, ring, t: Math.random() * 6 });
  if (state.joined) fx.burst(group.position.clone().addScaledVector(v3(a.u), 1), { count: 14, color, speed: 4, size: 0.1, life: 0.8, up: v3(a.u), emissive: true });
}

function removeArmorDrop(id) {
  const a = state.armorDrops.get(id);
  if (!a) return;
  a.group.removeFromParent();
  a.group.traverse(o => {
    if (!o.isMesh) return;
    o.geometry.dispose();
    if (o === a.ring || o.parent === a.group) o.material.dispose?.();
  });
  state.armorDrops.delete(id);
}

// What a slain caveman left: their weapon lying on the grass (E / GRAB takes it, yours goes down
// in its place), or a hide pouch of their ammo (walk over it when you're short).
const LOOT_RING = new THREE.RingGeometry(0.62, 0.8, 24).rotateX(-Math.PI / 2);
const POUCH = new THREE.SphereGeometry(0.3, 9, 7).scale(1, 0.75, 1);

function addLoot(l) {
  removeLoot(l.id);
  l = { ...l, u: M.norm(l.u) };   // positions arrive rounded; arcDist wants unit vectors
  const color = l.wpn ? C.TIER_COLORS[l.wpn.tier] || '#ffffff' : '#ffe066';
  const group = new THREE.Group();
  const item = new THREE.Group();
  const own = [];   // geometry made just for this loot, to free later
  if (l.wpn) {
    const w = buildWeapon(l.wpn);
    w.traverse(o => { if (o.isMesh) own.push(o.geometry); });
    w.rotation.x = Math.PI / 2;   // lying on its side
    w.position.set(0, 0.22, -0.5);
    item.add(w);
  } else {
    item.add(new THREE.Mesh(POUCH, mat('#8a5a2b', { flatShading: true })));
    item.children[0].position.y = 0.24;
    // spears and arrows poke out of the pouch; the rest is just the pouch
    const kind = C.RANGED[l.w]?.proj;
    if (projTemplates[kind] && (kind === 'spear' || kind === 'arrow')) {
      for (const tilt of [-0.35, 0.35]) {
        const p = projTemplates[kind].clone();
        p.scale.setScalar(kind === 'spear' ? 0.55 : 0.9);
        p.rotation.set(-1.1, tilt, 0);
        p.position.y = 0.3;
        item.add(p);
      }
    }
  }
  const ring = new THREE.Mesh(LOOT_RING, new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.6, depthWrite: false, side: THREE.DoubleSide }));
  ring.position.y = 0.04;
  group.add(item, ring);
  standOn(group, v3(l.u), Math.random() * 6);
  scene.add(group);
  state.loot.set(l.id, { ...l, group, item, ring, own, t: Math.random() * 6 });
}

function removeLoot(id) {
  const l = state.loot.get(id);
  if (!l) return;
  l.group.removeFromParent();
  for (const g of l.own) g.dispose();
  l.ring.material.dispose();
  state.loot.delete(id);
}

function clearLoot() {
  for (const id of [...state.loot.keys()]) removeLoot(id);
}

function updateLoot(dt) {
  for (const l of state.loot.values()) {
    if (!l.group.visible) continue;
    l.t += dt;
    l.item.rotation.y += dt * 0.6;
    l.ring.material.opacity = 0.4 + Math.sin(l.t * 3) * 0.2;
  }
}

// ====================================================================== magic mushrooms
// A big glowing toadstool in its kind's colour, with a ring and a slow bob. Walk over it to eat.
const SHROOM_STEM = new THREE.CylinderGeometry(0.12, 0.16, 0.5, 8).translate(0, 0.25, 0);
const SHROOM_CAP = new THREE.SphereGeometry(0.38, 12, 7, 0, Math.PI * 2, 0, Math.PI / 2).scale(1, 0.75, 1).translate(0, 0.46, 0);
const SHROOM_SPOT = new THREE.SphereGeometry(0.06, 6, 4);

const buffOn = (pl, kind) => ((pl === me ? me.buffs : pl?.buffs)?.[kind] || 0) > clock();

function addShroom(m) {
  removeShroom(m.id);
  const def = C.SHROOMS[m.kind];
  const u = M.norm(m.u);
  const group = new THREE.Group();
  const item = new THREE.Group();
  item.add(new THREE.Mesh(SHROOM_STEM, mat('#f2ead4', { flatShading: true })));
  const capMat = new THREE.MeshLambertMaterial({ color: def.color, emissive: def.color, emissiveIntensity: 0.35, flatShading: true });
  item.add(new THREE.Mesh(SHROOM_CAP, capMat));
  // spots sit on the cap (a squashed half ball, radius 0.38 and 0.285 tall at y 0.46), poking out a bit
  for (let i = 0; i < 7; i++) {
    const a = (i / 6) * Math.PI * 2 + 0.4, r = i === 6 ? 0 : i % 2 ? 0.27 : 0.15;
    const spot = new THREE.Mesh(SHROOM_SPOT, mat(def.spots, { emissive: def.spots, emissiveIntensity: 0.45 }));
    spot.position.set(Math.cos(a) * r, 0.46 + 0.285 * Math.sqrt(1 - (r / 0.38) ** 2) - 0.02, Math.sin(a) * r);
    item.add(spot);
  }
  const ring = new THREE.Mesh(LOOT_RING, new THREE.MeshBasicMaterial({ color: def.color, transparent: true, opacity: 0.55, depthWrite: false, side: THREE.DoubleSide }));
  ring.position.y = 0.04;
  group.add(item, ring);
  standOn(group, v3(u), Math.random() * 6);
  scene.add(group);
  state.shrooms.set(m.id, { ...m, u, group, item, ring, capMat, t: Math.random() * 6 });
}

function removeShroom(id) {
  const s = state.shrooms.get(id);
  if (!s) return;
  s.group.removeFromParent();
  s.capMat.dispose();
  s.ring.material.dispose();
  state.shrooms.delete(id);
}

function updateShrooms(dt) {
  for (const s of state.shrooms.values()) {
    if (!s.group.visible) continue;
    s.t += dt;
    s.item.position.y = Math.sin(s.t * 2) * 0.06;
    s.item.rotation.y += dt * 0.5;
    s.capMat.emissiveIntensity = 0.3 + Math.sin(s.t * 3) * 0.15;
    s.ring.material.opacity = 0.35 + Math.sin(s.t * 3) * 0.2;
    if (Math.random() < dt * 2) {
      const up = v3(s.u);
      fx.burst(up.clone().multiplyScalar(R + 0.8), { count: 1, color: C.SHROOMS[s.kind].color, speed: 0.6, size: 0.06, life: 1, grav: -0.1, up, emissive: true });
    }
  }
}

// ====================================================================== the Businessman
// How fat: the ages so far (Do Time and co-op) plus every bonk on the planet. Forever Stone has
// no ages, so there it's all bonks. Profit is what the round-end screen and his sign say.
function mammonGrowth() {
  const g = state.game;
  let kills = 0;
  for (const p of state.players.values()) kills += p.k || 0;
  const ages = g.mode === 'classic' ? 0 : g.era + (g.mode === 'dotime' && g.phase === 'play' ? Math.min(1, 1 - clockLeft() / (g.eraLen || g.eraSeconds || 45)) : 0);
  const fat = g.mode === 'classic'
    ? Math.min(1, 0.05 + kills * 0.012)
    : Math.min(1, 0.05 + (ages / (C.ERAS.length - 1)) * 0.7 + Math.min(0.3, kills * 0.005));
  const profit = kills * C.MAMMON.profitPerBonk + Math.floor(ages) * C.MAMMON.profitPerAge;
  return { fat, profit };
}

// He speaks (bubble over his head, a fat little laugh, a cash register) if he hasn't just.
function mammonSay(text, { force = false, feed = false } = {}) {
  const mm = state.world?.mammon;
  if (!mm || mm.dead || (!force && clock() - state.mammonSaid < 7)) return;
  state.mammonSaid = clock();
  mm.laugh();
  const at = mm.headPosition(new THREE.Vector3());
  const d = M.arcDist(me.p, C.MAMMON.at);
  if (state.joined && d < 45) {
    fx.float(at.addScaledVector(at.clone().normalize(), 1.2), text, 'emote quote mammon', { life: 3.4, rise: 0.3 });
    sound.play('chaching', d);
    sound.speak(text.toLowerCase().replace('cha-ching', ''), { pitch: 0.05, dist: d });
  }
  if (feed && state.joined) hud.feed(`<span class="mammon">THE BUSINESSMAN:</span> <span class="quote">"${esc(text)}"</span>`);
}

function updateMammon(dt) {
  const mm = state.world?.mammon;
  if (!mm) return;
  if (state.game.mmDead && !mm.dead) mm.die(true);        // joined after the end of the world got him
  else if (!state.game.mmDead && mm.dead) mm.revive();    // a new world, a new Businessman
  const { fat, profit } = mammonGrowth();
  mm.setFat(fat, profit);
  mm.update(dt, state.joined && state.myId ? v3(me.p).multiplyScalar(R + me.h + 1.6) : camera.position);
}

// ====================================================================== killstreak beasts
// mine (gold name), on my side in co-op (green) or out to get me (red)
function beastTeam(b) {
  if (b.owner === state.myId) return 'mine';
  const owner = state.players.get(b.owner);
  return owner && isAlly(owner) ? 'ally' : 'foe';
}

const BEAST_CALL = { dog: 'bark', mammoth: 'trumpet', trex: 'roar' };

function addBeast(m, fresh = true) {
  removeBeast(m.id, false);
  const owner = state.players.get(m.owner);
  const def = C.BEASTS[m.kind];
  const b = {
    id: m.id, kind: m.kind, name: m.name || def.name, owner: m.owner, rp: m.p, rf: m.f, rh: m.h || 0, hp: m.hp, maxHp: m.maxHp,
    until: clock() + (m.left ?? def.life), snaps: [], speed: 0,
  };
  b.model = new Beast(m.kind, { label: `${owner ? owner.name : 'WILD'}'S ${b.name}`, team: beastTeam(b), look: m.look });
  b.model.setHp(m.hp);
  b.model.place(b.rp, b.rf, b.rh);
  if (!fresh) b.model.spawnT = 9;   // already out when we arrived: no rising out of the ground
  scene.add(b.model.root);
  state.beasts.set(b.id, b);
  if (m.owner === state.myId) { me.beastId = b.id; me.reward = null; }
  if (fresh) {
    const up = v3(b.rp);
    fx.dust(up.clone().multiplyScalar(R), up, 14);
    fx.burst(up.clone().multiplyScalar(R + 0.5), { count: 24, color: '#8a6a45', speed: 7, size: 0.16, life: 1, up });
    fx.addShake(Math.max(0, 0.5 - distTo(b.rp) / 60));
    sound.play(BEAST_CALL[m.kind], distTo(b.rp));
    if (state.joined) hud.feed(`<span class="streak">${esc(playerName(owner))} CALL ${def.icon} ${b.name.toUpperCase()}!</span>`);
  }
  return b;
}

// slain: keel over first; otherwise (wandered off, new round) it just goes
function removeBeast(id, slain) {
  const b = state.beasts.get(id);
  if (!b) return;
  state.beasts.delete(id);
  if (me.beastId === id) me.beastId = 0;
  if (slain) {
    b.model.die();
    state.dyingBeasts.push({ model: b.model, t: 0 });
  } else b.model.dispose();
}

function clearBeasts() {
  for (const id of [...state.beasts.keys()]) removeBeast(id, false);
  for (const d of state.dyingBeasts) d.model.dispose();
  state.dyingBeasts.length = 0;
}

function updateBeasts(dt, renderT) {
  for (const b of state.beasts.values()) {
    const s = sampleSnaps(b.snaps, renderT);
    if (s) {
      const moved = M.arcDist(b.rp, s.p);
      b.speed += (moved / Math.max(dt, 1e-4) - b.speed) * Math.min(1, dt * 8);
      b.rp = s.p;
      b.rf = s.f;
      b.rh = s.h;
    }
    b.model.place(b.rp, b.rf, b.rh);
    b.model.update(dt, b.speed);
    // heavy things shake the ground
    if (b.kind !== 'dog' && b.speed > 2 && Math.random() < dt * 2.5) {
      const up = v3(b.rp);
      fx.dust(up.clone().multiplyScalar(R), up, 2);
      const d = distTo(b.rp);
      if (d < 25) fx.addShake((b.kind === 'trex' ? 0.12 : 0.08) * (1 - d / 25));
    }
  }
  for (let i = state.dyingBeasts.length - 1; i >= 0; i--) {
    const d = state.dyingBeasts[i];
    d.t += dt;
    d.model.update(dt, 0);
    if (d.t > 3) { d.model.dispose(); state.dyingBeasts.splice(i, 1); }
  }
}

// Q: call my beast, or send it at whoever (or wherever) I'm aiming.
const _ray = new THREE.Vector3();
function beastCommand() {
  if (!me.beastId && !me.reward) {
    fx.float(v3(me.p).multiplyScalar(R + 2.2), 'NO BEAST. BONK 3 IN A ROW.', 'ooga', { life: 1.4 });
    return;
  }
  if (!me.beastId) { send({ t: 'beast' }); return; }
  // the caveman closest to the crosshair, if any is near it
  const cam = camera.position;
  camera.getWorldDirection(_ray);
  let target = 0, best = 0.09;
  for (const p of state.players.values()) {
    if (p.id === state.myId || !p.alive || isAlly(p)) continue;
    const to = v3(p.rp).multiplyScalar(R + p.rh + 1.1).sub(cam);
    const dist = to.length();
    if (dist > 70) continue;
    const ang = to.normalize().angleTo(_ray);
    if (ang < best) { best = ang; target = p.id; }
  }
  // otherwise the spot on the ground under the crosshair (or straight ahead when aiming at the sky)
  let u;
  const b = cam.dot(_ray), c = cam.lengthSq() - R * R, disc = b * b - c;
  if (disc > 0) u = cam.clone().addScaledVector(_ray, -b - Math.sqrt(disc)).normalize().toArray();
  else u = M.moveOnSphere(me.p, me.f, me.f, 20)[0];
  send({ t: 'beast', target, u: r4(u) });
}

// the "Q" panel: what's waiting, or what's out and for how long
function updateBeastHud(t) {
  const out = state.beasts.get(me.beastId);
  const kind = out ? out.kind : me.reward;
  $('beast-slot').classList.toggle('hidden', !kind || !state.joined);
  touch?.setBeast(kind ? C.BEASTS[kind].icon : null, out ? 'SEND' : 'CALL');
  if (!kind) return;
  const def = C.BEASTS[kind];
  const key = out ? 'Q · SEND IT WHERE YOU AIM' : 'Q · CALL IT';
  const left = out ? Math.max(0, Math.ceil(out.until - clock())) : 0;
  const text = `${def.icon} ${def.name.toUpperCase()}${out ? ` · ${left}s` : ' READY!'}`;
  if (state.beastHudText !== text + key) {
    state.beastHudText = text + key;
    $('beast-name').textContent = text;
    $('beast-key').textContent = isTouch ? (out ? 'TAP BEAST · SEND IT WHERE YOU AIM' : 'TAP BEAST · CALL IT') : key;
  }
  $('beast-fill').style.width = out ? `${Math.max(0, out.hp / out.maxHp) * 100}%` : '100%';
  $('beast-slot').classList.toggle('ready', !out);
}

function updateArmorDrops(dt) {
  for (const a of state.armorDrops.values()) {
    a.t += dt;
    a.stand.rotation.y += dt * 0.8;
    a.stand.position.y = 0.15 + Math.sin(a.t * 2) * 0.1;
    a.ring.material.opacity = 0.45 + Math.sin(a.t * 3) * 0.15;
  }
}

function addBoulder(b) {
  const geo = new THREE.IcosahedronGeometry(b.r, 1);
  const p = geo.attributes.position;
  for (let i = 0; i < p.count; i++) {
    _v.fromBufferAttribute(p, i);
    _v.multiplyScalar(1 + (noise3(_v.x * 2.2 + b.id * 9, _v.y * 2.2, _v.z * 2.2) - 0.5) * 0.25);
    p.setXYZ(i, _v.x, _v.y, _v.z);
  }
  geo.computeVertexNormals();
  const mesh = new THREE.Mesh(geo, mat('#80776a', { flatShading: true }));
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  // a cave painting on the side, because why not
  const stripe = new THREE.Mesh(new THREE.TorusGeometry(b.r * 0.98, 0.06, 4, 20), mat('#a8402a'));
  mesh.add(stripe);
  scene.add(mesh);
  state.boulders.set(b.id, { id: b.id, mesh, r: b.r, rp: b.p, rf: b.f, snaps: [], q: new THREE.Quaternion(), dust: 0 });
}

function sampleSnaps(snaps, rt) {
  const n = snaps.length;
  if (!n) return null;
  if (rt <= snaps[0].t) return snaps[0];
  for (let i = n - 1; i >= 0; i--) {
    if (snaps[i].t > rt) continue;
    const a = snaps[i], b = snaps[i + 1];
    if (!b) return a;
    const k = (rt - a.t) / Math.max(1e-6, b.t - a.t);
    const lerp3 = (x, y) => [x[0] + (y[0] - x[0]) * k, x[1] + (y[1] - x[1]) * k, x[2] + (y[2] - x[2]) * k];
    const p = M.norm(lerp3(a.p, b.p));
    return { p, f: M.tangent(p, lerp3(a.f, b.f)), h: a.h !== undefined ? a.h + (b.h - a.h) * k : 0 };
  }
  return snaps[0];
}

function updateBoulders(dt, renderT) {
  let nearest = Infinity;
  for (const b of state.boulders.values()) {
    const s = sampleSnaps(b.snaps, renderT);
    if (s) {
      const dist = M.arcDist(b.rp, s.p);
      if (dist > 1e-5 && dist < 5) {
        const moveDir = M.towardDir(b.rp, s.p);
        const axis = M.norm(M.cross(b.rp, moveDir));
        b.q.premultiply(new THREE.Quaternion().setFromAxisAngle(_v.set(axis[0], axis[1], axis[2]), dist / b.r));
      }
      b.rp = s.p;
      b.rf = s.f;
    }
    b.mesh.position.set(b.rp[0], b.rp[1], b.rp[2]).multiplyScalar(R + b.r * 0.92);
    b.mesh.quaternion.copy(b.q);
    if ((b.dust -= dt) <= 0) {
      b.dust = 0.12;
      const up = v3(b.rp);
      fx.dust(up.clone().multiplyScalar(R).addScaledVector(v3(b.rf), -b.r * 0.8), up, 1);
    }
    if (state.myId) nearest = Math.min(nearest, M.arcDist(me.p, b.rp));
  }
  sound.setRumble(state.joined ? Math.max(0, 1 - nearest / 22) : 0);
}

function addFireball(m) {
  const mesh = new THREE.Mesh(new THREE.IcosahedronGeometry(0.5, 1), new THREE.MeshBasicMaterial({ color: '#ffb347' }));
  const core = new THREE.Mesh(new THREE.IcosahedronGeometry(0.62, 0), new THREE.MeshBasicMaterial({ color: '#ff4d12', transparent: true, opacity: 0.55 }));
  mesh.add(core);
  scene.add(mesh);
  const fb = { id: m.id, mesh, pos: m.pos.slice(), vel: m.vel.slice(), acc: 0, trail: 0, landed: false, rings: [] };
  if (m.land) {
    const u = v3(m.land).normalize();
    fb.rings.push(fx.decal(u, { radius: VOLCANO.blast, inner: VOLCANO.blast - 0.3, color: '#ff3d1f', opacity: 0.9, pulse: true }));
    fb.rings.push(fx.decal(u, { radius: VOLCANO.blast, color: '#ff3d1f', opacity: 0.18 }));
    fb.landU = u.toArray();
  }
  state.fireballs.set(m.id, fb);
}

function removeFireball(fb) {
  fb.mesh.removeFromParent();
  fb.mesh.geometry.dispose();
  for (const r of fb.rings) r.remove();
  state.fireballs.delete(fb.id);
}

function updateFireballs(dt) {
  for (const fb of state.fireballs.values()) {
    if (fb.landed) continue;
    fb.acc += dt;
    while (fb.acc >= PHYS) {
      fb.acc -= PHYS;
      M.stepProjectile(fb.pos, fb.vel, PHYS);
      if (M.len(fb.pos) <= R) { fb.landed = true; fb.mesh.visible = false; break; }
    }
    fb.mesh.position.set(fb.pos[0], fb.pos[1], fb.pos[2]);
    fb.mesh.rotation.x += dt * 5;
    if ((fb.trail -= dt) <= 0) {
      fb.trail = 0.03;
      fx.puff(fb.mesh.position, { color: '#ff8a2a', size: 1.1, grow: 0.2, life: 0.35, alpha: 0.9, additive: true });
      fx.puff(fb.mesh.position, { color: '#3a302a', size: 0.8, grow: 2.5, life: 1.4, alpha: 0.4 });
    }
  }
}

// ====================================================================== local player
const arcGeo = new THREE.BufferGeometry();
arcGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(3 * 140), 3));
const arcPoints = new THREE.Points(arcGeo, new THREE.PointsMaterial({ color: '#fff3d0', size: 0.2, transparent: true, opacity: 0.9, depthWrite: false }));
arcPoints.frustumCulled = false;
arcPoints.visible = false;
scene.add(arcPoints);
const landRing = new THREE.Mesh(
  new THREE.RingGeometry(0.45, 0.72, 24).rotateX(-Math.PI / 2),
  new THREE.MeshBasicMaterial({ color: '#ffb52e', transparent: true, opacity: 0.85, depthWrite: false, side: THREE.DoubleSide }),
);
landRing.visible = false;
scene.add(landRing);

function aimSolution(charge) {
  const def = rangedDef();
  const speed = M.lerp(def.minSpeed, def.maxSpeed, charge);
  const elev = def.lift - me.pitch;
  const dir = M.norm(M.add(M.scale(me.f, Math.cos(elev)), M.scale(me.p, Math.sin(elev))));
  const right = M.cross(me.f, me.p);
  // from the throwing hand: right of the head, or left for the left-handed
  const pos = M.add(M.scale(me.p, R + me.h + 1.65), M.add(M.scale(me.f, 0.25), M.scale(right, settings.get('lefty') ? -0.3 : 0.3)));
  return { pos, dir, vel: M.scale(dir, speed) };
}

function updateArc() {
  const def = rangedDef();
  // guns and lasers shoot flat and fast; the dotted arc is for things that fly in a curve
  if (!me.charging || !me.alive || def.auto || def.hitscan) { arcPoints.visible = landRing.visible = false; return; }
  const { pos, vel } = aimSolution(me.charge);
  const arr = arcGeo.attributes.position.array;
  let n = 0, step = 0;
  const hit = M.traceArc(pos, vel, state.world.obstacles, 3.5, PHYS, p => {
    if (step++ % 3 === 0 && n < 140) arr.set(p, 3 * n++);
  });
  arcGeo.setDrawRange(0, n);
  arcGeo.attributes.position.needsUpdate = true;
  arcPoints.visible = true;
  landRing.visible = !!(hit && hit.ground);
  if (landRing.visible) standOn(landRing, v3(hit.pos).normalize(), 0, 0.06);
}

const SHOUTS = {
  spear: ['HUAH!', 'OOGA!', 'HNNG!', 'YAH!', 'TAKE POINTY!'],
  arrow: ['TWANG!', 'FLY, POINTY!', 'PEW!', 'OOGA!'],
  ball: ['BOOM!', 'KA-BLAM!', 'SMOKE!', 'OOGA BOOM!'],
};
const SHOT_SOUND = { spear: 'throw', arrow: 'twang', ball: 'musket', bullet: 'gun', laser: 'laser' };

// Flash, smoke and noise at the shooter for any kind of shot.
function shotEffects(kind, pos, dir, dist) {
  sound.play(SHOT_SOUND[kind] || 'throw', dist);
  if (kind === 'ball') {
    fx.burst(pos, { count: 8, color: '#ffb347', speed: 6, size: 0.06, life: 0.25, up: dir, spread: 0.4, emissive: true });
    for (let i = 0; i < 4; i++) {
      fx.puff(pos.clone().addScaledVector(dir, 0.3 + i * 0.35), { color: '#e8e4dc', size: 0.8 + i * 0.25, grow: 3, life: 2.2, vel: dir.clone().multiplyScalar(1.2), alpha: 0.6 });
    }
  } else if (kind === 'bullet') {
    fx.puff(pos, { color: '#ffd27a', size: 0.45, grow: 0.4, life: 0.06, alpha: 1, additive: true });
  } else if (kind === 'laser') {
    fx.puff(pos, { color: '#7fe8ff', size: 0.5, grow: 0.5, life: 0.1, alpha: 1, additive: true });
  }
}

function zapImpact(pos, hitSomeone) {
  fx.puff(pos, { color: '#7fe8ff', size: hitSomeone ? 0.9 : 0.6, grow: 0.5, life: 0.18, alpha: 1, additive: true });
  if (!hitSomeone) fx.burst(pos, { count: 4, color: '#ffb347', speed: 2.5, size: 0.05, life: 0.3, emissive: true });
}

// Where our own laser would stop (ground, obstacle, caveman), so the beam can be drawn instantly.
function traceZap(pos, dir, range) {
  for (let s = 0.4; s <= range; s += 0.25) {
    const p = M.madd(pos, dir, s);
    if (M.len(p) <= R || M.obstacleAt(p, state.world.obstacles)) return p;
    for (const o of state.players.values()) {
      if (o.id !== state.myId && o.alive && !isAlly(o) && M.hitPlayer(p, o.rp, o.rh, rangedDef().hitRadius)) return p;
    }
    // beasts that aren't mine (or my tribe's) stop the beam too
    const r = M.len(p);
    for (const b of state.beasts.values()) {
      if (beastTeam(b) !== 'foe') continue;
      const def = C.BEASTS[b.kind];
      const hgt = r - R - b.rh;
      if (hgt > -0.3 && hgt < def.height && M.arcDist(M.scale(p, 1 / r), b.rp) < def.radius) return p;
    }
  }
  return M.madd(pos, dir, range);
}

function fireRanged(t, charge) {
  const def = rangedDef();
  let { pos, vel, dir: aim } = aimSolution(charge);
  if (def.spread) {
    const right = M.cross(me.f, me.p);
    vel = M.rotateAxis(vel, me.p, (Math.random() - 0.5) * 2 * def.spread);
    vel = M.rotateAxis(vel, right, (Math.random() - 0.5) * 2 * def.spread);
  }
  if (!def.auto) me.charging = false;
  me.lastThrow = t;
  me.ammo = Math.max(0, me.ammo - 1);
  // a laser has no speed (it's instant), so its direction comes from the aim, not the velocity
  const dir = v3(def.hitscan ? aim : vel).normalize();
  myPlayer()?.model.playThrow();
  shotEffects(def.proj, v3(pos), dir, 0);
  buzz({ ball: 40, spear: 12, arrow: 8 }[def.proj] || 0);
  if (def.hitscan) {
    const end = traceZap(pos, dir.toArray(), def.range);
    fx.beam(v3(pos), v3(end), { color: '#7fe8ff' });
    sendAttack({ t: 'throw', pos: r4(pos), vel: r4(dir.toArray()) });
    fx.addShake(0.04);
    return;
  }
  const tid = ++state.tid;
  const s = addSpear(null, state.myId, pos, vel, null, def.proj);
  s.tid = tid;
  state.pending.set(tid, s);
  sendAttack({ t: 'throw', pos: r4(pos), vel: r4(vel), tid });
  if (def.proj === 'ball') fx.addShake(0.25);
  if (def.proj === 'bullet') fx.addShake(0.05);
  if (SHOUTS[def.proj] && Math.random() < 0.3) fx.float(v3(me.p).multiplyScalar(R + me.h + 2.2), pick(SHOUTS[def.proj]), 'ooga', { life: 0.9 });
}

function trySwing(t) {
  if (!me.wpn || t - me.lastSwing < me.wpn.cd * (buffOn(me, 'quick') ? C.BUFF.quick : 1)) return;
  me.lastSwing = t;
  me.charging = false;
  sendAttack({ t: 'swing' });
  myPlayer()?.model.playSwing(me.wpn.windup);
  setTimeout(() => sound.play('whiff'), me.wpn.windup * 1000);
}

// Whatever E would grab: the closest weapon totem, piece of armor or fallen caveman's weapon
// (same rule as the server).
function nearestGrab() {
  if (!state.world) return null;
  let best = null, bestD = C.GRAB_RADIUS;
  for (const pk of state.world.pickups.values()) {
    const d = M.arcDist(me.p, pk.u.toArray());
    if (d < bestD) { bestD = d; best = { pk }; }
  }
  for (const a of state.armorDrops.values()) {
    const d = M.arcDist(me.p, a.u);
    if (d < bestD) { bestD = d; best = { armor: a }; }
  }
  for (const l of state.loot.values()) {
    if (!l.wpn) continue;
    const d = M.arcDist(me.p, l.u);
    if (d < bestD) { bestD = d; best = { pk: l }; }
  }
  // a cooked roast at a campfire, if I'm hurt (the server's rule: it comes first unless
  // something else is closer)
  if (me.hp < PLAYER.maxHp) {
    for (const f of state.world.fires) {
      const d = M.arcDist(me.p, f.u) - f.r;
      if (f.readyAt <= state.world.time && d < C.MEAT.reach && d <= bestD) { bestD = d; best = { meat: f }; }
    }
  }
  return best;
}

function nearestShroom(maxD) {
  let best = null, bestD = maxD;
  for (const s of state.shrooms.values()) {
    const d = M.arcDist(me.p, s.u);
    if (d < bestD) { bestD = d; best = s; }
  }
  return best;
}

function updateLocal(dt, t) {
  const pl = myPlayer();
  if (!pl) return;
  const [mdx, rawDy] = input.consumeMouse();
  const sens = 0.0024 * settings.get('sens');
  const mdy = settings.get('invertY') ? -rawDy : rawDy;
  if (input.locked) {
    // tilt (phones) turns at a rate set by how far the phone leans, and adds an up/down offset
    // on top of the mouse / drag aim
    const tiltTurn = me.alive ? tilt.turn : 0, tiltPitch = me.alive ? tilt.pitch : 0;
    me.f = M.tangent(me.p, M.rotateAxis(me.f, me.p, -mdx * sens - tiltTurn * dt));
    if (me.alive) {
      me.aim = M.clamp(me.aim + mdy * sens, -0.35 - tiltPitch, 1.2 - tiltPitch);
      me.pitch = M.clamp(me.aim + tiltPitch, -0.35, 1.2);
    }
  }
  const canAct = me.alive && t >= me.stunUntil && input.locked;
  const canFight = canAct && fightingNow();
  const def = rangedDef();
  const prev = me.p;

  if (me.alive) {
    let fwd = 0, side = 0;
    if (canAct) {
      if (input.down('KeyW') || input.down('ArrowUp')) fwd++;
      if (input.down('KeyS') || input.down('ArrowDown')) fwd--;
      if (input.down('KeyD') || input.down('ArrowRight')) side++;
      if (input.down('KeyA') || input.down('ArrowLeft')) side--;
      fwd += input.stick[1];
      side += input.stick[0];
    }
    const right = M.cross(me.f, me.p);
    const dir = M.add(M.scale(me.f, fwd), M.scale(right, side));
    const dl = M.len(dir);
    const slowed = t < me.slowUntil;
    const zoom = buffOn(me, 'fast') ? C.BUFF.fast : 1;
    const speed = PLAYER.speed * ((me.wpn?.speed || 1) + (me.armor?.speed || 0)) * (slowed ? 0.55 : 1) * zoom * (me.charging ? 0.6 : 1);
    // keys always give full speed; a thumbstick pushed halfway walks at half speed
    let disp = dl > 0 ? M.scale(dir, (speed * dt * Math.min(1, dl)) / dl) : [0, 0, 0];
    disp = M.madd(disp, me.kbv, dt);
    me.kbv = M.scale(me.kbv, Math.exp(-dt * 5));
    const len = M.len(disp);
    if (len > 1e-6) [me.p, me.f] = M.moveOnSphere(me.p, me.f, M.scale(disp, 1 / len), len);
    me.kbv = M.scale(M.tangent(me.p, me.kbv), M.len(me.kbv));

    [me.p, me.f] = M.collideObstacles(me.p, me.f, state.world.obstacles, PLAYER.radius);
    for (const b of state.boulders.values()) {
      if (me.h > b.r) continue;
      const hit = M.pushOut(me.p, me.f, b.rp, b.r + PLAYER.radius);
      if (hit) { me.p = hit.p; me.f = hit.f; }
    }
    for (const o of state.players.values()) {
      if (o === pl || !o.alive || Math.abs(o.rh - me.h) > 1.8) continue;
      const hit = M.pushOut(me.p, me.f, o.rp, PLAYER.radius * 1.8);
      if (hit) { me.p = hit.p; me.f = hit.f; }
    }

    if (canAct && input.pressed('Space') && me.h <= 0) { me.vh = PLAYER.jumpVel * (buffOn(me, 'bouncy') ? C.BUFF.bouncy : 1); sound.play(buffOn(me, 'bouncy') ? 'boing' : 'jump'); }
    me.vh -= PLAYER.gravity * dt;
    me.h += me.vh * dt;
    if (me.h <= 0) {
      if (me.vh < -7) fx.dust(v3(me.p).multiplyScalar(R), v3(me.p), 4);
      me.h = 0;
      me.vh = 0;
    }

    if (def.auto) {
      // guns and lasers: hold the button, it keeps firing while there's ammo
      me.charging = canFight && input.mouseDown(BUTTON.ranged) && me.ammo > 0;
      if (me.charging && t - me.lastThrow > def.cooldown) fireRanged(t, 1);
    } else if (me.charging) {
      // spear / bow / musket: hold to charge (or steady the aim), release to let fly
      if (!canFight || me.ammo <= 0) me.charging = false;
      else {
        me.charge = def.chargeTime ? Math.min(1, me.charge + dt / def.chargeTime) : 1;
        if (!input.mouseDown(BUTTON.ranged)) fireRanged(t, me.charge);
      }
    } else if (canFight && input.mouseDown(BUTTON.ranged) && me.ammo > 0 && t - me.lastThrow > def.cooldown) {
      me.charging = true;
      me.charge = 0;
    }
    if (canFight && input.mousePressed(BUTTON.ranged) && me.ammo === 0) {
      const empty = { arrow: 'NO ARROW!', ball: 'RELOADING...', bullet: 'CLICK. NO BANG.', laser: 'NO ZAP JUICE!' }[def.proj] || 'NO SPEAR!';
      fx.float(v3(me.p).multiplyScalar(R + 2.3), empty, 'ooga', { life: 0.8 });
    }

    if (canFight && (input.pressed('KeyF') || input.mousePressed(BUTTON.melee))) trySwing(t);
    if (canAct && input.pressed('KeyQ')) beastCommand();

    const grab = nearestGrab();
    state.grabNear = !!grab;
    const shroom = nearestShroom(3.2);
    if (grab?.meat) hud.prompt(`<span class="key">E</span>EAT ROAST MEAT <span class="up">+${C.MEAT.heal} LIFE</span>`);
    else if (grab?.armor) hud.armorPrompt(grab.armor, me.armor);
    else if (grab) hud.pickupPrompt(grab.pk, me.wpn);
    else if (shroom) {
      const d = C.SHROOMS[shroom.kind];
      hud.prompt(`<span style="color:${d.color}">${d.name}</span><span class="cmp">${d.buff}: ${d.desc} FOR ${d.secs} SEC · WALK OVER IT TO EAT</span>`);
    } else hud.prompt(null);
    if (grab && canAct && input.pressed('KeyE')) send({ t: 'grab' });

    for (let i = 0; i < C.EMOTES.length; i++) {
      if (input.pressed(`Digit${i + 1}`) && t - me.lastEmote > 1.2) { me.lastEmote = t; send({ t: 'emote', i }); }
    }

    if (me.ammo < def.ammo) me.regen += (dt / def.regen) * (buffOn(me, 'quick') ? 2 : 1); else me.regen = 0;
  } else {
    hud.prompt(null);
    state.grabNear = false;
    me.pitch += (0.85 - me.pitch) * Math.min(1, dt * 1.5);
  }

  const moved = M.arcDist(prev, me.p);
  me.speed = me.speed + (moved / Math.max(dt, 1e-4) - me.speed) * Math.min(1, dt * 12);
  me.stepDist += me.h <= 0 ? moved : 0;
  if (me.stepDist > 1.7) { me.stepDist = 0; fx.dust(v3(me.p).multiplyScalar(R), v3(me.p), 1); }

  if (me.alive && t - state.lastSend > 0.05) sendState();

  pl.rp = me.p;
  pl.rf = me.f;
  pl.rh = me.h;
}

// ====================================================================== the end of the world
// The server picks the disaster and when and where everything lands; this only draws it.
// look: LOOKS key for the ruined planet. drop: what falls on the red rings (rock or hail from
// space, lava lobbed out of the volcano). intro: the sound when it starts.
const DOOM = {
  meteor:  { look: 'fire',  drop: 'rock', intro: 'skyfall' },
  volcano: { look: 'fire',  drop: 'lava', intro: 'erupt' },
  flood:   { look: 'storm', drop: null,   intro: 'wave' },
  freeze:  { look: 'ice',   drop: 'hail', intro: 'wind' },
};

const color = c => new THREE.Color(c);
const LIGHT = { hemiSky: color('#d2e4ff'), hemiGround: color('#4d6b30'), sun: color('#fff1d6'), fog: color('#e6c49c') };
// sky: [near the horizon, overhead] as raw shader RGB. crust/glow: the layer that covers the ground.
// weather: what drifts around you while it lasts.
const LOOKS = {
  fire:  { sky: [[0.85, 0.28, 0.08], [0.16, 0.08, 0.07]], crust: '#2a2220', glow: '#4a1405', weather: 'fire',
    hemiSky: color('#ff8a5c'), hemiGround: color('#3a1208'), sun: color('#ff7a3c'), fog: color('#6b2a12') },
  storm: { sky: [[0.36, 0.44, 0.5], [0.1, 0.13, 0.17]], crust: '#2f3b3d', glow: '#000000', weather: 'rain',
    hemiSky: color('#8fa6b8'), hemiGround: color('#1f2b33'), sun: color('#a9bccc'), fog: color('#3b4b56') },
  ice:   { sky: [[0.86, 0.93, 0.98], [0.45, 0.58, 0.74]], crust: '#eef6ff', glow: '#000000', weather: 'snow',
    hemiSky: color('#e4f2ff'), hemiGround: color('#a8c0d4'), sun: color('#d6e8ff'), fog: color('#c9dae8') },
};

const VOLCANO_TOP = new THREE.Vector3(0, R + VOLCANO.peak + 0.2, 0);
const WATER_TOP = R + 2.6;    // deep enough to cover a caveman
const BIG_FALL = 5;           // seconds the giant meteor is visible on the way in
const geos = {};
const geo = (key, make) => (geos[key] ||= make());
let lavaMat, glowMat, waterMat;

function startDoom(m) {
  clearDoom();
  const kind = state.game.disaster;
  const def = C.DISASTERS[kind];
  if (!def) return;
  const el = m.el || 0;
  state.doomLook = DOOM[kind].look;
  state.doomRun = {
    kind, def, drop: DOOM[kind].drop, start: clock() - el, finalDone: el >= def.final, props: [],
    center: m.center ? v3(m.center).normalize() : null,
    strikes: m.strikes.map(s => ({ u: v3(s.to).normalize(), at: s.at, done: s.at <= el, mesh: null, ring: null })),
  };
  if (state.doomRun.finalDone) state.doomTarget = 1;
  for (const id of [...state.armorDrops.keys()]) removeArmorDrop(id);
  clearLoot();
  if (el > 1) return;   // joined partway through: skip the announcement
  hud.center(`${def.icon} ${def.name}! ${def.icon}`, def.sub, 4);
  hud.feed(`<span class="streak">${def.name}</span> · RUN! (IT NO HELP)`);
  sound.play(DOOM[kind].intro);
  sound.speak('uh oh', { pitch: 0.2 });
}

function clearDoom() {
  const run = state.doomRun;
  if (!run) return;
  for (const s of run.strikes) {
    s.mesh?.removeFromParent();
    s.ring?.remove();
  }
  run.bigRing?.remove();
  for (const obj of run.props) obj.removeFromParent();
  run.water?.geometry.dispose();
  state.doomRun = null;
}

function updateDisaster(dt) {
  const run = state.doomRun;
  if (!run) return;
  const el = clock() - run.start;
  for (const s of run.strikes) if (!s.done) updateDrop(run, s, el, dt);
  if (run.kind === 'meteor' && !run.finalDone) updateBigRock(run, el, dt);
  if (run.kind === 'flood') updateWater(run, el);
  if (run.kind === 'volcano') {
    state.world?.erupt();   // smoking and glowing the whole time
    if (!run.finalDone) state.eruptUntil = clock() + 0.5;
  }
  // water and cold creep in steadily instead of one hit at a time
  if (!run.finalDone && (run.kind === 'flood' || run.kind === 'freeze')) {
    state.doomTarget = Math.max(state.doomTarget, Math.min(0.85, el / run.def.final));
  }
  if (!run.finalDone && el >= run.def.final) {
    run.finalDone = true;
    finale(run);
  }
}

function dropMesh(drop) {
  let mesh;
  if (drop === 'lava') {
    lavaMat ||= new THREE.MeshBasicMaterial({ color: '#ff6a1a' });
    mesh = new THREE.Mesh(geo('lava', () => new THREE.IcosahedronGeometry(0.7, 1)), lavaMat);
  } else if (drop === 'hail') {
    mesh = new THREE.Mesh(geo('hail', () => new THREE.IcosahedronGeometry(0.8, 0)), mat('#d8f0ff', { flatShading: true, roughness: 0.2, emissive: '#6fb8ff', emissiveIntensity: 0.4 }));
  } else {
    mesh = new THREE.Mesh(geo('rock', () => new THREE.IcosahedronGeometry(1, 0)), mat('#4a3b30', { flatShading: true, emissive: '#ff5a12', emissiveIntensity: 0.6 }));
  }
  scene.add(mesh);
  return mesh;
}

// Where a falling thing is at k (0..1) of its fall: from space it dives in on a slant,
// lava arcs up out of the volcano and comes down on its ring.
function dropPos(drop, s, k) {
  if (drop === 'lava') {
    // follow the ground from the volcano (straight up) to the ring, arcing higher for farther targets
    const angle = _Y.angleTo(s.u);
    const axis = new THREE.Vector3().crossVectors(_Y, s.u);
    if (axis.lengthSq() < 1e-6) axis.crossVectors(_Y, s.side);   // exactly opposite: go round one side
    const h = (1 - k) * (VOLCANO.peak + 0.2) + 4 * (8 + angle * R * 0.35) * k * (1 - k);
    return _Y.clone().applyAxisAngle(axis.normalize(), angle * k).multiplyScalar(R + h);
  }
  const h = (1 - k) ** 1.6 * 90 + 1;
  return s.u.clone().multiplyScalar(R + h).addScaledVector(s.side, (1 - k) * 25);
}

function trail(drop, pos, size = 1) {
  if (drop === 'hail') {
    fx.puff(pos, { color: '#eaf6ff', size: 0.9 * size, grow: 2.5, life: 1.2, alpha: 0.5 });
    return;
  }
  fx.puff(pos, { color: '#ffb347', size: 1.2 * size, grow: 0.3, life: 0.25, alpha: 0.9, additive: true });
  fx.puff(pos, { color: drop === 'lava' ? '#3a302a' : '#6b625a', size: 1.1 * size, grow: 3, life: 2.2, alpha: 0.45 });
}

function updateDrop(run, s, el, dt) {
  const fall = run.drop === 'lava' ? 1.6 : 2;
  const k = (el - (s.at - fall)) / fall;
  if (k < 0) return;
  s.ring ||= fx.decal(s.u, { radius: run.def.blast, inner: run.def.blast - 0.6, color: '#ff3d1f', opacity: 0.9, pulse: true });
  if (!s.mesh) {
    s.mesh = dropMesh(run.drop);
    s.side = new THREE.Vector3().randomDirection().projectOnPlane(s.u).normalize();
  }
  if (k >= 1) {
    s.done = true;
    s.mesh.removeFromParent();
    s.ring.remove();
    strikeBlast(run, s);
    return;
  }
  const pos = dropPos(run.drop, s, k);
  s.mesh.position.copy(pos);
  s.mesh.rotation.x += dt * 4;
  s.mesh.rotation.y += dt * 3;
  trail(run.drop, pos);
}

function strikeBlast(run, s) {
  const ground = s.u.clone().multiplyScalar(R);
  const d = distTo(s.u.toArray());
  const icy = run.drop === 'hail';
  if (icy) {
    fx.burst(ground, { count: 28, color: '#dff4ff', speed: 8, size: 0.22, life: 1.4, up: s.u });
    fx.shockwave(s.u, { radius: run.def.blast * 1.4, life: 1, color: '#dff4ff' });
    fx.decal(s.u, { radius: run.def.blast * 0.7, color: '#eef6ff', opacity: 0.75, life: 25 });
    sound.play('shatter', d);
  } else {
    fx.explosion(ground, s.u, 2);
    fx.shockwave(s.u, { radius: run.def.blast * 1.6, life: 1.3 });
    fx.decal(s.u, { radius: run.def.blast * 0.5, color: '#1d1410', opacity: 0.6, life: 25 });
    sound.play('boom', d);
  }
  fx.addShake(Math.max(0.15, 0.9 - d / 40));
  hud.flash(Math.max(0.1, 0.5 - d / 80), icy ? 'cold' : 'blast');
  state.doomTarget = Math.min(0.85, state.doomTarget + 0.09);
}

// The giant meteor: a glowing rock the size of a hut that you can watch coming for a while.
function updateBigRock(run, el, dt) {
  const k = (el - (run.def.final - BIG_FALL)) / BIG_FALL;
  if (k < 0) return;
  if (!run.bigRock) {
    run.bigRock = new THREE.Mesh(geo('rock', () => new THREE.IcosahedronGeometry(1, 0)), mat('#4a3b30', { flatShading: true, emissive: '#ff5a12', emissiveIntensity: 0.9, fog: false }));
    glowMat ||= new THREE.SpriteMaterial({ map: softDotTexture(), color: '#ff8a3c', blending: THREE.AdditiveBlending, depthWrite: false, fog: false });
    const glow = new THREE.Sprite(glowMat);
    glow.scale.setScalar(3.2);
    run.bigRock.add(glow);
    run.bigRock.scale.setScalar(5);
    scene.add(run.bigRock);
    run.props.push(run.bigRock);
    run.bigSide = new THREE.Vector3().randomDirection().projectOnPlane(run.center).normalize();
    run.bigRing = fx.decal(run.center, { radius: 14, inner: 13.2, color: '#ff3d1f', opacity: 0.9, pulse: true });
  }
  const left = 1 - Math.min(1, k);
  const pos = run.center.clone().multiplyScalar(R + left ** 1.4 * 220 + 5).addScaledVector(run.bigSide, left * 70);
  run.bigRock.position.copy(pos);
  run.bigRock.rotation.x += dt * 0.8;
  run.bigRock.rotation.z += dt * 0.5;
  trail('rock', pos, 6);
}

// A dome of water that spreads from run.center until it covers the whole planet,
// with a curling wall at the front.
function waterGeometry(theta) {
  const crest = Math.min(theta, 0.08);
  const pts = [];
  for (let i = 0; i <= 40; i++) {
    const a = (i / 40) * (theta - crest);
    pts.push(new THREE.Vector2(WATER_TOP * Math.sin(a), WATER_TOP * Math.cos(a)));
  }
  const top = theta - crest * 0.4, wave = WATER_TOP + 1.6, floor = R - 0.5;
  pts.push(new THREE.Vector2(wave * Math.sin(top), wave * Math.cos(top)));
  pts.push(new THREE.Vector2(floor * Math.sin(theta), floor * Math.cos(theta)));
  return new THREE.LatheGeometry(pts, 72);
}

function updateWater(run, el) {
  let theta = C.waveAngle(run.def.wave, el);
  if (theta <= 0) return;
  if (!run.water) {
    waterMat ||= new THREE.MeshStandardMaterial({
      color: '#2b7cc4', emissive: '#0b2b4a', emissiveIntensity: 0.5, roughness: 0.15, metalness: 0.1,
      transparent: true, opacity: 0.85, side: THREE.DoubleSide,
    });
    run.water = new THREE.Mesh(waterGeometry(theta), waterMat);
    run.water.quaternion.setFromUnitVectors(_Y, run.center);
    run.water.renderOrder = 2;
    scene.add(run.water);
    run.props.push(run.water);
  } else if (theta - run.waterTheta > 0.006 || (theta >= Math.PI && run.waterTheta < Math.PI)) {
    // rebuilding the dome is a few thousand vertices, so only do it once the front has moved
    run.water.geometry.dispose();
    run.water.geometry = waterGeometry(theta);
  } else {
    theta = run.waterTheta;
  }
  run.waterTheta = theta;
  if (theta >= Math.PI) return;
  // foam along the wave front, mostly on your side of the planet where you can see it
  const toward = state.myId ? v3(me.p).projectOnPlane(run.center) : new THREE.Vector3();
  for (let i = 0; i < 3; i++) {
    const dir = toward.lengthSq() > 1e-4 ? toward.clone().normalize() : new THREE.Vector3().randomDirection().projectOnPlane(run.center).normalize();
    dir.applyAxisAngle(run.center, (Math.random() - 0.5) * 2.4);
    const p = run.center.clone().multiplyScalar(Math.cos(theta)).addScaledVector(dir, Math.sin(theta)).multiplyScalar(WATER_TOP + 1);
    fx.puff(p, { color: '#f2fbff', size: 1.6, grow: 1.8, life: 0.9, alpha: 0.7 });
  }
}

// Frozen cavemen stay in a slab of ice until the new Stone Age. It rides on the caveman's
// model, over where the body lands when it tips over backward (along -z).
function encaseInIce(pl) {
  if (!state.doomRun) return;
  const block = new THREE.Mesh(
    geo('ice', () => new THREE.BoxGeometry(1.7, 1.4, 2.9)),
    mat('#e6f7ff', { roughness: 0.1, emissive: '#7cc4ff', emissiveIntensity: 0.35, transparent: true, opacity: 0.6 }),
  );
  block.position.set(0, 0.6, -0.85);
  block.renderOrder = 2;          // after the frost on the ground, so the frost shows through it
  block.userData.shared = true;   // so the caveman's dispose() leaves the shared box alone
  pl.model.root.add(block);
  state.doomRun.props.push(block);
  const up = v3(pl.rp);
  fx.burst(up.clone().multiplyScalar(R + 0.8), { count: 14, color: '#dff4ff', speed: 4, size: 0.15, life: 1, up });
}

// A huge column of fire and smoke with a cap of dust spreading out on top.
function cloudColumn(ground, u) {
  const side = new THREE.Vector3().randomDirection().projectOnPlane(u).normalize();
  const side2 = new THREE.Vector3().crossVectors(u, side);
  for (let i = 0; i < 10; i++) {
    const p = ground.clone().addScaledVector(u, 1 + i * 1.3);
    fx.puff(p, { color: i < 3 ? '#ff8a3c' : '#6b5a4e', size: 2 + i * 0.25, grow: 2.2, life: 4 + Math.random() * 2, vel: u.clone().multiplyScalar(0.6), alpha: 0.85 });
  }
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * Math.PI * 2;
    const out = side.clone().multiplyScalar(Math.cos(a)).addScaledVector(side2, Math.sin(a));
    const p = ground.clone().addScaledVector(u, 13 + Math.random() * 1.5).addScaledVector(out, 2.5);
    fx.puff(p, { color: i % 3 ? '#5a4a40' : '#ff7a2c', size: 4 + Math.random() * 2, grow: 2, life: 5 + Math.random() * 2, vel: out.multiplyScalar(1.2), alpha: 0.8 });
  }
}

// The big one: it gets everybody.
function finale(run) {
  hud.center(run.def.finale[0], run.def.finale[1], 4);
  state.doomTarget = 1;
  fx.addShake(1.2);
  if (run.kind === 'meteor' || run.kind === 'volcano') {
    const u = run.center;
    const ground = run.kind === 'volcano' ? VOLCANO_TOP.clone() : u.clone().multiplyScalar(R);
    run.bigRock?.removeFromParent();
    run.bigRing?.remove();
    fx.explosion(ground, u, 6);
    fx.shockwave(u, { radius: 90, life: 3 });
    fx.burst(ground, { count: 120, color: run.kind === 'volcano' ? '#ff6a1a' : '#ffb347', speed: 24, size: 0.45, life: 2.5, up: u, emissive: true });
    fx.burst(ground, { count: 80, color: '#3d3530', speed: 18, size: 0.6, life: 3, up: u });
    cloudColumn(ground, u);
    sound.play('bigboom');
    hud.flash(1, 'blast');
  } else if (run.kind === 'flood') {
    sound.play('wave');
    hud.flash(1, 'water');
  } else {
    sound.play('freeze');
    hud.flash(1, 'cold');
    if (state.myId) fx.shockwave(v3(me.p), { radius: 90, life: 2.5, color: '#dff4ff' });
  }
}

// Ruin (or heal) the planet and the light toward state.doomTarget.
function updateDoom(dt) {
  const rising = state.doomTarget > state.doom;
  state.doom += (state.doomTarget - state.doom) * Math.min(1, dt * (rising ? 2.5 : 0.45));
  if (state.doom < 0.002 && !rising) state.doom = 0;
  const k = state.doom;
  const look = LOOKS[state.doomLook];
  state.world?.setDoom(k, look);
  sky.uniforms.doom.value = k;
  sky.uniforms.doomLow.value.fromArray(look.sky[0]);
  sky.uniforms.doomHigh.value.fromArray(look.sky[1]);
  hemi.color.copy(LIGHT.hemiSky).lerp(look.hemiSky, k);
  hemi.groundColor.copy(LIGHT.hemiGround).lerp(look.hemiGround, k);
  sun.color.copy(LIGHT.sun).lerp(look.sun, k);
  sun.intensity = 2.5 * (1 - 0.45 * k);
  scene.fog.color.copy(LIGHT.fog).lerp(look.fog, k);
  // weather while the world ends: little fires everywhere, rain or snow
  const rate = look.weather === 'fire' ? 8 : 40;
  if (k > 0.2 && state.myId && Math.random() < dt * rate * k) {
    const u = v3(M.norm(M.madd(me.p, M.randomUnit(), 0.5 + Math.random() * 0.3)));
    if (look.weather === 'fire') {
      const p = u.clone().multiplyScalar(R + 0.3);
      fx.puff(p, { color: '#ff7a2c', size: 0.9, grow: 1.5, life: 0.8, vel: u.clone().multiplyScalar(1.5), alpha: 0.9, additive: true });
      fx.puff(p.addScaledVector(u, 0.8), { color: '#3a302a', size: 1.2, grow: 3, life: 3, vel: u.multiplyScalar(1.2), alpha: 0.5 });
    } else if (look.weather === 'snow') {
      fx.puff(u.clone().multiplyScalar(R + 4 + Math.random() * 6), { color: '#ffffff', size: 0.3, grow: 1, life: 2.5, vel: u.clone().multiplyScalar(-2.5), alpha: 0.9 });
    } else {
      fx.puff(u.clone().multiplyScalar(R + 6 + Math.random() * 6), { color: '#bcd6ea', size: 0.18, grow: 1, life: 0.6, vel: u.clone().multiplyScalar(-16), alpha: 0.6 });
    }
  }
}

// ====================================================================== players & camera
function updatePlayers(dt, t, renderT) {
  for (const pl of state.players.values()) {
    const mine = pl.id === state.myId;
    if (!mine) {
      const s = sampleSnaps(pl.snaps, renderT);
      if (s) {
        const moved = M.arcDist(pl.rp, s.p);
        pl.speed += (moved / Math.max(dt, 1e-4) - pl.speed) * Math.min(1, dt * 10);
        if (moved > 6) pl.speed = 0;
        pl.rp = s.p;
        pl.rf = s.f;
        pl.rh = s.h;
      }
    }
    const model = pl.model;
    model.place(pl.rp, pl.rf, pl.rh);
    const ammo = mine ? me.ammo : pl.ammo;
    if (ammo !== model.ammo) model.setAmmo(ammo);
    model.update(dt, {
      speed: mine ? me.speed : pl.speed,
      air: pl.rh > 0.05,
      charging: mine ? me.charging : !!(pl.flags & 2),
      stunned: mine ? t < me.stunUntil && me.alive : !!(pl.flags & 4),
    });
    if (!pl.alive) continue;
    const up = v3(pl.rp);
    const slowed = mine ? t < me.slowUntil : pl.flags & 8;
    if (slowed && Math.random() < dt * 7) {
      fx.puff(up.clone().multiplyScalar(R + pl.rh + 1.4 + Math.random() * 0.6), { color: '#8fcf5a', size: 0.5, grow: 2, life: 1, vel: up.clone().multiplyScalar(0.6), alpha: 0.5 });
    }
    if (pl.flags & 16 && Math.random() < dt * 8) {
      fx.burst(up.clone().multiplyScalar(R + pl.rh + 1.1), { count: 1, color: '#a8201a', speed: 0.6, size: 0.07, life: 0.8 });
    }
    // mushroom buffs glitter in their colour
    for (const [kind, until] of Object.entries(mine ? me.buffs : pl.buffs || {})) {
      if (until > t && Math.random() < dt * 6) {
        const side = v3(M.anyTangent(pl.rp)).applyAxisAngle(up, Math.random() * 6.3).multiplyScalar(0.5);
        fx.burst(up.clone().multiplyScalar(R + pl.rh + 0.4 + Math.random() * 1.6).add(side), { count: 1, color: C.SHROOMS[kind].color, speed: 0.5, size: 0.07, life: 0.7, grav: -0.15, up, emissive: true });
      }
    }
    if (!mine && pl.speed > 3 && pl.rh <= 0.05 && Math.random() < dt * 4) fx.dust(up.clone().multiplyScalar(R), up, 1);
  }
}

const SUN_HINT = M.norm([0.45, 0.3, 0.84]);

function updateCamera(dt, t) {
  let focus, up;
  const pl = myPlayer();
  if (state.joined && pl) {
    up = v3(me.p);
    const fw = v3(me.f);
    const right = new THREE.Vector3().crossVectors(fw, up);
    const head = up.clone().multiplyScalar(R + me.h + 1.75);
    const deadFor = me.alive ? 0 : t - me.deadAt;
    const dist = 6.2 + Math.min(5, deadFor * 2.5);
    const ph = me.pitch;
    const back = fw.clone().multiplyScalar(-Math.cos(ph)).addScaledVector(up, Math.sin(ph));
    // orbit a pivot above and right of the head so the caveman sits lower-left, clear of the
    // crosshair (left of it and lower-right for the left-handed, so the throwing hand stays near it)
    const pivot = head.clone().addScaledVector(right, settings.get('lefty') ? -1.15 : 1.15).addScaledVector(up, 0.55);
    const pos = pivot.clone().addScaledVector(back, dist);
    if (pos.length() < R + 0.6) pos.setLength(R + 0.6);
    const look = pivot.clone().addScaledVector(back, -4);
    if (fx.shake > 0 && settings.get('shake') > 0) {
      const s = fx.shake * 0.35 * (settings.get('shake') / 100);
      pos.x += (Math.random() - 0.5) * s;
      pos.y += (Math.random() - 0.5) * s;
      pos.z += (Math.random() - 0.5) * s;
    }
    camera.up.copy(up);
    camera.position.copy(pos);
    camera.lookAt(look);
    focus = up.clone().multiplyScalar(R);
    scene.fog.near = 38;
    scene.fog.far = 105;
  } else {
    // slow orbit with the planet framed right of the lobby tablet
    state.lobbyAngle += dt * 0.06;
    const a = state.lobbyAngle;
    camera.up.set(0, 1, 0);
    camera.position.set(Math.cos(a) * R * 2.5, R * 0.9, Math.sin(a) * R * 2.5);
    const toCenter = camera.position.clone().negate().normalize();
    const left = new THREE.Vector3().crossVectors(camera.up, toCenter).normalize();
    const shift = innerWidth > 900 ? R * 0.75 : 0;
    camera.lookAt(left.multiplyScalar(shift).add(new THREE.Vector3(0, -R * 0.1, 0)));
    up = camera.position.clone().normalize();
    focus = up.clone().multiplyScalar(R);
    scene.fog.near = 200;
    scene.fog.far = 1000;
  }

  const hint = M.tangent(up.toArray(), SUN_HINT);
  const sunDir = up.clone().multiplyScalar(0.78).add(v3(hint).multiplyScalar(0.62)).normalize();
  sun.position.copy(focus).addScaledVector(sunDir, 70);
  sun.target.position.copy(focus);
  const extent = state.joined && pl ? 26 : R * 1.2;
  if (sun.shadow.camera.right !== extent) {
    Object.assign(sun.shadow.camera, { left: -extent, right: extent, top: extent, bottom: -extent });
    sun.shadow.camera.updateProjectionMatrix();
  }
  hemi.position.copy(up);
  sky.update(camera, state.joined && pl ? up : camera.position.clone().normalize(), sunDir);
}

// ====================================================================== HUD
const THROW_LABEL = { spear: 'THROW', arrow: 'SHOOT', ball: 'BOOM', bullet: 'BANG', laser: 'ZAP' };
const fpsMeter = { frames: 0, since: 0 };

function updateHud(dt, t) {
  hud.update(dt);
  if (!state.joined || !state.myId) return;
  const left = clockLeft();
  const coop = state.game.mode === 'coop';
  let foes = 0;
  if (coop) for (const p of state.players.values()) if (p.bot && p.alive) foes++;
  hud.setEra(state.game, left, foes);
  hud.setRanged(rangedKey(), rangedDef());
  hud.setArmor(me.armor);
  hud.setHp(me.hp);
  hud.setAmmo(me.ammo, me.regen);
  hud.setCharge(me.charging ? me.charge : 0);
  if (me.wpn) hud.setCooldown((t - me.lastSwing) / me.wpn.cd);
  const mine = myPlayer();
  updateBeastHud(t);
  const buffs = Object.entries(me.buffs).filter(([, until]) => until > t).map(([kind, until]) => ({ kind, left: Math.ceil(until - t) }));
  hud.setStatus({ stun: t < me.stunUntil, slow: t < me.slowUntil, bleed: mine && mine.flags & 16, buffs });
  hud.eruptWarning(t < state.eruptUntil);
  hud.scoreboard(state.players.values(), state.myId, input.down('Tab'), state.game.chief);
  hud.roundEnd(state.game.phase === 'end' ? state.standings : null, state.myId, left, state.game.disaster, coop ? state.game.wave : 0, state.roundQuote, state.roundProfit || 0, !!state.game.mmDead);
  const councilOpen = !$('council').classList.contains('hidden');
  $('lock-hint').classList.toggle('hidden', input.locked || !me.alive || councilOpen || settingsOpen());
  if (touch) {
    const def = rangedDef();
    touch.update({
      grab: !!state.grabNear,
      chief: state.game.chief === state.myId,
      throwLabel: THROW_LABEL[def.proj] || 'THROW',
      ammo: me.ammo,
      charge: me.charging && !def.auto ? me.charge : 0,
      verb: me.wpn?.verb || 'BONK',
      cooldown: me.wpn ? (t - me.lastSwing) / me.wpn.cd : 1,
    });
  }

  if (!me.alive) {
    const left = Math.max(0, PLAYER.respawn - (t - me.deadAt));
    const waiting = state.game.phase !== 'play';   // no getting up during the disaster or the victory screen
    let line;
    if (coop) {
      // co-op: down until the tribe clears the wave
      let standing = 0;
      for (const p of state.players.values()) if (!p.bot && p.alive) standing++;
      line = standing ? `${standing} FRIEND${standing > 1 ? 'S' : ''} STILL BONKING. WAKE UP WHEN WAVE DONE...` : 'WHOLE TRIBE DOWN...';
    } else {
      line = waiting ? 'WAIT FOR NEW STONE AGE...' : left > 0.2 ? `WAKE UP IN ${Math.ceil(left)}...` : 'WAKING UP...';
    }
    hud.death(true, me.deathText, line);
  }

  if (settings.get('fps')) {
    fpsMeter.frames++;
    const now = clock();
    if (now - fpsMeter.since >= 0.5) {
      $('fps').textContent = `${Math.round(fpsMeter.frames / (now - fpsMeter.since))} FPS`;
      fpsMeter.frames = 0;
      fpsMeter.since = now;
    }
  }
  if ((state.miniScoreT -= dt) <= 0) {
    state.miniScoreT = 0.5;
    hud.miniScore(state.players.values(), state.myId);
    const ping = $('ping');
    ping.textContent = state.ping ? `PING ${Math.round(state.ping)} MS` : '';
    ping.className = ping.className.replace(/\b(good|ok|bad)\b/g, '').trim();
    if (state.ping) ping.classList.add(state.ping < 90 ? 'good' : state.ping < 180 ? 'ok' : 'bad');
  }
  if ((state.radarT -= dt) <= 0) {
    state.radarT = 0.05;
    const items = [{ p: [0, 1, 0], color: '#ff6a2a', kind: 'volcano' }];
    for (const pk of state.world.pickups.values()) items.push({ p: pk.u.toArray(), color: C.TIER_COLORS[pk.wpn.tier], kind: 'pickup' });
    for (const b of state.boulders.values()) items.push({ p: b.rp, color: '#b3aa9c', kind: 'boulder' });
    for (const fb of state.fireballs.values()) if (fb.landU) items.push({ p: fb.landU, color: '#ff3d1f', kind: 'danger' });
    for (const a of state.armorDrops.values()) items.push({ p: a.u, color: C.ARMORS[a.armor.type]?.color || '#fff', kind: 'armor' });
    for (const l of state.loot.values()) if (l.wpn) items.push({ p: l.u, color: C.TIER_COLORS[l.wpn.tier], kind: 'loot' });
    for (const s of state.shrooms.values()) items.push({ p: s.u, color: C.SHROOMS[s.kind].color, kind: 'shroom' });
    for (const b of state.beasts.values()) items.push({ p: b.rp, color: beastTeam(b) === 'foe' ? '#ff4b4b' : '#5ef08a', kind: 'beast' });
    // co-op: friends green, bots red. Otherwise everyone's a target: humans red, bots orange.
    const dotColor = p => (coop ? (p.bot ? '#ff4b4b' : '#5ef08a') : p.bot ? '#ff9a3c' : '#ff4b4b');
    for (const p of state.players.values()) if (p.id !== state.myId && p.alive) items.push({ p: p.rp, color: dotColor(p), kind: 'player' });
    hud.radar(me, items);
  }
}

// ====================================================================== lobby
function initLobby() {
  const saved = store.get('ss-profile') || {};
  const look = { ...C.randomLook(), ...(saved.look || {}) };
  const nameEl = $('name');
  nameEl.value = saved.name || C.randomCaveName();
  $('reroll-name').onclick = () => { nameEl.value = C.randomCaveName(); };

  const swatchRow = (rootId, count, render, key) => {
    const root = $(rootId);
    const els = [];
    for (let i = 0; i < count; i++) {
      const el = document.createElement('div');
      render(el, i);
      el.onclick = () => {
        look[key] = i;
        els.forEach((e, j) => e.classList.toggle('sel', j === i));
      };
      el.classList.toggle('sel', look[key] === i);
      root.appendChild(el);
      els.push(el);
    }
  };
  swatchRow('garbs', C.GARBS.length, (el, i) => {
    el.className = 'swatch';
    el.style.backgroundImage = `url(${peltSwatchURL(i)})`;
    el.innerHTML = `<span>${esc(C.GARBS[i].name.toUpperCase())}</span>`;
  }, 'garb');
  swatchRow('skins', C.SKINS.length, (el, i) => {
    el.className = 'swatch small';
    el.style.background = C.SKINS[i];
  }, 'skin');
  $('opt-beard').checked = !!look.beard;
  $('opt-bone').checked = !!look.bone;

  const join = () => {
    if (!state.worldReady || state.joined) return;
    sound.unlock();
    look.beard = $('opt-beard').checked ? 1 : 0;
    look.bone = $('opt-bone').checked ? 1 : 0;
    const name = nameEl.value.trim() || C.randomCaveName();
    store.set('ss-profile', { name, look });
    state.joinMsg = { t: 'join', name, look: { ...look, lefty: settings.get('lefty') ? 1 : 0 } };
    send(state.joinMsg);
    state.joined = true;
    $('lobby').classList.add('hidden');
    hud.show(true);
    input.enabled = true;
    input.lock();
    sound.speak('ooga booga!', { pitch: 0.3 });
    if (touch) {
      touch.show(true);
      tilt.start();   // has to happen inside this tap for iOS to ask for motion access
      // full screen and sideways where the browser allows it (Android); iPhones ignore this
      const fs = document.documentElement.requestFullscreen?.({ navigationUI: 'hide' });
      fs?.then(() => screen.orientation?.lock?.('landscape')).catch(() => {});
      hud.center('OOGA BOOGA!', TILT_LEVELS[tilt.level] ? 'LEFT THUMB RUN · LEAN PHONE TO TURN · TIP PHONE TO AIM UP/DOWN' : 'LEFT THUMB RUN · DRAG RIGHT SIDE TO AIM', 3.5);
    }
  };
  $('play').onclick = join;
  nameEl.addEventListener('keydown', e => { if (e.key === 'Enter') join(); });
  $('open-settings').onclick = () => toggleSettings(true);

  // a Smedley Butler line at the bottom of the lobby, a new one every 14 s or on a tap
  const quotes = C.BUTLER.quotes;
  let wiseI = Math.floor(Math.random() * quotes.length);
  const wise = $('wise-text');
  const showWise = () => { wise.textContent = `“${quotes[wiseI]}”`; wise.classList.add('show'); };
  const nextWise = () => {
    wiseI = (wiseI + 1 + Math.floor(Math.random() * (quotes.length - 1))) % quotes.length;
    wise.classList.remove('show');
    setTimeout(showWise, 300);
  };
  $('wise-by').textContent = `— ${C.BUTLER.by}`;
  $('wise').onclick = nextWise;
  setInterval(() => { if (!state.joined) nextWise(); }, 14000);
  showWise();
}

// ====================================================================== settings panel
buildSettingsPanel(settings, $('settings-rows'));
const settingsOpen = () => !$('settings').classList.contains('hidden');

function toggleSettings(open = !settingsOpen()) {
  $('settings').classList.toggle('hidden', !open);
  if (open) {
    touch?.setTribe(false);
    input.unlock();
  } else if (state.joined && (me.alive || isTouch) && $('council').classList.contains('hidden')) {
    input.lock();
  }
}
$('settings-close').onclick = () => toggleSettings(false);
$('lock-settings').onclick = () => toggleSettings(true);
$('settings-reset').onclick = () => {
  settings.reset();
  hud.center('SETTINGS RESET', 'BACK TO HOW SPIRITS MADE THEM', 1.5);
};

// Re-center button: however the phone is held right now becomes "straight ahead".
function recenterTilt() {
  if (!TILT_LEVELS[tilt.level]) hud.center('TILT IS OFF', 'TURN IT ON IN SETTINGS (☰ THEN ⚙). DRAG RIGHT SIDE TO AIM.', 2.5);
  else if (tilt.recenter()) hud.center('TILT ZERO SET', 'HOLD PHONE LIKE THIS = LOOK STRAIGHT', 1.4);
  else tiltProblem(tilt.status);
}

function tiltProblem(status) {
  const why = {
    insecure: ['NO TILT ON HTTP', 'PHONE ONLY SHARE TILT ON HTTPS LINK. DRAG RIGHT SIDE TO AIM.'],
    denied: ['NO TILT ALLOWED', 'PHONE SAID NO. RELOAD AND TAP ALLOW. OR DRAG RIGHT SIDE TO AIM.'],
    none: ['NO TILT HERE', 'THIS PHONE NOT FEEL TILT. DRAG RIGHT SIDE TO AIM.'],
    waiting: ['TILT WAKING UP', 'HOLD STILL A MOMENT, THEN TAP AGAIN.'],
  }[status];
  if (why && state.joined) hud.center(why[0], why[1], 3);
}
tilt.onStatus = s => { if (s !== 'live' && s !== 'waiting') tiltProblem(s); };

// ====================================================================== planet rules (lobby + tribe council)
// The same controls render in the lobby (editable while no humans are on the planet) and in
// the in-game council (editable by the chief). The server enforces who may change what.
const rulesUIs = [];

function buildRules(root) {
  root.innerHTML = `
    <div class="rule"><span>MODE</span>
      <div class="seg" data-key="mode">${Object.entries(C.MODES).map(([k, n]) => `<button data-v="${k}">${n}</button>`).join('')}</div>
      <div class="rule-desc" data-desc></div>
    </div>
    <div class="rule"><span>BOT BRAINS</span>
      <div class="seg levels" data-key="botLevel">${C.BOT_LEVELS.map((l, i) =>
        `<button data-v="${i + 1}" title="${l.name}" style="--hue:${Math.round(120 - (i / (C.BOT_LEVELS.length - 1)) * 120)}">${i + 1}</button>`).join('')}</div>
      <div class="rule-desc" data-level-desc></div>
    </div>
    <div class="rule"><span>BOT FILL</span>
      <div class="stepper"><button data-step="-1">-</button><b data-bots>4</b><button data-step="1">+</button></div>
      <div class="rule-desc" data-fill-desc></div>
    </div>`;
  root.addEventListener('click', e => {
    const btn = e.target.closest('button');
    if (!btn || btn.disabled) return;
    const g = state.game;
    const want = { mode: g.mode, botLevel: g.botLevel, bots: g.bots };
    const seg = btn.closest('.seg');
    if (seg) want[seg.dataset.key] = seg.dataset.key === 'mode' ? btn.dataset.v : Number(btn.dataset.v);
    if (btn.dataset.step) want.bots = M.clamp(g.bots + Number(btn.dataset.step), 0, C.MAX_BOTS);
    send({ t: 'rules', ...want });
  });
  rulesUIs.push(root);
}

function refreshRules() {
  const g = state.game;
  const humans = humansOnPlanet();
  const chief = state.players.get(g.chief);
  const chiefName = chief ? chief.name.toUpperCase() : '';
  const iAmChief = !!state.myId && g.chief === state.myId;
  for (const root of rulesUIs) {
    const editable = root.id === 'council-rules' ? iAmChief : humans.length === 0;
    root.querySelectorAll('button').forEach(b => { b.disabled = !editable; });
    root.querySelectorAll('.seg').forEach(seg => {
      seg.querySelectorAll('button').forEach(b => b.classList.toggle('on', String(g[seg.dataset.key]) === b.dataset.v));
    });
    // the brain meter fills up to the chosen level
    root.querySelectorAll('.levels button').forEach(b => b.classList.toggle('lit', Number(b.dataset.v) <= g.botLevel));
    const lvl = C.botLevelDef(g.botLevel);
    const coop = g.mode === 'coop';
    root.querySelector('[data-level-desc]').textContent = `${g.botLevel}/10 ${lvl.name}: ${lvl.desc}${coop ? ` (WAVE 1. +1 EVERY ${C.COOP.smarterEvery} WAVES)` : ''}`;
    root.querySelector('[data-bots]').textContent = g.bots;
    root.querySelector('[data-fill-desc]').textContent = coop
      ? 'NOT USED IN TRIBE VS BOTS: EACH WAVE BRING MORE BOTS.'
      : 'BOTS JOIN UNTIL ROCK HAS THIS MANY CAVEMEN. 0 = HUMANS ONLY.';
    root.querySelector('[data-desc]').textContent = {
      dotime: `STONE → BOW → SWORD → MUSKET → GUN → LASER → DISASTER (SKY ROCK, MOUNTAIN BOOM, BIG WATER OR BIG COLD). EACH AGE ${g.eraSeconds} SEC. ARMOR FALL FROM SKY. MOST BONKS BEFORE THE END WIN.`,
      classic: 'SPEARS AND BONES FOREVER. NO CLOCK. NO ARMOR.',
      coop: `CO-OP. ALL HUMANS ONE TRIBE VS WAVES OF BOTS. NO HURTING FRIENDS. FALL DOWN = WAIT TILL WAVE DONE. WHOLE TRIBE DOWN = START OVER. NEW AGE EVERY ${C.COOP.ageEvery} WAVES.`,
    }[g.mode];
  }
  $('lobby-note').textContent = humans.length === 0
    ? 'NOBODY ON ROCK YET. YOU PICK RULES, THEN YOU CHIEF.'
    : `CHIEF ${chiefName} PICK RULES · ${humans.length} HUMAN${humans.length > 1 ? 'S' : ''} ON ROCK`;
  $('council-note').textContent = iAmChief
    ? 'YOU ARE CHIEF. YOU PICK. NEW MODE = NEW ROUND.'
    : `ONLY CHIEF ${chiefName} CHANGE RULES. CHIEF = LONGEST ON ROCK.`;
}

function toggleCouncil(open = $('council').classList.contains('hidden'), relock = true) {
  $('council').classList.toggle('hidden', !open);
  if (open) {
    refreshRules();
    input.unlock();
  } else if (relock && (me.alive || isTouch)) {
    input.lock();
  }
}

buildRules($('lobby-rules'));
buildRules($('council-rules'));
$('council-close').onclick = () => toggleCouncil(false);
refreshRules();

addEventListener('keydown', e => {
  if (e.target instanceof HTMLInputElement && e.target.type === 'text') return;   // typing a name
  if (e.code === 'Escape' && settingsOpen()) { toggleSettings(false); return; }
  if (e.code === 'KeyO') toggleSettings();
  if (!state.joined) return;
  if (e.code === 'KeyM') hud.center(settings.toggle('muted') ? 'QUIET CAVE' : 'LOUD CAVE', '', 1);
  if (e.code === 'KeyN') hud.center(settings.toggle('music') ? 'DRUMS ON' : 'DRUMS OFF', '', 1);
  if (e.code === 'KeyG') {
    settings.set('gfx', GFX_ORDER[(GFX_ORDER.indexOf(gfxKey) + 1) % GFX_ORDER.length]);
    const tips = { low: 'FAST ROCK. NO SHADOW, LESS SMOKE.', auto: 'ROCK PICK SHARPNESS BY SPEED.', high: 'PRETTY ROCK. NEEDS STRONG COMPUTER.' };
    hud.center(`GRAPHICS: ${GFX[gfxKey].label}`, tips[gfxKey], 1.5);
  }
  if (e.code === 'KeyC') toggleCouncil();
  if (e.code === 'Escape' && !$('council').classList.contains('hidden')) toggleCouncil(false, false);
});

document.fonts?.ready.then(redrawAllTags);

// Skip what the planet hides: players, projectiles, boulders, armor and lava bombs behind the
// horizon (scenery is handled by World.cull).
function cullHidden(visible) {
  for (const pl of state.players.values()) {
    pl.model.root.visible = pl.id === state.myId || visible(pl.rp[0], pl.rp[1], pl.rp[2], R + pl.rh + 2.9, 0.03);
  }
  const seen = s => {
    const r = M.len(s.pos);
    return visible(s.pos[0] / r, s.pos[1] / r, s.pos[2] / r, Math.max(r, R) + 0.5, 0.05);
  };
  for (const s of state.spears.values()) if (s.inst < 0) s.mesh.visible = !s.hidden && seen(s);
  for (const s of state.pending.values()) s.mesh.visible = !s.hidden && seen(s);
  for (const b of state.boulders.values()) b.mesh.visible = visible(b.rp[0], b.rp[1], b.rp[2], R + b.r * 2, b.r / R);
  for (const a of state.armorDrops.values()) a.group.visible = visible(a.u[0], a.u[1], a.u[2], R + 6, 0.05);
  for (const l of state.loot.values()) l.group.visible = visible(l.u[0], l.u[1], l.u[2], R + 1.5, 0.03);
  for (const s of state.shrooms.values()) s.group.visible = visible(s.u[0], s.u[1], s.u[2], R + 1.5, 0.03);
  for (const b of state.beasts.values()) b.model.root.visible = visible(b.rp[0], b.rp[1], b.rp[2], R + b.rh + C.BEASTS[b.kind].height + 1.5, C.BEASTS[b.kind].radius / R);
  for (const fb of state.fireballs.values()) fb.mesh.visible = !fb.landed && seen(fb);
}

// ====================================================================== main loop
// Cap at ~75 fps: a 120/144 Hz screen draws every other refresh (60-72 fps) instead of
// making the GPU render twice as many frames nobody needs.
const MIN_FRAME = 1 / 75;
let last = clock();
function frame() {
  requestAnimationFrame(frame);
  const t = clock();
  if (t - last < MIN_FRAME - 0.001) return;
  // Down to 10 fps the game keeps real time; only slower than that does it go slow-motion
  // (huge steps would let a caveman skip through things). Projectiles step at a fixed 1/60 s.
  const dt = Math.min(0.1, t - last);
  if (gfxKey !== 'high') adaptResolution(t - last);
  last = t;
  if ((state.pingT -= dt) <= 0) {
    state.pingT = 2;
    send({ t: 'ping', ts: clock() });
  }
  if (state.worldReady) {
    const renderT = t + (state.clockOffset ?? 0) - INTERP;
    tilt.update();
    if (state.joined && state.myId) updateLocal(dt, t);
    updatePlayers(dt, t, renderT);
    updateSpears(dt, t);
    updateBoulders(dt, renderT);
    updateFireballs(dt);
    updateArmorDrops(dt);
    updateLoot(dt);
    updateBeasts(dt, renderT);
    updateShrooms(dt);
    updateMammon(dt);
    updateDisaster(dt);
    updateDoom(dt);
    if (state.myId) updateArc();
    state.world.update(dt, camera.position);
  }
  fx.update(dt);
  updateCamera(dt, t);
  if (state.worldReady) {
    const visible = horizonTest(camera.position);
    state.world.cull(visible);
    cullHidden(visible);
  }
  updateHud(dt, t);
  renderer.render(scene, camera);
  input.endFrame();
}

// ?debug exposes internals for poking at the game from the console
if (new URLSearchParams(location.search).has('debug')) window.__ss = { state, me, input, tilt, settings, fx, hud, sound, camera, scene, renderer, M, handlers };

initLobby();
settings.onChange(applySetting);   // applies every saved setting now, then each change as it happens
connect();
frame();
