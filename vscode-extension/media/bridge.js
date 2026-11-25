// Roda antes do jogo dentro da webview do VS Code.
// 1. Põe ?u=login na URL, que é como o jogo sabe quem seguir.
// 2. Faz world.json/profiles.json/repo.json virem do site (atualizados) com a cópia embutida de reserva.
// 3. Lê o cartão do morador e manda o estado para a barra de status.
(function () {
  'use strict';
  const vscode = acquireVsCodeApi();
  const root = document.documentElement;
  const login = root.dataset.login || '';
  const site = root.dataset.site || '';
  const local = root.dataset.local || '';
  const live = root.dataset.live === '1';

  try {
    const url = new URL(location.href);
    if (login) url.searchParams.set('u', login); else url.searchParams.delete('u');
    history.replaceState(history.state, '', url);
  } catch { /* sem history: o jogo só não segue ninguém */ }

  const DATA = /(?:^|\/)(world|profiles|repo)\.json(?:\?.*)?$/;
  const realFetch = window.fetch.bind(window);
  window.fetch = async function (input, init) {
    const href = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    const m = DATA.exec(href);
    if (!m) return realFetch(input, init);
    const name = `${m[1]}.json`;
    if (live) {
      try {
        const r = await realFetch(site + name, { cache: 'no-cache', signal: AbortSignal.timeout(6000) });
        if (r.ok) return r;
      } catch { /* offline: cai na cópia */ }
    }
    return realFetch(local + name, init);
  };

  addEventListener('message', e => {
    const m = e.data;
    if (m && m.type === 'compact') root.classList.toggle('sg-compact', !!m.on);
  });

  let chip, chipName, chipState, last = '', warned = false;
  function ensureChip() {
    if (chip) return;
    chip = document.createElement('div');
    chip.className = 'sg-chip';
    chipName = document.createElement('b');
    chipState = document.createElement('span');
    chip.append(chipName, chipState);
    document.body.append(chip);
  }
  const text = sel => (document.querySelector(sel)?.textContent || '').trim();
  function tick() {
    if (!document.body) return;
    ensureChip();
    const loading = document.getElementById('loading');
    if (loading && !loading.hidden) return;
    const name = text('#card h4');
    const sub = text('#card .sub');
    const state = sub.includes(' · ') ? sub.slice(sub.indexOf(' · ') + 3) : sub;
    const clock = text('#clock'), weather = text('#weather');
    chipName.textContent = name || (login ? login : 'Ninguém seguido');
    chipState.textContent = name ? `${state} · ${clock}` : login ? 'ainda não mora aqui' : 'use “Seguir outro morador…”';
    if (login && !name && !warned) { warned = true; vscode.postMessage({ type: 'missing', login }); }
    const key = `${name}|${state}|${clock}|${weather}`;
    if (key !== last) { last = key; vscode.postMessage({ type: 'status', name, state, clock, weather }); }
  }
  setInterval(tick, 1000);
})();
