import { hsl, css } from '../core/color';
import { fnv, h32, mulberry32 } from '../core/rng';
import { COLS, DAY_MS, DIR4, DIR8, FLOWERS, HAIR, HATS, HOUSE_DX, N, PANTS, ROWS, SKIN, SPECIES, TICK_MS, TICKS_PER_HOUR, Tile } from './constants';
import { Terrain } from './world';
import type { Agent, AgentMeta, Plaza, Point, State, Tree, WorldFile } from './types';

export const hourAt = (t: number) => ((t * TICK_MS) / 3_600_000) % 24;
export const isNight = (h: number) => h >= 22.5 || h < 5.5;
export const stageOf = (t: Tree) => (t.growth < 8 ? 0 : t.growth < 30 ? 1 : t.growth < 80 ? 2 : 3);

/** Meia-noite local do mundo (fuso fixo) que contém o instante `ms`: é o ponto de checkpoint. */
/** Células da cabana (e, com withHome, também a casa e a árvore) para a casa em i. */
function houseCells(i: number, withHome: boolean): number[] {
  const c: number[] = [];
  for (let dx = -HOUSE_DX - 1; dx <= -HOUSE_DX + 1; dx++) c.push(i + dx, i - COLS + dx);
  if (withHome) c.push(i, i + 1);
  return c;
}

export function genesisFor(ms: number, tzHours: number): number {
  const off = tzHours * 3_600_000;
  return Math.floor((ms + off) / DAY_MS) * DAY_MS - off;
}

/**
 * Simulação determinística. Dado o world.json, a meia-noite do dia e um número de ticks,
 * o estado é sempre o mesmo, em qualquer navegador ou no Node.
 */
export class Simulation {
  readonly terrain: Terrain;
  readonly wear = new Float32Array(N);
  readonly lastV = new Int32Array(N);
  readonly flip = new Uint8Array(N);
  readonly flower = new Uint8Array(N);
  agents: Agent[] = [];
  trees: Tree[] = [];
  tick = 0;
  /** muda quando o chão (trilhas e flores) precisa ser redesenhado */
  groundVersion = 0;
  private reserved: Point[] = [];
  private readonly gScore = new Int32Array(N);
  private readonly closed = new Uint32Array(N);
  private readonly heapN = new Int32Array(N * 8);
  private readonly heapF = new Int32Array(N * 8);
  private readonly prev = new Int32Array(N);
  private readonly seen = new Uint32Array(N);
  private stamp = 0;

  constructor(readonly world: WorldFile, readonly genesis: number) {
    this.terrain = new Terrain(fnv(world.seed));
    const entries = world.stargazers.map(s => {
      if (s.starredAt) {
        const at = Date.parse(s.starredAt);
        return at < genesis
          ? { login: s.login, order: at, resident: true, days: Math.max(1, Math.ceil((genesis - at) / DAY_MS)), tick: 0 }
          : { login: s.login, order: at, resident: false, days: 0, tick: Math.max(1, Math.floor((at - genesis) / TICK_MS)) };
      }
      if (s.daysAgo !== undefined) return { login: s.login, order: -s.daysAgo, resident: true, days: s.daysAgo, tick: 0 };
      const tick = Math.max(1, Math.round((s.todayHour ?? 0) * TICKS_PER_HOUR));
      return { login: s.login, order: 1 + tick, resident: false, days: 0, tick };
    });
    // ordem estável: mais antigos primeiro, empate pelo login
    entries.sort((a, b) => a.order - b.order || (a.login < b.login ? -1 : 1));
    for (const e of entries) {
      if (e.resident) {
        const a = this.makeAgent(e.login, 0, { days: e.days });
        a.present = true;
        a.x = a.px = a.home.x;
        a.y = a.py = a.home.y;
        this.build(a).growth = e.days >= 3 ? 140 : e.days === 2 ? 95 : 60;
        a.state = 'REST';
        a.phase = 'stay';
        a.wait = Math.floor(a.r() * 300);
        this.agents.push(a);
      } else {
        this.agents.push(this.makeAgent(e.login, e.tick, { starredAt: genesis + e.tick * TICK_MS }));
      }
    }
  }

  tickAt(ms: number): number { return Math.floor((ms - this.genesis) / TICK_MS); }
  isRain(t = this.tick): boolean { return this.terrain.noise(t / 9000, 0.5, 9.3) > 0.3; }

