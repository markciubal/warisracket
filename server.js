// War is Racket game server: static files + the WebSocket front door. Every rock (lobby) is its
// own planet, simulated by room.js under a short code; this file makes rocks, puts each socket
// on the one it asks for, ticks them all on one clock and closes each when its last socket leaves.
import http from 'node:http';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';
import { WebSocketServer } from 'ws';
import * as C from './shared/constants.js';
import { createRoom, cleanRules, now, send } from './room.js';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const arg = name => process.argv.find(a => a.startsWith(`--${name}=`))?.split('=')[1];
const PORT = Number(process.env.PORT) || 3000;               // Heroku assigns PORT
const MAX_PLAYERS = Math.max(1, Number(process.env.MAX_PLAYERS) || 12);   // humans on each rock
const MAX_ROOMS = Math.max(1, Number(process.env.MAX_ROOMS) || 20);       // rocks at once
const MAX_CONNECTIONS = Math.max(MAX_PLAYERS, Number(process.env.MAX_CONNECTIONS) || 100);
const ERA_SECONDS = Math.max(10, Number(arg('era-seconds') ?? process.env.ERA_SECONDS) || C.DOTIME.eraSeconds);
// Ploughshares: farming time before each vote to keep going
const PEACE_SECONDS = Math.max(20, Number(arg('peace-seconds') ?? process.env.PEACE_SECONDS) || C.PEACE.seconds);
// what every new rock starts with, until its chief changes it
const START_RULES = cleanRules(
  { mode: arg('mode') ?? process.env.MODE, botLevel: arg('bot-level') ?? process.env.BOT_LEVEL, bots: arg('bots') ?? process.env.BOTS },
  { mode: 'dotime', botLevel: C.BOT_LEVEL_DEFAULT, bots: 4, open: 0 },
);
const HEARTBEAT_MS = 20000;   // below Heroku's 55 s idle cutoff; also reaps half-open sockets
const MSG_RATE = 60;          // messages/second refilled per socket (a client sends ~25)
const MSG_BURST = 120;
const DT = 1 / C.TICK_HZ;
const startedAt = Date.now();

// ------------------------------------------------------------------ static files
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.webmanifest': 'application/manifest+json',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
};
// [url prefix, directory, Cache-Control]. three.js is versioned by package.json, so browsers may keep it.
const ROUTES = [
  ['/shared/', path.join(ROOT, 'shared'), 'no-cache'],
  ['/three/', path.join(ROOT, 'node_modules', 'three'), 'public, max-age=604800'],
  // (the rock's QR code: see qrSvg in public/js/main.js)
  ['/qr/', path.join(ROOT, 'node_modules', 'qrcode-generator', 'dist'), 'public, max-age=604800'],
  ['/', path.join(ROOT, 'public'), 'no-cache'],
];
// single files outside those folders: the game itself, for playing offline in the browser (see
// public/js/offline-worker.js)
const FILES = { '/room.js': path.join(ROOT, 'room.js') };
// a rock's share link (/KPTX) is the page itself; the client reads the code from the address
const ROOM_PATH = new RegExp(`^/[A-Za-z]{${C.ROOM_CODE.len}}/?$`);

// ------------------------------------------------------------------ the app, offline
// The service worker (public/sw.js) keeps a copy of everything the game needs, so it opens and
// plays with no connection (installed as an app or not). It goes out with the list of files and a
// version that changes whenever any of them does, so browsers pick up each new deploy.
const LIB_FILES = ['/three/build/three.module.js', '/three/build/three.core.js', '/three/examples/jsm/utils/BufferGeometryUtils.js', '/qr/qrcode.mjs'];
const fileFor = url => FILES[url] || (() => {
  for (const [prefix, dir] of ROUTES) if (url.startsWith(prefix)) return path.join(dir, url.slice(prefix.length));
  return null;
})();
function precacheList() {
  const walk = (dir, base) => fs.readdirSync(dir, { withFileTypes: true }).flatMap(e =>
    (e.isDirectory() ? walk(path.join(dir, e.name), `${base}${e.name}/`) : [`${base}${e.name}`]));
  const pub = walk(path.join(ROOT, 'public'), '/').filter(u => u !== '/sw.js');
  const shared = walk(path.join(ROOT, 'shared'), '/shared/').filter(u => u.endsWith('.js'));
  return ['/', ...pub, ...shared, '/room.js', ...LIB_FILES];
}
let swCache = { sig: '', version: '' };
function serveServiceWorker(res) {
  const files = precacheList();
  // the version: a hash of every file's contents, worked out again only when one has changed
  const stats = files.map(u => (u === '/' ? null : fs.statSync(fileFor(u))));
  const sig = stats.map(st => (st ? `${st.size}:${st.mtimeMs}` : '')).join(',');
  if (sig !== swCache.sig) {
    const hash = crypto.createHash('sha1');
    for (const u of files) if (u !== '/') hash.update(u).update(fs.readFileSync(fileFor(u)));
    swCache = { sig, version: hash.digest('hex').slice(0, 12) };
  }
  const src = fs.readFileSync(path.join(ROOT, 'public', 'sw.js'), 'utf8');
  res.writeHead(200, { 'Content-Type': 'text/javascript; charset=utf-8', 'Cache-Control': 'no-cache' });
  res.end(`const VERSION = '${swCache.version}';\nconst PRECACHE = ${JSON.stringify(files)};\n${src}`);
}

