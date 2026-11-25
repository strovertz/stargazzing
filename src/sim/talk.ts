import { fnv, h32 } from '../core/rng';
import { DAY_MS, INSTRUMENTS, TICKS_PER_HOUR } from './constants';
import { NEEDS } from './village';
import { hourAt, isNight, type Simulation } from './simulation';
import { weatherAt, type WeatherKind } from './weather';
import type { Agent } from './types';

/**
 * Humor, falas e notícias. Tudo aqui é lido do estado da simulação, sem sortear nada novo:
 * a mesma hora mostra a mesma fala em qualquer navegador, e a simulação não muda.
 */
export interface Mood { hunger: number; tired: number; joy: number }
const clamp = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);
const pick = <T>(l: readonly T[], k: number): T => l[k % l.length]!;

/** Refeições às 7h, 12h30 e 19h30; cansaço cresce desde que acordou; alegria vem dos amigos, do tempo e do dia. */
export function moodOf(sim: Simulation, a: Agent): Mood {
  const h = hourAt(sim.tick), w = sim.weather();
  const meals = [7, 12.5, 19.5], last = meals.filter(m => m <= h).pop() ?? -4.5;
  const ate = a.state === 'FISH' && a.items.some(i => i.includes('peixe')) ? 0.15 : 0;
  const hunger = clamp((h - last) / 6 - ate);
  const wake = a.owl ? 8 : 5.5, awake = h >= wake ? h - wake : h + 24 - wake;
  const work = a.state === 'CHOP' || a.state === 'MINE' || a.state === 'BUCKET' ? 0.15 : 0;
  const tired = a.state === 'REST' && isNight(h) ? 0.2 : clamp((awake / 18) * (1.25 - a.traits.energy * 0.5) + work);
  let joy = 0.45 + a.friends.length * 0.07 - a.rivals.length * 0.06 + Math.min(4, a.items.length) * 0.04;
  if (a.partner) joy += 0.1;
  if (a.pet) joy += 0.05;
  if (w.storm) joy -= 0.2; else if (w.rain > 0.3) joy -= a.traits.gardener > 0.6 ? -0.05 : 0.1;
  if (sim.isParty()) joy += 0.2;
  if (a.state === 'PLAY' || a.state === 'GATHER' || a.state === 'GAME') joy += 0.1;
  if (a.tree && sim.tick - a.tree.lastWater > 3000) joy -= 0.12;
  return { hunger, tired, joy: clamp(joy - hunger * 0.15 - tired * 0.1) };
}

/** O que aconteceu hoje com o morador, pelo diário (mais recente primeiro). */
export function todayOf(sim: Simulation, a: Agent, n = 5): string[] {
  const out: string[] = [];
  for (let k = sim.log.length - 1; k >= 0 && out.length < n; k--) if (sim.log[k]!.text.includes(a.name)) out.push(sim.log[k]!.text);
  return out;
}

/** Diário em primeira pessoa: as últimas coisas que o morador viveu hoje, contadas por ele. */
export function firstPerson(a: Agent, text: string): string {
  let t = text.replace(new RegExp(`^${a.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')} `), 'Eu ');
  t = t.replace(a.name, 'mim');
  return t;
}

