import { css, hex, mix, type RGB } from '../core/color';
import { h32 } from '../core/rng';
import { COLS, N, ROWS, SPECIES, TICK_MS, Tile } from '../sim/constants';
import { hourAt, stageOf, type Simulation } from '../sim/simulation';
import type { Agent } from '../sim/types';
import { CHUNK, GroundCache } from './ground';
import { clearPropCache, drawFire, houseSprite } from './props';
import { spritesFor } from './sprites';
import { clearTreeCache, treeSprite } from './trees';

export const CW = 10;
export const CH = 18;
export const ZOOMS = [0.5, 0.65, 0.8, 1, 1.25, 1.6, 2];

/** Cores do minimapa (1 pixel por célula). */
const MINI: Record<number, RGB> = { 0: hex('#0b2333'), 1: hex('#16405a'), 2: hex('#5e5139'), 3: hex('#1f4a2b'), 4: hex('#12291a'), 5: hex('#474a51'), 6: hex('#50505a'), 7: hex('#2e2e35') };
/** Luz do dia (1 = meio-dia). O mundo nunca fica totalmente claro: há sempre uma penumbra. */
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
  private miniVersion = -1;
  /** quando true, o próximo drawScene desenha todos os blocos visíveis de uma vez (atrás da tela de carregamento ou após zoom) */
  warm = true;
  private groundCache: GroundCache;
  /** posição na tela de cada morador visível no último quadro */
  readonly screen = new Map<Agent, { x: number; y: number }>();

  constructor(private readonly bgc: HTMLCanvasElement, private readonly fgc: HTMLCanvasElement, miniCanvas: HTMLCanvasElement, public sim: Simulation) {
    this.bx = bgc.getContext('2d')!;
    this.fx = fgc.getContext('2d')!;
    this.mx = miniCanvas.getContext('2d')!;
    this.dx = this.dark.getContext('2d')!;
    this.mini.width = COLS;
    this.mini.height = ROWS;
    this.groundCache = new GroundCache(sim);
    this.resize();
  }

  resize(): void {
    this.dpr = Math.min(2, window.devicePixelRatio || 1);
    this.VW = innerWidth;
    this.VH = innerHeight;
    for (const c of [this.bgc, this.fgc, this.dark]) { c.width = Math.round(this.VW * this.dpr); c.height = Math.round(this.VH * this.dpr); }
    clearTreeCache();
    clearPropCache();
    this.clampCam();
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
    nz = Math.max(0, Math.min(ZOOMS.length - 1, nz));
    if (nz === this.zi) return;
    const { ox, oy } = this.view();
    const wx = ox + px / (CW * this.zoom), wy = oy + py / (CH * this.zoom);
    this.zi = nz;
    this.zoom = ZOOMS[nz]!;
    this.cam.x = wx - px / (CW * this.zoom) + this.VW / (2 * CW * this.zoom);
    this.cam.y = wy - py / (CH * this.zoom) + this.VH / (2 * CH * this.zoom);
    clearTreeCache();
    clearPropCache();
    this.warm = true;
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
    const budget = { n: this.warm ? 99 : 4 };
    this.warm = false;
    let pending = false;
    for (let cy = r0; cy <= r1; cy++) for (let cx = c0; cx <= c1; cx++) {
      const img = this.groundCache.get(cx, cy, cw, ch, budget);
      if (img) bx.drawImage(img, Math.round((cx * CHUNK - ox) * cw), Math.round((cy * CHUNK - oy) * ch));
      else pending = true;
    }
    // vento: faixas de rajada passam pela grama; brilho na água
    const x0 = Math.max(0, Math.floor(ox)), x1 = Math.min(COLS, Math.ceil(ox + vw) + 1), y0 = Math.max(0, Math.floor(oy)), y1 = Math.min(ROWS, Math.ceil(oy + vh) + 1);
    bx.font = `700 ${Math.max(3, Math.round((ch / 4) * 1.45))}px "JetBrains Mono",monospace`;
    bx.textAlign = 'center';
    bx.textBaseline = 'middle';
    for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) {
      const i = y * COLS + x, t = T[i]!, hs = h32(x, y, seed) % 100;
      if (t === Tile.Grass && sim.wear[i]! < 6 && hs < 45) {
        const w = noise(x * 0.06 - ts * 0.35, y * 0.12, ts * 0.05);
        if (w < 0.22) continue;
        bx.fillStyle = w > 0.34 ? '#6fa86a' : '#4f8a52';
        bx.fillText(hs % 2 ? '/' : "'", (x - ox + 0.2 + (hs % 3) * 0.3) * cw, (y - oy + 0.25 + (hs % 4) * 0.18) * ch);
      } else if (t <= Tile.Shallow && hs < 50) {
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
    const { ox, oy, vw, vh } = this.view(), h = hourAt(sim.tick), rain = sim.isRain(), L = lightAt(h);
    const cs = CW * z, ch = CH * z, sc = z * 2, VW = this.VW, VH = this.VH;
    fx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    fx.clearRect(0, 0, VW, VH);
    fx.imageSmoothingEnabled = false;
    this.screen.clear();
    const sx = (x: number) => (x - ox + 0.5) * cs, sy = (y: number) => (y - oy + 1) * ch;
    const inV = (x: number, y: number, up = 11) => x >= ox - 4 && x <= ox + vw + 4 && y >= oy - 1 && y <= oy + vh + up;
    const list = sim.agents.filter(a => a.present && inV(a.x, a.y, 3));
    type TreeDraw = { x: number; y: number; kind: string; variant: number; scale: number; thirsty: boolean };
    const trees: TreeDraw[] = [];
    for (const w of sim.terrain.wild) if (inV(w.x, w.y)) trees.push({ x: w.x, y: w.y, kind: ['mata-copa', 'mata-pinho', 'cipreste'][w.sp]!, variant: h32(w.x, w.y, 5) % 4, scale: w.big ? 1.1 : 0.75, thirsty: false });
    for (const t of sim.trees) { const st = stageOf(t); if (st > 0 && inV(t.x, t.y)) trees.push({ x: t.x, y: t.y, kind: SPECIES[t.sp]!.n, variant: h32(t.x, t.y, 5) % 4, scale: [0, 0.4, 0.7, 1][st]!, thirsty: sim.tick - t.lastWater > 3000 && !rain }); }
    const evening = L < 0.95;
    const houses = sim.agents.filter(a => a.hut && inV(a.home.x - 1, a.home.y, 4)).map(a => ({ a, spr: houseSprite(a.hue, evening, cs, ch, this.dpr) }));
    const fires = sim.terrain.plazas.filter(p => inV(p.x, p.y, 3));
    const sprites = trees.map(t => ({ t, spr: treeSprite(t.kind, t.variant, t.scale, t.thirsty, z, this.dpr, CW, CH) }));

    // sombras: direção e comprimento pela posição do sol; à noite só um contato leve no chão
    const sun = Math.max(-1, Math.min(1, (h - 12.5) / 6)), shLen = L < 0.3 ? 0.12 : 0.35 + Math.abs(sun) * 0.9, shA = L < 0.3 ? 0.22 : rain ? 0.2 : 0.38;
    fx.fillStyle = `rgba(0,0,0,${shA})`;
    for (const { t, spr } of sprites) {
      const len = spr.h * shLen;
      fx.beginPath(); fx.ellipse(sx(t.x) + sun * len * 0.5, sy(t.y) - ch * 0.2 + len * 0.12, spr.canopyW * 0.42 + Math.abs(sun) * len * 0.5, spr.canopyW * 0.2 + len * 0.08, 0, 0, 7); fx.fill();
    }
    for (const { a, spr } of houses) { fx.beginPath(); fx.ellipse(sx(a.home.x - 1) + sun * spr.h * shLen * 0.4, sy(a.home.y) - ch * 0.1, spr.w * 0.55 + Math.abs(sun) * spr.h * 0.3, ch * 0.35, 0, 0, 7); fx.fill(); }
    fx.fillStyle = 'rgba(0,0,0,.35)';
    for (const a of list) { const f = Math.min(1, Math.max(0, (tf - a.mt) / a.pace)); fx.beginPath(); fx.ellipse(sx(a.px + (a.x - a.px) * f), sy(a.py + (a.y - a.py) * f) - 2 * z, 5 * sc, 1.6 * sc, 0, 0, 7); fx.fill(); }

    // tudo que tem altura, na ordem de profundidade
    type D = { y: number; draw: () => void };
    const ds: D[] = [];
    for (const { t, spr } of sprites) {
      const wind = sim.terrain.noise(t.x * 0.06 - ts * 0.35, t.y * 0.12, ts * 0.05), sk = wind * 0.07 + Math.sin(ts * 1.7 + t.x) * 0.008;
      ds.push({ y: t.y + 0.01, draw: () => { fx.save(); fx.translate(sx(t.x), sy(t.y)); fx.transform(1, 0, -sk, 1, 0, 0); fx.drawImage(spr.canvas, -spr.w / 2, -spr.h, spr.w, spr.h); fx.restore(); } });
    }
    for (const { a, spr } of houses) ds.push({ y: a.home.y + 0.02, draw: () => fx.drawImage(spr.canvas, sx(a.home.x - 1) - spr.w / 2, sy(a.home.y) - spr.h + ch * 0.1, spr.w, spr.h) });
    for (const a of list) {
      const f = Math.min(1, Math.max(0, (tf - a.mt) / a.pace)), wx = a.px + (a.x - a.px) * f, wy = a.py + (a.y - a.py) * f, moving = f < 1;
      const p = { x: sx(wx), y: sy(wy) };
      this.screen.set(a, p);
      ds.push({ y: wy, draw: () => {
        const spr = spritesFor(a.name, a.look), sleeping = a.phase === 'stay' && a.state === 'REST';
        const fr = sleeping ? spr.sleep : moving && Math.floor((tf * 4) / a.pace) % 2 ? spr.step : spr.stand, bob = moving && fr === spr.step ? -sc : 0;
        fx.save(); fx.translate(p.x, p.y - 14 * sc - z + bob); if (a.face < 0) fx.scale(-1, 1); fx.drawImage(fr, -4 * sc, 0, 8 * sc, 14 * sc); fx.restore();
      } });
    }
    ds.sort((p, q) => p.y - q.y);
    for (const d of ds) d.draw();

    // fumaça das chaminés no fim do dia
    if (evening) {
      fx.font = `700 ${Math.round(9 * z)}px "JetBrains Mono",monospace`; fx.textAlign = 'center'; fx.textBaseline = 'middle';
      for (const { a, spr } of houses) for (let k = 0; k < 4; k++) {
        const life = (ts * 0.35 + k / 4 + a.hue / 360) % 1;
        fx.fillStyle = `rgba(150,150,160,${0.35 * (1 - life)})`;
        fx.fillText(k % 2 ? '°' : 'o', sx(a.home.x - 1) + spr.w * 0.17 + Math.sin(ts + k * 2) * 4 * z + life * 10 * z, sy(a.home.y) - spr.h * 0.85 - life * 40 * z);
      }
    }

    // escuridão com furos de luz (fogueiras sempre; janelas ao anoitecer)
    const dark = 0.14 + (1 - L) * 0.66 + (rain ? 0.08 : 0);
    const dx = this.dx;
    dx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    dx.globalCompositeOperation = 'source-over';
    dx.clearRect(0, 0, VW, VH);
    dx.fillStyle = `rgba(3,5,14,${Math.min(0.9, dark)})`;
    dx.fillRect(0, 0, VW, VH);
    dx.globalCompositeOperation = 'destination-out';
    const hole = (x: number, y: number, r: number, s: number) => { const g = dx.createRadialGradient(x, y, 0, x, y, r); g.addColorStop(0, `rgba(0,0,0,${s})`); g.addColorStop(0.55, `rgba(0,0,0,${s * 0.55})`); g.addColorStop(1, 'rgba(0,0,0,0)'); dx.fillStyle = g; dx.beginPath(); dx.arc(x, y, r, 0, 7); dx.fill(); };
    const flick = (k: number) => 1 + Math.sin(ts * 11 + k) * 0.05 + Math.sin(ts * 23 + k * 3) * 0.035;
    for (const p of fires) hole(sx(p.x), sy(p.y) - ch * 0.5, cs * 8 * flick(p.x), 0.95);
    if (evening) for (const { a, spr } of houses) hole(sx(a.home.x - 1), sy(a.home.y) - spr.h * 0.3, cs * 3.2, 0.75 * (1 - L));
    fx.drawImage(this.dark, 0, 0, VW, VH);
    // brilho quente
    fx.globalCompositeOperation = 'lighter';
    for (const p of fires) { const x = sx(p.x), y = sy(p.y) - ch * 0.5, r = cs * 6 * flick(p.x + 9); const g = fx.createRadialGradient(x, y, 0, x, y, r); g.addColorStop(0, `rgba(255,150,60,${0.32 + (1 - L) * 0.2})`); g.addColorStop(1, 'rgba(255,120,40,0)'); fx.fillStyle = g; fx.beginPath(); fx.arc(x, y, r, 0, 7); fx.fill(); }
    if (evening) for (const { a, spr } of houses) { const x = sx(a.home.x - 1), y = sy(a.home.y) - spr.h * 0.3, r = cs * 2; const g = fx.createRadialGradient(x, y, 0, x, y, r); g.addColorStop(0, `rgba(255,190,90,${0.22 * (1 - L)})`); g.addColorStop(1, 'rgba(255,190,90,0)'); fx.fillStyle = g; fx.beginPath(); fx.arc(x, y, r, 0, 7); fx.fill(); }
    fx.globalCompositeOperation = 'source-over';
    for (const p of fires) drawFire(fx, sx(p.x), sy(p.y) - ch * 0.45, cs * 1.5, ch * 1.5, ts, seed + p.x);

    // vagalumes e chuva
    if (L < 0.6) for (let k = 0; k < 50; k++) {
      const px = ((((h32(k, 7, seed) % 1000) / 1000) * VW + Math.sin(ts * 0.7 + k) * 30) % VW + VW) % VW;
      const py = ((((h32(k, 9, seed) % 1000) / 1000) * VH + Math.cos(ts * 0.5 + k * 1.3) * 20) % VH + VH) % VH;
      fx.fillStyle = `rgba(220,255,140,${(0.5 + 0.5 * Math.sin(ts * 3 + k)) * 0.85})`;
      fx.beginPath(); fx.arc(px, py, 1.4, 0, 7); fx.fill();
    }
    if (rain) {
      fx.strokeStyle = 'rgba(150,180,220,.32)'; fx.lineWidth = 1; fx.beginPath();
      for (let k = 0; k < 200; k++) {
        const px = ((((h32(k, 3, seed) % 1000) / 1000) * VW - ts * 60) % VW + VW) % VW, py = ((((h32(k, 5, seed) % 1000) / 1000) * VH + ts * 520) % (VH + 20)) - 10;
        fx.moveTo(px, py); fx.lineTo(px - 3, py + 11);
      }
      fx.stroke();
    }

    // balões e nomes por cima da escuridão
    fx.textAlign = 'center'; fx.textBaseline = 'middle';
    fx.font = `700 ${Math.round(12 + 4 * z)}px Inter,sans-serif`;
    for (const a of list) {
      const p = this.screen.get(a)!;
      if (a.bubble && sim.tick <= a.bubbleUntil && !(a.bubble === 'z' && (ts | 0) % 3 === 0)) {
        fx.fillStyle = a.bubble === '♥' ? '#ff7aa8' : a.bubble === '¨' ? '#7cc4ff' : '#f2c14e';
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
    const sp = selected && this.screen.get(selected);
    if (sp) { fx.strokeStyle = '#f2c14e'; fx.lineWidth = 1.5; fx.beginPath(); fx.ellipse(sp.x, sp.y - 2 * z, 7 * sc, 2.4 * sc, 0, 0, 7); fx.stroke(); }
  }

  drawMini(selected: Agent | null): void {
    if (this.miniVersion !== this.sim.groundVersion) this.buildMini();
    const mx = this.mx;
    mx.imageSmoothingEnabled = false;
    mx.drawImage(this.mini, 0, 0);
    mx.fillStyle = '#ff9a3c';
    for (const p of this.sim.terrain.plazas) mx.fillRect(p.x - 1, p.y - 1, 3, 3);
    for (const a of this.sim.agents) { if (!a.present) continue; mx.fillStyle = a === selected ? '#f2c14e' : css(a.col); mx.fillRect(a.x - 1, a.y - 1, 3, 3); }
    const { ox, oy, vw, vh } = this.view();
    mx.strokeStyle = 'rgba(255,255,255,.85)'; mx.lineWidth = 1; mx.strokeRect(ox + 0.5, oy + 0.5, vw, vh);
  }
}
