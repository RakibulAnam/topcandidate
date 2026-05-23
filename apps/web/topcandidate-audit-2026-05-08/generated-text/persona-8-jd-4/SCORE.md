# Tasnim Karim / JD-4 BRAC Climate Resilience — Live Score (NGO near-fit)

Same-employer, adjacent-domain transition (BRAC MNCH → BRAC Climate). Tests the new NGO bucket and a non-banking, non-tech, non-garments domain. Toolkit succeeded fully on the first attempt — zero fabrication-guard trips, zero Gemini 503s.

## Operational

- Optimizer + toolkit total: 37s.
- All 4 toolkit artifacts generated cleanly.
- No retries needed.

## Resume scoring

| Criterion | Score | Notes |
|---|---|---|
| a. JD keyword mirroring | 5/5 | Output mirrors exactly: "MEAL", "Kobo Toolbox", "ODK", "DHIS2", "Power BI", "FCDO", "log frame", "theory of change", "donor reporting", "partner NGOs". JD casing preserved. |
| b. Bullet quality | 5/5 | Strong verbs throughout: Designed, Managed, Built, Coordinated, Achieved, Developed, Supported, Tracked, Implemented, Created. No banned starts. |
| c. Summary differentiation | 3/5 | **Same cliché slip — "Proven track record"** (3rd persona where this fires; clear systematic issue with Groq enforcement of the system prompt's banned-cliché list). Otherwise solid: leads with role + tenure + JD-aligned focus areas. |
| d. Skill categorization | 5/5 | NGO-domain buckets: "MEAL & Reporting" / "Programme Management" / "Languages" / "Data Analysis". Substituted from the tech-skewed taxonomy correctly. |
| e. Project / experience ordering | 5/5 | proj-1 (Kobo + DHIS2 → Power BI dashboard) leads — high JD-vocab overlap. proj-2 (MEAL SOP) second. |
| f. Bullet density | 4/5 | exp-1 (5 bullets, rich) > exp-2 (2 bullets, thin) — density-trim engaged correctly. |
| g. Honesty (zero fabrication) | 5/5 | All metrics traceable: GBP 4.2M, 4 partner NGOs, 94% institutional delivery, 81% baseline, 11 upazilas, 9 indicators, 22-page document. No fabrication. |
| **Resume avg** | **4.6/5** | |

## Cover letter scoring

| Criterion | Score | Notes |
|---|---|---|
| h. Hook specificity | 5/5 | Opens with current role + FCDO grant + MEAL workstreams — concrete, not template. |
| i. Evidence density | 5/5 | Cites Power BI dashboard (Kobo+DHIS2, 11 upazilas, daily refresh), FCDO 2024 mid-term review citation, 22-page MEAL SOP, 4 partner NGOs, MPH from JPGSPH. |
| j. Tone calibration | 5/5 | NGO/development idiom: "donor accountability", "MEAL workstreams", "community-based adaptation", "data quality assurance". Not Silicon Valley. |
| k. No clichés / no fabrication | 4/5 | "I am eager to apply" — mild boilerplate; "extending my commitment to BRAC's mission" — acceptable closing. No fabrication. |
| **Cover letter avg** | **4.75/5** | |

## Outreach email scoring

| Criterion | Score | Notes |
|---|---|---|
| l. Subject line | 5/5 | "Programme Officer, Climate Resilience - MEAL & FCDO Expertise" — 60 chars, role-specific, two anchors (MEAL + FCDO). |
| m. Body grounded | 5/5 | BRAC (target) + FCDO + MEAL + Kobo Toolbox + ODK + Power BI + DHIS2 dashboard + FCDO mid-term review citation. Multiple anchors. |
| n. Soft specific ask | 5/5 | "Would a 15-minute chat next week be useful to discuss how my MEAL and FCDO reporting experience could support your team at BRAC in the Climate Resilience programme?" — specific to JD programme name. |
| o. 110–170 words, 3 paragraphs | 5/5 | ~135 words, 3 paragraphs. |
| **Outreach avg** | **5/5** | |

## LinkedIn note scoring

| Criterion | Score | Notes |
|---|---|---|
| p. ≤ 280 chars | 5/5 | 246 chars. |
| q. References target + anchor | 5/5 | "BRAC" (target, also current employer — mild ambiguity but acceptable) + "FCDO-funded MEAL workstreams" (anchor). |
| r. Not generic | 4/5 | "Would love to learn how your team approaches community-based adaptation project design." Specific but uses the soft "would love to learn" frame — acceptable. |
| **LinkedIn avg** | **4.7/5** | |

## Interview questions (7 questions)

| Criterion | Score | Notes |
|---|---|---|
| s. 6–8 across ≥3 categories | 4/5 | 7 Qs across 4 categories: Role-specific (3), Technical (1), Behavioral (2), Situational (1). Slightly category-thin (no Values & Culture), but the 4 represented are JD-relevant. |
| t. JD-specific | 5/5 | Every Q references MEAL framework, Power BI dashboard, FCDO reporting, climate adaptation, or specific programme management responsibilities. None are generic. |
| u. answerStrategy NAMES anchors | 5/5 | All 7 answer strategies name "MEAL SOP for Cluster-Lead-Approach Pilot", "Kobo + DHIS2 → Power BI Dashboard", "BRAC", "FCDO grant manager", or "BRAC M&E central team". 100% anchor coverage. |
| v. No fabricated tools | 5/5 | All tools/donors cited are in evidence. |
| **Interview Qs avg** | **4.75/5** | |

## Pair total

**Composite avg: 4.76 / 5.** Strong, ship-quality output. The NGO bucket fix did its job invisibly (no false-positive trips, no fabrications attempted). The system handles the NGO domain natively given evidence-rich input.

## Cross-pair pattern (3 personas grade together)

| | Sumaiya / banking | Arif / garments→PM | Tasnim / NGO |
|---|---|---|---|
| Optimizer fit | Perfect | Stretch | Near-perfect |
| Composite | 4.87 | 4.30 | 4.76 |
| Toolkit on first attempt | ❌ Gemini 503 | ❌ "Bangladesh Bank" guard fired (correct) | ✅ Clean |
| Per-item retry success | 3/4, then 4/4 | 3/4, blocked by Express FP | 4/4 |
| **Summary cliché ("proven track record") slipped through** | YES | YES | YES |

The "proven track record" pattern across all three personas is the single most actionable cross-pair finding — Groq's compliance with the banned-cliché list in the system prompt is unreliable. A 5-line post-pipeline regex strip of that exact phrase (and a few siblings: "results-driven", "passionate about", "highly motivated") would close the gap deterministically.
