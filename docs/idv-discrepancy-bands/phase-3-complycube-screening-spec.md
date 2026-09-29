# Phase 3 — ComplyCube screening (Spec)

**Goal:** Provide the sanctions / PEP / adverse-media **hit signal** the band logic needs (doc Step 4: a pending hit blocks Band B). Build a ComplyCube screening integration and expose a single `hasScreeningHit(attemptId)` accessor. All behind `IDV_DISCREPANCY_BANDS_ENABLED`; no live-journey wiring yet. **No paid calls** — unit-tested against mocked responses; ComplyCube sandbox (test key) is free but any real call is made only with explicit approval.

## ComplyCube facts (from docs, grounding this build)
- Base `https://api.complycube.com/v1/`; auth header `Authorization: <API_KEY>` (raw key, not Bearer). Keys are `test_...` (free deterministic sandbox) vs `live_...`.
- Flow (async): `POST /clients` (person: firstName, lastName, email, dob, nationality) → `POST /checks` `{ clientId, type: "extensive_screening_check" }` → result populates when the check `status: "complete"`; delivered by webhook (`check.completed[.attention]`) or poll.
- Result: `result.outcome ∈ clear | attention | not_processed`. `result.breakdown.summary.{pep, watchlist, adverseMedia, otherLists}` (each sub-field `clear`/`attention`/`not_processed`); `result.breakdown.matches[]` with `score` + `details.classifications`.
- **Hit = `outcome === "attention"`.** `not_processed` = "not screened", never treated as clear.
- Webhook HMAC-SHA256, header `ComplyCube-Signature`, secret `COMPLYCUBE_WEBHOOK_SECRET` (separate from the API key). Rate limits: live 10/s, sandbox 5/s.

## Open decision (needs your call — see end)
**SDK vs raw REST.** Official `@complycube/api` gives resource wrappers + `EventVerifier` for webhook signatures; raw `fetch` matches our existing `diditClient`/`niumClient` pattern (no new dependency, but we hand-roll the HMAC — which we already did for Didit). Spec is written to work either way behind one small client module; I recommend **raw REST for the calls + our own HMAC verifier** (consistency, no new dep, we own the security path), but will use the SDK if you prefer.

## In scope (module: `api/idv-match/screening/`)
1. **`config.js`** — resolve provider (`SCREENING_DEFAULT_PROVIDER`, default `complycube`), runtime mode (`SCREENING_RUNTIME_MODE` test/live), and the correct API key/secret; refuse to run live in a test context and vice-versa.
2. **`complyCubeClient.js`** — thin wrapper: `createClient(person)`, `createScreeningCheck(clientId)`, `getCheck(checkId)`. Raw REST via `fetch` (or SDK per decision). Rate-limit aware (respect `429` with backoff). Server-side only; key never reaches the browser.
3. **`interpret.js`** (pure) — `interpretCheck(check)` → `{ status, outcome, hit, categories: { sanctions, pep, adverseMedia, other }, notProcessed, matchCount }`. Derives `hit` from `outcome === "attention"`; categories from `breakdown.summary`. Fully unit-tested against mocked clear/attention/not_processed JSON.
4. **`screeningWebhookSignature.js`** (our own HMAC-SHA256 verifier, mirroring `lib/didit/webhookSignature.js`) — verify `ComplyCube-Signature` over the raw body with `COMPLYCUBE_WEBHOOK_SECRET`; constant-time compare. (Or SDK `EventVerifier` per decision.)
5. **`webhook.js`** — verify signature → find the screening record by ComplyCube check id → store the interpreted result (idempotent). Untrusted/no-result → server re-pulls `getCheck`.
6. **`store.js`** — data access for `idv_screening_checks` (create pending, get by check id / by attempt, update with interpreted result).
7. **`index.js`** — orchestration:
   - `startScreening(attemptId, person)` → create client + check, store a `pending` screening row bound to the attempt. (Which name(s) to screen — document name and/or CH name — is decided by the caller in Phase 5; this screens one supplied person.)
   - **`hasScreeningHit(attemptId)`** → reads stored screening rows for the attempt → `{ hit, pending, notProcessed, categories }`. This is the single signal the band logic consumes.
8. **Migration `016_idv_screening.sql`** — `idv_screening_checks` (id, attempt_id, provider, complycube_client_id, complycube_check_id, status, outcome, categories JSONB, result JSONB, created_at, updated_at). Append-only in spirit for outcomes.
9. Additive dev-proxy mount for the screening webhook (raw body).

## Security (first-class)
- API key + webhook secret server-side only; never in the browser or logs.
- Webhook HMAC verified (constant-time) before any state change; idempotent by check/event id.
- `hasScreeningHit` returns booleans/categories only — **no match PII** (names/DOB of watchlist entries) leaves the server via any browser-facing path.
- Test key must not be usable to bill live screening (config guards test vs live).
- Rate-limit/backoff on `429` to avoid abuse/lockout.

## Out of scope (later phases)
No band assignment (Phase 5 consumes `hasScreeningHit`), no "which name(s) to screen" policy (Phase 5), no UI, no ongoing monitoring (`enableMonitoring`), no live-journey wiring.

## Testing (mocks — no paid calls)
- `interpret.js`: clear → no hit; `attention` with sanctions/pep/adverse breakdown → hit + correct categories; `not_processed` → flagged, not clear.
- `screeningWebhookSignature`: valid accepted, tampered/stale rejected (if we build our own).
- `webhook` handler: signed payload → record updated; duplicate → idempotent; untrusted → re-pull.
- `startScreening`: stubbed client → creates ComplyCube client + check, stores pending row bound to attempt (assert no browser input drives it).
- `hasScreeningHit`: reads stored rows → correct `{ hit, pending, categories }`.
- Guarded DB integration (`IDV_MATCH_DB_TEST=1`) for `idv_screening_checks` round-trip + migration 016, with cleanup.
- **A real ComplyCube sandbox call** (free, deterministic by last name) is optional end-to-end proof — done only with your go-ahead.

## Definition of done
Screening module (config, client, interpret, store, webhook, `startScreening`, `hasScreeningHit`) + migration 016 (applied to `idv-dev` on OK) written and tested (unit + guarded integration); flag OFF changes nothing; committed + pushed; tracker ticked. No paid/live call without explicit approval.
