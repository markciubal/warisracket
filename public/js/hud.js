import { TIER_COLORS, PLAYER, ARMORS, ERAS, MODES, DISASTERS, SHROOMS, BUILDS, CLOTHES, DUEL_WEAPONS, duelWeapon, RANGED, PRACTICE_WEAPONS } from '/shared/constants.js';
import * as M from '/shared/math.js';

const $ = id => document.getElementById(id);
export const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const clockText = s => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;

const TIER_LABEL = { junk: 'JUNK', common: 'NORMAL', good: 'GOOD', rare: 'RARE', legend: 'LEGEND OF OOGA' };

// Bars are scaled against roughly the best roll of any weapon.
const STAT_ROWS = [
  ['BONK', w => w.dmg, 75, v => v.toFixed(0)],
  ['SPEED', w => 1 / w.cd, 3.6, v => `${v.toFixed(1)}/s`],
  ['REACH', w => w.range, 3.8, v => v.toFixed(1)],
  ['KNOCK', w => w.kb, 24, v => v.toFixed(0)],
  ['RUN', w => w.speed, 1.3, v => `${Math.round(v * 100)}%`],
];

// A weapon's extras, in plain words.
export function weaponSpecials(w) {
  const s = [];
  if (w.stun) s.push('STUNS');
  if (w.slow) s.push('SLOWS');
  if (w.bleed) s.push('BLEEDS');
  if (w.leech) s.push('STEALS LIFE');
  if (w.heal) s.push(`HEALS ${w.heal}`);
  if (w.crit) s.push(`${Math.round(w.crit * 100)}% CRIT`);
  return s;
}

export class Hud {
  constructor() {
    this.root = $('hud');
    this.hpFill = $('hp-fill');
    this.hpText = $('hp-text');
    this.hpBar = $('hp-bar');
    this.chargeFill = $('charge-fill');
    this.statusEl = $('status-icons');
    this.wcCd = $('wc-cd');
    this.promptEl = $('prompt');
    this.centerEl = $('center-msg');
    this.killfeed = $('killfeed');
    this.vignette = $('vignette');
    this.radarCtx = $('radar').getContext('2d');
    this.spearIcons = [];
    this.rangedKey = '';
    this.centerTimer = 0;
    this.vignetteLevel = 0;
    this.flashScale = 1;      // "screen flashes" setting, 0..1
    this.lastStatus = '';
    this.lastPrompt = null;
    this.lastHp = -1;
    this.lastArmor = '';
    this.lastEra = '';
  }

  // One icon per shot for small loads (3 spears ... 8 arrows, 1 musket ball); a counter for magazines.
  setRanged(key, def) {
    if (key === this.rangedKey) return;
    this.rangedKey = key;
    this.ammoMax = def.ammo;
    const root = $('spear-icons');
    root.innerHTML = '';
    root.className = def.ammo > 10 ? 'counter' : { arrow: 'arrows', ball: 'balls', pebble: 'balls pebbles', tomato: 'balls tomatoes', rocket: 'rockets' }[def.proj] || '';
    this.spearIcons = [];
    this.counter = null;
    if (def.ammo > 10) {
      root.innerHTML = `<span class="count"></span><div class="mag"><i></i></div><span class="unit">${def.proj === 'laser' ? 'ZAPS' : 'BANGS'}</span>`;
      this.counter = { count: root.querySelector('.count'), fill: root.querySelector('.mag i') };
    } else {
      for (let i = 0; i < def.ammo; i++) {
        const el = document.createElement('div');
        el.className = 'spear-icon';
        const regen = document.createElement('div');
        regen.className = 'regen';
        el.appendChild(regen);
        root.appendChild(el);
        this.spearIcons.push({ el, regen });
      }
    }
    this.rangedHint = def.hint || 'HOLD RMB · THROW';
    this.setThrowButton(this.throwButton);
    $('spear-hint').classList.remove('used');   // a new kind of weapon: say how it works again
  }

  // the "HOLD RMB" hint goes once you've used that kind of weapon
  rangedUsed() { $('spear-hint').classList.add('used'); }

  // The weapon hints are written for right-handers (RMB throws); left-handed, it's LMB.
  setThrowButton(name = 'RMB') {
    this.throwButton = name;
    if (this.rangedHint) $('spear-hint').textContent = this.rangedHint.replace('RMB', name);
  }

