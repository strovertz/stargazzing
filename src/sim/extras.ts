import { fnv, h32, mulberry32 } from '../core/rng';
import { DAY_MS } from './constants';
import type { RepoData } from './types';

/**
 * Funções puras que alimentam os sistemas novos. Nada aqui guarda estado: tudo sai do nome,
 * da data ou dos dados do repositório, então todo navegador calcula o mesmo valor.
 */

/** Afinidade entre dois moradores (0 a 99), simétrica: amizade, rivalidade e casais saem daqui. */
export function affinity(a: string, b: string): number {
  const [p, q] = a.toLowerCase() < b.toLowerCase() ? [a, b] : [b, a];
  return fnv(`${p.toLowerCase()}|${q.toLowerCase()}`) % 100;
}
export const FRIEND_AT = 84, RIVAL_AT = 6, COUPLE_AT = 97;

/** Fase da lua de verdade (0 nova, 0,5 cheia): ciclo sinódico a partir de uma lua nova conhecida. */
export function moonPhase(ms: number): number { return ((((ms - Date.UTC(2000, 0, 6, 18, 14)) / DAY_MS) / 29.530588) % 1 + 1) % 1; }
export const isFullMoon = (ms: number) => Math.abs(moonPhase(ms) - 0.5) < 0.034;

/**
 * Ecossistema: Lotka-Volterra discreto, um passo por dia, desde um dia fixo até o dia pedido.
 * A capacidade dos coelhos sobe com as flores da estação; as raposas comem coelhos.
 */
export function ecosystem(day: number, seed: number): { rabbits: number; foxes: number } {
  let R = 10, F = 3;
  for (let d = day - 120; d <= day; d++) {
    const month = new Date(d * DAY_MS).getUTCMonth();
    const flowers = month >= 8 && month <= 10 ? 1.35 : month >= 5 && month <= 7 ? 0.7 : 1;
    const K = 22 * flowers, jitter = 1 + ((h32(d, 5, seed) % 100) - 50) / 600;
    const nR = R + 0.32 * R * (1 - R / K) * jitter - 0.035 * R * F;
    const nF = F + 0.012 * R * F - 0.18 * F;
    R = Math.max(2, Math.min(26, nR)); F = Math.max(1, Math.min(10, nF));
  }
  return { rabbits: Math.round(R), foxes: Math.round(F) };
}

/** Dia (AAAA-MM-DD, UTC) de um instante. */
export const dayKey = (ms: number) => new Date(ms).toISOString().slice(0, 10);

/**
 * Commits mexem no clima: semana com commits puxa o céu para o sol, semana parada traz neblina.
 * Devolve quanto tirar das nuvens e quanto somar na neblina.
 */
export function commitBias(extra: RepoData | undefined, ms: number): { sun: number; fog: number } {
  const c = extra?.commits;
  if (!c) return { sun: 0, fog: 0 };
  let recent = 0, week = 0;
  for (let k = 0; k < 7; k++) { const n = c[dayKey(ms - k * DAY_MS)] ?? 0; week += n; if (k < 3) recent += n; }
  return { sun: Math.min(0.16, recent * 0.02), fog: week === 0 ? 0.35 : 0 };
}

/** Mercador do dia: um seguidor do dono do repositório, escolhido pela data. */
export function merchantFor(extra: RepoData | undefined, genesis: number, seed: number): string | null {
  const f = extra?.followers;
  if (!f?.length) return null;
  return f[h32(Math.floor(genesis / DAY_MS), 31, seed) % f.length]!;
}

/** Melodia da noite: 16 notas da pentatônica, sorteadas pela data (todo mundo ouve a mesma música hoje). */
export function nightTune(genesis: number): number[] {
  const r = mulberry32(fnv(`tune|${Math.floor(genesis / DAY_MS)}`)), out: number[] = [];
  let n = 4;
  for (let k = 0; k < 16; k++) { n = Math.max(0, Math.min(7, n + [-2, -1, -1, 0, 1, 1, 2][Math.floor(r() * 7)]!)); out.push(n); }
  return out;
}
