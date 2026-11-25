import { DAY_MS, TICKS_PER_HOUR } from '../sim/constants';
import { BRIDGE_AT, type Scheduled, type Simulation } from '../sim/simulation';
import type { LogEntry, WorldFile } from '../sim/types';
import type { WeatherKind } from '../sim/weather';

/**
 * Formas de acompanhar o que aconteceu (e o que vai acontecer), tudo tirado dos mesmos dados
 * determinísticos: agenda do dia, clima hora a hora, história da vila e o resumo da ausência.
 */
const el = <K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, text?: string): HTMLElementTagNameMap[K] => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
};
const dur = (ticks: number): string => {
  const m = Math.max(1, Math.round((ticks * 500) / 60_000)), h = Math.floor(m / 60);
  return h ? `${h}h${String(m % 60).padStart(2, '0')}` : `${m} min`;
};

/** Próximo compromisso (ou o que está acontecendo agora), para o chip do topo. */
export function nextUp(sim: Simulation, fmtTick: (t: number) => string): string {
  const now = sim.tick;
  const on = sim.agenda.find(e => now >= e.from && now < e.to && e.kind !== 'mercador');
  if (on) return `Agora: ${on.name}`;
  const nx = sim.agenda.find(e => e.from > now);
  return nx ? `${nx.name} às ${fmtTick(nx.from)} (em ${dur(nx.from - now)})` : '';
}

export function renderAgenda(sim: Simulation, box: HTMLElement, fmtTick: (t: number) => string): void {
  box.textContent = '';
  const now = sim.tick;
  const rows: Scheduled[] = [...sim.agenda];
  if (!rows.length) { box.append(el('p', 'bio', 'Nada marcado para hoje. A roda da fogueira começa no fim da tarde, como sempre.')); return; }
  const ul = el('ul', 'agenda');
  for (const e of rows) {
    const li = el('li'), t = el('time', '', `${fmtTick(e.from)}–${fmtTick(e.to)}`), n = el('span', '', e.name);
    const live = now >= e.from && now < e.to, past = now >= e.to;
    const st = el('em', live ? 'live' : '', live ? 'agora' : past ? 'já foi' : `em ${dur(e.from - now)}`);
    if (past) li.className = 'past';
    li.append(t, n, st);
    ul.append(li);
  }
  box.append(ul);
}

const WX: Record<WeatherKind, [string, string]> = {
  limpo: ['#e8c25a', 'sol'], nublado: ['#8d9aa3', 'nublado'], neblina: ['#b9c4c9', 'neblina'],
  garoa: ['#6fa6c9', 'garoa'], chuva: ['#3f78b5', 'chuva'], tempestade: ['#6a4fb3', 'tempestade'],
};
/** Faixa com o clima de cada hora do dia: o clima é função do tempo, então o resto do dia já se sabe. */
export function renderWeatherStrip(sim: Simulation, box: HTMLElement): void {
  box.textContent = '';
  const strip = el('div', 'wxstrip'), nowH = sim.tick / TICKS_PER_HOUR;
  strip.setAttribute('role', 'img');
  const parts: string[] = [];
  let last = '';
  for (let h = 0; h < 24; h++) {
    const w = sim.weather(Math.round((h + 0.5) * TICKS_PER_HOUR)), [col, label] = WX[w.kind];
    const c = el('i');
    c.style.background = col;
    if (h + 1 <= nowH) c.className = 'gone';
    if (h <= nowH && nowH < h + 1) c.classList.add('now');
    c.title = `${String(h).padStart(2, '0')}h: ${label}`;
    strip.append(c);
    if (label !== last) { parts.push(`${h}h ${label}`); last = label; }
  }
  strip.setAttribute('aria-label', `Clima de hoje hora a hora: ${parts.join(', ')}`);
  const axis = el('div', 'wxaxis');
  for (const h of [0, 6, 12, 18, 24]) axis.append(el('span', '', `${h}h`));
  const legend = el('div', 'wxlegend');
  const used = new Set<WeatherKind>();
  for (let h = 0; h < 24; h++) used.add(sim.weather(Math.round((h + 0.5) * TICKS_PER_HOUR)).kind);
  for (const k of used) { const s = el('span'); const dot = el('b'); dot.style.background = WX[k][0]; s.append(dot, WX[k][1]); legend.append(s); }
  box.append(strip, axis, legend);
}

