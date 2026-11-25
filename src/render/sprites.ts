import type { Look } from '../sim/types';

export interface SpriteSet { stand: HTMLCanvasElement; step: HTMLCanvasElement; sleep: HTMLCanvasElement }

const BODY = ['..hhhh..', '.hhhhhh.', '.hssssh.', '.sesses.', '..ssss..', '.tttttt.', 'stttttts', '.tttttt.', '..pppp..'];
const LEGS = { stand: ['..p..p..', '.bb..bb.'], step: ['.p....p.', 'bb....bb'] };
const HATROWS: Record<Look['hat'], string[]> = {
  cap: ['........', '..HHHH..', '.HHHHHHH'],
  beanie: ['...HH...', '..HHHH..', '.HHHHHH.'],
  wizard: ['....H...', '...HHH..', '.HHHHHH.'],
  crown: ['........', '.H.HH.H.', '.HHHHHH.'],
  flower: ['........', '......F.', '.....FHF'],
  none: ['........', '........', '..h.hh..'],
  band: ['........', '........', '........'],
};

/** Sprite 8x14 em pixel art, montado a partir da aparência sorteada pelo login. */
export function buildSprites(L: Look): SpriteSet {
  const pal: Record<string, string> = { h: L.hair, s: L.skin, e: '#151515', t: L.shirt, p: L.pants, b: '#1d1916', H: L.hat === 'crown' ? '#f2c14e' : L.hatc, F: '#ff86b4' };
  const make = (legs: string[], sleep = false) => {
    const rows = [...HATROWS[L.hat], ...BODY.map((r, i) => (L.hat === 'band' && i === 1 ? '.HHHHHH.' : sleep && i === 3 ? '.ssssss.' : r)), ...legs];
    const c = document.createElement('canvas');
    c.width = 8; c.height = 14;
    const x = c.getContext('2d')!;
    rows.forEach((r, y) => [...r].forEach((ch, xx) => { const col = pal[ch]; if (col) { x.fillStyle = col; x.fillRect(xx, y, 1, 1); } }));
    return c;
  };
  return { stand: make(LEGS.stand), step: make(LEGS.step), sleep: make(LEGS.stand, true) };
}

const cache = new Map<string, SpriteSet>();
export function spritesFor(name: string, look: Look): SpriteSet {
  let s = cache.get(name);
  if (!s) { s = buildSprites(look); cache.set(name, s); }
  return s;
}
