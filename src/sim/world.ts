import { makeNoise, type Noise3 } from '../core/noise';
import { h32, mulberry32 } from '../core/rng';
import { COLS, DIR4, N, ROWS, RUINS, Tile, WALKABLE } from './constants';
import type { Column, Plaza, WildTree } from './types';

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
  /** colunas da ágora central */
  columns: Column[] = [];
  /** centro e raios da ágora */
  agora = { x: 0, y: 0, rx: 16, ry: 8 };
  readonly noise: Noise3;

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

  private generate(): void {
    const { T, H, M, noise, seed } = this;
    const r = mulberry32(seed ^ 0x9e3779b9);
    const lakes = [0, 1, 2, 3].map(() => ({ x: 20 + r() * (COLS - 40), y: 12 + r() * 72, rx: 12 + r() * 14, ry: 5 + r() * 6 }));
    for (let y = 0; y < ROWS; y++) for (let x = 0; x < COLS; x++) {
      const i = y * COLS + x;
      let h = noise(x * 0.035, y * 0.07) + 0.5 * noise(x * 0.09, y * 0.18, 3.1) + 0.25 * noise(x * 0.2, y * 0.4, 7.7);
      for (const l of lakes) { const dx = (x - l.x) / l.rx, dy = (y - l.y) / l.ry; h -= 0.75 * Math.exp(-(dx * dx + dy * dy)); }
      const m = noise(x * 0.025 + 40, y * 0.05, 1.7);
      H[i] = h; M[i] = m;
      T[i] = h < -0.44 ? Tile.Deep : h < -0.33 ? Tile.Shallow : h < -0.26 ? Tile.Sand : h > 0.5 ? Tile.Rock : m > 0.18 ? Tile.Forest : Tile.Grass;
    }
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
      if (!ok || this.plazas.some(p => Math.abs(p.x - x) < 28 && Math.abs(p.y - y) < 14)) continue;
      this.plazas.push({ x, y, main: false });
    }
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
      this.wild.push({ x, y, big: h32(x, y, 9) % 3 > 0, sp: h32(x, y, 4) % 3 });
      this.block[i] = 1;
    }
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