const GREET = { manha: ['Bom dia!', 'Opa, bom dia.', 'Dia bonito pra andar por aí.'], tarde: ['Boa tarde!', 'E aí, tudo certo?', 'Olá, viajante.'], noite: ['Boa noite...', 'Ainda acordado?', 'Que noite, hein.'] };
const BY_STATE: Partial<Record<Agent['state'], string[]>> = {
  FISH: ['Shhh, tá beliscando!', 'Paciência é metade da pescaria.', 'Hoje o lago tá generoso.'],
  BOAT: ['O meio do lago é o lugar mais calmo do mundo.', 'Daqui dá pra ver a vila inteira.'],
  CHOP: ['Lenha pra fogueira de hoje à noite.', 'Uma árvore cortada, duas mudas plantadas. É a regra.'],
  PLAY: ['Quer ouvir uma música nova?', 'Essa eu compus ontem na roda.'],
  GATHER: ['Senta aí, a fogueira tá boa.', 'Nada como uma roda de conversa.'],
  WATER: ['Minha árvore tava com sede.', 'Um pouco de água todo dia e ela cresce que é uma beleza.'],
  GARDEN: ['As flores tão lindas nessa época.', 'Jardim bem cuidado alegra a vila toda.'],
  MINE: ['Achei uns cristais bonitos lá dentro!', 'A caverna é fria, mas vale a pena.'],
  SIGHT: ['Tô indo ver uma coisa que ouvi falar.', 'Esse mapa ainda tem muito canto escondido.'],
  REST: ['Só descansando um pouco.', 'Casa é casa.'],
  TASK: ['Tô lendo os pedidos do quadro.', 'Tem pedido novo no quadro, sabia?'],
  BUCKET: ['Fogo! Pega um balde!', 'Rápido, antes que espalhe!'],
  GAME: ['Sua vez... não, espera, é a minha.', 'Dama é coisa séria aqui.'],
  CHAT: ['A gente tava falando de você, sabia?', 'Sabe da última?'],
  AGORA: ['A ágora tá cada dia mais bonita.', 'Já viu as colunas novas?'],
};
const BY_WEATHER: Record<WeatherKind, string[]> = {
  limpo: ['Céu limpinho hoje.', 'Sol bom pra secar a roupa.'],
  nublado: ['Será que chove?', 'Nublado, mas abafado.'],
  neblina: ['Não dá pra ver um palmo com essa névoa.', 'A névoa veio da mata fechada de novo.'],
  garoa: ['Garoinha chata.', 'Essa garoa é boa pras plantas.'],
  chuva: ['Que chuvarada!', 'Chuva boa pra horta.'],
  tempestade: ['Melhor ficar em casa com esse temporal.', 'Ouviu esse trovão?!'],
};

/** Falas da hora: saudação, o que está fazendo, um comentário do dia e do humor. Mudam a cada hora. */
export function linesFor(sim: Simulation, a: Agent): string[] {
  const h = hourAt(sim.tick), slot = Math.floor(sim.tick / TICKS_PER_HOUR), k = h32(fnv(a.name), slot, sim.genesis / DAY_MS);
  const m = moodOf(sim, a), w = sim.weather();
  const out: string[] = [];
  const g = h < 12 && h >= 5 ? GREET.manha : h < 18 && h >= 5 ? GREET.tarde : GREET.noite;
  out.push(`${pick(g, k)} ${m.tired > 0.75 ? '*boceja* ' : ''}${pick(BY_STATE[a.state] ?? ['Só dando uma volta.'], k >>> 3)}`);
  const today = todayOf(sim, a, 3);
  if (today.length) out.push(`Hoje: ${firstPerson(a, today[0]!).replace(/^Eu /, 'eu ')}.`);
  const bits: string[] = [];
  if (m.hunger > 0.7) bits.push(pick(['Tô morrendo de fome.', 'Daqui a pouco é hora de comer.', 'Esse cheiro de pão vem de onde?'], k >>> 5));
  if (m.joy > 0.75) bits.push(pick(['Que dia bom!', 'Tô feliz demais hoje.', 'Adoro essa vila.'], k >>> 6));
  else if (m.joy < 0.3) bits.push(pick(['Hoje não tá fácil...', 'Tô meio pra baixo.', 'Preciso de uma roda de fogueira.'], k >>> 6));
  bits.push(pick(BY_WEATHER[w.kind], k >>> 7));
  if (a.pet && (k >>> 9) % 3 === 0) bits.push(`${a.pet.name} ${pick(['tá dormindo lá em casa.', 'me acordou cedo hoje.', 'adora esse tempo.'], k >>> 10)}`);
  if (a.partner && (k >>> 11) % 3 === 0) bits.push(`${a.partner.name} mandou um abraço.`);
  if (a.friends.length && (k >>> 12) % 2 === 0) bits.push(`Viu ${pick(a.friends, k >>> 13).name} por aí?`);
  out.push(bits.slice(0, 2).join(' '));
  if (a.prof === 2 && (k >>> 14) % 2 === 0) out.push(`Hoje eu toco ${INSTRUMENTS[a.instrument]} na roda. Aparece!`);
  return out.filter(Boolean);
}

