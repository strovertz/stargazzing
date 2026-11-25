import { defineConfig, type Plugin } from 'vitest/config';

// CSP só no build: o servidor de dev do Vite injeta estilos inline.
const csp: Plugin = {
  name: 'csp',
  apply: 'build',
  transformIndexHtml: html =>
    html.replace(
      '<meta charset="utf-8">',
      `<meta charset="utf-8">\n<meta http-equiv="Content-Security-Policy" content="default-src 'self'; script-src 'self'; style-src 'self' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; img-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'self'; form-action 'none'">`,
    ),
};

// No GitHub Pages o site fica em https://strovertz.github.io/stargazzing/
export default defineConfig({
  base: process.env.GITHUB_ACTIONS ? '/stargazzing/' : '/',
  plugins: [csp],
  build: { target: 'es2022', sourcemap: true },
  test: { environment: 'node' },
});
