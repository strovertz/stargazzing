import type { Look } from '../sim/types';

/** Pixel art do morador em texto (8x14), sem DOM: o canvas e os cartões SVG desenham a partir daqui. */
const BODY = ['..hhhh..', '.hhhhhh.', '.hssssh.', '.sesses.', '..ssss..', '.tttttt.', 'stttttts', '.tttttt.', '..pppp..'];
export const LEGS = { stand: ['..p..p..', '.bb..bb.'], step: ['.p....p.', 'bb....bb'] };
const HATROWS: Record<Look['hat'], string[]> = {
  cap: ['........', '..HHHH..', '.HHHHHHH'],
  beanie: ['...HH...', '..HHHH..', '.HHHHHH.'],
  wizard: ['....H...', '...HHH..', '.HHHHHH.'],
  crown: ['........', '.H.HH.H.', '.HHHHHH.'],
  flower: ['........', '......F.', '.....FHF'],
  none: ['........', '........', '..h.hh..'],
  band: ['........', '........', '........'],
};

export function palette(L: Look): Record<string, string> {
  return { h: L.hair, s: L.skin, e: '#151515', t: L.shirt, p: L.pants, b: '#1d1916', H: L.hat === 'crown' ? '#f2c14e' : L.hatc, F: '#ff86b4' };
}

export function spriteRows(L: Look, frame: 'stand' | 'step' | 'sleep'): string[] {
  const sleep = frame === 'sleep';
  return [
    ...HATROWS[L.hat],
    ...BODY.map((r, i) => (L.hat === 'band' && i === 1 ? '.HHHHHH.' : sleep && i === 3 ? '.ssssss.' : L.beard && i === 4 ? '..hhhh..' : r)),
    ...LEGS[frame === 'step' ? 'step' : 'stand'],
  ];
}
