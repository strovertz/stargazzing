# Stargazzing para VS Code

Acompanhe o seu morador do [Stargazzing](https://strovertz.github.io/stargazzing/) sem sair do editor. Cada ⭐ no [repositório](https://github.com/strovertz/stargazzing) vira um morador; esta extensão abre o mundo numa view da barra lateral e segue o seu.

## O que faz

- **View na barra lateral** (ícone da estrelinha): o mundo inteiro, com a câmera seguindo o morador.
- **Modo compacto** (padrão): só o mundo e um cartão com nome, o que ele está fazendo e a hora da vila. Desligue para ver o HUD, o minimapa e as gavetas do site.
- **Janela flutuante**: `Stargazzing: Abrir em janela flutuante` abre o mundo numa janela própria do VS Code, que dá para deixar num canto ou em outro monitor.
- **Barra de status**: `★ login · pescando` atualizado a cada segundo. Clique para abrir a view.
- **Seguir outro morador**: escolha qualquer stargazer numa lista com busca.

## Quem ele segue

1. A configuração `stargazzing.login`, se preenchida.
2. Senão, a conta do GitHub já conectada ao VS Code (sem pedir login).
3. Senão, `git config github.user`.

Se o login ainda não for morador, a extensão avisa e oferece o link para dar a star.

## Configurações

| Configuração | Padrão | Para quê |
| --- | --- | --- |
| `stargazzing.login` | vazio | Login do GitHub a seguir |
| `stargazzing.compact` | `true` | Esconde os menus do jogo |
| `stargazzing.statusBar` | `true` | Mostra o estado do morador na barra de status |
| `stargazzing.liveData` | `true` | Busca a lista de moradores atual no site; desligado ou offline, usa a cópia embutida |

## Como funciona

O jogo vai **embutido** na extensão (o mesmo build do Vite do site), então roda offline e não depende de iframe de outro domínio. A única coisa que vem da rede é o `world.json` (e os opcionais `profiles.json` e `repo.json`) de `strovertz.github.io`, para a vila ter os stargazers de agora. Como a simulação é determinística, a cena é a mesma do site.

A webview usa uma CSP restrita: scripts só com nonce, nada de `unsafe-inline`/`unsafe-eval`, `connect-src` só para o próprio pacote e `strovertz.github.io`, fontes só do Google Fonts. Um script pequeno (`media/bridge.js`) roda antes do jogo para passar o `?u=login`, redirecionar os JSON para o site com a cópia local de reserva, e ler o cartão do morador para a barra de status. O código do jogo não muda.

## Instalar o .vsix

```bash
code --install-extension stargazzing.vsix
```

Ou no VS Code: painel de extensões → `…` → **Install from VSIX…**.

## Gerar o pacote

Requer Node 22.

```bash
cd vscode-extension
npm ci
npm run package   # gera o jogo, compila e cria stargazzing.vsix
```

Para testar durante o desenvolvimento, abra a pasta `vscode-extension/` no VS Code e aperte F5 depois de `npm run build`.

## Publicar no Marketplace

Precisa de uma conta de publisher (o `package.json` usa `strovertz`):

1. Crie o publisher em <https://marketplace.visualstudio.com/manage> com o mesmo id.
2. Gere um Personal Access Token no Azure DevOps com escopo **Marketplace → Manage**.
3. `npx vsce login strovertz` e depois `npx vsce publish` dentro de `vscode-extension/`.

Para o Open VSX (VSCodium, Cursor e afins): `npx ovsx publish stargazzing.vsix -p <token>`.
