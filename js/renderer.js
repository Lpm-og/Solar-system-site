import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

const ADD = THREE.AdditiveBlending, Z = new THREE.Vector3(0, 0, 1), BLACK = new THREE.Color(0);

const canvasTex = (w, h, draw) => {
  const c = document.createElement('canvas'); c.width = w; c.height = h; draw(c.getContext('2d'));
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
};
const glowTex = canvasTex(128, 128, (x) => {
  const g = x.createRadialGradient(64, 64, 0, 64, 64, 64);
  g.addColorStop(0, 'rgba(255,255,255,1)'); g.addColorStop(0.25, 'rgba(255,255,255,.35)'); g.addColorStop(1, 'rgba(255,255,255,0)');
  x.fillStyle = g; x.fillRect(0, 0, 128, 128);
});
const diskTex = canvasTex(256, 256, (x) => {
  const g = x.createRadialGradient(128, 128, 0, 128, 128, 128);
  g.addColorStop(0.24, 'rgba(255,240,200,0)'); g.addColorStop(0.3, 'rgba(255,235,180,1)');
  g.addColorStop(0.55, 'rgba(255,120,30,.7)'); g.addColorStop(1, 'rgba(120,20,0,0)');
  x.fillStyle = g; x.fillRect(0, 0, 256, 256);
});
const bandTex = (color) => canvasTex(4, 64, (x) => {
  const base = new THREE.Color(color);
  for (let i = 0; i < 64; i++) {
    x.fillStyle = '#' + base.clone().multiplyScalar(0.65 + 0.35 * Math.sin(i * 0.9) * Math.cos(i * 0.23)).getHexString();
    x.fillRect(0, i, 4, 1);
  }
});
const glow = (color, size, op = 1) => {
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex, color, blending: ADD, transparent: true, depthWrite: false, opacity: op }));
  s.scale.setScalar(size); return s;
};

export class Renderer {
  constructor(canvas) {
    this.r = new THREE.WebGLRenderer({ canvas, antialias: true });
    this.r.setPixelRatio(Math.min(devicePixelRatio, 2));
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x02030a);
    this.cam = new THREE.PerspectiveCamera(55, 1, 0.1, 5000);
    this.controls = new OrbitControls(this.cam, canvas);
    this.controls.enableDamping = true; this.controls.maxDistance = 1500;
    this.scene.add(new THREE.AmbientLight(0x404868, 1.4));
    this.fx = []; this.frame = 0;
    this.resetCamera();

    // Campo de estrelas
    const sp = new Float32Array(9000), v = new THREE.Vector3();
    for (let i = 0; i < 3000; i++) { v.randomDirection().multiplyScalar(1800 + Math.random() * 800); sp.set([v.x, v.y, v.z], i * 3); }
    this.scene.add(new THREE.Points(
      new THREE.BufferGeometry().setAttribute('position', new THREE.BufferAttribute(sp, 3)),
      new THREE.PointsMaterial({ color: 0xffffff, size: 2, sizeAttenuation: false })));

    // Malha do espaço-tempo (plano XZ), deformada em Y pelo potencial gravitacional.
    const N = 72, S = 520, pos = new Float32Array((N + 1) ** 2 * 3), idx = [];
    for (let i = 0; i <= N; i++) for (let j = 0; j <= N; j++) {
      const k = i * (N + 1) + j;
      pos[k * 3] = (i / N - 0.5) * S; pos[k * 3 + 2] = (j / N - 0.5) * S;
      if (i < N) idx.push(k, k + N + 1);
      if (j < N) idx.push(k, k + 1);
    }
    const geo = new THREE.BufferGeometry().setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setIndex(idx);
    this.grid = new THREE.LineSegments(geo, new THREE.LineBasicMaterial({ color: 0x2f8fff, transparent: true, opacity: 0.38, depthWrite: false }));
    this.grid.frustumCulled = false;
    this.scene.add(this.grid);

