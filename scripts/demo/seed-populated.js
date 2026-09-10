"use strict";
/*
 * DEMO SEED (POPULATED): seeds SEVERAL varied verification attempts so the Neon
 * console looks populated and shows the range of outcomes — Band A / B / C plus
 * screening variety (clear / PEP / sanctions / adverse-media). Uses the real
 * durable paths (encrypted Vault, media, decision + outbox, events, lifecycle,
 * screening). Idempotent: cleans every prior DEMO* attempt first, then reseeds.
 *
 * Run from E:\kyc-agent-dev:
 *   node -r dotenv/config scripts/demo/seed-populated.js dotenv_config_path=.env.local
 */
const { neon } = require("@neondatabase/serverless");
const { createIdentityAttribute } = require("../../idv");
const attemptStore = require("../../api/idv-match/attemptStore");
const identityVault = require("../../api/idv-match/identityVault");
const identityEvents = require("../../api/idv-match/identityEventsStore");
const { recordBandOutcome } = require("../../api/idv-match/behaviors");
const { appendLifecycleEvent } = require("../../api/idv-match/lifecycle");
const media = require("../../api/idv-match/media");
const screeningStore = require("../../api/idv-match/screening/store");

// 1x1 PNG (real, viewable) so the media decrypt demo produces a picture.
const SAMPLE_PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64");

const attr = (concept, value) => createIdentityAttribute({ concept, value, provider: "DIDIT", providerSessionId: "s" });

// One fully-populated attempt from a compact config.
async function seedOne(sql, cfg) {
  const attemptId = await attemptStore.createAttempt({
    applicationId: cfg.app,
    selectedOfficer: cfg.officer,
    diditSessionId: `${cfg.app}-sess`,
  });

  const ref = await identityVault.storeExtractedIdentity({
    sessionId: attemptId, subjectId: attemptId, tenantId: "nium", attributes: cfg.identity,
  });
  await attemptStore.updateAttempt(attemptId, {
    status: cfg.status || "Approved",
    secureIdentityReference: ref,
    verificationResult: { provider: "DIDIT", providerVerified: true, observations: [{ observation_type: "LIVENESS", status: "PASSED" }] },
  });

  await identityEvents.appendIdentityEvent({ attemptId, secureIdentityReference: ref, eventType: "extraction_presented", actor: "system" });
  if (cfg.confirmedConcept) {
    await identityEvents.appendIdentityEvent({ attemptId, secureIdentityReference: ref, eventType: "applicant_confirmed", attributeConcept: cfg.confirmedConcept, actor: "applicant" });
  }

  await appendLifecycleEvent({ attemptId, type: "IDV_SESSION_CREATED", receivedAt: new Date().toISOString() });
  await appendLifecycleEvent({ attemptId, type: "PROVIDER_RESULT_RECEIVED", occurredAt: cfg.resultAt || "2026-09-01T10:05:00Z", receivedAt: new Date().toISOString() });

  await recordBandOutcome({ attemptId, applicationId: cfg.app, decision: { ...cfg.decision, secureIdentityReference: ref, policyVersion: "idv-match-1.0.0" } });

  if (cfg.media) {
    try { await media.storeDocumentImage({ attemptId, evidenceKind: "front", bytes: SAMPLE_PNG, contentType: "image/png" }); }
    catch (e) { console.warn(`  [${cfg.app}] media skipped:`, e.message); }
  }

  if (cfg.screening) {
    const sid = await screeningStore.createScreening({ attemptId, provider: "complycube", complyCubeCheckId: `${cfg.app}-check` });
    await screeningStore.updateScreeningResult(sid, { status: "complete", outcome: cfg.screening.outcome, categories: cfg.screening.categories });
  }

  if (cfg.reveal) {
    await identityVault.retrieveForAuthorizedPurpose({ reference: ref, fields: cfg.reveal, actorId: "demo-reviewer", purpose: "KYC_DECISIONING" });
  }

  console.log(`  ${cfg.app.padEnd(14)} band ${cfg.decision.band}/${cfg.decision.outcomeType.padEnd(28)} attempt ${attemptId}`);
  return attemptId;
}

const CLEAR = { outcome: "clear", categories: { pep: false, watchlist: false, adverseMedia: false, other: false } };

