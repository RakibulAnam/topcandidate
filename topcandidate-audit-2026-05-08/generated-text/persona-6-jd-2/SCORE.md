# Sumaiya Akter / JD-2 BRAC Bank RM — Live Score (post-fix)

Generated 2026-05-08, post-fix-#2 and post-fix-#3. Optimizer routed via Groq llama-3.3-70b. Toolkit via Gemini 2.5 Flash (after one Gemini 503 retry).

## Resume

| Criterion | Score | Notes |
|---|---|---|
| a. JD keyword mirroring | 5/5 | Output mirrors "CMSME", "credit memo", "financial spreading", "IFRS 9 ECL staging", "factory site visits", "buyer-supplier due diligence", "CIB and AML/KYC compliance", "RMG", "trade finance" — all exact JD casing. |
| b. Bullet quality | 5/5 | Strong verbs only: Owned, Conducted, Built, Approved, Acquired, Prepared, Predicted, Designed, Documented, Developed. No banned starts. |
| c. Summary differentiation | 3/5 | **Cliché slipped through**: "Proven track record of managing portfolios..." — `proven track record` is on the system prompt's instant-reject list (line 72). Groq is not perfectly enforcing it. |
| d. Skill categorization | 5/5 | Banker-appropriate buckets: "Financial Skills" / "Compliance and Risk Management" / "Tools and Technologies" / "Languages". Substituted from the tech-skewed taxonomy correctly. |
| e. Project / experience ordering | 5/5 | proj-1 (scorecard) leads, proj-2 (buyer compliance SOP) second — JD-fit reordering correct. |
| f. Bullet density | 4/5 | exp-1 has 4 bullets, exp-2 has 2 — density-trim worked. Both projects got 2 each (low item count, density step is a no-op). |
| g. Honesty (zero fabrication) | 5/5 | Every metric is in input: 2.3% NPL, 4.1% branch avg, 38 crore disbursement, 14 borrowers flagged, 4.2 crore expected losses, 5 RMs adopted SOP. No fabricated tools. |
| **Resume avg** | **4.6/5** | One real cliché slip. |

## Cover letter

| Criterion | Score | Notes |
|---|---|---|
| h. Hook specificity | 5/5 | Opens with role + 2.3% NPL achievement + bank-wide-adopted scorecard. No "I am writing to express interest" template. |
| i. Evidence density | 5/5 | Each paragraph cites real candidate items: NPL ratio, financial spreading + IFRS 9 ECL + CIB/AML, scorecard + 4.2 crore + Best Analyst award, RMG Buyer Compliance SOP, CFA Level II. |
| j. Tone calibration | 5/5 | Banker idiom: "credit memo processes", "facility structures", "Bangladesh Bank guidelines". Not Silicon Valley. |
| k. No clichés / no fabrication | 4/5 | "demonstrating my ability to acquire and grow SME clients" is borderline; "I am eager to discuss" is borderline. Neither on the banned list, but mildly soft. |
| **Cover letter avg** | **4.75/5** | |

## Outreach email

| Criterion | Score | Notes |
|---|---|---|
| l. Subject line | 5/5 | "SME RM: BRAC Bank Best Analyst (SME) & CFA Level II" — 53 chars, role-specific, 2 candidate anchors. |
| m. Body grounded | 5/5 | Mentions BRAC Bank + Best Analyst award + scorecard + 4.2 crore + 2.3% NPL + IFRS 9 ECL + financial spreading. |
| n. Soft specific ask | 5/5 | "Would a 15-minute chat next week be useful to discuss how my experience can benefit BRAC Bank's Chattogram SME unit?" — specific to JD location + unit. |
| o. 110–170 words, 3 paragraphs | 5/5 | Exactly 110 words, exactly 3 paragraphs. |
| **Outreach avg** | **5/5** | |

## LinkedIn note

| Criterion | Score | Notes |
|---|---|---|
| p. ≤ 280 chars | 5/5 | 266 chars. |
| q. References target + anchor | 5/5 | "BRAC Bank" (target) + "Buyer-Concentration Risk Scorecard" + "4.2 crore taka" (anchors). |
| r. Not generic | 5/5 | Specific ask referencing "Chattogram" SME acquisition strategy. No "hope this finds you well". |
| **LinkedIn avg** | **5/5** | |

## Interview questions (7 questions)

| Criterion | Score | Notes |
|---|---|---|
| s. 6–8 across ≥3 categories | 5/5 | 7 Qs across 5 categories: Role-specific (2), Behavioral (1), Technical (2), Values & Culture (1), Situational (1). |
| t. JD-specific | 5/5 | Every Q references "Chattogram", "RM role", "RMG accessory", "ship-breaking allied", "NPL ratio target", or specific JD requirements. None are generic prep-sheet. |
| u. answerStrategy NAMES anchors | 5/5 | All 7 answer strategies name "BRAC Bank Limited", "Standard Chartered Bank Bangladesh", "Buyer-Concentration Risk Scorecard", "RMG Buyer Compliance Verification SOP", or "CFA Level II". 100% anchor coverage — well above the 50% guard floor. |
| v. No fabricated tools | 5/5 | Every tool/employer cited is in evidence. |
| **Interview Qs avg** | **5/5** | |

## Pair total

**Composite avg: 4.87 / 5.** This is a STRONG, ship-quality output for the system's named happy-path persona. The only real demerit is a banned cliché ("proven track record") that Groq's lower temperature didn't catch — worth either a runtime regex post-filter to strip it or a prompt tweak emphasising it.

## Operational observations during this run

- Optimizer (Groq) returned in ~5–8s; toolkit (Gemini) failed first attempt with 503 UNAVAILABLE; the in-flight `withRetry` exhausted; per-item retries via `/api/toolkit-item` succeeded after Gemini recovered.
- Credit balance: 9999 → 9998 (kept on toolkit failure, as designed).
- Per-item retries did NOT consume additional credit (correct).
- The fabrication guard's first false-positive (the `Next` token in `GARMENTS_TOKENS`) was caught and removed in-flight; outreach email then succeeded.
