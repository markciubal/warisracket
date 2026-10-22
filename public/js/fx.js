import * as THREE from 'three';
import { R } from '/shared/constants.js';
import { softDotTexture } from './textures.js';
import { behindPlanet, standOn, lift } from './util.js';

const MAX_PARTICLES = 900;
const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _s = new THREE.Vector3();
const _v = new THREE.Vector3();
const _e = new THREE.Euler();
const _c = new THREE.Color();
const _Z = new THREE.Vector3(0, 0, 1);

// Camera-facing soft quads, all drawn in one call per blend mode (instead of one sprite each).
const PUFF_VERT = `
  attribute vec3 offset;
  attribute vec4 tint;    // rgb colour, a = opacity
  attribute float size;
  varying vec2 vUv;
  varying vec4 vTint;
  #include <fog_pars_vertex>
  void main() {
    vUv = position.xy + 0.5;
    vTint = tint;
    vec4 mvPosition = modelViewMatrix * vec4(offset, 1.0);
    mvPosition.xy += position.xy * size;
    gl_Position = projectionMatrix * mvPosition;
    #include <fog_vertex>
  }`;
const PUFF_FRAG = `
  uniform sampler2D map;
  varying vec2 vUv;
  varying vec4 vTint;
  #include <fog_pars_fragment>
  void main() {
    float a = texture2D(map, vUv).a * vTint.a;
    if (a < 0.004) discard;
    gl_FragColor = vec4(vTint.rgb, a);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
    #include <fog_fragment>
  }`;

class PuffPool {
  constructor(scene, capacity, blending) {
    this.cap = capacity;
    this.n = 0;
    this.cursor = 0;
    // simulation state, packed per puff
    this.pos = new Float32Array(capacity * 3);
    this.vel = new Float32Array(capacity * 3);
    this.life = new Float32Array(capacity);
    this.max = new Float32Array(capacity);
    this.size0 = new Float32Array(capacity);
    this.grow = new Float32Array(capacity);
    this.alpha0 = new Float32Array(capacity);
    this.rgb = new Float32Array(capacity * 3);

    const geo = new THREE.InstancedBufferGeometry();
    const quad = new THREE.PlaneGeometry(1, 1);
    geo.setIndex(quad.index);
    geo.setAttribute('position', quad.attributes.position);
    const attr = (name, size) => {
      const a = new THREE.InstancedBufferAttribute(new Float32Array(capacity * size), size);
      a.setUsage(THREE.DynamicDrawUsage);
      geo.setAttribute(name, a);
      return a;
    };
    this.offset = attr('offset', 3);
    this.tint = attr('tint', 4);
    this.size = attr('size', 1);
    geo.instanceCount = 0;
    const uniforms = THREE.UniformsUtils.merge([THREE.UniformsLib.fog, { map: { value: null } }]);
    uniforms.map.value = softDotTexture();
    this.mesh = new THREE.Mesh(geo, new THREE.ShaderMaterial({
      uniforms, vertexShader: PUFF_VERT, fragmentShader: PUFF_FRAG,
      transparent: true, depthWrite: false, fog: true, blending,
    }));
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 5;
    this.geo = geo;
    scene.add(this.mesh);
  }

  add(pos, vel, color, size, grow, life, alpha) {
    // when full, recycle the oldest-ish slot rather than dropping the new puff
    let i;
    if (this.n < this.cap) i = this.n++;
    else { i = this.cursor; this.cursor = (this.cursor + 1) % this.cap; }
    this.pos.set([pos.x, pos.y, pos.z], i * 3);
    if (vel) this.vel.set([vel.x, vel.y, vel.z], i * 3); else this.vel.fill(0, i * 3, i * 3 + 3);
    _c.set(color);
    this.rgb.set([_c.r, _c.g, _c.b], i * 3);
    this.life[i] = this.max[i] = life;
    this.size0[i] = size;
    this.grow[i] = grow;
    this.alpha0[i] = alpha;
  }

  // Move slot `from` into slot `to` (used to keep live puffs packed at the front).
  move(from, to) {
    this.pos.copyWithin(to * 3, from * 3, from * 3 + 3);
    this.vel.copyWithin(to * 3, from * 3, from * 3 + 3);
    this.rgb.copyWithin(to * 3, from * 3, from * 3 + 3);
    this.life[to] = this.life[from];
    this.max[to] = this.max[from];
    this.size0[to] = this.size0[from];
    this.grow[to] = this.grow[from];
    this.alpha0[to] = this.alpha0[from];
  }

