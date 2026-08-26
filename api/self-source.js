/**
 * api/self-source.js
 * Vercel serverless endpoint — runs the registry self-sourcing agent.
 *
 * Called in parallel with /api/doc-search from App.js when the Documents
 * step is entered. Returns registry-sourced field values ready to merge
 * into researchResults for dossier pre-population.
 *
 * Playwright screenshots are SKIPPED on Vercel (process.env.VERCEL === "1").
 * Evidence = HTML snapshot + AI extraction + metadata JSON stored in /tmp.
 * See PR-028 for the production screenshot path (Option B).
 *
 * CommonJS — matches api/doc-search.js pattern.
 */

module.exports = async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const {
    companyName,
    incorporationCountry,
    entityType,
    ownershipType,
    entityCategory,
    companyRegistrationNumber, // optional — improves second-pass on BR/JP/ID/CN
    tenantId,                  // reserved
  } = req.body || {};

  if (!companyName || !incorporationCountry || !entityType || !ownershipType) {
    return res.status(400).json({
      error: "Missing required fields: companyName, incorporationCountry, entityType, ownershipType",
    });
  }

  try {
    // ── Lazy requires ──────────────────────────────────────────────────────
    const { getRequirements } = require("../documentRequirements");
    const { selfSourceAgent } = require("../agents/selfSourceAgent");
    const { mapSelfSourcedFields, getManualReviewItems } = require("../agents/selfSourceFieldMapper");

    // ── Derive DRS checklist server-side (Option B) ────────────────────────
    // No need to pass the checklist over the wire — recompute from params.
    const checklist = getRequirements({
      incorporationCountry,
      entityType,
      ownershipType,
    });

    const selfSourceItems = checklist.filter(i =>
      ["Preferred self-source", "Supplementary self-source"].includes(i.selfSource)
        && i.sourceUrl
    );

    // Short-circuit: nothing to self-source for this combination
    if (selfSourceItems.length === 0) {
      return res.status(200).json({
        success: true,
        selfSourceItems: 0,
        selfSourcedFields: {},
        manualReviewItems: [],
        results: [],
        summary: { retrieved: 0, unverified: 0, failed: 0, manualRequired: 0, total: 0 },
        cost: null,
        searchedAt: new Date().toISOString(),
      });
    }

    // ── Output directory ───────────────────────────────────────────────────
    // Vercel: /tmp only. Locally: ./downloads (gitignored).
    const baseDir = process.env.VERCEL ? "/tmp/downloads" : "./downloads";
    const caseId  = [
      companyName.replace(/[^a-zA-Z0-9]/g, "_").toLowerCase().slice(0, 30),
      Date.now(),
    ].join("_");
    const outputDir = `${baseDir}/${caseId}/registry`;

    // ── Run self-source agent ──────────────────────────────────────────────
    // Playwright is auto-skipped inside selfSourceAgent when process.env.VERCEL
    // is set (screenshotHelper checks this before launching browser).
    const agentResult = await selfSourceAgent({
      companyName,
      incorporationCountry,
      drsChecklist:             checklist,
      companyRegistrationNumber: companyRegistrationNumber || null,
      outputDir,
      preferredOnly: false,     // include Supplementary items
    });

    // ── Map extracted fields → dossier schema ─────────────────────────────
    const flow = entityCategory === "fi" ? "fi" : "corporate";
    const selfSourcedFields = mapSelfSourcedFields(agentResult.results, flow);
    const manualReviewItems = getManualReviewItems(agentResult.results);

    return res.status(200).json({
      success:          true,
      selfSourceItems:  selfSourceItems.length,
      selfSourcedFields,      // { [fieldId]: { value, tier, source, sourceLabel, sourceUrl, ... } }
      manualReviewItems,      // [{ requirement, manualReviewReason, sourceUrl }]
      results:          agentResult.results,
      summary:          agentResult.summary,
      cost:             agentResult.cost,
      searchedAt:       agentResult.searchedAt,
    });

  } catch (err) {
    console.error("[api/self-source] Error:", err);
    return res.status(500).json({
      error: err.message || "Self-source agent failed",
    });
  }
};
