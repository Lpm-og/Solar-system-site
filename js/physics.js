import * as THREE from 'three';

// Unidades da simulação (não escalonadas): G = 1, "c²" = C2.
export const G = 1, C2 = 20000, SN_CRIT = 30000;
const RANK = { rocky: 0, gas: 1, star: 2, pulsar: 3, blackhole: 4 };
let uid = 1;

// Raio do horizonte de eventos (Schwarzschild: 2GM/c²), com mínimo visível.
export const horizon = (m) => Math.max(0.8, (2 * G * m) / C2);

export function makeBody(o) {
  const b = {
    id: uid++, name: o.name || `${o.type}-${uid}`, type: o.type, mass: o.mass,
    radius: o.radius || 1, color: o.color || '#4af',
    pos: new THREE.Vector3(...(o.pos || [0, 0, 0])),
    vel: new THREE.Vector3(...(o.vel || [0, 0, 0])),
    acc: new THREE.Vector3(), stretch: 1, dir: new THREE.Vector3(0, 0, 1),
    morph: 1, dead: false,
  };
  if (b.type === 'blackhole') { b.radius = horizon(b.mass); b.color = '#000000'; }
  return b;
}

// Velocidade tangencial circular em torno do corpo mais massivo.
export function circularVelocity(pos, bodies) {
  let c = null;
  for (const b of bodies) if (!c || b.mass > c.mass) c = b;
  if (!c) return [0, 0, 0];
  const r = pos.clone().sub(c.pos), d = r.length();
  if (d < 1e-3) return [0, 0, 0];
  const t = new THREE.Vector3(-r.z, 0, r.x).normalize().multiplyScalar(Math.sqrt((G * c.mass) / d));
  return [t.x + c.vel.x, t.y + c.vel.y, t.z + c.vel.z];
}

export class Physics {
  constructor() { this.bodies = []; this.events = []; }

  add(b) { this.bodies.push(b); this.events.push({ t: 'add', b }); return b; }

  // Gravidade newtoniana de N corpos (com suavização para evitar singularidades).
  accel() {
    const B = this.bodies, eps2 = 0.25, d = new THREE.Vector3();
    for (const b of B) b.acc.set(0, 0, 0);
    for (let i = 0; i < B.length; i++) {
      for (let j = i + 1; j < B.length; j++) {
        const a = B[i], c = B[j];
        d.subVectors(c.pos, a.pos);
        const r2 = d.lengthSq() + eps2, k = G / (r2 * Math.sqrt(r2));
        a.acc.addScaledVector(d, k * c.mass);
        c.acc.addScaledVector(d, -k * a.mass);
      }
    }
  }

  // Integrador leapfrog (velocity Verlet).
  step(dt) {
    const B = this.bodies;
    this.accel();
    for (const b of B) { b.vel.addScaledVector(b.acc, dt / 2); b.pos.addScaledVector(b.vel, dt); }
    this.accel();
    for (const b of B) b.vel.addScaledVector(b.acc, dt / 2);
    this.tidal(dt);
    this.collide();
  }

  // Espaguetificação: estiramento visual + perda de massa para o buraco negro.
  tidal(dt) {
    const bhs = this.bodies.filter((b) => b.type === 'blackhole');
    for (const b of this.bodies) {
      b.stretch = 1;
      if (b.type === 'blackhole') continue;
      for (const h of bhs) {
        const d = b.pos.distanceTo(h.pos), zone = h.radius * 10 + b.radius;
        if (d >= zone) continue;
        const k = 1 - d / zone;
        b.stretch = Math.max(b.stretch, 1 + 10 * k * k);
        b.dir.subVectors(h.pos, b.pos).normalize();
        if (b.mass > 0.01) {
          const loss = b.mass * 0.6 * k * dt;
          b.mass -= loss; h.mass += loss; h.radius = horizon(h.mass);
        }
      }
    }
  }

  collide() {
    const B = this.bodies;
    for (let i = 0; i < B.length; i++) {
      for (let j = i + 1; j < B.length; j++) {
        const a = B[i], c = B[j];
        if (a.dead || c.dead) continue;
        const ha = a.type === 'blackhole', hc = c.type === 'blackhole';
        // Com buraco negro, o corpo só é engolido ao cruzar o horizonte.
        const lim = ha || hc ? Math.max(ha ? a.radius : 0, hc ? c.radius : 0) : a.radius + c.radius;
        if (a.pos.distanceTo(c.pos) < lim) this.merge(a, c);
      }
    }
    this.bodies = B.filter((b) => !b.dead);
  }

  // Fusão com conservação de massa e momento linear.
  merge(a, c) {
    const [big, small] = (RANK[a.type] - RANK[c.type] || a.mass - c.mass) >= 0 ? [a, c] : [c, a];
    const m = a.mass + c.mass;
    big.vel.multiplyScalar(big.mass).addScaledVector(small.vel, small.mass).divideScalar(m);
    big.pos.multiplyScalar(big.mass).addScaledVector(small.pos, small.mass).divideScalar(m);
    const r3 = big.radius ** 3 + small.radius ** 3;
    big.mass = m; small.dead = true;
    big.radius = big.type === 'blackhole' ? horizon(m) : Math.cbrt(r3);
    this.events.push({ t: 'merge', b: big, gone: small });
    if (big.type === 'star' && m > SN_CRIT) this.supernova(big);
  }

  // Supernova: onda de choque empurra vizinhos; o núcleo vira pulsar ou buraco negro.
  supernova(b) {
    const fromR = b.radius, fromColor = b.color, bh = b.mass > 45000;
    this.events.push({ t: 'supernova', pos: b.pos.clone(), radius: b.radius, color: b.color });
    for (const o of this.bodies) {
      if (o === b || o.dead) continue;
      const d = o.pos.clone().sub(b.pos), r = d.length() + 1;
      o.vel.addScaledVector(d.normalize(), 600 / r);
    }
    b.mass *= 0.4;
    b.type = bh ? 'blackhole' : 'pulsar';
    b.radius = bh ? horizon(b.mass) : 1.2;
    b.color = bh ? '#000000' : '#9fe8ff';
    this.events.push({ t: 'rebuild', b, fromR, fromColor });
  }
}

// Sistema Solar padrão (massas e distâncias exageradas para boa visualização).
export function solarSystem(phys) {
  const sun = phys.add(makeBody({ name: 'Sol', type: 'star', mass: 20000, radius: 5, color: '#ffcc55' }));
  [
    ['Mercúrio', 0.2, 0.8, '#a9a9a9', 24, 'rocky'], ['Vênus', 0.8, 1.4, '#e8c07a', 36, 'rocky'],
    ['Terra', 1, 1.5, '#3a7bd5', 52, 'rocky'], ['Marte', 0.5, 1.1, '#c1440e', 70, 'rocky'],
    ['Júpiter', 80, 3.6, '#d9a066', 105, 'gas'], ['Saturno', 40, 3.1, '#e3d08a', 140, 'gas'],
    ['Urano', 12, 2.3, '#7fd6e0', 175, 'gas'], ['Netuno', 14, 2.2, '#4a6df0', 205, 'gas'],
  ].forEach(([name, mass, radius, color, r, type], i) => {
    const a = i * 2.1;
    const b = makeBody({ name, type, mass, radius, color, pos: [r * Math.cos(a), 0, r * Math.sin(a)] });
    b.vel.set(...circularVelocity(b.pos, [sun]));
    phys.add(b);
  });
}
