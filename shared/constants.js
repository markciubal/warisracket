// Shared tuning, weapon tables and caveman flavor. Imported by both server and browser.

// Planet radius. It grows when peace breaks out in Ploughshares, so it's a live binding: import it
// by name (`import { R }`), never copy it out (`const { R } = C` would freeze it).
export let R = 30;
export const PLANET_R = 30;          // the usual size, for every new round
export function setPlanetRadius(r) { R = r; }
export const TICK_HZ = 60;           // server simulation rate
export const SNAP_EVERY = 3;         // ticks per snapshot (20 Hz)
export const GRAVITY = 20;           // pull toward planet center for spears, arrows & lava bombs

export const PLAYER = {
  radius: 0.6,
  speed: 8,
  jumpVel: 8.5,
  gravity: 24,
  maxHp: 100,
  respawn: 4,
};

// What every thrown or shot thing shares.
export const PROJECTILE = {
  selfGrace: 0.45,     // seconds before your own projectile can hit you
  maxFlight: 9.5,      // long enough for a flat ~25 u/s throw to orbit once (~8 s) and come back
  stuckLife: 30,
  pickupRadius: 1.7,
};

// Ranged weapons. Charge 0..1 maps onto minSpeed..maxSpeed and damage scales with speed.
// lift: radians of loft added on top of the camera aim. botPace scales how often bots shoot.
// auto: fires while the button is held. hitscan: instant straight beam out to `range`.
// sticks: false means it vanishes on impact instead of lying around to be picked up.
// flight: seconds before a miss is cleaned up. burst: shots per bot volley. spread: radians.
// peace: only from a Ploughshares range shed, never in a war. blast: goes off where it lands,
// rattling every target within this far. splat: splats on whatever it hits.
export const RANGED = {
  spear:   { name: 'Spear',      proj: 'spear',  ammo: 3,  regen: 5,    chargeTime: 0.9,  minSpeed: 13, maxSpeed: 31, minDmg: 28, maxDmg: 60, headMult: 1.5,  hitRadius: 0.65, lift: 0.5,  cooldown: 0.35, botPace: 1,
    hint: 'HOLD RMB · THROW SPEAR' },
  bow:     { name: 'Bow',        proj: 'arrow',  ammo: 6,  regen: 2.6,  chargeTime: 0.65, minSpeed: 20, maxSpeed: 44, minDmg: 15, maxDmg: 34, headMult: 1.75, hitRadius: 0.55, lift: 0.36, cooldown: 0.3,  botPace: 0.6,
    hint: 'HOLD RMB · LOOSE ARROW' },
  longbow: { name: 'Longbow',    proj: 'arrow',  ammo: 8,  regen: 2.2,  chargeTime: 0.8,  minSpeed: 24, maxSpeed: 52, minDmg: 20, maxDmg: 44, headMult: 1.75, hitRadius: 0.55, lift: 0.33, cooldown: 0.3,  botPace: 0.6,
    hint: 'HOLD RMB · LOOSE ARROW (LONGBOW)' },
  musket:  { name: 'Boom Stick', proj: 'ball',   ammo: 1,  regen: 2.4,  chargeTime: 0.35, minSpeed: 75, maxSpeed: 75, minDmg: 62, maxDmg: 62, headMult: 1.6,  hitRadius: 0.5,  lift: 0.04, cooldown: 0.5,  botPace: 0.8,
    sticks: false, flight: 2.5, hint: 'HOLD RMB · AIM · LET GO · BOOM' },
  gun:     { name: 'Bang Stick', proj: 'bullet', ammo: 24, regen: 0.16, chargeTime: 0,    minSpeed: 95, maxSpeed: 95, minDmg: 11, maxDmg: 11, headMult: 2,    hitRadius: 0.45, lift: 0.02, cooldown: 0.11, botPace: 0.5,
    sticks: false, flight: 1.5, auto: true, spread: 0.018, burst: [4, 8], hint: 'HOLD RMB · BANG BANG BANG' },
  laser:   { name: 'Zap Stick',  proj: 'laser',  ammo: 14, regen: 0.3,  chargeTime: 0,    minSpeed: 0,  maxSpeed: 0,  minDmg: 20, maxDmg: 20, headMult: 1.75, hitRadius: 0.5,  lift: 0,    cooldown: 0.16, botPace: 0.4,
    hitscan: true, range: 60, auto: true, burst: [3, 6], hint: 'HOLD RMB · ZAP ZAP' },
  // only at the range shed, in peace
  slingshot: { name: 'Slingshot', proj: 'pebble', ammo: 5, regen: 1.2,  chargeTime: 0.5,  minSpeed: 18, maxSpeed: 38, minDmg: 6,  maxDmg: 12, headMult: 1.5,  hitRadius: 0.4,  lift: 0.22, cooldown: 0.3,  botPace: 0.6,
    sticks: false, flight: 3, peace: true, hint: 'HOLD RMB · PULL · LET GO · PING' },
  crossbow:  { name: 'Crossbow',  proj: 'arrow',  ammo: 1, regen: 1.1,  chargeTime: 0,    minSpeed: 62, maxSpeed: 62, minDmg: 40, maxDmg: 40, headMult: 1.75, hitRadius: 0.5,  lift: 0.06, cooldown: 0.9,  botPace: 0.8,
    peace: true, hint: 'RMB · THWACK' },
  tomato:    { name: 'Tomatoes',  proj: 'tomato', ammo: 4, regen: 1.5,  chargeTime: 0.6,  minSpeed: 10, maxSpeed: 24, minDmg: 1,  maxDmg: 3,  headMult: 1,    hitRadius: 0.5,  lift: 0.45, cooldown: 0.4,  botPace: 0.7,
    sticks: false, flight: 4, splat: true, peace: true, hint: 'HOLD RMB · LOB · SPLAT' },
  bazooka:   { name: 'Bazooka',   proj: 'rocket', ammo: 1, regen: 3,    chargeTime: 0,    minSpeed: 40, maxSpeed: 40, minDmg: 80, maxDmg: 80, headMult: 1,    hitRadius: 0.6,  lift: 0.05, cooldown: 1,    botPace: 1.2,
    sticks: false, flight: 2.5, blast: 3.5, peace: true, hint: 'RMB · ROCKET · BOOM' },
};

// The range shed's rack (Ploughshares): every age's ranged weapon, and the ones you only get there.
export const PRACTICE_WEAPONS = ['spear', 'bow', 'longbow', 'musket', 'gun', 'laser', 'slingshot', 'crossbow', 'tomato', 'bazooka'];

// ---------------------------------------------------------------- War mode eras
// In War mode a round walks through these in order; Forever Stone stays in the first.
// regear: when it begins, a new melee weapon from the era's pool lands at every caveman's feet
// (they keep their own unless they take it; bots just swap).
// After the last one a random natural disaster (DISASTERS below) ends the round.
export const ERAS = [
  { id: 'stone',  name: 'STONE AGE',       sub: 'ROCK. STICK. SPEAR. OOGA.',                    ranged: 'spear',   melee: 'primitive', armor: ['hide'] },
  { id: 'bow',    name: 'BENDY STICK AGE', sub: 'OOGA INVENT BOW! POINTY GO FAST!',             ranged: 'bow',     melee: 'primitive', armor: ['hide', 'bone'] },
  { id: 'sword',  name: 'SHINY ROCK AGE',  sub: 'BRONZE! SWORD FOR EVERYBODY!',                 ranged: 'longbow', melee: 'sword',     armor: ['bone', 'bronze'], regear: true },
  { id: 'musket', name: 'BOOM STICK AGE',  sub: 'OOGA FIND BOOM POWDER! ONE SHOT. BIG SMOKE.',  ranged: 'musket',  melee: 'sword',     armor: ['bronze', 'steel'] },
  { id: 'gun',    name: 'BANG BANG AGE',   sub: 'MANY BANG! SO LOUD! OOGA EARS HURT!',          ranged: 'gun',     melee: 'sword',     armor: ['steel', 'kevlar'] },
  { id: 'laser',  name: 'ZAP AGE',         sub: 'LIGHT HURT NOW! GLOW STICK FOR EVERYBODY!',    ranged: 'laser',   melee: 'future',    armor: ['kevlar', 'power'], regear: true },
];

