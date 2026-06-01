# TOP CANDIDATE — Production Setup Guide

> A complete, copy-paste-able walkthrough to take the app from `roh-ats-resume-builder.vercel.app` (free) to `topcandidate.com` (production) with **predictable, capped costs**.
>
> Total active engineering time: **~60 minutes**. Total ongoing cost at launch: **$45/month flat + capped AI bill**.

---

## 0. What this guide does (and doesn't)

**Covers:**
- Buying a domain (cheapest, no-renewal-trick option)
- Connecting the domain to Vercel
- Upgrading Vercel + setting a **hard spending cap** so your bill cannot surprise you
- Putting Cloudflare in front of Vercel to **cut Vercel bandwidth bills by ~10×**
- Updating Supabase auth and app code so sign-in works on the new domain
- A final cost prediction at 100 / 1K / 10K / 50K users

**Doesn't cover:**
- The Flutter SMS-watcher for bKash confirmation (see `AGENTS.md` §13)
- Migrating AI providers to OpenRouter (separate task — do after launch)
- Email deliverability for password resets (Supabase handles it on Pro)

> **Heads-up on the AI stack:** OpenRouter is **not implemented**. It is referenced below (and in `docs/OPENROUTER_MIGRATION.md`) only as a *planned* post-launch migration. The shipped stack is **Groq (primary optimizer) + Gemini (fallback optimizer + all toolkit generators + resume extractor)**, configured via `GROQ_API_KEY` + `GEMINI_API_KEY` — both on free tiers today. Where the cost tables in §12 say "via OpenRouter", read that as a future-state projection, not the current bill.

**Assumption:** You are the only user on Vercel and Cloudflare for now. Solo dev. One account each.

---

## 1. Pre-flight checklist (5 min)

Before you touch anything:

- [ ] You have a credit/debit card that works internationally (DBBL / EBL Aqua / Dutch-Bangla Visa Debit / etc.). Cloudflare and Vercel both bill in USD.
- [ ] You can receive emails at the address tied to your Vercel + Supabase + GitHub accounts.
- [ ] `npm run build` passes clean on `main`.
- [ ] You know which Vercel project name corresponds to your deployment (`roh-ats-resume-builder` based on the current URL).
- [ ] **Pick your domain.** Recommended order:
   1. `topcandidate.com` (first choice — but probably taken)
   2. `topcandidate.co` (~$13/yr)
   3. `topcandidate.app` (~$14/yr — implies SaaS, fine choice)
   4. `gettopcandidate.com` / `topcandidatebd.com` (~$10/yr)

Whatever you pick, **use it consistently everywhere**. Don't go back and forth.

---

## 2. Buy the domain from Cloudflare Registrar (~10 min)

### Why Cloudflare Registrar specifically

| Registrar | First year | Renewal | Hidden fees | WHOIS privacy |
|---|---|---|---|---|
| **Cloudflare** | ~$10.46 (.com) | **Same price** | None | **Free** |
| Namecheap | $6–8 | $13.98 | Upsells (privacy ~$3/yr after first year) | Free first year |
| GoDaddy | $0.99–11 | $20–25 | Many | $9.99/yr |
| Google Domains | n/a — discontinued, migrated to Squarespace | — | — | — |

Cloudflare sells at wholesale cost (what Verisign charges them). You will pay exactly the same number every year — no first-year-discount-then-double-price renewal trick. Free WHOIS privacy is a real $10–20/yr saving elsewhere. And — important — you want to be on Cloudflare DNS anyway (Section 5).

### Steps

1. Go to <https://www.cloudflare.com/products/registrar/> → click **Search for a domain**
2. Sign up for a Cloudflare account (free) if you don't have one. Use the email you'll keep forever (not a personal Gmail you might lose access to).
3. Enable **2FA on Cloudflare immediately** (Account → Security → Two-Factor Authentication → use Authy or Google Authenticator). Losing this account loses your domain.
4. Search your chosen domain. If `topcandidate.com` is unavailable, try the fallbacks from §1.
5. Add to cart → checkout. Pay with your card. The domain is yours within ~5 minutes; you'll get a confirmation email.
6. Once purchased, the domain shows up in your Cloudflare dashboard under **Websites** with DNS already managed by Cloudflare.

**Cost so far: ~$10.46 one-time (renews same price annually).**

