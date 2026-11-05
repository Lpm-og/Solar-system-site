import { Renderer } from './renderer.js';
import { Physics, solarSystem } from './physics.js';
import { UI } from './ui.js';

const state = { playing: true, speed: 1, follow: null, selected: null };
const cv = document.getElementById('c');
const rd = new Renderer(cv);
const phys = new Physics();

function reset() {
  phys.bodies.forEach((b) => rd.removeBody(b));
  phys.bodies.length = 0; phys.events.length = 0;
  state.follow = null; ui.select(null);
  solarSystem(phys);
  rd.resetCamera();
}
const ui = new UI({ state, rd, phys, reset });

// Traduz eventos do motor de física em mudanças na cena 3D.
function sync() {
  for (const e of phys.events.splice(0)) {
    if (e.t === 'add') rd.addBody(e.b);
    else if (e.t === 'merge') {
      rd.removeBody(e.gone);
      for (const k of ['follow', 'selected']) if (state[k] === e.gone) state[k] = e.b;
    } else if (e.t === 'supernova') rd.supernova(e.pos, e.radius, e.color);
    else if (e.t === 'rebuild') {
      Object.assign(e.b, { fromR: e.fromR, fromColor: e.fromColor, morph: e.b.type === 'blackhole' ? 0 : 1 });
      rd.buildBody(e.b);
    }
  }
  if (state.follow?.dead) state.follow = null;
  if (state.selected?.dead) ui.select(null);
}

// Seleção por clique (ignora arrastes da câmera).
let down = null;
cv.addEventListener('pointerdown', (e) => (down = [e.clientX, e.clientY]));
cv.addEventListener('pointerup', (e) => {
  if (down && Math.hypot(e.clientX - down[0], e.clientY - down[1]) < 5) ui.select(rd.pick(phys.bodies, e.clientX, e.clientY));
});

let last = performance.now();
function frame(now) {
  requestAnimationFrame(frame);
  const dt = Math.min(0.05, (now - last) / 1000); last = now;

  if (state.playing) {
    const total = dt * 2.4 * state.speed;                 // tempo simulado neste frame
    const n = Math.min(40, Math.max(1, Math.ceil(total / 0.01))); // sub-passos p/ estabilidade
    for (let i = 0; i < n; i++) phys.step(total / n);
  }
  sync();

  const f = state.follow;
  if (f) { // câmera acompanha o corpo mantendo o enquadramento
    rd.cam.position.add(f.pos.clone().sub(rd.controls.target));
    rd.controls.target.copy(f.pos);
  }

  rd.updateGrid(phys.bodies);
  rd.update(dt, phys.bodies);
  rd.render();
  ui.tick();
}

reset();
requestAnimationFrame(frame);