// The finale: one of these, picked at random (never the same twice in a row), ends the world.
// `strikes` land on red rings between `first` and `last` seconds and get anyone within `blast`.
// A `wave` sweeps across the planet from a random point between its start and end seconds.
// At `final` seconds the big one gets everybody; the round ends at `duration`.
// kill: death feed line, finale: banner when the big one hits.
export const DISASTERS = {
  meteor: {
    name: 'BIG ROCK FROM SKY', icon: '☄', sub: 'SKY FALLING. FOR REAL THIS TIME.',
    strikes: 7, first: 2.5, last: 6.5, blast: 8, final: 9, duration: 11.5,
    kill: 'SKY ROCK SQUISH', finale: 'SPLAT.',
  },
  volcano: {
    name: 'MOUNTAIN GO BOOM', icon: '🌋', sub: 'MOUNTAIN TOO ANGRY. MOUNTAIN EXPLODE.',
    strikes: 10, first: 2, last: 7, blast: 6, final: 9, duration: 11.5,
    kill: 'MOUNTAIN COOK', finale: 'KABOOM.',
  },
  flood: {
    name: 'BIG WATER', icon: '🌊', sub: 'WATER COME. OOGA NO CAN SWIM. RUN!',
    wave: { start: 1.5, end: 9 }, final: 9.2, duration: 11.5,
    kill: 'BIG WATER SWALLOW', finale: 'BLUB.',
  },
  freeze: {
    name: 'BIG COLD', icon: '❄', sub: 'SUN GO AWAY. ICE FALL FROM SKY.',
    strikes: 8, first: 2, last: 7, blast: 5, final: 9, duration: 11.5,
    kill: 'BIG COLD FREEZE', finale: 'CRACK.',
  },
};

// How far (radians from where it started) a sweeping disaster has spread `el` seconds in.
export const waveAngle = (wave, el) => Math.PI * Math.min(1, Math.max(0, (el - wave.start) / (wave.end - wave.start)));

export const DOTIME = {
  eraSeconds: 45,        // length of every age; override with the ERA_SECONDS config var
  endSeconds: 12,        // victory screen between rounds
  armorEvery: [14, 24],  // seconds between armor drops (shrinks with the ages too, down to 1/4)
  armorMax: 3,           // drops on the ground at once (+1 per 4 humans)
  armorLife: 60,
};

export const MODES = { dotime: 'WAR MODE', plough: 'PEACE MODE', classic: 'FOREVER STONE', coop: 'TRIBE VS BOTS' };

// Peace mode (the 'plough' mode: swords into ploughshares): no war at all. Every round starts in
// peace: weapons are hoes, nobody can die, and the tribe farms (plant, harvest into a shared food
// store) and builds with the food. The planet grows and the whole town opens up straight away
// (SHOPS: doctor, ranges, duel ring, tailor, haunted hollow, fishing pond, hot spring, bonfire).
// When the farming time runs out everyone votes to keep going; otherwise the round ends with a
// harvest festival and a fresh peace on a new planet.
export const PEACE = {
  seconds: 180,       // peace before each vote (PEACE_SECONDS / --peace-seconds to change)
  voteSeconds: 15,
  grudge: 25,         // seconds a bot fights back against whoever hurt it
  plantCd: 0.4,       // seconds between plantings
  plantReach: 1.4,    // seeds go this far in front of you
  cropGap: 0.9,       // closest two crops can be
  cropMax: 90,        // on the whole planet
  harvestRadius: 1.1, // walk this close to a ripe crop to pick it
  // The planet grows to make room for a town, and shops open one by one (SHOP_OPENINGS). Every
  // vote to keep farming grows it again (growStep, up to maxR), with more opening on the new ground
  // (EXPANSION_OPENINGS).
  grownR: 40,
  growStep: 10,
  maxR: 80,
  growSeconds: 12,
  startGrow: 5,       // ...but at the start of a round it's quick, so the town is open in seconds
  // Shells are the money: everyone gets a few when peace breaks out, and earns more picking crops
  // (one a crop), hitting targets and winning duels.
  startShells: 3,
  maxShells: 99,
  // Nobody dies in peace, but the volcano, boulders and sky rocks still hurt (down to 1 HP), and
  // below limpHp you walk slow until the doctor fixes you up.
  limpHp: 40,
  limp: 0.7,
  skyRockEvery: [16, 30],   // seconds between sky rocks
  skyRockWarn: 2.4,         // seconds from the warning ring to the impact
  // Nobody dies in peace, but a monster, a sky rock or the volcano can knock you out: you sleep
  // where you fell, and get up there, good as new, this many seconds later (out of the dark
  // forest, if that's where it happened: just past its edge, the nearest way out). Knocked down to
  // 1 in a duel, a stranger turns up with food (STRANGER).
  sleep: 10,
};

// Kind strangers of the peace: one walks over from somewhere nearby, hands the caveman a duel left
// at 1 HP some food (food: life back) and wanders off again. from: how far away they appear. giveUp: seconds of
// chasing someone who won't stand still before they just catch up. leave: seconds walking away.
export const STRANGER = {
  speed: 9.5, from: [13, 18], giveUp: 25, food: 60, leave: 4,
  // (in words of one beat, like all talk in peace: see shared/chat.js)
  lines: ['YOU LOOK WEAK, FRIEND. EAT.', 'HERE. EAT.', 'I HAVE SOME TO SPARE.', 'NO SHELLS. JUST EAT.', 'FOOD IS FOR ALL.'],
};

