import { describe, expect, it } from 'vitest';
import world from './fixtures/world.demo.json';
import { fnv } from '../src/core/rng';
import { genesisFor, Simulation } from '../src/sim/simulation';
import { encode, restore } from '../src/sim/snapshot';
import type { WorldFile } from '../src/sim/types';

const W = world as WorldFile;
const G = genesisFor(Date.UTC(2026, 10, 24, 15, 0), W.timezoneOffsetHours);
const logHash = (s: Simulation) => fnv(s.log.map(l => `${l.tick}${l.text}`).join('|'));

describe('checkpoint', () => {
  it('retomar de uma foto chega exatamente ao mesmo estado', () => {
    const a = new Simulation(W, G); a.runUntil(40_000);
    const b = new Simulation(W, G); b.runUntil(15_000);
    const snap = structuredClone(encode(b, 'k'));
    const c = new Simulation(W, G); restore(c, snap);
    expect(c.tick).toBe(15_000);
    c.runUntil(40_000);
    expect(c.stateHash()).toBe(a.stateHash());
    expect(logHash(c)).toBe(logHash(a));
    expect(encode(c, 'k')).toEqual(encode(a, 'k'));
  });
});
