import * as vscode from 'vscode';
import { execFile } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { readFile } from 'node:fs/promises';

const SITE = 'https://strovertz.github.io/stargazzing/';
const REPO = 'https://github.com/strovertz/stargazzing';
const LOGIN = /^[a-z\d](?:[a-z\d-]{0,38})$/i;

interface Status { type: 'status'; name: string; state: string; clock: string; weather: string }
type FromWebview = Status | { type: 'missing'; login: string } | { type: 'ready' };

const cfg = () => vscode.workspace.getConfiguration('stargazzing');

/** Login a seguir: configuração, conta do GitHub já conectada no VS Code, ou `git config github.user`. */
async function resolveLogin(): Promise<string> {
  const set = cfg().get<string>('login', '').trim();
  if (set) return set;
  try {
    const s = await vscode.authentication.getSession('github', ['read:user'], { silent: true });
    if (s && LOGIN.test(s.account.label)) return s.account.label;
  } catch { /* sem provedor do GitHub */ }
  return new Promise(res => {
    execFile('git', ['config', '--get', 'github.user'], { timeout: 3000 }, (err, out) => {
      const v = String(out ?? '').trim();
      res(!err && LOGIN.test(v) ? v : '');
    });
  });
}

/** Lista de moradores: do site (atual) ou da cópia embutida. */
async function stargazers(ext: vscode.Uri): Promise<string[]> {
  const pick = (w: unknown) => ((w as { stargazers?: { login?: unknown }[] }).stargazers ?? [])
    .map(s => s.login).filter((l): l is string => typeof l === 'string' && LOGIN.test(l));
  if (cfg().get<boolean>('liveData', true)) {
    try {
      const r = await fetch(`${SITE}world.json`, { signal: AbortSignal.timeout(5000) });
      if (r.ok) return pick(await r.json());
    } catch { /* offline: usa a cópia */ }
  }
  try {
    return pick(JSON.parse(await readFile(vscode.Uri.joinPath(ext, 'media', 'game', 'world.json').fsPath, 'utf8')));
  } catch { return []; }
}

class World {
  private views = new Set<vscode.Webview>();
  private game?: { head: string; body: string };
  private bar: vscode.StatusBarItem;
  private login = '';
  private warned = new Set<string>();

