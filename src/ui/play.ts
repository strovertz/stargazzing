import { fnv, h32 } from '../core/rng';
import { COLS, DAY_MS, N, TICKS_PER_HOUR } from '../sim/constants';
import { moonPhase } from '../sim/extras';
import { hourAt, type Simulation } from '../sim/simulation';
import type { Agent } from '../sim/types';

/**
 * Jogo leve, todo do lado de quem visita (localStorage): não mexe na simulação.
 * X do tesouro (o mesmo lugar para todo mundo no dia), álbum de figurinhas dos eventos raros
 * que a pessoa viu acontecer, desejo na estrela cadente e morador favorito.
 */
export interface Sticker { id: string; icon: string; name: string; hint: string; cat: 'céu' | 'festas' | 'vila' | 'tesouro' }
export const STICKERS: Sticker[] = [
  { id: 'tesouro', icon: '✕', name: 'Caçador de tesouro', hint: 'Ache o X escondido no mapa', cat: 'tesouro' },
  { id: 'tesouro7', icon: '❖', name: 'Mapa completo', hint: 'Ache o tesouro em 7 dias diferentes', cat: 'tesouro' },
  { id: 'desejo', icon: '✦', name: 'Desejo feito', hint: 'Faça um pedido numa estrela cadente', cat: 'tesouro' },
  { id: 'meteoros', icon: '☄', name: 'Chuva de meteoros', hint: 'Esteja aqui numa noite de chuva de meteoros', cat: 'céu' },
  { id: 'eclipse', icon: '◐', name: 'Lua vermelha', hint: 'Veja um eclipse lunar', cat: 'céu' },
  { id: 'aurora', icon: '≈', name: 'Aurora', hint: 'Veja a aurora rara de inverno', cat: 'céu' },
  { id: 'luacheia', icon: '●', name: 'Lua cheia', hint: 'Visite numa noite de lua cheia', cat: 'céu' },
  { id: 'tempestade', icon: 'ϟ', name: 'Tempestade', hint: 'Fique durante uma tempestade', cat: 'céu' },
  { id: 'colheita', icon: '♣', name: 'Festa da colheita', hint: 'Esteja na festa da colheita', cat: 'festas' },
  { id: 'solsticio', icon: '☀', name: 'Lanternas do solstício', hint: 'Veja as lanternas do solstício', cat: 'festas' },
  { id: 'equinocio', icon: '⚖', name: 'Equinócio', hint: 'Esteja na festa do equinócio', cat: 'festas' },
  { id: 'versao', icon: '✺', name: 'Festa de versão', hint: 'Veja os fogos de uma release nova', cat: 'festas' },
  { id: 'aniversario', icon: '♥', name: 'Aniversário de vila', hint: 'Vá a uma festa de aniversário', cat: 'festas' },
  { id: 'dourado', icon: '◆', name: 'Peixe dourado', hint: 'Veja alguém pescar o peixe dourado', cat: 'vila' },
  { id: 'cavalo', icon: '♞', name: 'Cavaleiro', hint: 'Veja um fork chegar a cavalo', cat: 'vila' },
  { id: 'cadente', icon: '✧', name: 'Estrela cadente', hint: 'Veja uma estrela cadente', cat: 'céu' },
  { id: 'coruja', icon: 'ʘ', name: 'Coruja', hint: 'Visite entre 3h e 4h da manhã', cat: 'vila' },
  { id: 'nascer', icon: '◒', name: 'Nascer do sol', hint: 'Esteja aqui às 6h', cat: 'vila' },
  // novas figurinhas entram sempre no fim: a posição é o bit no código do álbum
  { id: 'conselho', icon: '⚑', name: 'Conselho', hint: 'Assista ao conselho de quarta às 19h', cat: 'vila' },
  { id: 'vagalumes', icon: '∴', name: 'Corrida de vaga-lumes', hint: 'Veja a corrida de sexta às 20h', cat: 'vila' },
];
const FEST: Record<string, string> = { colheita: 'colheita', 'solstício': 'solsticio', 'equinócio': 'equinocio', 'versão': 'versao', 'aniversário': 'aniversario' };

interface Seen { t: number; n: number; d: string }
function loadAlbum(): Record<string, Seen> {
  const out: Record<string, Seen> = {};
  try {
    Object.assign(out, JSON.parse(localStorage.getItem('album2') ?? '{}') as Record<string, Seen>);
    for (const id of JSON.parse(localStorage.getItem('album') ?? '[]') as string[]) out[id] ??= { t: Date.now(), n: 1, d: '' }; // formato antigo
  } catch { /* modo privado */ }
  return out;
}

