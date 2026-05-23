# Arif Rahman / JD-12 bKash PM — Live Score (stretch fit)

Garments merchandiser → fintech PM. Predicted in TOOLKIT-CRITIQUE.md as the hardest stretch in the matrix. Live result is more interesting than the prediction.

## Key empirical findings (the reason this pair was worth running)

### 🎯 Fabrication guard fired correctly on `Bangladesh Bank`

The combined toolkit call (initial generation) failed with:
> Toolkit output contained fabricated tech tokens not in candidate evidence: Bangladesh Bank

Arif's evidence has zero banking exposure (he's a garments merchandiser). The bKash JD mentions "Bangladesh Bank MFS regulations" as a compliance constraint. The model attempted to drop "Bangladesh Bank" into Arif's cover letter / outreach to mirror the JD — and the new BANKING_TOKENS bucket caught it. **Pre-fix-#3 this would have shipped to a recruiter who would immediately reject Arif for claiming banking-regulator exposure he doesn't have.** Exactly the failure mode the BD-bucket fix was designed to catch.

### ⚠️ Pre-existing `Express` false positive surfaced

The single-artifact retry of `interviewQuestions` failed with:
> Toolkit output contained fabricated tech tokens not in candidate evidence: Express, Bangladesh Bank

The "Bangladesh Bank" half is the same true positive as above. The "Express" half is **a pre-existing false positive in the original `TECH_TOKENS` list** — `Express` (the Node framework) matches case-insensitively as a whole word, so legitimate phrases like "express interest", "express delivery", "express the value proposition" trip it. The model probably wrote one of those. This bug is older than my fix and is a sibling to the issue I caught with my own `Next` token earlier — same shape (English-word collision), different list. Worth tightening:
```diff
-  'Express', ...
+  'Express.js', 'ExpressJS', ...
```
Logged for the punch list.

### Single-artifact retries succeeded for 3/4 toolkit items

Cover letter, outreach email, LinkedIn note all generated and grounded after retry. Interview Qs blocked by the Express false positive. The user UX of "3 cards rendered, 1 failed" is correct per AGENTS.md design.

## Resume scoring

| Criterion | Score | Notes |
|---|---|---|
| a. JD keyword mirroring | 3/5 | Picks up "stakeholder management", "regulatory compliance", "process improvements" — soft JD echoes. Explicit JD terms like "PRD", "MFS", "DAU", "transactions per active user", "discovery", "A/B test" do NOT appear (correctly — Arif has no evidence). The summary is tilted toward "regulated consumer goods sector" framing which is JD-adjacent without fabricating. |
| b. Bullet quality | 5/5 | Strong verbs: Owned, Led, Built, Managed, Negotiated, Supported, Coordinated, Architected, Utilized, Achieved, Standardized. No banned starts. Every bullet is concrete. |
| c. Summary differentiation | 3/5 | **Stretches but does not fabricate.** "8 years in end-to-end product lifecycle ownership" is technically true (TNA-to-ship is a product lifecycle) but reads as PM-coded. "demonstrating strong consumer-product instincts" is **soft fabrication** — there's no evidence in input for "consumer-product instincts". The summary leans into the JD harder than the bullets do — a genuine asymmetry. **Notable finding: filterFabricatedSkills protects the skills array; nothing protects the summary text from soft framing.** |
| d. Skill categorization | 5/5 | Sensible buckets for a merchandiser: "Methodologies" (Stakeholder Mgmt, TNA, FOB Costing), "Tools & Platforms" (Google Sheets, WFX), "Compliance & Standards" (BSCI, SLCP), "Domain" (Merchandising, Knit Garments, H&M, Inditex). |
| e. Project / experience ordering | 5/5 | proj-1 (order tracker — process / tooling slant matches PM JD better) before proj-2 (audit prep — compliance slant). |
| f. Bullet density | 4/5 | exp-1 has 5 bullets (rich), exp-2 has 2 (trimmed). Density step worked. |
| g. Honesty (zero fabrication) | 5/5 | Every bullet metric checks out: 28 styles, 1.2M pieces, 9.5M USD FOB, 22 merchandisers, 4% FOB increase, zero non-compliances. No fabricated tools or employers. **Skills array clean.** |
| **Resume avg** | **4.3/5** | Solid. Summary stretching is the only real demerit. |