// The town that grows in a long peace. r: how much ground the building takes (and blocks).
// zone: stand this close (to the shop, or inside the ring) to use it.
//   doctor: E pays `fee` shells to heal to full.
//   range:  E at the shed picks a practice weapon (PRACTICE_WEAPONS), any age's or one you only
//           get there; you keep it, and can shoot it anywhere in peace, until you hand it back at
//           the shed. Targets downrange pay a shell a hit (each one at most once every payGap
//           seconds), and spears and arrows stick in them.
//   duel:   a ring where you can bonk each other (pick any weapon off the rack, DUEL_WEAPONS), but
//           nobody goes below 1 HP; knocking someone down to 1 wins the bout.
//   tailor: E to buy hats and capes (CLOTHES).
//   haunt:  the DARK FOREST, one a round, on the far side of the planet from everybody. Fully
//           grown it covers about half the planet: `reach` (an angle) out from its middle, its
//           edge wandering in and out by `wobble` of that (Perlin noise: a new shape every round)
//           and pulled in toward the poles by `poles` (shared/forest.js). It starts `startRings`
//           rings deep and grows a ring every `spreadEvery` seconds to all FOREST_TIERS.length.
//           Monsters (BEASTS with monster: true) live in it, each kind in its own ring, the worst
//           at the heart (FOREST_TIERS). Your hoe is a torch in there; a slain monster pays its
//           ring's reward, and another comes `respawn` seconds later. Round its edge, `penumbra`
//           wide, is the PENUMBRA: E there to pick a melee weapon (any on the duel ring's rack)
//           and a ranged one (any in a range shed) to take in, and keep.
//   pond:   fishing. The water (r) is solid; stand on the bank (zone) and E casts. A fish bites
//           some time in `wait` seconds later: E within `window` seconds hooks it (FISH), too
//           soon scares it off, too late and it gets away. Then it has to be reeled in, tap after
//           tap, each kind its own way (REELS); `giveUp` seconds and it's off.
//   spring: a hot spring to soak in: `heal` life every `every` seconds while you stand in it.
//   bonfire: a dance circle round a big fire (r is the fire). E dances (moving stops); each
//           dancer earns a shell every `every` seconds alone, quicker the more dance together
//           (divided by the dancers, up to `crowd` of them). Two drums stand round the edge (at
//           angles `drums` round from its front, `drumAt` in from the edge): E within `drumReach`
//           of one plays them (a big BOOM and a small TAK), and drummers earn like dancers.
export const SHOPS = {
  doctor:  { name: 'DOCTOR',       r: 1.7, zone: 3.6, fee: 1 },
  range:   { name: 'TARGET RANGE', r: 1.0, zone: 3.2, targets: 3, downrange: 9, spread: 2.6, targetR: 0.75, targetH: 1.35, payGap: 1 },
  duel:    { name: 'DUEL RING',    r: 0,   zone: 5.5, win: 3 },
  tailor:  { name: 'TAILOR',       r: 1.7, zone: 3.6 },
  haunt:   { name: 'DARK FOREST',  r: 0, reach: 0.62 * Math.PI, wobble: 0.16, poles: 0.42, startRings: 2, spreadEvery: 60, respawn: 8, penumbra: 3.5 },
  pond:    { name: 'FISHING POND', r: 2.3, zone: 4.2, wait: [2.5, 7], window: 1.1, giveUp: 30 },
  spring:  { name: 'HOT SPRING',   r: 0,   zone: 3.0, heal: 3, every: 1 },
  bonfire: { name: 'BONFIRE',      r: 0.9, zone: 4.6, every: 8, crowd: 5, drums: [1.2, 4.3], drumAt: 1.1, drumReach: 1.9 },
};
// Shops whose zone is ground you walk on (a ring, a forest, a bank, a pool, a dance circle):
// nothing gets planted or built on it.
export const AREA_SHOPS = new Set(['duel', 'haunt', 'pond', 'spring', 'bonfire']);
// [kind, seconds after the planet has finished growing]: the whole town, all at once
// (the forest first, on the far side, to claim the half of the planet it'll spread over)
export const SHOP_OPENINGS = [['haunt', 0], ['doctor', 0.3], ['range', 0.6], ['duel', 1], ['tailor', 1.5], ['pond', 2], ['spring', 2.5], ['bonfire', 3], ['range', 6], ['pond', 9]];
// ...and after each later growth spurt, on the new ground (the forest just spreads further)
export const EXPANSION_OPENINGS = [['pond', 3], ['doctor', 9], ['bonfire', 14], ['spring', 20]];
// The dark forest's rings, from the edge in: who lives in each (so many at once: it's a big
// forest) and what each one slain pays. The heart is the deepest ring it has spread to so far: as
// it spreads, the skeletons move out to the new edge and something worse moves into the middle.
export const FOREST_TIERS = [
  { name: 'SKELETONS AND ZOMBIES', kinds: ['skeleton', 'zombie'], count: 10, reward: 2 },
  { name: 'GHOSTS AND BATS', kinds: ['ghost', 'bat'], count: 8, reward: 3 },
  { name: 'VAMPIRES AND SLEEP DEMONS', kinds: ['vampire', 'demon'], count: 5, reward: 5 },
  { name: 'WEREWOLVES', kinds: ['werewolf'], count: 2, reward: 10 },
];
// How hard the dark forest's monsters are (a planet rule, for peace mode: MONSTERS), from none at
// all to a nightmare. Each scales the monsters' numbers (count: of each ring's FOREST_TIERS.count),
// their life, the blows they land, how fast they go and how far off they notice you (sense); and
// what each one slain pays (pay: of its ring's reward, never under 1).
export const MONSTER_LEVELS = [
  { name: 'NONE', desc: 'NO MONSTERS AT ALL. A QUIET WALK IN THE WOODS.', count: 0, hp: 1, dmg: 1, speed: 1, sense: 1, pay: 1 },
  { name: 'SLEEPY', desc: 'A FEW, SLOW AND SOFT. GOOD FOR LITTLE CAVE KIDS.', count: 0.5, hp: 0.5, dmg: 0.4, speed: 0.75, sense: 0.7, pay: 0.5 },
  { name: 'SPOOKY', desc: 'A BIT LESS OF EVERYTHING.', count: 0.75, hp: 0.75, dmg: 0.7, speed: 0.9, sense: 0.85, pay: 0.75 },
  { name: 'SCARY', desc: 'AS THEY COME.', count: 1, hp: 1, dmg: 1, speed: 1, sense: 1, pay: 1 },
  { name: 'NASTY', desc: 'MORE OF THEM, TOUGHER, HIT HARDER, QUICKER. PAY MORE.', count: 1.3, hp: 1.5, dmg: 1.35, speed: 1.12, sense: 1.25, pay: 1.5 },
  { name: 'NIGHTMARE', desc: 'RUN. (PAY DOUBLE, IF YOU LIVE.)', count: 1.6, hp: 2.2, dmg: 1.8, speed: 1.25, sense: 1.5, pay: 2 },
];
export const MONSTER_LEVEL_DEFAULT = 3;

// Motes: what a slain forest monster sometimes leaves behind, a glowing wisp to walk into.
// chance: of one, by the monster's ring (edge .. heart); gold: of those, how many are gold.
// Offensive (side 'off') and defensive ('def') ones give a buff for a while (buff: a SHROOMS
// buff, the same as the mushrooms'); gold ones are kept for good (perm: how much each one adds,
// up to `max` of them) for as long as you're on the rock, and count in peace mode. life: seconds
// one lies there before it fades. reach: how close to walk to take it.
export const MOTES = {
  chance: [0.35, 0.5, 0.7, 1],
  gold: [0.04, 0.06, 0.12, 0.3],
  life: 30,
  reach: 1.3,
  kinds: {
    fury:  { name: 'FURY MOTE',  side: 'off', color: '#ff4a3a', buff: 'strong', secs: 20 },
    swift: { name: 'SWIFT MOTE', side: 'off', color: '#ff9a2a', buff: 'quick', secs: 20 },
    ward:  { name: 'WARD MOTE',  side: 'def', color: '#4aa8ff', buff: 'tough', secs: 20 },
    mend:  { name: 'MEND MOTE',  side: 'def', color: '#5ef08a', buff: 'regrow', secs: 10 },
    might: { name: 'GOLD MIGHT', side: 'off', color: '#ffd34d', perm: 0.06, max: 5, desc: 'HIT 6% HARDER, FOR GOOD' },
    hide:  { name: 'GOLD HIDE',  side: 'def', color: '#ffe9a8', perm: 0.06, max: 5, desc: 'TAKE 6% LESS, FOR GOOD' },
  },
};

