# IDV Discrepancy Bands + Evidence Architecture — Demo Runbook

A **follow‑these‑exact‑steps** guide to demo everything built so far. Assumes no
knowledge of the implementation. Where something can't be shown in the app, it
gives the DB/script route instead.

- **Environment:** local — `npm start` on `http://localhost:3000`, using `.env.local`.
- **Run all commands in:** `E:\kyc-agent-dev` (PowerShell).
- **The feature is behind an OFF switch** — you turn it on for the demo (Section 1).
- **Nothing here changes live behaviour until the flag is on.**
- **Placeholders:** `ATTEMPT_ID` and `MEDIA_ID` mean "paste the real id here" — **no angle brackets** (`<…>` breaks in PowerShell). The seed script prints the exact `inspect.js` command with the real id already filled in — just copy that.

---

## 0. What can I demo today?

**Demoable directly in the app (flag ON):**
- The applicant journey: progressive disclosure → "who is completing" → pick a director → inline **Didit** QR → verification → **band result** → (Band B) one‑round dialogue → **confirm + dynamic extra‑ID fields** → **Band C** letter‑of‑authorization path → **unlisted verify‑only**.
- **Screening runs live now** (PEP/sanctions/adverse‑media): the app screens the verified identity during the journey on both the **listed** (matched director) and **unlisted** (verify‑only) paths. A hit routes the applicant to review on screen. To force an on‑screen hit for the demo, set `SCREENING_DEMO_FORCE_HIT=1` (Section 6).
- Flag OFF vs ON behaviour (the journey reverts exactly to today when OFF).

**Demoable through the DB / a script (not in the app UI):**
- The **Vault** (encrypted identity), the **reference** on the attempt, **immutable events**, **access audit**, **document media** (encrypted), **evidence outbox**, **lifecycle**, **screening result**, band decisions. → use **`inspect.js`** (Section 7b — fastest), or show it visually in the **Neon console** after the one‑time setup in Section 7c.
- Seeing a **stored document image as a picture** → `image-roundtrip.js` (Section 8).