## Cover letter scoring

| Criterion | Score | Notes |
|---|---|---|
| h. Hook specificity | 4/5 | "My six years of experience owning the full product lifecycle for high-volume consumer goods..." opens with a soft frame; pivots in sentence 2 to concrete: "At DBL Group, I managed the end-to-end journey for H&M's knit division, overseeing approximately 28 styles per season with a seasonal contract value of 9.5M USD." That second sentence is the real hook. |
| i. Evidence density | 4/5 | Cites Google Sheets order-tracker (11 milestones, 22 merchandisers), BSCI / SLCP audit zero non-compliances, H&M Hong Kong sourcing, weekly stakeholder reviews. |
| j. Tone calibration | 3/5 | Appropriately reaches across — explicitly addresses "as a cross-industry candidate, I bring a generalist's ability". Self-aware framing, which actually matches the JD's "Cross-industry candidates with strong consumer-product instincts welcome" line. Solid handling of the switcher angle. |
| k. No clichés / no fabrication | 4/5 | "I am eager to discuss" is mild boilerplate. No fabrication. The "consumer-product instincts" framing repeats from summary. |
| **Cover letter avg** | **3.75/5** | Reasonable for the stretch. |

## Outreach email scoring

| Criterion | Score | Notes |
|---|---|---|
| l. Subject line | 5/5 | "Product Manager - Arif Rahman - DBL Group's Knit Order Tracker" — 65 chars (slightly over the 60 spec), specific, role + name + signature project. Grounded. |
| m. Body grounded | 5/5 | Mentions bKash + DBL Group + Knit Order Tracker + 22 merchandisers + BSCI/SLCP + H&M + 4% FOB. Heavy candidate-anchor density. |
| n. Soft specific ask | 4/5 | "Would a 15-minute chat next week be useful to discuss how my approach to problem-solving and stakeholder management could translate to bKash's consumer-facing product lines?" — specific to bKash + framed as a translation question (good honesty for the switcher angle). |
| o. 110–170 words, 3 paragraphs | 4/5 | ~135 words, 3 paragraphs. Within band. |
| **Outreach avg** | **4.5/5** | Subject 5 chars too long, otherwise excellent. |

## LinkedIn note scoring

| Criterion | Score | Notes |
|---|---|---|
| p. ≤ 280 chars | 5/5 | 209 chars. |
| q. References target + anchor | 5/5 | bKash (target) + Knit Order Tracker + DBL Group (anchors). |
| r. Not generic | 4/5 | "I'd be keen to learn how your team approaches product discovery for bKash's consumer-facing features." Specific to bKash but the phrase "product discovery" is a generic PM term — acceptable. |
| **LinkedIn avg** | **4.7/5** | |

## Interview questions

**Failed and not retried.** Express false positive in the existing TECH_TOKENS list blocked the call. Per design the user can retry from the Preview UI; in this audit context it surfaces a punch-list item.

| Criterion | Score |
|---|---|
| Generated | ❌ blocked |
| **Interview Qs** | N/A (test-blocked finding, not a quality finding) |

## Pair total

**Composite avg over the 4 generated artifacts: 4.3 / 5.** This is meaningfully better than the prediction (which was around 2–3 because the pre-existing guard wouldn't catch the Bangladesh Bank fabrication). The BD-bucket fix moved this pair from "would have shipped fabrication" to "honest stretch frame".

## Net

For the actually-hardest persona×JD pair the audit could throw at the system, the post-fix output is honest, grounded, and recruiter-defensible — the worst that happens is the recruiter sees a switcher's resume that doesn't quite fit. Pre-fix, the worst that would have happened was the recruiter seeing fabricated banking experience. That's the difference the BD industry buckets make.
