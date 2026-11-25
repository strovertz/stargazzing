import { hsl, css } from '../core/color';
import { fnv, h32, mulberry32 } from '../core/rng';
import { PROFS, COLS, DAY_MS, DIR4, DIR8, FLOWERS, HAIR, HATS, HOUSE_DX, N, PANTS, ROWS, SKIN, SPECIES, TICK_MS, TICKS_PER_HOUR, Tile } from './constants';
import { Terrain } from './world';
import { weatherAt, type Weather } from './weather';
import { lanternSpots, planVillage, STARS_PER_COLUMN, type Structure } from './village';
import type { Agent, AgentMeta, LogEntry, Plaza, Point, State, Tree, WorldFile } from './types';

export const hourAt = (t: number) => ((t * TICK_MS) / 3_600_000) % 24;
/** Noite de sono: da meia-noite às 5h (corujas dormem ainda menos). */
export const isNight = (h: number) => h >= 23.5 || h < 5;
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
  /** diário do dia: chegadas, clima, obras, pescarias, eventos e céu */
  readonly log: LogEntry[] = [];
  readonly structures: Structure[];
  readonly lanterns: [number, number][];
  /** colunas da ágora já restauradas pela vila */
  restored = 0;
  /** tick da última estrela cadente */
  shootingAt = -9999;
  /** 0 verão, 1 outono, 2 inverno, 3 primavera (hemisfério sul, pela data real) */
  readonly season: number;
  /** dia da semana local (0 domingo) */
  readonly weekday: number;
  private lastKind = '';
  private readonly gardenCells = new Set<number>();
  private readonly brokenCols: number[];
  private readonly gScore = new Int32Array(N);
  private readonly closed = new Uint32Array(N);
  private readonly heapN = new Int32Array(N * 8);
  private readonly heapF = new Int32Array(N * 8);
  private readonly prev = new Int32Array(N);
  private readonly seen = new Uint32Array(N);
  private stamp = 0;

  constructor(readonly world: WorldFile, readonly genesis: number) {
    this.terrain = new Terrain(fnv(world.seed));
    const local = new Date(genesis + (world.timezoneOffsetHours ?? -3) * 3_600_000 + 12 * 3_600_000);
    const m = local.getUTCMonth();
    this.season = m === 11 || m <= 1 ? 0 : m <= 4 ? 1 : m <= 7 ? 2 : 3;
    this.weekday = local.getUTCDay();
    this.structures = planVillage(this.terrain);
    this.lanterns = lanternSpots(this.terrain);
    // ordem de restauro: quebradas primeiro, depois caídas, sempre a mesma
    this.brokenCols = this.terrain.columns.map((c, i) => ({ c, i })).filter(o => o.c.kind > 0).sort((p, q) => p.c.kind - q.c.kind || p.i - q.i).map(o => o.i);
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
    this.updateVillage(false);
  }

  /** Quantos moradores já chegaram: é isso que move as obras. */
  get stars(): number { let n = 0; for (const a of this.agents) if (a.present) n++; return n; }

  /** Ergue as obras cujas metas foram batidas e restaura colunas. */
  private updateVillage(announce: boolean): void {
    const n = this.stars;
    for (const s of this.structures) {
      if (s.built || n < s.need) continue;
      s.built = true; s.builtAt = this.tick;
      for (const c of s.cells) {
        if (s.kind === 'píer') { this.terrain.T[c] = Tile.Floor; this.terrain.ruinCh[c] = 'p'; this.terrain.comp[c] = 1; }
        else this.terrain.block[c] = 1;
      }
      if (s.kind === 'jardim') {
        for (let dy = -2; dy <= 2; dy++) for (let dx = -4; dx <= 4; dx++) {
          const i = (s.y + dy) * COLS + s.x + dx;
          if ((this.terrain.T[i] === Tile.Grass || this.terrain.T[i] === Tile.Forest) && !this.terrain.block[i] && (dx + dy) % 2 === 0) { this.flower[i] = 1 + (h32(i, 3, 7) % FLOWERS.length); this.gardenCells.add(i); }
        }
      }
      this.terrain.version++;
      if (announce) this.note(`A vila construiu ${s.kind === 'lanternas' ? 'as lanternas da ágora' : s.kind === 'jardim' ? 'um jardim em volta do poço' : s.kind === 'píer' ? 'um píer no lago' : `um${s.kind === 'estátua' ? 'a' : ''} ${s.kind}`} (${s.need} stars)`, 'obra');
    }
    const want = Math.min(this.brokenCols.length, Math.max(0, Math.floor((n - 2) / STARS_PER_COLUMN) + 1));
    while (this.restored < want) {
      const col = this.terrain.columns[this.brokenCols[this.restored]!]!;
      col.kind = 0; col.h = 0.9;
      this.terrain.block[col.y * COLS + col.x] = 1;
      this.terrain.ruinCh[col.y * COLS + col.x] = 'a';
      if (this.terrain.ruinCh[col.y * COLS + col.x + 1] === 'o') this.terrain.ruinCh[col.y * COLS + col.x + 1] = 'a';
      this.restored++;
      this.terrain.version++;
      if (announce) this.note('Uma coluna da ágora foi restaurada', 'obra');
    }
  }

  private note(text: string, kind: LogEntry['kind']): void {
    this.log.push({ tick: this.tick, text, kind });
    if (this.log.length > 400) this.log.shift();
  }

  tickAt(ms: number): number { return Math.floor((ms - this.genesis) / TICK_MS); }
  private wTick = -1;
  private wNow!: Weather;
  /** Clima do tick (guardado: decide() consulta muitas vezes por tick). */
  weather(t = this.tick): Weather {
    if (t === this.wTick) return this.wNow;
    const w = weatherAt(this.terrain.noise, (this.genesis + t * TICK_MS) / 3_600_000, hourAt(t));
    if (t === this.tick) { this.wTick = t; this.wNow = w; }
    return w;
  }
  isRain(t = this.tick): boolean { return this.weather(t).rain > 0.3; }

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
    this.skyAndEvents();
  }

  /** Clima que muda, estrelas cadentes e eventos marcados, tudo anotado no diário. */
  private skyAndEvents(): void {
    const t = this.tick, h = hourAt(t), seed = this.terrain.seed;
    if (t % 120 === 0) {
      const w = this.weather();
      if (w.kind !== this.lastKind) {
        if (this.lastKind) this.note(w.kind === 'limpo' ? 'O céu abriu' : w.kind === 'tempestade' ? 'Tempestade! Todo mundo correu para casa' : `Começou: ${w.kind}`, 'clima');
        this.lastKind = w.kind;
      }
    }
    if ((h >= 20 || h < 5) && this.weather().cloud < 0.5 && h32(t, 99, seed) % 2400 === 0) { this.shootingAt = t; this.note('Uma estrela cadente cruzou o céu', 'céu'); }
    if (t === Math.round(8 * TICKS_PER_HOUR) && (this.weekday === 0 || this.weekday === 6)) this.note('Dia de feira na ágora', 'evento');
    if (t === Math.round(20 * TICKS_PER_HOUR) && this.weekday === 5) this.note('Corrida de vaga-lumes em volta da ágora', 'evento');
  }

  /** Feira: sábado e domingo das 9h às 17h. Corrida de vaga-lumes: sexta das 20h às 21h. */
  isFair(t = this.tick): boolean { const h = hourAt(t); return (this.weekday === 0 || this.weekday === 6) && h >= 9 && h < 17; }
  isFireflyRace(t = this.tick): boolean { const h = hourAt(t); return this.weekday === 5 && h >= 20 && h < 21; }

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
      home: { x: 0, y: 0 }, chatAt: -9999,
      prof: fnv(name.toLowerCase() + '#prof') % PROFS.length, owl: fnv(name.toLowerCase() + '#owl') % 4 === 0,
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
      const ag = this.terrain.agora;
      if (!ok || plazas.some(p => Math.abs(p.x - x) < 10 && Math.abs(p.y - y) < 6)) continue;
      if (((x - ag.x) / (ag.rx + 6)) ** 2 + ((y - ag.y) / (ag.ry + 4)) ** 2 < 1) continue;
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
    this.note(`${a.name} chegou para morar na floresta (${PROFS[a.prof]})`, 'chegada');
    this.updateVillage(true);
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
    a.steps = 60 + Math.floor(a.r() * 100);
  }

  private shore: number[] | null = null;

  private shoreCells(): number[] {
    if (this.shore) return this.shore;
    const { T, comp } = this.terrain, out: number[] = [];
    for (let y = 1; y < ROWS - 1; y++) for (let x = 1; x < COLS - 1; x++) {
      const i = y * COLS + x;
      if (!comp[i] || !this.terrain.passable(i)) continue;   // alcançável e livre
      const water = (j: number) => T[j]! <= Tile.Shallow;
      if (water(i - 1) || water(i + 1) || water(i - COLS) || water(i + COLS)) out.push(i);
    }
    return (this.shore = out);
  }

  private fishSpot(a: Agent): Point | null {
  const s = this.shoreCells();
  if (!s.length) return null;
  const near = s
    .map(i => ({ i, d: Math.abs((i % COLS) - a.home.x) + Math.abs(((i / COLS) | 0) - a.home.y) * 2 }))
    .sort((p, q) => p.d - q.d || p.i - q.i)
    .slice(0, 5);
  const i = near[Math.floor(a.r() * near.length)]!.i;
  return { x: i % COLS, y: (i / COLS) | 0 };
  }

  private nearestPlaza(a: Agent): Plaza {
    let b = this.terrain.plazas[0]!, bd = 1e9;
    for (const p of this.terrain.plazas) { const d = Math.abs(p.x - a.home.x) + Math.abs(p.y - a.home.y) * 2; if (d < bd) { bd = d; b = p; } }
    return b;
  }

  /** Máquina de estados: pesos por temperamento, hora e clima, sorteados pelo PRNG do morador. */
  private decide(a: Agent): void {
    const h = hourAt(this.tick), night = isNight(h), wx = this.weather(), rain = wx.rain > 0.3, evening = h >= 18 && h < 22.5;
    const storm = wx.storm ? 1 : 0, fog = wx.fog > 0.35 ? 1 : 0, day = h >= 7 && h < 18;
    const thirsty = !!a.tree && this.tick - a.tree.lastWater > 1600;
    const prof = PROFS[a.prof], owl = a.owl ? 1 : 0, late = h >= 22 || h < 5, out = (1 - storm) * (rain ? 0.3 : 1), fair = this.isFair() ? 1 : 0;
    const w: [State, number][] = [
      ['WANDER', (0.4 + a.traits.wander * 1.2) * (night ? 0.25 : 1) * (fog ? 0.5 : 1) * (storm ? 0.05 : 1)],
      ['WATER', a.tree ? (thirsty && !rain ? 1.8 : 0.12) * (0.4 + a.traits.gardener) : 0],
      ['REST', (1.1 - a.traits.energy) * (night ? 0.8 : 0.25) + (night ? (owl ? 0.5 : 3.2) : 0) + (rain ? 1 : 0) + storm * 8],
      ['VISIT', a.traits.social * 0.9 * (night ? 0.15 : 1) * (storm ? 0.05 : 1)],
      ['GATHER', (0.25 + a.traits.social) * (evening ? 2.4 : late && owl ? 2 : 0.35) * (rain ? 0.2 : 1) * (1 - storm)],
      ['FISH', (prof === 'pescador' ? 0.8 : 0.15) * (rain ? 0.2 : 1) * (1 - storm) * (fog ? 1.6 : 1)],
      ['AGORA', (0.3 + a.traits.social * 0.6 + a.traits.wander * 0.4) * (day ? 1 : 0.08) * (rain ? 0.25 : 1) * (1 - storm) * (fair ? 2.5 : 1)],
      ['CHOP', prof === 'lenhador' && day ? 0.9 * out : 0],
      ['PLAY', prof === 'músico' && (day || evening) ? 0.8 * out : 0],
      ['GARDEN', prof === 'jardineiro' && day ? 0.9 * (1 - storm) : 0],
      ['SIGHT', day && this.terrain.landmarks.length ? (0.25 + a.traits.wander * 0.5) * (prof === 'explorador' ? 3 : 1) * out : 0],
      ['BOAT', prof === 'pescador' && day && !rain && this.structures.some(s => s.kind === 'píer' && s.built) ? 0.5 * out : 0],
    ];
    let pick = a.r() * w.reduce((s, x) => s + x[1], 0);
    let st: State = 'REST';
    for (const [k, v] of w) { pick -= v; if (pick <= 0) { st = k; break; } }
    a.state = st;
    a.friend = null;
    if (st === 'WANDER') return this.startWalk(a);
    if (st === 'WATER' || st === 'REST') return this.goTo(a, a.home.x, a.home.y);
    if (st == 'FISH') {const p = this.fishSpot(a); return p ? this.goTo(a, p.x, p.y) : this.startWalk(a);}
    if (st === 'VISIT') {
      let near = this.agents.filter(b => b !== a && b.present && b.hut && Math.abs(b.home.x - a.home.x) < 60 && Math.abs(b.home.y - a.home.y) < 30);
      if (!near.length) near = this.agents.filter(b => b !== a && b.present && b.hut);
      if (!near.length) return this.startWalk(a);
      const f = near[Math.floor(a.r() * near.length)]!;
      a.friend = f;
      const fy = f.home.y + 1;
      return fy < ROWS && this.terrain.passable(fy * COLS + f.home.x) ? this.goTo(a, f.home.x, fy) : this.goTo(a, f.home.x, f.home.y);
    }
    if (st === 'CHOP') {
      // lenhador: a árvore nativa mais perto de casa que ainda não é da ágora
      let best: Point | null = null, bd = Infinity;
      for (const w of this.terrain.wild) {
        const d = Math.abs(w.x - a.home.x) + Math.abs(w.y - a.home.y) * 2;
        if (d < bd && d > 2 && this.terrain.passable(w.y * COLS + w.x + 1)) { bd = d; best = { x: w.x + 1, y: w.y }; }
      }
      if (!best || bd > 120) return this.startWalk(a);
      a.face = -1;
      return this.goTo(a, best.x, best.y);
    }
    if (st === 'PLAY') {
      const ag = this.terrain.agora, x = ag.x + (a.r() < 0.5 ? -3 : 3), y = ag.y + 2;
      a.plaza = this.terrain.plazas[0]!;
      return this.terrain.passable(y * COLS + x) ? this.goTo(a, x, y) : this.startWalk(a);
    }
    if (st === 'GARDEN') {
      const others = this.trees.filter(t => t !== a.tree);
      if (!others.length) return this.goTo(a, a.home.x, a.home.y);
      const t = others[Math.floor(a.r() * others.length)]!;
      a.friend = this.agents.find(b => b.tree === t) ?? null;
      const y = t.y + 1;
      return y < ROWS && this.terrain.passable(y * COLS + t.x) ? this.goTo(a, t.x, y) : this.startWalk(a);
    }
    if (st === 'SIGHT') {
      // marco mais interessante: um dos três mais perto de casa (barracas valem como acampamento)
      const lms = this.terrain.landmarks.filter(l => l.kind !== 'barraca' || a.r() < 0.3)
        .map(l => ({ l, d: Math.abs(l.x - a.home.x) + Math.abs(l.y - a.home.y) * 2 })).sort((p, q) => p.d - q.d || p.l.x - q.l.x).slice(0, 3);
      if (!lms.length) return this.startWalk(a);
      const l = lms[Math.floor(a.r() * lms.length)]!.l;
      a.sight = l.kind === 'pedras' ? 'círculo de pedras' : l.kind === 'torre' ? 'torre de vigia' : l.kind;
      for (const [dx, dy] of [[1, 1], [0, 1], [2, 1], [-1, 0], [l.w, 0], [1, 2]] as const) {
        const x = l.x + dx, y = l.y + dy;
        if (y < ROWS && x < COLS && this.terrain.passable(y * COLS + x)) return this.goTo(a, x, y);
      }
      return this.startWalk(a);
    }
    if (st === 'BOAT') {
      const pier = this.structures.find(s => s.kind === 'píer')!;
      return this.goTo(a, pier.x, pier.y);
    }
    if (st === 'AGORA') {
      // passeio pela ágora: um ponto livre qualquer entre as colunas
      const ag = this.terrain.agora;
      a.plaza = this.terrain.plazas[0]!;
      for (let k = 0; k < 20; k++) {
        const ang = a.r() * Math.PI * 2, rr = 0.25 + a.r() * 0.6;
        const x = Math.round(ag.x + Math.cos(ang) * ag.rx * rr), y = Math.round(ag.y + Math.sin(ang) * ag.ry * rr);
        if (this.terrain.passable(y * COLS + x)) return this.goTo(a, x, y);
      }
      return this.startWalk(a);
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
    const rx = PROFS[a.prof] === 'explorador' ? 70 : 26, ry = PROFS[a.prof] === 'explorador' ? 32 : 12;
    if (Math.abs(dx) > rx || Math.abs(dy) > ry) a.dir = Math.abs(dx) / 2 > Math.abs(dy) ? (dx > 0 ? 1 : 3) : dy > 0 ? 2 : 0;
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
      if (a.state !== 'ARRIVE') this.meet(a);
      return;
    }
    if (a.phase === 'go') {
      if (a.state === 'ARRIVE') { a.state = 'PLANT'; a.phase = 'stay'; a.wait = 16; a.bubble = '+'; a.bubbleUntil = tick + 16; return; }
      if (a.state === 'GATHER') { a.phase = 'boid'; a.boidLeft = 60 + Math.floor(a.r() * 90); return; }
      if (a.state === 'AGORA') { a.phase = 'boid'; a.boidLeft = 50 + Math.floor(a.r() * 110); return; }
      a.phase = 'stay';
      const night = isNight(hourAt(tick));
      if (a.state === 'CHOP') { a.wait = 60 + Math.floor(a.r() * 80); a.bubble = 'tok'; a.bubbleUntil = tick + a.wait; return; }
      if (a.state === 'PLAY') { a.wait = 120 + Math.floor(a.r() * 160); a.bubble = '♪'; a.bubbleUntil = tick + a.wait; return; }
      if (a.state === 'GARDEN') {
        a.wait = 30 + Math.floor(a.r() * 30); a.bubble = '¨'; a.bubbleUntil = tick + a.wait;
        const t = this.trees.find(tr => tr.x === a.x && tr.y === a.y - 1);
        if (t) t.lastWater = tick;
        // planta uma flor do lado
        const fi = a.y * COLS + a.x + (a.r() < 0.5 ? -1 : 1);
        if (this.terrain.T[fi] === Tile.Grass && !this.flower[fi]) this.flower[fi] = 1 + Math.floor(a.r() * FLOWERS.length);
        if (a.friend && a.r() < 0.04) this.note(`${a.name} regou a árvore de ${a.friend.name}`, 'trabalho');
        return;
      }
      if (a.state === 'BOAT') { a.wait = 200 + Math.floor(a.r() * 300); return; }
      if (a.state === 'SIGHT') {
        a.wait = 60 + Math.floor(a.r() * 90); a.bubble = a.sight === 'moinho' ? '~' : a.sight === 'torre de vigia' ? '!' : '*'; a.bubbleUntil = tick + 12;
        if (a.r() < 0.08) this.note(`${a.name} foi até ${a.sight === 'moinho' ? 'o moinho' : a.sight === 'ponte' ? 'a ponte' : a.sight === 'barraca' ? 'o acampamento' : `o ${a.sight === 'torre de vigia' ? 'alto da torre de vigia' : a.sight}`}`, 'encontro');
        return;
      }
      a.wait = a.state === 'WATER' ? 14 : a.state === 'REST' ? (night ? Math.floor((120 + a.r() * 300) * 2.5) : 40 + Math.floor(a.r() * 100)) : 40 + Math.floor(a.r() * 60);
      if (a.state === 'WATER') { a.bubble = '¨'; a.bubbleUntil = tick + 14; }
      if (a.state === 'REST' && night) { a.bubble = 'z'; a.bubbleUntil = tick + a.wait; }
      const f = a.friend;
      if (a.state === 'VISIT' && f && Math.abs(f.x - a.x) < 4 && Math.abs(f.y - a.y) < 3) {
        const gift = a.r() < 0.4;
        a.bubble = gift ? 'gift' : '♥'; a.bubbleUntil = tick + a.wait; f.bubble = '♥'; f.bubbleUntil = tick + a.wait;
        if (gift) this.note(`${a.name} levou um presente para ${f.name}`, 'encontro');
      }
      return;
    }
    if ((a.phase === 'boid' || a.phase === 'walk') && this.weather().storm) { a.bubble = '!'; a.bubbleUntil = tick + 8; this.decide(a); return; }
    if (a.phase === 'boid') {
      this.boid(a);
      // roda de cantoria: com gente em volta à noite alguém puxa uma música
      if (hourAt(tick) >= 18 || isNight(hourAt(tick))) {
        if (a.r() < 0.04 * (0.3 + a.traits.social)) { a.bubble = '♪'; a.bubbleUntil = tick + 10 + Math.floor(a.r() * 14); }
      }
      if (--a.boidLeft <= 0) this.decide(a);
      return;
    }
    if (a.phase === 'walk') {
      this.walk(a);
      if (this.meet(a)) return;
      if (--a.steps <= 0) this.decide(a);
      return;
    }
    if (a.state === 'PLANT') this.build(a);
    if (a.state === 'WATER' && a.tree) a.tree.lastWater = tick;
    if ((a.state === 'FISH' || a.state === 'BOAT') && a.r() < (PROFS[a.prof] === 'pescador' ? 0.6 : 0.3)) {
      const roll = a.r(), fish = roll < 0.04 ? 'um peixe dourado' : roll < 0.1 ? 'uma bota velha' : ['um lambari', 'uma traíra', 'um bagre'][Math.floor(a.r() * 3)]!;
      a.bubble = fish === 'uma bota velha' ? '?' : '><>'; a.bubbleUntil = tick + 10;
      if (fish === 'um peixe dourado' || fish === 'uma bota velha' || a.r() < 0.08) this.note(`${a.name} pescou ${fish}`, 'pesca');
    }
    this.decide(a);
  }

  /** Encontro no passeio: acena para quem passa perto e às vezes para pra conversar. */
  private meet(a: Agent): boolean {
    const tick = this.tick;
    if (tick - a.chatAt < 400) return false;
    for (const b of this.agents) {
      if (b === a || !b.present || !(b.phase === 'walk' || (b.phase === 'go' && b.state !== 'ARRIVE')) || tick - b.chatAt < 400) continue;
      if (Math.abs(b.x - a.x) > 3 || Math.abs(b.y - a.y) > 2) continue;
      a.chatAt = b.chatAt = tick;
      if (a.r() < 0.25 + 0.5 * (a.traits.social + b.traits.social) / 2) {
        const len = 30 + Math.floor(a.r() * 50);
        for (const [p, q] of [[a, b], [b, a]] as const) {
          p.state = 'CHAT'; p.phase = 'stay'; p.wait = len; p.friend = q; p.path = [];
          p.face = q.x > p.x ? 1 : q.x < p.x ? -1 : p.face;
          p.bubble = '…'; p.bubbleUntil = tick + len;
        }
        return true;
      }
      a.bubble = b.bubble = 'o/';
      a.bubbleUntil = b.bubbleUntil = tick + 8;
      return false;
    }
    return false;
  }

  /** A cada 240 ticks: árvores crescem, trilhas se apagam, trilha esquecida vira flor. */
  private seasonPass(): void {
    const rain = this.isRain(), { T } = this.terrain, seed = this.terrain.seed;
    for (const t of this.trees) { const watered = this.tick - t.lastWater < 1800; t.growth += (rain ? 2 : 1) * (watered ? 1.5 : 1); }
    for (let i = 0; i < N; i++) {
      if (this.wear[i]! > 0) { this.wear[i]! *= 0.945; if (this.wear[i]! < 0.05) this.wear[i] = 0; }
      if (this.gardenCells.has(i)) continue;
      if (!this.flower[i] && T[i] === Tile.Grass && this.wear[i]! >= (this.season === 3 ? 2 : 2.5) && this.wear[i]! < 6 && this.tick - this.lastV[i]! > 2400 && h32(i, this.tick, seed) % 1000 < (this.season === 3 ? 18 : 12)) {
        this.flower[i] = 1 + (h32(i, 7, seed) % FLOWERS.length);
        this.wear[i] = 0;
      } else if (this.flower[i] && h32(i, this.tick, 11) % 1000 < 4) this.flower[i] = 0;
    }
    this.groundVersion++;
  }
}
