import { makeNoise, type Noise3 } from '../core/noise';
import { h32, mulberry32 } from '../core/rng';
import { COLS, DIR4, N, ROWS, RUINS, Tile, WALKABLE } from './constants';
import type { Column, Landmark, Plaza, WildTree } from './types';

/** Terreno gerado só a partir da semente: relevo e umidade por Perlin, 3 lagos, ruínas e mata nativa. */
export class Terrain {
  readonly T = new Uint8Array(N);
  readonly H = new Float32Array(N);
  readonly M = new Float32Array(N);
  /** células alcançáveis a partir da praça principal */
  readonly comp = new Uint8Array(N);
  /** células bloqueadas por tronco ou cabana */
  readonly block = new Uint8Array(N);
  readonly ruinCh: string[] = new Array<string>(N).fill('');
  plazas: Plaza[] = [];
  wild: WildTree[] = [];
  /** células do riacho, da nascente até o lago */
  stream: number[] = [];
  /** marcos fora do centro */
  landmarks: Landmark[] = [];
  /** colunas da ágora central */
  columns: Column[] = [];
  /** centro e raios da ágora */
  agora = { x: 0, y: 0, rx: 16, ry: 8 };
  readonly noise: Noise3;
  /** enfeite do chão por célula: 1 pântano, 2 cogumelos, 3 pomar, 5 conchas, 6 mata fechada */
  readonly deco = new Uint8Array(N);
  /** mata fechada (canto do mapa) e o cercado com porteiras que leva até ela */
  dense = { x0: 0, y0: 0, x1: 0, y1: 0 };
  pen = { x0: 0, y0: 0, x1: 0, y1: 0 };
  /** onde a trilha de pedra entra na mata */
  trailEnd = { x: 0, y: 0 };
  /** muda quando a vila altera o chão (píer, colunas restauradas) */
  version = 0;

  constructor(readonly seed: number) {
    this.noise = makeNoise(seed);
    this.generate();
  }

  passable(i: number): boolean {
    return WALKABLE[this.T[i]!] === 1 && !this.block[i];
  }

  /**
   * Ágora no centro do mapa: piso de lajes tomado por musgo e raízes, anel de colunas
   * (inteiras, quebradas e caídas), escadaria ao sul, árvores velhas crescendo entre as pedras
   * e o braseiro no meio, que é a fogueira principal.
   */
  private buildAgora(r: () => number): void {
    const { T, H } = this, a = this.agora, cx = Math.floor(COLS / 2), cy = Math.floor(ROWS / 2);
    a.x = cx; a.y = cy;
    for (let y = cy - 13; y <= cy + 13; y++) for (let x = cx - 26; x <= cx + 26; x++) {
      const i = y * COLS + x, d = ((x - cx) / a.rx) ** 2 + ((y - cy) / a.ry) ** 2;
      if (d < 1) { T[i] = Tile.Floor; H[i] = 0; this.ruinCh[i] = y === cy + Math.floor(a.ry) ? 's' : 'a'; }
      else if (d < 2.3) { T[i] = Tile.Grass; H[i] = Math.max(H[i]!, 0); }
    }
    // escadaria ao sul
    for (let x = cx - 3; x <= cx + 3; x++) for (const y of [cy + Math.ceil(a.ry), cy + Math.ceil(a.ry) + 1]) {
      const i = y * COLS + x; T[i] = Tile.Floor; this.ruinCh[i] = 's';
    }
    const n = 20;
    for (let k = 0; k < n; k++) {
      const ang = (k / n) * Math.PI * 2 + Math.PI / 2 + Math.PI / n;
      const x = Math.round(cx + Math.cos(ang) * (a.rx - 2.5)), y = Math.round(cy + Math.sin(ang) * (a.ry - 1.4));
      if (y > cy + 3 && Math.abs(x - cx) < 5) continue; // passagem da escadaria
      const roll = r(), kind = (roll < 0.55 ? 0 : roll < 0.85 ? 1 : 2) as 0 | 1 | 2;
      this.columns.push({ x, y, kind, h: kind === 0 ? 0.85 + r() * 0.15 : kind === 1 ? 0.3 + r() * 0.35 : 0 });
      if (kind !== 2) this.block[y * COLS + x] = 1;
      else { this.ruinCh[y * COLS + x] = 'o'; if (x + 1 < cx + a.rx) this.ruinCh[y * COLS + x + 1] = 'o'; }
    }
    // árvores antigas crescendo entre as pedras
    for (const [dx, dy] of [[-11, -4], [12, 3], [-6, 6], [7, -6]] as const) {
      const x = cx + dx, y = cy + dy;
      if (this.block[y * COLS + x]) continue;
      this.wild.push({ x, y, big: true, sp: 0 });
      this.block[y * COLS + x] = 1;
    }
    this.plazas.push({ x: cx, y: cy, main: true });
  }