/** Figurinha desenhada em pixel: fundo da categoria, estrelinhas ou chão, e o símbolo grande no meio. */
function stickerArt(s: Sticker, on: boolean, k: number): HTMLCanvasElement {
  const c = document.createElement('canvas'), S = 24, px = 3;
  c.width = c.height = S * px;
  c.setAttribute('aria-hidden', 'true');
  const g = c.getContext('2d')!;
  const pal: Record<Sticker['cat'], [string, string, string]> = { 'céu': ['#0b1430', '#1f2f66', '#fff6c8'], festas: ['#3a1424', '#7a2c3a', '#ffd36a'], vila: ['#102418', '#2f5a34', '#e9f5c8'], tesouro: ['#2a1d0c', '#6b4a1c', '#ffe08a'] };
  const [a, b, ink] = on ? pal[s.cat] : ['#15191c', '#22282c', '#3a4247'];
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    const t = y / S + ((x + y) % 2 ? 0.04 : 0);
    g.fillStyle = t < 0.5 ? a : b;
    g.fillRect(x * px, y * px, px, px);
  }
  if (on) {
    g.fillStyle = ink;
    for (let i = 0; i < 9; i++) { const h = h32(k, i, 7); if (s.cat === 'céu' || h % 3 === 0) g.fillRect((h % S) * px, ((h >>> 8) % (S / 2)) * px, px, px); }
    if (s.cat === 'vila') { g.fillStyle = '#3f7a3a'; g.fillRect(0, (S - 5) * px, S * px, 5 * px); }
    if (s.cat === 'tesouro') { g.fillStyle = '#8a6a34'; g.fillRect(0, (S - 5) * px, S * px, 5 * px); }
  }
  g.fillStyle = on ? ink : '#4a5459';
  g.font = `700 ${on ? 40 : 34}px "Pixelify Sans","JetBrains Mono",monospace`;
  g.textAlign = 'center'; g.textBaseline = 'middle';
  g.shadowColor = 'rgba(0,0,0,.6)'; g.shadowOffsetY = 3;
  g.fillText(on ? s.icon : '?', (S * px) / 2, (S * px) / 2 + 2);
  return c;
}

const get = (k: string): string | null => { try { return localStorage.getItem(k); } catch { return null; } };
const put = (k: string, v: string): void => { try { localStorage.setItem(k, v); } catch { /* modo privado */ } };

/** Lugar do X do dia: depende só do dia e da semente, então é o mesmo para todo mundo. */
export function treasureFor(sim: Simulation): { x: number; y: number } {
  const day = Math.floor(sim.genesis / DAY_MS), seed = sim.terrain.seed, ag = sim.terrain.agora;
  for (let k = 0; k < 400; k++) {
    const i = h32(day, k, seed + 17) % N, x = i % COLS, y = (i / COLS) | 0;
    if (y < 3 || x < 3 || x > COLS - 4 || !sim.terrain.passable(i)) continue;
    if (Math.abs(x - ag.x) < ag.rx + 2 && Math.abs(y - ag.y) < ag.ry + 2) continue;
    return { x, y };
  }
  return { x: ag.x, y: ag.y + ag.ry + 2 };
}

export class Play {
  /** figurinha -> quando foi vista pela primeira vez e quantas vezes */
  album = loadAlbum();
  private logSeen = 0;
  private dayKey = '';
  constructor(private toast: (text: string) => void) {}

  /** Recomeço do dia (ou primeira carga): só conta o que acontecer daqui para frente. */
  reset(sim: Simulation): void { this.logSeen = sim.log.length; this.dayKey = String(sim.genesis); }

  found(sim: Simulation): boolean { return get(`tesouro:${sim.genesis}`) === '1'; }
  treasureDays(): number { return Number(get('tesouros') ?? 0); }
  dig(sim: Simulation): void {
    if (this.found(sim)) return;
    put(`tesouro:${sim.genesis}`, '1');
    const n = this.treasureDays() + 1;
    put('tesouros', String(n));
    const loot = ['uma moeda antiga', 'um mapa rasgado', 'uma pena de coruja', 'uma bússola enferrujada', 'um cristal azul', 'uma concha do lago', 'um botão de bronze'][h32(sim.genesis / DAY_MS, 3, sim.terrain.seed) % 7]!;
    this.toast(`Você cavou no X e achou ${loot}! Tesouros achados: ${n}`);
    this.award('tesouro');
    if (n >= 7) this.award('tesouro7');
  }

