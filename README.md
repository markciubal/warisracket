# Spear Sphere

Multiplayer caveman spear-throwing on a tiny planet. Ooga booga.

You run around a small sphere wearing an animal pelt, throwing spears that arc under the
planet's gravity, bonking other cavemen with a random melee weapon, and dodging rolling
boulders and lava bombs from the volcano at the north pole. In **Do Time** mode history
marches on: spears, bows, swords, muskets, guns, lasers, 45 seconds each, until a random
natural disaster (a meteor, the volcano exploding, a giant flood or a sudden ice age) wipes
the planet clean and life starts over in the Stone Age.

## Run it

```
npm install
npm start
```

Open http://localhost:3000 and press **MAKE NEW ROCK**. The server also prints a `Network:`
address for anyone on the same Wi‑Fi/LAN. On Windows, allow Node through the firewall when
prompted (Private networks), or friends won't be able to connect.

The rules every new rock starts with can come from flags or environment variables (see the
table under Heroku):

```
node server.js --mode=classic         # Forever Stone instead of Do Time
node server.js --bots=6 --bot-level=10 # fill to 6 cavemen with level 10 (Sabertooth) bots
node server.js --era-seconds=20       # quick Do Time rounds (20 seconds per age)
npm run nobots                        # humans only
PORT=8080 node server.js              # different port (PowerShell: $env:PORT=8080; node server.js)
```

Once people are playing, each rock's **chief** changes its rules in-game (see Planet rules below).

## Rocks (lobbies)

One server runs any number of separate games at once. Each one is a **rock**: its own planet,
cavemen, bots, Do Time clock, chief and rules, found by a 4-letter code.

- **MAKE NEW ROCK** in the lobby rolls a fresh code (no vowels, so it never spells anything).
  The address bar becomes the rock's link, e.g. `https://my-spear-sphere.herokuapp.com/KPTX`.
  **COPY LINK** (**SHARE LINK** on phones) sends it to friends.
- Friends open that link, or go to the bare URL and type the code into **JOIN ROCK**. Pasting
  the whole link into the code box works too.
- **OTHER ROCK** in the lobby leaves for a different one. The code also shows on the scoreboard
  (Tab, or ☰ on phones) so you can read it out mid-game.
- A rock closes as soon as nobody is on it or watching its lobby, but its link keeps working:
  whoever opens it next gets a fresh planet under the same code. After a server restart,
  everyone who was on a rock reconnects onto the same code with the rules it had.
- Codes keep games apart; they aren't passwords. A wrong code is answered slowly so guessing
  one takes a while, and `/health` never lists them.

## Deploy to Heroku

The page and the game's WebSocket share one port, so Heroku's router handles both and
players connect with `wss://` automatically. From this folder:

```
git init
git add .
git commit -m "Spear Sphere"
heroku login
heroku create my-spear-sphere          # pick any free name
git push heroku HEAD:main
heroku ps:scale web=1
heroku open
```

Make a rock and send friends its link (`https://my-spear-sphere-xxxx.herokuapp.com/KPTX`), and
everyone lands on the same planet while other groups play on their own rocks. To ship changes
later: `git commit -am "more ooga"` then `git push heroku HEAD:main`.

Settings (optional), e.g. `heroku config:set BOT_LEVEL=7 ERA_SECONDS=120`:

| Config var | Flag | Default | What it does |
| --- | --- | --- | --- |
| `MODE` | `--mode` | `dotime` | `dotime`, `classic` (Forever Stone) or `coop` (Tribe vs Bots) |
| `ERA_SECONDS` | `--era-seconds` | 45 | Length of each Do Time age |
| `BOT_LEVEL` | `--bot-level` | 5 | Bot brains, 1–10: 1 wanders around and lags, 5 is a fair fight, 10 barely misses |
| `BOTS` | `--bots` | 4 | Bots fill the planet up to this many cavemen (0–10). 0 = humans only |
| `MAX_PLAYERS` | | 12 | Human cap on each rock. Extra visitors see "CAVE FULL" in that rock's lobby |
| `MAX_ROOMS` | | 20 | Most rocks at once. Past that, making a new one says "TOO MANY ROCKS" |
| `MAX_CONNECTIONS` | | 100 | Cap on open sockets across all rocks, including people sitting in lobbies |
| `PERF_LOG` | | off | Set to `1` to log the server's tick time (all rocks together) every 10 s. A warning is logged either way if the server ever falls behind |

