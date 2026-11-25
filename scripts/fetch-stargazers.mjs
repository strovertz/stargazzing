// Busca quem deu star no repositório e grava public/world.json.
// Uso: node scripts/fetch-stargazers.mjs [owner/repo]
// Token opcional: STARS_TOKEN (PAT só de leitura pública) ou GITHUB_TOKEN. O GITHUB_TOKEN das
// Actions recebe 403 no REST de stargazers; nesse caso usa o GraphQL, que o aceita.
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

// GraphQL aceita o GITHUB_TOKEN das Actions para ler dados públicos.
async function fetchGraphql() {
  const [owner, name] = repo.split('/');
  const all = [];
  let after = null;
  for (let i = 0; i < 400; i++) {
    const res = await fetch('https://api.github.com/graphql', {
      method: 'POST',
      headers: { 'User-Agent': headers['User-Agent'], Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        query: `query($o:String!,$n:String!,$a:String){repository(owner:$o,name:$n){stargazers(first:100,after:$a,orderBy:{field:STARRED_AT,direction:ASC}){pageInfo{hasNextPage endCursor} edges{starredAt node{login}}}}}`,
        variables: { o: owner, n: name, a: after },
      }),
    });
    const body = await res.json();
    if (!res.ok || body.errors) throw new Error(`GraphQL ${res.status}: ${JSON.stringify(body.errors ?? body)}`);
    const sg = body.data.repository.stargazers;
    for (const e of sg.edges) {
      const login = e?.node?.login, at = e?.starredAt;
      if (typeof login === 'string' && LOGIN.test(login) && typeof at === 'string' && !Number.isNaN(Date.parse(at)))
        all.push({ login, starredAt: new Date(Date.parse(at)).toISOString() });
    }
    if (!sg.pageInfo.hasNextPage) break;
    after = sg.pageInfo.endCursor;
  }
  return all.sort((a, b) => a.starredAt.localeCompare(b.starredAt) || a.login.localeCompare(b.login));
}

let stargazers;
try {
  try {
    stargazers = await fetchAll(true);
  } catch (err) {
    if (!token || (err.status !== 401 && err.status !== 403)) throw err;
    console.log(`REST recusou o token (${err.status}); tentando GraphQL`);
    stargazers = await fetchGraphql();
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
