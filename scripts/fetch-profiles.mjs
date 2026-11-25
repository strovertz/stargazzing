// Busca dados públicos do GitHub de cada stargazer e grava public/profiles.json (só no build, não vai pro git).
// Guarda o mínimo: linguagem mais usada, nº de repositórios, seguidores e ano de entrada.
import { readFile, writeFile } from 'node:fs/promises';

const world = JSON.parse(await readFile(new URL('../public/world.json', import.meta.url), 'utf8'));
const out = new URL('../public/profiles.json', import.meta.url);
const token = (process.env.STARS_TOKEN || process.env.GITHUB_TOKEN || '').trim();
const headers = { Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28', 'User-Agent': 'stargazzing-world-builder' };
if (token) headers.Authorization = `Bearer ${token}`;
const LOGIN = /^[a-z\d](?:[a-z\d]|-(?=[a-z\d])){0,38}(\[bot\])?$/i;

async function get(path) {
  const res = await fetch(`https://api.github.com/${path}`, { headers });
  if (!res.ok) throw new Error(`${path}: ${res.status}`);
  return res.json();
}

async function profile(login) {
  const u = await get(`users/${login}`);
  const repos = await get(`users/${login}/repos?per_page=100&type=owner&sort=pushed`);
  const count = {};
  for (const r of repos) if (!r.fork && typeof r.language === 'string') count[r.language] = (count[r.language] ?? 0) + 1;
  const lang = Object.entries(count).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0]?.[0];
  const p = {};
  if (Number.isInteger(u.public_repos)) p.repos = u.public_repos;
  if (Number.isInteger(u.followers)) p.followers = u.followers;
  if (typeof u.created_at === 'string') p.since = new Date(u.created_at).getUTCFullYear();
  if (lang && lang.length < 40) p.lang = lang;
  return p;
}

const logins = world.stargazers.map(s => s.login).filter(l => LOGIN.test(l)).slice(0, 400);
const result = {};
let ok = 0, fail = 0;
for (let i = 0; i < logins.length; i += 4) {
  await Promise.all(logins.slice(i, i + 4).map(async l => {
    try { result[l.toLowerCase()] = await profile(l); ok++; } catch (e) { fail++; if (fail <= 3) console.log(`perfil ${l}: ${e.message}`); }
  }));
}
await writeFile(out, JSON.stringify(result) + '\n');
console.log(`profiles.json: ${ok} perfis, ${fail} falhas`);
