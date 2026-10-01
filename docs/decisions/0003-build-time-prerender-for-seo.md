# ADR-0003: Build-time prerender of the landing page for search and AI crawlers

- **Date:** 2026-10-01
- **Status:** Accepted

## Context

The web app is a client-rendered Vite SPA. Every URL served the same `index.html` with an empty `<div id="root">`, so the page only had content after JavaScript ran. Google does render JavaScript, but it does so in a deferred second pass. Bing does so less reliably. AI crawlers (GPTBot, ClaudeBot, PerplexityBot, …) don't run it at all, so they saw a page with a title and nothing else. For a product whose growth depends on being found ("CV maker Bangladesh", "Top Candidate") and recommended by assistants, the public landing page has to exist as HTML.

## Decision

At build time, server-render the public pages and write them into static HTML. No server runtime is added.

1. `src/prerender.tsx` is a build-only SSR entry. Its `PAGES` list holds the public pages: the landing page in English and Bangla, and the Terms page. Each entry renders with `react-dom/server` and generates its own head tags (title, description, canonical, OG/Twitter; hreflang and JSON-LD on the landing pages) from the i18n dictionaries.
2. `scripts/prerender.mjs` runs after `vite build`. It writes `dist/index.html` (`/`), `dist/bn.html` (`/bn`), `dist/legal-terms.html` (`/legal/terms`) and `dist/sitemap.xml`. The last two pages are served through `vercel.json` rewrites.
3. **Snapshot, not hydration.** The client still calls `createRoot`, which replaces the markup. A boot script in `index.html` hides the snapshot before first paint for visitors who will see something else: signed-in users, other paths, or the other language. This prevents a flash of the wrong screen.

## Why not the alternatives

- **Migrate to Next.js / SSR framework.** This would solve it generally, but it means rewriting routing, the build, and the `api/` layout under the 12-function Hobby cap. That is out of proportion to the problem, which is a handful of public pages.
- **Hand-written static HTML fallback.** It would duplicate the landing copy and drift from it immediately. The prerender reads the same components and dictionaries.
- **Hydration (`hydrateRoot`).** The app's first render depends on auth state and the detected locale, so it would mismatch the snapshot for many visitors. Replacing the snapshot is simpler and has no mismatch class of bug.
- **A prerendering service (Prerender.io etc.).** It costs money, adds a third party in the request path, and relies on user-agent sniffing.

## Consequences

- `LandingScreen` and everything it imports must be SSR-safe at render time. A violation fails the build rather than shipping.
- Only the pages in `PAGES` are crawlable without JS. Any other route is served the English landing's HTML, with canonical `/`. A new public page (guides, templates) needs a `PAGES` entry, a rewrite, and a path in the boot script, or Google folds it into the homepage.