  /** Riacho: nasce na borda de cima, longe do centro, e desce serpenteando até achar um lago. */
  private carveStream(r: () => number): void {
    const { T, noise } = this;
    // testa algumas nascentes e fica com o riacho mais comprido
    const trace = (x0: number) => {
      const cells: number[] = [];
      let x = x0;
      for (let y = 0, k = 0; k < ROWS * 3 && y < ROWS - 1; k++, y++) {
        const i = y * COLS + x;
        if (T[i]! <= Tile.Shallow && k > 4) break;
        cells.push(i);
        const drift = noise(y * 0.09, x * 0.01, 4.4);
        if (Math.abs(drift) > 0.18 && k % 2) { x += drift > 0 ? 1 : -1; x = Math.max(2, Math.min(COLS - 3, x)); const j = y * COLS + x; if (T[j]! > Tile.Shallow) cells.push(j); }
      }
      return cells;
    };
    let best: number[] = [];
    for (let k = 0; k < 8; k++) {
      const x0 = Math.floor(COLS * (r() < 0.5 ? 0.1 + r() * 0.25 : 0.65 + r() * 0.25)), c = trace(x0);
      if (c.length > best.length && c.length < ROWS * 1.4) best = c;
    }
    for (const i of best) if (T[i]! > Tile.Shallow) { T[i] = Tile.Stream; this.stream.push(i); }
  }

  private nearPen(x: number, y: number, m: number): boolean {
    const p = this.pen;
    return x >= p.x0 - m && x <= p.x1 + m && y >= p.y0 - m && y <= p.y1 + m;
  }

  /**
   * Mata fechada num canto de baixo: tudo vira floresta escura. Ao lado, um cercado de madeira
   * com porteiras, e duas trilhas de pedra que saem dele e entram na mata.
   */
  private carveDense(r: () => number): void {
    const { T } = this, right = r() < 0.5, w = 54, h = 30;
    const x0 = right ? COLS - w - 1 : 1, x1 = x0 + w, y0 = ROWS - h - 1, y1 = ROWS - 1;
    this.dense = { x0, y0, x1, y1 };
    const cx = (x0 + x1) / 2, cy = y1;
    for (let y = y0 - 4; y <= y1; y++) for (let x = x0 - 6; x <= x1 + 6; x++) {
      if (x < 0 || x >= COLS || y < 0) continue;
      // borda irregular: elipse com ruído
      const e = ((x - cx) / (w / 2)) ** 2 + ((y - cy) / h) ** 2 + this.noise(x * 0.15, y * 0.2, 5.5) * 0.35;
      if (e < 1) { const i = y * COLS + x; T[i] = Tile.Forest; this.deco[i] = 6; }
    }
    // cercado entre a mata e o resto do mapa
    const pw = 18, ph = 8, px0 = right ? x0 - pw - 4 : x1 + 4, py1 = ROWS - 6, py0 = py1 - ph;
    this.pen = { x0: px0, y0: py0, x1: px0 + pw, y1: py1 };
    const gateA = right ? px0 + pw : px0, gates = new Set([py0 + 2, py0 + 6]);
    for (let y = py0; y <= py1; y++) for (let x = px0; x <= px0 + pw; x++) {
      const i = y * COLS + x, edge = y === py0 || y === py1 || x === px0 || x === px0 + pw;
      if (x < 0 || x >= COLS) continue;
      if (edge && !(x === gateA && gates.has(y)) && !(y === py0 && x === px0 + (pw >> 1))) { T[i] = Tile.Wall; this.ruinCh[i] = 'f'; }
      else if (T[i]! <= Tile.Shallow || T[i] === Tile.Rock || T[i] === Tile.Sand) T[i] = Tile.Grass;
      if (!edge && this.deco[i] === 6) { T[i] = Tile.Grass; this.deco[i] = 0; }
    }
    // trilhas de pedra: das duas porteiras até dentro da mata
    for (const gy of gates) {
      let x = gateA + (right ? 1 : -1), y = gy;
      for (let k = 0; k < 40; k++, x += right ? 1 : -1) {
        if (x < 0 || x >= COLS) break;
        if (k % 6 === 3) y += h32(x, gy, this.seed) % 2 ? 1 : 0;
        const i = Math.min(ROWS - 2, y) * COLS + x;
        T[i] = Tile.Floor; this.ruinCh[i] = 'r'; this.deco[i] = 0;
        this.trailEnd = { x, y: Math.min(ROWS - 2, y) };
        if (this.deco[i + (right ? 4 : -4)] === 6 && k > 12) break;
      }
    }
    // portão da frente, virado para a vila: trilha curta para fora
    for (let k = 1; k <= 5; k++) { const i = (py0 - k) * COLS + px0 + (pw >> 1); if (T[i] !== Tile.Wall) { T[i] = Tile.Floor; this.ruinCh[i] = 'r'; } }
  }

