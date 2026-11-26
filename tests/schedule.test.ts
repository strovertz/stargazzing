import { describe, expect, it } from 'vitest';
import world from './fixtures/world.demo.json';
import { genesisFor, Simulation } from '../src/sim/simulation';
import { DAY_MS, TICKS_PER_HOUR } from '../src/sim/constants';
import type { WorldFile } from '../src/sim/types';

const W = world as WorldFile;

describe('agenda', () => {
  it('compromissos marcados acontecem: sem tempestade e com a vila na ágora', () => {
    let checked = 0;
    for (let d = 0; d < 7; d++) {
      const s = new Simulation(W, genesisFor(Date.UTC(2026, 10, 23, 15) + d * DAY_MS, W.timezoneOffsetHours));
      for (const e of s.agenda.filter(x => x.call)) {
        expect(s.weather(e.from).storm).toBe(false);
        s.runUntil(e.from + TICKS_PER_HOUR / 4);
        const p = s.agents.filter(a => a.present);
        if (!p.length) continue;
        expect(p.filter(a => a.state === (e.site ? 'BUILD' : 'AGORA')).length / p.length).toBeGreaterThan(0.6);
        checked++;
      }
    }
    expect(checked).toBeGreaterThanOrEqual(2); // conselho de quarta e vaga-lumes de sexta
  }, 120_000);
});
