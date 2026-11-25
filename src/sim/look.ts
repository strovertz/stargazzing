import { css, hex, hsl, mix } from '../core/color';
import { fnv, mulberry32, type Rng } from '../core/rng';
import { HAIR, HATS, PANTS, SKIN } from './constants';
import type { Look } from './types';

/**
 * Aparência a partir do login, sem DOM: usada pela simulação, pelo canvas e pelos cartões SVG.
 * Consome sempre os mesmos 7 números do PRNG do morador, na mesma ordem.
 */
export function lookFrom(r: Rng): { hue: number; look: Look } {
  const hue = Math.floor(r() * 360);
  const pick = <T>(arr: readonly T[]) => arr[Math.floor(r() * arr.length)]!;
  const look: Look = {
    skin: pick(SKIN), hair: pick(HAIR), shirt: css(hsl(hue, 0.62, 0.55)), pants: pick(PANTS),
    hat: pick(HATS), hatc: css(hsl((hue + 150 + r() * 60) % 360, 0.6, 0.55)),
  };
  return { hue, look };
}

/** Envelhecimento: grisalho com 7 dias de vila, cabelo branco com 60, barba (para metade) com 30. */
export function age(look: Look, name: string, days: number): Look {
  const out = { ...look };
  const toHex = (c: [number, number, number]) => `#${c.map(v => Math.round(v).toString(16).padStart(2, '0')).join('')}`;
  if (look.hair.startsWith('#') && days >= 7) out.hair = toHex(mix(hex(look.hair), hex('#d8d8d4'), days >= 60 ? 0.85 : 0.45));
  if (days >= 30 && fnv(name.toLowerCase() + '#beard') % 2 === 0) out.beard = true;
  return out;
}

export function lookFor(name: string, days = 0): { hue: number; look: Look } {
  const { hue, look } = lookFrom(mulberry32(fnv(name.toLowerCase())));
  return { hue, look: age(look, name, days) };
}
