import { hsl } from '../core/color';
import { fnv, h32, mulberry32 } from '../core/rng';
import { INSTRUMENTS, PET_NAMES, PETS, PROFS, COLS, DAY_MS, DIR4, DIR8, FLOWERS, HOUSE_DX, N, ROWS, SPECIES, TICK_MS, TICKS_PER_HOUR, Tile, WALKABLE } from './constants';
import { affinity, commitBias, COUPLE_AT, ecosystem, FRIEND_AT, isFullMoon, merchantFor, RIVAL_AT } from './extras';
import { age, lookFrom, profOf } from './look';
import { CROPS, cropOf, growth, WHEAT_EPOCH, WHEAT_TARGET, type Growth } from './farm';
import { Terrain } from './world';
import { weatherAt, type Weather } from './weather';
import { lanternSpots, planVillage, STARS_PER_COLUMN, type Structure } from './village';
import type { Agent, AgentMeta, LogEntry, Plaza, Point, RepoData, State, Tree, WorldFile } from './types';

/** Fogo de raio numa árvore: some com o mutirão dos baldes e vira muda replantada. */
export interface Fire { x: number; y: number; hp: number; start: number; out: number }
/** Acampamento de quem fez fork, na borda do mapa. */
export interface ForkCamp { login: string; x: number; y: number }
export interface Request { n: number; title: string; state: 'open' | 'closed'; closedAt?: number; votes: number }
export interface Festival { name: string; kind: 'colheita' | 'solstício' | 'equinócio' | 'versão'; from: number; to: number }
/** Com 60 stars a vila conserta a ponte do riacho e abre o mirante do outro lado. */
export const BRIDGE_AT = 60;

