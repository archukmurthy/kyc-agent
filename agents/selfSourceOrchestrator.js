/**
 * selfSourceOrchestrator.js
 * Contract version: 1.1 (PR-025 + PR-026)
 *
 * Orchestrates both document retrieval agents and produces:
 *   1. registry      — selfSourceAgent output (registry HTML/screenshot/metadata)
 *   2. webDocs       — docSearchAgent output (Wolfsberg, Annual Report etc.) UNCHANGED
 *   3. selfSourcedFields — PR-026: mapped field values ready to merge into researchResults
 *   4. manualReviewItems — PR-025: items that need analyst manual retrieval
 *   5. mergedTable   — unified view for UI / dossier
 *   6. duplicateFlags — overlap between both agents for review
 *
 * Called by the main KYC agent after Step 1 classifiers are confirmed.
 *
 * Usage:
 *   const { orchestrateDocuments } = require("./selfSourceOrchestrator");
 *
 *   const result = await orchestrateDocuments({
 *     companyName:              "HSBC Holdings plc",
 *     incorporationCountry:     "United Kingdom",
 *     ownershipType:            "public_fi",
 *     niumEntityType:           "fi",
 *     drsChecklist:             checklist,
 *     companyRegistrationNumber: "00014259",   // optional — improves second-pass
 *     outputDir:                "./downloads/case-001",
 *   });
 *
 *   // Wire pre-population:
 *   const merged = mergeResearchResults(researchResults, result.selfSourcedFields);
 *   setResearchResults(merged);
 */

const { selfSourceAgent } = require("./selfSourceAgent");
const { docSearchAgent }  = require("./docSearchAgent");
const { mapSelfSourcedFields, getManualReviewItems } = require("./selfSourceFieldMapper");

/**
 * orchestrateDocuments
 *
 * @param {Object}  params
 * @param {string}  params.companyName
 * @param {string}  params.incorporationCountry
 * @param {string}  params.ownershipType
 * @param {string}  params.niumEntityType
 * @param {Array}   params.drsChecklist
 * @param {string}  [params.companyRegistrationNumber]  - PR-025 second-pass
 * @param {string}  [params.outputDir]
 * @param {boolean} [params.preferredOnly]
 * @returns {Promise<OrchestratorResult>}
 */
async function orchestrateDocuments(params) {
  const {
    companyName,
    incorporationCountry,
    ownershipType,
    niumEntityType,
    drsChecklist              = [],
    companyRegistrationNumber = null,
    outputDir                 = "./downloads",
    preferredOnly             = false,
  } = params;

  console.log("\n[Orchestrator] ══════════════════════════════════════════════");
  console.log(`[Orchestrator] Company:  ${companyName}`);
  console.log(`[Orchestrator] Country:  ${incorporationCountry}`);
  console.log(`[Orchestrator] RegNum:   ${companyRegistrationNumber || "not provided"}`);
  console.log(`[Orchestrator] Entity:   ${niumEntityType} | Ownership: ${ownershipType}`);
  console.log("[Orchestrator] Launching both agents in parallel...");
  console.log("[Orchestrator] ══════════════════════════════════════════════\n");

  // ── Run both agents in parallel ────────────────────────────────────────────
  const [selfSourceResult, docSearchResult] = await Promise.allSettled([

    // Agent 1: Registry self-sourcing (DRS-driven) — PR-025 second-pass enabled
    selfSourceAgent({
      companyName,
      incorporationCountry,
      drsChecklist,
      companyRegistrationNumber,
      outputDir:    `${outputDir}/registry`,
      preferredOnly,
    }),

    // Agent 2: Web document search (Wolfsberg, Annual Report, etc.) — UNCHANGED
    docSearchAgent({
      companyName,
      country:        incorporationCountry,
      ownershipType,
      niumEntityType,
      outputDir:      `${outputDir}/web-docs`,
    }),

  ]);

  // ── Unwrap results ─────────────────────────────────────────────────────────
  const registry = selfSourceResult.status === "fulfilled"
    ? selfSourceResult.value
    : { error: selfSourceResult.reason?.message, results: [], summary: { retrieved: 0, unverified: 0, failed: 0, manualRequired: 0, total: 0 }, cost: null };

  const webDocs = docSearchResult.status === "fulfilled"
    ? docSearchResult.value
    : { error: docSearchResult.reason?.message, documents: [], summary: { found: 0, notFound: 0, total: 0 }, cost: null };

  // ── PR-026: map extracted fields → dossier schema ─────────────────────────
  const flow            = niumEntityType === "fi" ? "fi" : "corporate";
  const selfSourcedFields  = mapSelfSourcedFields(registry.results || [], flow);
  const manualReviewItems  = getManualReviewItems(registry.results || []);

  // ── Duplicate detection ────────────────────────────────────────────────────
  const duplicateFlags = detectDuplicates(registry.results || [], webDocs.documents || []);

  // ── Merged summary table ───────────────────────────────────────────────────
  const mergedTable = buildMergedTable(companyName, registry.results || [], webDocs.documents || []);

  // ── Combined cost ──────────────────────────────────────────────────────────
  const totalCostUSD =
    (registry.cost?.totals?.totalCostUSD ?? 0) +
    (webDocs.cost?.totals?.totalCostUSD   ?? 0);

  const fieldsMapped = Object.keys(selfSourcedFields).length;

  console.log("\n[Orchestrator] ── Summary ──────────────────────────────────");
  console.log(`[Orchestrator]   Registry verified:    ${registry.summary?.retrieved ?? 0}`);
  console.log(`[Orchestrator]   Registry unverified:  ${registry.summary?.unverified ?? 0}`);
  console.log(`[Orchestrator]   Manual review needed: ${manualReviewItems.length}`);
  console.log(`[Orchestrator]   Web docs found:       ${webDocs.summary?.found ?? 0}`);
  console.log(`[Orchestrator]   Fields mapped (PR-026): ${fieldsMapped}`);
  console.log(`[Orchestrator]   Duplicate flags:      ${duplicateFlags.length}`);
  console.log(`[Orchestrator]   Combined cost:        $${totalCostUSD.toFixed(5)}`);
  console.log("[Orchestrator] ────────────────────────────────────────────\n");

  if (manualReviewItems.length > 0) {
    console.log("[Orchestrator] ⚠ Manual review required for:");
    manualReviewItems.forEach(m => console.log(`[Orchestrator]   - ${m.requirement}: ${m.manualReviewReason}`));
    console.log();
  }

  return {
    companyName,
    incorporationCountry,
    ownershipType,
    niumEntityType,

    // Agent outputs — kept separate for independent ownership
    registry,
    webDocs,

    // PR-026: pre-population output — merge into researchResults in App.js
    // Shape: { [fieldId]: { value, tier, source, sourceLabel, sourceUrl, evidenceRef, retrievedAt, confidence } }
    selfSourcedFields,

    // PR-025: items needing manual analyst retrieval
    // Shape: [{ requirement, manualReviewReason, sourceUrl, selfSourceTier }]
    manualReviewItems,

    // Combined views
    mergedTable,
    duplicateFlags,

    summary: {
      registryRetrieved:  registry.summary?.retrieved     ?? 0,
      registryUnverified: registry.summary?.unverified    ?? 0,
      registryFailed:     registry.summary?.failed        ?? 0,
      manualRequired:     manualReviewItems.length,
      webDocsFound:       webDocs.summary?.found          ?? 0,
      webDocsNotFound:    webDocs.summary?.notFound       ?? 0,
      fieldsMappedToDossier: fieldsMapped,
      duplicateFlags:     duplicateFlags.length,
      totalDocuments:     (registry.results?.length ?? 0) + (webDocs.documents?.length ?? 0),
    },

    cost: {
      registryAgent:  registry.cost,
      webSearchAgent: webDocs.cost,
      combined: { totalCostUSD, breakdown: "registry + web search" },
    },

    orchestratedAt: new Date().toISOString(),
    outputDir,
  };
}

