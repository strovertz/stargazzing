import type { RGB } from '../core/color';
import type { Rng } from '../core/rng';
import type { Hat } from './constants';

export type State = 'ARRIVE' | 'PLANT' | 'WANDER' | 'WATER' | 'REST' | 'VISIT' | 'GATHER';
export type Phase = 'go' | 'stay' | 'walk' | 'boid';

export interface Look { skin: string; hair: string; shirt: string; pants: string; hat: Hat; hatc: string }
export interface Traits { energy: number; social: number; gardener: number; wander: number }
export interface Point { x: number; y: number }
export interface Plaza extends Point { main: boolean }

export interface Tree { x: number; y: number; sp: number; growth: number; lastWater: number }
export interface WildTree { x: number; y: number; big: boolean; sp: number }

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
}
