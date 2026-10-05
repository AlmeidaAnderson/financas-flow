#!/usr/bin/env node
// Build do Finanças Flow como Artifact do claude.ai (alvo extra; a versão Netlify em site/ não muda).
//   npm run build:artifact  →  dist-artifact/financas-flow.html
// Contrato da página de Artifact: SEM <!doctype>/<html>/<head>/<body> (a plataforma envolve a página num
// esqueleto com charset + viewport); começa com <title>, depois <style>; scripts inline; bibliotecas só de
// CDNs permitidos (SheetJS do jsDelivr, pdf.js do cdnjs — carregado só ao escolher um PDF —, fontes do Google Fonts). Nada de manifest, service worker,
// Identity da Netlify ou /api.  Sem dependências (só node).
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SITE = join(ROOT, 'site');
const OUT_DIR = join(ROOT, 'dist-artifact');
const OUT = join(OUT_DIR, 'financas-flow.html');
// xlsx 0.18.5 (o mesmo arquivo de site/vendor/xlsx.full.min.js; conferido contra o tarball do npm)
const XLSX_URL = 'https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js';
const FONTS_RE = /<link rel="stylesheet" href="(https:\/\/fonts\.googleapis\.com\/[^"]+)">/;

const read = (f) => readFileSync(join(SITE, f), 'utf8');
const html = read('index.html');

const fonts = FONTS_RE.exec(html);
if (!fonts) throw new Error('Google Fonts <link> não encontrado em site/index.html');
const title = /<title>([^<]*)<\/title>/.exec(html)[1];

const bodyMatch = /<body[^>]*>([\s\S]*)<\/body>/i.exec(html);
if (!bodyMatch) throw new Error('<body> não encontrado em site/index.html');
let body = bodyMatch[1].trim();
// a marcação do corpo não pode carregar scripts/links da versão Netlify
if (/<script|<link|manifest|\/api\/|\.netlify/i.test(body)) throw new Error('corpo do index.html tem script/link/referência Netlify inesperada');

const css = read('app.css');
for (const need of [':root{', '@media (prefers-color-scheme: dark){:root:not([data-theme="light"]){', ':root[data-theme="dark"]{', 'body{background:var(--bg)']) {
  if (!css.includes(need)) throw new Error('app.css não segue o padrão de tema do Artifact: falta ' + need);
}

const inlineJs = (code, name) => {
  if (/\b(alert|confirm|prompt)\s*\(|window\.print\s*\(/.test(code.replace(/\/\/[^\n]*|\/\*[\s\S]*?\*\//g, ''))) throw new Error(name + ': alert/confirm/prompt/print não funcionam em Artifacts');
  return `<script>/* ${name} */\n${code.replace(/<\/(script)/gi, '<\\/$1').replace(/<!--/g, '<\\!--')}\n</script>`;
};
const inlineCss = (code) => `<style>\n${code.replace(/<\/(style)/gi, '<\\/$1')}\n</style>`;

const parts = [
  `<title>${title}</title>`,
  inlineCss(css),
  '<link rel="preconnect" href="https://fonts.googleapis.com">',
  '<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>',
  `<link rel="stylesheet" href="${fonts[1].replace(/&amp;/g, '&').replace(/&/g, '&amp;')}">`,
  body,
  // antes de tudo: este build nunca registra service worker e sempre usa o adaptador "artifact"
  `<script>window.FINSTORE_BUILD = 'artifact'; window.FINSTORE_NO_SW = true;</script>`,
  inlineJs(read('engine.js'), 'engine.js'),
  inlineJs(read('store.js'), 'store.js'),
  inlineJs(read('store-artifact.js'), 'store-artifact.js'),
  // SheetJS (planilhas .xlsx/.xls): async para não atrasar a abertura; app.js espera por ele quando precisa
  `<script src="${XLSX_URL}" async data-xlsx crossorigin="anonymous"></script>`,
  `<script>(function(){var s=document.querySelector('script[data-xlsx]');if(s)s.addEventListener('error',function(){s.dataset.failed='1';});})();</script>`,
  inlineJs(read('app.js'), 'app.js'),
];
const out = parts.join('\n') + '\n';

// conferências do contrato
if (/<!doctype|<html[\s>]|<head[\s>]|<\/head>|<body[\s>]|<\/body>|<\/html>/i.test(out)) throw new Error('saída contém doctype/html/head/body');
if (!out.startsWith('<title>')) throw new Error('a saída precisa começar com <title>');
if (/rel="manifest"|serviceWorker\.register\(swUrl|netlify-identity\.js"|theme-color|src="\/api|href="\/api/.test(out.replace(/<script>\/\* store\.js[\s\S]*?<\/script>/, ''))) throw new Error('referência da versão Netlify sobrou no build');
for (const m of out.matchAll(/<script[^>]*\ssrc="([^"]+)"/g)) {
  if (!/^https:\/\/(cdnjs\.cloudflare\.com|cdn\.jsdelivr\.net\/npm\/|unpkg\.com|cdn\.tailwindcss\.com|code\.jquery\.com)/.test(m[1])) throw new Error('script de origem não permitida: ' + m[1]);
}
for (const m of out.matchAll(/<link[^>]*rel="stylesheet"[^>]*href="([^"]+)"/g)) {
  if (!/^https:\/\/fonts\.googleapis\.com\//.test(m[1])) throw new Error('stylesheet de origem não permitida: ' + m[1]);
}
// v2.4b: pdf.js is loaded by app.js only when a PDF is chosen — from cdnjs (fallback jsDelivr), pinned (never a moving "latest")
const pdfUrls = [...out.matchAll(/https:\/\/[^'"`\s]*pdf\.js[^'"`\s]*/g)].map(m => m[0]);
if (!pdfUrls.length) throw new Error('app.js sem a URL do pdf.js');
for (const u of pdfUrls) if (!/^https:\/\/cdnjs\.cloudflare\.com\/ajax\/libs\/pdf\.js\/(?:\d+\.\d+\.\d+\/|'?\s*\+)/.test(u) && !/^https:\/\/cdnjs\.cloudflare\.com\/ajax\/libs\/pdf\.js\/$/.test(u)) throw new Error('pdf.js fora do cdnjs ou sem versão fixa: ' + u);
if (!/const PDFJS_VER = '\d+\.\d+\.\d+';/.test(out)) throw new Error('versão do pdf.js não fixada em app.js');
// fallback host: jsDelivr, the pinned npm package (same files as node_modules/pdfjs-dist/build/)
if ([...out.matchAll(/https:\/\/cdn\.jsdelivr\.net\/npm\/pdfjs-dist(?!@')/g)].length) throw new Error('pdf.js do jsDelivr sem versão fixa');
if (!/const PDFJS_CDN2 = 'https:\/\/cdn\.jsdelivr\.net\/npm\/pdfjs-dist@' \+ PDFJS_VER \+ '\/build\/';/.test(out)) throw new Error('fallback do pdf.js (jsDelivr) ausente ou fora do pacote fixado');
const bytes = Buffer.byteLength(out);
if (bytes > 16 * 1024 * 1024) throw new Error('maior que 16 MB');

mkdirSync(OUT_DIR, { recursive: true });
writeFileSync(OUT, out);
console.log(`dist-artifact/financas-flow.html  ${(bytes / 1024).toFixed(1)} KB`);