// ─── Duplicate detection ───────────────────────────────────────────────────────
const OVERLAP_MAP = {
  "Legal existence":   ["annual_report"],
  "Regulatory status": ["wolfsberg_questionnaire"],
  "Business activity": ["annual_report", "audited_financials"],
  "Ownership / control": ["annual_report"],
};

function detectDuplicates(registryResults, webDocResults) {
  const flags    = [];
  const webTypes = new Set(webDocResults.map(d => d.type));
  for (const reg of registryResults) {
    const overlaps = OVERLAP_MAP[reg.requirement] || [];
    for (const overlap of overlaps) {
      if (webTypes.has(overlap)) {
        flags.push({
          drsRequirement:  reg.requirement,
          webDocType:      overlap,
          note:            `Both agents retrieved evidence for "${reg.requirement}". Review and decide primary source.`,
          recommendation:  reg.selfSourceTier === "Preferred self-source"
            ? "Keep registry as primary (tier-1). Web doc is supplementary."
            : "Review both. Web doc may be the stronger source.",
        });
      }
    }
  }
  return flags;
}

// ─── Merged summary table ──────────────────────────────────────────────────────
function buildMergedTable(companyName, registryResults, webDocResults) {
  const registryRows = registryResults.map(r => ({
    companyName,
    source:           "Registry self-source",
    requirement:      r.requirement,
    tier:             r.selfSourceTier,
    status:           r.status,
    manualReviewFlag: r.manualReviewFlag ?? false,
    retrievedAt:      r.retrievedAt,
    sourceUrl:        r.searchUrl || r.sourceUrl,
    filesCount:       r.files?.length ?? 0,
    matchConf:        r.extracted?.matchConfidence ?? "—",
    costUSD:          r.cost?.totalCostUSD?.toFixed(5) ?? "—",
    notes:            r.manualReviewReason || r.extracted?.notes || "",
  }));

  const webRows = webDocResults.map(d => ({
    companyName,
    source:           "Web document search",
    requirement:      d.label,
    tier:             "Web search",
    status:           d.status,
    manualReviewFlag: false,
    retrievedAt:      d.cost?.timestamp ?? "—",
    sourceUrl:        d.sourceUrl || "—",
    filesCount:       d.localPath ? 1 : 0,
    matchConf:        d.confidence || "—",
    costUSD:          d.cost?.totalCostUSD?.toFixed(5) ?? "—",
    notes:            d.notes || "",
  }));

  return [...registryRows, ...webRows];
}

module.exports = { orchestrateDocuments };