  /** Star simulada localmente (botão "Dar star"): entra no próximo tick. */
  addLocal(login: string): Agent {
    const a = this.makeAgent(login, this.tick + 1, { local: true });
    this.agents.push(a);
    return a;
  }

  runUntil(target: number, budget = Infinity): void {
    while (this.tick < target && budget-- > 0) this.step();
  }

  step(): void {
    this.tick++;
    for (const a of this.agents) {
      if (!a.present) { if (this.tick >= a.arriveTick) this.spawn(a); continue; }
      if (a.wait > 0) { a.wait--; continue; }
      if (this.tick % a.pace) continue;
      this.act(a);
    }
    if (this.tick % 240 === 0) this.seasonPass();
  }

  /** Hash do estado inteiro, usado nos testes de determinismo. */
  stateHash(): number {
    let h = 0x811c9dc5;
    const mixIn = (v: number) => { h ^= v | 0; h = Math.imul(h, 0x01000193); };
    mixIn(this.tick);
    for (const a of this.agents) { mixIn(a.x); mixIn(a.y); mixIn(a.present ? 1 : 0); mixIn(a.wait); mixIn(fnv(a.state)); }
    for (const t of this.trees) { mixIn(t.x); mixIn(t.y); mixIn(Math.round(t.growth * 100)); mixIn(t.lastWater); }
    for (let i = 0; i < N; i++) { if (this.flower[i]) mixIn(i * 7 + this.flower[i]!); if (this.flip[i]) mixIn(i); mixIn(Math.round(this.wear[i]! * 1000)); }
    return h >>> 0;
  }

  // ---------- moradores ----------
  private makeAgent(name: string, arriveTick: number, meta: AgentMeta): Agent {
    const r = mulberry32(fnv(name.toLowerCase()));
    const hue = Math.floor(r() * 360);
    const pick = <T>(arr: readonly T[]) => arr[Math.floor(r() * arr.length)]!;
    const look = {
      skin: pick(SKIN), hair: pick(HAIR), shirt: css(hsl(hue, 0.62, 0.55)), pants: pick(PANTS),
      hat: pick(HATS), hatc: css(hsl((hue + 150 + r() * 60) % 360, 0.6, 0.55)),
    };
    const a: Agent = {
      name, r, hue, col: hsl(hue, 0.7, 0.7), look, species: Math.floor(r() * SPECIES.length), pace: 2 + Math.floor(r() * 3),
      traits: { energy: 0.25 + r() * 0.75, social: r(), gardener: r(), wander: r() },
      arriveTick, meta, present: false, x: 0, y: 0, px: 0, py: 0, mt: 0, face: 1, state: 'ARRIVE', phase: 'go', wait: 0, path: [],
      dir: Math.floor(r() * 4), steps: 0, boidLeft: 0, mv: [0, 0], tree: null, friend: null, plaza: null, bubble: '', bubbleUntil: 0, hut: false,
      home: { x: 0, y: 0 },
    };
    a.home = this.pickHome(a);
    return a;
  }

  private pickHome(a: Agent): Point {
    const { T, comp, block, plazas } = this.terrain;
    for (let k = 0; k < 900; k++) {
      const relax = k > 600, x = 3 + Math.floor(a.r() * (COLS - 7)), y = 4 + Math.floor(a.r() * (ROWS - 6)), i = y * COLS + x;
      let ok = true;
      for (const j of houseCells(i, true)) if (!(T[j] === Tile.Grass || T[j] === Tile.Forest) || !comp[j] || block[j]) ok = false;
      if (!ok || plazas.some(p => Math.abs(p.x - x) < 10 && Math.abs(p.y - y) < 6)) continue;
      if (!relax && this.reserved.some(p => Math.abs(p.x - x) < 8 && Math.abs(p.y - y) < 4)) continue;
      this.reserved.push({ x, y });
      return { x, y };
    }
    const p = plazas[0]!;
    return { x: p.x, y: p.y + 4 };
  }

  /** Cabana à esquerda da casa (3 células, duas linhas), árvore à direita. */
  private build(a: Agent): Tree {
    const i = a.home.y * COLS + a.home.x;
    for (const j of houseCells(i, false)) this.terrain.block[j] = 1;
    this.terrain.block[i + 1] = 1;
    a.hut = true;
    const tr: Tree = { x: a.home.x + 1, y: a.home.y, sp: a.species, growth: 0, lastWater: this.tick };
    this.trees.push(tr);
    a.tree = tr;
    return tr;
  }

