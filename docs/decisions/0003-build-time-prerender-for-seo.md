# ADR-0003: Build-time prerender of the landing page for search and AI crawlers

- **Date:** 2026-10-01
- **Status:** Accepted

## Context

The web app is a client-rendered Vite SPA. Every URL served the same `index.html` with an empty `<div id="root">`, so the page only had content after JavaScript ran. Google does render JavaScript, but it does so in a deferred second pass. Bing does so less reliably. AI crawlers (GPTBot, ClaudeBot, PerplexityBot, …) don't run it at all, so they saw a page with a title and nothing else. For a product whose growth depends on being found ("CV maker Bangladesh", "Top Candidate") and recommended by assistants, the public landing page has to exist as HTML.

## Decision

At build time, server-render the landing page and write it into the static HTML. No server runtime is added.

1. `src/prerender.tsx` is a build-only SSR entry. It renders `LandingScreen` with `react-dom/server` for each locale. It also generates the head tags (title, description, canonical, hreflang, OG/Twitter) and the JSON-LD from the i18n dictionaries.
2. `scripts/prerender.mjs` runs after `vite build`. It writes `dist/index.html` (English, `/`), `dist/bn.html` (Bangla, `/bn`, via a `vercel.json` rewrite) and `dist/sitemap.xml`.
3. **Snapshot, not hydration.** The client still calls `createRoot`, which replaces the markup. A boot script in `index.html` hides the snapshot before first paint for visitors who will see something else: signed-in users, other paths, or the other language. This prevents a flash of the wrong screen.

## Why not the alternatives

- **Migrate to Next.js / SSR framework.** This would solve it generally, but it means rewriting routing, the build, and the `api/` layout under the 12-function Hobby cap. That is out of proportion to the problem, which is one public page.
- **Hand-written static HTML fallback.** It would duplicate the landing copy and drift from it immediately. The prerender reads the same components and dictionaries.
- **Hydration (`hydrateRoot`).** The app's first render depends on auth state and the detected locale, so it would mismatch the snapshot for many visitors. Replacing the snapshot is simpler and has no mismatch class of bug.
- **A prerendering service (Prerender.io etc.).** It costs money, adds a third party in the request path, and relies on user-agent sniffing.

## Consequences

- `LandingScreen` and everything it imports must be SSR-safe at render time. A violation fails the build rather than shipping.
- Only the landing page is crawlable without JS. If more public pages are added (guides, templates), each needs an entry in the prerender script, the sitemap, and a rewrite.