// What bites at the pond. w: how often (out of all of them). shells: what it's worth. food: what
// it adds to the tribe's store. reel: how it has to be reeled in (REELS), and how: what the
// screen says about it once it's hooked.
export const FISH = {
  minnow: { name: 'MINNOW',      w: 40, shells: 1,  food: 1, reel: 'quick',   how: 'A TIDDLER! A FEW TAPS' },
  trout:  { name: 'TROUT',       w: 28, shells: 2,  food: 2, reel: 'steady',  how: 'STEADY TAPS. NOT TOO FAST!' },
  pike:   { name: 'BIG PIKE',    w: 16, shells: 3,  food: 4, reel: 'fighter', how: 'A FIGHTER! REEL WHEN IT TIRES, WAIT WHEN IT PULLS' },
  golden: { name: 'GOLDEN FISH', w: 6,  shells: 10, food: 0, reel: 'frenzy',  how: 'IT WANTS AWAY! MASH AS FAST AS YOU CAN' },
  boot:   { name: 'OLD BOOT',    w: 10, shells: 0,  food: 0, reel: 'heavy',   how: 'HEAVY. KEEP TAPPING' },
};
// Reeling in, once a fish is hooked: E (REEL on a phone), tap after tap. The line starts `start` of
// the way in. gain: how far in a good tap brings it. slip: how far it swims back out a second (all
// the way out: it got away). steady: taps closer than `fast` seconds are too fast, and do nothing.
// fighter: it pulls for `pull` seconds, then tires for `rest`, over and over; a tap while it pulls
// strains the line (`strain` a tap, easing off `ease` a second; all the way: it snaps), and it
// swims back `pullSlip` a second. minMs: the quickest it can honestly be done (the server checks).
// botFail: how often a bot loses one.
export const REELS = {
  start: 0.15,
  quick:   { gain: 0.25, slip: 0,    minMs: 300,  botFail: 0 },
  steady:  { gain: 0.1,  slip: 0.06, fast: 0.16, minMs: 1300, botFail: 0.2 },
  fighter: { gain: 0.06, slip: 0.02, pull: [1.2, 2.2], rest: [0.9, 1.5], strain: 0.34, ease: 0.5, pullSlip: 0.1, minMs: 1800, botFail: 0.35 },
  frenzy:  { gain: 0.07, slip: 0.35, minMs: 1000, botFail: 0.5 },
  heavy:   { gain: 0.07, slip: 0,    minMs: 1000, botFail: 0 },
};
export function pickFish() {
  let r = Math.random() * Object.values(FISH).reduce((n, f) => n + f.w, 0);
  for (const [k, f] of Object.entries(FISH)) if ((r -= f.w) < 0) return k;
  return 'minnow';
}
// slot: where it goes. cost: shells. Bought ones are yours (wear any of them again for free) until
// you leave the rock.
export const CLOTHES = {
  straw:    { name: 'STRAW HAT',    slot: 'hat',  cost: 2 },
  flowers:  { name: 'FLOWER CROWN', slot: 'hat',  cost: 3 },
  tophat:   { name: 'TOP HAT',      slot: 'hat',  cost: 5 },
  crown:    { name: 'GOLD CROWN',   slot: 'hat',  cost: 10 },
  redcape:  { name: 'RED CAPE',     slot: 'cape', cost: 3 },
  bluecape: { name: 'BLUE CAPE',    slot: 'cape', cost: 3 },
  goldcape: { name: 'GOLD CAPE',    slot: 'cape', cost: 8 },
};
// grow: seconds to ripe. food: what it adds to the tribe store.
export const CROPS = {
  wheat:   { name: 'WHEAT',   grow: 15, food: 1 },
  corn:    { name: 'CORN',    grow: 22, food: 2 },
  pumpkin: { name: 'PUMPKIN', grow: 30, food: 3 },
};
// cost: food from the tribe store. r: how much ground it takes (and blocks). icon: for the HUD.
export const BUILDS = {
  fence: { name: 'FENCE',      cost: 2,  r: 0.55, h: 1.2, icon: '🪵' },
  hut:   { name: 'HUT',        cost: 6,  r: 1.9,  h: 3.4, icon: '🛖' },
  head:  { name: 'STONE HEAD', cost: 12, r: 1.1,  h: 3.6, icon: '🗿' },
};
export const BUILD_ORDER = Object.keys(BUILDS);

// Rocks (lobbies): each is its own planet on the same server, found by a short code. Codes the
// server makes up skip vowels so they never spell anything; any 4 letters work in a link.
export const ROOM_CODE = { len: 4, chars: 'BCDFGHJKLMNPQRSTVWXZ' };
// Whatever was typed or linked, as a code ('' if it can't be one).
export function cleanRoomCode(c) {
  const s = String(c ?? '').toUpperCase().replace(/[^A-Z]/g, '');
  return s.length === ROOM_CODE.len ? s : '';
}

// Co-op: every human is on one tribe against waves of bots. Wave n brings
// min(maxBots, firstWave + (n - 1) + extra humans) bots, starting at the chosen bot brains and one
// level smarter every `smarterEvery` waves. The ages move on every `ageEvery` waves.
export const COOP = {
  firstWave: 3,
  smarterEvery: 2,
  ageEvery: 2,
  firstBreak: 6,       // seconds before wave 1
  breakSeconds: 8,     // between waves: fallen cavemen wake up, everyone heals
  endSeconds: 12,      // "tribe wiped" screen before starting over
};

// Melee swings bat incoming spears, arrows and musket balls back. A swing is "live" from
// `early` seconds (or 60% of a slow weapon's wind-up) before its blow lands until `late` after;
// anything that reaches the batter (from the front) or comes within the weapon's reach +
// `reach` in that time flies back.
export const BAT = { early: 0.12, late: 0.18, reach: 1.4, front: -0.2 };

// What slain cavemen leave behind: their weapon (grab with E) and a pouch of their ammo
// (walk over it). Armor drops too, see ARMORS. giftLife: how long a new age's weapon lies at
// a caveman's feet for them to take or leave (see ERAS regear).
export const LOOT = { life: 30, giftLife: 45, max: 30, grabRadius: 1.5 };

// block: share of each hit the armor soaks up, dur: how much it can soak before breaking.
export const ARMORS = {
  hide:   { name: 'Mammoth Hide', block: 0.25, dur: 50,  speed: 0,     color: '#c8a06a', desc: 'Thick fur. Soak some bonk.' },
  bone:   { name: 'Bone Plate',   block: 0.35, dur: 75,  speed: -0.04, color: '#f3e7c8', desc: 'Rib bones tied on. Crunchy.' },
  bronze: { name: 'Bronze Shell', block: 0.5,  dur: 110, speed: -0.08, color: '#ffb52e', desc: 'Shiny hard shell. Heavy.' },
  steel:  { name: 'Steel Cuirass', block: 0.5, dur: 130, speed: -0.08, color: '#d7dde4', desc: 'Grey shiny. Stop musket ball sometimes.' },
  kevlar: { name: 'Bulletproof Vest', block: 0.55, dur: 120, speed: -0.03, color: '#9bb06a', desc: 'Squishy cloth that stop bang.' },
  power:  { name: 'Power Suit',   block: 0.6,  dur: 160, speed: 0,     color: '#7fe8ff', desc: 'Space caveman suit. Very future.' },
};

// Newest armor of the era is the most common; durability gets a random roll.
export function makeArmor(era, rng = Math.random) {
  const pool = ERAS[era].armor;
  const type = pool.length > 1 && rng() < 0.65 ? pool[pool.length - 1] : pool[Math.floor(rng() * pool.length)];
  const base = ARMORS[type];
  const dur = Math.round(base.dur * (0.85 + rng() * 0.3));
  return { type, name: base.name, block: base.block, dur, maxDur: dur, speed: base.speed };
}

