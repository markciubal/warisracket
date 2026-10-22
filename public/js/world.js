import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { R, VOLCANO, TIER_COLORS, MEAT } from '/shared/constants.js';
import { seededRandom, fbm, noise3, mat, lambert, mergeChildren, shadows, standOn, placeOnSphere, lift, v3 } from './util.js';
import { barkTexture, hideTexture, softDotTexture } from './textures.js';
import { buildWeapon, taperedTube } from './weapons.js';
import { Businessman } from './mammon.js';

const smoothstep = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
const BONE = '#e9dfc6';
const ROCKS = ['#8a8578', '#7a7368', '#968c7c', '#6f6a62', '#857a6a'];
// campfire roast: raw on the spit, roasted when done
const MEAT_DONE = '#7c3a1c';
const MEAT_RAW_C = new THREE.Color('#e0645a'), MEAT_DONE_C = new THREE.Color(MEAT_DONE);

function part(parent, geo, material, x = 0, y = 0, z = 0) {
  const m = new THREE.Mesh(geo, material);
  m.position.set(x, y, z);
  parent.add(m);
  return m;
}

let barkMat, hideMat;
const barkMaterial = () => (barkMat ||= lambert({ map: barkTexture() }));
const hideMaterial = () => (hideMat ||= lambert({ map: hideTexture(), side: THREE.DoubleSide }));

// ====================================================================== sky
const SKY_VERT = `
  varying vec3 vDir;
  void main() {
    vDir = normalize(position);
    vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    gl_Position = p.xyww;
  }`;
const SKY_FRAG = `
  uniform vec3 up;
  uniform vec3 sunDir;
  uniform float doom;
  uniform vec3 doomLow;
  uniform vec3 doomHigh;
  varying vec3 vDir;
  void main() {
    vec3 d = normalize(vDir);
    float h = dot(d, up);
    vec3 zenith = vec3(0.20, 0.42, 0.82);
    vec3 horizon = vec3(1.0, 0.80, 0.58);
    vec3 space = vec3(0.07, 0.04, 0.17);
    vec3 col = h > 0.0 ? mix(horizon, zenith, pow(h, 0.5)) : mix(horizon, space, pow(min(1.0, -h * 2.4), 0.6));
    float s = max(dot(d, sunDir), 0.0);
    col += vec3(1.0, 0.85, 0.55) * pow(s, 300.0) * 2.0 + vec3(1.0, 0.65, 0.35) * pow(s, 8.0) * 0.25;
    // the end of the world: the disaster's sky, doomLow near the horizon fading to doomHigh overhead
    vec3 ruined = mix(doomLow, doomHigh, clamp(h * 1.6 + 0.3, 0.0, 1.0));
    col = mix(col, ruined, doom * 0.9);
    gl_FragColor = vec4(col, 1.0);
  }`;
const STAR_VERT = `
  uniform vec3 up;
  attribute float size;
  varying float vAlpha;
  void main() {
    vAlpha = smoothstep(0.25, -0.15, dot(normalize(position), up));
    gl_PointSize = size;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }`;
const STAR_FRAG = `
  varying float vAlpha;
  void main() {
    float d = length(gl_PointCoord - 0.5);
    gl_FragColor = vec4(1.0, 0.97, 0.9, vAlpha * smoothstep(0.5, 0.1, d));
  }`;

export class Sky {
  constructor(scene) {
    this.uniforms = {
      up: { value: new THREE.Vector3(0, 1, 0) }, sunDir: { value: new THREE.Vector3(0.3, 1, 0.2).normalize() },
      doom: { value: 0 }, doomLow: { value: new THREE.Vector3(0.85, 0.28, 0.08) }, doomHigh: { value: new THREE.Vector3(0.16, 0.08, 0.07) },
    };
    this.dome = new THREE.Mesh(
      new THREE.SphereGeometry(400, 32, 16),
      new THREE.ShaderMaterial({ uniforms: this.uniforms, vertexShader: SKY_VERT, fragmentShader: SKY_FRAG, side: THREE.BackSide, depthWrite: false }),
    );
    this.dome.renderOrder = -2;
    this.dome.frustumCulled = false;
    scene.add(this.dome);

    const n = 1600, pos = new Float32Array(n * 3), size = new Float32Array(n);
    const v = new THREE.Vector3();
    for (let i = 0; i < n; i++) {
      v.randomDirection().multiplyScalar(380);
      pos.set([v.x, v.y, v.z], i * 3);
      size[i] = 1 + Math.random() * Math.random() * 3;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('size', new THREE.BufferAttribute(size, 1));
    this.stars = new THREE.Points(geo, new THREE.ShaderMaterial({
      uniforms: { up: this.uniforms.up }, vertexShader: STAR_VERT, fragmentShader: STAR_FRAG,
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    }));
    this.stars.renderOrder = -1;
    this.stars.frustumCulled = false;
    scene.add(this.stars);

    this.sun = new THREE.Sprite(new THREE.SpriteMaterial({ map: softDotTexture(), color: '#fff1c2', blending: THREE.AdditiveBlending, depthWrite: false, fog: false }));
    this.sun.scale.setScalar(70);
    this.sun.renderOrder = -1;
    scene.add(this.sun);
  }

  update(camera, up, sunDir) {
    this.dome.position.copy(camera.position);
    this.stars.position.copy(camera.position);
    this.uniforms.up.value.copy(up);
    this.uniforms.sunDir.value.copy(sunDir);
    this.sun.position.copy(camera.position).addScaledVector(sunDir, 350);
  }
}

// ====================================================================== world
export class World {
  constructor(scene, data, fx) {
    this.scene = scene;
    this.fx = fx;
    this.group = new THREE.Group();
    scene.add(this.group);
    this.rng = seededRandom(data.seed);
    this.obstacles = data.obstacles.map(o => ({ ...o, uv: v3(o.u) }));
    this.fires = [];
    this.pteros = [];
    this.clouds = [];
    this.pickups = new Map();
    this.eruptT = 0;
    this.smokeT = 0;
    this.time = 0;

    this.staticRoots = [];
    this.cullables = [];   // top: how high it reaches above the ground
    this.fineDecor = [];
    this.decor = [];       // every scattered instanced mesh, to lift when the planet grows
    this.buildPlanet();
    for (const o of this.obstacles) {
      const build = { rock: this.buildRock, tree: this.buildTree, hut: this.buildHut, skeleton: this.buildSkeleton, campfire: this.buildCampfire, volcano: this.buildVolcano, mammon: this.buildMammon }[o.type];
      if (build) build.call(this, o, seededRandom(Math.floor(o.seed * 1e9)));
    }
    this.mergeStatic(this.staticRoots);
    // One light borrowed by whichever campfire is nearest the camera, instead of a light per fire:
    // every lit pixel on screen pays for every point light in the scene.
    for (const fire of this.fires) fire.lightPos = fire.group.localToWorld(new THREE.Vector3(0, 1.1, 0));
    this.fireLight = new THREE.PointLight('#ff8a33', 0, 13, 1.4);
    this.group.add(this.fireLight);
    this.buildDecor();
    for (const pk of data.pickups) this.addPickup(pk);
    this.buildSkyCritters();
  }