  private spawn(a: Agent): void {
    a.present = true;
    const right = a.r() < 0.5;
    let best: Point | null = null, bd = 1e9;
    for (let y = 0; y < ROWS; y++) for (let x = 0; x < COLS; x++) {
      const i = y * COLS + x;
      if (!this.terrain.comp[i] || !this.terrain.passable(i)) continue;
      const d = (right ? COLS - 1 - x : x) * 4 + Math.abs(y - a.home.y);
      if (d < bd) { bd = d; best = { x, y }; }
    }
    const b = best ?? a.home;
    a.x = a.px = b.x;
    a.y = a.py = b.y;
    a.state = 'ARRIVE';
    a.phase = 'go';
    a.path = this.bfs(a.x, a.y, a.home.x, a.home.y) ?? [];
  }

  private stepOn(a: Agent, nx: number, ny: number): void {
    a.px = a.x; a.py = a.y; a.mt = this.tick;
    if (nx !== a.x) a.face = nx > a.x ? 1 : -1;
    a.mv = [nx - a.x, ny - a.y];
    a.x = nx; a.y = ny;
    const i = ny * COLS + nx, t = this.terrain.T[i];
    if (t === Tile.Grass || t === Tile.Forest || t === Tile.Sand) {
      this.wear[i]! += 1;
      this.lastV[i] = this.tick;
      if (this.flower[i] && this.wear[i]! > 3) this.flower[i] = 0;
    }
  }

  /** A* em 8 direções (custo 10 reto, 14 diagonal, heurística octil) com heap binário e carimbos em vez de limpar buffers. */
  private bfs(sx: number, sy: number, tx: number, ty: number): number[] | null {
    const s = sy * COLS + sx, t = ty * COLS + tx;
    if (s === t) return [];
    const { prev, seen, gScore, closed } = this;
    const st = ++this.stamp;
    const heapN = this.heapN, heapF = this.heapF;
    let size = 0;
    const push = (n: number, f: number) => {
      let i = size++;
      while (i > 0) { const p = (i - 1) >> 1; if (heapF[p]! <= f) break; heapN[i] = heapN[p]!; heapF[i] = heapF[p]!; i = p; }
      heapN[i] = n; heapF[i] = f;
    };
    const pop = () => {
      const top = heapN[0]!, ln = heapN[--size]!, lf = heapF[size]!;
      let i = 0;
      for (;;) {
        let c = 2 * i + 1;
        if (c >= size) break;
        if (c + 1 < size && heapF[c + 1]! < heapF[c]!) c++;
        if (heapF[c]! >= lf) break;
        heapN[i] = heapN[c]!; heapF[i] = heapF[c]!; i = c;
      }
      heapN[i] = ln; heapF[i] = lf;
      return top;
    };
    const hh = (n: number) => { const dx = Math.abs((n % COLS) - tx), dy = Math.abs(((n / COLS) | 0) - ty); return 10 * (dx + dy) - 6 * Math.min(dx, dy); };
    seen[s] = st; gScore[s] = 0; prev[s] = s;
    push(s, hh(s));
    let expanded = 0;
    while (size > 0 && expanded < 14000) {
      const c = pop();
      if (c === t) break;
      if (closed[c] === st) continue;
      closed[c] = st;
      expanded++;
      const cx = c % COLS, cy = (c / COLS) | 0, gc = gScore[c]!;
      for (const [dx, dy] of DIR8) {
        const nx = cx + dx, ny = cy + dy;
        if (nx < 0 || ny < 0 || nx >= COLS || ny >= ROWS) continue;
        const ni = ny * COLS + nx;
        if (closed[ni] === st) continue;
        if (ni !== t && !this.terrain.passable(ni)) continue;
        const g = gc + (dx && dy ? 14 : 10);
        if (seen[ni] === st && g >= gScore[ni]!) continue;
        seen[ni] = st; gScore[ni] = g; prev[ni] = c;
        if (size >= heapN.length) return null;
        push(ni, g + hh(ni));
      }
    }
    if (seen[t] !== st) return null;
    const path: number[] = [];
    for (let c = t; c !== s; c = prev[c]!) path.push(c);
    return path.reverse();
  }

  private goTo(a: Agent, tx: number, ty: number): void {
    const p = this.bfs(a.x, a.y, tx, ty);
    if (p === null) { this.startWalk(a); return; }
    a.path = p;
    a.phase = 'go';
  }

