# TOP CANDIDATE

The complete toolkit to land the job. Paste a job description; get an ATS-tailored resume, a real cover letter, a cold outreach email to the hiring manager, a LinkedIn connection note, and a prep sheet of the 6–8 questions you'll actually be asked — all in one run.

> **For AI agents** (Claude Code, Cursor, Antigravity, etc.): the canonical context document is [`AGENTS.md`](./AGENTS.md). Start there.
> Claude Code-specific rules are in [`CLAUDE.md`](./CLAUDE.md).

---

## Quick start

```bash
npm install
cp .env.example .env     # fill in the three env vars below
npm run dev
```

### Required env vars

| Variable | Where to get it |
|---|---|
| `VITE_GEMINI_API_KEY` | [Google AI Studio](https://aistudio.google.com/app/apikey) |
| `VITE_SUPABASE_URL` | Supabase Project Settings → API |
| `VITE_SUPABASE_ANON_KEY` | Supabase Project Settings → API |

### Database

Run `supabase/schema.sql` in the Supabase SQL editor, then every file under `supabase/migrations/` in order. All migrations are idempotent.

## Build

```bash
npm run build       # tsc + vite build
npm run preview     # serve dist/
```

No test suite. Verification is `npm run build` passing + a manual browser pass.

## What's in the box

- **Resume** — tailored summary, bullets, skills; 4 ATS-safe single-column templates; export to PDF or Word
- **Cover letter** — role-specific body paragraphs; export to PDF or Word
- **Outreach email** — cold email to the hiring manager (subject + body); copy-to-clipboard
- **LinkedIn note** — ≤ 280-char tailored connection request
- **Interview prep** — 6–8 questions with *why asked* and *how to answer*, expandable cards, per-question copy
- **Master profile** — one-time capture; drives auto-generated resumes and prefills the builder
- **General Resume** — a generic, profile-based resume with a 24-hour regen cooldown

## Stack

React 19 · TypeScript 5.8 · Vite 6 · Tailwind (CDN) · Google Gemini 2.5 Flash · Supabase (Auth + Postgres + RLS) · docx · jspdf / html2pdf.js · Lucide · Sonner · date-fns

Clean Architecture: `domain → application → infrastructure (impl) ← presentation`. Full details in [`AGENTS.md`](./AGENTS.md).

## Deploying

See [`DEPLOYING.md`](./DEPLOYING.md) — Vercel + Supabase, with the migration step called out.

## License

MIT
