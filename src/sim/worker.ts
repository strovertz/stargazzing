import { Simulation } from './simulation';
import { encode, restore, type Snapshot } from './snapshot';
import type { WorldFile } from './types';

/** Refaz o dia fora da thread principal: a página continua respondendo enquanto o mundo é recalculado. */
export interface ReplayJob { world: WorldFile; genesis: number; target: number; key: string; from?: Snapshot }
export type ReplayMsg = { kind: 'progress'; tick: number } | { kind: 'done'; snap: Snapshot };

(self as unknown as { onmessage: (e: MessageEvent<ReplayJob>) => void }).onmessage = e => {
  const { world, genesis, target, key, from } = e.data;
  const sim = new Simulation(world, genesis);
  if (from) restore(sim, from);
  while (sim.tick < target) {
    sim.runUntil(Math.min(target, sim.tick + 6000));
    (self as unknown as Worker).postMessage({ kind: 'progress', tick: sim.tick } satisfies ReplayMsg);
  }
  (self as unknown as Worker).postMessage({ kind: 'done', snap: encode(sim, key) } satisfies ReplayMsg);
};
