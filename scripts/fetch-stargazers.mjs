// Busca quem deu star no repositório e grava public/world.json.
// Uso: node scripts/fetch-stargazers.mjs [owner/repo]
// Token opcional: STARS_TOKEN (PAT só de leitura pública) ou GITHUB_TOKEN. O GITHUB_TOKEN das
// Actions não tem acesso a stargazers (403); nesse caso tenta de novo sem token, o que funciona
// para repositório público dentro do limite de 60 chamadas por hora.
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
const token = process.env.STARS_TOKEN || process.env.GITHUB_TOKEN;

async function fetchAll(auth) {
  const h = auth && token ? { ...headers, Authorization: `Bearer ${token}` } : headers;
  const all = [];
  for (let page = 1; page <= 400; page++) {
    const res = await fetch(`https://api.github.com/repos/${repo}/stargazers?per_page=100&page=${page}`, { headers: h });
    if (!res.ok) throw Object.assign(new Error(`GitHub API ${res.status}: ${await res.text()}`), { status: res.status });
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
  try {
    stargazers = await fetchAll(true);
  } catch (err) {
    if (!token || (err.status !== 401 && err.status !== 403)) throw err;
    console.log(`token recusado (${err.status}); tentando sem token`);
    stargazers = await fetchAll(false);
  }
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