  update(dt) {
    const off = this.offset.array, tint = this.tint.array, size = this.size.array;
    for (let i = 0; i < this.n; i++) {
      this.life[i] -= dt;
      if (this.life[i] <= 0) {
        this.n--;
        if (i !== this.n) { this.move(this.n, i); i--; }
        continue;
      }
      const k = 1 - this.life[i] / this.max[i];
      const j = i * 3;
      this.pos[j] += this.vel[j] * dt;
      this.pos[j + 1] += this.vel[j + 1] * dt;
      this.pos[j + 2] += this.vel[j + 2] * dt;
      off[j] = this.pos[j]; off[j + 1] = this.pos[j + 1]; off[j + 2] = this.pos[j + 2];
      size[i] = this.size0[i] * (1 + (this.grow[i] - 1) * k);
      tint[i * 4] = this.rgb[j];
      tint[i * 4 + 1] = this.rgb[j + 1];
      tint[i * 4 + 2] = this.rgb[j + 2];
      tint[i * 4 + 3] = this.alpha0[i] * (1 - k) * Math.min(1, k * 8 + 0.3);
    }
    if (this.cursor >= this.n) this.cursor = 0;
    this.geo.instanceCount = this.n;
    this.offset.needsUpdate = this.tint.needsUpdate = this.size.needsUpdate = true;
  }
}

export class Effects {
  constructor(scene, camera) {
    this.scene = scene;
    this.camera = camera;
    this.numbers = true;      // "damage numbers" setting

    // chunky debris / dust / sparks
    this.mesh = new THREE.InstancedMesh(
      new THREE.BoxGeometry(1, 1, 1),
      new THREE.MeshLambertMaterial(),
      MAX_PARTICLES,
    );
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.frustumCulled = false;
    this.parts = [];
    for (let i = 0; i < MAX_PARTICLES; i++) {
      this.parts.push({ life: 0, max: 1, pos: new THREE.Vector3(), vel: new THREE.Vector3(), size: 0.1, grav: 1, spin: new THREE.Vector3(), rot: new THREE.Vector3() });
      this.mesh.setColorAt(i, _c.set('#ffffff'));
    }
    // live debris is kept packed at the front and only that many instances get drawn
    this.alive = 0;
    this.mesh.count = 0;
    this.cursor = 0;
    scene.add(this.mesh);

    // soft puffs: smoke, dust, glow, flashes
    this.smoke = new PuffPool(scene, 700, THREE.NormalBlending);
    this.glow = new PuffPool(scene, 260, THREE.AdditiveBlending);
    this.density = 1;   // graphics LOW thins the puffs out

    this.decals = [];
    this.waves = [];
    this.beams = [];
    this.floaters = [];
    this.floaterRoot = document.getElementById('floaters');
    this.flashLight = new THREE.PointLight('#ff9a3c', 0, 18, 1.5);
    scene.add(this.flashLight);
    this.flashT = 0;
    this.flashBase = 0;
    this.shake = 0;
  }

  // ---------------------------------------------------------------- debris
  burst(pos, { count = 12, color = '#ffffff', speed = 4, size = 0.12, life = 0.8, grav = 1, up = null, spread = 1, emissive = false } = {}) {
    count = Math.max(1, Math.round(count * this.density));
    for (let n = 0; n < count; n++) {
      // full: recycle a slot instead of dropping the new piece
      let i;
      if (this.alive < MAX_PARTICLES) i = this.alive++;
      else { i = this.cursor; this.cursor = (this.cursor + 1) % MAX_PARTICLES; }
      const p = this.parts[i];
      p.life = p.max = life * (0.6 + Math.random() * 0.8);
      p.pos.copy(pos);
      p.vel.set(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).normalize().multiplyScalar(speed * spread * (0.4 + Math.random() * 0.8));
      if (up) p.vel.addScaledVector(up, speed * (0.4 + Math.random() * 0.8));
      p.size = size * (0.6 + Math.random() * 0.8);
      p.grav = grav;
      p.spin.set(Math.random() * 8, Math.random() * 8, Math.random() * 8);
      p.rot.set(Math.random() * 6, Math.random() * 6, Math.random() * 6);
      _c.set(color);
      if (emissive) _c.multiplyScalar(2.5);
      _c.offsetHSL(0, 0, (Math.random() - 0.5) * 0.12);
      this.mesh.setColorAt(i, _c);
    }
    this.mesh.instanceColor.needsUpdate = true;
  }

  // ---------------------------------------------------------------- sprites
  puff(pos, { color = '#ffffff', size = 1, grow = 1.5, life = 1.2, vel = null, alpha = 0.7, additive = false } = {}) {
    if (this.density < 1 && Math.random() > this.density) return;
    (additive ? this.glow : this.smoke).add(pos, vel, color, size, grow, life, alpha);
  }

  dust(pos, up, amount = 1) {
    for (let i = 0; i < amount; i++) {
      const p = pos.clone().addScaledVector(up, 0.1);
      p.x += (Math.random() - 0.5) * 0.4;
      p.z += (Math.random() - 0.5) * 0.4;
      this.puff(p, { color: '#c9b48c', size: 0.5, grow: 1.2, life: 0.6, vel: up.clone().multiplyScalar(0.6), alpha: 0.45 });
    }
  }

