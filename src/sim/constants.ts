export const COLS = 384;
export const ROWS = 112;
export const N = COLS * ROWS;
/** 1 tick = 0,5 s de relógio real. */
export const TICK_MS = 500;
export const TICKS_PER_HOUR = 3_600_000 / TICK_MS;
export const DAY_MS = 86_400_000;

/** Tipos de célula. */
export const Tile = { Deep: 0, Shallow: 1, Sand: 2, Grass: 3, Forest: 4, Rock: 5, Wall: 6, Floor: 7, Stream: 8 } as const;
/** o riacho é raso: dá para atravessar a vau */
export const WALKABLE = new Uint8Array([0, 0, 1, 1, 1, 0, 0, 1, 1]);

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
/** Profissão sai do hash do login: muda a rotina e o item que o morador carrega. */
/** Instrumentos dos músicos e bichos de estimação (sorteados pelo login). */
export const INSTRUMENTS = ['alaúde', 'flauta', 'tambor', 'harpa', 'gaita'] as const;
export const PETS = ['cachorro', 'gato', 'galinha', 'pato', 'sapo'] as const;
export const PET_NAMES = ['Pipoca', 'Farofa', 'Paçoca', 'Biscoito', 'Tico', 'Nina', 'Bolota', 'Pitoco', 'Mel', 'Jujuba', 'Fubá', 'Cacau', 'Pingo', 'Luna', 'Toddy', 'Banzé'];
/** Tipos de casa: o login escolhe, o terreno dá a palavra final (palafita só perto da água). */
export const HOUSES = ['cabana', 'casa de pedra', 'casa na árvore', 'palafita', 'tenda'] as const;
export const PROFS = ['lenhador', 'pescador', 'músico', 'jardineiro', 'explorador', 'minerador'] as const;
export type Prof = (typeof PROFS)[number];
