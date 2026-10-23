// The offline rock: room.js, the game the server runs, running here in the browser instead, on
// the same 60-a-second clock. It does what server.js does for one socket: answers pings, puts the
// page on the rock (made with the rules it asks for), and passes everything else to the rock.
import { createRoom, cleanRules } from '../room.js';
import * as C from '../shared/constants.js';

console.log = () => {};   // (room.js tells the server's log about every join and age; nobody's reading here)

const ROOM = 'OFFLINE';
const START = { mode: 'dotime', botLevel: C.BOT_LEVEL_DEFAULT, bots: 4, monsters: C.MONSTER_LEVEL_DEFAULT };
const client = { ws: { readyState: 1, send: data => postMessage(data) }, pid: 0 };
let room = null;

const reply = msg => postMessage(JSON.stringify(msg));

onmessage = e => {
  let m;
  try { m = JSON.parse(e.data); } catch { return; }
  if (!m || typeof m.t !== 'string') return;
  if (m.t === 'ping') reply({ t: 'pong', ts: m.ts });
  else if (m.t === 'room') pickRoom(m);
  else room?.handleMessage(client, m);
};

// { t: 'room', ... }: onto the one rock there is (made now if it isn't there yet), or off it
function pickRoom(m) {
  if (m.leave) {
    room?.detach(client, false);
    room = null;
    return;
  }
  room ||= createRoom(ROOM, {
    // (never public: there's nobody else here to find it)
    rules: cleanRules({ ...m.rules, open: 0 }, START), maxPlayers: 1, eraSeconds: C.DOTIME.eraSeconds, peaceSeconds: C.PEACE.seconds,
  });
  reply({ t: 'room', code: ROOM });
  room.attach(client);
}

// one clock, like the server's: catch up after a slow moment, but not forever
const DT = 1 / C.TICK_HZ;
let last = performance.now() / 1000, acc = 0;
setInterval(() => {
  const t = performance.now() / 1000;
  acc += Math.min(t - last, 0.25);
  last = t;
  while (acc >= DT) {
    acc -= DT;
    room?.tick();
  }
}, 8);