  constructor(private ctx: vscode.ExtensionContext) {
    this.bar = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 50);
    this.bar.command = 'stargazzing.view.focus';
    ctx.subscriptions.push(this.bar);
  }

  async init(): Promise<void> { this.login = await resolveLogin(); }
  get current(): string { return this.login; }

  async follow(login: string): Promise<void> {
    this.login = login;
    this.bar.hide();
    for (const w of this.views) w.html = await this.html(w);
  }

  setCompact(on: boolean): void { for (const w of this.views) void w.postMessage({ type: 'compact', on }); }
  async reload(): Promise<void> { this.game = undefined; await this.follow(this.login); }

  /** Liga uma webview (barra lateral ou aba) ao mundo. */
  async attach(w: vscode.Webview, gone: vscode.Event<void>): Promise<void> {
    const media = vscode.Uri.joinPath(this.ctx.extensionUri, 'media');
    w.options = { enableScripts: true, localResourceRoots: [media] };
    this.views.add(w);
    const subs = [
      w.onDidReceiveMessage((m: FromWebview) => this.onMessage(m)),
      gone(() => { this.views.delete(w); subs.forEach(s => s.dispose()); if (!this.views.size) this.bar.hide(); }),
    ];
    w.html = await this.html(w);
  }

  private onMessage(m: FromWebview): void {
    if (m.type === 'status') {
      if (!cfg().get<boolean>('statusBar', true) || !m.name) { this.bar.hide(); return; }
      this.bar.text = `$(star-full) ${m.name} · ${m.state}`;
      this.bar.tooltip = `Stargazzing ${m.clock} · ${m.weather}\n${m.name}: ${m.state}`;
      this.bar.show();
    } else if (m.type === 'missing' && m.login && !this.warned.has(m.login.toLowerCase())) {
      this.warned.add(m.login.toLowerCase());
      void vscode.window.showInformationMessage(
        `${m.login} ainda não mora no Stargazzing. Dê uma star no repositório e o morador chega em poucos minutos.`,
        'Dar star', 'Seguir outro',
      ).then(a => {
        if (a === 'Dar star') void vscode.env.openExternal(vscode.Uri.parse(REPO));
        if (a === 'Seguir outro') void vscode.commands.executeCommand('stargazzing.follow');
      });
    }
  }

  /** Lê o index.html gerado pelo Vite e separa o que precisamos dele. */
  private async loadGame(): Promise<{ head: string; body: string }> {
    if (this.game) return this.game;
    const file = vscode.Uri.joinPath(this.ctx.extensionUri, 'media', 'game', 'index.html').fsPath;
    const src = await readFile(file, 'utf8');
    const body = /<body>([\s\S]*)<\/body>/.exec(src)?.[1] ?? '';
    const assets = [...src.matchAll(/<(?:script[^>]*src|link[^>]*rel="stylesheet"[^>]*href)="\.\/(assets\/[^"]+)"/g)].map(m => m[1]!);
    this.game = { head: assets.join('\n'), body: body.replace(/<script[\s\S]*?<\/script>/g, '') };
    return this.game;
  }

  private async html(w: vscode.Webview): Promise<string> {
    const nonce = randomBytes(16).toString('base64');
    const media = vscode.Uri.joinPath(this.ctx.extensionUri, 'media');
    const uri = (...p: string[]) => w.asWebviewUri(vscode.Uri.joinPath(media, ...p)).toString();
    let game: { head: string; body: string };
    try { game = await this.loadGame(); } catch {
      return `<!DOCTYPE html><body style="font-family:sans-serif;padding:12px">O jogo não foi empacotado. Rode <code>npm run build</code> em <code>vscode-extension/</code>.</body>`;
    }
    const tags = game.head.split('\n').map(a => a.endsWith('.css')
      ? `<link rel="stylesheet" href="${uri('game', ...a.split('/'))}">`
      : `<script type="module" nonce="${nonce}" src="${uri('game', ...a.split('/'))}"></script>`).join('\n');
    const live = cfg().get<boolean>('liveData', true);
    const csp = [
      `default-src 'none'`,
      `script-src 'nonce-${nonce}'`,
      `style-src ${w.cspSource} https://fonts.googleapis.com`,
      `font-src ${w.cspSource} https://fonts.gstatic.com`,
      `img-src ${w.cspSource} data: blob:`,
      `connect-src ${w.cspSource}${live ? ' https://strovertz.github.io' : ''}`,
      `media-src blob: data:`,
      `base-uri 'none'`,
      `form-action 'none'`,
    ].join('; ');
    const esc = (s: string) => s.replace(/[&"<>]/g, c => `&#${c.charCodeAt(0)};`);
    return `<!DOCTYPE html>
<html lang="pt-BR" class="${cfg().get<boolean>('compact', true) ? 'sg-compact' : ''}"
  data-login="${esc(this.login)}" data-site="${SITE}" data-local="${uri('game')}/" data-live="${live ? '1' : ''}">
<head>
<meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="${csp}">
<meta name="viewport" content="width=device-width, initial-scale=1">
<link href="https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;700&family=Pixelify+Sans:wght@500;700&family=Inter:wght@400;600&display=swap" rel="stylesheet">
<script nonce="${nonce}" src="${uri('bridge.js')}"></script>
${tags}
<link rel="stylesheet" href="${uri('webview.css')}">
</head>
<body>${game.body}</body>
</html>`;
  }
}

export async function activate(ctx: vscode.ExtensionContext): Promise<void> {
  const world = new World(ctx);
  await world.init();
  let panel: vscode.WebviewPanel | undefined;

  const openPanel = async (): Promise<vscode.WebviewPanel> => {
    if (panel) { panel.reveal(vscode.ViewColumn.Beside); return panel; }
    const p = vscode.window.createWebviewPanel('stargazzing.panel', 'Stargazzing', vscode.ViewColumn.Beside, { enableScripts: true, retainContextWhenHidden: true });
    p.iconPath = vscode.Uri.joinPath(ctx.extensionUri, 'media', 'icon.png');
    panel = p;
    p.onDidDispose(() => { panel = undefined; });
    await world.attach(p.webview, p.onDidDispose);
    return p;
  };

  ctx.subscriptions.push(
    vscode.window.registerWebviewViewProvider('stargazzing.view', {
      resolveWebviewView: v => world.attach(v.webview, v.onDidDispose),
    }, { webviewOptions: { retainContextWhenHidden: true } }),

    vscode.commands.registerCommand('stargazzing.follow', async () => {
      const qp = vscode.window.createQuickPick();
      qp.placeholder = 'Login do GitHub do morador';
      qp.busy = true;
      qp.show();
      const list = await stargazers(ctx.extensionUri);
      qp.items = list.map(l => ({ label: l, description: l.toLowerCase() === world.current.toLowerCase() ? 'seguindo' : undefined }));
      qp.busy = false;
      const chosen = await new Promise<string | undefined>(res => {
        qp.onDidAccept(() => res(qp.selectedItems[0]?.label ?? qp.value.trim()));
        qp.onDidHide(() => res(undefined));
      });
      qp.dispose();
      if (!chosen || !LOGIN.test(chosen)) return;
      await cfg().update('login', chosen, vscode.ConfigurationTarget.Global);
    }),

    vscode.commands.registerCommand('stargazzing.openPanel', openPanel),
    vscode.commands.registerCommand('stargazzing.openPopup', async () => {
      const p = await openPanel();
      p.reveal(p.viewColumn, false);
      // Janela auxiliar do VS Code (1.85+): a aba vira um "popup" que pode ficar por cima.
      try { await vscode.commands.executeCommand('workbench.action.moveEditorToNewWindow'); } catch { /* versão sem janelas auxiliares */ }
    }),
    vscode.commands.registerCommand('stargazzing.toggleCompact', () =>
      cfg().update('compact', !cfg().get<boolean>('compact', true), vscode.ConfigurationTarget.Global)),
    vscode.commands.registerCommand('stargazzing.reload', () => world.reload()),
    vscode.commands.registerCommand('stargazzing.openSite', () =>
      vscode.env.openExternal(vscode.Uri.parse(world.current ? `${SITE}?u=${encodeURIComponent(world.current)}` : SITE))),

    vscode.workspace.onDidChangeConfiguration(async e => {
      if (e.affectsConfiguration('stargazzing.compact')) world.setCompact(cfg().get<boolean>('compact', true));
      if (e.affectsConfiguration('stargazzing.login') || e.affectsConfiguration('stargazzing.liveData')) {
        await world.init();
        await world.follow(world.current);
      }
    }),
  );
}

export function deactivate(): void { /* nada a liberar além das subscriptions */ }
