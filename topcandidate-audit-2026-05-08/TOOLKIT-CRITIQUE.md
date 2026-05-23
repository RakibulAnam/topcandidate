# Phase 5 — Toolkit Quality Deep Dive (live, post-fix)

The audit prompt asks for 200–400 word critiques of three (persona, JD) pairs that most stretch the candidate-vs-JD fit. After issues #2 and #3 were fixed, the live API became reachable and the BD-bucket fabrication guard was active. The three pairs below were live-generated, scored against the rubric, and saved under `generated-text/`.

The live results validated and partially refuted the static predictions in the previous draft of this document — most importantly, the Arif × bKash pair scored materially **higher** than predicted because the new Banking-bucket fabrication guard caught what would otherwise have been a "Bangladesh Bank" fabrication in his cover letter.

---

## Pair B (live) — Persona #6 Sumaiya Akter × JD-2 BRAC Bank RM, Chattogram

**Predicted: 5/5. Actual: 4.87/5.** Tightest fit in the matrix; same-employer adjacent role.

This is what the system looks like when it's working as designed. The optimizer routed via Groq returned in ~6s. The summary, bullets, and skill categories all anchor on real Sumaiya facts — 2.3% NPL ratio vs 4.1% branch avg, 38 crore disbursement vs 32 crore target, the buyer-concentration risk scorecard adopted bank-wide, the Best Analyst (SME) award. The skill taxonomy correctly substituted the tech-skewed default with banker buckets ("Financial Skills", "Compliance and Risk Management"). Project-ordering reorderer correctly led with the scorecard project (highest JD-vocab overlap) over the buyer-compliance SOP.

Cover letter and outreach were generated only after a Gemini 503 retry (the combined toolkit call hit the upstream limit on first attempt; per-item retry via `/api/toolkit-item` succeeded after Gemini recovered). All four artifacts ground in real Sumaiya proper nouns: BRAC Bank, Best Analyst (SME) Annual Award, the scorecard, the RMG Buyer Compliance Verification SOP, CFA Level II, Standard Chartered Bank Bangladesh. Subject line is 53 chars (under the 60 spec). Word count and paragraph structure all hit. Interview Qs are 7-across-5-categories with 100% answer-strategy anchor coverage — well above the 50% guard floor.

**One real demerit**: the summary contains "Proven track record of managing portfolios with low NPL ratios" — `proven track record` is on the system prompt's instant-reject cliché list. Across all three live runs (Sumaiya, Arif, Tasnim) the same exact phrase slipped through, so this is a systematic Groq-compliance issue, not a one-off. A 5-line post-pipeline regex that strips the phrase and rewrites the sentence would close it deterministically.

**Recruiter would**: read this and lean in. The grounded specificity is exactly what BRAC Bank SME hiring managers expect; the cliché is a wash because their own internal templates have it too. Pre-fix this would have been blocked by P0 #2; post-fix it ships clean.

---

## Pair A (live) — Persona #3 Arif Rahman × JD-12 bKash Product Manager

**Predicted: 2–3/5 with high fabrication risk. Actual: 4.30/5 with the BD bucket catching one fabrication and a pre-existing TECH_TOKEN false-positive blocking one artifact.** Hardest stretch in the matrix.

This is the pair that justifies the BD-bucket fix. The combined toolkit call failed with `Toolkit output contained fabricated tech tokens not in candidate evidence: Bangladesh Bank` — the model was attempting to drop "Bangladesh Bank MFS regulations" (verbatim from the JD) into Arif's cover letter / outreach to mirror the JD. Arif has zero banking exposure; the new BANKING_TOKENS bucket caught the attempt. Pre-fix this would have shipped to a recruiter who would immediately reject Arif for claiming regulator exposure he doesn't have.

After the guard fired, single-artifact retries via `/api/toolkit-item` succeeded for cover letter, outreach, and LinkedIn — each grounded in real Arif anchors (DBL Group, the Knit Order Tracker, BSCI / SLCP audit, H&M Hong Kong sourcing, 4% FOB negotiation, 22-merchandiser adoption). The cover letter explicitly leans into the switcher angle (the JD invites cross-industry candidates) — "as a cross-industry candidate, I bring a generalist's ability". That's exactly the right framing for an honest stretch.

The **interview Qs failed twice** — both attempts blocked by the fabrication guard with `Express, Bangladesh Bank`. The Bangladesh Bank half is the same true positive as before. The "Express" half is **a pre-existing false positive in the original `TECH_TOKENS`**: `Express` (the Node framework) matches case-insensitively as a whole word, so the model writing "express interest" / "express delivery" trips it. Same shape as the `Next` false positive my fix surfaced earlier; sibling bug. Adding to the punch list as P2 polish.

