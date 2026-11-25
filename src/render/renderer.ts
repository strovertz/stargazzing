import { css, hex, mix, type RGB } from '../core/color';
import { h32 } from '../core/rng';
import { COLS, FLOWERS, HOUSE_DX, N, ROWS, SPECIES, TICK_MS, Tile } from '../sim/constants';
import { hourAt, stageOf, type Simulation } from '../sim/simulation';
import { lightningAt } from '../sim/weather';
import type { Agent } from '../sim/types';
import { CHUNK, GroundCache } from './ground';
import { houseVariant, boardSprite, caveSprite, cartSprite, templeSprite, boatSprite, menhirSprite, millSprite, tentSprite, towerSprite, clearPropCache, columnSprite, drawFire, lanternSprite, marketSprite, statueSprite, wellSprite } from './props';
import { spritesFor, toolSprite } from './sprites';
import { drawAnimals, drawCat, drawDeer, drawPets } from './animals';
import { lookFor } from '../sim/look';
import { clearTreeCache, treeSprite } from './trees';
import { glow } from './glow';
import { CROPS } from '../sim/farm';

export const CW = 10;
export const CH = 18;
export const ZOOMS = [0.5, 0.65, 0.8, 1, 1.25, 1.6, 2];

/** Cores do minimapa (1 pixel por célula). */
const MINI: Record<number, RGB> = { 0: hex('#0b2333'), 1: hex('#16405a'), 2: hex('#5e5139'), 3: hex('#1f4a2b'), 4: hex('#12291a'), 5: hex('#474a51'), 6: hex('#50505a'), 7: hex('#2e2e35'), 8: hex('#2f789c') };
/** Luz do dia (1 = meio-dia). O mundo nunca fica totalmente claro: há sempre uma penumbra. */
const DARK_SCALE = 0.25;
const CHAT = ['…', '!', '?', '♪', '☺', 'ha', 'hm', '♥', '…'];
const lightAt = (h: number) => (h >= 7 && h < 17.5 ? 1 : h >= 19.5 || h < 5 ? 0 : h < 7 ? (h - 5) / 2 : 1 - (h - 17.5) / 2);

/**
 * Render em camadas:
 *  1. chão em mini-grade, cacheado em blocos de 16x16 células (canvas de fundo, ~10x/s);
 *  2. sombras, árvores, casas, fogueiras e moradores ordenados por profundidade (a cada quadro);
 *  3. escuridão com "furos" de luz nas fogueiras e janelas, mais brilho quente aditivo;
 *  4. nomes e balões por cima de tudo.
 */
export class Renderer {
  cam = { x: COLS / 2, y: ROWS / 2 };
  zi = 4;
  zoom = ZOOMS[4]!;
  dirty = true;
  VW = 0;
  VH = 0;
  private dpr = 1;
  private readonly bx: CanvasRenderingContext2D;
  private readonly fx: CanvasRenderingContext2D;
  private readonly mx: CanvasRenderingContext2D;
  private readonly dark = document.createElement('canvas');
  private readonly dx: CanvasRenderingContext2D;
  private readonly mini = document.createElement('canvas');
  /** chão do minimapa, sem moradores (usado no timelapse) */
  miniGround(): HTMLCanvasElement { if (this.miniVersion !== this.sim.groundVersion) this.buildMini(); return this.mini; }
  private miniVersion = -1;
  /** quando true, o próximo drawScene desenha todos os blocos visíveis de uma vez (atrás da tela de carregamento ou após zoom) */
  warm = true;
  private groundCache: GroundCache;
  /** posição na tela de cada morador visível no último quadro */
  readonly screen = new Map<Agent, { x: number; y: number }>();
  /** retângulo de cada casa visível (para abrir a planta ao clicar) */
  /** papéis pregados no quadro (notícias do dia) e onde ele ficou na tela */
  boardPapers = 0;
  private boardRect: { x: number; y: number; w: number; h: number } | null = null;
  boardAt(px: number, py: number): boolean { const r = this.boardRect; return !!r && px >= r.x - 6 && px <= r.x + r.w + 6 && py >= r.y - 6 && py <= r.y + r.h + 6; }
  private houseRects: { a: Agent; x: number; y: number; w: number; h: number }[] = [];
  houseAt(px: number, py: number): Agent | null { for (let k = this.houseRects.length - 1; k >= 0; k--) { const r = this.houseRects[k]!; if (px >= r.x && px <= r.x + r.w && py >= r.y && py <= r.y + r.h) return r.a; } return null; }
  /** efeitos de brincadeira: chuva de estrelas (código Konami) e lanternas de papel soltas no céu (tecla L) */
  private starRainUntil = 0;
  private skyLanterns: { x: number; y: number; t0: number; hue: number }[] = [];
  starRain(ts: number): void { this.starRainUntil = ts + 12; }
  releaseLantern(ts: number): void {
    const { ox, oy, vw, vh } = this.view();
    this.skyLanterns.push({ x: ox + vw * (0.3 + Math.random() * 0.4), y: oy + vh * 0.75, t0: ts, hue: Math.floor(Math.random() * 60) });
    if (this.skyLanterns.length > 30) this.skyLanterns.shift();
  }
  /** esconde nomes e balões (modo foto continua mostrando o mundo) */
  hideLabels = false;

  constructor(private readonly bgc: HTMLCanvasElement, private readonly fgc: HTMLCanvasElement, miniCanvas: HTMLCanvasElement, public sim: Simulation) {
    this.bx = bgc.getContext('2d')!;
    this.fx = fgc.getContext('2d')!;
    this.mx = miniCanvas.getContext('2d')!;
    miniCanvas.width = COLS; miniCanvas.height = ROWS;
    this.dx = this.dark.getContext('2d')!;
    this.mini.width = COLS;
    this.mini.height = ROWS;
    this.groundCache = new GroundCache(sim);
    this.resize();
  }

  /** Qualidade: 2 completa, 1 resolução menor, 0 resolução menor e sem o vento na grama. */
  quality = 2;
  setQuality(q: number): void { q = Math.max(0, Math.min(2, q)); if (q === this.quality) return; this.quality = q; this.resize(); this.warm = true; }

  resize(): void {
    this.dpr = Math.min([0.75, 1, 1.5][this.quality]!, window.devicePixelRatio || 1);
    this.VW = innerWidth;
    this.VH = innerHeight;
    for (const c of [this.bgc, this.fgc]) { c.width = Math.round(this.VW * this.dpr); c.height = Math.round(this.VH * this.dpr); }
    // a escuridão só tem gradientes suaves: 1/4 da resolução e ampliada com suavização
    this.dark.width = Math.ceil(this.VW * DARK_SCALE); this.dark.height = Math.ceil(this.VH * DARK_SCALE);
    clearTreeCache();
    clearPropCache();
    if (this.zi < this.minZi()) { this.zi = this.minZi(); this.zoom = ZOOMS[this.zi]!; this.warm = true; }
    this.clampCam();
  }

  /** Menor zoom em que o mapa ainda cobre a tela inteira: nunca sobram faixas pretas. */
  minZi(): number {
    for (let i = 0; i < ZOOMS.length; i++) if (ZOOMS[i]! * CW * COLS >= this.VW && ZOOMS[i]! * CH * ROWS >= this.VH) return i;
    return ZOOMS.length - 1;
  }

  /**
   * Listas prontas das poucas células que interessam (flores, cogumelos que brilham,
   * estrelas refletidas na água), refeitas só quando o chão muda: o quadro percorre
   * centenas de células em vez de varrer a tela inteira.
   */
  private lists = { flower: [] as number[], mush: [] as number[], water: [] as number[], gv: -1, tv: -1, sim: null as Simulation | null };
  private cells(kind: 'flower' | 'mush' | 'water'): number[] {
    const L = this.lists, sim = this.sim, t = sim.terrain;
    if (L.sim !== sim) { L.sim = sim; L.gv = L.tv = -1; }
    if (kind === 'flower' && L.gv !== sim.groundVersion) {
      L.gv = sim.groundVersion; L.flower = [];
      for (let i = 0; i < N; i++) if (sim.flower[i]) L.flower.push(i);
    }
    if (kind !== 'flower' && L.tv !== t.version) {
      L.tv = t.version; L.mush = []; L.water = [];
      for (let i = 0; i < N; i++) {
        const x = i % COLS, y = (i / COLS) | 0;
        if (t.deco[i] === 2 && h32(x, y, t.seed + 21) % 3 === 0) L.mush.push(i);
        if (t.T[i]! <= Tile.Shallow && h32(x, y, t.seed + 13) % 7 === 0) L.water.push(i);
      }
    }
    return L[kind];
  }

  setSim(sim: Simulation): void { this.sim = sim; this.groundCache.setSim(sim); this.miniVersion = -1; this.dirty = true; this.warm = true; }

  view() {
    const vw = this.VW / (CW * this.zoom), vh = this.VH / (CH * this.zoom);
    return { ox: this.cam.x - vw / 2, oy: this.cam.y - vh / 2, vw, vh };
  }

  clampCam(): void {
    const vw = this.VW / (CW * this.zoom), vh = this.VH / (CH * this.zoom);
    this.cam.x = vw >= COLS ? COLS / 2 : Math.max(vw / 2, Math.min(COLS - vw / 2, this.cam.x));
    this.cam.y = vh >= ROWS ? ROWS / 2 : Math.max(vh / 2, Math.min(ROWS - vh / 2, this.cam.y));
    this.dirty = true;
  }

