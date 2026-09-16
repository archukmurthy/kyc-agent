# Preboarding subsystem audit — 2026-09-13

Three parallel read-only investigations (flow map, backend persistence, adversarial hunt).

## How it works
Analyst opens `?preboarding=1` → client-side password gate (a hardcoded `PREBOARDING_PASSWORD` literal, App.js:287 — value redacted; the password now comes from the server-side `PREBOARDING_PASSWORD` environment variable) → researches a company (shared CompanyLookupPage) → dossier auto-saves to `entity_dossiers` ~500ms after research at the confirm step (App.js:957-985) → reviews in DossierView → sends an invite → customer opens link → onboarding pre-filled.

Persistence verdict: analyst in-progress work IS covered (the localStorage draft+resume we built fires for preboarding too, plus DB autosave). NOT the old no-draft hole. But real bugs remain.

## Ranked findings

### 🔴 P1-a — Emailed invite link is the DEAD `?ref` link, not the working dossier link
`api/invite.js:40,70` mints its own token and embeds `${origin}/?ref=${token}` in the email; never receives/uses `dossierId`. The client shows a working `?dossierId=…&tenant=…&journey=customer` link on screen (InviteScreen.jsx:56-58) but POSTs to /api/invite WITHOUT it. `?ref` only hydrates from the ANALYST's own localStorage (`nium_invite_<token>`, App.js:1004) — customer on another device gets a blank form. Fix: send the dossier link/dossierId to /api/invite; server embeds THAT link + stores dossierId on the record; retire the emailed `?ref`.

### 🔴 P1-b — Silent dossier save failure (same disease as old submit)
`api/save-dossier.js:56-59,204-207` returns HTTP 200 even on failure (`{success:false,dossierId:null,warning}`). Client `saveDossier()` (App.js:4648-4665) only console.warns and still `setShowDossierView(true)` — no error surfaced. dossierId stays null → invite silently degrades to the dead `?ref`. DB blip after paid research = lost dossier, no signal. Fix: surface failure + retry; block "Send invite" when dossierId is null (a dead link must never go out).

### 🟠 P2 — get-dossier unauthenticated PII read
`api/get-dossier.js` has NO auth — only tenant match + a random UUID. Dossier URL is an unexpiring/unrevocable bearer link to full stakeholder PII (names/DOB/nationality/PEP). Fix: server-side auth and/or signed+expiring dossier tokens.

### 🟠 P2 — Preboarding password is client-side only + APIs unauthenticated
Password (value redacted) hardcoded in the bundle, checked in-browser (PreboardingGate.jsx:36). save/get/search-attempt APIs require no auth; save-dossier even creates arbitrary tenant rows on demand. Gates the screen, not the data. Fix: real server-side gate on preboarding APIs.

### 🟡 P3 — Resume strands analyst on wrong view
`showDossierView` not persisted in the draft; after resume the analyst lands on the customer Confirm step with no path back to DossierView (data safe in DB). Fix: persist or re-derive `showDossierView` (agentType===preboarding && dossierId && step===confirm).

### 🟡 P3 — smaller
- `selfSourceResults`/manual uploads lost on localStorage resume (App.js:810-837 omits it; DB-load path restores it, localStorage path doesn't).
- `api/search-attempt.js:38-52` not tenant-scoped (cross-tenant counter read/increment given a UUID).
- First-save duplicate race: `saveDossier` has no in-flight guard; two INSERTs before dossierId is set create duplicate rows (upsert only engages once dossierId exists). Narrow.
- Dead code: PreboardingGate "back to agent selection" button; duplicate `?preboarding` param parsing; `nium_invite_` snapshots never cleaned up.

## Plan
- Phase 1 (customer-facing breakage): P1-a (send working link) + P1-b (surface save failure, gate invite on saved dossier).
- Phase 2 (security, needs product decisions): get-dossier auth + real preboarding gate + signed/expiring tokens + tenant-scope search-attempt.
- Phase 3 (polish): resume view, selfSourceResults, first-save idempotency, dead-code cleanup.