// Files are cached in memory (gzipped once) and revalidated by mtime, so edits still show up locally.
const fileCache = new Map();
function loadFile(file, cb) {
  fs.stat(file, (err, st) => {
    if (err || !st.isFile()) return cb(err || new Error('not a file'));
    const hit = fileCache.get(file);
    if (hit && hit.mtime === st.mtimeMs) return cb(null, hit);
    fs.readFile(file, (readErr, data) => {
      if (readErr) return cb(readErr);
      const type = MIME[path.extname(file)] || 'application/octet-stream';
      const entry = {
        mtime: st.mtimeMs, data, type,
        gz: /text|svg/.test(type) ? zlib.gzipSync(data) : null,
        etag: `"${st.size.toString(36)}-${Math.floor(st.mtimeMs).toString(36)}"`,
      };
      fileCache.set(file, entry);
      cb(null, entry);
    });
  });
}

function serveStatic(req, res) {
  let url;
  try { url = decodeURIComponent(new URL(req.url, 'http://local').pathname); } catch { url = '/'; }
  if (url === '/health') {
    // counts only: a rock's code is how you get onto it, so codes stay private
    const { games, humans, bots } = census();
    res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
    res.end(JSON.stringify({
      ok: true, rooms: rooms.size, maxRooms: MAX_ROOMS, humans, bots, connections: sockets.size,
      uptime: Math.round((Date.now() - startedAt) / 1000), games,
    }));
    return;
  }
  if (url === '/sw.js') {
    try { serveServiceWorker(res); } catch (err) { console.error('sw.js:', err.message); res.writeHead(500); res.end(); }
    return;
  }
  if (FILES[url]) {
    loadFile(FILES[url], (err, f) => {
      if (err) { res.writeHead(404); res.end('Ugg. No find.'); return; }
      res.writeHead(200, { 'Content-Type': f.type, 'Cache-Control': 'no-cache', ETag: f.etag });
      res.end(f.data);
    });
    return;
  }
  if (ROOM_PATH.test(url)) {
    // the page's relative links only work without the trailing slash
    if (url.endsWith('/')) { res.writeHead(301, { Location: url.slice(0, -1) }); res.end(); return; }
    url = '/index.html';
  }
  for (const [prefix, dir, cache] of ROUTES) {
    if (!url.startsWith(prefix)) continue;
    const file = path.normalize(path.join(dir, url.slice(prefix.length) || 'index.html'));
    if (!file.startsWith(dir + path.sep)) break;
    loadFile(file, (err, f) => {
      if (err) { res.writeHead(404); res.end('Ugg. No find.'); return; }
      const headers = { 'Content-Type': f.type, 'Cache-Control': cache, ETag: f.etag, Vary: 'Accept-Encoding' };
      if (req.headers['if-none-match'] === f.etag) { res.writeHead(304, headers); res.end(); return; }
      const gzip = f.gz && /\bgzip\b/.test(req.headers['accept-encoding'] || '');
      if (gzip) headers['Content-Encoding'] = 'gzip';
      res.writeHead(200, headers);
      res.end(gzip ? f.gz : f.data);
    });
    return;
  }
  res.writeHead(404);
  res.end('Ugg. No find.');
}

// ------------------------------------------------------------------ rocks (lobbies)
const rooms = new Map();     // code -> room (see room.js)
const sockets = new Set();   // every open socket, on a rock or still picking one

// Every rock's numbers, plus totals across them.
function census() {
  const games = [...rooms.values()].map(r => r.stats());
  const total = k => games.reduce((n, g) => n + g[k], 0);
  return { games, humans: total('humans'), bots: total('bots'), projectiles: total('projectiles') };
}

function freshCode() {
  const { len, chars } = C.ROOM_CODE;
  for (;;) {
    let code = '';
    for (let i = 0; i < len; i++) code += chars[Math.floor(Math.random() * chars.length)];
    if (!rooms.has(code)) return code;
  }
}

