import type { Simulation } from '../sim/simulation';
import { boardNews } from '../sim/talk';

/** Quadro de anúncios da ágora: papéis pregados com as notícias do dia. */
export class BoardView {
  private readonly body: HTMLElement;
  constructor(private readonly root: HTMLElement) {
    this.body = root.querySelector('.board-body')!;
    root.querySelector('button')!.addEventListener('click', () => this.close());
  }
  get open(): boolean { return !this.root.hidden; }
  close(): void { this.root.hidden = true; }

  show(sim: Simulation): void {
    const n = boardNews(sim), b = this.body;
    b.textContent = '';
    const paper = (title: string, lines: string[], empty: string, tilt: number) => {
      const d = document.createElement('section'), h = document.createElement('h4'), ul = document.createElement('ul');
      d.className = 'paper'; d.style.setProperty('--tilt', `${tilt}deg`);
      h.textContent = title;
      for (const l of lines.length ? lines : [empty]) { const li = document.createElement('li'); li.textContent = l; ul.append(li); }
      d.append(h, ul); b.append(d);
    };
    paper(`Chegaram hoje (${n.arrivals.length})`, [...n.arrivals.slice(-8).reverse().map(a => `★ ${a}`), ...(n.arrivals.length > 8 ? [`e mais ${n.arrivals.length - 8}`] : [])], 'Ninguém novo ainda. Dê uma star!', -1.5);
    paper('Obras', [...n.works.done.map(w => `✓ ${w}`), n.works.next ? `→ próxima: ${n.works.next}` : '→ todas prontas!'], '', 1);
    if (n.festivals.length) paper('Festa hoje!', n.festivals.map(f => `✦ ${f}`), '', 1.8);
    paper('Previsão de amanhã', [n.forecast], '', -0.5);
    paper('Preços na banca', n.prices.map(p => `${p.item.padEnd(8, ' ')} ${String(p.price).padStart(2, ' ')} ✦ ${p.trend > 0 ? '▲' : p.trend < 0 ? '▼' : '='}`), '', 0.6);
    paper('Campo de trigo', [n.wheat], '', -1.2);
    paper('Melhor pescador', n.fisher ? [n.fisher] : [], 'O lago ainda não rendeu nada hoje.', 1.5);
    paper('Amizades e pazes', n.friends, 'Nada de novo nos corações da vila.', -1);
    paper('Pedidos (issues)', n.requests.map(q => `#${q.n} ${q.title}`), 'Nenhum pedido aberto. Abra uma issue com o rótulo "pedido" e vote com 👍.', 0.8);
    this.root.hidden = false;
  }
}
