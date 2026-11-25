import { css, hex, mix, type RGB } from '../core/color';
import { h32 } from '../core/rng';
import { COLS, FLOWERS, N, ROWS, SPECIES, TICK_MS, Tile, WILD, type Species } from '../sim/constants';
import { hourAt, isNight, stageOf, type Simulation } from '../sim/simulation';
import type { Agent } from '../sim/types';
import { spritesFor } from './sprites';

export const CW = 10;
export const CH = 18;
export const ZOOMS = [0.5, 0.65, 0.8, 1, 1.25, 1.6, 2];

const GC: Record<number, RGB> = { 0: hex('#14395a'), 1: hex('#1f5c7c'), 2: hex('#9c8450'), 3: hex('#3c7a3a'), 4: hex('#245232'), 5: hex('#5d6068'), 6: hex('#6a6872'), 7: hex('#4a4850') };
const TRAIL = hex('#7d6240'), G2 = hex('#4d8c3f'), DEEP = hex('#0e2a46'), PEAK = hex('#7b7f88');
const GRASS = [',', "'", '"', '`', ',', "'"], GSH = ['#5fa04f', '#73b85c', '#8fd46c', '#a9e07e'], FSH = ['#2f6e3c', '#3b8248', '#4c9a55'], WSH = ['#3f88b8', '#5aa5d0', '#86c4e6'];
const FLIPCH: Record<string, string> = { '/': '\\', '\\': '/', '▲': '▼', '^': 'v', n: 'u', _: '‾' };
const lightAt = (h: number) => (h >= 7 && h < 17.5 ? 1 : h >= 19.5 || h < 5 ? 0.42 : h < 7 ? 0.42 + ((h - 5) / 2) * 0.58 : 1 - ((h - 17.5) / 2) * 0.58);

type ArtCell = [number, number, string, number];
function treeArt(sp: Species, stage: number): ArtCell[] {
  const g = sp.g;
  if (stage === 0) return [[0, 0, ',', 0]];
  if (stage === 1) return [[0, 0, g, 0]];
  if (stage === 2) return [[0, -2, g, 0], [-1, -1, g, 1], [0, -1, g, 0], [1, -1, g, 1], [0, 0, '|', 9]];
  return [[-1, -3, g, 0], [0, -3, g, 1], [1, -3, g, 0], [-2, -2, g, 1], [-1, -2, g, 0], [0, -2, g, 1], [1, -2, g, 0], [2, -2, g, 1], [-1, -1, g, 0], [0, -1, g, 1], [1, -1, g, 0], [0, 0, '|', 9]];
}

/**
 * Render em duas camadas:
 *  - cenário (chão + glifos + árvores), só a área visível, redesenhado ~10x/s ou quando a câmera mexe;
 *  - personagens, a cada quadro, com posição interpolada entre células.
 * Glifos vêm de um atlas: cada (caractere, cor) é rasterizado uma vez e depois só copiado.
 */
export class Renderer {
  cam = { x: COLS / 2, y: ROWS / 2 };
  zi = 4;
  zoom = ZOOMS[4]!;
  dirty = true;
  private dpr = 1;
  VW = 0;
  VH = 0;
  private readonly bx: CanvasRenderingContext2D;
  private readonly fx: CanvasRenderingContext2D;
  private readonly mx: CanvasRenderingContext2D;
  private readonly ground = document.createElement('canvas');
  private readonly gx: CanvasRenderingContext2D;
  private readonly gimg: ImageData;
  private groundVersion = -1;
  private atlas!: HTMLCanvasElement;
  private actx!: CanvasRenderingContext2D;
  private amap = new Map<string, { x: number; y: number }>();
  private ax = 0;
  private ay = 0;
  private gw = 0;
  private gh = 0;
  private OX = 0;
  private OY = 0;
  /** posição na tela de cada morador visível no último quadro */
  readonly screen = new Map<Agent, { x: number; y: number }>();

  constructor(private readonly bgc: HTMLCanvasElement, private readonly fgc: HTMLCanvasElement, mini: HTMLCanvasElement, public sim: Simulation) {
    this.bx = bgc.getContext('2d')!;
    this.fx = fgc.getContext('2d')!;
    this.mx = mini.getContext('2d')!;
    this.ground.width = COLS;
    this.ground.height = ROWS;
    this.gx = this.ground.getContext('2d')!;
    this.gimg = this.gx.createImageData(COLS, ROWS);
    this.resize();
  }

  resize(): void {
    this.dpr = Math.min(2, window.devicePixelRatio || 1);
    this.VW = innerWidth;
    this.VH = innerHeight;
    for (const c of [this.bgc, this.fgc]) { c.width = Math.round(this.VW * this.dpr); c.height = Math.round(this.VH * this.dpr); }
    this.resetAtlas();
    this.clampCam();
  }

