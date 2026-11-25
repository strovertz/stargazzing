import { fnv, mulberry32 } from '../core/rng';
import { DAY_MS, PROFS, SPECIES } from '../sim/constants';
import { lookFor, lookFrom, profOf } from '../sim/look';
import { palette, spriteRows } from '../render/pixels';
import type { StargazerEntry } from '../sim/types';

/**
 * Cartões SVG animados para README, gerados no build (sem JavaScript: só CSS dentro do SVG,
 * que o GitHub mostra em <img>). O desenho do morador sai da mesma pixel art do site.
 */
export const LOGIN = /^[a-z\d](?:[a-z\d]|-(?=[a-z\d])){0,38}(\[bot\])?$/i;
const esc = (s: string) => s.replace(/[&<>"']/g, c => `&#${c.charCodeAt(0)};`);

/** Os pixels do sprite como <rect>s, juntando pixels vizinhos da mesma cor numa linha. */
function pixels(name: string, days: number, frame: 'stand' | 'step', px: number): string {
  const { look } = lookFor(name, days), pal = palette(look), out: string[] = [];
  spriteRows(look, frame).forEach((row, y) => {
    for (let x = 0; x < row.length;) {
      const col = pal[row[x]!];
      let w = 1;
      while (col && x + w < row.length && pal[row[x + w]!] === col) w++;
      if (col) out.push(`<rect x="${x * px}" y="${y * px}" width="${w * px}" height="${px}" fill="${col}"/>`);
      x += w;
    }
  });
  return out.join('');
}

export function daysOf(e: StargazerEntry, now: number): number {
  if (e.starredAt) return Math.max(0, Math.floor((now - Date.parse(e.starredAt)) / DAY_MS));
  return e.daysAgo ?? 0;
}

export function residentCard(e: StargazerEntry, now: number, site: string): string {
  const name = e.login, days = daysOf(e, now), key = name.toLowerCase();
  const prof = PROFS[profOf(key)]!, owl = fnv(key + '#owl') % 4 === 0;
  // a espécie é o 8º sorteio do PRNG do morador, logo depois da aparência (igual à simulação)
  const r = mulberry32(fnv(key)), { hue } = lookFrom(r), sp = SPECIES[Math.floor(r() * SPECIES.length)]!;
  const since = days === 0 ? 'chegou hoje' : `morador há ${days} dia${days > 1 ? 's' : ''}`;
  const grow = Math.min(1, 0.35 + days / 10);
  return `<svg xmlns="http://www.w3.org/2000/svg" width="420" height="130" viewBox="0 0 420 130" role="img" aria-label="${esc(name)} em Stargazzing">
<title>${esc(name)} em Stargazzing</title>
<style>
.b{animation:bob 1s steps(2) infinite}.s{animation:sw 1s steps(1) infinite}.s2{animation:sw 1s steps(1) infinite reverse}
@keyframes bob{50%{transform:translateY(-3px)}}@keyframes sw{0%{opacity:1}50%{opacity:0}}
.f{animation:tw 3s ease-in-out infinite}.f:nth-child(2){animation-delay:-1s}.f:nth-child(3){animation-delay:-2s}
@keyframes tw{0%,100%{opacity:.15}50%{opacity:1}}
.t{animation:gr 1.2s ease-out both;transform-origin:350px 112px}@keyframes gr{from{transform:scale(.2)}}
.fire{animation:fl .4s steps(2) infinite}@keyframes fl{50%{opacity:.6;transform:translateY(-1px)}}
text{font-family:'JetBrains Mono',ui-monospace,monospace}
</style>
<rect width="420" height="130" rx="14" fill="#0b120e"/>
<rect y="108" width="420" height="22" rx="0" fill="#122a1a"/><rect y="124" width="420" height="6" rx="3" fill="#0d1f14"/>
<g fill="#478b50" opacity=".7">${Array.from({ length: 26 }, (_, i) => `<text x="${i * 16 + (i % 3) * 3}" y="${118 + (i % 2) * 6}" font-size="10">${i % 2 ? "'" : ','}</text>`).join('')}</g>
<g fill="#dcff8c"><circle class="f" cx="300" cy="40" r="1.6"/><circle class="f" cx="250" cy="60" r="1.4"/><circle class="f" cx="390" cy="30" r="1.5"/></g>
<g class="t"><rect x="346" y="${112 - 40 * grow}" width="8" height="${40 * grow}" fill="#6a4426"/><circle cx="350" cy="${112 - 44 * grow}" r="${22 * grow}" fill="${sp.col[0]}"/><circle cx="338" cy="${112 - 34 * grow}" r="${14 * grow}" fill="${sp.col[0]}" opacity=".85"/></g>
<g class="fire" transform="translate(290 96)"><rect x="0" y="12" width="18" height="3" fill="#5a3a20"/><rect x="5" y="2" width="8" height="10" fill="#ff9a3c"/><rect x="7" y="5" width="4" height="7" fill="#ffd36b"/></g>
<g transform="translate(26 40)"><g class="b"><g class="s">${pixels(name, days, 'stand', 5)}</g><g class="s2">${pixels(name, days, 'step', 5)}</g></g></g>
<text x="86" y="44" font-size="20" font-weight="700" fill="hsl(${hue} 70% 72%)">${esc(name)}</text>
<text x="86" y="66" font-size="13" fill="#c9d1c4">${esc(prof)}${owl ? ' · coruja' : ''} · ${esc(since)}</text>
<text x="86" y="86" font-size="12" fill="#8a948a">${esc(sp.n)} plantada na floresta</text>
<text x="404" y="20" font-size="11" fill="#f2c14e" text-anchor="end">★ stargazzing</text>
<text x="86" y="102" font-size="10" fill="#5f6b60">${esc(site.replace(/^https?:\/\//, ''))}</text>
</svg>
`;
}

export function villageCard(list: StargazerEntry[], now: number): string {
  const shown = list.slice(-14), n = list.length;
  const people = shown.map((e, i) => {
    const dur = 14 + (fnv(e.login) % 9), delay = -((fnv(e.login + '#d') % 100) / 100) * dur, y = 64 + (i % 3) * 8;
    return `<g style="animation:walk ${dur}s linear ${delay.toFixed(2)}s infinite"><g transform="translate(0 ${y})"><g class="s">${pixels(e.login, daysOf(e, now), 'stand', 3)}</g><g class="s2">${pixels(e.login, daysOf(e, now), 'step', 3)}</g></g></g>`;
  }).join('\n');
  return `<svg xmlns="http://www.w3.org/2000/svg" width="640" height="150" viewBox="0 0 640 150" role="img" aria-label="Stargazzing: ${n} moradores">
<title>Stargazzing: ${n} moradores</title>
<style>
@keyframes walk{from{transform:translateX(-40px)}to{transform:translateX(660px)}}
.s{animation:sw .6s steps(1) infinite}.s2{animation:sw .6s steps(1) infinite reverse}@keyframes sw{0%{opacity:1}50%{opacity:0}}
.f{animation:tw 3s ease-in-out infinite}@keyframes tw{0%,100%{opacity:.15}50%{opacity:1}}
.fire{animation:fl .4s steps(2) infinite}@keyframes fl{50%{opacity:.6}}
text{font-family:'JetBrains Mono',ui-monospace,monospace}
</style>
<rect width="640" height="150" rx="16" fill="#0b120e"/>
<rect y="112" width="640" height="38" fill="#122a1a"/>
${Array.from({ length: 12 }, (_, i) => `<circle class="f" style="animation-delay:-${(i * 0.37).toFixed(2)}s" cx="${30 + i * 52}" cy="${20 + ((i * 37) % 40)}" r="1.5" fill="#dcff8c"/>`).join('')}
${[60, 180, 470, 590].map((x, i) => `<g><rect x="${x - 3}" y="${82 - i % 2 * 8}" width="6" height="${30 + i % 2 * 8}" fill="#6a4426"/><circle cx="${x}" cy="${78 - i % 2 * 8}" r="${16 + i % 2 * 4}" fill="${['#2f683a', '#3a7a44', '#21482c', '#478b50'][i]}"/></g>`).join('')}
<g class="fire" transform="translate(312 96)"><rect x="0" y="14" width="20" height="3" fill="#5a3a20"/><rect x="5" y="2" width="10" height="12" fill="#ff9a3c"/><rect x="8" y="6" width="4" height="8" fill="#ffd36b"/></g>
${people}
<text x="20" y="34" font-size="20" font-weight="700" fill="#f2c14e">★ Stargazzing</text>
<text x="20" y="54" font-size="13" fill="#c9d1c4">${n} morador${n === 1 ? '' : 'es'} na floresta · dê uma star e vire um</text>
</svg>
`;
}