  dispose() {
    this.group.removeFromParent();
    this.group.traverse(o => { if (o.isMesh || o.isInstancedMesh) o.geometry.dispose(); });
  }

  // ---------------------------------------------------------------- planet
  buildPlanet() {
    const geo = new THREE.IcosahedronGeometry(R, 40);
    const pos = geo.attributes.position;
    const colors = new Float32Array(pos.count * 3);
    const grassA = new THREE.Color('#4f9233'), grassB = new THREE.Color('#86bd4a');
    const dirt = new THREE.Color('#9b7a4b'), ash = new THREE.Color('#463b33'), moss = new THREE.Color('#3f7a2c');
    const clearings = this.obstacles.filter(o => o.type === 'hut' || o.type === 'campfire');
    const c = new THREE.Color(), v = new THREE.Vector3(), w = new THREE.Vector3();
    for (let i = 0; i < pos.count; i += 3) {
      v.set(0, 0, 0);
      for (let k = 0; k < 3; k++) v.add(w.fromBufferAttribute(pos, i + k));
      v.normalize();
      const n = fbm(v.x * 3 + 7, v.y * 3, v.z * 3);
      const d = fbm(v.x * 6, v.y * 6 + 11, v.z * 6);
      c.copy(grassA).lerp(grassB, smoothstep(0.3, 0.7, n));
      if (n < 0.33) c.lerp(moss, 0.5);
      c.lerp(dirt, smoothstep(0.6, 0.7, d) * 0.85);
      for (const o of clearings) {
        const dist = v.angleTo(o.uv) * R;
        if (dist < o.r + 2.6) c.lerp(dirt, 0.75 * (1 - dist / (o.r + 2.6)));
      }
      c.lerp(ash, smoothstep(0.86, 0.95, v.y));
      c.offsetHSL(0, 0, (noise3(v.x * 40, v.y * 40, v.z * 40) - 0.5) * 0.05);
      for (let k = 0; k < 3; k++) colors.set([c.r, c.g, c.b], (i + k) * 3);
    }
    geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    const planet = this.planet = new THREE.Mesh(geo, lambert({ vertexColors: true, flatShading: true }));
    planet.receiveShadow = true;
    this.group.add(planet);
    this.builtR = R;   // the planet is scaled from this size when it grows (regrow)
  }

  place(obj, o, h = 0) {
    standOn(obj, o.uv, o.yaw, h);
    this.group.add(obj);
    this.staticRoots.push(obj);
    this.cullables.push({ obj, u: o.uv, top: o.h + 0.5, spread: o.r / R });
    return obj;
  }

  // Bake each obstacle into one mesh per material. This stays per obstacle rather than
  // planet-wide so cull() can skip whatever is behind the horizon (most of the planet, most of
  // the time) and the shadow camera can skip what's outside its box. Lights and
  // userData.dynamic meshes (flames) stay as they are.
  mergeStatic(roots) {
    this.group.updateMatrixWorld(true);
    for (const root of roots) {
      const nested = [];
      root.traverse(o => {
        if (o.userData.dynamic) o.userData.keep = true;
        else if (o.isMesh && o.parent !== root) nested.push(o);
      });
      for (const m of nested) root.attach(m);   // flatten sub-groups, keeping each part where it was
      mergeChildren(root);
    }
  }

  // Hide anything the planet itself would block from view. visibleFrom(ux, uy, uz, top, spread)
  // comes from horizonTest() for the current camera.
  cull(visibleFrom) {
    for (const c of this.cullables) c.obj.visible = visibleFrom(c.u.x, c.u.y, c.u.z, R + c.top, c.spread);
  }

  // Graphics LOW drops the small scattered stuff (grass, pebbles, bones).
  setLowDetail(on) {
    for (const m of this.fineDecor) m.visible = !on;
  }

