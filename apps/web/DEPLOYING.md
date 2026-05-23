# Deploying TOP CANDIDATE to Vercel

Step-by-step guide to get TOP CANDIDATE running on [Vercel](https://vercel.com) with a Supabase backend.

## Prerequisites

- A Git host (GitHub, GitLab, or Bitbucket) with the repo pushed
- A [Vercel account](https://vercel.com/signup)
- A [Supabase account](https://supabase.com)
- A [Google AI Studio API key](https://aistudio.google.com/app/apikey) (Gemini)

---

## Step 1 — Supabase (backend)

1. **Create a project** at [supabase.com/dashboard](https://supabase.com/dashboard). Note the Project URL and the Anon Key (Project Settings → API).

2. **Enable email/password auth** under Authentication → Providers.

3. **Bootstrap the schema**:
   - Open the SQL Editor in Supabase.
   - Paste the full contents of `supabase/schema.sql` and run it. This creates every table, RLS policy, the `handle_new_user` trigger, and the `delete_user` RPC.

4. **Apply migrations in order**: every file under `supabase/migrations/` is idempotent — run each one once. At time of writing:
   - `001_add_toolkit_column.sql` — adds the `toolkit jsonb` column on `generated_resumes` for AI-generated outreach/LinkedIn/interview prep.

   If you just ran `schema.sql` on a fresh project you can skip migrations that are already reflected in the schema — but the migration files are still safe to re-run.

---

## Step 2 — Vercel (frontend)

### Option A: Git integration (recommended)

1. **Import** the repo at [vercel.com/dashboard](https://vercel.com/dashboard) → Add New → Project.
2. **Framework preset**: Vite (auto-detected). Build command `vite build`, output `dist`.
3. **Environment variables** — add all three:

   | Name | Source |
   |---|---|
   | `VITE_SUPABASE_URL` | Supabase → Project Settings → API |
   | `VITE_SUPABASE_ANON_KEY` | Supabase → Project Settings → API |
   | `VITE_GEMINI_API_KEY` | Google AI Studio → API keys |

4. **Deploy**. Vercel gives you a live URL on completion.

### Option B: Vercel CLI

```bash
npm i -g vercel
vercel login
vercel             # first run creates + links the project
vercel --prod      # promote to production after smoke test
```

Add env vars in the dashboard afterwards (or via `vercel env add`).

---

## Step 3 — Verify

1. Open the deployed URL, sign up, confirm a new row lands in `profiles`.
2. Build a resume against a real job description. Confirm:
   - The resume renders and exports
   - The cover letter tab appears
   - The **Outreach Email**, **LinkedIn Note**, and **Question Prep** sidebar sections appear
   - Inspect the row in `generated_resumes`: `data` holds the resume, `toolkit` holds the three new artifacts

## Troubleshooting

- **404 on refresh** — `vercel.json` handles SPA rewrites; if you forked, make sure the file is present.
- **"Missing Supabase environment variables" warning** — env vars not wired in Vercel, or the deployment preview is using the wrong environment.
- **AI not responding** — `VITE_GEMINI_API_KEY` missing or invalid in Vercel env.
- **Empty toolkit sections in Preview** — the resume was generated **before** the toolkit migration. Generate a new application; old rows legitimately have `toolkit = NULL`.
- **"relation generated_resumes.toolkit does not exist"** — the migration was not applied. Open the Supabase SQL editor, run `supabase/migrations/001_add_toolkit_column.sql`.