  /** Árvores bem juntas na mata fechada (passa por cima das regras de espaçamento). */
  private plantDense(): void {
    const { x0, y0, x1, y1 } = this.dense;
    for (let y = y0 - 4; y < y1; y += 2) for (let x = x0 - 6; x <= x1 + 6; x += 2) {
      const jx = x + (h32(x, y, this.seed) % 2), i = y * COLS + jx;
      if (jx < 1 || jx >= COLS - 1 || y < 2 || this.deco[i] !== 6 || this.block[i] || this.T[i] !== Tile.Forest) continue;
      if (h32(jx, y, 77) % 5 === 0) continue;
      this.wild.push({ x: jx, y, big: h32(jx, y, 9) % 2 === 0, sp: 1 + (h32(jx, y, 4) % 2) });
      this.block[i] = 1;
    }
  }

  /** Pequenas áreas espalhadas: pântano, clareira de cogumelos, pomar, pedreira e uma praia. */
  private placeAreas(r: () => number, lakes: { x: number; y: number; rx: number; ry: number }[]): void {
    const { T, deco } = this, free = (x: number, y: number, rx: number, ry: number) => {
      for (let yy = y - ry; yy <= y + ry; yy++) for (let xx = x - rx; xx <= x + rx; xx++) {
        if (xx < 2 || yy < 2 || xx >= COLS - 2 || yy >= ROWS - 2) return false;
        const t = T[yy * COLS + xx];
        if ((t !== Tile.Grass && t !== Tile.Forest) || deco[yy * COLS + xx]) return false;
      }
      const a = this.agora;
      return !(Math.abs(x - a.x) < a.rx + rx + 8 && Math.abs(y - a.y) < a.ry + ry + 6) && !this.plazas.some(p => Math.abs(p.x - x) < rx + 6 && Math.abs(p.y - y) < ry + 4) && !this.nearPen(x, y, rx + 3);
    };
    const spot = (rx: number, ry: number) => { for (let k = 0; k < 4000; k++) { const x = 6 + Math.floor(r() * (COLS - 12)), y = 5 + Math.floor(r() * (ROWS - 10)); if (free(x, y, rx, ry) && !this.landmarks.some(l => Math.abs(l.x - x) < 30 && Math.abs(l.y - y) < 14)) return [x, y] as const; } return null; };
    const mark = (kind: Landmark['kind'], x: number, y: number) => this.landmarks.push({ kind, x, y, w: 1, v: 0 });
    const sw = spot(8, 4);
    if (sw) {
      for (let dy = -4; dy <= 4; dy++) for (let dx = -8; dx <= 8; dx++) {
        if ((dx / 8) ** 2 + (dy / 4) ** 2 > 1) continue;
        const i = (sw[1] + dy) * COLS + sw[0] + dx, hh = h32(sw[0] + dx, sw[1] + dy, this.seed) % 9;
        deco[i] = 1;
        if (hh < 3 && Math.abs(dx) < 7) T[i] = Tile.Shallow;
      }
      mark('pântano', sw[0], sw[1]);
    }
    const mu = spot(5, 3);
    if (mu) { for (let dy = -3; dy <= 3; dy++) for (let dx = -5; dx <= 5; dx++) if ((dx / 5) ** 2 + (dy / 3) ** 2 <= 1) deco[(mu[1] + dy) * COLS + mu[0] + dx] = 2; mark('cogumelos', mu[0], mu[1]); }
    const po = spot(7, 4);
    if (po) {
      for (let dy = -3; dy <= 3; dy++) for (let dx = -6; dx <= 6; dx++) deco[(po[1] + dy) * COLS + po[0] + dx] = 3;
      for (let dy = -2; dy <= 2; dy += 2) for (let dx = -5; dx <= 5; dx += 3) { const x = po[0] + dx, y = po[1] + dy; this.wild.push({ x, y, big: false, sp: 0, fruit: true }); this.block[y * COLS + x] = 1; }
      mark('pomar', po[0], po[1] + 3);
    }
    // pedreira: um pedaço de rocha que vira chão de blocos cortados, com grama na frente
    for (let k = 0; k < 6000; k++) {
      const x = 6 + Math.floor(r() * (COLS - 12)), y = 6 + Math.floor(r() * (ROWS - 12));
      if (T[y * COLS + x] !== Tile.Rock || T[(y + 3) * COLS + x] !== Tile.Grass || this.nearPen(x, y, 6)) continue;
      for (let dy = -2; dy <= 2; dy++) for (let dx = -4; dx <= 4; dx++) { const i = (y + dy) * COLS + x + dx; if (T[i] === Tile.Rock) { T[i] = Tile.Floor; this.ruinCh[i] = 'q'; } }
      mark('pedreira', x, y + 2);
      break;
    }
    // praia: anel de areia com conchas em volta do maior lago
    const big = [...lakes].sort((p, q) => q.rx * q.ry - p.rx * p.ry)[0]!;
    for (let dy = -Math.ceil(big.ry * 1.6); dy <= big.ry * 1.6; dy++) for (let dx = -Math.ceil(big.rx * 1.5); dx <= big.rx * 1.5; dx++) {
      const x = Math.round(big.x + dx), y = Math.round(big.y + dy);
      if (x < 1 || y < 1 || x >= COLS - 1 || y >= ROWS - 1) continue;
      const i = y * COLS + x, near = [-1, 1, -COLS, COLS, -2, 2].some(o => T[i + o]! <= Tile.Shallow);
      if (near && (T[i] === Tile.Grass || T[i] === Tile.Forest) && !deco[i] && x > 2) { T[i] = Tile.Sand; if (h32(x, y, 3) % 4 === 0) deco[i] = 5; }
    }
    mark('praia', Math.round(big.x), Math.round(big.y + big.ry));
    const pen = this.pen, d = this.dense;
    mark('cercado', pen.x0 + ((pen.x1 - pen.x0) >> 1), pen.y0 + 2);
    mark('floresta', this.trailEnd.x, this.trailEnd.y);
    void d;
  }

