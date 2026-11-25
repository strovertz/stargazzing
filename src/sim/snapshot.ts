import { mulberry32 } from '../core/rng';
import type { Simulation } from './simulation';

/**
 * Foto do estado da simulação, para retomar sem refazer o dia inteiro.
 * Guarda o grafo de objetos com referências (um morador apontando para o amigo continua
 * apontando para o mesmo objeto), os vetores tipados como bytes e os sorteadores pelo estado.
 * Ao restaurar, tudo é escrito por cima de uma Simulation nova, feita com o mesmo world.json.
 */
export interface Snapshot { v: number; key: string; tick: number; root: Enc }
type Enc = null | boolean | number | string | Enc[] | { [k: string]: Enc } | ArrayBufferView;

/** Campos que não entram: entrada fixa, buffers de rascunho do A* e o ruído do terreno. */
const SKIP = new Set(['world', 'genesis', 'noise', 'seed', 'gScore', 'closed', 'heapN', 'heapF', 'prev', 'seen']);
const TYPED: Record<string, new (b: ArrayBuffer) => ArrayBufferView> = { Uint8Array, Int8Array, Uint16Array, Int32Array, Uint32Array, Float32Array, Float64Array };
export const SNAP_V = 1;

export function encode(sim: Simulation, key: string): Snapshot {
  const ids = new Map<object, number>();
  let next = 0;
  const enc = (v: unknown): Enc => {
    if (v === undefined) return { $u: 1 };
    if (v === null) return null;
    const t = typeof v;
    if (t === 'number' || t === 'string' || t === 'boolean') return v as Enc;
    if (t === 'function') {
      if (typeof (v as { s?: unknown }).s !== 'number') throw new Error('função sem estado no snapshot');
      return { $r: (v as { s: number }).s };
    }
    const o = v as object;
    const seen = ids.get(o);
    if (seen !== undefined) return { $ref: seen };
    const id = next++;
    ids.set(o, id);
    if (ArrayBuffer.isView(o)) return { $id: id, $ta: o.constructor.name, d: (o as Uint8Array).slice() };
    if (Array.isArray(o)) return { $id: id, $a: o.map(enc) };
    if (o instanceof Map) return { $id: id, $m: [...o].map(([k, x]) => [enc(k), enc(x)]) };
    if (o instanceof Set) return { $id: id, $s: [...o].map(enc) };
    const out: Record<string, Enc> = { $id: id };
    for (const [k, x] of Object.entries(o)) if (!SKIP.has(k)) out[k] = enc(x);
    return out;
  };
  return { v: SNAP_V, key, tick: sim.tick, root: enc(sim) };
}

/** Escreve a foto por cima de `sim` (recém-criada com a mesma entrada). */
export function restore(sim: Simulation, snap: Snapshot): void {
  const objs = new Map<number, unknown>();
  const dec = (e: Enc, into?: unknown): unknown => {
    if (e === null || typeof e !== 'object') return e === null ? null : e;
    if (ArrayBuffer.isView(e)) return e;
    const o = e as Record<string, Enc>;
    if ('$u' in o) return undefined;
    if ('$ref' in o) return objs.get(o.$ref as number);
    if ('$r' in o) { const r = mulberry32(0); r.s = o.$r as number; return r; }
    const id = o.$id as number;
    if ('$ta' in o) {
      const src = o.d as ArrayBufferView, C = TYPED[o.$ta as string]!;
      const arr = into && ArrayBuffer.isView(into) && into.constructor === C ? into as Uint8Array : new C(new ArrayBuffer(src.byteLength)) as Uint8Array;
      new Uint8Array(arr.buffer, arr.byteOffset, arr.byteLength).set(new Uint8Array(src.buffer, src.byteOffset, src.byteLength));
      objs.set(id, arr); return arr;
    }
    if ('$a' in o) { const a: unknown[] = []; objs.set(id, a); for (const x of o.$a as Enc[]) a.push(dec(x)); return a; }
    if ('$m' in o) { const m = new Map(); objs.set(id, m); for (const [k, x] of o.$m as [Enc, Enc][]) m.set(dec(k), dec(x)); return m; }
    if ('$s' in o) { const s = new Set(); objs.set(id, s); for (const x of o.$s as Enc[]) s.add(dec(x)); return s; }
    // objeto: classes (Simulation, Terrain) recebem os campos no lugar; o resto vira objeto novo
    const keep = into && typeof into === 'object' && Object.getPrototypeOf(into) !== Object.prototype && !Array.isArray(into);
    const t = (keep ? into : {}) as Record<string, unknown>;
    objs.set(id, t);
    for (const [k, x] of Object.entries(o)) if (k !== '$id') t[k] = dec(x, keep ? t[k] : undefined);
    return t;
  };
  dec(snap.root, sim);
}