/** História da vila: marcos tirados das datas das stars, releases, forks e pedidos atendidos. */
export function renderHistory(world: WorldFile, box: HTMLElement, tz: number): void {
  box.textContent = '';
  const date = (iso: string) => new Date(Date.parse(iso) + tz * 3_600_000).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: '2-digit', timeZone: 'UTC' });
  const ev: { at: number; text: string }[] = [];
  const stars = [...world.stargazers].filter(s => s.starredAt).sort((a, b) => Date.parse(a.starredAt!) - Date.parse(b.starredAt!));
  stars.forEach((s, i) => {
    const n = i + 1, at = Date.parse(s.starredAt!);
    if (n === 1) ev.push({ at, text: `${s.login} foi o primeiro morador` });
    else if (n === 25) ev.push({ at, text: `${s.login} trouxe a 25ª star: o templo escondido apareceu` });
    else if (n === 50) ev.push({ at, text: `${s.login} trouxe a 50ª star: o cristal do templo acendeu` });
    else if (n === BRIDGE_AT) ev.push({ at, text: `${s.login} trouxe a ${BRIDGE_AT}ª star: a ponte foi consertada` });
    else if (n % 10 === 0) ev.push({ at, text: `${n} moradores com a chegada de ${s.login}` });
  });
  const x = world.extra ?? {};
  for (const r of x.releases ?? []) ev.push({ at: Date.parse(r.at), text: `Release ${r.tag}: festa com fogos` });
  for (const f of x.forks ?? []) ev.push({ at: Date.parse(f.at), text: `${f.login} montou acampamento (fork)` });
  for (const q of x.requests ?? []) if (q.state === 'closed' && q.closedAt) ev.push({ at: Date.parse(q.closedAt), text: `Pedido atendido: ${q.title}` });
  ev.sort((a, b) => b.at - a.at);

  // stars por dia nos últimos 14 dias: barras de uma cor só, com o valor no título
  const today = Math.floor((Date.now() + tz * 3_600_000) / DAY_MS), per = new Array<number>(14).fill(0);
  for (const s of stars) { const d = today - Math.floor((Date.parse(s.starredAt!) + tz * 3_600_000) / DAY_MS); if (d >= 0 && d < 14) per[13 - d]!++; }
  const max = Math.max(1, ...per), chart = el('div', 'bars');
  chart.setAttribute('role', 'img');
  chart.setAttribute('aria-label', `Stars por dia nas últimas duas semanas: ${per.map((v, i) => `${13 - i === 0 ? 'hoje' : `há ${13 - i} dia${13 - i > 1 ? 's' : ''}`} ${v}`).join(', ')}`);
  per.forEach((v, i) => {
    const col = el('div', 'sbar'), b = el('i'), d = 13 - i;
    b.style.height = `${v ? Math.max(6, (v / max) * 100) : 0}%`;
    col.title = `${d === 0 ? 'hoje' : d === 1 ? 'ontem' : `há ${d} dias`}: ${v} star${v === 1 ? '' : 's'}`;
    col.append(b);
    if (v === max && v > 0) { const lb = el('span', '', String(v)); lb.style.bottom = `calc(${b.style.height} + 2px)`; col.append(lb); }
    chart.append(col);
  });
  const ax = el('div', 'baraxis'); ax.append(el('span', '', 'há 13 dias'), el('span', '', 'hoje'));
  box.append(el('p', 'bio', `${stars.length} stars no total`), chart, ax);
  if (!ev.length) return;
  const ol = el('ol', 'diary hist');
  for (const e of ev.slice(0, 40)) { const li = el('li'); li.append(el('time', '', date(new Date(e.at).toISOString())), el('span', '', e.text)); ol.append(li); }
  box.append(ol);
}

/** O que mais importou entre a última visita e agora (hoje), para o aviso de boas-vindas. */
export function highlightsSince(log: LogEntry[], fromTick: number, toTick: number): string[] {
  const rank: Partial<Record<LogEntry['kind'], number>> = { evento: 5, github: 5, lenda: 4, obra: 4, 'céu': 3, chegada: 2, pesca: 1, clima: 1 };
  return log.filter(e => e.tick >= fromTick && e.tick <= toTick && (rank[e.kind] ?? 0) >= 2 && !e.text.startsWith('Ecossistema') && !e.text.includes(' leu o pedido') && !/^\d+ pedidos? no quadro/.test(e.text))
    .sort((a, b) => (rank[b.kind] ?? 0) - (rank[a.kind] ?? 0) || a.tick - b.tick).slice(0, 3).map(e => e.text);
}
