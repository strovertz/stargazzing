import type { Snapshot } from '../sim/snapshot';

/** Checkpoint do dia no IndexedDB (cabe o estado inteiro, com os vetores tipados como estão). */
const DB = 'stargazzing', OS = 'snap';
function open(): Promise<IDBDatabase> {
  return new Promise((res, rej) => {
    const r = indexedDB.open(DB, 1);
    r.onupgradeneeded = () => r.result.createObjectStore(OS);
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
}
export async function loadSnap(key: string): Promise<Snapshot | null> {
  try {
    const db = await open();
    return await new Promise(res => {
      const q = db.transaction(OS).objectStore(OS).get('day');
      q.onsuccess = () => { const s = q.result as Snapshot | undefined; res(s && s.key === key ? s : null); };
      q.onerror = () => res(null);
    });
  } catch { return null; }
}
export async function saveSnap(s: Snapshot): Promise<void> {
  try {
    const db = await open();
    db.transaction(OS, 'readwrite').objectStore(OS).put(s, 'day');
  } catch { /* modo privado ou sem espaço: só fica mais lento na próxima visita */ }
}