---

## 3. Upgrade Vercel to Pro + set the hard spending cap (10 min)

This is the most important step in the whole guide. Skip nothing here.

### Why Pro is required, not optional

Vercel Hobby (free) tier blocks two things this app needs:
- **10-second function timeout** — your `/api/optimize` route runs the optimizer + toolkit AI calls, which can take 30–45 seconds. On Hobby, every generation 504-errors.
- **No spending cap with auto-pause** — Hobby is just rate-limited; Pro is the only tier where you can install the circuit breaker.

Pro is **$20/month flat** and includes 1TB bandwidth + everything else this app uses.

### Upgrade

1. Vercel dashboard → your team (top-left dropdown) → **Settings** → **Billing**
2. Click **Upgrade to Pro** → confirm card details → confirm.
3. Wait ~30 seconds; the team is now Pro.

### Install the spending cap (do not skip)

1. Same team → **Settings** → **Spend Management**
2. Click **Enable Spend Management**
3. Set **Spend amount** = `$30` (this gives you $10 of overage headroom above the $20 base; raise later if needed)
4. **Toggle "Pause production deployment" ON**. This is what makes it a hard cap instead of an alert.
5. Type your team name to confirm → **Save**

### What this cap actually does

- Vercel checks every few minutes whether your month-to-date spend is at or above $30.
- When it crosses the threshold, **all production deployments in this team are paused**. Visitors see a `503 DEPLOYMENT_PAUSED` page until you manually resume.
- Pausing is **not instant** — you might overshoot by $1–2 before Vercel catches up. That's fine.
- **Projects do NOT auto-resume on the 1st of the next month.** You have to manually unpause each one in the dashboard. This is on purpose — if you got paused, you want to know why before you bring it back up.

### What to do if you actually get paused

1. Vercel dashboard → **Usage** → look at what's eating budget
2. Most common cause: a runaway loop in `/api/optimize-general` or an abuse pattern on the free tier
3. Fix the root cause (tighten the `ai_call_log` rate limit, add a cool-down, etc.)
4. Settings → Spend Management → raise cap to next round number (e.g. $50)
5. Each project page → **Resume Deployment** button

**Cost so far: $10.46 one-time + $20/month flat (capped at $30 worst case).**

---

## 4. Connect the domain to Vercel (10 min)

### Add the domain in Vercel

1. Vercel dashboard → your project → **Settings** → **Domains**
2. In the input field, type your domain (e.g. `topcandidate.com`) → click **Add**
3. Vercel asks "Add `www.topcandidate.com` too?" — say **Yes**. Pick `topcandidate.com` (no `www`) as primary; `www` will 308-redirect to it.
4. Vercel now shows DNS records you need to add. Typically:
   - `A` record on `@` → `76.76.21.21`
   - `CNAME` record on `www` → `cname.vercel-dns.com`

Keep this tab open.

### Add DNS records in Cloudflare

1. Cloudflare dashboard → your domain → **DNS** → **Records** → **Add record**
2. Add the A record:
   - Type: `A`
   - Name: `@` (or leave blank — Cloudflare uses the apex)
   - IPv4 address: `76.76.21.21` (from Vercel — use whatever Vercel showed you)
   - **Proxy status: DNS only** (grey cloud) — IMPORTANT, do NOT enable proxy yet. We'll flip this in §6.
   - Save
3. Add the CNAME record:
   - Type: `CNAME`
   - Name: `www`
   - Target: `cname.vercel-dns.com`
   - Proxy status: **DNS only** (grey cloud) for now
   - Save

### Verify

1. Wait 1–10 minutes (DNS propagation; usually under 2 min on Cloudflare)
2. Vercel domains tab will show **Valid Configuration** with a green check
3. Vercel auto-issues a free Let's Encrypt SSL cert (~30 seconds)
4. Visit `https://topcandidate.com` in a browser — your app loads. SSL works (padlock icon).

**If it doesn't work after 15 minutes:**
- Check both DNS records exist in Cloudflare with the right values
- `dig topcandidate.com` from terminal — should return `76.76.21.21`
- If Cloudflare shows the record but Vercel still says invalid, hit **Refresh** in Vercel's Domains tab

**Cost so far: still $10.46 one-time + $20/month flat. Nothing new.**

---

## 5. Update Supabase auth redirect URLs (5 min) — DO NOT SKIP

