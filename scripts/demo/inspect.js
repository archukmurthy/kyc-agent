"use strict";
/*
 * DEMO INSPECTOR (CLI, read-only): prints the WHOLE data trail for one attempt
 * across every store - so you can show "where what is happening" without an admin
 * UI. Sensitive identity is MASKED by default; pass --reveal to do the authorized,
 * AUDITED decrypt (mirrors the reviewer reveal).
 *
 * Run from E:\kyc-agent-dev:
 *   node -r dotenv/config scripts/demo/inspect.js <attemptId> [--reveal] dotenv_config_path=.env.local
 */
const { neon } = require("@neondatabase/serverless");
const identityVault = require("../../api/idv-match/identityVault");

const attemptId = process.argv[2];
const reveal = process.argv.includes("--reveal");
if (!attemptId) { console.error("usage: inspect.js <attemptId> [--reveal]"); process.exit(1); }

function line(label, value) { console.log("  " + label.padEnd(26) + (value == null ? "" : value)); }
function header(t) { console.log("\n=== " + t + " ==="); }

async function main() {
  const sql = neon(process.env.IDV_DATABASE_URL || process.env.DATABASE_URL);

  const attempt = (await sql`SELECT * FROM idv_verification_attempts WHERE id = ${attemptId}`)[0];
  if (!attempt) { console.error("attempt not found:", attemptId); process.exit(1); }
  const ref = attempt.secure_identity_reference;

  header("ATTEMPT (ordinary idv DB) - holds a REFERENCE, no plaintext identity");
  line("application_id", attempt.application_id);
  line("status", attempt.status);
  line("secure_identity_reference", ref);
  line("verification_result", JSON.stringify(attempt.verification_result));

  header("VAULT (encrypted, Neon idv DB) - sensitive identity");
  if (ref) {
    const attrs = await sql`SELECT attribute_concept, left(ciphertext,20) AS ciphertext, version, superseded FROM idv_vault_attributes WHERE secure_identity_reference = ${ref} ORDER BY attribute_concept, version`;
    for (const a of attrs) line(a.attribute_concept, "ciphertext=" + a.ciphertext + "…  v" + a.version + (a.superseded ? " (superseded)" : ""));
    if (reveal) {
      const vals = await identityVault.retrieveForAuthorizedPurpose({ reference: ref, fields: attrs.map((a) => a.attribute_concept), actorId: "demo-inspector", purpose: "KYC_DECISIONING" });
      console.log("  --- REVEALED (authorized + audited decrypt) ---");
      for (const [k, v] of Object.entries(vals)) line("  " + k, v);
    } else {
      console.log("  (masked - run with --reveal to authorized-decrypt; each reveal is audited)");
    }
    const audit = await sql`SELECT actor_id, purpose, outcome, at FROM idv_vault_access_audit WHERE secure_identity_reference = ${ref} ORDER BY at`;
    console.log("  access audit rows: " + audit.length + (audit.length ? "  (last by " + audit[audit.length - 1].actor_id + ")" : ""));
  } else line("(no vault reference)", "");

  header("BAND DECISIONS (ordinary idv DB)");
  for (const d of await sql`SELECT band, outcome_type, resolved_by, policy_version, created_at FROM idv_match_decisions WHERE attempt_id = ${attemptId} ORDER BY created_at`) line("Band " + d.band, d.outcome_type + "  by " + d.resolved_by + "  (" + d.policy_version + ")");

  header("IMMUTABLE IDENTITY EVENTS (references + metadata only)");
  for (const e of await sql`SELECT event_type, attribute_concept, actor FROM idv_identity_events WHERE attempt_id = ${attemptId} ORDER BY occurred_at`) line(e.event_type, (e.attribute_concept || "") + "  by " + e.actor);

  header("LIFECYCLE TIMELINE");
  for (const l of await sql`SELECT event_type, occurred_at, received_at FROM idv_lifecycle_events WHERE attempt_id = ${attemptId} ORDER BY COALESCE(occurred_at, received_at)`) line(l.event_type, "occurred=" + (l.occurred_at || "-") + "  received=" + (l.received_at || "-"));

  header("DOCUMENT MEDIA (encrypted; pointer + wrapped key + hash, NO bytes)");
  for (const m of await sql`SELECT id, evidence_kind, blob_key, content_type, sha256 FROM idv_document_media WHERE attempt_id = ${attemptId}`) { line(m.evidence_kind, "blob_key=" + m.blob_key); line("  sha256", m.sha256); line("  media id", m.id); }

  header("SCREENING (isolated - NOT from the live flow)");
  for (const s of await sql`SELECT outcome, categories FROM idv_screening_checks WHERE attempt_id = ${attemptId}`) line(s.outcome || "(pending)", JSON.stringify(s.categories));

  header("EVIDENCE OUTBOX (references-only envelope; UNCONSUMED)");
  for (const o of await sql`SELECT idempotency_key, status, envelope FROM idv_evidence_outbox WHERE attempt_id = ${attemptId}`) { line("status", o.status); line("envelope", JSON.stringify(o.envelope)); }
}
main().catch((e) => { console.error("inspect failed:", e.message); process.exit(1); });