These are only the rules a new rock starts with. Each rock's chief can change mode, bot brains
and bot fill while playing, and those changes last as long as the rock does.

Things to know:

- **Run exactly one web dyno.** Every rock lives in that process's memory, so a second dyno
  would split rocks between them and friends with the same code could land on different
  planets. `app.json` and the scale command above keep it at one.
- **How many rocks fit.** All rocks share one CPU, and bots are what cost: on a desktop PC, 20
  rocks with the default 4-bot fill take about 1.5 ms of each 16.7 ms tick, while 20 rocks
  of 10 cavemen each take about 8 ms. A Heroku dyno is slower than that, so if you raise
  `MAX_ROOMS` or bot fill, run with `PERF_LOG=1` for a while and keep the average well under 16 ms.
- **Restarts are fine.** Heroku restarts dynos about once a day and on every deploy. Players see
  "CAVE SERVER MOVING" and are put back on the same rock code automatically within a few
  seconds, with the rules it had. The planet is new and scores reset with it.
- **Eco dynos sleep** after a stretch without web traffic. The first visitor wakes it in a few
  seconds. Basic dynos stay awake.
- `heroku logs --tail` shows rocks opening and closing, players joining and leaving, age
  changes, round winners and rule changes, each line tagged with its rock's code. `/health`
  returns JSON with the number of rocks and players, and each rock's mode, age and bot level
  (but not its code).
- **What you see is what you hit.** Everyone else is drawn about 0.12 s in the past (that's
  what keeps them moving smoothly), plus your ping. Each spear, shot, beam and swing tells the
  server what moment was on your screen, and the server checks the hit against where cavemen
  stood at that moment, up to 0.3 s back.