  setArmor(armor) {
    const key = armor ? `${armor.type}:${Math.round(armor.dur)}` : '';
    if (key === this.lastArmor) return;
    this.lastArmor = key;
    $('armor-row').classList.toggle('hidden', !armor);
    if (!armor) return;
    $('armor-name').textContent = `${armor.name.toUpperCase()} · BLOCK ${Math.round(armor.block * 100)}%`;
    $('armor-name').style.color = ARMORS[armor.type]?.color || '#fff';
    $('armor-fill').style.width = `${Math.max(0, armor.dur / armor.maxDur) * 100}%`;
  }

  // Era banner: current age, how fast time is running and how long until the next age
  // (the last age counts down to a disaster nobody knows yet).
  setEra(game, left, foes = 0) {
    if (game.mode === 'coop') { this.setWave(game, left, foes); return; }
    if (game.phase === 'peace') { this.setPeace(game, left); return; }
    const timed = game.mode === 'dotime' || game.mode === 'plough';
    const era = ERAS[game.era];
    const last = game.era === ERAS.length - 1;
    const doom = game.phase === 'doom';
    const disaster = DISASTERS[game.disaster];
    let line;
    if (game.mode === 'classic') line = 'FOREVER STONE · NO TIME HERE';
    else if (game.phase === 'end') line = `NEW STONE AGE IN ${Math.ceil(left)}`;
    else if (doom) line = `EVERYTHING GONE IN ${Math.ceil(left)}`;
    else line = `${last ? 'SOMETHING BAD' : ERAS[game.era + 1].name} IN ${clockText(left)}`;
    // Ploughshares: is the peace holding this age?
    const calm = game.mode === 'plough' && game.phase === 'play' ? (game.calm ? 'calm' : 'broken') : '';
    const key = `${game.mode}${game.era}${game.phase}${game.disaster}${line}${calm}`;
    if (key === this.lastEra) return;
    this.lastEra = key;
    $('era-panel').classList.remove('peace');
    $('era-panel').classList.toggle('doom', doom);
    $('era-panel').classList.toggle('hurry', timed && game.phase === 'play' && last);
    $('era-calm').textContent = calm === 'calm' ? '☮ PEACE HOLDING' : calm === 'broken' ? '⚔ PEACE BROKEN THIS AGE' : '';
    $('era-calm').className = calm;
    $('era-name').textContent = game.mode === 'classic' ? MODES.classic : doom && disaster ? `${disaster.icon} ${disaster.name} ${disaster.icon}` : era.name;
    $('era-next').textContent = line;
    const frac = timed && game.phase !== 'end' ? 1 - left / (game.eraLen || game.eraSeconds) : 1;
    $('era-fill').style.width = `${Math.min(1, Math.max(0, frac)) * 100}%`;
    $('era-dots').innerHTML = timed
      ? ERAS.map((e, i) => `<i class="${i < game.era || doom ? 'done' : i === game.era ? 'now' : ''}" title="${e.name}"></i>`).join('')
        + `<i class="end ${doom ? 'now' : ''}" title="${disaster ? disaster.name : 'SOMETHING BAD'}">${disaster ? disaster.icon : '?'}</i>`
      : '';
  }

  // Ploughshares, in peace: the farming age, the countdown to the vote, and the tribe's food.
  setPeace(game, left) {
    const line = game.vote ? `VOTE NOW · ${Math.ceil(left)}` : `VOTE IN ${clockText(left)}`;
    const key = `peace${line}${game.food}`;
    if (key === this.lastEra) return;
    this.lastEra = key;
    $('era-panel').classList.remove('doom', 'hurry');
    $('era-panel').classList.add('peace');
    $('era-name').textContent = '🌾 PEACE TIME 🌾';
    $('era-next').textContent = line;
    $('era-fill').style.width = `${Math.min(1, Math.max(0, 1 - left / (game.eraLen || 1))) * 100}%`;
    $('era-dots').innerHTML = `<b class="food">${game.food} FOOD</b>`;
    $('era-calm').textContent = '';
  }

  // Ploughshares, in peace: what the throw button builds, what it costs, and the keys.
  setBuild(kind, food) {
    const def = BUILDS[kind];
    const key = `${kind}${food}`;
    if (key === this.lastBuild) return;
    this.lastBuild = key;
    $('build-what').textContent = `${def.icon} ${def.name} · ${def.cost} FOOD`;
    $('build-what').classList.toggle('poor', food < def.cost);
  }

