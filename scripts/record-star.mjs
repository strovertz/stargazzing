// Registra no public/world.json quem acabou de dar star (evento `watch` das Actions).
// Não depende de token: o login vem do próprio evento. Uso: STAR_LOGIN=fulano node scripts/record-star.mjs
import { readFile, writeFile } from 'node:fs/promises';

const LOGIN = /^[a-z\d](?:[a-z\d]|-(?=[a-z\d])){0,38}(\[bot\])?$/i;
const login = (process.env.STAR_LOGIN ?? '').trim();
if (!LOGIN.test(login)) { console.log(`login inválido ou vazio: "${login}"`); process.exit(0); }

const out = new URL('../public/world.json', import.meta.url);
const world = JSON.parse(await readFile(out, 'utf8'));
if (world.stargazers.some(s => s.login.toLowerCase() === login.toLowerCase())) {
  console.log(`${login} já está no world.json`);
  process.exit(0);
}
world.stargazers.push({ login, starredAt: new Date().toISOString() });
world.stargazers.sort((a, b) => (a.starredAt ?? '').localeCompare(b.starredAt ?? '') || a.login.localeCompare(b.login));
world.generatedAt = new Date().toISOString();
await writeFile(out, JSON.stringify(world, null, 2) + '\n');
console.log(`${login} entrou no world.json (${world.stargazers.length} stargazers)`);
