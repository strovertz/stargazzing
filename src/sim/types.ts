import type { RGB } from '../core/color';
import type { Rng } from '../core/rng';
import type { Hat } from './constants';

export interface LogEntry { tick: number; text: string; kind: 'chegada' | 'clima' | 'obra' | 'pesca' | 'evento' | 'céu' | 'encontro' | 'trabalho' | 'lenda' | 'amizade' | 'github' }

export type State = 'CAMP' | 'FARM' | 'SELL' | 'BAKE' | 'MAIL' | 'GAME' | 'ARRIVE' | 'PLANT' | 'WANDER' | 'WATER' | 'REST' | 'VISIT' | 'GATHER' | 'FISH' | 'CHAT' | 'AGORA' | 'CHOP' | 'PLAY' | 'GARDEN' | 'BOAT' | 'SIGHT' | 'MINE' | 'BUCKET' | 'TASK';
export type Phase = 'go' | 'stay' | 'walk' | 'boid';

export interface Look { skin: string; hair: string; shirt: string; pants: string; hat: Hat; hatc: string; beard?: boolean }
export interface Traits { energy: number; social: number; gardener: number; wander: number }
export interface Point { x: number; y: number }
export interface Plaza extends Point { main: boolean }

export interface Tree { x: number; y: number; sp: number; growth: number; lastWater: number; /** dias desde o plantio (árvores antigas ficam enormes) */ age?: number }
export interface WildTree { x: number; y: number; big: boolean; sp: number; /** árvore do pomar, com frutas */ fruit?: boolean }
/** Marco espalhado pelo mapa: moinho, torre de vigia, círculo de pedras, barraca de acampamento, ponte. */
export interface Landmark { kind: 'moinho' | 'torre' | 'pedras' | 'barraca' | 'ponte' | 'caverna' | 'templo' | 'quadro' | 'pântano' | 'cogumelos' | 'pomar' | 'pedreira' | 'praia' | 'cercado' | 'floresta' | 'mirante'; x: number; y: number; w: number; v: number }
/** Coluna da ágora: 0 inteira, 1 quebrada, 2 caída (tambores no chão). */
export interface Column { x: number; y: number; kind: 0 | 1 | 2; h: number }

export interface AgentMeta { days?: number; local?: boolean; starredAt?: number }

export interface Agent {
  name: string;
  r: Rng;
  hue: number;
  col: RGB;
  look: Look;
  species: number;
  pace: number;
  traits: Traits;
  arriveTick: number;
  meta: AgentMeta;
  present: boolean;
  x: number; y: number;
  /** posição anterior e tick do último passo, para o render interpolar */
  px: number; py: number; mt: number;
  face: 1 | -1;
  state: State;
  phase: Phase;
  wait: number;
  path: number[];
  dir: number;
  steps: number;
  boidLeft: number;
  mv: [number, number];
  tree: Tree | null;
  friend: Agent | null;
  plaza: Plaza | null;
  bubble: string;
  bubbleUntil: number;
  hut: boolean;
  home: Point;
  /** último tick em que conversou ou acenou, para não ficar tagarelando sem parar */
  chatAt: number;
  /** índice em PROFS */
  prof: number;
  /** amigos e rivais (afinidade pelos nomes) e par, se morar ao lado de alguém */
  friends: Agent[];
  rivals: Agent[];
  partner: Agent | null;
  /** dentro da caverna (não aparece) e cristais trazidos hoje */
  inside: boolean;
  crystals: number;
  /** marco que está visitando */
  sight?: string;
  /** índice em HOUSES */
  house: number;
  /** índice em INSTRUMENTS (só músicos tocam) */
  instrument: number;
  /** bicho de estimação: índice em PETS e nome, ou null */
  pet: { kind: number; name: string } | null;
  /** coisas que juntou ou ganhou hoje (peixe dourado, cristal, flor, presentes) */
  items: string[];
  /** coruja: fica acordado até tarde */
  owl: boolean;
}

/** Uma entrada de public/world.json. Dados reais usam starredAt; a demo usa daysAgo ou todayHour. */
export interface StargazerEntry { login: string; starredAt?: string; daysAgo?: number; todayHour?: number }
export interface WorldFile {
  repo: string;
  seed: string;
  timezoneOffsetHours: number;
  demo?: boolean;
  generatedAt?: string;
  stargazers: StargazerEntry[];
  /** logins que tiraram a star: a casa fica vazia, com placa */
  former?: string[];
  /** dados do GitHub juntados na hora de carregar (não ficam no world.json) */
  extra?: RepoData;
}

/** Dados do repositório buscados no deploy (public/repo.json), todos opcionais. */
export interface RepoData {
  forks?: { login: string; at: string }[];
  requests?: { n: number; title: string; state: 'open' | 'closed'; closedAt?: string; votes?: number }[];
  /** issues com a label "recado": viram bilhete na porta da casa de quem escreveu */
  notes?: { n: number; login: string; text: string; at: string }[];
  /** releases publicadas: dia de festa com fogos */
  releases?: { tag: string; name: string; at: string }[];
  /** autores de pull requests aceitos: ganham chapéu de construtor */
  builders?: string[];
  /** commits por dia (AAAA-MM-DD, UTC) nos últimos 14 dias */
  commits?: Record<string, number>;
  followers?: string[];
}
