# War is Racket

Multiplayer caveman spear-throwing on a tiny planet. Ooga booga.

You run around a small sphere wearing an animal pelt, throwing spears that arc under the
planet's gravity, bonking other cavemen with a random melee weapon, and dodging rolling
boulders and lava bombs from the volcano at the north pole. In **War mode** history
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
node server.js --mode=classic         # Forever Stone instead of War mode
node server.js --bots=6 --bot-level=10 # fill to 6 cavemen with level 10 (Sabertooth) bots
node server.js --era-seconds=20       # quick War mode rounds (20 seconds per age)
npm run nobots                        # humans only
PORT=8080 node server.js              # different port (PowerShell: $env:PORT=8080; node server.js)
```

Once people are playing, each rock's **chief** changes its rules in-game (see Planet rules below).

## Rocks (lobbies)

One server runs any number of separate games at once. Each one is a **rock**: its own planet,
cavemen, bots, War mode clock, chief and rules, found by a 4-letter code. A rock is **public**
(anyone can find it and join) or **private** (only people with its code or link).

- **QUICK PLAY** puts you on the busiest public rock that has room, so you play with whoever
  else is on. If there isn't one, it makes a new public rock for the next person to find.
- **OPEN ROCKS** lists every public rock, busiest first: its code, mode, the age (or wave, or
  peace), whose rock it is (the chief) and how many people are on it, e.g. `KPTX · WAR MODE ·
  ZAP AGE · CHIEF THAG · 3/12`. The list keeps itself up to date; tap one to go there.
- **MAKE NEW ROCK** rolls a fresh code (no vowels, so it never spells anything). The
  **PUBLIC / PRIVATE** switch next to it picks which (it remembers your pick). The address bar
  becomes the rock's link, e.g. `https://my-war-is-racket.herokuapp.com/KPTX`.
- **The code is big** in the lobby, ready to read out. **COPY LINK** (**SHARE LINK** on phones)
  sends the link, and **▦ QR CODE** shows a QR code of it: friends point a phone camera at it
  and they're on your rock. In a game, the code shows under the radar, and the QR code is on
  the pause screen (**▦ ROCK**), or under ☰ on phones (**▦ ROCK CODE**).
- Friends open that link, scan it, or go to the bare URL and type the code into **JOIN ROCK**.
  Pasting the whole link into the code box works too.
