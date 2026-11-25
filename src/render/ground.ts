import { h32 } from '../core/rng';
import { COLS, FLOWERS, ROWS, Tile } from '../sim/constants';
import type { Simulation } from '../sim/simulation';

/**
 * Chão em "mini-grade": cada célula do mapa vira 3x4 caracteres miúdos sobre um fundo escuro.
 * O mapa é dividido em blocos de 16x16 células; cada bloco é rasterizado uma vez por zoom
 * e só é refeito quando as trilhas ou flores daquele bloco mudam.
 */
export const CHUNK = 16;
const SX = 3, SY = 4;

const pick = <T>(arr: readonly T[], n: number) => arr[n % arr.length]!;
const BLADES = [',', "'", '"', '`', '|', ';', "'", ','];
const GRASS_T = ['#25552f', '#2f683a', '#3a7a44', '#478b50', '#5a9e60'];
const FOREST_T = ['#1a3a24', '#21482c', '#2a5635', '#34663f'];
const DIRT_T = ['#3a2f23', '#4a3c2c', '#5c4a36'];
const SAND_T = ['#5e5139', '#74654a', '#8a7854'];
const ROCK_T = ['#34363c', '#474a51', '#5e6169', '#7a7d86'];
const STONE_T = ['#3c3c44', '#50505a', '#686874', '#84848f'];
const DEEP_T = ['#0f2d42', '#143a55', '#1b4a6a'];
const SHALLOW_T = ['#1b4d6a', '#236183', '#2f789c'];
const MOSS_T = ['#2f5a2c', '#3f7a38', '#4f8a40', '#6a9f4c'];
const SLAB_T = ['#5a574c', '#6f6b5e', '#878272'];
const BG: Record<number, string> = { 0: '#06182a', 1: '#0a2536', 2: '#2a241a', 3: '#122a1a', 4: '#0d1f14', 5: '#141518', 6: '#18181d', 7: '#101013' };

export class GroundCache {
  /** blocos por zoom: os últimos 3 zooms ficam guardados, então ir e voltar não refaz nada */
  private byZoom = new Map<string, Map<number, { canvas: HTMLCanvasElement; sig: number }>>();
  private chunks = new Map<number, { canvas: HTMLCanvasElement; sig: number }>();
  private key = '';
  constructor(private sim: Simulation) {}

  setSim(sim: Simulation): void { this.sim = sim; this.byZoom.clear(); this.chunks.clear(); this.key = ''; }

  /** Assinatura do que é visível e muda: trilhas e flores. */
  private sig(cx: number, cy: number): number {
    let h = 0x811c9dc5;
    const { wear, flower } = this.sim;
    for (let y = cy * CHUNK; y < Math.min(ROWS, (cy + 1) * CHUNK); y++) for (let x = cx * CHUNK; x < Math.min(COLS, (cx + 1) * CHUNK); x++) {
      const i = y * COLS + x, w = wear[i]!;
      h ^= (w >= 6 ? 2 : w >= 2.5 ? 1 : 0) + flower[i]! * 3;
      h = Math.imul(h, 0x01000193);
    }
    return h >>> 0;
  }

  /** Devolve o bloco pronto, ou null se ainda não deu tempo de desenhar (o orçamento evita travadas). */
  get(cx: number, cy: number, cw: number, ch: number, budget: { n: number }): HTMLCanvasElement | null {
    const key = `${cw}|${ch}`;
    if (key !== this.key) {
      this.key = key;
      const m = this.byZoom.get(key) ?? new Map();
      this.byZoom.delete(key);
      this.byZoom.set(key, m);
      while (this.byZoom.size > 3) this.byZoom.delete(this.byZoom.keys().next().value!);
      this.chunks = m;
    }
    const id = cy * 1000 + cx, have = this.chunks.get(id);
    if (have && (budget.n <= 0 || have.sig === this.sig(cx, cy))) return have.canvas;
    if (budget.n <= 0) return null;
    budget.n--;
    const sig = this.sig(cx, cy), canvas = have?.canvas ?? document.createElement('canvas');
    this.draw(canvas, cx, cy, cw, ch);
    this.chunks.set(id, { canvas, sig });
    return canvas;
  }

