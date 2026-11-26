import './style.css';
import { css } from './core/color';
import { COLS, ROWS, SPECIES, TICK_MS } from './sim/constants';
import { genesisFor, hourAt, isNight, Simulation, stageOf } from './sim/simulation';
import type { Agent, WorldFile } from './sim/types';
import { CW, CH, Renderer } from './render/renderer';
import { spritesFor } from './render/sprites';
import { Ambience } from './audio/ambience';
import { lightningAt } from './sim/weather';
import { HOUSES, INSTRUMENTS, PROFS } from './sim/constants';
import { NEEDS, STARS_PER_COLUMN } from './sim/village';
import { moonPhase, nightTune } from './sim/extras';
import type { RepoData } from './sim/types';
import { Timelapse } from './ui/timelapse';
import { HouseView } from './ui/house';
import { Dialogue } from './ui/dialogue';
import { BoardView } from './ui/board';
import { achievementsOf, boardCount, firstPerson, moodOf, todayOf } from './sim/talk';
import { Visitor } from './ui/visitor';
import { BRIDGE_AT } from './sim/simulation';
import { fnv } from './core/rng';
import { encode, restore } from './sim/snapshot';
import { loadSnap, saveSnap } from './core/store';
import type { ReplayJob, ReplayMsg } from './sim/worker';
import { Play, treasureFor } from './ui/play';
import { highlightsSince, nextUp, renderAgenda, renderHistory, renderWeatherStrip } from './ui/chronicle';
import { applyA11y, describeScene, loadA11y, PALETTES } from './ui/a11y';

const STATE_PT: Record<Agent['state'], string> = { TAVERN: 'na ceia da taverna', BUILD: 'no mutirão', SICK: 'de cama, resfriado', ARRIVE: 'chegando', PLANT: 'plantando a árvore', WANDER: 'passeando', WATER: 'regando a árvore', REST: 'descansando', VISIT: 'visitando', GATHER: 'na roda da fogueira', FISH: 'Pescando um poquin...', CHAT: 'conversando', AGORA: 'passeando pela ágora', CHOP: 'cortando lenha', PLAY: 'tocando alaúde na ágora', GARDEN: 'cuidando do jardim', BOAT: 'remando no lago', SIGHT: 'visitando um marco', MINE: 'minerando na caverna', BUCKET: 'no mutirão contra o fogo', TASK: 'lendo o quadro de pedidos', GAME: 'jogando dama', FARM: 'cuidando do trigo', SELL: 'trocando na banca', BAKE: 'assando pão', MAIL: 'entregando cartas', CAMP: 'no acampamento' };
const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;

let world: WorldFile;
const clock = () => Date.now();
const params = new URLSearchParams(location.search);
let sim: Simulation;
let renderer: Renderer;
let simMs = 0, ready = false, follow = false;
let selected: Agent | null = null, hovered: Agent | null = null;

