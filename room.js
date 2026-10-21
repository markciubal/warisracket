// One rock (lobby): a whole planet and everything on it. server.js makes one per lobby code
// and ticks them all; each has its own players, projectiles, hazards, Do Time clock, chief and
// bots, and only ever talks to its own sockets. Clients own their own movement; the room owns
// projectiles, hits, health, armor, hazards, the era clock and the bots.
import * as C from './shared/constants.js';
import * as M from './shared/math.js';

const { R, PLAYER, PROJECTILE, BOULDER, VOLCANO, DOTIME, DISASTERS } = C;
const DT = 1 / C.TICK_HZ;

const rand = (a, b) => a + Math.random() * (b - a);
const randIn = ([a, b]) => rand(a, b);
const rnd = (v, d) => v.map(x => Math.round(x * 10 ** d) / 10 ** d);
const isVec = v => Array.isArray(v) && v.length === 3 && v.every(Number.isFinite);
export const now = () => performance.now() / 1000;
const intIn = (v, lo, hi, fallback) => (Number.isInteger(v) && v >= lo && v <= hi ? v : fallback);

export function send(client, msg) {
  if (client.ws.readyState === 1) client.ws.send(JSON.stringify(msg));
}

// Starting rules (mode, bot brains, bot fill) from config vars, flags or a client, with anything
// missing or nonsense taken from `base`.
export function cleanRules(r, base) {
  const src = r && typeof r === 'object' ? r : {};
  const mode = String(src.mode ?? '').toLowerCase();
  return {
    mode: C.MODES[mode] ? mode : base.mode,
    botLevel: intIn(Number(src.botLevel), 1, C.BOT_LEVELS.length, base.botLevel),
    bots: intIn(Number(src.bots), 0, C.MAX_BOTS, base.bots),
  };
}

