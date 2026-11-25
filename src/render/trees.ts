import { hex, mix, type RGB } from '../core/color';
import { h32, mulberry32 } from '../core/rng';

/**
 * Árvores em "mini-grade": cada árvore é desenhada com caracteres bem menores que a célula do mapa
 * (3 por célula na largura, 4 na altura), formando copas densas com luz vinda do alto à esquerda.
 * Cada combinação (forma, variante, tamanho, zoom) é rasterizada uma vez num canvas e reaproveitada;
 * o balanço do vento é só uma transformação na hora de desenhar.
 */
export type Shape = 'cypress' | 'pine' | 'round';
export interface TreeKind { shape: Shape; tones: string[]; bloom?: string[] }

export const KINDS: Record<string, TreeKind> = {
  carvalho: { shape: 'round', tones: ['#132a17', '#214a27', '#336a35', '#4c8c45', '#86bf68'] },
  pinheiro: { shape: 'pine', tones: ['#0e241c', '#1a412f', '#285f43', '#3d835a', '#74b888'] },
  'ipê-amarelo': { shape: 'round', tones: ['#1a2c14', '#2c4a22', '#41662d', '#5e8a3a', '#9cbf5a'], bloom: ['#e2a92c', '#f4cf45', '#ffe58a'] },
  jacarandá: { shape: 'round', tones: ['#182a22', '#284634', '#3a6446', '#548a5c', '#8cbf86'], bloom: ['#7d55c4', '#a27ae8', '#cfb2ff'] },
  cipreste: { shape: 'cypress', tones: ['#0c2422', '#173f39', '#245e52', '#36826e', '#68b496'] },
  'mata-pinho': { shape: 'pine', tones: ['#0b1e17', '#153626', '#215238', '#30704b', '#5e9e72'] },
  'mata-copa': { shape: 'round', tones: ['#0f2214', '#1b3d21', '#2a5a2e', '#3f7a3d', '#6aa35a'] },
};
const DRY = hex('#a8923f');
const TRUNK = ['#2e2924', '#46403a', '#5f574c', '#7a7064'];
const TRUNK_CH = ['#', '$', '8', '&', '%', '#'];
const CH_DARK = [',', '.', ';', "'", ','];
const CH_MID = ['"', "'", '|', '!', ';', ':'];
const CH_LIGHT = ['"', "'", '`', 'i', 'l', '|'];

/** Tamanho em células do mapa (largura, altura da copa, altura do tronco). */
const DIMS: Record<Shape, [number, number, number]> = { cypress: [3.6, 9, 1.2], pine: [6, 7.5, 1.2], round: [6, 5, 1.6] };

export interface TreeSprite { canvas: HTMLCanvasElement; w: number; h: number; canopyW: number }

const cache = new Map<string, TreeSprite>();

/** Meia-largura da copa (0..1) na altura v (0 = topo, 1 = base da copa). */
function halfWidth(shape: Shape, u: number, v: number, blobs: number[][]): boolean {
  if (shape === 'cypress') {
    const hw = Math.pow(Math.sin(Math.PI * Math.min(1, v * 0.98 + 0.02)), 0.55) * (0.5 + 0.5 * v);
    return Math.abs(u) < hw;
  }
  if (shape === 'pine') {
    const tiers = 4, t = Math.min(tiers - 1, Math.floor(v * tiers)), vt = v * tiers - t;
    const hw = (0.3 + (0.7 * (t + 1)) / tiers) * (0.25 + 0.75 * vt);
    return Math.abs(u) < hw;
  }
  for (const [bx, by, br] of blobs) { const dx = u - bx!, dy = (v - by!) * 1.15; if (dx * dx + dy * dy < br! * br!) return true; }
  return false;
}