const tz = () => world.timezoneOffsetHours;
const fmt = (ms: number) => { const d = new Date(ms + tz() * 3_600_000); return `${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')}`; };
function stateText(a: Agent): string {
  if (!a.present) return `chega às ${fmt(sim.genesis + a.arriveTick * TICK_MS)}`;
  if (a.state === 'VISIT' && a.friend) return `visitando ${a.friend.name}`;
  if (a.state === 'CHAT' && a.friend && a.phase === 'stay') return `conversando com ${a.friend.name}`;
  if (a.state === 'GAME' && a.friend) return `jogando dama com ${a.friend.name}`;
  if (a.state === 'CAMP' && a.sight) return `${a.phase === 'stay' ? 'no' : 'indo ao'} ${a.sight}`;
  if (a.state === 'SIGHT' && a.sight) return `${a.phase === 'stay' ? 'no' : 'indo ao'} ${a.sight}`;
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
  const bioEl = document.createElement('p'), link = document.createElement('a');
  bioEl.className = 'bio'; bioEl.textContent = bio(a);
  link.className = 'gh'; link.href = `https://github.com/${encodeURIComponent(a.name)}`; link.target = '_blank'; link.rel = 'noopener'; link.textContent = `github.com/${a.name}`;
  const rel = document.createElement('p');
  rel.className = 'bio rel'; rel.textContent = relations(a);
  // link para seguir este morador e cartão SVG animado para o README
  const page = `${location.origin}${import.meta.env.BASE_URL}`;
  const share = document.createElement('div'); share.className = 'share';
  const mk = (label: string, text: string) => {
    const b = document.createElement('button'); b.textContent = label;
    b.addEventListener('click', () => { void navigator.clipboard?.writeText(text).then(() => { b.textContent = 'copiado ✓'; setTimeout(() => { b.textContent = label; }, 1600); }); });
    return b;
  };
  const favB = document.createElement('button'), isFav = () => play.favorite() === a.name;
  favB.textContent = isFav() ? '♥ favorito' : '♡ favoritar'; favB.setAttribute('aria-pressed', String(isFav()));
  favB.addEventListener('click', () => { play.setFavorite(isFav() ? null : a.name); renderer.favorite = play.favorite(); favB.textContent = isFav() ? '♥ favorito' : '♡ favoritar'; favB.setAttribute('aria-pressed', String(isFav())); });
  share.append(favB);
  share.append(mk('Copiar link', `${page}?u=${encodeURIComponent(a.name)}`), mk('Cartão p/ README', `[![${a.name} em Stargazzing](${page}cards/${encodeURIComponent(a.name.toLowerCase())}.svg)](${page}?u=${encodeURIComponent(a.name)})`));
  const ach = achievementsOf(sim, a), badges = document.createElement('div');
  badges.className = 'badges';
  for (const b of ach) { const s = document.createElement('span'); s.textContent = b.icon; s.title = b.name; s.setAttribute('aria-label', b.name); badges.append(s); }
  const note = sim.notes.get(a.name.toLowerCase()), noteEl = document.createElement('p');
  noteEl.className = 'bio note'; noteEl.textContent = note ? `Recado na porta: "${note}"` : '';
  // diário pessoal: as últimas coisas do dia, contadas pelo próprio morador
  const mine = todayOf(sim, a, 5).map(t => firstPerson(a, t));
  for (const l of sim.letters.filter(l => l.to === a.name && l.tick <= sim.tick).slice(-2)) mine.push(l.gift ? `Recebi uma carta de ${l.from} com ${l.gift} dentro` : `Recebi uma carta de ${l.from}`);
  for (const f of sim.favors.filter(f => f.to === a.name).slice(-1)) mine.push(`${f.from} me ajudou: ${f.what}`);
  if (a.helped) mine.push(`Ajudei ${a.helped} vizinho${a.helped > 1 ? 's' : ''} hoje`);
  if (a.tool) mine.push(`Peguei ${a.tool} emprestado no galpão`);
  if (a.sickUntil > sim.tick) mine.unshift('Tô de cama com um resfriado da tempestade');
  const diary = document.createElement('div');
  if (mine.length) {
    diary.className = 'pdiary';
    const h5 = document.createElement('b'); h5.textContent = `Diário de ${a.name}`;
    const ul = document.createElement('ul');
    for (const t of mine.slice(0, 5)) { const li = document.createElement('li'); li.textContent = `${t}.`; ul.append(li); }
    diary.append(h5, ul);
  }
  const ann = sim.anniversaries().find(x => x.a === a);
  if (ann) { const p = document.createElement('p'); p.className = 'bio note'; p.textContent = `Hoje faz ${ann.what} que ${a.name} mora na vila! Festa às 17h30.`; diary.prepend(p); }
  box.append(spriteCanvas(a), h4, s1, s2, bioEl, rel, ...(note ? [noteEl] : []), ...(ach.length ? [badges] : []), ...(mine.length || ann ? [diary] : []), share, link);
  const md = moodOf(sim, a);
  moodBars = [];
  for (const [k, v] of [['Fome', md.hunger], ['Cansaço', md.tired], ['Alegria', md.joy], ['Energia', a.traits.energy], ['Sociável', a.traits.social], ['Jardineiro', a.traits.gardener], ['Explorador', a.traits.wander]] as const) {
    const row = document.createElement('div'), l = document.createElement('span'), m = document.createElement('span'), i = document.createElement('i');
    row.className = 'trait'; m.className = 'm'; l.textContent = k; i.style.width = `${(v * 100).toFixed(0)}%`;
    m.append(i); row.append(l, m); box.append(row);
    if (k === 'Fome' || k === 'Cansaço' || k === 'Alegria') { row.classList.add('mood'); moodBars.push(i); }
  }
  c.append(box);
  updateCard();
}
function relations(a: Agent): string {
  const names = (l: Agent[]) => l.slice(0, 3).map(b => b.name).join(', ') + (l.length > 3 ? ` e mais ${l.length - 3}` : '');
  const bits = [
    a.partner ? `mora ao lado de ${a.partner.name}` : '',
    a.friends.length ? `amigos: ${names(a.friends)}` : '',
    a.rivals.length ? `não se bica com ${names(a.rivals)}` : '',
    a.pet ? `tem ${['um cachorro', 'um gato', 'uma galinha', 'um pato', 'um sapo'][a.pet.kind]} chamado ${a.pet.name}` : '',
    a.items.length ? `guardou hoje: ${a.items.slice(-4).join(', ')}` : '',
  ].filter(Boolean);
  return bits.length ? `${bits.join(' · ')}.` : 'Ainda sem amizades marcantes.';
}
let moodBars: HTMLElement[] = [];
function updateCard(): void {
  if (!selected || !cardSub) return;
  { const md = moodOf(sim, selected); [md.hunger, md.tired, md.joy].forEach((v, k) => { if (moodBars[k]) moodBars[k]!.style.width = `${(v * 100).toFixed(0)}%`; }); }
  const a = selected, t = a.tree, sp = SPECIES[a.species]!;
  const when = a.meta.days ? `Star há ${a.meta.days} dia${a.meta.days > 1 ? 's' : ''}` : `Star hoje às ${fmt(sim.genesis + a.arriveTick * TICK_MS)}`;
  cardSub[0].textContent = `${when} · ${stateText(a)}`;
  cardSub[1].textContent = t ? `${sp.n}: ${['muda', 'broto', 'arbusto', 'árvore adulta'][stageOf(t)]}${sim.tick - t.lastWater > 3000 ? ', com sede' : ''}` : `${sp.n}, ainda não plantada`;
}
function renderStatus(): void {
  const nu = nextUp(sim, t => fmt(sim.genesis + t * TICK_MS)), nb = $('nextUp');
  nb.hidden = !nu; if (nb.textContent !== nu) nb.textContent = nu;
  $('clock').textContent = fmt(sim.genesis + sim.tick * TICK_MS);
  const h = hourAt(sim.tick), w = sim.weather();
  const sky = w.kind === 'limpo' ? 'céu limpo' : w.kind;
  $('weather').textContent = sky + (w.wind > 0.7 && !w.storm ? ' e vento' : '') + (isNight(h) || h >= 20 ? ', noite' : h < 7 ? ', amanhecer' : h >= 17.5 ? ', entardecer' : ', dia');
  const ph = moonPhase(sim.genesis + sim.tick * TICK_MS);
  drawMoon(ph, sim.sky?.kind === 'eclipse' && (h >= 20 || h < 5));
  $('moonTxt').textContent = MOON[Math.round(ph * 8) % 8]!;
  $('season').textContent = SEASON[sim.season]!;
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
  const now = clock(), gen = ++startGen;
  sim = new Simulation(world, genesisFor(now, tz()));
  if (renderer) renderer.setSim(sim);
  else renderer = new Renderer($<HTMLCanvasElement>('bg'), $<HTMLCanvasElement>('fg'), $<HTMLCanvasElement>('mini'), sim);
  amb.setTune(nightTune(sim.genesis));
  const p = sim.terrain.plazas[0]!;
  renderer.cam = { x: p.x, y: p.y + 6 };
  renderer.clampCam();
  selected = null; listKey = ''; simMs = now;
  ready = false;
  const target = sim.tickAt(simMs), el = $('loading'), bar = $('loadBar'), txt = $('loadTxt'), t0 = performance.now();
  const key = snapKey(sim.genesis), base = sim.tick;
  el.hidden = false;
  const show = (tick: number, from: number) => {
    bar.style.width = `${(target ? (tick / target) * 100 : 100).toFixed(1)}%`;
    txt.textContent = from ? `Retomando do checkpoint das ${fmt(sim.genesis + from * TICK_MS)}: ${tick.toLocaleString('pt-BR')} de ${target.toLocaleString('pt-BR')} ticks`
      : `Refazendo o dia desde 00:00 a partir da semente: ${tick.toLocaleString('pt-BR')} de ${target.toLocaleString('pt-BR')} ticks`;
  };
  const finish = (from: number) => {
    renderer.setSim(sim);
    renderer.warm = true; renderer.drawScene((sim.tick * TICK_MS) / 1000);
    el.hidden = true; ready = true; savedHour = Math.floor(sim.tick / CHECK_EVERY);
    renderStatus(); renderPlayers(true);
    play.reset(sim);
    renderer.treasure = play.found(sim) ? null : treasureFor(sim);
    renderer.favorite = play.favorite();
    welcomeBack();
    // ?u=login: abre já seguindo esse morador
    const want = new URLSearchParams(location.search).get('u')?.toLowerCase();
    const who = want ? sim.agents.find(a => a.name.toLowerCase() === want) : undefined;
    if (who) { select(who); if (who.present) { renderer.cam = { x: who.x, y: who.y }; renderer.setZoom(5); renderer.clampCam(); } openDrawer('playersDrawer'); }
    $('msg').textContent = `Mundo ${from ? 'retomado' : 'refeito'} em ${((performance.now() - t0) / 1000).toFixed(1)} s.`;
    if (target - from > CHECK_EVERY) checkpoint();
  };
  // pedaços na thread principal (sem worker, ou pouco a refazer)
  const onMain = (from: number) => {
    const chunk = () => {
      sim.runUntil(Math.min(target, sim.tick + 8000));
      show(sim.tick, from);
      if (sim.tick < target) { setTimeout(chunk, 0); return; }
      finish(from);
    };
    chunk();
  };
  void loadSnap(key).then(snap => {
    if (gen !== startGen) return;
    if (snap && snap.tick <= target && snap.tick > base) restore(sim, snap);
    const from = sim.tick > base ? sim.tick : 0;
    if (target - sim.tick < 20_000 || typeof Worker === 'undefined') { onMain(from); return; }
    const w = new Worker(new URL('./sim/worker.ts', import.meta.url), { type: 'module' });
    const fallback = () => { w.terminate(); onMain(from); };
    w.onerror = fallback;
    w.onmessage = (e: MessageEvent<ReplayMsg>) => {
      if (gen !== startGen) { w.terminate(); return; }
      if (e.data.kind === 'progress') { show(e.data.tick, from); return; }
      w.terminate();
      restore(sim, e.data.snap);
      sim.runUntil(sim.tickAt(clock()), 5000);
      finish(from);
    };
    w.postMessage({ world, genesis: sim.genesis, target, key, from: snap && from ? snap : undefined } satisfies ReplayJob);
  });
}

