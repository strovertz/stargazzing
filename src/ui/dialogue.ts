import { css } from '../core/color';
import { spritesFor } from '../render/sprites';
import type { Simulation } from '../sim/simulation';
import { linesFor, moodOf, questionFor } from '../sim/talk';
import type { Agent } from '../sim/types';

/**
 * Caixa de conversa no estilo dos RPGs de bolso: retrato em pixel, nome e texto que vai
 * aparecendo letra a letra. A última página é a pergunta do dia, com duas respostas.
 * A resposta fica só no navegador de quem respondeu: o mundo não muda.
 */
export class Dialogue {
  private readonly portrait: HTMLCanvasElement;
  private readonly name: HTMLElement;
  private readonly text: HTMLElement;
  private readonly opts: HTMLElement;
  private readonly more: HTMLElement;
  private pages: string[] = [];
  private page = 0;
  private shown = 0;
  private timer = 0;
  private who: Agent | null = null;
  private sim: Simulation | null = null;
  constructor(private readonly root: HTMLElement) {
    this.portrait = root.querySelector('canvas')!;
    this.name = root.querySelector('b')!;
    this.text = root.querySelector('p')!;
    this.opts = root.querySelector('.dlg-opts')!;
    this.more = root.querySelector('.dlg-more')!;
    root.querySelector('.dlg-x')!.addEventListener('click', e => { e.stopPropagation(); this.close(); });
    root.addEventListener('click', () => this.advance());
  }
  get open(): boolean { return !this.root.hidden; }
  get agent(): Agent | null { return this.open ? this.who : null; }
  close(): void { this.root.hidden = true; clearInterval(this.timer); this.who = null; }

  show(sim: Simulation, a: Agent): void {
    this.sim = sim; this.who = a;
    const m = moodOf(sim, a);
    this.pages = linesFor(sim, a);
    if (m.tired > 0.85 && a.state === 'REST') this.pages = ['Zzz... *resmunga* ...só mais cinco minutinhos...'];
    this.pages.push('?');
    const g = this.portrait.getContext('2d')!;
    g.clearRect(0, 0, 8, 14); g.drawImage(spritesFor(a.name, a.look).stand, 0, 0);
    this.name.textContent = a.name;
    this.name.style.color = css(a.col);
    this.root.hidden = false;
    this.page = 0;
    this.type();
  }

  /** Clique, espaço ou enter: completa a página ou passa para a próxima. */
  advance(): void {
    if (!this.open) return;
    const cur = this.pages[this.page]!;
    if (cur !== '?' && this.shown < cur.length) { this.shown = cur.length; this.text.textContent = cur; this.more.hidden = false; return; }
    if (cur === '?') return;
    this.page++;
    if (this.page >= this.pages.length) { this.close(); return; }
    this.type();
  }

  private type(): void {
    clearInterval(this.timer);
    this.opts.textContent = '';
    this.more.hidden = true;
    const cur = this.pages[this.page]!;
    if (cur === '?') { this.question(); return; }
    this.shown = 0;
    const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (reduce) { this.shown = cur.length; this.text.textContent = cur; this.more.hidden = false; return; }
    this.timer = window.setInterval(() => {
      this.shown = Math.min(cur.length, this.shown + 1);
      this.text.textContent = cur.slice(0, this.shown);
      if (this.shown >= cur.length) { clearInterval(this.timer); this.more.hidden = false; }
    }, 26);
  }

  private question(): void {
    const sim = this.sim!, a = this.who!, q = questionFor(sim, a), key = `pergunta:${sim.genesis}:${a.name.toLowerCase()}`;
    let got: number | null = null;
    try { const v = localStorage.getItem(key); got = v === null ? null : Number(v); } catch { /* modo privado */ }
    if (got === 0 || got === 1) { this.text.textContent = `Você me disse "${q.a[got]}" hoje. ${q.r[got]}`; this.more.hidden = false; this.pages[this.page] = this.text.textContent; this.shown = 1e9; return; }
    this.text.textContent = q.q;
    q.a.forEach((label, k) => {
      const b = document.createElement('button');
      b.textContent = label;
      b.addEventListener('click', e => {
        e.stopPropagation();
        try { localStorage.setItem(key, String(k)); } catch { /* modo privado */ }
        this.pages[this.page] = q.r[k]!;
        this.type();
      });
      this.opts.append(b);
    });
  }
}
