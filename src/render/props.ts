import { h32 } from '../core/rng';

/** Casas e fogueiras em mini-grade (3x4 caracteres por célula). */
const cache = new Map<string, { canvas: HTMLCanvasElement; w: number; h: number }>();
export function clearPropCache(): void { cache.clear(); }

const ROOF = ['#2a1610', '#3e2116', '#5a2f1d', '#764028'];
const WOOD = ['#21170f', '#2f2216', '#45321f', '#5c442a'];

/** Casa de 3 células de largura: telhado em camadas, paredes de tábua, porta, janela e chaminé. */
export function houseSprite(hue: number, lit: boolean, cw: number, ch: number, dpr: number) {
  const key = `${hue}|${lit}|${cw}|${ch}|${dpr}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const sw = (cw / 3) * dpr, sh = (ch / 4) * dpr, cols = 9, roofRows = 6, wallRows = 5;
  const W = Math.ceil(cols * sw), H = Math.ceil((roofRows + wallRows + 2) * sh);
  const c = document.createElement('canvas');
  c.width = W; c.height = H;
  const g = c.getContext('2d')!;
  g.font = `700 ${Math.max(3, Math.round(sh * 1.45))}px "JetBrains Mono",monospace`;
  g.textAlign = 'center'; g.textBaseline = 'middle';
  const put = (ch0: string, col: string, i: number, j: number, bg?: string) => {
    if (bg) { g.fillStyle = bg; g.fillRect(i * sw - 0.3, j * sh - 0.3, sw + 0.6, sh + 0.6); }
    g.fillStyle = col; g.fillText(ch0, (i + 0.5) * sw, (j + 0.5) * sh);
  };
  // chaminé e bandeirinha na cor do dono
  put('|', '#5a5a60', 6, 1, '#2a2a2e'); put('|', '#5a5a60', 6, 2, '#2a2a2e');
  put('>', `hsl(${hue} 70% 62%)`, 4, 0); put('|', '#6b5a48', 4, 1);
  for (let j = 0; j < roofRows; j++) {
    const half = ((j + 1) / roofRows) * 4.6, y = j + 2;
    for (let i = 0; i < cols; i++) {
      const d = i + 0.5 - cols / 2;
      if (Math.abs(d) > half) continue;
      const edge = Math.abs(d) > half - 1, lit = d < 0 ? 2 : 0, hh = h32(i, j, 31);
      const chr = edge ? (d < 0 ? '/' : '\\') : j === roofRows - 1 ? '=' : ['^', '=', '#', '^'][hh % 4]!;
      put(chr, ROOF[Math.min(3, lit + (hh % 2) + (edge ? 1 : 0))]!, i, y, ROOF[Math.max(0, lit - 1)]);
    }
  }
  for (let j = 0; j < wallRows; j++) for (let i = 1; i < cols - 1; i++) {
    const y = roofRows + 2 + j, hh = h32(i, j, 57), lit = i < 3 ? 2 : i < 6 ? 1 : 0;
    const door = i === 4 && j >= 2, win = (i === 2 || i === 6) && (j === 1 || j === 2);
    if (door) put(j === 2 ? 'n' : '|', '#120c08', i, y, '#1a120c');
    else if (win) put('#', lit ? '#ffd27a' : '#2a3440', i, y, lit ? '#a8651f' : '#121820');
    else put(['|', '#', '|', ':'][hh % 4]!, WOOD[Math.min(3, lit + (hh % 2))]!, i, y, WOOD[Math.max(0, lit - 1)]);
  }
  const s = { canvas: c, w: W / dpr, h: H / dpr };
  cache.set(key, s);
  return s;
}

const FLAME = ['#fff1b0', '#ffd36b', '#ffa640', '#ff7a2e', '#d94a1e'];
/** Fogueira animada: pedras em volta, lenha, chamas e faíscas. Desenhada a cada quadro (poucos caracteres). */
export function drawFire(g: CanvasRenderingContext2D, x: number, y: number, cw: number, ch: number, ts: number, seed: number): void {
  const sw = cw / 3, sh = ch / 4;
  g.save();
  g.font = `700 ${Math.max(4, Math.round(sh * 1.5))}px "JetBrains Mono",monospace`;
  g.textAlign = 'center'; g.textBaseline = 'middle';
  for (let k = 0; k < 10; k++) { const a = (k / 10) * Math.PI * 2; g.fillStyle = k % 3 ? '#4a4a52' : '#6a6a74'; g.fillText('o', x + Math.cos(a) * cw * 0.75, y + Math.sin(a) * ch * 0.32); }
  g.fillStyle = '#5a3a20'; g.fillText('=', x - sw * 0.6, y + sh * 0.3); g.fillText('=', x + sw * 0.6, y + sh * 0.1);
  const f = Math.floor(ts * 12);
  for (let k = 0; k < 16; k++) {
    const hh = h32(k, f, seed), hgt = ((hh % 100) / 100) * 1.0;
    const px = x + (((hh >>> 8) % 100) / 100 - 0.5) * cw * 0.9 * (1 - hgt * 0.6), py = y - hgt * ch * 1.1;
    g.fillStyle = FLAME[Math.min(4, Math.floor(hgt * 5 + ((hh >>> 16) % 2)))]!;
    g.fillText(['^', '*', "'", '`', ',', '^'][(hh >>> 4) % 6]!, px, py);
  }
  for (let k = 0; k < 6; k++) {
    const life = (ts * 0.8 + k / 6) % 1, hh = h32(k, Math.floor(ts * 0.8 + k / 6), seed);
    g.globalAlpha = 1 - life;
    g.fillStyle = '#ffc060';
    g.fillText('.', x + (((hh % 100) / 100) - 0.5) * cw * 1.2 + Math.sin(ts * 3 + k) * sw, y - ch * (0.8 + life * 2.2));
  }
  g.restore();
}

