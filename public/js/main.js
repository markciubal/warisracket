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
import { Farm } from './farm.js';
import { Town, SHOP_LOOK, zoneOf, drumsOf } from './town.js';
import { CHAT, SAY_IT, checkChat } from '/shared/chat.js';
import { OfflineSocket, OFFLINE_ROOM } from './offline.js';
import { GearView, meleeRows, rangedRows } from './gear.js';
import { buildProjectile, buildArmorDisplay, buildWeapon } from './weapons.js';
import { peltSwatchURL, softDotTexture } from './textures.js';
import { v3, mat, noise3, standOn, horizonTest, lift } from './util.js';
import { R } from '/shared/constants.js';   // live: the planet grows in a Ploughshares peace (setRadius)

const { PLAYER, PROJECTILE, VOLCANO } = C;
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
// iPhone and iPad Safari: no pinch-zoom (it ignores user-scalable=no; double-tap zoom is off in the
// CSS), and once the keyboard goes away the page goes back where it was, instead of staying
// pushed up and half off the screen
for (const type of ['gesturestart', 'gesturechange']) document.addEventListener(type, e => e.preventDefault(), { passive: false });
document.addEventListener('focusout', () => { if (isTouch) setTimeout(() => scrollTo(0, 0), 60); });
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
fx.hudEl = $('era-panel');
const farm = new Farm(scene);   // Ploughshares: the crops and buildings of a peace
const town = new Town(scene);   // ...and the shops that open up in it
const sound = new Sound();
const hud = new Hud();
const input = new Input(canvas, isTouch);
const tilt = new TiltAim();
const touch = isTouch ? new TouchControls(input, tilt, { council: () => toggleCouncil(), settings: () => toggleSettings(true), recenter: recenterTilt, quit: btn => askQuit(btn), chat: () => openChat(), rock: () => showQr() }) : null;
const projTemplates = Object.fromEntries(['spear', 'arrow', 'ball', 'bullet', 'pebble', 'tomato', 'rocket'].map(k => [k, buildProjectile(k)]));
const NO_STICK = new Set(['ball', 'bullet', 'pebble', 'tomato', 'rocket']);   // gone where they land

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
    case 'view':
      // switched mid-game (V, or here): glide over from the old view, the look kept in range
      if (state.joined && me.alive) {
        state.camGlide = { from: v === 'first' ? 'third' : 'first', at: clock(), secs: 0.45 };
        const [lo, hi] = PITCH_RANGE[v === 'first' ? 'first' : 'third'];
        me.pitch = M.clamp(me.pitch, lo, hi);
        me.aim = M.clamp(me.aim, lo, hi);
        hud.center(v === 'first' ? '1ST PERSON' : '3RD PERSON', isTouch ? '' : 'V SWITCHES', 1);
      }
      break;
    case 'flashes': hud.flashScale = v / 100; break;
    case 'dmgNumbers': fx.numbers = v; break;
    case 'chat':
      document.body.classList.toggle('no-chat', !v);
      if (!v) closeChat();
      break;
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

// The window changed size: the canvas follows, but in the frame, just before it's drawn (frame()
// calls this). Resizing a WebGL canvas wipes it, and on a phone resizes come in bursts between
// frames (an iPhone's Safari bars sliding in and out, a double tap): done there, each one showed a
// blank frame, a flicker.
let fitted = '';
function fitCanvas() {
  const size = `${innerWidth}x${innerHeight}`;
  if (size === fitted) return;
  fitted = size;
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
}

// ====================================================================== state
const state = {
  ws: null,
  connected: false,
  room: '',            // code of the rock (lobby) we're on, '' while still picking one
  offline: false,      // playing on our own rock in the browser (offline.js), not the server
  everConnected: false,   // reached the server at least once since the page opened
  asking: false,       // asked the server for a rock, no answer yet
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
  camGlide: null,      // the camera gliding between views: { from: 'first' | 'third', at, secs }
  miniScoreT: 0,
  radarT: 0,
  eruptUntil: 0,
  joinMsg: null,       // resent automatically after a reconnect
  retries: 0,
  restarting: false,
  clockOffset: null,   // server time minus client time, from snapshot timestamps
  ping: 0,
  pingT: 0,
  // planet rules + War mode clock, as last told by the server
  game: { mode: 'dotime', era: 0, phase: 'play', eraLeft: 0, eraLen: 45, endLeft: 0, eraSeconds: 45, botLevel: C.BOT_LEVEL_DEFAULT, bots: 4, open: 0, chief: 0, disaster: null, mmDead: 0,
    wave: 0, waveSize: 0, waveLevel: 0,   // co-op
    calm: 1, food: 0, vote: 0, yes: 0, no: 0,     // Ploughshares: peace holding this age, food store, the vote,
    radius: C.PLANET_R },                         // ...and how big the planet has grown
  gameAt: 0,
  armorDrops: new Map(),
  loot: new Map(),     // weapons and ammo pouches dropped by slain cavemen
  beasts: new Map(),   // killstreak beasts on the planet
  shrooms: new Map(),  // magic mushrooms on the ground
  motes: new Map(),    // motes a slain forest monster left (peace mode)
  perm: { might: 0, hide: 0 },   // gold motes I've kept
  strangers: new Map(),   // Ploughshares: kind strangers bringing food to the hungry
  mammonSaid: 0,       // when the Businessman last spoke (he doesn't get to talk all the time)
  talkNear: false,     // at his podium, where E talks to him
  penumbra: false,     // at the dark forest's edge, where E picks gear
  drumming: null,      // at a bonfire's drums: { shop, i } (which drum I'm at)
  reel: null,          // a fish on the line, being reeled in (startReel)
  reeled: null,        // ...and the last one: { kind, ms } (how long it took)
  forestTier: null,    // which ring of the dark forest I'm in (null: not in it)
  talkedAt: -99,       // ...and when he last answered
  mammonBubble: null,  // his last words over his head (fx floater)
  dyingBeasts: [],     // slain ones keeling over before they're removed
  standings: null,
  doomRun: null,       // the running finale (see startDoom)
  doomLook: 'fire',    // LOOKS key: how the ruined planet looks, kept while it heals
  doom: 0,             // how ruined the planet looks right now (0..1)
  doomTarget: 0,
  // Ploughshares, in peace
  buildKind: 0,        // BUILD_ORDER index: what the throw button builds
  lastPlant: 0,
  myVote: null,        // 'yes' | 'no' once I've voted
  harvestFest: false,  // the round ended in a harvest festival, not a fight
  peaceFrom: 0,        // when peace broke out, and how fat the Businessman was then (he wastes away)
  peaceFat: 0,
  // ...the town: my money, the clothes I've bought, and the shop I'm at (id, 0 = none)
  shells: 0,
  wardrobe: [],
  zone: 0,
  practice: null,      // ...the practice weapon I took from a range shed (RANGED key), if any
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
const eraRanged = () => C.ERAS[state.game.era].ranged;
// mine: the age's, or (in peace) a practice weapon from a range shed
const rangedKey = () => state.practice || eraRanged();
const rangedDef = () => C.RANGED[rangedKey()];
// Ploughshares, once peace breaks out: farming, not fighting, and nobody carries a ranged weapon
// except a practice one from a range shed
const peaceNow = () => state.game.phase === 'peace';
const heldRanged = pl => pl?.practice || (peaceNow() ? null : eraRanged());
const myShop = () => (peaceNow() && town.shops.get(state.zone)) || null;
const timedMode = mode => mode === 'dotime' || mode === 'plough';   // the ages go by on a clock
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
  setRadius(state.game.radius);
  if (prev.era !== state.game.era || (prev.phase === 'peace') !== peaceNow()) for (const pl of state.players.values()) pl.model.setRanged(heldRanged(pl));
  if (prev.phase !== 'peace' && peaceNow()) {
    // the Businessman wastes away from here on
    state.peaceFrom = clock();
    state.peaceFat = state.world?.mammon?.fat ?? 0.3;
  }
  document.body.classList.toggle('peace', peaceNow());
  if (prev.phase === 'peace' && !peaceNow()) closeChat();   // peace over: no more talking
  if (prev.mode !== state.game.mode) for (const pl of state.players.values()) pl.model.setTeam(teamOf(pl));
  if (prev.chief !== state.game.chief) {
    for (const pl of state.players.values()) pl.model.setChief(pl.id === state.game.chief);
    if (state.game.chief && state.game.chief === state.myId) hud.feed(`<span class="me">YOU ARE CHIEF</span> · ${isTouch ? 'RULES IN ☰' : 'C FOR RULES'}`);
  }
  refreshRules();
}

// ====================================================================== networking
// Off any rock (still picking one, or just left one) only these count: anything else is a
// straggler from the rock we left.
const OFF_ROCK = new Set(['room', 'noroom', 'rocks', 'world', 'restart', 'pong']);

// Same host and port as the page, so it works locally, on a LAN and behind Heroku's HTTPS router.
function connect() {
  if (state.offline) return;
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  hookUp(new WebSocket(`${proto}://${location.host}`));
}

// The connection, to the server or (offline) to the rock in a worker: the same messages both ways.
function hookUp(ws) {
  state.ws = ws;
  ws.onopen = () => {
    state.connected = true;
    if (!state.offline) state.everConnected = true;
    refreshRoomPick();
    requestRoom();
    askRocks();
    send({ t: 'ping', ts: clock() });
  };
  ws.onmessage = e => {
    const m = JSON.parse(e.data);
    if (!state.worldReady && !OFF_ROCK.has(m.t)) return;
    const fn = handlers[m.t];
    if (fn) fn(m);
  };
  ws.onclose = () => {
    if (state.ws !== ws) return;
    state.ws = null;
    Object.assign(state, { connected: false, asking: false });
    refreshRoomPick();
    if (state.offline) return;
    state.retries++;
    // never reached the server since the page opened (no signal, or the server's down): play
    // offline instead, rather than waiting on a connection that isn't coming
    if (!state.everConnected && state.retries >= 2 && !state.joined) {
      startOffline('NO CAVE SERVER, SO THIS IS YOUR OWN ROCK: JUST YOU AND THE BOTS.');
      return;
    }
    netBanner(state.restarting ? 'CAVE SERVER MOVING. BACK SOON...' : 'LOST CAVE SIGNAL. RECONNECTING...');
    // keep retrying forever, but after about a minute also offer a manual reload
    if (state.retries >= 14) $('disconnected').classList.remove('hidden');
    setTimeout(connect, Math.min(5000, 400 * 2 ** state.retries));
  };
}

// Offline: our own rock in a worker (the game the server runs, running here), you and the bots.
// why: a note for the lobby (we switched on our own because there's no server).
function startOffline(why = '') {
  if (state.offline) return;
  const old = state.ws;
  Object.assign(state, { offline: true, ws: null, connected: false, asking: false, retries: 0 });
  old?.close();   // (its onclose sees it's not ours any more)
  if (state.world) clearWorld();
  netBanner(null);
  $('disconnected').classList.add('hidden');
  setRoom(OFFLINE_ROOM);
  $('room-mode').textContent = why || 'OFFLINE: YOUR OWN ROCK, JUST YOU AND THE BOTS.';
  hookUp(new OfflineSocket());
}

