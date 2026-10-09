"use strict";

// Reviewer access to a verification case (Phase E4). Sensitive values are MASKED
// by default; the full value is released only through an explicit, authorized,
// AUDITED reveal (never URL/possession - the Vault records every read). This is
// the server capability; a minimal read-only view (src/idv-match/ReviewerCase)
// renders it. The full review-queue UI is a later phase.
const attemptStore = require("./attemptStore");
const matchDecisionStore = require("./matchDecisionStore");
const identityEventsStore = require("./identityEventsStore");
const identityVault = require("./identityVault");
const { bandsEnabled } = require("./config");
const { applyCors, requireAdmin } = require("../../lib/routeAuth");

// Concepts a reviewer may see (mrz stays server-side matching-only, never shown).
const REVIEWABLE_CONCEPTS = [
  "first_name", "last_name", "date_of_birth", "nationality", "document_number",
  "document_type", "expiry_date", "issuing_country", "gender", "place_of_birth", "address",
];

const MASK = "••••••";
function mask(value) {
  const s = String(value == null ? "" : value);
  if (!s) return "";
  if (s.length <= 4) return "••••";
  return "••••" + s.slice(-4);
}

// Case summary: status, decisions, immutable events, and MASKED identity fields.
async function getCase(attemptId, deps = {}) {
  if (!bandsEnabled()) return { enabled: false };
  if (!attemptId) return { enabled: true, error: "attemptId_required" };
  const store = deps.attemptStore || attemptStore;
  const decisions = deps.matchDecisionStore || matchDecisionStore;
  const events = deps.identityEventsStore || identityEventsStore;
  const vault = deps.identityVault || identityVault;

  const attempt = await store.getAttempt(attemptId);
  if (!attempt) return { enabled: true, error: "attempt_not_found" };

  // Mask WITHOUT decrypting: list which reviewable concepts exist and show a
  // placeholder. The full value is fetched only via an explicit audited reveal.
  const maskedFields = {};
  if (attempt.secure_identity_reference) {
    const concepts = await vault.listConcepts({ reference: attempt.secure_identity_reference });
    for (const concept of concepts) {
      if (REVIEWABLE_CONCEPTS.includes(concept)) maskedFields[concept] = MASK;
    }
  }
  return {
    enabled: true,
    attemptId,
    status: attempt.status,
    secureIdentityReference: attempt.secure_identity_reference || null,
    decisions: await decisions.listByAttempt(attemptId),
    events: await events.listByAttempt(attemptId),
    maskedFields,
  };
}

// Authorized + audited reveal of ONE field's full value.
async function revealField({ attemptId, concept, actorId }, deps = {}) {
  if (!bandsEnabled()) return { enabled: false };
  if (!attemptId || !concept || !actorId) return { enabled: true, error: "attemptId_concept_actor_required" };
  if (!REVIEWABLE_CONCEPTS.includes(concept)) return { enabled: true, error: "concept_not_reviewable" };
  const store = deps.attemptStore || attemptStore;
  const vault = deps.identityVault || identityVault;
  const attempt = await store.getAttempt(attemptId);
  if (!attempt || !attempt.secure_identity_reference) return { enabled: true, error: "no_vault_reference" };
  const values = await vault.retrieveForAuthorizedPurpose({
    reference: attempt.secure_identity_reference, fields: [concept], actorId, purpose: "KYC_DECISIONING",
  });
  return { enabled: true, concept, value: values[concept] == null ? null : values[concept] };
}

async function handler(req, res) {
  if (applyCors(req, res)) return undefined;

  // This route releases identity data. It had no credential check at all, and
  // it believed the actorId in the query string - so the Vault's audit record,
  // the thing that makes a reveal accountable, recorded whatever the caller
  // typed. Both halves are fixed here: a real admin credential, and the actor
  // taken from that credential.
  const tenant = await requireAdmin(req, res);
  if (!tenant) return undefined;
  const actorId = `admin:${tenant}`;

  const q = { ...(req.query || {}), ...(req.body || {}) };
  try {
    if (req.method === "POST" && q.reveal) {
      return res.status(200).json(await revealField({ attemptId: q.attemptId, concept: q.concept, actorId }));
    }
    if (!q.attemptId) return res.status(400).json({ error: "attemptId_required" });
    return res.status(200).json(await getCase(q.attemptId, { actorId }));
  } catch (err) {
    console.error("[idv-match reviewer]", err && err.message);
    return res.status(500).json({ error: "reviewer_error" });
  }
}

module.exports = handler;
module.exports.getCase = getCase;
module.exports.revealField = revealField;
module.exports.mask = mask;
module.exports.REVIEWABLE_CONCEPTS = REVIEWABLE_CONCEPTS;
