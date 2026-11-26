import { describe, expect, it } from 'vitest';
import world from './fixtures/world.demo.json';
import { genesisFor, Simulation } from '../src/sim/simulation';
import { ledger, PROJECTS } from '../src/sim/commons';
import { boardNews } from '../src/sim/talk';
import { DAY_MS, TICKS_PER_HOUR } from '../src/sim/constants';
import type { WorldFile } from '../src/sim/types';

const W = world as WorldFile;

describe('economia comunitária', () => {
  it('a conta dos materiais marca as obras em ordem e é a mesma toda vez', () => {
    const res = Array.from({ length: 30 }, (_, i) => ({ day: 100 + (i % 6), prof: i % 9 }));
    const a = ledger(res, 104), b = ledger(res, 104);
    expect(a).toEqual(b);
    const days = a.days.filter((d): d is number => d !== null);
    expect(days).toEqual([...days].sort((p, q) => p - q));
    expect(a.lenha).toBeGreaterThanOrEqual(0);
  });
  it('celeiro nunca fica negativo, mutirão constrói a obra e o quadro monta', () => {
    for (let d = 0; d < 5; d++) {
      const s = new Simulation(W, genesisFor(Date.UTC(2026, 10, 23, 15) + d * DAY_MS, W.timezoneOffsetHours));
      expect(s.projects.length).toBe(PROJECTS.length);
      s.runUntil(Math.round(23.9 * TICKS_PER_HOUR));
      for (const v of Object.values(s.stock)) expect(v).toBeGreaterThanOrEqual(0);
      expect(s.toolsOut).toBeGreaterThanOrEqual(0);
      expect(s.toolsOut).toBeLessThanOrEqual(s.toolsTotal);
      const mt = s.mutiraoToday();
      if (mt) expect(s.projectBuilt(mt)).toBe(true);
      const n = boardNews(s);
      expect(n.agenda.length).toBeGreaterThan(0);
      expect(n.granary.length).toBe(8);
      expect(JSON.stringify(n)).not.toMatch(/\$|R\$|moeda/);
    }
  }, 200_000);
});