// Off our own rock and back to the server's (to pick a rock there).
function goOnline() {
  const old = state.ws;
  Object.assign(state, { offline: false, ws: null, connected: false, asking: false, retries: 0 });
  old?.close();
  if (state.world) clearWorld();
  setRoom('');
  roomNote('');
  $('room-mode').textContent = '';
  connect();
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

function backOnline() {
  state.retries = 0;
  state.restarting = false;
  netBanner(null);
  $('disconnected').classList.add('hidden');
}

// ====================================================================== rocks (lobbies)
// Each rock is its own planet on the server, found by a short code. The address bar always
// shows ours (/KPTX), so it's the link to share and a reload lands back on it.
function setRoom(code) {
  state.room = code;
  // (our own rock offline has no link: the address stays as it was)
  if (!state.offline) history.replaceState(null, '', `/${code}${location.search}`);
  $('room-copy').classList.toggle('hidden', state.offline);
  // (a rock's code, link and QR code: nothing to share on your own rock offline)
  const sharable = !!code && !state.offline;
  for (const id of ['room-qr', 'lock-rock', 't-rock', 'rock-chip']) $(id).classList.toggle('hidden', !sharable);
  $('rock-chip').textContent = sharable ? `ROCK ${code}` : '';
  $('room-card-label').textContent = state.offline ? 'YOUR OWN ROCK · NOBODY ELSE ON IT' : 'ROCK CODE · FRIENDS TYPE IT IN, OR SCAN IT';
  if (!sharable) hideQr();
  $('room-leave').textContent = state.offline ? 'GO ONLINE' : 'OTHER ROCK';
  $('room-pick').classList.toggle('hidden', !!code);
  $('room-in').classList.toggle('hidden', !code);
  $('room-show').textContent = code;
  $('room-show').title = code ? `${location.host}/${code}` : '';
  if (!state.offline) $('room-mode').textContent = '';
  scoreRoom();
  if (!state.worldReady) {
    $('play').disabled = true;
    $('play').textContent = 'CONNECTING...';
  }
  refreshRoomPick();
  askRocks();   // back to picking: the list, now
}

// the rock's code (and who can join it) on the scoreboard, to read out mid-game
function scoreRoom() {
  const code = state.room;
  $('score-room').textContent = state.offline ? 'OFFLINE: YOU AND THE BOTS'
    : code ? `ROCK CODE ${code} · ${state.game.open ? 'PUBLIC' : 'PRIVATE'}` : '';
}

// (Re)connected: back onto our rock. make: if the server restarted, the rock comes back under the
// same code with the rules it had, so the whole tribe lands together again.
function requestRoom() {
  if (!state.room) return;
  const g = state.game;
  send({ t: 'room', code: state.room, make: 1, rules: state.world ? { mode: g.mode, botLevel: g.botLevel, bots: g.bots, open: g.open } : undefined });
}

// ---- JOIN MY ROCK: the code big, the link, and a QR code of the link (a phone camera opens it).
// From the lobby, the pause screen, or ☰ on a phone. The QR maker loads the first time it's needed.
let makeQr = null;
async function showQr() {
  if (!state.room || state.offline) return;
  const url = `${location.origin}/${state.room}`;
  $('qr-rock').textContent = state.room;
  $('qr-link').textContent = url.replace(/^https?:\/\//, '');
  $('qr').classList.remove('hidden');
  try {
    makeQr ||= (await import('/qr/qrcode.mjs')).default;
    const qr = makeQr(0, 'M');   // (0: as small as the link fits in)
    qr.addData(url);
    qr.make();
    $('qr-code').innerHTML = qr.createSvgTag({ cellSize: 4, margin: 12, scalable: true });
    $('qr-code').title = url;
  } catch {
    $('qr-code').textContent = 'NO QR CODE RIGHT NOW. TELL THEM THE CODE.';
  }
}
function hideQr() { $('qr').classList.add('hidden'); }
const qrOpen = () => !$('qr').classList.contains('hidden');

// ---- the open rocks list: every public rock on the server, busiest first, asked for every few
// seconds while you're picking one. A tap on one goes there.
function askRocks() {
  if (state.connected && !state.room && !state.offline && !document.hidden) send({ t: 'rocks' });
}
setInterval(askRocks, 3000);

// what's going on there: the age (or wave, or peace...), and whose rock it is
function rockLine(r) {
  const now = r.phase === 'peace' ? 'PEACE TIME' : r.phase === 'doom' ? 'WORLD ENDING' : r.phase === 'end' ? 'ROUND OVER'
    : r.mode === 'coop' ? (r.wave ? `WAVE ${r.wave}` : 'GETTING READY') : r.mode === 'classic' ? '' : C.ERAS[r.era]?.name || '';
  const who = r.humans ? (r.chief ? `CHIEF ${r.chief.toUpperCase()}` : '') : 'NOBODY PLAYING YET';
  return [C.MODES[r.mode], now, who].filter(Boolean).join(' · ');
}

function showRocks(list, max) {
  $('rocks-head').textContent = list.length ? `OPEN ROCKS (${list.length})` : 'OPEN ROCKS';
  $('rock-list').innerHTML = !list.length
    ? '<div class="rock-none">NO PUBLIC ROCKS RIGHT NOW. QUICK PLAY MAKES ONE.</div>'
    : list.map(r => {
      const full = r.humans >= max;
      const off = full || !state.connected || state.asking;
      return `<button class="rock-row" data-code="${esc(r.code)}"${off ? ' disabled' : ''} title="${full ? 'Full' : `Join rock ${esc(r.code)}`}">
        <b>${esc(r.code)}</b><span>${esc(rockLine(r))}</span><i>${full ? 'FULL' : `${r.humans}/${max}`}</i></button>`;
    }).join('');
}

function askRoom(msg) {
  if (!state.connected || state.asking) return;
  state.asking = true;
  send(msg);
  roomNote('');
  refreshRoomPick();
}

// Off this rock, back to picking one (offline: back online to pick one there).
function leaveRoom() {
  if (state.offline) { goOnline(); return; }
  const code = state.room;
  send({ t: 'room', leave: 1 });
  if (state.world) clearWorld();
  setRoom('');
  roomNote(`LEFT ROCK ${code}. A ROCK CLOSES WHEN NOBODY IS ON IT; ITS LINK STILL WORKS.`);
}

let makePublic = (() => { try { return localStorage.getItem('wir.makePublic') !== '0'; } catch { return true; } })();
function refreshRoomPick() {
  const ready = state.connected && !state.asking;
  $('room-new').disabled = $('room-go').disabled = $('room-quick').disabled = !ready;
  $('rock-list').querySelectorAll('.rock-row').forEach(b => { b.disabled = !ready || /FULL/.test(b.lastElementChild.textContent); });
  $('room-new').textContent = state.connected ? 'MAKE NEW ROCK' : 'CONNECTING...';
  $('room-quick').textContent = state.connected ? 'QUICK PLAY' : 'CONNECTING...';
  // a new rock: public (in everyone's list) or private (the code or link only). Remembered.
  $('room-vis').querySelectorAll('button').forEach(b => b.classList.toggle('on', b.dataset.v === (makePublic ? '1' : '0')));
  $('room-vis-desc').textContent = makePublic ? 'PUBLIC: IN THE OPEN ROCKS LIST. ANYONE CAN JOIN.' : 'PRIVATE: ONLY FOR WHOEVER YOU GIVE THE CODE OR LINK.';
}

// ---- the app: Chrome, Edge and Android offer to install it (GET THE APP); an iPhone or iPad
// adds it to the home screen from Safari's share menu, so there the button says how. Installed,
// or not, it opens and plays with no connection (sw.js keeps a copy; offline, you play the bots).
let installPrompt = null;
const installed = () => matchMedia('(display-mode: standalone), (display-mode: fullscreen)').matches || navigator.standalone === true;
const isIOS = /iP(hone|ad|od)/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
function refreshInstall() {
  $('get-app').classList.toggle('hidden', installed() || !(installPrompt || isIOS));
}
addEventListener('beforeinstallprompt', e => {
  e.preventDefault();   // (our own button, not the browser's mini bar)
  installPrompt = e;
  refreshInstall();
});
addEventListener('appinstalled', () => {
  installPrompt = null;
  refreshInstall();
  $('app-hint').classList.add('hidden');
});
async function getApp() {
  if (installPrompt) {
    installPrompt.prompt();
    await installPrompt.userChoice.catch(() => {});
    installPrompt = null;
    refreshInstall();
  } else {
    $('app-hint').textContent = 'ON IPHONE OR IPAD: TAP SHARE (THE SQUARE WITH THE ARROW), THEN ADD TO HOME SCREEN.';
    $('app-hint').classList.toggle('hidden');
  }
}

const ROOM_HELP = 'EACH ROCK IS ITS OWN GAME. JOIN AN OPEN ONE, OR MAKE YOUR OWN AND SHARE ITS CODE.';
function roomNote(text, err = false) {
  $('room-note').textContent = text || ROOM_HELP;
  $('room-note').classList.toggle('err', err);
}

// Phones get the share sheet; everyone else gets it on the clipboard (or a box to copy from,
// where the browser won't allow that, e.g. plain http on a LAN).
const shareLabel = () => (isTouch && navigator.share ? 'SHARE LINK' : 'COPY LINK');
// btn: the button that was pressed (the lobby's, or the one under the QR code)
function shareRoom(btn) {
  const url = `${location.origin}/${state.room}`;
  const manual = () => prompt('Copy this link for your friends:', url);
  if (isTouch && navigator.share) {
    navigator.share({ title: 'War is Racket', text: `Come bonk on rock ${state.room}!`, url }).catch(() => {});
  } else if (navigator.clipboard) {
    navigator.clipboard.writeText(url).then(() => {
      btn.textContent = 'COPIED!';
      setTimeout(() => { btn.textContent = shareLabel(); }, 1500);
    }, manual);
  } else {
    manual();
  }
}

// The planet grows when peace breaks out in Ploughshares (and shrinks back for the next round):
// the ground and everything standing on it move with it. Players, beasts and boulders are placed
// from R every frame anyway.
function setRadius(r) {
  if (!(r > 0) || r === R) return;
  const dR = r - R;
  C.setPlanetRadius(r);
  if (!state.world) return;   // (a new World is built at the new size)
  state.world.regrow(dR);
  farm.lift(dR);
  town.relayout();
  fx.lift(dR);
  for (const m of [...state.armorDrops.values(), ...state.loot.values(), ...state.shrooms.values()]) lift(m.group, dR);
  // (spears stuck in a target ride on the town)
  for (const s of state.spears.values()) if (s.stuck && !s.inTarget) setStuck(s, M.scale(s.pos, 1 + dR / M.len(s.pos)), s.dir);
}

// Drop everything from the previous connection; a restarted server rolls a brand-new planet.
function clearWorld() {
  state.world.dispose();
  state.world = null;
  for (const id of [...state.motes.keys()]) removeMote(id);
  for (const id of [...fishGear.keys()]) dropGear(id);
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
  farm.clear();
  town.clear();
  clearStrangers();
  Object.assign(state, { myId: 0, worldReady: false, clockOffset: null, standings: null, doom: 0, doomTarget: 0, zone: 0, practice: null });
  Object.assign(me, { alive: false, charging: false, armor: null, reward: null, beastId: 0 });
  hud.death(false);
  hud.roundEnd(null);
}

// Off the planet, back to the lobby tablet.
function showLobby() {
  Object.assign(state, { joined: false, joinMsg: null, drumming: null });
  sound.setDuck(false);
  input.enabled = false;
  input.unlock();
  touch?.show(false);
  hud.show(false);
  // these live outside the HUD and only update while playing
  hud.death(false);
  hud.roundEnd(null);
  $('lock-hint').classList.add('hidden');
  $('lobby').classList.remove('hidden');
}

// Quit: off the planet and back to this rock's lobby, still watching it (OOGA BOOGA goes straight
// back on, OTHER ROCK goes elsewhere). The first press only asks; a second one within 3 s quits,
// so a stray tap doesn't throw away a good score.
function askQuit(btn) {
  if (!state.joined) return;
  if (btn.classList.contains('armed')) { quitGame(); return; }
  armQuit(btn);
}

function armQuit(btn) {
  btn.dataset.label ??= btn.textContent;
  btn.textContent = 'SURE?';
  btn.classList.add('armed');
  clearTimeout(btn.disarm);
  btn.disarm = setTimeout(() => disarmQuit(btn), 3000);
}

function disarmQuit(btn) {
  if (!btn.classList.contains('armed')) return;
  clearTimeout(btn.disarm);
  btn.classList.remove('armed');
  if (btn.dataset.label) btn.textContent = btn.dataset.label;
}

// Installed on a computer, the game has a window of its own: EXIT TO DESKTOP closes it, as the
// window's ✕ (or Alt+F4) would. It asks first, like QUIT. A browser that won't let a page close its
// own window gets told which keys will.
const EXIT_BUTTONS = ['lobby-exit', 'lock-exit', 'settings-exit'];
const EXIT_KEYS = /Mac/.test(navigator.platform) ? '⌘Q' : 'ALT+F4';
for (const id of EXIT_BUTTONS) {
  $(id).classList.toggle('hidden', !installed() || isTouch);
  $(id).onclick = () => askExit($(id));
}
function askExit(btn) {
  if (!btn.classList.contains('armed')) { armQuit(btn); return; }
  disarmQuit(btn);
  if (document.fullscreenElement) document.exitFullscreen?.().catch(() => {});
  window.close();
  // (still here: it wouldn't)
  setTimeout(() => {
    btn.textContent = `PRESS ${EXIT_KEYS} TO CLOSE`;
    clearTimeout(btn.disarm);
    btn.disarm = setTimeout(() => { btn.textContent = btn.dataset.label; }, 4000);
  }, 300);
}

function quitGame() {
  if (!state.joined) return;
  send({ t: 'quit' });
  showLobby();
  toggleSettings(false);
  toggleCouncil(false, false);
  closePanels();
  closeChat();
  for (const id of ['lock-quit', 'settings-quit', 't-quit', ...EXIT_BUTTONS]) disarmQuit($(id));
  // our caveman goes when the server's pleave for him arrives
  state.myId = 0;
  state.zone = 0;
  Object.assign(me, { alive: false, charging: false, armor: null, reward: null, beastId: 0, buffs: {} });
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
    for (const mt of m.motes || []) addMote(mt);
    farm.clear();
    for (const c of m.crops || []) farm.addCrop(c);
    for (const b of m.builds || []) farm.addBuild(b);
    town.clear();
    for (const sh of m.shops || []) town.add(sh);
    for (const st of m.strangers || []) addStranger(st);
    if (m.doom) startDoom(m.doom);
    // Build every shader the scene needs now (in the background where the GPU allows it)
    // instead of stalling a frame the first time each thing comes into view.
    if (renderer.extensions.has('KHR_parallel_shader_compile')) renderer.compileAsync(scene, camera).catch(() => {});
    else renderer.compile(scene, camera);
    refreshRules();
    state.worldReady = true;
    backOnline();
    $('play').disabled = false;
    $('play').textContent = 'OOGA BOOGA!';
    if (state.joined && state.joinMsg) {
      send(state.joinMsg);
      if (rejoining) hud.center('BACK ON ROCK!', 'NEW PLANET, SAME CAVEMAN', 2.2);
    }
  },

  full(m) {
    showLobby();
    $('play').textContent = `CAVE FULL (${m.max}). TRY AGAIN`;
  },

  // the server put us on a rock: one we made, typed in, picked from the list or linked, one
  // QUICK PLAY found, or ours again after a reconnect
  room(m) {
    state.asking = false;
    setRoom(m.code);
    if (m.quick) {
      $('room-mode').textContent = m.humans
        ? `QUICK PLAY: A PUBLIC ROCK WITH ${m.humans} ${m.humans > 1 ? 'CAVEMEN' : 'CAVEMAN'} ON IT. OOGA BOOGA!`
        : 'QUICK PLAY: NOBODY ON A PUBLIC ROCK YET, SO HERE IS A NEW ONE. OTHERS WILL FIND IT IN THEIR LIST.';
    }
  },

  // the open rocks list (asked for every few seconds while picking a rock)
  rocks(m) {
    showRocks(m.list || [], m.max);
  },

  noroom(m) {
    state.asking = false;
    if (state.joined) showLobby();
    if (state.world) clearWorld();
    setRoom('');
    roomNote(m.full ? 'TOO MANY ROCKS ON SERVER RIGHT NOW. TRY AGAIN SOON.'
      : m.code ? `NO ROCK WITH CODE ${m.code}. CHECK CODE WITH FRIEND.` : `CODE IS ${C.ROOM_CODE.len} LETTERS.`, true);
  },

  restart() { state.restarting = true; },

  game(m) {
    setGame(m);
    if (m.changed?.length && state.joined) {
      const bits = [];
      if (m.changed.includes('mode')) bits.push(C.MODES[m.mode]);
      if (m.changed.includes('botLevel')) bits.push(`BOT BRAINS ${m.botLevel}/10 (${C.botLevelDef(m.botLevel).name})`);
      if (m.changed.includes('bots')) bits.push(m.bots ? `BOTS FILL TO ${m.bots}` : 'NO BOTS');
      if (m.changed.includes('open')) bits.push(m.open ? 'ROCK NOW PUBLIC: ANYONE CAN JOIN' : 'ROCK NOW PRIVATE: CODE ONLY');
      hud.feed(`<span class="streak">${m.by ? `CHIEF ${esc(m.by.toUpperCase())}` : 'SPIRITS'}:</span> ${bits.join(' · ')}`);
    }
  },

  era(m) {
    setGame(m);
    const era = C.ERAS[m.era];
    mammonSay(pick(C.MAMMON.newAge), { force: true });
    // a new age's weapon lands in front of you (the server drops it); yours is still yours
    const gift = era.regear && state.myId && me.alive;
    const sub = gift ? `NEW WEAPON AT YOUR FEET · ${isTouch ? 'GRAB' : 'E'} TO TAKE IT` : m.mode === 'plough' ? 'NOBODY HURT THIS AGE = PEACE' : era.sub;
    hud.center(`${era.name}!`, sub, 2.5);
    hud.flash(0.6, 'era');
    sound.play('era');
    const shout = { bow: 'bendy stick!', sword: 'shiny rock!', musket: 'boom stick!', gun: 'bang bang!', laser: 'zap zap!' }[era.id];
    if (shout) sound.speak(shout, { pitch: 0.3 });
    if (state.myId && me.alive) {
      const up = v3(me.p);
      fx.burst(up.clone().multiplyScalar(R + 1.5), { count: 30, color: '#ffd34d', speed: 6, size: 0.1, life: 1.2, up, emissive: true });
    }
  },

  roundend(m) {
    setGame(m);
    state.standings = m.standings;
    state.harvestFest = !!m.harvest;
    me.charging = false;
    if (!state.game.mmDead) {
      state.roundProfit = mammonGrowth().profit;
      mammonSay(m.harvest ? C.MAMMON.harvest : C.MAMMON.end, { force: true });
    }
    if (m.harvest) {
      sound.play('era');
      sound.speak('harvest feast!', { pitch: 0.3 });
      return;
    }
    if (m.mode === 'coop') {
      sound.play('die');
      sound.speak('tribe fall down', { pitch: 0.2 });
      return;
    }
    const doomed = !!m.disaster;
    if (!doomed) sound.play('era');
    const won = m.standings[0]?.id === state.myId;
    sound.speak(won ? 'me win! me best caveman!' : doomed ? 'everything gone' : 'time done', { pitch: 0.25 });
  },

  // The end of the world: the server picked the disaster and when and where everything lands.
  doom(m) {
    setGame(m);
    mammonSay(C.MAMMON.doom, { force: true });
    startDoom(m);
  },

  // ...and the bunker didn't help: last words, over he goes, money everywhere
  mammondie() {
    state.game.mmDead = 1;
    const mm = state.world?.mammon;
    if (!mm || mm.dead) return;
    state.roundProfit = mammonGrowth().profit;
    mammonSay(C.MAMMON.death, { force: true });
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

  // ---- peace mode: a round starts in peace (swords into ploughshares)
  peace(m) {
    setGame(m);
    me.charging = false;
    state.myVote = null;
    for (const pl of state.players.values()) { pl.practice = null; pl.model.setRanged(null); }
    state.practice = null;
    // (the server cleared every spear and arrow on the planet)
    for (const s of [...state.spears.values(), ...state.pending.values()]) dropSpear(s);
    state.spears.clear();
    state.pending.clear();
    hud.center('PEACE TIME!', FARM_HOW(), 4);
    if (state.joined) hud.feed('<span class="streak">THE TOWN IS OPENING:</span> FISH, DANCE, SOAK, DUEL, SHOOT TARGETS, SHOP');
    hud.flash(0.6, 'era');
    sound.play('era');
    sound.speak('peace! peace!', { pitch: 0.3 });
    mammonSay(C.MAMMON.peace, { force: true });
    if (state.joined && settings.get('chat')) hud.chatLine('', `THE TRIBE CAN TALK NOW, BUT ONLY ONE SYLLABLE PER WORD.${isTouch ? '' : ' ENTER TO TALK.'}`, { note: true });
  },

  // somebody hurt somebody: no peace this age
  peacebreak(m) {
    setGame(m);
    const by = state.players.get(m.by);
    if (state.joined) hud.feed(`<span class="streak">PEACE BROKEN</span> BY ${by ? `<span class="${m.by === state.myId ? 'me' : ''}">${esc(by.name)}</span>` : 'SOMEBODY'}`);
  },

  crop(m) {
    farm.addCrop(m);
    const pl = state.players.get(m.by);
    if (pl && pl.id !== state.myId) pl.model.playSwing(0.1);
    if (m.by === state.myId) sound.play('thunk');
  },

  // picked (or trampled by a new build, n = 0)
  harvest(m) {
    state.game.food = m.food;
    const at = farm.removeCrop(m.id);
    if (!at || !m.n) return;
    const up = at.clone().normalize();
    fx.burst(at.clone().addScaledVector(up, 0.4), { count: 10, color: '#e8c45a', speed: 3, size: 0.08, life: 0.7, up });
    if (m.by === state.myId) {
      sound.play('pickup');
      fx.float(at.clone().addScaledVector(up, 1.2), `+${m.n} FOOD`, 'heal', { life: 1 });
    }
  },

  build(m) {
    state.game.food = m.food;
    farm.addBuild(m);
    const u = v3(m.u).normalize();
    fx.dust(u.clone().multiplyScalar(R), u, 10);
    sound.play('stomp', distTo(m.u));
  },

  // ---- the town
  // a shop opens (the first one: the Businessman perks up)
  shop(m) {
    town.add(m);
    const u = v3(m.u).normalize();
    fx.dust(u.clone().multiplyScalar(R), u, 14);
    if (!state.joined) return;
    const def = C.SHOPS[m.kind], look = SHOP_LOOK[m.kind];
    sound.play('stomp', distTo(m.u));
    hud.feed(`<span style="color:${look.color}">${look.icon} ${def.name} OPEN</span>${m.first ? ' · THE TOWN IS GROWING' : ''}`);
    if (m.first) mammonSay(C.MAMMON.shop, { force: true });
  },

  // somebody walked into (or out of) a shop
  zone(m) {
    const pl = state.players.get(m.id);
    if (!pl) return;
    const was = pl.zone;
    pl.zone = m.z;
    if (m.id !== state.myId) return;
    state.zone = m.z;
    closePanels(penumbraOf() ? ['gear'] : []);   // walked away from the counter (the penumbra runs over the forest's edge: still there)
    if (!m.z) return;
    const kind = town.shops.get(m.z)?.kind;
    const key = isTouch ? 'TAP' : mouseWord(kind === 'range' ? 'ranged' : 'melee');
    const hello = {
      doctor: ['DOCTOR', me.hp < PLAYER.maxHp ? `${isTouch ? 'USE' : 'E'} · ALL BETTER FOR 1 🐚` : 'COME BACK WHEN HURT'],
      range: ['TARGET RANGE', state.practice ? `${isTouch ? 'WEAPONS' : 'E'} · SWAP IT OR HAND IT BACK` : `${isTouch ? 'WEAPONS' : 'E'} · PICK A PRACTICE WEAPON`],
      duel: ['DUEL RING', `${isTouch ? 'WEAPON' : 'E'} PICKS A WEAPON · KNOCK THEM TO 1 HP FOR ${C.SHOPS.duel.win} 🐚`],
      tailor: ['TAILOR', `${isTouch ? 'USE' : 'E'} · HATS AND CAPES`],
      haunt: ['DARK FOREST!', `${carrying() ? `YOUR ${C.duelWeapon(myPlayer().carry).name.toUpperCase()} VS THE MONSTERS` : 'YOUR HOE IS A TORCH IN HERE'} · THE DEEPER, THE WORSE (AND THE MORE 🐚)`],
      pond: ['FISHING POND', `${isTouch ? 'FISH' : 'E'} TO CAST · ${isTouch ? 'REEL' : 'E'} AGAIN WHEN IT BITES`],
      spring: ['HOT SPRING', 'SOAK A WHILE: LIFE COMES BACK'],
      bonfire: ['BONFIRE', `${isTouch ? 'DANCE' : 'E'} TO DANCE · MORE DANCERS, MORE 🐚`],
    }[kind];
    if (hello) hud.center(hello[0], hello[1], 1.8);
  },

  // the dark forest spread a ring: built again bigger (and the radar shows it)
  forest(m) {
    town.regrow(m.id, m.zone, m.rings);
    if (!state.joined) return;
    const heart = C.FOREST_TIERS[m.rings - 1];
    hud.feed(`<span style="color:${SHOP_LOOK.haunt.color}">🌲 THE DARK FOREST SPREADS</span> · ${heart.name} AT ITS HEART`);
    sound.play('wind');
  },

  // a vampire vanished and came back right behind somebody
  blink(m) {
    const b = state.beasts.get(m.id);
    if (!b) return;
    const puff = p => { const up = v3(p); for (let i = 0; i < 3; i++) fx.puff(up.clone().multiplyScalar(R + 0.6 + i * 0.5), { color: '#2a1630', size: 1.1, grow: 2, life: 0.9, vel: up.clone().multiplyScalar(0.6), alpha: 0.7 }); };
    puff(b.rp);
    b.snaps.length = 0;
    b.rp = m.p;
    b.rf = m.f;
    puff(m.p);
    sound.play('magic', distTo(m.p));
  },

  // a vampire's bite gave it life back
  bheal(m) {
    const b = state.beasts.get(m.id);
    if (!b) return;
    b.hp = m.hp;
    b.model.setHp(m.hp);
    fx.float(v3(b.rp).multiplyScalar(R + b.rh + C.BEASTS[b.kind].height + 0.3), `+${m.n}`, 'heal', { life: 1 });
  },

  // fishing at a pond: a cast, a bite, then a catch, or it swam off (too soon), got away (too
  // late), or the line came in (off the bank)
  fish(m) {
    const pl = state.players.get(m.id);
    if (!pl) return;
    const mine = m.id === state.myId;
    const over = () => v3(pl.rp).multiplyScalar(R + pl.rh + 2.4);
    if (m.s === 'cast') {
      pl.fish = { shop: m.shop, bit: false };
      pl.model.playSwing(0.1);
      if (mine) fx.float(over(), 'CAST! WAIT FOR A BITE...', 'ooga', { life: 1.4 });
      return;
    }
    if (m.s === 'bite') {
      if (pl.fish) pl.fish.bit = true;
      if (mine) {
        hud.center('BITE!', `${isTouch ? 'REEL' : 'E'} · HOOK IT!`, 1.1);
        sound.play('splash');
        buzz(40);
      }
      return;
    }
    if (m.s === 'hooked') {
      if (pl.fish) pl.fish.hooked = true;
      if (mine) startReel(m.kind);
      sound.play('splash', distTo(pl.rp));
      return;
    }
    pl.fish = null;
    if (mine) endReel();
    if (m.s === 'got') {
      const f = C.FISH[m.kind];
      state.game.food = m.food;
      pl.model.playSwing(0.05);
      sound.play('splash', distTo(pl.rp));
      if (mine) {
        // how long it took, to the millisecond (as timed here, tap by tap), and the best so far
        const ms = state.reeled?.kind === m.kind ? state.reeled.ms : m.ms;
        const best = fishBest[m.kind];
        if (!best || ms < best) {
          fishBest[m.kind] = ms;
          try { localStorage.setItem('wir.fishBest', JSON.stringify(fishBest)); } catch { /* (just not kept) */ }
        }
        const got = [f.shells ? `+${f.shells} 🐚` : '', f.food ? `+${f.food} FOOD` : ''].filter(Boolean).join(' · ') || 'WELL... IT IS A BOOT';
        hud.center(`${f.name}!`, `${got} · IN ${ms.toLocaleString('en-US')} MS${!best || ms < best ? (best ? ' · NEW BEST!' : '') : ` · BEST ${best.toLocaleString('en-US')} MS`}`, 2.4);
        if (f.shells) sound.play(f.shells >= 5 ? 'chaching' : 'coins');
      } else if (m.kind === 'golden') {
        hud.feed(`<span class="streak">${esc(pl.name.toUpperCase())}</span> CAUGHT A GOLDEN FISH IN ${m.ms.toLocaleString('en-US')} MS!`);
      }
    } else if (mine && m.s === 'soon') {
      fx.float(over(), 'TOO SOON! IT SWAM OFF', 'ooga', { life: 1.3 });
    } else if (mine && m.s === 'lost') {
      fx.float(over(), 'TOO SLOW! IT GOT AWAY', 'ooga', { life: 1.3 });
    } else if (mine && m.s === 'snap') {
      hud.center('SNAP!', 'THE LINE BROKE: IT WAS PULLING', 1.6);
      sound.play('break');
    } else if (mine && m.s === 'escaped') {
      hud.center('IT GOT AWAY!', 'REEL FASTER NEXT TIME', 1.6);
    }
  },

  // a hit on a bonfire's drums (k: 0 the big one, 1 the small one): mine already sounded
  drum(m) {
    if (m.id === state.myId) return;
    const pl = state.players.get(m.id);
    if (!pl) return;
    sound.drum(m.k, distTo(pl.rp));
    town.drumHit(m.shop, m.k);
    pl.model.playSwing(0.04);
  },

  // a shell for playing the drums (n: dancers and drummers there)
  band(m) {
    if (m.id !== state.myId) return;
    fx.float(v3(me.p).multiplyScalar(R + me.h + 2.4), `+1 🐚${m.n > 1 ? ` · ${m.n} IN THE BAND` : ''}`, 'heal', { life: 1.2 });
    sound.play('coins');
  },

  // dancing round a bonfire (on), stopping, and the shells it earns (paid: n dancing)
  dance(m) {
    const pl = state.players.get(m.id);
    if (!pl) return;
    const was = pl.dancing;
    pl.dancing = !!m.on;
    pl.model.setDancing(pl.dancing);
    if (m.id !== state.myId) return;
    if (m.paid) {
      fx.float(v3(me.p).multiplyScalar(R + me.h + 2.4), `+1 🐚${m.n > 1 ? ` · ${m.n} DANCING` : ''}`, 'heal', { life: 1.2 });
      sound.play('coins');
    } else if (pl.dancing && !was) {
      hud.center('DANCE!', `THE MORE DANCE, THE MORE 🐚 · ${isTouch ? 'MOVE' : 'WALK'} TO STOP`, 1.8);
    }
  },

  // someone took a practice weapon from a range shed (or handed it back: w null)
  practice(m) {
    const pl = state.players.get(m.id);
    if (!pl) return;
    pl.practice = m.w || null;
    pl.model.setRanged(heldRanged(pl));
    if (m.id !== state.myId) return;
    state.practice = pl.practice;
    Object.assign(me, { charging: false, charge: 0, regen: 0 });
    sound.play('pickup');
    if (m.quiet) return;   // (from the penumbra: its screen said)
    if (pl.practice) hud.center(`${C.RANGED[pl.practice].name.toUpperCase()}!`, 'TAKE IT ANYWHERE · BACK TO THE SHED TO STOP', 2.4);
    else hud.center('HANDED IT BACK', '', 1.4);
  },

  // a hit at the range: the target shakes, and straw flies
  target(m) {
    if (!town.shake(m.shop, m.i) || !m.pos) return;
    const at = v3(m.pos), up = at.clone().normalize();
    fx.burst(at, { count: 14, color: '#e8c45a', speed: 4, size: 0.08, life: 0.7, up });
    sound.play('thunk', distTo(up.toArray()));
    if (m.by === state.myId) fx.float(at.clone().addScaledVector(up, 0.9), m.paid ? pick(['BULLSEYE!', 'THWACK!', 'GOOD SHOT!']) : 'THWACK!', 'ooga', { life: 0.9 });
    if (C.RANGED[m.w]?.splat) splatTarget(m.shop, m.i, at);
  },

  doctor(m) {
    const pl = state.players.get(m.id);
    if (!pl) return;
    const up = v3(pl.rp);
    fx.burst(up.clone().multiplyScalar(R + pl.rh + 1.2), { count: 18, color: '#9dff8a', speed: 2.5, size: 0.09, life: 1, up, emissive: true, grav: -0.2 });
    if (m.id === state.myId) {
      hud.center('ALL BETTER!', 'THE DOCTOR TAKES 1 🐚', 1.6);
      sound.speak('all better!', { pitch: 0.35 });
    }
  },

  // a bout in the ring is won (down to 1 HP)
  duel(m) {
    const a = state.players.get(m.a), v = state.players.get(m.v);
    if (!state.joined) return;
    hud.feed(`<span class="${m.a === state.myId ? 'me' : ''}">${esc(playerName(a))}</span> WINS THE DUEL WITH <span class="${m.v === state.myId ? 'me' : ''}">${esc(playerName(v))}</span>`);
    if (m.a === state.myId) {
      hud.center('YOU WIN THE BOUT!', `+${m.n} 🐚`, 2);
      sound.play('kill');
    } else if (m.v === state.myId) {
      hud.center('YOU YIELD!', 'SEE THE DOCTOR · 1 🐚', 2.2);
    }
  },

  // new clothes (or clothes off)
  look(m) {
    const pl = state.players.get(m.id);
    if (!pl) return;
    pl.look = m.look;
    pl.model.setOutfit(m.look);
    const up = v3(pl.rp);
    fx.burst(up.clone().multiplyScalar(R + pl.rh + 1.8), { count: 14, color: '#ffe066', speed: 3, size: 0.08, life: 0.7, up, emissive: true });
    if (m.id === state.myId) {
      sound.play('pickup');
      if (state.joinMsg) Object.assign(state.joinMsg.look, { hat: m.look.hat, cape: m.look.cape });
      refreshTailor();
    }
  },

  // ---- peace chat
  chat(m) {
    const pl = state.players.get(m.id);
    if (!pl || !settings.get('chat')) return;
    hud.chatLine(pl.name, m.text, { mine: m.id === state.myId });
    fx.float(v3(pl.rp).multiplyScalar(R + pl.rh), m.text, 'emote chat', { life: CHAT.bubble, rise: 0.3, follow: pl.model.root, offset: 2.9 });
    const d = distTo(pl.rp);
    if (state.joined && d < 25) sound.speak(m.text.toLowerCase(), { pitch: 0.1 + (pl.id % 5) * 0.08, dist: d });
  },

  // ---- hunger: a stranger is on the way with food
  stranger(m) {
    addStranger(m);
    if (m.for === state.myId && state.joined) hud.feed('<span class="streak">A STRANGER</span> IS COMING WITH FOOD');
  },

  // ...the food changes hands, a kind word, and the stranger goes on their way
  fed(m) {
    const st = state.strangers.get(m.id), pl = state.players.get(m.v);
    const line = C.STRANGER.lines[m.line] || C.STRANGER.lines[0];
    if (st) {
      st.model.playSwing(0.15);
      setTimeout(() => { if (st.model.weaponMesh) st.model.weaponMesh.visible = false; }, 200);
      fx.float(v3(st.rp).multiplyScalar(R + 2.6), line, 'emote', { life: 2.4, rise: 0.4, follow: st.model.root, offset: 2.9 });
    }
    if (pl) {
      const up = v3(pl.rp);
      fx.burst(up.clone().multiplyScalar(R + pl.rh + 1.3), { count: 14, color: '#c0703a', speed: 2.5, size: 0.08, life: 0.8, up });
    }
    if (m.v === state.myId) {
      hud.center('A STRANGER SHARES FOOD', `+${C.STRANGER.food} LIFE`, 2.4);
      sound.speak(line.toLowerCase(), { pitch: 0.45 });
    }
    if (state.joined) mammonSay(pick(C.MAMMON.free));
  },

  strangergone(m) { removeStranger(m.id); },

  // the vote to keep farming: opens, then keep going (yes) or the round ends (no)
  vote(m) {
    setGame(m);
    if (m.start) state.myVote = null;
    if (!state.joined) return;
    if (m.start) sound.play('era');   // the vote panel itself asks the question
    else if (m.result === 'yes') hud.center(m.grow ? 'THE WORLD GROWS!' : 'MORE FARMING!', m.grow ? 'MORE FARMING, AND NEW PLACES TO FIND' : `${m.yes} YES · ${m.no} NO`, 2.8);
    else if (m.result === 'no') hud.feed(`<span class="streak">FARMING DONE</span> · ${m.yes} YES · ${m.no} NO`);
  },

  // the server turned down a planting or a build
  nope(m) {
    const text = { spot: 'NO ROOM HERE', food: `NEED ${m.need} FOOD`, full: 'TOO MANY CROPS', healthy: 'YOU ARE FINE!', shells: `NEED ${m.need} 🐚`, hands: 'HANDS FULL' }[m.why] || 'NO';
    if (m.why === 'chat') { hud.chatLine('', `NOT SAID. TOO LONG: ${(m.long || []).join(', ')}`, { note: true }); return; }
    fx.float(v3(me.p).multiplyScalar(R + me.h + 2.3), text, 'ooga', { life: 0.9 });
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
    farm.clear();       // the fields, buildings and town of the last peace go with the old world
    town.clear();
    clearStrangers();
    state.zone = 0;
    state.practice = null;   // (the practice weapons went back with the town, and the duel ring's)
    state.drumming = null;
    endReel();
    for (const id of [...state.motes.keys()]) removeMote(id);   // (they fade with the old world)
    for (const pl of state.players.values()) {
      Object.assign(pl, { zone: 0, practice: null, carry: null, fish: null, dancing: false });
      pl.model.setDancing(false);
    }
    closePanels();
    state.harvestFest = false;
    me.reward = null;   // streak rewards don't carry over into a new round
    for (const f of state.world?.fires || []) f.readyAt = 0;
    for (const pk of m.pickups) state.world?.setPickupWeapon(pk.id, pk.wpn);
    if (state.joined) {
      hud.center({ dotime: 'NEW STONE AGE!', plough: 'NEW STONE AGE!', classic: 'FOREVER STONE!', coop: 'TRIBE VS BOTS!' }[m.mode], '', 2);
      setTimeout(() => mammonSay(C.MAMMON.start, { force: true }), 3500);
    }
  },

  // co-op: a wave starts (start) or the last bot of one falls (cleared)
  wave(m) {
    setGame(m);
    if (!state.joined) return;
    if (m.start) {
      hud.center(`WAVE ${m.wave}!`, `${m.waveSize} BOTS COMING`, 2.5);
      sound.play('era');
      sound.speak(pick(['here they come!', 'bots! many bots!', 'tribe! bonk them!']), { pitch: 0.3 });
    } else if (m.cleared) {
      hud.center(`WAVE ${m.wave} DONE!`, 'FALLEN FRIENDS WAKE UP', 2.5);
      hud.flash(0.5, 'era');
      sound.play('kill');
      sound.speak('tribe strong!', { pitch: 0.3 });
    }
  },

  // ---- motes: a slain forest monster left one; somebody took one (by), or it faded (by 0)
  mote(m) {
    addMote(m);
    if (state.joined) sound.play('magic', distTo(m.u));
  },

  unmote(m) {
    const mt = state.motes.get(m.id);
    if (!mt) return;
    const def = C.MOTES.kinds[mt.kind];
    if (m.by) fx.burst(mt.bob.getWorldPosition(new THREE.Vector3()), { count: 10, color: def.color, speed: 3, size: 0.08, life: 0.6, emissive: true });
    removeMote(m.id);
    if (m.by !== state.myId) return;
    sound.play(def.perm ? 'chaching' : 'magic');
    // (a buff one: the 'buff' message says what it does)
    if (def.perm) hud.center(`${def.name}!`, `${def.desc} · ${m.n} OF ${def.max}`, 2.4);
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
      // (a mushroom, or a mote from the dark forest that does the same)
      hud.center(`${def.buff}!`, `${m.mote ? C.MOTES.kinds[m.mote].name : def.name}: ${def.desc} FOR ${m.left} SEC`, 2.2);
      sound.speak(pick(['oooh', 'whoa', 'me feel funny', 'ooga!']), { pitch: 0.4 });
      hud.flash(0.4, 'era');
    }
  },

  // ---- killstreak beasts
  reward(m) {
    const pl = state.players.get(m.id);
    const def = C.BEASTS[m.kind];
    if (!def) return;
    if (state.joined && !pl.bot) hud.feed(`<span class="streak">${esc(playerName(pl))} EARN ${def.icon} ${def.name.toUpperCase()}!</span>`);
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
    else if (m.a === 'swipe' && MONSTER_SWIPE[b.kind]) {
      const [noise, shout] = MONSTER_SWIPE[b.kind];
      sound.play(noise, d);
      if (shout && (b.kind === 'ghost' || Math.random() < 0.3)) fx.float(v3(b.rp).multiplyScalar(R + C.BEASTS[b.kind].height + 0.3), shout, 'ooga', { life: 0.9 });
    } else if (m.a === 'swipe') sound.play('clang', d);
    else if (m.a === 'pounce' && b.kind === 'werewolf') {
      sound.play('roar', d);
      fx.float(v3(b.rp).multiplyScalar(R + C.BEASTS.werewolf.height + 0.3), 'AWOOOO!', 'ooga', { life: 1 });
    }
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
    const name = b.monster ? `A ${b.name.toUpperCase()}` : `${esc(playerName(owner))}'S ${b.name.toUpperCase()}`;
    if (m.reason === 'slain' && b.monster) {
      const by = state.players.get(m.by);
      if (state.joined && by) hud.feed(`<span class="${m.by === state.myId ? 'me' : ''}">${esc(by.name)}</span> SLAY ${name}`);
      sound.play('shatter', distTo(b.rp));
      if (m.by === state.myId) hud.center(`YOU SLAY THE ${b.name.toUpperCase()}!`, `+${C.FOREST_TIERS[b.tier]?.reward ?? 2} 🐚`, 1.6);
    } else if (m.reason === 'slain') {
      const by = state.players.get(m.by);
      if (state.joined) hud.feed(by ? `<span class="${m.by === state.myId ? 'me' : ''}">${esc(by.name)}</span> SLAY ${name}!` : `${name} GO SLEEP`);
      sound.play('die', distTo(b.rp));
      if (m.by === state.myId) hud.center(`YOU SLAY ${b.name.toUpperCase()}!`, '', 1.6);
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
    // still picking a rock: no world is coming, so the server answering is what says we're back
    if (!state.room && state.retries) backOnline();
  },

  you(m) {
    state.myId = m.id;
    state.sq = m.sq;
    const pl = myPlayer();
    if (!pl) return;
    pl.model.isLocal = true;
    if (pl.model.tag) pl.model.tag.visible = false;
    state.practice = pl.practice;
    Object.assign(me, { p: pl.rp, f: pl.rf, h: 0, vh: 0, alive: true, hp: PLAYER.maxHp, ammo: m.ammo, wpn: pl.wpn, armor: null });
    wakeUp();   // (into the world: eyes open, and out over the shoulder)
    hud.setWeapon(pl.wpn);
    hud.setHp(me.hp);
    if (!me.helped) {
      me.helped = true;
      // first time on: the mode, and how to play
      const how = isTouch ? 'LEFT THUMB RUN · DRAG RIGHT SIDE TO AIM'
        : `WASD RUN · ${mouseWord('melee')} CLICK BONK · HOLD ${mouseWord('ranged')} CLICK THROW`;
      if (peaceNow()) hud.center('PEACE TIME!', FARM_HOW(), 4);
      else if (state.game.mode === 'plough') hud.center('PEACE TIME!', 'THE TOWN IS OPENING', 4);
      else hud.center({ dotime: 'MOST BONKS WINS!', classic: 'BONK EVERYBODY!', coop: 'BEAT THE BOT WAVES!' }[state.game.mode] || 'OOGA!', how, 4);
    }
  },

  pjoin(m) {
    const pl = addPlayer(m.pl);
    // while our own join is in flight (no id yet), the next pjoin is us
    if (state.joined && state.myId && pl.id !== state.myId && !pl.bot) hud.feed(`${esc(pl.name)} JOIN TRIBE`);
  },

  pleave(m) {
    const pl = state.players.get(m.id);
    if (!pl) return;
    pl.model.dispose();
    state.players.delete(m.id);
    if (state.joined && !pl.bot) hud.feed(`${esc(pl.name)} WANDER OFF`);
    updateOnline();
  },

  s(m) {
    // Track the freshest-arriving snapshot's offset; late (jittery) ones only nudge it down slowly.
    const t = m.ts / 1000;
    const sample = t - clock();
    if (state.clockOffset === null || sample > state.clockOffset) state.clockOffset = sample;
    else state.clockOffset += (sample - state.clockOffset) * 0.01;
    if (m.r) setRadius(m.r);
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
    // strangers: [id, px, py, pz, fx, fy, fz]
    for (const row of m.st || []) {
      const st = state.strangers.get(row[0]);
      if (!st) continue;
      st.snaps.push({ t, p: [row[1], row[2], row[3]], f: [row[4], row[5], row[6]] });
      if (st.snaps.length > 30) st.snaps.shift();
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
    if (m.shells === undefined) return;
    const gain = m.shells - state.shells;
    state.shells = m.shells;
    state.wardrobe = m.wardrobe || [];
    if (m.perm) state.perm = m.perm;
    if (gain && state.joined && me.alive) {
      fx.float(v3(me.p).multiplyScalar(R + me.h + 2.6), `${gain > 0 ? '+' : ''}${gain} 🐚`, gain > 0 ? 'heal' : 'ooga', { life: 1.1 });
      if (gain > 0) sound.play('coins');
    }
    if (panelOpen('tailor')) refreshTailor();
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
    setStuck(s, m.pos, m.dir, m.tg);
    if (m.tg) return;   // (the target's own hit shows the straw flying)
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
    if (m.boom && m.pos) {
      // a rocket going off
      const pos = v3(m.pos), up = pos.clone().normalize();
      const d = distTo(up.toArray());
      fx.explosion(pos, up);
      fx.decal(up, { radius: 1.7, color: '#1d1410', opacity: 0.5, life: 12 });
      sound.play('boom', d);
      fx.addShake(Math.max(0, 0.6 - d / 30));
    }
    if (m.splat && m.pos) {
      const pos = v3(m.pos), up = pos.clone().normalize();
      fx.burst(pos, { count: 16, color: '#d8382c', speed: 4, size: 0.09, life: 0.6, up });
      if (pos.length() < R + 0.4) fx.decal(up, { radius: 0.5, color: '#b02a20', opacity: 0.7, life: 12 });
      sound.play('munch', distTo(up.toArray()));
    }
    if (m.imp && !m.splat && m.pos) {
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
      // nobody dies in peace, but they can end up at 1 HP (the duel ring says its own thing)
      if (peaceNow() && m.hp <= 1 && !m.a) hud.center('OUCH! 1 HP LEFT', 'SEE THE DOCTOR · 1 🐚', 2.2);
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
      if (m.k !== 'doom' && m.k !== 'sleep') v.d++;   // (a nap in peace isn't a death)
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
      if (title && !k.bot) {
        hud.feed(`<span class="streak">${esc(k.name)} ${title}</span>`);
        if (k.id === state.myId) sound.speak(title.toLowerCase(), { pitch: 0.25 });
      }
    }
    if (m.v === state.myId) {
      if (settings.get('view') === 'first') state.camGlide = { from: 'first', at: clock(), secs: 0.9 };
      me.alive = false;
      me.deadAt = clock();
      // knocked out in peace: lie down where the server has me, which is where I'll wake up
      // (a slide from the blow that it hadn't heard about yet doesn't count)
      if (m.p) { me.p = m.p; me.kbv = [0, 0, 0]; }
      me.charging = false;
      me.deathText = line;
      sound.speak(pick(['ugh', 'oof', 'ow ow ow']), { pitch: 0.1 });
      buzz([60, 40, 120]);
    }
    if (m.a === state.myId && m.v !== state.myId) {
      const title = C.STREAKS[k?.streak];
      hud.center(`YOU BONK ${playerName(v).toUpperCase()}!`, title || '', 1.6);
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
      const waking = !me.alive;   // (back from sleep, or from the dead. Not a new round's fresh start.)
      const look = settings.get('view') === 'first' ? 0.05 : 0.32;
      Object.assign(me, {
        p: m.p, f: m.f, h: 0, vh: 0, kbv: [0, 0, 0], alive: true, hp: PLAYER.maxHp, ammo: rangedDef().ammo,
        wpn: m.wpn, armor: null, stunUntil: 0, slowUntil: 0, charging: false, pitch: look, aim: look, buffs: {},
      });
      if (waking) wakeUp();
      // however the phone is held now counts as "straight ahead"
      tilt.recenter();
      hud.death(false);
      hud.setHp(me.hp);
      hud.setWeapon(m.wpn);
      hud.center('WAKE UP!', m.wpn.name.toUpperCase(), 1.6);
    }
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
    if (m.carry !== undefined) pl.carry = m.carry || null;   // (a weapon kept off the duel ring's rack)
    if (m.id === state.myId) {
      me.wpn = m.wpn;
      hud.setWeapon(m.wpn);
      if (m.back) {
        sound.play('pickup');
        hud.center('HANDED IT BACK', 'THE HOE AGAIN OUT OF THE RING', 1.6);
      } else if (!m.era) {
        sound.play('pickup');
        hud.center(`GOT ${m.wpn.name.toUpperCase()}!`, m.carry ? 'YOURS TO KEEP · TAKE IT ANYWHERE' : '', 1.8);
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
    case 'bleed': return k ? `${vn} BLED OUT (THANK ${kn})` : `${vn} BLED OUT`;
    case 'sleep': return `${m.w ? `${esc(m.w.toUpperCase())} KNOCK OUT` : 'KNOCKED OUT:'} ${vn} · SLEEP IT OFF`;
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
  model.setRanged(heldRanged(p));
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
    model, snaps: [], rp: p.p, rf: p.f, rh: p.h, flags: 1 | (ammo << 5), ammo, speed: 0, streak: 0, zone: p.zone || 0, practice: p.practice || null, carry: p.carry || null,
    fish: p.fish ? { shop: p.fish.shop, bit: !!p.fish.bit } : null, dancing: !!p.dancing,
  };
  if (!p.alive) { model.die(); model.deadT = 10; }
  model.setDancing(pl.dancing);
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
  if (stuck) setStuck(s, stuck.pos, stuck.dir, stuck.tg);
  else orientSpear(s);
  if (id != null) state.spears.set(id, s);
  return s;
}

// The server says where it landed: hand it to the instanced pile (or keep a mesh if that's full).
// tg: [shop id, target index] when it's stuck in a target at a range
function setStuck(s, pos, dir, tg = null) {
  s.stuck = true;
  s.pos = pos.slice();
  s.dir = dir.slice();
  if (s.inst >= 0) poolRemove(s);
  if (tg && stickInTarget(s, tg)) return;
  if ((s.kind === 'spear' || s.kind === 'arrow') && poolAdd(s)) {
    s.mesh.removeFromParent();
    return;
  }
  orientSpear(s);
}

// Stuck in a target: it rides on the target from here on (and rocks with it when it's hit).
function stickInTarget(s, tg) {
  const target = town.target(tg[0], tg[1]);
  if (!target) return false;
  if (!s.mesh.parent) scene.add(s.mesh);
  orientSpear(s);
  s.mesh.updateMatrixWorld(true);
  target.hinge.attach(s.mesh);   // keeping where it is in the world
  s.inTarget = true;
  s.hidden = false;
  return true;
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
      const prev = s.pos.slice();
      M.stepProjectile(s.pos, s.vel, PHYS);
      const ground = M.len(s.pos) <= R;
      // (at a range: through a target's face, where it sticks in the straw)
      const inTarget = town.shops.size ? town.targetOnPath(prev, s.pos) : null;
      if (ground || inTarget || M.obstacleAt(s.pos, obstacles)) {
        // predicted landing; the server's 'stuck' event has the final say
        s.stuck = true;
        s.dir = M.norm(s.vel);
        const sink = s.kind === 'arrow' ? 0.18 : 0.3;
        if (ground) s.pos = M.scale(M.norm(s.pos), R - sink);
        if (inTarget) s.pos = M.madd(inTarget, s.dir, sink * 0.8);
        // balls, bullets, stones, tomatoes and rockets don't stick around; the server's event shows the rest
        if (NO_STICK.has(s.kind)) s.hidden = true;
        break;
      }
    }
    orientSpear(s);
    if (s.kind === 'rocket' && !s.hidden && (s.trail -= dt) <= 0) {
      // fire out the back, and a long trail of smoke
      s.trail = 0.02;
      fx.puff(s.mesh.position, { color: '#ff8a2a', size: 0.5, grow: 0.3, life: 0.18, alpha: 0.9, additive: true });
      fx.puff(s.mesh.position, { color: '#bdb6aa', size: 0.45, grow: 2.4, life: 1.3, alpha: 0.45 });
    } else if (s.kind !== 'bullet' && s.kind !== 'rocket' && (s.trail -= dt) <= 0) {
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

// ---- motes: glowing wisps bobbing about where a forest monster fell. Walk into one to take it.
const MOTE_GEO = new THREE.SphereGeometry(0.2, 12, 8);
function addMote(m) {
  removeMote(m.id);
  const def = C.MOTES.kinds[m.kind], gold = !!def.perm;
  const group = new THREE.Group(), bob = new THREE.Group();
  const orb = new THREE.Mesh(MOTE_GEO, new THREE.MeshBasicMaterial({ color: def.color }));
  orb.scale.setScalar(gold ? 1.4 : 1);
  const halo = new THREE.Sprite(new THREE.SpriteMaterial({ map: softDotTexture(), color: def.color, transparent: true, opacity: 0.85, depthWrite: false, blending: THREE.AdditiveBlending }));
  halo.scale.setScalar(gold ? 1.7 : 1.1);
  bob.add(orb, halo);
  bob.position.y = 1;
  group.add(bob);
  standOn(group, v3(M.norm(m.u)), 0);
  scene.add(group);
  state.motes.set(m.id, { id: m.id, kind: m.kind, u: m.u, group, bob });
}

function removeMote(id) {
  const m = state.motes.get(id);
  if (!m) return;
  m.group.removeFromParent();
  for (const c of m.bob.children) c.material.dispose();
  state.motes.delete(id);
}

function updateMotes(t) {
  for (const m of state.motes.values()) {
    m.bob.position.y = 1 + Math.sin(t * 3 + m.id) * 0.18;
    m.bob.rotation.y = t * 2;
  }
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

// ---- the bonfire's drums: E at one and you're playing (BOOM: attack button, TAK: throw button);
// walk off and you've stopped. Everyone hears; the band earns shells like the dancers.
function drumNear(shop) {
  if (shop?.kind !== 'bonfire') return null;
  let best = null, bestD = C.SHOPS.bonfire.drumReach;
  drumsOf(shop).forEach((d, i) => { const dist = M.arcDist(me.p, d); if (dist < bestD) { bestD = dist; best = i; } });
  return best;
}
function startDrumming(shop, i) {
  if (myPlayer()?.dancing) send({ t: 'dance', on: 0 });
  state.drumming = { shop: shop.id, i };
  hud.center('DRUMS!', isTouch ? 'BOOM · TAK · MOVE TO STOP' : `${mouseWord('melee')} CLICK: BOOM · ${mouseWord('ranged')} CLICK: TAK · WALK TO STOP`, 1.8);
}
function stopDrumming() { state.drumming = null; }
function hitDrum(k) {
  sound.drum(k);
  town.drumHit(state.drumming.shop, k);
  myPlayer()?.model.playSwing(0.04);
  sendState();
  send({ t: 'drum', k });
}

// ---- reeling a fish in, once it's hooked: E (REEL on a phone), tap after tap, each kind its own
// way (REELS). It happens here, so every tap counts at once; the server hears how it went and
// checks it. The clock runs from the hook, to the millisecond.
const fishBest = (() => { try { return JSON.parse(localStorage.getItem('wir.fishBest')) || {}; } catch { return {}; } })();
const between = ([a, b]) => a + Math.random() * (b - a);
function startReel(kind) {
  const fish = C.FISH[kind], how = fish.reel, t = clock();
  state.reel = { kind, how, start: t, progress: C.REELS.start, strain: 0, pulling: how === 'fighter', phaseUntil: how === 'fighter' ? t + between(C.REELS.fighter.pull) : 0, lastTap: -9, warn: '', warnUntil: 0 };
  $('reel-name').textContent = `${fish.name}!`;
  $('reel-how').textContent = fish.how;
  $('reel-strain-bar').classList.toggle('hidden', how !== 'fighter');
  $('reel').classList.remove('hidden');
  hud.prompt(null);
}

function endReel() {
  state.reel = null;
  $('reel').classList.add('hidden');
}

function reelTap(t) {
  const r = state.reel, rule = C.REELS[r.how];
  if (r.how === 'steady' && t - r.lastTap < rule.fast) {
    r.lastTap = t;
    Object.assign(r, { warn: 'TOO FAST! STEADY...', warnUntil: t + 0.5 });
    return;
  }
  r.lastTap = t;
  if (r.how === 'fighter' && r.pulling) {
    // fighting a fish that's pulling: the line takes the strain
    r.strain += rule.strain;
    Object.assign(r, { warn: 'IT PULLS! WAIT!', warnUntil: t + 0.5 });
    buzz(25);
    if (r.strain >= 1) reelDone(false, 'snap');
    return;
  }
  r.progress += rule.gain;
  if (r.progress >= 1) reelDone(true);
}

// landed (or lost: 'snap', 'escaped'): the server hears, and says what's caught
function reelDone(landed, why = 'escaped') {
  const r = state.reel;
  state.reeled = { kind: r.kind, ms: Math.round((clock() - r.start) * 1000) };
  send({ t: 'fish', ...(landed ? { landed: 1 } : { lost: why }) });
  endReel();
}

function updateReel(t, dt) {
  const r = state.reel;
  if (!r) return;
  const rule = C.REELS[r.how];
  if (r.how === 'fighter' && t >= r.phaseUntil) {
    r.pulling = !r.pulling;
    r.phaseUntil = t + between(r.pulling ? rule.pull : rule.rest);
  }
  r.progress -= (r.how === 'fighter' && r.pulling ? rule.pullSlip : rule.slip) * dt;
  if (rule.ease) r.strain = Math.max(0, r.strain - rule.ease * dt);
  if (r.progress <= 0) { reelDone(false, 'escaped'); return; }
  $('reel-fill').style.width = `${Math.min(1, r.progress) * 100}%`;
  $('reel-strain').style.width = `${Math.min(1, r.strain) * 100}%`;
  const warned = t < r.warnUntil;
  $('reel-state').textContent = warned ? r.warn : r.how === 'fighter' ? (r.pulling ? 'IT PULLS... WAIT' : 'IT TIRES! REEL! REEL!') : `${isTouch ? 'REEL' : 'E'}! ${isTouch ? 'REEL' : 'E'}! ${isTouch ? 'REEL' : 'E'}!`;
  $('reel-state').classList.toggle('bad', warned || (r.how === 'fighter' && r.pulling));
  $('reel-time').textContent = `${Math.round((t - r.start) * 1000).toLocaleString('en-US')} MS`;
}

// ---- fishing: a bobber out on the water in front of whoever's fishing, and a line to it from the
// end of their rod (the hoe, held up). It bobs; when a fish bites it dips and jerks.
const fishGear = new Map();   // player id -> { bob, line }
const BOBBER_GEO = new THREE.SphereGeometry(0.13, 10, 8);
const BOBBER_MAT = new THREE.MeshLambertMaterial({ color: '#e8352a' });
const LINE_MAT = new THREE.LineBasicMaterial({ color: '#f4efe2', transparent: true, opacity: 0.85 });
function dropGear(id) {
  const g = fishGear.get(id);
  if (!g) return;
  g.bob.removeFromParent();
  g.line.removeFromParent();
  g.line.geometry.dispose();
  fishGear.delete(id);
}
function updateFishing(t) {
  for (const id of [...fishGear.keys()]) if (!state.players.get(id)?.fish) dropGear(id);
  for (const pl of state.players.values()) {
    const s = pl.fish && pl.alive ? town.shops.get(pl.fish.shop) : null;
    if (!s) { dropGear(pl.id); continue; }
    let g = fishGear.get(pl.id);
    if (!g) {
      g = { bob: new THREE.Mesh(BOBBER_GEO, BOBBER_MAT), line: new THREE.Line(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3()]), LINE_MAT) };
      g.line.frustumCulled = false;
      scene.add(g.bob, g.line);
      fishGear.set(pl.id, g);
    }
    const toShore = M.towardDir(s.u, pl.rp);
    const spot = M.moveOnSphere(s.u, toShore, toShore, C.SHOPS.pond.r - 0.9)[0];
    const dip = pl.fish.hooked ? 0.22 + Math.abs(Math.sin(t * 9)) * 0.1 : pl.fish.bit ? 0.08 + Math.abs(Math.sin(t * 18)) * 0.12 : Math.sin(t * 2.5 + pl.id) * 0.025;
    g.bob.position.copy(v3(spot)).multiplyScalar(R + 0.1 - dip);
    const tip = v3(pl.rp).multiplyScalar(R + pl.rh + 2.0).addScaledVector(v3(M.towardDir(pl.rp, spot)), 1.0);
    const pos = g.line.geometry.attributes.position;
    pos.setXYZ(0, tip.x, tip.y, tip.z);
    pos.setXYZ(1, g.bob.position.x, g.bob.position.y, g.bob.position.z);
    pos.needsUpdate = true;
  }
}

// ====================================================================== the Businessman
// How fat: the ages so far (War mode and co-op) plus every bonk on the planet. Forever Stone has
// no ages, so there it's all bonks. Profit is what the round-end screen and his sign say.
function mammonGrowth() {
  const g = state.game;
  let kills = 0;
  for (const p of state.players.values()) kills += p.k || 0;
  const ages = g.mode === 'classic' ? 0 : g.era + (timedMode(g.mode) && g.phase === 'play' ? Math.min(1, 1 - clockLeft() / (g.eraLen || g.eraSeconds || 45)) : 0);
  const fat = g.mode === 'classic'
    ? Math.min(1, 0.05 + kills * 0.012)
    : Math.min(1, 0.05 + (ages / (C.ERAS.length - 1)) * 0.7 + Math.min(0.3, kills * 0.005));
  const profit = kills * C.MAMMON.profitPerBonk + Math.floor(ages) * C.MAMMON.profitPerAge;
  // peace: no war, no profit, and he wastes away
  if (g.phase === 'peace' || (g.phase === 'end' && state.harvestFest)) return { fat: Math.max(0.05, state.peaceFat - (clock() - state.peaceFrom) / 120), profit };
  return { fat, profit };
}

// He speaks (bubble over his head, a fat little laugh, a cash register) if he hasn't just.
function mammonSay(text, { force = false, cls = '', life = 3 } = {}) {
  const mm = state.world?.mammon;
  if (!mm || mm.dead || (!force && clock() - state.mammonSaid < 7)) return;
  state.mammonSaid = clock();
  mm.laugh();
  mm.sign.updateWorldMatrix(true, false);
  const at = mm.sign.getWorldPosition(new THREE.Vector3());   // above his sign, not on top of it
  const d = M.arcDist(me.p, C.MAMMON.at);
  if (state.joined && d < 45) {
    // one thing at a time: what he said last makes way. (Below the age panel: from up close he
    // towers over you, and on a phone his words went under it.)
    if (state.mammonBubble) state.mammonBubble.life = Math.min(state.mammonBubble.life, 0.2);
    state.mammonBubble = fx.float(at.addScaledVector(at.clone().normalize(), 0.9), text, `emote mammon ${cls}`, { life, rise: 0.3, belowHud: true });
    sound.play('chaching', d);
    sound.speak(text.toLowerCase().replace('cha-ching', ''), { pitch: 0.05, dist: d });
  }
}

// Standing at his podium (and him still alive to talk).
function nearMammon() {
  const mm = state.world?.mammon;
  return !!mm && !mm.dead && M.arcDist(me.p, C.MAMMON.at) < C.MAMMON.reach;
}

// E at his podium: he talks business. Each of his lines once, shuffled, before any comes round again.
const talked = { lines: null, left: [] };
function mammonTalk() {
  // (let him finish what he's telling you. Something he came out with on his own, he drops.)
  if (clock() - state.talkedAt < 1.5) return;
  state.talkedAt = clock();
  const g = state.game;
  const lines = g.phase === 'doom' ? C.MAMMON.talkDoom : peaceNow() ? C.MAMMON.talkPeace : C.MAMMON.talk;
  if (talked.lines !== lines || !talked.left.length) {
    talked.lines = lines;
    talked.left = [...lines].sort(() => Math.random() - 0.5);
  }
  const text = talked.left.pop()
    .replace('{profit}', mammonGrowth().profit)
    .replace('{age}', C.ERAS[g.era]?.name || 'THIS AGE');
  mammonSay(text, { force: true, cls: 'talk', life: Math.min(6, Math.max(3, text.length / 12)) });
}

// Whose skin he has: mine. My caveman's once I'm on the planet, else whatever I've picked in the lobby.
const mySkin = () => C.SKINS[myPlayer()?.look?.skin ?? profileLook?.skin] || C.SKINS[0];

function updateMammon(dt) {
  const mm = state.world?.mammon;
  if (!mm) return;
  if (state.game.mmDead && !mm.dead) mm.die(true);        // joined after the end of the world got him
  else if (!state.game.mmDead && mm.dead) mm.revive();    // a new world, a new Businessman
  // dressed for the age, geared up for the disaster, toasting a wiped-out tribe (co-op)
  const g = state.game;
  mm.setLook({ era: C.ERAS[g.era]?.id, disaster: g.phase === 'doom' ? g.disaster : null, party: g.phase === 'end' && !state.harvestFest, skin: mySkin() });
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

const BEAST_CALL = { dog: 'bark', mammoth: 'trumpet', trex: 'roar', ghost: 'wind', skeleton: 'clang', zombie: 'grunt', bat: 'whiff', vampire: 'magic', demon: 'wind', werewolf: 'snarl' };
// what a monster's attack sounds like, and what it shouts (now and then)
const MONSTER_SWIPE = {
  ghost: ['wind', 'BOO!'], skeleton: ['clang', null], zombie: ['grunt', 'BRAAAINS...'], bat: ['whiff', 'SKREE!'],
  vampire: ['chomp', 'I VANT YOUR LIFE!'], demon: ['wind', 'SHHH... SLEEP...'], werewolf: ['snarl', 'GRRRAAH!'],
};

function addBeast(m, fresh = true) {
  removeBeast(m.id, false);
  const owner = state.players.get(m.owner);
  const def = C.BEASTS[m.kind];
  const b = {
    id: m.id, kind: m.kind, name: m.name || def.name, owner: m.owner, rp: m.p, rf: m.f, rh: m.h || 0, hp: m.hp, maxHp: m.maxHp,
    until: clock() + (m.left ?? def.life), snaps: [], speed: 0, monster: !!m.monster, tier: m.tier ?? null,
  };
  // (the dark forest's monsters are nobody's)
  b.model = new Beast(m.kind, { label: b.monster ? b.name : `${owner ? owner.name : 'WILD'}'S ${b.name}`, team: beastTeam(b), look: m.look });
  b.model.setHp(m.hp);
  b.model.place(b.rp, b.rf, b.rh);
  if (!fresh) b.model.spawnT = 9;   // already out when we arrived: no rising out of the ground
  scene.add(b.model.root);
  state.beasts.set(b.id, b);
  if (m.owner === state.myId) { me.beastId = b.id; me.reward = null; }
  if (fresh && b.monster) {
    // a monster rises out of the hollow in a puff of gloom
    const up = v3(b.rp);
    for (let i = 0; i < 4; i++) fx.puff(up.clone().multiplyScalar(R + 0.4 + i * 0.4), { color: '#3a2a52', size: 1.2, grow: 2.5, life: 1.6, vel: up.clone().multiplyScalar(0.8), alpha: 0.6 });
    sound.play('wind', distTo(b.rp));
  } else if (fresh) {
    const up = v3(b.rp);
    fx.dust(up.clone().multiplyScalar(R), up, 14);
    fx.burst(up.clone().multiplyScalar(R + 0.5), { count: 24, color: '#8a6a45', speed: 7, size: 0.16, life: 1, up });
    fx.addShake(Math.max(0, 0.5 - distTo(b.rp) / 60));
    sound.play(BEAST_CALL[m.kind], distTo(b.rp));
    if (state.joined && owner && !owner.bot) hud.feed(`<span class="streak">${esc(playerName(owner))} CALL ${def.icon} ${b.name.toUpperCase()}!</span>`);
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

// A tomato on a target: a red splat on its face for a while (rocking with the target when it's hit).
const SPLAT_GEO = new THREE.CircleGeometry(0.2, 9);
function splatTarget(shop, i, at) {
  const tg = town.target(shop, i);
  if (!tg) return;
  const splat = new THREE.Mesh(SPLAT_GEO, new THREE.MeshBasicMaterial({ color: '#b02a20', transparent: true, opacity: 0.9, depthWrite: false }));
  splat.userData.shared = true;   // (shared geometry: the town mustn't dispose it)
  tg.hinge.updateWorldMatrix(true, false);
  const local = tg.hinge.worldToLocal(at.clone());
  splat.position.set(local.x, local.y, 0.09);
  splat.rotation.z = Math.random() * 6;
  splat.scale.setScalar(0.8 + Math.random() * 0.7);
  tg.hinge.add(splat);
  setTimeout(() => { splat.removeFromParent(); splat.material.dispose(); }, 12000);
}

// ---- kind strangers (Ploughshares): hooded, with food in hand, walking up to the hungry
function addStranger(m) {
  if (state.strangers.has(m.id)) return;
  const model = new Caveman({ name: 'STRANGER', look: m.look, bot: true, lifeBar: false });
  model.setRanged(null);
  model.setWeapon(C.weaponOfType('meatbone'));   // the food
  if (m.leaving) model.weaponMesh.visible = false;
  model.place(m.p, m.f, 0);
  scene.add(model.root);
  state.strangers.set(m.id, { id: m.id, model, snaps: [], rp: m.p, rf: m.f, speed: 0 });
  const up = v3(m.p);
  fx.dust(up.clone().multiplyScalar(R), up, 8);
}

function removeStranger(id) {
  const st = state.strangers.get(id);
  if (!st) return;
  const up = v3(st.rp);
  fx.puff(up.clone().multiplyScalar(R + 1), { color: '#d8c7a8', size: 1.2, grow: 2, life: 0.8, alpha: 0.6 });
  st.model.dispose();
  state.strangers.delete(id);
}

function clearStrangers() {
  for (const st of state.strangers.values()) st.model.dispose();
  state.strangers.clear();
}

function updateStrangers(dt, renderT) {
  for (const st of state.strangers.values()) {
    const s = sampleSnaps(st.snaps, renderT);
    if (s) {
      const moved = M.arcDist(st.rp, s.p);
      st.speed += (moved / Math.max(dt, 1e-4) - st.speed) * Math.min(1, dt * 8);
      st.rp = s.p;
      st.rf = s.f;
    }
    st.model.place(st.rp, st.rf, 0);
    st.model.update(dt, { speed: st.speed, air: false, charging: false, stunned: false });
  }
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
  if (peaceNow()) {
    $('beast-slot').classList.add('hidden');
    touch?.setBeast(C.BUILDS[C.BUILD_ORDER[state.buildKind]].icon, 'NEXT');
    return;
  }
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
  // lava from the volcano, or (in a Ploughshares peace) a rock out of the sky, burning up
  const mesh = new THREE.Mesh(new THREE.IcosahedronGeometry(m.sky ? 0.7 : 0.5, m.sky ? 0 : 1), m.sky ? mat('#6f6258', { flatShading: true }) : new THREE.MeshBasicMaterial({ color: '#ffb347' }));
  const core = new THREE.Mesh(new THREE.IcosahedronGeometry(m.sky ? 0.85 : 0.62, 0), new THREE.MeshBasicMaterial({ color: '#ff4d12', transparent: true, opacity: m.sky ? 0.3 : 0.55 }));
  mesh.add(core);
  scene.add(mesh);
  const fb = { id: m.id, mesh, pos: m.pos.slice(), vel: m.vel.slice(), acc: 0, trail: 0, landed: false, rings: [] };
  if (m.land) {
    const u = v3(m.land).normalize();
    fb.rings.push(fx.decal(u, { radius: VOLCANO.blast, inner: VOLCANO.blast - 0.3, color: '#ff3d1f', opacity: 0.9, pulse: true }));
    fb.rings.push(fx.decal(u, { radius: VOLCANO.blast, color: '#ff3d1f', opacity: 0.18 }));
    fb.landU = u.toArray();
    if (m.sky && state.joined && M.arcDist(me.p, fb.landU) < 14) {
      fx.float(u.clone().multiplyScalar(R + 2.5), 'LOOK UP!', 'ooga', { life: 1.4 });
      sound.play('skyfall', M.arcDist(me.p, fb.landU));
    }
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

// A shot, from the throwing hand (right of the head, or left for the left-handed). Two kinds, the
// two ways other third-person games do it:
// - What flies in a big arc (spears, arrows, stones, tomatoes: lift from LOFTED up) goes the way
//   I'm looking, raised by the weapon's lift: tip the view down to throw shorter, up to throw
//   further, and the dotted arc shows where it comes down (Fortnite's and Gears of War's
//   grenades). It's turned a touch so it comes down in line with the crosshair, not off to the
//   side where the hand is.
// - What flies straight and fast (guns, lasers, the crossbow, the bazooka) goes at whatever the
//   crosshair is on, raised just enough to make up for the drop on the way there (the bow in The
//   Last of Us). At the sky, out along the line of sight, with the weapon's own lift.
const LOFTED = 0.15;
function aimSolution(charge) {
  const def = rangedDef();
  const speed = M.lerp(def.minSpeed, def.maxSpeed, charge);
  const right = M.cross(me.f, me.p);
  const pos = M.add(M.scale(me.p, R + me.h + 1.65), M.add(M.scale(me.f, 0.25), M.scale(right, settings.get('lefty') ? -0.3 : 0.3)));
  const dir = def.lift >= LOFTED ? throwDir(def, pos, speed) : shootDir(def, pos, speed);
  return { pos, dir, vel: M.scale(dir, speed) };
}

// Thrown: up from where I face by the lift less the view's tilt, then turned about the up at my
// feet until it comes down on the crosshair's line: the great circle through the camera and its
// line of sight (the planet's middle is on it too, so a point's distance off it is a dot product).
// A couple of goes, each measuring how far one small turn moves the landing.
function throwDir(def, pos, speed) {
  const elev = def.lift - me.pitch;
  let dir = M.norm(M.add(M.scale(me.f, Math.cos(elev)), M.scale(me.p, Math.sin(elev))));
  const { pos: cam, look } = cameraRig(clock());
  const n = M.norm(M.cross(cam, look));
  const off = d => M.dot(landing(pos, M.scale(d, speed)), n);
  let o0 = off(dir);
  for (let i = 0; i < 2 && Math.abs(o0) > 0.05; i++) {
    const o1 = off(M.rotateAxis(dir, me.p, 0.02));
    if (Math.abs(o1 - o0) < 1e-6) break;
    dir = M.rotateAxis(dir, me.p, M.clamp((-o0 * 0.02) / (o1 - o0), -0.3, 0.3));
    o0 = off(dir);
  }
  return dir;
}

// where a shot comes down on bare ground (or where it's got to after a few seconds, if it hasn't)
function landing(pos, vel) {
  let last = pos;
  const hit = M.traceArc(pos, vel, null, 3.5, PHYS, p => { last = p; });
  return hit ? hit.pos : last;
}

// Shot: at the crosshair's target, raised just enough to come down onto it (halving the gap
// between too high and too low); at the sky, along the line of sight with the weapon's own lift.
function shootDir(def, pos, speed) {
  const { p: target, hit } = aimTarget();
  const at = M.norm(M.sub(target, pos));
  return loft(at, hit && !def.hitscan ? liftOnto(pos, at, speed, target, def.lift) : def.lift);
}

// at, turned up by a (radians) in the plane of it and straight up
function loft(at, a) {
  const above = M.sub(me.p, M.scale(at, M.dot(me.p, at)));
  return M.len(above) < 1e-6 ? at : M.norm(M.add(M.scale(at, Math.cos(a)), M.scale(M.norm(above), Math.sin(a))));
}

function liftOnto(pos, at, speed, target, lift) {
  let lo = -0.2, hi = Math.max(0.5, lift * 4);
  if (missBy(pos, at, speed, hi, target) < 0) return lift;   // (out of its reach: as it comes)
  for (let i = 0; i < 14; i++) {
    const a = (lo + hi) / 2;
    if (missBy(pos, at, speed, a, target) > 0) hi = a; else lo = a;
  }
  return (lo + hi) / 2;
}

// how far above (+) or below (-) the target a shot raised by a passes, once it's out that far
function missBy(pos, at, speed, a, target) {
  const p = pos.slice(), v = M.scale(loft(at, a), speed);
  const far = M.angleBetween(me.p, M.norm(target)), high = M.len(target);
  for (let t = 0; t < 4; t += PHYS) {
    M.stepProjectile(p, v, PHYS);
    if (M.angleBetween(me.p, M.norm(p)) >= far) return M.len(p) - high;
    if (M.len(p) <= R) return -1e3;   // (into the ground first: low)
  }
  return 1e3;   // (still going: high)
}

// What the crosshair is on: the first caveman, beast, range target, tree or rock, or bit of ground
// along the line of sight through the middle of the screen ({ p, hit: true }), or a point far off
// along it ({ p, hit: false }: the sky). It looks past what shots go through: friends (and in
// peace everybody), my own beast and my tribe's; huts, fences, shops and boulders.
const AIM_FAR = 80;
function aimTarget() {
  const { pos, pivot, look } = cameraRig(clock());
  const d = M.norm(M.sub(look, pos));
  // (from level with the pivot on: between the camera and the caveman there's nothing to aim at)
  const s0 = M.dot(M.sub(pivot, pos), d);
  // the ground, where the line meets the planet
  const b = M.dot(pos, d), c = M.dot(pos, pos) - R * R, disc = b * b - c;
  const ground = disc > 0 ? -b - Math.sqrt(disc) : Infinity;
  const end = Math.min(AIM_FAR, ground > s0 ? ground : AIM_FAR);
  const people = peaceNow() ? [] : [...state.players.values()].filter(o => o.id !== state.myId && o.alive && !isAlly(o));
  const beasts = [...state.beasts.values()].filter(bt => beastTeam(bt) === 'foe');
  let prev = M.madd(pos, d, s0);
  for (let s = s0 + 0.4; s < end; s += 0.4) {
    const p = M.madd(pos, d, s);
    if (M.obstacleAt(p, state.world.obstacles)) return { p, hit: true };
    const face = town.targetOnPath(prev, p);
    if (face) return { p: face, hit: true };
    if (people.some(o => M.hitPlayer(p, o.rp, o.rh, 0.55))) return { p, hit: true };
    const r = M.len(p);
    for (const bt of beasts) {
      const def = C.BEASTS[bt.kind];
      const hgt = r - R - bt.rh;
      if (hgt > -0.3 && hgt < def.height && M.arcDist(M.scale(p, 1 / r), bt.rp) < def.radius) return { p, hit: true };
    }
    prev = p;
  }
  return { p: M.madd(pos, d, end), hit: end < AIM_FAR };
}
const aimPoint = () => aimTarget().p;

// A straight shot that can't get to what the crosshair's on from the hand (the curve of the
// planet in the way, or the edge of a tree) turns the crosshair red, as in Fortnite and PUBG. A
// few times a second.
let blockedAt = 0;
function updateBlocked(t, canShoot) {
  if (t - blockedAt < 0.15) return;
  blockedAt = t;
  const def = rangedDef();
  let blocked = false;
  if (canShoot && me.alive && def.lift < LOFTED) {
    const { p: target, hit } = aimTarget();
    if (hit) {
      const { pos, dir, vel } = aimSolution(1);
      const end = def.hitscan ? traceZap(pos, dir, def.range) : M.traceArc(pos, vel, state.world.obstacles, 3, PHYS)?.pos;
      blocked = !!end && M.len(M.sub(end, pos)) < M.len(M.sub(target, pos)) - 0.8;
    }
  }
  $('crosshair').classList.toggle('blocked', blocked);
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
  pebble: ['PING!', 'PEW!', 'TAKE ROCK!'],
  tomato: ['SPLAT!', 'TOMATO!', 'CATCH!'],
  rocket: ['KA-BOOM!', 'FIRE!', 'OOGA BOOM BOOM!'],
};
const SHOT_SOUND = { spear: 'throw', arrow: 'twang', ball: 'musket', bullet: 'gun', laser: 'laser', pebble: 'twang', tomato: 'throw', rocket: 'musket' };

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
  } else if (kind === 'rocket') {
    // a flash out the front, and the back-blast out the back
    fx.puff(pos, { color: '#ffb347', size: 0.9, grow: 0.6, life: 0.12, alpha: 1, additive: true });
    for (let i = 0; i < 4; i++) fx.puff(pos.clone().addScaledVector(dir, -0.8 - i * 0.4), { color: '#d8d2c8', size: 0.7 + i * 0.2, grow: 2.5, life: 1.6, vel: dir.clone().multiplyScalar(-2), alpha: 0.5 });
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
    hud.rangedUsed();
    fx.addShake(0.04);
    return;
  }
  const tid = ++state.tid;
  const s = addSpear(null, state.myId, pos, vel, null, def.proj);
  s.tid = tid;
  state.pending.set(tid, s);
  sendAttack({ t: 'throw', pos: r4(pos), vel: r4(vel), tid });
  hud.rangedUsed();
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

// Ploughshares, in peace: the attack button plants, the throw button builds, Q picks what.
const FARM_HOW = () => (isTouch ? 'PLANT · BUILD · NEXT PICKS WHAT TO BUILD'
  : `${mouseWord('melee')} CLICK PLANT · ${mouseWord('ranged')} CLICK BUILD · Q PICKS WHAT`);

// A weapon kept off the duel ring's rack, in hand (not the hoe) wherever you go in the peace.
const carrying = () => peaceNow() && !!myPlayer()?.carry;

function farmInput(t) {
  // (in the duel ring, or with a weapon kept off its rack, the attack button bonks; with a practice
  // weapon the throw button throws; at the drums they're the drums: updateLocal)
  if (state.drumming) return;
  const kind = myShop()?.kind;
  if (kind !== 'duel' && kind !== 'haunt' && !carrying() && (input.pressed('KeyF') || input.mousePressed(BUTTON.melee)) && t - state.lastPlant > C.PEACE.plantCd) {
    state.lastPlant = t;
    sendState();
    send({ t: 'plant' });
    myPlayer()?.model.playSwing(0.1);
  }
  if (!state.practice && input.mousePressed(BUTTON.ranged)) {
    sendState();
    send({ t: 'build', kind: C.BUILD_ORDER[state.buildKind] });
  }
  if (input.pressed('KeyQ')) state.buildKind = (state.buildKind + 1) % C.BUILD_ORDER.length;
}

// E at a shop: the doctor patches you up (the server checks the money), the tailor and the duel
// ring's weapon rack open up.
function useShop(shop) {
  if (shop.kind === 'doctor') { sendState(); send({ t: 'grab' }); }
  else if (shop.kind === 'tailor') togglePanel('tailor', true);
  else if (shop.kind === 'duel') togglePanel('rack', true);
  else if (shop.kind === 'range') togglePanel('shed', true);
  else if (shop.kind === 'pond') { sendState(); send({ t: 'fish' }); }
  else if (shop.kind === 'bonfire') {
    const d = drumNear(shop);
    if (state.drumming) stopDrumming();
    else if (d !== null) startDrumming(shop, d);
    else { sendState(); send({ t: 'dance', on: myPlayer()?.dancing ? 0 : 1 }); }
  }
}

// What the prompt says at each shop.
function shopPrompt(shop) {
  const key = k => (isTouch ? '' : `<span class="key">${k}</span>`);
  switch (shop.kind) {
    case 'doctor': return me.hp < PLAYER.maxHp ? `${key('E')}DOCTOR · ALL BETTER FOR <span class="up">${C.SHOPS.doctor.fee} 🐚</span>` : 'DOCTOR · YOU ARE FINE';
    case 'tailor': return `${key('E')}TAILOR · HATS AND CAPES`;
    case 'range': return state.practice ? `${key('E')}RANGE SHED · SWAP IT OR HAND IT BACK`
      : `${key('E')}RANGE SHED · PICK A PRACTICE WEAPON · <span class="up">1 🐚 A HIT</span>`;
    case 'haunt': {
      const tier = forestTier(shop, me.p), T = C.FOREST_TIERS[tier];
      return `DARK FOREST · ${forestDepth(shop, tier)}: ${T.name} · ${isTouch ? 'BONK' : buttonName('melee')} THEM · <span class="up">${T.reward} 🐚 EACH</span>`;
    }
    case 'duel': return `${key('E')}PICK A WEAPON · ${isTouch ? 'BONK' : buttonName('melee')} · DOWN TO 1 HP WINS <span class="up">${C.SHOPS.duel.win} 🐚</span>`;
    case 'pond': {
      const f = myPlayer()?.fish;
      return state.reel ? null : !f ? `${key('E')}FISHING POND · CAST A LINE` : f.bit ? `${key('E')}<span class="up">BITE! HOOK IT!</span>` : 'WAIT FOR A BITE...';
    }
    case 'spring': return me.hp < PLAYER.maxHp ? `HOT SPRING · SOAKING <span class="up">+${C.SHOPS.spring.heal} LIFE A SECOND</span>` : 'HOT SPRING · WARM AND WELL';
    case 'bonfire':
      if (state.drumming) return `DRUMMING! ${isTouch ? 'BOOM' : mouseWord('melee')} · ${isTouch ? 'TAK' : mouseWord('ranged')} · <span class="up">🐚 FOR THE BAND</span> · ${isTouch ? 'MOVE' : 'WALK'} TO STOP`;
      if (drumNear(shop) !== null) return `${key('E')}THE DRUMS · PLAY THEM <span class="up">🐚 FOR THE BAND</span>`;
      return myPlayer()?.dancing ? `DANCING! <span class="up">🐚 ON THE WAY</span> · ${isTouch ? 'MOVE' : 'WALK'} TO STOP`
        : `${key('E')}BONFIRE · DANCE FOR 🐚 <span class="up">MORE DANCERS, MORE 🐚</span>`;
  }
  return null;
}

// Which ring of the dark forest p is in, from its edge (0) to its heart (rings - 1), and what to
// call it. The server's rings are the same.
function forestTier(s, p) {
  return M.clamp(Math.floor((zoneOf(s) - M.arcDist(p, s.at)) / C.SHOPS.haunt.ring), 0, (s.rings || 1) - 1);
}
const forestDepth = (s, tier) => (tier === (s.rings || 1) - 1 ? 'THE HEART' : tier === 0 ? 'THE EDGE' : 'DEEPER IN');

// What GRAB says on a phone at each place it works.
function grabLabel(kind) {
  if (state.talkNear) return 'TALK';
  if (state.penumbra) return 'GEAR';
  if (kind === 'pond') { const f = myPlayer()?.fish; return state.reel ? 'REEL!' : !f ? 'FISH' : f.bit ? 'HOOK!' : 'WAIT'; }
  if (kind === 'bonfire') return state.drumming || myPlayer()?.dancing ? 'STOP' : drumNear(myShop()) !== null ? 'DRUMS' : 'DANCE';
  return { doctor: 'HEAL', tailor: 'SHOP', duel: 'WEAPON', range: 'WEAPONS' }[kind] || 'GRAB';
}

// ---- the town's counters: the tailor's, and the duel ring's weapon rack. The mouse is free while
// one is open.
function refreshTailor() {
  const pl = myPlayer();
  if (pl) hud.tailor(state.shells, state.wardrobe, pl.look);
}
const PANELS = { tailor: refreshTailor, rack: () => hud.rack(me.wpn?.name, myPlayer()?.carry), shed: () => hud.shed(state.practice), gear: openGear };
const PANEL_CLOSED = { gear: () => gearView.stop() };
const panelOpen = id => !$(id).classList.contains('hidden');
const townPanelOpen = () => Object.keys(PANELS).some(panelOpen);
// relock: back to the game with the mouse (not after Esc, or when the server closed it)
function togglePanel(id, open = !panelOpen(id), relock = true) {
  if (open === panelOpen(id)) return;
  $(id).classList.toggle('hidden', !open);
  if (!open) PANEL_CLOSED[id]?.();
  if (open) {
    PANELS[id]();
    input.unlock();
  } else if (relock && state.joined && (me.alive || isTouch)) {
    input.lock();
  }
}
// keep: panels to leave open
function closePanels(keep = []) {
  for (const id of Object.keys(PANELS)) if (!keep.includes(id)) togglePanel(id, false, false);
}
for (const id of Object.keys(PANELS)) {
  $(`${id}-close`).onclick = () => togglePanel(id, false);
  $(`${id}-x`).onclick = () => togglePanel(id, false);
}
$('tailor-items').onclick = e => {
  const b = e.target.closest('button[data-item]');
  if (b?.dataset.item) send({ t: 'buy', item: b.dataset.item });
};
// ---- the penumbra round the dark forest: pick a melee and a ranged weapon to take in. The screen
// shows my caveman with both, going at a dummy at their real pace (gear.js), and their numbers.
const gearView = new GearView($('gear-canvas'), $('gear-floats'), $('gear-doing'));
const gearPick = { melee: 'club', ranged: 'spear' };
// the forest whose penumbra I'm in (its edge, and the band of gloom round it), if any
function penumbraOf() {
  for (const s of town.shops.values()) {
    if (s.kind !== 'haunt') continue;
    const d = M.arcDist(me.p, s.at);
    if (d > zoneOf(s) - 0.5 && d < zoneOf(s) + C.SHOPS.haunt.penumbra) return s;
  }
  return null;
}
function openGear() {
  // (what I've got already, else what I picked last time)
  gearPick.melee = myPlayer()?.carry || gearPick.melee;
  gearPick.ranged = state.practice || gearPick.ranged;
  const list = (keys, label, pick, only) => keys.map(k => `<button data-k="${k}" class="${k === pick ? 'on' : ''}${only?.(k) ? ' only' : ''}">${esc(label(k))}</button>`).join('');
  $('gear-melee').innerHTML = list(C.DUEL_WEAPONS, k => C.duelWeapon(k).name.toUpperCase(), gearPick.melee);
  $('gear-ranged').innerHTML = list(C.PRACTICE_WEAPONS, k => C.RANGED[k].name.toUpperCase(), gearPick.ranged, k => C.RANGED[k].peace);
  $('gear-back').classList.toggle('hidden', !myPlayer()?.carry && !state.practice);
  showGear();
  gearView.start();
}
function showGear() {
  const mult = 1 + state.perm.might * C.MOTES.kinds.might.perm;
  gearView.show(myPlayer()?.look || profileLook || {}, gearPick.melee, gearPick.ranged, mult);
  const table = (title, { rows, special }) => `<b>${esc(title)}</b><table>${rows.map(([k, v]) => `<tr><td>${k}</td><td>${v}</td></tr>`).join('')}</table>${special.length ? `<div class="special">${special.join(' · ')}</div>` : ''}`;
  $('gear-melee-stats').innerHTML = table(C.duelWeapon(gearPick.melee).name.toUpperCase(), meleeRows(C.duelWeapon(gearPick.melee), mult));
  $('gear-ranged-stats').innerHTML = table(C.RANGED[gearPick.ranged].name.toUpperCase(), rangedRows(C.RANGED[gearPick.ranged], mult));
  for (const [id, pick] of [['gear-melee', gearPick.melee], ['gear-ranged', gearPick.ranged]]) {
    for (const b of $(id).children) b.classList.toggle('on', b.dataset.k === pick);
  }
}
$('gear-melee').onclick = e => { const b = e.target.closest('button[data-k]'); if (b) { gearPick.melee = b.dataset.k; showGear(); } };
$('gear-ranged').onclick = e => { const b = e.target.closest('button[data-k]'); if (b) { gearPick.ranged = b.dataset.k; showGear(); } };
$('gear-take').onclick = () => {
  sendState();
  send({ t: 'gear', melee: gearPick.melee, ranged: gearPick.ranged });
  togglePanel('gear', false);
  hud.center('GEARED UP!', `${C.duelWeapon(gearPick.melee).name.toUpperCase()} + ${C.RANGED[gearPick.ranged].name.toUpperCase()} · INTO THE DARK`, 2.2);
  sound.play('pickup');
};
$('gear-back').onclick = () => {
  sendState();
  send({ t: 'gear', melee: '', ranged: '' });
  togglePanel('gear', false);
  hud.center('HANDED THEM BACK', 'THE HOE AGAIN', 1.6);
};

// the range shed: take one (or hand it back), and off you go
$('shed-items').onclick = e => {
  const b = e.target.closest('button[data-w]');
  if (!b) return;
  send({ t: 'practice', w: b.dataset.w || null });
  togglePanel('shed', false);
};
// pick one, and straight back into the ring with it
$('rack-items').onclick = e => {
  const b = e.target.closest('button[data-type]');
  if (!b) return;
  send({ t: 'duelwpn', type: b.dataset.type });
  togglePanel('rack', false);
};

// ---- peace chat: Enter (or 💬) opens the box, Enter says it, Esc (or an empty Enter) puts it away.
// Words of more than one beat are pointed out as you type, and the line isn't sent until they're gone.
const chatOpen = () => !$('chat-form').classList.contains('hidden');
const canChat = () => state.joined && peaceNow() && me.alive && settings.get('chat')
  && !townPanelOpen() && !settingsOpen() && $('council').classList.contains('hidden');
let lastSaid = 0;
let chatOpened = 0;

function openChat() {
  if (!canChat()) return;
  if (!chatOpen()) {
    input.keys.clear();   // whatever was held down stops (or the caveman walks off while you type)
    $('chat-form').classList.remove('hidden');
    $('chat-input').value = '';
    if (chatOpened++) egShown = [...SAY_KEYS].sort(() => Math.random() - 0.5).slice(0, 2);
    chatHint();
  }
  document.body.classList.add('chatting');
  $('chat-input').focus();
}

function closeChat() {
  $('chat-form').classList.add('hidden');
  document.body.classList.remove('chatting');
  $('chat-input').blur();
}

function chatHint() {
  const { long } = checkChat($('chat-input').value);
  $('chat-hint').textContent = long.length ? `TOO LONG: ${long.join(', ')}. ONLY ONE SYLLABLE PER WORD.` : 'ONLY ONE SYLLABLE PER WORD. ENTER TO SAY IT.';
  $('chat-hint').classList.toggle('bad', long.length > 0);
  chatExamples(long);
  return long;
}

// The grey examples under the box: how to say a long word in short ones. Two, picked each time
// the box opens (BANANA the first time); a long word you've typed that has one of its own goes first.
const SAY_KEYS = SAY_IT.map(([long, short]) => ({ long, short, words: checkChat(long).long }));
let egShown = [SAY_KEYS[0], SAY_KEYS[1 + Math.floor(Math.random() * (SAY_KEYS.length - 1))]];
function chatExamples(long) {
  const hits = SAY_KEYS.filter(e => e.words.some(w => long.includes(w)));
  const show = [...hits, ...egShown.filter(e => !hits.includes(e))].slice(0, 2);
  $('chat-eg').innerHTML = show.map(e => `<div>"${esc(e.long)}"? SAY "${esc(e.short)}"</div>`).join('');
}

$('chat-input').addEventListener('input', chatHint);
$('chat-input').addEventListener('keydown', e => { if (e.code === 'Escape') closeChat(); });
$('chat-form').addEventListener('submit', e => {
  e.preventDefault();
  const raw = $('chat-input').value;
  if (!checkChat(raw).text) { closeChat(); return; }
  const form = $('chat-form');
  if (chatHint().length || clock() - lastSaid < CHAT.gap) {
    // not yet: a shake, and the hint says why
    if (clock() - lastSaid < CHAT.gap && !checkChat(raw).long.length) $('chat-hint').textContent = 'SLOW DOWN.';
    form.classList.remove('no');
    void form.offsetWidth;
    form.classList.add('no');
    return;
  }
  lastSaid = clock();
  send({ t: 'chat', text: raw });
  closeChat();
});

function castVote(yes) {
  if (!state.game.vote) return;
  state.myVote = yes ? 'yes' : 'no';
  send({ t: 'vote', yes });
}
$('vote-yes').onclick = () => castVote(true);
$('vote-no').onclick = () => castVote(false);

function updateLocal(dt, t) {
  const pl = myPlayer();
  if (!pl) return;
  // the vote works paused or not
  if (state.game.vote && input.pressed('KeyY')) castVote(true);
  if (state.game.vote && input.pressed('KeyN')) castVote(false);
  const [mdx, rawDy] = input.consumeMouse();
  const sens = 0.0024 * settings.get('sens');
  const mdy = settings.get('invertY') ? -rawDy : rawDy;
  if (input.locked) {
    // tilt (phones) turns at a rate set by how far the phone leans, and adds an up/down offset
    // on top of the mouse / drag aim
    const tiltTurn = me.alive ? tilt.turn : 0, tiltPitch = me.alive ? tilt.pitch : 0;
    me.f = M.tangent(me.p, M.rotateAxis(me.f, me.p, -mdx * sens - tiltTurn * dt));
    if (me.alive) {
      const [lo, hi] = PITCH_RANGE[firstPerson() ? 'first' : 'third'];
      me.aim = M.clamp(me.aim + mdy * sens, lo - tiltPitch, hi - tiltPitch);
      me.pitch = M.clamp(me.aim + tiltPitch, lo, hi);
    }
  }
  const canAct = me.alive && t >= me.stunUntil && input.locked;
  // in peace: shooting only with a practice weapon (anywhere), bonking only in the duel ring
  const shop = myShop();
  const canShoot = canAct && !state.drumming && (fightingNow() || (peaceNow() && !!state.practice));
  updateBlocked(t, canShoot);
  const canBonk = canAct && !state.drumming && (fightingNow() || shop?.kind === 'duel' || shop?.kind === 'haunt' || carrying());
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
    if (dl > 0.1 && myPlayer()?.dancing && t - (me.danceStop || 0) > 0.5) {
      me.danceStop = t;
      send({ t: 'dance', on: 0 });
    }
    if (dl > 0.1 && state.drumming) stopDrumming();   // (walked off the drums)
    const slowed = t < me.slowUntil;
    const zoom = buffOn(me, 'fast') ? C.BUFF.fast : 1;
    const limp = peaceNow() && me.hp < C.PEACE.limpHp ? C.PEACE.limp : 1;   // hurt in peace: off to the doctor
    const speed = PLAYER.speed * ((me.wpn?.speed || 1) + (me.armor?.speed || 0)) * (slowed ? 0.55 : 1) * zoom * limp * (me.charging ? 0.6 : 1);
    // keys always give full speed; a thumbstick pushed halfway walks at half speed
    let disp = dl > 0 ? M.scale(dir, (speed * dt * Math.min(1, dl)) / dl) : [0, 0, 0];
    disp = M.madd(disp, me.kbv, dt);
    me.kbv = M.scale(me.kbv, Math.exp(-dt * 5));
    const len = M.len(disp);
    if (len > 1e-6) [me.p, me.f] = M.moveOnSphere(me.p, me.f, M.scale(disp, 1 / len), len);
    me.kbv = M.scale(M.tangent(me.p, me.kbv), M.len(me.kbv));

    [me.p, me.f] = M.collideObstacles(me.p, me.f, state.world.obstacles, PLAYER.radius);
    if (farm.solids().length) [me.p, me.f] = M.collideObstacles(me.p, me.f, farm.solids(), PLAYER.radius);
    if (town.solids().length) [me.p, me.f] = M.collideObstacles(me.p, me.f, town.solids(), PLAYER.radius);
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
      me.charging = canShoot && input.mouseDown(BUTTON.ranged) && me.ammo > 0;
      if (me.charging && t - me.lastThrow > def.cooldown) fireRanged(t, 1);
    } else if (me.charging) {
      // spear / bow / musket: hold to charge (or steady the aim), release to let fly
      if (!canShoot || me.ammo <= 0) me.charging = false;
      else {
        me.charge = def.chargeTime ? Math.min(1, me.charge + dt / def.chargeTime) : 1;
        if (!input.mouseDown(BUTTON.ranged)) fireRanged(t, me.charge);
      }
    } else if (canShoot && (input.mouseDown(BUTTON.ranged) || input.mousePressed(BUTTON.ranged)) && me.ammo > 0 && t - me.lastThrow > def.cooldown) {
      // (a click that's down and up again between two frames still counts: it lets fly next frame)
      me.charging = true;
      me.charge = 0;
    }
    if (canShoot && input.mousePressed(BUTTON.ranged) && me.ammo === 0) {
      const empty = { arrow: 'NO ARROW!', ball: 'RELOADING...', bullet: 'CLICK. NO BANG.', laser: 'NO ZAP JUICE!' }[def.proj] || 'NO SPEAR!';
      fx.float(v3(me.p).multiplyScalar(R + 2.3), empty, 'ooga', { life: 0.8 });
    }

    if (canBonk && (input.pressed('KeyF') || input.mousePressed(BUTTON.melee))) trySwing(t);
    if (canAct && peaceNow()) farmInput(t);
    else if (canAct && input.pressed('KeyQ')) beastCommand();

    const grab = peaceNow() ? null : nearestGrab();
    // ...and with nothing else to use there, at his podium E talks to the Businessman
    state.talkNear = !grab && !shop && nearMammon();
    // E (GRAB on a phone) also works the doctor, the tailor and the duel ring's rack
    state.grabNear = !!grab || ['doctor', 'tailor', 'duel', 'range', 'pond', 'bonfire'].includes(shop?.kind) || state.talkNear || !!penumbraOf();
    const shroom = nearestShroom(3.2);
    // at the dark forest's edge, in its penumbra: E picks what to take in
    const pen = !shop || shop.kind === 'haunt' ? penumbraOf() : null;
    state.penumbra = !!pen;
    // deeper into the dark forest: it says what lives here
    const tier = shop?.kind === 'haunt' ? forestTier(shop, me.p) : null;
    if (tier !== null && state.forestTier !== null && tier > state.forestTier) {
      const T = C.FOREST_TIERS[tier];
      hud.center(forestDepth(shop, tier), `${T.name} · ${T.reward} 🐚 EACH`, 1.5);
    }
    state.forestTier = tier;
    if (pen && !state.reel) hud.prompt(`${isTouch ? '' : '<span class="key">E</span>'}THE PENUMBRA · PICK YOUR GEAR FOR THE DARK FOREST`);
    else if (shop) hud.prompt(shopPrompt(shop));
    else if (grab?.meat) hud.prompt(`<span class="key">E</span>EAT ROAST MEAT <span class="up">+${C.MEAT.heal} LIFE</span>`);
    else if (grab?.armor) hud.armorPrompt(grab.armor, me.armor);
    else if (grab) hud.pickupPrompt(grab.pk, me.wpn);
    else if (state.talkNear) hud.prompt(`${isTouch ? '' : '<span class="key">E</span>'}THE BUSINESSMAN · TALK BUSINESS`);
    else if (shroom) {
      const d = C.SHROOMS[shroom.kind];
      hud.prompt(`<span style="color:${d.color}">${d.name}</span><span class="cmp">${d.buff}: ${d.desc} FOR ${d.secs} SEC · WALK OVER IT TO EAT</span>`);
    } else hud.prompt(null);
    if (grab && canAct && input.pressed('KeyE')) send({ t: 'grab' });
    updateReel(t, dt);
    if (state.reel && canAct && input.pressed('KeyE')) reelTap(t);
    else if (pen && canAct && input.pressed('KeyE')) togglePanel('gear', true);
    else if (shop && canAct && input.pressed('KeyE')) useShop(shop);
    if (state.drumming && shop?.id !== state.drumming.shop) stopDrumming();
    if (state.drumming && canAct) {
      if (input.pressed('KeyF') || input.mousePressed(BUTTON.melee)) hitDrum(0);
      if (input.mousePressed(BUTTON.ranged)) hitDrum(1);
    }
    // by the bonfire's drums, everything else goes quieter
    sound.setDuck(shop?.kind === 'bonfire');
    if (state.talkNear && canAct && input.pressed('KeyE')) mammonTalk();

    for (let i = 0; i < C.EMOTES.length; i++) {
      if (input.pressed(`Digit${i + 1}`) && t - me.lastEmote > 1.2) { me.lastEmote = t; send({ t: 'emote', i }); }
    }

    if (me.ammo < def.ammo) me.regen += (dt / def.regen) * (buffOn(me, 'quick') ? 2 : 1); else me.regen = 0;
  } else {
    hud.prompt(null);
    state.grabNear = state.talkNear = false;
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

const volcanoTop = () => new THREE.Vector3(0, R + VOLCANO.peak + 0.2, 0);
const waterTop = () => R + 2.6;    // deep enough to cover a caveman
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
  hud.center(`${def.icon} ${def.name}! ${def.icon}`, def.sub, 3);
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
  const WATER_TOP = waterTop();
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
    const p = run.center.clone().multiplyScalar(Math.cos(theta)).addScaledVector(dir, Math.sin(theta)).multiplyScalar(waterTop() + 1);
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
  hud.center(run.def.finale, '', 2.5);
  state.doomTarget = 1;
  fx.addShake(1.2);
  if (run.kind === 'meteor' || run.kind === 'volcano') {
    const u = run.center;
    const ground = run.kind === 'volcano' ? volcanoTop() : u.clone().multiplyScalar(R);
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

// Where the camera sits and what it looks at, before any shake: over the shoulder (shoulderRig),
// or in first person through my own eyes (eyeRig: the V key, or VIEW in settings; knocked out,
// it's over the shoulder again, to see myself asleep). The crosshair is the middle of the screen:
// the line from pos through look (aimPoint follows it). The camera can glide from one to the
// other (state.camGlide): out of my eyes when I wake up, or either way when V switches them.
const firstPerson = () => settings.get('view') === 'first' && me.alive;
const mix = (a, b, k) => M.add(M.scale(a, 1 - k), M.scale(b, k));
function cameraRig(t) {
  const want = firstPerson() ? eyeRig() : shoulderRig(t);
  const g = state.camGlide;
  if (!g) return want;
  const k = M.clamp((t - g.at) / g.secs, 0, 1);
  if (k >= 1) { state.camGlide = null; return want; }
  const from = g.from === 'first' ? eyeRig() : shoulderRig(t);
  const e = k * k * (3 - 2 * k);
  return { pos: mix(from.pos, want.pos, e), pivot: mix(from.pivot, want.pivot, e), look: mix(from.look, want.look, e) };
}

// It orbits a pivot above and right of the head so the caveman sits lower-left, clear of the
// crosshair (left of it and lower-right for the left-handed, so the throwing hand stays near it).
function shoulderRig(t) {
  const up = me.p, fw = me.f;
  const right = M.cross(fw, up);
  const head = M.scale(up, R + me.h + 1.75);
  const deadFor = me.alive ? 0 : t - me.deadAt;
  const dist = 6.2 + Math.min(5, deadFor * 2.5);
  const ph = me.pitch;
  const back = M.add(M.scale(fw, -Math.cos(ph)), M.scale(up, Math.sin(ph)));
  const pivot = M.add(head, M.add(M.scale(right, settings.get('lefty') ? -1.15 : 1.15), M.scale(up, 0.55)));
  let pos = M.madd(pivot, back, dist);
  if (M.len(pos) < R + 0.6) pos = M.scale(M.norm(pos), R + 0.6);
  return { pos, pivot, look: M.madd(pivot, back, -4) };
}

// my own eyes: at the front of the head, looking the way I face, tipped down by the pitch
function eyeRig() {
  const up = me.p, fw = me.f;
  const eye = M.add(M.scale(up, R + me.h + 1.72), M.scale(fw, 0.18));
  const look = M.add(M.scale(fw, Math.cos(me.pitch)), M.scale(up, -Math.sin(me.pitch)));
  return { pos: eye, pivot: eye, look: M.madd(eye, look, 4) };
}

// Waking up, or coming into the world: a blink (hud.wake), seen through my own eyes, then the
// camera draws back over my shoulder as they open (in first person it stays in them)
function wakeUp() {
  hud.wake();
  state.camGlide = { from: 'first', at: clock() + 0.35, secs: 1.2 };
}

// V: over the shoulder <-> my own eyes, gliding between them
const PITCH_RANGE = { third: [-0.35, 1.2], first: [-1.3, 1.3] };
function toggleView() {
  const was = settings.get('view');
  settings.set('view', was === 'first' ? 'third' : 'first');
}

function updateCamera(dt, t) {
  let focus, up;
  const pl = myPlayer();
  if (state.joined && pl) {
    up = v3(me.p);
    const rig = cameraRig(t);
    // (the camera in or near my own head: my caveman out of the way, as in most first-person
    // games, and no weapon held up across the view; back in sight as the camera draws away)
    pl.model.body.visible = M.len(M.sub(rig.pos, M.scale(me.p, R + me.h + 1.75))) > 1.3;
    const pos = v3(rig.pos);
    const look = v3(rig.look);
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
const THROW_LABEL = { spear: 'THROW', arrow: 'SHOOT', ball: 'BOOM', bullet: 'BANG', laser: 'ZAP', pebble: 'PING', tomato: 'SPLAT', rocket: 'FIRE' };
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
  hud.setStatus({ stun: t < me.stunUntil, slow: t < me.slowUntil, bleed: mine && mine.flags & 16, limp: peaceNow() && me.alive && me.hp < C.PEACE.limpHp,
    hungry: peaceNow() && me.alive && me.hp < 70 && me.hp >= C.PEACE.limpHp, buffs, perm: peaceNow() ? state.perm : null });
  hud.eruptWarning(t < state.eruptUntil);
  hud.scoreboard(state.players.values(), state.myId, input.down('Tab'), state.game.chief);
  // weapon stats only while the scores are up (Tab, or ☰ on a phone)
  document.body.classList.toggle('details', input.down('Tab'));
  const roundOver = state.game.phase === 'end';
  hud.roundEnd(roundOver ? state.standings : null, state.myId, left, state.game.disaster, coop ? state.game.wave : 0, state.roundProfit || 0, !!state.game.mmDead, state.harvestFest);
  if (peaceNow()) hud.setBuild(C.BUILD_ORDER[state.buildKind], state.game.food);
  hud.setShells(state.shells);
  const shopKind = myShop()?.kind;
  const practicing = peaceNow() && !!state.practice;
  document.body.classList.toggle('practicing', practicing);   // the ammo box comes back
  // what you've got from the town to take back: a practice weapon, a weapon off the duel ring's rack
  const notes = [];
  if (practicing) notes.push(shopKind === 'range'
    ? `${isTouch ? 'WEAPONS' : 'E'} · SWAP THE ${C.RANGED[state.practice].name.toUpperCase()} OR HAND IT BACK`
    : `PRACTICE: ${C.RANGED[state.practice].name.toUpperCase()} · BACK TO A RANGE SHED (OR THE PENUMBRA) TO STOP`);
  if (carrying()) {
    const kept = C.duelWeapon(myPlayer().carry).name.toUpperCase();
    notes.push(shopKind === 'duel' ? `${isTouch ? 'WEAPON' : 'E'} · SWAP THE ${kept} OR HAND IT BACK`
      : `KEPT: ${kept} · HAND IT BACK AT THE DUEL RING (OR THE PENUMBRA) TO PLANT AGAIN`);
  }
  hud.practiceNote(notes.join('\n') || null);
  hud.vote(state.game, state.myVote);
  const councilOpen = !$('council').classList.contains('hidden');
  $('lock-hint').classList.toggle('hidden', input.locked || !me.alive || councilOpen || settingsOpen() || townPanelOpen());
  if ($('lock-hint').classList.contains('hidden')) { disarmQuit($('lock-quit')); disarmQuit($('lock-exit')); }
  if (touch) {
    const def = rangedDef();
    const peace = peaceNow();
    // in peace: BONK plants and THROW builds (showing what it costs), except in the duel ring
    // and at a range; GRAB works the doctor and the tailor
    const building = peace && !state.practice;
    touch.update({
      grab: !!state.grabNear,
      chat: canChat() || chatOpen(),
      grabLabel: grabLabel(shopKind),
      chief: state.game.chief === state.myId,
      throwLabel: state.drumming ? 'TAK' : building ? 'BUILD' : THROW_LABEL[def.proj] || 'THROW',
      ammo: building ? C.BUILDS[C.BUILD_ORDER[state.buildKind]].cost : me.ammo,
      charge: me.charging && !def.auto ? me.charge : 0,
      verb: state.drumming ? 'BOOM' : peace && !carrying() && shopKind !== 'duel' && shopKind !== 'haunt' ? 'PLANT' : 'BONK',   // one word that always means melee (weapon verbs like ZAP clash with the throw button)
      cooldown: me.wpn ? (t - me.lastSwing) / me.wpn.cd : 1,
    });
  }

  if (!me.alive) {
    const left = Math.max(0, (peaceNow() ? C.PEACE.sleep : PLAYER.respawn) - (t - me.deadAt));
    const waiting = state.game.phase !== 'play' && !peaceNow();   // no getting up during the disaster or the victory screen
    let line;
    if (coop) {
      // co-op: down until the tribe clears the wave
      let standing = 0;
      for (const p of state.players.values()) if (!p.bot && p.alive) standing++;
      line = standing ? `WAKE UP WHEN WAVE DONE · ${standing} FRIEND${standing > 1 ? 'S' : ''} LEFT` : 'WHOLE TRIBE DOWN';
    } else {
      line = waiting ? 'WAIT FOR NEW STONE AGE' : left > 0.2 ? `WAKE UP IN ${Math.ceil(left)}` : 'WAKING UP...';
    }
    // the round-end scores take over the screen
    hud.death(!roundOver, me.deathText, line);
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
    for (const mt of state.motes.values()) items.push({ p: mt.u, color: C.MOTES.kinds[mt.kind].color, kind: 'loot' });
    for (const b of state.beasts.values()) items.push({ p: b.rp, color: beastTeam(b) === 'foe' ? '#ff4b4b' : '#5ef08a', kind: 'beast' });
    for (const sh of town.shops.values()) items.push({ p: sh.at, color: SHOP_LOOK[sh.kind].color, kind: 'shop' });
    for (const st of state.strangers.values()) items.push({ p: st.rp, color: '#9dff8a', kind: 'player' });
    // co-op: friends green, bots red. Otherwise everyone's a target: humans red, bots orange.
    const dotColor = p => (coop ? (p.bot ? '#ff4b4b' : '#5ef08a') : p.bot ? '#ff9a3c' : '#ff4b4b');
    for (const p of state.players.values()) if (p.id !== state.myId && p.alive) items.push({ p: p.rp, color: dotColor(p), kind: 'player' });
    const areas = [...town.shops.values()].filter(sh => sh.kind === 'haunt').map(sh => ({ p: sh.at, r: zoneOf(sh), rings: sh.rings || 1 }));
    hud.radar(me, items, areas);
  }
}

// ====================================================================== lobby
let profileLook = null;   // the look being picked in the lobby (the Businessman borrows its skin)

// the War is Racket Do Good Fund's Stripe page (DO GOOD FUND in the lobby)
const DO_GOOD_FUND = 'https://buy.stripe.com/7sY6oIfxA3Qgf94gHig3600';

function initLobby() {
  const saved = store.get('ss-profile') || {};
  const look = profileLook = { ...C.randomLook(), ...(saved.look || {}) };
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
    sound.inWorld = true;   // now, not next frame, so the shout below is heard
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
    }
  };
  $('play').onclick = join;
  nameEl.addEventListener('keydown', e => { if (e.key === 'Enter') join(); });
  $('open-settings').onclick = () => toggleSettings(true);
  // the War is Racket Do Good Fund: a dollar, through Stripe, in a tab of its own (the installed
  // app opens it in the browser)
  $('do-good').onclick = () => window.open(DO_GOOD_FUND, '_blank', 'noopener');

  // rocks: make one, or type in a friend's code (pasting their whole link works too)
  const codeEl = $('room-code');
  const joinCode = () => {
    const code = C.cleanRoomCode(codeEl.value);
    if (code) askRoom({ t: 'room', code });
    else roomNote(`CODE IS ${C.ROOM_CODE.len} LETTERS.`, true);
  };
  codeEl.addEventListener('input', () => {
    const v = codeEl.value.includes('/') ? codeEl.value.split('/').filter(Boolean).pop() ?? '' : codeEl.value;
    codeEl.value = v.toUpperCase().replace(/[^A-Z]/g, '').slice(0, C.ROOM_CODE.len);
    roomNote('');
  });
  codeEl.addEventListener('keydown', e => { if (e.key === 'Enter') joinCode(); });
  $('room-go').onclick = joinCode;
  $('room-new').onclick = () => askRoom({ t: 'room', create: 1, open: makePublic ? 1 : 0 });
  $('room-quick').onclick = () => askRoom({ t: 'room', quick: 1 });
  $('room-vis').onclick = e => {
    const b = e.target.closest('button');
    if (!b) return;
    makePublic = b.dataset.v === '1';
    try { localStorage.setItem('wir.makePublic', makePublic ? '1' : '0'); } catch { /* (just not remembered) */ }
    refreshRoomPick();
  };
  $('rock-list').onclick = e => {
    const b = e.target.closest('.rock-row');
    if (b && !b.disabled) askRoom({ t: 'room', code: b.dataset.code });
  };
  $('room-leave').onclick = leaveRoom;
  $('room-offline').onclick = () => startOffline();
  $('get-app').onclick = getApp;
  refreshInstall();
  $('room-copy').textContent = $('qr-copy').textContent = shareLabel();
  $('room-copy').onclick = () => shareRoom($('room-copy'));
  $('room-qr').onclick = showQr;
  $('qr-copy').onclick = () => shareRoom($('qr-copy'));
  $('qr-close').onclick = $('qr-x').onclick = hideQr;
  $('qr').onclick = e => { if (e.target === $('qr')) hideQr(); };   // (a tap outside the tablet)
  addEventListener('keydown', e => { if (e.code === 'Escape' && qrOpen()) hideQr(); });
  roomNote('');
  // opened from a share link (/KPTX): straight onto that rock once connected
  setRoom(C.cleanRoomCode(location.pathname.slice(1)));
}

// ====================================================================== settings panel
buildSettingsPanel(settings, $('settings-rows'));
const settingsOpen = () => !$('settings').classList.contains('hidden');

function toggleSettings(open = !settingsOpen()) {
  $('settings').classList.toggle('hidden', !open);
  if (open) {
    // quitting only makes sense from in a game (from the lobby it's just BACK)
    $('settings-quit').classList.toggle('hidden', !state.joined);
    // opened from the pause screen: BACK goes back to it rather than into the game
    state.settingsFromPause = state.joined && !isTouch && !input.locked;
    touch?.setTribe(false);
    input.unlock();
  } else {
    disarmQuit($('settings-quit'));
    disarmQuit($('settings-exit'));
    if (state.joined && !state.settingsFromPause && (me.alive || isTouch) && $('council').classList.contains('hidden')) input.lock();
  }
}
$('settings-close').onclick = () => toggleSettings(false);
$('settings-x').onclick = () => toggleSettings(false);
$('settings-quit').onclick = () => askQuit($('settings-quit'));
// the pause screen (mouse freed with Esc): back in, settings, or quit
$('lock-resume').onclick = () => input.lock();
$('lock-settings').onclick = () => toggleSettings(true);
$('lock-rock').onclick = showQr;
$('lock-quit').onclick = () => askQuit($('lock-quit'));
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
    </div>
    <div class="rule" data-open-rule><span>ROCK IS</span>
      <div class="seg" data-key="open"><button data-v="1">PUBLIC</button><button data-v="0">PRIVATE</button></div>
      <div class="rule-desc" data-open-desc></div>
    </div>`;
  root.addEventListener('click', e => {
    const btn = e.target.closest('button');
    if (!btn || btn.disabled) return;
    const g = state.game;
    const want = { mode: g.mode, botLevel: g.botLevel, bots: g.bots, open: g.open };
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
    root.querySelector('[data-level-desc]').textContent = `${g.botLevel}/10 ${lvl.name}: ${lvl.desc}`;
    root.querySelector('[data-bots]').textContent = g.bots;
    root.querySelector('[data-fill-desc]').textContent = coop ? 'NOT USED: WAVES DECIDE.' : '0 = HUMANS ONLY.';
    // (your own rock offline is nobody else's to join)
    root.querySelector('[data-open-rule]').classList.toggle('hidden', state.offline);
    root.querySelector('[data-open-desc]').textContent = g.open ? 'IN THE OPEN ROCKS LIST: ANYONE CAN JOIN.' : 'ONLY WHOEVER HAS THE CODE OR LINK.';
    root.querySelector('[data-desc]').textContent = {
      dotime: `SIX AGES, ${g.eraSeconds} SEC EACH, THEN THE WORLD ENDS. MOST BONKS WINS.`,
      plough: 'NO WAR AT ALL. FARM, BUILD, FISH, DANCE ROUND THE BONFIRE, SOAK IN A HOT SPRING, DUEL (DOWN TO 1 HP), SHOOT TARGETS, FIGHT MONSTERS AND SHOP. VOTE TO KEEP GOING.',
      classic: 'SPEARS AND BONES FOREVER. NO CLOCK.',
      coop: 'ALL HUMANS VS WAVES OF BOTS.',
    }[g.mode];
  }
  // folded away in the lobby: one line says what's set
  $('rules-sum').textContent = `RULES: ${C.MODES[g.mode]} · ${g.mode === 'coop' ? 'WAVES' : `${g.bots} BOTS`} · BRAINS ${g.botLevel}${state.offline ? '' : g.open ? ' · PUBLIC' : ' · PRIVATE'}`;
  scoreRoom();
  $('lobby-note').textContent = humans.length === 0 ? 'YOU PICK THE RULES.' : `CHIEF ${chiefName} PICKS THE RULES.`;
  $('council-note').textContent = iAmChief ? 'NEW MODE = NEW ROUND.' : `ONLY CHIEF ${chiefName} CAN CHANGE RULES.`;
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
$('council-x').onclick = () => toggleCouncil(false);
refreshRules();

addEventListener('keydown', e => {
  if (e.target instanceof HTMLInputElement && e.target.type === 'text') return;   // typing a name
  if (e.code === 'Escape' && settingsOpen()) { toggleSettings(false); return; }
  if (e.code === 'KeyO') toggleSettings();
  if (!state.joined) return;
  if (e.code === 'KeyM') hud.center(settings.toggle('muted') ? 'QUIET CAVE' : 'LOUD CAVE', '', 1);
  if (e.code === 'KeyN' && !state.game.vote) hud.center(settings.toggle('music') ? 'DRUMS ON' : 'DRUMS OFF', '', 1);
  if (e.code === 'KeyG') {
    settings.set('gfx', GFX_ORDER[(GFX_ORDER.indexOf(gfxKey) + 1) % GFX_ORDER.length]);
    hud.center(`GRAPHICS: ${GFX[gfxKey].label}`, '', 1.2);
  }
  if (e.code === 'KeyC') toggleCouncil();
  if (e.code === 'KeyV') toggleView();
  if ((e.code === 'Enter' || e.code === 'NumpadEnter') && canChat()) { e.preventDefault(); openChat(); }
  if (e.code === 'Escape' && !$('council').classList.contains('hidden')) toggleCouncil(false, false);
  if (e.code === 'Escape' && townPanelOpen()) closePanels();
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
  for (const st of state.strangers.values()) st.model.root.visible = visible(st.rp[0], st.rp[1], st.rp[2], R + 2.9, 0.03);
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
  fitCanvas();   // (a frame that draws: so a resize is never shown wiped)
  // Down to 10 fps the game keeps real time; only slower than that does it go slow-motion
  // (huge steps would let a caveman skip through things). Projectiles step at a fixed 1/60 s.
  const dt = Math.min(0.1, t - last);
  sound.inWorld = state.joined;   // game sounds only while playing; the lobby just has the drums
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
    updateStrangers(dt, renderT);
    updateShrooms(dt);
    farm.update();
    town.update(camera.position);
    updateFishing(clock());
    updateMotes(clock());
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
if (new URLSearchParams(location.search).has('debug')) window.__ss = { state, me, input, tilt, settings, fx, hud, sound, camera, scene, renderer, M, C, handlers, farm, town, aim: { aimSolution, aimPoint, cameraRig } };

initLobby();
settings.onChange(applySetting);   // applies every saved setting now, then each change as it happens
sound.autostart();                 // drums from the start (after the settings, so at the saved volumes)
// keep a copy of the game for playing offline (secure pages only: https, or localhost)
if ('serviceWorker' in navigator && isSecureContext) navigator.serviceWorker.register('/sw.js').catch(() => {});
// no signal at all: straight onto our own rock; otherwise the server (which goes offline by itself
// if it can't be reached)
if (navigator.onLine === false) startOffline('NO SIGNAL, SO THIS IS YOUR OWN ROCK: JUST YOU AND THE BOTS.');
else connect();
frame();
