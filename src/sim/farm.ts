import type { Noise3 } from '../core/noise';
import { fnv, h32 } from '../core/rng';
import { DAY_MS } from './constants';
import { weatherAt } from './weather';

/**
 * Plantações que crescem em dias reais. Cada 2 horas somam 1 ponto, ou 1,6 com chuva;
 * ao bater a meta a planta é colhida e o canteiro recomeça. Como a chuva é uma função
 * do tempo, o crescimento também é: todo navegador vê a mesma horta no mesmo estágio.
 */
const SLOT = 2 * 3_600_000;
const rainCache = new Map<string, number>();
function rainy(noise: Noise3, seedKey: number, slot: number): boolean {
  const k = `${seedKey}|${slot}`;
  let v = rainCache.get(k);
  if (v === undefined) {
    const abs = (slot * SLOT) / 3_600_000;
    v = weatherAt(noise, abs, abs % 24).rain > 0.3 ? 1 : 0;
    if (rainCache.size > 40_000) rainCache.clear();
    rainCache.set(k, v);
  }
  return v === 1;
}

export interface Growth { stage: number; progress: number; harvests: number; lastHarvest: number; nextHarvest: number }

/** Crescimento de `fromMs` até `atMs` com meta de `target` pontos. Olha no máximo 40 dias para trás. */
export function growth(noise: Noise3, seedKey: number, fromMs: number, atMs: number, target: number): Growth {
  const s0 = Math.max(Math.floor(fromMs / SLOT), Math.floor((atMs - 40 * DAY_MS) / SLOT)), s1 = Math.floor(atMs / SLOT);
  let acc = 0, harvests = 0, last = s0 * SLOT;
  for (let s = s0; s < s1; s++) {
    acc += rainy(noise, seedKey, s) ? 1.6 : 1;
    if (acc >= target) { acc = 0; harvests++; last = (s + 1) * SLOT; }
  }
  // próxima colheita: continua somando a partir de agora
  let a2 = acc, s = s1;
  while (a2 < target && s < s1 + 200) { a2 += rainy(noise, seedKey, s) ? 1.6 : 1; s++; }
  const progress = acc / target;
  return { stage: progress < 0.15 ? 0 : progress < 0.45 ? 1 : progress < 0.8 ? 2 : 3, progress, harvests, lastHarvest: last, nextHarvest: s * SLOT };
}

/** Hortas: o login escolhe o que plantar; cada cultura tem seu tempo (em blocos de 2 horas). */
export const CROPS = [
  { n: 'cenoura', item: 'uma cenoura', target: 30, col: '#e8862a' },
  { n: 'abóbora', item: 'uma abóbora', target: 48, col: '#e89a2a' },
  { n: 'alface', item: 'um pé de alface', target: 24, col: '#8fd46a' },
  { n: 'girassol', item: 'um girassol', target: 40, col: '#f2c14e' },
  { n: 'tomate', item: 'um tomate', target: 36, col: '#d8463a' },
] as const;
export const cropOf = (name: string) => fnv(name.toLowerCase() + '#crop') % CROPS.length;

/** Trigo do campo da vila: plantado no começo do ano, colhido a cada ~3 dias (menos se chover). */
export const WHEAT_TARGET = 36;
export const WHEAT_EPOCH = Date.UTC(2026, 0, 1);

/** Preços do dia na banca: base, sorteio do dia e oferta (trigo colhido há pouco fica barato). */
export function pricesFor(day: number, seed: number, wheatFresh: boolean): { item: string; price: number; trend: -1 | 0 | 1 }[] {
  const base: [string, number][] = [['trigo', 4], ['pão', 6], ['peixe', 5], ['cristal', 20], ['abóbora', 7], ['mel', 9]];
  return base.map(([item, b], k) => {
    const today = 0.8 + (h32(day, k, seed) % 45) / 100, yday = 0.8 + (h32(day - 1, k, seed) % 45) / 100;
    let p = b * today;
    if (item === 'trigo' && wheatFresh) p *= 0.7;
    if (item === 'pão' && wheatFresh) p *= 0.85;
    const pr = Math.max(1, Math.round(p));
    return { item, price: pr, trend: today > yday + 0.03 ? 1 : today < yday - 0.03 ? -1 : 0 };
  });
}