const WED = 3;
const DX8 = Int8Array.from(DIR8, d => d[0]), DY8 = Int8Array.from(DIR8, d => d[1]);

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
  /** dados do GitHub (forks, pedidos, commits e seguidores) */
  readonly extra: RepoData;
  private readonly bias: { sun: number; fog: number };
  /** fogo de raio em andamento (no máximo um por dia) */
  fire: Fire | null = null;
  private fireDone = false;
  /** coelhos e raposas de hoje, pelo modelo predador-presa */
  readonly eco: { rabbits: number; foxes: number };
  readonly forks: ForkCamp[] = [];
  private readonly trail = new Set<number>();
  readonly requests: Request[];
  /** mercador do dia (um seguidor do dono do repo) e o caminho dele: oeste, mercado, leste */
  readonly merchant: string | null;
  merchantPath: number[] = [];
  private merchantStop = 0;
  /** semana da última votação do conselho */
  private voteWeek = -1;
  /** ruína secreta: aparece com 25 stars, cristal aceso com 50 */
  templeOpen = false;
  crystalLit = false;
  private readonly gardenCells = new Uint8Array(N);
  private readonly brokenCols: number[];
  private readonly gScore = new Int32Array(N);
  private readonly closed = new Uint32Array(N);
  private readonly heapN = new Int32Array(N * 8);
  private readonly heapF = new Int32Array(N * 8);
  private readonly prev = new Int32Array(N);
  private readonly seen = new Uint32Array(N);
  private stamp = 0;
  /** recados (issues "recado") por login e quem já teve PR aceito */
  readonly notes = new Map<string, string>();
  readonly builders = new Set<string>();
  /** festas do dia: colheita, solstício, equinócio e lançamento de versão */
  festivals: Festival[] = [];
  /** ponte quebrada do riacho e o mirante que ela abre */
  bridge: { x: number; y: number; fixed: boolean; lookout: Point } | null = null;
  private soldToday = false;
  private bakedToday = false;
  /** campo de trigo da vila (ao lado do mercado) e o estado dele agora */
  field: { x: number; y: number; w: number; h: number } | null = null;
  wheat!: Growth;
  private wheatSeen = 0;
  /** sacas de trigo no celeiro: a colheita enche, o padeiro gasta */
  wheatStock = 0;
  /** próxima colheita de cada horta (ms) */
  private nextCrop = new Map<Agent, number>();
  /** cartas entregues hoje pelo carteiro */
  readonly letters: { tick: number; from: string; to: string }[] = [];

  constructor(readonly world: WorldFile, readonly genesis: number) {
    this.terrain = new Terrain(fnv(world.seed));
    const local = new Date(genesis + (world.timezoneOffsetHours ?? -3) * 3_600_000 + 12 * 3_600_000);
    const m = local.getUTCMonth();
    this.season = m === 11 || m <= 1 ? 0 : m <= 4 ? 1 : m <= 7 ? 2 : 3;
    this.weekday = local.getUTCDay();
    this.extra = world.extra ?? {};
    this.bias = commitBias(this.extra, genesis + 12 * 3_600_000);
    this.eco = ecosystem(Math.floor(genesis / DAY_MS), this.terrain.seed);
    this.requests = (this.extra.requests ?? []).slice(0, 30).map(q => ({ n: q.n, title: String(q.title).slice(0, 80), state: q.state, closedAt: q.closedAt ? Date.parse(q.closedAt) : undefined, votes: q.votes ?? 0 }));
    for (const n of this.extra.notes ?? []) if (!this.notes.has(n.login.toLowerCase())) this.notes.set(n.login.toLowerCase(), n.text);
    for (const b of this.extra.builders ?? []) this.builders.add(b.toLowerCase());
    this.merchant = merchantFor(this.extra, genesis, this.terrain.seed);
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
    this.placeForks();
    for (const e of entries) {
      if (e.resident) {
        // casal: quem chega depois vai morar ao lado de quem tem afinidade alta (os dois há 3+ dias)
        const mate = e.days >= 3 ? this.agents.find(b => !b.partner && (b.meta.days ?? 0) >= 3 && affinity(b.name, e.login) >= COUPLE_AT) : undefined;
        const a = this.makeAgent(e.login, 0, { days: e.days }, mate);
        a.present = true;
        a.x = a.px = a.home.x;
        a.y = a.py = a.home.y;
        const tr = this.build(a);
        tr.growth = e.days >= 3 ? 140 : e.days === 2 ? 95 : 60;
        tr.age = e.days;
        a.state = 'REST';
        a.phase = 'stay';
        a.wait = Math.floor(a.r() * 300);
        this.agents.push(a);
      } else {
        this.agents.push(this.makeAgent(e.login, e.tick, { starredAt: genesis + e.tick * TICK_MS }));
      }
    }
    for (const a of this.agents) this.relate(a);
    this.placeField();
    const nowMs = genesis;
    this.wheat = growth(this.terrain.noise, this.terrain.seed, WHEAT_EPOCH, nowMs, WHEAT_TARGET);
    this.wheatSeen = this.wheat.harvests;
    this.wheatStock = nowMs - this.wheat.lastHarvest < 3 * DAY_MS ? 12 : 4;
    this.planFestivals();
    this.placeBridge();
    this.planMerchant();
    // votação mais recente do conselho (quarta, 19h30) vale até a próxima
    this.applyVote(this.weekOf(0), false);
    this.updateVillage(false);
    this.startNotes();
  }

  /** Festas do dia, pelo calendário real e pelos dados do repositório. */
  private planFestivals(): void {
    const local = new Date(this.genesis + (this.world.timezoneOffsetHours ?? -3) * 3_600_000 + 12 * 3_600_000);
    const m = local.getUTCMonth() + 1, d = local.getUTCDate(), at = (h: number) => Math.round(h * TICKS_PER_HOUR);
    const sky: [number, number, Festival['kind'], string][] = [[12, 21, 'solstício', 'Festa do solstício de verão'], [6, 21, 'solstício', 'Festa do solstício de inverno'], [3, 20, 'equinócio', 'Festa do equinócio de outono'], [9, 22, 'equinócio', 'Festa do equinócio de primavera']];
    for (const [mm, dd, kind, name] of sky) if (m === mm && d === dd) this.festivals.push({ name, kind, from: at(18), to: at(23.5) });
    const before = growth(this.terrain.noise, this.terrain.seed, WHEAT_EPOCH, this.genesis + 18 * 3_600_000, WHEAT_TARGET).harvests;
    const start = growth(this.terrain.noise, this.terrain.seed, WHEAT_EPOCH, this.genesis, WHEAT_TARGET).harvests;
    if (before > start) this.festivals.push({ name: 'Festa da colheita', kind: 'colheita', from: at(18.5), to: at(22) });
    for (const r of this.extra.releases ?? []) {
      const t = Math.floor((Date.parse(r.at) - this.genesis) / TICK_MS);
      if (t >= -6 * TICKS_PER_HOUR && t < at(22)) { this.festivals.push({ name: `Festa da versão ${r.tag}`, kind: 'versão', from: Math.max(at(19), t), to: at(23.5) }); break; }
    }
  }
  festivalAt(t = this.tick): Festival | null { for (const f of this.festivals) if (t >= f.from && t < f.to) return f; return null; }

  /** Ponte do riacho: meio do riacho; o mirante fica a alguns passos, do lado de lá. */
  private placeBridge(): void {
    const s = this.terrain.stream;
    if (s.length < 12) return;
    const i = s[Math.floor(s.length * 0.45)]!, x = i % COLS, y = (i / COLS) | 0, ag = this.terrain.agora;
    const dir = x < ag.x ? -1 : 1;
    for (let r = 5; r < 14; r++) for (const dy of [0, -1, 1, -2, 2]) {
      const lx = x + dir * r, ly = y + dy, j = ly * COLS + lx;
      if (lx < 3 || lx >= COLS - 3 || ly < 3 || ly >= ROWS - 2) continue;
      if ((this.terrain.T[j] === Tile.Grass || this.terrain.T[j] === Tile.Forest) && this.terrain.comp[j] && !this.terrain.block[j]) {
        this.bridge = { x, y, fixed: false, lookout: { x: lx, y: ly } };
        this.terrain.clearTrees(lx - 2, ly - 2, lx + 2, ly + 1);
        return;
      }
    }
  }

  /** Campo de trigo 12x5 perto do mercado (ou da ágora), em grama livre longe das casas. */
  private placeField(): void {
    const { T, comp, block } = this.terrain, mk = this.structures.find(s => s.kind === 'mercado'), ag = this.terrain.agora;
    const cx = mk ? mk.x + 4 : ag.x + ag.rx + 4, cy = mk ? mk.y + 3 : ag.y + ag.ry + 2, W = 12, H = 5;
    const ok = (x0: number, y0: number) => {
      if (x0 < 3 || y0 < 3 || x0 + W >= COLS - 3 || y0 + H >= ROWS - 2) return false;
      for (let y = y0; y < y0 + H; y++) for (let x = x0; x < x0 + W; x++) {
        const i = y * COLS + x;
        if (!(T[i] === Tile.Grass || T[i] === Tile.Forest) || !comp[i] || block[i]) return false;
      }
      return !this.agents.some(a => a.home.x > x0 - 6 && a.home.x < x0 + W + 4 && a.home.y > y0 - 3 && a.home.y < y0 + H + 3)
        && !this.structures.some(s => s.x > x0 - 3 && s.x < x0 + W + 2 && s.y > y0 - 2 && s.y < y0 + H + 2);
    };
    for (let r = 0; r < 40; r++) for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
      if (Math.max(Math.abs(dx), Math.abs(dy)) !== r || !ok(cx + dx, cy + dy)) continue;
      this.field = { x: cx + dx, y: cy + dy, w: W, h: H };
      this.terrain.clearTrees(cx + dx - 1, cy + dy - 1, cx + dx + W + 1, cy + dy + H + 4);
      this.terrain.version++;
      return;
    }
  }

  /** Horta do morador: cultura pelo login e estágio de agora (recalculado a cada 2 horas). */
  private cropCache = new Map<Agent, { slot: number; stage: number }>();
  gardenOf(a: Agent, atMs = this.genesis + this.tick * TICK_MS): { crop: number; stage: number } {
    const crop = cropOf(a.name), slot = Math.floor(atMs / 7_200_000), c = this.cropCache.get(a);
    if (c && c.slot === slot) return { crop, stage: c.stage };
    const stage = growth(this.terrain.noise, this.terrain.seed, this.plantedAt(a), atMs, CROPS[crop]!.target).stage;
    this.cropCache.set(a, { slot, stage });
    return { crop, stage };
  }
  private plantedAt(a: Agent): number { return a.meta.starredAt ?? this.genesis - (a.meta.days ?? 0) * DAY_MS; }

  /** A cada 2 horas: trigo e hortas crescem pela chuva; quem colhe guarda e às vezes conta no diário. */
  private farmPass(): void {
    const ms = this.genesis + this.tick * TICK_MS, { noise, seed } = this.terrain;
    this.wheat = growth(noise, seed, WHEAT_EPOCH, ms, WHEAT_TARGET);
    if (this.wheat.harvests > this.wheatSeen) {
      this.wheatSeen = this.wheat.harvests;
      this.wheatStock += 12;
      const f = this.agents.find(a => a.present && PROFS[a.prof] === 'agricultor');
      this.note(f ? `Colheita do trigo! ${f.name} encheu o celeiro com 12 sacas` : 'O trigo do campo amadureceu e foi colhido', 'trabalho');
    }
    for (const a of this.agents) {
      if (!a.present) continue;
      let next = this.nextCrop.get(a);
      if (next === undefined) { next = growth(noise, seed, this.plantedAt(a), ms, CROPS[cropOf(a.name)]!.target).nextHarvest; this.nextCrop.set(a, next); }
      if (ms < next) continue;
      const crop = CROPS[cropOf(a.name)]!;
      if (a.items.length < 8) a.items.push(crop.item);
      if (h32(fnv(a.name), this.tick, 5) % 3 === 0) this.note(`${a.name} colheu ${crop.item} da horta`, 'trabalho');
      this.nextCrop.set(a, growth(noise, seed, this.plantedAt(a), ms + 1, crop.target).nextHarvest);
    }
  }

  /** Amigos e rivais pela afinidade dos nomes (a relação vale para os dois lados). */
  private relate(a: Agent): void {
    for (const b of this.agents) {
      if (b === a || a.friends.includes(b) || a.rivals.includes(b)) continue;
      const k = affinity(a.name, b.name);
      if (k >= FRIEND_AT) { a.friends.push(b); b.friends.push(a); } else if (k <= RIVAL_AT) { a.rivals.push(b); b.rivals.push(a); }
    }
  }

  /** Forks viram acampamentos vizinhos nas bordas, com uma trilha até a ágora. */
  private placeForks(): void {
    const forks = [...(this.extra.forks ?? [])].sort((p, q) => (p.at < q.at ? -1 : p.at > q.at ? 1 : p.login < q.login ? -1 : 1)).slice(0, 12);
    const { T, block, comp } = this.terrain;
    const ok = (x: number, y: number) => { const i = y * COLS + x; return (T[i] === Tile.Grass || T[i] === Tile.Forest) && comp[i] && !block[i] && !block[i + 1] && (T[i + 1] === Tile.Grass || T[i + 1] === Tile.Forest); };
    forks.forEach((f, k) => {
      const west = k % 2 === 0, y0 = 8 + ((Math.floor(k / 2) * 23 + (h32(k, 3, this.terrain.seed) % 9)) % (ROWS - 16));
      for (let r = 0; r < 30; r++) for (let dy = -r; dy <= r; dy++) {
        const x = west ? 7 + r : COLS - 9 - r, y = y0 + dy;
        if (y < 3 || y >= ROWS - 3 || !ok(x, y)) continue;
        this.terrain.clearTrees(x - 1, y - 2, x + 2, y + 1);
        block[y * COLS + x] = block[y * COLS + x + 1] = 1;
        this.forks.push({ login: f.login, x, y });
        const ag = this.terrain.plazas[0]!, path = this.bfs(x, y + 1, ag.x, ag.y + 3);
        if (path) for (const c of path.slice(0, Math.ceil(path.length * 0.6))) if (T[c] === Tile.Grass || T[c] === Tile.Forest || T[c] === Tile.Sand) { this.trail.add(c); this.wear[c] = 6.5; }
        return;
      }
    });
    this.terrain.version++;
  }

  /** Caminho do mercador: entra pelo oeste, para no mercado e sai pelo leste. */
  private planMerchant(): void {
    if (!this.merchant) return;
    const mk = this.structures.find(s => s.kind === 'mercado');
    if (!mk) return;
    const tx = mk.x + 1, ty = mk.y + 1, edge = (east: boolean) => {
      for (let r = 0; r < ROWS; r++) for (const y of [ty - r, ty + r]) {
        const x = east ? COLS - 1 : 0;
        if (y >= 0 && y < ROWS && this.terrain.comp[y * COLS + x] && this.terrain.passable(y * COLS + x)) return { x, y };
      }
      return null;
    };
    const w = edge(false), e = edge(true);
    if (!w || !e) return;
    const a = this.bfs(w.x, w.y, tx, ty), b = this.bfs(tx, ty, e.x, e.y);
    if (!a || !b) return;
    this.merchantPath = [w.y * COLS + w.x, ...a, ...b];
    this.merchantStop = a.length;
  }

  /** Onde está o mercador no tick fracionário tf: anda das 9h, fica no mercado e sai antes das 17h. */
  merchantAt(tf: number): { x: number; y: number; face: 1 | -1; walking: boolean } | null {
    const P = this.merchantPath;
    if (!P.length || this.weather(Math.floor(tf)).storm) return null;
    const STEP = 3, t9 = 9 * TICKS_PER_HOUR, t17 = 17 * TICKS_PER_HOUR, back = P.length - 1 - this.merchantStop;
    let idx: number, walking = true, face: 1 | -1 = 1;
    if (tf < t9 || tf > t17) return null;
    const out = t17 - back * STEP;
    if (tf < t9 + this.merchantStop * STEP) idx = (tf - t9) / STEP;
    else if (tf < out) { idx = this.merchantStop; walking = false; face = Math.floor(tf / 120) % 2 ? 1 : -1; }
    else idx = this.merchantStop + (tf - out) / STEP;
    const i0 = Math.min(P.length - 1, Math.floor(idx)), i1 = Math.min(P.length - 1, i0 + 1), f = idx - Math.floor(idx);
    const x0 = P[i0]! % COLS, y0 = (P[i0]! / COLS) | 0, x1 = P[i1]! % COLS, y1 = (P[i1]! / COLS) | 0;
    if (walking) face = x1 >= x0 ? 1 : -1;
    return { x: x0 + (x1 - x0) * f, y: y0 + (y1 - y0) * f, face, walking };
  }

  /** Semana do conselho a que o tick t pertence (muda na quarta às 19h30). */
  private weekOf(t: number): number {
    const ms = this.genesis + t * TICK_MS + (this.world.timezoneOffsetHours ?? -3) * 3_600_000;
    // 1/1/1970 foi quinta: desloca para a semana começar na quarta às 19h30
    return Math.floor((ms - (6 * DAY_MS + 19.5 * 3_600_000)) / (7 * DAY_MS));
  }

  /** O conselho vota se as duas próximas obras trocam de ordem. */
  private applyVote(week: number, announce: boolean): void {
    if (week === this.voteWeek) return;
    this.voteWeek = week;
    const next = this.structures.filter(s => !s.built).sort((p, q) => p.need - q.need).slice(0, 2);
    if (next.length < 2) return;
    const swap = h32(week, 8, this.terrain.seed) % 2 === 1;
    if (swap) { const n = next[0]!.need; next[0]!.need = next[1]!.need; next[1]!.need = n; }
    if (announce) this.note(`Conselho na ágora: a vila votou e a próxima obra será ${swap ? next[1]!.kind : next[0]!.kind}`, 'evento');
    const top = this.requests.filter(q => q.state === 'open' && q.votes > 0).sort((p, q) => q.votes - p.votes || p.n - q.n)[0];
    if (announce && top) this.note(`O conselho contou os 👍: o pedido #${top.n} "${top.title}" (${top.votes} voto${top.votes > 1 ? 's' : ''}) é o primeiro da fila`, 'github');
  }

  /** No conselho, um par de rivais presentes faz as pazes (e vira amigo). */
  private makePeace(): void {
    for (const a of this.agents) {
      const b = a.rivals.find(r => r.present && r.state === 'AGORA');
      if (!a.present || a.state !== 'AGORA' || !b) continue;
      a.rivals = a.rivals.filter(r => r !== b); b.rivals = b.rivals.filter(r => r !== a);
      a.friends.push(b); b.friends.push(a);
      a.bubble = b.bubble = '♥'; a.bubbleUntil = b.bubbleUntil = this.tick + 20;
      this.note(`${a.name} e ${b.name} fizeram as pazes no conselho`, 'amizade');
      return;
    }
  }

  private give(a: Agent, b: Agent, item: string): void {
    const k = a.items.indexOf(item);
    if (k >= 0) a.items.splice(k, 1);
    b.items.push(`${item} (de ${a.name})`);
    if (b.items.length > 12) b.items.shift();
  }

  /** Notas do começo do dia: forks recentes, pedidos e o ecossistema. */
  private startNotes(): void {
    const day = this.genesis;
    for (const f of this.extra.forks ?? []) { const at = Date.parse(f.at); if (at >= day - DAY_MS && at < day + DAY_MS) { const c = this.forks.find(k => k.login === f.login); if (c) this.note(`${f.login} fez um fork e montou acampamento na borda da floresta`, 'github'); } }
    const open = this.requests.filter(q => q.state === 'open').length;
    if (open) this.note(`${open} pedido${open > 1 ? 's' : ''} no quadro da ágora`, 'github');
    this.note(`Ecossistema: ${this.eco.rabbits} coelhos e ${this.eco.foxes} raposas na mata`, 'evento');
  }

  /** Festa na ágora nas 3 horas depois de um pedido atendido. */
  isParty(t = this.tick): boolean {
    const ms = this.genesis + t * TICK_MS;
    if (this.festivalAt(t)) return true;
    return this.requests.some(q => q.state === 'closed' && q.closedAt !== undefined && ms >= q.closedAt && ms < q.closedAt + 3 * 3_600_000);
  }
  /** Conselho: quarta das 19h às 20h. */
  isCouncil(t = this.tick): boolean { const h = hourAt(t); return this.weekday === WED && h >= 19 && h < 20; }

  /** Cervo branco: só em noite de lua cheia, da meia-noite e meia às 4h, perto de uma árvore antiga. */
  deerAt(tf: number): Point | null {
    const t = Math.floor(tf), h = hourAt(t);
    if (h < 0.5 || h >= 4 || !isFullMoon(this.genesis + t * TICK_MS) || !this.terrain.wild.length) return null;
    const day = Math.floor(this.genesis / DAY_MS), w = this.terrain.wild[h32(day, 61, this.terrain.seed) % this.terrain.wild.length]!;
    const n = this.terrain.noise;
    const x = w.x + n(tf * 0.0015, 1.1, day % 97) * 8, y = w.y + n(2.2, tf * 0.0015, day % 89) * 4;
    // cervo não anda na água: se o passeio cair num lago, fica pastando perto da árvore
    const i = Math.round(y) * COLS + Math.round(x);
    return this.terrain.T[i] !== undefined && this.terrain.T[i]! > Tile.Shallow ? { x, y } : { x: w.x + 1, y: w.y + 0.5 };
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
          if ((this.terrain.T[i] === Tile.Grass || this.terrain.T[i] === Tile.Forest) && !this.terrain.block[i] && (dx + dy) % 2 === 0) { this.flower[i] = 1 + (h32(i, 3, 7) % FLOWERS.length); this.gardenCells[i] = 1; }
        }
      }
      this.terrain.version++;
      if (announce) this.note(`A vila construiu ${s.kind === 'lanternas' ? 'as lanternas da ágora' : s.kind === 'jardim' ? 'um jardim em volta do poço' : s.kind === 'píer' ? 'um píer no lago' : `um${s.kind === 'estátua' ? 'a' : ''} ${s.kind}`} (${s.need} stars)`, 'obra');
    }
    if (!this.templeOpen && n >= 25) { this.templeOpen = true; this.terrain.version++; if (announce) this.note('Com 25 stars a mata se abriu e revelou um templo escondido', 'lenda'); }
    if (this.bridge && !this.bridge.fixed && n >= BRIDGE_AT) {
      this.bridge.fixed = true; this.terrain.version++;
      this.terrain.landmarks.push({ kind: 'mirante', x: this.bridge.lookout.x, y: this.bridge.lookout.y, w: 1, v: 0 });
      if (announce) this.note(`Com ${BRIDGE_AT} stars a vila consertou a ponte do riacho, e do outro lado apareceu um mirante`, 'obra');
    }
    if (!this.crystalLit && n >= 50) { this.crystalLit = true; if (announce) this.note('Com 50 stars o cristal do templo acendeu', 'lenda'); }
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
    const w = weatherAt(this.terrain.noise, (this.genesis + t * TICK_MS) / 3_600_000, hourAt(t), this.bias);
    if (t === this.tick) { this.wTick = t; this.wNow = w; }
    return w;
  }
  isRain(t = this.tick): boolean { return this.weather(t).rain > 0.3; }

  /** Star simulada localmente (botão "Dar star"): entra no próximo tick. */
  addLocal(login: string): Agent {
    const a = this.makeAgent(login, this.tick + 1, { local: true });
    this.agents.push(a);
    this.relate(a);
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
    if (this.tick % 14_400 === 7_200) this.farmPass();
    this.skyAndEvents();
    if (this.fire && this.tick - this.fire.start > 900) this.putOut(true);
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
    if (t === Math.round(19.5 * TICKS_PER_HOUR) && this.weekday === WED) this.applyVote(this.weekOf(t), true);
    if (t === Math.round(19 * TICKS_PER_HOUR) && this.weekday === WED) this.note('O conselho se reúne na ágora', 'evento');
    if (t === Math.round(19.75 * TICKS_PER_HOUR) && this.weekday === WED) this.makePeace();
    if (t === Math.round(9 * TICKS_PER_HOUR) && this.merchantPath.length) this.note(`O mercador ${this.merchant} chegou pelo oeste com sua carroça`, 'github');
    if (t === Math.round(0.75 * TICKS_PER_HOUR) && this.deerAt(t)) this.note('Lua cheia: alguém jura ter visto o cervo branco entre as árvores', 'lenda');
    for (const f of this.festivals) if (t === f.from) this.note(`${f.name} na ágora!${f.kind === 'versão' ? ' Fogos no céu' : f.kind === 'colheita' ? ' Pão quente para todo mundo' : ' Lanternas acesas até tarde'}`, 'evento');
    for (const q of this.requests) {
      if (q.state !== 'closed' || q.closedAt === undefined) continue;
      const at = Math.floor((q.closedAt - this.genesis) / TICK_MS);
      if (at === t || (t === 1 && at < 1 && at > -6 * TICKS_PER_HOUR)) this.note(`Pedido #${q.n} atendido: "${q.title}". Festa na ágora!`, 'github');
    }
    // raio numa árvore: só em tempestade, no máximo uma vez por dia
    if (t % 120 === 0 && !this.fire && !this.fireDone && this.weather().storm && h32(t, 55, seed) % 4 === 0) this.ignite(t);
  }

  private ignite(t: number): void {
    const ag = this.terrain.agora, wild = this.terrain.wild, seed = this.terrain.seed;
    for (let k = 0; k < 30 && wild.length; k++) {
      const w = wild[h32(t, 56 + k, seed) % wild.length]!;
      if (Math.abs(w.x - ag.x) < ag.rx + 8 && Math.abs(w.y - ag.y) < ag.ry + 6) continue;
      if (!this.terrain.passable(w.y * COLS + w.x + 1) && !this.terrain.passable((w.y + 1) * COLS + w.x)) continue;
      this.fire = { x: w.x, y: w.y, hp: 6, start: t, out: -1 };
      const who = this.agents.filter(a => a.present).sort((p, q) => Math.abs(p.home.x - w.x) + Math.abs(p.home.y - w.y) - Math.abs(q.home.x - w.x) - Math.abs(q.home.y - w.y))[0];
      this.note(`Um raio acertou uma árvore${who ? ` perto da casa de ${who.name}` : ''}! Mutirão de baldes`, 'evento');
      return;
    }
  }

  /** O fogo apaga (pelos baldes ou pela chuva) e a vila replanta uma muda no lugar. */
  private putOut(rain: boolean): void {
    const f = this.fire!;
    this.fire = null; this.fireDone = true;
    this.terrain.wild = this.terrain.wild.filter(w => !(w.x === f.x && w.y === f.y));
    this.terrain.version++;
    this.trees.push({ x: f.x, y: f.y, sp: h32(f.x, f.y, 9) % SPECIES.length, growth: 0, lastWater: this.tick });
    const crew = this.agents.filter(a => a.state === 'BUCKET').length;
    this.note(`${rain ? 'A chuva e o mutirão' : `O mutirão de ${Math.max(crew, 2)} moradores`} apagou o fogo e replantou uma muda no lugar`, 'trabalho');
  }

  /** Feira: sábado e domingo das 9h às 17h. Corrida de vaga-lumes: sexta das 20h às 21h. */
  /** Dia de banca do agricultor: feira, ou um dia em cada três pelo calendário. */
  isMarketDay(): boolean { return this.weekday === 0 || this.weekday === 6 || h32(Math.floor(this.genesis / DAY_MS), 31, this.terrain.seed) % 3 === 0; }
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
  private makeAgent(name: string, arriveTick: number, meta: AgentMeta, mate?: Agent): Agent {
    const r = mulberry32(fnv(name.toLowerCase()));
    const { hue, look: base } = lookFrom(r), look = age(base, name, meta.days ?? 0);
    const a: Agent = {
      name, r, hue, col: hsl(hue, 0.7, 0.7), look, species: Math.floor(r() * SPECIES.length), pace: 2 + Math.floor(r() * 3),
      traits: { energy: 0.25 + r() * 0.75, social: r(), gardener: r(), wander: r() },
      arriveTick, meta, present: false, x: 0, y: 0, px: 0, py: 0, mt: 0, face: 1, state: 'ARRIVE', phase: 'go', wait: 0, path: [],
      dir: Math.floor(r() * 4), steps: 0, boidLeft: 0, mv: [0, 0], tree: null, friend: null, plaza: null, bubble: '', bubbleUntil: 0, hut: false,
      home: { x: 0, y: 0 }, chatAt: -9999, friends: [], rivals: [], partner: null, inside: false, crystals: 0, items: [], house: 0,
      instrument: fnv(name.toLowerCase() + '#inst') % INSTRUMENTS.length,
      pet: fnv(name.toLowerCase() + '#pet') % 3 === 0 ? { kind: fnv(name.toLowerCase() + '#petk') % PETS.length, name: PET_NAMES[fnv(name.toLowerCase() + '#petn') % PET_NAMES.length]! } : null,
      prof: profOf(name), owl: fnv(name.toLowerCase() + '#owl') % 4 === 0,
    };
    a.home = this.pickHome(a, mate?.home);
    a.house = this.houseType(a);
    if (mate && Math.abs(a.home.x - mate.home.x) < 16 && Math.abs(a.home.y - mate.home.y) < 8) { a.partner = mate; mate.partner = a; }
    return a;
  }

  /** Tipo da casa: palafita se mora na beira d'água; senão o login escolhe (casa na árvore só na mata). */
  private houseType(a: Agent): number {
    const { T } = this.terrain, h = fnv(a.name.toLowerCase() + '#house');
    let wet = false;
    for (let dy = -2; dy <= 3 && !wet; dy++) for (let dx = -5; dx <= 3; dx++) { const x = a.home.x + dx, y = a.home.y + dy; if (x >= 0 && y >= 0 && x < COLS && y < ROWS && T[y * COLS + x]! <= Tile.Shallow) { wet = true; break; } }
    if (wet && h % 2 === 0) return 3;
    const forest = T[a.home.y * COLS + a.home.x] === Tile.Forest;
    const opts = forest ? [0, 1, 2, 2, 4] : [0, 0, 1, 4, 1];
    return opts[(h >>> 3) % opts.length]!;
  }

  private pickHome(a: Agent, near?: Point): Point {
    const { T, comp, block, plazas } = this.terrain;
    for (let k = 0; k < 900; k++) {
      // casal: as primeiras tentativas ficam a poucos passos da casa do par
      const close = near && k < 300, relax = k > 600;
      const x = close ? near.x + (a.r() < 0.5 ? -1 : 1) * (6 + Math.floor(a.r() * 6)) : 3 + Math.floor(a.r() * (COLS - 7));
      const y = close ? near.y + Math.floor(a.r() * 7) - 3 : 4 + Math.floor(a.r() * (ROWS - 6)), i = y * COLS + x;
      if (x < 4 || x > COLS - 4 || y < 4 || y > ROWS - 2) continue;
      let ok = true;
      for (const j of houseCells(i, true)) if (!(T[j] === Tile.Grass || T[j] === Tile.Forest) || !comp[j] || block[j]) ok = false;
      const ag = this.terrain.agora;
      if (!ok || plazas.some(p => Math.abs(p.x - x) < 10 && Math.abs(p.y - y) < 6)) continue;
      if (((x - ag.x) / (ag.rx + 6)) ** 2 + ((y - ag.y) / (ag.ry + 4)) ** 2 < 1) continue;
      if (!relax && this.reserved.some(p => Math.abs(p.x - x) < (close ? 6 : 8) && Math.abs(p.y - y) < (close ? 2 : 4))) continue;
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
    const T = this.terrain.T, block = this.terrain.block;
    let size = 1, expanded = 0;
    { const dx = Math.abs(sx - tx), dy = Math.abs(sy - ty); heapN[0] = s; heapF[0] = 10 * (dx + dy) - 6 * Math.min(dx, dy); }
    seen[s] = st; gScore[s] = 0; prev[s] = s;
    while (size > 0 && expanded < 14000) {
      // pop do heap binário (mesma ordem de antes, só sem closures)
      const c = heapN[0]!, ln = heapN[--size]!, lf = heapF[size]!;
      {
        let i = 0;
        for (;;) {
          let k = 2 * i + 1;
          if (k >= size) break;
          if (k + 1 < size && heapF[k + 1]! < heapF[k]!) k++;
          if (heapF[k]! >= lf) break;
          heapN[i] = heapN[k]!; heapF[i] = heapF[k]!; i = k;
        }
        heapN[i] = ln; heapF[i] = lf;
      }
      if (c === t) break;
      if (closed[c] === st) continue;
      closed[c] = st;
      expanded++;
      const cx = c % COLS, cy = (c / COLS) | 0, gc = gScore[c]!;
      for (let d = 0; d < 8; d++) {
        const dx = DX8[d]!, dy = DY8[d]!, nx = cx + dx, ny = cy + dy;
        if (nx < 0 || ny < 0 || nx >= COLS || ny >= ROWS) continue;
        const ni = ny * COLS + nx;
        if (closed[ni] === st) continue;
        if (ni !== t && (WALKABLE[T[ni]!] !== 1 || block[ni])) continue;
        const g = gc + (dx && dy ? 14 : 10);
        if (seen[ni] === st && g >= gScore[ni]!) continue;
        seen[ni] = st; gScore[ni] = g; prev[ni] = c;
        if (size >= heapN.length) return null;
        const ax = Math.abs(nx - tx), ay = Math.abs(ny - ty), f = g + 10 * (ax + ay) - 6 * Math.min(ax, ay);
        let i = size++;
        while (i > 0) { const q = (i - 1) >> 1; if (heapF[q]! <= f) break; heapN[i] = heapN[q]!; heapF[i] = heapF[q]!; i = q; }
        heapN[i] = ni; heapF[i] = f;
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
  /** as 5 margens mais perto de cada casa (a lista de margens não muda no dia) */
  private readonly nearShore = new Map<number, number[]>();

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
  const key = a.home.y * COLS + a.home.x;
  let near = this.nearShore.get(key);
  if (!near) {
    near = s
      .map(i => ({ i, d: Math.abs((i % COLS) - a.home.x) + Math.abs(((i / COLS) | 0) - a.home.y) * 2 }))
      .sort((p, q) => p.d - q.d || p.i - q.i)
      .slice(0, 5).map(o => o.i);
    this.nearShore.set(key, near);
  }
  const i = near[Math.floor(a.r() * near.length)]!;
  return { x: i % COLS, y: (i / COLS) | 0 };
  }

  private nearestPlaza(a: Agent): Plaza {
    let b = this.terrain.plazas[0]!, bd = 1e9;
    for (const p of this.terrain.plazas) { const d = Math.abs(p.x - a.home.x) + Math.abs(p.y - a.home.y) * 2; if (d < bd) { bd = d; b = p; } }
    return b;
  }

  /** Árvore de vizinho com sede, perto de casa (para ajudar a regar). */
  private thirstyNear(a: Agent): Tree | null {
    for (const t of this.trees) if (t !== a.tree && this.tick - t.lastWater > 2600 && Math.abs(t.x - a.home.x) < 40 && Math.abs(t.y - a.home.y) < 20 && !this.isRain()) return t;
    return null;
  }

  /** Máquina de estados: pesos por temperamento, hora e clima, sorteados pelo PRNG do morador. */
  private decide(a: Agent): void {
    const h = hourAt(this.tick), night = isNight(h), wx = this.weather(), rain = wx.rain > 0.3, evening = h >= 18 && h < 22.5;
    const storm = wx.storm ? 1 : 0, fog = wx.fog > 0.35 ? 1 : 0, day = h >= 7 && h < 18;
    const thirsty = !!a.tree && this.tick - a.tree.lastWater > 1600;
    const prof = PROFS[a.prof], owl = a.owl ? 1 : 0, late = h >= 22 || h < 5, out = (1 - storm) * (rain ? 0.3 : 1), fair = this.isFair() ? 1 : 0;
    const council = this.isCouncil() ? 1 : 0, party = this.isParty() ? 1 : 0, fire = this.fire;
    const cave = this.terrain.landmarks.find(l => l.kind === 'caverna'), board = this.requests.some(q => q.state === 'open');
    const w: [State, number][] = [
      ['WANDER', (0.4 + a.traits.wander * 1.2) * (night ? 0.25 : 1) * (fog ? 0.5 : 1) * (storm ? 0.05 : 1)],
      ['WATER', a.tree ? (thirsty && !rain ? 1.8 : 0.12) * (0.4 + a.traits.gardener) : 0],
      ['REST', (1.1 - a.traits.energy) * (night ? 0.8 : 0.25) + (night ? (owl ? 0.5 : 3.2) : 0) + (rain ? 1 : 0) + storm * 8],
      ['VISIT', a.traits.social * 0.9 * (night ? 0.15 : 1) * (storm ? 0.05 : 1)],
      ['GATHER', (0.25 + a.traits.social) * (evening ? 2.4 : late && owl ? 2 : 0.35) * (rain ? 0.2 : 1) * (1 - storm)],
      ['FISH', (prof === 'pescador' ? 0.8 : 0.15) * (rain ? 0.2 : 1) * (1 - storm) * (fog ? 1.6 : 1)],
      ['AGORA', (0.3 + a.traits.social * 0.6 + a.traits.wander * 0.4) * (day || council || party ? 1 : 0.08) * (rain ? 0.25 : 1) * (1 - storm) * (fair ? 2.5 : 1) * (party ? 3 : 1) + council * 9 * (1 - storm)],
      ['MINE', prof === 'minerador' && day && cave ? 1.1 * (1 - storm) : 0],
      ['TASK', board && day ? (0.12 + a.traits.social * 0.2) * out : 0],
      ['BUCKET', fire && Math.abs(fire.x - a.x) < 90 && Math.abs(fire.y - a.y) < 45 ? 40 : 0],
      ['CHOP', prof === 'lenhador' && day ? 0.9 * out : 0],
      ['PLAY', prof === 'músico' && (day || evening) ? 0.8 * out : 0],
      ['GARDEN', (prof === 'jardineiro' ? 0.9 : this.thirstyNear(a) ? 0.35 : 0) * (day ? 1 : 0) * (1 - storm)],
      ['SIGHT', day && this.terrain.landmarks.length ? (0.25 + a.traits.wander * 0.5) * (prof === 'explorador' ? 3 : 1) * out : 0],
      ['FARM', prof === 'agricultor' && day && this.field ? 1.4 * out : 0],
      ['SELL', prof === 'agricultor' && this.isMarketDay() && h >= 9 && h < 12.5 && this.structures.some(s => s.kind === 'mercado' && s.built) ? 4 * (1 - storm) : 0],
      ['BAKE', prof === 'padeiro' && h >= 4.5 && h < 9 && this.wheatStock > 0 ? 5 : 0],
      ['MAIL', prof === 'carteiro' && day ? 1.6 * out : 0],
      ['BOAT', prof === 'pescador' && day && !rain && this.structures.some(s => s.kind === 'píer' && s.built) ? 0.5 * out : 0],
    ];
    let pick = a.r() * w.reduce((s, x) => s + x[1], 0);
    let st: State = 'REST';
    for (const [k, v] of w) { pick -= v; if (pick <= 0) { st = k; break; } }
    a.state = st;
    a.friend = null;
    if (st === 'WANDER') return this.startWalk(a);
    if (st === 'WATER' || st === 'REST') return this.goTo(a, a.home.x, a.home.y);
    if (st === 'FISH') {
      // pescaria em dupla: se um amigo já está pescando, senta do lado
      const pal = a.friends.find(b => b.present && b.state === 'FISH' && b.phase === 'stay');
      if (pal) for (const [dx, dy] of [[1, 0], [-1, 0], [2, 0], [-2, 0], [0, 1]] as const) {
        const x = pal.x + dx, y = pal.y + dy;
        if (x > 0 && y > 0 && x < COLS && y < ROWS && this.terrain.passable(y * COLS + x)) { a.friend = pal; if (a.r() < 0.15) this.note(`${a.name} foi pescar com ${pal.name}`, 'amizade'); return this.goTo(a, x, y); }
      }
      const p = this.fishSpot(a); return p ? this.goTo(a, p.x, p.y) : this.startWalk(a);
    }
    if (st === 'MINE') { const c = this.terrain.landmarks.find(l => l.kind === 'caverna')!; return this.goTo(a, c.x, c.y + 1); }
    if (st === 'TASK') { const q = this.terrain.landmarks.find(l => l.kind === 'quadro'); return q ? this.goTo(a, q.x, q.y + 1) : this.startWalk(a); }
    if (st === 'BUCKET') {
      const f = this.fire!;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [1, 1], [-1, 1], [2, 0], [-2, 0]] as const) {
        const x = f.x + dx, y = f.y + dy;
        if (x >= 0 && y >= 0 && x < COLS && y < ROWS && this.terrain.passable(y * COLS + x)) return this.goTo(a, x, y);
      }
      return this.startWalk(a);
    }
    if (st === 'VISIT') {
      // amigos primeiro; rivais nunca
      const pals = a.friends.filter(b => b.present && b.hut);
      let near = pals.length && a.r() < 0.7 ? pals : this.agents.filter(b => b !== a && b.present && b.hut && !a.rivals.includes(b) && Math.abs(b.home.x - a.home.x) < 60 && Math.abs(b.home.y - a.home.y) < 30);
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
      // árvore com sede de um vizinho tem prioridade
      const dry = this.thirstyNear(a);
      const others = dry ? [dry] : this.trees.filter(t => t !== a.tree);
      if (!others.length) return this.goTo(a, a.home.x, a.home.y);
      const t = others[Math.floor(a.r() * others.length)]!;
      a.friend = this.agents.find(b => b.tree === t) ?? null;
      const y = t.y + 1;
      return y < ROWS && this.terrain.passable(y * COLS + t.x) ? this.goTo(a, t.x, y) : this.startWalk(a);
    }
    if (st === 'SIGHT') {
      // marco mais interessante: um dos três mais perto de casa (barracas valem como acampamento)
      const lms = this.terrain.landmarks.filter(l => (l.kind !== 'barraca' || a.r() < 0.3) && (l.kind !== 'floresta' || PROFS[a.prof] === 'explorador') && l.kind !== 'quadro')
        .map(l => ({ l, d: Math.abs(l.x - a.home.x) + Math.abs(l.y - a.home.y) * 2 })).sort((p, q) => p.d - q.d || p.l.x - q.l.x).slice(0, 3);
      if (!lms.length) return this.startWalk(a);
      const l = lms[Math.floor(a.r() * lms.length)]!.l;
      a.sight = l.kind === 'pedras' ? 'círculo de pedras' : l.kind === 'torre' ? 'torre de vigia' : l.kind === 'floresta' ? 'floresta densa' : l.kind === 'cogumelos' ? 'clareira dos cogumelos' : l.kind;
      for (const [dx, dy] of [[0, 0], [1, 1], [0, 1], [2, 1], [-1, 0], [l.w, 0], [1, 2], [-1, 1], [0, -1]] as const) {
        const x = l.x + dx, y = l.y + dy;
        if (y < ROWS && x < COLS && this.terrain.passable(y * COLS + x)) return this.goTo(a, x, y);
      }
      return this.startWalk(a);
    }
    if (st === 'FARM') {
      const f = this.field!, x = f.x + Math.floor(a.r() * f.w), y = f.y + Math.floor(a.r() * f.h);
      return this.terrain.passable(y * COLS + x) ? this.goTo(a, x, y) : this.startWalk(a);
    }
    if (st === 'SELL') { const mk = this.structures.find(s => s.kind === 'mercado')!; return this.goTo(a, mk.x + 1, mk.y + 1); }
    if (st === 'BAKE') return this.goTo(a, a.home.x, a.home.y);
    if (st === 'MAIL') {
      // carta de um amigo para outro: o carteiro leva até a porta
      const to = this.agents.filter(b => b.present && b.hut && b !== a && b.friends.some(c => c.present));
      if (!to.length) return this.startWalk(a);
      const b = to[Math.floor(a.r() * to.length)]!;
      a.friend = b;
      const fy = b.home.y + 1;
      return fy < ROWS && this.terrain.passable(fy * COLS + b.home.x) ? this.goTo(a, b.home.x, fy) : this.goTo(a, b.home.x, b.home.y);
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
        if (this.terrain.T[fi] === Tile.Grass && !this.flower[fi]) { this.flower[fi] = 1 + Math.floor(a.r() * FLOWERS.length); this.groundVersion++; }
        if (a.friend && (t && this.tick - t.lastWater > 1000 ? a.r() < 0.5 : a.r() < 0.04)) this.note(`${a.name} regou a árvore${t && this.tick - t.lastWater > 1000 ? ' com sede' : ''} de ${a.friend.name}`, 'trabalho');
        return;
      }
      if (a.state === 'FARM') {
        const stg = this.wheat.stage;
        a.wait = 70 + Math.floor(a.r() * 90); a.bubble = stg === 3 ? 'v' : stg === 0 ? '~' : '¨'; a.bubbleUntil = tick + 14;
        return;
      }
      if (a.state === 'SELL') {
        a.wait = 160 + Math.floor(a.r() * 120); a.bubble = '$'; a.bubbleUntil = tick + 20;
        if (!this.soldToday) { this.soldToday = true; this.note(`${a.name} montou a banca de trigo no mercado`, 'evento'); }
        return;
      }
      if (a.state === 'BAKE') {
        a.wait = 90 + Math.floor(a.r() * 60); a.bubble = 'pão'; a.bubbleUntil = tick + 30;
        if (this.wheatStock > 0) { this.wheatStock--; for (let k = 0; k < 3 && a.items.length < 8; k++) a.items.push('um pão'); }
        if (!this.bakedToday) { this.bakedToday = true; this.note(`Cheiro de pão quente: ${a.name} acendeu o forno`, 'trabalho'); }
        return;
      }
      if (a.state === 'MAIL') {
        a.wait = 16; a.bubble = '✉'; a.bubbleUntil = tick + 16;
        const b = a.friend;
        if (b) {
          const pals = b.friends.filter(c => c.present && c !== a);
          if (pals.length) {
            const from = pals[Math.floor(a.r() * pals.length)]!;
            this.letters.push({ tick, from: from.name, to: b.name });
            if (a.r() < 0.12) this.note(`${a.name} entregou uma carta de ${from.name} para ${b.name}`, 'encontro');
          }
        }
        return;
      }
      if (a.state === 'BOAT') { a.wait = 200 + Math.floor(a.r() * 300); return; }
      if (a.state === 'MINE') { a.inside = true; a.wait = 140 + Math.floor(a.r() * 160); a.bubble = ''; return; }
      if (a.state === 'TASK') {
        a.wait = 24 + Math.floor(a.r() * 20); a.bubble = '!'; a.bubbleUntil = tick + a.wait;
        const open = this.requests.filter(q => q.state === 'open');
        if (open.length && a.r() < 0.12) { const q = open[Math.floor(a.r() * open.length)]!; this.note(`${a.name} leu o pedido #${q.n} no quadro: "${q.title}"`, 'github'); }
        return;
      }
      if (a.state === 'BUCKET') {
        a.wait = 10 + Math.floor(a.r() * 8); a.bubble = 'balde'; a.bubbleUntil = tick + a.wait;
        if (this.fire && --this.fire.hp <= 0) this.putOut(false);
        return;
      }
      if (a.state === 'SIGHT' && a.sight === 'floresta densa') { a.inside = true; a.wait = 200 + Math.floor(a.r() * 200); a.bubble = ''; return; }
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
        if (gift) {
          // presente de verdade: algo que juntou hoje, ou uma flor colhida no caminho
          const own = a.items.filter(i => !i.includes(' (de '));
          const item = own.length ? own[Math.floor(a.r() * own.length)]! : ['uma flor', 'um pão', 'uma pinha', 'um desenho'][Math.floor(a.r() * 4)]!;
          this.give(a, f, item);
          if (a.r() < 0.35 || item.includes('cristal') || item.includes('dourado')) this.note(`${a.name} deu ${item} para ${f.name}`, 'encontro');
        }
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
    if (a.state === 'SIGHT' && a.inside) {
      a.inside = false; a.bubble = '?'; a.bubbleUntil = tick + 16;
      const tales = ['jurando ter ouvido sinos lá no fundo', 'com um cogumelo azul que brilha no escuro', 'dizendo que as árvores cochicham', 'sem saber explicar onde esteve', 'com uma pena branca do cervo', 'contando de uma clareira com mil vaga-lumes', 'com o mapa todo rabiscado'];
      if (a.r() < 0.5) this.note(`${a.name} voltou da floresta densa ${tales[Math.floor(a.r() * tales.length)]}`, 'lenda');
    }
    if (a.state === 'MINE' && a.inside) {
      a.inside = false;
      if (a.r() < 0.5) { a.crystals++; a.items.push('um cristal'); a.bubble = '◆'; a.bubbleUntil = tick + 16; if (a.crystals === 1 || a.r() < 0.1) this.note(`${a.name} saiu da caverna com um cristal`, 'trabalho'); }
    }
    if (a.state === 'WATER' && a.tree) a.tree.lastWater = tick;
    if ((a.state === 'FISH' || a.state === 'BOAT') && a.r() < (PROFS[a.prof] === 'pescador' ? 0.6 : 0.3)) {
      const roll = a.r(), fish = roll < 0.04 ? 'um peixe dourado' : roll < 0.1 ? 'uma bota velha' : ['um lambari', 'uma traíra', 'um bagre'][Math.floor(a.r() * 3)]!;
      a.bubble = fish === 'uma bota velha' ? '?' : '><>'; a.bubbleUntil = tick + 10;
      if (fish === 'um peixe dourado' || fish === 'uma bota velha' || a.r() < 0.08) this.note(`${a.name} pescou ${fish}`, 'pesca');
      if (fish === 'um peixe dourado' || (a.r() < 0.1 && a.items.length < 8)) a.items.push(fish);
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
      if (a.rivals.includes(b)) { a.bubble = b.bubble = 'hmpf'; a.bubbleUntil = b.bubbleUntil = tick + 8; return false; }
      const pals = a.friends.includes(b);
      if (pals || a.r() < 0.25 + 0.5 * (a.traits.social + b.traits.social) / 2) {
        if (pals && a.r() < 0.05) this.note(`${a.name} e ${b.name}, amigos de longa data, pararam para conversar`, 'amizade');
        // amigos às vezes sentam para uma partida de dama em vez de só conversar
        const game = pals && hourAt(tick) >= 8 && hourAt(tick) < 21 && a.r() < 0.3;
        const len = game ? 90 + Math.floor(a.r() * 90) : 30 + Math.floor(a.r() * 50);
        for (const [p, q] of [[a, b], [b, a]] as const) {
          p.state = game ? 'GAME' : 'CHAT'; p.phase = 'stay'; p.wait = len; p.friend = q; p.path = [];
          p.face = q.x > p.x ? 1 : q.x < p.x ? -1 : p.face;
          p.bubble = game ? '♟' : '…'; p.bubbleUntil = tick + len;
        }
        if (game && a.r() < 0.2) { const w = a.r() < 0.5 ? a : b; this.note(`${w.name} ganhou de ${w === a ? b.name : a.name} numa partida de dama`, 'amizade'); }
        // apresenta um amigo: quem é amigo de um passa a ser amigo do outro
        const c = a.friends.find(x => x !== b && x.present && !b.friends.includes(x) && !b.rivals.includes(x));
        if (c && b.friends.length < 6 && c.friends.length < 6 && a.r() < 0.02) { b.friends.push(c); c.friends.push(b); this.note(`${a.name} apresentou ${c.name} para ${b.name}, e os dois viraram amigos`, 'amizade'); }
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
    for (const i of this.trail) this.wear[i] = Math.max(this.wear[i]!, 6.5);
    for (let i = 0; i < N; i++) {
      if (this.wear[i]! > 0) { this.wear[i]! *= 0.945; if (this.wear[i]! < 0.05) this.wear[i] = 0; }
      if (this.gardenCells[i]) continue;
      if (!this.flower[i] && T[i] === Tile.Grass && this.wear[i]! >= (this.season === 3 ? 2 : 2.5) && this.wear[i]! < 6 && this.tick - this.lastV[i]! > 2400 && h32(i, this.tick, seed) % 1000 < (this.season === 3 ? 18 : 12)) {
        this.flower[i] = 1 + (h32(i, 7, seed) % FLOWERS.length);
        this.wear[i] = 0;
      } else if (this.flower[i] && h32(i, this.tick, 11) % 1000 < 4) this.flower[i] = 0;
    }
    this.groundVersion++;
  }
}