// Six varied attempts: Band A/B/C + screening clear/PEP/sanctions/adverse.
const CASES = [
  {
    app: "DEMO-A-MATCH", officer: { name: "LOVELACE, Ada", birthMonthYear: "1815-12", role: "Director", officerId: "off-1" },
    identity: [attr("first_name", "Ada"), attr("last_name", "Lovelace"), attr("date_of_birth", "1815-12-10"), attr("document_number", "X1234567"), attr("gender", "F")],
    decision: { band: "A", outcomeType: "auto_match", resolvedBy: "system", score: 1 },
    confirmedConcept: "document_number", media: true, screening: CLEAR, reveal: ["first_name", "date_of_birth"],
  },
  {
    app: "DEMO-B-VARIANCE", officer: { name: "MOHAMMED, Ali", birthMonthYear: "1988-04", role: "Director", officerId: "off-2" },
    identity: [attr("first_name", "Ali"), attr("last_name", "Muhammad"), attr("date_of_birth", "1988-04-22"), attr("document_number", "M7654321"), attr("nationality", "AE")],
    decision: { band: "B", outcomeType: "same_person_variation_accepted", resolvedBy: "system", score: 0.9 },
    media: true, screening: CLEAR,
  },
  {
    app: "DEMO-C-LOA", officer: { name: "SMITH, John", birthMonthYear: "1975-03", role: "Director", officerId: "off-3" },
    identity: [attr("first_name", "Maria Victoria"), attr("last_name", "Villareal"), attr("date_of_birth", "1990-06-15"), attr("document_number", "AAF794880"), attr("nationality", "ARG"), attr("place_of_birth", "Buenos Aires")],
    decision: { band: "C", outcomeType: "demoted_to_loa_path", resolvedBy: "system", escalate: true, reasons: ["no_officer_match"] },
    screening: CLEAR,
  },
  {
    app: "DEMO-PEP", officer: { name: "OKONKWO, Grace", birthMonthYear: "1970-09", role: "UBO", officerId: "off-4" },
    identity: [attr("first_name", "Grace"), attr("last_name", "Okonkwo"), attr("date_of_birth", "1970-09-02"), attr("document_number", "P0099887")],
    decision: { band: "B", outcomeType: "unresolved_to_review", resolvedBy: "reviewer", reasons: ["screening_hit"] },
    screening: { outcome: "attention", categories: { pep: true, watchlist: false, adverseMedia: false, other: false } },
  },
  {
    app: "DEMO-SANCTIONS", officer: { name: "IVANOV, Dmitri", birthMonthYear: "1965-01", role: "Director", officerId: "off-5" },
    identity: [attr("first_name", "Dmitri"), attr("last_name", "Ivanov"), attr("date_of_birth", "1965-01-30"), attr("document_number", "S5544332")],
    decision: { band: "B", outcomeType: "unresolved_to_review", resolvedBy: "reviewer", reasons: ["screening_hit"] },
    screening: { outcome: "attention", categories: { pep: false, watchlist: true, adverseMedia: false, other: false } },
  },
  {
    app: "DEMO-ADVERSE", officer: { name: "REYES, Carlos", birthMonthYear: "1982-07", role: "Director", officerId: "off-6" },
    identity: [attr("first_name", "Carlos"), attr("last_name", "Reyes"), attr("date_of_birth", "1982-07-11"), attr("document_number", "A1122334")],
    decision: { band: "B", outcomeType: "unresolved_to_review", resolvedBy: "reviewer", reasons: ["screening_hit"] },
    screening: { outcome: "attention", categories: { pep: false, watchlist: false, adverseMedia: true, other: false } },
  },
];

async function cleanDemo(sql) {
  const prior = await sql`SELECT id, secure_identity_reference FROM idv_verification_attempts WHERE application_id LIKE 'DEMO%'`;
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
  return prior.length;
}

async function main() {
  const sql = neon(process.env.IDV_DATABASE_URL || process.env.DATABASE_URL);
  const removed = await cleanDemo(sql);
  console.log(`Cleaned ${removed} prior DEMO* attempt(s). Seeding ${CASES.length} varied attempts:\n`);
  for (const cfg of CASES) await seedOne(sql, cfg);
  console.log(`\n✅ Seeded ${CASES.length} attempts across every idv_* store — Band A/B/C + clear/PEP/sanctions/adverse.`);
}
main().catch((e) => { console.error("seed failed:", e.message); process.exit(1); });
