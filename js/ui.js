import * as THREE from 'three';
import { makeBody, circularVelocity, horizon } from './physics.js';

const $ = (id) => document.getElementById(id);
const NAMES = { rocky: 'Planeta rochoso', gas: 'Gigante gasoso', star: 'Estrela', blackhole: 'Buraco negro', pulsar: 'Pulsar' };
const DEF = {
  rocky: { mass: 1, radius: 1.5, color: '#3a7bd5' },
  gas: { mass: 60, radius: 3.5, color: '#d9a066' },
  star: { mass: 8000, radius: 4, color: '#ffd27a' },
  blackhole: { mass: 5000, radius: 1, color: '#000000' },
  pulsar: { mass: 3000, radius: 1.2, color: '#9fe8ff' },
};
const field = (p, k, l) => `<label>${l}<input id="${p}-${k}" type="number" step="any"></label>`;

export class UI {
  constructor(api) {
    this.api = api; this.tickN = 0;
    const { state, rd } = api;

    $('sp-fields').innerHTML = [['mass', 'Massa'], ['radius', 'Raio'], ['px', 'X'], ['py', 'Y'], ['pz', 'Z'], ['vx', 'Vx'], ['vy', 'Vy'], ['vz', 'Vz']]
      .map(([k, l]) => field('sp', k, l)).join('') + '<label>Cor<input id="sp-color" type="color"></label>';
    $('ed-fields').innerHTML = [['mass', 'Massa'], ['radius', 'Raio'], ['vx', 'Vx'], ['vy', 'Vy'], ['vz', 'Vz']]
      .map(([k, l]) => field('ed', k, l)).join('');

    // Simulação
    $('play').onclick = () => { state.playing = !state.playing; $('play').textContent = state.playing ? '⏸ Pausar' : '▶ Continuar'; };
    $('speed').oninput = (e) => { state.speed = 0.05 * 400 ** +e.target.value; $('speedVal').textContent = state.speed.toFixed(2) + '×'; };
    $('reset').onclick = api.reset;
    $('grid').onchange = (e) => (rd.grid.visible = e.target.checked);

    // Criação de corpos
    document.querySelectorAll('[data-add]').forEach((b) => (b.onclick = () => this.openSpawn(b.dataset.add)));
    $('sp-cancel').onclick = () => $('spawn').close();
    $('spawn-form').onsubmit = (e) => { e.preventDefault(); this.spawn(); $('spawn').close(); };
    $('sp-orbit').onclick = () => {
      const p = new THREE.Vector3(this.sv('px'), this.sv('py'), this.sv('pz'));
      circularVelocity(p, api.phys.bodies).forEach((x, i) => ($('sp-v' + 'xyz'[i]).value = x.toFixed(2)));
    };

    // Editor em tempo real
    ['mass', 'radius', 'vx', 'vy', 'vz'].forEach((k) => ($('ed-' + k).oninput = (e) => this.edit(k, +e.target.value)));
    $('ed-close').onclick = () => this.select(null);
    $('ed-follow').onclick = () => {
      state.follow = state.follow === state.selected ? null : state.selected;
      $('ed-follow').textContent = state.follow ? 'Soltar câmera' : 'Seguir';
    };
    $('ed-del').onclick = () => {
      const b = state.selected, bodies = api.phys.bodies;
      bodies.splice(bodies.indexOf(b), 1); b.dead = true; rd.removeBody(b);
      if (state.follow === b) state.follow = null;
      this.select(null);
    };
    $('ed-bh').onclick = () => { // botão mágico
      const b = state.selected;
      if (!b || b.type === 'blackhole') return;
      b.fromR = b.radius; b.fromColor = b.color;
      b.type = 'blackhole';
      b.mass = Math.max(b.mass, 3000); // massa mínima para o efeito ser visível
      b.radius = horizon(b.mass); b.morph = 0;
      rd.buildBody(b); this.select(b);
    };
  }

  sv(k) { return +$('sp-' + k).value || 0; }

  openSpawn(type) {
    this.type = type;
    const d = DEF[type], a = Math.random() * Math.PI * 2;
    $('sp-title').textContent = NAMES[type];
    const set = { mass: d.mass, radius: d.radius, color: d.color, px: Math.round(90 * Math.cos(a)), py: 0, pz: Math.round(90 * Math.sin(a)), vx: 0, vy: 0, vz: 0 };
    for (const k in set) $('sp-' + k).value = set[k];
    $('sp-radius').disabled = type === 'blackhole';
    $('spawn').showModal();
  }

  spawn() {
    const t = this.type;
    const b = makeBody({
      type: t, name: `${NAMES[t]} ${Math.floor(Math.random() * 900 + 100)}`,
      mass: Math.max(0.01, this.sv('mass')), radius: Math.max(0.2, this.sv('radius')), color: $('sp-color').value,
      pos: [this.sv('px'), this.sv('py'), this.sv('pz')], vel: [this.sv('vx'), this.sv('vy'), this.sv('vz')],
    });
    this.api.phys.add(b); this.select(b);
  }

  edit(k, val) {
    const b = this.api.state.selected;
    if (!b || !isFinite(val)) return;
    if (k === 'mass' && val > 0) { b.mass = val; if (b.type === 'blackhole') b.radius = horizon(val); }
    else if (k === 'radius' && val > 0 && b.type !== 'blackhole') { b.radius = val; this.api.rd.buildBody(b); }
    else if (k[0] === 'v') b.vel['xyz'.indexOf(k[1])] = val;
  }

  select(b) {
    this.api.state.selected = b;
    $('editor').hidden = !b;
    if (b) { $('ed-follow').textContent = this.api.state.follow === b ? 'Soltar câmera' : 'Seguir'; this.refresh(true); }
  }

  refresh(force) {
    const b = this.api.state.selected; if (!b) return;
    $('ed-name').textContent = `${b.name} (${NAMES[b.type]})`;
    $('ed-radius').disabled = $('ed-bh').disabled = b.type === 'blackhole';
    const vals = { mass: b.mass, radius: b.radius, vx: b.vel.x, vy: b.vel.y, vz: b.vel.z };
    for (const k in vals) { const el = $('ed-' + k); if (force || document.activeElement !== el) el.value = vals[k].toFixed(2); }
  }

  tick() { if (++this.tickN % 8 === 0) this.refresh(false); }
}
