// Busca quem deu star no repositório e grava public/world.json.
// Uso: node scripts/fetch-stargazers.mjs [owner/repo]
// GITHUB_TOKEN é opcional (sobe o limite da API); sem ele funciona para repositório público.
import { readFile, writeFile } from 'node:fs/promises';

const SEED = 'strovertz/stargazzing'; // fixa: muda o mapa inteiro se mudar
const repo = process.argv[2] ?? process.env.GITHUB_REPOSITORY ?? SEED;
const out = new URL('../public/world.json', import.meta.url);
const LOGIN = /^[a-z\d](?:[a-z\d]|-(?=[a-z\d])){0,38}(\[bot\])?$/i;

if (!/^[\w.-]+\/[\w.-]+$/.test(repo)) throw new Error(`repo inválido: ${repo}`);

const headers = {
  Accept: 'application/vnd.github.star+json',
  'X-GitHub-Api-Version': '2022-11-28',
  'User-Agent': 'stargazzing-world-builder',
};
if (process.env.GITHUB_TOKEN) headers.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`;

async function fetchAll() {
  const all = [];
  for (let page = 1; page <= 400; page++) {
    const res = await fetch(`https://api.github.com/repos/${repo}/stargazers?per_page=100&page=${page}`, { headers });
    if (!res.ok) throw new Error(`GitHub API ${res.status}: ${await res.text()}`);
    const batch = await res.json();
    for (const s of batch) {
      const login = s?.user?.login, at = s?.starred_at;
      if (typeof login === 'string' && LOGIN.test(login) && typeof at === 'string' && !Number.isNaN(Date.parse(at)))
        all.push({ login, starredAt: new Date(Date.parse(at)).toISOString() });
    }
    if (batch.length < 100) break;
  }
  return all.sort((a, b) => a.starredAt.localeCompare(b.starredAt) || a.login.localeCompare(b.login));
}

let stargazers;
try {
  stargazers = await fetchAll();
} catch (err) {
  // Sem API (limite, rede): mantém o arquivo atual para o deploy não quebrar.
  try {
    await readFile(out);
    console.warn(`::warning::não consegui buscar stars (${err.message}); mantendo world.json atual`);
    process.exit(0);
  } catch { throw err; }
}

const world = {
  repo,
  seed: SEED,
  timezoneOffsetHours: -3,
  generatedAt: new Date().toISOString(),
  stargazers,
};
await writeFile(out, JSON.stringify(world, null, 2) + '\n');
console.log(`world.json: ${stargazers.length} stargazers de ${repo}`);