- **ROCK IS: PUBLIC / PRIVATE** is one of the rock's rules: the chief can switch it at any time
  (everyone's told), like the mode. It's on the scoreboard too (`ROCK CODE KPTX · PUBLIC`).
- **OTHER ROCK** in the lobby leaves for a different one. The code also shows on the scoreboard
  (Tab, or ☰ on phones) so you can read it out mid-game.
- A rock closes as soon as nobody is on it or watching its lobby, but its link keeps working:
  whoever opens it next (a reload, or a friend arriving after everyone left) gets a fresh
  planet under the same code, with the mode and bots it had (remembered for 6 hours). After a
  server restart, everyone who was on a rock reconnects onto the same code with the rules it had.
- Codes keep games apart; they aren't passwords. A wrong code is answered slowly so guessing
  one takes a while. Private rocks never show in the list, and `/health` lists no codes at all.
  A link to a code nobody has used makes a private rock.

**💚 DO GOOD FUND**, at the bottom of the lobby, opens a $1 donation to the War is Racket Do Good
Fund on Stripe, in a new tab (from the installed app, in the browser). The link is
`DO_GOOD_FUND` in `public/js/main.js`.

## The app, and playing offline

War is Racket installs like an app and plays with no internet, against bots.

- **⬇ GET THE APP** shows at the bottom of the lobby when the browser can install it (Chrome,
  Edge, Android). One tap puts it on the home screen or desktop, and it opens like any app. On an
  iPhone or iPad the button says how instead: in Safari, Share → *Add to Home Screen*.
- On a computer the app opens in a window of its own, with the usual title bar (**F11** for full
  screen and back). **⏻ EXIT TO DESKTOP** (in the lobby, on the pause screen and in settings,
  only in the installed app) closes it: press it twice, like QUIT. If the browser won't let the
  game close its own window, the button says to press **Alt+F4** (**⌘Q** on a Mac). On phones
  the game goes full screen when you start playing.
- **PLAY OFFLINE** (under JOIN ROCK) puts you on your own rock in the browser: you and the bots,
  no server and no link to share. **GO ONLINE** goes back to the server's rocks.
- If there's no signal, or the server can't be reached, when the page opens, the game goes
  offline by itself and says why.
- The first visit keeps a copy of the whole game (about 3.5 MB: page, scripts, three.js,
  fonts, icons), so it opens with no connection, installed or just bookmarked. Online it
  always asks the server first, so you never play an old version. If the server doesn't
  answer within 6 seconds, it uses the copy.
- Installing and the offline copy need `https://` (the Heroku URL is fine) or `localhost`.
  Over plain `http://` on your Wi-Fi the game still plays, but it can't be installed and needs
  the server.

How it works: `public/sw.js` is the service worker. server.js sends it out with a version (a
hash of every file) and the list of files to keep, so each deploy refreshes the copy by itself.
Offline, `public/js/offline-worker.js` runs `room.js` (the same game code the server runs) in a
Web Worker. `public/js/offline.js` stands in for the WebSocket, so the client plays it exactly
as it plays the server.

## Deploy to Heroku

The page and the game's WebSocket share one port, so Heroku's router handles both and
players connect with `wss://` automatically. From this folder:

```
git init
git add .
git commit -m "War is Racket"
heroku login
heroku create my-war-is-racket          # pick any free name
git push heroku HEAD:main
heroku ps:scale web=1
heroku open
```

Make a rock and send friends its link (`https://my-war-is-racket-xxxx.herokuapp.com/KPTX`), and
everyone lands on the same planet while other groups play on their own rocks. To ship changes
later: `git commit -am "more ooga"` then `git push heroku HEAD:main`.

Settings (optional), e.g. `heroku config:set BOT_LEVEL=7 ERA_SECONDS=120`:

| Config var | Flag | Default | What it does |
| --- | --- | --- | --- |
| `MODE` | `--mode` | `dotime` | `dotime` (War mode), `plough` (Peace mode), `classic` (Forever Stone) or `coop` (Tribe vs Bots) |
| `ERA_SECONDS` | `--era-seconds` | 45 | Length of each War mode age |
| `PEACE_SECONDS` | `--peace-seconds` | 180 | Peace mode: time before each vote to keep going |
| `BOT_LEVEL` | `--bot-level` | 1 | Bot brains, 1–10: 1 wanders around and lags, 5 is a fair fight, 10 barely misses |
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
| Mouse | Turn and aim (click the game to capture the mouse, Esc frees it). Bullets, lasers, crossbow bolts and rockets go to whatever is under the crosshair, near or far (the crosshair turns red if something's in the way of your hand). Spears, arrows, stones and tomatoes fly in a curve: look up to throw further (up to a point: higher than that is a lob), down to throw shorter, and the dotted arc shows where it lands, in line with the crosshair |
| Left mouse / F | Bonk with your melee weapon (right mouse when left-handed) |
| Hold right mouse | Charge a spear, draw a bow or steady a musket (a dotted arc shows where it lands), then release. Guns and lasers fire while held (left mouse when left-handed) |
| Space | Jump (you can hop over boulders if you time it) |
| E | Swap weapons at a glowing totem, put on armor, (when hurt) eat the roast at a campfire, or talk business with the Businessman at his podium. In peace mode, use the town: the doctor, the range shed, the duel rack, the tailor, cast, hook and reel in at a pond (tap E fast to reel), dance or play the drums at the bonfire, pick gear in the Dark Forest's penumbra |
| Q | Killstreak beast: call it, then aim and Q again to send it |
| 1–6 | Grunt: OOGA!, BOOGA!, UNGA BUNGA!, ME SMASH!, ME HUNGRY., WAR IS RACKET! |
| Enter | In peace mode: talk, one syllable per word |
| Tab | Scores (with the rock code), plus your weapon's full stats on its card |
| C | Tribe council (planet rules) |
| V | Switch the view: over the shoulder (3rd person) or through your caveman's own eyes (1st person), gliding between them |
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

The drums play the whole time, from the lobby on. Browsers don't let a page make sound until you
click, tap or press a key, so if yours holds it back they start with your first click anywhere
in the lobby. In the lobby you only hear the drums; the bots fighting on the planet behind it
stay quiet until you join.

| Section | Settings |
| --- | --- |
| Sound | Sound on/off (M), all sound (starts at 65%), bonks & booms, drums on/off (N), drum loudness, caveman voices (starts at 50%; 0 turns the spoken grunts off) |
| Controls | Mouse speed (drag speed on phones), flip up/down look, handed (right / left). Phones also get tilt aim (off by default / soft / normal / wild), flip up/down tilt and buzz |
| Screen | Graphics (G), view (V: 3rd or 1st person), view width (field of view, 50–95°), screen shake, screen flashes (red hurt flash, age glow, end-of-world whiteout), damage numbers, FPS counter, show ping (your latency under the radar: green under 90 ms, yellow under 180, red above; off to start) |

**Handed**: right-handed (the default) bonks with left click and throws with right click, and your
caveman throws with his right hand and clubs with his left. Left-handed swaps both: right click
bonks, left click throws, and your caveman is the mirror image, throwing with his left hand. Your
shots come out of that side, the camera moves to that shoulder, and everyone else sees the hands
swap. About one bot in ten is left-handed too.

**View** (V, or VIEW under Screen): **3rd person** (the default) looks over your caveman's shoulder;
**1st person** looks through his own eyes. Your own caveman is out of the way in 1st person, you
can look further up and down, and shots still go where the crosshair is. Knocked out, the camera
floats out of your head so you can see yourself down. Whichever view, **coming into the world and
waking up** start with a blink through your own eyes; in 3rd person the camera then draws back
over your shoulder as they open.

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
| ☰ | Scores (with the rock code) and your weapon card with its full stats, plus ⚙ settings, ⚑ tribe council (only for the chief) and ✕ quit |

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
- Double-tapping or pinching never zooms the page, and the game keeps its size when the
  keyboard comes and goes (on iPhones and iPads too).

## War mode

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

## Peace mode

**No war at all.** Every round starts in **PEACE TIME**: weapons are hoes, **nobody gets killed**
(knocked out, you just **go to sleep** for 10 seconds and wake up on the same spot), and the
whole town opens up within seconds, so everything below is there to do from the start:

- **Plant**: the attack button (left click / F, PLANT on phones) puts a seed in the ground just
  in front of you: wheat, corn or pumpkin. Crops grow (15 to 30 s) and sway when they're ripe.
- **Harvest**: walk over a ripe crop to pick it. Its food (1 to 3) goes into the tribe's shared
  store, shown on the age panel. Bots farm too: they plant now and then and pick what's ripe.
- **Build**: the throw button (right click, BUILD on phones) builds in front of you, paid for
  out of the store: a **fence** (2 food), a **hut** (6) or a big **stone head** (12). **Q**
  (NEXT on phones) picks which. They face whoever built them, and they're solid.
- **Vote**: when the time is up (3 minutes, `PEACE_SECONDS`) everyone votes **KEEP FARMING?**
  with Y / N or the buttons. More yes than no gives another stretch; anything else ends the
  round with a **HARVEST FESTIVAL** ranking who picked the most food and built the most. Then a
  fresh planet, the fields, buildings and town gone, and a new peace with a new town.

### The town

As a round starts **the planet grows** (radius 30 to 40, over 5 seconds), and the town opens
up on the new ground straight after, near wherever people are: a **doctor**, a **target range**,
a **duel ring**, a **tailor**, a **fishing pond**, a **hot spring** and a **bonfire**, then another
range and another pond, and somewhere out of town the **Dark Forest** takes root. Each has a
floating sign and shows on the radar as a square (the forest as a dark green patch, its true
size); stand in its circle to use it.

**Every time the tribe votes to keep farming, the planet grows again**: 10 more each time (40, 50,
60...), up to 80, with another pond, another doctor, another bonfire and another hot spring on the
new ground, and room for the forest to spread further. The shops keep their size as it grows
under them. A new round starts back at the usual 30.

- **Shells** 🐚 are the money. Everyone gets 3 when a peace starts (they're shown under your
  health) and earns more: **1 for every crop you pick** (the food still goes to the tribe), 1 for
  every target hit, 3 for every duel won, fish, dancing and monsters. Your shells stay with you
  from round to round.
- **Doctor**: **E** (HEAL on phones) gets you all better for **1 shell**.
- **Target range**: **E** at the range shed (WEAPONS on phones) opens its rack: every age's ranged
  weapon (spear, bow, longbow, boom stick, bang stick, zap stick) and four you only get here, never
  in a war: a **slingshot**, a **crossbow**, **tomatoes** (they splat red on whatever they hit) and
  a **bazooka** (its rockets go off where they land and rattle every target in the blast). Take one
  and you're practicing: keep it, go anywhere, shoot from anywhere (only the targets count), and a
  note on screen reminds you to **take it back to the range shed** to stop (E there again to swap
  it or hand it back). A hit on a target makes it shake and earns a shell (each target pays at most
  once a second, so a quick gun can't print money). Spears and arrows stick in the target where
  they hit and shake with it; walk up to it to pull them out again. Musket balls and bullets punch
  through the straw. Without a practice weapon, nobody throws or shoots in peace.
- **Duel ring**: inside the ropes your hoe becomes a padded **practice club**, and you can bonk
  anyone else in the ring. **E** (WEAPON on phones) opens the **weapon rack**: pick any weapon of
  any age (a Dino Femur, a Longsword, a Glow Stick...), and **it's yours to keep**: take it out of
  the ring and anywhere in the peace (into the Dark Forest, say), until you hand it back at the
  rack (**✋ HAND IT BACK**) or the peace ends. A note on screen says what you've got and where it
  goes back. Your hands are full while you carry it, so it's no planting until you hand it back,
  and out of the ring it only swings at the air (and at monsters). Bots grab whatever's on the
  rack. **Nobody goes below 1 HP in a duel**: knocking someone down to 1 wins the bout and 3
  shells, and the loser had better see the doctor.
- **The Dark Forest**: one a round, a wood of dead trees, crooked gravestones and drifting wisps
  that starts small (two rings across) and **grows a ring at a time** (every minute) out from the
  same spot, as far as the planet has room for, up to four rings. The deeper you go, the worse it
  gets, each kind of monster keeping to its own ring:

  | Ring | Who lives there | Each one pays |
  |---|---|---|
  | The edge | **Skeletons** (quick, rattly) and **zombies** (slow and tough; a bite slows you down) | 2 🐚 |
  | Deeper in | **Ghosts** (a spook stuns you) and **bats** (small, fast, nip nip nip) | 3 🐚 |
  | Deeper still | **Vampires** (a bite drinks your life back into them, and they pop up behind you) and **sleep demons**: tall, black, stooped, arms down to their knees, and a pair of googly eyes rattling about in their heads. Their long arms reach a long way, and a grab **freezes you stiff** for a moment | 5 🐚 |
  | The heart | **Werewolves**: big, fast, and they leap at you from far off | 10 🐚 |

  The screen says when you've gone a ring deeper (and who's in it), and the forest shows on the
  radar as a dark patch. They never leave their ring, but they go for anyone who comes in, and
  another comes back a while after one's slain. Inside, your hoe becomes a **torch**; practice and
  rack weapons work on them too (a bazooka does nicely). If they knock you out, you go to sleep
  for 10 seconds where you fell (see below).
- **The penumbra**: the grey band right round the forest's edge. **E** there (GEAR on phones)
  opens the **gear screen**: pick a **melee weapon** (anything on the duel ring's rack) and a
  **ranged one** (anything in a range shed) to take in. It shows your own caveman holding both,
  going at a straw dummy at each weapon's **real attack speed** (practice numbers fly off it),
  next to their stats: damage, how often it swings or shoots, reach, knockback, sweep, run speed,
  shot speed, ammo and anything special (crits, bleeds, blasts...), counting any gold might you've
  got. **TAKE THEM** and they're yours to keep, the same as a
  rack or range pick (hand them back at the penumbra, the ring or a range shed).
- **Motes**: a slain monster sometimes leaves a glowing **mote** behind (more often the deeper it
  was; a werewolf always does). Walk into one to take it before it fades (30 s). The offensive
  ones: **FURY** (hit harder, 20 s) and **SWIFT** (quicker, 20 s); the defensive ones: **WARD**
  (take less, 20 s) and **MEND** (life comes back, 10 s). Now and then one is **gold**, and gold
  ones you keep **for good** while you're on the rock, up to five of each: **GOLD MIGHT** (hit 6%
  harder) and **GOLD HIDE** (take 6% less). They show as chips under your health, and they only
  count in peace.
- **Tailor**: **E** (SHOP on phones) opens the counter: straw hat (2), flower crown (3), top hat
  (5), gold crown (10), red or blue cape (3), gold cape (8). Everyone sees what you wear, it stays
  on in later rounds, and anything you've bought you can put back on for free (or take off).
- **Fishing pond**: stand on the sandy bank and press **E** (FISH on phones) to cast: a red
  bobber goes out on the water. Wait. When a fish bites the bobber dips, the screen says
  **BITE!**, and you have about a second to press **E** again (HOOK! on phones) to hook it. Too
  soon and it swims off; too slow and it gets away. Then **reel it in**: tap **E** (REEL! on
  phones) over and over to fill the bar before the fish pulls it back down, and every kind fights
  its own way:

  | Fish | How to reel it | Worth |
  |---|---|---|
  | **Minnow** | A few taps and it's out | 1 🐚, 1 food for the tribe |
  | **Trout** | Steady taps: tap too fast and the reel slips, tap too slow and it swims back | 2 🐚, 2 food |
  | **Big pike** | A fighter: it pulls, then tires, then pulls. Reel while it tires; tap while it pulls and the line strains, and too much strain **snaps** it | 3 🐚, 4 food |
  | **Golden fish** | Pulls back hard all the time: mash as fast as you can | 10 🐚, and everyone hears about it |
  | **Old boot** | Heavy, but it doesn't fight: just keep tapping | Nothing |

  The clock runs from the hook, and when it's out the screen says how long it took **to the
  millisecond**, with your best for that kind of fish (kept in your browser). Leave a line out too
  long and they give up on you.
- **Hot spring**: a steaming pool in a ring of stones. Stand in it and your life comes back,
  **3 a second**. Free, but slower than the doctor.
- **Bonfire**: a big fire in a dance circle, with log seats and drums. **E** (DANCE on phones)
  and you dance; walking off stops it. Dancers earn shells, and the more dance together the
  quicker: a shell every 8 seconds alone, every 4 with two, every 2 with four, up to five
  dancers. Everyone sees you dance.
- **The drums**: walk up to one of the bonfire's two drums and **E** (DRUMS on phones) to play
  them: the attack button (left click / F, **BOOM** on phones) hits the big low one and the throw
  button (right click, **TAK**) the small high one. Everyone nearby hears what you play, and a
  drummer counts for the band the same as a dancer (keep playing to keep earning). Walk off to
  stop. While you're at the bonfire **everything else goes quieter, to half**: the music, the
  sounds, the speech. The drums don't.
- **It's still a dangerous world.** The volcano erupts again, boulders still roll, and now and
  then a **sky rock** falls near somebody (a red ring shows where, and the feed says LOOK UP!).
  They hurt. Below 40 HP you **limp** (walk slower) until the doctor fixes you up.
- **Going to sleep**: in peace, whatever knocks you out (a monster, a sky rock, a boulder, the
  volcano) only puts you to sleep. You lie where you fell for **10 seconds** (a countdown says
  so), then wake up **on the same spot**, blinking (a quick snap, a double blink, a groggy one, a
  flutter or a squint, never more than half a second) through your own eyes before the camera
  draws back over your shoulder, with your gear still on you. Being knocked
  out doesn't count as a death on the scoreboard. (A duel still stops at 1, and so does hunger.)
- **Hunger**: in peace your life slowly runs down, a point every 1.5 seconds (**HUNGRY** under
  your health), never below 1. But just as it's about to run down to 1, **a stranger** in a
  hooded cloak walks over from somewhere nearby with food in hand, gives you +60 life with a kind
  word, and wanders off again (no shells asked). The same goes for anyone a lost duel leaves at
  1: a stranger always comes. The Businessman can't stand it.

Bots use the town too: they see the doctor when they're hurt and can pay (and soak in a hot spring
when they can't), buy hats when they're rich, take practice weapons to the ranges, duel each other
in the ring, go fishing (they're not always quick enough on the hook, and the fighters and golden
fish get away from them more often than not) and dance round the bonfire, where a crowd draws a
crowd. (They don't go looking for monsters, but one that wanders into the forest gets a fright.)

### Peace chat

In peace **the tribe can talk**, but **only one syllable per word**, and the chat box says so.
**Enter** opens it (**💬** on phones), Enter says it, Esc puts it away. Under the box, two grey
examples show how to say a long word in short ones (`"BANANA"? SAY "A LONG, SUN-LIKE FRUIT"`,
`"DOCTOR"? SAY "THE ONE WHO HEALS"`; there are 26, in `SAY_IT` in `shared/chat.js`). As you type,
any longer word is pointed out (**TOO LONG: BANANA. ONLY ONE SYLLABLE PER WORD.**), the example for
it comes first if there is one, and the line can't be sent until it's gone; the server checks
again. What's said shows in the chat log, in a bubble over
the speaker's head, and is read out in a caveman voice to anyone nearby. Bots chime in now and
then (**GROW, CORN, GROW.**), and so does the stranger. One line every 1.5 seconds, up to 80
letters; rude words come out as **GRR**. When the peace ends, so does the talking.
**PEACE CHAT** in the settings turns it off.

The syllable counter (`shared/chat.js`) is rules, not a dictionary: it counts the vowel sounds
and knows the usual silent ones (the e in "make", the ed in "jumped", the es in "takes"). It
gets nearly all everyday words right, but it can miss now and then; the words it's known to
get wrong are listed at the top of the file, to add to.

The Businessman hates all of it: no war, no profit, and he wastes away for as long as the peace
lasts (though he does perk up when the first shop opens).

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
  so on up to lasers), with the same gear changes as War mode. There's no end-of-the-world
  disaster.
- **Falling down**: if you're knocked out mid-wave you stay down. When the last bot of the wave
  falls, **WAVE DONE**: the fallen wake up next to a friend, everyone still standing heals to
  full and restocks, and the next wave comes 8 s later.
- **Tribe wiped**: if every human is down at once, the results show how far the tribe got, and
  12 s later it starts over from wave 1.

## Planet rules and bot difficulty

The human who's been on the planet longest is the **chief** (feather headdress, marked in the
scoreboard). The chief opens the **tribe council** with C to change:

- **Mode**: War mode, Peace mode, Forever Stone or Tribe vs Bots (co-op). Changing it starts a new round.
- **Rock is**: public (in everyone's OPEN ROCKS list) or private (code or link only).
- **Bot brains**, from 1 to 10:

  | Level | Name | What they're like |
  | --- | --- | --- |
  | 1 | Pebble Brain | Wanders around. Freezes mid-step every few seconds and walks in stuttery stop-go jerks, like a caveman on a bad connection. Usually forgets to fight, only notices you up close, swings rarely, throws almost never and wildly, walks into boulders (the default) |
  | 2 | Sleepy | Slow, wild aim, an occasional freeze, sometimes wanders off |
  | 3 | Dozy | Misses most throws, slow to swing, rare freezes |
  | 4 | Clumsy | Tries hard, not very good |
  | 5 | Normal | A fair fight |
  | 6 | Hungry | Better aim, shoots more often |
  | 7 | Smart | Tight aim, leads moving targets, goes after armor and better weapons |
  | 8 | Cunning | Quicker, sneakier, good aim |
  | 9 | Dire Wolf | Deadly aim, and bats your spears back at you |
  | 10 | Sabertooth | Almost never misses, reacts instantly, runs faster than you |

- **Bot fill**: bots join until the planet has this many cavemen and leave as humans arrive.

Every rock has its own chief and rules. If nobody is playing on a rock yet, its lobby shows the
same controls, so whoever makes the rock (or arrives first) sets the rules and becomes chief. The
rules start open in the lobby, right above **OOGA BOOGA!** (click **RULES** to fold them away);
on a short screen the button stays at the bottom and the rules scroll under it.

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

**He dresses for the times.** Each age he twirls into the war profiteer of that era:

| Age | Outfit | Carries | Hat (once he can afford one) |
| --- | --- | --- | --- |
| Stone | Leopard-pelt suit with a necktie | A ledger carved in stone | Fur hat |
| Bendy Stick | Lincoln-green tunic | Coin pouch | Feathered cap |
| Shiny Rock | Toga with a purple sash, bare legs | Scroll | Gold laurel wreath |
| Boom Stick | Redcoat, cravat, powdered wig | Treasure chest | Tricorn |
| Bang Bang | Dark three-piece suit, red tie | Briefcase | Top hat |
| Zap | White tech suit, glowing tie | Glowing tablet | Light visor |

Forever Stone stays in the Stone Age, so there he's always in the pelt suit. Co-op moves him
through the ages with the waves. When the world starts ending he gears up for it: a **hard
hat** for the falling rocks, a **gas mask** when the mountain blows, a **swim ring** for the
flood, **earmuffs and a scarf** for the big cold. He dies in it anyway. In co-op, when the
tribe is wiped, he raises a glass of champagne.

**He looks like you.** His skin is the skin you picked for your own caveman: it follows your
pick live in the lobby, then your caveman's once you're playing. Everyone sees their own
match, so nobody gets to picture the profiteer as somebody else.

He gets fatter as the round goes on (with the ages in War mode and co-op, and with every bonk),
and picks up his trimmings as he swells: a gold watch chain, his hat, a **monocle**, gold
**chains** with a medallion, a cigar, and money bags. At the very end his suit turns to gold
and his eyes glow red. He turns to watch you and laughs. He gloats in a gold speech bubble
when cavemen fall ("ME SELL SPEARS TO BOTH TRIBES."), cheers each new age, and the round-end
screen tells you how much he made while you were bonking each other.

**Talk business with him.** Walk up to his podium and press **E** (TALK on phones), and he
shares his thinking on war and profit: "WAR IS JUST PEACE WITH BETTER MARGINS.", "ME SELL TO
BOTH TRIBES. THAT CALLED DIVERSIFYING.", "THOUGHTS AND PRAYERS. AND AN INVOICE." There are 30
of these, and you hear every one before any comes round again. Some know how the round is
going ("PROFIT SO FAR: 0 SHINY ROCKS. DISAPPOINTING. BONK HARDER."). In peace mode he
has 10 sour ones instead ("CABBAGE NOT GO BOOM. CABBAGE BAD INVESTMENT."), and while the world
ends he gets in a last few ("ME SHORTED THE PLANET."). Only you see and hear his answer.

**The end of the world gets him too.** When the War mode finale starts he says "ME HAVE
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
room.js              One rock's game: projectiles, hits, armor, War mode clock, rules, hazards, bots
shared/constants.js  Tuning: ages, ranged weapons, armor, bot levels, melee weapons, names
shared/math.js       Sphere-surface movement, collisions, projectile physics
shared/chat.js       Peace mode: the chat's one-syllable rule (syllable counter), its tidying, and the examples
shared/layout.js     Peace mode: where a shop's parts go, so the server and clients agree as the planet grows
public/index.html    Page shell, HUD, lobby, council and round-end markup
public/style.css     Carved-stone UI
public/js/main.js    Client: networking, local movement, camera, events, rules UI
public/js/world.js   Planet, volcano, trees, huts, skeletons, campfires, sky, pterodactyls
public/js/caveman.js Caveman model and animation (spear and bow poses, armor, headdress)
public/js/weapons.js Weapon, sword, bow, arrow, spear and armor models
public/js/fx.js      Particles, smoke, ground decals, floating text
public/js/audio.js   Synthesized sound effects, tribal drums, speech grunts, the bonfire drums (and everything else at half by them)
public/js/hud.js     HUD, era banner, radar, scoreboard, round-end screen
public/js/input.js   Keyboard and pointer-locked mouse (touch controls feed the same state)
public/js/touch.js   Phone controls: thumbstick, buttons, drag-to-aim, tilt aiming
public/js/settings.js Player settings (sound, controls, screen) and the settings panel
public/js/beasts.js  Killstreak beast models and animation: attack dogs, mammoth, T-Rex; and the Dark Forest's skeletons, zombies, ghosts, bats, vampires, sleep demons (googly eyes and all) and werewolves
public/js/mammon.js  The Businessman: model, outfits per age, disaster gear, fattening stages,
                     coin heap and profit sign
public/js/farm.js    Peace mode: crops growing and the fences, huts and stone heads built in peace
public/js/town.js    Peace mode: the doctor, ranges, duel ring, tailor, the Dark Forest, ponds, hot springs and bonfires (and their drums)
public/js/gear.js    Peace mode: the penumbra's gear screen, your caveman trying both weapons on a dummy, and their stats
node_modules/qrcode-generator  The rock's QR code (served at /qr/, and kept for offline like three.js)
public/js/offline.js Playing offline: stands in for the WebSocket, talking to offline-worker.js
public/js/offline-worker.js  room.js running in the browser: your own rock, you and the bots
public/sw.js         Service worker: keeps a copy of the game so it opens with no connection
public/manifest.webmanifest, public/icons/  The installed app's name, icons and full screen
public/fonts/        The two fonts, kept here (not Google Fonts) so they work offline
```

The client is authoritative over its own movement. The server owns projectiles, damage,
health, armor, ammo, the War mode clock, boulders, the volcano and the bots. Everything runs at 60 Hz
on the server, and snapshots go out at 20 Hz with a server timestamp. Clients draw other cavemen 120 ms
behind the server's clock and interpolate between snapshots, which hides internet jitter. Your
own shots and movement are predicted locally, so they feel instant even with lag. Attacks carry
the server time the shooter was looking at, and the server keeps 0.3 s of position history to
check hits against where targets stood at that moment (lag compensation).

The server gzips and caches static files (three.js is cached for a week), rate-limits each
socket, and on SIGTERM tells clients it is restarting before closing.
Open the game with `?debug` to get `window.__ss` in the console for poking at state.