  private startWalk(a: Agent): void {
    a.state = 'WANDER';
    a.phase = 'walk';
    a.steps = 30 + Math.floor(a.r() * 70);
  }

  private nearestPlaza(a: Agent): Plaza {
    let b = this.terrain.plazas[0]!, bd = 1e9;
    for (const p of this.terrain.plazas) { const d = Math.abs(p.x - a.home.x) + Math.abs(p.y - a.home.y) * 2; if (d < bd) { bd = d; b = p; } }
    return b;
  }

  /** Máquina de estados: pesos por temperamento, hora e clima, sorteados pelo PRNG do morador. */
  private decide(a: Agent): void {
    const h = hourAt(this.tick), night = isNight(h), rain = this.isRain(), evening = h >= 18 && h < 22.5;
    const thirsty = !!a.tree && this.tick - a.tree.lastWater > 1600;
    const w: [State, number][] = [
      ['WANDER', (0.4 + a.traits.wander * 1.2) * (night ? 0.25 : 1)],
      ['WATER', a.tree ? (thirsty && !rain ? 1.8 : 0.12) * (0.4 + a.traits.gardener) : 0],
      ['REST', (1.1 - a.traits.energy) * 0.8 + (night ? 3.2 : 0) + (rain ? 1.4 : 0)],
      ['VISIT', a.traits.social * 0.9 * (night ? 0.15 : 1)],
      ['GATHER', (0.25 + a.traits.social) * (evening ? 2.4 : 0.35) * (rain ? 0.2 : 1)],
    ];
    let pick = a.r() * w.reduce((s, x) => s + x[1], 0);
    let st: State = 'REST';
    for (const [k, v] of w) { pick -= v; if (pick <= 0) { st = k; break; } }
    a.state = st;
    a.friend = null;
    if (st === 'WANDER') return this.startWalk(a);
    if (st === 'WATER' || st === 'REST') return this.goTo(a, a.home.x, a.home.y);
    if (st === 'VISIT') {
      let near = this.agents.filter(b => b !== a && b.present && b.hut && Math.abs(b.home.x - a.home.x) < 60 && Math.abs(b.home.y - a.home.y) < 30);
      if (!near.length) near = this.agents.filter(b => b !== a && b.present && b.hut);
      if (!near.length) return this.startWalk(a);
      const f = near[Math.floor(a.r() * near.length)]!;
      a.friend = f;
      const fy = f.home.y + 1;
      return fy < ROWS && this.terrain.passable(fy * COLS + f.home.x) ? this.goTo(a, f.home.x, fy) : this.goTo(a, f.home.x, f.home.y);
    }
    a.plaza = this.nearestPlaza(a);
    const gx = a.plaza.x + Math.floor(a.r() * 3) - 1, gy = a.plaza.y + 1;
    this.goTo(a, gx, gy < ROWS && this.terrain.passable(gy * COLS + gx) ? gy : a.plaza.y - 1);
  }

  /** Passeio pela regra da Formiga de Langton, preso a um raio em volta de casa. */
  private walk(a: Agent): void {
    const i = a.y * COLS + a.x;
    if (a.r() < 0.75) { a.dir = this.flip[i] ? (a.dir + 3) % 4 : (a.dir + 1) % 4; this.flip[i]! ^= 1; }
    const dx = a.home.x - a.x, dy = a.home.y - a.y;
    if (Math.abs(dx) > 26 || Math.abs(dy) > 12) a.dir = Math.abs(dx) / 2 > Math.abs(dy) ? (dx > 0 ? 1 : 3) : dy > 0 ? 2 : 0;
    for (const k of [0, 1, 3, 2]) {
      const d = (a.dir + k) % 4, [ddx, ddy] = DIR4[d]!, nx = a.x + ddx, ny = a.y + ddy;
      if (nx < 0 || ny < 0 || nx >= COLS || ny >= ROWS || !this.terrain.passable(ny * COLS + nx)) continue;
      a.dir = d;
      this.stepOn(a, nx, ny);
      return;
    }
  }

