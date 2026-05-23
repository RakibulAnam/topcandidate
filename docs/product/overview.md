# Product overview

**TopCandidate** is a career toolkit. The customer pastes a job description; AI generates a complete, role-tailored application package (resume, cover letter, outreach email, LinkedIn note, interview prep).

Payment for premium credits flows through bKash, a Bangladeshi mobile money service. Because integrating the bKash commercial gateway is not viable for this stage, the system uses a manual-pay + companion-app confirmation model: the operator's Android phone reads bKash SMS and confirms purchases via webhook.

For the full product surface and feature status, read [`apps/web/AGENTS.md`](../../apps/web/AGENTS.md) §3. For the payment flow, read [`docs/contracts/webhook-confirm-purchase.md`](../contracts/webhook-confirm-purchase.md).

## Audience

- **Primary users:** job seekers in Bangladesh and the broader region, willing to pay in BDT via bKash for AI-generated application materials.
- **Single operator:** owns the bKash receiving number and the Android phone running the watcher app.

## Out-of-scope (for now)

- Mock-interview marketplace (planned, not started).
- iOS for the watcher (Android-only by design — operator's phone is Android).
- Multi-operator / multi-phone payment confirmation.
- Real bKash gateway integration (manual-pay model is intentional).
