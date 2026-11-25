// Busca dados públicos do repositório e grava public/repo.json (só no build, não vai pro git):
// forks, issues com a label "pedido", commits por dia (14 dias) e seguidores do dono.
// Cada parte é opcional: se uma chamada falhar, o resto segue e o mundo só não mostra aquela parte.
import { writeFile } from 'node:fs/promises';

const repo = process.argv[2] || process.env.GITHUB_REPOSITORY || 'strovertz/stargazzing';
if (!/^[\w.-]+\/[\w.-]+$/.test(repo)) throw new Error(`repo inválido: ${repo}`);
const owner = repo.split('/')[0];
const token = (process.env.STARS_TOKEN || process.env.GITHUB_TOKEN || '').trim();
const headers = { Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28', 'User-Agent': 'stargazzing-world-builder' };
if (token) headers.Authorization = `Bearer ${token}`;
const LOGIN = /^[a-z\d](?:[a-z\d]|-(?=[a-z\d])){0,38}(\[bot\])?$/i;

async function get(path) {
  const res = await fetch(`https://api.github.com/${path}`, { headers });
  if (!res.ok) throw new Error(`${path}: ${res.status}`);
  return res.json();
}
async function part(name, fn) {
  try { const v = await fn(); console.log(`${name}: ok`); return v; } catch (e) { console.log(`${name}: ${e.message}`); return undefined; }
}

const out = {};
out.forks = await part('forks', async () => {
  const list = await get(`repos/${repo}/forks?per_page=100&sort=oldest`);
  return list.filter(f => LOGIN.test(f.owner?.login ?? '')).slice(0, 30).map(f => ({ login: f.owner.login, at: f.created_at }));
});
out.requests = await part('pedidos', async () => {
  const list = await get(`repos/${repo}/issues?labels=pedido&state=all&per_page=50&sort=created&direction=desc`);
  return list.filter(i => !i.pull_request).map(i => ({ n: i.number, title: String(i.title).replace(/[\u0000-\u001f]/g, ' ').slice(0, 80), state: i.state === 'closed' ? 'closed' : 'open', ...(i.closed_at ? { closedAt: i.closed_at } : {}) }));
});
out.commits = await part('commits', async () => {
  const since = new Date(Date.now() - 14 * 86_400_000).toISOString();
  const list = await get(`repos/${repo}/commits?since=${since}&per_page=100`);
  const days = {};
  for (const c of list) {
    // commits do bot que registra stars não contam como trabalho no código
    if (/^Nova star: /.test(c.commit?.message ?? '')) continue;
    const d = (c.commit?.committer?.date ?? '').slice(0, 10);
    if (/^\d{4}-\d\d-\d\d$/.test(d)) days[d] = (days[d] ?? 0) + 1;
  }
  return days;
});
out.followers = await part('seguidores', async () => {
  const list = await get(`users/${owner}/followers?per_page=100`);
  return list.map(u => u.login).filter(l => LOGIN.test(l));
});
for (const k of Object.keys(out)) if (out[k] === undefined) delete out[k];
await writeFile(new URL('../public/repo.json', import.meta.url), JSON.stringify(out) + '\n');
console.log(`repo.json: ${Object.keys(out).join(', ') || 'vazio'}`);
