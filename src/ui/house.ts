import { HOUSES, INSTRUMENTS, PETS } from '../sim/constants';
import type { Agent } from '../sim/types';
import { spritesFor } from '../render/sprites';

/**
 * Planta da casa em ASCII marrom, no estilo dos jogos de bolso: paredes grossas, piso de tábua,
 * cama, mesa, fogão, baú com o que o morador juntou e o bicho dormindo no cantinho.
 */
type Cell = { c: string; fg: string; bg: string };
const W = 26, H = 15, T = 22;
const CREAM = '#f0e0b8', WOOD = '#e2c48e', PLANK = '#c9a46a', WALL = '#6a4426', WALL_D = '#3e2614', INK = '#3a2410';

export class HouseView {
  private readonly canvas: HTMLCanvasElement;
  private readonly title: HTMLElement;
  private readonly info: HTMLElement;
  constructor(private readonly root: HTMLElement) {
    this.canvas = root.querySelector('canvas')!;
    this.title = root.querySelector('h3')!;
    this.info = root.querySelector('p')!;
    root.querySelector('button')!.addEventListener('click', () => this.close());
  }
  close(): void { this.root.hidden = true; }
  get open(): boolean { return !this.root.hidden; }

  show(a: Agent, home: boolean, sleeping: boolean): void {
    const days = a.meta.days ?? 0, type = a.house, g: Cell[][] = [];
    const out = type === 3 ? { c: '~', fg: '#4f8ab0', bg: '#bcd8e0' } : { c: ',', fg: '#8aa65a', bg: '#d8d0a0' };
    for (let y = 0; y < H; y++) { g.push([]); for (let x = 0; x < W; x++) g[y]!.push({ ...out, c: (x * 7 + y * 3) % 5 ? (type === 3 ? '-' : ' ') : out.c }); }
    const put = (x: number, y: number, c: string, fg = INK, bg?: string) => { const k = g[y]?.[x]; if (k) { k.c = c; k.fg = fg; if (bg) k.bg = bg; } };
    // contorno: tenda e casa na árvore são redondas; o resto, retangular
    const round = type === 2 || type === 4, x0 = 2, y0 = 1, x1 = W - 3, y1 = H - 3;
    const inside = (x: number, y: number) => round ? ((x - (x0 + x1) / 2) / ((x1 - x0) / 2)) ** 2 + ((y - (y0 + y1) / 2) / ((y1 - y0) / 2)) ** 2 < 1 : x > x0 && x < x1 && y > y0 && y < y1;
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      if (inside(x, y)) put(x, y, (x + y * 3) % 7 ? (y % 2 ? '-' : '.') : '|', PLANK, WOOD);
      else if ([[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dy]) => inside(x + dx!, y + dy!))) put(x, y, type === 1 ? '#' : type === 4 ? '%' : '=', CREAM, type === 1 ? '#6a6458' : type === 4 ? `hsl(${a.hue} 40% 38%)` : WALL);
    }
    const mid = Math.floor(W / 2), doorY = round ? y1 : y1;
    put(mid, doorY, ' ', INK, WOOD); put(mid, doorY + 1, type === 2 ? 'H' : '_', INK, type === 3 ? '#9a6a3a' : '#b89a6a');
    if (type === 2) for (let y = doorY + 1; y < H; y++) put(mid, y, 'H', CREAM, '#7a5530');
    if (type === 3) for (let y = doorY + 1; y < H; y++) put(mid, y, '=', CREAM, '#9a6a3a');
    // parede do meio (a partir de 3 dias a casa ganha dois cômodos)
    if (days >= 3 && !round) for (let y = y0 + 1; y < y1; y++) if (y !== 7 && y !== 8) put(13, y, '#', CREAM, WALL_D);
    // cama, tapete, mesa e cadeiras, fogão, baú
    const blanket = `hsl(${a.hue} 55% 55%)`;
    put(5, 3, 'o', INK, '#f4ecd8'); put(6, 3, 'o', INK, '#f4ecd8');
    for (const y of [4, 5]) for (const x of [5, 6]) put(x, y, '▒', '#ffffff', blanket);
    for (let y = 8; y <= 10; y++) for (let x = 5; x <= 9; x++) put(x, y, '░', `hsl(${(a.hue + 180) % 360} 40% 45%)`, `hsl(${(a.hue + 180) % 360} 45% 70%)`);
    put(17, 5, 'T', CREAM, '#7a4e2c'); put(18, 5, 'T', CREAM, '#7a4e2c'); put(16, 5, 'h', INK); put(19, 5, 'h', INK);
    put(20, 3, '▓', '#ffcf6a', '#8a2a1e'); put(21, 3, '▓', '#ff9a3c', '#8a2a1e');
    put(19, 10, '■', '#f2c14e', '#6a4426'); put(20, 10, '■', '#f2c14e', '#6a4426');
    // coisas na parede: prateleira de cristais, troféu de peixe, instrumento
    const crystals = a.items.filter(i => i.includes('cristal')).length + a.crystals;
    for (let k = 0; k < Math.min(4, crystals); k++) put(15 + k, y0 + 1, '◆', '#b48cff', WOOD);
    if (a.items.some(i => i.includes('dourado'))) { put(4, y0 + 1, '>', '#f2c14e', WOOD); put(5, y0 + 1, '<', '#f2c14e', WOOD); put(6, y0 + 1, '>', '#f2c14e', WOOD); }
    if (a.prof === 2) put(9, y0 + 1, '♪', '#7a3aa8', WOOD);
    if (days >= 14) { put(11, 3, '≡', INK, PLANK); put(11, 4, '≡', INK, PLANK); }
    if (a.pet) { put(10, 11, 'ω', '#a86a3a', '#e8c890'); }
    // horta do lado de fora
    if (days >= 7) for (let x = 2; x <= 7; x++) put(x, H - 1, x % 2 ? 'v' : 'Y', '#3a8a3a', '#7a5a34');

    const c = this.canvas, ctx = c.getContext('2d')!;
    c.width = W * T; c.height = H * T;
    ctx.font = `700 ${Math.round(T * 0.8)}px "JetBrains Mono",monospace`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    g.forEach((row, y) => row.forEach((k, x) => { ctx.fillStyle = k.bg; ctx.fillRect(x * T, y * T, T, T); if (k.c.trim()) { ctx.fillStyle = k.fg; ctx.fillText(k.c, x * T + T / 2, y * T + T / 2 + 1); } }));
    // o morador: dormindo na cama, ou à mesa se está em casa acordado
    if (home) {
      const spr = spritesFor(a.name, a.look), fr = sleeping ? spr.sleep : spr.stand;
      ctx.imageSmoothingEnabled = false;
      if (sleeping) ctx.drawImage(fr, 5 * T, 3 * T - 6, 2 * T, 3.5 * T);
      else ctx.drawImage(fr, 16 * T - 4, 5 * T - T * 2.4, T * 1.4, T * 2.45);
    }
    if (a.pet && home) { ctx.fillStyle = '#3a2410'; ctx.font = `700 ${Math.round(T * 0.55)}px Inter,sans-serif`; ctx.fillText('z', 11 * T, 10.6 * T); }

    this.title.textContent = `${HOUSES[a.house]![0]!.toUpperCase()}${HOUSES[a.house]!.slice(1)} de ${a.name}`;
    const extras = [days >= 3 ? 'dois cômodos e cerca' : '', days >= 7 ? 'horta' : '', days >= 14 ? 'segundo andar e varal' : ''].filter(Boolean);
    const chest = a.items.length ? a.items.join(', ') : 'vazio por enquanto';
    this.info.textContent = `${days ? `${days} dia${days > 1 ? 's' : ''} de vila` : 'chegou hoje'}${extras.length ? ` · ${extras.join(', ')}` : ''}` +
      `${a.prof === 2 ? ` · ${INSTRUMENTS[a.instrument]} na parede` : ''}${a.pet ? ` · ${PETS[a.pet.kind]} ${a.pet.name}` : ''}` +
      ` · ${home ? (sleeping ? 'dormindo agora' : 'em casa agora') : 'saiu de casa'} · No baú: ${chest}.`;
    this.root.hidden = false;
  }
}
