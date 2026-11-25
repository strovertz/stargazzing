import './style.css';
import { css } from './core/color';
import { COLS, ROWS, SPECIES, TICK_MS } from './sim/constants';
import { genesisFor, hourAt, isNight, Simulation, stageOf } from './sim/simulation';
import type { Agent, WorldFile } from './sim/types';
import { CW, CH, Renderer } from './render/renderer';
import { spritesFor } from './render/sprites';

const STATE_PT: Record<Agent['state'], string> = { ARRIVE: 'chegando', PLANT: 'plantando a árvore', WANDER: 'passeando', WATER: 'regando a árvore', REST: 'descansando', VISIT: 'visitando', GATHER: 'na roda das ruínas', FISH: 'Pescando um poquin...' };
const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;

let world: WorldFile;
let sim: Simulation;
let renderer: Renderer;
let simMs = 0, ready = false, follow = false;
let selected: Agent | null = null, hovered: Agent | null = null;

const tz = () => world.timezoneOffsetHours;
const fmt = (ms: number) => { const d = new Date(ms + tz() * 3_600_000); return `${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')}`; };
function stateText(a: Agent): string {
  if (!a.present) return `chega às ${fmt(sim.genesis + a.arriveTick * TICK_MS)}`;
  if (a.state === 'VISIT' && a.friend) return `visitando ${a.friend.name}`;
  return STATE_PT[a.state];
}
function spriteCanvas(a: Agent): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = 8; c.height = 14;
  c.getContext('2d')!.drawImage(spritesFor(a.name, a.look).stand, 0, 0);
  return c;
}

// ---------- gaveta de players ----------
let listKey = '';
const rowsUi = new Map<Agent, { b: HTMLButtonElement; st: HTMLElement }>();
let cardSub: [HTMLElement, HTMLElement] | null = null;
const playersOpen = () => $('playersDrawer').classList.contains('open');
function renderPlayers(force = false): void {
  $('nBadge').textContent = String(sim.agents.filter(a => a.present).length);
  if (!force && !playersOpen()) return;
  const q = $<HTMLInputElement>('search').value.trim().toLowerCase();
  const key = `${sim.agents.length}|${selected?.name ?? ''}|${q}`, list = $('list');
  if (key !== listKey) {
    listKey = key;
    list.textContent = '';
    rowsUi.clear();
    if (!sim.agents.length) {
      const e = document.createElement('p');
      e.className = 'msg';
      e.textContent = 'Ninguém deu star ainda. O primeiro morador pode ser você.';
      list.append(e);
    }
    for (const a of sim.agents) {
      if (q && !a.name.toLowerCase().includes(q)) continue;
      const b = document.createElement('button');
      b.className = 'who';
      b.setAttribute('aria-pressed', String(a === selected));
      const tx = document.createElement('span'), nm = document.createElement('span'), st = document.createElement('span');
      nm.className = 'nm'; st.className = 'st'; nm.textContent = a.name;
      tx.append(nm, st);
      b.append(spriteCanvas(a), tx);
      b.addEventListener('click', () => select(a === selected ? null : a));
      list.append(b);
      rowsUi.set(a, { b, st });
    }
    renderCard();
  }
  for (const [a, u] of rowsUi) { u.st.textContent = stateText(a); u.b.classList.toggle('away', !a.present); }
  updateCard();
}
function renderCard(): void {
  const c = $('card');
  c.textContent = '';
  cardSub = null;
  if (!selected) return;
  const a = selected, box = document.createElement('div');
  box.className = 'card';
  const h4 = document.createElement('h4');
  h4.textContent = a.name;
  h4.style.color = css(a.col);
  const s1 = document.createElement('div'), s2 = document.createElement('div');
  s1.className = s2.className = 'sub';
  cardSub = [s1, s2];
  box.append(spriteCanvas(a), h4, s1, s2);
  for (const [k, v] of [['Energia', a.traits.energy], ['Sociável', a.traits.social], ['Jardineiro', a.traits.gardener], ['Explorador', a.traits.wander]] as const) {
    const row = document.createElement('div'), l = document.createElement('span'), m = document.createElement('span'), i = document.createElement('i');
    row.className = 'trait'; m.className = 'm'; l.textContent = k; i.style.width = `${(v * 100).toFixed(0)}%`;
    m.append(i); row.append(l, m); box.append(row);
  }
  c.append(box);
  updateCard();
}
function updateCard(): void {
  if (!selected || !cardSub) return;
  const a = selected, t = a.tree, sp = SPECIES[a.species]!;
  const when = a.meta.days ? `Star há ${a.meta.days} dia${a.meta.days > 1 ? 's' : ''}` : `Star hoje às ${fmt(sim.genesis + a.arriveTick * TICK_MS)}`;
  cardSub[0].textContent = `${when} · ${stateText(a)}`;
  cardSub[1].textContent = t ? `${sp.n}: ${['muda', 'broto', 'arbusto', 'árvore adulta'][stageOf(t)]}${sim.tick - t.lastWater > 3000 ? ', com sede' : ''}` : `${sp.n}, ainda não plantada`;
}
function renderStatus(): void {
  $('clock').textContent = fmt(sim.genesis + sim.tick * TICK_MS);
  const h = hourAt(sim.tick), rain = sim.isRain();
  $('weather').textContent = (rain ? 'chuva' : 'céu limpo') + (isNight(h) || h >= 20 ? ', noite' : h < 7 ? ', amanhecer' : h >= 17.5 ? ', entardecer' : ', dia');
  $('nPeople').textContent = `${sim.agents.filter(a => a.present).length}/${sim.agents.length}`;
  $('nTrees').textContent = String(sim.trees.length);
  let f = 0;
  for (const v of sim.flower) if (v) f++;
  $('nFlowers').textContent = String(f);
}
function select(a: Agent | null): void { selected = a; follow = !!a?.present; listKey = ''; renderPlayers(true); }
function openDrawer(id: string): void {
  for (const d of document.querySelectorAll<HTMLElement>('.drawer')) {
    const on = d.id === id && !d.classList.contains('open');
    d.classList.toggle('open', on);
    d.setAttribute('aria-hidden', String(!on));
  }
  if (id === 'playersDrawer') { listKey = ''; renderPlayers(true); }
}