  // One line of peace chat in the log (the last few, fading out after a while). note: a line
  // from the game itself, not from a caveman.
  chatLine(name, text, { mine = false, note = false } = {}) {
    const el = document.createElement('div');
    el.className = `chat-line${mine ? ' me' : ''}${note ? ' note' : ''}`;
    el.innerHTML = note ? esc(text) : `<b>${esc(name)}</b>${esc(text)}`;
    const log = $('chat-log');
    log.appendChild(el);
    while (log.children.length > 6) log.firstChild.remove();
    setTimeout(() => el.classList.add('old'), 15000);
    setTimeout(() => el.remove(), 16000);
  }

  // Shells: the money of the peace-time town (shown in peace only, by the CSS).
  setShells(n) {
    if (n === this.lastShells) return;
    this.lastShells = n;
    $('purse').textContent = `🐚 ${n} SHELL${n === 1 ? '' : 'S'}`;
  }

  // The tailor's counter: every hat and cape, and what pressing its button would do.
  // look: what I'm wearing now. wardrobe: CLOTHES keys I've bought.
  tailor(shells, wardrobe, look) {
    $('tailor-purse').textContent = `YOU HAVE 🐚 ${shells} · BOUGHT CLOTHES ARE YOURS, WEAR THEM ANY TIME HERE`;
    const rows = Object.entries(CLOTHES).map(([k, c]) => {
      const owned = wardrobe.includes(k), on = look[c.slot] === k;
      const [label, item, cls] = on ? ['TAKE OFF', c.slot, 'minor']
        : owned ? ['WEAR', k, '']
        : shells >= c.cost ? [`BUY · ${c.cost} 🐚`, k, ''] : [`${c.cost} 🐚`, '', 'poor'];
      return `<div class="shop-row${on ? ' on' : ''}"><span class="shop-name">${c.name}</span>`
        + `<button class="${cls}" data-item="${item}"${item ? '' : ' disabled'}>${label}</button></div>`;
    });
    $('tailor-items').innerHTML = rows.join('');
  }

  // The duel ring's weapon rack: the padded club and every weapon of every age. current: the
  // name of what I'm holding.
  // kept: the one I've taken to keep (DUEL_WEAPONS key), if any: it can go back on the rack
  rack(current, kept = null) {
    const AGE = { tool: 'PADDED', primitive: 'STONE AGE', sword: 'SHINY ROCK AGE', future: 'ZAP AGE' };
    $('rack-items').innerHTML = DUEL_WEAPONS.map(type => {
      const w = duelWeapon(type);
      return `<button class="rack-item${w.name === current ? ' on' : ''}" data-type="${type}">`
        + `<b>${esc(w.name.toUpperCase())}</b><small>${AGE[w.pool]} · BONK ${w.dmg}</small></button>`;
    }).join('') + (kept ? '<button class="rack-item stop" data-type=""><b>✋ HAND IT BACK</b><small>THE HOE AGAIN OUT OF THE RING</small></button>' : '');
  }

  // The range shed's rack: every age's ranged weapon, and the ones you only get here. current: the
  // practice weapon I've got (RANGED key), if any.
  shed(current) {
    const where = Object.fromEntries(ERAS.map(e => [e.ranged, e.name]));
    $('shed-items').innerHTML = PRACTICE_WEAPONS.map(k => {
      const w = RANGED[k];
      return `<button class="rack-item${k === current ? ' on' : ''}${w.peace ? ' only' : ''}" data-w="${k}">`
        + `<b>${esc(w.name.toUpperCase())}</b><small>${w.peace ? 'ONLY HERE' : where[k] || ''} · ${w.ammo} A LOAD</small></button>`;
    }).join('') + (current ? '<button class="rack-item stop" data-w=""><b>✋ HAND IT BACK</b><small>STOP PRACTICE</small></button>' : '');
  }

  // While I've got a practice weapon: where to take it back (null: none).
  practiceNote(text) {
    if (text === this.lastPracticeNote) return;
    this.lastPracticeNote = text;
    $('practice-note').classList.toggle('hidden', !text);
    if (text) $('practice-note').textContent = text;
  }

