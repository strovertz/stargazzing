import { readdirSync, readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { defineConfig, type Plugin } from 'vitest/config';
import { LOGIN, residentCard, villageCard } from './src/cards/svg';
import { buildPages } from './src/cards/pages';
import type { WorldFile } from './src/sim/types';

// CSP só no build: o servidor de dev do Vite injeta estilos inline.
const csp: Plugin = {
  name: 'csp',
  apply: 'build',
  transformIndexHtml: html =>
    html.replace(
      '<meta charset="utf-8">',
      `<meta charset="utf-8">\n<meta http-equiv="Content-Security-Policy" content="default-src 'self'; script-src 'self'; style-src 'self' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; img-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'self'; form-action 'none'">`,
    ),
};

// Cartões SVG animados para README: /cards/{login}.svg para cada morador e /card.svg da vila.
const SITE = 'https://strovertz.github.io/stargazzing/';
const cards: Plugin = {
  name: 'cards',
  apply: 'build',
  generateBundle() {
    const world = JSON.parse(readFileSync(new URL('./public/world.json', import.meta.url), 'utf8')) as WorldFile;
    const now = Date.now(), list = world.stargazers.filter(e => LOGIN.test(e.login));
    for (const e of list) this.emitFile({ type: 'asset', fileName: `cards/${e.login.toLowerCase()}.svg`, source: residentCard(e, now, SITE) });
    this.emitFile({ type: 'asset', fileName: 'card.svg', source: villageCard(list, now) });
    // feed do diário e páginas públicas por morador (/m/login/), com o dia simulado até agora
    try { world.extra = JSON.parse(readFileSync(new URL('./public/repo.json', import.meta.url), 'utf8')); } catch { /* sem dados do repo */ }
    for (const p of buildPages(world, now, SITE)) this.emitFile({ type: 'asset', fileName: p.file, source: p.body });
  },
};

// Versão do código da simulação: checkpoints salvos por outra versão são descartados.
const simHash = createHash('sha1');
for (const dir of ['src/sim', 'src/core']) for (const f of readdirSync(dir).sort()) simHash.update(readFileSync(`${dir}/${f}`));
const SIM_VERSION = simHash.digest('hex').slice(0, 12);

// No GitHub Pages o site fica em https://strovertz.github.io/stargazzing/
export default defineConfig({
  base: process.env.GITHUB_ACTIONS ? '/stargazzing/' : '/',
  plugins: [csp, cards],
  define: { __SIM_VERSION__: JSON.stringify(SIM_VERSION) },
  build: { target: 'es2022', sourcemap: true },
  test: { environment: 'node' },
});
