import { h32 } from '../core/rng';

/** Casas e fogueiras em mini-grade (3x4 caracteres por célula). */
const cache = new Map<string, { canvas: HTMLCanvasElement; w: number; h: number }>();
export function clearPropCache(): void { cache.clear(); }

const ROOF = ['#2a1610', '#3e2116', '#5a2f1d', '#764028'];
const WOOD = ['#21170f', '#2f2216', '#45321f', '#5c442a'];

/** Casa de 3 células de largura: telhado em camadas, paredes de tábua, porta, janela e chaminé. */
export function houseSprite(hue: number, lit: boolean, cw: number, ch: number, dpr: number, tall = false) {
  const key = `${hue}|${lit}|${cw}|${ch}|${dpr}|${tall}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const sw = (cw / 3) * dpr, sh = (ch / 4) * dpr, cols = 9, roofRows = 6, wallRows = tall ? 9 : 5;
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
    // com segundo andar: uma faixa de tábuas no meio e mais um par de janelas em cima
    const base = wallRows - 5, door = i === 4 && j >= base + 2, win = (i === 2 || i === 6) && (j === base + 1 || j === base + 2 || (tall && (j === 1 || j === 2)));
    if (tall && j === base - 1) { put('=', '#4a2e18', i, y, '#2a1a0e'); continue; }
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

/** Arte em mini-grade a partir de linhas de texto: cada caractere vira um subcaractere; cores por letra. */
type Pal = Record<string, [string, string?]>;
function artSprite(key: string, rows: string[], pal: Pal, map: (ch: string, i: number, j: number) => string, cw: number, ch: number, dpr: number) {
  const k = `${key}|${cw}|${ch}|${dpr}`;
  const hit = cache.get(k);
  if (hit) return hit;
  const sw = (cw / 3) * dpr, sh = (ch / 4) * dpr, cols = Math.max(...rows.map(r => r.length));
  const c = document.createElement('canvas');
  c.width = Math.ceil(cols * sw); c.height = Math.ceil(rows.length * sh);
  const g = c.getContext('2d')!;
  g.font = `700 ${Math.max(3, Math.round(sh * 1.45))}px "JetBrains Mono",monospace`;
  g.textAlign = 'center'; g.textBaseline = 'middle';
  rows.forEach((row, j) => [...row].forEach((code, i) => {
    if (code === ' ') return;
    const [fg, bg] = pal[code] ?? ['#ff00ff'];
    if (bg) { g.fillStyle = bg; g.fillRect(i * sw - 0.3, j * sh - 0.3, sw + 0.6, sh + 0.6); }
    g.fillStyle = fg; g.fillText(map(code, i, j), (i + 0.5) * sw, (j + 0.5) * sh);
  }));
  const s = { canvas: c, w: c.width / dpr, h: c.height / dpr };
  cache.set(k, s);
  return s;
}

const STONE: Pal = { s: ['#8c8676', '#4a4840'], S: ['#aaa492', '#6b675b'], m: ['#5a9a48', '#2f5a2c'], w: ['#6a4a2a', '#3a2818'], r: ['#b0503a', '#5a2418'], R: ['#d06a48', '#7a3020'], a: ['#2f6f9a', '#143a55'], f: ['#f2c14e'], g: ['#86bf68'], p: ['#f07aa8'], y: ['#fadc5a'], o: ['#ff9a5a'], b: ['#b89cff'] };

export function wellSprite(cw: number, ch: number, dpr: number) {
  const rows = ['  rrRRR  ', ' rrRRRRR ', 'rrrRRRRRR', '  w   w  ', '  w   w  ', '  w   w  ', ' SsSsSsS ', 'SsaaaaasS', 'SsaaaaasS', 'mSsSsSsSm'];
  return artSprite('poço', rows, STONE, (c, i) => (c === 'r' || c === 'R' ? (i < 4 ? '/' : i > 4 ? '\\' : '^') : c === 'w' ? '|' : c === 'a' ? '~' : c === 'm' ? '"' : i % 2 ? '#' : '='), cw, ch, dpr);
}

export function marketSprite(fair: boolean, cw: number, ch: number, dpr: number) {
  // três barracas com toldo listrado; em dia de feira, cheias de frutas e flores
  const rows: string[] = [];
  const stall = () => ['XYXYXYXYX', 'XYXYXYXYX', ' w     w ', ' w' + (fair ? 'fypob' : '     ') + 'w ', ' wsssssw ', ' w     w '];
  const parts = [stall(), stall(), stall()];
  for (let j = 0; j < 6; j++) rows.push(parts.map(p => p[j]).join(''));
  const pal: Pal = { ...STONE, X: ['#f4e9d0', '#c43c3c'], Y: ['#f4e9d0', '#e8d9b0'] };
  return artSprite(`mercado|${fair}`, rows, pal, (c, i) => (c === 'X' || c === 'Y' ? (i % 9 === 0 ? '/' : i % 9 === 8 ? '\\' : '=') : c === 'w' ? '|' : c === 's' ? '=' : 'o'), cw, ch, dpr);
}

export function statueSprite(cw: number, ch: number, dpr: number) {
  // figura antiga de mármore com musgo no pedestal
  const rows = ['   SSS   ', '  SssS   ', '   SS    ', ' sSSSSs  ', 's SSSS s ', '  SSSS   ', '  SSSS   ', '  S  S   ', '  S  S   ', ' mSSSSSm ', ' SsSsSsS ', 'mSsSsSsSm', 'SsSsSsSsS'];
  return artSprite('estátua', rows, STONE, (c, i, j) => (c === 'm' ? '"' : j < 3 ? (c === 's' ? 'o' : '@') : j < 9 ? (c === 's' ? (i < 4 ? '/' : '\\') : '|') : i % 2 ? '#' : '='), cw, ch, dpr);
}

export function lanternSprite(lit: boolean, cw: number, ch: number, dpr: number) {
  const rows = [' R ', 'RfR', ' w ', ' w ', ' w ', ' w ', 'sws'];
  const pal: Pal = { ...STONE, f: [lit ? '#ffe08a' : '#6a6a5a', lit ? '#a8651f' : '#2a2a24'], R: ['#3a3a40', '#1a1a1e'] };
  return artSprite(`lanterna|${lit}`, rows, pal, (c, i) => (c === 'R' ? (i === 1 ? '^' : '=') : c === 'f' ? '*' : c === 'w' ? '|' : '_'), cw, ch, dpr);
}

export function boatSprite(cw: number, ch: number, dpr: number) {
  const rows = ['wwwwwwwww', ' WWWWWWW '];
  const pal: Pal = { w: ['#8a5a32', '#4a2e18'], W: ['#6a4426', '#2e1c0e'] };
  return artSprite('barco', rows, pal, (c, i) => (c === 'w' ? (i === 0 ? '\\' : i === 8 ? '/' : '=') : '_'), cw, ch, dpr);
}

export function millSprite(cw: number, ch: number, dpr: number) {
  // torre de pedra do moinho (as pás giram por cima, desenhadas a cada quadro)
  const rows = ['  rrRRR  ', ' rrrRRRR ', 'rrrrRRRRR', ' SsSsSsS ', ' sSsSsSs ', ' SsSwSsS ', ' sSswsSs ', ' SsSsSsS ', ' sSsSsSs ', ' SsSsSsS ', ' sSsddSs ', ' SsSddsS ', ' sSsddSs ', 'mSsSddsSm'];
  const pal: Pal = { ...STONE, d: ['#3a2818', '#1e140c'], w: ['#ffd27a', '#3a3020'] };
  return artSprite('moinho', rows, pal, (c, i) => (c === 'r' || c === 'R' ? (i < 4 ? '/' : i > 4 ? '\\' : '^') : c === 'd' ? '#' : c === 'w' ? '+' : c === 'm' ? '"' : i % 2 ? '#' : '='), cw, ch, dpr);
}

export function towerSprite(cw: number, ch: number, dpr: number) {
  // torre de vigia de madeira: telhado, plataforma, pernas com travessas em X
  const rows = ['   rRr   ', '  rrRRr  ', ' rrrRRRr ', ' w     w ', ' wwwwwww ', 'WWWWWWWWW', ' w  X  w ', ' w X X w ', ' wX   Xw ', ' w X X w ', ' w  X  w ', ' w X X w ', ' wX   Xw ', ' w     w ', 'mw     wm'];
  const pal: Pal = { ...STONE, W: ['#8a5a32', '#4a2e18'], X: ['#6a4426'] };
  return artSprite('torre', rows, pal, (c, i) => (c === 'r' || c === 'R' ? (i < 4 ? '/' : i > 4 ? '\\' : '^') : c === 'w' ? '|' : c === 'W' ? '=' : c === 'X' ? (i < 4 ? '\\' : '/') : '"'), cw, ch, dpr);
}

export function menhirSprite(v: number, glow: boolean, cw: number, ch: number, dpr: number) {
  const tall = 6 + (v % 3);
  const rows = [' S ', ...Array.from({ length: tall }, (_, j) => (j < tall - 2 ? 'SsS' : 'msm'))];
  const pal: Pal = { ...STONE, s: [glow ? '#9fd8ff' : '#8c8676', '#4a4840'] };
  return artSprite(`menir|${v % 3}|${glow}`, rows, pal, (c, i, j) => (c === 'm' ? '"' : c === 's' ? (glow && j % 2 ? '*' : ':') : i === 0 ? '(' : i === 2 ? ')' : '^'), cw, ch, dpr);
}

export function tentSprite(hue: number, cw: number, ch: number, dpr: number) {
  const rows = ['  ^^  ', ' /AA\\ ', ' /AaA\\ '.slice(0, 6), '/AaaA\\'.slice(0, 6), '/AddA\\'.slice(0, 6), 'AAddAA', 'gAddAg'];
  const pal: Pal = { A: [`hsl(${hue} 45% 62%)`, `hsl(${hue} 45% 32%)`], a: [`hsl(${hue} 45% 52%)`, `hsl(${hue} 45% 26%)`], d: ['#1a120c', '#0c0806'], '^': ['#6a4426'], '/': [`hsl(${hue} 45% 70%)`, `hsl(${hue} 45% 36%)`], '\\': [`hsl(${hue} 45% 50%)`, `hsl(${hue} 45% 26%)`], g: ['#5a9a48'] };
  return artSprite(`barraca|${hue}`, rows, pal, (c) => (c === 'A' || c === 'a' ? '#' : c === 'd' ? ' ' : c === 'g' ? ',' : c), cw, ch, dpr);
}

/** Boca de caverna na pedra: arco escuro com pedras soltas na frente. */
export function caveSprite(cw: number, ch: number, dpr: number) {
  const rows = ['   SSSSS   ', '  SSsssSS  ', ' SSs   sSS ', ' Ss  d  sS ', 'SSs ddd sSS', 'Ss ddddd sS', 'Ss ddddd sS', 'mSsdddddsSm', 'm.s.....s.m'];
  const pal: Pal = { ...STONE, d: ['#0a0a0c', '#050506'], '.': ['#4a4840'] };
  return artSprite('caverna', rows, pal, (c, i) => (c === 'S' ? (i < 5 ? '/' : '\\') : c === 's' ? '#' : c === 'd' ? ' ' : c === 'm' ? '"' : '.'), cw, ch, dpr);
}

/** Templo escondido: antes de 25 stars é só um morro de mato; depois, frontão, colunas e o cristal. */
export function templeSprite(open: boolean, lit: boolean, cw: number, ch: number, dpr: number) {
  const rows = open
    ? ['          b          ', '         bBb         ', '       SSSSSSS       ', '    SSSSSSSSSSSSS    ', '  SSSSSSSSSSSSSSSSS  ', ' sssssssssssssssssss ', '  S   S   S   S   S  ', '  S   S   S   S   S  ', '  S   S   S   S   S  ', 'm S m S   S m S   S m', 'sssssssssssssssssssss']
    : ['                     ', '       mmmmmmm       ', '    mmmmmmmmmmmmm    ', '  mmmmmmmmmmmmmmmmm  ', ' mmmmmmmSmmmmmSmmmmm ', 'mmmmmmmmmmmmmmmmmmmmm'];
  const pal: Pal = { ...STONE, b: lit ? ['#d8c8ff', '#6a4ab8'] : ['#6a6070'], B: lit ? ['#ffffff', '#9a7aff'] : ['#7a7080'] };
  return artSprite(`templo|${open}|${lit}`, rows, pal, (c, i, j) => (c === 'm' ? pick3(i + j) : c === 'S' ? (j < 5 ? (i < 10 ? '/' : '\\') : '|') : c === 's' ? '=' : c === 'b' || c === 'B' ? '*' : '.'), cw, ch, dpr);
}
const pick3 = (n: number) => ['"', ',', ';'][n % 3]!;

/** Quadro de pedidos: moldura de madeira com um papel por pedido aberto (até 6). */
export function boardSprite(n: number, cw: number, ch: number, dpr: number) {
  const k = Math.min(6, n), papers = (row: number) => [...'      '].map((_, i) => (i < k && (i % 2 === row) ? 'p' : ' ')).join('');
  const rows = ['wwwwwwww', `w${papers(0).replace(/ /g, 'o')}w`, `w${papers(1).replace(/ /g, 'o')}w`, 'wwwwwwww', ' w    w ', ' w    w '];
  const pal: Pal = { ...STONE, o: ['#3a2818', '#2a1a0e'], p: ['#2a2420', '#e8e0c8'], w: ['#8a5a32', '#4a2e18'] };
  return artSprite(`quadro|${k}`, rows, pal, (c) => (c === 'w' ? '#' : c === 'p' ? '=' : ' '), cw, ch, dpr);
}

/** Carroça do mercador. */
export function cartSprite(cw: number, ch: number, dpr: number) {
  const rows = ['  yyyyy ', ' yrrrrry', 'wwwwwwww', ' O    O '];
  const pal: Pal = { ...STONE, y: ['#f2c14e', '#8a6420'], r: ['#c43c3c', '#6a1a14'], w: ['#8a5a32', '#4a2e18'], O: ['#3a2818'] };
  return artSprite('carroça', rows, pal, (c) => (c === 'y' ? '~' : c === 'r' ? 'o' : c === 'w' ? '=' : 'O'), cw, ch, dpr);
}

/** Tipos de casa além da cabana: pedra, casa na árvore, palafita e tenda. Mesma largura (3 células). */
const HOUSE_ROWS: Record<number, string[]> = {
  1: ['      cc ', '   RRRcc ', '  RRRRRR ', ' RRRRRRRR', 'RRRRRRRRR', ' SSSSSSS ', ' SwSSSwS ', ' SSSSSSS ', ' SSSdSSS ', ' SSSdSSS '],
  2: ['  lllll  ', ' lllllll ', 'lllRRRlll', 'llRRRRRll', ' lpwppwl ', ' pppdpp  ', ' xxxxxxx ', '   t   h ', '   t   h ', '   t   h ', '  ttt  h '],
  3: ['   RRR   ', '  RRRRR  ', ' RRRRRRR ', 'RRRRRRRRR', ' ppwppwp ', ' pppdppp ', 'xxxxxxxxx', ' x  x  x ', ' x  x  x '],
  4: ['    ^    ', '   fFf   ', '  fFfFf  ', ' fFfFfFf ', 'fFfFfFfFf', 'fFfFdFfFf', 'fFfFdFfFf'],
};
const HOUSE_TALL: Record<number, string[]> = {
  1: ['      cc ', '   RRRcc ', '  RRRRRR ', ' RRRRRRRR', 'RRRRRRRRR', ' SwSSSwS ', ' SSSSSSS ', ' ======= ', ' SwSSSwS ', ' SSSSSSS ', ' SSSdSSS ', ' SSSdSSS '],
};
export function houseVariant(type: number, hue: number, lit: boolean, tall: boolean, cw: number, ch: number, dpr: number) {
  if (type === 0 || !HOUSE_ROWS[type]) return houseSprite(hue, lit, cw, ch, dpr, tall);
  const rows = (tall && HOUSE_TALL[type]) || HOUSE_ROWS[type]!;
  const pal: Pal = {
    R: [`hsl(${hue} 45% 55%)`, `hsl(${hue} 45% 28%)`], S: ['#9a958a', '#55524a'], c: ['#5a5a60', '#2a2a2e'],
    w: lit ? ['#ffd27a', '#a8651f'] : ['#2a3440', '#121820'], d: ['#120c08', '#1a120c'], p: ['#9a6a3a', '#5a3a1e'],
    x: ['#6a4426', '#3a2414'], t: ['#7a5530', '#4a3018'], h: ['#b08a5a'], l: ['#4f8a40', '#2a5226'],
    f: [`hsl(${hue} 50% 70%)`, `hsl(${hue} 45% 40%)`], F: [`hsl(${hue} 50% 58%)`, `hsl(${hue} 45% 30%)`], '^': ['#6a4426'], '=': ['#4a2e18', '#2a1a0e'],
  };
  return artSprite(`casa|${type}|${hue}|${lit}|${tall}`, rows, pal, (c, i, j) => (c === 'R' ? (j % 2 ? '=' : '^') : c === 'S' ? ((i + j) % 2 ? '#' : '=') : c === 'w' ? '#' : c === 'd' ? (j % 2 ? 'n' : '|') : c === 'p' ? '|' : c === 'x' ? (j > 6 ? '|' : '=') : c === 't' ? '|' : c === 'h' ? 'H' : c === 'l' ? ['"', '&', '%'][(i + j) % 3]! : c === 'f' || c === 'F' ? (i < 4 ? '/' : i > 4 ? '\\' : '|') : c === 'c' ? '|' : c), cw, ch, dpr);
}

/* ---------- economia comunitária: celeiro, taverna, galpão, oficina e obras de mutirão ---------- */
const COMMON: Pal = { ...STONE, W: ['#8a5a32', '#4a2e18'], w: ['#6a4426', '#2e1c0e'], d: ['#3a2818', '#1e140c'], h: ['#e8d9a0', '#8a6a30'], l: ['#ffd27a', '#5a3a18'], L: ['#3a3020', '#1a140c'], c: ['#9a9a9a', '#3a3a3a'], k: ['#2a2a2a', '#111'], t: ['#c43c3c', '#6a1a14'] };
const roofCh = (i: number, mid: number) => (i < mid ? '/' : i > mid ? '\\' : '^');

/** Celeiro comum: telhado vermelho de duas águas, porta larga e feno na janela. */
export function granarySprite(cw: number, ch: number, dpr: number) {
  const rows = ['     tt     ', '    tttt    ', '   tttttt   ', '  tttttttt  ', ' tttttttttt ', 'tttttttttttt', ' WhhWWWWhhW ', ' WWWWddWWWW ', ' WWWddddWWW ', ' WWWddddWWW ', 'mWWWddddWWWm'];
  return artSprite('celeiro', rows, COMMON, (c, i) => (c === 't' ? roofCh(i, 6) : c === 'h' ? '"' : c === 'd' ? 'X' : c === 'm' ? '"' : '|'), cw, ch, dpr);
}
/** Taverna: placa pendurada, janelas acesas à noite e chaminé. */
export function tavernSprite(lit: boolean, cw: number, ch: number, dpr: number) {
  const rows = ['        cc  ', '   RRRRRcc  ', '  RRRRRRRRR ', ' RRRRRRRRRRR', 'RRRRRRRRRRRR', ' WWWWWWWWWW ', ' WllWWWWllW ', ' WWWWddWWWW ', 'hWWWWddWWWW ', 'hWWWWddWWWW '];
  const pal: Pal = { ...COMMON, R: ['#764028', '#3e2116'], l: lit ? ['#ffd27a', '#7a5020'] : ['#3a3020', '#1a140c'], h: ['#f2c14e', '#5a3a18'] };
  return artSprite(`taverna|${lit}`, rows, pal, (c, i) => (c === 'R' ? roofCh(i, 6) : c === 'c' ? '#' : c === 'l' ? '+' : c === 'd' ? '#' : c === 'h' ? '@' : '|'), cw, ch, dpr);
}
/** Galpão de ferramentas: telhado baixo e ferramentas penduradas na parede. */
export function shedSprite(cw: number, ch: number, dpr: number) {
  const rows = ['  wwwwwww ', ' wwwwwwwww', ' W c k c W', ' W k c k W', ' W ddddd W', 'mWWWWWWWWm'];
  return artSprite('galpão', rows, COMMON, (c, i) => (c === 'w' ? (i < 5 ? '/' : '\\') : c === 'c' ? 'T' : c === 'k' ? 'Y' : c === 'd' ? '=' : c === 'm' ? '"' : '|'), cw, ch, dpr);
}
/** Oficina: bancada com serrote e tábuas encostadas. */
export function workshopSprite(cw: number, ch: number, dpr: number) {
  const rows = ['  RRRRRR  ', ' RRRRRRRR ', 'W        W', 'W  ccc   W', 'WWWWWWWW W', 'W ww  ww W'];
  const pal: Pal = { ...COMMON, R: ['#5a442a', '#2f2216'] };
  return artSprite('oficina', rows, pal, (c, i) => (c === 'R' ? roofCh(i, 5) : c === 'c' ? '~' : c === 'w' ? '#' : '|'), cw, ch, dpr);
}
/** Forno comunitário de barro com boca acesa. */
export function ovenSprite(lit: boolean, cw: number, ch: number, dpr: number) {
  const rows = ['   SSS   ', '  SSSSS  ', ' SSSSSSS ', ' SSSllSS ', 'SSSSllSSS', 'mSSSSSSSm'];
  const pal: Pal = { ...COMMON, S: ['#c08050', '#6a3a1e'], l: lit ? ['#ffb040', '#a83a10'] : ['#2a1a10', '#140c06'] };
  return artSprite(`forno|${lit}`, rows, pal, (c) => (c === 'l' ? '*' : c === 'm' ? '"' : 'o'), cw, ch, dpr);
}
/** Farol listrado na beira do lago. */
export function lighthouseSprite(lit: boolean, cw: number, ch: number, dpr: number) {
  const rows = ['  rr  ', ' llll ', ' WWWW ', ' tWWt ', ' tttt ', ' WWWW ', ' tttt ', 'WWWWWW', 'tttttt', 'WWWWWW', 'ttdttt', 'SSSSSS'];
  const pal: Pal = { ...COMMON, W: ['#f4efe4', '#c8c0b0'], t: ['#c43c3c', '#7a1a14'], l: lit ? ['#fff4c0', '#d8a020'] : ['#4a4a40', '#2a2a24'], r: ['#3a3a40', '#1a1a1e'] };
  return artSprite(`farol|${lit}`, rows, pal, (c) => (c === 'l' ? '*' : c === 'r' ? '^' : c === 'd' ? '#' : c === 'S' ? '=' : '|'), cw, ch, dpr);
}
/** Coreto: telhado octogonal sobre colunas, para os músicos. */
export function bandstandSprite(cw: number, ch: number, dpr: number) {
  const rows = ['    RR    ', '  RRRRRR  ', ' RRRRRRRR ', 'RRRRRRRRRR', ' W  W  W  ', ' W  W  W  ', ' W  W  W  ', 'SSSSSSSSSS'];
  const pal: Pal = { ...COMMON, R: ['#2f7f6a', '#174a3c'], W: ['#f4efe4'] };
  return artSprite('coreto', rows, pal, (c, i) => (c === 'R' ? roofCh(i, 5) : c === 'W' ? '|' : '='), cw, ch, dpr);
}
/** Terreno marcado para a próxima obra: estacas, corda e plaquinha. */
export function siteSprite(cw: number, ch: number, dpr: number) {
  const rows = ['   hhh   ', '   h h   ', 'w   w   w', 'w---w---w', 'w   w   w'];
  const pal: Pal = { ...COMMON, h: ['#e8d9a0', '#5a3a18'], '-': ['#c8b080'] };
  return artSprite('terreno', rows, pal, (c) => (c === 'w' ? '|' : c === 'h' ? '=' : '-'), cw, ch, dpr);
}
/** Andaime do mutirão em andamento. */
export function scaffoldSprite(cw: number, ch: number, dpr: number) {
  const rows = ['w=w=w=w=w', 'wX wX wXw', 'w=w=w=w=w', 'w Xw Xw w', 'w=w=w=w=w', 'pppw wppp'];
  const pal: Pal = { ...COMMON, '=': ['#a07040'], X: ['#6a4426'], p: ['#8c8676', '#4a4840'] };
  return artSprite('andaime', rows, pal, (c, i) => (c === 'w' ? '|' : c === '=' ? '=' : c === 'X' ? (i % 2 ? '/' : '\\') : '#'), cw, ch, dpr);
}