/** Checkpoint a cada hora do mundo: a próxima visita retoma daqui em vez de refazer o dia. */
const CHECK_EVERY = 7200;
let savedHour = -1, startGen = 0;
const snapKey = (genesis: number) => `${__SIM_VERSION__}|${genesis}|${fnv(JSON.stringify([world.seed, world.timezoneOffsetHours, world.stargazers, world.extra ?? null]))}`;
function checkpoint(): void {
  const s = sim, key = snapKey(s.genesis);
  const run = () => { if (s === sim) void saveSnap(encode(s, key)); };
  if ('requestIdleCallback' in window) requestIdleCallback(run, { timeout: 4000 }); else setTimeout(run, 500);
}

let lastBoard = 0, lastScene = 0, lastUi = 0, lastMini = 0, lastFrame = 0, lastSound = 0;
const amb = new Ambience();

/** Dados públicos do GitHub de cada morador, buscados no deploy (opcional). */
interface Profile { name?: string; repos?: number; followers?: number; since?: number; lang?: string }
let profiles: Record<string, Profile> = {};
function bio(a: Agent): string {
  const p = profiles[a.name.toLowerCase()];
  const prof = PROFS[a.prof]! + (a.prof === 2 ? ` (${INSTRUMENTS[a.instrument]})` : ''), owl = a.owl ? ', coruja da vila' : '';
  if (!p) return `${prof[0]!.toUpperCase()}${prof.slice(1)}${owl}.`;
  const bits = [
    p.lang ? `Escreve mais em ${p.lang}` : '',
    p.repos !== undefined ? `${p.repos} repositório${p.repos === 1 ? '' : 's'} públicos` : '',
    p.since ? `no GitHub desde ${p.since}` : '',
  ].filter(Boolean);
  return `${prof[0]!.toUpperCase()}${prof.slice(1)}${owl}. ${bits.join(', ')}.`;
}

const MOON = ['lua nova', 'lua crescente', 'quarto crescente', 'gibosa crescente', 'lua cheia', 'gibosa minguante', 'quarto minguante', 'lua minguante'];
const SEASON = ['verão', 'outono', 'inverno', 'primavera'];
function drawMoon(ph: number, eclipse = false): void {
  const c = $<HTMLCanvasElement>('moon'), g = c.getContext('2d')!, r = 13;
  g.clearRect(0, 0, 32, 32);
  g.fillStyle = '#2a2f3a'; g.beginPath(); g.arc(16, 16, r, 0, 7); g.fill();
  // parte iluminada: meia lua de um lado + elipse que cresce ou encolhe
  const waxing = ph < 0.5, k = Math.cos(ph * Math.PI * 2);
  g.fillStyle = eclipse ? '#c0503a' : '#f2ecd8'; g.beginPath();
  g.arc(16, 16, r, -Math.PI / 2, Math.PI / 2, !waxing);
  g.ellipse(16, 16, Math.abs(k) * r, r, 0, Math.PI / 2, -Math.PI / 2, waxing ? k > 0 : k < 0);
  g.fill();
}

