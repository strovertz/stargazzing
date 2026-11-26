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

/** Diário em primeira pessoa: "Fulano pescou um bagre" vira "Pesquei um bagre". */
const VERB: Record<string, string> = {
  chegou: 'cheguei', pescou: 'pesquei', foi: 'fui', deu: 'dei', colheu: 'colhi', regou: 'reguei', tocou: 'toquei', ouviu: 'ouvi', leu: 'li',
  ganhou: 'ganhei', entregou: 'entreguei', montou: 'montei', apresentou: 'apresentei', acendeu: 'acendi', encheu: 'enchi', visitou: 'visitei',
  sentou: 'sentei', achou: 'achei', voltou: 'voltei', entrou: 'entrei', viu: 'vi', plantou: 'plantei', trouxe: 'trouxe', fez: 'fiz', comprou: 'comprei',
};
export function firstPerson(a: Agent, text: string): string {
  const esc = a.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  let t = text;
  const pair = new RegExp(`^${esc} e (\\S+) (fizeram|viraram|foram|pararam)`).exec(t);
  if (pair) t = t.replace(pair[0], `Eu e ${pair[1]} ${{ fizeram: 'fizemos', viraram: 'viramos', foram: 'fomos', pararam: 'paramos' }[pair[2]!]}`);
  else if (t.startsWith(`${a.name} `)) {
    const rest = t.slice(a.name.length + 1), [verb, ...more] = rest.split(' ');
    t = VERB[verb!] ? `${VERB[verb!]![0]!.toUpperCase()}${VERB[verb!]!.slice(1)} ${more.join(' ')}` : `${rest[0]!.toUpperCase()}${rest.slice(1)}`;
  }
  t = t.replace(new RegExp(`${esc} (\\S+)`, 'g'), (m, v: string) => (VERB[v] ? `eu ${VERB[v]}` : m));
  return t.replace(new RegExp(`\\b${esc}\\b`, 'g'), 'mim').replace(/para mim e os dois/, 'para mim, e nós dois').trim();
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
  if (today.length) { const f = firstPerson(a, today[0]!); out.push(`Hoje eu... ${f[0]!.toLowerCase()}${f.slice(1)}.`); }
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
export interface BoardNews {
  agenda: string[]; granary: string[]; tools: string; mutirao: string[]; supper: string[]; arrivals: string[]; later: number;
  rates: string[]; trades: string[]; favors: string[]; sick: string[]; mail: string[]; works: { done: string[]; next: string | null };
  wheat: string; fisher: string | null; friends: string[]; forecast: string; requests: { n: number; title: string }[]; count: number;
}
const hhmm = (t: number) => `${String(Math.floor(t / TICKS_PER_HOUR) % 24).padStart(2, '0')}:${String(Math.floor((t % TICKS_PER_HOUR) / (TICKS_PER_HOUR / 60))).padStart(2, '0')}`;
/** "hoje", "amanhã" ou o dia da semana de um dia absoluto */
function whenDay(sim: Simulation, day: number): string {
  const d = day - sim.today;
  if (d === 0) return 'hoje';
  if (d === 1) return 'amanhã';
  return new Date(day * DAY_MS + 12 * 3_600_000).toLocaleDateString('pt-BR', { weekday: 'long', day: 'numeric', month: 'numeric', timeZone: 'UTC' });
}
/** Quantos papéis novos o quadro tem (barato: roda a cada segundo para desenhar os papéis). */
export function boardCount(sim: Simulation): number {
  return sim.agents.filter(a => !a.meta.days && a.present).length + Math.min(3, sim.trades.length) + Math.min(3, sim.favors.length) + sim.requests.filter(q => q.state === 'open').length;
}
export function boardNews(sim: Simulation): BoardNews {
  const now = sim.tick, s = sim.stock;
  const arrivals = sim.agents.filter(a => !a.meta.days && a.present).map(a => a.name), later = sim.agents.filter(a => !a.meta.days && !a.present).length;
  const done = NEEDS.filter(([, n]) => sim.stars >= n).map(([k]) => k), nx = NEEDS.find(([, n]) => sim.stars < n);
  // melhor pescador: só o que pescou hoje (anotado no diário pelo nome exato)
  const catches = new Map<string, number>();
  for (const e of sim.log) if (e.kind === 'pesca') { const m = e.text.match(/^(\S+) pescou (?!uma bota)/); if (m) catches.set(m[1]!, (catches.get(m[1]!) ?? 0) + 1); }
  const fisher = [...catches].sort((p, q) => q[1] - p[1] || (p[0] < q[0] ? -1 : 1))[0];
  const friends = sim.log.filter(e => e.kind === 'amizade' && /viraram amigos|pazes|vizinhos|casal/.test(e.text)).slice(-4).map(e => e.text);
  const requests = sim.requests.filter(q => q.state === 'open').sort((p, q) => q.votes - p.votes || p.n - q.n).slice(0, 5).map(q => ({ n: q.n, title: q.votes ? `${q.title} (${q.votes} 👍)` : q.title }));
  const nh = sim.wheat.nextHarvest, nhDay = Math.floor((nh + (sim.world.timezoneOffsetHours ?? -3) * 3_600_000) / DAY_MS);
  const wheat = `${['Terra arada', 'Brotando', 'Trigo verde', 'Trigo dourado, quase na colheita'][sim.wheat.stage]}. Próxima colheita: ${whenDay(sim, nhDay)}.`;
  const agenda = sim.agenda.filter(e => e.kind !== 'mercador').map(e => `${hhmm(e.from)} ${e.name}${now >= e.from && now < e.to ? ' (agora!)' : now >= e.to ? ' (já foi)' : ''}`);
  if (sim.merchant && sim.agenda.some(e => e.kind === 'mercador')) agenda.push(`09:00–17:00 Mercador ${sim.merchant} no mercado, trocando sementes por histórias`);
  const granary = [
    `trigo ${sim.wheatStock} sacas${sim.low('trigo') ? ' ▼ falta' : ''}`,
    ...(['pão', 'peixe', 'legumes', 'ervas', 'sementes', 'lenha', 'pedra'] as const).map(g => `${g.padEnd(9, ' ')}${String(s[g]).padStart(3, ' ')}${sim.low(g) ? '  ▼ falta' : ''}`),
  ];
  const tools = `Galpão de ferramentas: ${sim.toolsOut} de ${sim.toolsTotal} emprestadas`;
  const nextP = sim.projects.find(p => !sim.projectBuilt(p)), built = sim.projects.filter(p => sim.projectBuilt(p)).map(p => `✓ ${p.name}`);
  const mutirao = [...built];
  if (nextP) {
    const mt = sim.agenda.find(e => e.kind === 'mutirão');
    if (nextP.day === sim.today && mt) mutirao.push(now < mt.from ? `→ ${nextP.name}: mutirão HOJE às ${hhmm(mt.from)}! Toda a vila vai` : `→ ${nextP.name}: mutirão acontecendo agora`);
    else mutirao.push(`→ ${nextP.name}: precisa de ${nextP.lenha} feixes de lenha e ${nextP.pedra} pedras`, `   no celeiro: ${s.lenha} de lenha, ${s.pedra} de pedra`, nextP.day !== null ? `   mutirão previsto: ${whenDay(sim, nextP.day)}, 15h` : '   ainda sem data');
  } else mutirao.push('Todas as obras de mutirão estão prontas!');
  const soup = sim.log.find(e => e.tick === sim.soupAt && /caldeirão/.test(e.text)), sup = sim.log.find(e => e.tick === sim.supperAt && /Ceia/.test(e.text));
  const supper = [soup ? soup.text : 'Sopa no caldeirão da ágora ao meio-dia', sup ? sup.text : `Ceia na taverna às 19:30${s['pão'] < 2 && s.peixe < 2 ? ' (o celeiro está curto: traga o que puder)' : ''}`];
  // trocas: quanto uma coisa vale em outra hoje, pela fartura do celeiro (sem moeda)
  const pairs: [string, number, string, number][] = [['pão', s['pão'], 'peixe', s.peixe], ['cesto de legumes', s.legumes, 'feixe de lenha', s.lenha], ['punhado de sementes', s.sementes, 'maço de ervas', s.ervas]];
  const rates = pairs.map(([a, na, b, nb]) => { const r = Math.max(1, Math.min(4, Math.round((nb + 1) / (na + 1)))); return r === 1 ? `1 ${a} ⇄ 1 ${b}` : `1 ${a} ⇄ ${r} ${b === 'peixe' ? 'peixes' : b.replace('feixe', 'feixes').replace('maço', 'maços')}`; });
  rates.push('1 cristal ⇄ uma boa história na roda');
  const trades = sim.trades.slice(-4).reverse().map(t => `${hhmm(t.tick)} ${t.text}`);
  const favors = sim.favors.slice(-3).reverse().map(f => `${f.to} agradece ${f.from} por ${f.what}`);
  const sick = sim.agents.filter(a => a.present && a.sickUntil > now).map(a => `${a.name} está de cama: leve uma sopa`);
  const letters = sim.letters.filter(l => l.tick <= now), gifts = letters.filter(l => l.gift);
  const mail = letters.length ? [`${letters.length} carta${letters.length > 1 ? 's' : ''} entregue${letters.length > 1 ? 's' : ''} hoje, ${gifts.length} com presente`, ...gifts.slice(-2).map(l => `${l.from} → ${l.to}: ${l.gift}`)] : [];
  return {
    agenda, granary, tools, mutirao, supper, arrivals, later, rates, trades, favors, sick, mail,
    works: { done, next: nx ? `${nx[0]} (faltam ${nx[1] - sim.stars} star${nx[1] - sim.stars > 1 ? 's' : ''})` : null },
    wheat, fisher: fisher ? `${fisher[0]} (${fisher[1]} peixe${fisher[1] > 1 ? 's' : ''})` : null,
    friends, forecast: forecast(sim), requests, count: boardCount(sim),
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

/** Conquistas do morador, tiradas do estado de hoje e do histórico (dias de vila). */
export function achievementsOf(sim: Simulation, a: Agent): { icon: string; name: string }[] {
  const days = a.meta.days ?? 0, out: { icon: string; name: string }[] = [];
  const first = [...sim.agents].sort((p, q) => (q.meta.days ?? 0) - (p.meta.days ?? 0))[0];
  if (first === a) out.push({ icon: '①', name: 'Primeiro morador' });
  if (days >= 30) out.push({ icon: '⌛', name: 'Veterano (30 dias)' }); else if (days >= 7) out.push({ icon: '☾', name: 'Uma semana de vila' });
  if (a.items.includes('um peixe dourado')) out.push({ icon: '🐟', name: 'Peixe dourado' });
  if (a.friends.length >= 5) out.push({ icon: '♥', name: 'Amigo de todos' });
  if (a.partner) out.push({ icon: '⌂', name: 'Mora com o par' });
  if (a.crystals > 0 || a.items.some(i => i.includes('cristal'))) out.push({ icon: '◆', name: 'Achou cristal' });
  if (sim.letters.some(l => l.to === a.name)) out.push({ icon: '✉', name: 'Recebeu carta' });
  if (sim.builders.has(a.name.toLowerCase())) out.push({ icon: '⚒', name: 'Construtor (PR aceito)' });
  if (sim.notes.has(a.name.toLowerCase())) out.push({ icon: '✎', name: 'Deixou recado' });
  if (sim.log.some(e => e.kind === 'trabalho' && e.text.startsWith(a.name) && e.text.includes('colheu'))) out.push({ icon: '✿', name: 'Colheu da horta' });
  if (a.state === 'SIGHT' && a.sight === 'floresta densa' || sim.log.some(e => e.kind === 'lenda' && e.text.includes(a.name))) out.push({ icon: '✦', name: 'Entrou na mata' });
  return out;
}