- The server sends a ping every 20 s (under Heroku's 55 s idle cutoff) and drops sockets
  that stop answering, so a closed laptop doesn't leave a frozen caveman behind.

Not on Heroku? Any host that runs `npm start` and supports WebSockets works the same way
(Render, Railway, Fly.io, a VPS). For a quick game from your own PC, forward the port on
your router or use a tunnel such as `cloudflared tunnel --url http://localhost:3000`.

## Controls

| Input | Action |
| --- | --- |
| WASD / arrows | Run |
| Mouse | Turn and aim (click the game to capture the mouse, Esc frees it) |
| Left mouse / F | Bonk with your melee weapon (right mouse when left-handed) |
| Hold right mouse | Charge a spear, draw a bow or steady a musket (a dotted arc shows where it lands), then release. Guns and lasers fire while held (left mouse when left-handed) |
| Space | Jump (you can hop over boulders if you time it) |
| E | Swap weapons at a glowing totem, put on armor, or (when hurt) eat the roast at a campfire |
| Q | Killstreak beast: call it, then aim and Q again to send it |
| 1–6 | Grunt: OOGA!, BOOGA!, UNGA BUNGA!, ME SMASH!, ME HUNGRY., WAR IS RACKET! |
| Tab | Scoreboard |
| C | Tribe council (planet rules) |
| M / N | Mute everything / toggle the drums |
| G | Graphics: LOW / AUTO / HIGH |
| O | Settings |
| Esc | Pause: frees the mouse and shows **▶ BACK TO BONKING**, **⚙ SETTINGS** and **✕ QUIT** |

**Quitting** takes you off the planet and back to your rock's lobby, where **OOGA BOOGA!** puts
you straight back on (as a fresh caveman) and **OTHER ROCK** goes elsewhere. QUIT is on the pause
screen, at the bottom of settings while you're playing, and in the ☰ menu on phones. It asks
first ("SURE?"), and a second press within 3 seconds quits, so a stray tap doesn't cost you your
score. Settings and the tribe council close with their ✕, their bottom button, or Esc.

### Settings

Open **⚙ SETTINGS** from the lobby, press O in game, or use the button on the pause screen
after Esc frees the mouse (on phones: ☰ then ⚙). Everything is remembered in that browser,
and **RESET ALL** puts it back the way it started.

| Section | Settings |
| --- | --- |
| Sound | Mute all (M), all sound, bonks & booms, drums on/off (N), drum loudness, caveman voices (0 turns the spoken grunts off) |
| Controls | Mouse speed (drag speed on phones), flip up/down look, handed (right / left). Phones also get tilt aim (off by default / soft / normal / wild), flip up/down tilt and buzz |

**Handed**: right-handed (the default) bonks with left click and throws with right click, and your
caveman throws with his right hand and clubs with his left. Left-handed swaps both: right click
bonks, left click throws, and your caveman is the mirror image, throwing with his left hand. Your
shots come out of that side, the camera moves to that shoulder, and everyone else sees the hands
swap. About one bot in ten is left-handed too.
| Screen | Graphics (G), view width (field of view, 50–95°), screen shake, screen flashes (red hurt flash, age glow, end-of-world whiteout), damage numbers, FPS counter, show ping (your latency under the radar: green under 90 ms, yellow under 180, red above; on by default on computers, off on phones) |

### Graphics

Pick **GRAPHICS** in settings, or press G in game.

- **LOW**: no shadows, half the smoke and debris, no grass blades, pebbles or scattered bones, at most 1 screen
  pixel per CSS pixel. For older laptops and integrated graphics.
- **AUTO** (default): soft shadows and full effects. Drops the render resolution a step when the
  game falls under about 45 fps and raises it again when there's headroom.
- **HIGH**: full resolution on high-DPI screens, sharper shadows, always antialiased.

LOW and AUTO both adjust resolution on the fly. Only HIGH keeps it fixed.

### Phones and tablets

Open the same link on a phone and turn it sideways. Touch screens get touch controls
automatically (add `?touch` to the URL to try them on a computer with the mouse).

| Touch | Action |
| --- | --- |
The controls are the usual phone-game ones: a thumbstick on the left, drag on the right to look.

| Touch | Action |
| --- | --- |
| Left thumb, anywhere on the left half | Thumbstick: run. Push it halfway to walk |
| Drag on the right half | Turn and aim (DRAG SPEED in settings) |
| THROW (hold, let go) | Charge and throw, same as the right mouse button. Slide your thumb on it to aim while charging |
| BONK, JUMP | Melee, jump. BONK's ring shows when the swing is ready again |
| GRAB | Shows up next to a totem or armor |
| BEAST | Shows up with a killstreak beast: tap to call it, tap again to send it where you aim |
| 🗣 | Grunts |
| ☰ | Scores (with the rock code) and your weapon card, plus ⚙ settings, ⚑ tribe council (only for the chief) and ✕ quit |

- **Tilt aim** is off unless you turn it on in settings (**TILT AIM**: SOFT, NORMAL or WILD).
  Then you also **lean the phone** like a steering wheel to turn (the further, the faster) and
  **tip it** (top edge away from you / toward you) to aim lower / higher, and a **◎** button
  appears: "straight ahead is how I'm holding it now" (this also happens on its own when you
  start and after each respawn). **FLIP UP/DOWN TILT** reverses the tip. Players who had
  tilt on only because it used to be the default are switched to off; anyone who picked SOFT or
  WILD keeps it.
- **Tilt needs an `https://` link.** The Heroku URL is fine. On an iPhone, tap *Allow* when the
  game asks for Motion & Orientation access. Over plain `http://` (for example
  `http://192.168.1.20:3000` on your Wi-Fi) phones won't share tilt with web pages, so you aim
  by dragging instead. For https at home, use the `cloudflared` tunnel from the Heroku section.
- **BUZZ** in settings turns the hit rumble on and off.
- On Android the game goes full screen and stays sideways. On iPhone, use Share → *Add to Home
  Screen* and start it from there for full screen.
- Phones start on LOW graphics. Android phones buzz when you get hit or bonk someone.

## Do Time mode

History marches through six ages, **45 seconds each**. The banner at the top shows the age
and the countdown to the next one.

| Age | Ranged | Melee | Armor that drops |
| --- | --- | --- | --- |
| Stone Age | Spear (3, regrow every 5 s) | Bones, clubs and friends | Mammoth Hide |
| Bendy Stick Age | Bow (6 arrows, faster and flatter) | Keep what you have | Hide, Bone Plate |
| Shiny Rock Age | Longbow (8 arrows) | **A bronze sword lands in front of everyone** (take it or keep yours) | Bone Plate, Bronze Shell |
| Boom Stick Age | Musket: one huge shot, 2.4 s reload, lots of smoke | Keep your weapon | Bronze Shell, Steel Cuirass |
| Bang Bang Age | Rifle: hold to spray, 24-round magazine | Keep your weapon | Steel Cuirass, Bulletproof Vest |
| Zap Age | Laser: instant straight beam, fire while held | **A Glow Stick or Zap Club lands in front of everyone** | Vest, Power Suit |
| Random disaster (~11 s) | | | |

With the default `ERA_SECONDS=45` a whole round is 4½ minutes plus the finale.

- When an age starts, everyone's ranged weapon upgrades on the spot and the totems restock
  with that age's weapons. Respawns get that age's gear too.
- Nobody loses their weapon when an age begins. In the Shiny Rock and Zap Ages a new weapon from
  that age lands just in front of each caveman: press E to take it (yours drops in its place for
  someone else) or just leave it. It lies there for 45 s. Bots simply swap.
- Lasers don't curve with the planet: aim above the horizon and the beam goes off into space.
  Bullets and musket balls kick up dirt instead of lying around to be picked up.
- **Armor** spawns at random spots and shows as a glowing stand (and a shield on the radar). It
  drops more often in later ages. Walk onto it to put it on if you have none, or press E to
  swap. Armor soaks a share of every hit (25% up to 60%) until it wears out and shatters.
  Heavier armor slows you a little. Whatever's left drops when you die.
- **The end of the world**: after the Zap Age, nature picks one of these at random (never the
  same one twice in a row):
  - ☄ **Big Rock From Sky**: flaming meteors smash onto red target rings, then a giant one you
    can watch coming for five seconds lands and flattens the planet.
  - 🌋 **Mountain Go Boom**: the volcano erupts nonstop, lava bombs arc out onto red rings, then
    the whole mountain explodes.
  - 🌊 **Big Water**: a wall of water rolls across the planet from a random spot. Run from it as
    long as you can; once it reaches you, you're gone, and soon it covers everything.
  - ❄ **Big Cold**: the sky turns white, snow falls, hailstones shatter on red rings, then
    everyone freezes solid in a block of ice.

  You can keep fighting while it happens, but the final blow gets everyone. Disaster deaths
  don't count against your score. Then **EVERYTHING GONE!** shows who bonked the most before the
  end, and 12 s later the ash, ice or flood clears, the grass grows back, and a new round starts
  in the Stone Age with scores reset.

**Forever Stone** is the original mode: spears and bones only, no clock, no armor.

## Tribe vs Bots (co-op)

Every human on the planet is one tribe, fighting waves of bots together.

- **The tribe sticks together.** Each round the whole tribe starts at one camp. Anyone joining
  (or waking up after a wave) comes in beside a tribe member who's still up, and the bots of
  each wave come in far away from the tribe.
- **No hurting your own side.** Your swings, spears and beams pass straight through tribe
  members, and bots never hit each other either. Boulders, lava and your own spear falling back
  on you still hurt. Tribe names are green, bots are red, on the radar too.
- **Waves**: wave 1 brings 3 bots, plus 1 for each extra human. Each wave brings one more, up
  to 10. Wave 1 bots use the chosen **bot brains**, and every 2 waves they get a level smarter.
  Bot fill isn't used.
- **Ages move with the waves**: a new age every 2 waves (bows on wave 3, swords on wave 5, and
  so on up to lasers), with the same gear changes as Do Time. There's no end-of-the-world
  disaster.
- **Falling down**: if you're knocked out mid-wave you stay down. When the last bot of the wave
  falls, **WAVE DONE**: the fallen wake up next to a friend, everyone still standing heals to
  full and restocks, and the next wave comes 8 s later.
- **Tribe wiped**: if every human is down at once, the results show how far the tribe got, and
  12 s later it starts over from wave 1.

## Planet rules and bot difficulty

The human who's been on the planet longest is the **chief** (feather headdress, marked in the
scoreboard). The chief opens the **tribe council** with C to change:

- **Mode**: Do Time, Forever Stone or Tribe vs Bots (co-op). Changing it starts a new round.
- **Bot brains**, from 1 to 10:

  | Level | Name | What they're like |
  | --- | --- | --- |
  | 1 | Pebble Brain | Wanders around. Freezes mid-step every few seconds and walks in stuttery stop-go jerks, like a caveman on a bad connection. Usually forgets to fight, only notices you up close, swings rarely, throws almost never and wildly, walks into boulders |
  | 2 | Sleepy | Slow, wild aim, an occasional freeze, sometimes wanders off |
  | 3 | Dozy | Misses most throws, slow to swing, rare freezes |
  | 4 | Clumsy | Tries hard, not very good |
  | 5 | Normal | A fair fight (the default) |
  | 6 | Hungry | Better aim, shoots more often |
  | 7 | Smart | Tight aim, leads moving targets, goes after armor and better weapons |
  | 8 | Cunning | Quicker, sneakier, good aim |
  | 9 | Dire Wolf | Deadly aim, and bats your spears back at you |
  | 10 | Sabertooth | Almost never misses, reacts instantly, runs faster than you |

- **Bot fill**: bots join until the planet has this many cavemen and leave as humans arrive.

Every rock has its own chief and rules. If nobody is playing on a rock yet, its lobby shows the
same controls, so whoever makes the rock (or arrives first) sets the rules and becomes chief.