  // The vote to keep farming: open while game.vote; mine: 'yes' | 'no' | null.
  vote(game, mine) {
    const open = !!game.vote && this.root && !this.root.classList.contains('hidden');
    $('vote').classList.toggle('hidden', !open);
    if (!open) return;
    const key = `${game.yes}${game.no}${mine}`;
    if (key === this.lastVote) return;
    this.lastVote = key;
    $('vote-count').textContent = `${game.yes} YES · ${game.no} NO`;
    $('vote-yes').classList.toggle('on', mine === 'yes');
    $('vote-no').classList.toggle('on', mine === 'no');
  }

  // Co-op banner: which wave, how many bots are left and in what age; between waves, the countdown.
  setWave(game, left, foes) {
    const era = ERAS[game.era];
    let name, line, frac;
    if (game.phase === 'end') {
      name = 'TRIBE WIPED';
      line = `WAVE 1 AGAIN IN ${Math.ceil(left)}`;
      frac = 1;
    } else if (game.phase === 'break') {
      name = game.wave ? `WAVE ${game.wave} DONE` : 'GET READY';
      line = left > 0 ? `WAVE ${game.wave + 1} IN ${Math.ceil(left)}` : 'WAITING FOR TRIBE';
      frac = game.eraLen ? 1 - left / game.eraLen : 0;
    } else {
      name = `WAVE ${game.wave}`;
      line = `${foes} BOT${foes === 1 ? '' : 'S'} LEFT · ${era.name}`;
      frac = game.waveSize ? 1 - foes / game.waveSize : 0;
    }
    const key = `coop${game.phase}${game.era}${name}${line}${Math.round(frac * 40)}`;
    if (key === this.lastEra) return;
    this.lastEra = key;
    $('era-panel').classList.remove('doom', 'hurry');
    $('era-name').textContent = name;
    $('era-next').textContent = line;
    $('era-fill').style.width = `${Math.min(1, Math.max(0, frac)) * 100}%`;
    $('era-dots').innerHTML = ERAS.map((e, i) => `<i class="${i < game.era ? 'done' : i === game.era ? 'now' : ''}" title="${e.name}"></i>`).join('');
  }

  // disaster: DISASTERS key if the world ended, null if time just ran out.
  // wave: co-op only, the wave the tribe got wiped on.
  // profit: the Businessman's take this round, in shiny rocks. buried: the end of the world got him.
  // harvest: Ploughshares, the tribe voted to stop farming (standings: k = food picked, d = built).
  roundEnd(standings, myId, left, disaster = null, wave = 0, profit = 0, buried = false, harvest = false) {
    if (!standings) { $('roundend').classList.add('hidden'); return; }
    $('re-profit').textContent = harvest ? 'THE BUSINESSMAN MADE NOTHING. NOBODY NEEDED SPEARS.'
      : profit ? `THE BUSINESSMAN ${buried ? 'WAS BURIED WITH' : 'MADE'} ${profit.toLocaleString('en-US')} SHINY ROCKS` : '';
    $('re-col-k').textContent = harvest ? 'FOOD' : 'BONKS';
    $('re-col-d').textContent = harvest ? 'BUILT' : 'DEATHS';
    const doom = DISASTERS[disaster];
    $('roundend').classList.remove('hidden');
    const [win] = standings;
    if (harvest) {
      $('re-title').textContent = 'HARVEST FESTIVAL!';
      $('re-winner').innerHTML = win ? `MOST FOOD: ${esc(win.name.toUpperCase())} (${win.k})` : 'NOBODY FARMED';
    } else if (wave) {
      $('re-title').textContent = `TRIBE WIPED · WAVE ${wave}`;
      $('re-winner').innerHTML = win ? `MOST BONKS: ${esc(win.name.toUpperCase())} (${win.k})` : 'NOBODY BONK';
    } else {
      $('re-title').textContent = doom ? 'EVERYTHING GONE!' : 'TIME DONE!';
      $('re-winner').innerHTML = win ? `${esc(win.name.toUpperCase())} WINS (${win.k})` : 'NOBODY BONK';
    }
    $('re-rows').innerHTML = standings.map((p, i) =>
      `<tr class="${p.id === myId ? 'me' : ''}"><td>${i + 1}.</td><td>${esc(p.name)}${p.bot ? '<span class="bot">(BOT)</span>' : ''}</td><td>${p.k}</td><td>${p.d}</td></tr>`).join('');
    $('re-timer').textContent = wave ? `WAVE 1 AGAIN IN ${Math.ceil(left)}` : `NEW ROUND IN ${Math.ceil(left)}`;
  }

