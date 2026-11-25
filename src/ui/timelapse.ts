import { css } from '../core/color';
import { COLS, HOUSE_DX, ROWS } from '../sim/constants';
import { NEEDS } from '../sim/village';
import type { Simulation } from '../sim/simulation';
import type { Renderer } from '../render/renderer';

/**
 * Timelapse: a vila nascendo star por star, em cima do minimapa.
 * Mostra as casas na ordem de chegada e as obras quando a contagem bate a meta.
 */
export class Timelapse {
  private raf = 0;
  private readonly canvas: HTMLCanvasElement;
  private readonly label: HTMLElement;
  constructor(private readonly root: HTMLElement) {
    this.canvas = root.querySelector('canvas')!;
    this.label = root.querySelector('p')!;
    root.querySelector('button')!.addEventListener('click', () => this.stop());
  }

  get on(): boolean { return !this.root.hidden; }
  stop(): void { cancelAnimationFrame(this.raf); this.root.hidden = true; }

  play(sim: Simulation, renderer: Renderer): void {
    cancelAnimationFrame(this.raf);
    this.root.hidden = false;
    const order = sim.agents.filter(a => a.present || a.hut).sort((p, q) => (q.meta.days ?? 0) - (p.meta.days ?? 0) || p.arriveTick - q.arriveTick);
    const N = order.length, S = 4, c = this.canvas, g = c.getContext('2d')!, ground = renderer.miniGround();
    c.width = COLS * S; c.height = ROWS * S;
    const t0 = performance.now(), dur = Math.max(6000, Math.min(16000, N * 700));
    const frame = (now: number) => {
      const u = Math.min(1, (now - t0) / dur), k = Math.ceil(u * N);
      g.imageSmoothingEnabled = false;
      g.drawImage(ground, 0, 0, c.width, c.height);
      g.fillStyle = 'rgba(4,7,9,.35)'; g.fillRect(0, 0, c.width, c.height);
      for (const st of sim.structures) if (k >= st.need) { g.fillStyle = '#f2c14e'; g.fillRect(st.x * S - 3, st.y * S - 3, 8, 8); }
      for (let i = 0; i < k; i++) {
        const a = order[i]!, x = (a.home.x - HOUSE_DX) * S, y = a.home.y * S, fresh = i === k - 1 ? 1 + (1 - ((u * N) % 1)) * 3 : 1;
        g.fillStyle = css(a.col); g.fillRect(x - 3 * fresh, y - 3 * fresh, 6 * fresh, 6 * fresh);
        g.fillStyle = '#3f7a38'; g.fillRect(x + (HOUSE_DX + 1) * S - 2, y - 6, 4, 6);
      }
      const built = NEEDS.filter(([, need]) => k >= need).map(([kind]) => kind);
      const who = k ? order[k - 1]!.name : '';
      this.label.textContent = `${k} de ${N} stars${who ? ` · chegou ${who}` : ''}${built.length ? ` · obras: ${built.join(', ')}` : ''}`;
      if (u < 1) this.raf = requestAnimationFrame(frame);
    };
    this.raf = requestAnimationFrame(frame);
  }
}
