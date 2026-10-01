// Post-build step (run by `npm run build`, after `vite build` and the SSR
// build of src/prerender.tsx into dist-ssr/).
//
// For each public page in PAGES it takes dist/index.html and writes a
// crawlable copy:
//   - replaces the `<!-- seo:start -->…<!-- seo:end -->` block with that
//     page's title / description / canonical / hreflang / OG / JSON-LD
//   - injects the server-rendered page into #root, wrapped in #tc-prerender
//     so index.html's boot script can hide it for visitors who will see a
//     different screen
//   - stamps <html lang> + data-prerender (the page key)
// The landing (en) overwrites dist/index.html itself, which the SPA rewrite
// also serves for every app path. It also writes dist/sitemap.xml.

import { readFileSync, writeFileSync, rmSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dist = path.join(root, 'dist');
const ssrDir = path.join(root, 'dist-ssr');

const { PAGES, SITE_URL } = await import(pathToFileURL(path.join(ssrDir, 'prerender.js')).href);

const template = readFileSync(path.join(dist, 'index.html'), 'utf8');
const SEO_BLOCK = /<!-- seo:start[\s\S]*?<!-- seo:end -->/;
const ROOT_MARK = '<!--app-html-->';
if (!SEO_BLOCK.test(template) || !template.includes(ROOT_MARK)) {
  throw new Error('prerender: dist/index.html is missing the seo:start/seo:end or <!--app-html--> markers');
}

for (const page of PAGES) {
  const html = template
    .replace('<html lang="en">', `<html lang="${page.locale}" data-locale="${page.locale}" data-prerender="${page.key}">`)
    .replace(SEO_BLOCK, () => page.head())
    .replace(ROOT_MARK, () => `<div id="tc-prerender">${page.body()}</div>`);
  writeFileSync(path.join(dist, page.file), html);
  console.log(`prerender: ${page.path} → dist/${page.file} (${(html.length / 1024).toFixed(0)} kB)`);
}

// Only public, indexable URLs. Everything behind sign-in is noindex.
// No <lastmod>: it would change on every deploy whether or not the page did,
// and Google ignores a lastmod it can't trust.
const sitemap = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">
${PAGES.map(
  (p) => `  <url>
    <loc>${SITE_URL}${p.path}</loc>
    <priority>${p.priority}</priority>
${(p.alternates ?? []).map((a) => `    <xhtml:link rel="alternate" hreflang="${a.hreflang}" href="${a.href}" />\n`).join('')}  </url>`,
).join('\n')}
</urlset>
`;
writeFileSync(path.join(dist, 'sitemap.xml'), sitemap);
console.log('prerender: dist/sitemap.xml');

rmSync(ssrDir, { recursive: true, force: true });
