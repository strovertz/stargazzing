import { describe, expect, it } from 'vitest';
import world from './fixtures/world.demo.json';
import { genesisFor, Simulation } from '../src/sim/simulation';
import { affinity, commitBias, ecosystem, nightTune } from '../src/sim/extras';
import { lookFor } from '../src/sim/look';
import { h32 } from '../src/core/rng';
import { COLS, DAY_MS } from '../src/sim/constants';
import type { WorldFile } from '../src/sim/types';

const W = world as WorldFile;
const GENESIS = genesisFor(Date.UTC(2026, 10, 24, 15, 0), W.timezoneOffsetHours);

describe('relações e aparência', () => {
  it('afinidade é simétrica e não depende de maiúsculas', () => {
    expect(affinity('Ana', 'bruno')).toBe(affinity('BRUNO', 'ana'));
  });
  it('a aparência pura (usada no SVG) é a mesma do morador', () => {
    const s = new Simulation(W, GENESIS);
    for (const a of s.agents) expect(lookFor(a.name, a.meta.days ?? 0).look).toEqual(a.look);
  });
  it('amizade vale para os dois lados', () => {
    const s = new Simulation(W, GENESIS);
    for (const a of s.agents) for (const b of a.friends) expect(b.friends).toContain(a);
  });
});

describe('sistemas novos', () => {
  it('ecossistema fica em faixas razoáveis e é determinístico', () => {
    for (let d = 0; d < 40; d++) {
      const e = ecosystem(20000 + d, 7);
      expect(e).toEqual(ecosystem(20000 + d, 7));
      expect(e.rabbits).toBeGreaterThanOrEqual(2);
      expect(e.foxes).toBeGreaterThanOrEqual(1);
    }
  });
  it('melodia da noite é a mesma para o mesmo dia', () => {
    expect(nightTune(GENESIS)).toEqual(nightTune(GENESIS));
    expect(nightTune(GENESIS)).not.toEqual(nightTune(GENESIS + DAY_MS));
  });
  it('commits puxam sol; semana parada traz neblina', () => {
    const day = new Date(GENESIS).toISOString().slice(0, 10);
    expect(commitBias({ commits: { [day]: 5 } }, GENESIS).sun).toBeGreaterThan(0);
    expect(commitBias({ commits: {} }, GENESIS).fog).toBeGreaterThan(0);
  });
  it('forks viram acampamentos e seguidores viram mercador', () => {
    const w: WorldFile = { ...W, extra: { forks: [{ login: 'garfo', at: '2026-11-20T10:00:00Z' }, { login: 'colher', at: '2026-11-21T10:00:00Z' }], followers: ['mercante'] } };
    const s = new Simulation(w, GENESIS);
    expect(s.forks.length).toBe(2);
    expect(s.forks[0]!.x < 60 || s.forks[0]!.x > 260).toBe(true);
    if (s.merchantPath.length) {
      expect(s.merchantAt(10 * 7200)).not.toBeNull();
      expect(s.merchantAt(3 * 7200)).toBeNull();
    }
  });
  it('pedido atendido dá festa', () => {
    const w: WorldFile = { ...W, extra: { requests: [{ n: 1, title: 'Um lago maior', state: 'closed', closedAt: new Date(GENESIS + 10 * 3_600_000).toISOString() }] } };
    const s = new Simulation(w, GENESIS);
    expect(s.isParty(11 * 7200)).toBe(true);
    expect(s.isParty(15 * 7200)).toBe(false);
  });
  it('fogo de raio sempre termina com mutirão e muda replantada', { timeout: 60_000 }, () => {
    // procura um dia em que o raio cai e roda o dia inteiro
    for (let d = 0; d < 120; d++) {
      const s = new Simulation(W, GENESIS + d * DAY_MS);
      let hit = -1;
      for (let t = 120; t < 24 * 7200 && hit < 0; t += 120) if (s.weather(t).storm && h32(t, 55, s.terrain.seed) % 4 === 0) hit = t;
      if (hit < 0) continue;
      s.runUntil(Math.min(24 * 7200 - 1, hit + 1200));
      const log = s.log.map(e => e.text).join('\n');
      expect(log).toMatch(/raio acertou/);
      expect(log).toMatch(/apagou o fogo e replantou/);
      expect(s.fire).toBeNull();
      return;
    }
  });
});

describe('cartões SVG', () => {
  it('cartão do morador e da vila saem com o nome e sem script', async () => {
    const { residentCard, villageCard } = await import('../src/cards/svg');
    const c = residentCard({ login: 'Ana', daysAgo: 40 }, GENESIS, 'https://exemplo/');
    expect(c).toContain('>Ana<');
    expect(c).not.toMatch(/<script/i);
    expect(villageCard(W.stargazers, GENESIS)).toContain(`${W.stargazers.length} moradores`);
  });
});

describe('interações', () => {
  it('pets, instrumentos e um dia com presentes de verdade e partidas de dama', { timeout: 60_000 }, () => {
    const s = new Simulation(W, GENESIS);
    expect(s.agents.some(a => a.pet)).toBe(true);
    expect(new Simulation(W, GENESIS).agents.map(a => a.pet?.name ?? '')).toEqual(s.agents.map(a => a.pet?.name ?? ''));
    s.runUntil(24 * 7200 - 1);
    const log = s.log.map(e => e.text).join('\n');
    expect(log).toMatch(/ deu /);
    expect(s.agents.some(a => a.items.some(i => i.includes('(de ')))).toBe(true);
    // amizades nunca ficam pela metade
    for (const a of s.agents) for (const b of a.friends) expect(b.friends).toContain(a);
  });
});

describe('casas', () => {
  it('palafita só na beira da água e tipos estáveis', () => {
    const s = new Simulation(W, GENESIS), T = s.terrain.T;
    for (const a of s.agents) {
      expect(a.house).toBe(new Simulation(W, GENESIS).agents.find(b => b.name === a.name)!.house);
      if (a.house !== 3) continue;
      let wet = false;
      for (let dy = -2; dy <= 3; dy++) for (let dx = -5; dx <= 3; dx++) if (T[(a.home.y + dy) * COLS + a.home.x + dx]! <= 1) wet = true;
      expect(wet).toBe(true);
    }
    expect(new Set(s.agents.map(a => a.house)).size).toBeGreaterThan(2);
  });
});