  show(on) { this.root.classList.toggle('hidden', !on); }

  setHp(hp) {
    if (hp === this.lastHp) return;
    this.lastHp = hp;
    const frac = Math.max(0, hp) / PLAYER.maxHp;
    this.hpFill.style.width = `${frac * 100}%`;
    this.hpText.textContent = Math.max(0, Math.round(hp));
    this.hpBar.classList.toggle('low', frac <= 0.3);
  }

  setAmmo(n, regenFrac) {
    // out: the box says so rather than going blank
    $('spear-box').classList.toggle('out', n === 0);
    if (this.counter) {
      this.counter.count.textContent = n;
      this.counter.fill.style.width = `${(n / this.ammoMax) * 100}%`;
      return;
    }
    this.spearIcons.forEach((s, i) => {
      s.el.classList.toggle('empty', i >= n);
      s.regen.style.height = i === n ? `${Math.min(1, regenFrac) * 100}%` : '0';
    });
  }

  // the charge bar only shows while you're charging a throw
  setCharge(c) {
    this.chargeFill.style.width = `${c * 100}%`;
    this.chargeFill.parentElement.classList.toggle('idle', c <= 0);
  }

  setWeapon(w) {
    const color = TIER_COLORS[w.tier] || '#fff';
    $('wc-tier').textContent = TIER_LABEL[w.tier] || '';
    $('wc-tier').style.color = color;
    $('wc-name').textContent = w.name.toUpperCase();
    $('wc-name').style.color = color;
    // long names get smaller type rather than cut off
    $('wc-name').classList.toggle('long', w.name.length > 14);
    $('wc-name').classList.toggle('longer', w.name.length > 19);
    $('wc-stats').innerHTML = STAT_ROWS.map(([label, get, max, fmt]) => {
      const v = get(w);
      return `<span>${label}</span><div class="bar"><i style="width:${Math.min(100, (v / max) * 100)}%"></i></div><span class="val">${fmt(v)}</span>`;
    }).join('');
    const specials = weaponSpecials(w);
    $('wc-desc').innerHTML = `${esc(w.desc.toUpperCase())}${specials.length ? `<br><span class="special">${specials.join(' · ')}</span>` : ''}`;
  }

  setCooldown(frac) { this.wcCd.style.width = `${Math.max(0, 1 - frac) * 100}%`; }

  // buffs: [{ kind, left }] from magic mushrooms, shown with their seconds left
  setStatus({ stun, slow, bleed, limp, hungry, buffs = [] }) {
    const key = `${stun ? 1 : 0}${slow ? 1 : 0}${bleed ? 1 : 0}${limp ? 1 : 0}${hungry ? 1 : 0}${buffs.map(b => b.kind + b.left).join()}`;
    if (key === this.lastStatus) return;
    this.lastStatus = key;
    this.statusEl.innerHTML = [
      limp && '<span class="status bleed">LIMPING · SEE DOCTOR</span>',
      hungry && '<span class="status slow">HUNGRY</span>',
      stun && '<span class="status stun">STUNNED</span>',
      slow && '<span class="status slow">SLOWED</span>',
      bleed && '<span class="status bleed">BLEEDING</span>',
      ...buffs.map(b => `<span class="status buff" style="background:${SHROOMS[b.kind].color}">${SHROOMS[b.kind].buff} ${b.left}</span>`),
    ].filter(Boolean).join('');
  }

  feed(html) {
    const el = document.createElement('div');
    el.className = 'kf';
    el.innerHTML = html;
    this.killfeed.appendChild(el);
    while (this.killfeed.children.length > 4) this.killfeed.firstChild.remove();
    setTimeout(() => el.classList.add('fade'), 4500);
    setTimeout(() => el.remove(), 5100);
  }

  center(text, sub = '', dur = 2) {
    this.centerEl.innerHTML = `${esc(text)}${sub ? `<span class="sub">${esc(sub)}</span>` : ''}`;
    this.centerEl.classList.toggle('long', text.length > 18);
    this.centerEl.classList.remove('pop');
    void this.centerEl.offsetWidth;
    this.centerEl.classList.add('pop');
    this.centerTimer = dur;
  }

  prompt(html) {
    if (html === this.lastPrompt) return;
    this.lastPrompt = html;
    this.promptEl.classList.toggle('hidden', !html);
    if (html) this.promptEl.innerHTML = html;
  }