let diaryKey = '', wxKey = 0;
function renderDiary(): void {
  if (!$('diaryDrawer').classList.contains('open')) return;
  const local = visitor.entries(sim.genesis);
  const n = sim.stars, key = `${sim.log.length}|${n}|${sim.restored}|${local.length}`;
  if (key === diaryKey) return;
  diaryKey = key;
  const ft = (t: number) => fmt(sim.genesis + t * TICK_MS);
  renderAgenda(sim, $('agenda'), ft);
  if (wxKey !== sim.genesis + Math.floor(sim.tick / 7200)) { wxKey = sim.genesis + Math.floor(sim.tick / 7200); renderWeatherStrip(sim, $('wxday')); renderHistory(world, $('history'), tz()); }
  const works = $('works'); works.textContent = '';
  for (const [kind, need] of NEEDS) {
    const li = document.createElement('li'), b = document.createElement('b'), st = document.createElement('span');
    b.textContent = kind[0]!.toUpperCase() + kind.slice(1);
    const done = n >= need;
    st.textContent = done ? 'pronto' : `faltam ${need - n} star${need - n > 1 ? 's' : ''}`;
    li.className = done ? 'done' : '';
    li.append(b, st); works.append(li);
  }
  for (const [label, need] of [['Templo escondido', 25], ['Cristal do templo', 50], ['Ponte do riacho e mirante', BRIDGE_AT]] as const) {
    const li = document.createElement('li'), b = document.createElement('b'), st = document.createElement('span');
    b.textContent = label; st.textContent = n >= need ? 'pronto' : `faltam ${need - n} stars`;
    li.className = n >= need ? 'done' : ''; li.append(b, st); works.append(li);
  }
  const reqs = sim.requests.filter(q => q.state === 'open');
  for (const q of reqs.slice(0, 6)) {
    const li = document.createElement('li'), b = document.createElement('b'), st = document.createElement('span');
    b.textContent = `Pedido #${q.n}`; st.textContent = q.title; li.append(b, st); works.append(li);
  }
  {
    const li = document.createElement('li'), b = document.createElement('b'), st = document.createElement('span');
    b.textContent = 'Ecossistema'; st.textContent = `${sim.eco.rabbits} coelhos · ${sim.eco.foxes} raposas`;
    li.append(b, st); works.append(li);
  }
  const total = sim.terrain.columns.length, intact = sim.terrain.columns.filter(c => c.kind === 0).length;
  const li = document.createElement('li'), b = document.createElement('b'), st = document.createElement('span');
  b.textContent = 'Colunas da ágora'; st.textContent = `${intact} de ${total} em pé · 1 a cada ${STARS_PER_COLUMN} stars`;
  li.append(b, st); works.append(li);
  const ol = $('diary'); ol.textContent = '';
  const items = [...sim.log.slice(-120), ...local.map(e => ({ tick: Math.floor((e.ms - sim.genesis) / TICK_MS), text: `✦ ${e.text}` }))].sort((p, q) => q.tick - p.tick);
  if (!items.length) { const e = document.createElement('li'); e.textContent = 'Nada aconteceu ainda hoje.'; ol.append(e); }
  for (const e of items) {
    const li2 = document.createElement('li'), t = document.createElement('time'), sp = document.createElement('span');
    t.textContent = fmt(sim.genesis + e.tick * TICK_MS); sp.textContent = e.text;
    li2.append(t, sp); ol.append(li2);
  }
}

/** O que o som precisa saber: clima, hora e quão perto a câmera está de uma roda de fogueira. */
function updateSound(ts: number): void {
  const w = sim.weather(), h = hourAt(sim.tick), c = renderer.cam;
  let best = Infinity, fire = sim.terrain.plazas[0]!;
  for (const p of sim.terrain.plazas) { const d = Math.hypot(p.x - c.x, (p.y - c.y) * 2); if (d < best) { best = d; fire = p; } }
  const near = Math.max(0, 1 - best / 40) * Math.min(1, renderer.zoom / 1.25);
  const crowd = sim.agents.filter(a => a.present && (a.state === 'GATHER' || (a.state === 'PLAY' && a.phase === 'stay')) && Math.abs(a.x - fire.x) < 14 && Math.abs(a.y - fire.y) < 8).length
    + (sim.agents.some(a => a.state === 'PLAY' && a.phase === 'stay' && Math.abs(a.x - fire.x) < 14) ? 2 : 0);
  const day = h >= 6.5 && h < 18.5 ? 1 : h >= 5.5 && h < 19.5 ? 0.5 : 0;
  const players = sim.agents.filter(a => a.present && a.prof === 2 && a.phase === 'stay' && (a.state === 'PLAY' || a.state === 'GATHER') && Math.abs(a.x - fire.x) < 14 && Math.abs(a.y - fire.y) < 8)
    .concat(sim.agents.filter(a => a.present && a.prof === 2 && a.phase === 'boid' && a.state === 'GATHER' && Math.abs(a.x - fire.x) < 14 && Math.abs(a.y - fire.y) < 8));
  amb.setTune(nightTune(sim.genesis, sim.terrain.plazas.indexOf(fire)));
  amb.update({ rain: w.rain, wind: w.wind, storm: w.storm, day, fire: near, crowd, flash: w.storm ? lightningAt(ts, sim.terrain.seed) : 0, voice: players[0]?.instrument ?? 0, duet: players.length >= 2 });
}
/** 30 quadros por segundo bastam: o mundo anda a cada 500 ms e o resto é interpolado. */
const FRAME_MS = 1000 / 30 - 2, IDLE_MS = 1000 / 12 - 2;
/** última interação: parado há 20 s (sem seguir ninguém), desenha só 12 quadros por segundo */
let lastInput = performance.now(), hiddenAt = 0;
/** custo médio de um quadro, para baixar ou subir a qualidade sozinho */
let cost = 0, slowFor = 0, fastFor = 0, raised = false;
function tuneQuality(ms: number, now: number): void {
  cost = cost * 0.95 + ms * 0.05;
  if (cost > 20) { slowFor ||= now; fastFor = 0; } else if (cost < 7) { fastFor ||= now; slowFor = 0; } else slowFor = fastFor = 0;
  if (slowFor && now - slowFor > 3000 && renderer.quality > 0) { renderer.setQuality(renderer.quality - 1); slowFor = 0; cost = 12; saveQ(); }
  else if (fastFor && now - fastFor > 15000 && renderer.quality < 2 && !raised) { renderer.setQuality(renderer.quality + 1); raised = true; fastFor = 0; saveQ(); }
}
const saveQ = () => { try { localStorage.setItem('qualidade', String(renderer.quality)); } catch { /* modo privado */ } };
function loop(now: number): void {
  const idle = !follow && !timelapse.on && now - lastInput > 20_000;
  if (ready && !document.hidden && now - lastFrame >= (idle ? IDLE_MS : FRAME_MS)) {
    lastFrame = now;
    simMs = clock(); // ao vivo: o mundo segue o relógio real
    sim.runUntil(sim.tickAt(simMs), 5000);
    if (Math.floor(sim.tick / CHECK_EVERY) > savedHour) { savedHour = Math.floor(sim.tick / CHECK_EVERY); checkpoint(); }
    const tf = (simMs - sim.genesis) / TICK_MS, ts = (tf * TICK_MS) / 1000;
    if (vitrineOn) cinema(now, tf);
    else if (follow && selected?.present) {
      const a = selected, f = Math.min(1, Math.max(0, (tf - a.mt) / a.pace));
      const tx = a.px + (a.x - a.px) * f, ty = a.py + (a.y - a.py) * f, c = renderer.cam;
      if (Math.abs(tx - c.x) + Math.abs(ty - c.y) > 0.02) { c.x += (tx - c.x) * 0.08; c.y += (ty - c.y) * 0.08; renderer.clampCam(); }
    }
    const t0 = performance.now();
    if (renderer.dirty || now - lastScene > 100) { renderer.drawScene(ts); lastScene = now; }
    renderer.drawActors(tf, selected, hovered);
    tuneQuality(performance.now() - t0, now);
    if (now - lastMini > 100) { renderer.drawMini(selected, now); lastMini = now; }
    if (now - lastUi > 1000) { gameTick(tf); renderer.boardPapers = boardCount(sim); if (now - lastBoard > 5000) { board.refresh(); lastBoard = now; } renderStatus(); renderPlayers(); renderDiary(); lastUi = now; }
    if (amb.on && now - lastSound > 200) { updateSound(ts); lastSound = now; }
  }
  requestAnimationFrame(loop);
}

