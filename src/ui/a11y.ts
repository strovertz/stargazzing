import { hourAt, type Simulation } from '../sim/simulation';
import { moonPhase } from '../sim/extras';
import type { Agent } from '../sim/types';

/** Preferências de visualização guardadas no navegador: alto contraste, texto grande e paleta. */
export interface A11y { contrast: boolean; big: boolean; palette: '' | 'sepia' | 'bolso' | 'azul' }
export const PALETTES: [A11y['palette'], string][] = [['', 'cores normais'], ['sepia', 'sépia'], ['bolso', 'verde de bolso (4 tons)'], ['azul', 'noite azul']];

export function loadA11y(): A11y {
  let o: Partial<A11y> = {};
  try { o = JSON.parse(localStorage.getItem('a11y') ?? '{}') as Partial<A11y>; } catch { /* modo privado */ }
  const pal = PALETTES.some(p => p[0] === o.palette) ? o.palette! : '';
  return { contrast: o.contrast === true || (o.contrast === undefined && matchMedia('(prefers-contrast: more)').matches), big: o.big === true, palette: pal };
}
export function applyA11y(s: A11y): void {
  const b = document.body.classList;
  b.toggle('contrast', s.contrast);
  b.toggle('bigtext', s.big);
  for (const [p] of PALETTES) if (p) b.toggle(`pal-${p}`, s.palette === p);
  try { localStorage.setItem('a11y', JSON.stringify(s)); } catch { /* modo privado */ }
}

const MOON = ['lua nova', 'lua crescente', 'quarto crescente', 'lua gibosa crescente', 'lua cheia', 'lua gibosa minguante', 'quarto minguante', 'lua minguante'];
const SEASON = ['verão', 'outono', 'inverno', 'primavera'];

/**
 * Descrição em texto do que está na tela, para leitor de tela: hora, clima, céu,
 * quem aparece e fazendo o quê, e se o X do tesouro está à vista.
 */
export function describeScene(sim: Simulation, clock: string, visible: Agent[], stateText: (a: Agent) => string, selected: Agent | null, treasureInView: boolean): string {
  const h = hourAt(sim.tick), w = sim.weather(), night = h >= 20 || h < 5;
  const part = night ? 'noite' : h < 7 ? 'amanhecer' : h >= 17.5 ? 'entardecer' : 'dia';
  const sky = w.kind === 'limpo' ? 'céu limpo' : w.kind;
  const out: string[] = [`${clock}, ${part}, ${sky}${w.wind > 0.7 ? ' e vento' : ''}. ${SEASON[sim.season]![0]!.toUpperCase()}${SEASON[sim.season]!.slice(1)}, ${MOON[Math.round(moonPhase(sim.genesis + sim.tick * 500) * 8) % 8]}.`];
  if (sim.sky && night) out.push(sim.sky.name + '.');
  const f = sim.festivalAt();
  if (f) out.push(`Agora: ${f.name}.`);
  const present = sim.agents.filter(a => a.present).length;
  out.push(`${present} de ${sim.agents.length} moradores na vila.`);
  if (!visible.length) out.push('Ninguém à vista nesta parte do mapa.');
  else {
    const groups = new Map<string, string[]>();
    for (const a of visible) { const s = stateText(a); groups.set(s, [...(groups.get(s) ?? []), a.name]); }
    const parts = [...groups].sort((a, b) => b[1].length - a[1].length).slice(0, 5).map(([s, n]) => n.length > 3 ? `${n.length} moradores ${s}` : `${n.join(' e ')} ${s}`);
    out.push(`Na tela, ${visible.length} morador${visible.length > 1 ? 'es' : ''}: ${parts.join('; ')}.`);
  }
  if (selected) out.push(`Seguindo ${selected.name}, ${stateText(selected)}.`);
  if (treasureInView) out.push('Há um X de tesouro marcado no chão nesta tela: aperte X para cavar.');
  return out.join(' ');
}