  /** Tira árvores nativas de um retângulo (para abrir clareira em volta de uma construção). */
  clearTrees(x0: number, y0: number, x1: number, y1: number): void {
    this.wild = this.wild.filter(w => {
      const inside = w.x >= x0 && w.x <= x1 && w.y >= y0 && w.y <= y1;
      if (inside) { this.block[w.y * COLS + w.x] = 0; this.comp[w.y * COLS + w.x] = 1; }
      return !inside;
    });
  }

  /** Retângulo w x h (base em y) todo de grama ou mata, sem bloqueio e longe de fogueiras. */
  private fits(x: number, y: number, w: number, h: number): boolean {
    if (x < 3 || y - h < 3 || x + w >= COLS - 3 || y >= ROWS - 3) return false;
    for (let yy = y - h + 1; yy <= y; yy++) for (let xx = x; xx < x + w; xx++) {
      const t = this.T[yy * COLS + xx];
      if (t !== Tile.Grass && t !== Tile.Forest) return false;
    }
    const a = this.agora;
    if (((x - a.x) / (a.rx + 8)) ** 2 + ((y - a.y) / (a.ry + 5)) ** 2 < 1) return false;
    return !this.plazas.some(p => Math.abs(p.x - x) < 9 && Math.abs(p.y - y) < 5) && !this.landmarks.some(l => Math.abs(l.x - x) < 14 && Math.abs(l.y - y) < 7);
  }