  // ---------------------------------------------------------------- obstacles
  buildRock(o, rng) {
    const g = new THREE.Group();
    const makeRock = (rx, ry, rz, seed) => {
      const geo = new THREE.DodecahedronGeometry(1, 1);
      const p = geo.attributes.position, t = new THREE.Vector3();
      for (let i = 0; i < p.count; i++) {
        t.fromBufferAttribute(p, i);
        t.multiplyScalar(1 + (noise3(t.x * 1.7 + seed, t.y * 1.7, t.z * 1.7) - 0.5) * 0.45);
        p.setXYZ(i, t.x, t.y, t.z);
      }
      geo.computeVertexNormals();
      const m = new THREE.Mesh(geo, mat(ROCKS[Math.floor(rng() * ROCKS.length)], { flatShading: true }));
      m.scale.set(rx, ry, rz);
      m.rotation.y = rng() * 6;
      return m;
    };
    const main = makeRock(o.r * 1.02, o.h * 0.8, o.r * 0.92, o.seed * 100);
    main.position.y = o.h * 0.3;
    g.add(main);
    if (rng() < 0.5) {
      const top = new THREE.Mesh(new THREE.SphereGeometry(o.r * 0.5, 7, 5), mat('#4e8a2e', { flatShading: true }));
      top.scale.y = 0.25;
      top.position.y = o.h * 1.02;
      g.add(top);
    }
    for (let i = 0; i < 2; i++) {
      const a = rng() * Math.PI * 2, s = 0.25 + rng() * 0.25;
      const pebble = makeRock(s, s * 0.7, s, i + o.seed * 50);
      pebble.position.set(Math.cos(a) * o.r * 0.85, s * 0.2, Math.sin(a) * o.r * 0.85);
      g.add(pebble);
    }
    this.place(shadows(g), o, -0.1);
  }

