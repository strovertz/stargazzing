# Stargazzing

Um mundo ASCII em pixel art que vive sozinho. Cada star neste repositório vira um morador: ele chega pela borda do mapa, constrói uma cabana, planta uma árvore e passa a viver ali.

**Site:** https://strovertz.github.io/stargazzing/

Dê uma ⭐ e vire morador.

## Como funciona

Não tem IA nem servidor rodando a simulação. O estado do mundo é uma função de três coisas:

```
estado = f(semente do mundo, lista de stargazers, hora atual)
```

Por isso o mundo continua vivo sem ninguém olhando, e todo mundo que abre o site no mesmo instante vê a mesma cena.

| Peça | Algoritmo | Efeito |
| --- | --- | --- |
| Identidade | FNV-1a(login) → mulberry32 | Aparência, chapéu, espécie da árvore, ritmo e temperamento. Mesmo login, mesmo personagem. |
| Terreno | Perlin 2D (3 oitavas) + lagos gaussianos | Água, areia, grama, mata, pedra e ruínas. |
| Comportamento | Máquina de estados com pesos | Chegar, plantar, passear, regar, descansar, visitar vizinhos, ir para a roda. |
| Rastro | Formiga de Langton | Passos gastam a grama em trilha; trilha esquecida vira flor. |
| Grupos | Boids | A roda nas ruínas, com separação, alinhamento e coesão. |
| Clima | Perlin 3D no tempo | Vento na grama, ondas, chuva, dia e noite (fuso fixo de São Paulo). |
| Caminhos | A* octil com heap binário | Ida até casa, vizinhos e praça. |

1 tick = 0,5 s. Ao abrir, o site parte da meia-noite do mundo (o checkpoint) e simula até agora.

## Desenvolvimento

```bash
npm ci
npm run dev        # servidor local
npm test           # testes de determinismo
npm run build      # typecheck + build em dist/
```

Estrutura:

```
src/core/     PRNG, hash, ruído Perlin, cores
src/sim/      simulação pura, sem DOM (roda igual no navegador e no Node)
src/render/   canvas: cenário com atlas de glifos e personagens interpolados
src/main.ts   UI, câmera e laço de animação
public/world.json   stargazers reais (gerado no deploy por scripts/fetch-stargazers.mjs)
scripts/      busca de stargazers na API do GitHub
tests/        determinismo, identidade e desempenho (com fixture de demonstração)
```

## Stars reais

O deploy do Pages roda `scripts/fetch-stargazers.mjs` antes do build, a cada star nova (evento `watch`), a cada 30 minutos e a cada push. O `GITHUB_TOKEN` das Actions não consegue ler stargazers, então o repositório precisa do secret `STARS`: um token fine-grained com acesso só a repositórios públicos e nenhuma permissão extra. Sem ele, o deploy segue com o `world.json` versionado e mostra um aviso.

## Roadmap

1. ~~Protótipo~~
2. ~~Repo, núcleo determinístico, CI e deploy no Pages~~
3. ~~Stargazers reais: o deploy lê a API a cada star nova (evento `watch`) e a cada 30 min~~ (esta versão)
4. Checkpoint diário pré-calculado, Web Worker e escala para 1.000 moradores
5. Polimento e trilha opcional na AWS (S3 + CloudFront, webhook em Lambda, Terraform, OIDC)

## Segurança

- Actions fixadas por SHA, com `permissions` mínimas e Dependabot para atualizá-las.
- Content Security Policy no build: só scripts do próprio site e fontes do Google Fonts.
- Logins são desenhados no canvas ou inseridos via `textContent`, nunca como HTML.