/** Modo vitrine (tecla V): tela cheia sem interface e câmera passeando sozinha pela vila. */
let vitrineOn = false, shot = { until: 0, x: 0, y: 0, zi: 4 };
function vitrine(on: boolean): void {
  vitrineOn = on;
  document.body.classList.toggle('vitrine', on);
  if (on) { openDrawer(''); follow = false; shot.until = 0; void document.documentElement.requestFullscreen?.().catch(() => undefined); }
  else if (document.fullscreenElement) void document.exitFullscreen().catch(() => undefined);
}
function cinema(now: number, tf: number): void {
  if (now > shot.until) {
    // próxima cena: a ágora, um morador fazendo algo, o campo, um acampamento ou a mata
    const k = Math.floor(now / 14_000), r = (n: number) => fnv(`${k}|${n}`) % 1000 / 1000;
    const busy = sim.agents.filter(a => a.present && !a.inside && a.state !== 'REST');
    const spots: { x: number; y: number }[] = [sim.terrain.agora, ...(sim.field ? [{ x: sim.field.x + 6, y: sim.field.y + 2 }] : []), ...sim.forks.map(f => ({ x: f.x + 3, y: f.y + 1 })), { x: (sim.terrain.dense.x0 + sim.terrain.dense.x1) / 2, y: sim.terrain.dense.y0 + 4 }];
    const who = busy.length && r(1) < 0.55 ? busy[Math.floor(r(2) * busy.length)]! : null;
    const p = who ?? spots[Math.floor(r(3) * spots.length)]!;
    shot = { until: now + 14_000, x: p.x, y: p.y, zi: 3 + Math.floor(r(4) * 3) };
    if (who) { selected = who; } else selected = null;
    renderer.setZoom(shot.zi);
  }
  const a = selected;
  if (a?.present) { const f = Math.min(1, Math.max(0, (tf - a.mt) / a.pace)); shot.x = a.px + (a.x - a.px) * f; shot.y = a.py + (a.y - a.py) * f; }
  const c = renderer.cam;
  c.x += (shot.x - c.x) * 0.025; c.y += (shot.y - c.y) * 0.025; renderer.clampCam();
}

/** Ranking e estatísticas da vila, tudo do estado de agora. */
function renderRank(): void {
  const el = $('rank'); el.textContent = '';
  const present = sim.agents.filter(a => a.present);
  const sec = (title: string, rows: [string, string][]) => {
    const h = document.createElement('h3'), ol = document.createElement('ol');
    h.textContent = title;
    for (const [n, v] of rows) { const li = document.createElement('li'), b = document.createElement('b'), sp = document.createElement('span'); b.textContent = n; sp.textContent = v; li.append(b, sp); ol.append(li); }
    el.append(h, ol);
  };
  const top = (f: (a: Agent) => number, unit: (n: number) => string) => present.map(a => [a, f(a)] as const).filter(x => x[1] > 0).sort((p, q) => q[1] - p[1] || (p[0].name < q[0].name ? -1 : 1)).slice(0, 5).map(([a, n]) => [a.name, unit(n)] as [string, string]);
  sec('Mais antigos', top(a => a.meta.days ?? 0, n => `${n} dia${n > 1 ? 's' : ''}`));
  sec('Mais amigos', top(a => a.friends.length, n => `${n} amigo${n > 1 ? 's' : ''}`));
  sec('Baú mais cheio', top(a => a.items.length, n => `${n} ite${n > 1 ? 'ns' : 'm'}`));
  sec('Mais citados no diário', top(a => sim.log.filter(e => e.text.includes(a.name)).length, n => `${n}×`));
  const count = (l: string[]) => [...l.reduce((m, k) => m.set(k, (m.get(k) ?? 0) + 1), new Map<string, number>())].sort((p, q) => q[1] - p[1]).map(([k, n]) => [k, String(n)] as [string, string]);
  sec('Profissões', count(present.map(a => PROFS[a.prof]!)));
  sec('Casas', count(present.map(a => HOUSES[a.house]!)));
  sec('A vila hoje', [['Moradores', `${present.length} de ${sim.agents.length}`], ['Árvores', String(sim.trees.length)], ['Cartas entregues', String(sim.letters.length)], ['Sacas no celeiro', String(sim.wheatStock)], ['Coelhos e raposas', `${sim.eco.rabbits} · ${sim.eco.foxes}`], ['Entradas no diário', String(sim.log.length)]]);
}

