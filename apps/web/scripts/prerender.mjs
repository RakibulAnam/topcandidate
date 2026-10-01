// Post-build step (run by `npm run build`, after `vite build` and the SSR
// build of src/prerender.tsx into dist-ssr/).
//
// For each locale it takes dist/index.html and writes a crawlable page:
//   - replaces the `<!-- seo:start -->…<!-- seo:end -->` block with that
//     locale's title / description / canonical / hreflang / OG / JSON-LD
//   - injects the server-rendered landing page into #root, wrapped in
//     #tc-prerender so index.html's boot script can hide it for visitors who
//     will see a different screen
//   - stamps <html lang> + data-prerender
// en → dist/index.html (served at `/` and, via the SPA rewrite, every app
// path), bn → dist/bn.html (served at `/bn`, see vercel.json).
// It also writes dist/sitemap.xml so <lastmod> tracks the deploy date.

import { readFileSync, writeFileSync, rmSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dist = path.join(root, 'dist');
const ssrDir = path.join(root, 'dist-ssr');

const { renderLanding, headFor, pathFor, LOCALES, SITE_URL } = await import(
  pathToFileURL(path.join(ssrDir, 'prerender.js')).href
);

const template = readFileSync(path.join(dist, 'index.html'), 'utf8');
const SEO_BLOCK = /<!-- seo:start[\s\S]*?<!-- seo:end -->/;
const ROOT_MARK = '<!--app-html-->';
if (!SEO_BLOCK.test(template) || !template.includes(ROOT_MARK)) {
  throw new Error('prerender: dist/index.html is missing the seo:start/seo:end or <!--app-html--> markers');
}

for (const locale of LOCALES) {
  const html = template
    .replace('<html lang="en">', `<html lang="${locale}" data-locale="${locale}" data-prerender="${locale}">`)
    .replace(SEO_BLOCK, () => headFor(locale))
    .replace(ROOT_MARK, () => `<div id="tc-prerender">${renderLanding(locale)}</div>`);
  const out = locale === 'en' ? 'index.html' : `${pathFor(locale).slice(1)}.html`;
  writeFileSync(path.join(dist, out), html);
  console.log(`prerender: ${pathFor(locale)} → dist/${out} (${(html.length / 1024).toFixed(0)} kB)`);
}

// Only public, indexable URLs. Everything behind sign-in is noindex.
const today = new Date().toISOString().slice(0, 10);
const alternates = LOCALES.map(
  (l) => `    <xhtml:link rel="alternate" hreflang="${l}" href="${SITE_URL}${pathFor(l)}" />`,
).concat(`    <xhtml:link rel="alternate" hreflang="x-default" href="${SITE_URL}/" />`);
const urls = [
  ...LOCALES.map((l) => ({ loc: `${SITE_URL}${pathFor(l)}`, priority: l === 'en' ? '1.0' : '0.9', alt: true })),
  { loc: `${SITE_URL}/legal/terms`, priority: '0.3', alt: false },
];
const sitemap = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">
${urls
  .map(
    (u) => `  <url>
    <loc>${u.loc}</loc>
    <lastmod>${today}</lastmod>
    <priority>${u.priority}</priority>
${u.alt ? alternates.join('\n') + '\n' : ''}  </url>`,
  )
  .join('\n')}
</urlset>
`;
writeFileSync(path.join(dist, 'sitemap.xml'), sitemap);
console.log('prerender: dist/sitemap.xml');

rmSync(ssrDir, { recursive: true, force: true });
