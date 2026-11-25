import type { Noise3 } from '../core/noise';
import { h32 } from '../core/rng';

export type WeatherKind = 'limpo' | 'nublado' | 'neblina' | 'garoa' | 'chuva' | 'tempestade';
export interface Weather {
  /** nuvens, chuva, neblina e vento de 0 a 1 */
  cloud: number; rain: number; fog: number; wind: number;
  storm: boolean;
  kind: WeatherKind;
}

const clamp = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);

/**
 * Clima determinístico a partir do instante absoluto (horas desde 1970) e da hora local.
 * Ruído Perlin em escalas de horas: frentes de nuvem duram meio dia, pancadas uma ou duas horas,
 * neblina só de madrugada e de manhã cedo com pouco vento. Todo navegador vê o mesmo céu.
 */
export function weatherAt(noise: Noise3, absHours: number, localHour: number, bias = { sun: 0, fog: 0 }): Weather {
  const cloud = clamp(0.63 - bias.sun + 0.85 * noise(absHours / 9, 0.5, 9.3) + 0.35 * noise(absHours / 1.7, 2.5, 4.1));
  const rain = clamp((cloud - 0.6) * 3);
  const wind = clamp(0.3 + 0.9 * noise(absHours / 3.5, 5.5, 2.2) + rain * 0.25);
  const storm = rain > 0.8 && noise(absHours / 2.2, 7.7, 1.3) > 0;
  const morning = localHour >= 2 && localHour < 10 ? Math.sin(((localHour - 2) / 8) * Math.PI) : 0;
  const fog0 = clamp((noise(absHours / 5, 3.3, 8.8) + 0.25) * 2.4) * morning * clamp(1.2 - wind * 1.4) * (rain > 0.3 ? 0.4 : 1) + (rain > 0.3 ? 0 : bias.fog * (0.3 + morning * 0.7));
  const fog = clamp(fog0);
  const kind: WeatherKind = storm ? 'tempestade' : rain > 0.45 ? 'chuva' : rain > 0.12 ? 'garoa' : fog > 0.35 ? 'neblina' : cloud > 0.55 ? 'nublado' : 'limpo';
  return { cloud, rain, fog, wind: storm ? Math.max(wind, 0.8) : wind, storm, kind };
}

/** Relâmpago em tempestade: devolve o brilho (0 a 1) no segundo `ts`; o mesmo instante para todos. */
export function lightningAt(ts: number, seed: number): number {
  const k = Math.floor(ts / 0.7), f = ts / 0.7 - k;
  if (h32(k, 77, seed) % 14 !== 0) return 0;
  return f < 0.08 ? 1 : f < 0.16 ? 0.25 : f < 0.24 ? 0.8 : Math.max(0, 0.8 - (f - 0.24) * 3);
}

/** Trégua: em hora de compromisso marcado a chuva para e a tempestade passa longe. */
export function truce(w: Weather): Weather {
  const rain = Math.min(w.rain, 0.1), cloud = Math.min(w.cloud, 0.62), wind = Math.min(w.wind, 0.6);
  const kind: WeatherKind = w.fog > 0.35 ? 'neblina' : cloud > 0.55 ? 'nublado' : 'limpo';
  return { cloud, rain, fog: w.fog, wind, storm: false, kind };
}
