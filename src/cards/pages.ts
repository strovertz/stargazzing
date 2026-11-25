import { PROFS } from '../sim/constants';
import { genesisFor, Simulation } from '../sim/simulation';
import { firstPerson, todayOf } from '../sim/talk';
import type { WorldFile } from '../sim/types';
import { LOGIN } from './svg';

/**
 * Gerado no build: roda a simulação de hoje até a hora do build e escreve
 * o feed do diário (JSON Feed e RSS) e uma página pública por morador, com og:image.
 * Nada disso pede conta ou login: são páginas estáticas, só para ler e compartilhar.
 */
const esc = (s: string) => s.replace(/[&<>"']/g, c => `&#${c.charCodeAt(0)};`);

export function buildPages(world: WorldFile, now: number, site: string): { file: string; body: string }[] {
  const sim = new Simulation(world, genesisFor(now, world.timezoneOffsetHours ?? -3));
  sim.runUntil(sim.tickAt(now));
  const at = (tick: number) => new Date(sim.genesis + tick * 500).toISOString();
  const out: { file: string; body: string }[] = [];
  const items = sim.log.slice(-60).reverse();
  out.push({ file: 'feed.json', body: JSON.stringify({
    version: 'https://jsonfeed.org/version/1.1', title: 'Diário de Stargazzing', home_page_url: site, feed_url: `${site}feed.json`, language: 'pt-BR',
    items: items.map(e => ({ id: `${sim.genesis}-${e.tick}-${e.kind}`, content_text: e.text, date_published: at(e.tick), tags: [e.kind], url: site })),
  }, null, 1) });
  out.push({ file: 'feed.xml', body: `<?xml version="1.0" encoding="utf-8"?>
<rss version="2.0"><channel><title>Diário de Stargazzing</title><link>${site}</link><description>O que aconteceu hoje na vila dos stargazers.</description><language>pt-BR</language>
${items.map(e => `<item><title>${esc(e.text)}</title><link>${site}</link><guid isPermaLink="false">${sim.genesis}-${e.tick}-${esc(e.kind)}</guid><pubDate>${new Date(at(e.tick)).toUTCString()}</pubDate><category>${esc(e.kind)}</category></item>`).join('\n')}
</channel></rss>
` });
  for (const a of sim.agents) {
    if (!LOGIN.test(a.name)) continue;
    const key = a.name.toLowerCase(), days = a.meta.days ?? 0, diary = todayOf(sim, a, 6).map(t => firstPerson(a, t));
    const title = `${a.name} em Stargazzing`, desc = `${PROFS[a.prof]} na vila dos stargazers, ${days ? `há ${days} dia${days > 1 ? 's' : ''}` : 'chegou hoje'}. ${a.friends.length} amigo${a.friends.length === 1 ? '' : 's'}.`;
    out.push({ file: `m/${key}/index.html`, body: `<!DOCTYPE html>
<html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; img-src ${site}">
<title>${esc(title)}</title><meta name="description" content="${esc(desc)}">
<meta property="og:title" content="${esc(title)}"><meta property="og:description" content="${esc(desc)}"><meta property="og:type" content="profile">
<meta property="og:image" content="${site}cards/${key}.svg"><meta property="og:url" content="${site}m/${key}/"><meta name="twitter:card" content="summary_large_image">
<style>body{margin:0;min-height:100vh;display:grid;place-items:center;background:#050807;color:#e8e2d0;font:15px/1.5 system-ui,sans-serif}main{max-width:660px;padding:24px}img{width:100%;border-radius:14px}a{color:#f2c14e}h1{font:700 22px monospace;margin:16px 0 4px}ul{padding-left:18px}</style></head>
<body><main><img src="${site}cards/${key}.svg" alt="${esc(a.name)} em Stargazzing">
<h1>${esc(a.name)}</h1><p>${esc(desc)}</p>
${diary.length ? `<p><b>Hoje, contado por ${esc(a.name)}:</b></p><ul>${diary.map(t => `<li>${esc(t)}.</li>`).join('')}</ul>` : ''}
<p><a href="${site}?u=${encodeURIComponent(a.name)}">Ver ${esc(a.name)} ao vivo no mapa →</a></p></main></body></html>
` });
  }
  return out;
}
