import { COLS, ROWS, Tile } from './constants';
import type { Terrain } from './world';

/**
 * Obras coletivas: cada uma tem uma meta de stars. O estado da vila é só uma função de quantos
 * moradores já chegaram, então todo navegador calcula a mesma vila sem guardar nada.
 */
export type StructKind = 'poço' | 'lanternas' | 'mercado' | 'píer' | 'jardim' | 'estátua';
export interface Structure { kind: StructKind; need: number; x: number; y: number; cells: number[]; built: boolean; builtAt: number }

export const NEEDS: [StructKind, number][] = [['poço', 1], ['lanternas', 3], ['mercado', 5], ['píer', 8], ['jardim', 12], ['estátua', 16]];

/** A cada quantas stars uma coluna caída ou quebrada é restaurada (depois da segunda star). */
export const STARS_PER_COLUMN = 2;

const free = (t: Terrain, i: number) => (t.T[i] === Tile.Grass || t.T[i] === Tile.Forest || t.T[i] === Tile.Floor) && !t.block[i] && t.comp[i];

/** Procura em espiral a partir de (x, y) um lugar onde todas as células `w` x 1 estejam livres. */
function near(t: Terrain, x: number, y: number, w: number): [number, number] | null {
  for (let r = 0; r < 12; r++) for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
    if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
    const px = x + dx, py = y + dy;
    if (px < 2 || py < 3 || px + w >= COLS - 2 || py >= ROWS - 2) continue;
    let ok = true;
    for (let k = 0; k < w && ok; k++) if (!free(t, py * COLS + px + k) || !free(t, (py - 1) * COLS + px + k)) ok = false;
    if (ok) return [px, py];
  }
  return null;
}

export function planVillage(t: Terrain): Structure[] {
  const a = t.agora, out: Structure[] = [];
  const add = (kind: StructKind, x: number, y: number, cells: number[]) => out.push({ kind, need: NEEDS.find(n => n[0] === kind)![1], x, y, cells, built: false, builtAt: -1 });
  t.clearTrees(a.x - 12, a.y + Math.ceil(a.ry) + 1, a.x - 2, a.y + Math.ceil(a.ry) + 8);
  const well = near(t, a.x - 6, a.y + Math.ceil(a.ry) + 4, 1);
  if (well) add('poço', well[0], well[1], [well[1] * COLS + well[0]]);
  // lanternas: 8 postes em volta da ágora (não bloqueiam, só iluminam)
  add('lanternas', a.x, a.y, []);
  // mercado numa clareira a sudeste da escadaria, à vista de quem chega
  t.clearTrees(a.x + 3, a.y + Math.ceil(a.ry) + 1, a.x + 18, a.y + Math.ceil(a.ry) + 9);
  const mk = near(t, a.x + 7, a.y + Math.ceil(a.ry) + 6, 3);
  if (mk) add('mercado', mk[0], mk[1], [0, 1, 2].map(k => mk[1] * COLS + mk[0] + k));
  // píer: margem caminhável mais perto da ágora, avançando 4 células na água
  let best = -1, bd = Infinity, dir: [number, number] = [0, 1];
  for (let y = 2; y < ROWS - 2; y++) for (let x = 2; x < COLS - 2; x++) {
    const i = y * COLS + x;
    if (!free(t, i) || t.T[i] === Tile.Floor) continue;
    for (const [dx, dy] of [[0, 1], [1, 0], [-1, 0], [0, -1]] as const) {
      let ok = true;
      for (let k = 1; k <= 4 && ok; k++) { const j = (y + dy * k) * COLS + x + dx * k; if (y + dy * k >= ROWS || t.T[j]! > Tile.Shallow) ok = false; }
      if (!ok) continue;
      const d = Math.hypot(x - a.x, (y - a.y) * 2);
      if (d < bd) { bd = d; best = i; dir = [dx, dy]; }
    }
  }
  if (best >= 0) {
    const x = best % COLS, y = (best / COLS) | 0;
    add('píer', x, y, [1, 2, 3, 4].map(k => (y + dir[1] * k) * COLS + x + dir[0] * k));
  }
  if (well) add('jardim', well[0], well[1], []);
  add('estátua', a.x, a.y - 3, [(a.y - 3) * COLS + a.x]);
  return out;
}

/** Posições dos postes de lanterna em volta da ágora. */
export function lanternSpots(t: Terrain): [number, number][] {
  const a = t.agora, out: [number, number][] = [];
  for (let k = 0; k < 8; k++) {
    const ang = (k / 8) * Math.PI * 2 + Math.PI / 8;
    out.push([Math.round(a.x + Math.cos(ang) * (a.rx + 2)), Math.round(a.y + Math.sin(ang) * (a.ry + 1.2))]);
  }
  return out;
}
