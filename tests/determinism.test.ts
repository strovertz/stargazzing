import { describe, expect, it } from 'vitest';
import world from './fixtures/world.demo.json';
import { genesisFor, Simulation } from '../src/sim/simulation';
import type { WorldFile } from '../src/sim/types';

const W = world as WorldFile;
const GENESIS = genesisFor(Date.UTC(2026, 10, 24, 15, 0), W.timezoneOffsetHours);

function run(ticks: number, w: WorldFile = W): Simulation {
  const s = new Simulation(w, GENESIS);
  s.runUntil(ticks);
  return s;
}

describe('simulação determinística', () => {
  it('a mesma entrada chega ao mesmo estado', () => {
    expect(run(20_000).stateHash()).toBe(run(20_000).stateHash());
  });

  it('simular em pedaços dá o mesmo resultado que de uma vez', () => {
    const a = new Simulation(W, GENESIS);
    for (let t = 1000; t <= 20_000; t += 1000) a.runUntil(t, 7_000);
    expect(a.stateHash()).toBe(run(20_000).stateHash());
  });

  it('o estado muda com o tempo', () => {
    expect(run(5_000).stateHash()).not.toBe(run(6_000).stateHash());
  });

  it('a ordem do world.json não importa', () => {
    const shuffled: WorldFile = { ...W, stargazers: [...W.stargazers].reverse() };
    expect(run(10_000, shuffled).stateHash()).toBe(run(10_000).stateHash());
  });

  it('meia-noite do mundo segue o fuso fixo', () => {
    // 24/11/2026 15:00 UTC = 12:00 em São Paulo; a meia-noite local é 03:00 UTC
    expect(new Date(GENESIS).toISOString()).toBe('2026-11-24T03:00:00.000Z');
  });
});

describe('identidade pelo login', () => {
  it('mesmo login, mesmo personagem; logins diferentes, personagens diferentes', () => {
    const a = new Simulation(W, GENESIS).agents.find(x => x.name === 'kernelpanda')!;
    const b = new Simulation(W, GENESIS).agents.find(x => x.name === 'kernelpanda')!;
    expect(a.look).toEqual(b.look);
    expect(a.traits).toEqual(b.traits);
    const looks = new Set(new Simulation(W, GENESIS).agents.map(x => JSON.stringify([x.look, x.traits])));
    expect(looks.size).toBe(W.stargazers.length);
  });

  it('todo morador antigo já tem casa e árvore no checkpoint', () => {
    const s = new Simulation(W, GENESIS);
    const residents = s.agents.filter(a => a.present);
    expect(residents.length).toBe(W.stargazers.filter(x => x.daysAgo !== undefined).length);
    for (const a of residents) expect(a.tree).not.toBeNull();
  });

  it('quem deu star hoje chega e planta a árvore', { timeout: 30_000 }, () => {
    const s = run(24 * 7200);
    expect(s.agents.every(a => a.present)).toBe(true);
    expect(s.trees.length).toBe(W.stargazers.length);
  });
});

describe('desempenho', () => {
  it('um dia inteiro roda em poucos segundos', () => {
    const t0 = performance.now();
    run(24 * 7200);
    expect(performance.now() - t0).toBeLessThan(10_000);
  }, 30_000);

  it('stars reais com starredAt: antes de hoje mora, depois chega na hora', () => {
    const w: WorldFile = { ...W, stargazers: [
      { login: 'antiga', starredAt: new Date(GENESIS - 3 * 86_400_000).toISOString() },
      { login: 'hoje', starredAt: new Date(GENESIS + 10 * 3_600_000).toISOString() },
    ] };
    const s = new Simulation(w, GENESIS);
    expect(s.agents.find(a => a.name === 'antiga')!.present).toBe(true);
    const h = s.agents.find(a => a.name === 'hoje')!;
    expect(h.present).toBe(false);
    s.runUntil(h.arriveTick + 5);
    expect(h.present).toBe(true);
  });

  it('mundo sem nenhuma star roda sem erro', () => {
    const s = run(2000, { ...W, stargazers: [] });
    expect(s.agents.length).toBe(0);
  });
});
