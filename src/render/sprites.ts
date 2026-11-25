import type { Look } from '../sim/types';
import { palette, spriteRows } from './pixels';

export interface SpriteSet { stand: HTMLCanvasElement; step: HTMLCanvasElement; sleep: HTMLCanvasElement }

/** Sprite 8x14 em pixel art, montado a partir da aparência sorteada pelo login. */
export function buildSprites(L: Look): SpriteSet {
  const pal = palette(L);
  const make = (frame: 'stand' | 'step' | 'sleep') => {
    const c = document.createElement('canvas');
    c.width = 8; c.height = 14;
    const x = c.getContext('2d')!;
    spriteRows(L, frame).forEach((r, y) => [...r].forEach((ch, xx) => { const col = pal[ch]; if (col) { x.fillStyle = col; x.fillRect(xx, y, 1, 1); } }));
    return c;
  };
  return { stand: make('stand'), step: make('step'), sleep: make('sleep') };
}
const cache = new Map<string, SpriteSet>();
export function spritesFor(name: string, look: Look): SpriteSet {
  let s = cache.get(name);
  if (!s) { s = buildSprites(look); cache.set(name, s); }
  return s;
}

/** Item da profissão, 4x9 pixels, segurado do lado da mão (lenhador, pescador, músico, jardineiro, explorador, minerador). */
const TOOLS: string[][] = [
  ['.GG.', 'GGGw', '.Gw.', '..w.', '..w.', '..w.', '..w.', '....', '....'],
  ['...w', '...w', '..w.', '..w.', '.w..', '.w..', 'w...', '....', '....'],
  ['.w..', '.w..', '.w..', 'wBBw', 'BBBB', 'BbBB', 'BBBB', '.BB.', '....'],
  ['....', '....', '....', 'G...', '.GGG', 'GGGG', 'GGGG', '.GG.', '....'],
  ['....', '....', '....', 'PPP.', 'PpPP', 'PPPP', 'PPPP', '....', '....'],
  ['GGG.', 'G.wG', '..w.', '..w.', '..w.', '..w.', '..w.', '....', '....'],
  // agricultor: enxada com feixe de trigo
  ['GG.S', '.wSS', '.wS.', '.w..', '.w..', '.w..', '.w..', '....', '....'],
  // padeiro: pá de forno com pão
  ['.BB.', 'BppB', '.BB.', '.w..', '.w..', '.w..', '.w..', '....', '....'],
  // carteiro: bolsa de cartas
  ['....', '....', '..w.', '.w..', 'PPPP', 'PFFP', 'PFFP', 'PPPP', '....'],
];
/** Instrumentos do músico (alaúde, flauta, tambor, harpa, gaita), no mesmo tamanho dos itens. */
const INSTR: string[][] = [
  TOOLS[2]!,
  ['...w', '...F', '..w.', '..F.', '.w..', '.F..', 'w...', '....', '....'],
  ['....', '....', '....', 'RRRR', 'DDDD', 'RRRR', 'DDDD', 'RRRR', '....'],
  ['wwww', 'wSSw', 'w.Sw', 'wSSw', 'w.Sw', 'wSSw', 'w..w', 'wwww', '....'],
  ['....', '....', '....', '....', 'GGGG', 'MMMM', '....', '....', '....'],
];
const TPAL: Record<string, string> = { G: '#9a9aa4', w: '#7a5530', B: '#b07a3c', b: '#3a2410', P: '#6a5030', p: '#c9a86a', F: '#e8dcc0', R: '#c43c3c', D: '#e8d9b0', S: '#f2c14e', M: '#4a4a52' };
const toolCache = new Map<string, HTMLCanvasElement>();
export function toolSprite(prof: number, inst = 0): HTMLCanvasElement {
  const key = `${prof}|${prof === 2 ? inst : 0}`;
  let c = toolCache.get(key);
  if (c) return c;
  c = document.createElement('canvas');
  c.width = 4; c.height = 9;
  const x = c.getContext('2d')!;
  (prof === 2 ? INSTR[inst]! : TOOLS[prof]!).forEach((r, y) => [...r].forEach((ch, xx) => { const col = TPAL[ch]; if (col) { x.fillStyle = col; x.fillRect(xx, y, 1, 1); } }));
  toolCache.set(key, c);
  return c;
}
