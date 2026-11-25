/**
 * Brilhos prontos: em vez de criar um gradiente radial novo por luz a cada quadro,
 * desenha um sprite de 64 px já pintado, escalado e com alfa.
 */
const cache = new Map<string, HTMLCanvasElement>();
function sprite(rgb: string, hole: boolean): HTMLCanvasElement {
  const k = `${rgb}|${hole}`;
  let c = cache.get(k);
  if (c) return c;
  c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d')!, gr = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  gr.addColorStop(0, `rgba(${rgb},1)`);
  if (hole) gr.addColorStop(0.55, `rgba(${rgb},0.55)`);
  gr.addColorStop(1, `rgba(${rgb},0)`);
  g.fillStyle = gr; g.fillRect(0, 0, 64, 64);
  cache.set(k, c);
  return c;
}
/** Luz redonda (ou elíptica, com ry) de raio r em (x, y), cor "r,g,b" e intensidade a. */
export function glow(g: CanvasRenderingContext2D, x: number, y: number, r: number, rgb: string, a: number, ry = r, hole = false): void {
  if (a <= 0.003 || r <= 0) return;
  const prev = g.globalAlpha;
  g.globalAlpha = Math.min(1, a);
  g.drawImage(sprite(rgb, hole), x - r, y - ry, r * 2, ry * 2);
  g.globalAlpha = prev;
}
