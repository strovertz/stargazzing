// Busca quem deu star no repositório e grava public/world.json.
// Uso: node scripts/fetch-stargazers.mjs [owner/repo]
// Token opcional: STARS_TOKEN (PAT só de leitura pública) ou GITHUB_TOKEN. O GITHUB_TOKEN das
// Actions não lê stargazers (403 no REST e no GraphQL), e sem token a API pede autenticação:
// no deploy é preciso o secret STARS_TOKEN (fine-grained, só repositórios públicos, sem permissões).
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
  stargazers = await fetchAll(true);
} catch (err) {
  // Sem API (limite, rede): mantém o arquivo atual para o deploy não quebrar.
  try {
    await readFile(out);
    const hint = process.env.STARS_TOKEN ? '' : ' Configure o secret STARS_TOKEN.';
    console.warn(`::warning::não consegui buscar stars (${err.message}); mantendo world.json atual.${hint}`);
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