  /** Procura um lugar dentro de uma região (frações do mapa), em ordem sorteada pela semente. */
  private findSpot(r: () => number, fx0: number, fx1: number, fy0: number, fy1: number, w: number, h: number): [number, number] | null {
    for (let k = 0; k < 3000; k++) {
      const x = Math.floor(COLS * (fx0 + r() * (fx1 - fx0))), y = Math.floor(ROWS * (fy0 + r() * (fy1 - fy0)));
      if (this.fits(x, y, w, h)) return [x, y];
    }
    return null;
  }

  /**
   * Marcos fora do centro, para o mapa ter o que ver em todo canto: moinho a oeste, torre de vigia
   * a leste, círculo de pedras ao norte e ao sul, barracas nos acampamentos e uma ponte num lago.
   */
  private placeLandmarks(r: () => number): void {
    const add = (kind: Landmark['kind'], x: number, y: number, w: number, blockW: number) => {
      this.landmarks.push({ kind, x, y, w, v: Math.floor(r() * 1000) });
      this.clearTrees(x - 3, y - 6, x + w + 3, y + 2);
      for (let k = 0; k < blockW; k++) this.block[y * COLS + x + k] = 1;
    };
    const mill = this.findSpot(r, 0.05, 0.3, 0.2, 0.8, 3, 3);
    if (mill) add('moinho', mill[0], mill[1], 3, 3);
    const tower = this.findSpot(r, 0.7, 0.95, 0.2, 0.8, 3, 3);
    if (tower) add('torre', tower[0], tower[1], 3, 3);
    for (const [y0, y1] of [[0.08, 0.3], [0.7, 0.92]] as const) {
      const st = this.findSpot(r, 0.3, 0.7, y0, y1, 7, 4);
      if (st) { add('pedras', st[0], st[1], 7, 0); for (const [dx, dy] of [[0, -2], [6, -2], [1, 0], [5, 0], [3, -3]]) this.block[(st[1] + dy!) * COLS + st[0] + dx!] = 1; }
    }
    for (const p of this.plazas) {
      if (p.main) continue;
      for (const [dx, dy] of [[-5, -1], [4, 1]] as const) {
        const x = p.x + dx, y = p.y + dy, i = y * COLS + x;
        if ((this.T[i] === Tile.Grass || this.T[i] === Tile.Forest) && (this.T[i + 1] === Tile.Grass || this.T[i + 1] === Tile.Forest) && !this.block[i] && !this.block[i + 1]) add('barraca', x, y, 2, 2);
      }
    }
    // caverna: boca na pedra, com grama na frente, longe da ágora
    let cave: [number, number] | null = null, cd = -1;
    for (let k = 0; k < 6000; k++) {
      const x = 4 + Math.floor(r() * (COLS - 8)), y = 6 + Math.floor(r() * (ROWS - 10)), i = y * COLS + x;
      if (this.T[i] !== Tile.Grass || this.T[i - COLS] !== Tile.Rock || this.T[i - 2 * COLS] !== Tile.Rock || this.block[i]) continue;
      const d = Math.abs(x - this.agora.x) + Math.abs(y - this.agora.y);
      if (d > cd) { cd = d; cave = [x, y]; }
      if (cd > 120) break;
    }
    if (cave) { this.landmarks.push({ kind: 'caverna', x: cave[0], y: cave[1] - 1, w: 1, v: 0 }); this.clearTrees(cave[0] - 2, cave[1] - 1, cave[0] + 2, cave[1] + 2); }
    // ruína secreta: escondida num canto do mapa, revelada com 25 stars
    const tp = this.findSpot(r, 0.82, 0.96, 0.08, 0.35, 7, 4) ?? this.findSpot(r, 0.04, 0.18, 0.08, 0.35, 7, 4);
    if (tp) { this.landmarks.push({ kind: 'templo', x: tp[0], y: tp[1], w: 7, v: 0 }); this.clearTrees(tp[0] - 2, tp[1] - 6, tp[0] + 9, tp[1] + 2); for (let k = 0; k < 7; k++) this.block[tp[1] * COLS + tp[0] + k] = 1; }
    // quadro de pedidos ao lado da escadaria da ágora
    const bx = this.agora.x + 6, by = this.agora.y + Math.ceil(this.agora.ry) + 2;
    this.landmarks.push({ kind: 'quadro', x: bx, y: by, w: 2, v: 0 });
    this.clearTrees(bx - 1, by - 3, bx + 3, by + 1);
    this.block[by * COLS + bx] = this.block[by * COLS + bx + 1] = 1;
    // ponte: travessia horizontal de 3 a 7 células de água entre duas margens, a mais perto do centro
    let best: [number, number, number] | null = null, bd = Infinity;
    for (let y = 6; y < ROWS - 6; y++) for (let x = 4; x < COLS - 12; x++) {
      const i = y * COLS + x;
      if (!(this.T[i] === Tile.Grass || this.T[i] === Tile.Sand) || this.T[i + 1]! > Tile.Shallow) continue;
      let n = 1;
      while (n < 9 && this.T[i + n]! <= Tile.Shallow) n++;
      if (n < 4 || n > 8 || !(this.T[i + n] === Tile.Grass || this.T[i + n] === Tile.Sand)) continue;
      const d = Math.abs(x - this.agora.x) + Math.abs(y - this.agora.y) * 2;
      if (d > 20 && d < bd) { bd = d; best = [x + 1, y, n - 1]; }
    }
    if (best) {
      const [x, y, n] = best;
      for (let k = 0; k < n; k++) { const i = y * COLS + x + k; this.T[i] = Tile.Floor; this.ruinCh[i] = 'b'; }
      this.landmarks.push({ kind: 'ponte', x, y, w: n, v: 0 });
    }
  }

