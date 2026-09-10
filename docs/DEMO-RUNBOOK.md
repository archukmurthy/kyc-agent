# IDV Discrepancy Bands + Evidence Architecture — Demo Runbook

A **follow‑these‑exact‑steps** guide to demo everything built so far. Assumes no
knowledge of the implementation. Where something can't be shown in the app, it
gives the DB/script route instead.

- **Environment:** local — `npm start` on `http://localhost:3000`, using `.env.local`.
- **Run all commands in:** `E:\kyc-agent-dev`
- **The feature is behind an OFF switch** — you turn it on for the demo (Section 1).
- **Nothing here changes live behaviour until the flag is on.**

---

## 0. What can I demo today?

**Demoable directly in the app (flag ON):**
- The applicant journey: progressive disclosure → "who is completing" → pick a director → inline **Didit** QR → verification → **band result** → (Band B) one‑round dialogue → **confirm + dynamic extra‑ID fields** → **Band C** letter‑of‑authorization path → **unlisted verify‑only**.
- Flag OFF vs ON behaviour (the journey reverts exactly to today when OFF).

**Demoable through the DB / a script (not in the app UI):**
- The **Vault** (encrypted identity), the **reference** on the attempt, **immutable events**, **access audit**, **document media** (encrypted), **evidence outbox**, **lifecycle**, **screening result**, band decisions. → use **`inspect.js`** (Section 7 — the recommended way). *(The `idv` database is NOT visible in the Neon web console; for raw SQL use a desktop SQL client — see 7c.)*
- Seeing a **stored document image as a picture** → `image-roundtrip.js` (Section 8).

**Demoable only through isolated scripts/tests:**
- **Band A / B / C outcomes on demand** → `band-outcomes.js` (the live Didit sandbox can't force these reliably — see Section 4).
- **PEP / sanctions / adverse‑media (criminal)** → `screening-fixture.js` (offline) or a live ComplyCube **sandbox** check (Section 6).

**Built but NOT wired / NOT demoable in the live flow (by design):**
- **Screening is not called by the live applicant flow** (BACKLOG **SCR‑2**) — so a PEP/sanctions hit will not appear during the live journey; demo it in isolation (Section 6).
- **No reviewer/admin page** — the "reviewer reveal" is shown via `inspect.js --reveal` (Section 7), not a UI.
- Real **Didit document‑image capture** only runs on a real webhook and needs its field names confirmed (BACKLOG **BANDS‑2**) — demo the media store with the seed instead (Sections 7–8).

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
   - *Behind the scenes:* Band C recorded `demoted_to_loa_path`, set the escalation flag, and routes to the existing LOA path. The verified identity stays on the attempt only.
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

**Constraint:** screening is intentionally **NOT wired into the live applicant flow** (BACKLOG **SCR‑2**), so it won't trigger during Section 4. Demo it in isolation.

### 6a. Offline (guaranteed, no network)
```
node scripts/demo/screening-fixture.js
```
**You'll see** each category interpreted by the real logic: **PEP hit**, **sanctions (watchlist) hit**, **adverse‑media/criminal hit**, and **clear** — each showing `HIT: true/false`, the categories, and the band effect ("HARD EXCLUSION → routed to review").

### 6b. Live ComplyCube **sandbox** check (optional, real API call)
Use this to show a real end‑to‑end screening hit. It calls ComplyCube's **sandbox** (free; uses `COMPLYCUBE_API_KEY` from `.env.local`).
- The proven create→check→interpret path lives in `api/idv-match/screening/` (`index.js` `startScreening`, `complyCubeClient.js`, `interpret.js`).
- To run a live sandbox screening for a name, use the screening module's `startScreening` with a synthetic sanctioned/PEP test name (ComplyCube's sandbox returns "attention" for its test names).
- **Where to verify the result:** the `idv_screening_checks` table (Section 7) — `outcome` + `categories`.