  // How it compares to what you hold, in words (the numbers are on the weapon card with Tab).
  pickupPrompt(pk, current) {
    if (!pk) { this.prompt(null); return; }
    const w = pk.wpn;
    const say = (a, b, better, worse) => {
      const d = (a - b) / Math.max(1e-6, Math.abs(b));
      return Math.abs(d) < 0.06 ? '' : `<span class="${d > 0 ? 'up' : 'down'}">${d > 0 ? '▲' : '▼'} ${d > 0 ? better : worse}</span>`;
    };
    const parts = current ? [
      say(w.dmg, current.dmg, 'HARDER', 'WEAKER'),
      say(1 / w.cd, 1 / current.cd, 'FASTER', 'SLOWER'),
      say(w.range, current.range, 'LONGER', 'SHORTER'),
    ].filter(Boolean) : [];
    const line = [...parts, ...weaponSpecials(w)].join(' · ');
    this.prompt(`<span class="key">E</span>GRAB <span style="color:${TIER_COLORS[w.tier]}">${esc(w.name.toUpperCase())}</span>`
      + (line ? `<span class="cmp">${line}</span>` : ''));
  }

  armorPrompt(drop, current) {
    const a = drop.armor;
    const vs = current ? ` <span class="${a.dur * a.block > current.dur * current.block ? 'up' : 'down'}">(YOURS: ${esc(current.name.toUpperCase())} ${Math.round(current.dur)})</span>` : '';
    this.prompt(`<span class="key">E</span>WEAR <span style="color:${ARMORS[a.type]?.color}">${esc(a.name.toUpperCase())}</span>`
      + `<span class="cmp">BLOCK ${Math.round(a.block * 100)}% · TOUGH ${a.dur}${a.speed ? ` · RUN ${Math.round(a.speed * 100)}%` : ''}${vs}</span>`);
  }

  scoreboard(players, myId, visible, chiefId = 0) {
    $('scoreboard').classList.toggle('hidden', !visible);
    if (!visible) return;
    $('score-rows').innerHTML = sortScores(players).map(p =>
      `<tr class="${p.id === myId ? 'me' : ''}"><td>${esc(p.name)}${p.id === chiefId ? '<span class="chief">CHIEF</span>' : ''}${p.bot ? '<span class="bot">(BOT)</span>' : ''}</td><td>${p.k}</td><td>${p.d}</td></tr>`).join('');
  }

  miniScore(players, myId) {
    $('mini-score').innerHTML = '<div class="head"><span></span><span>BONKS</span></div>' + sortScores(players).slice(0, 5).map(p =>
      `<div class="${p.id === myId ? 'me' : ''}"><span>${esc(p.name)}</span><span>${p.k}</span></div>`).join('');
  }