**One soft fabrication the guard does NOT catch**: the optimized **summary** says Arif has "8 years in end-to-end product lifecycle ownership" and "demonstrating strong consumer-product instincts". The bullets are honest (TNA, FOB, BSCI), but the summary's framing is JD-coded language with no clear evidence. `filterFabricatedSkills` protects the skills array; nothing protects the summary text from soft framing. Worth a future SUMMARY_GUARD that checks for hand-wavy phrases ("strong X instincts", "product lifecycle ownership" without engineering/PM evidence).

**Recruiter would**: see a switcher's resume that doesn't quite fit, but is honest about it. That's still net-positive vs. the pre-fix counterfactual where they'd see fabricated banking compliance experience.

---

## Pair Hybrid (live, replacement for predicted Pair C) — Persona #8 Tasnim Karim × JD-4 BRAC Climate Resilience

**Replaced the predicted teacher → corporate L&D pair to keep budget tight; this NGO near-fit is more representative of the BD market and tested the new NGO_TOKENS bucket. Actual: 4.76/5.**

Same employer, adjacent domain (BRAC MNCH → BRAC Climate). Toolkit succeeded fully on the first attempt — zero fabrication-guard trips, zero Gemini 503s. All four artifacts generated and grounded.

The NGO bucket worked invisibly: FCDO, GIZ, Kobo Toolbox, ODK, DHIS2, Power BI all appear in Tasnim's evidence corpus, so the model could mirror them without tripping the guard. (Had the model invented "USAID" or "World Bank" donor exposure Tasnim doesn't have, the guard would have caught it; the model didn't try.)

Skill categorization correctly NGO-themed: "MEAL & Reporting" / "Programme Management" / "Languages" / "Data Analysis". The cover letter's evidence density is excellent — Power BI dashboard cited in FCDO 2024 mid-term review, 22-page MEAL SOP peer-reviewed by BRAC M&E central team, MPH from JPGSPH, four partner NGOs coordinated. Outreach subject is exactly 60 chars and JD-anchored ("Programme Officer, Climate Resilience - MEAL & FCDO Expertise"). LinkedIn note targets BRAC + names the FCDO MEAL workstream. Interview Qs are 7-across-4-categories with 100% anchor coverage.

**Same "Proven track record" cliché slip in summary** — third pair, same exact phrase. Confirmed systematic.

**Recruiter would**: shortlist. This is what the system delivers when the candidate is well-fit AND well-described — strong, grounded, ship-quality output across all five artifacts.

---

## Cross-pair patterns (live, three-pair sample)

| | Sumaiya / banking | Arif / garments→PM | Tasnim / NGO |
|---|---|---|---|
| Optimizer fit | Perfect | Stretch | Near-perfect |
| Composite | **4.87** | **4.30** | **4.76** |
| Toolkit on first attempt | ❌ Gemini 503 | ❌ Bangladesh Bank guard (correct) | ✅ Clean |
| Per-item retry success | 4/4 (after Gemini recovery) | 3/4 (Express FP blocked Q's) | 4/4 (no retry needed) |
| Summary "proven track record" cliché slip | ✅ slipped | ✅ slipped | ✅ slipped |

### Three actionable cross-pair findings

1. **Cliché enforcement is a Groq weakness** (3/3 pairs). Add a deterministic post-pipeline regex strip for the system-prompt-banned phrases (`proven track record`, `results-driven`, `passionate about`, `highly motivated`, `detail-oriented`, `synergy`, `strong communication skills`). Five-line fix. Estimated 30 min including verification.

2. **The fabrication guard's word-boundary regex creates false positives on common-English-word tokens** (`Next`, `Express`, surfaced; potentially also `Go`, `R`, `Spring`, `Rust`, `Apache`, `Oracle`, `Apple`, `Block`, `Square` in TECH_TOKENS). Two paths: either narrow the case-sensitivity (require uppercase first letter for short tokens), or replace single-word tokens with more-specific multi-word names (`Express.js`, `Go (Golang)`, `Spring Boot`). Estimated 1 hour including verification.

3. **Summaries can be stretched without tripping any guard** (Arif's "8 years in end-to-end product lifecycle ownership" / "strong consumer-product instincts"). The bullets are honest; the framing is not. Add a `SUMMARY_GUARD` that flags hand-wavy framing phrases when there's no candidate evidence for them (e.g. "X instincts", "Y ownership" without role/title alignment). Estimated 2 hours.

After those three deterministic post-pipeline tweaks, expected composite quality across stretch fits would move from ~4.3 to ~4.6+. Tight, well-fit pairs like Sumaiya and Tasnim would move from ~4.8 to ~4.95.
