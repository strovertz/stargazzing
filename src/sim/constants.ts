export const COLS = 320;
export const ROWS = 96;
export const N = COLS * ROWS;
/** 1 tick = 0,5 s de relógio real. */
export const TICK_MS = 500;
export const TICKS_PER_HOUR = 3_600_000 / TICK_MS;
export const DAY_MS = 86_400_000;

/** Tipos de célula. */
export const Tile = { Deep: 0, Shallow: 1, Sand: 2, Grass: 3, Forest: 4, Rock: 5, Wall: 6, Floor: 7 } as const;
export const WALKABLE = new Uint8Array([0, 0, 1, 1, 1, 0, 0, 1]);

export const DIR4: ReadonlyArray<readonly [number, number]> = [[0, -1], [1, 0], [0, 1], [-1, 0]];
export const DIR8: ReadonlyArray<readonly [number, number]> = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [-1, 1], [1, -1], [-1, -1]];

export interface Species { n: string; g: string; col: [string, string] }
export const SPECIES: Species[] = [
  { n: 'carvalho', g: '♣', col: ['#5fbf62', '#3f9a4a'] },
  { n: 'pinheiro', g: '▲', col: ['#3fae7c', '#2b8460'] },
  { n: 'ipê-amarelo', g: '✿', col: ['#f4cf45', '#e2a92c'] },
  { n: 'jacarandá', g: '*', col: ['#b78af0', '#8f66d6'] },
];
export const WILD: Species = { n: 'mata', g: '♣', col: ['#2e7a44', '#22603a'] };
export const FLOWERS = ['#f07aa8', '#fadc5a', '#b89cff', '#ffffff', '#ff9a5a'];
export const RUINS: string[][] = [
  ['n_n_ _ _n_n', '|#|     |#|', '|#|  .  |#|', '|_|.   .|_|'],
  ['n_ _n', ' |#| ', ' |_| '],
  [' _n_ ', '|# #|', '|_ _|'],
];

export const SKIN = ['#f6d0a2', '#e8b17f', '#c98a55', '#9a6239', '#6e4325', '#f1c6b0'];
export const HAIR = ['#2b1b0e', '#5a3825', '#d8b66e', '#b5523b', '#151515', '#e6e6e6', '#7a4ea3', '#2f7f8f'];
export const PANTS = ['#2d3a5a', '#3b2f2f', '#2f4a3a', '#4a3b5c', '#4c4c52', '#5a4630'];
export const HATS = ['cap', 'beanie', 'wizard', 'crown', 'flower', 'none', 'band'] as const;
export type Hat = (typeof HATS)[number];
/** A cabana fica centrada em home.x - HOUSE_DX e ocupa 3 células (home.x-3..home.x-1), duas linhas de fundo. */
export const HOUSE_DX = 2;