  /** Estrela cadente visível agora (ou noite de chuva de meteoros): dá para fazer um pedido. */
  canWish(sim: Simulation, tf: number): boolean {
    if (get(`desejo:${sim.genesis}`) === '1') return false;
    const h = hourAt(sim.tick), night = h >= 20 || h < 5;
    return (tf - sim.shootingAt >= 0 && tf - sim.shootingAt < 14) || (night && sim.sky?.kind === 'meteoros' && sim.weather().cloud < 0.7);
  }
  wish(sim: Simulation): void {
    put(`desejo:${sim.genesis}`, '1');
    const n = Number(get('desejos') ?? 0) + 1;
    put('desejos', String(n));
    this.toast(n === 1 ? 'Você fechou os olhos e fez um pedido. Segredo seu e da estrela.' : `Mais um pedido para a estrela (${n} até agora).`);
    this.award('desejo');
  }

  award(id: string): void {
    const day = this.dayKey, e = this.album[id];
    if (e) { if (e.d !== day) { e.n++; e.d = day; put('album2', JSON.stringify(this.album)); } return; }
    this.album[id] = { t: Date.now(), n: 1, d: day };
    put('album2', JSON.stringify(this.album));
    const s = STICKERS.find(x => x.id === id);
    if (s) this.toast(`Figurinha nova no álbum: ${s.icon} ${s.name}`);
  }

  /** Chamado uma vez por segundo: vê o que está acontecendo agora e cola as figurinhas. */
  check(sim: Simulation): void {
    if (this.dayKey !== String(sim.genesis)) this.reset(sim);
    const h = hourAt(sim.tick), night = h >= 20 || h < 5, w = sim.weather();
    if (sim.sky && night && w.cloud < 0.7) this.award(sim.sky.kind);
    if (night && w.cloud < 0.6) { const ph = moonPhase(sim.genesis + sim.tick * 500); if (Math.abs(ph - 0.5) < 0.035) this.award('luacheia'); }
    if (w.storm) this.award('tempestade');
    const call = sim.calledAt();
    if (call?.kind === 'conselho') this.award('conselho');
    if (call?.kind === 'vaga-lumes') this.award('vagalumes');
    const f = sim.festivalAt();
    if (f && FEST[f.kind]) this.award(FEST[f.kind]!);
    if (h >= 3 && h < 4) this.award('coruja');
    if (h >= 6 && h < 6.25) this.award('nascer');
    for (; this.logSeen < sim.log.length; this.logSeen++) {
      const t = sim.log[this.logSeen]!.text;
      if (t.includes('peixe dourado')) this.award('dourado');
      else if (t.includes('chegou a cavalo')) this.award('cavalo');
      else if (t.includes('estrela cadente')) this.award('cadente');
    }
  }

  favorite(): string | null { return get('favorito'); }
  setFavorite(login: string | null): void { if (login) put('favorito', login); else try { localStorage.removeItem('favorito'); } catch { /* modo privado */ } }

  /** "Desde a sua última visita": o que o favorito fez entre a última visita e agora (no dia de hoje). */
  sinceLast(sim: Simulation, fav: Agent): string[] {
    const last = Number(get('ultimaVisita') ?? 0), from = Math.max(0, Math.floor((last - sim.genesis) / 500));
    const name = fav.name;
    const out = sim.log.filter(e => e.tick >= from && e.tick <= sim.tick && e.text.includes(name)).slice(-4).map(e => e.text);
    if (!out.length && fav.present) out.push(`${name} passou o tempo tranquilo pela vila`);
    if (!fav.present) out.push(`${name} chega hoje às ${String(Math.floor(fav.arriveTick / TICKS_PER_HOUR)).padStart(2, '0')}h`);
    return out;
  }
  markVisit(ms: number): void { put('ultimaVisita', String(ms)); }
  lastVisit(): number { return Number(get('ultimaVisita') ?? 0); }

  /** Código curto com o álbum, para levar a outro navegador ou aparelho (sem login). */
  code(): string {
    let mask = 0;
    STICKERS.forEach((x, i) => { if (this.album[x.id]) mask += 2 ** i; });
    const body = `${mask.toString(36)}-${this.treasureDays().toString(36)}-${Number(get('desejos') ?? 0).toString(36)}`;
    return `${body}-${(fnv(body) % 1296).toString(36).padStart(2, '0')}`;
  }
  /** Junta um código ao álbum daqui (nunca apaga nada). Devolve quantas figurinhas entraram. */
  importCode(code: string): number | null {
    const m = code.trim().toLowerCase().match(/^([0-9a-z]+)-([0-9a-z]+)-([0-9a-z]+)-([0-9a-z]{2})$/);
    if (!m || (fnv(`${m[1]}-${m[2]}-${m[3]}`) % 1296).toString(36).padStart(2, '0') !== m[4]) return null;
    const mask = parseInt(m[1]!, 36);
    let added = 0;
    STICKERS.forEach((x, i) => { if (Math.floor(mask / 2 ** i) % 2 && !this.album[x.id]) { this.album[x.id] = { t: Date.now(), n: 1, d: 'importada' }; added++; } });
    put('album2', JSON.stringify(this.album));
    put('tesouros', String(Math.max(this.treasureDays(), parseInt(m[2]!, 36))));
    put('desejos', String(Math.max(Number(get('desejos') ?? 0), parseInt(m[3]!, 36))));
    return added;
  }