// ---------- reconstrução do dia ----------
function start(): void {
  const now = Date.now();
  sim = new Simulation(world, genesisFor(now, tz()));
  if (renderer) renderer.setSim(sim);
  else renderer = new Renderer($<HTMLCanvasElement>('bg'), $<HTMLCanvasElement>('fg'), $<HTMLCanvasElement>('mini'), sim);
  const p = sim.terrain.plazas[0]!;
  renderer.cam = { x: p.x, y: p.y + 6 };
  renderer.clampCam();
  selected = null; listKey = ''; simMs = now;
  ready = false;
  const target = sim.tickAt(simMs), el = $('loading'), bar = $('loadBar'), txt = $('loadTxt'), t0 = performance.now();
  el.hidden = false;
  const chunk = () => {
    sim.runUntil(Math.min(target, sim.tick + 8000));
    bar.style.width = `${(target ? (sim.tick / target) * 100 : 100).toFixed(1)}%`;
    txt.textContent = `Refazendo o dia desde 00:00 a partir da semente: ${sim.tick.toLocaleString('pt-BR')} de ${target.toLocaleString('pt-BR')} ticks`;
    if (sim.tick < target) { setTimeout(chunk, 0); return; }
    renderer.warm = true; renderer.drawScene((sim.tick * TICK_MS) / 1000);
    el.hidden = true; ready = true;
    renderStatus(); renderPlayers(true);
    $('msg').textContent = `Mundo refeito em ${((performance.now() - t0) / 1000).toFixed(1)} s.`;
  };
  chunk();
}

let lastScene = 0, lastUi = 0, lastMini = 0, lastFrame = 0;
/** 30 quadros por segundo bastam: o mundo anda a cada 500 ms e o resto é interpolado. */
const FRAME_MS = 1000 / 30 - 2;
function loop(now: number): void {
  if (ready && now - lastFrame >= FRAME_MS) {
    lastFrame = now;
    simMs = Date.now(); // sempre ao vivo: o mundo segue o relógio real
    sim.runUntil(sim.tickAt(simMs), 5000);
    const tf = (simMs - sim.genesis) / TICK_MS, ts = (tf * TICK_MS) / 1000;
    if (follow && selected?.present) {
      const a = selected, f = Math.min(1, Math.max(0, (tf - a.mt) / a.pace));
      const tx = a.px + (a.x - a.px) * f, ty = a.py + (a.y - a.py) * f, c = renderer.cam;
      if (Math.abs(tx - c.x) + Math.abs(ty - c.y) > 0.02) { c.x += (tx - c.x) * 0.08; c.y += (ty - c.y) * 0.08; renderer.clampCam(); }
    }
    if (renderer.dirty || now - lastScene > 100) { renderer.drawScene(ts); lastScene = now; }
    renderer.drawActors(tf, selected, hovered);
    if (now - lastMini > 500) { renderer.drawMini(selected); lastMini = now; }
    if (now - lastUi > 1000) { renderStatus(); renderPlayers(); lastUi = now; }
  }
  requestAnimationFrame(loop);
}

