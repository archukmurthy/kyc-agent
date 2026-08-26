# Refactor Smoke Checklist (Phase 0 safety net)

Run after EVERY extraction phase of the modular-architecture refactor.
All checks run locally under `npm start` with **Demo mode ON** (toggle on the
journey screen, or open `http://localhost:3000/?demo=true`) so no API credits
are spent. "Dummy Research" on Step 0 is the test-tools equivalent.

Setup: `npm start` → open `http://localhost:3000/?demo=true`

| # | Check | Steps | Pass criteria |
|---|-------|-------|---------------|
| 1 | Research returns results for a UK Corporate company | Onboarding agent → Company name "Acme Holdings", Country United Kingdom, Entity Corporate, ownership Private Limited → pick AI-only journey (demo mode) → Start | Research completes; Applicant step reached; no error banner |
| 2 | Applicant page shows the director/UBO dropdown | After check 1 | "Select who you are" person selector lists the demo directors (John Smith, Jane Doe, Mark Lee) |
| 3 | Confirm page shows People Found cards | Continue from Applicant | People/stakeholder cards render for directors/UBOs (not a raw JSON blob) |
| 4 | Fill Gaps has no applicant section | Continue to Fill Gaps | No "applicant" section heading among the gap sections (applicant fields live on the earlier Applicant page); stakeholder section IS present |
| 5 | Required Docs shows a document checklist | Continue to Required Docs step | Checklist of required documents renders, not empty |
| 6 | Invite-link path works end to end | Pre-boarding agent (password ARCH) → run demo research → Save dossier → copy invite link (`?dossierId=…&journey=customer`) → open it in a fresh tab | Lands on Applicant page with fields populated; Required Docs step shows documents (not empty) |

Baseline run 2026-07-20 (pre-refactor): all 6 checks PASS. Reusable local demo
dossier for check 6:
`http://localhost:3000/?tenant=demo&dossierId=3398b56a-4b23-499c-b566-dad8481a27a9&journey=customer`
(dev filesystem store; regenerate via the pre-boarding flow if missing).

Also after every commit: `npm run build` must succeed with no new warnings-as-errors.

Automated slice: `npx react-scripts test --watchAll=false` runs the
characterization tests in `src/__tests__/` (landing page mounts + extracted
pure modules keep their pre-refactor outputs).
