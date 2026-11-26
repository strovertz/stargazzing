import { h32 } from '../core/rng';
import { COLS, DAY_MS, PROFS } from './constants';
import { near } from './village';
import type { Terrain } from './world';

/**
 * Economia comunitária, sem dinheiro: celeiro comum, trocas, mutirões e cuidado.
 * Tudo que atravessa dias (materiais juntados, obras prontas) sai de uma conta fechada sobre
 * quantos moradores de cada ofício havia em cada dia, então todo navegador vê o mesmo celeiro.
 */
export type Good = 'trigo' | 'pão' | 'peixe' | 'legumes' | 'ervas' | 'sementes' | 'lenha' | 'pedra';
export const GOODS: Good[] = ['trigo', 'pão', 'peixe', 'legumes', 'ervas', 'sementes', 'lenha', 'pedra'];
export const GOOD_UNIT: Record<Good, [string, string]> = {
  trigo: ['saca de trigo', 'sacas de trigo'], 'pão': ['pão', 'pães'], peixe: ['peixe', 'peixes'], legumes: ['cesto de legumes', 'cestos de legumes'],
  ervas: ['maço de ervas', 'maços de ervas'], sementes: ['punhado de sementes', 'punhados de sementes'], lenha: ['feixe de lenha', 'feixes de lenha'], pedra: ['pedra', 'pedras'],
};
export const qty = (n: number, g: Good) => `${n} ${GOOD_UNIT[g][n === 1 ? 0 : 1]}`;
/** abaixo disso falta, e a vila puxa gente para esse trabalho */
export const LOW: Partial<Record<Good, number>> = { 'pão': 4, peixe: 4, legumes: 3, lenha: 6, ervas: 2 };

export type BuildingKind = 'celeiro' | 'taverna' | 'ferramentas' | 'oficina' | 'caldeirão' | 'canteiro' | 'forno' | 'farol' | 'coreto';
export interface Building { kind: BuildingKind; x: number; y: number; w: number; cells: number[] }
export type ProjectKind = 'forno' | 'farol' | 'coreto';
export interface Project { kind: ProjectKind; name: string; lenha: number; pedra: number; b: Building | null; /** dia (absoluto) do mutirão; null se ainda faltam materiais */ day: number | null }
export const PROJECTS: { kind: ProjectKind; name: string; lenha: number; pedra: number }[] = [
  { kind: 'forno', name: 'forno comunitário', lenha: 40, pedra: 50 },
  { kind: 'farol', name: 'farol do lago', lenha: 70, pedra: 110 },
  { kind: 'coreto', name: 'coreto da ágora', lenha: 140, pedra: 70 },
];

/** Lugares dos prédios comuns: perto da ágora, do mercado e da praia. Marca as células como ocupadas. */
export function planCommons(t: Terrain, market: { x: number; y: number } | undefined): Building[] {
  const a = t.agora, out: Building[] = [];
  const put = (kind: BuildingKind, x: number, y: number, w: number, block = true) => {
    const p = near(t, x, y, w);
    if (!p) return;
    const cells = Array.from({ length: w }, (_, k) => p[1] * COLS + p[0] + k);
    if (block) for (const c of cells) t.block[c] = 1;
    out.push({ kind, x: p[0], y: p[1], w, cells });
  };
  const ry = Math.ceil(a.ry);
  t.clearTrees(a.x - 30, a.y - ry - 2, a.x - a.rx - 1, a.y + ry + 2);
  t.clearTrees(a.x + a.rx + 1, a.y - ry - 2, a.x + 30, a.y + ry + 2);
  put('taverna', a.x - a.rx - 9, a.y - 1, 4);
  put('celeiro', a.x + a.rx + 6, a.y - 2, 4);
  put('canteiro', a.x - 3, a.y - ry - 3, 7);
  const mk = market ?? { x: a.x + 8, y: a.y + ry + 6 };
  t.clearTrees(mk.x + 4, mk.y - 3, mk.x + 16, mk.y + 3);
  put('ferramentas', mk.x + 6, mk.y, 3);
  put('oficina', mk.x + 11, mk.y, 3);
  // caldeirão no meio da ágora, ao lado do braseiro (não bloqueia: a fila passa em volta)
  out.push({ kind: 'caldeirão', x: a.x + 3, y: a.y + 1, w: 1, cells: [] });
  return out;
}