  private generate(): void {
    const { T, H, M, noise, seed } = this;
    const r = mulberry32(seed ^ 0x9e3779b9);
    const lakes = [0, 1, 2, 3, 4].map(() => ({ x: 20 + r() * (COLS - 40), y: 12 + r() * (ROWS - 24), rx: 12 + r() * 14, ry: 5 + r() * 6 }));
    for (let y = 0; y < ROWS; y++) for (let x = 0; x < COLS; x++) {
      const i = y * COLS + x;
      let h = noise(x * 0.035, y * 0.07) + 0.5 * noise(x * 0.09, y * 0.18, 3.1) + 0.25 * noise(x * 0.2, y * 0.4, 7.7);
      for (const l of lakes) { const dx = (x - l.x) / l.rx, dy = (y - l.y) / l.ry; h -= 0.75 * Math.exp(-(dx * dx + dy * dy)); }
      const m = noise(x * 0.025 + 40, y * 0.05, 1.7);
      H[i] = h; M[i] = m;
      T[i] = h < -0.44 ? Tile.Deep : h < -0.33 ? Tile.Shallow : h < -0.26 ? Tile.Sand : h > 0.5 ? Tile.Rock : m > 0.18 ? Tile.Forest : Tile.Grass;
    }
    this.carveDense(r);
    this.carveStream(r);
    this.buildAgora(r);
    // ruínas menores espalhadas pela mata
    RUINS.forEach((tpl, ri) => {
      const w = tpl[0]!.length, hh = tpl.length;
      for (let k = 0; k < 500; k++) {
        const rx = 6 + Math.floor(r() * (COLS - w - 12)), ry = 4 + Math.floor(r() * (ROWS - hh - 8));
        let ok = true;
        for (let y = ry - 2; y < ry + hh + 3 && ok; y++) for (let x = rx - 2; x < rx + w + 2 && ok; x++) if (T[y * COLS + x] !== Tile.Grass) ok = false;
        if (!ok || this.plazas.some(p => Math.abs(p.x - rx) < 40 && Math.abs(p.y - ry) < 20)) continue;
        tpl.forEach((row, dy) => [...row].forEach((ch, dx) => {
          const i = (ry + dy) * COLS + rx + dx;
          T[i] = ch === ' ' || ch === '.' ? Tile.Floor : Tile.Wall;
          this.ruinCh[i] = ch;
        }));
        this.plazas.push({ x: rx + Math.floor(w / 2), y: ry + (ri === 0 ? 2 : hh), main: false });
        break;
      }
    });
    // acampamentos: fogueiras em clareiras de grama, longe das ruínas e umas das outras
    for (let k = 0; k < 6000 && this.plazas.length < 13; k++) {
      const x = 8 + Math.floor(r() * (COLS - 16)), y = 6 + Math.floor(r() * (ROWS - 12));
      let ok = true;
      for (let yy = y - 2; yy <= y + 2 && ok; yy++) for (let xx = x - 3; xx <= x + 3 && ok; xx++) if (T[yy * COLS + xx] !== Tile.Grass) ok = false;
      if (!ok || this.plazas.some(p => Math.abs(p.x - x) < 28 && Math.abs(p.y - y) < 14) || this.nearPen(x, y, 4)) continue;
      this.plazas.push({ x, y, main: false });
    }
    this.placeAreas(r, lakes);
    // fogueira: pedras e chamas ocupam 3x2 células
    for (const p of this.plazas) for (let dx = -1; dx <= 1; dx++) { const i = p.y * COLS + p.x + dx; this.block[i] = this.block[i - COLS] = 1; }
    // mata nativa
    for (let y = 4; y < ROWS - 1; y++) for (let x = 3; x < COLS - 3; x++) {
      const i = y * COLS + x;
      const roll = h32(x, y, seed);
      if (!((T[i] === Tile.Forest && roll % 100 < 9) || (T[i] === Tile.Grass && roll % 1000 < 6))) continue;
      if (this.wild.some(w => Math.abs(w.x - x) < 4 && Math.abs(w.y - y) < 3)) continue;
      if (this.plazas.some(p => Math.abs(p.x - x) < 10 && Math.abs(p.y - y) < 6)) continue;
      if (((x - this.agora.x) / (this.agora.rx + 3)) ** 2 + ((y - this.agora.y) / (this.agora.ry + 2)) ** 2 < 1) continue;
      if (this.deco[i] || this.nearPen(x, y, 1)) continue;
      this.wild.push({ x, y, big: h32(x, y, 9) % 3 > 0, sp: h32(x, y, 4) % 3 });
      this.block[i] = 1;
    }
    this.plantDense();
    this.placeLandmarks(r);
    // componente conexo a partir da praça principal
    const p0 = this.plazas[0]!;
    const q = [(p0.y + 1) * COLS + p0.x];
    this.comp[q[0]!] = 1;
    while (q.length) {
      const c = q.pop()!, cx = c % COLS, cy = (c / COLS) | 0;
      for (const [dx, dy] of DIR4) {
        const nx = cx + dx, ny = cy + dy;
        if (nx < 0 || ny < 0 || nx >= COLS || ny >= ROWS) continue;
        const ni = ny * COLS + nx;
        if (!this.comp[ni] && WALKABLE[T[ni]!] && !this.block[ni]) { this.comp[ni] = 1; q.push(ni); }
      }
    }
  }
}