  private draw(c: HTMLCanvasElement, cx: number, cy: number, cw: number, ch: number): void {
    const { T, H, M, ruinCh } = this.sim.terrain, seed = this.sim.terrain.seed, { wear, flower } = this.sim;
    c.width = Math.ceil(CHUNK * cw);
    c.height = Math.ceil(CHUNK * ch);
    const g = c.getContext('2d')!;
    const sw = cw / SX, sh = ch / SY;
    g.font = `700 ${Math.max(3, Math.round(sh * 1.45))}px "JetBrains Mono",monospace`;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    const isWater = (x: number, y: number) => x < 0 || y < 0 || x >= COLS || y >= ROWS || T[y * COLS + x]! <= Tile.Shallow;
    for (let ly = 0; ly < CHUNK; ly++) for (let lx = 0; lx < CHUNK; lx++) {
      const x = cx * CHUNK + lx, y = cy * CHUNK + ly;
      if (x >= COLS || y >= ROWS) continue;
      const i = y * COLS + x, t = T[i]!, w = wear[i]!;
      const trail = (t === Tile.Grass || t === Tile.Forest || t === Tile.Sand) && w >= 6;
      g.fillStyle = trail ? '#17120c' : t === Tile.Floor && ruinCh[i] ? (ruinCh[i] === 'a' ? '#23251f' : '#2a2923') : BG[t]!;
      g.fillRect(lx * cw, ly * ch, cw + 0.5, ch + 0.5);
      const shore = t <= Tile.Shallow && (!isWater(x - 1, y) || !isWater(x + 1, y) || !isWater(x, y - 1) || !isWater(x, y + 1));
      for (let j = 0; j < SY; j++) for (let k = 0; k < SX; k++) {
        const hh = h32(x * SX + k, y * SY + j, seed), roll = hh % 100;
        let chr = '', col = '';
        if (trail) {
          if (roll < 55) { chr = pick(['.', ':', ',', '·', "'"], hh >>> 8); col = pick(DIRT_T, hh >>> 12); }
        } else if (t === Tile.Grass || t === Tile.Forest) {
          if (flower[i] && roll < 30) { chr = pick(['*', 'o', '.', '*'], hh >>> 8); col = FLOWERS[flower[i]! - 1]!; }
          else if (t === Tile.Grass && roll < 90) {
            const worn = w >= 2.5 ? 1 : 0, tone = Math.min(4, Math.max(0, ((hh >>> 10) % 4) + (M[i]! > 0 ? 1 : 0) - worn));
            chr = pick(BLADES, hh >>> 6); col = worn && roll < 30 ? pick(DIRT_T, hh >>> 12) : GRASS_T[tone]!;
            if (roll < 1) { chr = '.'; col = '#c9d8a8'; }
          } else if (t === Tile.Forest && roll < 62) { chr = pick([',', '.', "'", ';', '`'], hh >>> 6); col = pick(FOREST_T, hh >>> 11); }
        } else if (t === Tile.Sand) { if (roll < 55) { chr = pick(['.', '·', ',', '`'], hh >>> 6); col = pick(SAND_T, hh >>> 11); } }
        else if (t === Tile.Rock) {
          if (roll < 75) { const lit = k === 0 || j === 0 ? 1 : 0, peak = H[i]! > 0.62 ? 1 : 0; chr = pick(['^', '#', '%', 'A', '^'], hh >>> 6); col = ROCK_T[Math.min(3, ((hh >>> 11) % 2) + lit + peak)]!; }
        } else if (t <= Tile.Shallow) {
          if (shore && roll < 40) { chr = pick(['·', '°', '~', '.'], hh >>> 6); col = roll < 15 ? '#7fb3c8' : '#3f7f9c'; }
          else if (roll < (t === Tile.Deep ? 55 : 70)) { chr = pick(['~', '-', '~', '='], hh >>> 6); col = pick(t === Tile.Deep ? DEEP_T : SHALLOW_T, hh >>> 11); }
        } else if (t === Tile.Wall) {
          const r0 = ruinCh[i]!, lit = k === 0 ? 2 : k === 1 ? 1 : 0;
          chr = r0 === '#' ? pick(['#', '%', '&'], hh >>> 6) : r0 === '_' || r0 === 'n' ? pick(['=', '#', '='], hh >>> 6) : pick(['|', '#', '[', ']'], hh >>> 6);
          col = r0 === '#' && roll < 45 ? '#3f5a3c' : STONE_T[Math.min(3, lit + ((hh >>> 11) % 2))]!;
        } else if (t === Tile.Floor && ruinCh[i] === 'a') {
          // lajes da ágora: juntas em grade, musgo nas frestas, raízes e folhas por cima
          const moss = M[i]! + ((hh >>> 20) % 100) / 220 > 0.18, root = h32(x >> 1, y, seed + 5) % 9 === 0;
          if (root && j === 1 + (x % 2) && roll < 85) { chr = pick(['~', '-', '~', 's'], hh >>> 6); col = '#5a4028'; }
          else if (k === 0 || j === 0) { chr = k === 0 && j === 0 ? '+' : k === 0 ? '|' : '-'; col = moss && roll < 70 ? pick(MOSS_T, hh >>> 9) : '#3c3a34'; }
          else if (moss && roll < 55) { chr = pick([',', '"', "'", ';', '*'], hh >>> 6); col = pick(MOSS_T, hh >>> 11); }
          else if (roll < 35) { chr = pick(['.', ':', '·'], hh >>> 6); col = pick(SLAB_T, hh >>> 11); }
        } else if (t === Tile.Floor && ruinCh[i] === 's') {
          chr = j % 2 ? '_' : '='; col = SLAB_T[Math.min(2, (j >> 1) + ((hh >>> 9) % 2))]!;
        } else if (t === Tile.Floor && ruinCh[i] === 'o') {
          // tambores de coluna caída
          chr = pick(['O', '0', '=', 'o'], (hh >>> 6) + k); col = roll < 25 ? pick(MOSS_T, hh >>> 11) : pick(SLAB_T, hh >>> 9);
        } else if (t === Tile.Floor) { if (roll < 45) { chr = pick(['.', ':', '+', '.'], hh >>> 6); col = pick(['#2e2e35', '#3a3a42', '#46464f'], hh >>> 11); } }
        if (!chr) continue;
        g.fillStyle = col;
        g.fillText(chr, lx * cw + (k + 0.5) * sw, ly * ch + (j + 0.5) * sh);
      }
    }
  }
}