// ---------------------------------------------------------------- bots
// Bot brains go from 1 (wanders around, lags, forgets to fight) to 10 (barely misses).
// wobble: aim error range (radians), lead: how much they lead moving targets,
// throwGap: seconds between shots, windup: visible aim time before a shot,
// think: seconds between decisions, speed: run speed mult, dodge: hazard-avoid strength,
// gear: how far they'll walk for armor or a better weapon (0 = never),
// chase: farthest caveman they'll pick a fight with, daydream: chance per decision to ignore
// everyone and wander off, swingRest: extra seconds between melee swings,
// lag: { every, freeze } stand frozen for `freeze` seconds every `every` seconds, and
// stutter: walk in stop-go jerks, like a caveman on a bad connection,
// deflect: bat incoming projectiles back.
export const BOT_LEVELS = [
  { name: 'PEBBLE BRAIN', desc: 'WANDER AROUND. LAG. FORGET TO FIGHT.',
    wobble: [0.25, 0.45], lead: 0, throwGap: [6, 10], windup: 1.2, think: [1.8, 3], speed: 0.6, dodge: 0, gear: 0,
    chase: 12, daydream: 0.6, swingRest: [1.5, 3.5], lag: { every: [2.5, 5], freeze: [0.7, 1.8], stutter: true } },
  { name: 'SLEEPY', desc: 'SLOW. WILD AIM. NAP SOMETIMES.',
    wobble: [0.14, 0.26], lead: 0.15, throwGap: [3.2, 5.5], windup: 0.9, think: [0.9, 1.5], speed: 0.78, dodge: 0.2, gear: 0,
    chase: 30, daydream: 0.25, swingRest: [0.7, 1.6], lag: { every: [7, 12], freeze: [0.3, 0.8] } },
  { name: 'DOZY', desc: 'MISS MOST THROWS. EASY BONK.',
    wobble: [0.1, 0.2], lead: 0.35, throwGap: [2.4, 4.2], windup: 0.7, think: [0.6, 1], speed: 0.88, dodge: 0.5, gear: 0,
    chase: 50, daydream: 0.1, swingRest: [0.3, 0.9], lag: { every: [14, 24], freeze: [0.2, 0.5] } },
  { name: 'CLUMSY', desc: 'TRY HARD. NOT VERY GOOD.',
    wobble: [0.07, 0.16], lead: 0.55, throwGap: [1.8, 3.6], windup: 0.6, think: [0.4, 0.8], speed: 0.95, dodge: 0.8, gear: 6,
    chase: 75, daydream: 0, swingRest: [0.1, 0.4] },
  { name: 'NORMAL', desc: 'FAIR FIGHT.',
    wobble: [0.05, 0.13], lead: 0.7, throwGap: [1.4, 3.2], windup: 0.5, think: [0.3, 0.7], speed: 1, dodge: 1, gear: 12,
    chase: 75, daydream: 0, swingRest: [0, 0] },
  { name: 'HUNGRY', desc: 'AIM BETTER. CHASE MORE.',
    wobble: [0.035, 0.09], lead: 0.8, throwGap: [1.2, 2.6], windup: 0.45, think: [0.25, 0.55], speed: 1, dodge: 1, gear: 18,
    chase: 75, daydream: 0, swingRest: [0, 0] },
  { name: 'SMART', desc: 'LEAD MOVING TARGETS. GO GET ARMOR.',
    wobble: [0.025, 0.06], lead: 0.9, throwGap: [1, 2.2], windup: 0.4, think: [0.2, 0.4], speed: 1, dodge: 1, gear: 25,
    chase: 75, daydream: 0, swingRest: [0, 0] },
  { name: 'CUNNING', desc: 'QUICK. SNEAKY. GOOD AIM.',
    wobble: [0.015, 0.04], lead: 0.95, throwGap: [0.8, 1.8], windup: 0.35, think: [0.15, 0.3], speed: 1.04, dodge: 1.1, gear: 32,
    chase: 75, daydream: 0, swingRest: [0, 0] },
  { name: 'DIRE WOLF', desc: 'BAT YOUR SPEARS BACK. DEADLY AIM.',
    wobble: [0.008, 0.025], lead: 1, throwGap: [0.6, 1.4], windup: 0.3, think: [0.1, 0.25], speed: 1.08, dodge: 1.2, gear: 40,
    chase: 75, daydream: 0, swingRest: [0, 0], deflect: true },
  { name: 'SABERTOOTH', desc: 'NEVER MISS. NEVER SLEEP. RUN.',
    wobble: [0.003, 0.012], lead: 1, throwGap: [0.45, 1], windup: 0.22, think: [0.06, 0.15], speed: 1.12, dodge: 1.4, gear: 50,
    chase: 75, daydream: 0, swingRest: [0, 0], deflect: true },
];
export const BOT_LEVEL_DEFAULT = 1;
// Level n (1..10) -> its settings.
export const botLevelDef = n => BOT_LEVELS[Math.min(BOT_LEVELS.length, Math.max(1, n)) - 1];
export const MAX_BOTS = 10;

export const BOULDER = { count: 3, radius: 1.2, minSpeed: 5.5, maxSpeed: 8, dmg: 30, kb: 13 };

export const VOLCANO = {
  radius: 6.5,
  peak: 9,
  firstDelay: 25,
  minGap: 28,
  maxGap: 45,
  shots: [7, 11],
  blast: 3.4,
  dmg: 35,
  kb: 11,
};

export const PICKUP_COUNT = 6;
export const GRAB_RADIUS = 2.6;

// ---------------------------------------------------------------- food
// Campfire meat: press E at a fire to eat its roast (when hurt). A raw one goes back on the spit
// and is ready again once it has cooked for `cook` seconds.
export const MEAT = { heal: 45, cook: 30, reach: 2.2 };

// Magic mushrooms: only a handful on the planet, one of each kind, each a different buff. Walk
// over one to eat it; it grows back somewhere else `regrow` seconds later.
// secs: how long the buff lasts. Effects: strong = hit 50% harder, fast = run 40% faster,
// tough = take half damage, bouncy = jump 70% higher, regrow = +5 life a second, quick = swing
// 40% faster and reload twice as fast.
export const SHROOMS = {
  strong: { name: 'RED RAGE CAP', buff: 'BIG STRONG', desc: 'HIT 50% HARDER', color: '#d8322a', spots: '#fff3e0', secs: 15 },
  fast:   { name: 'BLUE ZOOM CAP', buff: 'FAST FEET', desc: 'RUN 40% FASTER', color: '#3a7bd5', spots: '#d8ecff', secs: 15 },
  tough:  { name: 'GOLD ROCK CAP', buff: 'ROCK SKIN', desc: 'TAKE HALF THE BONK', color: '#e0b53a', spots: '#fff7d0', secs: 15 },
  bouncy: { name: 'PURPLE HOP CAP', buff: 'BOING', desc: 'JUMP WAY HIGHER', color: '#9a4fd6', spots: '#f0e0ff', secs: 20 },
  regrow: { name: 'GREEN MEND CAP', buff: 'REGROW', desc: '+5 LIFE EVERY SECOND', color: '#4fd16a', spots: '#e0ffe6', secs: 10 },
  quick:  { name: 'ORANGE ZIP CAP', buff: 'QUICK HANDS', desc: 'SWING FASTER, RELOAD 2X', color: '#ff8a1f', spots: '#fff0dc', secs: 15 },
};
export const SHROOM_RULES = { regrow: [25, 40], reach: 1.2 };
export const BUFF = { strong: 1.5, fast: 1.4, tough: 0.5, bouncy: 1.7, regrow: 5, quick: 0.6 };