  /** Boids em grade: separação, alinhamento, coesão e atração pela praça. */
  private boid(a: Agent): void {
    let cx = 0, cy = 0, n = 0, sx = 0, sy = 0, ax = 0, ay = 0;
    const P = a.plaza ?? this.terrain.plazas[0]!;
    for (const b of this.agents) {
      if (b === a || !b.present || b.phase !== 'boid') continue;
      const dx = b.x - a.x, dy = (b.y - a.y) * 2, d = Math.hypot(dx, dy);
      if (d > 16) continue;
      n++; cx += b.x; cy += b.y; ax += b.mv[0]; ay += b.mv[1];
      if (d < 2.5) { sx -= dx / (d || 1); sy -= dy / (d || 1) / 2; }
    }
    let vx = (P.x - a.x) * 0.08, vy = (P.y - a.y) * 0.16;
    if (n) { vx += (cx / n - a.x) * 0.12 + (ax / n) * 0.5; vy += (cy / n - a.y) * 0.24 + (ay / n) * 0.5; }
    vx += sx * 1.4 + (a.r() - 0.5) * 1.1;
    vy += sy * 1.4 + (a.r() - 0.5) * 1.1;
    const mx = Math.abs(vx) > 0.4 ? Math.sign(vx) : 0, my = Math.abs(vy) > 0.4 ? Math.sign(vy) : 0, nx = a.x + mx, ny = a.y + my;
    if ((mx || my) && nx >= 0 && ny >= 0 && nx < COLS && ny < ROWS && this.terrain.passable(ny * COLS + nx)) this.stepOn(a, nx, ny);
    else a.mv = [0, 0];
  }

  private act(a: Agent): void {
    const tick = this.tick;
    if (a.path.length) {
      const nx = a.path[0]!;
      if (!this.terrain.passable(nx) && a.path.length > 1) { const last = a.path[a.path.length - 1]!; this.goTo(a, last % COLS, (last / COLS) | 0); return; }
      a.path.shift();
      this.stepOn(a, nx % COLS, (nx / COLS) | 0);
      return;
    }
    if (a.phase === 'go') {
      if (a.state === 'ARRIVE') { a.state = 'PLANT'; a.phase = 'stay'; a.wait = 16; a.bubble = '+'; a.bubbleUntil = tick + 16; return; }
      if (a.state === 'GATHER') { a.phase = 'boid'; a.boidLeft = 60 + Math.floor(a.r() * 90); return; }
      a.phase = 'stay';
      const night = isNight(hourAt(tick));
      a.wait = a.state === 'WATER' ? 14 : a.state === 'REST' ? Math.floor((120 + a.r() * 300) * (night ? 2.5 : 1)) : 40 + Math.floor(a.r() * 60);
      if (a.state === 'WATER') { a.bubble = '¨'; a.bubbleUntil = tick + 14; }
      if (a.state === 'REST') { a.bubble = 'z'; a.bubbleUntil = tick + a.wait; }
      const f = a.friend;
      if (a.state === 'VISIT' && f && Math.abs(f.x - a.x) < 4 && Math.abs(f.y - a.y) < 3) {
        a.bubble = '♥'; a.bubbleUntil = tick + a.wait; f.bubble = '♥'; f.bubbleUntil = tick + a.wait;
      }
      return;
    }
    if (a.phase === 'boid') { this.boid(a); if (--a.boidLeft <= 0) this.decide(a); return; }
    if (a.phase === 'walk') { this.walk(a); if (--a.steps <= 0) this.decide(a); return; }
    if (a.state === 'PLANT') this.build(a);
    if (a.state === 'WATER' && a.tree) a.tree.lastWater = tick;
    this.decide(a);
  }

  /** A cada 240 ticks: árvores crescem, trilhas se apagam, trilha esquecida vira flor. */
  private seasonPass(): void {
    const rain = this.isRain(), { T } = this.terrain, seed = this.terrain.seed;
    for (const t of this.trees) { const watered = this.tick - t.lastWater < 1800; t.growth += (rain ? 2 : 1) * (watered ? 1.5 : 1); }
    for (let i = 0; i < N; i++) {
      if (this.wear[i]! > 0) { this.wear[i]! *= 0.945; if (this.wear[i]! < 0.05) this.wear[i] = 0; }
      if (!this.flower[i] && T[i] === Tile.Grass && this.wear[i]! >= 2.5 && this.wear[i]! < 6 && this.tick - this.lastV[i]! > 2400 && h32(i, this.tick, seed) % 1000 < 12) {
        this.flower[i] = 1 + (h32(i, 7, seed) % FLOWERS.length);
        this.wear[i] = 0;
      } else if (this.flower[i] && h32(i, this.tick, 11) % 1000 < 4) this.flower[i] = 0;
    }
    this.groundVersion++;
  }
}