const MARBLE = ['#4a4840', '#6b675b', '#8c8676', '#aaa492', '#c4bead'];
const MOSS = ['#2f5a2c', '#3f7a38', '#5a9a48', '#7ab85a'];
/**
 * Coluna dórica antiga: base, fuste canelado, capitel; quebrada termina em lascas.
 * Musgo sobe do pé e algumas têm hera descendo do topo.
 */
export function columnSprite(kind: number, hgt: number, variant: number, cw: number, ch: number, dpr: number) {
  const key = `col|${kind}|${hgt.toFixed(2)}|${variant}|${cw}|${ch}|${dpr}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const sw = (cw / 3) * dpr, sh = (ch / 4) * dpr, cols = 5, rows = Math.max(3, Math.round(hgt * 15));
  const c = document.createElement('canvas');
  c.width = Math.ceil(cols * sw); c.height = Math.ceil((rows + 1) * sh);
  const g = c.getContext('2d')!;
  g.font = `700 ${Math.max(3, Math.round(sh * 1.45))}px "JetBrains Mono",monospace`;
  g.textAlign = 'center'; g.textBaseline = 'middle';
  const put = (chr: string, col: string, i: number, j: number, bg?: string) => {
    if (bg) { g.fillStyle = bg; g.fillRect(i * sw - 0.3, j * sh - 0.3, sw + 0.6, sh + 0.6); }
    g.fillStyle = col; g.fillText(chr, (i + 0.5) * sw, (j + 0.5) * sh);
  };
  const ivy = variant % 3 === 0, mossH = 2 + (variant % 4);
  for (let j = 0; j <= rows; j++) {
    const fromBottom = rows - j, top = j === 0, cap = kind === 0 && j <= 1, base = fromBottom === 0;
    for (let i = 0; i < cols; i++) {
      const hh = h32(i, j, 91 + variant), edge = i === 0 || i === cols - 1;
      if (!cap && !base && edge) continue; // fuste é mais estreito que capitel e base
      const lit = i <= 1 ? 3 : i === 2 ? 2 : 1;
      let chr: string, col = MARBLE[lit]!, bg = MARBLE[lit - 1];
      if (cap) chr = j === 0 ? '=' : '#';
      else if (base) chr = i === 0 ? '[' : i === cols - 1 ? ']' : '_';
      else if (top && kind === 1) { chr = ['^', '/', '\\', 'v'][hh % 4]!; if (hh % 3 === 0) continue; }
      else chr = i === 2 ? ':' : '|';
      if (fromBottom < mossH && hh % 3 !== 0) { chr = [',', '"', ';', '%'][hh % 4]!; col = MOSS[Math.min(3, (hh >>> 4) % 3 + (fromBottom === 0 ? 0 : 1))]!; }
      if (ivy && i === 3 && j > 1 && j < rows * 0.7 && hh % 4 !== 0) { chr = ['§', '{', '&', '}'][hh % 4]!; col = MOSS[2 + ((hh >>> 3) % 2)]!; }
      if (hh % 29 === 0 && !cap) { chr = '/'; col = '#2e2c26'; } // rachadura
      put(chr, col, i, j, bg);
    }
  }
  const s = { canvas: c, w: c.width / dpr, h: c.height / dpr };
  cache.set(key, s);
  return s;
}