/** Terrenos das obras de mutirão (o farol vai na praia do maior lago). */
export function planProjects(t: Terrain): Building[] {
  const a = t.agora, out: Building[] = [], beach = t.landmarks.find(l => l.kind === 'praia');
  const put = (kind: BuildingKind, x: number, y: number, w: number) => {
    const p = near(t, x, y, w);
    if (!p) return;
    const cells = Array.from({ length: w }, (_, k) => p[1] * COLS + p[0] + k);
    for (const c of cells) t.block[c] = 1; // terreno reservado: ninguém constrói casa em cima
    out.push({ kind, x: p[0], y: p[1], w, cells });
  };
  put('forno', a.x - a.rx - 4, a.y + Math.ceil(a.ry) + 3, 3);
  if (beach) put('farol', beach.x + 4, beach.y, 2); else put('farol', a.x + 40, a.y + 20, 2);
  put('coreto', a.x + a.rx + 6, a.y + Math.ceil(a.ry) + 4, 3);
  return out;
}

/** Produção diária esperada de cada ofício (base das contas que atravessam dias). */
function daily(profs: number[]): { lenha: number; pedra: number } {
  let lenha = 2, pedra = 2;
  for (const p of profs) { if (PROFS[p] === 'lenhador') lenha += 5; else if (PROFS[p] === 'minerador') pedra += 5; else { lenha += 0.6; pedra += 0.4; } }
  return { lenha: Math.floor(lenha), pedra: Math.floor(pedra) };
}

/**
 * Conta fechada dos materiais: de dia em dia, desde o primeiro morador, junta lenha e pedra e,
 * quando dá para a próxima obra, marca o mutirão naquele dia. Devolve as obras com o dia do mutirão
 * e o que sobrou no celeiro no começo de hoje.
 */
export function ledger(residents: { day: number; prof: number }[], today: number): { days: (number | null)[]; lenha: number; pedra: number } {
  const days: (number | null)[] = PROJECTS.map(() => null);
  if (!residents.length) return { days, lenha: 0, pedra: 0 };
  const first = Math.min(...residents.map(r => r.day));
  let lenha = 0, pedra = 0, next = 0, left = { lenha: 0, pedra: 0 };
  for (let d = Math.max(first, today - 400); d <= today + 60; d++) {
    if (d === today) left = { lenha, pedra };
    const prod = daily(residents.filter(r => r.day <= Math.min(d, today)).map(r => r.prof));
    lenha += prod.lenha; pedra += prod.pedra;
    while (next < PROJECTS.length && lenha >= PROJECTS[next]!.lenha && pedra >= PROJECTS[next]!.pedra) {
      lenha -= PROJECTS[next]!.lenha; pedra -= PROJECTS[next]!.pedra; days[next] = d; next++;
    }
    if (d >= today && next >= PROJECTS.length) break;
  }
  return { days, ...left };
}

/** Celeiro no começo do dia: comida pela quantidade de cada ofício, com um pouco de acaso do dia. */
export function startStock(profs: number[], dayAbs: number, seed: number, wheat: number, season: number): Record<Good, number> {
  const n = (p: string) => profs.filter(x => PROFS[x] === p).length, j = (k: number, m: number) => h32(dayAbs, k, seed) % m;
  return {
    trigo: wheat, 'pão': 2 + j(1, 3), peixe: Math.min(30, 2 * n('pescador') + j(2, 10)), legumes: Math.min(30, 2 + n('jardineiro') + n('agricultor') + j(3, 8)),
    ervas: 1 + j(4, 4), sementes: Math.min(40, 6 + (season === 3 ? 10 : 0) + n('jardineiro') * 2), lenha: 0, pedra: 0,
  };
}

export const dayOf = (ms: number, tz: number) => Math.floor((ms + tz * 3_600_000) / DAY_MS);

/** Histórias contadas na roda da fogueira (vão para o diário). */
export const TALES = [
  'do peixe que aprendeu a assobiar', 'da primeira star, que caiu no lago e virou vaga-lume', 'do lenhador que plantava duas árvores para cada uma que cortava',
  'do cervo branco que guia quem se perde na mata', 'da coluna que se levantou sozinha numa noite de lua cheia', 'do mercador que trocou um mapa por uma canção',
  'do pão que não acabava nunca no inverno da grande neblina', 'da coruja que sabia o nome de todo mundo', 'do templo que só aparece para quem tem paciência',
  'do riacho que corria ao contrário no equinócio', 'do sapo que virou conselheiro da vila', 'da tempestade que parou para ouvir uma harpa',
  'das sementes que brotam onde alguém ri alto', 'do pescador que devolveu o peixe dourado e ganhou um desejo', 'da ponte que rangia uma música', 'do forno que assava sonhos',
];
/** Coisas que o mercador traz e leva: sem moeda, só troca de bens e de histórias. */
export const MERCHANT_BRINGS = ['sementes de girassol', 'sementes de abóbora', 'uma rabeca', 'um pandeiro', 'mudas de alecrim', 'sementes de melancia', 'um apito de barro'];
export const MERCHANT_TAKES = ['a história do cervo branco', 'uma receita de pão', 'um desenho da ágora', 'um cesto de legumes', 'uma canção da roda', 'um mapa da mata'];