/** Pergunta do dia: uma por morador por dia, com duas respostas e o que ele responde a cada uma. */
const QUESTIONS: { q: string; a: [string, string]; r: [string, string] }[] = [
  { q: 'Você prefere o lago ou a mata?', a: ['O lago', 'A mata'], r: ['Também! Água calma acalma a cabeça.', 'Corajoso! A mata fechada tem seus segredos.'] },
  { q: 'Chuva ou sol pra hoje?', a: ['Chuva', 'Sol'], r: ['As plantas agradecem.', 'Bom pra pescar, então.'] },
  { q: 'Me ajuda a escolher: trigo ou abóbora na horta?', a: ['Trigo', 'Abóbora'], r: ['Pão fresco, então!', 'Vai dar uma sopa daquelas.'] },
  { q: 'Você acredita no cervo branco?', a: ['Acredito', 'É lenda'], r: ['Eu sabia que não era só eu!', 'Hmm... espera até a lua cheia.'] },
  { q: 'Qual música toca na roda hoje?', a: ['Uma lenta', 'Uma animada'], r: ['Pra olhar as estrelas.', 'Pra dançar em volta da fogueira!'] },
  { q: 'Gato ou cachorro?', a: ['Gato', 'Cachorro'], r: ['Gatos mandam nessa vila.', 'Cachorro é parceiro de pescaria.'] },
  { q: 'O conselho devia consertar o quê primeiro?', a: ['A ponte', 'As colunas'], r: ['Do outro lado tem um canto que ninguém viu.', 'A ágora merece!'] },
  { q: 'Você dorme cedo ou é coruja?', a: ['Cedo', 'Coruja'], r: ['Sábio. O sol nasce cedo aqui.', 'Então a gente se vê na fogueira.'] },
];
export function questionFor(sim: Simulation, a: Agent): { id: number; q: string; a: [string, string]; r: [string, string] } {
  const id = h32(fnv(a.name), sim.genesis / DAY_MS, 3) % QUESTIONS.length;
  return { id, ...QUESTIONS[id]! };
}

/** Notícias do quadro de anúncios. */
export interface BoardNews { arrivals: string[]; works: { done: string[]; next: string | null }; fisher: string | null; friends: string[]; forecast: string; requests: { n: number; title: string }[]; count: number }
export function boardNews(sim: Simulation): BoardNews {
  const arrivals = sim.agents.filter(a => !a.meta.days && a.present).map(a => a.name);
  const done = NEEDS.filter(([, n]) => sim.stars >= n).map(([k]) => k), nx = NEEDS.find(([, n]) => sim.stars < n);
  const catches = new Map<string, number>();
  for (const a of sim.agents) { const n = a.items.filter(i => /lambari|traíra|bagre|peixe/.test(i)).length; if (n) catches.set(a.name, n); }
  for (const e of sim.log) if (e.kind === 'pesca') { const who = sim.agents.find(a => e.text.startsWith(a.name)); if (who) catches.set(who.name, (catches.get(who.name) ?? 0) + 1); }
  const fisher = [...catches].sort((p, q) => q[1] - p[1] || (p[0] < q[0] ? -1 : 1))[0];
  const friends = sim.log.filter(e => e.kind === 'amizade' && /viraram amigos|pazes|vizinhos|casal/.test(e.text)).slice(-4).map(e => e.text);
  const requests = sim.requests.filter(q => q.state === 'open').slice(0, 5).map(q => ({ n: q.n, title: q.title }));
  return {
    arrivals, works: { done, next: nx ? `${nx[0]} (faltam ${nx[1] - sim.stars})` : null },
    fisher: fisher ? `${fisher[0]} (${fisher[1]} peixe${fisher[1] > 1 ? 's' : ''})` : null,
    friends, forecast: forecast(sim), requests, count: arrivals.length + friends.length + requests.length,
  };
}

/** Previsão de amanhã: o clima é uma função do tempo, então dá para "prever" com certeza. */
export function forecast(sim: Simulation): string {
  const base = sim.genesis + DAY_MS, kinds = new Map<WeatherKind, number>();
  let rainy = 0;
  for (let h = 6; h < 22; h += 2) {
    const w = weatherAt(sim.terrain.noise, (base + h * 3_600_000) / 3_600_000, h);
    kinds.set(w.kind, (kinds.get(w.kind) ?? 0) + 1);
    if (w.rain > 0.3) rainy++;
  }
  const main = [...kinds].sort((p, q) => q[1] - p[1])[0]![0];
  const morning = weatherAt(sim.terrain.noise, (base + 7 * 3_600_000) / 3_600_000, 7).kind;
  return `${main === 'limpo' ? 'Sol' : main[0]!.toUpperCase() + main.slice(1)} na maior parte do dia${morning !== main ? `, ${morning} cedo` : ''}${rainy >= 3 && main !== 'chuva' && main !== 'tempestade' ? ', com pancadas de chuva' : ''}.`;
}
