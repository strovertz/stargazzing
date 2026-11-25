import { h32 } from '../core/rng';
import { COLS, DAY_MS, N, TICKS_PER_HOUR } from '../sim/constants';
import { moonPhase } from '../sim/extras';
import { hourAt, type Simulation } from '../sim/simulation';
import type { Agent } from '../sim/types';

/**
 * Jogo leve, todo do lado de quem visita (localStorage): não mexe na simulação.
 * X do tesouro (o mesmo lugar para todo mundo no dia), álbum de figurinhas dos eventos raros
 * que a pessoa viu acontecer, desejo na estrela cadente e morador favorito.
 */
export interface Sticker { id: string; icon: string; name: string; hint: string }
export const STICKERS: Sticker[] = [
  { id: 'tesouro', icon: '✕', name: 'Caçador de tesouro', hint: 'Ache o X escondido no mapa' },
  { id: 'tesouro7', icon: '🗝', name: 'Mapa completo', hint: 'Ache o tesouro em 7 dias diferentes' },
  { id: 'desejo', icon: '✦', name: 'Desejo feito', hint: 'Faça um pedido numa estrela cadente' },
  { id: 'meteoros', icon: '☄', name: 'Chuva de meteoros', hint: 'Esteja aqui numa noite de chuva de meteoros' },
  { id: 'eclipse', icon: '◐', name: 'Lua vermelha', hint: 'Veja um eclipse lunar' },
  { id: 'aurora', icon: '≈', name: 'Aurora', hint: 'Veja a aurora rara de inverno' },
  { id: 'luacheia', icon: '●', name: 'Lua cheia', hint: 'Visite numa noite de lua cheia' },
  { id: 'tempestade', icon: 'ϟ', name: 'Tempestade', hint: 'Fique durante uma tempestade' },
  { id: 'colheita', icon: '♣', name: 'Festa da colheita', hint: 'Esteja na festa da colheita' },
  { id: 'solsticio', icon: '☀', name: 'Lanternas do solstício', hint: 'Veja as lanternas do solstício' },
  { id: 'equinocio', icon: '⚖', name: 'Equinócio', hint: 'Esteja na festa do equinócio' },
  { id: 'versao', icon: '✺', name: 'Festa de versão', hint: 'Veja os fogos de uma release nova' },
  { id: 'aniversario', icon: '♥', name: 'Aniversário de vila', hint: 'Vá a uma festa de aniversário' },
  { id: 'dourado', icon: '◆', name: 'Peixe dourado', hint: 'Veja alguém pescar o peixe dourado' },
  { id: 'cavalo', icon: '♞', name: 'Cavaleiro', hint: 'Veja um fork chegar a cavalo' },
  { id: 'cadente', icon: '✧', name: 'Estrela cadente', hint: 'Veja uma estrela cadente' },
  { id: 'coruja', icon: 'ʘ', name: 'Coruja', hint: 'Visite entre 3h e 4h da manhã' },
  { id: 'nascer', icon: '◒', name: 'Nascer do sol', hint: 'Esteja aqui às 6h' },
];
const FEST: Record<string, string> = { colheita: 'colheita', 'solstício': 'solsticio', 'equinócio': 'equinocio', 'versão': 'versao', 'aniversário': 'aniversario' };

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
  album = new Set<string>(JSON.parse(get('album') ?? '[]') as string[]);
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
    if (this.album.has(id)) return;
    this.album.add(id);
    put('album', JSON.stringify([...this.album]));
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

  renderAlbum(el: HTMLElement): void {
    el.textContent = '';
    const head = document.createElement('p');
    head.className = 'bio';
    head.textContent = `${this.album.size} de ${STICKERS.length} figurinhas · ${this.treasureDays()} tesouro${this.treasureDays() === 1 ? '' : 's'} achado${this.treasureDays() === 1 ? '' : 's'}`;
    const grid = document.createElement('div');
    grid.className = 'album';
    for (const s of STICKERS) {
      const has = this.album.has(s.id), d = document.createElement('div');
      d.className = has ? 'stk on' : 'stk';
      const i = document.createElement('b'), n = document.createElement('span');
      i.textContent = has ? s.icon : '?';
      n.textContent = has ? s.name : s.hint;
      d.setAttribute('aria-label', has ? `${s.name}: conseguida` : `Falta: ${s.hint}`);
      d.append(i, n);
      grid.append(d);
    }
    el.append(head, grid);
  }
}
