# Test account (for agents / manual QA)

A shared, pre-seeded account for logging into the app during development and
agent-driven UI testing. It signs in through the normal email/password flow.

```
Email:    sumaiya.akter.audit01@gmail.com
Password: see apps/web/TEST_ACCOUNT.local.md (gitignored — ask the maintainer)
```

The password is **not committed** (this repo is public). It lives only in
`apps/web/TEST_ACCOUNT.local.md`, which is gitignored. Ask the maintainer for a
copy, or reset it via the app's "Forgot password" flow.

## What it has
- **Onboarding complete** → lands directly on the dashboard (not the setup wizard).
- **3 tailored toolkits** (BRAC Bank PLC, Linear, Standard Chartered Bank Bangladesh) → the "Your toolkits" grid + All Toolkits screen have real content.
- **~32 credits** (of 35 bought) and **7 completed purchases** → the credits pill and Purchase History screen show real data.
- No Master/General resume yet → the dashboard shows the "Build it from my profile" banner state.

## How to use
1. `cd apps/web && npm run dev` → open http://localhost:3000/login (or click **Sign in** from the landing page).
2. Enter the credentials (email above, password from the gitignored local file) and **Continue with email**.
3. You land on the redesigned dashboard.

> **Note:** `npm run dev` (plain Vite) does **not** serve the `/api/*` serverless
> functions, so anything that hits them (toolkit generation, Master-resume build,
> purchase confirmation) 404s locally. Use `vercel dev` to exercise those paths.

## ⚠️ Security
- This is a **test-only** account on the **production** Supabase project (single environment — there is no staging). It is a normal end-user account with **no admin access**.
- The password is **never committed** — this repository is public. Keep it only in the gitignored `TEST_ACCOUNT.local.md`. If it ever leaks, rotate it (reset in Supabase / via the app's "Forgot password" flow).
- Don't run destructive tests with it (it holds real sample data used to demo the UI).
