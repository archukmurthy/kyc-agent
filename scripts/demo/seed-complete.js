"use strict";
/*
 * DEMO SEED: creates ONE complete verification attempt that touches EVERY store,
 * so the DB verification queries in the runbook all return data. Uses the real
 * durable paths (encrypted Vault, media store, decision + outbox, events,
 * lifecycle, screening). Idempotent: cleans its own prior data first.
 *
 * Run from E:\kyc-agent-dev:  node -r dotenv/config scripts/demo/seed-complete.js dotenv_config_path=.env.local
 */
const path = require("path");
const { neon } = require("@neondatabase/serverless");
const { createIdentityAttribute } = require("../../idv");
const attemptStore = require("../../api/idv-match/attemptStore");
const identityVault = require("../../api/idv-match/identityVault");
const identityEvents = require("../../api/idv-match/identityEventsStore");
const { recordBandOutcome } = require("../../api/idv-match/behaviors");
const { appendLifecycleEvent } = require("../../api/idv-match/lifecycle");
const media = require("../../api/idv-match/media");
const screeningStore = require("../../api/idv-match/screening/store");

const APP = "DEMO-FULL";
// 1x1 PNG (a real, viewable image) so the media decrypt demo produces a picture.
const SAMPLE_PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64");

async function main() {
  const conn = process.env.IDV_DATABASE_URL || process.env.DATABASE_URL;
  const sql = neon(conn);

  // ---- clean prior DEMO-FULL ----
  const prior = await sql`SELECT id, secure_identity_reference FROM idv_verification_attempts WHERE application_id = ${APP}`;
  for (const a of prior) {
    await sql`DELETE FROM idv_identity_events WHERE attempt_id = ${a.id}`;
    await sql`DELETE FROM idv_lifecycle_events WHERE attempt_id = ${a.id}`;
    await sql`DELETE FROM idv_document_media WHERE attempt_id = ${a.id}`;
    await sql`DELETE FROM idv_evidence_outbox WHERE attempt_id = ${a.id}`;
    await sql`DELETE FROM idv_review_tasks WHERE attempt_id = ${a.id}`;
    await sql`DELETE FROM idv_screening_checks WHERE attempt_id = ${a.id}`;
    await sql`DELETE FROM idv_match_decisions WHERE attempt_id = ${a.id}`;
    if (a.secure_identity_reference) {
      await sql`DELETE FROM idv_vault_access_audit WHERE secure_identity_reference = ${a.secure_identity_reference}`;
      await sql`DELETE FROM idv_vault_attributes WHERE secure_identity_reference = ${a.secure_identity_reference}`;
      await sql`DELETE FROM idv_vault_records WHERE secure_identity_reference = ${a.secure_identity_reference}`;
    }
    await sql`DELETE FROM idv_verification_attempts WHERE id = ${a.id}`;
  }

  // ---- 1) attempt (frozen officer snapshot) ----
  const attemptId = await attemptStore.createAttempt({ applicationId: APP, selectedOfficer: { name: "LOVELACE, Ada", birthMonthYear: "1815-12", role: "Director", officerId: "off-1" }, diditSessionId: "demo-full-sess" });

  // ---- 2) Vault: sensitive identity, encrypted ----
  const ref = await identityVault.storeExtractedIdentity({
    sessionId: attemptId, subjectId: attemptId, tenantId: "nium",
    attributes: [
      createIdentityAttribute({ concept: "first_name", value: "Ada", provider: "DIDIT", providerSessionId: "s" }),
      createIdentityAttribute({ concept: "last_name", value: "Lovelace", provider: "DIDIT", providerSessionId: "s" }),
      createIdentityAttribute({ concept: "date_of_birth", value: "1815-12-10", provider: "DIDIT", providerSessionId: "s" }),
      createIdentityAttribute({ concept: "document_number", value: "X1234567", provider: "DIDIT", providerSessionId: "s" }),
      createIdentityAttribute({ concept: "gender", value: "F", provider: "DIDIT", providerSessionId: "s" }),
    ],
  });
  await attemptStore.updateAttempt(attemptId, { status: "Approved", secureIdentityReference: ref, verificationResult: { provider: "DIDIT", providerVerified: true, observations: [{ observation_type: "LIVENESS", status: "PASSED" }] } });

  // ---- 3) immutable identity events ----
  await identityEvents.appendIdentityEvent({ attemptId, secureIdentityReference: ref, eventType: "extraction_presented", actor: "system" });
  await identityEvents.appendIdentityEvent({ attemptId, secureIdentityReference: ref, eventType: "applicant_confirmed", attributeConcept: "document_number", actor: "applicant" });

  // ---- 4) lifecycle timeline ----
  await appendLifecycleEvent({ attemptId, type: "IDV_SESSION_CREATED", receivedAt: new Date().toISOString() });
  await appendLifecycleEvent({ attemptId, type: "PROVIDER_RESULT_RECEIVED", occurredAt: "2026-09-01T10:05:00Z", receivedAt: new Date().toISOString() });

  // ---- 5) band decision (+ references-only outbox envelope) ----
  await recordBandOutcome({ attemptId, applicationId: APP, decision: { band: "A", outcomeType: "auto_match", resolvedBy: "system", score: 1, secureIdentityReference: ref, policyVersion: "idv-match-1.0.0" } });

  // ---- 6) encrypted document media (real Blob) ----
  let mediaId = null;
  try { ({ mediaId } = await media.storeDocumentImage({ attemptId, evidenceKind: "front", bytes: SAMPLE_PNG, contentType: "image/png" })); }
  catch (e) { console.warn("  media store skipped:", e.message); }

  // ---- 7) screening result (isolated; NOT from the live flow) ----
  const screeningId = await screeningStore.createScreening({ attemptId, provider: "complycube", complyCubeCheckId: "demo-check" });
  await screeningStore.updateScreeningResult(screeningId, { status: "complete", outcome: "attention", categories: { pep: true, watchlist: false, adverseMedia: false, other: false } });

  // ---- 8) generate one authorized Vault read (creates an audit row) ----
  await identityVault.retrieveForAuthorizedPurpose({ reference: ref, fields: ["first_name", "date_of_birth"], actorId: "demo-reviewer", purpose: "KYC_DECISIONING" });

  console.log("Seeded complete DEMO-FULL attempt.");
  console.log("  application_id           :", APP);
  console.log("  attempt id               :", attemptId);
  console.log("  secure_identity_reference:", ref);
  console.log("  media id                 :", mediaId || "(blob unavailable)");
  console.log("\nEvery idv_* store now has a row for this attempt. Inspect with:");
  console.log("  node -r dotenv/config scripts/demo/inspect.js " + attemptId + " dotenv_config_path=.env.local");
}
main().catch((e) => { console.error("seed failed:", e.message); process.exit(1); });