  setSim(sim: Simulation): void { this.sim = sim; this.groundVersion = -1; this.dirty = true; }

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
    this.resetAtlas();
    this.clampCam();
  }

  pan(dxCells: number, dyCells: number): void { this.cam.x += dxCells; this.cam.y += dyCells; this.clampCam(); }

  agentAt(px: number, py: number): Agent | null {
    let best: Agent | null = null, bd = 22 * Math.max(1, this.zoom);
    for (const [a, p] of this.screen) { const d = Math.hypot(p.x - px, p.y - 10 * this.zoom - py); if (d < bd) { bd = d; best = a; } }
    return best;
  }

  private resetAtlas(): void {
    this.gw = Math.ceil(CW * this.zoom * this.dpr);
    this.gh = Math.ceil(CH * this.zoom * this.dpr);
    this.atlas = document.createElement('canvas');
    this.atlas.width = 2048;
    this.atlas.height = 1024;
    this.actx = this.atlas.getContext('2d')!;
    this.actx.font = `700 ${Math.round(16 * this.zoom * this.dpr)}px "JetBrains Mono",monospace`;
    this.actx.textAlign = 'center';
    this.actx.textBaseline = 'middle';
    this.amap.clear();
    this.ax = 0;
    this.ay = 0;
    this.dirty = true;
  }

  private glyph(ch: string, col: string): { x: number; y: number } {
    const k = ch + col;
    const g = this.amap.get(k);
    if (g) return g;
    if (this.ax + this.gw > 2048) { this.ax = 0; this.ay += this.gh; }
    if (this.ay + this.gh > 1024) { this.resetAtlas(); return this.glyph(ch, col); }
    this.actx.fillStyle = col;
    this.actx.fillText(ch, this.ax + this.gw / 2, this.ay + this.gh / 2 + this.zoom * this.dpr);
    const ng = { x: this.ax, y: this.ay };
    this.amap.set(k, ng);
    this.ax += this.gw;
    return ng;
  }

  private put(ch: string, col: string, x: number, y: number): void {
    const g = this.glyph(ch, col), s = CW * this.zoom * this.dpr, sy = CH * this.zoom * this.dpr;
    this.bx.drawImage(this.atlas, g.x, g.y, this.gw, this.gh, Math.round((x - this.OX) * s), Math.round((y - this.OY) * sy), this.gw, this.gh);
  }

  /** Chão: 1 pixel por célula, ampliado sem suavização (visual de pixel art). */
  private buildGround(): void {
    const { T, H, M, } = this.sim.terrain, seed = this.sim.terrain.seed, wear = this.sim.wear, d = this.gimg.data;
    for (let i = 0; i < N; i++) {
      const t = T[i]!;
      let c = GC[t]!;
      if (t === Tile.Grass) c = mix(c, G2, Math.max(0, Math.min(1, (M[i]! + 0.3) * 0.9)));
      if (t <= Tile.Shallow) c = mix(c, DEEP, Math.min(1, Math.max(0, -H[i]! - 0.44) * 3));
      if (t === Tile.Rock) c = mix(c, PEAK, Math.min(1, Math.max(0, H[i]! - 0.5) * 3));
      if (wear[i]! > 1 && t >= Tile.Sand && t <= Tile.Forest) c = mix(c, TRAIL, Math.min(0.85, wear[i]! / 12));
      const k = 0.94 + ((h32(i, 1, seed) % 100) / 100) * 0.1;
      d[i * 4] = c[0] * k; d[i * 4 + 1] = c[1] * k; d[i * 4 + 2] = c[2] * k; d[i * 4 + 3] = 255;
    }
    this.gx.putImageData(this.gimg, 0, 0);
    this.groundVersion = this.sim.groundVersion;
  }

  drawScene(ts: number): void {
    const sim = this.sim, { T, H, ruinCh, noise, wild } = sim.terrain, seed = sim.terrain.seed;
    const { ox, oy, vw, vh } = this.view(), h = hourAt(sim.tick), rain = sim.isRain(), L = lightAt(h) * (rain ? 0.85 : 1);
    this.OX = ox; this.OY = oy;
    if (this.groundVersion !== sim.groundVersion) this.buildGround();
    const bx = this.bx, s = CW * this.zoom * this.dpr, sy = CH * this.zoom * this.dpr;
    bx.setTransform(1, 0, 0, 1, 0, 0);
    bx.fillStyle = '#05080a';
    bx.fillRect(0, 0, this.bgc.width, this.bgc.height);
    bx.imageSmoothingEnabled = false;
    bx.drawImage(this.ground, 0, 0, COLS, ROWS, Math.round(-ox * s), Math.round(-oy * sy), COLS * s, ROWS * sy);
    const x0 = Math.max(0, Math.floor(ox)), x1 = Math.min(COLS, Math.ceil(ox + vw) + 1), y0 = Math.max(0, Math.floor(oy)), y1 = Math.min(ROWS, Math.ceil(oy + vh) + 1);
    const { wear, flower } = sim;
    for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) {
      const i = y * COLS + x, t = T[i]!, hs = h32(x, y, seed) % 100;
      if (t === Tile.Grass || t === Tile.Forest) {
        if (flower[i]) { this.put(hs % 2 ? '*' : '✿', FLOWERS[flower[i]! - 1]!, x, y); continue; }
        if (wear[i]! >= 6) { if (hs < 35) this.put(wear[i]! > 14 ? ':' : '.', '#b89468', x, y); continue; }
        if (hs >= (t === Tile.Forest ? 28 : 50)) continue;
        const w = noise(x * 0.06 - ts * 0.35, y * 0.12, ts * 0.05);
        if (t === Tile.Forest) { this.put(hs < 6 ? '♠' : hs % 2 ? ',' : '.', FSH[Math.min(2, Math.max(0, Math.floor((w + 0.4) * 3)))]!, x, y); continue; }
        this.put(w > 0.3 ? '"' : w > 0.18 ? "'" : GRASS[hs % 6]!, GSH[Math.min(3, Math.max(0, Math.floor((w + 0.35) * 5)))]!, x, y);
      } else if (t <= Tile.Shallow) {
        const v = noise(x * 0.16, y * 0.32, ts * 0.25);
        if (v > 0.12 || hs < 6) this.put(v > 0.3 ? '≈' : '~', WSH[v > 0.3 ? 2 : v > 0.2 ? 1 : 0]!, x, y);
      } else if (t === Tile.Sand) { if (hs < 25) this.put(hs % 2 ? '.' : '·', '#d6c08a', x, y); }
      else if (t === Tile.Rock) { if (hs < 55) this.put(H[i]! > 0.62 ? '▲' : '^', H[i]! > 0.62 ? '#c9ccd4' : '#9aa0aa', x, y); }
      else if (t === Tile.Wall) this.put(ruinCh[i]!, ruinCh[i] === '#' ? '#8fbf8a' : '#c9c6d4', x, y);
      else if (t === Tile.Floor && ruinCh[i] === '.') this.put('.', '#8c8996', x, y);
    }
    const inView = (x: number, y: number) => x >= x0 - 3 && x < x1 + 3 && y >= y0 - 1 && y < y1 + 4;
    const drawTree = (tx: number, ty: number, sp: Species, stage: number, thirsty: boolean) => {
      const art = treeArt(sp, stage), cols = thirsty ? ['#c9b35a', '#a8923f'] : sp.col;
      let sh = -1;
      for (let k = 1; k <= 3; k++) { const yy = ty + k; if (yy < ROWS && T[yy * COLS + tx]! <= Tile.Shallow) { sh = yy; break; } }
      if (sh > 0) {
        bx.globalAlpha = 0.3;
        for (const [dx, dy, ch, ci] of art) {
          const ry = sh + (sh - 1 - (ty + dy)), xx = tx + dx + Math.round(Math.sin(ts * 2 + ry) * 0.4);
          if (ry < ROWS && xx >= 0 && xx < COLS && T[ry * COLS + xx]! <= Tile.Shallow) this.put(FLIPCH[ch] ?? ch, ci === 9 ? '#6b5a48' : '#5d9fb8', xx, ry);
        }
        bx.globalAlpha = 1;
      }
      for (const [dx, dy, ch, ci] of art) {
        const xx = tx + dx, yy = ty + dy;
        if (xx < 0 || yy < 0 || xx >= COLS) continue;
        this.put(ch, ci === 9 ? '#8a6240' : cols[ci]!, xx, yy);
      }
    };
    for (const w of wild) if (inView(w.x, w.y)) drawTree(w.x, w.y, w.sp ? SPECIES[1]! : WILD, w.big ? 3 : 2, false);
    for (const t of sim.trees) if (inView(t.x, t.y)) drawTree(t.x, t.y, SPECIES[t.sp]!, stageOf(t), sim.tick - t.lastWater > 3000 && !rain);
    const evening = isNight(h) || h >= 19;
    for (const a of sim.agents) if (a.hut && inView(a.home.x - 1, a.home.y)) this.put('⌂', evening ? '#ffd36b' : '#e0a46a', a.home.x - 1, a.home.y);
    if (L < 1 || rain) {
      bx.fillStyle = `rgba(${rain ? '30,40,60' : '6,10,38'},${Math.min(0.62, (1 - L) * 1.05 + (rain ? 0.12 : 0))})`;
      bx.fillRect(0, 0, this.bgc.width, this.bgc.height);
    }
    if (evening && L < 0.9) {
      bx.globalCompositeOperation = 'lighter';
      bx.fillStyle = 'rgba(255,190,90,.22)';
      for (const a of sim.agents) if (a.hut && inView(a.home.x - 1, a.home.y)) { bx.beginPath(); bx.arc((a.home.x - 0.5 - ox) * s, (a.home.y + 0.5 - oy) * sy, s * 1.5, 0, 7); bx.fill(); }
      bx.globalCompositeOperation = 'source-over';
    }
    this.dirty = false;
  }

  /** tf = tick fracionário (tempo do mundo), para interpolar o movimento. */
  drawActors(tf: number, selected: Agent | null, hovered: Agent | null): void {
    const sim = this.sim, fx = this.fx, z = this.zoom, ts = (tf * TICK_MS) / 1000;
    const { ox, oy, vw, vh } = this.view(), h = hourAt(sim.tick), rain = sim.isRain(), L = lightAt(h) * (rain ? 0.85 : 1);
    const cs = CW * z, ch = CH * z, sc = z * 2, VW = this.VW, VH = this.VH, seed = sim.terrain.seed;
    fx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    fx.clearRect(0, 0, VW, VH);
    fx.imageSmoothingEnabled = false;
    this.screen.clear();
    const list = sim.agents.filter(a => a.present && a.x >= ox - 2 && a.x <= ox + vw + 2 && a.y >= oy - 2 && a.y <= oy + vh + 3).sort((a, b) => a.y - b.y);
    for (const a of list) {
      const f = Math.min(1, Math.max(0, (tf - a.mt) / a.pace)), wx = a.px + (a.x - a.px) * f, wy = a.py + (a.y - a.py) * f, moving = f < 1;
      const p = { x: (wx - ox + 0.5) * cs, y: (wy - oy + 1) * ch };
      this.screen.set(a, p);
      const spr = spritesFor(a.name, a.look), sleeping = a.phase === 'stay' && a.state === 'REST';
      const fr = sleeping ? spr.sleep : moving && Math.floor((tf * 4) / a.pace) % 2 ? spr.step : spr.stand, bob = moving && fr === spr.step ? -sc : 0;
      fx.fillStyle = 'rgba(0,0,0,.35)';
      fx.beginPath(); fx.ellipse(p.x, p.y - 2 * z, 5 * sc, 1.6 * sc, 0, 0, 7); fx.fill();
      fx.save();
      fx.translate(p.x, p.y - 14 * sc - z + bob);
      if (a.face < 0) fx.scale(-1, 1);
      fx.drawImage(fr, -4 * sc, 0, 8 * sc, 14 * sc);
      fx.restore();
    }
    if (L < 1) { fx.globalCompositeOperation = 'source-atop'; fx.fillStyle = `rgba(8,12,40,${(1 - L) * 0.5})`; fx.fillRect(0, 0, VW, VH); fx.globalCompositeOperation = 'source-over'; }
    if (isNight(h) || h >= 20) {
      for (let k = 0; k < 40; k++) {
        const px = ((((h32(k, 7, seed) % 1000) / 1000) * VW + Math.sin(ts * 0.7 + k) * 30) % VW + VW) % VW;
        const py = ((((h32(k, 9, seed) % 1000) / 1000) * VH + Math.cos(ts * 0.5 + k * 1.3) * 20) % VH + VH) % VH;
        fx.fillStyle = `rgba(255,236,140,${(0.5 + 0.5 * Math.sin(ts * 3 + k)) * 0.9})`;
        fx.beginPath(); fx.arc(px, py, 1.6, 0, 7); fx.fill();
      }
    }
    if (rain) {
      fx.strokeStyle = 'rgba(170,200,240,.4)'; fx.lineWidth = 1; fx.beginPath();
      for (let k = 0; k < 180; k++) {
        const px = ((((h32(k, 3, seed) % 1000) / 1000) * VW - ts * 60) % VW + VW) % VW, py = ((((h32(k, 5, seed) % 1000) / 1000) * VH + ts * 520) % (VH + 20)) - 10;
        fx.moveTo(px, py); fx.lineTo(px - 3, py + 11);
      }
      fx.stroke();
    }
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
    const mx = this.mx;
    mx.imageSmoothingEnabled = false;
    mx.drawImage(this.ground, 0, 0);
    for (const a of this.sim.agents) { if (!a.present) continue; mx.fillStyle = a === selected ? '#f2c14e' : css(a.col); mx.fillRect(a.x - 1, a.y - 1, 3, 3); }
    const { ox, oy, vw, vh } = this.view();
    mx.strokeStyle = 'rgba(255,255,255,.85)'; mx.lineWidth = 1; mx.strokeRect(ox + 0.5, oy + 0.5, vw, vh);
  }
}