/** Lê a cena em voz (leitor de tela) e mostra o mesmo texto em "Como funciona". */
function describe(): void {
  if (!ready) return;
  const vis = [...renderer.screen.keys()];
  const text = describeScene(sim, fmt(sim.genesis + sim.tick * TICK_MS), vis, stateText, selected, renderer.treasureInView);
  const sc = $('scene');
  sc.textContent = '';
  setTimeout(() => { sc.textContent = text; }, 50);
  $('sceneTxt').textContent = text;
}
/** Avisos curtos no canto da tela (figurinha nova, tesouro, desejo) */
const toasts: string[] = [];
let toastBusy = false, toastSeq = 0;
function toast(text: string, now = false): void {
  if (now) { toasts.length = 0; toastSeq++; toastBusy = false; }
  toasts.push(text);
  if (toastBusy) return;
  const next = () => {
    const t = toasts.shift(), el = $('toast');
    if (!t) { toastBusy = false; el.hidden = true; return; }
    toastBusy = true; el.textContent = t; el.hidden = false;
    const my = ++toastSeq;
    el.onclick = () => { if (my === toastSeq) next(); };
    setTimeout(() => { if (my === toastSeq) next(); }, Math.min(12_000, 3500 + t.length * 45));
  };
  next();
}
const play = new Play(toast);
// #album=código: junta o álbum trazido de outro aparelho e limpa o endereço
{
  const m = location.hash.match(/^#album=([0-9a-z-]+)$/i);
  if (m) {
    const n = play.importCode(m[1]!);
    history.replaceState(null, '', location.pathname + location.search);
    setTimeout(() => toast(n === null ? 'Esse código de álbum não é válido' : `Álbum juntado: ${n} figurinha${n === 1 ? '' : 's'} nova${n === 1 ? '' : 's'}`), 1500);
  }
}
/** Uma vez por segundo: figurinhas, botão de desejo e hora da última visita. */
function gameTick(tf: number): void {
  if (timelapse.on) return;
  play.check(sim);
  const pl = visitor.plant();
  renderer.localPlant = pl ? { x: pl.x, y: pl.y, stage: visitor.plantStage() } : null;
  const reader = visitor.readAtFire(sim, hourAt(sim.tick));
  if (reader) { toast(`Na roda da fogueira, ${reader.name} leu o seu bilhete em voz alta ✦`); if (!follow) { renderer.cam = { x: reader.x, y: reader.y }; renderer.clampCam(); } diaryKey = ''; }
  $('wish').hidden = !play.canWish(sim, tf) || document.body.classList.contains('embed');
  play.markVisit(Date.now());
}
/** "Desde a sua última visita": resumo do morador favorito quando a pessoa volta. */
function welcomeBack(): void {
  const fav = play.favorite(), a = fav ? sim.agents.find(x => x.name === fav) : undefined, last = play.lastVisit();
  if (!last || Date.now() - last < 10 * 60_000) return;
  const since = last >= sim.genesis ? `desde as ${fmt(last)}` : 'hoje';
  const vila = highlightsSince(sim.log, Math.max(0, Math.floor((last - sim.genesis) / TICK_MS)), sim.tick);
  if (vila.length) toast(`Enquanto você esteve fora (${since}): ${vila.join(' · ')}`);
  if (a) toast(`♥ ${a.name} ${since}: ${play.sinceLast(sim, a).join(' · ')}`);
}
const timelapse = new Timelapse($('timelapse'));
const houseView = new HouseView($('houseView'));
const dialogue = new Dialogue($('dialogue'));
const visitor = new Visitor(toast);
const board = new BoardView($('board'), visitor);
/** plantar: o próximo clique num lugar de grama vira a plantinha do visitante */
let plantMode = false;
board.onPlant = () => { plantMode = true; $('fg').classList.add('planting'); toast('Clique num lugar de grama para plantar sua semente (Esc cancela)', true); };

/** Modo foto: redesenha sem nomes nem balões, junta chão e atores e baixa um PNG com legenda. */
function photo(): void {
  const tf = (clock() - sim.genesis) / TICK_MS, ts = (tf * TICK_MS) / 1000;
  renderer.hideLabels = true;
  renderer.drawScene(ts); renderer.drawActors(tf, null, null);
  const bg = $<HTMLCanvasElement>('bg'), fg = $<HTMLCanvasElement>('fg'), out = document.createElement('canvas');
  out.width = bg.width; out.height = bg.height;
  const g = out.getContext('2d')!;
  g.drawImage(bg, 0, 0); g.drawImage(fg, 0, 0);
  renderer.hideLabels = false;
  const k = out.width / innerWidth, text = `Stargazzing · ${fmt(sim.genesis + sim.tick * TICK_MS)} · ${sim.weather().kind} · ${sim.stars} moradores`;
  g.font = `600 ${Math.round(14 * k)}px Inter,sans-serif`;
  const w = g.measureText(text).width + 24 * k;
  g.fillStyle = 'rgba(4,7,9,.7)'; g.beginPath(); g.roundRect(16 * k, out.height - 44 * k, w, 30 * k, 15 * k); g.fill();
  g.fillStyle = '#f2c14e'; g.textBaseline = 'middle'; g.fillText(text, 28 * k, out.height - 29 * k);
  const a = document.createElement('a');
  a.download = `stargazzing-${new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-')}.png`;
  a.href = out.toDataURL('image/png');
  a.click();
  $('msg').textContent = 'Foto salva.';
}

// ---------- eventos ----------
function bind(): void {
  // acessibilidade: preferências e descrição da cena para leitor de tela
  const opt = loadA11y();
  applyA11y(opt);
  const cbC = $<HTMLInputElement>('optContrast'), cbB = $<HTMLInputElement>('optBig'), sel = $<HTMLSelectElement>('optPalette');
  for (const [v, label] of PALETTES) { const o = document.createElement('option'); o.value = v; o.textContent = label; sel.append(o); }
  cbC.checked = opt.contrast; cbB.checked = opt.big; sel.value = opt.palette;
  cbC.addEventListener('change', () => { opt.contrast = cbC.checked; applyA11y(opt); });
  cbB.addEventListener('change', () => { opt.big = cbB.checked; applyA11y(opt); });
  sel.addEventListener('change', () => { opt.palette = sel.value as typeof opt.palette; applyA11y(opt); });
  $('describe').addEventListener('click', describe);
  $('nextUp').addEventListener('click', () => { diaryKey = ''; wxKey = 0; openDrawer('diaryDrawer'); renderDiary(); });
  $('openAlbum').addEventListener('click', () => { openDrawer('albumDrawer'); play.renderAlbum($('album')); });
  $('wish').addEventListener('click', () => { play.wish(sim); $('wish').hidden = true; renderer.releaseLantern(clock() / 1000 - sim.genesis / 1000); });
  $('openRank').addEventListener('click', () => { openDrawer('rankDrawer'); renderRank(); });
  for (const ev of ['pointerdown', 'pointermove', 'wheel', 'keydown', 'touchstart']) addEventListener(ev, () => { lastInput = performance.now(); }, { passive: true });
  // aba escondida: o laço para; ao voltar depois de muito tempo (ou noutro dia), retoma do checkpoint
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) { hiddenAt = Date.now(); if (ready) checkpoint(); return; }
    lastInput = performance.now();
    if (ready && (Date.now() - hiddenAt > 30 * 60_000 || genesisFor(clock(), tz()) !== sim.genesis)) start();
  });
  $('openHow').addEventListener('click', () => openDrawer('howDrawer'));
  $('openPlayers').addEventListener('click', () => openDrawer('playersDrawer'));
  $('openDiary').addEventListener('click', () => { diaryKey = ''; openDrawer('diaryDrawer'); renderDiary(); });
  document.querySelectorAll('[data-close]').forEach(b => b.addEventListener('click', () => openDrawer('')));
  addEventListener('resize', () => renderer.resize());
  const KONAMI = ['ArrowUp', 'ArrowUp', 'ArrowDown', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'ArrowLeft', 'ArrowRight', 'b', 'a'];
  let kq: string[] = [];
  addEventListener('keydown', e => {
    if (e.key === 'Escape' && plantMode) { plantMode = false; $('fg').classList.remove('planting'); }
    if (e.key === 'Escape') { if (vitrineOn) vitrine(false); openDrawer(''); timelapse.stop(); houseView.close(); dialogue.close(); board.close(); }
    if (dialogue.open && (e.key === ' ' || e.key === 'Enter') && (e.target as HTMLElement).tagName !== 'BUTTON') { e.preventDefault(); dialogue.advance(); return; }
    if ((e.target as HTMLElement).tagName === 'INPUT') return;
    const ts = clock() / 1000 - sim.genesis / 1000;
    kq = [...kq, e.key.length === 1 ? e.key.toLowerCase() : e.key].slice(-KONAMI.length);
    if (kq.join() === KONAMI.join()) { renderer.starRain(ts); kq = []; $('msg').textContent = 'Chuva de estrelas! ★'; }
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    const key = e.key.toLowerCase();
    if (key === 'l') renderer.releaseLantern(ts);
    // atalhos de teclado (a lista aparece em "Como funciona")
    if (key === 'q') board.show(sim);
    if (key === 'v') vitrine(!vitrineOn);
    if (key === 'r') { openDrawer('rankDrawer'); renderRank(); }
    if (key === 's') describe();
    if (key === 'x' && renderer.treasureInView) { play.dig(sim); renderer.treasure = null; }
    if (key === 'a') { openDrawer('albumDrawer'); play.renderAlbum($('album')); }
    if (key === 'w' && !$('wish').hidden) $('wish').click();
    if (key === 'p') openDrawer('playersDrawer');
    if (key === 'd') { diaryKey = ''; openDrawer('diaryDrawer'); renderDiary(); }
    if (key === 'c') openDrawer('howDrawer');
    if (key === 't') timelapse.play(sim, renderer);
    if (key === 'f') photo();
    if (key === 'm') $('sound').click();
    if (key === '+' || key === '=') renderer.setZoom(renderer.zi + 1);
    if (key === '-' || key === '_') renderer.setZoom(renderer.zi - 1);
    const k = ({ ArrowLeft: [-4, 0], ArrowRight: [4, 0], ArrowUp: [0, -3], ArrowDown: [0, 3] } as Record<string, [number, number]>)[e.key];
    if (k) { follow = false; renderer.pan(k[0], k[1]); }
  });
  $('search').addEventListener('input', () => renderPlayers(true));
  // som começa desligado (autoplay); a escolha fica salva e volta no primeiro clique da próxima visita
  const sb = $('sound');
  const setSound = async (on: boolean) => {
    if (on) { await amb.enable(); updateSound(Date.now() / 1000); } else amb.disable();
    sb.textContent = on ? '♪ on' : '♪ off';
    sb.setAttribute('aria-pressed', String(on));
    sb.setAttribute('aria-label', on ? 'Desligar som ambiente' : 'Ligar som ambiente');
    try { localStorage.setItem('som', on ? '1' : '0'); } catch { /* modo privado */ }
  };
  sb.addEventListener('click', () => void setSound(!amb.on));
  let wanted = false;
  try { wanted = localStorage.getItem('som') === '1'; } catch { /* modo privado */ }
  if (wanted) addEventListener('pointerdown', e => { if (e.target !== sb && !amb.on) void setSound(true); }, { once: true });
  $('photo').addEventListener('click', photo);
  $('openTimelapse').addEventListener('click', () => timelapse.play(sim, renderer));
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
    if (drag && !drag.moved) {
      if (plantMode) {
        const c = renderer.cellAt(e.offsetX, e.offsetY);
        if (visitor.setPlant(sim, c.x, c.y)) { plantMode = false; fg.classList.remove('planting'); renderer.localPlant = { x: c.x, y: c.y, stage: 0 }; toast('Semente plantada! Volte nos próximos dias para ver crescer.', true); }
        else toast('Ali não dá: escolha um lugar de grama livre.', true);
        drag = null; return;
      }
      if (renderer.treasureAt(e.offsetX, e.offsetY)) { play.dig(sim); renderer.treasure = null; drag = null; return; }
      const a = renderer.agentAt(e.offsetX, e.offsetY), h = a ? null : renderer.houseAt(e.offsetX, e.offsetY);
      if (!a && !h && renderer.boardAt(e.offsetX, e.offsetY)) { board.show(sim); drag = null; return; }
      if (a?.present && !a.inside) dialogue.show(sim, a); else if (!a) dialogue.close();
      if (h) {
        const atHome = h.present && Math.abs(h.x - h.home.x) <= 1 && Math.abs(h.y - h.home.y) <= 1 && h.phase === 'stay';
        const hr = hourAt(sim.tick);
        houseView.show(h, atHome, atHome && h.state === 'REST' && (hr >= 23 || hr < 5.5), sim.notes.get(h.name.toLowerCase()));
      } else { select(a); if (a && !playersOpen()) openDrawer('playersDrawer'); }
    }
    drag = null;
    fg.classList.remove('dragging');
  });
  fg.addEventListener('pointerleave', () => { hovered = null; });
  // minimapa: clicar leva até o ponto, arrastar move a câmera junto
  const mini = $('mini');
  let miniDrag = false;
  const miniGo = (e: PointerEvent) => {
    const r = mini.getBoundingClientRect();
    renderer.cam = { x: ((e.clientX - r.left) / r.width) * COLS, y: ((e.clientY - r.top) / r.height) * ROWS };
    follow = false;
    renderer.clampCam();
    renderer.drawMini(selected);
  };
  mini.addEventListener('pointerdown', e => { miniDrag = true; mini.setPointerCapture(e.pointerId); miniGo(e); });
  mini.addEventListener('pointermove', e => { if (miniDrag) miniGo(e); });
  mini.addEventListener('pointerup', () => { miniDrag = false; });
  mini.addEventListener('pointercancel', () => { miniDrag = false; });
}

