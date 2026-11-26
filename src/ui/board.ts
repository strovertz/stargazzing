import type { Simulation } from '../sim/simulation';
import { boardNews } from '../sim/talk';

/** Quadro de anúncios da ágora: papéis pregados com as notícias do dia. */
export class BoardView {
  private readonly body: HTMLElement;
  private key = '';
  private sim: Simulation | null = null;
  constructor(private readonly root: HTMLElement) {
    this.body = root.querySelector('.board-body')!;
    root.querySelector('button')!.addEventListener('click', () => this.close());
  }
  get open(): boolean { return !this.root.hidden; }
  close(): void { this.root.hidden = true; }

  /** Atualiza com o quadro aberto, só se algo mudou (não perde o que a pessoa está digitando). */
  refresh(): void {
    if (!this.open || !this.sim) return;
    const ae = document.activeElement;
    if (ae && this.root.contains(ae) && (ae.tagName === 'TEXTAREA' || ae.tagName === 'SELECT')) return;
    this.show(this.sim, true);
  }

  show(sim: Simulation, soft = false): void {
    this.sim = sim;
    const n = boardNews(sim), key = JSON.stringify(n);
    if (soft && key === this.key) return;
    this.key = key;
    const b = this.body, top = this.root.scrollTop;
    b.textContent = '';
    const paper = (title: string, lines: string[], empty: string, tilt: number, cls = '') => {
      const d = document.createElement('section'), h = document.createElement('h4'), ul = document.createElement('ul');
      d.className = `paper ${cls}`; d.style.setProperty('--tilt', `${tilt}deg`);
      h.textContent = title;
      for (const l of lines.length ? lines : [empty]) { const li = document.createElement('li'); li.textContent = l; if (l.includes('▼')) li.className = 'low'; ul.append(li); }
      d.append(h, ul); b.append(d);
      return d;
    };
    paper('Agenda de hoje', n.agenda, 'Dia tranquilo, sem nada marcado.', -1.2, 'wide');
    paper('Celeiro comum', [...n.granary, n.tools], '', 0.8);
    paper('Mutirão', n.mutirao, '', -0.6);
    paper(`Chegaram hoje (${n.arrivals.length})`, [...n.arrivals.slice(-8).reverse().map(a => `★ ${a}`), ...(n.arrivals.length > 8 ? [`e mais ${n.arrivals.length - 8}`] : []), ...(n.later ? [`+ ${n.later} a caminho`] : [])], 'Ninguém novo ainda. Dê uma star!', 1.4);
    paper('Sopa e ceia', n.supper, '', -1);
    paper('Feira de trocas', [...n.rates, ...(n.trades.length ? ['— trocas de hoje —', ...n.trades] : [])], '', 0.5);
    paper('Favores e gratidão', [...n.sick, ...n.favors], 'Ninguém precisou de ajuda ainda. Que bom!', -0.8);
    if (n.mail.length) paper('Correio', n.mail, '', 1.1);
    paper('Previsão de amanhã', [n.forecast, n.wheat], '', -0.4);
    paper('Pedidos (issues)', n.requests.map(q => `#${q.n} ${q.title}`), 'Nenhum pedido aberto. Abra uma issue com o rótulo "pedido" e vote com 👍.', 0.8);
    paper('Obras das stars', [...n.works.done.map(w => `✓ ${w}`), n.works.next ? `→ próxima: ${n.works.next}` : '→ todas prontas!'], '', -1.3);
    if (n.fisher || n.friends.length) paper('Por aí', [...(n.fisher ? [`Melhor pescador: ${n.fisher}`] : []), ...n.friends], '', 1);
    this.root.hidden = false;
    this.root.scrollTop = top;
  }
}