  explosion(pos, up, scale = 1) {
    this.burst(pos, { count: 26, color: '#ff7a1f', speed: 9 * scale, size: 0.22, life: 0.9, up, emissive: true });
    this.burst(pos, { count: 18, color: '#3d3530', speed: 7 * scale, size: 0.28, life: 1.4, up });
    this.puff(pos.clone().addScaledVector(up, 0.6), { color: '#ffd27a', size: 3 * scale, grow: 2.5, life: 0.35, alpha: 1, additive: true });
    for (let i = 0; i < 6; i++) {
      const p = pos.clone().addScaledVector(up, 0.5 + Math.random());
      this.puff(p, { color: '#4a423c', size: 1.4, grow: 2.2, life: 2.2, vel: up.clone().multiplyScalar(1.5).add(new THREE.Vector3().randomDirection().multiplyScalar(0.8)), alpha: 0.6 });
    }
    this.flashLight.position.copy(pos).addScaledVector(up, 1.5);
    this.flashBase = 60 * scale;
    this.flashT = 0.35;
  }

  // ---------------------------------------------------------------- ground decals
  // The planet grew (or shrank) by dR: the marks on the ground move with it.
  lift(dR) {
    for (const d of this.decals) lift(d.mesh, dR);
  }

  // A flat disk/ring stuck to the planet surface. Returns a handle with .remove().
  decal(u, { radius = 1, inner = 0, color = '#000000', opacity = 0.5, life = Infinity, pulse = false, additive = false } = {}) {
    const geo = inner > 0 ? new THREE.RingGeometry(inner, radius, 40) : new THREE.CircleGeometry(radius, 32);
    geo.rotateX(-Math.PI / 2);
    const material = new THREE.MeshBasicMaterial({
      color, transparent: true, opacity, depthWrite: false,
      blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
      polygonOffset: true, polygonOffsetFactor: -4,
    });
    const mesh = new THREE.Mesh(geo, material);
    standOn(mesh, u, Math.random() * 6, 0.03);
    this.scene.add(mesh);
    const d = { mesh, life, max: life, opacity, pulse, remove: () => { d.life = 0; } };
    this.decals.push(d);
    return d;
  }

  // ---------------------------------------------------------------- shockwaves & beams
  // Bright ring racing outward across the ground from unit point u.
  shockwave(u, { radius = 20, life = 1.6, color = '#fff1c4', lift = 0.4 } = {}) {
    this.ringGeo ||= new THREE.RingGeometry(0.85, 1, 64).rotateX(-Math.PI / 2);
    const mesh = new THREE.Mesh(this.ringGeo, new THREE.MeshBasicMaterial({
      color, transparent: true, opacity: 0.9, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
    }));
    standOn(mesh, u, 0, lift);
    this.scene.add(mesh);
    this.waves.push({ mesh, life, max: life, radius });
  }