## How it plays

- **Spears and arrows**: harder throws and shots hit harder; head hits do 1.5× (1.75× for
  arrows, up to 2× for bullets). Pick up any spear or arrow stuck in the ground by walking over
  it. Throw too hard and flat and it goes into orbit and can come back around to hit you.
- **Melee**: every caveman spawns with a random weapon: a weapon type, a quality prefix, and a
  small random roll on every stat, so no two are the same.
- **Batting**: swing as a spear, arrow or musket ball reaches you and you hit it back ("HOME
  RUN!"). It now belongs to you, so if it hits someone the bonk is yours. A swing bats things
  from a moment before its blow lands until a moment after (big slow weapons cover more of their
  wind-up), and anything reaching you from the front while you swing gets batted instead of
  hitting you. Face the thrower and it flies straight back down its own path into them;
  otherwise it goes where you face. Bullets come too fast and thick to bat, and lasers are light.
- **Loot**: a knocked-out caveman drops everything they carried. Their **armor** goes on if you
  walk onto it with none, or press E to swap. Their **weapon** lies on the grass with a glow ring
  in its rarity color: press E to take it, and yours drops in its place so a friend can have it.
  Their **ammo pouch** refills you when you walk over it while short, worth the same share of a
  full load they had, whatever you're carrying now. Loot lasts 30 s. Smarter bots go for good
  dropped weapons and for pouches when they're out of ammo.
- **Totems**: six stone totems each offer a weapon (the beam color shows its rarity). Press E
  to swap; your old weapon stays on the totem. Untouched totems re-roll over time.
- **Hazards**: three boulders roll around the planet and bounce off rocks. Every 30–45 s the
  volcano erupts and lobs lava bombs; red rings on the ground show where they'll land.
  Kills from hazards go to whoever hit the victim last.
- **Radar**: top right, turning with you (your arrow always points ahead). N, E, S and W ride
  round its rim: north is the volcano's pole and south is the Businessman's, and east is on your
  right when you face north.
- **Kill streaks**: 3 = DISCOVER FIRE, 5 = INVENT WHEEL, 7 = MAMMOTH SLAYER, 10 = GOD OF ROCK.

### Killstreak beasts

Bonk cavemen in a row without going down and the spirits give you a beast to set loose on the
planet:

| Streak | Beast | What it does |
| --- | --- | --- |
| 3 | 🐕 Attack Dog | Faster than any caveman. Lunges from a few strides away (30 and a short stun), bites up close (18). Barks, wags. 75 HP, 28 s |
| 5 | 🦣 Mammoth | Tramples everything in front of it as it walks, with huge knockback, and swings its tusks. 225 HP, 32 s |
| 8 | 🦖 T-Rex | Chomps for 72. Roars every 9 s and freezes everyone nearby. 325 HP, 32 s |

The dog is either a **Blue Nose Pitbull** (stocky, slate-grey, white blaze, spiked collar) or a
**Dingo Dog** (lean, ginger, pointed ears, white socks). First dogs are dealt out in turn
(pitbull, dingo, pitbull...), and after that you always get the other breed from your last one.
Any reward has an 8% chance of coming out as a T-Rex instead.

- **You keep it until you want it.** The panel above your life bar glows when one is waiting,
  even after you go down. Press **Q** (BEAST on phones) to call it: it bursts out of the ground
  in front of you. A bigger reward replaces a smaller waiting one, never the other way round.
- **Point it at things.** With your beast out, aim at a caveman and press Q to send it after
  them (SIC 'EM!), or aim at the ground to send it there. It ignores everyone on the way, then
  guards that spot for a while, chasing anyone who comes within 10 steps and going back to its
  post after. Aim inside a hut or a rock and it waits at the edge. Left alone it goes for the
  nearest enemy, or follows you around.
- **Big ones don't go round small things.** Mammoths and T-Rexes crash straight through trees,
  campfires and small rocks; only huts, big rocks, skeletons and the volcano make them detour.
- **Fighting back:** beasts can be speared, shot, zapped and bonked (big ones are easy to hit,
  hard to finish). Its owner, and in co-op his tribe, can't hurt it. Slaying one counts as a
  bonk. It wanders off when its time is up, or when its caveman leaves.
- Its kills count for its owner but don't build the streak, so one beast can't earn the next.
- Bots earn beasts too, and set them loose straight away. In co-op your beast only goes after
  bots.
- **Smedley Butler, in cave talk**: the Marine general with two Medals of Honor who wrote *War
  Is a Racket* (1935) has thoughts on all this bonking. His lines, put into caveman, turn up:
  - at the bottom of the lobby (tap for another)
  - on the YOU GO SLEEP screen
  - on every end-of-round screen
  - and from the bots: as their last words, when the gunpowder ages arrive, now and then
    mid-fight, and a lot while the world ends

  Bot quotes show in the kill feed, credited to him. Grunt 6 lets you say WAR IS RACKET! too.
  The lines and the originals they come from are in `BUTLER` in `shared/constants.js`.

### Roast meat and magic mushrooms

- **Roast meat**: every campfire has a roast turning on a spit. When you're hurt, stand by the
  fire and press **E** (GRAB on phones) to eat it for **+45 life**. Then a new one has to cook
  for 30 s: it starts pink and browns as it cooks. You can't waste it at full life. Hurt bots
  head for a ready roast too.
- **Magic mushrooms**: there are only six on the planet, one of each kind, glowing in their
  color with a pulsing ring. Walk over one to eat it. The prompt tells you what you're standing
  next to, and they show on the radar. An eaten one grows back somewhere else 25–40 s later.
  Smarter bots eat any they pass near.

| Mushroom | Buff | Effect | Lasts |
| --- | --- | --- | --- |
| Red Rage Cap | BIG STRONG | Hits 50% harder (melee and ranged) | 15 s |
| Blue Zoom Cap | FAST FEET | Run 40% faster | 15 s |
| Gold Rock Cap | ROCK SKIN | Take half damage | 15 s |
| Purple Hop Cap | BOING | Jump way higher | 20 s |
| Green Mend Cap | REGROW | +5 life every second | 10 s |
| Orange Zip Cap | QUICK HANDS | Swing faster, ammo comes back 2× as fast | 15 s |

Active buffs show as colored chips under your life bar with the seconds left, and buffed
cavemen sparkle in that color.

### The Businessman

On a marble-and-gold podium at the bottom of the planet stands Mammon in a suit, Smedley
Butler's war profiteer made flesh. Nothing you do can hurt him; spears just stick in his podium
("TOO BIG TO FAIL."). Every bonk on the planet is profit to him: 25 shiny rocks per knockout and
100 per new age. His sign keeps the total, and a heap of gold coins grows at his feet.

He gets fatter as the round goes on (with the ages in Do Time and co-op, and with every bonk),
and picks up his trimmings as he swells: a gold watch chain, a top hat, a **monocle**, gold
**chains** with a medallion, a cigar, and money bags. At the very end his suit turns to gold
and his eyes glow red. He turns to watch you and laughs. He gloats in a gold speech bubble
when cavemen fall ("ME SELL SPEARS TO BOTH TRIBES."), cheers each new age, and the round-end
screen tells you how much he made while you were bonking each other.

**The end of the world gets him too.** When the Do Time finale starts he says "ME HAVE
BUNKER." It doesn't help. About 5.5 s in, one of the falling rocks, lava bombs or ice chunks
lands right on his podium (or the flood reaches him). He jolts with his eyes crossed out and
his hat flying off, says **"BURY ME WITH MY MONEY."**, and goes over onto his back with his legs
in the air. His money bursts out of him and out of his money bags, and the coins bounce down the
steps and across the grass, more of them the more he made. His sign turns to "R.I.P. THE
BUSINESSMAN · BURIED WITH N SHINY ROCKS", and the round-end screen says they buried him with
it. He's back, thin again, in the next Stone Age. (Forever Stone never ends, so there he never
dies; in co-op the round ends when the tribe is wiped, and he outlives you.) The lines are in
`MAMMON` in `shared/constants.js`.

### Weapon types

| Weapon | Age | Feel | Special |
| --- | --- | --- | --- |
| Big Bone | Stone | Medium | Big knockback |
| Club | Stone | Medium-slow | Stuns (target sees stars) |
| Stick | Stone | Very fast, weak | You run faster |
| Mammoth Tusk | Stone | Longest reach, narrow | Bleed |
| Rock-on-Stick | Stone | Heavy, short | High damage |
| Old Fish | Stone | Fast, weak | Stink slows the target |
| Dino Femur | Stone | Very slow, huge | Massive knockback, widest arc |
| Jawbone | Stone | Quick | Steals life |
| Antler | Stone | Quick, very wide | Hits several cavemen |
| Meat Bone | Stone | Medium | Each hit heals you |
| Bronze Dagger | Shiny Rock | Fastest, short | Built-in crits |
| Short Sword | Shiny Rock | Quick, solid | Reliable all-rounder |
| Khopesh | Shiny Rock | Medium, wide | Big bleed |
| Longsword | Shiny Rock | Long reach | Strong hits |
| Big Shiny Stick | Shiny Rock | Very slow, huge | Hits everyone around you |
| Obsidian Paddle | Shiny Rock | Medium | Bleed and a short stun |
| Glow Stick | Zap | Fast, wide, very strong | Light sword |
| Zap Club | Zap | Medium | Long stun |

Prefixes, from junk to legendary: Cracked, Soggy · Mighty, Swift, Long, Spiky (adds bleed),
Feathered (run faster) · Ancient, Lucky (crits) · **Ooga's** (gold glow, better at everything).

## Project layout

```
Procfile, app.json   Heroku process type and app manifest (one web dyno)
server.js            HTTP static server + WebSocket front door: makes rocks (lobbies) by code,
                     puts each socket on its rock, ticks every rock on one clock
room.js              One rock's game: projectiles, hits, armor, Do Time clock, rules, hazards, bots
shared/constants.js  Tuning: ages, ranged weapons, armor, bot levels, melee weapons, names
shared/math.js       Sphere-surface movement, collisions, projectile physics
public/index.html    Page shell, HUD, lobby, council and round-end markup
public/style.css     Carved-stone UI
public/js/main.js    Client: networking, local movement, camera, events, rules UI
public/js/world.js   Planet, volcano, trees, huts, skeletons, campfires, sky, pterodactyls
public/js/caveman.js Caveman model and animation (spear and bow poses, armor, headdress)
public/js/weapons.js Weapon, sword, bow, arrow, spear and armor models
public/js/fx.js      Particles, smoke, ground decals, floating text
public/js/audio.js   Synthesized sound effects, tribal drums, speech grunts
public/js/hud.js     HUD, era banner, radar, scoreboard, round-end screen
public/js/input.js   Keyboard and pointer-locked mouse (touch controls feed the same state)
public/js/touch.js   Phone controls: thumbstick, buttons, drag-to-aim, tilt aiming
public/js/settings.js Player settings (sound, controls, screen) and the settings panel
public/js/beasts.js  Killstreak beast models and animation: attack dogs, mammoth, T-Rex
public/js/mammon.js  The Businessman: model, fattening stages, coin heap and profit sign
```

The client is authoritative over its own movement. The server owns projectiles, damage,
health, armor, ammo, the Do Time clock, boulders, the volcano and the bots. Everything runs at 60 Hz
on the server, and snapshots go out at 20 Hz with a server timestamp. Clients draw other cavemen 120 ms
behind the server's clock and interpolate between snapshots, which hides internet jitter. Your
own shots and movement are predicted locally, so they feel instant even with lag. Attacks carry
the server time the shooter was looking at, and the server keeps 0.3 s of position history to
check hits against where targets stood at that moment (lag compensation).

The server gzips and caches static files (three.js is cached for a week), rate-limits each
socket, and on SIGTERM tells clients it is restarting before closing.
Open the game with `?debug` to get `window.__ss` in the console for poking at state.