/** season: 0 verão, 1 outono (copas alaranjadas), 2 inverno (neve no topo), 3 primavera (florzinhas). */
export function treeSprite(kindName: string, variant: number, scale: number, thirsty: boolean, zoom: number, dpr: number, CW: number, CH: number, season = 0): TreeSprite {
  const key = `${kindName}|${variant}|${scale}|${thirsty ? 1 : 0}|${zoom}|${dpr}|${season}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const kind = KINDS[kindName] ?? KINDS.carvalho!;
  const r = mulberry32(h32(variant, kindName.length, 77));
  const [cw0, chh0, th0] = DIMS[kind.shape];
  const sizeJ = 0.88 + r() * 0.28;
  const cwCells = cw0 * scale * (kind.shape === 'cypress' ? 1 : sizeJ), chCells = chh0 * scale * sizeJ, thCells = Math.max(0.5, th0 * scale);
  const px = CW * zoom * dpr, py = CH * zoom * dpr;
  const W = Math.ceil(cwCells * px) + 4, H = Math.ceil((chCells + thCells) * py) + 2;
  const c = document.createElement('canvas');
  c.width = W; c.height = H;
  const g = c.getContext('2d')!;
  const sw = px / 3, sh = py / 4;
  g.font = `700 ${Math.max(3, Math.round(sh * 1.35))}px "JetBrains Mono",monospace`;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  let tones = kind.tones.map(hex);
  if (thirsty) tones = tones.map(t => mix(t, DRY, 0.45));
  if (season === 1 && kind.shape !== 'pine') tones = tones.map((t, k) => mix(t, hex(['#4a2410', '#7a3a14', '#a8521c', '#c8702a', '#e8a048'][k]!), 0.5 + (variant % 3) * 0.1));
  if (season === 2) tones = tones.map(t => mix(t, hex('#8a9aa4'), 0.22));
  const toneCss = tones.map((t: RGB) => `rgb(${t[0] | 0},${t[1] | 0},${t[2] | 0})`);
  const blobs: number[][] = [[0, 0.55, 0.62]];
  for (let k = 0; k < 5; k++) blobs.push([(r() - 0.5) * 1.1, 0.25 + r() * 0.55, 0.32 + r() * 0.22]);
  const canopyH = chCells * py, cols = Math.floor(W / sw), rows = Math.floor(canopyH / sh);
  // tronco (atrás da base da copa)
  const tw = Math.max(sw, cwCells * px * (kind.shape === 'cypress' ? 0.16 : 0.12));
  for (let y = canopyH - sh * 2; y < H - 1; y += sh) for (let x = W / 2 - tw / 2; x < W / 2 + tw / 2; x += sw) {
    const lx = (x - (W / 2 - tw / 2)) / tw;
    g.fillStyle = TRUNK[Math.min(3, Math.max(0, Math.floor((1 - lx) * 3 + r() * 1.2)))]!;
    g.fillText(TRUNK_CH[Math.floor(r() * TRUNK_CH.length)]!, x + sw / 2, y + sh / 2);
  }
  // copa
  for (let j = 0; j < rows; j++) for (let i = 0; i < cols; i++) {
    const u = ((i + 0.5) * sw - W / 2) / (W / 2 - 2), v = (j + 0.5) / rows;
    const jag = (h32(i, j, variant) % 100) / 100 * 0.16 - 0.08;
    if (!halfWidth(kind.shape, u + jag, v, blobs)) continue;
    let l = 0.62 - 0.45 * u - 0.3 * (v - 0.45) + (r() - 0.5) * 0.35;
    if (kind.shape === 'pine') { const vt = (v * 4) % 1; if (vt > 0.8) l -= 0.25; }
    if (!halfWidth(kind.shape, u * 1.18 + jag, v, blobs)) l -= 0.18; // borda mais escura
    const ti = Math.max(0, Math.min(4, Math.floor(l * 5)));
    let col = toneCss[ti]!, set = ti <= 1 ? CH_DARK : ti >= 3 ? CH_LIGHT : CH_MID;
    if (kind.bloom && !thirsty && season !== 2 && r() < (season === 3 ? 0.3 : 0.18) + 0.3 * Math.max(0, l - 0.4)) { col = kind.bloom[Math.min(2, Math.floor(l * 3))]!; set = ['*', 'o', '.', '°']; }
    else if (season === 3 && kind.shape === 'round' && r() < 0.05) { col = '#f4c2d8'; set = ['*', '.']; }
    if (season === 2 && v < 0.35 && l > 0.35 && r() < 0.5) { col = '#e8f0f4'; set = ['*', '°', '.']; }
    // corpo sólido da copa (tom mais escuro) e o caractere por cima (tom mais claro): textura densa
    g.fillStyle = toneCss[Math.max(0, ti - 2)]!;
    g.fillRect(i * sw - 0.3, j * sh - 0.3, sw + 0.6, sh + 0.6);
    g.fillStyle = col === toneCss[ti] ? toneCss[Math.min(4, ti + 1)]! : col;
    g.fillText(set[Math.floor(r() * set.length)]!, (i + 0.5) * sw, (j + 0.5) * sh);
  }
  const sprite = { canvas: c, w: W / dpr, h: H / dpr, canopyW: (cwCells * px) / dpr };
  cache.set(key, sprite);
  return sprite;
}

export function clearTreeCache(): void { cache.clear(); }