  setZoom(nz: number, px = this.VW / 2, py = this.VH / 2): void {
    nz = Math.max(this.minZi(), Math.min(ZOOMS.length - 1, nz));
    if (nz === this.zi) return;
    const { ox, oy } = this.view();
    const wx = ox + px / (CW * this.zoom), wy = oy + py / (CH * this.zoom);
    this.zi = nz;
    this.zoom = ZOOMS[nz]!;
    this.cam.x = wx - px / (CW * this.zoom) + this.VW / (2 * CW * this.zoom);
    this.cam.y = wy - py / (CH * this.zoom) + this.VH / (2 * CH * this.zoom);
    // sprites e blocos de chão são guardados por zoom; o que faltar entra aos poucos
    this.clampCam();
  }

  pan(dxCells: number, dyCells: number): void { this.cam.x += dxCells; this.cam.y += dyCells; this.clampCam(); }

  agentAt(px: number, py: number): Agent | null {
    let best: Agent | null = null, bd = 22 * Math.max(1, this.zoom);
    for (const [a, p] of this.screen) { const d = Math.hypot(p.x - px, p.y - 10 * this.zoom - py); if (d < bd) { bd = d; best = a; } }
    return best;
  }

  private buildMini(): void {
    const g = this.mini.getContext('2d')!, img = g.createImageData(COLS, ROWS), d = img.data, { T } = this.sim.terrain;
    for (let i = 0; i < N; i++) {
      let c = MINI[T[i]!]!;
      if (this.sim.terrain.deco[i] === 6) c = mix(c, hex('#000000'), 0.55);
      if (this.sim.wear[i]! >= 6) c = mix(c, hex('#4a3c2c'), 0.7);
      d[i * 4] = c[0]; d[i * 4 + 1] = c[1]; d[i * 4 + 2] = c[2]; d[i * 4 + 3] = 255;
    }
    g.putImageData(img, 0, 0);
    this.miniVersion = this.sim.groundVersion;
  }