// rules: cleanRules() output. maxPlayers: human cap on this planet. eraSeconds: Do Time age length.
export function createRoom(code, { rules, maxPlayers, eraSeconds }) {
  const MAX_PLAYERS = maxPlayers;
  const ERA_SECONDS = eraSeconds;
  const log = (...args) => console.log(`[${code}]`, ...args);

  // ------------------------------------------------------------------ world
  const world = generateWorld();
  const players = new Map();
  const clients = new Set();
  const spears = new Map();       // every projectile: spears and arrows
  const fireballs = new Map();
  const armorDrops = new Map();
  const loot = new Map();         // weapons and ammo pouches dropped by slain cavemen
  const beasts = new Map();       // killstreak beasts: attack dogs, mammoths, the odd T-Rex
  // the roast on each campfire's spit: ready to eat once readyAt has passed
  const fires = world.obstacles.filter(o => o.type === 'campfire').map(o => ({ id: o.id, u: o.u, r: o.r, readyAt: 0 }));
  const shrooms = new Map();      // magic mushrooms on the ground, one of each kind
  const shroomRegrow = [];        // { kind, at }: eaten ones growing back
  const swings = [];
  const pickups = [];
  const boulders = [];
  const volcano = { next: now() + VOLCANO.firstDelay, left: 0, nextShot: 0 };
  let nextId = 1;

  // Planet rules. The chief (longest-present human) can change mode and bots in-game.
  const game = {
    mode: rules.mode,
    era: 0,
    // 'play' | 'doom' (the finale) | 'end' (victory / "tribe wiped" screen between rounds)
    // | 'break' (co-op: between waves)
    phase: 'play',
    wave: 0,                    // co-op: current wave (0 = not started)
    waveSize: 0,                // co-op: bots this wave started with
    waveLevel: 0,               // co-op: bot brains this wave
    breakUntil: 0,              // co-op: when the next wave comes (Infinity while nobody's here)
    camp: null,                 // co-op: where the tribe gathers (unit vector)
    eraStart: now(),
    endUntil: 0,
    disaster: null,             // DISASTERS key while the finale runs and on the victory screen after it
    lastDisaster: null,
    doomStart: 0,
    doomEnd: 0,
    doomCenter: null,           // where the big one lands, or where the wave starts (unit vector)
    doomDone: false,            // the big one has hit
    strikes: [],                // smaller hits during the finale: { to, at, done }
    mammonDead: false,          // the finale got the Businessman too (until the next round)
    botLevel: rules.botLevel,
    bots: rules.bots,
    chief: 0,
    nextArmorAt: now() + randIn(DOTIME.armorEvery),
  };

  const eraDef = () => C.ERAS[game.era];
  const rangedDef = () => C.RANGED[eraDef().ranged];
  const newWeapon = () => C.makeWeapon(Math.random, eraDef().melee);
  const eraLen = () => ERA_SECONDS;   // every age lasts the same
  // cavemen keep bonking right up until the world ends; only the victory screen is peaceful
  const fighting = () => game.phase === 'play' || game.phase === 'doom';
  const coop = () => game.mode === 'coop';
  // co-op waves get smarter as they go; otherwise it's whatever the chief picked
  const botLevel = () => C.botLevelDef(coop() && game.waveLevel ? game.waveLevel : game.botLevel);
  const botLevelText = () => `${game.botLevel}/10 ${C.botLevelDef(game.botLevel).name}`;
  // Two different cavemen on the same side? In co-op humans are one tribe and bots the other;
  // otherwise it's every caveman for himself.
  const allies = (a, b) => coop() && !!a && !!b && a !== b && a.bot === b.bot;

  function generateWorld() {
    const obstacles = [];
    const place = (type, u, r, h, taper) =>
      obstacles.push({ id: obstacles.length, type, u, r, h, taper, yaw: rand(0, Math.PI * 2), seed: Math.random() });
    place('volcano', [0, 1, 0], VOLCANO.radius, VOLCANO.peak, 0.8);
    // the Businessman's podium of gold, at the bottom of the world, opposite the volcano
    place('mammon', C.MAMMON.at, 2.4, 2.6, 0.15);
    const scatter = (type, count, rMin, rMax, heightOf, taper) => {
      for (let placed = 0, tries = 0; placed < count && tries < count * 80; tries++) {
        const u = M.randomUnit();
        const r = rand(rMin, rMax);
        if (obstacles.some(o => M.arcDist(u, o.u) < o.r + r + 3)) continue;
        place(type, u, r, heightOf(r), taper);
        placed++;
      }
    };
    scatter('hut', 4, 1.9, 2.2, () => 3.4, 0.9);
    scatter('skeleton', 3, 2.2, 2.6, () => 2.8, 0.3);
    scatter('campfire', 3, 0.9, 0.9, () => 1.0, 0);
    scatter('rock', 22, 1.0, 2.2, r => r * 1.25, 0.45);
    scatter('tree', 20, 0.55, 0.55, () => 7.5, 0);
    return { seed: Math.floor(Math.random() * 1e9), obstacles };
  }

  const isClear = (u, margin) => world.obstacles.every(o => M.arcDist(u, o.u) > o.r + margin);

  function randomClearPoint(margin, extraOk = () => true) {
    for (let i = 0; i < 400; i++) {
      const u = M.randomUnit();
      if (isClear(u, margin) && extraOk(u)) return u;
    }
    return [0, -1, 0];
  }

  for (let i = 0; i < C.PICKUP_COUNT; i++) {
    const u = randomClearPoint(2.5, c => pickups.every(pk => M.arcDist(c, pk.u) > 15));
    pickups.push({ id: i, u, wpn: newWeapon(), rerollAt: now() + rand(50, 80) });
  }

  for (let i = 0; i < BOULDER.count; i++) {
    const u = randomClearPoint(BOULDER.radius + 1, c => c[1] < 0.7);
    boulders.push({ id: i, p: u, f: M.randomTangent(u), speed: rand(BOULDER.minSpeed, BOULDER.maxSpeed), turn: 0, r: BOULDER.radius });
  }

  function findSpawn() {
    let best = null, bestScore = -1;
    for (let i = 0; i < 40; i++) {
      const u = M.randomUnit();
      if (u[1] > 0.75 || !isClear(u, PLAYER.radius + 0.8)) continue;
      let score = 999;
      for (const pl of players.values()) if (pl.alive) score = Math.min(score, M.arcDist(u, pl.p));
      for (const b of boulders) score = Math.min(score, M.arcDist(u, b.p) * 2);
      if (score > bestScore) { bestScore = score; best = u; }
    }
    best ||= randomClearPoint(PLAYER.radius + 0.8);
    return [best, M.randomTangent(best)];
  }

  // ------------------------------------------------------------------ networking
  // only this rock's sockets: other rocks never hear about this one
  function broadcast(msg) {
    const data = JSON.stringify(msg);
    for (const c of clients) if (c.ws.readyState === 1) c.ws.send(data);
  }

  function sendMe(pl) {
    if (pl.client) send(pl.client, { t: 'me', ammo: pl.ammo });
  }

  function gameInfo(t = now()) {
    const left = until => (until === Infinity ? 0 : Math.max(0, Math.round((until - t) * 10) / 10));
    const dotime = game.mode === 'dotime';
    return {
      mode: game.mode,
      era: game.era,
      phase: game.phase,
      // seconds until the next age (or, during the finale, until everything is gone; in co-op, until the next wave)
      eraLeft: coop() ? (game.phase === 'break' ? left(game.breakUntil) : 0)
        : !dotime ? 0 : game.phase === 'play' ? left(game.eraStart + eraLen()) : game.phase === 'doom' ? left(game.doomEnd) : 0,
      eraLen: coop() ? (game.phase === 'break' ? (game.wave ? C.COOP.breakSeconds : C.COOP.firstBreak) : 0)
        : game.phase === 'doom' ? DISASTERS[game.disaster].duration : eraLen(),
      wave: game.wave,
      waveSize: game.waveSize,
      waveLevel: game.waveLevel,
      endLeft: game.phase === 'end' ? left(game.endUntil) : 0,
      eraSeconds: ERA_SECONDS,
      disaster: game.disaster,
      mmDead: game.mammonDead ? 1 : 0,
      botLevel: game.botLevel,
      bots: game.bots,
      chief: game.chief,
    };
  }

  const broadcastGame = (extra = {}) => broadcast({ t: 'game', ...gameInfo(), ...extra });

  const publicPlayer = pl => ({
    id: pl.id, name: pl.name, look: pl.look, bot: pl.bot, p: rnd(pl.p, 4), f: rnd(pl.f, 4), h: pl.h,
    hp: pl.hp, alive: pl.alive, wpn: pl.weapon, armor: pl.armor, k: pl.kills, d: pl.deaths,
    buffs: Object.fromEntries(Object.entries(pl.buffs || {}).map(([k, until]) => [k, Math.max(0, Math.round((until - now()) * 10) / 10)]).filter(([, left]) => left > 0)),
  });

  const publicSpear = s => ({ id: s.id, owner: s.owner, w: s.w, pos: rnd(s.pos, 4), vel: rnd(s.vel, 4), stuck: s.stuck, dir: s.dir && rnd(s.dir, 4) });
  const publicDrop = a => ({ id: a.id, u: rnd(a.u, 4), armor: a.armor });
  const publicLoot = l => ({ id: l.id, u: rnd(l.u, 4), wpn: l.wpn || null, ammo: l.ammo || 0, w: l.w || null });

  function welcome(client) {
    send(client, {
      t: 'world',
      seed: world.seed,
      obstacles: world.obstacles,
      game: gameInfo(),
      pickups: pickups.map(pk => ({ id: pk.id, u: pk.u, wpn: pk.wpn })),
      boulders: boulders.map(b => ({ id: b.id, p: b.p, f: b.f, r: b.r })),
      players: [...players.values()].map(publicPlayer),
      spears: [...spears.values()].map(publicSpear),
      fireballs: [...fireballs.values()].map(fb => ({ id: fb.id, pos: fb.pos, vel: fb.vel, land: fb.land })),
      armorDrops: [...armorDrops.values()].map(publicDrop),
      loot: [...loot.values()].map(publicLoot),
      beasts: [...beasts.values()].map(publicBeast),
      fires: fires.map(publicFire),
      shrooms: [...shrooms.values()].map(publicShroom),
      doom: game.phase === 'doom' ? doomInfo() : null,
    });
  }

  function cleanName(name) {
    return String(name ?? '').replace(/[^\p{L}\p{N} '\-_.!?]/gu, '').replace(/\s+/g, ' ').trim().slice(0, 18);
  }

  function cleanLook(l) {
    const look = l && typeof l === 'object' ? l : {};
    const int = (v, n) => (Number.isInteger(v) && v >= 0 && v < n ? v : Math.floor(Math.random() * n));
    return {
      garb: int(look.garb, C.GARBS.length),
      skin: int(look.skin, C.SKINS.length),
      hair: int(look.hair, C.HAIRS.length),
      beard: look.beard ? 1 : 0,
      bone: look.bone ? 1 : 0,
      size: M.clamp(Number(look.size) || 1, 0.92, 1.08),
      lefty: look.lefty ? 1 : 0,
    };
  }

  function handleMessage(client, m) {
    const pl = client.pid ? players.get(client.pid) : null;
    const t = now();
    switch (m.t) {
      case 'join': {
        if (pl) return;
        if (humanCount() >= MAX_PLAYERS) { send(client, { t: 'full', max: MAX_PLAYERS }); return; }
        const me = createPlayer(cleanName(m.name) || C.randomCaveName(), cleanLook(m.look), false);
        me.client = client;
        client.pid = me.id;
        send(client, { t: 'you', id: me.id, sq: me.sq, ammo: me.ammo });
        balanceBots();
        updateChief();
        log(`join  "${me.name}" (${humanCount()}/${MAX_PLAYERS} humans, ${clients.size} sockets)`);
        break;
      }
      case 'st': {
        if (!pl || !pl.alive || m.sq !== pl.sq || !isVec(m.p) || !isVec(m.f)) return;
        const p = M.norm(m.p);
        if (pl.lastStateAt) {
          const span = Math.max(t - pl.lastStateAt, 0.02);
          pl.vel = M.add(M.scale(pl.vel, 0.5), M.scale(M.sub(p, pl.p), (0.5 * R) / span));
        }
        pl.lastStateAt = t;
        pl.p = p;
        pl.f = M.tangent(p, m.f);
        pl.h = M.clamp(Number(m.h) || 0, 0, 5);
        pl.charging = !!m.c;
        break;
      }
      case 'throw': {
        const def = rangedDef();
        if (!pl || !pl.alive || !fighting() || pl.ammo <= 0 || t < pl.stunUntil || t - pl.lastThrow < def.cooldown * 0.8) return;
        if (!isVec(m.pos) || !isVec(m.vel) || M.len(m.vel) < 1e-6) return;
        const head = M.scale(pl.p, R + pl.h + 1.6);
        const pos = M.len(M.sub(m.pos, head)) > 3 ? head : m.pos;
        pl.lastThrow = t;
        if (def.hitscan) { zap(pl, pos, m.vel, viewLag(m, t)); break; }
        const speed = M.len(m.vel);
        const vel = speed > def.maxSpeed ? M.scale(m.vel, def.maxSpeed / speed) : m.vel;
        throwProjectile(pl, pos, vel, Number.isInteger(m.tid) ? m.tid : null, viewLag(m, t));
        break;
      }
      case 'swing':
        if (pl) startSwing(pl, t, viewLag(m, t));
        break;
      case 'beast':
        // Q: call your waiting beast, or send the one you have out at a caveman (target) or a spot (u)
        if (pl && pl.alive) beastCommand(pl, m, t);
        break;
      case 'emote':
        if (pl && Number.isInteger(m.i)) emote(pl, m.i, t);
        break;
      case 'hand':
        // switched between right- and left-handed in the settings: everyone sees the hands swap
        if (pl && pl.look.lefty !== (m.lefty ? 1 : 0)) {
          pl.look.lefty = m.lefty ? 1 : 0;
          broadcast({ t: 'hand', id: pl.id, lefty: pl.look.lefty });
        }
        break;
      case 'grab':
        if (pl) tryGrab(pl, t);
        break;
      case 'rules':
        // The chief decides. With no humans on the planet, whoever is in the lobby may set it up.
        if (humanCount() > 0 && !(pl && pl.id === game.chief)) return;
        applyRules(m, pl);
        break;
      case 'quit':
        // back to the lobby: off the planet, but still watching this rock
        if (!pl) return;
        removePlayer(pl.id);
        client.pid = 0;
        balanceBots();
        break;
    }
  }

  // ------------------------------------------------------------------ players
  function createPlayer(name, look, bot) {
    const pl = {
      id: nextId++, name, look, bot, p: [0, -1, 0], f: [1, 0, 0], h: 0, vh: 0, charging: false,
      hp: PLAYER.maxHp, alive: false, respawnAt: 0, sq: 0, ammo: rangedDef().ammo, regen: 0,
      weapon: newWeapon(), armor: null, lastSwing: -99, lastThrow: -99, lastEmote: -99,
      stunUntil: 0, slowUntil: 0, bleedUntil: 0, bleedDps: 0, bleedBy: 0, bleedAcc: 0,
      lastHitBy: 0, lastHitAt: -99, boulderCd: 0, kills: 0, deaths: 0, joinedAt: now(),
      vel: [0, 0, 0], kbv: [0, 0, 0], lastStateAt: 0, client: null, ai: bot ? newBrain() : null, hist: [],
      streak: 0, reward: null, beastId: 0,   // killstreak: bonks in a row, beast waiting to be called, beast out
      buffs: {},                             // mushroom buffs: kind -> server time it wears off
    };
    players.set(pl.id, pl);
    spawnPlayer(pl, false);
    broadcast({ t: 'pjoin', pl: publicPlayer(pl) });
    return pl;
  }

  // at: [p, f] to spawn there instead of the spot farthest from everyone
  function spawnPlayer(pl, announce = true, at = null) {
    [pl.p, pl.f] = at || tribeSpawn(pl) || findSpawn();
    if (coop() && !pl.bot && !game.camp) game.camp = pl.p;   // the first one in picks the camp
    Object.assign(pl, {
      h: 0, vh: 0, hp: PLAYER.maxHp, alive: true, ammo: rangedDef().ammo, regen: 0, charging: false, armor: null,
      stunUntil: 0, slowUntil: 0, bleedUntil: 0, kbv: [0, 0, 0], vel: [0, 0, 0], lastStateAt: 0, hist: [],
      buffs: {}, regrowAcc: 0,
    });
    pl.sq++;
    if (announce) {
      pl.weapon = newWeapon();
      broadcast({ t: 'respawn', id: pl.id, sq: pl.sq, p: rnd(pl.p, 4), f: rnd(pl.f, 4), wpn: pl.weapon });
    }
    sendMe(pl);
  }

  const humanCount = () => { let n = 0; for (const p of players.values()) if (!p.bot) n++; return n; };

  function removePlayer(id) {
    const pl = players.get(id);
    if (!pl) return;
    players.delete(id);
    broadcast({ t: 'pleave', id });
    const beast = beasts.get(pl.beastId);
    if (beast) beastGone(beast, 'left');
    if (!pl.bot) {
      log(`leave "${pl.name}" (${humanCount()}/${MAX_PLAYERS} humans)`);
      updateChief();
    }
  }

  function updateChief() {
    let chief = null;
    for (const p of players.values()) if (!p.bot && (!chief || p.joinedAt < chief.joinedAt)) chief = p;
    const id = chief ? chief.id : 0;
    if (id !== game.chief) {
      game.chief = id;
      broadcastGame();
    }
  }

  function emote(pl, i, t) {
    if (i < 0 || i >= C.EMOTES.length || t - pl.lastEmote < 1.2) return;
    pl.lastEmote = t;
    broadcast({ t: 'emote', id: pl.id, i });
  }

  // E grabs whichever is closest: a weapon totem, a piece of armor, or a slain caveman's weapon.
  function tryGrab(pl, t) {
    if (!pl.alive) return;
    let best = null, bestD = C.GRAB_RADIUS;
    for (const pk of pickups) {
      const d = M.arcDist(pl.p, pk.u);
      if (d < bestD) { bestD = d; best = pk; }
    }
    let drop = null, dropped = null;
    for (const a of armorDrops.values()) {
      const d = M.arcDist(pl.p, a.u);
      if (d < bestD) { bestD = d; drop = a; best = null; }
    }
    for (const l of loot.values()) {
      if (!l.wpn) continue;
      const d = M.arcDist(pl.p, l.u);
      if (d < bestD) { bestD = d; dropped = l; drop = best = null; }
    }
    // at a campfire and hurt: the roast comes first unless something else is right underfoot
    const roast = pl.hp < PLAYER.maxHp ? fireInReach(pl, t) : null;
    if (roast && roast.d <= bestD) { eatMeat(pl, roast.fire, t); return; }
    if (drop) { wearArmor(pl, drop); return; }
    if (dropped) {
      // swap: yours goes down where theirs was, so a friend can still have it
      removeLoot(dropped, pl);
      const mine = pl.weapon;
      pl.weapon = dropped.wpn;
      dropLoot(dropped.u, { wpn: mine }, t);
      broadcast({ t: 'wpn', id: pl.id, wpn: pl.weapon });
      return;
    }
    if (!best) return;
    [pl.weapon, best.wpn] = [best.wpn, pl.weapon];
    best.rerollAt = t + rand(30, 45);
    broadcast({ t: 'wpn', id: pl.id, wpn: pl.weapon });
    broadcast({ t: 'pickup', id: best.id, wpn: best.wpn });
  }

  function heal(pl, amount) {
    if (!pl.alive || pl.hp >= PLAYER.maxHp) return;
    const n = Math.min(PLAYER.maxHp - pl.hp, Math.round(amount));
    if (n <= 0) return;
    pl.hp += n;
    broadcast({ t: 'heal', id: pl.id, n, hp: pl.hp });
  }

  function damage(v, amount, info) {
    if (!v.alive || !fighting()) return;
    const t = now();
    const att = info.attacker || null;
    // mushrooms: BIG STRONG hits harder, ROCK SKIN takes less (not for bleeding or the end of the world)
    if (info.kind !== 'bleed' && info.kind !== 'doom') {
      if (att && att !== v && !info.beast && buffed(att, 'strong', t)) amount *= C.BUFF.strong;
      if (buffed(v, 'tough', t)) amount *= C.BUFF.tough;
    }
    // Armor soaks its share of every hit (not bleeding) until it runs out.
    let absorbed = 0;
    if (v.armor && info.kind !== 'bleed') {
      absorbed = Math.min(v.armor.dur, amount * v.armor.block);
      v.armor.dur -= absorbed;
      amount -= absorbed;
    }
    const d = Math.max(1, Math.round(amount));
    v.hp -= d;
    if (att && att !== v) { v.lastHitBy = att.id; v.lastHitAt = t; }
    if (info.stun) v.stunUntil = Math.max(v.stunUntil, t + info.stun);
    if (info.slow) v.slowUntil = Math.max(v.slowUntil, t + info.slow);
    if (info.bleed) { v.bleedUntil = t + 3; v.bleedDps = info.bleed; v.bleedBy = att ? att.id : 0; }
    if (info.kb && v.bot) v.kbv = M.add(v.kbv, info.kb);
    broadcast({
      t: 'dmg', v: v.id, a: att ? att.id : 0, d, hp: Math.max(0, v.hp), k: info.kind,
      hs: info.head ? 1 : 0, cr: info.crit ? 1 : 0,
      pos: info.pos ? rnd(info.pos, 2) : null, kb: info.kb ? rnd(info.kb, 2) : null,
      st: info.stun || 0, sl: info.slow || 0,
      ab: Math.round(absorbed), ad: v.armor ? Math.round(v.armor.dur) : null,
    });
    if (v.armor && v.armor.dur < 1) {
      v.armor = null;
      broadcast({ t: 'armor', id: v.id, armor: null, broke: 1 });
    }
    if (v.hp <= 0) kill(v, info, t);
  }

  function kill(v, info, t) {
    v.alive = false;
    v.hp = 0;
    v.charging = false;
    if (info.kind === 'doom') {
      // the end of the world isn't anyone's fault, and nobody gets up again until the new Stone Age
      v.respawnAt = Infinity;
      v.armor = null;
      broadcast({ t: 'die', v: v.id, a: 0, k: 'doom', w: '', vb: '', hs: 0 });
      return;
    }
    v.deaths++;
    // co-op: no getting up mid-wave; clearing the wave wakes the fallen
    v.respawnAt = coop() ? Infinity : t + PLAYER.respawn;
    let killer = info.attacker || null;
    // Environmental deaths credit whoever hit you last ("pushed into boulder").
    if ((!killer || killer === v) && info.kind !== 'self' && v.lastHitBy && t - v.lastHitAt < 6) {
      killer = players.get(v.lastHitBy) || null;
    }
    if (killer === v) killer = null;
    if (killer) killer.kills++;
    // streaks: a beast's kills count for its owner but don't feed the streak (no beast chains)
    v.streak = 0;
    if (killer && !info.beast) {
      killer.streak++;
      const reward = C.STREAK_REWARDS[killer.streak];
      if (reward) grantReward(killer, reward, t);
    }
    broadcast({ t: 'die', v: v.id, a: killer ? killer.id : 0, k: info.kind, w: info.wname || '', vb: info.verb || '', hs: info.head ? 1 : 0 });
    // Everything they carried falls out for someone else: armor, weapon and spare ammo,
    // spread a little so each is easy to pick.
    const side = M.randomTangent(v.p);
    const spot = k => {
      const u = M.moveOnSphere(v.p, side, M.scale(side, k), 0.9)[0];
      return M.obstacleAt(M.scale(u, R + 0.3), world.obstacles) ? v.p : u;
    };
    if (v.armor && v.armor.dur >= 10) dropArmor(v.p, v.armor, t, 30);
    v.armor = null;
    if (v.weapon) dropLoot(spot(1), { wpn: v.weapon }, t);
    if (v.ammo > 0) dropLoot(spot(-1), { ammo: v.ammo / rangedDef().ammo, w: eraDef().ranged }, t);
    v.ammo = 0;
  }

  // ------------------------------------------------------------------ loot from the fallen
  // item: { wpn } or { ammo, w } where ammo is the share of a full load (so a half-full gun's
  // magazine is worth half a load of spears to whoever picks it up).
  function dropLoot(u, item, t, life = C.LOOT.life) {
    const l = { id: nextId++, u, ...item, expire: t + life };
    loot.set(l.id, l);
    broadcast({ t: 'loot', ...publicLoot(l) });
    if (loot.size > C.LOOT.max) removeLoot([...loot.values()].reduce((a, b) => (a.expire < b.expire ? a : b)));
  }

  function removeLoot(l, by = null, extra = {}) {
    loot.delete(l.id);
    broadcast({ t: 'unloot', id: l.id, by: by ? by.id : 0, ...extra });
  }

  function stepLoot(t, pl) {
    // ammo pouches: walk over one when you're short and you get its share of a load
    const def = rangedDef();
    if (pl.ammo >= def.ammo) return;
    for (const l of loot.values()) {
      if (!l.ammo || M.arcDist(pl.p, l.u) > C.LOOT.grabRadius) continue;
      const got = Math.min(def.ammo - pl.ammo, Math.max(1, Math.round(l.ammo * def.ammo)));
      pl.ammo += got;
      sendMe(pl);
      removeLoot(l, pl, { n: got });
      if (pl.ammo >= def.ammo) break;
    }
  }

  function expireLoot(t) {
    for (const l of loot.values()) if (t > l.expire) removeLoot(l);
  }

  // ------------------------------------------------------------------ food: campfire roasts, magic mushrooms
  const publicFire = f => ({ id: f.id, left: Math.max(0, Math.round((f.readyAt - now()) * 10) / 10) });
  const publicShroom = s => ({ id: s.id, kind: s.kind, u: rnd(s.u, 4) });
  const buffed = (pl, kind, t = now()) => (pl.buffs?.[kind] || 0) > t;

  // The cooked roast nearest pl, if one is within reach.
  function fireInReach(pl, t) {
    let best = null, bestD = Infinity;
    for (const f of fires) {
      const d = M.arcDist(pl.p, f.u) - f.r;
      if (d < C.MEAT.reach && d < bestD && t >= f.readyAt) { best = f; bestD = d; }
    }
    return best && { fire: best, d: bestD };
  }

  // Eat it; a raw one goes on the spit.
  function eatMeat(pl, f, t) {
    f.readyAt = t + C.MEAT.cook;
    heal(pl, C.MEAT.heal);
    broadcast({ t: 'meat', id: f.id, by: pl.id, left: C.MEAT.cook });
  }

  // One of each kind, spread around the planet (not up the volcano, not at the Businessman's feet).
  function growShroom(kind) {
    const others = [...shrooms.values()];
    const u = randomClearPoint(1.2, p => p[1] < 0.7 && M.arcDist(p, C.MAMMON.at) > 7 && others.every(s => M.arcDist(p, s.u) > 12));
    const s = { id: nextId++, kind, u };
    shrooms.set(s.id, s);
    broadcast({ t: 'shroom', ...publicShroom(s) });
  }

  function eatShroom(pl, s, t) {
    const def = C.SHROOMS[s.kind];
    shrooms.delete(s.id);
    shroomRegrow.push({ kind: s.kind, at: t + randIn(C.SHROOM_RULES.regrow) });
    pl.buffs[s.kind] = t + def.secs;
    broadcast({ t: 'unshroom', id: s.id, by: pl.id });
    broadcast({ t: 'buff', id: pl.id, kind: s.kind, left: def.secs });
  }

  function stepFood(t) {
    // any kind that's neither growing nor waiting to grow back (e.g. at startup) sprouts now
    for (const kind of Object.keys(C.SHROOMS)) {
      if (![...shrooms.values()].some(s => s.kind === kind) && !shroomRegrow.some(r => r.kind === kind)) growShroom(kind);
    }
    for (let i = shroomRegrow.length - 1; i >= 0; i--) {
      if (t >= shroomRegrow[i].at) { growShroom(shroomRegrow[i].kind); shroomRegrow.splice(i, 1); }
    }
  }

  // Per caveman, per tick: eat a mushroom by walking over it, and the regrow buff's healing.
  function stepBuffs(pl, t) {
    for (const s of shrooms.values()) {
      if (pl.h < 1.5 && M.arcDist(pl.p, s.u) < C.SHROOM_RULES.reach) { eatShroom(pl, s, t); break; }
    }
    if (buffed(pl, 'regrow', t)) {
      pl.regrowAcc = (pl.regrowAcc || 0) + C.BUFF.regrow * DT;
      if (pl.regrowAcc >= C.BUFF.regrow) { pl.regrowAcc -= C.BUFF.regrow; heal(pl, C.BUFF.regrow); }
    }
  }

  // ------------------------------------------------------------------ killstreak beasts
  let firstLookTurn = 0;   // whose turn it is for a first dog to be which breed (see summonBeast)
  // Mammoths and T-Rexes crash straight through trees, campfires and small rocks; only the big
  // stuff (huts, boulders of rock, skeletons, the volcano) makes them go round.
  const BIG_SOLIDS = world.obstacles.filter(o => o.r >= 1.3);
  const solidsFor = def => (def.radius >= 1.5 ? BIG_SOLIDS : world.obstacles);

  const publicBeast = b => ({
    id: b.id, kind: b.kind, look: b.look, name: b.name, owner: b.owner, p: rnd(b.p, 4), f: rnd(b.f, 4), h: b.h, hp: Math.round(b.hp), maxHp: b.maxHp,
    left: Math.round((b.until - now()) * 10) / 10,
  });

  // Earned on a streak. One waiting slot: a bigger beast replaces a smaller one, never the reverse.
  // Bots don't wait: they call it right away.
  function grantReward(pl, kind, t) {
    if (kind !== 'trex' && Math.random() < C.TREX_CHANCE) kind = 'trex';
    if (pl.reward && C.BEASTS[pl.reward].rank >= C.BEASTS[kind].rank) return;
    pl.reward = kind;
    broadcast({ t: 'reward', id: pl.id, kind });
    if (pl.bot && pl.alive && !beasts.has(pl.beastId)) summonBeast(pl, t);
  }

  function beastCommand(pl, m, t) {
    const b = beasts.get(pl.beastId);
    if (!b) {
      if (pl.reward) summonBeast(pl, t);
      return;
    }
    const target = players.get(m.target);
    if (target && target.alive && isEnemy(b, target)) {
      b.cmdTarget = target.id;
      b.cmdPoint = null;
      b.holdPoint = null;
    } else if (isVec(m.u)) {
      let spot = M.norm(m.u);
      const r = C.BEASTS[b.kind].radius;
      for (const o of solidsFor(C.BEASTS[b.kind])) {
        const out = M.pushOut(spot, M.anyTangent(spot), o.u, o.r + r);
        if (out) spot = out.p;
      }
      b.cmdPoint = spot;
      b.cmdTarget = 0;
      b.holdPoint = null;
    } else return;
    b.cmdUntil = t + 12;
    b.think = 0;
    broadcast({ t: 'bcmd', id: b.id, target: b.cmdTarget, u: b.cmdPoint && rnd(b.cmdPoint, 4) });
  }

  // It bursts out of the ground a few steps in front of its caveman.
  function summonBeast(pl, t) {
    const kind = pl.reward;
    const def = C.BEASTS[kind];
    // which dog: first dogs are dealt out in turn across everyone (pit, dingo, pit, ...), and after
    // that each caveman gets the other breed from last time, so nobody keeps getting the same one
    const looks = def.looks ? Object.keys(def.looks) : null;
    let look = null;
    if (looks) {
      look = pl.lastLook ? looks.find(l => l !== pl.lastLook) : looks[firstLookTurn++ % looks.length];
      pl.lastLook = look;
    }
    pl.reward = null;
    let p = M.moveOnSphere(pl.p, pl.f, pl.f, def.radius + 2.5)[0];
    if (!isClear(p, def.radius * 0.6)) p = pl.p;
    const b = {
      id: nextId++, kind, look, name: look ? def.looks[look] : def.name, owner: pl.id, p, f: pl.f.slice(), h: 0, vh: 0, hp: def.hp, maxHp: def.hp,
      until: t + def.life, think: 0, target: 0, cmdTarget: 0, cmdPoint: null, cmdUntil: 0,
      cd: {}, hitCd: new Map(), lunge: 0, pending: [], kbv: [0, 0, 0], moving: false,
    };
    if (kind === 'trex') b.cd.roar = t + 1.5;   // it announces itself
    beasts.set(b.id, b);
    pl.beastId = b.id;
    broadcast({ t: 'beast', ...publicBeast(b) });
    log(`beast "${pl.name}" calls ${b.name}`);
  }

  // reason: 'left' (time's up or the owner left), 'slain' (by), 'round' (new round)
  function beastGone(b, reason, by = null) {
    beasts.delete(b.id);
    const owner = players.get(b.owner);
    if (owner && owner.beastId === b.id) owner.beastId = 0;
    if (reason !== 'round') broadcast({ t: 'beastgone', id: b.id, reason, by: by ? by.id : 0 });
    if (reason === 'slain' && by) by.kills++;
  }

  // Who a beast may hurt: anyone but its caveman and (in co-op) his side.
  const isEnemy = (b, pl) => pl.id !== b.owner && !allies(players.get(b.owner), pl);

  function beastHits(b, pl, info) {
    const def = C.BEASTS[b.kind];
    damage(pl, info.dmg, {
      attacker: players.get(b.owner) || null, kind: b.kind, wname: b.name, beast: true,
      kb: info.kb, stun: info.stun, pos: M.scale(pl.p, R + pl.h + 1.2),
    });
  }

  // Everyone hurtable within `range` (+ their body) in front of the beast, inside `arc` degrees.
  function beastVictims(b, range, arc = 360) {
    const cosHalf = Math.cos((arc * Math.PI) / 360);
    const out = [];
    for (const pl of players.values()) {
      if (!pl.alive || !isEnemy(b, pl) || pl.h > C.BEASTS[b.kind].height) continue;
      const d = M.arcDist(b.p, pl.p);
      if (d > range + PLAYER.radius) continue;
      if (arc < 360 && d > 0.5 && M.dot(M.towardDir(b.p, pl.p), b.f) < cosHalf) continue;
      out.push(pl);
    }
    return out;
  }

  function stepBeasts(t) {
    for (const b of [...beasts.values()]) {
      const def = C.BEASTS[b.kind];
      const owner = players.get(b.owner);
      if (!owner || t >= b.until) { beastGone(b, 'left'); continue; }
      const live = fighting();

      // pick who to go after a few times a second: the one it was sent at, else the nearest enemy
      if ((b.think -= DT) <= 0) {
        b.think = 0.25;
        if (t > b.cmdUntil) { b.cmdTarget = 0; b.cmdPoint = null; }
        const sent = players.get(b.cmdTarget);
        if (sent && sent.alive) b.target = sent.id;
        else {
          b.cmdTarget = 0;
          // on its way somewhere it ignores everyone; holding a spot, it only chases enemies who
          // come near that spot; otherwise anyone it can sense
          const holding = b.holdPoint && t < b.holdUntil;
          const from = holding ? b.holdPoint : b.p;
          let best = null, bestD = b.cmdPoint ? 0 : holding ? C.BEAST_HOLD_RADIUS : def.sense;
          for (const pl of players.values()) {
            if (!pl.alive || !isEnemy(b, pl)) continue;
            const d = M.arcDist(from, pl.p);
            if (d < bestD) { bestD = d; best = pl; }
          }
          b.target = best ? best.id : 0;
        }
      }
      const target = live ? players.get(b.target) : null;
      let goal = null;
      if (target && target.alive) goal = target.p;
      else if (b.cmdPoint) {
        goal = b.cmdPoint;
        // there: it holds the spot (and hunts whoever comes near it) until the order runs out
        if (M.arcDist(b.p, goal) < 2.5) { b.holdPoint = b.cmdPoint; b.holdUntil = b.cmdUntil; b.cmdPoint = null; }
      } else if (b.holdPoint && t < b.holdUntil) {
        if (M.arcDist(b.p, b.holdPoint) > 2.5) goal = b.holdPoint;   // back to its post
      } else if (owner.alive && M.arcDist(b.p, owner.p) > 6) goal = owner.p;   // heel

      // move: big ones steer around rocks and trees like everyone else
      const dist = target ? M.arcDist(b.p, target.p) : Infinity;
      const close = target && dist < (def.chomp?.range ?? def.tusk?.range ?? def.bite.range) * 0.6;
      let move = goal && !close ? M.towardDir(b.p, goal) : null;
      if (move) move = beastSteer(b, move, def, t);
      else b.stuckFrom = null;
      const speed = def.speed * (t < b.lunge ? 1.9 : 1);
      let disp = move ? M.scale(M.tangent(b.p, move), speed * DT) : [0, 0, 0];
      disp = M.madd(disp, b.kbv, DT);
      b.kbv = M.scale(b.kbv, Math.exp(-DT * 4));
      const dl = M.len(disp);
      b.moving = dl > 1e-4;
      if (dl > 1e-6) [b.p, b.f] = M.moveOnSphere(b.p, b.f, M.scale(disp, 1 / dl), dl);
      [b.p, b.f] = M.collideObstacles(b.p, b.f, solidsFor(def), def.radius * 0.8);
      const face = target ? M.towardDir(b.p, target.p) : move;
      if (face) {
        const k = 1 - Math.exp(-DT * (b.kind === 'dog' ? 10 : 5));
        b.f = M.tangent(b.p, M.add(M.scale(b.f, 1 - k), M.scale(M.tangent(b.p, face), k)));
      }
      b.vh -= PLAYER.gravity * DT;
      b.h += b.vh * DT;
      if (b.h <= 0) { b.h = 0; b.vh = 0; }

      if (live) beastAttack(b, def, target, dist, t);
      // blows wound up earlier land now
      for (let i = b.pending.length - 1; i >= 0; i--) {
        const a = b.pending[i];
        if (t < a.at) continue;
        b.pending.splice(i, 1);
        if (live) a.fn();
      }
    }
  }

  // Big bodies have to start turning around rocks and trees sooner than cavemen do. If one still
  // wedges itself in (trying to go somewhere but barely moving for a second), it side-steps a moment.
  function beastSteer(b, move, def, t) {
    if (t < (b.detourUntil || 0)) return M.tangent(b.p, b.detour);
    let m = M.tangent(b.p, move);
    for (const o of solidsFor(def)) {
      const gap = M.arcDist(b.p, o.u) - o.r - def.radius;
      if (gap > 3) continue;
      const to = M.towardDir(b.p, o.u);
      const ahead = M.dot(to, m);
      if (ahead <= 0.1) continue;
      const side = M.cross(to, b.p);
      m = M.madd(m, side, (M.dot(side, m) >= 0 ? 1 : -1) * 1.8 * ahead * (1 - Math.max(0, gap) / 3));
    }
    if (t >= (b.stuckCheck || 0)) {
      if (b.stuckFrom && M.arcDist(b.stuckFrom, b.p) < def.speed * 0.15) {
        const side = M.cross(m, b.p);
        b.detour = M.norm(M.madd(M.scale(side, Math.random() < 0.5 ? 1 : -1), m, -0.4));
        b.detourUntil = t + 0.8;
      }
      b.stuckFrom = b.p.slice();
      b.stuckCheck = t + 1;
    }
    return M.len(m) > 1e-4 ? M.norm(m) : null;
  }

  function beastAttack(b, def, target, dist, t) {
    const ready = k => !(t < (b.cd[k] || 0));
    const windup = (a, delay, fn) => {
      broadcast({ t: 'battack', id: b.id, a });
      b.pending.push({ at: t + delay, fn });
    };
    if (b.kind === 'dog') {
      // leap at anyone a few strides away, bite anyone close
      if (target && b.h <= 0 && ready('pounce') && dist > 2.5 && dist < def.pounce.range) {
        b.cd.pounce = t + def.pounce.cd;
        b.vh = 8;
        b.lunge = t + 0.45;
        windup('pounce', 0.4, () => {
          for (const pl of beastVictims(b, 1.8, 140)) {
            beastHits(b, pl, { dmg: def.pounce.dmg, stun: def.pounce.stun, kb: M.scale(b.f, def.pounce.kb) });
          }
        });
      } else if (target && ready('bite') && dist < def.bite.range) {
        b.cd.bite = t + def.bite.cd;
        windup('bite', 0.15, () => {
          for (const pl of beastVictims(b, def.bite.range, 120).slice(0, 1)) beastHits(b, pl, { dmg: def.bite.dmg, kb: M.scale(b.f, 4) });
        });
      }
    } else if (b.kind === 'mammoth') {
      // anything in front of a walking mammoth gets run over
      if (b.moving) {
        for (const pl of beastVictims(b, def.radius + 0.4, 200)) {
          if (t < (b.hitCd.get(pl.id) || 0) || pl.h > 1.5) continue;
          b.hitCd.set(pl.id, t + def.trample.cd);
          beastHits(b, pl, { dmg: def.trample.dmg, kb: M.add(M.scale(b.f, def.trample.kb), M.scale(M.awayDir(pl.p, b.p), 8)) });
          broadcast({ t: 'battack', id: b.id, a: 'trample' });
        }
      }
      if (target && ready('tusk') && dist < def.tusk.range) {
        b.cd.tusk = t + def.tusk.cd;
        windup('tusk', 0.35, () => {
          for (const pl of beastVictims(b, def.tusk.range, def.tusk.arc)) {
            beastHits(b, pl, { dmg: def.tusk.dmg, kb: M.scale(M.awayDir(pl.p, b.p), def.tusk.kb) });
          }
        });
      }
    } else if (b.kind === 'trex') {
      // the roar freezes everyone near; the chomp is the end of most cavemen
      if (ready('roar') && beastVictims(b, def.roar.range).length) {
        b.cd.roar = t + def.roar.cd;
        windup('roar', 0.5, () => {
          for (const pl of beastVictims(b, def.roar.range)) beastHits(b, pl, { dmg: 1, stun: def.roar.stun });
        });
      } else if (target && ready('chomp') && dist < def.chomp.range) {
        b.cd.chomp = t + def.chomp.cd;
        windup('chomp', 0.4, () => {
          for (const pl of beastVictims(b, def.chomp.range, def.chomp.arc).slice(0, 2)) {
            beastHits(b, pl, { dmg: def.chomp.dmg, kb: M.scale(M.awayDir(pl.p, b.p), def.chomp.kb) });
          }
        });
      }
    }
  }

  // Somebody fights back. Its own caveman (and his tribe in co-op) can't hurt it.
  function damageBeast(b, amount, att, pos = null) {
    if (!beasts.has(b.id) || !fighting()) return;
    if (att && (att.id === b.owner || allies(players.get(b.owner), att))) return;
    const d = Math.max(1, Math.round(amount));
    b.hp -= d;
    broadcast({ t: 'bdmg', id: b.id, d, hp: Math.max(0, b.hp), a: att ? att.id : 0, pos: pos && rnd(pos, 2) });
    if (b.hp <= 0) beastGone(b, 'slain', att);
  }

  // The beast a point in the air is inside, skipping ones `att` can't hurt.
  function beastAt(p, att = null) {
    const r = M.len(p);
    for (const b of beasts.values()) {
      if (att && (att.id === b.owner || allies(players.get(b.owner), att))) continue;
      const def = C.BEASTS[b.kind];
      const hgt = r - R - b.h;
      if (hgt < -0.3 || hgt > def.height) continue;
      if (M.arcDist(M.scale(p, 1 / r), b.p) < def.radius) return b;
    }
    return null;
  }

  // ------------------------------------------------------------------ armor
  function dropArmor(u, armor, t, life = DOTIME.armorLife) {
    const a = { id: nextId++, u, armor, expire: t + life };
    armorDrops.set(a.id, a);
    broadcast({ t: 'adrop', ...publicDrop(a) });
  }

  function wearArmor(pl, drop) {
    armorDrops.delete(drop.id);
    pl.armor = { ...drop.armor };
    broadcast({ t: 'adel', id: drop.id, by: pl.id });
    broadcast({ t: 'armor', id: pl.id, armor: pl.armor });
  }

  function stepArmor(t) {
    if (game.mode === 'classic' || game.phase !== 'play') return;
    if (t >= game.nextArmorAt) {
      // drops come faster in later ages (down to a quarter of the Stone Age gap)
      game.nextArmorAt = t + randIn(DOTIME.armorEvery) * Math.max(0.25, 0.5 ** game.era);
      if (armorDrops.size < DOTIME.armorMax + Math.floor(humanCount() / 4)) {
        dropArmor(randomClearPoint(1.5), C.makeArmor(game.era), t);
      }
    }
    for (const a of armorDrops.values()) {
      if (t > a.expire) { armorDrops.delete(a.id); broadcast({ t: 'adel', id: a.id }); }
    }
  }

  // ------------------------------------------------------------------ Do Time clock
  function stepGame(t) {
    if (coop()) { stepCoop(t); return; }
    if (game.mode !== 'dotime') return;
    if (game.phase === 'end') {
      if (t >= game.endUntil) restartRound(t);
      return;
    }
    if (game.phase === 'doom') {
      stepDoom(t);
      return;
    }
    if (t < game.eraStart + eraLen()) return;
    if (game.era < C.ERAS.length - 1) advanceEra(t);
    else startDoom(t);
  }

  const advanceEra = t => setEra(t, game.era + 1);

  function setEra(t, index) {
    game.era = index;
    game.eraStart = t;
    const era = eraDef();
    broadcast({ t: 'era', ...gameInfo(t) });
    for (const pl of players.values()) {
      pl.ammo = rangedDef().ammo;
      pl.regen = 0;
      sendMe(pl);
      if (!era.regear) continue;
      if (pl.bot) {
        // bots just take the new age's weapon
        pl.weapon = newWeapon();
        broadcast({ t: 'wpn', id: pl.id, wpn: pl.weapon, era: 1 });
      } else if (pl.alive) {
        // humans keep what they've got: the new age's weapon lands just in front of them, to take
        // with E (theirs drops in its place, as with any loot) or to leave lying there
        const ahead = M.moveOnSphere(pl.p, pl.f, pl.f, 1.6)[0];
        const u = M.obstacleAt(M.scale(ahead, R + 0.3), world.obstacles) ? pl.p : ahead;
        dropLoot(u, { wpn: newWeapon() }, t, C.LOOT.giftLife);
      }
    }
    for (const pk of pickups) {
      pk.wpn = newWeapon();
      pk.rerollAt = t + rand(40, 60);
      broadcast({ t: 'pickup', id: pk.id, wpn: pk.wpn });
    }
    log(`era   ${era.name}`);
  }

  // After the Zap Age a random natural disaster ends the world. Clients get the whole plan up
  // front (what, where, when) so they can draw it; the server just checks the clock and kills.
  function startDoom(t) {
    const kinds = Object.keys(DISASTERS).filter(k => k !== game.lastDisaster);
    const kind = kinds[Math.floor(Math.random() * kinds.length)];
    const def = DISASTERS[kind];
    Object.assign(game, {
      phase: 'doom', disaster: kind, lastDisaster: kind, doomStart: t, doomEnd: t + def.duration, doomDone: false, strikes: [],
      // the volcano blows itself up; the cold just arrives everywhere at once; the flood starts
      // far enough from the Businessman that it reaches him about MAMMON.dieAt in
      doomCenter: kind === 'volcano' ? [0, 1, 0] : kind === 'freeze' ? null : def.wave ? floodStart(def.wave) : M.randomUnit(),
    });
    for (let i = 0; i < (def.strikes || 0); i++) {
      const at = def.first + (i / (def.strikes - 1)) * (def.last - def.first) + rand(-0.2, 0.2);
      game.strikes.push({ to: M.randomUnit(), at, done: false });
    }
    // and one of them is for the Businessman (killNear gets him when it lands)
    if (def.strikes) game.strikes.push({ to: C.MAMMON.at.slice(), at: C.MAMMON.dieAt, done: false });
    if (kind === 'volcano') volcano.next = t;   // and it starts lobbing real lava bombs too
    armorDrops.clear();
    loot.clear();
    broadcast({ t: 'doom', ...doomInfo(t), ...gameInfo(t) });
    log(def.name);
  }

  // el: seconds since the disaster began, so late joiners can catch up.
  const doomInfo = (t = now()) => ({
    el: Math.round((t - game.doomStart) * 100) / 100,
    strikes: game.strikes.map(s => ({ to: rnd(s.to, 3), at: Math.round(s.at * 100) / 100 })),
    center: game.doomCenter && rnd(game.doomCenter, 3),
  });

  function stepDoom(t) {
    const def = DISASTERS[game.disaster];
    const el = t - game.doomStart;
    for (const s of game.strikes) {
      if (s.done || el < s.at) continue;
      s.done = true;
      killNear(s.to, def.blast, t);
    }
    if (def.wave) killNear(game.doomCenter, C.waveAngle(def.wave, el) * R, t);
    if (!game.doomDone && el >= def.final) {
      game.doomDone = true;
      killNear(null, Infinity, t);
    }
    if (t >= game.doomEnd) endRound(t);
  }

  // Kills everyone within `dist` (along the ground) of unit point u, or everyone if u is null.
  // The Businessman too: his bunker doesn't help.
  function killNear(u, dist, t) {
    for (const pl of players.values()) {
      if (pl.alive && (!u || M.arcDist(pl.p, u) < dist)) kill(pl, { kind: 'doom' }, t);
    }
    if (!game.mammonDead && (!u || M.arcDist(C.MAMMON.at, u) < dist)) {
      game.mammonDead = true;
      broadcast({ t: 'mammondie', el: Math.round((t - game.doomStart) * 100) / 100 });
      log('the Businessman is dead');
    }
  }

  // A random flood source whose wave front reaches the Businessman's podium about MAMMON.dieAt
  // seconds into the finale (the front sweeps the planet from wave.start to wave.end).
  function floodStart(wave) {
    const k = M.clamp((C.MAMMON.dieAt - wave.start) / (wave.end - wave.start), 0.05, 0.95);
    const want = k * Math.PI * R;   // how far (along the ground) the flood starts from him
    for (let i = 0; i < 500; i++) {
      const u = M.randomUnit();
      if (Math.abs(M.arcDist(u, C.MAMMON.at) - want) < 0.08 * R) return u;
    }
    return M.randomUnit();
  }

  // The world ended (Do Time) or the whole tribe is down (co-op, where only the humans are ranked).
  function endRound(t) {
    game.phase = 'end';
    game.endUntil = t + (coop() ? C.COOP.endSeconds : DOTIME.endSeconds);
    game.strikes = [];
    for (const pl of players.values()) { pl.charging = false; if (pl.ai) pl.ai.throwAt = 0; }
    const standings = [...players.values()]
      .filter(p => !coop() || !p.bot)
      .sort((a, b) => b.kills - a.kills || a.deaths - b.deaths)
      .slice(0, 5)
      .map(p => ({ id: p.id, name: p.name, k: p.kills, d: p.deaths, bot: p.bot }));
    broadcast({ t: 'roundend', standings, ...gameInfo(t) });
    log(coop() ? `tribe wiped on wave ${game.wave}` : `round over, winner "${standings[0]?.name ?? 'nobody'}"`);
  }

  // ------------------------------------------------------------------ co-op waves
  const humansHere = () => [...players.values()].filter(p => !p.bot);

  function removeBots() {
    for (const b of [...players.values()]) if (b.bot) removePlayer(b.id);
  }

  function stepCoop(t) {
    const humans = humansHere();
    if (!humans.length) {
      // nobody to fight for: clear the planet and wait for someone
      if (game.wave || game.phase !== 'break' || game.breakUntil !== Infinity) coopReset(t);
      return;
    }
    if (game.phase === 'end') {
      if (t >= game.endUntil) restartRound(t);
    } else if (game.phase === 'break') {
      if (game.breakUntil === Infinity) {
        game.breakUntil = t + C.COOP.firstBreak;
        broadcastGame();
      } else if (t >= game.breakUntil) startWave(t);
    } else if (!humans.some(p => p.alive)) {
      endRound(t);
    } else if (![...players.values()].some(p => p.bot && p.alive)) {
      waveCleared(t);
    }
  }

  // "Waiting for wave 1": no bots; the first wave comes a few seconds after a human is here.
  function coopReset(t) {
    removeBots();
    Object.assign(game, {
      phase: 'break', wave: 0, waveSize: 0, waveLevel: 0,
      breakUntil: humansHere().length ? t + C.COOP.firstBreak : Infinity,
    });
    if (!humansHere().length) game.camp = null;   // the next tribe picks its own
    broadcastGame();
  }

  function startWave(t) {
    game.wave++;
    game.waveSize = Math.min(C.MAX_BOTS, C.COOP.firstWave + game.wave - 1 + Math.max(0, humansHere().length - 1));
    game.waveLevel = Math.min(C.BOT_LEVELS.length, game.botLevel + Math.floor((game.wave - 1) / C.COOP.smarterEvery));
    game.phase = 'play';
    removeBots();   // last wave's fallen
    for (let i = 0; i < game.waveSize; i++) addBot();
    const era = Math.min(C.ERAS.length - 1, Math.floor((game.wave - 1) / C.COOP.ageEvery));
    if (era !== game.era) setEra(t, era);
    broadcast({ t: 'wave', start: 1, ...gameInfo(t) });
    log(`wave  ${game.wave}: ${game.waveSize} bots, brains ${game.waveLevel}/10`);
  }

  // Every bot is down: the fallen wake up next to a friend, everyone else heals and restocks.
  function waveCleared(t) {
    game.phase = 'break';
    game.breakUntil = t + C.COOP.breakSeconds;
    const standing = humansHere().filter(p => p.alive);
    for (const pl of humansHere()) {
      if (!pl.alive) {
        const friend = standing[Math.floor(Math.random() * standing.length)];
        spawnPlayer(pl, true, friend ? spawnNear(friend.p) : null);
      } else {
        heal(pl, PLAYER.maxHp);
        pl.ammo = rangedDef().ammo;
        sendMe(pl);
      }
    }
    broadcast({ t: 'wave', cleared: 1, ...gameInfo(t) });
    log(`wave  ${game.wave} cleared`);
  }

  // Co-op: the tribe sticks together. A human comes in beside a tribe member who's up, or at the
  // tribe's camp if nobody is; bots (and every other mode) spawn as far from everyone as possible.
  function tribeSpawn(pl) {
    if (!coop() || pl.bot) return null;
    const friends = humansHere().filter(p => p !== pl && p.alive);
    if (friends.length) return spawnNear(friends[Math.floor(Math.random() * friends.length)].p);
    return game.camp ? spawnNear(game.camp) : null;
  }

  // A clear spot a few steps from unit point u, or null.
  function spawnNear(u) {
    for (let i = 0; i < 24; i++) {
      const dir = M.randomTangent(u);
      const p = M.moveOnSphere(u, dir, dir, rand(2.5, 4.5))[0];
      if (isClear(p, PLAYER.radius + 0.6)) return [p, M.towardDir(p, u)];
    }
    return null;
  }

  // New round from the Stone Age: scores, gear, armor and projectiles all reset.
  function restartRound(t) {
    game.phase = 'play';
    game.era = 0;
    game.eraStart = t;
    game.disaster = null;
    game.strikes = [];
    game.mammonDead = false;   // a new Businessman for a new world
    game.nextArmorAt = t + randIn(DOTIME.armorEvery);
    armorDrops.clear();
    loot.clear();
    for (const f of fires) f.readyAt = 0;
    for (const b of [...beasts.values()]) beastGone(b, 'round');
    spears.clear();
    swings.length = 0;
    Object.assign(game, { wave: 0, waveSize: 0, waveLevel: 0 });
    if (coop()) {
      // co-op starts with a short breather before wave 1, and only the humans, all at one camp
      removeBots();
      Object.assign(game, { phase: 'break', breakUntil: humansHere().length ? t + C.COOP.firstBreak : Infinity });
      game.camp = findSpawn()[0];
    }
    for (const pk of pickups) { pk.wpn = newWeapon(); pk.rerollAt = t + rand(50, 80); }
    broadcast({ t: 'round', pickups: pickups.map(pk => ({ id: pk.id, wpn: pk.wpn })), ...gameInfo(t) });
    for (const pl of players.values()) {
      pl.kills = 0;
      pl.deaths = 0;
      pl.streak = 0;
      pl.reward = null;
      if (pl.ai) pl.ai.throwAt = 0;
      // (in co-op every human gathers round the camp; "near a friend" would find friends who
      // haven't moved yet from where the last round left them)
      spawnPlayer(pl, true, coop() && !pl.bot ? spawnNear(game.camp) : null);
    }
    balanceBots();   // leaving co-op brings the fill-in bots back
  }

  function applyRules(m, by) {
    const changed = [];
    if (C.MODES[m.mode] && m.mode !== game.mode) {
      game.mode = m.mode;
      changed.push('mode');
    }
    const level = intIn(m.botLevel, 1, C.BOT_LEVELS.length, game.botLevel);
    if (level !== game.botLevel) { game.botLevel = level; changed.push('botLevel'); }
    const bots = intIn(m.bots, 0, C.MAX_BOTS, game.bots);
    if (bots !== game.bots) { game.bots = bots; changed.push('bots'); balanceBots(); }
    if (!changed.length) return;
    if (changed.includes('mode')) restartRound(now());
    broadcastGame({ by: by ? by.name : '', changed });
    log(`rules ${changed.join(', ')} -> ${game.mode}, bot brains ${botLevelText()}, ${game.bots} bots${by ? ` (by "${by.name}")` : ''}`);
  }

  // ------------------------------------------------------------------ lag compensation
  // Players see everyone else a little in the past: the interpolation delay plus their ping.
  // Their attacks carry `vt`, the server time of what was on their screen, and hits are checked
  // against where targets stood at that moment, so a beam that lands on screen lands for real.
  // Capped so a laggy (or lying) client can't reach far back.
  const MAX_REWIND = 0.3;
  const HIST_LEN = Math.ceil(MAX_REWIND * C.TICK_HZ) + 4;

  // Seconds to rewind for an attack message from a human.
  function viewLag(m, t) {
    const vt = Number(m.vt);
    return Number.isFinite(vt) ? M.clamp(t - vt, 0, MAX_REWIND) : 0;
  }

  function recordHistory(pl, t) {
    pl.hist.push({ t, p: pl.p.slice(), h: pl.h });
    if (pl.hist.length > HIST_LEN) pl.hist.shift();
  }

  // Where v stood (p, h) at server time t.
  function seenAt(v, t) {
    const hist = v.hist;
    if (!hist.length || t >= hist[hist.length - 1].t) return v;
    for (let i = hist.length - 1; i > 0; i--) {
      const a = hist[i - 1];
      if (a.t > t) continue;
      const b = hist[i];
      const k = (t - a.t) / Math.max(b.t - a.t, 1e-6);
      return { p: M.norm(M.add(M.scale(a.p, 1 - k), M.scale(b.p, k))), h: a.h + (b.h - a.h) * k };
    }
    return hist[0];
  }

  // ------------------------------------------------------------------ combat
  function throwProjectile(pl, pos, vel, tid, lag = 0) {
    pl.ammo--;
    sendMe(pl);
    const w = eraDef().ranged;
    const s = { id: nextId++, owner: pl.id, w, pos: pos.slice(), vel: vel.slice(), age: 0, stuck: false, dir: null, u: null, hgt: 0, expire: 0, lag };
    spears.set(s.id, s);
    broadcast({ t: 'spear', id: s.id, owner: pl.id, w, pos: rnd(pos, 4), vel: rnd(vel, 4), tid });
  }

  // Lasers are instant and dead straight, so they don't follow the planet's curve:
  // aim too high and the beam heads off into space.
  function zap(pl, pos, dir, lag = 0) {
    const def = rangedDef();
    pl.ammo--;
    sendMe(pl);
    const d = M.norm(dir);
    const seenT = now() - lag;
    const targets = [];
    for (const v of players.values()) if (v !== pl && v.alive && !allies(pl, v)) targets.push({ v, at: lag ? seenAt(v, seenT) : v });
    let hit = null, end = null, beast = null;
    for (let s = 0.4; s <= def.range && !end; s += 0.25) {
      const p = M.madd(pos, d, s);
      if (M.len(p) <= R || M.obstacleAt(p, world.obstacles)) { end = p; break; }
      for (const { v, at } of targets) {
        const zone = M.hitPlayer(p, at.p, at.h, def.hitRadius);
        if (zone) { hit = { v, head: zone === 2 }; end = p; break; }
      }
      if (!end && beasts.size && (beast = beastAt(p, pl))) end = p;
    }
    if (beast) damageBeast(beast, def.maxDmg, pl, end);
    end ||= M.madd(pos, d, def.range);
    broadcast({ t: 'zap', owner: pl.id, from: rnd(pos, 2), to: rnd(end, 2), hit: hit ? hit.v.id : 0 });
    if (hit) {
      damage(hit.v, def.maxDmg * (hit.head ? def.headMult : 1), {
        attacker: pl, kind: 'laser', wname: def.name, head: hit.head,
        kb: M.scale(M.tangent(hit.v.p, d), 3), pos: end,
      });
    }
  }

  // A swing lands its blow at `at`, and bats projectiles from batFrom to batUntil (see BAT). Big
  // slow weapons sweep through more of their wind-up, and a laggy swinger saw the projectile
  // late, so their window opens earlier (never before the swing itself).
  function startSwing(pl, t, lag = 0) {
    const cd = pl.weapon.cd * (buffed(pl, 'quick', t) ? C.BUFF.quick : 1);
    if (!pl.alive || !fighting() || t < pl.stunUntil || t - pl.lastSwing < cd * 0.85) return false;
    pl.lastSwing = t;
    const windup = pl.weapon.windup;
    const at = t + windup;
    swings.push({
      pid: pl.id, at, sq: pl.sq, lag, landed: false,
      batFrom: Math.max(t, at - Math.max(C.BAT.early, windup * 0.6) - lag), batUntil: at + C.BAT.late,
    });
    broadcast({ t: 'swing', id: pl.id });
    return true;
  }

  function resolveSwings(t) {
    for (let i = swings.length - 1; i >= 0; i--) {
      const sw = swings[i];
      const pl = players.get(sw.pid);
      const live = pl && pl.alive && pl.sq === sw.sq;
      if (!sw.landed && t >= sw.at) {
        sw.landed = true;
        if (live) meleeHit(pl, t, sw.lag);
      }
      if (!live || t > sw.batUntil) swings.splice(i, 1);
    }
  }

  // The swing pl has going right now that can still bat things, if any.
  function batWindow(pl, t) {
    for (const sw of swings) if (sw.pid === pl.id && sw.sq === pl.sq && t >= sw.batFrom && t <= sw.batUntil) return sw;
    return null;
  }

  // Spears, arrows and musket balls can be batted. Bullets come too thick and fast.
  const batable = s => !s.stuck && C.RANGED[s.w].proj !== 'bullet';

  // Hit it back. Facing the thrower sends it straight back down its own path (with gravity,
  // that lands it right where it was thrown from); otherwise it flies where you face.
  function batBack(s, att, lag) {
    const back = M.scale(M.norm(s.vel), -1);
    if (M.dot(M.tangent(att.p, back), att.f) > 0.5) {
      s.vel = M.scale(s.vel, -1.05);
    } else {
      const dir = M.norm(M.add(M.scale(att.f, Math.cos(0.2)), M.scale(att.p, Math.sin(0.2))));
      s.vel = M.scale(dir, Math.max(M.len(s.vel), 22));
    }
    s.owner = att.id;
    s.age = 0;
    s.lag = lag;
    broadcast({ t: 'deflect', id: s.id, owner: att.id, pos: rnd(s.pos, 4), vel: rnd(s.vel, 4) });
  }

  // Every live swing bats whatever is flying at the swinger within reach, in front. For a laggy
  // swinger the projectile counts where they saw it too (s.vel * lag back along its path).
  function batProjectiles(t) {
    if (!swings.length || !fighting()) return;
    for (const sw of swings) {
      if (t < sw.batFrom || t > sw.batUntil) continue;
      const att = players.get(sw.pid);
      if (!att || !att.alive || att.sq !== sw.sq) continue;
      const reach = att.weapon.range + C.BAT.reach;
      const chest = M.scale(att.p, R + att.h + 1.3);
      for (const s of spears.values()) {
        if (!batable(s) || s.owner === att.id || allies(players.get(s.owner), att)) continue;
        const near = p => {
          const off = M.sub(p, chest);
          const d = M.len(off);
          return d < reach && (d < 0.5 || M.dot(off, att.f) > C.BAT.front * d) && M.dot(s.vel, off) < 0;
        };
        if (near(s.pos) || (sw.lag && near(M.madd(s.pos, s.vel, -sw.lag)))) batBack(s, att, sw.lag);
      }
    }
  }

  // lag: the swinger's view delay. Targets are judged where the swinger saw them as the blow landed.
  function meleeHit(att, t, lag = 0) {
    const w = att.weapon;
    const cosHalf = Math.cos((w.arc * Math.PI) / 360);
    for (const v of players.values()) {
      if (v === att || !v.alive || allies(att, v)) continue;
      const at = lag ? seenAt(v, t - lag) : v;
      const dist = M.arcDist(att.p, at.p);
      if (dist > w.range + PLAYER.radius || Math.abs(at.h - att.h) > 2) continue;
      if (dist > 0.3 && M.dot(M.towardDir(att.p, at.p), att.f) < cosHalf) continue;
      const crit = w.crit > 0 && Math.random() < w.crit;
      const dmg = w.dmg * (crit ? 2 : 1);
      damage(v, dmg, {
        attacker: att, kind: 'melee', wname: w.name, verb: w.verb, crit,
        kb: M.scale(M.awayDir(v.p, att.p), w.kb), stun: w.stun, slow: w.slow, bleed: w.bleed,
        pos: M.scale(v.p, R + v.h + 1.3),
      });
      if (w.leech) heal(att, dmg * w.leech);
      if (w.heal) heal(att, w.heal);
    }
    // beasts are big: reach them from anywhere along their body
    for (const b of [...beasts.values()]) {
      const def = C.BEASTS[b.kind];
      const dist = M.arcDist(att.p, b.p) - def.radius;
      if (dist > w.range || Math.abs(b.h - att.h) > def.height) continue;
      if (dist > 0.3 && M.dot(M.towardDir(att.p, b.p), att.f) < cosHalf) continue;
      damageBeast(b, w.dmg, att, M.scale(b.p, R + b.h + def.height * 0.5));
    }
  }

  // Fast arrows can cover more than a body width per tick, so test points along the step.
  // Other cavemen are where the thrower saw them (s.lag); the thrower is where they really are.
  // In co-op it flies straight through the thrower's own side.
  function projectileVictim(s, prev, def, t) {
    const owner = players.get(s.owner);
    const targets = [];
    for (const pl of players.values()) {
      if (!pl.alive || (pl.id === s.owner && s.age < PROJECTILE.selfGrace) || allies(owner, pl)) continue;
      targets.push({ pl, at: s.lag && pl.id !== s.owner ? seenAt(pl, t - s.lag) : pl });
    }
    if (!targets.length && !beasts.size) return null;
    const seg = M.sub(s.pos, prev);
    const steps = Math.max(1, Math.ceil(M.len(seg) / (def.hitRadius * 0.8)));
    for (let i = 1; i <= steps; i++) {
      const p = M.madd(prev, seg, i / steps);
      for (const { pl, at } of targets) {
        const zone = M.hitPlayer(p, at.p, at.h, def.hitRadius);
        if (zone) return { pl, head: zone === 2, pos: p };
      }
      const beast = beasts.size ? beastAt(p, owner) : null;
      if (beast) return { beast, pos: p };
    }
    return null;
  }

  function stickProjectile(s, t, ground) {
    s.stuck = true;
    s.expire = t + PROJECTILE.stuckLife;
    s.dir = M.norm(s.vel);
    if (ground) s.pos = M.scale(M.norm(s.pos), R - (s.w === 'spear' ? 0.3 : 0.18));
    s.u = M.norm(s.pos);
    s.hgt = M.len(s.pos) - R;
    broadcast({ t: 'stuck', id: s.id, pos: rnd(s.pos, 4), dir: rnd(s.dir, 4) });
  }

  function stepProjectiles(t) {
    for (const s of spears.values()) {
      if (s.stuck) {
        if (t > s.expire) { spears.delete(s.id); broadcast({ t: 'spgone', id: s.id }); }
        continue;
      }
      const def = C.RANGED[s.w];
      const prev = s.pos.slice();
      s.age += DT;
      M.stepProjectile(s.pos, s.vel, DT);
      const hit = fighting() ? projectileVictim(s, prev, def, t) : null;
      if (hit?.beast) {
        // stuck in a beast's hide
        const speed = M.len(s.vel);
        const span = def.maxSpeed - def.minSpeed;
        const k = span > 0 ? M.clamp((speed - def.minSpeed) / span, 0, 1) : 1;
        spears.delete(s.id);
        broadcast({ t: 'sphit', id: s.id, v: 0 });
        damageBeast(hit.beast, M.lerp(def.minDmg, def.maxDmg, k), players.get(s.owner) || null, hit.pos);
        continue;
      }
      // mid-swing and it's coming at your face: you bat it instead of eating it
      const sw = hit && hit.pl.id !== s.owner && batable(s) && batWindow(hit.pl, t);
      if (sw && M.dot(M.tangent(hit.pl.p, M.scale(s.vel, -1)), hit.pl.f) > C.BAT.front) {
        s.pos = prev;
        batBack(s, hit.pl, sw.lag);
        continue;
      }
      if (hit) {
        const speed = M.len(s.vel);
        const span = def.maxSpeed - def.minSpeed;
        const k = span > 0 ? M.clamp((speed - def.minSpeed) / span, 0, 1) : 1;
        const dmg = M.lerp(def.minDmg, def.maxDmg, k) * (hit.head ? def.headMult : 1);
        const owner = players.get(s.owner) || null;
        spears.delete(s.id);
        broadcast({ t: 'sphit', id: s.id, v: hit.pl.id });
        damage(hit.pl, dmg, {
          attacker: owner, kind: owner === hit.pl ? 'self' : def.proj, wname: def.name, head: hit.head,
          kb: M.scale(M.tangent(hit.pl.p, s.vel), 4 + 4 * k), pos: hit.pos,
        });
        continue;
      }
      const ground = M.len(s.pos) <= R;
      const wall = !ground && M.obstacleAt(s.pos, world.obstacles);
      if ((ground || wall) && def.sticks === false) {
        // musket balls and bullets just kick up dirt
        spears.delete(s.id);
        broadcast({ t: 'spgone', id: s.id, imp: 1, pos: rnd(s.pos, 2) });
        continue;
      }
      if (ground || wall) { stickProjectile(s, t, ground); continue; }
      if (boulders.some(b => M.len(M.sub(s.pos, M.scale(b.p, R + b.r))) < b.r + 0.15)) {
        spears.delete(s.id);
        broadcast({ t: 'spgone', id: s.id, brk: def.sticks === false ? 0 : 1, imp: def.sticks === false ? 1 : 0, pos: rnd(s.pos, 2) });
        continue;
      }
      if (s.age > (def.flight || PROJECTILE.maxFlight)) { spears.delete(s.id); broadcast({ t: 'spgone', id: s.id }); }
    }
  }

  function updateStatus(pl, t) {
    if (pl.bleedUntil > t) {
      pl.bleedAcc += pl.bleedDps * DT;
      if (pl.bleedAcc >= 2) {
        const d = Math.floor(pl.bleedAcc);
        pl.bleedAcc -= d;
        damage(pl, d, { attacker: players.get(pl.bleedBy), kind: 'bleed' });
        if (!pl.alive) return;
      }
    }
    // walking onto armor with none on puts it on
    if (!pl.armor) {
      for (const a of armorDrops.values()) {
        if (M.arcDist(pl.p, a.u) < 1.4) { wearArmor(pl, a); break; }
      }
    }
    stepLoot(t, pl);
    stepBuffs(pl, t);
    const def = rangedDef();
    if (pl.ammo < def.ammo) {
      pl.regen += DT * (buffed(pl, 'quick', t) ? 2 : 1);
      if (pl.regen >= def.regen) { pl.regen = 0; pl.ammo++; sendMe(pl); }
    } else {
      pl.regen = 0;
    }
    if (pl.ammo >= def.ammo) return;
    // any stuck spear or arrow counts as one more shot of whatever you carry now
    for (const s of spears.values()) {
      if (!s.stuck || s.hgt > 3 || M.arcDist(pl.p, s.u) > PROJECTILE.pickupRadius) continue;
      spears.delete(s.id);
      pl.ammo++;
      sendMe(pl);
      broadcast({ t: 'sppick', id: s.id, by: pl.id });
      if (pl.ammo >= def.ammo) break;
    }
  }

  // ------------------------------------------------------------------ hazards
  function bounce(b, center, minArc) {
    const hit = M.pushOut(b.p, b.f, center, minArc);
    if (!hit) return;
    b.p = hit.p;
    b.f = hit.f;
    const d = M.dot(b.f, hit.n);
    if (d < 0) b.f = M.tangent(b.p, M.madd(b.f, hit.n, -2 * d));
  }

  function stepBoulders(t) {
    for (const b of boulders) {
      b.turn = M.clamp(b.turn + rand(-1, 1) * DT * 0.8, -0.35, 0.35);
      b.f = M.tangent(b.p, M.rotateAxis(b.f, b.p, b.turn * DT));
      [b.p, b.f] = M.moveOnSphere(b.p, b.f, b.f, b.speed * DT);
      for (const o of world.obstacles) bounce(b, o.u, o.r + b.r * 0.85);
      for (const o of boulders) if (o !== b) bounce(b, o.p, b.r * 2);
      for (const pl of players.values()) {
        if (!pl.alive || pl.h > b.r || t < pl.boulderCd) continue;
        if (M.arcDist(pl.p, b.p) > b.r + PLAYER.radius) continue;
        pl.boulderCd = t + 1;
        const kb = M.add(M.scale(M.tangent(pl.p, b.f), BOULDER.kb), M.scale(M.awayDir(pl.p, b.p), 5));
        damage(pl, BOULDER.dmg, { kind: 'boulder', kb, pos: M.scale(pl.p, R + 1) });
      }
    }
  }

  function launchFireball() {
    const a = rand(0, Math.PI * 2), e = rand(0.55, 1.2), sp = rand(15, 26);
    const pos = [0, R + VOLCANO.peak + 0.5, 0];
    const vel = [Math.cos(a) * Math.cos(e) * sp, Math.sin(e) * sp, Math.sin(a) * Math.cos(e) * sp];
    const hit = M.traceArc(pos, vel, null, 12, DT);
    const landU = hit ? M.norm(hit.pos) : null;
    const fb = { id: nextId++, pos, vel, landU, land: landU ? rnd(M.scale(landU, R), 2) : null };
    fireballs.set(fb.id, fb);
    broadcast({ t: 'fb', id: fb.id, pos: rnd(pos, 4), vel: rnd(vel, 4), land: fb.land });
  }

  function explode(fb) {
    fireballs.delete(fb.id);
    const u = M.norm(fb.pos);
    broadcast({ t: 'boom', id: fb.id, pos: rnd(M.scale(u, R), 2) });
    for (const pl of players.values()) {
      if (!pl.alive || pl.h > 3) continue;
      const d = M.arcDist(pl.p, u);
      if (d > VOLCANO.blast) continue;
      const k = 1 - d / VOLCANO.blast;
      damage(pl, VOLCANO.dmg * (0.4 + 0.6 * k), {
        kind: 'fire', kb: M.scale(M.awayDir(pl.p, u), VOLCANO.kb * (0.5 + k)), pos: M.scale(pl.p, R + 1),
      });
    }
  }

  function stepVolcano(t) {
    if (t >= volcano.next) {
      volcano.next = t + rand(VOLCANO.minGap, VOLCANO.maxGap);
      volcano.left = Math.floor(rand(VOLCANO.shots[0], VOLCANO.shots[1] + 1));
      volcano.nextShot = t + 1.8;
      broadcast({ t: 'erupt' });
    }
    if (volcano.left > 0 && t >= volcano.nextShot) {
      volcano.left--;
      volcano.nextShot = t + rand(0.2, 0.55);
      launchFireball();
    }
    for (const fb of fireballs.values()) {
      M.stepProjectile(fb.pos, fb.vel, DT);
      if (M.len(fb.pos) <= R) explode(fb);
    }
  }

  function stepPickups(t) {
    for (const pk of pickups) {
      if (t < pk.rerollAt) continue;
      pk.wpn = newWeapon();
      pk.rerollAt = t + rand(40, 60);
      broadcast({ t: 'pickup', id: pk.id, wpn: pk.wpn });
    }
  }

  // ------------------------------------------------------------------ bots
  function newBrain() {
    return {
      think: 0, target: 0, goal: null, strafe: 1, wander: 0, nextThrow: now() + rand(1, 3), throwAt: 0, throwTarget: 0, jumpCd: 0,
      nextSwing: 0, lagAt: 0, frozenUntil: 0,
    };
  }

  function addBot() {
    const taken = new Set([...players.values()].map(p => p.name));
    let name = C.randomCaveName();
    for (let i = 0; i < 20 && taken.has(name); i++) name = C.randomCaveName();
    return createPlayer(name, C.randomLook(), true);
  }

  function balanceBots() {
    if (coop()) return;   // in co-op the waves decide how many bots there are
    const all = [...players.values()];
    const humans = all.filter(p => !p.bot).length;
    const bots = all.filter(p => p.bot);
    const want = Math.max(0, game.bots - humans);
    while (bots.length < want) bots.push(addBot());
    while (bots.length > want) removePlayer(bots.pop().id);
  }

  function botAim(b, tg) {
    const def = rangedDef();
    const lvl = botLevel();
    const pos = M.madd(M.scale(b.p, R + b.h + 1.6), b.f, 0.3);
    const dist = M.arcDist(b.p, tg.p);
    const wobble = randIn(lvl.wobble) + (def.spread || 0);
    if (def.hitscan) {
      // straight line at the chest, give or take the bot's shaky hands
      const chest = M.scale(tg.p, R + tg.h + 1.1);
      let dir = M.norm(M.sub(chest, pos));
      dir = M.rotateAxis(dir, b.p, rand(-wobble, wobble));
      dir = M.rotateAxis(dir, M.norm(M.cross(b.p, dir)), rand(-wobble, wobble) * 0.6);
      return { pos, vel: dir };
    }
    const speed = M.clamp(def.minSpeed + dist * ((def.maxSpeed - def.minSpeed) / 40), def.minSpeed, def.maxSpeed);
    const flight = dist / (speed * 0.8);
    const aimP = M.norm(M.madd(tg.p, tg.vel, (flight * lvl.lead) / R));
    const chest = M.scale(aimP, R + tg.h + 1.1);
    const to = M.towardDir(b.p, aimP);
    // sample each trial arc roughly every 1.2 units, so fast bullets don't skip past the target
    const dt = M.clamp(1.2 / speed, 1 / 240, 1 / 30);
    const maxT = Math.min(4, def.flight || 4);
    let best = null, bestErr = Infinity;
    for (let e = -0.15; e < 1.0; e += speed > 50 ? 0.02 : 0.04) {
      const vel = M.scale(M.add(M.scale(to, Math.cos(e)), M.scale(b.p, Math.sin(e))), speed);
      let err = Infinity;
      M.traceArc(pos, vel, world.obstacles, maxT, dt, p => {
        const dx = p[0] - chest[0], dy = p[1] - chest[1], dz = p[2] - chest[2];
        const d = Math.sqrt(dx * dx + dy * dy + dz * dz);
        if (d < err) err = d;
        return d > err + 3;   // flying away from the target again: this arc is done
      });
      if (err < bestErr) { bestErr = err; best = vel; }
      if (speed > 50 && e > 0.3) break;   // flat shooters never need a high lob
    }
    if (!best || bestErr > 4) return null;
    let vel = M.rotateAxis(best, b.p, rand(-wobble, wobble));
    vel = M.rotateAxis(vel, M.norm(M.cross(b.p, to)), rand(-wobble, wobble) * 0.6);
    return { pos, vel };
  }

  function avoidHazards(b, move, lvl) {
    let m = move ? M.tangent(b.p, move) : [0, 0, 0];
    for (const bo of boulders) {
      const d = M.arcDist(b.p, bo.p);
      if (d > 9 || M.dot(bo.f, M.towardDir(bo.p, b.p)) < 0.4) continue;
      const side = M.cross(bo.f, bo.p);
      const sgn = M.dot(side, M.sub(b.p, bo.p)) >= 0 ? 1 : -1;
      m = M.madd(m, M.tangent(b.p, M.scale(side, sgn)), 2.5 * lvl.dodge);
      if (d < 3 && b.h === 0 && Math.random() < 0.05 * lvl.dodge) b.vh = PLAYER.jumpVel;
    }
    for (const fb of fireballs.values()) {
      if (fb.landU && M.arcDist(b.p, fb.landU) < VOLCANO.blast + 1.5) m = M.madd(m, M.awayDir(b.p, fb.landU), 3 * lvl.dodge);
    }
    if (move) {
      for (const o of world.obstacles) {
        if (M.arcDist(b.p, o.u) - o.r > 2.5) continue;
        const to = M.towardDir(b.p, o.u);
        const ahead = M.dot(to, m);
        if (ahead <= 0) continue;
        const side = M.cross(to, b.p);
        m = M.madd(m, side, (M.dot(side, m) >= 0 ? 1.5 : -1.5) * ahead);
      }
    }
    return M.len(m) > 1e-4 ? m : null;
  }

  // Smarter bots walk over to armor (and swap junk weapons at totems) when nothing's in their face.
  // Hurt ones go eat at a campfire first; any of them will grab a mushroom that's close.
  function botGearGoal(b, lvl) {
    if (!lvl.gear) return null;
    const t = now();
    if (b.hp < 55) {
      let fire = null, fd = lvl.gear * 1.5;
      for (const f of fires) {
        const d = M.arcDist(b.p, f.u);
        if (t >= f.readyAt && d < fd) { fd = d; fire = f; }
      }
      if (fire) return { u: fire.u, grab: true };
    }
    let goal = null, bestD = lvl.gear;
    if (!b.armor) {
      for (const a of armorDrops.values()) {
        const d = M.arcDist(b.p, a.u);
        if (d < bestD) { bestD = d; goal = { u: a.u, grab: false }; }
      }
    }
    if (!goal && b.weapon.tier === 'junk') {
      for (const pk of pickups) {
        const d = M.arcDist(b.p, pk.u);
        if (d < bestD && pk.wpn.tier !== 'junk') { bestD = d; goal = { u: pk.u, grab: true }; }
      }
      for (const l of loot.values()) {
        const d = M.arcDist(b.p, l.u);
        if (l.wpn && l.wpn.tier !== 'junk' && d < bestD) { bestD = d; goal = { u: l.u, grab: true }; }
      }
    }
    if (!goal) {
      for (const s of shrooms.values()) {
        const d = M.arcDist(b.p, s.u);
        if (d < Math.min(bestD, 15)) { bestD = d; goal = { u: s.u, grab: false }; }
      }
    }
    // out of ammo: a fallen caveman's pouch is worth the walk
    if (!goal && b.ammo === 0) {
      for (const l of loot.values()) {
        const d = M.arcDist(b.p, l.u);
        if (l.ammo && d < bestD) { bestD = d; goal = { u: l.u, grab: false }; }
      }
    }
    return goal;
  }

  // Level 9-10 bots swing at projectiles about to hit them, batting them back.
  function botTryDeflect(b, t) {
    if (t - b.lastSwing < b.weapon.cd) return false;
    const chest = M.scale(b.p, R + b.h + 1.3);
    for (const s of spears.values()) {
      if (s.stuck || s.owner === b.id || C.RANGED[s.w].sticks === false) continue;
      const off = M.sub(chest, s.pos);
      const d = M.len(off);
      if (d > 3.5 || M.dot(s.vel, off) <= 0) continue;
      b.f = M.towardDir(b.p, M.norm(s.pos));
      return startSwing(b, t);
    }
    return false;
  }

  // Low-level bots "lag": every so often they stand frozen for a moment, like a caveman whose
  // connection dropped. Returns true while frozen.
  function botLagSpike(ai, lvl, t) {
    if (!lvl.lag) return false;
    if (!ai.lagAt) ai.lagAt = t + randIn(lvl.lag.every);
    if (t >= ai.lagAt) {
      ai.frozenUntil = t + randIn(lvl.lag.freeze);
      ai.lagAt = ai.frozenUntil + randIn(lvl.lag.every);
    }
    return t < ai.frozenUntil;
  }

  function botThink(b, t) {
    const ai = b.ai;
    const lvl = botLevel();
    const stunned = t < b.stunUntil;
    const frozen = botLagSpike(ai, lvl, t);
    // a bot holding a beast lets it out as soon as the last one is gone
    if (b.reward && fighting() && !beasts.has(b.beastId)) summonBeast(b, t);
    if (!frozen && (ai.think -= DT) <= 0) {
      ai.think = randIn(lvl.think);
      // dim bots sometimes forget there's a fight and just go for a walk
      const daydream = Math.random() < lvl.daydream;
      let best = null, bestD = lvl.chase;
      for (const pl of players.values()) {
        if (daydream || pl === b || !pl.alive || allies(b, pl)) continue;
        const d = M.arcDist(b.p, pl.p) * (pl.bot ? 1.15 : 1);
        if (d < bestD) { bestD = d; best = pl; }
      }
      ai.target = best ? best.id : 0;
      ai.goal = bestD > 12 || !best ? botGearGoal(b, lvl) : null;
      if (Math.random() < 0.25) ai.strafe = -ai.strafe;
      const chatty = game.phase === 'doom' ? 0.35 : fighting() ? 0.015 : 0.08;   // the end of the world makes everyone yell
      if (Math.random() < chatty) emote(b, Math.floor(Math.random() * C.EMOTES.length), t);
    }

    const def = rangedDef();
    // when the world ends, bots forget the fight and run around in circles
    const target = game.phase === 'play' ? players.get(ai.target) : null;
    if (game.phase === 'doom') ai.goal = null;
    let move = null, face = null;
    if (frozen) {
      // stuck mid-step: no moving, turning or attacking; a throw being aimed waits too
      if (ai.throwAt) ai.throwAt += DT;
    } else if (ai.goal) {
      move = M.towardDir(b.p, ai.goal.u);
      if (M.arcDist(b.p, ai.goal.u) < 1.8) {
        if (ai.goal.grab) tryGrab(b, t);
        ai.goal = null;
      }
    } else if (target && target.alive) {
      const dist = M.arcDist(b.p, target.p);
      const to = M.towardDir(b.p, target.p);
      const side = M.cross(to, b.p);
      const reach = b.weapon.range + PLAYER.radius;
      face = to;
      if (dist < reach + 4 || b.ammo === 0) {
        move = to;
        if (dist < reach * 0.9) {
          move = M.madd(M.scale(to, 0.2), side, ai.strafe * 0.6);
          // slow bots stand there a while between swings
          if (t >= ai.nextSwing && startSwing(b, t)) ai.nextSwing = t + randIn(lvl.swingRest);
        }
      } else if (dist > 26) move = to;
      else if (dist < 10) move = M.madd(M.scale(to, -0.8), side, ai.strafe);
      else move = M.madd(M.scale(to, 0.15), side, ai.strafe);
      if (b.ammo > 0 && !ai.throwAt && t >= ai.nextThrow && dist > reach + 2 && dist < 45) {
        ai.throwAt = t + lvl.windup * (def.chargeTime / 0.9);
        ai.throwTarget = target.id;
      }
    } else {
      ai.wander = M.clamp(ai.wander + rand(-1, 1) * DT * 3, -0.8, 0.8);
      b.f = M.tangent(b.p, M.rotateAxis(b.f, b.p, ai.wander * DT));
      move = b.f;
    }

    if (lvl.deflect && fighting() && !stunned) botTryDeflect(b, t);

    b.charging = !!ai.throwAt;
    if (!frozen && ai.throwAt && t >= ai.throwAt) {
      const tg = players.get(ai.throwTarget);
      ai.throwAt = 0;
      ai.nextThrow = t + randIn(lvl.throwGap) * def.botPace;
      const shot = tg && tg.alive && b.ammo > 0 && !stunned && fighting() ? botAim(b, tg) : null;
      if (shot) {
        b.lastThrow = t;
        if (def.hitscan) zap(b, shot.pos, shot.vel);
        else throwProjectile(b, shot.pos, shot.vel, null);
        // automatic weapons keep the trigger down for a short burst
        if (def.auto) {
          if (ai.burst === undefined || ai.burst <= 0) ai.burst = Math.round(randIn(def.burst)) - 1;
          else ai.burst--;
          if (ai.burst > 0 && b.ammo > 0) {
            ai.throwAt = t + def.cooldown * 1.15;
            ai.throwTarget = tg.id;
          }
        }
      }
    }

    move = stunned || frozen ? null : avoidHazards(b, move, lvl);
    const slow = t < b.slowUntil ? 0.55 : 1;
    // stutter: alternate a double-speed step with a dead stop, four times a second
    const jerk = lvl.lag?.stutter ? (((t * 4 + b.id * 0.37) % 1) < 0.5 ? 2 : 0) : 1;
    const zoom = buffed(b, 'fast', t) ? C.BUFF.fast : 1;
    const speed = PLAYER.speed * (b.weapon.speed + (b.armor?.speed || 0)) * lvl.speed * slow * jerk * zoom * (b.charging ? 0.6 : 1);
    let disp = move ? M.scale(M.tangent(b.p, move), speed * DT) : [0, 0, 0];
    disp = M.madd(disp, b.kbv, DT);
    b.kbv = M.scale(b.kbv, Math.exp(-DT * 5));
    const prev = b.p;
    const dl = M.len(disp);
    if (dl > 1e-6) [b.p, b.f] = M.moveOnSphere(b.p, b.f, M.scale(disp, 1 / dl), dl);
    [b.p, b.f] = M.collideObstacles(b.p, b.f, world.obstacles, PLAYER.radius);
    for (const bo of boulders) {
      if (b.h > bo.r) continue;
      const hit = M.pushOut(b.p, b.f, bo.p, bo.r + PLAYER.radius);
      if (hit) { b.p = hit.p; b.f = hit.f; }
    }

    const want = face || (move && dl > 1e-4 ? move : null);
    if (want) {
      const k = 1 - Math.exp(-DT * 10);
      b.f = M.tangent(b.p, M.add(M.scale(b.f, 1 - k), M.scale(M.tangent(b.p, want), k)));
    }

    if (!frozen && b.h <= 0 && b.vh <= 0 && t > ai.jumpCd && Math.random() < 0.004) { b.vh = PLAYER.jumpVel * (buffed(b, 'bouncy', t) ? C.BUFF.bouncy : 1); ai.jumpCd = t + 2; }
    b.vh -= PLAYER.gravity * DT;
    b.h += b.vh * DT;
    if (b.h <= 0) { b.h = 0; b.vh = 0; }
    b.vel = M.scale(M.sub(b.p, prev), R / DT);
  }

  // ------------------------------------------------------------------ main loop
  let tickCount = 0;

  function snapshot(t) {
    const p = [];
    for (const pl of players.values()) {
      const flags = (pl.alive ? 1 : 0) | (pl.charging ? 2 : 0) | (t < pl.stunUntil ? 4 : 0)
        | (t < pl.slowUntil ? 8 : 0) | (t < pl.bleedUntil ? 16 : 0) | (pl.ammo << 5);
      p.push([pl.id, ...rnd(pl.p, 4), ...rnd(pl.f, 3), Math.round(pl.h * 100) / 100, pl.hp, flags]);
    }
    const b = boulders.map(bo => [bo.id, ...rnd(bo.p, 4), ...rnd(bo.f, 3)]);
    const bs = [...beasts.values()].map(be => [be.id, ...rnd(be.p, 4), ...rnd(be.f, 3), Math.round(be.h * 100) / 100, Math.round(be.hp), be.moving ? 1 : 0]);
    // ts (server ms) lets clients interpolate on the server's timeline instead of arrival time,
    // which absorbs internet jitter
    broadcast({ t: 's', ts: Math.round(t * 1000), p, b, bs });
  }

  function tick() {
    const t = now();
    tickCount++;
    stepGame(t);
    for (const pl of players.values()) {
      if (!pl.alive) {
        // nobody climbs out of the rubble mid-apocalypse; the new round wakes everyone
        if (t >= pl.respawnAt && game.phase === 'play') spawnPlayer(pl);
        continue;
      }
      if (pl.bot) botThink(pl, t);
      updateStatus(pl, t);
      recordHistory(pl, t);
    }
    resolveSwings(t);
    batProjectiles(t);
    stepProjectiles(t);
    stepBeasts(t);
    stepFood(t);
    expireLoot(t);
    stepBoulders(t);
    stepVolcano(t);
    stepPickups(t);
    stepArmor(t);
    if (tickCount % C.SNAP_EVERY === 0) snapshot(t);
    if (tickCount % (C.TICK_HZ * 5) === 0) broadcastGame();    // keeps everyone's era clocks honest
  }

  // ------------------------------------------------------------------ sockets in and out
  function attach(client) {
    clients.add(client);
    welcome(client);
  }

  // rebalance: false while the server shuts down (no point refilling bots then)
  function detach(client, rebalance = true) {
    clients.delete(client);
    if (client.pid) removePlayer(client.pid);
    client.pid = 0;
    if (rebalance) balanceBots();
  }

  function stats() {
    const humans = humanCount();
    return {
      humans, bots: players.size - humans, sockets: clients.size, projectiles: spears.size,
      mode: game.mode, era: C.ERAS[game.era].id, phase: game.phase, botLevel: game.botLevel, botBrains: botLevel().name,
    };
  }

  balanceBots();
  return { code, clients, attach, detach, handleMessage, tick, stats };
}
