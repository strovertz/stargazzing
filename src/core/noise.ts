import { mulberry32 } from './rng';

export type Noise3 = (x: number, y: number, z?: number) => number;

/** Ruído Perlin 3D clássico com tabela de permutação embaralhada pela semente. */
export function makeNoise(seed: number): Noise3 {
  const r = mulberry32(seed);
  const p = new Uint8Array(512);
  const b = Array.from({ length: 256 }, (_, i) => i);
  for (let i = 255; i > 0; i--) {
    const j = Math.floor(r() * (i + 1));
    const t = b[i]!;
    b[i] = b[j]!;
    b[j] = t;
  }
  for (let i = 0; i < 512; i++) p[i] = b[i & 255]!;
  const fade = (t: number) => t * t * t * (t * (t * 6 - 15) + 10);
  const lerp = (a: number, c: number, t: number) => a + t * (c - a);
  const g = (h: number, x: number, y: number, z: number) => {
    h &= 15;
    const u = h < 8 ? x : y;
    const v = h < 4 ? y : h === 12 || h === 14 ? x : z;
    return (h & 1 ? -u : u) + (h & 2 ? -v : v);
  };
  return (x, y, z = 0) => {
    const fx = Math.floor(x), fy = Math.floor(y), fz = Math.floor(z);
    const X = fx & 255, Y = fy & 255, Z = fz & 255;
    x -= fx; y -= fy; z -= fz;
    const u = fade(x), v = fade(y), w = fade(z);
    const A = p[X]! + Y, AA = p[A]! + Z, AB = p[A + 1]! + Z;
    const B = p[X + 1]! + Y, BA = p[B]! + Z, BB = p[B + 1]! + Z;
    return lerp(
      lerp(lerp(g(p[AA]!, x, y, z), g(p[BA]!, x - 1, y, z), u), lerp(g(p[AB]!, x, y - 1, z), g(p[BB]!, x - 1, y - 1, z), u), v),
      lerp(lerp(g(p[AA + 1]!, x, y, z - 1), g(p[BA + 1]!, x - 1, y, z - 1), u), lerp(g(p[AB + 1]!, x, y - 1, z - 1), g(p[BB + 1]!, x - 1, y - 1, z - 1), u), v),
      w,
    );
  };
}