/** Confere o formato do repo.json antes de usar: só passa o que tem o tipo certo. */
function cleanRepo(d: unknown): RepoData {
  const o = (d ?? {}) as Record<string, unknown>, out: RepoData = {};
  const str = (v: unknown, max = 80) => (typeof v === 'string' ? v.slice(0, max) : '');
  if (Array.isArray(o.forks)) out.forks = o.forks.map(f => ({ login: str(f?.login, 39), at: str(f?.at, 30) })).filter(f => f.login && f.at);
  if (Array.isArray(o.followers)) out.followers = o.followers.map(f => str(f, 39)).filter(Boolean);
  if (Array.isArray(o.requests)) out.requests = o.requests.filter(q => Number.isInteger(q?.n)).map(q => ({ n: q.n as number, title: str(q.title), state: q.state === 'closed' ? 'closed' as const : 'open' as const, closedAt: str(q.closedAt, 30) || undefined }));
  if (Array.isArray(o.requests)) out.requests!.forEach((q, k) => { const v = (o.requests as { votes?: unknown }[])[k]?.votes; if (Number.isInteger(v) && (v as number) > 0) q.votes = Math.min(9999, v as number); });
  if (Array.isArray(o.notes)) out.notes = o.notes.filter(x => Number.isInteger(x?.n)).map(x => ({ n: x.n as number, login: str(x.login, 39), text: str(x.text, 90), at: str(x.at, 30) })).filter(x => x.login && x.text);
  if (Array.isArray(o.releases)) out.releases = o.releases.map(x => ({ tag: str(x?.tag, 30), name: str(x?.name, 60), at: str(x?.at, 30) })).filter(x => x.tag && x.at);
  if (Array.isArray(o.builders)) out.builders = o.builders.map(x => str(x, 39)).filter(Boolean);
  if (o.commits && typeof o.commits === 'object') { out.commits = {}; for (const [k, v] of Object.entries(o.commits as Record<string, unknown>)) if (/^\d{4}-\d\d-\d\d$/.test(k) && Number.isInteger(v)) out.commits[k] = v as number; }
  return out;
}