  // Straight glowing line from `from` to `to` (Vector3s) that fades out fast.
  beam(from, to, { color = '#7fe8ff', life = 0.18, width = 0.05 } = {}) {
    this.beamGeo ||= new THREE.CylinderGeometry(1, 1, 1, 6, 1, true).rotateX(Math.PI / 2);
    const dir = _v.subVectors(to, from);
    const len = dir.length();
    if (len < 0.01) return;
    const group = new THREE.Group();
    const core = new THREE.Mesh(this.beamGeo, new THREE.MeshBasicMaterial({ color: '#ffffff', transparent: true, depthWrite: false }));
    core.scale.set(width, width, len);
    const glow = new THREE.Mesh(this.beamGeo, new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.6, depthWrite: false, blending: THREE.AdditiveBlending }));
    glow.scale.set(width * 3.5, width * 3.5, len);
    group.add(core, glow);
    group.position.copy(from).addScaledVector(dir, 0.5);
    group.quaternion.setFromUnitVectors(_Z, dir.normalize());
    this.scene.add(group);
    this.beams.push({ group, life, max: life });
  }

  // ---------------------------------------------------------------- floating text
  float(pos, text, cls = '', { life = 1.1, rise = 1.4, follow = null, offset = 0 } = {}) {
    if (!this.numbers && (cls.startsWith('dmg') || cls === 'block')) return;
    const el = document.createElement('div');
    el.className = `floater ${cls}`;
    el.textContent = text;
    this.floaterRoot.appendChild(el);
    this.floaters.push({ el, pos: pos.clone(), life, max: life, rise, follow, offset, jitter: (Math.random() - 0.5) * 30 });
  }

  addShake(amount) { this.shake = Math.min(1.2, this.shake + amount); }

  update(dt) {
    // debris
    let recolored = false;
    for (let i = 0; i < this.alive; i++) {
      const p = this.parts[i];
      p.life -= dt;
      if (p.life <= 0) {
        // swap the last live piece into this slot (colour too) and look at it next
        const last = --this.alive;
        if (i !== last) {
          this.parts[i] = this.parts[last];
          this.parts[last] = p;
          this.mesh.getColorAt(last, _c);
          this.mesh.setColorAt(i, _c);
          recolored = true;
          i--;
        }
        continue;
      }
      _v.copy(p.pos).normalize();
      p.vel.addScaledVector(_v, -18 * p.grav * dt);
      p.vel.multiplyScalar(Math.exp(-dt * 1.2));
      p.pos.addScaledVector(p.vel, dt);
      const r = p.pos.length();
      if (r < R + p.size * 0.5) {
        p.pos.multiplyScalar((R + p.size * 0.5) / r);
        p.vel.multiplyScalar(0.3);
      } else {
        p.rot.addScaledVector(p.spin, dt);
      }
      const k = Math.min(1, p.life / (p.max * 0.4));
      _q.setFromEuler(_e.set(p.rot.x, p.rot.y, p.rot.z));
      _m.compose(p.pos, _q, _s.setScalar(p.size * k));
      this.mesh.setMatrixAt(i, _m);
    }
    if (this.cursor >= this.alive) this.cursor = 0;
    this.mesh.count = this.alive;
    this.mesh.instanceMatrix.needsUpdate = true;
    if (recolored) this.mesh.instanceColor.needsUpdate = true;

    this.smoke.update(dt);
    this.glow.update(dt);

    for (let i = this.decals.length - 1; i >= 0; i--) {
      const d = this.decals[i];
      d.life -= dt;
      if (d.life <= 0) {
        d.mesh.removeFromParent();
        d.mesh.geometry.dispose();
        d.mesh.material.dispose();
        this.decals.splice(i, 1);
        continue;
      }
      let o = d.opacity;
      if (Number.isFinite(d.max)) o *= Math.min(1, d.life / Math.min(2, d.max));
      if (d.pulse) o *= 0.6 + 0.4 * Math.sin(performance.now() / 90);
      d.mesh.material.opacity = o;
    }

    for (let i = this.waves.length - 1; i >= 0; i--) {
      const w = this.waves[i];
      w.life -= dt;
      const k = 1 - Math.max(0, w.life) / w.max;
      w.mesh.scale.setScalar(1 + w.radius * (1 - (1 - k) ** 3));
      w.mesh.material.opacity = 0.9 * (1 - k);
      if (w.life <= 0) {
        w.mesh.removeFromParent();
        w.mesh.material.dispose();
        this.waves.splice(i, 1);
      }
    }

    for (let i = this.beams.length - 1; i >= 0; i--) {
      const b = this.beams[i];
      b.life -= dt;
      const k = Math.max(0, b.life) / b.max;
      for (const m of b.group.children) m.material.opacity = (m === b.group.children[0] ? 1 : 0.6) * k;
      if (b.life <= 0) {
        b.group.removeFromParent();
        for (const m of b.group.children) m.material.dispose();
        this.beams.splice(i, 1);
      }
    }

    if (this.flashT > 0) {
      this.flashT -= dt;
      this.flashLight.intensity = Math.max(0, this.flashT / 0.35) * this.flashBase;
    }

    this.shake = Math.max(0, this.shake - dt * 1.8);

    // DOM floaters
    const w = window.innerWidth, h = window.innerHeight;
    const cam = this.camera.position;
    for (let i = this.floaters.length - 1; i >= 0; i--) {
      const f = this.floaters[i];
      f.life -= dt;
      if (f.life <= 0) { f.el.remove(); this.floaters.splice(i, 1); continue; }
      const k = 1 - f.life / f.max;
      if (f.follow) f.pos.copy(f.follow.position);
      _v.copy(f.pos).normalize();
      const world = _s.copy(f.pos).addScaledVector(_v, f.offset + f.rise * k);
      const hidden = behindPlanet(cam, world);
      world.project(this.camera);
      if (hidden || world.z > 1) { f.el.style.opacity = 0; continue; }
      const x = (world.x * 0.5 + 0.5) * w + f.jitter * k;
      const y = (-world.y * 0.5 + 0.5) * h;
      const pop = k < 0.15 ? 0.6 + (k / 0.15) * 0.5 : 1.1 - Math.min(0.1, (k - 0.15));
      f.el.style.opacity = Math.min(1, f.life / (f.max * 0.3));
      f.el.style.transform = `translate(-50%, -50%) translate(${x.toFixed(1)}px, ${y.toFixed(1)}px) scale(${pop.toFixed(3)})`;
    }
  }
}
