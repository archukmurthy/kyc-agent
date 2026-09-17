// Live customer onboarding submission → Neon Postgres.
//
// Two-phase submit: (1) durably enqueue the raw bundle into submission_inbox
// (Task 2's store) so it is never lost, then (2) try the real 11-table write
// once inline via finalizeSubmission (Task 4). Success → "saved" with the new
// IDs; finalize failure → "queued" and the row stays pending for the retry
// worker (Phase 5). The customer is never blocked: enqueue is the only step
// whose failure produces a non-200 response.
"use strict";

const { enqueue, markProcessing, markDone, markFailed } = require("./lib/submissionInboxStore");
const { finalizeSubmission } = require("./lib/finalizeSubmission");
const dossierAccess = require("../lib/dossierAccess");

// Injected deps (overridable in tests via __setDeps).
let _deps = { enqueue, finalizeSubmission, markProcessing, markDone, markFailed, access: dossierAccess };

module.exports = async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const rawBody = req.body || {};
  const { submissionId, tenantId, company } = rawBody;
  if (!submissionId || !tenantId || !company || !company.name) {
    return res.status(400).json({
      error: "Missing required fields: submissionId, tenantId and company.name are required",
    });
  }
  if (!process.env.DATABASE_URL) {
    // No DB configured: we cannot durably capture. Report queued so the client keeps
    // its browser draft and retries; nothing is silently lost.
    console.error("[api/submit] No DATABASE_URL");
    return res.status(200).json({ status: "queued", submissionId });
  }

  // A submission may name the analyst dossier it came from, but only the
  // customer holding that dossier's signed link may claim it — otherwise anyone
  // could attach a submission to (and lock the analyst out of) any dossier.
  let verifiedDossierId = null;
  if (rawBody.dossierId) {
    try {
      const actor = await _deps.access.resolveDossierActor(req);
      if (
        actor.kind === "customer" &&
        actor.dossierId === String(rawBody.dossierId) &&
        actor.tenantId === tenantId
      ) {
        verifiedDossierId = actor.dossierId;
      }
    } catch (err) {
      console.warn("[api/submit] dossier link not verified:", err.message);
    }
  }
  const body = { ...rawBody, dossierId: verifiedDossierId };

  // Phase 1: durable capture. If this throws, the request fails loudly (non-200) so
  // the browser keeps retrying from its saved draft — the bundle is NOT yet safe.
  try {
    await _deps.enqueue({ submissionId, tenantId, payload: body });
  } catch (err) {
    console.error("[api/submit] enqueue failed:", err.message);
    return res.status(503).json({ status: "capture_failed", submissionId, error: err.message });
  }

  // Claim the row before the inline finalize attempt so a concurrent cron tick can't
  // also finalize it (double-finalize window). Best-effort: a crash here is covered
  // by claimPending's stale-processing reclaim, so don't fail the submit over it.
  let claimed = false;
  try {
    await _deps.markProcessing(submissionId);
    claimed = true;
  } catch (err) {
    console.error("[api/submit] markProcessing failed (best-effort):", err.message);
  }

  // Phase 2: try the real save once, inline. Success → saved; failure → queued for
  // the worker. Either way the customer is never blocked and never loses data.
  try {
    const r = await _deps.finalizeSubmission(body);
    await _deps.markDone(submissionId, r.sessionId);
    console.log(`[api/submit] saved inline — session ${r.sessionId}`);
    return res.status(200).json({ status: "saved", ...r });
  } catch (err) {
    // Count this attempt here only if markProcessing didn't already count it above —
    // never double-counts, never zero-counts.
    await _deps.markFailed(submissionId, err.message, { incrementAttempt: !claimed }).catch(() => {});
    console.warn(`[api/submit] finalize deferred to worker (${submissionId}):`, err.message);
    return res.status(200).json({ status: "queued", submissionId });
  }
};

// Test seam only.
module.exports.__setDeps = (d) => { _deps = { ..._deps, ...d }; };
