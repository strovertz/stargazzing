// Gera o jogo dentro da extensão: roda o build do Vite do repositório com caminhos
// relativos e guarda só o que a webview usa (index.html, JS, CSS e world.json).
import { execFileSync } from 'node:child_process';
import { rmSync, existsSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

const ext = fileURLToPath(new URL('..', import.meta.url));
const root = join(ext, '..');
const out = join(ext, 'media', 'game');

if (!existsSync(join(root, 'node_modules'))) execFileSync('npm', ['ci'], { cwd: root, stdio: 'inherit' });
rmSync(out, { recursive: true, force: true });
execFileSync('npx', ['vite', 'build', '--base', './', '--outDir', out, '--emptyOutDir'], {
  cwd: root,
  stdio: 'inherit',
  env: { ...process.env, GITHUB_ACTIONS: '' },
});
// Os cartões SVG do README e os source maps não entram no .vsix.
for (const p of ['cards', 'card.svg']) rmSync(join(out, p), { recursive: true, force: true });
for (const f of readdirSync(join(out, 'assets'))) if (f.endsWith('.map')) rmSync(join(out, 'assets', f));
console.log(`jogo gerado em ${out}`);