  buildTree(o, rng) {
    const g = new THREE.Group();
    const bark = barkMaterial();
    const pine = o.seed > 0.62;
    const H = pine ? 3.4 : 5.6;
    const bend = pine ? 0 : 0.6 + rng() * 0.9;
    const pts = [];
    for (let i = 0; i <= 6; i++) {
      const t = i / 6;
      pts.push(new THREE.Vector3(bend * t * t, t * H, 0));
    }
    for (let i = 0; i < 6; i++) {
      const a = pts[i], b = pts[i + 1];
      const d = new THREE.Vector3().subVectors(b, a);
      const ra = 0.42 - i * 0.03, rb = 0.42 - (i + 1) * 0.03;
      const seg = new THREE.Mesh(new THREE.CylinderGeometry(rb, ra, d.length() + 0.05, 9), bark);
      seg.position.copy(a).addScaledVector(d, 0.5);
      seg.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), d.clone().normalize());
      g.add(seg);
      if (!pine) {
        const ring = new THREE.Mesh(new THREE.TorusGeometry(rb + 0.02, 0.05, 5, 12), mat('#4a2f17'));
        ring.position.copy(b);
        ring.quaternion.copy(seg.quaternion);
        ring.rotateX(Math.PI / 2);
        g.add(ring);
      }
    }
    const top = pts[6];
    if (pine) {
      const greens = ['#2f6b2c', '#367a30', '#2a5f28'];
      for (let i = 0; i < 4; i++) {
        const cone = new THREE.Mesh(new THREE.ConeGeometry(2.1 - i * 0.42, 1.9, 8), mat(greens[i % 3], { flatShading: true }));
        cone.position.y = 2.6 + i * 1.15;
        cone.rotation.y = rng() * 3;
        g.add(cone);
      }
    } else {
      const frondMat = mat('#3f8f2f', { flatShading: true, side: THREE.DoubleSide });
      const frondMat2 = mat('#57a83a', { flatShading: true, side: THREE.DoubleSide });
      const count = 8;
      for (let i = 0; i < count; i++) {
        const L = 3.0 + rng() * 0.8;
        const geo = new THREE.PlaneGeometry(1, L, 2, 8);
        const p = geo.attributes.position;
        for (let k = 0; k < p.count; k++) {
          const x = p.getX(k), y = p.getY(k) + L / 2;
          const t = y / L;
          const width = 0.95 * Math.sin(Math.PI * Math.min(1, t * 1.15)) + 0.08;
          p.setXYZ(k, x * width, 0.55 * y - 0.3 * y * y - Math.abs(x) * 0.35, y);
        }
        geo.computeVertexNormals();
        const frond = new THREE.Mesh(geo, i % 2 ? frondMat : frondMat2);
        frond.position.copy(top);
        frond.rotation.y = (i / count) * Math.PI * 2 + rng() * 0.3;
        g.add(frond);
      }
      for (let i = 0; i < 3; i++) {
        const nut = new THREE.Mesh(new THREE.SphereGeometry(0.17, 7, 6), mat('#5a3a1c'));
        nut.position.set(top.x + Math.cos(i * 2.1) * 0.25, top.y - 0.2, Math.sin(i * 2.1) * 0.25);
        g.add(nut);
      }
    }
    this.place(shadows(g), o);
  }

  buildHut(o, rng) {
    const g = new THREE.Group();
    const cone = new THREE.Mesh(new THREE.ConeGeometry(o.r * 1.02, o.h, 11, 1, true), hideMaterial());
    cone.position.y = o.h / 2;
    g.add(cone);
    for (let i = 0; i < 5; i++) {
      const a = (i / 5) * Math.PI * 2;
      const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.06, 1.5, 5), mat('#6b4423'));
      pole.position.set(Math.cos(a) * 0.18, o.h + 0.35, Math.sin(a) * 0.18);
      pole.rotation.set(Math.sin(a) * 0.35, 0, -Math.cos(a) * 0.35);
      g.add(pole);
    }
    // doorway: dark triangle on the cone face
    const r0 = o.r * 1.04, door = 0.36, hy = o.h * 0.5, r1 = o.r * 1.04 * (1 - 0.5);
    const tri = new THREE.BufferGeometry();
    tri.setAttribute('position', new THREE.Float32BufferAttribute([
      Math.sin(-door) * r0, 0.02, Math.cos(-door) * r0,
      Math.sin(door) * r0, 0.02, Math.cos(door) * r0,
      0, hy, r1,
    ], 3));
    tri.computeVertexNormals();
    g.add(new THREE.Mesh(tri, new THREE.MeshBasicMaterial({ color: '#1a100a', side: THREE.DoubleSide })));
    // mammoth tusk arch over the entrance
    for (const side of [-1, 1]) {
      const pts = new THREE.QuadraticBezierCurve3(
        new THREE.Vector3(side * 1.0, 0, o.r + 0.6),
        new THREE.Vector3(side * 1.3, 1.8, o.r + 1.0),
        new THREE.Vector3(side * 0.15, 2.4, o.r + 0.5)).getPoints(6);
      taperedTube(g, pts, 0.13, 0.04, '#f2ead4');
    }
    // skull totem
    const totem = new THREE.Group();
    totem.add(new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.07, 1.6, 5), mat('#6b4423')));
    totem.children[0].position.y = 0.8;
    const skull = new THREE.Mesh(new THREE.SphereGeometry(0.22, 8, 6), mat(BONE));
    skull.position.y = 1.7;
    skull.scale.set(1, 0.9, 1.15);
    totem.add(skull);
    for (const s of [-1, 1]) {
      const eye = new THREE.Mesh(new THREE.SphereGeometry(0.06, 6, 4), mat('#1a100a'));
      eye.position.set(s * 0.09, 1.74, 0.2);
      totem.add(eye);
      const horn = new THREE.Mesh(new THREE.ConeGeometry(0.05, 0.35, 5), mat(BONE));
      horn.position.set(s * 0.22, 1.85, 0);
      horn.rotation.z = -s * 0.8;
      totem.add(horn);
    }
    totem.position.set(o.r + 0.4, 0, o.r * 0.6);
    g.add(totem);
    this.place(shadows(g), o);
  }

  buildSkeleton(o, rng) {
    const g = new THREE.Group();
    const bone = mat(BONE);
    for (let i = 0; i < 6; i++) {
      const z = -1.6 + i * 0.55;
      const rib = new THREE.Mesh(new THREE.TorusGeometry(1.15 - Math.abs(i - 2.5) * 0.08, 0.075, 5, 16, Math.PI), bone);
      rib.position.set(0, 0, z);
      rib.scale.y = 1.2;
      g.add(rib);
    }
    for (let i = 0; i < 10; i++) {
      const vert = new THREE.Mesh(new THREE.SphereGeometry(0.15, 7, 5), bone);
      vert.position.set(0, 1.4 - Math.max(0, i - 7) * 0.12, -2.1 + i * 0.36);
      vert.scale.set(1, 0.8, 0.8);
      g.add(vert);
    }
    const skull = new THREE.Group();
    const cranium = new THREE.Mesh(new THREE.SphereGeometry(0.7, 10, 8), bone);
    cranium.scale.set(1, 0.9, 1.15);
    skull.add(cranium);
    for (const s of [-1, 1]) {
      const socket = new THREE.Mesh(new THREE.SphereGeometry(0.17, 7, 5), mat('#2a1f18'));
      socket.position.set(s * 0.32, 0.12, 0.6);
      skull.add(socket);
      const pts = new THREE.CubicBezierCurve3(
        new THREE.Vector3(s * 0.3, -0.35, 0.55),
        new THREE.Vector3(s * 0.6, -1.1, 1.4),
        new THREE.Vector3(s * 0.7, 0.4, 2.3),
        new THREE.Vector3(s * 0.25, 0.7, 1.9)).getPoints(9);
      taperedTube(skull, pts, 0.16, 0.04, '#f4ecd6');
    }
    skull.position.set(0, 0.85, 1.9);
    skull.rotation.x = 0.25;
    g.add(skull);
    this.place(shadows(g), o, -0.05);
  }

  buildCampfire(o, rng) {
    const g = new THREE.Group();
    for (let i = 0; i < 10; i++) {
      const a = (i / 10) * Math.PI * 2;
      const stone = new THREE.Mesh(new THREE.DodecahedronGeometry(0.2, 0), mat(ROCKS[i % ROCKS.length], { flatShading: true }));
      stone.position.set(Math.cos(a) * 0.72, 0.08, Math.sin(a) * 0.72);
      stone.rotation.set(rng() * 3, rng() * 3, 0);
      g.add(stone);
    }
    for (let i = 0; i < 3; i++) {
      const log = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.09, 1.0, 6), mat('#5a3519'));
      const a = (i / 3) * Math.PI * 2;
      log.position.set(Math.cos(a) * 0.2, 0.3, Math.sin(a) * 0.2);
      log.rotation.set(Math.sin(a) * 0.9, 0, -Math.cos(a) * 0.9);
      g.add(log);
    }
    // roasting spit with a mammoth drumstick
    for (const s of [-1, 1]) {
      const post = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.05, 1.5, 5), mat('#6b4423'));
      post.position.set(s * 0.95, 0.75, 0);
      g.add(post);
    }
    const spit = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 2.1, 5), mat('#6b4423'));
    spit.rotation.z = Math.PI / 2;
    spit.position.y = 1.45;
    g.add(spit);
    const meat = new THREE.Mesh(new THREE.SphereGeometry(0.28, 9, 7), new THREE.MeshLambertMaterial({ color: MEAT_DONE }));
    meat.scale.set(1.5, 1, 1);
    meat.position.y = 1.45;
    meat.userData.dynamic = true;
    g.add(meat);
    shadows(g);

    const flames = [];
    const flameColors = ['#ff5a14', '#ff9a1f', '#ffe066'];
    for (let i = 0; i < 3; i++) {
      const f = new THREE.Mesh(new THREE.ConeGeometry(0.42 - i * 0.11, 1.0 - i * 0.15, 7), new THREE.MeshBasicMaterial({ color: flameColors[i], transparent: true, opacity: 0.85, depthWrite: false }));
      f.position.y = 0.45 + i * 0.05;
      f.userData.dynamic = true;
      g.add(f);
      flames.push(f);
    }
    this.place(g, o);
    this.fires.push({ id: o.id, u: o.u, r: o.r, flames, base: 18, group: g, smoke: 0, meat, readyAt: 0 });
  }

  // The Businessman's podium: marble steps up to a dais of gold. He stands on top (mammon.js).
  buildMammon(o) {
    const g = new THREE.Group();
    const marble = mat('#d9d2c3', { flatShading: true });
    const gold = mat('#e8b931', { metalness: 0.8, roughness: 0.3 });
    part(g, new THREE.CylinderGeometry(2.4, 2.5, 0.42, 20), marble, 0, 0.21, 0);
    part(g, new THREE.CylinderGeometry(1.95, 2.0, 0.42, 20), marble, 0, 0.63, 0);
    part(g, new THREE.CylinderGeometry(1.45, 1.5, 0.46, 20), gold, 0, 1.07, 0);
    for (const [r, y] of [[2.42, 0.42], [1.97, 0.84]]) part(g, new THREE.TorusGeometry(r, 0.05, 4, 32), gold, 0, y, 0).rotation.x = Math.PI / 2;
    // four little columns at the corners of the top step, for a bank-like look
    for (let i = 0; i < 4; i++) {
      const a = Math.PI / 4 + (i * Math.PI) / 2;
      part(g, new THREE.CylinderGeometry(0.1, 0.12, 0.9, 8), marble, Math.cos(a) * 1.75, 1.29, Math.sin(a) * 1.75);
      part(g, new THREE.BoxGeometry(0.3, 0.08, 0.3), gold, Math.cos(a) * 1.75, 1.76, Math.sin(a) * 1.75);
    }
    shadows(g);
    this.place(g, o);
    // the man himself stays out of the static merge: he moves
    this.mammon = new Businessman();
    const anchor = new THREE.Group();
    standOn(anchor, o.uv, 0, 0);
    this.mammon.root.position.y = 1.3;
    anchor.add(this.mammon.root);
    this.group.add(anchor);
    this.cullables.push({ obj: anchor, u: o.uv, top: 9, spread: 0.1 });
  }

  // a roast was eaten: a raw one is on the spit, done in `left` seconds
  setMeat(id, left) {
    const fire = this.fires.find(f => f.id === id);
    if (fire) fire.readyAt = this.time + left;
  }

  buildVolcano(o) {
    const g = new THREE.Group();
    const profile = [[7.4, -0.8], [7.0, 0], [6.0, 1.6], [4.9, 3.5], [3.8, 5.6], [2.9, 7.4], [2.3, 9.0], [1.9, 9.25], [1.5, 8.7], [1.1, 8.35], [0, 8.35]];
    const geo = new THREE.LatheGeometry(profile.map(([r, y]) => new THREE.Vector2(r, y)), 22);
    const p = geo.attributes.position, t = new THREE.Vector3();
    for (let i = 0; i < p.count; i++) {
      t.fromBufferAttribute(p, i);
      const k = 1 + (noise3(t.x * 0.6, t.y * 0.6, t.z * 0.6) - 0.5) * 0.22;
      p.setXYZ(i, t.x * k, t.y, t.z * k);
    }
    geo.computeVertexNormals();
    const cone = new THREE.Mesh(geo, mat('#55463a', { flatShading: true }));
    g.add(cone);

    this.lavaMat = new THREE.MeshBasicMaterial({ color: '#ff5a12' });
    const pool = new THREE.Mesh(new THREE.CircleGeometry(1.6, 16), this.lavaMat);
    pool.rotation.x = -Math.PI / 2;
    pool.position.y = 8.45;
    g.add(pool);

    const radiusAt = y => {
      for (let i = 0; i < 6; i++) {
        const [r0, y0] = profile[i + 1], [r1, y1] = profile[i + 2];
        if (y >= y0 && y <= y1) return r0 + ((y - y0) / (y1 - y0)) * (r1 - r0);
      }
      return 2.3;
    };
    for (let s = 0; s < 4; s++) {
      const a0 = s * 1.6 + 0.4, pts = [];
      for (let y = 9.0; y >= 1.5; y -= 0.75) {
        const a = a0 + Math.sin(y * 0.9 + s) * 0.08;
        const r = radiusAt(y) + 0.06;
        pts.push(new THREE.Vector3(Math.cos(a) * r, y, Math.sin(a) * r));
      }
      const tube = new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 24, 0.2, 5), this.lavaMat);
      tube.scale.set(1, 1, 1);
      g.add(tube);
    }
    this.lavaLight = new THREE.PointLight('#ff6a2a', 50, 32, 1.2);
    this.lavaLight.position.y = 10.5;
    g.add(this.lavaLight);
    shadows(cone, true, true);
    this.volcanoTop = new THREE.Vector3(0, R + 9.2, 0);
    this.place(g, o, -0.2);
  }

  // ---------------------------------------------------------------- scattered decor
  decorPoints(count, margin) {
    const out = [];
    const v = new THREE.Vector3();
    const volcanoCos = Math.cos((VOLCANO.radius + 1.5) / R);
    for (let tries = 0; out.length < count && tries < count * 20; tries++) {
      const z = this.rng() * 2 - 1, th = this.rng() * Math.PI * 2, s = Math.sqrt(1 - z * z);
      v.set(s * Math.cos(th), z, s * Math.sin(th));
      if (v.y > volcanoCos) continue;
      if (this.obstacles.some(o => v.angleTo(o.uv) * R < o.r + margin)) continue;
      out.push(v.clone());
    }
    return out;
  }

  scatter(geo, material, points, { scale = [0.7, 1.3], colors = null, sink = 0, tilt = 0.15 } = {}) {
    const mesh = new THREE.InstancedMesh(geo, material, points.length);
    const obj = new THREE.Object3D();
    const c = new THREE.Color();
    points.forEach((u, i) => {
      standOn(obj, u, this.rng() * Math.PI * 2, -sink);
      obj.rotateX((this.rng() - 0.5) * tilt);
      obj.rotateZ((this.rng() - 0.5) * tilt);
      obj.scale.setScalar(scale[0] + this.rng() * (scale[1] - scale[0]));
      obj.updateMatrix();
      mesh.setMatrixAt(i, obj.matrix);
      if (colors) mesh.setColorAt(i, c.set(colors[Math.floor(this.rng() * colors.length)]));
    });
    mesh.receiveShadow = true;
    this.group.add(mesh);
    this.decor.push(mesh);
    return mesh;
  }

  buildDecor() {
    // grass tufts, clustered
    const centers = this.decorPoints(320, 0.4);
    const blades = [];
    for (const c of centers) {
      for (let i = 0; i < 5; i++) {
        const off = new THREE.Vector3().randomDirection().multiplyScalar(0.5 / R);
        blades.push(c.clone().add(off).normalize());
      }
    }
    const blade = new THREE.ConeGeometry(0.07, 0.6, 3);
    blade.translate(0, 0.3, 0);
    this.fineDecor.push(this.scatter(blade, mat('#ffffff', { flatShading: true }), blades, { scale: [0.6, 1.4], colors: ['#5ea83a', '#7cc04a', '#4c8f2e', '#93c95a'], tilt: 0.6 }));

    // flowers
    const flowers = this.decorPoints(200, 0.5);
    const stem = new THREE.CylinderGeometry(0.015, 0.02, 0.35, 4).toNonIndexed();
    stem.translate(0, 0.17, 0);
    const bloom = new THREE.IcosahedronGeometry(0.08, 0);
    bloom.translate(0, 0.37, 0);
    const flowerGeo = mergeGeometries([stem, bloom]);
    const flowerMesh = this.scatter(flowerGeo, mat('#ffffff', { flatShading: true }), flowers, { scale: [0.8, 1.5], colors: ['#ffd23d', '#ff5a5a', '#c47cff', '#ffffff', '#ff9ad5'], tilt: 0.3 });
    flowerMesh.castShadow = false;

    // pebbles
    this.fineDecor.push(this.scatter(new THREE.DodecahedronGeometry(0.13, 0), mat('#ffffff', { flatShading: true }), this.decorPoints(240, 0.3), { scale: [0.5, 1.6], colors: ROCKS, sink: 0.04, tilt: 3 }));

    // bushes
    const bushGeo = new THREE.IcosahedronGeometry(0.75, 1);
    bushGeo.scale(1, 0.62, 1);
    this.scatter(bushGeo, mat('#ffffff', { flatShading: true }), this.decorPoints(70, 1.0), { scale: [0.7, 1.3], colors: ['#3d7a2a', '#4a8a33', '#356b25'], sink: 0.1 });

    // scattered little bones
    const shaft = new THREE.CylinderGeometry(0.035, 0.035, 0.5, 5);
    shaft.rotateZ(Math.PI / 2);
    const knobs = [-0.25, 0.25].flatMap(x => [-0.035, 0.035].map(z => new THREE.SphereGeometry(0.055, 6, 4).translate(x, 0, z)));
    const boneGeo = mergeGeometries([shaft, ...knobs]);
    boneGeo.translate(0, 0.04, 0);
    this.fineDecor.push(this.scatter(boneGeo, mat(BONE), this.decorPoints(60, 0.5), { scale: [0.8, 1.6], tilt: 0.2 }));

    // (no decorative mushrooms: the few on the planet are magic ones, see main.js addShroom)
  }

  // ---------------------------------------------------------------- weapon totems
  addPickup(pk) {
    const g = new THREE.Group();
    const stone = mat('#7c776d', { flatShading: true });
    const base = new THREE.Mesh(new THREE.CylinderGeometry(0.55, 0.72, 0.75, 6), stone);
    base.position.y = 0.37;
    const slab = new THREE.Mesh(new THREE.CylinderGeometry(0.66, 0.62, 0.14, 6), stone);
    slab.position.y = 0.8;
    g.add(base, slab);
    for (const s of [-1, 1]) {
      const eye = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.08, 0.05), mat('#2a221b'));
      eye.position.set(s * 0.16, 0.52, 0.56);
      eye.rotation.z = s * 0.25;
      g.add(eye);
    }
    const mouth = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.06, 0.05), mat('#2a221b'));
    mouth.position.set(0, 0.32, 0.6);
    g.add(mouth);
    shadows(g);
    mergeChildren(g);

    const ringMat = new THREE.MeshBasicMaterial({ transparent: true, opacity: 0.6, depthWrite: false, side: THREE.DoubleSide });
    const ring = new THREE.Mesh(new THREE.RingGeometry(1.05, 1.3, 32).rotateX(-Math.PI / 2), ringMat);
    ring.position.y = 0.04;
    const beamMat = new THREE.MeshBasicMaterial({ transparent: true, opacity: 0.13, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide });
    const beam = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.55, 7, 12, 1, true), beamMat);
    beam.position.y = 3.6;
    const holder = new THREE.Group();
    holder.position.y = 1.55;
    g.add(ring, beam, holder);

    const u = v3(pk.u);
    standOn(g, u, 0);
    this.group.add(g);
    this.cullables.push({ obj: g, u, top: 7.5, spread: 0.05 });   // the beam reaches up high
    this.pickups.set(pk.id, { id: pk.id, group: g, holder, ringMat, beamMat, u, wpn: null, mesh: null });
    this.setPickupWeapon(pk.id, pk.wpn);
  }

  setPickupWeapon(id, wpn) {
    const pk = this.pickups.get(id);
    if (!pk) return;
    if (pk.mesh) pk.holder.remove(pk.mesh);
    pk.wpn = wpn;
    pk.mesh = shadows(buildWeapon(wpn), false, false);
    pk.mesh.position.y = -0.7 * (wpn.scale || 1);
    pk.holder.add(pk.mesh);
    const color = TIER_COLORS[wpn.tier] || '#ffffff';
    pk.ringMat.color.set(color);
    pk.beamMat.color.set(color);
  }

  // ---------------------------------------------------------------- critters & clouds
  buildSkyCritters() {
    const orbit = (h, speedMin, speedMax) => {
      const axis = new THREE.Vector3().randomDirection();
      const start = new THREE.Vector3().randomDirection().projectOnPlane(axis).normalize();
      return { axis, start, h, speed: speedMin + Math.random() * (speedMax - speedMin), phase: Math.random() * Math.PI * 2 };
    };
    const skinMat = mat('#8a5a3c', { flatShading: true });
    const wingMat = mat('#a06c49', { flatShading: true, side: THREE.DoubleSide });
    for (let i = 0; i < 4; i++) {
      const g = new THREE.Group();
      const body = new THREE.Mesh(new THREE.ConeGeometry(0.22, 1.4, 6), skinMat);
      body.rotation.x = Math.PI / 2;
      const head = new THREE.Mesh(new THREE.ConeGeometry(0.11, 0.9, 4), skinMat);
      head.rotation.x = Math.PI / 2;
      head.position.z = 1.05;
      const crest = new THREE.Mesh(new THREE.ConeGeometry(0.08, 0.6, 4), skinMat);
      crest.rotation.x = -Math.PI / 2 - 0.5;
      crest.position.set(0, 0.15, 0.55);
      g.add(body, head, crest);
      const wings = [];
      for (const s of [-1, 1]) {
        const pivot = new THREE.Group();
        pivot.position.x = s * 0.12;
        const tri = new THREE.BufferGeometry();
        tri.setAttribute('position', new THREE.Float32BufferAttribute([0, 0, 0.4, 0, 0, -0.45, s * 2.3, 0, -0.25], 3));
        tri.computeVertexNormals();
        pivot.add(new THREE.Mesh(tri, wingMat));
        g.add(pivot);
        wings.push({ pivot, s });
      }
      mergeChildren(g);          // body, head and crest; the wings flap on their own pivots
      shadows(g, false, false);  // they're up high and tiny; shadows aren't worth the draw calls
      this.group.add(g);
      this.pteros.push({ g, wings, ...orbit(11 + Math.random() * 5, 0.07, 0.13) });
    }

    const cloudMat = lambert({ color: '#ffffff', emissive: '#fff4e8', emissiveIntensity: 0.55, flatShading: true });
    for (let i = 0; i < 16; i++) {
      const g = new THREE.Group();
      const n = 3 + Math.floor(Math.random() * 4);
      for (let k = 0; k < n; k++) {
        const puff = new THREE.Mesh(new THREE.IcosahedronGeometry(1 + Math.random() * 1.2, 1), cloudMat);
        puff.position.set((k - n / 2) * 1.3, Math.random() * 0.6, (Math.random() - 0.5) * 1.5);
        puff.scale.y = 0.6;
        g.add(puff);
      }
      mergeChildren(g);
      this.group.add(g);
      this.clouds.push({ g, ...orbit(17 + Math.random() * 6, 0.01, 0.025) });
    }
  }

  erupt() { this.eruptT = 4.5; }

  // The planet grew (or shrank) by dR, to R: scale the ground and lift everything standing on it.
  regrow(dR) {
    this.planet.scale.setScalar(R / this.builtR);
    if (this.ash) this.ash.scale.setScalar((R + 0.05) / (this.ashR + 0.05));
    for (const obj of this.group.children) if (obj !== this.fireLight) lift(obj, dR);
    const m = new THREE.Matrix4();
    for (const mesh of this.decor) {
      for (let i = 0; i < mesh.count; i++) {
        mesh.getMatrixAt(i, m);
        const e = m.elements, k = 1 + dR / Math.hypot(e[12], e[13], e[14]);
        e[12] *= k; e[13] *= k; e[14] *= k;
        mesh.setMatrixAt(i, m);
      }
      mesh.instanceMatrix.needsUpdate = true;
      mesh.boundingSphere = null;   // (recomputed for culling)
    }
    this.group.updateMatrixWorld(true);
    for (const fire of this.fires) fire.lightPos = fire.group.localToWorld(new THREE.Vector3(0, 1.1, 0));
    this.volcanoTop?.setLength(R + 9.2);
  }

  // 0 = lush, 1 = ruined by the end of the world: a crust (ash, mud or ice, coloured by
  // `look.crust` and `look.glow`) grows over the whole planet.
  setDoom(k, look) {
    if (!this.ash) {
      if (k <= 0) return;
      this.ash = new THREE.Mesh(
        new THREE.SphereGeometry(R + 0.05, 64, 40),
        lambert({ emissiveIntensity: 0, transparent: true, opacity: 0, depthWrite: false }),
      );
      this.ash.receiveShadow = true;
      this.ash.renderOrder = 1;
      this.ashR = R;
      this.group.add(this.ash);
    }
    if (look !== this.ashLook) {
      this.ashLook = look;
      this.ash.material.color.set(look.crust);
      this.ash.material.emissive.set(look.glow);
    }
    this.ash.visible = k > 0.005;
    this.ash.material.opacity = Math.min(0.92, k);
    this.ash.material.emissiveIntensity = k * (0.6 + Math.sin(this.time * 3) * 0.2);
  }

  // focus: where the camera is, so the one campfire light can follow the nearest fire
  update(dt, focus) {
    this.time += dt;
    const t = this.time;
    const p = new THREE.Vector3(), f = new THREE.Vector3();
    const flyer = (o, bank = 0) => {
      const ang = o.phase + t * o.speed;
      p.copy(o.start).applyAxisAngle(o.axis, ang);
      f.crossVectors(o.axis, p).normalize();
      placeOnSphere(o.g, [p.x, p.y, p.z], [f.x, f.y, f.z], o.h);
      if (bank) o.g.rotateZ(bank);
    };
    for (const pt of this.pteros) {
      flyer(pt, Math.sin(t * 0.7 + pt.phase) * 0.3);
      const flap = Math.sin(t * 5 + pt.phase * 3) * 0.55;
      for (const w of pt.wings) w.pivot.rotation.z = w.s * flap;
    }
    for (const c of this.clouds) flyer(c);

    let nearest = null, nearestD = 40 * 40;
    for (const fire of this.fires) {
      const d = focus ? fire.lightPos.distanceToSquared(focus) : Infinity;
      if (d < nearestD) { nearestD = d; nearest = fire; }
    }
    if (nearest) {
      this.fireLight.position.copy(nearest.lightPos);
      this.fireLight.intensity = nearest.base * (0.85 + Math.sin(t * 17) * 0.08 + Math.random() * 0.12);
    } else {
      this.fireLight.intensity = 0;
    }

    for (const fire of this.fires) {
      if (!fire.group.visible) continue;   // behind the horizon: no point animating it
      // the roast browns as it cooks; a done one turns slowly on the spit
      const cooked = fire.readyAt <= t ? 1 : 1 - (fire.readyAt - t) / MEAT.cook;
      fire.meat.material.color.copy(MEAT_RAW_C).lerp(MEAT_DONE_C, Math.max(0, Math.min(1, cooked)));
      fire.meat.rotation.x += dt * (cooked >= 1 ? 0.8 : 0.3);
      fire.flames.forEach((fl, i) => {
        fl.scale.set(1 + Math.sin(t * 11 + i) * 0.08, 1 + Math.sin(t * 13 + i * 2) * 0.18 + Math.random() * 0.08, 1);
        fl.rotation.y += dt * (1 + i);
      });
      if ((fire.smoke -= dt) <= 0) {
        fire.smoke = 0.25;
        const up = fire.group.position.clone().normalize();
        const pos = fire.group.position.clone().addScaledVector(up, 1.3);
        this.fx.puff(pos, { color: '#6d645c', size: 0.5, grow: 3, life: 2.4, vel: up.multiplyScalar(1.4), alpha: 0.35 });
        if (Math.random() < 0.5) this.fx.burst(pos, { count: 1, color: '#ffb03a', speed: 0.6, size: 0.06, life: 1.2, grav: -0.08, up: pos.clone().normalize(), emissive: true });
      }
    }

    if (this.lavaLight) {
      this.eruptT = Math.max(0, this.eruptT - dt);
      const e = this.eruptT > 0 ? 1 : 0;
      this.lavaLight.intensity = 50 + Math.sin(t * 3) * 8 + e * (80 + Math.random() * 60);
      this.lavaMat.color.setHSL(0.04 + Math.sin(t * 2) * 0.01, 1, 0.5 + e * 0.1 + Math.sin(t * 4) * 0.04);
      if ((this.smokeT -= dt) <= 0) {
        this.smokeT = e ? 0.05 : 0.22;
        const pos = this.volcanoTop.clone();
        pos.x += (Math.random() - 0.5) * 1.5;
        pos.z += (Math.random() - 0.5) * 1.5;
        const vel = new THREE.Vector3((Math.random() - 0.5) * 0.8, 2 + e * 4, (Math.random() - 0.5) * 0.8);
        this.fx.puff(pos, { color: e ? '#3a302a' : '#5d5550', size: 1.6 + e, grow: 3.5, life: 4, vel, alpha: 0.5 });
        if (e && Math.random() < 0.4) this.fx.burst(pos, { count: 3, color: '#ff6a1a', speed: 5, size: 0.18, life: 1.4, up: new THREE.Vector3(0, 1, 0), emissive: true });
      }
    }

    for (const pk of this.pickups.values()) {
      pk.holder.rotation.y += dt * 1.2;
      pk.holder.position.y = 1.55 + Math.sin(t * 2 + pk.id) * 0.12;
      pk.ringMat.opacity = 0.45 + Math.sin(t * 3 + pk.id) * 0.15;
    }
  }
}