  renderAlbum(el: HTMLElement): void {
    el.textContent = '';
    const got = STICKERS.filter(x => this.album[x.id]).length, tes = this.treasureDays(), wishes = Number(get('desejos') ?? 0);
    const top = document.createElement('div');
    top.className = 'alb-top';
    const bar = document.createElement('div'), fill = document.createElement('i');
    bar.className = 'alb-bar'; fill.style.width = `${(got / STICKERS.length) * 100}%`; bar.append(fill);
    bar.setAttribute('role', 'progressbar'); bar.setAttribute('aria-valuemin', '0'); bar.setAttribute('aria-valuemax', String(STICKERS.length)); bar.setAttribute('aria-valuenow', String(got));
    const nums = document.createElement('p');
    nums.innerHTML = '';
    nums.textContent = `${got} de ${STICKERS.length} figurinhas · ${tes} tesouro${tes === 1 ? '' : 's'} · ${wishes} desejo${wishes === 1 ? '' : 's'}`;
    top.append(nums, bar);
    el.append(top);
    const CATS: [Sticker['cat'], string][] = [['céu', 'Céu'], ['festas', 'Festas'], ['vila', 'Vida na vila'], ['tesouro', 'Tesouros e desejos']];
    for (const [cat, title] of CATS) {
      const list = STICKERS.filter(x => x.cat === cat), h = document.createElement('h3');
      h.textContent = `${title} · ${list.filter(x => this.album[x.id]).length}/${list.length}`;
      const grid = document.createElement('div');
      grid.className = 'album';
      for (const s of list) {
        const e = this.album[s.id], d = document.createElement('figure');
        d.className = e ? 'stk on' : 'stk';
        d.append(stickerArt(s, !!e, STICKERS.indexOf(s)));
        const cap = document.createElement('figcaption'), nm = document.createElement('b'), sub = document.createElement('span');
        nm.textContent = e ? s.name : '???';
        sub.textContent = e ? (e.d === 'importada' ? 'trazida de outro aparelho' : `${new Date(e.t).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' })}${e.n > 1 ? ` · ${e.n} dias` : ''}`) : s.hint;
        cap.append(nm, sub);
        d.append(cap);
        d.setAttribute('aria-label', e ? `${s.name}, conseguida` : `Falta: ${s.hint}`);
        grid.append(d);
      }
      el.append(h, grid);
    }
    // levar o álbum para outro aparelho: código curto, sem conta nem login
    const sync = document.createElement('div');
    sync.className = 'alb-sync';
    const h = document.createElement('h3'); h.textContent = 'Levar para outro aparelho';
    const p = document.createElement('p'); p.className = 'bio';
    p.textContent = 'O álbum fica neste navegador. Para continuar em outro, copie o código aqui e cole lá (ou abra o link). Nada é enviado para servidor.';
    const code = this.code(), row = document.createElement('div'); row.className = 'alb-row';
    const out = document.createElement('code'); out.textContent = code;
    const cp = document.createElement('button'); cp.textContent = 'copiar link';
    cp.addEventListener('click', () => { void navigator.clipboard?.writeText(`${location.origin}${location.pathname}#album=${code}`).then(() => { cp.textContent = 'copiado ✓'; }); });
    row.append(out, cp);
    const inRow = document.createElement('div'); inRow.className = 'alb-row';
    const inp = document.createElement('input'); inp.placeholder = 'colar código'; inp.setAttribute('aria-label', 'Código do álbum de outro aparelho'); inp.className = 'search';
    const go = document.createElement('button'); go.textContent = 'juntar';
    go.addEventListener('click', () => { const n = this.importCode(inp.value); this.toast(n === null ? 'Código inválido' : `Álbum juntado: ${n} figurinha${n === 1 ? '' : 's'} nova${n === 1 ? '' : 's'}`); if (n !== null) this.renderAlbum(el); });
    inRow.append(inp, go);
    sync.append(h, p, row, inRow);
    el.append(sync);
  }

}