    this.resize(); addEventListener('resize', () => this.resize());
  }

  resetCamera() { this.cam.position.set(0, 190, 330); this.controls.target.set(0, 0, 0); }
  resize() { this.r.setSize(innerWidth, innerHeight, false); this.cam.aspect = innerWidth / innerHeight; this.cam.updateProjectionMatrix(); }

  // Φ = -G Σ m/r  →  profundidade da malha (comprimida com tanh para não explodir).
  updateGrid(bodies) {
    if (!this.grid.visible) return;
    const p = this.grid.geometry.attributes.position, a = p.array;
    for (let k = 0; k < a.length; k += 3) {
      let phi = 0;
      for (const b of bodies) { const dx = a[k] - b.pos.x, dz = a[k + 2] - b.pos.z; phi += b.mass / Math.sqrt(dx * dx + dz * dz + 9); }
      a[k + 1] = -70 * Math.tanh((phi * 0.012) / 70);
    }
    p.needsUpdate = true;
  }

  addBody(b) {
    b.mesh = new THREE.Group(); b.mesh.userData.body = b;
    this.buildBody(b); this.scene.add(b.mesh);
    const n = 160, arr = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) arr.set([b.pos.x, b.pos.y, b.pos.z], i * 3);
    b.trail = new THREE.Line(new THREE.BufferGeometry().setAttribute('position', new THREE.BufferAttribute(arr, 3)),
      new THREE.LineBasicMaterial({ color: b.type === 'blackhole' ? 0xff9a40 : b.color, transparent: true, opacity: 0.45 }));
    b.trail.frustumCulled = false; this.scene.add(b.trail);
  }

  removeBody(b) {
    this.scene.remove(b.mesh, b.trail);
    b.trail?.geometry.dispose();
    b.mesh?.traverse((o) => o.geometry?.dispose());
  }

  buildBody(b) {
    const g = b.mesh, u = g.userData, col = new THREE.Color(b.color), t = b.type;
    g.clear(); u.disks = []; u.spin = null; u.r0 = b.radius;
    const core = (u.core = new THREE.Mesh(new THREE.SphereGeometry(1, 32, 24)));
    g.add(core);
    if (t === 'rocky') core.material = new THREE.MeshStandardMaterial({ color: col, roughness: 0.9 });
    else if (t === 'gas') core.material = new THREE.MeshStandardMaterial({ map: bandTex(b.color), roughness: 0.8 });
    else core.material = new THREE.MeshBasicMaterial({ color: t === 'blackhole' ? 0x000000 : col });

    if (t === 'star') { g.add(glow(col, b.radius * 7, 0.9)); g.add(new THREE.PointLight(col, 2.5, 0, 0)); }

    if (t === 'pulsar') { // feixes de radiação girando, inclinados em relação ao eixo de rotação
      g.add(glow(0x9fe8ff, b.radius * 10));
      const L = 60, tilt = new THREE.Group();
      tilt.rotation.z = 0.6; u.spin = new THREE.Group(); u.spin.add(tilt); g.add(u.spin);
      const geo = new THREE.ConeGeometry(b.radius * 3, L, 24, 1, true).rotateX(Math.PI).translate(0, L / 2, 0);
      const mat = new THREE.MeshBasicMaterial({ color: 0x8fe0ff, transparent: true, opacity: 0.22, blending: ADD, depthWrite: false, side: THREE.DoubleSide });
      const b1 = new THREE.Mesh(geo, mat), b2 = b1.clone(); b2.rotation.z = Math.PI;
      tilt.add(b1, b2);
    }

    if (t === 'blackhole') { // disco de acreção + anel "lenteado" sempre voltado para a câmera
      const mk = (k, o, bb) => {
        const m = new THREE.Mesh(new THREE.RingGeometry(b.radius * 1.5, b.radius * 6, 64),
          new THREE.MeshBasicMaterial({ map: diskTex, transparent: true, blending: ADD, side: THREE.DoubleSide, depthWrite: false, opacity: o }));
        if (!bb) m.rotation.x = -Math.PI / 2 + 0.3;
        m.userData = { k, o, bb }; g.add(m); u.disks.push(m);
      };
      mk(1, 1, false); mk(0.55, 0.8, true);
    }
  }

  update(dt, bodies) {
    const n = ++this.frame;
    for (const b of bodies) {
      const g = b.mesh; if (!g) continue;
      const u = g.userData, core = u.core;
      g.position.copy(b.pos);
      let s = b.radius;

      if (b.type === 'blackhole') {
        let e = 1;
        if (b.morph < 1) { // transformação fluida: encolhe até o horizonte e acende o disco
          b.morph = Math.min(1, b.morph + dt / 1.6);
          e = b.morph * b.morph * (3 - 2 * b.morph);
          s = THREE.MathUtils.lerp(b.fromR || s, b.radius, e);
          core.material.color.set(b.fromColor || '#000000').lerp(BLACK, e);
        }
        for (const d of u.disks) {
          if (d.userData.bb) d.quaternion.copy(this.cam.quaternion);
          d.scale.setScalar((e * d.userData.k * b.radius) / u.r0);
          d.material.opacity = e * d.userData.o;
        }
      }

      if (b.stretch > 1) { // espaguetificação: estica em direção ao buraco negro
        const q = 1 / Math.sqrt(b.stretch);
        core.quaternion.setFromUnitVectors(Z, b.dir);
        core.scale.set(s * q, s * q, s * b.stretch);
      } else { core.quaternion.identity(); core.scale.setScalar(s); core.rotation.y += dt * 0.3; }

      if (u.spin) u.spin.rotation.y += dt * 18;
      if (b.trail && n % 2 === 0) {
        const a = b.trail.geometry.attributes.position;
        a.array.copyWithin(0, 3); a.array.set([b.pos.x, b.pos.y, b.pos.z], a.array.length - 3); a.needsUpdate = true;
      }
    }
    this.fx = this.fx.filter((f) => f(dt));
  }

  // Supernova: partículas, onda de choque esférica e clarão.
  supernova(pos, radius, color) {
    const N = 1800, p = new Float32Array(N * 3), v = new Float32Array(N * 3), d = new THREE.Vector3();
    for (let i = 0; i < N; i++) {
      d.randomDirection().multiplyScalar(15 + Math.random() * 70);
      v.set([d.x, d.y, d.z], i * 3); p.set([pos.x, pos.y, pos.z], i * 3);
    }
    const geo = new THREE.BufferGeometry().setAttribute('position', new THREE.BufferAttribute(p, 3));
    const pts = new THREE.Points(geo, new THREE.PointsMaterial({
      size: 4, map: glowTex, color: new THREE.Color(color).lerp(new THREE.Color(0xffffff), 0.5),
      blending: ADD, transparent: true, depthWrite: false }));
    pts.frustumCulled = false;
    const wave = new THREE.Mesh(new THREE.SphereGeometry(1, 32, 16),
      new THREE.MeshBasicMaterial({ color: 0xffeecc, transparent: true, blending: ADD, depthWrite: false, side: THREE.BackSide }));
    wave.position.copy(pos);
    const flash = glow(0xffffff, 1); flash.position.copy(pos);
    this.scene.add(pts, wave, flash);
    let t = 0;
    this.fx.push((dt) => {
      t += dt;
      for (let i = 0; i < p.length; i++) p[i] += v[i] * dt;
      geo.attributes.position.needsUpdate = true;
      pts.material.opacity = Math.max(0, 1 - t / 7);
      wave.scale.setScalar(radius + t * 90); wave.material.opacity = Math.max(0, 0.5 * (1 - t / 3));
      flash.scale.setScalar(Math.max(0.01, 260 * (1 - t / 1.5))); flash.material.opacity = Math.max(0, 1 - t / 1.5);
      if (t < 7) return true;
      this.scene.remove(pts, wave, flash); geo.dispose(); return false;
    });
  }

  // Seleção por proximidade na tela (funciona bem mesmo com corpos minúsculos).
  pick(bodies, x, y) {
    let best = null, bd = 28;
    for (const b of bodies) {
      const v = b.pos.clone().project(this.cam);
      if (v.z > 1) continue;
      const d = Math.hypot(((v.x + 1) / 2) * innerWidth - x, ((1 - v.y) / 2) * innerHeight - y);
      if (d < bd) { bd = d; best = b; }
    }
    return best;
  }

  render() { this.controls.update(); this.r.render(this.scene, this.cam); }
}