// ---------- eventos ----------
function bind(): void {
  $('openHow').addEventListener('click', () => openDrawer('howDrawer'));
  $('openPlayers').addEventListener('click', () => openDrawer('playersDrawer'));
  document.querySelectorAll('[data-close]').forEach(b => b.addEventListener('click', () => openDrawer('')));
  addEventListener('resize', () => renderer.resize());
  addEventListener('keydown', e => {
    if (e.key === 'Escape') openDrawer('');
    if ((e.target as HTMLElement).tagName === 'INPUT') return;
    const k = ({ ArrowLeft: [-4, 0], ArrowRight: [4, 0], ArrowUp: [0, -3], ArrowDown: [0, 3] } as Record<string, [number, number]>)[e.key];
    if (k) { follow = false; renderer.pan(k[0], k[1]); }
  });
  $('search').addEventListener('input', () => renderPlayers(true));
  $('zin').addEventListener('click', () => renderer.setZoom(renderer.zi + 1));
  $('zout').addEventListener('click', () => renderer.setZoom(renderer.zi - 1));
  const fg = $<HTMLCanvasElement>('fg');
  // trackpad manda dezenas de eventos por gesto: acumula e troca no máximo um nível a cada 140 ms
  let wheelAcc = 0, lastZoom = 0;
  fg.addEventListener('wheel', e => {
    e.preventDefault();
    wheelAcc += e.deltaMode === 1 ? e.deltaY * 16 : e.deltaY;
    const now = performance.now();
    if (Math.abs(wheelAcc) < 60 || now - lastZoom < 140) return;
    renderer.setZoom(renderer.zi + (wheelAcc < 0 ? 1 : -1), e.offsetX, e.offsetY);
    wheelAcc = 0; lastZoom = now;
  }, { passive: false });
  let drag: { x: number; y: number; cx: number; cy: number; moved: boolean } | null = null;
  fg.addEventListener('pointerdown', e => { drag = { x: e.clientX, y: e.clientY, cx: renderer.cam.x, cy: renderer.cam.y, moved: false }; fg.setPointerCapture(e.pointerId); });
  fg.addEventListener('pointermove', e => {
    if (!drag) { hovered = renderer.agentAt(e.offsetX, e.offsetY); return; }
    const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
    if (!drag.moved && Math.abs(dx) + Math.abs(dy) > 5) { drag.moved = true; follow = false; fg.classList.add('dragging'); $('hint').style.display = 'none'; }
    if (drag.moved) { renderer.cam.x = drag.cx - dx / (CW * renderer.zoom); renderer.cam.y = drag.cy - dy / (CH * renderer.zoom); renderer.clampCam(); }
  });
  fg.addEventListener('pointerup', e => {
    if (drag && !drag.moved) { const a = renderer.agentAt(e.offsetX, e.offsetY); select(a); if (a && !playersOpen()) openDrawer('playersDrawer'); }
    drag = null;
    fg.classList.remove('dragging');
  });
  fg.addEventListener('pointerleave', () => { hovered = null; });
  $('mini').addEventListener('click', e => {
    const r = $('mini').getBoundingClientRect();
    renderer.cam = { x: ((e.clientX - r.left) / r.width) * COLS, y: ((e.clientY - r.top) / r.height) * ROWS };
    follow = false;
    renderer.clampCam();
  });
}

async function boot(): Promise<void> {
  const res = await fetch(`${import.meta.env.BASE_URL}world.json`, { cache: 'no-cache' });
  world = (await res.json()) as WorldFile;
  const n = world.stargazers.length;
  $('dataNote').textContent = `${n} stargazer${n === 1 ? '' : 's'} reais de ${world.repo}` +
    (world.generatedAt ? `, lidos em ${new Date(world.generatedAt).toLocaleString('pt-BR')}.` : '.') +
    ' A lista é atualizada a cada star nova e a cada 30 minutos.';
  await document.fonts?.load('16px "JetBrains Mono"').catch(() => undefined);
  start();
  bind();
  requestAnimationFrame(loop);
}
boot().catch(err => { $('loadTxt').textContent = `Não consegui carregar o mundo: ${String(err)}`; });
