// Everything is synthesized with WebAudio, so there are no asset files to load.
const BPM = 96;
const STEP = 60 / BPM / 4;
// 16-step patterns: kick, low tom, high tom, shaker
const DRUMS = {
  kick:  [1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 1, 0, 0, 0, 0],
  low:   [0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 1, 0],
  high:  [0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 1, 0, 1],
  shake: [1, 0, 1, 0, 1, 0, 1, 1, 1, 0, 1, 0, 1, 0, 1, 1],
};

export class Sound {
  constructor() {
    this.ctx = null;
    this.muted = false;
    this.musicOn = true;
    this.vol = { master: 1, sfx: 1, music: 1, voice: 1 };   // 0..1, from the settings panel
    this.lastSpeech = 0;
    // on the planet (playing)? Off it, in the lobby, there are only the drums: the bots fighting
    // in the background stay quiet
    this.inWorld = false;
  }

  // Volumes and switches from the settings. Safe to call before the first click unlocks audio.
  configure({ muted = this.muted, musicOn = this.musicOn, ...vol }) {
    this.muted = muted;
    this.musicOn = musicOn;
    Object.assign(this.vol, vol);
    if ((this.muted || !this.vol.voice || !this.vol.master) && window.speechSynthesis) speechSynthesis.cancel();
    if (!this.ctx) return;
    // glide instead of jumping, so dragging a slider doesn't click; a paused context (before the
    // first click, or a backgrounded tab) has no clock to glide on, so set it outright
    const glide = (param, v) => {
      if (this.ctx.state !== 'running') { param.value = v; return; }
      param.cancelScheduledValues(this.ctx.currentTime);
      param.setTargetAtTime(v, this.ctx.currentTime, 0.03);
    };
    glide(this.master.gain, this.muted ? 0 : 0.8 * this.vol.master);
    glide(this.sfx.gain, this.vol.sfx);
    glide(this.music.gain, this.musicOn ? 0.32 * this.vol.music : 0);
  }

  // Music from the moment the page opens, lobby included. The sound is set up right away; browsers
  // that allow it start playing at once, the rest hold it until the first click, tap or key press
  // anywhere (their autoplay rules), so every one of those nudges it. It keeps listening, because
  // phones pause audio when the app goes to the background and need a touch to start it again.
  autostart() {
    this.unlock();
    if (!this.ctx) return;
    const wake = () => { if (this.ctx.state !== 'running') this.ctx.resume()?.catch?.(() => {}); };
    for (const ev of ['pointerdown', 'keydown', 'touchend', 'click']) addEventListener(ev, wake, true);
    document.addEventListener('visibilitychange', () => { if (!document.hidden) wake(); });
  }

  unlock() {
    if (this.ctx) { this.ctx.resume()?.catch?.(() => {}); return; }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    const ctx = this.ctx = new AC();
    this.master = ctx.createGain();
    this.master.gain.value = this.muted ? 0 : 0.8 * this.vol.master;
    this.master.connect(ctx.destination);
    this.sfx = ctx.createGain();
    this.sfx.gain.value = this.vol.sfx;
    this.sfx.connect(this.master);
    this.music = ctx.createGain();
    this.music.gain.value = this.musicOn ? 0.32 * this.vol.music : 0;
    this.music.connect(this.master);

    const len = ctx.sampleRate * 2;
    this.noiseBuf = ctx.createBuffer(1, len, ctx.sampleRate);
    const data = this.noiseBuf.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;

    // continuous boulder rumble, gain driven by proximity
    const rumble = ctx.createBufferSource();
    rumble.buffer = this.noiseBuf;
    rumble.loop = true;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 90;
    this.rumbleGain = ctx.createGain();
    this.rumbleGain.gain.value = 0;
    rumble.connect(lp).connect(this.rumbleGain).connect(this.sfx);
    rumble.start();

    this.startMusic();
  }