Without this, sign-in and email verification will break the moment a user visits the new domain. Email verification links will point at `roh-ats-resume-builder.vercel.app` and confuse users.

### Steps

1. Supabase dashboard → your project → **Authentication** → **URL Configuration**
2. **Site URL:** change to `https://topcandidate.com`
3. **Redirect URLs:** add these (keep existing ones for fallback during transition):
   - `https://topcandidate.com/**`
   - `https://www.topcandidate.com/**`
   - (Leave `https://roh-ats-resume-builder.vercel.app/**` for now — remove in 2 weeks after you confirm nothing depends on it)
4. Save.

### Email template (optional, do this when you have 10 min)

The Supabase default email templates reference the Site URL but you can polish them:
1. Authentication → **Email Templates**
2. For "Confirm signup" / "Reset password" — replace any hardcoded `Supabase` branding with `TOP CANDIDATE`
3. Verify the action URL uses `{{ .SiteURL }}` (not a hardcoded string)

---

## 6. Put Cloudflare in front of Vercel — cut bandwidth bills (10 min)

This is the cost-optimization layer. It's optional for correctness but **it's how you protect Vercel bandwidth at scale**.

### What this does

Before: User → Vercel → loads 1.7MB JS bundle + fonts + images = **~50MB per active user**. Vercel Pro includes 1TB; you'd hit it at ~20K active monthly users.

After: User → **Cloudflare CDN (free, unlimited bandwidth)** → cached JS/CSS/fonts served from Cloudflare's 300+ edge POPs. Vercel only sees the dynamic `/api/*` calls (~5KB each).

**Net effect: ~10× reduction in Vercel bandwidth.** You won't sniff the 1TB cap until ~200K active users.

### Steps

#### 6a. Flip the proxy from grey to orange

1. Cloudflare dashboard → your domain → **DNS** → **Records**
2. Click the cloud icon next to the `A` record (the one pointing to `76.76.21.21`). It flips from grey ☁ to orange ☁. This means traffic now flows **through** Cloudflare.
3. Same for the `www` CNAME record.

Done. Traffic now goes User → Cloudflare → Vercel.

#### 6b. Add a Cache Rule to bypass `/api/*`

