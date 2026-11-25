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
];
const TPAL: Record<string, string> = { G: '#9a9aa4', w: '#7a5530', B: '#b07a3c', b: '#3a2410', P: '#6a5030', p: '#c9a86a' };
const toolCache = new Map<number, HTMLCanvasElement>();
export function toolSprite(prof: number): HTMLCanvasElement {
  let c = toolCache.get(prof);
  if (c) return c;
  c = document.createElement('canvas');
  c.width = 4; c.height = 9;
  const x = c.getContext('2d')!;
  TOOLS[prof]!.forEach((r, y) => [...r].forEach((ch, xx) => { const col = TPAL[ch]; if (col) { x.fillStyle = col; x.fillRect(xx, y, 1, 1); } }));
  toolCache.set(prof, c);
  return c;
}