// ---------------------------------------------------------------- the Businessman
// Mammon in a suit, on a podium of gold at the south pole. He can't be hurt; every bonk on the
// planet is profit, and he gets fatter with the profits and the ages. fat 0..1 picks up his
// trimmings at these points. profitPerBonk/profitPerAge: shiny rocks for the round-end screen.
export const MAMMON = {
  at: [0, -1, 0],
  stages: { watch: 0.18, hat: 0.32, monocle: 0.48, chains: 0.6, cigar: 0.72, bags: 0.84, gold: 0.95 },
  profitPerBonk: 25,
  profitPerAge: 100,
  // what he says (cave talk, Wall Street manners)
  gloat: [
    'EXCELLENT. MORE SPEARS WILL BE NEEDED.',
    'ME SELL SPEARS TO BOTH TRIBES.',
    'EVERY BONK IS PROFIT.',
    'BUY LOW. BONK HIGH.',
    'SHAREHOLDERS VERY PLEASED.',
    'THANK YOU FOR YOUR SACRIFICE. CHA-CHING.',
    'ME NEVER CARRY SPEAR. ME CARRY LEDGER.',
    'WAR IS GOOD FOR BUSINESS.',
    'KEEP BONKING, LITTLE CAVEMEN.',
    'ONE MORE FALLEN, ONE MORE SHINY ROCK.',
  ],
  newAge: ['NEW WEAPONS! NEW CUSTOMERS!', 'UPGRADE CYCLE. MAGNIFICENT.', 'OLD SPEARS OBSOLETE. BUY NEW ONES.'],
  hit: ['TOO BIG TO FAIL.', 'SECURITY!', 'YOU CANNOT BONK CAPITAL.', 'ME HAVE LAWYERS.'],
  doom: 'ME HAVE BUNKER.',
  end: 'PROFITS WERE EXCELLENT THIS QUARTER.',
  start: 'NEW MARKET OPEN. BONK AWAY.',
  // The bunker doesn't help: the end of the world gets him too, dieAt seconds into the finale
  // (one of the falling rocks, lava bombs or ice lands on his podium, or the flood reaches him
  // about then). He goes over with the coins bursting out of him, and these are his last words.
  dieAt: 5.5,
  death: 'BURY ME WITH MY MONEY.',
  // Ploughshares: peace breaks out, and the farming ends
  peace: 'NO! PEACE IS BAD FOR BUSINESS!',
  harvest: 'NOBODY BUYS SPEARS ANY MORE...',
  shop: 'FINALLY. SOME BUSINESS.',
  free: ['FREE FOOD?! WHO PAYS FOR THAT?', 'CHARITY IS BAD FOR BUSINESS.', 'GIVING THINGS AWAY? DISGUSTING.'],
  // E at his podium (within reach of it): he talks business, every line once before any comes
  // round again. {profit}: his profit so far. {age}: the age it is.
  reach: 5.5,
  talk: [
    'WAR IS JUST PEACE WITH BETTER MARGINS.',
    'ME NOT START WARS. ME JUST MONETIZE THEM.',
    'A SPEAR IN EVERY HAND. TWO, WITH FINANCING.',
    'ME SELL TO BOTH TRIBES. THAT CALLED DIVERSIFYING.',
    'HEALTHY ECONOMY NEEDS HEALTHY SUPPLY OF ENEMIES.',
    'WIN OR LOSE, ME WIN.',
    'THIS NOT WAR. THIS MARKET CORRECTION.',
    'FIVE-YEAR PLAN: WAR, WAR, WAR, WAR, BIGGER WAR.',
    'ME CALL IT DEFENSE. SOUNDS NICER. SAME PRICE.',
    'COLLATERAL DAMAGE? ME LOVE COLLATERAL.',
    'NOTHING PERSONAL. JUST SPEARS.',
    'WEALTH TRICKLE DOWN. MOSTLY AS SPEARS.',
    'PROFIT SO FAR: {profit} SHINY ROCKS. DISAPPOINTING. BONK HARDER.',
    '{age}? GREAT AGE. NEXT AGE EVEN GREATER. FOR ME.',
    'ME GIVE ONE SHINY ROCK TO PEACE. TAX WRITE-OFF.',
    'ADVICE: BUY LOW, SELL SPEARS. THAT WILL BE ONE SHINY ROCK.',
    'ME NOT GREEDY. ME JUST WANT ALL OF IT.',
    'WHY FIGHT ME? ME SELL YOU THE THING YOU FIGHT ME WITH.',
    'BEST WAR NEVER ENDS. LIKE A SUBSCRIPTION.',
    'OTHER TRIBE HAS BIGGER SPEAR. WHAT LUCK! ME HAVE BIGGER-ER SPEAR.',
    'BLOOD IS RED. LEDGER IS BLACK. BEAUTIFUL.',
    'DEAD CAVEMEN BUY NO SPEARS. SO PLEASE, DIE SLOWLY.',
    'ME NOT INVENT WHEEL. ME INVENT WHEEL TAX.',
    'SHAREHOLDERS ASK: WHY ONLY ONE WAR? GOOD QUESTION.',
    'VOLCANO GO BOOM? ME SELL HELMETS.',
    'THOUGHTS AND PRAYERS. AND AN INVOICE.',
    'ME NOT SEE CAVEMEN. ME SEE CUSTOMERS.',
    'BRAVE LITTLE CAVEMAN! HAVE COUPON FOR NEXT SPEAR.',
    'ONE BONK IS TRAGEDY. MILLION BONKS IS QUARTERLY REPORT.',
    'ME LOVE PEACE. PEACE IS WHEN WE RESTOCK.',
  ],
  // in a Ploughshares peace, while he wastes away
  talkPeace: [
    'PLOUGHS?! WHO PROFITS FROM PLOUGHS?!',
    'CABBAGE NOT GO BOOM. CABBAGE BAD INVESTMENT.',
    'ME SELL YOU SPEAR SHAPED LIKE HOE. NOBODY WILL KNOW.',
    'EVERYBODY FED AND HAPPY. DISGUSTING.',
    'ME WASTING AWAY. PLEASE. ONE SMALL WAR. TINY ONE.',
    'NEIGHBOR LOOKING AT YOUR TURNIPS. JUST SAYING.',
    'PEACE IS JUST WAR WITH NO CUSTOMERS.',
    'VOTE FOR WAR. ME ALREADY PRINTED THE SIGNS.',
    'YOU GROW FOOD. FOOD GET EATEN. WHERE IS THE GROWTH?',
    'TARGET PRACTICE, GOOD. KEEP PRACTICING. FOR NO REASON.',
  ],
  // the end of the world, for the few seconds he has left
  talkDoom: [
    'BUNKER HAS ROOM FOR ONE. GUESS WHO.',
    'ME SELL SEATS ON THE ARK. NO REFUNDS.',
    'FINAL SALE! EVERYTHING MUST GO!',
    'MONEY CANNOT BURN. RIGHT? RIGHT?!',
    'ME SHORTED THE PLANET.',
  ],
};

// ---------------------------------------------------------------- melee weapons
// dmg: hit damage, range: reach, cd: seconds between swings, windup: delay before
// the hit lands, kb: knockback, arc: swing width in degrees, speed: run speed mult.
// pool: which era hands it out, verb: what the kill feed says.
export const WEAPON_TYPES = {
  bigbone:    { name: 'Big Bone',        pool: 'primitive', verb: 'BONK',   dmg: 26, range: 2.4, cd: 0.80, windup: 0.18, kb: 11, arc: 110, speed: 0.95, desc: 'Sends cavemen flying.' },
  club:       { name: 'Club',            pool: 'primitive', verb: 'BONK',   dmg: 32, range: 2.1, cd: 0.95, windup: 0.22, kb: 6,  arc: 90,  speed: 0.92, stun: 0.7, desc: 'BONK. Target sees stars.' },
  stick:      { name: 'Stick',           pool: 'primitive', verb: 'POKE',   dmg: 11, range: 2.7, cd: 0.32, windup: 0.07, kb: 3,  arc: 70,  speed: 1.15, desc: 'Fast pokey. Light. Run quick.' },
  tusk:       { name: 'Mammoth Tusk',    pool: 'primitive', verb: 'POKE',   dmg: 22, range: 3.3, cd: 0.85, windup: 0.20, kb: 5,  arc: 45,  speed: 0.95, bleed: 4, desc: 'Long reach. Make enemy leak.' },
  stoneaxe:   { name: 'Rock-on-Stick',   pool: 'primitive', verb: 'SMASH',  dmg: 40, range: 1.9, cd: 1.15, windup: 0.30, kb: 5,  arc: 80,  speed: 0.88, desc: 'Heavy smash. Slow swing.' },
  fish:       { name: 'Old Fish',        pool: 'primitive', verb: 'SLAP',   dmg: 9,  range: 2.0, cd: 0.45, windup: 0.10, kb: 2,  arc: 100, speed: 1.05, slow: 2.5, desc: 'Stinky. Target walk slow.' },
  femur:      { name: 'Dino Femur',      pool: 'primitive', verb: 'BONK',   dmg: 45, range: 2.9, cd: 1.50, windup: 0.42, kb: 18, arc: 150, speed: 0.78, desc: 'Biggest bonk. Very heavy.' },
  jawbone:    { name: 'Jawbone',         pool: 'primitive', verb: 'CHOMP',  dmg: 17, range: 2.0, cd: 0.55, windup: 0.12, kb: 3,  arc: 80,  speed: 1.00, leech: 0.6, desc: 'Bite back. Steal life.' },
  antler:     { name: 'Antler',          pool: 'primitive', verb: 'BONK',   dmg: 19, range: 2.4, cd: 0.60, windup: 0.13, kb: 6,  arc: 140, speed: 1.00, desc: 'Wide swipe. Hit many.' },
  meatbone:   { name: 'Meat Bone',       pool: 'primitive', verb: 'BONK',   dmg: 14, range: 2.0, cd: 0.60, windup: 0.12, kb: 4,  arc: 90,  speed: 1.00, heal: 9, desc: 'Hit, then take bite. Yum.' },
  // Shiny Rock Age
  dagger:     { name: 'Bronze Dagger',   pool: 'sword',     verb: 'STAB',   dmg: 17, range: 1.9, cd: 0.27, windup: 0.06, kb: 3,  arc: 70,  speed: 1.12, crit: 0.2, desc: 'Tiny shiny. Stab stab stab.' },
  shortsword: { name: 'Short Sword',     pool: 'sword',     verb: 'SLICE',  dmg: 30, range: 2.3, cd: 0.50, windup: 0.10, kb: 5,  arc: 100, speed: 1.00, desc: 'Shiny. Sharp. Good.' },
  khopesh:    { name: 'Khopesh',         pool: 'sword',     verb: 'HOOK',   dmg: 33, range: 2.5, cd: 0.62, windup: 0.13, kb: 6,  arc: 120, speed: 1.00, bleed: 5, desc: 'Hook sword. Make big leak.' },
  longsword:  { name: 'Longsword',       pool: 'sword',     verb: 'SLICE',  dmg: 42, range: 3.1, cd: 0.85, windup: 0.20, kb: 9,  arc: 110, speed: 0.95, desc: 'Long shiny. Reach far.' },
  greatsword: { name: 'Big Shiny Stick', pool: 'sword',     verb: 'CLEAVE', dmg: 60, range: 3.3, cd: 1.35, windup: 0.40, kb: 17, arc: 160, speed: 0.80, desc: 'Biggest sword. Swing slow. Hit all.' },
  obsidian:   { name: 'Obsidian Paddle', pool: 'sword',     verb: 'CHOP',   dmg: 38, range: 2.4, cd: 0.80, windup: 0.18, kb: 7,  arc: 110, speed: 0.95, bleed: 4, stun: 0.25, desc: 'Wood paddle. Sharp black rock teeth.' },
  // Zap Age
  glowstick:  { name: 'Glow Stick',      pool: 'future',    verb: 'VWOOM',  dmg: 48, range: 2.8, cd: 0.50, windup: 0.08, kb: 7,  arc: 130, speed: 1.05, desc: 'Hot light sword. Go VMMMM.' },
  zapclub:    { name: 'Zap Club',        pool: 'future',    verb: 'ZAP',    dmg: 30, range: 2.2, cd: 0.60, windup: 0.10, kb: 5,  arc: 100, speed: 1.00, stun: 0.9, desc: 'Club that bite with lightning.' },
};