**Demoable only through isolated scripts/tests:**
- **Band A / B / C outcomes on demand** → `band-outcomes.js` (the live Didit sandbox can't force these reliably — see Section 4).
- **Each screening category shown side‑by‑side** (PEP vs sanctions vs adverse‑media) → `screening-fixture.js` (offline, deterministic — Section 6a). The *live* flow screens for real but ComplyCube's sandbox won't let you pick *which* category hits, so use the fixture to show each one distinctly.

**Built but NOT wired / NOT demoable in the live flow (by design):**
- **No reviewer/admin page** — the "reviewer reveal" is shown via `inspect.js --reveal` (Section 7), not a UI. **The applicant never sees which screening category hit** — a hit shows the neutral "we're completing our checks" copy; the PEP/sanctions/adverse‑media detail is visible only in the DB (`idv_screening_checks.categories`, Section 7).
- Real **Didit document‑image capture** only runs on a real webhook and needs its field names confirmed (BACKLOG **BANDS‑2**) — demo the media store with the seed instead (Sections 7–8).
- **No‑officer‑match (Band C) identities are not auto‑screened** — they escalate to a human reviewer instead (tracked as **SCR‑6**, pending compliance sign‑off).

---

## 1. Turn the feature ON (the flag)

The whole feature is gated by one setting.

**Where:** `E:\kyc-agent-dev\.env.local`
**How to turn ON:** add (or change) this line:
```
IDV_DISCREPANCY_BANDS_ENABLED=1
```
**How to turn OFF:** set it to `0` (or delete the line).

**Important:** `.env.local` is only read at server start. After changing it you MUST restart the dev server:
1. Stop `npm start` (Ctrl+C in its terminal).
2. Start it again: `npm start`.

**Verify which state you're in** (run in `E:\kyc-agent-dev`):
```
curl http://localhost:3000/api/idv-match/flags
```
- `{"idvDiscrepancyBands":true}` → ON.  `false` → OFF.

**What changes when ON:** the applicant page uses the new flow (director → Didit → band result; the manual "Signatory ID" upload is hidden).
**What changes when OFF:** the applicant page behaves exactly as before (Signatory‑ID upload + manual Continue). Nothing IDV‑bands runs.

---

## 2. The mental model — three stores (say this during the demo)

| Data | Stored where | How it's read |
|---|---|---|
| **Sensitive identity text** (name, DOB, doc number, gender, address…) | **The Vault** — encrypted, in the **Neon `idv` database** (`idv_vault_*`) | authorized, audited, decrypt‑on‑read |
| **Non‑PII** (band decisions, events, lifecycle, outcomes, references) | **Ordinary `idv` DB tables** | plain query |
| **Document images** | **Encrypted media store** — ciphertext in **Vercel Blob** + a metadata row (`idv_document_media`) | authorized + audited, decrypt‑on‑read |

The **Vault is ours, on Neon** (not Didit's). Didit is the provider; we hold only the *extracted* identity, encrypted. Our ordinary tables hold only an **opaque reference** to the Vault — never plaintext.

---

## 3. Start the app

In `E:\kyc-agent-dev`:
```
npm start
```
Open `http://localhost:3000`. (Make sure the flag is ON — Section 1.)

---

## 4. FLOW — Live applicant journey (Band C / different person, in the app)

This is the one band the **live Didit sandbox** shows reliably (the verified person won't match a director you pick, so it lands on Band C). For A and B on demand, use Section 5.

**Steps:**
1. On the start screen, enter a **UK company** name + country, and run **Research**. (Real Companies House lookup finds the company's directors.)
2. Walk the wizard to the **Applicant** page.
3. **Progressive disclosure:** only the **"Who is completing this application?"** selector is shown first.
   - *Behind the scenes:* the flag is on, so the applicant fields stay hidden until a person is chosen.
4. Pick a **director** from the dropdown (a listed officer).
   - *Behind the scenes:* the selected officer is frozen as a snapshot for comparison.
5. The **Didit verification** box appears with a **QR code + link**. Open the link / scan the QR and **complete Didit's sandbox verification screens**, then come back.
   - *Behind the scenes:* clicking Start called `POST /api/idv-match/session` → created a server‑side **attempt** bound to the officer + a Didit session.
6. Click **"I've completed verification."**
   - *Behind the scenes:* `GET /api/idv-match/status` → when verified, `POST /api/idv-match/resolve` re‑pulls the Didit decision, maps it, **stores the identity in the Vault**, compares it to the officer, and decides the band.
7. Because the verified person ≠ the chosen director, you'll see **Band C copy**: *"We couldn't confirm your details against the company's registered officers"* + **Provide letter of authorization**.
   - *Behind the scenes:* Band C recorded `demoted_to_loa_path`, set the escalation flag, and routes to the existing LOA path. The verified identity stays on the attempt only. **This no‑match path is not auto‑screened** (it already escalates to a human — SCR‑6); screening runs on the **matched** (Band A) and **verify‑only** paths. To see a screening hit on screen, use a matched/verify‑only journey with `SCREENING_DEMO_FORCE_HIT=1` (Section 6b).
8. **Verify in the DB** what just happened (Section 7): find the attempt for your application and run `inspect.js` — you'll see the Vault reference, the band decision, the events, the outbox envelope.

> To also show **confirm + dynamic extra‑ID fields**: use a flow that lands on a *passing* band (Band A) — easiest via the seed + `inspect.js`, or explain it using Section 5's Band A output plus the confirm screen description below.

**What the confirm screen does (Band A / passing):** after a pass, the applicant sees their verified fields (name, DOB, **plus extra ID fields**: document number, type, expiry, issuing country, gender, place of birth, address) each with a tick and an **Edit**. On **Confirm & continue**, the sensitive extras go to the **Vault** (not the submission) and the submission keeps only a **reference** — see it via `inspect.js`.

---

## 5. FLOW — Band A / B / C / retry / PEP on demand (script)

The live sandbox can't force each band, so drive the **real band logic** directly.

**Run (in `E:\kyc-agent-dev`):**
```
node scripts/demo/band-outcomes.js
```
**You'll see**, for each controlled case, the exact decision + what the applicant would see:
- **Band A — exact match** → `auto_match` → "Identity verified".
- **Band A — MRZ fixes a visual typo** → `extraction_error_corrected`.
- **Band B — transliteration (Murthy/Moorthy)** → auto‑resolved `same_person_variation_accepted` via a named rule.
- **Band C — different person (DOB conflict)** → `demoted_to_loa_path` + escalation → LOA path.
- **RETRY — missing DOB** → never a match, applicant asked to verify again.
- **PEP/sanctions HIT** → clean match **blocked**, routed to review.

*What that means:* this is the **exact logic the live app runs**; the app just renders the applicant‑facing copy for each. Use this to demonstrate every band without needing to steer Didit.

---

## 6. FLOW — Screening (PEP / sanctions / adverse‑media)

**Screening is now wired into the live flow (SCR‑2).** When the flag is ON, the app screens the **verified identity** during the journey — on both the **listed** (matched director) and **unlisted** (verify‑only) paths — after Didit verification completes. Any hit routes the applicant to review (uniform hard‑exclusion). It runs against ComplyCube's **sandbox** (`COMPLYCUBE_API_KEY` test key in `.env.local`).

**Required env for screening (already set in `.env.local`):** `COMPLYCUBE_API_KEY` (a `test_` key), `SCREENING_RUNTIME_MODE=test`, `IDV_DATABASE_URL`, plus the feature flag `IDV_DISCREPANCY_BANDS_ENABLED=1`. (The webhook secret is optional — the flow polls the result, it doesn't need the push webhook.)

### 6a. Show each category distinctly (offline, deterministic)
```
node scripts/demo/screening-fixture.js
```
**You'll see** each category interpreted by the **real** decision logic: **PEP hit**, **sanctions (watchlist) hit**, **adverse‑media/criminal hit**, and **clear** — each showing `HIT: true/false`, the categories, and the band effect ("HARD EXCLUSION → routed to review"). Use this to demonstrate that each category is detected and acted on — the live sandbox can force *a* hit but not steer *which* category, so this is how you show them side‑by‑side.

### 6b. Force an on‑screen hit in the LIVE journey (demo switch)
By default the live flow screens the name Didit extracted — which won't match a danger list, so the journey passes. To make the **real on‑screen flow land on a screening hit**, turn on the demo switch:
1. In `.env.local` add `SCREENING_DEMO_FORCE_HIT=1`, then restart `npm start`.
2. Run the normal journey (Section 4). During screening the app sends last name **`attention`** to ComplyCube's sandbox, which returns a hit → the applicant lands on the neutral **"We're completing our checks"** review screen.
3. **Safety:** this switch only works in **sandbox/test mode** — it is ignored in live mode, so it can never alter a real screening. Turn it off (`0`) for a normal demo.

### 6c. Prove it's a real ComplyCube call (not a fixture)
The offline fixture (6a) uses sample answers we wrote. To prove the **real vendor connection**: run a direct `startScreening` with last name `attention` against the sandbox, then read the stored result.
- `startScreening` creates a ComplyCube client → runs an `extensive_screening_check` → `interpret.js` turns the response into `outcome` + `categories`, stored in `idv_screening_checks`. The band logic reads it via `hasScreeningHit(attemptId)`.
- **Where to verify the result:** the `idv_screening_checks` table (Section 7) — `outcome` = `attention`, `categories` = the real breakdown ComplyCube returned.
- (Async note: ComplyCube can also push the result via webhook, which then **re‑resolves** the band — but the live flow doesn't depend on it; it polls.)

---

## 7. Verify anything in the DB (the "where is it happening" route)

Two ways: the **inspector script** (easiest) or **SQL in the Neon console**.

### 7a. Seed one complete attempt (so every store has data)
```
node -r dotenv/config scripts/demo/seed-complete.js dotenv_config_path=.env.local
```
This creates one attempt (`application_id = DEMO-FULL`) touching **every** store and prints its `attempt id`. It cleans its own prior data, so it's safe to re‑run.

### 7b. Inspect it (masked, then authorized reveal)
```
node -r dotenv/config scripts/demo/inspect.js ATTEMPT_ID dotenv_config_path=.env.local
```
Shows, for that attempt: the **attempt** (reference, no plaintext), the **Vault** (ciphertext, masked) + **access‑audit count**, **band decisions**, **immutable events**, **lifecycle**, **document media** (encrypted pointer), **screening**, and the **evidence outbox envelope**.

Add `--reveal` to do the **authorized, audited decrypt** of the identity:
```
node -r dotenv/config scripts/demo/inspect.js ATTEMPT_ID --reveal dotenv_config_path=.env.local
```
**Point this out:** masked by default → `--reveal` shows the real values → the **audit count goes up** (every reveal is logged). That's the reviewer security story.

### 7c. Neon Console walkthrough (the visual DB demo)

> **`idv` is already registered in the console** — it shows on branch **`main`** in
> **Branches → Databases** (owner `neondb_owner`), alongside `neondb`. Nothing to
> create. If you "couldn't see it" before, it was **selection**, not a missing DB:
> the SQL Editor's branch/database pickers were pointed at the wrong branch (or at
> `neondb`).

**To view it (two ways):**
1. **Databases tab → the `idv` row → "Edit data"** — opens Neon's table browser for
   `idv`; pick any `idv_*` table and read rows directly. Simplest visual demo.
2. **SQL Editor** → at the top pick **branch `main`** and **database `idv`** (not
   `neondb`) → run the queries below.

**Sanity check it's the live DB the app writes to:** open `idv_verification_attempts`
via *Edit data* — you should see rows (~9 from prior runs + the seed). Empty means
the console branch differs from `IDV_DATABASE_URL`'s endpoint (`ep-blue-mouse-abxjk5d5`) —
realign the branch (or `.env.local`) before demoing.

**Rebuild from scratch (only if you ever need a clean `idv` or a brand‑new branch):**
```
npm run idv:db:migrate   # applies migrations 013–023 to IDV_DATABASE_URL
npm run idv:db:seed      # seeds one complete attempt (application_id = DEMO-FULL)
```
(If you deliberately recreate the database, create it via the **Databases tab → Add
database** so the console registers it, then run the two commands above.)

**During the demo:** SQL Editor → pick the `ep-blue-mouse` branch → database **`idv`** → run each query and say the line next to it:

| Query | What it proves (say this) |
| --- | --- |
| `SELECT attribute_concept, left(ciphertext,24) AS ciphertext_sample, nonce, version FROM idv_vault_attributes;` | **The Vault** — sensitive identity stored as **ciphertext only**, per‑attribute nonce, versioned. No plaintext anywhere. |
| `SELECT actor_id, purpose, outcome, at FROM idv_vault_access_audit ORDER BY at DESC;` | **Every Vault read is audited** — run `inspect.js --reveal` and watch a row get added. |
| `SELECT id, application_id, status, secure_identity_reference, verification_result FROM idv_verification_attempts;` | Ordinary tables hold only an **opaque reference** to the Vault — never identity text. |
| `SELECT band, outcome_type, resolved_by, policy_version FROM idv_match_decisions;` | **Band decisions** (A/B/C) — non‑PII, append‑only, policy‑versioned. |
| `SELECT event_type, attribute_concept, actor, occurred_at FROM idv_identity_events ORDER BY occurred_at;` | **Immutable identity events** — references + metadata, the audit trail. |
| `SELECT event_type, occurred_at, received_at, recorded_at FROM idv_lifecycle_events;` | **Lifecycle timeline** of the attempt. |
| `SELECT evidence_kind, blob_key, content_type, sha256 FROM idv_document_media;` | **Document media** — encrypted pointer + hash, **no bytes** in the DB (bytes are encrypted in Vercel Blob). |
| `SELECT outcome, categories FROM idv_screening_checks;` | **Screening** (PEP/sanctions/adverse‑media) — isolated result. |
| `SELECT idempotency_key, status, envelope FROM idv_evidence_outbox;` | **Evidence outbox** — references‑only envelope, append‑only, **unconsumed** (awaits Evidence Control Room). |

The **ciphertext object** for a document image lives in **Vercel → Storage → Blob** under the `blob_key` above (opening it shows encrypted bytes, not a picture — by design).

*(Alternative, no console setup: a desktop SQL client — TablePlus/DBeaver/`psql` — connected with `IDV_DATABASE_URL` from `.env.local` runs the same queries against `idv` on host `ep-blue-mouse-abxjk5d5`.)*

---

## 8. See a stored document image as a picture

```
node -r dotenv/config scripts/demo/image-roundtrip.js MEDIA_ID dotenv_config_path=.env.local
```
(`MEDIA_ID` is printed by the seed, or shown in `inspect.js` under DOCUMENT MEDIA.)

It does the **authorized + audited decrypt** and writes a **viewable image file** into `scratch\` (gitignored). Open that file to see the picture.

**Point this out:** the raw Blob object is encrypted (not viewable); only the authorized decrypt turns it back into a picture — and it's logged.
*(The seed stores a tiny sample image. A real Didit document scan needs a live webhook + confirmed field names — BANDS‑2.)*

---

## 9. FLOW — Unlisted / verify‑only

**In the app (flag ON):**
1. On the Applicant page, in "Who is completing this application?", choose **"I am not listed — fill in manually."**
2. Upload the **Authority‑to‑act** document (this path is unchanged from today).
3. The **Didit verification** box then appears (verify‑only mode — no officer to match).
4. Complete Didit → the applicant proceeds on a successful check.
   - *Behind the scenes:* `session` was created with `verifyOnly` (no officer snapshot); `resolve` **skips the band comparison** (there's no officer to compare against) but **still screens the verified identity** — a PEP/sanctions/adverse‑media hit routes them to review instead of passing. No band decision row is written on this path.
   - *To show a hit here:* set `SCREENING_DEMO_FORCE_HIT=1` (Section 6b) and this verify‑only pass will land on the review screen instead.

---

## 10. FLOW — Flag OFF (regression / "nothing changes")

1. Set `IDV_DISCREPANCY_BANDS_ENABLED=0` in `.env.local`, restart `npm start`.
2. Walk the Applicant page: it shows the **Signatory‑ID upload + manual Continue** exactly as before; no Didit box, no bands.
3. `curl http://localhost:3000/api/idv-match/flags` → `false`.
*Point this out:* the feature is fully reversible; production is unaffected until the flag is turned on deliberately.

---

## 11. All commands (quick reference)

Run everything in `E:\kyc-agent-dev`.

| Command | What it does | Expect | Needed for |
|---|---|---|---|
| `npm start` | Run the app + dev API | app on :3000 | app demo |
| `curl http://localhost:3000/api/idv-match/flags` | Check the flag | `{"idvDiscrepancyBands":true/false}` | any |
| `node scripts/demo/band-outcomes.js` | Band A/B/C/retry/PEP logic | printed decisions | band demo |
| `node scripts/demo/screening-fixture.js` | PEP/sanctions/adverse interpretation (each category, offline) | printed hits | screening demo (6a) |
| set `SCREENING_DEMO_FORCE_HIT=1` in `.env.local` + restart | force an on‑screen screening hit in the live journey (sandbox only) | applicant lands on review | live screening demo (6b) |
| `npm run idv:db:migrate` | Apply IDV migrations 013–023 to `idv` (after console recreate) | schema built | Neon console setup (7c) |
| `npm run idv:db:seed` | Seed one complete attempt into `idv` | prints attempt id | Neon console setup (7c) |
| `npm run idv:db:seed:populated` | Seed 6 varied attempts (Band A/B/C + clear/PEP/sanctions/adverse) | populated tables | fuller console demo |
| `node -r dotenv/config scripts/demo/seed-complete.js dotenv_config_path=.env.local` | Seed one complete attempt | prints attempt id | DB demo |
| `node -r dotenv/config scripts/demo/inspect.js ATTEMPT_ID [--reveal] dotenv_config_path=.env.local` | Show every store for an attempt | printed trail | DB demo |
| `node -r dotenv/config scripts/demo/image-roundtrip.js MEDIA_ID dotenv_config_path=.env.local` | Decrypt a stored image to a file | writes `scratch\decrypted-*.png` | media demo |
| `IDV_MATCH_DB_TEST=1 node -r dotenv/config --test api/idv-match/__tests__/*.integration.nodetest.js dotenv_config_path=.env.local` | Run the guarded DB integration tests | all pass | proof |
| `node --test api/idv-match/**/__tests__/*.nodetest.js api/idv-match/__tests__/*.nodetest.js` | Run the offline test suite | ~pass, guarded skipped | proof |

**If a command fails:**
- *"IDV_DATABASE_URL / DATABASE_URL not set"* → you forgot `-r dotenv/config … dotenv_config_path=.env.local`.
- *DB connection hangs/`database "idv" does not exist`* → the pooled host lags on a new DB; `.env.local` already points `IDV_DATABASE_URL` at the direct host, so just re‑run.
- *`/api/idv-match/*` 404 in the app* → the dev server didn't pick up new routes; restart `npm start`.
- *flags shows `false`* → set the flag to `1` and restart `npm start`.
- *Neon web console shows only `neondb`, no `idv` / "relation … does not exist"* → it's a **selection** issue, not a missing DB. `idv` is registered on branch **`main`** (see it in Branches → Databases). In the SQL Editor pick **branch `main`** and **database `idv`** (never query `idv_*` against `neondb`), or just use the **Edit data** button on the `idv` row (Section 7c).

---

## 12. Current limitations (state these plainly)

1. **Screening runs live, but the sandbox can't steer the category** — a hit triggers during the journey (use `SCREENING_DEMO_FORCE_HIT=1` to force one on screen), but to show PEP vs sanctions vs adverse‑media *distinctly* use the offline fixture (Section 6a). No‑officer‑match (Band C) identities aren't auto‑screened (they escalate to a human — SCR‑6). Category detail is DB‑only, never shown to the applicant.
2. **No reviewer/admin UI** — the Vault/reference/events/audit/outbox are shown via `inspect.js` or SQL, not a page.
3. **Live Didit can only reliably show Band C** — A and B are shown via `band-outcomes.js` (Section 5).
4. **Real Didit document images** are only captured on a live webhook and need field‑name confirmation (BANDS‑2) — the media store itself is demoed with the seed (Sections 7–8).
5. **Dev key + dev auth** — the Vault encrypts with a local dev key and the reviewer‑reveal endpoint isn't authenticated yet (IDVSEC‑1). Fine for a **sandbox/synthetic** demo; not for real PII (that's the IDV‑2 production hardening).

---

## 13. Proposed "Demo Readiness" (NOT built — for reference)

If you later want a smoother demo, the intended scope is **D3 only**: turn the flag on + a demo seed (this runbook has it) + a short guided script covering Band A / B / C / PEP / unlisted. Screening is now wired into the live flow; what remains not built is an admin/inspector page — the isolated scripts above stand in for it.

---

*All flows above are behind the OFF flag and use synthetic/sandbox data only.*