  // ---------------------------------------------------------------- primitives
  tone({ type = 'sine', f0 = 440, f1 = f0, dur = 0.2, vol = 0.3, at = 0, lp = 0, out = this.sfx, attack = 0.005 }) {
    const ctx = this.ctx, t = ctx.currentTime + at;
    const o = ctx.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(f0, t);
    o.frequency.exponentialRampToValueAtTime(Math.max(1, f1), t + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    let node = o;
    if (lp) {
      const f = ctx.createBiquadFilter();
      f.type = 'lowpass';
      f.frequency.value = lp;
      node = node.connect(f);
    }
    node.connect(g).connect(out);
    o.start(t);
    o.stop(t + dur + 0.05);
  }

  noise({ dur = 0.2, vol = 0.3, f0 = 1000, f1 = f0, q = 1, type = 'bandpass', at = 0, out = this.sfx, attack = 0.005 }) {
    const ctx = this.ctx, t = ctx.currentTime + at;
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuf;
    src.loop = true;
    const f = ctx.createBiquadFilter();
    f.type = type;
    f.Q.value = q;
    f.frequency.setValueAtTime(f0, t);
    f.frequency.exponentialRampToValueAtTime(Math.max(10, f1), t + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(f).connect(g).connect(out);
    src.start(t, Math.random() * 1.5);
    src.stop(t + dur + 0.05);
  }

  // dist: world distance from the listener, fades sounds far away
  play(name, dist = 0) {
    if (!this.ctx || this.muted || !this.inWorld) return;
    const v = Math.max(0.06, 1 - dist / 55);
    switch (name) {
      case 'throw':
        this.noise({ dur: 0.25, vol: 0.4 * v, f0: 400, f1: 2200, q: 2 });
        break;
      case 'whiff':
        this.noise({ dur: 0.16, vol: 0.32 * v, f0: 300, f1: 1400, q: 1.5 });
        break;
      case 'thunk':
        this.tone({ f0: 170, f1: 55, dur: 0.14, vol: 0.45 * v });
        this.noise({ dur: 0.06, vol: 0.25 * v, f0: 900, type: 'lowpass' });
        break;
      case 'bonk':
        this.tone({ type: 'triangle', f0: 560, f1: 150, dur: 0.22, vol: 0.55 * v });
        this.tone({ type: 'square', f0: 280, f1: 80, dur: 0.1, vol: 0.12 * v, lp: 1800 });
        break;
      case 'stab':
        this.noise({ dur: 0.12, vol: 0.5 * v, f0: 1400, f1: 300, type: 'lowpass' });
        this.tone({ f0: 140, f1: 60, dur: 0.16, vol: 0.4 * v });
        break;
      case 'hurt':
        this.tone({ type: 'sawtooth', f0: 210, f1: 120, dur: 0.28, vol: 0.28, lp: 900 });
        break;
      case 'die':
        this.tone({ type: 'sawtooth', f0: 320, f1: 55, dur: 0.95, vol: 0.3 * v, lp: 1100 });
        this.tone({ type: 'sine', f0: 160, f1: 40, dur: 1.0, vol: 0.25 * v });
        break;
      case 'pickup':
        this.tone({ type: 'triangle', f0: 520, f1: 1040, dur: 0.12, vol: 0.3 });
        this.tone({ type: 'triangle', f0: 780, f1: 1560, dur: 0.16, vol: 0.25, at: 0.08 });
        break;
      case 'spearpick':
        this.tone({ type: 'triangle', f0: 700, f1: 950, dur: 0.07, vol: 0.2 });
        break;
      case 'boom':
        this.noise({ dur: 1.3, vol: 0.9 * v, f0: 1000, f1: 70, type: 'lowpass', attack: 0.01 });
        this.tone({ f0: 80, f1: 28, dur: 0.9, vol: 0.7 * v });
        break;
      case 'erupt':
        this.noise({ dur: 3.2, vol: 0.7, f0: 160, f1: 50, type: 'lowpass', attack: 0.4 });
        this.tone({ f0: 45, f1: 30, dur: 3, vol: 0.4, attack: 0.5 });
        break;
      case 'break':
        this.noise({ dur: 0.1, vol: 0.35 * v, f0: 2500, type: 'highpass' });
        this.tone({ type: 'triangle', f0: 900, f1: 300, dur: 0.08, vol: 0.2 * v });
        break;
      case 'kill':
        this.tone({ type: 'sawtooth', f0: 220, f1: 220, dur: 0.18, vol: 0.18, lp: 1400 });
        this.tone({ type: 'sawtooth', f0: 330, f1: 300, dur: 0.45, vol: 0.2, lp: 1600, at: 0.16 });
        break;
      case 'jump':
        this.tone({ f0: 280, f1: 520, dur: 0.1, vol: 0.12 });
        break;
      case 'deflect':
        this.tone({ type: 'square', f0: 1200, f1: 600, dur: 0.12, vol: 0.18 * v, lp: 3000 });
        this.noise({ dur: 0.08, vol: 0.3 * v, f0: 3000, type: 'highpass' });
        break;
      case 'grunt':
        this.tone({ type: 'sawtooth', f0: 150, f1: 105, dur: 0.32, vol: 0.25 * v, lp: 700 });
        break;
      case 'heal':
        this.tone({ type: 'sine', f0: 600, f1: 900, dur: 0.15, vol: 0.15 });
        break;
      case 'twang':
        this.tone({ type: 'triangle', f0: 190, f1: 120, dur: 0.22, vol: 0.32 * v });
        this.noise({ dur: 0.12, vol: 0.25 * v, f0: 1800, f1: 3500, q: 3 });
        break;
      case 'clang':
        this.tone({ type: 'square', f0: 1300, f1: 1150, dur: 0.18, vol: 0.12 * v, lp: 4000 });
        this.tone({ type: 'triangle', f0: 2100, f1: 1900, dur: 0.25, vol: 0.1 * v });
        break;
      case 'armorbreak':
        this.noise({ dur: 0.35, vol: 0.5 * v, f0: 3000, f1: 600, type: 'bandpass', q: 1.2 });
        this.tone({ type: 'square', f0: 900, f1: 200, dur: 0.3, vol: 0.12 * v, lp: 3000 });
        break;
      case 'armor':
        this.tone({ type: 'triangle', f0: 330, f1: 660, dur: 0.15, vol: 0.25 });
        this.noise({ dur: 0.15, vol: 0.15, f0: 900, type: 'lowpass' });
        break;
      case 'musket':
        this.noise({ dur: 0.7, vol: 0.85 * v, f0: 2500, f1: 120, type: 'lowpass', attack: 0.003 });
        this.tone({ f0: 120, f1: 40, dur: 0.4, vol: 0.6 * v });
        break;
      case 'gun':
        this.noise({ dur: 0.09, vol: 0.45 * v, f0: 4000, f1: 600, type: 'lowpass', attack: 0.002 });
        this.tone({ type: 'square', f0: 180, f1: 60, dur: 0.06, vol: 0.15 * v });
        break;
      case 'laser':
        this.tone({ type: 'square', f0: 1900, f1: 280, dur: 0.16, vol: 0.13 * v, lp: 5000 });
        this.tone({ type: 'sine', f0: 2600, f1: 900, dur: 0.12, vol: 0.12 * v });
        break;
      case 'impact':
        this.noise({ dur: 0.06, vol: 0.2 * v, f0: 2500, type: 'bandpass', q: 2 });
        break;
      // ---- the end of the world
      case 'skyfall':
        // a long falling whistle over a rumble that builds
        this.tone({ f0: 1500, f1: 260, dur: 3.2, vol: 0.14, attack: 0.4 });
        this.noise({ dur: 4.5, vol: 0.55, f0: 220, f1: 60, type: 'lowpass', attack: 1.5 });
        break;
      case 'wave':
        // the roar of a lot of water getting closer
        this.noise({ dur: 4.5, vol: 0.7, f0: 250, f1: 1100, type: 'lowpass', attack: 1.8 });
        this.tone({ f0: 50, f1: 34, dur: 4, vol: 0.4, attack: 1.2 });
        break;
      case 'wind':
        // two howling gusts
        this.noise({ dur: 2.6, vol: 0.32, f0: 450, f1: 950, type: 'bandpass', q: 7, attack: 0.9 });
        this.noise({ dur: 2.8, vol: 0.28, f0: 900, f1: 420, type: 'bandpass', q: 7, at: 1.6, attack: 0.9 });
        break;
      case 'freeze':
        // ice cracking everywhere, then a deep thud
        for (let i = 0; i < 7; i++) this.noise({ dur: 0.05, vol: 0.35, f0: 3200, type: 'highpass', at: i * 0.06 + Math.random() * 0.03 });
        this.noise({ dur: 1.6, vol: 0.3, f0: 1800, f1: 500, type: 'bandpass', q: 1.5, at: 0.2 });
        this.tone({ f0: 90, f1: 38, dur: 1.3, vol: 0.6, at: 0.25 });
        break;
      // ---- killstreak beasts
      case 'roar':
        // T-Rex: a long rasping growl that sinks, over a chest-deep rumble
        this.noise({ dur: 1.6, vol: 0.7 * v, f0: 700, f1: 160, type: 'bandpass', q: 1.2, attack: 0.08 });
        this.tone({ type: 'sawtooth', f0: 110, f1: 55, dur: 1.5, vol: 0.4 * v, lp: 500, attack: 0.1 });
        this.tone({ type: 'sawtooth', f0: 165, f1: 70, dur: 1.3, vol: 0.2 * v, lp: 800, attack: 0.12 });
        this.tone({ f0: 50, f1: 32, dur: 1.6, vol: 0.5 * v, attack: 0.15 });
        break;
      case 'trumpet':
        // mammoth: a brassy blast that bends up, then down
        this.tone({ type: 'sawtooth', f0: 330, f1: 520, dur: 0.35, vol: 0.28 * v, lp: 2200, attack: 0.04 });
        this.tone({ type: 'sawtooth', f0: 520, f1: 300, dur: 0.6, vol: 0.28 * v, lp: 2000, at: 0.33 });
        this.tone({ type: 'square', f0: 262, f1: 390, dur: 0.8, vol: 0.08 * v, lp: 1500, attack: 0.05 });
        break;
      case 'snarl':
        // attack dog: a quick snarling growl
        this.noise({ dur: 0.4, vol: 0.4 * v, f0: 1400, f1: 600, type: 'bandpass', q: 2, attack: 0.02 });
        this.tone({ type: 'sawtooth', f0: 210, f1: 140, dur: 0.35, vol: 0.18 * v, lp: 900 });
        break;
      case 'bark':
        // two sharp barks: a quick pitch drop with a little rasp on each
        for (const at of [0, 0.2]) {
          this.tone({ type: 'sawtooth', f0: 620, f1: 260, dur: 0.12, vol: 0.32 * v, lp: 1800, at, attack: 0.005 });
          this.noise({ dur: 0.08, vol: 0.18 * v, f0: 1200, type: 'bandpass', q: 2, at });
        }
        break;
      case 'stomp':
        this.tone({ f0: 70, f1: 28, dur: 0.35, vol: 0.6 * v });
        this.noise({ dur: 0.2, vol: 0.3 * v, f0: 300, f1: 80, type: 'lowpass' });
        break;
      // ---- food and the Businessman
      case 'munch':
        // three wet crunchy bites
        for (const at of [0, 0.17, 0.34]) {
          this.noise({ dur: 0.09, vol: 0.32 * v, f0: 900, f1: 400, type: 'bandpass', q: 1.5, at });
          this.tone({ type: 'square', f0: 120, f1: 80, dur: 0.06, vol: 0.12 * v, lp: 500, at });
        }
        break;
      case 'magic':
        // a rising sparkle
        for (let i = 0; i < 5; i++) this.tone({ type: 'triangle', f0: 600 * 1.26 ** i, f1: 700 * 1.26 ** i, dur: 0.18, vol: 0.12 * v, at: i * 0.06 });
        break;
      case 'chaching':
        // the till drawer and its bell
        this.noise({ dur: 0.1, vol: 0.25 * v, f0: 2500, type: 'bandpass', q: 3 });
        this.tone({ type: 'triangle', f0: 1760, f1: 1760, dur: 0.6, vol: 0.18 * v, at: 0.1 });
        this.tone({ type: 'triangle', f0: 2637, f1: 2637, dur: 0.5, vol: 0.12 * v, at: 0.12 });
        break;
      case 'coins':
        // a pile of money hitting marble: lots of little pings and clinks, thinning out
        for (let i = 0; i < 34; i++) {
          const at = Math.random() ** 1.8 * 1.6, f = 2400 + Math.random() * 2600;
          this.tone({ type: 'triangle', f0: f, f1: f * 0.97, dur: 0.07 + Math.random() * 0.12, vol: (0.05 + Math.random() * 0.07) * v, at });
        }
        this.noise({ dur: 0.9, vol: 0.12 * v, f0: 5000, type: 'highpass', attack: 0.02 });
        break;
      case 'boing':
        this.tone({ type: 'sine', f0: 180, f1: 620, dur: 0.35, vol: 0.3 * v });
        this.tone({ type: 'triangle', f0: 360, f1: 900, dur: 0.3, vol: 0.12 * v, at: 0.02 });
        break;
      case 'chomp':
        this.noise({ dur: 0.08, vol: 0.5 * v, f0: 1800, type: 'bandpass', q: 3, at: 0.38 });
        this.tone({ type: 'square', f0: 140, f1: 60, dur: 0.15, vol: 0.3 * v, lp: 600, at: 0.38 });
        this.noise({ dur: 0.5, vol: 0.3 * v, f0: 600, f1: 200, type: 'bandpass', q: 1.5, attack: 0.05 });
        break;
      case 'shatter':
        this.noise({ dur: 0.25, vol: 0.45 * v, f0: 4000, type: 'highpass' });
        this.tone({ type: 'triangle', f0: 2400, f1: 1200, dur: 0.15, vol: 0.12 * v });
        this.tone({ type: 'triangle', f0: 3100, f1: 1700, dur: 0.2, vol: 0.1 * v, at: 0.03 });
        this.tone({ f0: 120, f1: 50, dur: 0.3, vol: 0.4 * v });
        break;
      case 'bigboom':
        this.noise({ dur: 4, vol: 1.0 * v, f0: 1800, f1: 40, type: 'lowpass', attack: 0.01 });
        this.tone({ f0: 60, f1: 22, dur: 3.5, vol: 0.9 * v });
        this.noise({ dur: 5, vol: 0.5 * v, f0: 140, f1: 50, type: 'lowpass', at: 0.4, attack: 0.6 });
        break;
      case 'era':
        // a big hollow-log horn: rising chord
        [196, 247, 294, 392].forEach((f, i) => this.tone({ type: 'sawtooth', f0: f, f1: f * 1.01, dur: 0.9 - i * 0.1, vol: 0.12, lp: 1400, at: i * 0.14, attack: 0.04 }));
        this.tone({ f0: 70, f1: 50, dur: 1.2, vol: 0.4 });
        break;
    }
  }

  setRumble(k) {
    if (this.rumbleGain) this.rumbleGain.gain.value = this.muted ? 0 : Math.min(1, k) * 0.55;
  }

  // Deep, slow speech for the full caveman experience. Falls back to a synthesized grunt.
  speak(text, { pitch = 0.2, dist = 0 } = {}) {
    if (this.muted || !this.inWorld || dist > 40 || !this.vol.voice || !this.vol.master) return;
    const t = performance.now();
    if (!window.speechSynthesis || t - this.lastSpeech < 700) { this.play('grunt', dist); return; }
    this.lastSpeech = t;
    const u = new SpeechSynthesisUtterance(text);
    u.pitch = pitch;
    u.rate = 0.85;
    // speech skips the WebAudio graph, so it takes the volume sliders directly
    u.volume = Math.max(0.2, 1 - dist / 40) * this.vol.voice * this.vol.master;
    speechSynthesis.cancel();
    speechSynthesis.speak(u);
  }

  // ---------------------------------------------------------------- tribal drums
  startMusic() {
    const ctx = this.ctx;
    let step = 0;
    let next = ctx.currentTime + 0.1;
    const out = this.music;

    // low drone with a slow wobble
    for (const f of [55, 82.4]) {
      const o = ctx.createOscillator();
      o.type = 'sawtooth';
      o.frequency.value = f;
      const lp = ctx.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.value = 180;
      const lfo = ctx.createOscillator();
      lfo.frequency.value = 0.13 + f / 1000;
      const lfoGain = ctx.createGain();
      lfoGain.gain.value = 80;
      lfo.connect(lfoGain).connect(lp.frequency);
      const g = ctx.createGain();
      g.gain.value = 0.05;
      o.connect(lp).connect(g).connect(out);
      o.start();
      lfo.start();
    }

    const hit = (name, at) => {
      const dt = at - ctx.currentTime;
      if (name === 'kick') this.tone({ f0: 140, f1: 42, dur: 0.3, vol: 0.9, at: dt, out });
      if (name === 'low') this.tone({ f0: 190, f1: 110, dur: 0.25, vol: 0.55, at: dt, out });
      if (name === 'high') this.tone({ f0: 300, f1: 190, dur: 0.18, vol: 0.4, at: dt, out });
      if (name === 'shake') this.noise({ dur: 0.05, vol: 0.12, f0: 6000, type: 'highpass', at: dt, out });
    };

    setInterval(() => {
      if (!this.musicOn || this.muted) { next = ctx.currentTime + 0.1; return; }
      while (next < ctx.currentTime + 0.15) {
        for (const [name, pattern] of Object.entries(DRUMS)) if (pattern[step]) hit(name, next);
        step = (step + 1) % 16;
        next += STEP;
      }
    }, 30);
  }
}