// Random quality prefixes. w = roll weight. Multipliers stack on the base stats.
export const PREFIXES = [
  { id: '',          name: '',          w: 30, tier: 'common' },
  { id: 'cracked',   name: 'Cracked',   w: 8,  tier: 'junk',   dmg: 0.78, scale: 0.9 },
  { id: 'soggy',     name: 'Soggy',     w: 6,  tier: 'junk',   cd: 1.2, kb: 0.8 },
  { id: 'mighty',    name: 'Mighty',    w: 9,  tier: 'good',   dmg: 1.25, scale: 1.2 },
  { id: 'swift',     name: 'Swift',     w: 9,  tier: 'good',   cd: 0.75, windup: 0.75 },
  { id: 'long',      name: 'Long',      w: 8,  tier: 'good',   range: 1.25, scale: 1.15 },
  { id: 'spiky',     name: 'Spiky',     w: 7,  tier: 'good',   dmg: 1.1, addBleed: 3 },
  { id: 'feathered', name: 'Feathered', w: 7,  tier: 'good',   speed: 0.1 },
  { id: 'ancient',   name: 'Ancient',   w: 5,  tier: 'rare',   dmg: 1.15, kb: 1.4 },
  { id: 'lucky',     name: 'Lucky',     w: 5,  tier: 'rare',   crit: 0.3 },
  { id: 'ooga',      name: "Ooga's",    w: 2,  tier: 'legend', dmg: 1.3, cd: 0.85, kb: 1.25, crit: 0.15, scale: 1.1 },
];

export const TIER_COLORS = {
  junk: '#9b9488',
  common: '#f3e7c8',
  good: '#86d65f',
  rare: '#5fb0ff',
  legend: '#ffb52e',
};

const round = (v, d) => Math.round(v * 10 ** d) / 10 ** d;

function weightedPick(list, rng) {
  let total = 0;
  for (const item of list) total += item.w;
  let roll = rng() * total;
  for (const item of list) if ((roll -= item.w) <= 0) return item;
  return list[0];
}

// Every weapon is a random type from the pool + random prefix + a small per-stat roll,
// so no two are identical.
// What everyone holds once swords turn into ploughshares. Shaped like a weapon so the HUD and the
// caveman model take it as one; it can't hurt anybody (nothing can, in peace).
export function makeTool() {
  return {
    type: 'hoe', pool: 'tool', verb: 'PLANT', prefix: '', tier: 'common', name: 'Hoe',
    dmg: 0, range: 1.5, cd: 0.5, windup: 0.1, kb: 0, arc: 60, speed: 1.05,
    stun: 0, slow: 0, bleed: 0, leech: 0, heal: 0, crit: 0, scale: 1, desc: 'Dig. Plant. Grow food.',
  };
}

// What you hold in the duel ring, unless you pick something else off the rack: a padded club. It
// hurts, but nothing in the ring takes anybody below 1 HP.
export function makePracticeClub() {
  return {
    type: 'club', pool: 'tool', verb: 'BONK', prefix: '', tier: 'common', name: 'Practice Club',
    dmg: 18, range: 2.2, cd: 0.7, windup: 0.16, kb: 6, arc: 100, speed: 1,
    stun: 0, slow: 0, bleed: 0, leech: 0, heal: 0, crit: 0, scale: 0.9, desc: 'Padded. For duels.',
  };
}

// What your hoe turns into in a haunted hollow: fire on a stick. Monsters hate it.
export function makeTorch() {
  return {
    type: 'torch', pool: 'tool', verb: 'BURN', prefix: '', tier: 'common', name: 'Torch',
    dmg: 26, range: 2.3, cd: 0.55, windup: 0.12, kb: 7, arc: 110, speed: 1,
    stun: 0, slow: 0, bleed: 0, leech: 0, heal: 0, crit: 0, scale: 1, desc: 'Fire on a stick. Monsters hate it.',
  };
}

// One weapon of a given type, plain: no prefix, no roll.
export function weaponOfType(type) {
  const base = WEAPON_TYPES[type];
  return {
    type, pool: base.pool, verb: base.verb, prefix: '', tier: 'common', name: base.name,
    dmg: base.dmg, range: base.range, cd: base.cd, windup: base.windup, kb: base.kb, arc: base.arc, speed: base.speed,
    stun: base.stun || 0, slow: base.slow || 0, bleed: base.bleed || 0, leech: base.leech || 0, heal: base.heal || 0,
    crit: base.crit || 0, scale: 1, desc: base.desc,
  };
}

// The duel ring's weapon rack: the padded club, or any weapon of any age.
export const DUEL_WEAPONS = ['practice', ...Object.keys(WEAPON_TYPES)];
export const duelWeapon = type => (WEAPON_TYPES[type] ? weaponOfType(type) : makePracticeClub());

export function makeWeapon(rng = Math.random, pool = 'primitive') {
  const types = Object.keys(WEAPON_TYPES).filter(k => WEAPON_TYPES[k].pool === pool);
  const type = types[Math.floor(rng() * types.length)];
  const base = WEAPON_TYPES[type];
  const pre = weightedPick(PREFIXES, rng);
  const roll = () => 0.92 + rng() * 0.16;
  return {
    type,
    pool,
    verb: base.verb,
    prefix: pre.id,
    tier: pre.tier,
    name: pre.name ? `${pre.name} ${base.name}` : base.name,
    dmg: round(base.dmg * (pre.dmg || 1) * roll(), 0),
    range: round(base.range * (pre.range || 1) * roll(), 2),
    cd: round(base.cd * (pre.cd || 1) * roll(), 2),
    windup: round(base.windup * (pre.windup || 1), 2),
    kb: round(base.kb * (pre.kb || 1) * roll(), 1),
    arc: base.arc,
    speed: round(base.speed + (pre.speed || 0), 2),
    stun: base.stun || 0,
    slow: base.slow || 0,
    bleed: base.bleed || pre.addBleed || 0,
    leech: base.leech || 0,
    heal: base.heal || 0,
    crit: round((base.crit || 0) + (pre.crit || 0), 2),
    scale: round((pre.scale || 1) * (0.94 + rng() * 0.12), 2),
    desc: base.desc,
  };
}

// ---------------------------------------------------------------- caveman flavor
export const GARBS = [
  { id: 'leopard', name: 'Leopard' },
  { id: 'tiger', name: 'Sabertooth' },
  { id: 'zebra', name: 'Zebra' },
  { id: 'mammoth', name: 'Mammoth' },
  { id: 'wolf', name: 'Dire Wolf' },
  { id: 'spotted', name: 'Spotty Beast' },
];
export const SKINS = ['#f1c27d', '#e0ac69', '#c68642', '#a86b3c', '#8d5524', '#5c3a1e'];
export const HAIRS = ['#2b1a0e', '#4a2c12', '#161212', '#7a4a1f', '#8b2d0f', '#b9a27a'];