*What `startScreening` does:* creates a ComplyCube client → runs an `extensive_screening_check` → the async **webhook** delivers the result → `interpret.js` turns it into `outcome` + `categories`, stored in `idv_screening_checks`. The band logic reads it via `hasScreeningHit(attemptId)`.
*Why it's not in the live flow yet:* wiring needs a design decision (which name to screen, when, and how to handle the async webhook vs the synchronous band decision) — tracked as **SCR‑2**.

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
node -r dotenv/config scripts/demo/inspect.js <attemptId> dotenv_config_path=.env.local
```
Shows, for that attempt: the **attempt** (reference, no plaintext), the **Vault** (ciphertext, masked) + **access‑audit count**, **band decisions**, **immutable events**, **lifecycle**, **document media** (encrypted pointer), **screening**, and the **evidence outbox envelope**.

Add `--reveal` to do the **authorized, audited decrypt** of the identity:
```
node -r dotenv/config scripts/demo/inspect.js <attemptId> --reveal dotenv_config_path=.env.local
```
**Point this out:** masked by default → `--reveal` shows the real values → the **audit count goes up** (every reveal is logged). That's the reviewer security story.

### 7c. Or query with raw SQL (use a desktop SQL client — NOT the Neon web console)
> ⚠️ **The Neon web console will NOT list the `idv` database** (it was created via SQL; Neon's console only lists databases made through its console/API). So the `idv_*` tables won't appear there — you'll only see `neondb`, and queries against it error with *"relation … does not exist"*. This is a console‑visibility quirk, not a data problem.
>
> To run raw SQL, use a **desktop SQL client** — TablePlus, DBeaver, or `psql` — connected with the **`IDV_DATABASE_URL`** value from `.env.local` (that points at the `idv` database on host `ep-snowy-cherry-abf2ntrs`). Then run:
```sql
-- Vault: sensitive identity, CIPHERTEXT only (no plaintext)
SELECT attribute_concept, left(ciphertext,24) AS ciphertext_sample, nonce, version FROM idv_vault_attributes;
-- Every Vault read is audited
SELECT actor_id, purpose, outcome, at FROM idv_vault_access_audit ORDER BY at DESC;
-- The reference lives on the attempt (no plaintext identity)
SELECT id, application_id, status, secure_identity_reference, verification_result FROM idv_verification_attempts;
-- Non-PII: band decisions
SELECT band, outcome_type, resolved_by, policy_version FROM idv_match_decisions;
-- Immutable events (references + metadata only)
SELECT event_type, attribute_concept, actor, occurred_at FROM idv_identity_events ORDER BY occurred_at;
-- Lifecycle timeline
SELECT event_type, occurred_at, received_at, recorded_at FROM idv_lifecycle_events;
-- Encrypted document media (pointer + wrapped key + hash, NO bytes)
SELECT evidence_kind, blob_key, content_type, sha256 FROM idv_document_media;
-- Screening (isolated)
SELECT outcome, categories FROM idv_screening_checks;
-- Evidence outbox (references-only envelope; unconsumed)
SELECT idempotency_key, status, envelope FROM idv_evidence_outbox;
```
The **ciphertext object** for a document image lives in **Vercel → Storage → Blob** under the `blob_key` shown above (opening it shows encrypted bytes, not a picture — by design).

---

## 8. See a stored document image as a picture

```
node -r dotenv/config scripts/demo/image-roundtrip.js <mediaId> dotenv_config_path=.env.local
```
(`<mediaId>` is printed by the seed, or shown in `inspect.js` under DOCUMENT MEDIA.)

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
   - *Behind the scenes:* `session` was created with `verifyOnly` (no officer snapshot); `resolve` **skips the band comparison** and just returns verified/not — no band decision row is written.

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
| `node scripts/demo/screening-fixture.js` | PEP/sanctions/adverse interpretation | printed hits | screening demo |
| `node -r dotenv/config scripts/demo/seed-complete.js dotenv_config_path=.env.local` | Seed one complete attempt | prints attempt id | DB demo |
| `node -r dotenv/config scripts/demo/inspect.js <attemptId> [--reveal] dotenv_config_path=.env.local` | Show every store for an attempt | printed trail | DB demo |
| `node -r dotenv/config scripts/demo/image-roundtrip.js <mediaId> dotenv_config_path=.env.local` | Decrypt a stored image to a file | writes `scratch\decrypted-*.png` | media demo |
| `IDV_MATCH_DB_TEST=1 node -r dotenv/config --test api/idv-match/__tests__/*.integration.nodetest.js dotenv_config_path=.env.local` | Run the guarded DB integration tests | all pass | proof |
| `node --test api/idv-match/**/__tests__/*.nodetest.js api/idv-match/__tests__/*.nodetest.js` | Run the offline test suite | ~pass, guarded skipped | proof |

**If a command fails:**
- *"IDV_DATABASE_URL / DATABASE_URL not set"* → you forgot `-r dotenv/config … dotenv_config_path=.env.local`.
- *DB connection hangs/`database "idv" does not exist`* → the pooled host lags on a new DB; `.env.local` already points `IDV_DATABASE_URL` at the direct host, so just re‑run.
- *`/api/idv-match/*` 404 in the app* → the dev server didn't pick up new routes; restart `npm start`.
- *flags shows `false`* → set the flag to `1` and restart `npm start`.
- *Neon web console shows only `neondb`, no `idv` / "relation … does not exist"* → expected; the console can't list the SQL‑created `idv` DB. Use `inspect.js` (Section 7b) or a desktop SQL client (Section 7c). Don't query `idv_*` against `neondb`.

---

## 12. Current limitations (state these plainly)

1. **Screening is not wired into the live flow** (SCR‑2) — PEP/sanctions won't trigger during the live journey; demo it via Section 6.
2. **No reviewer/admin UI** — the Vault/reference/events/audit/outbox are shown via `inspect.js` or SQL, not a page.
3. **Live Didit can only reliably show Band C** — A and B are shown via `band-outcomes.js` (Section 5).
4. **Real Didit document images** are only captured on a live webhook and need field‑name confirmation (BANDS‑2) — the media store itself is demoed with the seed (Sections 7–8).
5. **Dev key + dev auth** — the Vault encrypts with a local dev key and the reviewer‑reveal endpoint isn't authenticated yet (IDVSEC‑1). Fine for a **sandbox/synthetic** demo; not for real PII (that's the IDV‑2 production hardening).

---

## 13. Proposed "Demo Readiness" (NOT built — for reference)

If you later want a smoother demo, the intended scope is **D3 only**: turn the flag on + a demo seed (this runbook has it) + a short guided script covering Band A / B / C / PEP / unlisted. Per the current constraints we are **not** wiring screening into the live flow and **not** building an admin/inspector page — the isolated scripts above stand in for both.

---

*All flows above are behind the OFF flag and use synthetic/sandbox data only.*
