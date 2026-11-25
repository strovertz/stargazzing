/** Hash FNV-1a de 32 bits: transforma um texto (login, nome do repo) numa semente estável. */
export function fnv(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** Sorteador: a função devolve [0, 1); `s` guarda o estado, para salvar e retomar a simulação. */
export type Rng = (() => number) & { s: number };

/** PRNG mulberry32: rápido, 32 bits, totalmente determinístico. */
export function mulberry32(seed: number): Rng {
  const f = (() => {
    const a = (f.s + 0x6d2b79f5) | 0;
    f.s = a;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }) as Rng;
  f.s = seed | 0;
  return f;
}

/** Hash inteiro de três números, para sorteios por célula sem guardar estado. */
export function h32(a: number, b: number, c: number): number {
  let h = Math.imul(a, 374761393) + Math.imul(b, 668265263) + Math.imul(c, 2246822519);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return (h ^ (h >>> 16)) >>> 0;
}