function openRoom(code, rules) {
  const room = createRoom(code, { rules, maxPlayers: MAX_PLAYERS, eraSeconds: ERA_SECONDS, peaceSeconds: PEACE_SECONDS });
  rooms.set(code, room);
  console.log(`[${code}] open  (${rooms.size}/${MAX_ROOMS} rocks) ${C.MODES[rules.mode]}, ${rules.bots} bots, brains ${rules.botLevel}/10, ${rules.open ? 'public' : 'private'}`);
  return room;
}

// The open rocks list: every public rock, busiest first. (Private ones are only for whoever has
// the code; they never show here, or in /health.)
function publicRocks() {
  return [...rooms.values()].filter(r => r.rules().open).map(r => r.listing())
    .sort((a, b) => b.humans - a.humans || a.code.localeCompare(b.code));
}

// A closed rock's rules, kept a while so opening its code again (a reload, a friend arriving
// after everyone left) brings back the mode and bots it had rather than the defaults.
const closedRules = new Map();   // code -> { rules, at }
const KEEP_RULES_MS = 6 * 3600 * 1000;
function rememberRules(room) {
  closedRules.delete(room.code);
  closedRules.set(room.code, { rules: room.rules(), at: Date.now() });
  // oldest first: drop the stale ones, and never keep more than a few hundred
  for (const [code, r] of closedRules) {
    if (closedRules.size <= 500 && Date.now() - r.at < KEEP_RULES_MS) break;
    closedRules.delete(code);
  }
}
function rulesFor(code) {
  const r = closedRules.get(code);
  return r && Date.now() - r.at < KEEP_RULES_MS ? r.rules : null;
}

// rebalance: see room.detach
function leaveRoom(client, rebalance = true) {
  const room = client.room;
  if (!room) return;
  client.room = null;
  room.detach(client, rebalance);
  // nobody left playing or watching: it goes. The code keeps working; whoever uses it next
  // gets a fresh planet under it, with the rules it had.
  if (!room.clients.size) {
    rooms.delete(room.code);
    rememberRules(room);
    console.log(`[${room.code}] closed (${rooms.size}/${MAX_ROOMS} rocks)`);
  }
}

// { t: 'room', create: 1, open }      a new rock under a fresh code, public (open: 1) or private
// { t: 'room', quick: 1 }             QUICK PLAY: the busiest public rock with room for one more,
//                                     else a new public one
// { t: 'room', code }                 a rock that's already there (typed in, or picked from the
//                                     open rocks list), else 'noroom'
// { t: 'room', code, make: 1, rules } that rock, made on the spot if it isn't there: a shared
//                                     link, or a reconnect after a restart (bringing its old rules)
// { t: 'room', leave: 1 }             back to picking a rock
function pickRoom(client, m) {
  if (m.leave) { leaveRoom(client); return; }
  if (m.quick) { quickRoom(client); return; }
  const code = m.create ? '' : C.cleanRoomCode(m.code);
  let room = code ? rooms.get(code) : null;
  if (room && room === client.room) return;
  if (!room && !m.create && !(code && m.make)) {
    client.budget -= 10;   // makes guessing codes slow
    send(client, { t: 'noroom', code });
    return;
  }
  leaveRoom(client);
  if (!room) {
    if (rooms.size >= MAX_ROOMS) { send(client, { t: 'noroom', code, full: 1 }); return; }
    // reopening a code: the rules it brings (a reconnect), else the ones it had when it closed
    const back = m.make && !m.rules ? rulesFor(code) : null;
    room = openRoom(code || freshCode(), m.make ? cleanRules(m.rules || back, START_RULES) : { ...START_RULES, open: m.open ? 1 : 0 });
  }
  enterRoom(client, room);
}

function quickRoom(client) {
  let best = null, most = -1;
  for (const room of rooms.values()) {
    if (room === client.room || !room.rules().open) continue;
    const { humans } = room.listing();
    if (humans < MAX_PLAYERS && humans > most) { best = room; most = humans; }
  }
  leaveRoom(client);
  if (!best && rooms.size >= MAX_ROOMS) { send(client, { t: 'noroom', full: 1 }); return; }
  // nobody on a public rock with room: a new one, for the next person to find
  enterRoom(client, best || openRoom(freshCode(), { ...START_RULES, open: 1 }), { quick: 1, humans: Math.max(0, most) });
}

// extra: for the page to say how it got there (QUICK PLAY: and how many were already on it)
function enterRoom(client, room, extra = {}) {
  client.room = room;
  send(client, { t: 'room', code: room.code, ...extra });
  room.attach(client);
}

// ------------------------------------------------------------------ sockets
const server = http.createServer(serveStatic);
const wss = new WebSocketServer({ server, maxPayload: 16 * 1024 });

