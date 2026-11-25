import { h32 } from '../core/rng';
import { COLS, ROWS, Tile } from '../sim/constants';
import type { Simulation } from '../sim/simulation';

/**
 * Bichos só de enfeite, calculados a partir do tempo (iguais para todos):
 * coelhos de dia na grama, raposas no fim de tarde e à noite na mata, um gato que segue um morador.
 * Fogem de quem chega perto.
 */
const ART: Record<string, string[]> = {
  coelho: ['.w.w.', '.www.', 'wwwww', '.w.w.'],
  raposa: ['o...o..', 'ooooo..', '.oooooW', '.o..o..'],
  gato: ['k.k..', 'kkk..', 'kkkkk', 'k..k.'],
};
const COLORS: Record<string, Record<string, string>> = {
  coelho: { w: '#d8d2c4' },
  raposa: { o: '#d06a28', W: '#f4efe4' },
  gato: { k: '#2a2a30' },
};
const sprites = new Map<string, HTMLCanvasElement>();
function art(kind: string): HTMLCanvasElement {
  let c = sprites.get(kind);
  if (c) return c;
  const rows = ART[kind]!;
  c = document.createElement('canvas');
  c.width = rows[0]!.length; c.height = rows.length;
  const g = c.getContext('2d')!;
  rows.forEach((r, y) => [...r].forEach((ch, x) => { const col = COLORS[kind]![ch]; if (col) { g.fillStyle = col; g.fillRect(x, y, 1, 1); } }));
  sprites.set(kind, c);
  return c;
}

interface Den { kind: 'coelho' | 'raposa'; x: number; y: number; k: number }
const dens = new WeakMap<Simulation, Den[]>();
function densFor(sim: Simulation): Den[] {
  let d = dens.get(sim);
  if (d) return d;
  d = [];
  const { T, block, seed } = sim.terrain;
  for (let k = 0; k < 4000 && d.length < 26; k++) {
    const x = 4 + (h32(k, 1, seed) % (COLS - 8)), y = 4 + (h32(k, 2, seed) % (ROWS - 8)), i = y * COLS + x;
    if (block[i]) continue;
    if (T[i] === Tile.Grass && d.filter(q => q.kind === 'coelho').length < 18) d.push({ kind: 'coelho', x, y, k });
    else if (T[i] === Tile.Forest && d.filter(q => q.kind === 'raposa').length < 8) d.push({ kind: 'raposa', x, y, k });
  }
  dens.set(sim, d);
  return d;
}

export interface View { sx: (x: number) => number; sy: (y: number) => number; inV: (x: number, y: number) => boolean; cs: number; ch: number; z: number }

export function drawAnimals(g: CanvasRenderingContext2D, sim: Simulation, v: View, ts: number, L: number, people: { x: number; y: number }[]): void {
  if (v.z < 0.65) return;
  const { noise } = sim.terrain, px = v.z * 2;
  for (const d of densFor(sim)) {
    const awake = d.kind === 'coelho' ? L > 0.5 : L < 0.7;
    if (!awake || !v.inV(d.x, d.y)) continue;
    const r = d.kind === 'coelho' ? 4 : 7, sp = d.kind === 'coelho' ? 0.05 : 0.03;
    let x = d.x + noise(ts * sp + d.k, d.k * 1.7, 3.3) * r * 2, y = d.y + noise(d.k * 2.3, ts * sp + d.k, 5.1) * r;
    // fuga: empurrados para longe de quem estiver a menos de 5 células
    for (const p of people) {
      const dx = x - p.x, dy = (y - p.y) * 2, dist = Math.hypot(dx, dy);
      if (dist < 5 && dist > 0.01) { const push = ((5 - dist) / 5) * 4; x += (dx / dist) * push; y += (dy / dist) * push * 0.5; }
    }
    const hop = d.kind === 'coelho' ? Math.abs(Math.sin(ts * 5 + d.k)) * 3 * px * 0.5 : 0;
    const face = Math.sin(ts * sp * 6 + d.k) > 0 ? 1 : -1, c = art(d.kind);
    g.save(); g.translate(v.sx(x), v.sy(y) - c.height * px - hop); if (face < 0) g.scale(-1, 1);
    g.drawImage(c, -(c.width * px) / 2, 0, c.width * px, c.height * px); g.restore();
  }
}

/** Gato do dia: segue um morador escolhido pela data, alguns passos atrás. */
export function drawCat(g: CanvasRenderingContext2D, sim: Simulation, v: View, ts: number, pos: (i: number) => { x: number; y: number; face: number } | null): void {
  if (v.z < 0.65) return;
  const present = sim.agents.filter(a => a.present);
  if (!present.length) return;
  const idx = sim.agents.indexOf(present[h32(Math.floor(sim.genesis / 86_400_000), 3, sim.terrain.seed) % present.length]!);
  const p = pos(idx);
  if (!p || !v.inV(p.x, p.y)) return;
  const x = p.x - p.face * 1.3 + Math.sin(ts * 0.8) * 0.3, y = p.y + 0.4, c = art('gato'), px = v.z * 2;
  g.save(); g.translate(v.sx(x), v.sy(y) - c.height * px); if (p.face < 0) g.scale(-1, 1);
  g.drawImage(c, -(c.width * px) / 2, 0, c.width * px, c.height * px); g.restore();
}