  /** Chão (blocos cacheados) + vento na grama e brilho na água, só na área visível. */
  drawScene(ts: number): void {
    const sim = this.sim, { T, noise } = sim.terrain, seed = sim.terrain.seed;
    const { ox, oy, vw, vh } = this.view(), z = this.zoom, dpr = this.dpr, cw = CW * z * dpr, ch = CH * z * dpr;
    const bx = this.bx;
    bx.setTransform(1, 0, 0, 1, 0, 0);
    bx.fillStyle = '#050807';
    bx.fillRect(0, 0, this.bgc.width, this.bgc.height);
    bx.imageSmoothingEnabled = false;
    const c0 = Math.max(0, Math.floor(ox / CHUNK)), c1 = Math.min(Math.ceil(COLS / CHUNK) - 1, Math.floor((ox + vw) / CHUNK));
    const r0 = Math.max(0, Math.floor(oy / CHUNK)), r1 = Math.min(Math.ceil(ROWS / CHUNK) - 1, Math.floor((oy + vh) / CHUNK));
    const budget = { n: this.warm ? 99 : 2 };
    this.warm = false;
    let pending = false;
    for (let cy = r0; cy <= r1; cy++) for (let cx = c0; cx <= c1; cx++) {
      const img = this.groundCache.get(cx, cy, cw, ch, budget);
      const dxp = Math.round((cx * CHUNK - ox) * cw), dyp = Math.round((cy * CHUNK - oy) * ch);
      if (img) { bx.drawImage(img, dxp, dyp); continue; }
      // ainda não desenhado: mostra as cores do minimapa ampliadas até o bloco ficar pronto
      pending = true;
      if (this.miniVersion !== sim.groundVersion) this.buildMini();
      const w = Math.min(CHUNK, COLS - cx * CHUNK), hh = Math.min(CHUNK, ROWS - cy * CHUNK);
      bx.drawImage(this.mini, cx * CHUNK, cy * CHUNK, w, hh, dxp, dyp, Math.ceil(w * cw), Math.ceil(hh * ch));
    }
    // vento e brilho na água: milhares de caracteres, então só com o chão pronto e zoom em que dá para ver
    if (pending || z < 0.8 || this.quality === 0) { this.dirty = pending; return; }
    const windNow = sim.weather().wind, windSp = 0.2 + windNow * 0.5, windMin = 0.3 - windNow * 0.16;
    // vento: faixas de rajada passam pela grama; brilho na água
    const x0 = Math.max(0, Math.floor(ox)), x1 = Math.min(COLS, Math.ceil(ox + vw) + 1), y0 = Math.max(0, Math.floor(oy)), y1 = Math.min(ROWS, Math.ceil(oy + vh) + 1);
    bx.font = `700 ${Math.max(3, Math.round((ch / 4) * 1.45))}px "JetBrains Mono",monospace`;
    bx.textAlign = 'center';
    bx.textBaseline = 'middle';
    for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) {
      const i = y * COLS + x, t = T[i]!, hs = h32(x, y, seed) % 100;
      if (t === Tile.Grass && sim.wear[i]! < 6 && hs < 45) {
        const w = noise(x * 0.06 - ts * windSp, y * 0.12, ts * 0.05);
        if (w < windMin) continue;
        bx.fillStyle = w > 0.34 ? '#6fa86a' : '#4f8a52';
        bx.fillText(hs % 2 ? '/' : "'", (x - ox + 0.2 + (hs % 3) * 0.3) * cw, (y - oy + 0.25 + (hs % 4) * 0.18) * ch);
      } else if ((t <= Tile.Shallow || t === Tile.Stream) && hs < 50) {
        const v = noise(x * 0.16, y * 0.32, ts * 0.25);
        if (v < 0.22) continue;
        bx.fillStyle = v > 0.34 ? '#5fa0c0' : '#2f6a88';
        bx.fillText(v > 0.34 ? '~' : '-', (x - ox + 0.2 + (hs % 3) * 0.3) * cw, (y - oy + 0.3 + (hs % 4) * 0.15) * ch);
      }
    }
    this.dirty = pending;
  }

  /** tf = tick fracionário (tempo do mundo), para interpolar o movimento. */
  drawActors(tf: number, selected: Agent | null, hovered: Agent | null): void {
    const sim = this.sim, fx = this.fx, z = this.zoom, ts = (tf * TICK_MS) / 1000, seed = sim.terrain.seed;
    const { ox, oy, vw, vh } = this.view(), h = hourAt(sim.tick), wx = sim.weather(), rain = wx.rain > 0.3, L = lightAt(h);
    const cs = CW * z, ch = CH * z, sc = z * 2, VW = this.VW, VH = this.VH;
    fx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    fx.clearRect(0, 0, VW, VH);
    fx.imageSmoothingEnabled = false;
    this.screen.clear();
    const sx = (x: number) => (x - ox + 0.5) * cs, sy = (y: number) => (y - oy + 1) * ch;
    const inV = (x: number, y: number, up = 11) => x >= ox - 4 && x <= ox + vw + 4 && y >= oy - 1 && y <= oy + vh + up;
    const list = sim.agents.filter(a => a.present && !a.inside && inV(a.x, a.y, 3));
    type TreeDraw = { x: number; y: number; kind: string; variant: number; scale: number; thirsty: boolean; fruit?: boolean };
    const trees: TreeDraw[] = [];
    for (const w of sim.terrain.wild) if (inV(w.x, w.y)) trees.push({ x: w.x, y: w.y, kind: ['mata-copa', 'mata-pinho', 'cipreste'][w.sp]!, variant: h32(w.x, w.y, 5) % 4, scale: w.big ? 1.1 : 0.75, thirsty: false, fruit: !!w.fruit });
    for (const t of sim.trees) { const st = stageOf(t); if (st > 0 && inV(t.x, t.y)) trees.push({ x: t.x, y: t.y, kind: SPECIES[t.sp]!.n, variant: h32(t.x, t.y, 5) % 4, scale: [0, 0.4, 0.7, 1][st]! * ((t.age ?? 0) >= 30 ? 1.3 : (t.age ?? 0) >= 14 ? 1.15 : 1), thirsty: sim.tick - t.lastWater > 3000 && !rain }); }
    const evening = L < 0.95;
    const houses = sim.agents.filter(a => a.hut && inV(a.home.x - HOUSE_DX, a.home.y, 4)).map(a => ({ a, spr: houseVariant(a.house, a.hue, evening, (a.meta.days ?? 0) >= 14, cs, ch, this.dpr) }));
    const fires: { x: number; y: number }[] = sim.terrain.plazas.filter(p => inV(p.x, p.y, 3));
    const burn = sim.fire && inV(sim.fire.x, sim.fire.y, 8) ? sim.fire : null;
    const party = sim.isParty();
    const sprites = trees.map(t => ({ t, spr: treeSprite(t.kind, t.variant, t.scale, t.thirsty, z, this.dpr, CW, CH, sim.season) }));

    // sombras: direção e comprimento pela posição do sol; à noite só um contato leve no chão
    const sun = Math.max(-1, Math.min(1, (h - 12.5) / 6)), shLen = L < 0.3 ? 0.12 : 0.35 + Math.abs(sun) * 0.9, shA = L < 0.3 ? 0.22 : rain ? 0.2 : 0.38;
    fx.fillStyle = `rgba(0,0,0,${shA})`;
    for (const { t, spr } of sprites) {
      const len = spr.h * shLen;
      fx.beginPath(); fx.ellipse(sx(t.x) + sun * len * 0.5, sy(t.y) - ch * 0.2 + len * 0.12, spr.canopyW * 0.42 + Math.abs(sun) * len * 0.5, spr.canopyW * 0.2 + len * 0.08, 0, 0, 7); fx.fill();
    }
    for (const { a, spr } of houses) { fx.beginPath(); fx.ellipse(sx(a.home.x - HOUSE_DX) + sun * spr.h * shLen * 0.4, sy(a.home.y) - ch * 0.1, spr.w * 0.55 + Math.abs(sun) * spr.h * 0.3, ch * 0.35, 0, 0, 7); fx.fill(); }
    fx.fillStyle = 'rgba(0,0,0,.35)';
    for (const a of list) { const f = Math.min(1, Math.max(0, (tf - a.mt) / a.pace)); fx.beginPath(); fx.ellipse(sx(a.px + (a.x - a.px) * f), sy(a.py + (a.y - a.py) * f) - 2 * z, 5 * sc, 1.6 * sc, 0, 0, 7); fx.fill(); }

    // flores: brotam das trilhas esquecidas e balançam com o vento
    const fl: { x: number; y: number }[] = [];
    if (z >= 0.65) {
      const x0 = Math.max(0, Math.floor(ox)), x1 = Math.min(COLS, Math.ceil(ox + vw) + 1), y0 = Math.max(0, Math.floor(oy)), y1 = Math.min(ROWS, Math.ceil(oy + vh) + 1);
      fx.font = `700 ${Math.round(ch * 0.62)}px "JetBrains Mono",monospace`; fx.textAlign = 'center'; fx.textBaseline = 'middle';
      for (const i of this.cells('flower')) {
        const x = i % COLS, y = (i / COLS) | 0, f = sim.flower[i];
        if (!f || x < x0 || x >= x1 || y < y0 || y >= y1) continue;
        fl.push({ x, y });
        const hh = h32(x, y, 17), bx = sx(x) + ((hh % 7) - 3) * cs * 0.08, by = sy(y) - ch * 0.35, sway = Math.sin(ts * (1 + wx.wind * 2) + x * 0.7) * cs * 0.06 * (0.5 + wx.wind);
        fx.fillStyle = '#3f7a38'; fx.fillText('|', bx, by + ch * 0.12);
        fx.fillStyle = FLOWERS[f - 1]!; fx.fillText(hh % 3 ? '*' : 'o', bx + sway, by - ch * 0.12);
        if (hh % 4 === 0) { fx.fillStyle = FLOWERS[(f + 1) % FLOWERS.length]!; fx.fillText('*', bx + cs * 0.3 + sway, by); }
      }
    }

    // bichos (fogem de quem estiver perto) e o gato que segue alguém
    const people = list.map(a => { const f = Math.min(1, Math.max(0, (tf - a.mt) / a.pace)); return { x: a.px + (a.x - a.px) * f, y: a.py + (a.y - a.py) * f, face: a.face as number }; });
    const view = { sx, sy, inV: (x: number, y: number) => inV(x, y, 2), cs, ch, z };
    drawAnimals(fx, sim, view, ts, L, people);
    const posOf = (i: number) => { const a = sim.agents[i]!; const k = list.indexOf(a); return k >= 0 ? people[k]! : null; };
    drawCat(fx, sim, view, ts, posOf);

    // tabuleiro de dama no chão entre os dois jogadores
    for (const a of list) {
      if (a.state !== 'GAME' || a.phase !== 'stay' || !a.friend || a.name > a.friend.name) continue;
      const bx = sx((a.x + a.friend.x) / 2), by = sy((a.y + a.friend.y) / 2) - ch * 0.3, q = 2 * z;
      for (let i = 0; i < 4; i++) for (let j = 0; j < 4; j++) { fx.fillStyle = (i + j) % 2 ? '#2a1a0e' : '#d8c8a0'; fx.fillRect(bx - 4 * q + i * 2 * q, by - 2 * q + j * q, 2 * q, q); }
      fx.fillStyle = '#c43c3c'; fx.beginPath(); fx.arc(bx - 2 * q, by - q * 1.5, q * 0.6, 0, 7); fx.fill();
      fx.fillStyle = '#151515'; fx.beginPath(); fx.arc(bx + 2 * q, by + q * 0.5, q * 0.6, 0, 7); fx.fill();
    }

    // tudo que tem altura, na ordem de profundidade
    type D = { y: number; draw: () => void };
    const ds: D[] = [];
    drawPets(fx, sim, view, ts, posOf, i => { const a = sim.agents[i]!; return a.phase === 'stay' && a.state === 'REST' && (h >= 23 || h < 5.5); }, (y, draw) => ds.push({ y: y - 0.01, draw }));
    for (const { t, spr } of sprites) {
      const wind = sim.terrain.noise(t.x * 0.06 - ts * (0.2 + wx.wind * 0.5), t.y * 0.12, ts * 0.05), sk = wind * (0.02 + wx.wind * 0.11) + Math.sin(ts * (1.2 + wx.wind * 1.5) + t.x) * (0.004 + wx.wind * 0.012);
      ds.push({ y: t.y + 0.01, draw: () => {
        fx.save(); fx.translate(sx(t.x), sy(t.y)); fx.transform(1, 0, -sk, 1, 0, 0); fx.drawImage(spr.canvas, -spr.w / 2, -spr.h, spr.w, spr.h);
        if (t.fruit) for (let k = 0; k < 7; k++) { const hh = h32(t.x * 7 + k, t.y, 11); fx.fillStyle = sim.season === 1 ? '#e8862a' : '#d8302a'; fx.beginPath(); fx.arc(((hh % 100) / 100 - 0.5) * spr.canopyW * 0.8, -spr.h * (0.45 + ((hh >>> 8) % 40) / 100), 1.8 * z, 0, 7); fx.fill(); }
        fx.restore();
      } });
    }
    for (const col of sim.terrain.columns) {
      if (col.kind === 2 || !inV(col.x, col.y, 6)) continue;
      const spr = columnSprite(col.kind, col.h, h32(col.x, col.y, 3) % 12, cs, ch, this.dpr);
      ds.push({ y: col.y + 0.03, draw: () => fx.drawImage(spr.canvas, sx(col.x) - spr.w / 2, sy(col.y) - spr.h + ch * 0.15, spr.w, spr.h) });
    }
    this.houseRects = [];
    for (const { a, spr } of houses) {
      const hx = sx(a.home.x - HOUSE_DX) - spr.w / 2, hy = sy(a.home.y) - spr.h + ch * 0.1, days = a.meta.days ?? 0;
      this.houseRects.push({ a, x: hx, y: hy, w: spr.w, h: spr.h });
      ds.push({ y: a.home.y + 0.02, draw: () => fx.drawImage(spr.canvas, hx, hy, spr.w, spr.h) });
      // horta de cada morador: 2 canteiros do lado da casa, com a cultura e o estágio de agora
      if (z >= 0.65) {
        const gd = sim.gardenOf(a), crop = CROPS[gd.crop]!, gx = hx - cs * 1.5, gy = sy(a.home.y) - ch * 0.35;
        ds.push({ y: a.home.y + 0.01, draw: () => {
          fx.font = `700 ${Math.round(ch * 0.66)}px "JetBrains Mono",monospace`; fx.textAlign = 'center'; fx.textBaseline = 'middle';
          fx.fillStyle = '#4a3420'; fx.fillRect(gx - cs * 1.05, gy - ch * 0.34, cs * 2.1, ch * 0.7);
          fx.fillStyle = '#6a4a2c'; for (let k = 0; k < 3; k++) fx.fillRect(gx - cs * 1.0 + k * cs * 0.7, gy + ch * 0.18, cs * 0.55, ch * 0.07);
          for (let k = 0; k < 3; k++) {
            const px = gx - cs * 0.7 + k * cs * 0.7, sw2 = Math.sin(ts * (1 + wx.wind * 2) + k + a.hue) * cs * 0.04;
            if (gd.stage === 0) { fx.fillStyle = '#7a5a38'; fx.fillText('.', px, gy); continue; }
            fx.fillStyle = '#6fbf5a';
            fx.fillText(gd.stage === 1 ? ',' : crop.n === 'girassol' ? '|' : 'v', px + sw2, gy - (gd.stage >= 2 ? ch * 0.08 : 0));
            if (gd.stage === 3) { fx.fillStyle = crop.col; fx.fillText(crop.n === 'girassol' ? '✿' : crop.n === 'alface' ? '@' : crop.n === 'abóbora' ? 'O' : crop.n === 'tomate' ? 'ó' : 'V', px + sw2, gy - ch * (crop.n === 'girassol' ? 0.32 : 0.02)); }
          }
          if (a.state === 'WATER' && a.phase === 'stay') { fx.fillStyle = '#8ac8f0'; fx.fillText('¨', gx + Math.sin(ts * 8) * cs * 0.3, gy - ch * 0.5); }
        } });
      }
      // a casa cresce com os dias: cerca (3 dias) e varal (14)
      if (z < 0.65 || days < 3) continue;
      ds.push({ y: a.home.y + 0.5, draw: () => {
        fx.font = `700 ${Math.round(ch * 0.42)}px "JetBrains Mono",monospace`; fx.textAlign = 'center'; fx.textBaseline = 'middle';
        const fy = sy(a.home.y) + ch * 0.35, x0 = hx - cs * 1.4;
        fx.fillStyle = '#8a6a44';
        for (let k = 0; k <= 9; k++) fx.fillText(k % 3 ? '-' : '+', x0 + k * cs * 0.5, fy);
        if (days >= 14) {
          // varal com roupas na cor do dono, balançando com o vento
          const vx0 = hx - cs * 1.9, vx1 = hx - cs * 0.2, vy = hy + spr.h * 0.45;
          fx.strokeStyle = '#6a4426'; fx.lineWidth = 1.2; fx.beginPath(); fx.moveTo(vx0, vy + ch * 0.9); fx.lineTo(vx0, vy); fx.lineTo(vx1, vy); fx.lineTo(vx1, vy + ch * 0.9); fx.stroke();
          for (let k = 0; k < 3; k++) { fx.fillStyle = `hsl(${(a.hue + k * 60) % 360} 60% 60%)`; const sw2 = Math.sin(ts * (1 + wx.wind * 3) + k) * 2 * z; fx.fillRect(vx0 + (k + 0.6) * (vx1 - vx0) / 4 + sw2, vy, cs * 0.35, ch * 0.35); }
        }
      } });
    }
    // campo de trigo: terra arada, brotos, trigo verde e trigo dourado balançando
    const fd = sim.field;
    if (fd && z >= 0.4 && inV(fd.x + fd.w / 2, fd.y + fd.h / 2, fd.w)) {
      const stg = sim.wheat.stage;
      for (let r = 0; r < fd.h; r++) ds.push({ y: fd.y + r - 0.2, draw: () => {
        fx.font = `700 ${Math.round(ch * 0.62)}px "JetBrains Mono",monospace`; fx.textAlign = 'center'; fx.textBaseline = 'middle';
        const y = fd.y + r;
        fx.fillStyle = '#5a3e24'; fx.fillRect(sx(fd.x) - cs * 0.5, sy(y) - ch * 0.5, cs * fd.w, ch);
        for (let x = fd.x; x < fd.x + fd.w; x++) for (let k = 0; k < 2; k++) {
          const px = sx(x) + (k - 0.5) * cs * 0.45, sw2 = stg >= 2 ? Math.sin(ts * (1.2 + wx.wind * 2.5) + x * 0.6 + r) * cs * 0.08 * (0.4 + wx.wind) : 0;
          if (stg === 0) { fx.fillStyle = '#7a5a38'; fx.fillText('=', px, sy(y) - ch * 0.05); continue; }
          fx.fillStyle = stg === 3 ? (k ? '#f0c860' : '#dcae44') : stg === 2 ? '#8ccc62' : '#9ad870';
          fx.fillText(stg === 1 ? ',' : stg === 2 ? '|' : 'Ψ', px + sw2, sy(y) - ch * (stg === 1 ? 0.05 : 0.25));
        }
      } });
    }
    // marcos espalhados pelo mapa
    this.boardRect = null;
    for (const lm of sim.terrain.landmarks) {
      if (lm.kind === 'ponte' || lm.kind === 'pântano' || lm.kind === 'cogumelos' || lm.kind === 'pomar' || lm.kind === 'pedreira' || lm.kind === 'praia' || lm.kind === 'cercado' || lm.kind === 'floresta' || !inV(lm.x + lm.w / 2, lm.y, 8)) continue;
      if (lm.kind === 'pedras') {
        for (const [dx, dy] of [[0, -2], [6, -2], [1, 0], [5, 0], [3, -3]] as const) {
          const spr = menhirSprite(lm.v + dx, L < 0.5, cs, ch, this.dpr), x = lm.x + dx, y = lm.y + dy;
          ds.push({ y: y + 0.02, draw: () => fx.drawImage(spr.canvas, sx(x) - spr.w / 2, sy(y) - spr.h + ch * 0.1, spr.w, spr.h) });
        }
        continue;
      }
      if (lm.kind === 'caverna' || lm.kind === 'templo' || lm.kind === 'quadro') {
        const open = this.boardPapers;
        const spr = lm.kind === 'caverna' ? caveSprite(cs * 1.3, ch * 1.3, this.dpr) : lm.kind === 'templo' ? templeSprite(sim.templeOpen, sim.crystalLit, cs, ch, this.dpr) : boardSprite(open, cs * 1.4, ch * 1.4, this.dpr);
        const cx0 = sx(lm.x + (lm.w - 1) / 2), y = lm.kind === 'caverna' ? lm.y + 0.6 : lm.y;
        if (lm.kind === 'quadro') this.boardRect = { x: cx0 - spr.w / 2, y: sy(y) - spr.h + ch * 0.1, w: spr.w, h: spr.h };
        ds.push({ y: lm.y + 0.02, draw: () => fx.drawImage(spr.canvas, cx0 - spr.w / 2, sy(y) - spr.h + ch * 0.1, spr.w, spr.h) });
        continue;
      }
      const spr = lm.kind === 'moinho' ? millSprite(cs * 1.6, ch * 1.6, this.dpr) : lm.kind === 'torre' ? towerSprite(cs * 1.5, ch * 1.5, this.dpr) : tentSprite(lm.v % 360, cs * 1.2, ch * 1.2, this.dpr);
      const cx0 = sx(lm.x + (lm.w - 1) / 2);
      ds.push({ y: lm.y + 0.02, draw: () => {
        const top = sy(lm.y) - spr.h + ch * 0.1;
        fx.drawImage(spr.canvas, cx0 - spr.w / 2, top, spr.w, spr.h);
        if (lm.kind === 'moinho') {
          // pás girando com o vento
          const hx = cx0, hy = top + spr.h * 0.32, R = cs * 5.2, ang = ts * (0.4 + wx.wind * 2.2);
          fx.strokeStyle = '#6a4426'; fx.lineWidth = Math.max(1.5, 2 * z);
          for (let k = 0; k < 4; k++) {
            const a0 = ang + (k * Math.PI) / 2, ex = hx + Math.cos(a0) * R, ey = hy + Math.sin(a0) * R * 0.9;
            fx.beginPath(); fx.moveTo(hx, hy); fx.lineTo(ex, ey); fx.stroke();
            const a1 = a0 + 0.22, px2 = hx + Math.cos(a1) * R * 0.95, py2 = hy + Math.sin(a1) * R * 0.85;
            fx.fillStyle = 'rgba(232,222,196,.85)'; fx.beginPath(); fx.moveTo(hx + Math.cos(a0) * R * 0.3, hy + Math.sin(a0) * R * 0.27); fx.lineTo(ex, ey); fx.lineTo(px2, py2); fx.lineTo(hx + Math.cos(a1) * R * 0.3, hy + Math.sin(a1) * R * 0.27); fx.fill();
          }
          fx.fillStyle = '#3a2818'; fx.beginPath(); fx.arc(hx, hy, 2.5 * z, 0, 7); fx.fill();
        } else if (lm.kind === 'torre') {
          // bandeira no topo tremulando
          const fxp = cx0 + 1, fyp = top - ch * 0.9;
          fx.strokeStyle = '#4a3018'; fx.lineWidth = 1.5; fx.beginPath(); fx.moveTo(fxp, top + ch * 0.2); fx.lineTo(fxp, fyp); fx.stroke();
          fx.fillStyle = '#c43c3c'; fx.beginPath(); fx.moveTo(fxp, fyp);
          for (let q = 0; q <= 6; q++) fx.lineTo(fxp + q * 3 * z, fyp + Math.sin(ts * (3 + wx.wind * 5) + q) * 1.5 * z);
          for (let q = 6; q >= 0; q--) fx.lineTo(fxp + q * 3 * z, fyp + 8 * z + Math.sin(ts * (3 + wx.wind * 5) + q) * 1.5 * z);
          fx.fill();
        }
      } });
    }
    // obras da vila
    const fair = sim.isFair();
    for (const st of sim.structures) {
      if (!st.built || !inV(st.x, st.y, 5)) continue;
      const spr = st.kind === 'poço' ? wellSprite(cs * 1.2, ch * 1.2, this.dpr) : st.kind === 'mercado' ? marketSprite(fair, cs * 1.3, ch * 1.3, this.dpr) : st.kind === 'estátua' ? statueSprite(cs, ch, this.dpr) : null;
      if (!spr) continue;
      const cx0 = st.kind === 'mercado' ? sx(st.x + 1) : sx(st.x);
      ds.push({ y: st.y + 0.02, draw: () => fx.drawImage(spr.canvas, cx0 - spr.w / 2, sy(st.y) - spr.h + ch * 0.1, spr.w, spr.h) });
    }
    const lanternsOn = sim.structures.some(st => st.kind === 'lanternas' && st.built);
    if (lanternsOn) for (const [lx, ly] of sim.lanterns) {
      if (!inV(lx, ly, 3)) continue;
      const spr = lanternSprite(L < 0.8, cs, ch, this.dpr);
      ds.push({ y: ly + 0.02, draw: () => fx.drawImage(spr.canvas, sx(lx) - spr.w / 2, sy(ly) - spr.h + ch * 0.1, spr.w, spr.h) });
    }
    // varal de bandeirinhas entre as colunas em dia de feira
    if (fair) {
      const cols = sim.terrain.columns.filter(c => c.kind === 0);
      ds.push({ y: sim.terrain.agora.y - sim.terrain.agora.ry, draw: () => {
        for (let k = 0; k < cols.length; k++) {
          const c0 = cols[k]!, c1 = cols[(k + 1) % cols.length]!;
          const x0 = sx(c0.x), y0 = sy(c0.y) - ch * 3.2, x1 = sx(c1.x), y1 = sy(c1.y) - ch * 3.2;
          fx.strokeStyle = 'rgba(230,220,190,.5)'; fx.lineWidth = 1; fx.beginPath(); fx.moveTo(x0, y0); fx.quadraticCurveTo((x0 + x1) / 2, (y0 + y1) / 2 + ch * 0.6, x1, y1); fx.stroke();
          for (let q = 1; q < 6; q++) {
            const u = q / 6, bx = x0 + (x1 - x0) * u, by = y0 + (y1 - y0) * u + ch * 0.6 * 4 * u * (1 - u) * 0.5;
            fx.fillStyle = ['#f2c14e', '#f07aa8', '#7cc4ff', '#86e095', '#ff9a5a'][(k + q) % 5]!;
            fx.beginPath(); fx.moveTo(bx - 3 * z, by); fx.lineTo(bx + 3 * z, by); fx.lineTo(bx, by + 6 * z + Math.sin(ts * 3 + q) * z); fx.fill();
          }
        }
      } });
    }
    // acampamentos de quem fez fork
    for (const k of sim.forks) {
      if (!inV(k.x, k.y, 5)) continue;
      const spr = tentSprite(h32(k.x, k.y, 3) % 360, cs * 1.2, ch * 1.2, this.dpr), cx0 = sx(k.x + 0.5);
      ds.push({ y: k.y + 0.02, draw: () => fx.drawImage(spr.canvas, cx0 - spr.w / 2, sy(k.y) - spr.h + ch * 0.1, spr.w, spr.h) });
    }
    // mercador do dia com a carroça
    const mc = sim.merchant ? sim.merchantAt(tf) : null;
    if (mc && inV(mc.x, mc.y, 3)) {
      const look = lookFor(sim.merchant!).look, spr = spritesFor(`@m:${sim.merchant}`, look), cart = cartSprite(cs, ch, this.dpr);
      ds.push({ y: mc.y, draw: () => {
        const x = sx(mc.x), y = sy(mc.y), fr = mc.walking && Math.floor(tf * 1.4) % 2 ? spr.step : spr.stand;
        fx.drawImage(cart.canvas, x - mc.face * cs * 1.8 - cart.w / 2, y - cart.h + ch * 0.1, cart.w, cart.h);
        fx.save(); fx.translate(x, y - 14 * sc - z); if (mc.face < 0) fx.scale(-1, 1); fx.drawImage(fr, -4 * sc, 0, 8 * sc, 14 * sc); fx.restore();
      } });
    }
    for (const a of list) {
      const f = Math.min(1, Math.max(0, (tf - a.mt) / a.pace)), wx = a.px + (a.x - a.px) * f, wy = a.py + (a.y - a.py) * f, moving = f < 1;
      const p = { x: sx(wx), y: sy(wy) };
      this.screen.set(a, p);
      ds.push({ y: wy, draw: () => {
        const spr = spritesFor(a.name, a.look), sleeping = a.phase === 'stay' && a.state === 'REST' && (h >= 23 || h < 5.5);
        // dança na roda da fogueira à noite: pulinho no compasso e vira de lado
        const dancing = a.phase === 'boid' && a.state === 'GATHER' && L < 0.5, beat = Math.floor(ts * 2.2 + a.hue);
        const fr = sleeping ? spr.sleep : (moving && Math.floor((tf * 4) / a.pace) % 2) || (dancing && beat % 2) ? spr.step : spr.stand;
        const bob = (moving && fr === spr.step ? -sc : 0) + (dancing ? -Math.abs(Math.sin(ts * Math.PI * 2.2 + a.hue)) * 3 * sc : 0);
        const face = dancing ? (beat % 4 < 2 ? 1 : -1) : a.face;
        const boat = a.state === 'BOAT' && a.phase === 'stay';
        let bx = p.x, by = p.y;
        if (boat) {
          // no barco: um pouco para dentro da água, balançando
          const pier = sim.structures.find(st => st.kind === 'píer');
          const end = pier?.cells[pier.cells.length - 1] ?? 0, ex = end % COLS, ey = (end / COLS) | 0;
          bx = sx(ex + 1 + Math.sin(ts * 0.2 + a.hue) * 1.5); by = sy(ey + 1) + Math.sin(ts * 1.6 + a.hue) * 1.5 * z;
          const b = boatSprite(cs, ch, this.dpr); fx.drawImage(b.canvas, bx - b.w / 2, by - b.h * 0.6, b.w, b.h);
        }
        fx.save(); fx.translate(bx, by - 14 * sc - z + bob - (boat ? 4 * sc : 0)); if (face < 0) fx.scale(-1, 1); fx.drawImage(fr, -4 * sc, 0, 8 * sc, 14 * sc);
        if (!sleeping) fx.drawImage(toolSprite(a.prof, a.instrument), a.prof === 4 ? -6 * sc : 3 * sc, (a.prof === 4 ? 5 : 4) * sc, 4 * sc, 9 * sc);
        fx.restore();
      } });
    }
    ds.sort((p, q) => p.y - q.y);
    for (const d of ds) d.draw();

    // fumaça das chaminés no fim do dia (e na casa do padeiro quando o forno está aceso)
    const baking = houses.filter(({ a }) => a.state === 'BAKE' && a.phase === 'stay');
    if (evening || baking.length) {
      fx.font = `700 ${Math.round(9 * z)}px "JetBrains Mono",monospace`; fx.textAlign = 'center'; fx.textBaseline = 'middle';
      for (const { a, spr } of evening ? houses : baking) for (let k = 0; k < 4; k++) {
        const life = (ts * 0.35 + k / 4 + a.hue / 360) % 1;
        fx.fillStyle = `rgba(150,150,160,${0.35 * (1 - life)})`;
        fx.fillText(k % 2 ? '°' : 'o', sx(a.home.x - HOUSE_DX) + spr.w * 0.17 + Math.sin(ts + k * 2) * 4 * z + life * 10 * z, sy(a.home.y) - spr.h * 0.85 - life * 40 * z);
      }
    }

    // escuridão com furos de luz (fogueiras sempre; janelas ao anoitecer)
    if (burn) fires.push({ x: burn.x, y: burn.y - 1 });
    const crystals = evening ? houses.filter(o => o.a.crystals > 0) : [];
    const dark = 0.05 + (1 - L) * 0.47 + wx.cloud * 0.06 + wx.rain * 0.06 + (wx.storm ? 0.08 : 0);
    const flick = (k: number) => 1 + Math.sin(ts * 11 + k) * 0.05 + Math.sin(ts * 23 + k * 3) * 0.035;
    if (dark < 0.12) {
      // de dia a luz das fogueiras nem aparece: só um véu, sem camada extra
      fx.fillStyle = `rgba(8,12,30,${dark})`;
      fx.fillRect(0, 0, VW, VH);
    } else {
      const dx = this.dx;
      dx.setTransform(DARK_SCALE, 0, 0, DARK_SCALE, 0, 0);
      dx.globalCompositeOperation = 'source-over';
      dx.clearRect(0, 0, VW, VH);
      dx.fillStyle = `rgba(8,12,30,${Math.min(0.6, dark)})`;
      dx.fillRect(0, 0, VW, VH);
      dx.globalCompositeOperation = 'destination-out';
      const hole = (x: number, y: number, r: number, s: number) => glow(dx, x, y, r, '0,0,0', s, r, true);
      for (const p of fires) hole(sx(p.x), sy(p.y) - ch * 0.5, cs * 11 * flick(p.x), 0.95);
      if (evening) for (const { a, spr } of houses) hole(sx(a.home.x - HOUSE_DX), sy(a.home.y) - spr.h * 0.3, cs * 4.5, 0.8 * (1 - L));
      if (lanternsOn && evening) for (const [lx, ly] of sim.lanterns) hole(sx(lx), sy(ly) - ch * 1.6, cs * 5, 0.75 * (1 - L));
      for (const { a } of crystals) hole(sx(a.home.x - HOUSE_DX + 1), sy(a.home.y) - ch * 0.4, cs * 3, 0.6 * (1 - L));
      if (sim.crystalLit) for (const lm of sim.terrain.landmarks) if (lm.kind === 'templo') hole(sx(lm.x + 3), sy(lm.y) - ch * 2.6, cs * 8, 0.8);
      for (const lt of this.skyLanterns) { const u = ts - lt.t0; if (u < 25) hole(sx(lt.x + Math.sin(u * 0.4) * 2), sy(lt.y - u * 0.9), cs * 3, 0.5 * (1 - u / 25)); }
      fx.imageSmoothingEnabled = true;
      fx.drawImage(this.dark, 0, 0, this.dark.width / DARK_SCALE, this.dark.height / DARK_SCALE);
      fx.imageSmoothingEnabled = false;
    }
    // brilho quente
    fx.globalCompositeOperation = 'lighter';
    if (lanternsOn && evening) for (const [lx, ly] of sim.lanterns) glow(fx, sx(lx), sy(ly) - ch * 1.6, cs * 2.2, '255,210,120', 0.3 * (1 - L));
    for (const p of fires) glow(fx, sx(p.x), sy(p.y) - ch * 0.5, cs * 6 * flick(p.x + 9), '255,140,52', 0.32 + (1 - L) * 0.2);
    if (evening) for (const { a, spr } of houses) glow(fx, sx(a.home.x - HOUSE_DX), sy(a.home.y) - spr.h * 0.3, cs * 2, '255,190,90', 0.22 * (1 - L));
    for (const { a } of crystals) glow(fx, sx(a.home.x - HOUSE_DX + 1), sy(a.home.y) - ch * 0.4, cs * 1.6, '190,150,255', 0.45 * (1 - L));
    if (sim.crystalLit) for (const lm of sim.terrain.landmarks) if (lm.kind === 'templo' && inV(lm.x + 3, lm.y, 8)) glow(fx, sx(lm.x + 3), sy(lm.y) - ch * 2.6, cs * (3 + Math.sin(ts * 1.5) * 0.4), '200,170,255', 0.55);
    fx.globalCompositeOperation = 'source-over';
    if (burn) {
      // árvore em chamas: fogo alto e fumaça subindo
      drawFire(fx, sx(burn.x), sy(burn.y) - ch * 1.4, cs * 2.4, ch * 2.2, ts, seed + 77);
      fx.font = `700 ${Math.round(10 * z + 4)}px "JetBrains Mono",monospace`;
      for (let k = 0; k < 8; k++) { const life = (ts * 0.4 + k / 8) % 1; fx.fillStyle = `rgba(110,110,118,${0.5 * (1 - life)})`; fx.fillText(k % 2 ? 'O' : 'o', sx(burn.x) + Math.sin(ts + k * 1.7) * 6 * z + life * 14 * z, sy(burn.y) - ch * 2.6 - life * 60 * z); }
    }
    drawDeer(fx, sim, view, tf);
    // cogumelos que brilham à noite
    if (L < 0.5 && z >= 0.65) {
      const x0 = Math.max(0, Math.floor(ox)), x1 = Math.min(COLS, Math.ceil(ox + vw) + 1), y0 = Math.max(0, Math.floor(oy)), y1 = Math.min(ROWS, Math.ceil(oy + vh) + 1);
      fx.globalCompositeOperation = 'lighter';
      for (const i of this.cells('mush')) {
        const x = i % COLS, y = (i / COLS) | 0, hh = h32(x, y, seed + 21);
        if (x < x0 || x >= x1 || y < y0 || y >= y1) continue;
        const px = sx(x) + ((hh >>> 4) % 10 - 5) * cs * 0.06, py = sy(y) - ch * 0.4, a = (0.35 + 0.25 * Math.sin(ts * 1.5 + hh)) * (1 - L);
        glow(fx, px, py, cs * 0.9, '120,220,255', a);
      }
      fx.globalCompositeOperation = 'source-over';
    }
    this.denseFog(fx, sx, sy, inV, cs, ch, ts, L, z);
    for (const p of fires) if (p !== fires[fires.length - 1] || !burn) drawFire(fx, sx(p.x), sy(p.y) - ch * 0.45, cs * 1.5, ch * 1.5, ts, seed + p.x);

    // vagalumes e chuva
    if (sim.isFireflyRace() && wx.rain < 0.2) {
      // corrida de vaga-lumes: quatro enxames dando voltas na ágora em velocidades diferentes
      const ag = sim.terrain.agora;
      for (let team = 0; team < 4; team++) for (let k = 0; k < 14; k++) {
        const ang = ts * (0.35 + team * 0.07) + team * 1.6 - k * 0.05, rr = 1.25 + team * 0.12;
        const px = sx(ag.x + Math.cos(ang) * ag.rx * rr) + Math.sin(ts * 4 + k) * 4, py = sy(ag.y + Math.sin(ang) * ag.ry * rr) - ch + Math.cos(ts * 3 + k) * 4;
        fx.fillStyle = `rgba(${['220,255,140', '255,210,120', '150,230,255', '255,160,220'][team]},${0.9 - k * 0.05})`;
        fx.beginPath(); fx.arc(px, py, 2.2 - k * 0.1, 0, 7); fx.fill();
      }
    }
    if (L < 0.6 && wx.rain < 0.2) for (let k = 0; k < (sim.season === 0 ? 90 : sim.season === 2 ? 15 : 50); k++) {
      const px = ((((h32(k, 7, seed) % 1000) / 1000) * VW + Math.sin(ts * 0.7 + k) * 30) % VW + VW) % VW;
      const py = ((((h32(k, 9, seed) % 1000) / 1000) * VH + Math.cos(ts * 0.5 + k * 1.3) * 20) % VH + VH) % VH;
      fx.fillStyle = `rgba(220,255,140,${(0.5 + 0.5 * Math.sin(ts * 3 + k)) * 0.85})`;
      fx.beginPath(); fx.arc(px, py, 1.4, 0, 7); fx.fill();
    }
    // vida no mapa: borboletas nas flores, peixes pulando, folhas no vento e bandos de pássaros
    fx.textAlign = 'center'; fx.textBaseline = 'middle';
    if (L > 0.6 && wx.rain < 0.2) {
      fx.font = `700 ${Math.round(9 + 3 * z)}px "JetBrains Mono",monospace`;
      for (let k = 0; k < Math.min(14, fl.length); k++) {
        const f = fl[h32(k, 41, seed) % fl.length]!, ph = ts * (2 + (k % 3)) + k;
        fx.fillStyle = ['#ffd36b', '#f07aa8', '#9fd8ff', '#ffffff'][k % 4]!;
        fx.fillText(Math.sin(ph * 6) > 0 ? 'v' : '-', sx(f.x) + Math.sin(ph * 0.7) * cs * 1.6, sy(f.y) - ch * (0.9 + 0.5 * Math.sin(ph * 0.9)));
      }
    }
    if (z >= 0.65) {
      // peixe pulando: um anel que abre na água visível
      for (let k = 0; k < 6; k++) {
        const slot = Math.floor(ts / 3 + k / 6), life = ((ts / 3 + k / 6) % 1);
        const x = Math.floor(ox + ((h32(slot, k, seed) % 1000) / 1000) * vw), y = Math.floor(oy + ((h32(slot, k + 9, seed) % 1000) / 1000) * vh);
        if (x < 0 || y < 0 || x >= COLS || y >= ROWS || sim.terrain.T[y * COLS + x]! > Tile.Shallow) continue;
        fx.strokeStyle = `rgba(170,215,235,${0.55 * (1 - life)})`; fx.lineWidth = 1;
        fx.beginPath(); fx.ellipse(sx(x), sy(y) - ch * 0.5, cs * (0.2 + life * 1.4), ch * (0.08 + life * 0.35), 0, 0, 7); fx.stroke();
        if (life < 0.25) { fx.fillStyle = '#b8d8e8'; fx.font = `700 ${Math.round(10 + 3 * z)}px "JetBrains Mono",monospace`; fx.fillText('>', sx(x), sy(y) - ch * (0.6 + Math.sin(life * 4 * Math.PI) * 0.6)); }
      }
    }
    if (wx.wind > 0.45 && L > 0.2) {
      const n = Math.round((wx.wind - 0.45) * 60);
      fx.font = `700 ${Math.round(9 + 3 * z)}px "JetBrains Mono",monospace`;
      for (let k = 0; k < n; k++) {
        const sp = 60 + (h32(k, 61, seed) % 80) * (0.5 + wx.wind);
        const px = ((((h32(k, 62, seed) % 1000) / 1000) * (VW + 200) + ts * sp) % (VW + 200)) - 100, py = (((h32(k, 63, seed) % 1000) / 1000) * VH + Math.sin(ts * 1.3 + k) * 30 + ts * 18) % VH;
        fx.fillStyle = (sim.season === 1 ? ['#c8702a', '#e8a048', '#a8521c', '#d88a30'] : sim.season === 3 ? ['#f4c2d8', '#7a9a3c', '#ffffff', '#5f8a3a'] : ['#7a9a3c', '#a8892f', '#8a5a2a', '#5f8a3a'])[k % 4]!;
        fx.fillText(Math.sin(ts * 5 + k) > 0 ? ',' : '`', px, py);
      }
    }
    if (L > 0.7 && wx.rain < 0.3) {
      // bando de pássaros cruzando a tela a cada ~45 s
      const cyc = ts / 45, slot = Math.floor(cyc), f = cyc - slot;
      if (f < 0.35 && h32(slot, 71, seed) % 2 === 0) {
        const dir = h32(slot, 72, seed) % 2 ? 1 : -1, bx = dir > 0 ? -100 + (f / 0.35) * (VW + 200) : VW + 100 - (f / 0.35) * (VW + 200), by = 60 + (h32(slot, 73, seed) % 1000) / 1000 * VH * 0.5;
        fx.font = `700 ${Math.round(11 + 2 * z)}px "JetBrains Mono",monospace`; fx.fillStyle = 'rgba(20,24,28,.75)';
        for (let k = 0; k < 7; k++) { const row = Math.ceil(k / 2), side = k % 2 ? 1 : -1; fx.fillText(Math.sin(ts * 9 + k) > 0 ? 'v' : '-', bx - dir * row * 14, by + side * row * 9 + Math.sin(ts * 2 + k) * 3); }
      }
    }

    // bola na ágora: pares de quem está passeando por lá chutam uma bola de um para o outro
    if (L > 0.6 && wx.rain < 0.3) {
      const ag = sim.terrain.agora, players = list.filter(a => a.state === 'AGORA' && a.phase === 'boid').sort((p, q) => (p.name < q.name ? -1 : 1));
      for (let k = 0; k + 1 < players.length; k += 2) {
        const A = this.screen.get(players[k]!)!, B = this.screen.get(players[k + 1]!)!;
        if (Math.hypot(A.x - B.x, A.y - B.y) > cs * 12 || Math.abs(players[k]!.x - ag.x) > ag.rx) continue;
        const cyc = ts / 1.3 + k, u = cyc % 1, fwd = Math.floor(cyc) % 2 === 0, P0 = fwd ? A : B, P1 = fwd ? B : A;
        const bx = P0.x + (P1.x - P0.x) * u, by = P0.y + (P1.y - P0.y) * u - Math.sin(u * Math.PI) * ch * 1.2 - 3 * z;
        fx.fillStyle = 'rgba(0,0,0,.3)'; fx.beginPath(); fx.ellipse(P0.x + (P1.x - P0.x) * u, P0.y + (P1.y - P0.y) * u - z, 3 * z, 1.2 * z, 0, 0, 7); fx.fill();
        fx.fillStyle = '#f4efe4'; fx.beginPath(); fx.arc(bx, by, 3 * z, 0, 7); fx.fill();
        fx.fillStyle = '#c43c3c'; fx.fillRect(bx - 3 * z, by - 0.6 * z, 6 * z, 1.2 * z);
      }
    }
    // festa de pedido atendido: confete caindo sobre a ágora
    if (party && L > 0.3) {
      const ag = sim.terrain.agora;
      for (let k = 0; k < 70; k++) {
        const u = ((ts * (0.15 + (k % 5) * 0.03) + (h32(k, 81, seed) % 1000) / 1000) % 1);
        const x = sx(ag.x + (((h32(k, 82, seed) % 1000) / 1000) * 2 - 1) * ag.rx * 1.1 + Math.sin(ts * 2 + k) * 0.6), y = sy(ag.y - ag.ry * 1.6 + u * ag.ry * 2.6);
        fx.fillStyle = ['#f2c14e', '#f07aa8', '#7cc4ff', '#86e095', '#ff9a5a'][k % 5]!;
        fx.fillRect(x, y, 3 * z, (1.5 + Math.abs(Math.sin(ts * 6 + k)) * 2) * z);
      }
    }
    // riacho: folhas e barquinhos de papel descendo a correnteza
    if (z >= 0.65 && sim.terrain.stream.length > 10) {
      const S = sim.terrain.stream;
      fx.font = `700 ${Math.round(9 + 3 * z)}px "JetBrains Mono",monospace`;
      for (let k = 0; k < 10; k++) {
        const pos = ((ts * (1.2 + (k % 3) * 0.4) + k * (S.length / 10)) % S.length), c = S[Math.floor(pos)]!, x = c % COLS, y = (c / COLS) | 0;
        if (!inV(x, y, 1)) continue;
        const boat = k % 4 === 0;
        fx.fillStyle = boat ? '#f4efe4' : (sim.season === 1 ? '#d88a30' : '#7a9a3c');
        fx.fillText(boat ? '◣' : Math.sin(ts * 3 + k) > 0 ? ',' : '`', sx(x) + Math.sin(ts * 1.5 + k) * cs * 0.2, sy(y) - ch * 0.45);
      }
    }
    // chuva de estrelas e lanternas no céu
    if (ts < this.starRainUntil) {
      const left = this.starRainUntil - ts;
      for (let k = 0; k < 40; k++) {
        const u = ((ts * 0.6 + (h32(k, 91, 1) % 1000) / 1000) % 1), x0 = ((h32(k, 92, 1) % 1000) / 1000) * VW * 1.2;
        const x = x0 - u * 220, y = u * VH * 0.9, a = Math.min(1, left / 3) * (1 - u);
        const g = fx.createLinearGradient(x + 60, y - 30, x, y); g.addColorStop(0, 'rgba(255,255,255,0)'); g.addColorStop(1, `rgba(255,245,200,${a})`);
        fx.strokeStyle = g; fx.lineWidth = 1.6; fx.beginPath(); fx.moveTo(x + 60, y - 30); fx.lineTo(x, y); fx.stroke();
      }
    }
    this.skyLanterns = this.skyLanterns.filter(lt => ts - lt.t0 < 25);
    for (const lt of this.skyLanterns) {
      const u = ts - lt.t0, x = sx(lt.x + Math.sin(u * 0.4) * 2), y = sy(lt.y - u * 0.9), a = 1 - u / 25;
      glow(fx, x, y, 18, `255,${170 + lt.hue},90`, 0.5 * a);
      fx.fillStyle = `rgba(255,${190 + lt.hue / 2},120,${a})`; fx.fillRect(x - 4, y - 6, 8, 10);
    }
    // céu refletido nos lagos: estrelas piscando e estrela cadente
    if (L < 0.4 && wx.cloud < 0.6) {
      const a0 = (1 - L) * (1 - wx.cloud), x0 = Math.max(0, Math.floor(ox)), x1 = Math.min(COLS, Math.ceil(ox + vw) + 1), y0 = Math.max(0, Math.floor(oy)), y1 = Math.min(ROWS, Math.ceil(oy + vh) + 1);
      for (const i of this.cells('water')) {
        const x = i % COLS, y = (i / COLS) | 0, hh = h32(x, y, seed + 13);
        if (x < x0 || x >= x1 || y < y0 || y >= y1) continue;
        fx.fillStyle = `rgba(235,240,255,${a0 * (0.35 + 0.45 * Math.sin(ts * (1 + (hh % 5) * 0.4) + hh))})`;
        fx.fillRect(sx(x) + ((hh >>> 4) % 10 - 5) * cs * 0.08, sy(y) - ch * (0.2 + ((hh >>> 8) % 6) * 0.1), 1.5, 1.5);
      }
    }
    if (tf - sim.shootingAt < 3 && tf >= sim.shootingAt) {
      const u = (tf - sim.shootingAt) / 3, hh = h32(sim.shootingAt, 5, seed);
      const x0 = ((hh % 1000) / 1000) * VW * 0.7, y0 = (((hh >>> 10) % 1000) / 1000) * VH * 0.3, len = 260;
      const hx = x0 + u * len * 1.6, hy = y0 + u * len * 0.6;
      const g = fx.createLinearGradient(hx - 120, hy - 45, hx, hy); g.addColorStop(0, 'rgba(255,255,255,0)'); g.addColorStop(1, `rgba(255,250,220,${1 - u})`);
      fx.strokeStyle = g; fx.lineWidth = 2; fx.beginPath(); fx.moveTo(hx - 120, hy - 45); fx.lineTo(hx, hy); fx.stroke();
    }

    // neblina: véu claro e bancos de névoa que derivam com o vento
    if (wx.fog > 0.05) {
      fx.fillStyle = `rgba(170,182,196,${wx.fog * 0.22})`;
      fx.fillRect(0, 0, VW, VH);
      for (let k = 0; k < 7; k++) {
        const px = ((((h32(k, 21, seed) % 1000) / 1000) * (VW + 600) + ts * (8 + wx.wind * 20)) % (VW + 600)) - 300;
        const py = ((h32(k, 23, seed) % 1000) / 1000) * VH, r = 180 + (h32(k, 25, seed) % 220);
        glow(fx, px, py, r * 1.8, '190,200,212', wx.fog * 0.28, r * 0.6);
      }
    }
    // no inverno a chuva vira neve
    if (wx.rain > 0.08 && sim.season === 2) {
      const n = Math.round(40 + wx.rain * 220);
      fx.fillStyle = 'rgba(240,246,250,.8)';
      for (let k = 0; k < n; k++) {
        const px = ((((h32(k, 3, seed) % 1000) / 1000) * VW + Math.sin(ts * 0.8 + k) * 20 - ts * wx.wind * 30) % VW + VW) % VW, py = ((((h32(k, 5, seed) % 1000) / 1000) * VH + ts * (40 + (k % 5) * 8)) % (VH + 20)) - 10;
        fx.beginPath(); fx.arc(px, py, 1 + (k % 3) * 0.6, 0, 7); fx.fill();
      }
    }
    // chuva com intensidade e inclinação pelo vento
    else if (wx.rain > 0.08) {
      const n = Math.round(30 + wx.rain * 320), slant = 2 + wx.wind * 12, len = 8 + wx.rain * 8;
      fx.strokeStyle = `rgba(160,190,230,${0.22 + wx.rain * 0.28})`; fx.lineWidth = 1.2; fx.beginPath();
      for (let k = 0; k < n; k++) {
        const px = ((((h32(k, 3, seed) % 1000) / 1000) * VW - ts * (40 + wx.wind * 160)) % VW + VW) % VW, py = ((((h32(k, 5, seed) % 1000) / 1000) * VH + ts * 520) % (VH + 20)) - 10;
        fx.moveTo(px, py); fx.lineTo(px - slant, py + len);
      }
      fx.stroke();
    }
    // relâmpago
    if (wx.storm) {
      const fl = lightningAt(ts, seed);
      if (fl > 0) { fx.fillStyle = `rgba(215,225,255,${fl * 0.4})`; fx.fillRect(0, 0, VW, VH); }
    }

    if (this.hideLabels) return;
    // balões e nomes por cima da escuridão
    fx.textAlign = 'center'; fx.textBaseline = 'middle';
    fx.font = `700 ${Math.round(12 + 4 * z)}px Inter,sans-serif`;
    for (const a of list) {
      const p = this.screen.get(a)!;
      if (a.state === 'CHAT' && a.phase === 'stay' && a.friend) {
        // conversa: os dois se revezam, cada fala dura 3 segundos
        const slot = Math.floor(sim.tick / 6), me = a.name < a.friend.name ? 0 : 1;
        if ((slot + me) % 2) continue;
        fx.fillStyle = '#e8e2d0';
        fx.fillText(CHAT[h32(slot, a.hue, 3) % CHAT.length]!, p.x + 7 * sc, p.y - 15 * sc - Math.sin(ts * 3) * 1.5);
        continue;
      }
      if (a.bubble === 'gift' && sim.tick <= a.bubbleUntil) {
        const gx = p.x + 7 * sc, gy = p.y - 16 * sc - Math.sin(ts * 2) * 2, s0 = 4 * z;
        fx.fillStyle = '#c43c3c'; fx.fillRect(gx - s0, gy - s0, s0 * 2, s0 * 2);
        fx.fillStyle = '#f2c14e'; fx.fillRect(gx - s0, gy - s0 * 0.2, s0 * 2, s0 * 0.4); fx.fillRect(gx - s0 * 0.2, gy - s0, s0 * 0.4, s0 * 2);
        continue;
      }
      if (a.bubble === 'balde' && sim.tick <= a.bubbleUntil) {
        // balde d'água jogado no fogo
        const gx = p.x + 7 * sc, gy = p.y - 15 * sc, s0 = 3.5 * z;
        fx.fillStyle = '#8a5a32'; fx.beginPath(); fx.moveTo(gx - s0, gy - s0); fx.lineTo(gx + s0, gy - s0); fx.lineTo(gx + s0 * 0.7, gy + s0); fx.lineTo(gx - s0 * 0.7, gy + s0); fx.fill();
        fx.fillStyle = '#7cc4ff'; fx.fillRect(gx - s0, gy - s0 - 1.5 * z, s0 * 2, 1.5 * z);
        continue;
      }
      if (a.bubble && sim.tick <= a.bubbleUntil && !(a.bubble === 'z' && (ts | 0) % 3 === 0)) {
        fx.fillStyle = a.bubble === '♥' ? '#ff7aa8' : a.bubble === '¨' ? '#7cc4ff' : a.bubble === '♪' ? '#c9a8ff' : a.bubble === '◆' ? '#c8a8ff' : a.bubble === '♟' ? '#e8e2d0' : a.bubble === 'hmpf' ? '#e07a5a' : '#f2c14e';
        fx.fillText(a.bubble, p.x + 7 * sc, p.y - 15 * sc - Math.sin(ts * 2) * 2);
      }
    }
    const showAll = z >= 0.8;
    fx.font = '600 11px Inter,sans-serif';
    for (const a of list) {
      if (!(showAll || a === selected || a === hovered)) continue;
      const p = this.screen.get(a)!, py = p.y - 14 * sc - 10, w = fx.measureText(a.name).width + 12;
      fx.fillStyle = a === selected ? 'rgba(242,193,78,.95)' : 'rgba(4,7,9,.72)';
      fx.beginPath(); fx.roundRect(p.x - w / 2, py - 8, w, 16, 8); fx.fill();
      fx.fillStyle = a === selected ? '#1b1404' : css(a.col);
      fx.fillText(a.name, p.x, py);
    }
    // nomes de quem acampou (fork) e do mercador
    fx.font = '600 10px Inter,sans-serif';
    const tag = (text: string, x: number, y: number, col: string) => { const w = fx.measureText(text).width + 10; fx.fillStyle = 'rgba(4,7,9,.65)'; fx.beginPath(); fx.roundRect(x - w / 2, y - 7, w, 14, 7); fx.fill(); fx.fillStyle = col; fx.fillText(text, x, y); };
    if (z >= 0.65) for (const k of sim.forks) if (inV(k.x, k.y, 3)) tag(`⑂ ${k.login}`, sx(k.x + 0.5), sy(k.y) - ch * 2.8, '#9fd8ff');
    if (mc && inV(mc.x, mc.y, 3)) tag(`mercador ${sim.merchant}`, sx(mc.x), sy(mc.y) - 14 * sc - 10, '#f2c14e');
    const sp = selected && this.screen.get(selected);
    if (sp) { fx.strokeStyle = '#f2c14e'; fx.lineWidth = 1.5; fx.beginPath(); fx.ellipse(sp.x, sp.y - 2 * z, 7 * sc, 2.4 * sc, 0, 0, 7); fx.stroke(); }
  }

  /** Névoa que escorre da mata fechada, olhos piscando lá dentro à noite e as ovelhas do cercado. */
  private denseFog(fx: CanvasRenderingContext2D, sx: (x: number) => number, sy: (y: number) => number, inV: (x: number, y: number, up?: number) => boolean, cs: number, ch: number, ts: number, L: number, z: number): void {
    const t = this.sim.terrain, d = t.dense, seed = t.seed, right = d.x0 > COLS / 2;
    if (inV((d.x0 + d.x1) / 2, d.y0, 40) || inV(d.x0, d.y1) || inV(d.x1, d.y1)) {
      for (let k = 0; k < 16; k++) {
        // cada banco nasce dentro da mata e vai saindo devagar, sumindo no caminho
        const life = (ts * 0.025 + k / 16) % 1, bx = d.x0 + ((h32(k, 5, seed) % 1000) / 1000) * (d.x1 - d.x0), by = d.y0 + 4 + ((h32(k, 6, seed) % 1000) / 1000) * (d.y1 - d.y0 - 4);
        const x = bx + (right ? -1 : 1) * life * 26, y = by - life * 10, a = Math.sin(life * Math.PI) * (0.16 + (1 - L) * 0.12);
        if (!inV(x, y, 12)) continue;
        const px = sx(x), py = sy(y), r = cs * (6 + (h32(k, 7, seed) % 6));
        glow(fx, px, py, r * 1.6, '200,210,220', a, r * 0.6);
      }
      if (L < 0.4) for (let k = 0; k < 7; k++) {
        const slot = Math.floor(ts / 5 + k * 0.37), blink = (ts / 5 + k * 0.37) % 1;
        if (blink > 0.85 || h32(slot, k, seed) % 3 === 0) continue;
        const x = d.x0 + 3 + (h32(slot, k + 1, seed) % Math.max(1, d.x1 - d.x0 - 6)), y = d.y0 + 6 + (h32(slot, k + 2, seed) % Math.max(1, d.y1 - d.y0 - 8));
        if (!inV(x, y)) continue;
        fx.fillStyle = k % 3 ? 'rgba(255,220,90,.9)' : 'rgba(160,255,140,.85)';
        fx.fillRect(sx(x) - 3 * z, sy(y) - ch * 0.6, 2 * z, 1.6 * z); fx.fillRect(sx(x) + 1.5 * z, sy(y) - ch * 0.6, 2 * z, 1.6 * z);
      }
    }
    const p = t.pen;
    if (z >= 0.65 && L > 0.25 && inV((p.x0 + p.x1) / 2, (p.y0 + p.y1) / 2, 4)) {
      fx.font = `700 ${Math.round(9 + 4 * z)}px "JetBrains Mono",monospace`; fx.textAlign = 'center'; fx.textBaseline = 'middle';
      for (let k = 0; k < 5; k++) {
        const x = p.x0 + 2 + (p.x1 - p.x0 - 4) * (0.5 + 0.45 * t.noise(ts * 0.03 + k, k * 2.1, 9.1)), y = p.y0 + 2 + (p.y1 - p.y0 - 3) * (0.5 + 0.45 * t.noise(k * 1.3, ts * 0.03 + k, 4.4));
        fx.fillStyle = '#f4f0e4'; fx.fillText('@', sx(x), sy(y) - ch * 0.5);
        fx.fillStyle = '#2a2a2e'; fx.fillText(Math.sin(ts + k) > 0 ? '>' : '<', sx(x) + cs * 0.35 * (Math.sin(ts + k) > 0 ? 1 : -1), sy(y) - ch * 0.55);
      }
    }
  }

  drawMini(selected: Agent | null): void {
    if (this.miniVersion !== this.sim.groundVersion) this.buildMini();
    const mx = this.mx;
    mx.imageSmoothingEnabled = false;
    mx.drawImage(this.mini, 0, 0);
    mx.fillStyle = '#ff9a3c';
    for (const p of this.sim.terrain.plazas) mx.fillRect(p.x - 1, p.y - 1, 3, 3);
    mx.fillStyle = '#e8dec4';
    for (const l of this.sim.terrain.landmarks) if (l.kind !== 'barraca') mx.fillRect(l.x, l.y - 1, Math.max(2, l.w), 2);
    for (const a of this.sim.agents) { if (!a.present) continue; mx.fillStyle = a === selected ? '#f2c14e' : css(a.col); mx.fillRect(a.x - 1, a.y - 1, 3, 3); }
    const { ox, oy, vw, vh } = this.view();
    mx.strokeStyle = 'rgba(255,255,255,.85)'; mx.lineWidth = 1; mx.strokeRect(ox + 0.5, oy + 0.5, vw, vh);
  }
}
