import type { Simulation } from '../sim/simulation';
import { boardNews } from '../sim/talk';
import { OFFERINGS, type Visitor } from './visitor';

/** Quadro de anúncios da ágora: papéis pregados com as notícias do dia e o cantinho do visitante. */
export class BoardView {
  private readonly body: HTMLElement;
  private key = '';
  private sim: Simulation | null = null;
  /** ações do visitante: o main decide o que fazer (plantar pede um clique no mapa) */
  onPlant: () => void = () => {};
  constructor(private readonly root: HTMLElement, private readonly visitor: Visitor) {
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
    this.visitorPaper(sim);
    this.root.hidden = false;
    this.root.scrollTop = top;
  }

  /** Cantinho do visitante: oferenda no celeiro, semente que cresce no navegador, bilhete lido na roda. */
  private visitorPaper(sim: Simulation): void {
    const v = this.visitor, d = document.createElement('section');
    d.className = 'paper visit wide'; d.style.setProperty('--tilt', '0.4deg');
    const h = document.createElement('h4'); h.textContent = 'Você na vila';
    const p = document.createElement('p'); p.textContent = 'Fica só no seu navegador: a vila de todo mundo não muda.';
    d.append(h, p);
    // oferenda
    const off = v.offeredToday(sim.genesis), r1 = document.createElement('div'); r1.className = 'vrow';
    if (off) r1.textContent = `✓ Hoje você deixou ${off} no celeiro.`;
    else {
      const sel = document.createElement('select'); sel.setAttribute('aria-label', 'O que deixar no celeiro');
      for (const o of OFFERINGS) { const op = document.createElement('option'); op.value = o; op.textContent = o; sel.append(op); }
      const bt = document.createElement('button'); bt.textContent = 'deixar no celeiro';
      bt.addEventListener('click', () => { v.offer(sim, sel.value); this.show(sim); });
      const lb = document.createElement('span'); lb.textContent = 'Oferenda:';
      r1.append(lb, sel, bt);
    }
    // semente
    const pl = v.plant(), r2 = document.createElement('div'); r2.className = 'vrow';
    const st = ['broto', 'muda', 'em flor', 'moita florida'][v.plantStage()]!;
    const bt2 = document.createElement('button'); bt2.textContent = pl ? 'replantar em outro lugar' : 'plantar uma semente';
    bt2.addEventListener('click', () => { this.close(); this.onPlant(); });
    const s2 = document.createElement('span'); s2.textContent = pl ? `Sua planta: ${st}.` : 'Uma semente que cresce aqui, dia após dia.';
    r2.append(s2, bt2);
    // bilhete
    const note = v.note(), r3 = document.createElement('div'); r3.className = 'vrow col';
    const s3 = document.createElement('span');
    s3.textContent = note?.readMs ? `✓ ${note.by} leu seu bilhete na fogueira: "${note.text}"` : note ? `Bilhete esperando a roda da noite: "${note.text}"` : 'Escreva um bilhete: alguém da roda da fogueira lê à noite, só para você.';
    const ta = document.createElement('textarea'); ta.maxLength = 140; ta.rows = 2; ta.placeholder = 'até 140 letras'; ta.setAttribute('aria-label', 'Bilhete para ler na fogueira');
    const bt3 = document.createElement('button'); bt3.textContent = note && !note.readMs ? 'trocar o bilhete' : 'mandar para a roda';
    bt3.addEventListener('click', () => { if (ta.value.trim()) { v.writeNote(ta.value); this.show(sim); } });
    r3.append(s3, ta, bt3);
    d.append(r1, r2, r3);
    this.body.append(d);
  }
}