async function boot(): Promise<void> {
  const res = await fetch(`${import.meta.env.BASE_URL}world.json`, { cache: 'no-cache' });
  world = (await res.json()) as WorldFile;
  try {
    const pr = await fetch(`${import.meta.env.BASE_URL}profiles.json`, { cache: 'no-cache' });
    if (pr.ok) profiles = (await pr.json()) as Record<string, Profile>;
  } catch { /* perfis são opcionais */ }
  try {
    const rr = await fetch(`${import.meta.env.BASE_URL}repo.json`, { cache: 'no-cache' });
    if (rr.ok) world.extra = cleanRepo(await rr.json());
  } catch { /* dados do repo são opcionais */ }
  const n = world.stargazers.length;
  $('dataNote').textContent = `${n} stargazer${n === 1 ? '' : 's'} reais de ${world.repo}` +
    (world.generatedAt ? `, lidos em ${new Date(world.generatedAt).toLocaleString('pt-BR')}.` : '.') +
    ' A lista é atualizada a cada star nova e a cada 30 minutos.';
  if (params.has('embed')) {
    document.body.classList.add('embed');
    const l = $<HTMLAnchorElement>('embedLink'); l.href = `${location.origin}${import.meta.env.BASE_URL}`; l.hidden = false;
  }
  if ('serviceWorker' in navigator && import.meta.env.PROD) void navigator.serviceWorker.register(`${import.meta.env.BASE_URL}sw.js`).catch(() => undefined);
  await document.fonts?.load('16px "JetBrains Mono"').catch(() => undefined);
  start();
  try { const q = Number(localStorage.getItem('qualidade') ?? 2); if (q === 0 || q === 1) renderer.setQuality(q); } catch { /* modo privado */ }
  bind();
  requestAnimationFrame(loop);
}
// ?debug expõe a simulação e o renderer no console (para testes e screenshots)
if (new URLSearchParams(location.search).has("debug")) Object.assign(window, { __sim: () => sim, __r: () => renderer });
boot().catch(err => { $('loadTxt').textContent = `Não consegui carregar o mundo: ${String(err)}`; });