export const EMOTES = ['OOGA!', 'BOOGA!', 'UNGA BUNGA!', 'ME SMASH!', 'ME HUNGRY.', 'WAR IS RACKET!'];
export const EMOTE_SPEECH = ['ooga!', 'booga!', 'unga bunga!', 'me smash!', 'me hungry', 'war is racket!'];

const FIRST = ['Grok', 'Ugg', 'Thag', 'Zug', 'Oog', 'Brak', 'Krunk', 'Mog', 'Gronk', 'Durg', 'Rok', 'Bok',
  'Nug', 'Zorg', 'Hurg', 'Grub', 'Lug', 'Tharg', 'Ook', 'Glub', 'Krag', 'Urk', 'Dag', 'Gork', 'Mung',
  'Snarf', 'Blug', 'Fung', 'Wug', 'Brug', 'Ula', 'Zuga', 'Mok', 'Ruk'];
const EPITHET = ['Rockfoot', 'the Smelly', 'Bonecrusher', 'Unibrow', 'Fireskull', 'Stonebelly', 'Two-Toes',
  'Big Club', 'Hairyback', 'Mudface', 'Rib-Eater', 'No-Fire', 'the Loud', 'Lizardkin', 'Flatnose'];

const pickFrom = (list, rng) => list[Math.floor(rng() * list.length)];

export function randomCaveName(rng = Math.random) {
  const first = pickFrom(FIRST, rng);
  return rng() < 0.45 ? `${first} ${pickFrom(EPITHET, rng)}` : first;
}

export function randomLook(rng = Math.random) {
  return {
    garb: Math.floor(rng() * GARBS.length),
    skin: Math.floor(rng() * SKINS.length),
    hair: Math.floor(rng() * HAIRS.length),
    beard: rng() < 0.7 ? 1 : 0,
    bone: rng() < 0.4 ? 1 : 0,
    size: round(0.93 + rng() * 0.14, 2),
    lefty: rng() < 0.1 ? 1 : 0,   // throws with the left hand, clubs with the right (like 1 in 10 people)
  };
}

// Kill streak titles (announced in the kill feed).
export const STREAKS = { 3: 'DISCOVER FIRE!', 5: 'INVENT WHEEL!', 7: 'MAMMOTH SLAYER!', 10: 'GOD OF ROCK!' };

// ---------------------------------------------------------------- killstreak beasts
// Bonk this many in a row without going down and the spirits give you a beast. You keep it
// until you use it: Q calls it to your side, and Q again sends it at whatever you aim at.
// Left alone it hunts the nearest enemy (or follows you). Any reward has TREX_CHANCE of
// turning out to be a T-Rex. A beast's kills count for its owner but don't add to the streak.
export const STREAK_REWARDS = { 3: 'dog', 5: 'mammoth', 8: 'trex' };
export const TREX_CHANCE = 0.08;
// A beast sent to a spot holds it for a while, chasing only enemies who come this close to it.
export const BEAST_HOLD_RADIUS = 10;
// radius/height: body size for hits. speed: cavemen run at 8. life: seconds before it wanders off.
// sense: how far it notices enemies. verb: what the kill feed says it did.
export const BEASTS = {
  // the attack dog: a blue nose pitbull or a dingo-looking dog, whichever answers the whistle.
  // looks: which dog shows up (picked when it's called); its name goes on the tag and in the feed
  dog: {
    name: 'Attack Dog', icon: '🐕', rank: 1, hp: 75, radius: 0.8, height: 1.3, speed: 13, life: 28, sense: 45,
    verb: 'MAUL', desc: 'GOOD BOY. FAST. LUNGE AND BITE.',
    pounce: { range: 7, dmg: 30, stun: 0.4, kb: 10, cd: 1.5 }, bite: { range: 2.2, dmg: 18, cd: 0.65 },
    looks: { pit: 'Blue Nose Pitbull', dingo: 'Dingo Dog' },
  },
  mammoth: {
    name: 'Mammoth', icon: '🦣', rank: 2, hp: 225, radius: 2.1, height: 4.4, speed: 7, life: 32, sense: 40,
    verb: 'FLATTEN', desc: 'BIG. TRAMPLE EVERYTHING IN WAY.',
    trample: { dmg: 26, kb: 22, cd: 1.2 }, tusk: { range: 4.8, dmg: 38, kb: 24, cd: 2, arc: 110 },
  },
  trex: {
    name: 'T-Rex', icon: '🦖', rank: 3, hp: 325, radius: 1.8, height: 5.6, speed: 9.5, life: 32, sense: 50,
    verb: 'EAT', desc: 'RARE! CHOMP. ROAR MAKE EVERYBODY FREEZE.',
    chomp: { range: 5.4, dmg: 72, kb: 16, cd: 1.7, arc: 80 }, roar: { range: 15, stun: 1.1, cd: 9 },
  },
  // The monsters of the dark forest (peace mode): nobody's, each keeps to its ring of the forest
  // (FOREST_TIERS), and they go for whoever comes in. swipe: their attack (slow: seconds it slows
  // you; drain: it gets the life back). A werewolf also pounces; a vampire blinks behind you; a
  // sleep demon's long arms reach a long way, and its grab freezes you stiff (stun).
  skeleton: {
    name: 'Skeleton', icon: '💀', rank: 0, hp: 90, radius: 0.6, height: 2.1, speed: 6.5, sense: 10, monster: true,
    verb: 'RATTLE', desc: 'CLACK CLACK.', swipe: { range: 2.2, dmg: 16, kb: 7, cd: 1.1 },
  },
  zombie: {
    name: 'Zombie', icon: '🧟', rank: 0, hp: 140, radius: 0.65, height: 2.1, speed: 3.2, sense: 9, monster: true,
    verb: 'GNAW', desc: 'SLOW. HUNGRY. BITE MAKE YOU SLOW TOO.', swipe: { range: 2.0, dmg: 14, slow: 2.5, kb: 3, cd: 1.6 },
  },
  ghost: {
    name: 'Ghost', icon: '👻', rank: 0, hp: 60, radius: 0.7, height: 2.3, speed: 5.5, sense: 10, monster: true,
    verb: 'SPOOK', desc: 'BOO.', swipe: { range: 2.0, dmg: 12, stun: 0.5, kb: 5, cd: 1.4 },
  },
  bat: {
    name: 'Bat', icon: '🦇', rank: 0, hp: 28, radius: 0.45, height: 2.6, speed: 10, sense: 12, monster: true,
    verb: 'NIP', desc: 'SMALL. FAST. NIP NIP NIP.', swipe: { range: 1.8, dmg: 6, kb: 2, cd: 0.6 },
  },
  vampire: {
    name: 'Vampire', icon: '🧛', rank: 0, hp: 160, radius: 0.6, height: 2.3, speed: 7.5, sense: 13, monster: true,
    verb: 'BITE', desc: 'DRINK YOUR LIFE. POP UP BEHIND YOU.', swipe: { range: 2.2, dmg: 22, kb: 6, cd: 1.2, drain: true },
    blink: { range: 12, cd: 7 },
  },
  demon: {
    name: 'Sleep Demon', icon: '👤', rank: 0, hp: 170, radius: 0.6, height: 3.6, speed: 5.5, sense: 14, monster: true,
    verb: 'GRAB', desc: 'TALL. BLACK. BIG SILLY EYES. ONE GRAB AND YOU CAN NOT MOVE.', swipe: { range: 3.0, dmg: 16, stun: 1.2, kb: 1, cd: 1.8 },
  },
  werewolf: {
    name: 'Werewolf', icon: '🐺', rank: 0, hp: 260, radius: 0.9, height: 2.8, speed: 9.5, sense: 15, monster: true,
    verb: 'MAUL', desc: 'BIG. FAST. LEAP FROM FAR.', swipe: { range: 2.6, dmg: 26, kb: 9, cd: 1.0 },
    pounce: { range: 8, dmg: 32, stun: 0.5, kb: 12, cd: 3.5 },
  },
};
export const MONSTERS = Object.keys(BEASTS).filter(k => BEASTS[k].monster);
