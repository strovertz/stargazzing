import { COLS, DAY_MS, Tile } from '../sim/constants';
import { h32, fnv } from '../core/rng';
import type { Simulation } from '../sim/simulation';
import type { Agent } from '../sim/types';

/**
 * O visitante também participa, mas só no próprio navegador (localStorage): a vila compartilhada
 * continua determinística e igual para todo mundo. Nada disso sai do aparelho.
 */
const get = (k: string): string | null => { try { return localStorage.getItem(k); } catch { return null; } };
const put = (k: string, v: string): void => { try { localStorage.setItem(k, v); } catch { /* modo privado */ } };

export const OFFERINGS = ['um pão', 'uma flor', 'um punhado de sementes', 'um peixe', 'uma canção', 'um desenho'];

export interface LocalEntry { ms: number; text: string }
interface Plant { x: number; y: number; ms: number }
interface Note { text: string; ms: number; readMs?: number; by?: string }

export class Visitor {
  constructor(private toast: (t: string) => void) {}

  /** entradas do diário só deste navegador (oferenda, bilhete lido) para o dia de hoje */
  entries(genesis: number): LocalEntry[] {
    try { return (JSON.parse(get(`diarioLocal:${genesis}`) ?? '[]') as LocalEntry[]).filter(e => typeof e.text === 'string'); } catch { return []; }
  }
  private add(genesis: number, text: string): void {
    const list = this.entries(genesis);
    list.push({ ms: Date.now(), text });
    put(`diarioLocal:${genesis}`, JSON.stringify(list.slice(-20)));
  }

  offeredToday(genesis: number): string | null { return get(`oferenda:${genesis}`); }
  offer(sim: Simulation, what: string): void {
    if (this.offeredToday(sim.genesis) || !OFFERINGS.includes(what)) return;
    put(`oferenda:${sim.genesis}`, what);
    const pres = sim.agents.filter(a => a.present);
    const who = pres.length ? pres[h32(Math.floor(sim.genesis / DAY_MS), fnv(what), 5) % pres.length]!.name : 'A vila';
    const text = `Um visitante deixou ${what} no celeiro comum. ${who} agradeceu em nome da vila`;
    this.add(sim.genesis, text);
    this.toast(`${text}. ♥`);
  }

  plant(): Plant | null {
    try { const p = JSON.parse(get('plantinha') ?? 'null') as Plant | null; return p && Number.isFinite(p.x) && Number.isFinite(p.y) ? p : null; } catch { return null; }
  }
  /** estágio da plantinha pelo tempo real: broto, muda, flor e moita florida em ~3 dias */
  plantStage(ms = Date.now()): number { const p = this.plant(); if (!p) return 0; const h = (ms - p.ms) / 3_600_000; return h < 2 ? 0 : h < 24 ? 1 : h < 72 ? 2 : 3; }
  canPlant(sim: Simulation, x: number, y: number): boolean {
    if (x < 1 || y < 1 || x >= COLS - 1) return false;
    const i = y * COLS + x;
    return (sim.terrain.T[i] === Tile.Grass || sim.terrain.T[i] === Tile.Forest) && sim.terrain.passable(i);
  }
  setPlant(sim: Simulation, x: number, y: number): boolean {
    if (!this.canPlant(sim, x, y)) return false;
    put('plantinha', JSON.stringify({ x, y, ms: Date.now() }));
    this.add(sim.genesis, 'Você plantou uma semente na vila. Ela cresce no seu navegador, dia após dia');
    return true;
  }

  note(): Note | null { try { const n = JSON.parse(get('bilhete') ?? 'null') as Note | null; return n && typeof n.text === 'string' ? n : null; } catch { return null; } }
  writeNote(text: string): void {
    const t = text.replace(/\s+/g, ' ').trim().slice(0, 140);
    if (!t) return;
    put('bilhete', JSON.stringify({ text: t, ms: Date.now() }));
  }
  /** À noite, alguém da roda da fogueira lê o bilhete (uma vez). Devolve quem leu. */
  readAtFire(sim: Simulation, hour: number): Agent | null {
    const n = this.note();
    if (!n || n.readMs || !(hour >= 18.5 || hour < 1)) return null;
    const ring = sim.agents.filter(a => a.present && a.state === 'GATHER' && a.phase === 'boid');
    if (!ring.length) return null;
    const a = ring[fnv(n.text) % ring.length]!;
    n.readMs = Date.now(); n.by = a.name;
    put('bilhete', JSON.stringify(n));
    this.add(sim.genesis, `Na roda da fogueira, ${a.name} leu em voz alta o seu bilhete: "${n.text}"`);
    return a;
  }
}