let shuttingDown = false;

wss.on('connection', ws => {
  if (shuttingDown || sockets.size >= MAX_CONNECTIONS) { ws.close(1013, 'Cave full'); return; }
  const client = { ws, room: null, pid: 0, alive: true, budget: MSG_BURST };
  sockets.add(client);
  ws.on('pong', () => { client.alive = true; });
  ws.on('message', raw => {
    // token bucket: drop floods, cut off sockets that keep flooding
    if (--client.budget < 0) {
      if (client.budget < -MSG_BURST) ws.terminate();
      return;
    }
    let msg;
    try { msg = JSON.parse(raw); } catch { return; }
    if (!msg || typeof msg.t !== 'string') return;
    if (msg.t === 'ping') send(client, { t: 'pong', ts: msg.ts });
    else if (msg.t === 'room') pickRoom(client, msg);
    else if (msg.t === 'rocks') send(client, { t: 'rocks', list: publicRocks(), max: MAX_PLAYERS });
    else client.room?.handleMessage(client, msg);
  });
  ws.on('close', () => {
    sockets.delete(client);
    leaveRoom(client, !shuttingDown);
  });
  ws.on('error', () => {});
});

setInterval(() => {
  for (const c of sockets) c.budget = Math.min(MSG_BURST, c.budget + MSG_RATE);
}, 1000);

// Sockets that stop answering pings (closed laptop, dead Wi-Fi) get reaped so they don't
// leave ghost cavemen behind.
setInterval(() => {
  for (const c of sockets) {
    if (!c.alive) { c.ws.terminate(); continue; }
    c.alive = false;
    if (c.ws.readyState === 1) c.ws.ping();
  }
}, HEARTBEAT_MS);

// Heroku sends SIGTERM on every deploy and daily restart. Warn clients so they show
// "moving cave" and reconnect on their own (back onto the same code) instead of looking crashed.
function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`${signal}: telling ${sockets.size} sockets on ${rooms.size} rocks the cave is moving`);
  const bye = JSON.stringify({ t: 'restart' });
  for (const c of sockets) {
    if (c.ws.readyState === 1) c.ws.send(bye);
    c.ws.close(1012, 'Server restarting');
  }
  server.close();
  setTimeout(() => process.exit(0), 1000).unref();
}
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

// ------------------------------------------------------------------ main loop
// One clock for every rock. PERF_LOG=1 prints tick timings (all rocks together) every 10 s.
// Falling behind is always reported: that's when every game runs in slow motion.
const perf = { ticks: 0, ms: 0, max: 0, behind: 0 };
let last = now(), acc = 0;
setInterval(() => {
  const t = now();
  const elapsed = t - last;
  if (elapsed > 0.25) perf.behind++;
  acc += Math.min(elapsed, 0.25);
  last = t;
  while (acc >= DT) {
    acc -= DT;
    const t0 = performance.now();
    for (const room of rooms.values()) room.tick();
    const ms = performance.now() - t0;
    perf.ticks++;
    perf.ms += ms;
    if (ms > perf.max) perf.max = ms;
  }
}, 8);
setInterval(() => {
  if (process.env.PERF_LOG && perf.ticks) {
    const { humans, bots, projectiles } = census();
    console.log(`perf  tick avg ${(perf.ms / perf.ticks).toFixed(2)} ms, max ${perf.max.toFixed(1)} ms, ${perf.ticks / 10} ticks/s, ${rooms.size} rocks, ${humans + bots} cavemen, ${projectiles} projectiles`);
  }
  if (perf.behind) console.log(`perf  WARNING: server fell behind ${perf.behind}x in the last 10 s (game ran slow)`);
  Object.assign(perf, { ticks: 0, ms: 0, max: 0, behind: 0 });
}, 10000).unref();

server.listen(PORT, () => {
  console.log(`\n  OOGA BOOGA! War is Racket running.\n`);
  console.log(`  Local:   http://localhost:${PORT}`);
  for (const nets of Object.values(os.networkInterfaces())) {
    for (const n of nets || []) if (n.family === 'IPv4' && !n.internal) console.log(`  Network: http://${n.address}:${PORT}`);
  }
  const r = START_RULES;
  console.log(`\n  New rocks start as: ${C.MODES[r.mode]}${r.mode === 'dotime' ? ` (${ERA_SECONDS}s per age)` : ''}`);
  console.log(`  Bots: ${r.bots} (brains ${r.botLevel}/10 ${C.botLevelDef(r.botLevel).name}). Up to ${MAX_PLAYERS} humans per rock, ${MAX_ROOMS} rocks.\n`);
});