You do NOT want Cloudflare caching your API responses (they're per-user, dynamic, often sensitive).

1. Cloudflare dashboard → your domain → **Caching** → **Cache Rules** → **Create rule**
2. Rule name: `Bypass API routes`
3. When incoming requests match: **Custom filter expression**
   - Field: `URI Path`
   - Operator: `starts with`
   - Value: `/api/`
4. Then: **Bypass cache**
5. Deploy

#### 6c. (Optional but free) Aggressive caching for static assets

1. Same Cache Rules page → **Create rule**
2. Name: `Cache static assets long`
3. When: URI Path matches regex `\.(js|css|woff2?|ttf|otf|png|jpg|jpeg|svg|webp|ico|pdf)$`
4. Then: **Cache eligibility: Eligible for cache**, **Edge TTL: Use cache-control header** or override to **30 days**
5. Deploy

Vite already adds content hashes to bundled filenames (`assets/index-A1b2C3d4.js`), so 30-day caching is safe — when you redeploy, the hash changes and clients fetch the new file.

#### 6d. Verify

1. Open `https://topcandidate.com` in an incognito window
2. Open DevTools → Network tab
3. Reload. Look at the response headers of `index.js` (or any asset):
   - First load: `cf-cache-status: MISS` (Cloudflare fetched from Vercel)
   - Reload: `cf-cache-status: HIT` (served from Cloudflare's edge, didn't touch Vercel)
4. Now hit an API route (e.g. trigger a sign-in):
   - Response headers should show `cf-cache-status: BYPASS` or `DYNAMIC`
   - This proves API calls still go to Vercel

**Cost so far: still $10.46/yr + $20/mo. Cloudflare is free for this use case.**

### Caveat — when Cloudflare proxy can bite you

- If Vercel issues a new SSL cert (auto-renewal every 90 days), Cloudflare's proxy can briefly show a stale cert. Resolved by Vercel's Let's Encrypt auto-renew on retry. Has not been a real problem since ~2023.
- The first time you set up the proxy, sometimes Vercel takes 1–2 minutes to recognize that the request is legit (it sees a Cloudflare IP, not a direct visitor). If you see 525 errors initially, wait 5 minutes.
- If you ever need to debug a Vercel-specific issue, flip the cloud back to grey temporarily to bypass Cloudflare.

---

## 7. Update hardcoded URLs in the app (15 min)

The app likely has the old `vercel.app` URL hardcoded in a few places. Audit and replace.

### Find every reference

```bash
cd /Users/bs00834/Desktop/TopCandidate/apps/web
grep -rni "vercel.app\|roh-ats-resume-builder" src/ api/ index.html metadata.json supabase/ 2>/dev/null
```

### What to replace

For each hit:
- **`index.html`** — `<meta property="og:url">`, `<link rel="canonical">`, JSON-LD if any
- **`metadata.json`** — top-level URL field if present
- **Any social share buttons** in components (Open Graph image URLs, etc.)
- **Email templates** in Supabase (covered in §5)
- **README.md / DEPLOYING.md** — replace the example URL

### Commit and deploy

```bash
git checkout -b chore/migrate-to-topcandidate-domain
# make changes
git add -p
git commit -m "chore: switch primary domain to topcandidate.com"
git push -u origin chore/migrate-to-topcandidate-domain
```

Open a PR, merge to `master`, Vercel auto-deploys. Both URLs (`*.vercel.app` and `topcandidate.com`) keep working — Vercel doesn't remove the original.

---

## 8. Tighten per-route function timeouts (5 min, free saving)

Your `vercel.json` currently sets `maxDuration: 60` for **all** `api/**/*.ts`. The optimizer needs that, but a runaway request on a small endpoint could eat 60s of compute for no reason.

### Edit `vercel.json`

Replace the existing `functions` block with:

```jsonc
{
  "functions": {
    "api/optimize.ts":            { "maxDuration": 60 },
    "api/optimize-general.ts":    { "maxDuration": 60 },
    "api/toolkit-item.ts":        { "maxDuration": 45 },
    "api/extract-resume.ts":      { "maxDuration": 30 },
    "api/purchase.ts":            { "maxDuration": 10 },
    "api/confirm-purchase.ts":    { "maxDuration": 10 }
  }
}
```

(There is no `api/dev-mock-confirm.ts` — that scaffolding was removed; `/api/purchase` records a real `pending` bKash row and the HMAC `confirm-purchase` webhook grants credits.)

Caps compute waste from misbehaving endpoints.

---

## 9. Final smoke test (10 min) — go through the whole flow

Use a real browser, incognito mode, on `https://topcandidate.com`. Hit every paid path:

- [ ] Landing page loads, SSL padlock shows
- [ ] Sign up with a fresh email → confirmation email arrives, links to `topcandidate.com`
- [ ] Sign in → lands on profile setup or dashboard
- [ ] Profile setup completes → dashboard loads
- [ ] Build a tailored resume → optimizer + toolkit complete (this is the 60s path)
- [ ] Preview tab shows resume + toolkit
- [ ] Download PDF → renders
- [ ] Download Word → renders
- [ ] Trigger PurchaseModal → bKash placeholder shows
- [ ] Sign out → back to landing

If any step fails, check:
- Supabase Auth URL Configuration (§5)
- Browser console for CORS errors (means an API endpoint is rejecting the new origin)
- Vercel function logs → Vercel dashboard → your project → Logs

---

## 10. Monitoring (free, do once)

You want to know things are healthy without paying for a separate observability tool.

### Vercel built-in (free on Pro)

- **Vercel dashboard → your project → Logs** — last 24h of function invocations, filterable
- **Vercel dashboard → your project → Usage** — bandwidth, function execution, build minutes
- **Vercel dashboard → team → Spend Management → Activity** — what's eating budget

Set this bookmark: `https://vercel.com/<your-team>/<your-project>/usage` — check weekly until you're comfortable with the numbers.

### Cloudflare built-in (free)

- Cloudflare → your domain → **Analytics & Logs** → **Traffic** — request volume, cache hit ratio, country breakdown
- The **cache hit ratio** is the number to watch. Target: 70%+. If lower, your Cache Rules in §6 aren't matching enough requests.

### Supabase built-in (free)

- Supabase dashboard → **Reports** — auth signups, database queries, edge function invocations
- Set email alerts for "API usage > 80% of plan limit" under **Settings → Notifications**

### Uptime monitoring (free, optional)

- <https://uptimerobot.com> — free tier: 50 monitors, 5-min interval, email alerts
- Add one monitor for `https://topcandidate.com` (HTTP, 200 expected)
- Add one for `https://topcandidate.com/api/optimize-general` (POST, but you can use HEAD for liveness)

Saves you "I didn't know it was down for 4 hours" stories.

---

## 11. What to do next month (after launch)

These are not gating; do them once you have ~100 real users:

- [ ] Migrate AI providers to **OpenRouter** with a $20/mo hard cap (see prior chat — single key for DeepSeek + Llama + Gemini fallback)
- [ ] Build the **Flutter SMS-watcher** for bKash confirmation (AGENTS.md §13). Until this exists, you confirm purchases manually via `select confirm_purchase('<txnid>', '<observed_sender_msisdn>');` in the Supabase SQL editor (the function takes the transaction id plus the observed sender msisdn), or use the `/admin` panel's "Confirm now" action.
- [ ] Upgrade **Supabase to Pro** ($25/mo) the day you cross 40K monthly active users on Auth. Free tier pauses inactive projects after 7 days, so do this *before* launch traffic if anyone in another timezone needs the app online overnight.
- [ ] **Apply all DB migrations through `012_realtime_and_match_on_submit.sql`** (full list + order in [`../DEPLOYING.md`](../DEPLOYING.md)). Migration 012 ships near-real-time credit assignment (`inbound_payments` + match-on-submit) and adds the `purchases` table to the `supabase_realtime` publication.
- [ ] **Confirm Realtime on `purchases`** — Realtime is on by default (no switch to flip; the "Replication" page is a different Pro feature you don't need). Migration 012 adds `purchases` to the `supabase_realtime` publication; verify under **Database → Publications → `supabase_realtime`** or via `select tablename from pg_publication_tables where pubname='supabase_realtime';`. The purchase-status pill subscribes live to its own row, so credits appear sub-second instead of via polling. Works on the free tier.
- [ ] (Done) The dev mock-confirm scaffolding (`api/dev-mock-confirm.ts` + `mockConfirm()` in `PurchaseModal.tsx`) has already been removed — nothing to delete here.

---

## 12. SUMMARY — what you are buying and what it costs

### One-time purchases

| Item | Cost (USD) | Cost (BDT @ 122.9) | Frequency |
|---|---|---|---|
| Domain (Cloudflare Registrar, `.com`) | $10.46 | ৳1,285 | Yearly, same price forever |

### Recurring fixed costs

| Service | Monthly | Annual | Why |
|---|---|---|---|
| Vercel Pro | $20 | $240 | Required for 60s function timeout + Spend Management cap |
| Supabase Pro *(only when launching to real users)* | $25 | $300 | Required so the project doesn't auto-pause after 7 days idle |
| Cloudflare | $0 | $0 | DNS + CDN + caching are all free |
| Domain | — | $10.46 | Already listed above |
| **Total fixed (pre-launch)** | **$20** | **~$250** | Vercel only — Supabase still free |
| **Total fixed (post-launch)** | **$45** | **~$550** | Both Pro tiers + domain |

### Variable costs (capped)

| Service | What it covers | Cap mechanism |
|---|---|---|
| Vercel overage (bandwidth, compute > included) | Anything beyond Pro plan inclusions | **Hard cap at $30/mo via Spend Management — auto-pauses deployments** |
| AI APIs (DeepSeek / Llama / Gemini via OpenRouter) | All AI generation | **Hard cap via OpenRouter per-key spending limit (you choose: $20/$50/$200/etc.)** |
| bKash transaction fees | ~1.5% on each purchase | Proportional to revenue, not a fixed cost |

### Worst-case monthly bill (everything caps trigger)

```
Vercel Pro base        $20
Vercel overage cap     $10  (the $30 spend cap minus the $20 base)
Supabase Pro           $25
OpenRouter cap         $50  (you choose this number)
Domain (1/12 of $10)   $0.87
─────────────────────────────
Worst case             $106 / month  = ~৳13,000 / month
```

**Even if every spending cap triggers, you cannot lose more than ~৳13K/month.** Realistic months at low traffic will be ~$45.

### Active user predictions

Based on the architecture documented in `AGENTS.md` and what the above stack supports:

| Active monthly users | What's happening | Monthly cost (realistic) | Notes |
|---|---|---|---|
| 0–100 | Soft launch, friends + early adopters | **~$45** | Almost all of it is fixed Vercel + Supabase Pro. AI cost is rounding error (~$1) |
| 1,000 | Initial marketing pull | **~$50** | AI bill ticks up to ~$3/mo if 10% buy (100 buyers × 5 gens × $0.005) |
| 5,000 | Word-of-mouth + LinkedIn posts | **~$75** | AI ~$25/mo at 10% conversion. Bandwidth still trivial thanks to Cloudflare. |
| 10,000 | Modest scale | **~$120** | AI ~$60/mo. You'd be earning ৳200K+ in revenue — net positive easily. |
| 50,000 | Real business | **~$300–400** | AI ~$200/mo at OpenRouter rates. Revenue ~৳833K/month. **70%+ net margin.** |
| 100,000 | Pop-off scale | **~$700–900** | AI ~$500/mo + likely a Supabase storage/egress upgrade ($50–100 add-on). Time to hire someone. |

### Revenue vs cost at the target scale (50K paying users / month)

```
Monthly revenue (50K × ৳200)         ৳10,000,000   ($81,400)
Monthly operating cost                    ~৳43,000     ($350)
   ├─ Vercel Pro                          ৳2,500       ($20)
   ├─ Supabase Pro                        ৳3,000       ($25)
   ├─ AI APIs (capped)                    ৳25,000      ($200)
   ├─ bKash fees (~1.5%)                  ৳15,000      ($120) — proportional
   ├─ Domain                              ৳110         ($0.87)
─────────────────────────────────────────────────────────────────
Net monthly                            ৳9,957,000   ($81,050) — 99.5% margin
```

**The bill barely moves with scale. That's the point of this stack.** Cloudflare + Vercel Pro's flat fee + Supabase Pro's flat fee + OpenRouter's hard cap means your costs are largely fixed regardless of whether you have 1K or 50K users. Revenue scales linearly; cost scales sub-linearly.

### What you DON'T need to buy

- ❌ A separate VPS, EC2, or DigitalOcean droplet
- ❌ A separate CDN provider (Cloudflare free tier suffices)
- ❌ Cloudflare Pro/Business ($20/$200) — DNS + caching + Cache Rules are all on free
- ❌ A separate database host (Supabase is your Postgres)
- ❌ Sentry / Datadog / LogRocket (Vercel + Supabase + Cloudflare built-in dashboards cover free tiers comfortably at this scale)
- ❌ A separate email service (Supabase Auth sends auth emails; for marketing emails you can add Resend or similar later, free tier 3K/mo)
- ❌ A traditional payment gateway (SSLCommerz / ShurjoPay charge 2.5–3% per txn; bKash + your Flutter SMS-watcher is 1.5%)

---

## 13. Quick-reference checklist (print this)

Tape this to your monitor.

- [ ] Bought domain on Cloudflare Registrar
- [ ] 2FA enabled on Cloudflare account
- [ ] Upgraded Vercel to Pro
- [ ] **Spend Management cap set to $30/mo with auto-pause ON**
- [ ] Domain added in Vercel (both apex + www)
- [ ] DNS records in Cloudflare (A + CNAME) — initially grey cloud
- [ ] SSL working on `https://topcandidate.com`
- [ ] Supabase Site URL updated
- [ ] Supabase Redirect URLs added (`https://topcandidate.com/**`)
- [ ] Hardcoded vercel.app URLs grep'd and replaced in code
- [ ] PR merged to master, redeploy succeeded
- [ ] Cloudflare proxy flipped to orange (Section 6)
- [ ] Cloudflare Cache Rule: bypass `/api/*`
- [ ] Cloudflare Cache Rule: cache static assets 30 days
- [ ] `vercel.json` per-route timeouts tightened
- [ ] Smoke test: signup → tailor resume → purchase modal → sign out
- [ ] UptimeRobot monitor added (optional but recommended)

When all boxes are ticked, you are in production. Total spend so far: **~$30 charged to your card** ($10.46 domain + first month of Vercel Pro). Total time: ~1 hour.

---

*Last updated: 2026-05-20. Re-check Vercel/Cloudflare pricing pages before re-running this guide — prices and tier names drift.*