  // items: { p: unit vec, color, kind: 'player'|'boulder'|'pickup'|'volcano'|'danger'|'armor' }
  radar(me, items, range = 42) {
    const g = this.radarCtx, S = 180, cx = S / 2, rad = S / 2 - 8;
    g.clearRect(0, 0, S, S);
    g.strokeStyle = 'rgba(255,240,200,0.18)';
    g.lineWidth = 1;
    for (const k of [0.33, 0.66, 1]) { g.beginPath(); g.arc(cx, cx, rad * k, 0, Math.PI * 2); g.stroke(); }
    const right = M.cross(me.f, me.p);
    for (const it of items) {
      const d = M.arcDist(me.p, it.p);
      if (d < 0.01) continue;
      const dir = M.towardDir(me.p, it.p);
      const k = Math.min(1, d / range);
      const x = cx + M.dot(dir, right) * k * rad;
      const y = cx - M.dot(dir, me.f) * k * rad;
      g.globalAlpha = d > range ? 0.45 : 1;
      g.fillStyle = it.color;
      g.strokeStyle = 'rgba(0,0,0,0.7)';
      g.lineWidth = 2;
      g.beginPath();
      if (it.kind === 'pickup') { g.moveTo(x, y - 6); g.lineTo(x + 5, y); g.lineTo(x, y + 6); g.lineTo(x - 5, y); g.closePath(); }
      else if (it.kind === 'shroom') { g.arc(x, y + 1.5, 4.5, Math.PI, 0); g.lineTo(x + 1.5, y + 1.5); g.lineTo(x + 1.5, y + 5); g.lineTo(x - 1.5, y + 5); g.lineTo(x - 1.5, y + 1.5); g.closePath(); }
      else if (it.kind === 'loot') { g.moveTo(x, y - 4); g.lineTo(x + 3.5, y); g.lineTo(x, y + 4); g.lineTo(x - 3.5, y); g.closePath(); }
      else if (it.kind === 'volcano') { g.moveTo(x, y - 8); g.lineTo(x + 8, y + 6); g.lineTo(x - 8, y + 6); g.closePath(); }
      else if (it.kind === 'boulder') g.arc(x, y, 6, 0, Math.PI * 2);
      else if (it.kind === 'shop') g.rect(x - 5.5, y - 5.5, 11, 11);
      else if (it.kind === 'beast') { g.arc(x, y, 8, 0, Math.PI * 2); g.moveTo(x + 3, y); g.arc(x, y, 3, 0, Math.PI * 2, true); }
      else if (it.kind === 'danger') { g.arc(x, y, 7, 0, Math.PI * 2); g.globalAlpha *= 0.6; }
      else if (it.kind === 'armor') { g.moveTo(x - 6, y - 6); g.lineTo(x + 6, y - 6); g.lineTo(x + 5, y + 2); g.lineTo(x, y + 7); g.lineTo(x - 5, y + 2); g.closePath(); }
      else g.arc(x, y, 4.5, 0, Math.PI * 2);
      g.fill();
      g.stroke();
    }
    g.globalAlpha = 1;
    // Compass round the rim, turning as you turn: north is the volcano's pole (the Businessman
    // sits at the south one), and east is on your right when you face north. Right on a pole
    // there's no north, so it keeps the last one. Letters are drawn bigger when the radar is shown
    // small (phones), so they stay readable.
    if (Math.abs(me.p[1]) < 0.9995) {
      const n = M.towardDir(me.p, [0, 1, 0]);
      this.northAngle = Math.atan2(M.dot(n, right), M.dot(n, me.f));
    }
    const shown = g.canvas.clientWidth || S;
    const font = Math.round(13 * Math.min(1.9, Math.max(1, S / shown)));
    g.font = `${font}px "Luckiest Guy", Impact, sans-serif`;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.lineWidth = 3;
    g.strokeStyle = 'rgba(0,0,0,0.8)';
    ['N', 'E', 'S', 'W'].forEach((letter, i) => {
      const a = (this.northAngle || 0) + (i * Math.PI) / 2;
      const r = rad - font * 0.2;
      const x = cx + Math.sin(a) * r, y = cx - Math.cos(a) * r + font * 0.08;
      g.fillStyle = i === 0 ? '#ff5a3c' : '#f3e7c8';
      g.strokeText(letter, x, y);
      g.fillText(letter, x, y);
    });
    // me: arrow pointing up
    g.fillStyle = '#ffd34d';
    g.strokeStyle = '#000';
    g.beginPath();
    g.moveTo(cx, cx - 8);
    g.lineTo(cx + 6, cx + 6);
    g.lineTo(cx, cx + 2);
    g.lineTo(cx - 6, cx + 6);
    g.closePath();
    g.fill();
    g.stroke();
  }

  death(show, by = '', timer = '') {
    $('death').classList.toggle('hidden', !show);
    if (show) {
      $('death-by').innerHTML = by;
      $('death-timer').textContent = timer;
    }
  }

  flash(amount, kind = 'hurt') {
    this.vignette.classList.toggle('slow', kind === 'slow');
    this.vignette.classList.toggle('era', kind === 'era');
    for (const k of ['blast', 'water', 'cold']) this.vignette.classList.toggle(k, kind === k);
    this.vignetteLevel = Math.min(1, this.vignetteLevel + amount);
  }

  eruptWarning(on) { $('erupt-warning').classList.toggle('hidden', !on); }

  update(dt) {
    if (this.centerTimer > 0) {
      this.centerTimer -= dt;
      this.centerEl.style.opacity = Math.min(1, this.centerTimer * 2);
    }
    this.vignetteLevel = Math.max(0, this.vignetteLevel - dt * 1.5);
    this.vignette.style.opacity = this.vignetteLevel * this.flashScale;
  }
}

function sortScores(players) {
  return [...players].sort((a, b) => b.k - a.k || a.d - b.d || a.name.localeCompare(b.name));
}
